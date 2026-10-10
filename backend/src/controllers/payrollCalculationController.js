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
  if (request.auth.role === 'OWNER') {
    throw new ApiError(
      403,
      'PERMISSION_DENIED',
      'Owner persona is read-only governance and cannot calculate payroll runs.'
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

function rejectRequestBody(body) {
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0
  ) {
    return;
  }

  if (
    body === undefined ||
    body === null
  ) {
    return;
  }

  throw new ApiError(
    400,
    'PROTECTED_PAYROLL_CALCULATION_FIELD',
    'Payroll totals and calculation lifecycle fields are controlled by the backend.'
  );
}

function readSafeNonNegativeInteger(
  value,
  fieldName
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new ApiError(
      409,
      'PAYSLIP_TOTALS_INVALID',
      `${fieldName} must be a safe non-negative integer.`
    );
  }

  return value;
}

function addSafeInteger(
  currentTotal,
  value,
  fieldName
) {
  const nextTotal =
    currentTotal + value;

  if (!Number.isSafeInteger(nextTotal)) {
    throw new ApiError(
      409,
      'PAYROLL_TOTAL_TOO_LARGE',
      `${fieldName} exceeds the supported amount.`
    );
  }

  return nextTotal;
}

function calculatePayslipTotals(payslip) {
  let grossPayPaise = 0;

  for (const field of EARNING_FIELDS) {
    grossPayPaise =
      addSafeInteger(
        grossPayPaise,
        readSafeNonNegativeInteger(
          payslip.earnings?.[field],
          `earnings.${field}`
        ),
        'grossPayPaise'
      );
  }

  const storedGrossPayPaise =
    readSafeNonNegativeInteger(
      payslip.earnings
        ?.grossPayPaise,
      'earnings.grossPayPaise'
    );

  let totalDeductionPaise = 0;

  for (const field of DEDUCTION_FIELDS) {
    totalDeductionPaise =
      addSafeInteger(
        totalDeductionPaise,
        readSafeNonNegativeInteger(
          payslip.deductions?.[field],
          `deductions.${field}`
        ),
        'totalDeductionPaise'
      );
  }

  const storedTotalDeductionPaise =
    readSafeNonNegativeInteger(
      payslip.deductions
        ?.totalDeductionPaise,
      'deductions.totalDeductionPaise'
    );

  if (
    totalDeductionPaise >
    grossPayPaise
  ) {
    throw new ApiError(
      409,
      'PAYSLIP_TOTALS_INVALID',
      'Payslip deductions cannot exceed gross pay.'
    );
  }

  const netPayPaise =
    grossPayPaise -
    totalDeductionPaise;

  const storedNetPayPaise =
    readSafeNonNegativeInteger(
      payslip.netPayPaise,
      'netPayPaise'
    );

  if (
    storedGrossPayPaise !==
      grossPayPaise ||
    storedTotalDeductionPaise !==
      totalDeductionPaise ||
    storedNetPayPaise !==
      netPayPaise
  ) {
    throw new ApiError(
      409,
      'PAYSLIP_TOTALS_INVALID',
      'A draft payslip contains inconsistent backend totals.'
    );
  }

  return {
    grossPayPaise,
    totalDeductionPaise,
    netPayPaise,
  };
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
      'PAYROLL_RUN_NOT_CALCULABLE',
      'Only a DRAFT payroll run may be calculated.'
    );
  }

  return payrollRun;
}

const calculatePayrollRun = asyncHandler(
  async (request, response) => {
    requirePayrollManagementAccess(
      request
    );

    rejectRequestBody(
      request.body
    );

    const payrollRunId =
      normalizePayrollRunId(
        request.params.payrollRunId
      );

    const payrollRun =
      await findManagedDraftPayrollRun(
        request,
        payrollRunId
      );

    const payslips =
      await Payslip.find({
        organisationId:
          request.auth.organisationId,
        payrollRunId,
        cafeId: payrollRun.cafeId,
      });

    if (payslips.length === 0) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_EMPTY',
        'At least one draft payslip is required before payroll calculation.'
      );
    }

    const invalidStatusPayslip =
      payslips.find(
        (payslip) =>
          payslip.status !== 'DRAFT'
      );

    if (invalidStatusPayslip) {
      throw new ApiError(
        409,
        'PAYSLIP_STATUS_BLOCKS_CALCULATION',
        'Every payslip must remain in DRAFT status before payroll calculation.'
      );
    }

    let totalGrossPaise = 0;
    let totalDeductionPaise = 0;
    let totalNetPayPaise = 0;

    for (const payslip of payslips) {
      const totals =
        calculatePayslipTotals(
          payslip
        );

      totalGrossPaise =
        addSafeInteger(
          totalGrossPaise,
          totals.grossPayPaise,
          'totalGrossPaise'
        );

      totalDeductionPaise =
        addSafeInteger(
          totalDeductionPaise,
          totals.totalDeductionPaise,
          'totalDeductionPaise'
        );

      totalNetPayPaise =
        addSafeInteger(
          totalNetPayPaise,
          totals.netPayPaise,
          'totalNetPayPaise'
        );
    }

    if (
      totalNetPayPaise !==
      totalGrossPaise -
        totalDeductionPaise
    ) {
      throw new ApiError(
        409,
        'PAYROLL_TOTALS_INVALID',
        'Payroll net pay must equal gross pay minus deductions.'
      );
    }

    const before = {
      status: payrollRun.status,
      employeeCount:
        payrollRun.employeeCount,
      totalGrossPaise:
        payrollRun.totalGrossPaise,
      totalDeductionPaise:
        payrollRun.totalDeductionPaise,
      totalNetPayPaise:
        payrollRun.totalNetPayPaise,
    };

    const calculatedAt =
      new Date();

    payrollRun.employeeCount =
      payslips.length;
    payrollRun.totalGrossPaise =
      totalGrossPaise;
    payrollRun.totalDeductionPaise =
      totalDeductionPaise;
    payrollRun.totalNetPayPaise =
      totalNetPayPaise;
    payrollRun.status = 'CALCULATED';
    payrollRun.calculatedAt =
      calculatedAt;
    payrollRun.calculatedBy =
      request.auth.userId;
    payrollRun.updatedBy =
      request.auth.userId;

    await payrollRun.save();

    await recordRequestAudit({
      request,
      module: 'PAYROLL',
      action: 'CALCULATE_PAYROLL_RUN',
      entityType: 'PAYROLL_RUN',
      entityId: payrollRunId,
      cafeId: payrollRun.cafeId,
      before,
      after: {
        status: payrollRun.status,
        employeeCount:
          payrollRun.employeeCount,
        totalGrossPaise,
        totalDeductionPaise,
        totalNetPayPaise,
        calculatedAt,
        calculatedBy:
          request.auth.userId,
      },
      riskClassification: 'HIGH',
      metadata: {
        periodKey:
          payrollRun.periodKey,
      },
    });

    return response.status(200).json({
      success: true,
      message:
        'Payroll run calculated successfully.',
      data: {
        payrollRun,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

module.exports = {
  calculatePayrollRun,
};
