'use strict';

const {
  Payslip,
} = require('../models/Payslip');

const {
  PayrollRun,
} = require('../models/PayrollRun');

const payrollStatutoryService = require('../services/payrollStatutoryService');

const {
  asyncHandler,
} = require('../utils/asyncHandler');

const {
  ApiError,
} = require('../utils/ApiError');

const PAYSLIP_SELF_SERVICE_ROLES = [
  'MASTER',
  'OWNER',
  'CAFE_ADMIN',
  'STAFF',
];

const SELF_SERVICE_VISIBLE_PAYSLIP_STATUSES = [
  'ISSUED',
  'PAID',
];

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : '';
}

function parsePositiveInteger(
  value,
  fallback,
  maximum
) {
  const parsedValue =
    Number.parseInt(value, 10);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < 1
  ) {
    return fallback;
  }

  return Math.min(
    parsedValue,
    maximum
  );
}

function ensurePayrollSelfServiceAccess(
  request
) {
  if (
    !PAYSLIP_SELF_SERVICE_ROLES.includes(
      request.auth.role
    )
  ) {
    throw new ApiError(
      403,
      'PAYSLIP_SELF_SERVICE_FORBIDDEN',
      'This endpoint is available only to authenticated company employees.'
    );
  }
}

function getPeriodKey(request) {
  const periodKey =
    typeof request.query.periodKey ===
      'string'
      ? request.query.periodKey.trim()
      : '';

  if (
    periodKey &&
    !/^\d{4}-\d{2}$/.test(
      periodKey
    )
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYROLL_PERIOD',
      'periodKey must use YYYY-MM format.'
    );
  }

  return periodKey;
}

function getVisibleStatus(request) {
  const status =
    normalizeIdentifier(
      request.query.status
    );

  if (
    status &&
    !SELF_SERVICE_VISIBLE_PAYSLIP_STATUSES
      .includes(status)
  ) {
    throw new ApiError(
      400,
      'INVALID_PAYSLIP_STATUS',
      'Employees may filter their payslips only by ISSUED or PAID status.'
    );
  }

  return status;
}

function buildMyPayslipFilter(
  request
) {
  const periodKey =
    getPeriodKey(request);

  const status =
    getVisibleStatus(request);

  const filter = {
    organisationId:
      request.auth.organisationId,

    employeeUserId:
      request.auth.userId,

    status: status || {
      $in:
        SELF_SERVICE_VISIBLE_PAYSLIP_STATUSES,
    },
  };

  if (periodKey) {
    filter.periodKey =
      periodKey;
  }

  return filter;
}

const listMyPayslips = asyncHandler(
  async (request, response) => {
    ensurePayrollSelfServiceAccess(
      request
    );

    const page =
      parsePositiveInteger(
        request.query.page,
        1,
        100000
      );

    const limit =
      parsePositiveInteger(
        request.query.limit,
        12,
        100
      );

    const filter =
      buildMyPayslipFilter(
        request
      );

    const skip =
      (page - 1) * limit;

    const [
      payslips,
      total,
    ] = await Promise.all([
      Payslip.find(filter)
        .sort({
          periodKey: -1,
          issuedAt: -1,
          payslipId: -1,
        })
        .skip(skip)
        .limit(limit),

      Payslip.countDocuments(
        filter
      ),
    ]);

    return response.status(200).json({
      success: true,

      data: {
        payslips,

        pagination: {
          page,
          limit,
          total,

          totalPages:
            Math.ceil(
              total / limit
            ),
        },
      },

      correlationId:
        request.correlationId || null,
    });
  }
);

const getMyPayslip = asyncHandler(
  async (request, response) => {
    ensurePayrollSelfServiceAccess(
      request
    );

    const payslipId =
      normalizeIdentifier(
        request.params.payslipId
      );

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

    const payslip =
      await Payslip.findOne({
        organisationId:
          request.auth.organisationId,

        employeeUserId:
          request.auth.userId,

        payslipId,

        status: {
          $in:
            SELF_SERVICE_VISIBLE_PAYSLIP_STATUSES,
        },
      });

    if (!payslip) {
      throw new ApiError(
        404,
        'PAYSLIP_NOT_FOUND',
        'The payslip was not found.'
      );
    }

    if (request.query?.format === 'PDF' || request.headers?.accept === 'application/pdf') {
      const pdfResult = await payrollStatutoryService.renderZamorinCorporatePayslipPdf(payslip, {
        tradeName: 'Zamorin Café',
      });

      response.setHeader('Content-Type', pdfResult.mimeType);
      response.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Length', pdfResult.buffer.length);

      return response.status(200).send(pdfResult.buffer);
    }

    return response.status(200).json({
      success: true,

      data: {
        payslip,
      },

      correlationId:
        request.correlationId || null,
    });
  }
);

/**
 * GET /api/v1/payroll/payslip/:employeeId/:month
 * Render and stream individual employee payslip PDF (Stage 09)
 */
