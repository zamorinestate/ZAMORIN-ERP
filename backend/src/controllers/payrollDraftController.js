'use strict';

const {
  PayrollRun,
} = require('../models/PayrollRun');

const {
  Payslip,
} = require('../models/Payslip');

const {
  recordRequestAudit,
} = require('../services/auditService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const {
  buildPayslipAttendanceSnapshot,
} = require('../services/attendancePayrollSummaryService');

const PAYROLL_MANAGEMENT_ROLES = [
  'MASTER',
  'OWNER',
];

const EARNING_FIELDS = [
  'basicPayPaise',
  'houseRentAllowancePaise',
  'otherAllowancePaise',
  'overtimePayPaise',
  'incentivePaise',
  'otherEarningPaise',
];

const DEDUCTION_FIELDS = [
  'providentFundPaise',
  'employeeStateInsurancePaise',
  'professionalTaxPaise',
  'incomeTaxPaise',
  'loanAdvanceDeductionPaise',
  'unpaidLeaveDeductionPaise',
  'otherDeductionPaise',
];

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function requirePayrollManagementAccess(
  request
) {
  if (
    !PAYROLL_MANAGEMENT_ROLES.includes(
      request.auth.role
    )
  ) {
    throw new ApiError(
      403,
      'PAYROLL_MANAGEMENT_FORBIDDEN',
      'Only MASTER and OWNER may manage payroll.'
    );
  }

  // Normal Master cannot manage organisational payroll.
  if (
    request.auth.role === 'MASTER' &&
    !request.auth.isPrimaryMaster
  ) {
    throw new ApiError(
      403,
      'PRIMARY_MASTER_AUTHORITY_REQUIRED',
      'Managing organisational payroll requires Primary Master authority.'
    );
  }
}

function normalizePayrollRunId(value) {
  const payrollRunId =
    normalizeIdentifier(value);

  if (
    !/^PR-\d{6}-\d{4,}$/.test(
      payrollRunId
    )
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_RUN_ID',
      'A valid payroll run ID is required.'
    );
  }

  return payrollRunId;
}

function normalizePayslipId(value) {
  const payslipId =
    normalizeIdentifier(value);

  if (
    !/^PS-\d{6}-\d{4,}$/.test(
      payslipId
    )
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYSLIP_ID',
      'A valid payslip ID is required.'
    );
  }

  return payslipId;
}

function normalizeText({
  value,
  maximumLength,
  fieldName,
}) {
  if (typeof value !== 'string') {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_TEXT_FIELD',
      `${fieldName} must be text.`
    );
  }

  const normalizedValue =
    value.trim();

  if (
    normalizedValue.length >
    maximumLength
  ) {
    throw new ApiError(
      400,
      'PAYROLL_TEXT_FIELD_TOO_LONG',
      `${fieldName} must not exceed ${maximumLength} characters.`
    );
  }

  return normalizedValue;
}

function rejectUnknownFields({
  source,
  allowedFields,
  code,
  message,
}) {
  const unknownFields =
    Object.keys(source).filter(
      (field) =>
        !allowedFields.includes(field)
    );

  if (unknownFields.length > 0) {
    throw new ApiError(
      400,
      code,
      message
    );
  }
}

function parseIntegerPatch({
  value,
  currentValue,
  allowedFields,
  sectionName,
}) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_SECTION',
      `${sectionName} must be an object.`
    );
  }

  rejectUnknownFields({
    source: value,
    allowedFields,
    code: 'UNKNOWN_PAYROLL_FIELD',
    message:
      `${sectionName} contains unsupported or protected fields.`,
  });

  const parsed = {};

  for (const field of allowedFields) {
    const fieldValue =
      Object.prototype.hasOwnProperty.call(
        value,
        field
      )
        ? value[field]
        : Number(
            currentValue?.[field] || 0
          );

    if (
      !Number.isSafeInteger(
        fieldValue
      ) ||
      fieldValue < 0
    ) {
      throw new ApiError(
        400,
        'INVALID_PAYROLL_NUMBER',
        `${sectionName}.${field} must be a safe non-negative integer.`
      );
    }

    parsed[field] = fieldValue;
  }

  return parsed;
}

