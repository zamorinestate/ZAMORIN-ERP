'use strict';

const mongoose = require('mongoose');

const PAYSLIP_STATUSES = [
  'DRAFT',
  'ISSUED',
  'PAID',
  'VOIDED',
];

// Mirrors User.userId's pattern exactly: payroll must be able to pay every
// user id the User model can create (incl. VU-* vendors and EMP-ZC-* staff).
const EMPLOYEE_USER_ID_PATTERN =
  /^((MU|OW|AD|ST|VU)-\d{4,}|EMP-ZC-\d{4,})$/;

function createPaiseField() {
  return {
    type: Number,
    min: 0,
    default: 0,
    validate: {
      validator(value) {
        return Number.isSafeInteger(value);
      },
      message:
        'Money values must be safe non-negative integers in paise.',
    },
  };
}

function createDayField() {
  return {
    type: Number,
    min: 0,
    default: 0,
  };
}

const attendanceSummarySchema =
  new mongoose.Schema(
    {
      totalCalendarDays: {
        type: Number,
        min: 0,
        default: 0,
        validate: {
          validator(value) {
            return Number.isSafeInteger(
              value
            );
          },
          message:
            'Calendar days must be a safe non-negative integer.',
        },
      },

      presentDays:
        createDayField(),

      paidLeaveDays:
        createDayField(),

      unpaidLeaveDays:
        createDayField(),

      weeklyOffDays:
        createDayField(),

      holidayDays:
        createDayField(),

      payableDays:
        createDayField(),

      overtimeMinutes: {
        type: Number,
        min: 0,
        default: 0,
        validate: {
          validator(value) {
            return Number.isSafeInteger(
              value
            );
          },
          message:
            'Overtime minutes must be a safe non-negative integer.',
        },
      },
    },
    {
      _id: false,
    }
  );

const earningsSchema =
  new mongoose.Schema(
    {
      basicPayPaise:
        createPaiseField(),

      houseRentAllowancePaise:
        createPaiseField(),

      otherAllowancePaise:
        createPaiseField(),

      overtimePayPaise:
        createPaiseField(),

      incentivePaise:
        createPaiseField(),

      otherEarningPaise:
        createPaiseField(),

      grossPayPaise:
        createPaiseField(),
    },
    {
      _id: false,
    }
  );

const deductionsSchema =
  new mongoose.Schema(
    {
      providentFundPaise:
        createPaiseField(),

      employeeStateInsurancePaise:
        createPaiseField(),

      professionalTaxPaise:
        createPaiseField(),

      incomeTaxPaise:
        createPaiseField(),

      loanAdvanceDeductionPaise:
        createPaiseField(),

      unpaidLeaveDeductionPaise:
        createPaiseField(),

      otherDeductionPaise:
        createPaiseField(),

      totalDeductionPaise:
        createPaiseField(),
    },
    {
      _id: false,
    }
  );

const payslipSchema =
  new mongoose.Schema(
    {
      payslipId: {
        type: String,
        required: true,
        unique: true,
        immutable: true,
        trim: true,
        uppercase: true,
        match: /^PS-\d{6}-\d{4,}$/,
      },

      organisationId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
        index: true,
      },

      payrollRunId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
        index: true,
      },

      cafeId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
        index: true,
      },

      employeeUserId: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
        match: EMPLOYEE_USER_ID_PATTERN,
        index: true,
      },

      employeeName: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        maxlength: 120,
      },

      jobTitle: {
        type: String,
        immutable: true,
        trim: true,
        maxlength: 120,
        default: '',
      },

      periodKey: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        match: /^\d{4}-\d{2}$/,
        index: true,
      },

      periodStartDate: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
      },

      periodEndDate: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
      },

      attendanceSummary: {
        type: attendanceSummarySchema,
        default: () => ({}),
      },

      earnings: {
        type: earningsSchema,
        required: true,
        default: () => ({}),
      },

      deductions: {
        type: deductionsSchema,
        required: true,
        default: () => ({}),
      },

      netPayPaise:
        createPaiseField(),

      currency: {
        type: String,
        immutable: true,
        enum: ['INR'],
        default: 'INR',
      },

      status: {
        type: String,
        required: true,
        enum: PAYSLIP_STATUSES,
        default: 'DRAFT',
        index: true,
      },

      issuedAt: {
        type: Date,
        default: null,
      },

      issuedBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      paidAt: {
        type: Date,
        default: null,
      },

      paidBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      paymentReference: {
        type: String,
        trim: true,
        uppercase: true,
        maxlength: 200,
        default: '',
      },

      voidedAt: {
        type: Date,
        default: null,
      },

      voidedBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },

      voidReason: {
        type: String,
        trim: true,
        maxlength: 2000,
        default: '',
      },

      notes: {
        type: String,
        trim: true,
        maxlength: 2000,
        default: '',
      },

      timezone: {
        type: String,
        immutable: true,
        default: 'Asia/Kolkata',
      },

      createdBy: {
        type: String,
        required: true,
        immutable: true,
        trim: true,
        uppercase: true,
      },

      updatedBy: {
        type: String,
        trim: true,
        uppercase: true,
        default: null,
      },
    },
    {
      timestamps: true,
      optimisticConcurrency: true,
      versionKey: 'version',
      collection: 'payslips',
    }
  );