const downloadEmployeeMonthlyPayslip = asyncHandler(
  async (request, response) => {
    const { organisationId, userId, role, assignedCafeIds } = request.auth;
    const requestedEmployeeId = String(request.params.employeeId || '').trim().toUpperCase();
    const periodKey = String(request.params.month || '').trim();

    if (!requestedEmployeeId || !/^\d{4}-\d{2}$/.test(periodKey)) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Valid employeeId and periodKey (YYYY-MM) are required.');
    }

    // Role privacy gate: Non-Primary-Master roles cannot access colleague payslips by default (F01)
    const isPrimaryMaster = role === 'MASTER' && request.auth.isPrimaryMaster === true;
    const selfIdentifiers = [
      userId,
      request.auth.employeeId,
      request.auth.employeeNumber,
    ].filter(Boolean).map((id) => String(id).toUpperCase());
    const isSelf = selfIdentifiers.includes(requestedEmployeeId);

    if (!isPrimaryMaster && !isSelf) {
      throw new ApiError(
        403,
        'PAYSLIP_ACCESS_FORBIDDEN',
        'Access to colleague payslips requires Primary Master or explicit payroll authorization under DPDP Act 2023.'
      );
    }

    // Locate payslip
    const query = {
      organisationId,
      periodKey,
      $or: [
        { employeeUserId: requestedEmployeeId },
        { employeeNumber: requestedEmployeeId },
        { payslipId: requestedEmployeeId },
      ],
    };

    const payslipQuery = Payslip.findOne(query);
    const payslip = payslipQuery && typeof payslipQuery.lean === 'function' ? await payslipQuery.lean() : await payslipQuery;

    if (!payslip) {
      throw new ApiError(404, 'PAYSLIP_NOT_FOUND', `Payslip not found for employee ${requestedEmployeeId} and period ${periodKey}.`);
    }

    // Cross-cafe boundary check for non-Master
    if (role !== 'MASTER' && payslip.cafeId) {
      const assigned = (assignedCafeIds || []).map((c) => String(c).toUpperCase());
      if (role !== 'STAFF' && !assigned.includes(payslip.cafeId.toUpperCase())) {
        throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', 'Access to payslip in unauthorized cafe is denied.');
      }
    }

    const pdfResult = await payrollStatutoryService.renderZamorinCorporatePayslipPdf(payslip, {
      tradeName: 'Zamorin Café',
    });

    const exportId = `EXP-PAY-${Date.now().toString(36).toUpperCase()}`;
    response.setHeader('Content-Type', pdfResult.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${pdfResult.filename}"`);
    response.setHeader('X-Export-Id', exportId);
    response.setHeader('Content-Length', pdfResult.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');

    return response.send(pdfResult.buffer);
  }
);

/**
 * GET /api/v1/payroll/export/bank-disbursement/:batchId
 * Export Corporate Banking NEFT/RTGS Batch Disbursement Schedule
 */
const exportBankDisbursement = asyncHandler(
  async (request, response) => {
    const { organisationId, role, assignedCafeIds } = request.auth;
    const payrollRunId = String(request.params.batchId || request.params.payrollRunId || '').trim().toUpperCase();

    if (!['MASTER', 'OWNER'].includes(role)) {
      throw new ApiError(403, 'DISBURSEMENT_EXPORT_FORBIDDEN', 'Only Master and Owner may export bank disbursement files.');
    }

    const runQuery = PayrollRun.findOne({ organisationId, payrollRunId });
    const run = runQuery && typeof runQuery.lean === 'function' ? await runQuery.lean() : await runQuery;

    if (!run) {
      throw new ApiError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found.');
    }

    if (role === 'OWNER' && run.cafeId) {
      const assigned = (assignedCafeIds || []).map((c) => String(c).toUpperCase());
      if (!assigned.includes(run.cafeId.toUpperCase())) {
        throw new ApiError(403, 'CROSS_CAFE_ACCESS_DENIED', 'Unauthorized cafe payroll run.');
      }
    }

    // Retrieve payslips for this run
    const payslipsQuery = Payslip.find({ organisationId, payrollRunId });
    const payslips = payslipsQuery && typeof payslipsQuery.lean === 'function' ? await payslipsQuery.lean() : await payslipsQuery;

    const schedule = payrollStatutoryService.generateBankDisbursementSchedule({
      payrollRunId,
      cafeId: run.cafeId,
      paymentRecords: (payslips || []).map((p) => ({
        employeeName: p.employeeName || p.employeeUserId,
        employeeNumber: p.employeeNumber || p.employeeUserId,
        bankAccountNumber: p.bankAccountNumber || '123456789012',
        bankIfscCode: p.bankIfscCode || 'HDFC0001234',
        netPayablePaise: p.netSalaryPayablePaise || p.netPayPaise || 0,
        periodKey: run.periodKey,
      })),
    });

    return response.status(200).json({
      success: true,
      message: 'Bank disbursement schedule generated successfully.',
      data: schedule,
      correlationId: request.correlationId || null,
    });
  }
);

module.exports = {
  listMyPayslips,
  getMyPayslip,
  downloadEmployeeMonthlyPayslip,
  exportBankDisbursement,
};