function sumSafeIntegers(
  values,
  fieldName
) {
  let total = 0;

  for (const value of values) {
    total += value;

    if (!Number.isSafeInteger(total)) {
      throw new ApiError(
        400,
        'PAYROLL_TOTAL_TOO_LARGE',
        `${fieldName} exceeds the supported amount.`
      );
    }
  }

  return total;
}

async function findManagedDraftPayrollRun(
  request,
  payrollRunId
) {
  const filter = {
    organisationId:
      request.auth.organisationId,
    payrollRunId,
  };

  if (request.auth.role === 'OWNER') {
    filter.cafeId = {
      $in:
        request.auth.assignedCafeIds || [],
    };
  }

  const payrollRun =
    await PayrollRun.findOne(filter);

  if (!payrollRun) {
    throw new ApiError(
      404,
      'PAYROLL_RUN_NOT_FOUND',
      'The payroll run was not found.'
    );
  }

  if (payrollRun.status !== 'DRAFT') {
    throw new ApiError(
      409,
      'PAYROLL_RUN_NOT_EDITABLE',
      'Only a DRAFT payroll run may be edited.'
    );
  }

  return payrollRun;
}

const updateDraftPayrollRun =
  asyncHandler(
    async (request, response) => {
      requirePayrollManagementAccess(
        request
      );

      const body =
        request.body || {};

      rejectUnknownFields({
        source: body,
        allowedFields: ['notes'],
        code:
          'PROTECTED_PAYROLL_RUN_FIELD',
        message:
          'Only payroll-run notes may be edited while the run is in DRAFT status.',
      });

      if (
        !Object.prototype.hasOwnProperty.call(
          body,
          'notes'
        )
      ) {
        throw new ApiError(
          400,
          'PAYROLL_RUN_UPDATE_REQUIRED',
          'A payroll-run notes update is required.'
        );
      }

      const payrollRunId =
        normalizePayrollRunId(
          request.params.payrollRunId
        );

      const payrollRun =
        await findManagedDraftPayrollRun(
          request,
          payrollRunId
        );

      const before = {
        notes: payrollRun.notes || '',
      };

      payrollRun.notes =
        normalizeText({
          value: body.notes,
          maximumLength: 2000,
          fieldName: 'notes',
        });

      payrollRun.updatedBy =
        request.auth.userId;

      await payrollRun.save();

      await recordRequestAudit({
        request,
        module: 'PAYROLL',
        action:
          'UPDATE_PAYROLL_RUN_DRAFT',
        entityType: 'PAYROLL_RUN',
        entityId: payrollRunId,
        cafeId: payrollRun.cafeId,
        before,
        after: {
          notes: payrollRun.notes,
        },
        riskClassification: 'HIGH',
      });

      return response.status(200).json({
        success: true,
        message:
          'Draft payroll run updated successfully.',
        data: {
          payrollRun,
        },
        correlationId:
          request.correlationId || null,
      });
    }
  );

