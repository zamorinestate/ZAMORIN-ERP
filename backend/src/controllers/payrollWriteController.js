'use strict';

const {
  PayrollRun,
} = require('../models/PayrollRun');

const {
  Payslip,
  EMPLOYEE_USER_ID_PATTERN,
} = require('../models/Payslip');

const {
  User,
} = require('../models/User');

const {
  Cafe,
} = require('../models/Cafe');

const {
  SequenceCounter,
} = require('../models/SequenceCounter');

const {
  canAccessCafe,
} = require('../middleware/authorize');

const {
  recordRequestAudit,
} = require('../services/auditService');

const {
  buildPayslipAttendanceSnapshot,
} = require('../services/attendancePayrollSummaryService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const PAYROLL_MANAGEMENT_ROLES = [
  'MASTER',
  'OWNER',
];

const CAFE_ASSIGNED_EMPLOYEE_ROLES = [
  'CAFE_ADMIN',
  'STAFF',
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
  if (request.auth.role === 'OWNER') {
    throw new ApiError(
      403,
      'PERMISSION_DENIED',
      'Owner persona is read-only governance and cannot create or modify payroll runs.'
    );
  }

  if (
    request.auth.role !== 'MASTER'
  ) {
    throw new ApiError(
      403,
      'PAYROLL_MANAGEMENT_FORBIDDEN',
      'Only MASTER may manage payroll.'
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

function ensureCafeAccess(
  request,
  cafeId
) {
  if (
    !canAccessCafe(
      request.auth,
      cafeId
    )
  ) {
    throw new ApiError(
      403,
      'CAFE_ACCESS_DENIED',
      'You do not have access to this café.'
    );
  }
}

function normalizeRequiredCafeId(value) {
  const cafeId =
    normalizeIdentifier(value);

  if (!/^ZC-\d{4,}$/.test(cafeId)) {
    throw new ApiError(
      400,
      'INVALID_CAFE_ID',
      'A valid café ID is required.'
    );
  }

  return cafeId;
}

function parseRequiredPeriod(value) {
  const periodKey =
    typeof value === 'string'
      ? value.trim()
      : '';

  const match =
    /^(\d{4})-(\d{2})$/.exec(
      periodKey
    );

  if (!match) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_PERIOD',
      'periodKey must use YYYY-MM format.'
    );
  }

  const year =
    Number.parseInt(match[1], 10);

  const month =
    Number.parseInt(match[2], 10);

  if (
    year < 2000 ||
    year > 9999 ||
    month < 1 ||
    month > 12
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_PERIOD',
      'periodKey must contain a valid year and calendar month.'
    );
  }

  const periodPart =
    `${match[1]}${match[2]}`;

  const finalDay =
    new Date(
      Date.UTC(year, month, 0)
    ).getUTCDate();

  return {
    periodKey,
    periodPart,
    periodStartDate:
      `${periodKey}-01`,
    periodEndDate:
      `${periodKey}-` +
      String(finalDay).padStart(
        2,
        '0'
      ),
  };
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

function normalizeEmployeeUserId(value) {
  const employeeUserId =
    normalizeIdentifier(value);

  if (
    !EMPLOYEE_USER_ID_PATTERN.test(
      employeeUserId
    )
  ) {
    throw new ApiError(
      400,
      'INVALID_EMPLOYEE_USER_ID',
      'A valid employee user ID is required.'
    );
  }

  return employeeUserId;
}

function normalizeOptionalText({
  value,
  maximumLength,
  fieldName,
}) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

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

function rejectProtectedFields({
  source,
  fields,
  code,
  message,
}) {
  const suppliedFields =
    fields.filter((field) =>
      Object.prototype.hasOwnProperty.call(
        source,
        field
      )
    );

  if (suppliedFields.length > 0) {
    throw new ApiError(
      400,
      code,
      message
    );
  }
}

function parseIntegerSection({
  value,
  allowedFields,
  sectionName,
}) {
  const source =
    value === undefined ||
    value === null
      ? {}
      : value;

  if (
    typeof source !== 'object' ||
    Array.isArray(source)
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_SECTION',
      `${sectionName} must be an object.`
    );
  }

  const unknownFields =
    Object.keys(source).filter(
      (field) =>
        !allowedFields.includes(field)
    );

  if (unknownFields.length > 0) {
    throw new ApiError(
      400,
      'UNKNOWN_PAYROLL_FIELD',
      `${sectionName} contains unsupported fields.`
    );
  }

  const parsed = {};

  for (const field of allowedFields) {
    const fieldValue =
      source[field] === undefined
        ? 0
        : source[field];

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
      'Payslips may be added only while the payroll run is in DRAFT status.'
    );
  }

  return payrollRun;
}

