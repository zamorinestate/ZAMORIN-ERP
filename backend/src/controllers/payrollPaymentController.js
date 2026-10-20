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
  if (
    !request?.auth ||
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

/**
 * Returns the caller-supplied paymentReference (normalized), or null when the
 * caller omitted it. A null result means the backend synthesizes one — the
 * self-service "Record Pay" action sends an empty body.
 */
function validatePaymentRequestBody(body) {
  if (body === undefined || body === null) {
    return null;
  }

  if (
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYMENT_REFERENCE',
      'A valid payment reference is required in the request body.'
    );
  }

  const keys = Object.keys(body);

  const forbiddenKeys = keys.filter(
    (key) => key !== 'paymentReference'
  );

  if (forbiddenKeys.length > 0) {
    throw new ApiError(
      400,
      'PROTECTED_PAYROLL_PAYMENT_FIELD',
      'Payroll payment lifecycle fields are controlled by the backend.'
    );
  }

  if (
    !('paymentReference' in body) ||
    body.paymentReference === undefined ||
    body.paymentReference === null ||
    body.paymentReference === ''
  ) {
    return null;
  }

  const { paymentReference } = body;

  if (
    typeof paymentReference !== 'string' ||
    paymentReference.trim().length === 0 ||
    paymentReference.trim().length > 200
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYMENT_REFERENCE',
      'paymentReference must be a non-empty string of 200 characters or less.'
    );
  }

  return paymentReference.trim().toUpperCase();
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
      'A payslip contains inconsistent backend totals.'
    );
  }

  return {
    grossPayPaise,
    totalDeductionPaise,
    netPayPaise,
  };
}