payslipSchema.index(
  {
    organisationId: 1,
    payrollRunId: 1,
    employeeUserId: 1,
  },
  {
    unique: true,
    name:
      'payslip_payroll_run_employee_unique',
  }
);

payslipSchema.index(
  {
    organisationId: 1,
    employeeUserId: 1,
    periodKey: -1,
    status: 1,
  },
  {
    name:
      'payslip_employee_period_status',
  }
);

payslipSchema.pre(
  'validate',
  function validatePayslip() {
    const identifierFields = [
      'payslipId',
      'organisationId',
      'payrollRunId',
      'cafeId',
      'employeeUserId',
      'issuedBy',
      'paidBy',
      'voidedBy',
      'paymentReference',
      'createdBy',
      'updatedBy',
    ];

    for (const field of identifierFields) {
      if (
        typeof this[field] === 'string' &&
        this[field]
      ) {
        this[field] =
          this[field]
            .trim()
            .toUpperCase();
      }
    }

    if (
      this.periodStartDate &&
      this.periodEndDate &&
      this.periodStartDate >
        this.periodEndDate
    ) {
      this.invalidate(
        'periodEndDate',
        'Payslip period end date must not be before its start date.'
      );
    }

    if (
      this.periodKey &&
      this.periodStartDate &&
      !this.periodStartDate.startsWith(
        this.periodKey
      )
    ) {
      this.invalidate(
        'periodStartDate',
        'Payslip period start date must match the period key.'
      );
    }

    if (
      this.periodKey &&
      this.periodEndDate &&
      !this.periodEndDate.startsWith(
        this.periodKey
      )
    ) {
      this.invalidate(
        'periodEndDate',
        'Payslip period end date must match the period key.'
      );
    }

    const earnings =
      this.earnings || {};

    const expectedGrossPayPaise =
      Number(
        earnings.basicPayPaise || 0
      ) +
      Number(
        earnings
          .houseRentAllowancePaise ||
          0
      ) +
      Number(
        earnings.otherAllowancePaise ||
          0
      ) +
      Number(
        earnings.overtimePayPaise || 0
      ) +
      Number(
        earnings.incentivePaise || 0
      ) +
      Number(
        earnings.otherEarningPaise || 0
      );

    if (
      earnings.grossPayPaise !==
      expectedGrossPayPaise
    ) {
      this.invalidate(
        'earnings.grossPayPaise',
        'Gross pay must equal the sum of all earnings.'
      );
    }

    const deductions =
      this.deductions || {};

    const expectedDeductionPaise =
      Number(
        deductions
          .providentFundPaise || 0
      ) +
      Number(
        deductions
          .employeeStateInsurancePaise ||
          0
      ) +
      Number(
        deductions
          .professionalTaxPaise || 0
      ) +
      Number(
        deductions.incomeTaxPaise || 0
      ) +
      Number(
        deductions
          .loanAdvanceDeductionPaise ||
          0
      ) +
      Number(
        deductions
          .unpaidLeaveDeductionPaise ||
          0
      ) +
      Number(
        deductions
          .otherDeductionPaise || 0
      );

    if (
      deductions.totalDeductionPaise !==
      expectedDeductionPaise
    ) {
      this.invalidate(
        'deductions.totalDeductionPaise',
        'Total deductions must equal the sum of all deductions.'
      );
    }

    if (
      deductions.totalDeductionPaise >
      earnings.grossPayPaise
    ) {
      this.invalidate(
        'deductions.totalDeductionPaise',
        'Payslip deductions cannot exceed gross pay.'
      );
    }

    const expectedNetPayPaise =
      earnings.grossPayPaise -
      deductions.totalDeductionPaise;

    if (
      this.netPayPaise !==
      expectedNetPayPaise
    ) {
      this.invalidate(
        'netPayPaise',
        'Net pay must equal gross pay minus total deductions.'
      );
    }

    if (
      ['ISSUED', 'PAID'].includes(
        this.status
      ) &&
      (
        !this.issuedAt ||
        !this.issuedBy
      )
    ) {
      this.invalidate(
        'issuedAt',
        'Issued payslips require a backend timestamp and actor.'
      );
    }

    if (
      this.status === 'PAID' &&
      (
        !this.paidAt ||
        !this.paidBy
      )
    ) {
      this.invalidate(
        'paidAt',
        'Paid payslips require a backend timestamp and actor.'
      );
    }

    if (
      this.status === 'VOIDED' &&
      (
        !this.voidedAt ||
        !this.voidedBy ||
        !this.voidReason
      )
    ) {
      this.invalidate(
        'voidReason',
        'Voided payslips require a backend timestamp, actor and reason.'
      );
    }
  }
);

payslipSchema.methods.isLocked =
  function isLocked() {
    return [
      'ISSUED',
      'PAID',
      'VOIDED',
    ].includes(this.status);
  };

const Payslip =
  mongoose.models.Payslip ||
  mongoose.model(
    'Payslip',
    payslipSchema
  );

module.exports = {
  Payslip,
  PAYSLIP_STATUSES,
  EMPLOYEE_USER_ID_PATTERN,
};