const createPayrollRun = asyncHandler(
  async (request, response) => {
    requirePayrollManagementAccess(
      request
    );

    const body =
      request.body || {};

    rejectProtectedFields({
      source: body,
      fields: [
        'payrollRunId',
        'organisationId',
        'periodStartDate',
        'periodEndDate',
        'status',
        'employeeCount',
        'totalGrossPaise',
        'totalDeductionPaise',
        'totalNetPayPaise',
        'currency',
        'calculatedAt',
        'calculatedBy',
        'submittedAt',
        'submittedBy',
        'approvedAt',
        'approvedBy',
        'paidAt',
        'paidBy',
        'paymentReference',
        'voidedAt',
        'voidedBy',
        'voidReason',
        'timezone',
        'createdBy',
        'updatedBy',
      ],
      code:
        'PROTECTED_PAYROLL_RUN_FIELD',
      message:
        'Payroll-run identifiers, totals, status and lifecycle fields are controlled by the backend.',
    });

    const cafeId =
      normalizeRequiredCafeId(
        body.cafeId
      );

    ensureCafeAccess(
      request,
      cafeId
    );

    const period =
      parseRequiredPeriod(
        body.periodKey
      );

    const cafe =
      await Cafe.findOne({
        organisationId:
          request.auth.organisationId,
        cafeId,
        status: {
          $ne: 'ARCHIVED',
        },
      });

    if (!cafe) {
      throw new ApiError(
        404,
        'CAFE_NOT_FOUND',
        'The café was not found.'
      );
    }

    const existingPayrollRun =
      await PayrollRun.findOne({
        organisationId:
          request.auth.organisationId,
        cafeId,
        periodKey:
          period.periodKey,
      });

    if (existingPayrollRun) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_ALREADY_EXISTS',
        'A payroll run already exists for this café and period.'
      );
    }

    const notes =
      normalizeOptionalText({
        value: body.notes,
        maximumLength: 2000,
        fieldName: 'notes',
      });

    const payrollRunId =
      await SequenceCounter.generateId({
        organisationId:
          request.auth.organisationId,
        sequenceKey:
          `PAYROLL_RUN_${period.periodPart}`,
        prefix:
          `PR-${period.periodPart}`,
        minimumDigits: 4,
      });

    const payrollRun =
      await PayrollRun.create({
        payrollRunId,
        organisationId:
          request.auth.organisationId,
        cafeId,
        periodKey:
          period.periodKey,
        periodStartDate:
          period.periodStartDate,
        periodEndDate:
          period.periodEndDate,
        status: 'DRAFT',
        employeeCount: 0,
        totalGrossPaise: 0,
        totalDeductionPaise: 0,
        totalNetPayPaise: 0,
        currency: 'INR',
        notes,
        timezone: 'Asia/Kolkata',
        createdBy:
          request.auth.userId,
        updatedBy:
          request.auth.userId,
      });

    await recordRequestAudit({
      request,
      module: 'PAYROLL',
      action: 'CREATE_PAYROLL_RUN',
      entityType: 'PAYROLL_RUN',
      entityId: payrollRunId,
      cafeId,
      after: {
        payrollRunId,
        cafeId,
        periodKey:
          period.periodKey,
        status: 'DRAFT',
      },
      riskClassification: 'HIGH',
      metadata: {
        cafeStatus: cafe.status,
      },
    });

    return response.status(201).json({
      success: true,
      message:
        'Payroll run created successfully.',
      data: {
        payrollRun,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const createPayrollRunPayslip =
  asyncHandler(
    async (request, response) => {
      requirePayrollManagementAccess(
        request
      );

      const body =
        request.body || {};

      rejectProtectedFields({
        source: body,
        fields: [
          'payslipId',
          'organisationId',
          'payrollRunId',
          'cafeId',
          'employeeName',
          'periodKey',
          'periodStartDate',
          'periodEndDate',
          'netPayPaise',
          'currency',
          'status',
          'issuedAt',
          'issuedBy',
          'paidAt',
          'paidBy',
          'paymentReference',
          'voidedAt',
          'voidedBy',
          'voidReason',
          'timezone',
          'createdBy',
          'updatedBy',
        ],
        code:
          'PROTECTED_PAYSLIP_FIELD',
        message:
          'Payslip identifiers, computed totals, status and lifecycle fields are controlled by the backend.',
      });

      const payrollRunId =
        normalizePayrollRunId(
          request.params.payrollRunId
        );

      const payrollRun =
        await findManagedDraftPayrollRun(
          request,
          payrollRunId
        );

      const employeeUserId =
        normalizeEmployeeUserId(
          body.employeeUserId
        );

      const employee =
        await User.findOne({
          organisationId:
            request.auth.organisationId,
          userId: employeeUserId,
          accountStatus: 'ACTIVE',
        });

      if (!employee) {
        throw new ApiError(
          404,
          'ACTIVE_EMPLOYEE_NOT_FOUND',
          'An active employee with this user ID was not found.'
        );
      }

      if (
        CAFE_ASSIGNED_EMPLOYEE_ROLES
          .includes(employee.role) &&
        !(
          employee.assignedCafeIds || []
        ).includes(payrollRun.cafeId)
      ) {
        throw new ApiError(
          400,
          'EMPLOYEE_NOT_ASSIGNED_TO_CAFE',
          'Café Admin and Staff employees must be assigned to the payroll café.'
        );
      }

      const existingPayslip =
        await Payslip.findOne({
          organisationId:
            request.auth.organisationId,
          payrollRunId,
          employeeUserId,
        });

      if (existingPayslip) {
        throw new ApiError(
          409,
          'PAYSLIP_ALREADY_EXISTS',
          'A payslip already exists for this employee in the payroll run.'
        );
      }

      if (
        body.earnings &&
        Object.prototype.hasOwnProperty.call(
          body.earnings,
          'grossPayPaise'
        )
      ) {
        throw new ApiError(
          400,
          'PROTECTED_PAYSLIP_TOTAL',
          'earnings.grossPayPaise is calculated by the backend.'
        );
      }

      if (
        body.deductions &&
        Object.prototype.hasOwnProperty.call(
          body.deductions,
          'totalDeductionPaise'
        )
      ) {
        throw new ApiError(
          400,
          'PROTECTED_PAYSLIP_TOTAL',
          'deductions.totalDeductionPaise is calculated by the backend.'
        );
      }

      // attendanceSummary is derived from real Attendance / Leave / Holiday
      // records; any client-supplied value is accepted but ignored.
      const attendanceSummary =
        await buildPayslipAttendanceSnapshot(
          {
            organisationId:
              request.auth.organisationId,
            cafeId: payrollRun.cafeId,
            userId: employeeUserId,
            periodKey: payrollRun.periodKey,
          }
        );

      const earnings =
        parseIntegerSection({
          value: body.earnings,
          allowedFields:
            EARNING_FIELDS,
          sectionName: 'earnings',
        });

      const deductions =
        parseIntegerSection({
          value: body.deductions,
          allowedFields:
            DEDUCTION_FIELDS,
          sectionName: 'deductions',
        });

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

      const netPayPaise =
        grossPayPaise -
        totalDeductionPaise;

      const jobTitle =
        normalizeOptionalText({
          value: body.jobTitle,
          maximumLength: 120,
          fieldName: 'jobTitle',
        });

      const notes =
        normalizeOptionalText({
          value: body.notes,
          maximumLength: 2000,
          fieldName: 'notes',
        });

      const periodPart =
        payrollRun.periodKey
          .replaceAll('-', '');

      const payslipId =
        await SequenceCounter.generateId({
          organisationId:
            request.auth.organisationId,
          sequenceKey:
            `PAYSLIP_${periodPart}`,
          prefix:
            `PS-${periodPart}`,
          minimumDigits: 4,
        });

      const payslip =
        await Payslip.create({
          payslipId,
          organisationId:
            request.auth.organisationId,
          payrollRunId,
          cafeId:
            payrollRun.cafeId,
          employeeUserId,
          employeeName:
            employee.name,
          jobTitle,
          periodKey:
            payrollRun.periodKey,
          periodStartDate:
            payrollRun.periodStartDate,
          periodEndDate:
            payrollRun.periodEndDate,
          attendanceSummary,
          earnings: {
            ...earnings,
            grossPayPaise,
          },
          deductions: {
            ...deductions,
            totalDeductionPaise,
          },
          netPayPaise,
          currency: 'INR',
          status: 'DRAFT',
          notes,
          timezone: 'Asia/Kolkata',
          createdBy:
            request.auth.userId,
          updatedBy:
            request.auth.userId,
        });

      const payrollRunAfterCreate =
        await PayrollRun.findOne({
          organisationId:
            request.auth.organisationId,
          payrollRunId,
          cafeId:
            payrollRun.cafeId,
        });

      if (
        payrollRunAfterCreate &&
        payrollRunAfterCreate.status ===
          'VOIDED'
      ) {
        const racedVoidResult =
          await Payslip.updateOne(
            {
              organisationId:
                request.auth.organisationId,
              payrollRunId,
              payslipId,
              cafeId:
                payrollRun.cafeId,
              status: {
                $ne: 'VOIDED',
              },
            },
            {
              $set: {
                status: 'VOIDED',
                voidedAt:
                  payrollRunAfterCreate.voidedAt,
                voidedBy:
                  payrollRunAfterCreate.voidedBy,
                voidReason:
                  payrollRunAfterCreate.voidReason,
                updatedBy:
                  request.auth.userId,
              },
            }
          );

        if (
          !racedVoidResult ||
          !Number.isSafeInteger(
            racedVoidResult.matchedCount
          ) ||
          !Number.isSafeInteger(
            racedVoidResult.modifiedCount
          ) ||
          racedVoidResult.matchedCount < 0 ||
          racedVoidResult.modifiedCount < 0 ||
          racedVoidResult.modifiedCount >
            racedVoidResult.matchedCount ||
          racedVoidResult.matchedCount > 1
        ) {
          throw new ApiError(
            409,
            'PAYSLIP_VOID_RACE_CONFLICT',
            'The concurrently voided payslip could not be verified.'
          );
        }

        const finalPayslip =
          await Payslip.findOne({
            organisationId:
              request.auth.organisationId,
            payrollRunId,
            payslipId,
            cafeId:
              payrollRun.cafeId,
          });

        if (
          !finalPayslip ||
          finalPayslip.status !== 'VOIDED' ||
          !finalPayslip.voidedAt ||
          finalPayslip.voidedBy !==
            payrollRunAfterCreate.voidedBy ||
          finalPayslip.voidReason !==
            payrollRunAfterCreate.voidReason ||
          new Date(
            finalPayslip.voidedAt
          ).getTime() !==
            new Date(
              payrollRunAfterCreate.voidedAt
            ).getTime()
        ) {
          throw new ApiError(
            409,
            'PAYSLIP_VOID_RACE_CONFLICT',
            'The concurrently voided payslip failed authoritative verification.'
          );
        }

        await recordRequestAudit({
          request,
          module: 'PAYROLL',
          action:
            'VOID_RACED_PAYSLIP_CREATION',
          entityType: 'PAYSLIP',
          entityId: payslipId,
          cafeId:
            payrollRun.cafeId,
          before: {
            status: 'DRAFT',
          },
          after: {
            status: 'VOIDED',
            voidedAt:
              finalPayslip.voidedAt,
            voidedBy:
              finalPayslip.voidedBy,
            voidReason:
              finalPayslip.voidReason,
          },
          reason:
            payrollRunAfterCreate.voidReason,
          riskClassification: 'HIGH',
          metadata: {
            payrollRunStatus: 'VOIDED',
            concurrentLifecycleRace: true,
            newlyVoided:
              racedVoidResult.modifiedCount === 1,
          },
        });

        throw new ApiError(
          409,
          'PAYROLL_RUN_NOT_EDITABLE',
          'The payroll run was voided while the payslip was being created. The payslip was securely voided.'
        );
      }

      if (
        !payrollRunAfterCreate ||
        payrollRunAfterCreate.status !==
          'DRAFT'
      ) {
        const racedStatus =
          payrollRunAfterCreate
            ? payrollRunAfterCreate.status
            : 'MISSING';

        const rollbackResult =
          await Payslip.deleteOne({
            organisationId:
              request.auth.organisationId,
            payrollRunId,
            payslipId,
            cafeId:
              payrollRun.cafeId,
            status: 'DRAFT',
            createdBy:
              request.auth.userId,
          });

        if (
          !rollbackResult ||
          !Number.isSafeInteger(
            rollbackResult.deletedCount
          ) ||
          rollbackResult.deletedCount < 0 ||
          rollbackResult.deletedCount > 1
        ) {
          throw new ApiError(
            409,
            'PAYSLIP_CREATION_ROLLBACK_CONFLICT',
            'The raced payslip rollback produced invalid results.'
          );
        }

        const remainingPayslip =
          await Payslip.findOne({
            organisationId:
              request.auth.organisationId,
            payrollRunId,
            payslipId,
            cafeId:
              payrollRun.cafeId,
          });

        if (remainingPayslip) {
          throw new ApiError(
            409,
            'PAYSLIP_CREATION_ROLLBACK_CONFLICT',
            'The raced payslip remained after authoritative rollback verification.'
          );
        }

        await recordRequestAudit({
          request,
          module: 'PAYROLL',
          action:
            'ROLLBACK_RACED_PAYSLIP_CREATION',
          entityType: 'PAYSLIP',
          entityId: payslipId,
          cafeId:
            payrollRun.cafeId,
          before: {
            status: 'DRAFT',
          },
          after: {
            deleted: true,
          },
          reason:
            'Payroll run left DRAFT status during payslip creation.',
          riskClassification: 'HIGH',
          metadata: {
            payrollRunStatus:
              racedStatus,
            concurrentLifecycleRace: true,
            rollbackDeleted:
              rollbackResult.deletedCount === 1,
          },
        });

        throw new ApiError(
          409,
          'PAYROLL_RUN_NOT_EDITABLE',
          'The payroll run changed while the payslip was being created. The draft payslip was rolled back.'
        );
      }

      await recordRequestAudit({
        request,
        module: 'PAYROLL',
        action: 'CREATE_PAYSLIP',
        entityType: 'PAYSLIP',
        entityId: payslipId,
        cafeId:
          payrollRun.cafeId,
        after: {
          payslipId,
          payrollRunId,
          employeeUserId,
          cafeId:
            payrollRun.cafeId,
          periodKey:
            payrollRun.periodKey,
          status: 'DRAFT',
          grossPayPaise,
          totalDeductionPaise,
          netPayPaise,
        },
        riskClassification: 'HIGH',
        metadata: {
          employeeRole:
            employee.role,
        },
      });

      return response.status(201).json({
        success: true,
        message:
          'Draft payslip created successfully.',
        data: {
          payslip,
        },
        correlationId:
          request.correlationId || null,
      });
    }
  );

module.exports = {
  createPayrollRun,
  createPayrollRunPayslip,
};
