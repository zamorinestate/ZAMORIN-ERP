'use strict';

const {
  PayrollRun,
} = require('../models/PayrollRun');

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
      'Owner persona is read-only governance and cannot approve or submit payroll runs.'
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

function rejectRequestBody(
  body,
  code,
  message
) {
  if (
    body === undefined ||
    body === null
  ) {
    return;
  }

  if (
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.keys(body).length === 0
  ) {
    return;
  }

  throw new ApiError(
    400,
    code,
    message
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
      'PAYROLL_RUN_TOTALS_INVALID',
      `${fieldName} must be a safe non-negative integer.`
    );
  }

  return value;
}

function verifyCalculatedPayrollRun(
  payrollRun
) {
  const employeeCount =
    readSafeNonNegativeInteger(
      payrollRun.employeeCount,
      'employeeCount'
    );

  const totalGrossPaise =
    readSafeNonNegativeInteger(
      payrollRun.totalGrossPaise,
      'totalGrossPaise'
    );

  const totalDeductionPaise =
    readSafeNonNegativeInteger(
      payrollRun.totalDeductionPaise,
      'totalDeductionPaise'
    );

  const totalNetPayPaise =
    readSafeNonNegativeInteger(
      payrollRun.totalNetPayPaise,
      'totalNetPayPaise'
    );

  if (employeeCount < 1) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_EMPTY',
      'A calculated payroll run must contain at least one employee.'
    );
  }

  if (
    totalDeductionPaise >
    totalGrossPaise
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_TOTALS_INVALID',
      'Payroll deductions cannot exceed gross pay.'
    );
  }

  if (
    totalNetPayPaise !==
    totalGrossPaise -
      totalDeductionPaise
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_TOTALS_INVALID',
      'Payroll net pay must equal gross pay minus deductions.'
    );
  }

  if (
    !payrollRun.calculatedAt ||
    !payrollRun.calculatedBy
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_CALCULATION_METADATA_MISSING',
      'Calculated payroll requires a backend timestamp and actor.'
    );
  }

  return {
    employeeCount,
    totalGrossPaise,
    totalDeductionPaise,
    totalNetPayPaise,
  };
}

async function findManagedPayrollRun(
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

  return payrollRun;
}

const submitPayrollRun = asyncHandler(
  async (request, response) => {
    requirePayrollManagementAccess(
      request
    );

    rejectRequestBody(
      request.body,
      'PROTECTED_PAYROLL_SUBMISSION_FIELD',
      'Payroll submission lifecycle fields are controlled by the backend.'
    );

    const payrollRunId =
      normalizePayrollRunId(
        request.params.payrollRunId
      );

    const payrollRun =
      await findManagedPayrollRun(
        request,
        payrollRunId
      );

    if (
      payrollRun.status !==
      'CALCULATED'
    ) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_NOT_SUBMITTABLE',
        'Only a CALCULATED payroll run may be submitted.'
      );
    }

    const totals =
      verifyCalculatedPayrollRun(
        payrollRun
      );

    const before = {
      status: payrollRun.status,
      submittedAt:
        payrollRun.submittedAt || null,
      submittedBy:
        payrollRun.submittedBy || null,
    };

    const submittedAt =
      new Date();

    payrollRun.status = 'SUBMITTED';
    payrollRun.submittedAt =
      submittedAt;
    payrollRun.submittedBy =
      request.auth.userId;
    payrollRun.updatedBy =
      request.auth.userId;

    await payrollRun.save();

    await recordRequestAudit({
      request,
      module: 'PAYROLL',
      action: 'SUBMIT_PAYROLL_RUN',
      entityType: 'PAYROLL_RUN',
      entityId: payrollRunId,
      cafeId: payrollRun.cafeId,
      before,
      after: {
        status: payrollRun.status,
        submittedAt,
        submittedBy:
          request.auth.userId,
        ...totals,
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
        'Payroll run submitted successfully.',
      data: {
        payrollRun,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

const approvePayrollRun = asyncHandler(
  async (request, response) => {
    requirePayrollManagementAccess(
      request
    );

    rejectRequestBody(
      request.body,
      'PROTECTED_PAYROLL_APPROVAL_FIELD',
      'Payroll approval lifecycle fields are controlled by the backend.'
    );

    const payrollRunId =
      normalizePayrollRunId(
        request.params.payrollRunId
      );

    const payrollRun =
      await findManagedPayrollRun(
        request,
        payrollRunId
      );

    if (
      payrollRun.status !==
      'SUBMITTED'
    ) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_NOT_APPROVABLE',
        'Only a SUBMITTED payroll run may be approved.'
      );
    }

    if (
      !payrollRun.submittedAt ||
      !payrollRun.submittedBy
    ) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_SUBMISSION_METADATA_MISSING',
        'Submitted payroll requires a backend timestamp and actor.'
      );
    }

    const totals =
      verifyCalculatedPayrollRun(
        payrollRun
      );

    const before = {
      status: payrollRun.status,
      approvedAt:
        payrollRun.approvedAt || null,
      approvedBy:
        payrollRun.approvedBy || null,
    };

    const approvedAt =
      new Date();

    payrollRun.status = 'APPROVED';
    payrollRun.approvedAt =
      approvedAt;
    payrollRun.approvedBy =
      request.auth.userId;
    payrollRun.updatedBy =
      request.auth.userId;

    await payrollRun.save();

    await recordRequestAudit({
      request,
      module: 'PAYROLL',
      action: 'APPROVE_PAYROLL_RUN',
      entityType: 'PAYROLL_RUN',
      entityId: payrollRunId,
      cafeId: payrollRun.cafeId,
      before,
      after: {
        status: payrollRun.status,
        approvedAt,
        approvedBy:
          request.auth.userId,
        submittedAt:
          payrollRun.submittedAt,
        submittedBy:
          payrollRun.submittedBy,
        ...totals,
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
        'Payroll run approved successfully.',
      data: {
        payrollRun,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

module.exports = {
  submitPayrollRun,
  approvePayrollRun,
};