function verifyPayablePayrollRun(
  payrollRun,
  normalizedPaymentReference
) {
  if (
    !['APPROVED', 'PAID'].includes(
      payrollRun.status
    )
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_NOT_PAYABLE',
      'Only APPROVED or PAID payroll runs may be processed for payment.'
    );
  }

  if (
    !payrollRun.calculatedAt ||
    !payrollRun.calculatedBy ||
    !payrollRun.submittedAt ||
    !payrollRun.submittedBy ||
    !payrollRun.approvedAt ||
    !payrollRun.approvedBy
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_APPROVAL_METADATA_MISSING',
      'Approved payroll requires complete calculation, submission, and approval metadata.'
    );
  }

  if (payrollRun.status === 'PAID') {
    if (
      !payrollRun.paidAt ||
      !payrollRun.paidBy ||
      !payrollRun.paymentReference
    ) {
      throw new ApiError(
        409,
        'PAYROLL_PAYMENT_METADATA_MISSING',
        'Paid payroll run is missing backend payment metadata.'
      );
    }

    if (
      payrollRun.paymentReference !==
      normalizedPaymentReference
    ) {
      throw new ApiError(
        409,
        'PAYROLL_PAYMENT_REFERENCE_CONFLICT',
        'Payment reference conflicts with the existing paid payroll run.'
      );
    }
  }

  const employeeCount =
    readSafeNonNegativeInteger(
      payrollRun.employeeCount,
      'employeeCount'
    );

  if (employeeCount < 1) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_EMPTY',
      'A payable payroll run must contain at least one employee.'
    );
  }

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

  if (
    totalDeductionPaise >
      totalGrossPaise ||
    totalNetPayPaise !==
      totalGrossPaise -
        totalDeductionPaise
  ) {
    throw new ApiError(
      409,
      'PAYROLL_RUN_TOTALS_INVALID',
      'Payable payroll contains inconsistent backend totals.'
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

function categorizeAndValidatePayslips(
  payslips,
  normalizedPaymentReference
) {
  const issuedPayslips = [];
  const existingPaidPayslips = [];

  for (const payslip of payslips) {
    if (payslip.status === 'ISSUED') {
      if (
        !payslip.issuedAt ||
        !payslip.issuedBy
      ) {
        throw new ApiError(
          409,
          'PAYSLIP_ISSUANCE_METADATA_MISSING',
          'Issued payslip is missing required issuance metadata.'
        );
      }
      issuedPayslips.push(payslip);
    } else if (payslip.status === 'PAID') {
      if (
        !payslip.issuedAt ||
        !payslip.issuedBy
      ) {
        throw new ApiError(
          409,
          'PAYSLIP_ISSUANCE_METADATA_MISSING',
          'Paid payslip is missing required issuance metadata.'
        );
      }

      if (
        !payslip.paidAt ||
        !payslip.paidBy ||
        !payslip.paymentReference
      ) {
        throw new ApiError(
          409,
          'PAYSLIP_PAYMENT_METADATA_MISSING',
          'Paid payslip is missing required payment metadata.'
        );
      }

      if (
        payslip.paymentReference !==
        normalizedPaymentReference
      ) {
        throw new ApiError(
          409,
          'PAYROLL_PAYMENT_REFERENCE_CONFLICT',
          'Payment reference conflicts with an existing paid payslip.'
        );
      }

      existingPaidPayslips.push(payslip);
    } else {
      throw new ApiError(
        409,
        'PAYSLIP_STATUS_BLOCKS_PAYMENT',
        `Payslip status ${payslip.status} blocks payment.`
      );
    }
  }

  return {
    issuedPayslips,
    existingPaidPayslips,
  };
}

const payPayrollRun = asyncHandler(
  async (request, response) => {
    requirePayrollManagementAccess(
      request
    );

    const payrollRunId =
      normalizePayrollRunId(
        request.params.payrollRunId
      );

    const suppliedPaymentReference =
      validatePaymentRequestBody(
        request.body
      );

    const payrollRun =
      await findManagedPayrollRun(
        request,
        payrollRunId
      );

    // Callers may omit the reference entirely (the self-service "Record Pay"
    // action sends {}): reuse the run's own reference when re-recording a
    // payment, otherwise synthesize a traceable backend reference.
    const normalizedPaymentReference =
      suppliedPaymentReference ||
      (payrollRun.status === 'PAID' &&
      payrollRun.paymentReference
        ? payrollRun.paymentReference
        : `PAY-${payrollRunId}-${Date.now()
            .toString(36)
            .toUpperCase()}`);

    const runTotals =
      verifyPayablePayrollRun(
        payrollRun,
        normalizedPaymentReference
      );

    const payslipFilter = {
      organisationId:
        request.auth.organisationId,
      payrollRunId,
      cafeId: payrollRun.cafeId,
    };

    const payslips =
      await Payslip.find(payslipFilter);

    if (payslips.length === 0) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_EMPTY',
        'At least one payslip is required before payment.'
      );
    }

    if (
      payslips.length !==
      runTotals.employeeCount
    ) {
      throw new ApiError(
        409,
        'PAYROLL_EMPLOYEE_COUNT_MISMATCH',
        'Payroll employee count does not match the payslip count.'
      );
    }

    const {
      issuedPayslips,
      existingPaidPayslips,
    } = categorizeAndValidatePayslips(
      payslips,
      normalizedPaymentReference
    );

    let totalGrossPaise = 0;
    let totalDeductionPaise = 0;
    let totalNetPayPaise = 0;

    for (const payslip of payslips) {
      const totals =
        calculatePayslipTotals(payslip);

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
      totalGrossPaise !==
        runTotals.totalGrossPaise ||
      totalDeductionPaise !==
        runTotals.totalDeductionPaise ||
      totalNetPayPaise !==
        runTotals.totalNetPayPaise
    ) {
      throw new ApiError(
        409,
        'PAYROLL_RUN_TOTALS_MISMATCH',
        'Approved payroll totals do not match its payslips.'
      );
    }

    let newlyPaidCount = 0;
    let actionPaidAt = null;
    let actionPaidBy = null;

    if (issuedPayslips.length > 0) {
      actionPaidAt = new Date();
      actionPaidBy = request.auth.userId;

      const payslipUpdateResult =
        await Payslip.updateMany(
          {
            ...payslipFilter,
            status: 'ISSUED',
          },
          {
            $set: {
              status: 'PAID',
              paidAt: actionPaidAt,
              paidBy: actionPaidBy,
              paymentReference:
                normalizedPaymentReference,
              updatedBy:
                request.auth.userId,
            },
          }
        );

      if (
        !Number.isSafeInteger(
          payslipUpdateResult?.matchedCount
        ) ||
        !Number.isSafeInteger(
          payslipUpdateResult?.modifiedCount
        ) ||
        payslipUpdateResult.matchedCount <
          0 ||
        payslipUpdateResult.modifiedCount <
          0 ||
        payslipUpdateResult.modifiedCount >
          payslipUpdateResult.matchedCount ||
        payslipUpdateResult.matchedCount >
          issuedPayslips.length
      ) {
        throw new ApiError(
          409,
          'PAYROLL_PAYMENT_CONFLICT',
          'Payslip bulk payment update produced invalid counts.'
        );
      }

      newlyPaidCount =
        payslipUpdateResult.modifiedCount;
    } else if (
      existingPaidPayslips.length > 0
    ) {
      actionPaidAt =
        existingPaidPayslips[0].paidAt;
      actionPaidBy =
        existingPaidPayslips[0].paidBy;
    }

    const finalPayslips =
      await Payslip.find(payslipFilter);

    if (
      finalPayslips.length !==
      runTotals.employeeCount
    ) {
      throw new ApiError(
        409,
        'PAYROLL_PAYMENT_CONFLICT',
        'Final payslip count does not match employee count.'
      );
    }

    const incompletePayslip =
      finalPayslips.find(
        (p) =>
          p.status !== 'PAID' ||
          !p.issuedAt ||
          !p.issuedBy ||
          !p.paidAt ||
          !p.paidBy ||
          !p.paymentReference ||
          p.paymentReference !==
            normalizedPaymentReference
      );

    if (incompletePayslip) {
      throw new ApiError(
        409,
        'PAYROLL_PAYMENT_CONFLICT',
        'Final payslip payment state is incomplete or invalid.'
      );
    }

    let finalRun = payrollRun;

    if (payrollRun.status === 'APPROVED') {
      const runFilter = {
        organisationId:
          request.auth.organisationId,
        payrollRunId,
        cafeId: payrollRun.cafeId,
        status: 'APPROVED',
      };

      if (request.auth.role === 'OWNER') {
        runFilter.cafeId = {
          $in:
            request.auth
              .assignedCafeIds || [],
        };
      }

      const runUpdateResult =
        await PayrollRun.updateOne(
          runFilter,
          {
            $set: {
              status: 'PAID',
              paidAt:
                actionPaidAt ||
                new Date(),
              paidBy:
                actionPaidBy ||
                request.auth.userId,
              paymentReference:
                normalizedPaymentReference,
              updatedBy:
                request.auth.userId,
            },
          }
        );

      if (
        !Number.isSafeInteger(
          runUpdateResult?.matchedCount
        ) ||
        !Number.isSafeInteger(
          runUpdateResult?.modifiedCount
        ) ||
        runUpdateResult.matchedCount < 0 ||
        runUpdateResult.matchedCount > 1 ||
        runUpdateResult.modifiedCount < 0 ||
        runUpdateResult.modifiedCount >
          runUpdateResult.matchedCount
      ) {
        throw new ApiError(
          409,
          'PAYROLL_PAYMENT_CONFLICT',
          'Payroll run payment update produced invalid counts.'
        );
      }

      finalRun =
        await findManagedPayrollRun(
          request,
          payrollRunId
        );
    }

    if (
      finalRun.status !== 'PAID' ||
      !finalRun.paidAt ||
      !finalRun.paidBy ||
      !finalRun.paymentReference ||
      finalRun.paymentReference !==
        normalizedPaymentReference
    ) {
      throw new ApiError(
        409,
        'PAYROLL_PAYMENT_CONFLICT',
        'Final payroll run payment state is incomplete or invalid.'
      );
    }

    await recordRequestAudit({
      request,
      module: 'PAYROLL',
      action: 'PAY_PAYROLL_RUN',
      entityType: 'PAYROLL_RUN',
      entityId: payrollRunId,
      cafeId: payrollRun.cafeId,
      before: {
        runStatus: payrollRun.status,
        totalPayslipCount:
          payslips.length,
        issuedPayslipCount:
          issuedPayslips.length,
        previouslyPaidPayslipCount:
          existingPaidPayslips.length,
        existingRunPaidAt:
          payrollRun.paidAt || null,
        existingRunPaidBy:
          payrollRun.paidBy || null,
        existingRunPaymentReference:
          payrollRun.paymentReference || null,
      },
      after: {
        runStatus: 'PAID',
        finalPaidPayslipCount:
          finalPayslips.length,
        newlyPaidPayslipCount:
          newlyPaidCount,
        paidAt: finalRun.paidAt,
        paidBy: finalRun.paidBy,
        paymentReference:
          normalizedPaymentReference,
      },
      riskClassification: 'HIGH',
      metadata: {
        periodKey: payrollRun.periodKey,
        employeeCount:
          payrollRun.employeeCount,
        totalGrossPaise:
          runTotals.totalGrossPaise,
        totalDeductionPaise:
          runTotals.totalDeductionPaise,
        totalNetPayPaise:
          runTotals.totalNetPayPaise,
        idempotentRetry:
          issuedPayslips.length === 0 &&
          payrollRun.status === 'PAID',
        recoveryCompletion:
          issuedPayslips.length > 0 &&
          existingPaidPayslips.length > 0,
      },
    });

    return response.status(200).json({
      success: true,
      message:
        'Payroll run paid successfully.',
      data: {
        payrollRunId,
        cafeId: payrollRun.cafeId,
        status: 'PAID',
        paidPayslipCount:
          finalPayslips.length,
        newlyPaidPayslipCount:
          newlyPaidCount,
        paidAt: finalRun.paidAt,
        paidBy: finalRun.paidBy,
        paymentReference:
          normalizedPaymentReference,
      },
      correlationId:
        request.correlationId || null,
    });
  }
);

module.exports = {
  payPayrollRun,
};