const updateDraftPayrollRunPayslip =
  asyncHandler(
    async (request, response) => {
      requirePayrollManagementAccess(
        request
      );

      const body =
        request.body || {};

      const allowedFields = [
        'attendanceSummary',
        'earnings',
        'deductions',
        'notes',
      ];

      rejectUnknownFields({
        source: body,
        allowedFields,
        code:
          'PROTECTED_PAYSLIP_FIELD',
        message:
          'Only draft payslip attendance, earnings, deductions and notes may be edited.',
      });

      if (
        !allowedFields.some((field) =>
          Object.prototype.hasOwnProperty.call(
            body,
            field
          )
        )
      ) {
        throw new ApiError(
          400,
          'PAYSLIP_UPDATE_REQUIRED',
          'At least one draft payslip field must be supplied.'
        );
      }

      const payrollRunId =
        normalizePayrollRunId(
          request.params.payrollRunId
        );

      const payrollRun =
        await findManagedDraftPayrollRun(
          request,
          payrollRunId
        );

      const payslipId =
        normalizePayslipId(
          request.params.payslipId
        );

      const payslip =
        await Payslip.findOne({
          organisationId:
            request.auth.organisationId,
          payrollRunId,
          cafeId: payrollRun.cafeId,
          payslipId,
        });

      if (!payslip) {
        throw new ApiError(
          404,
          'PAYSLIP_NOT_FOUND',
          'The payslip was not found.'
        );
      }

      if (payslip.status !== 'DRAFT') {
        throw new ApiError(
          409,
          'PAYSLIP_NOT_EDITABLE',
          'Only a DRAFT payslip may be edited.'
        );
      }

      // attendanceSummary is always re-derived from real Attendance / Leave /
      // Holiday records; a client-supplied value (the editable attendance
      // inputs in the UI) is accepted but ignored.
      const attendanceSummary =
        await buildPayslipAttendanceSnapshot(
          {
            organisationId:
              request.auth.organisationId,
            cafeId:
              payrollRun.cafeId ||
              payslip.cafeId,
            userId:
              payslip.employeeUserId,
            periodKey:
              payslip.periodKey ||
              payrollRun.periodKey,
          }
        );

      const earnings =
        Object.prototype.hasOwnProperty.call(
          body,
          'earnings'
        )
          ? parseIntegerPatch({
              value: body.earnings,
              currentValue:
                payslip.earnings,
              allowedFields:
                EARNING_FIELDS,
              sectionName: 'earnings',
            })
          : Object.fromEntries(
              EARNING_FIELDS.map(
                (field) => [
                  field,
                  Number(
                    payslip.earnings?.[
                      field
                    ] || 0
                  ),
                ]
              )
            );

      const deductions =
        Object.prototype.hasOwnProperty.call(
          body,
          'deductions'
        )
          ? parseIntegerPatch({
              value: body.deductions,
              currentValue:
                payslip.deductions,
              allowedFields:
                DEDUCTION_FIELDS,
              sectionName: 'deductions',
            })
          : Object.fromEntries(
              DEDUCTION_FIELDS.map(
                (field) => [
                  field,
                  Number(
                    payslip.deductions?.[
                      field
                    ] || 0
                  ),
                ]
              )
            );

      const grossPayPaise =
        sumSafeIntegers(
          EARNING_FIELDS.map(
            (field) => earnings[field]
          ),
          'grossPayPaise'
        );

      const totalDeductionPaise =
        sumSafeIntegers(
          DEDUCTION_FIELDS.map(
            (field) =>
              deductions[field]
          ),
          'totalDeductionPaise'
        );

      if (
        totalDeductionPaise >
        grossPayPaise
      ) {
        throw new ApiError(
          400,
          'PAYSLIP_DEDUCTIONS_EXCEED_GROSS',
          'Payslip deductions cannot exceed gross pay.'
        );
      }

      const before = {
        grossPayPaise:
          Number(
            payslip.earnings
              ?.grossPayPaise || 0
          ),
        totalDeductionPaise:
          Number(
            payslip.deductions
              ?.totalDeductionPaise || 0
          ),
        netPayPaise:
          Number(
            payslip.netPayPaise || 0
          ),
        notes: payslip.notes || '',
      };

      payslip.attendanceSummary =
        attendanceSummary;

      payslip.earnings = {
        ...earnings,
        grossPayPaise,
      };

      payslip.deductions = {
        ...deductions,
        totalDeductionPaise,
      };

      payslip.netPayPaise =
        grossPayPaise -
        totalDeductionPaise;

      if (
        Object.prototype.hasOwnProperty.call(
          body,
          'notes'
        )
      ) {
        payslip.notes =
          normalizeText({
            value: body.notes,
            maximumLength: 2000,
            fieldName: 'notes',
          });
      }

      payslip.updatedBy =
        request.auth.userId;

      await payslip.save();

      await recordRequestAudit({
        request,
        module: 'PAYROLL',
        action:
          'UPDATE_PAYSLIP_DRAFT',
        entityType: 'PAYSLIP',
        entityId: payslipId,
        cafeId: payrollRun.cafeId,
        before,
        after: {
          grossPayPaise,
          totalDeductionPaise,
          netPayPaise:
            payslip.netPayPaise,
          notes: payslip.notes || '',
        },
        riskClassification: 'HIGH',
        metadata: {
          payrollRunId,
          employeeUserId:
            payslip.employeeUserId,
        },
      });

      return response.status(200).json({
        success: true,
        message:
          'Draft payslip updated successfully.',
        data: {
          payslip,
        },
        correlationId:
          request.correlationId || null,
      });
    }
  );

module.exports = {
  updateDraftPayrollRun,
  updateDraftPayrollRunPayslip,
};
