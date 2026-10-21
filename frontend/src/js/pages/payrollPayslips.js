// PAGE HELPER: Payroll-run Payslip management for authenticated MASTER and OWNER users.
import {
  ApiClientError,
  apiGet,
  apiPatch,
  apiPost,
} from "../apiClient.js";

import {
  emptyState,
  showToast,
  skeleton,
} from "../components.js";

let payslipRequest = null;
let payslipMutationInProgress = false;

const ATTENDANCE_FIELDS = [
  ["totalCalendarDays", "Calendar days"],
  ["presentDays", "Present days"],
  ["paidLeaveDays", "Paid leave days"],
  ["unpaidLeaveDays", "Unpaid leave days"],
  ["weeklyOffDays", "Weekly off days"],
  ["holidayDays", "Holiday days"],
  ["payableDays", "Payable days"],
  ["overtimeMinutes", "Overtime minutes"],
];

const EARNING_FIELDS = [
  ["basicPayPaise", "Basic pay"],
  ["houseRentAllowancePaise", "House rent allowance"],
  ["otherAllowancePaise", "Other allowance"],
  ["overtimePayPaise", "Overtime pay"],
  ["incentivePaise", "Incentive"],
  ["otherEarningPaise", "Other earning"],
];

const DEDUCTION_FIELDS = [
  ["providentFundPaise", "Provident fund"],
  ["employeeStateInsurancePaise", "Employee state insurance"],
  ["professionalTaxPaise", "Professional tax"],
  ["incomeTaxPaise", "Income tax"],
  ["loanAdvanceDeductionPaise", "Loan or advance deduction"],
  ["unpaidLeaveDeductionPaise", "Unpaid leave deduction"],
  ["otherDeductionPaise", "Other deduction"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  const paise =
    Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}

function apiErrorMessage(error) {
  return error instanceof ApiClientError
    ? error.message
    : "The payslip request could not be completed.";
}

function renderPayslipLoading() {
  return `
    <div class="flex-col gap-md" aria-live="polite">
      ${skeleton("72px")}
      ${skeleton("72px")}
      ${skeleton("72px")}
    </div>
  `;
}

function statusPill(status) {
  return `
    <span class="pill pill-dark">
      ${escapeHtml(status || "UNKNOWN")}
    </span>
  `;
}

function employeeOptions(users, selectedUserId = "") {
  return `
    <option value="">Select employee</option>
    ${users
      .map(
        (user) => `
          <option
            value="${escapeHtml(user.userId)}"
            ${user.userId === selectedUserId ? "selected" : ""}
          >
            ${escapeHtml(user.name || user.userId)}
            · ${escapeHtml(user.userId)}
            · ${escapeHtml(user.role)}
          </option>
        `
      )
      .join("")}
  `;
}

// Attendance is derived server-side from real Attendance / LeaveRequest /
// HolidayCalendar records (create AND every draft patch overwrite whatever the
// client sends), so it renders as read-only display and is never submitted.
function derivedIntegerDisplay(fields, values = {}) {
  return fields
    .map(
      ([name, label]) => `
        <label style="min-width:180px; flex:1;">
          <span
            style="color:var(--muted);"
            style="display:block; font-size:11px; margin-bottom:6px;"
          >
            ${escapeHtml(label)}
          </span>
          <input
            class="glass-input"
            type="number"
            min="0"
            step="1"
            data-derived-attendance="${escapeHtml(name)}"
            aria-readonly="true"
            readonly
            tabindex="-1"
            value="${escapeHtml(values?.[name] ?? 0)}"
            style="width:100%;"
          />
        </label>
      `
    )
    .join("");
}

function moneyInputs(fields, section, values = {}) {
  return fields
    .map(
      ([name, label]) => `
        <label style="min-width:180px; flex:1;">
          <span
            style="color:var(--muted);"
            style="display:block; font-size:11px; margin-bottom:6px;"
          >
            ${escapeHtml(label)} (₹)
          </span>
          <input
            class="glass-input"
            type="number"
            min="0"
            step="0.01"
            name="${escapeHtml(section)}.${escapeHtml(name)}"
            value="${escapeHtml(
              ((values?.[name] || 0) / 100).toFixed(2)
            )}"
            required
            style="width:100%;"
          />
        </label>
      `
    )
    .join("");
}

function renderPayslipRows(payslips) {
  if (payslips.length === 0) {
    return emptyState({
      title: "No payslips added",
      body: "Add employees and salary details before calculating this payroll run.",
    });
  }

  return `
    <div style="overflow:auto;">
      <table class="glass-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Status</th>
            <th>Gross</th>
            <th>Deductions</th>
            <th>Net pay</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${payslips
            .map(
              (payslip) => `
                <tr>
                  <td>
                    <div style="font-weight:700;">
                      ${escapeHtml(payslip.employeeName)}
                    </div>
                    <div style="color:var(--muted);" style="font-size:11px;">
                      ${escapeHtml(payslip.employeeUserId)}
                      ${payslip.jobTitle
                        ? ` · ${escapeHtml(payslip.jobTitle)}`
                        : ""}
                    </div>
                  </td>
                  <td>${statusPill(payslip.status)}</td>
                  <td>
                    ${escapeHtml(
                      formatMoney(
                        payslip.earnings?.grossPayPaise
                      )
                    )}
                  </td>
                  <td>
                    ${escapeHtml(
                      formatMoney(
                        payslip.deductions
                          ?.totalDeductionPaise
                      )
                    )}
                  </td>
                  <td style="font-weight:700;">
                    ${escapeHtml(
                      formatMoney(payslip.netPayPaise)
                    )}
                  </td>
                  <td>
                    ${
                      payslip.status === "DRAFT"
                        ? `
                          <button
                            class="btn btn-ghost"
                            type="button"
                            data-edit-payslip="${escapeHtml(
                              payslip.payslipId
                            )}"
                          >
                            Edit draft
                          </button>
                        `
                        : `<span style="color:var(--muted);" style="font-size:11px;">Read only</span>`
                    }
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPayslipForm({
  payrollRunId,
  users,
  payslip = null,
}) {
  const editing = Boolean(payslip);
  const attendance = payslip?.attendanceSummary || {};
  const earnings = payslip?.earnings || {};
  const deductions = payslip?.deductions || {};

  return `
    <form
      data-payslip-form
      data-payroll-run-id="${escapeHtml(payrollRunId)}"
      data-payslip-id="${escapeHtml(
        payslip?.payslipId || ""
      )}"
    >
      <div
        class="flex justify-between items-center"
        style="gap:12px; flex-wrap:wrap; margin-bottom:16px;"
      >
        <div>
          <div style="color:var(--ink); font-size:16px; font-weight:700;">
            ${editing ? "Edit draft payslip" : "Add payslip"}
          </div>
          <div style="color:var(--muted);" style="font-size:12px;">
            All totals and lifecycle fields are calculated by the backend.
          </div>
        </div>
        ${
          editing
            ? `
              <button
                class="btn btn-ghost"
                type="button"
                data-cancel-payslip-edit
              >
                Cancel edit
              </button>
            `
            : ""
        }
      </div>

      <div class="flex gap-md" style="flex-wrap:wrap;">
        <label style="min-width:240px; flex:1;">
          <span style="color:var(--muted);" style="display:block; font-size:11px; margin-bottom:6px;">
            Employee
          </span>
          <select
            class="glass-input"
            name="employeeUserId"
            ${editing ? 'disabled data-payslip-locked' : "required"}
            style="width:100%;"
          >
            ${employeeOptions(
              users,
              payslip?.employeeUserId || ""
            )}
          </select>
        </label>

        <label style="min-width:220px; flex:1;">
          <span style="color:var(--muted);" style="display:block; font-size:11px; margin-bottom:6px;">
            Job title
          </span>
          <input
            class="glass-input"
            type="text"
            name="jobTitle"
            maxlength="120"
            value="${escapeHtml(payslip?.jobTitle || "")}"
            ${editing ? 'disabled data-payslip-locked' : ""}
            style="width:100%;"
          />
        </label>

        <label style="min-width:260px; flex:1;">
          <span style="color:var(--muted);" style="display:block; font-size:11px; margin-bottom:6px;">
            Notes
          </span>
          <input
            class="glass-input"
            type="text"
            name="notes"
            maxlength="2000"
            value="${escapeHtml(payslip?.notes || "")}"
            style="width:100%;"
          />
        </label>
      </div>

      <div style="margin-top:18px;">
        <div style="color:var(--ink); font-weight:700; margin-bottom:10px;">
          Attendance
        </div>
        <div style="color:var(--muted); font-size:11px; margin-bottom:10px;">
          Derived by the backend from real attendance, leave and holiday
          records — display only, and never submitted.
        </div>
        <div class="flex gap-md" style="flex-wrap:wrap;">
          ${derivedIntegerDisplay(
            ATTENDANCE_FIELDS,
            attendance
          )}
        </div>
      </div>

      <div style="margin-top:18px;">
        <div style="color:var(--ink); font-weight:700; margin-bottom:10px;">
          Earnings
        </div>
        <div class="flex gap-md" style="flex-wrap:wrap;">
          ${moneyInputs(
            EARNING_FIELDS,
            "earnings",
            earnings
          )}
        </div>
      </div>

      <div style="margin-top:18px;">
        <div style="color:var(--ink); font-weight:700; margin-bottom:10px;">
          Deductions
        </div>
        <div class="flex gap-md" style="flex-wrap:wrap;">
          ${moneyInputs(
            DEDUCTION_FIELDS,
            "deductions",
            deductions
          )}
        </div>
      </div>

      <div style="margin-top:20px;">
        <button class="btn btn-primary" type="submit">
          ${editing ? "Save draft" : "Add payslip"}
        </button>
      </div>
    </form>
  `;
}

function eligibleEmployees(users, cafeId) {
  return users.filter((user) => {
    if (!user || user.accountStatus !== "ACTIVE") {
      return false;
    }

    if (["MASTER", "OWNER"].includes(user.role)) {
      return true;
    }

    return Array.isArray(user.assignedCafeIds) &&
      user.assignedCafeIds.includes(cafeId);
  });
}

function parseRupeesToPaise(formData, fieldName, label) {
  const raw = String(formData.get(fieldName) ?? "").trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(`${label} must be a non-negative amount with at most two decimal places.`);
  }

  const [wholePart, decimalPart = ""] = raw.split(".");
  const rupees = Number(wholePart);
  const paise = Number(decimalPart.padEnd(2, "0"));

  if (
    !Number.isSafeInteger(rupees) ||
    !Number.isSafeInteger(paise) ||
    rupees > Math.floor(Number.MAX_SAFE_INTEGER / 100)
  ) {
    throw new Error(`${label} is outside the supported range.`);
  }

  return rupees * 100 + paise;
}

function buildMoneySection(formData, fields, section) {
  return Object.fromEntries(
    fields.map(([name, label]) => [
      name,
      parseRupeesToPaise(
        formData,
        `${section}.${name}`,
        label
      ),
    ])
  );
}

function buildPayslipBody(form, editing) {
  const formData = new FormData(form);
  const notes = String(
    formData.get("notes") || ""
  ).trim();

  // attendanceSummary is intentionally absent: the backend derives it from real
  // attendance/leave/holiday records on create and re-derives it on every patch.
  const body = {
    earnings: buildMoneySection(
      formData,
      EARNING_FIELDS,
      "earnings"
    ),
    deductions: buildMoneySection(
      formData,
      DEDUCTION_FIELDS,
      "deductions"
    ),
    notes,
  };

  if (!editing) {
    const employeeUserId = String(
      formData.get("employeeUserId") || ""
    )
      .trim()
      .toUpperCase();

    // Mirrors backend `EMPLOYEE_USER_ID_PATTERN` (Payslip.js / User.js): staff
    // onboarded through employeeService get EMP-ZC-* ids and vendor portal users
    // get VU-* ids — rejecting them here made those employees unpayable.
    if (
      !/^((MU|OW|AD|ST|VU)-\d{4,}|EMP-ZC-\d{4,})$/.test(
        employeeUserId
      )
    ) {
      throw new Error("Select a valid employee.");
    }

    const jobTitle = String(
      formData.get("jobTitle") || ""
    ).trim();

    body.employeeUserId = employeeUserId;

    if (jobTitle) {
      body.jobTitle = jobTitle;
    }
  }

  return body;
}

function setPayslipMutationState(dialog, busy) {
  payslipMutationInProgress = busy;

  dialog
    .querySelectorAll(
      "button, input, select, textarea"
    )
    .forEach((element) => {
      element.disabled = busy;
    });

  if (!busy) {
    dialog
      .querySelectorAll("[data-payslip-locked]")
      .forEach((element) => {
        element.disabled = true;
      });
  }
}

function renderPayslipManagerShell(payrollRun) {
  const canEdit = payrollRun.status === "DRAFT";

  return `
    <div
      class="glass-dark dialog-box"
      role="dialog"
      aria-modal="true"
      aria-label="Payroll-run payslips"
      style="width:min(1180px, 96vw); max-height:94vh; overflow:auto;"
    >
      <div
        class="flex justify-between items-center"
        style="gap:14px; flex-wrap:wrap; margin-bottom:18px;"
      >
        <div>
          <div style="color:var(--ink); font-size:18px; font-weight:700;">
            Payslips · ${escapeHtml(
              payrollRun.payrollRunId
            )}
          </div>
          <div style="color:var(--muted);" style="font-size:12px;">
            ${escapeHtml(payrollRun.cafeId)}
            · ${escapeHtml(payrollRun.periodKey)}
            · ${escapeHtml(payrollRun.status)}
          </div>
        </div>
        <div class="flex gap-sm">
          <button
            class="btn btn-ghost"
            type="button"
            data-refresh-payslips
          >
            Refresh
          </button>
          <button
            class="btn btn-ghost"
            type="button"
            data-close-payslips
          >
            Close
          </button>
        </div>
      </div>

      ${
        canEdit
          ? ""
          : `
            <div
              class="glass"
              style="padding:12px 14px; margin-bottom:16px;"
            >
              <div style="color:var(--muted);" style="font-size:12px;">
                This payroll run is read only because its status is
                ${escapeHtml(payrollRun.status)}.
              </div>
            </div>
          `
      }

      <div
        class="glass"
        style="padding:18px; margin-bottom:18px;"
      >
        <div
          style="color:var(--ink); font-size:15px; font-weight:700; margin-bottom:12px;"
        >
          Employee payslips
        </div>
        <div data-payslip-list>
          ${renderPayslipLoading()}
        </div>
      </div>

      <div
        class="glass"
        data-payslip-editor
        style="padding:18px;"
      >
        ${
          canEdit
            ? renderPayslipLoading()
            : `<div style="color:var(--muted);">Draft editing is unavailable.</div>`
        }
      </div>
    </div>
  `;
}

async function fetchPayslipManagerData(
  payrollRun,
  signal
) {
  const runId = encodeURIComponent(
    payrollRun.payrollRunId
  );

  const [payslipPayload, userPayload] =
    await Promise.all([
      apiGet(
        `/payroll/runs/${runId}/payslips?limit=100`,
        {
          signal,
        }
      ),
      payrollRun.status === "DRAFT"
        ? apiGet(
            "/users?accountStatus=ACTIVE",
            {
              signal,
            }
          )
        : Promise.resolve({
            data: {
              users: [],
            },
          }),
    ]);

  return {
    payslips:
      payslipPayload?.data?.payslips || [],
    users: eligibleEmployees(
      userPayload?.data?.users || [],
      payrollRun.cafeId
    ),
  };
}

function bindPayslipEditor({
  dialog,
  payrollRun,
  users,
  payslips,
  onChanged,
}) {
  const list = dialog.querySelector(
    "[data-payslip-list]"
  );
  const editor = dialog.querySelector(
    "[data-payslip-editor]"
  );
  const canEdit = payrollRun.status === "DRAFT";

  list.innerHTML = renderPayslipRows(payslips);

  if (!canEdit) {
    list
      .querySelectorAll("[data-edit-payslip]")
      .forEach((button) => {
        button.disabled = true;
        button.textContent = "Read only";
        button.removeAttribute(
          "data-edit-payslip"
        );
      });

    editor.innerHTML =
      `<div style="color:var(--muted);">Draft editing is unavailable.</div>`;
    return;
  }

  const renderEditor = (payslip = null) => {
    editor.innerHTML = renderPayslipForm({
      payrollRunId:
        payrollRun.payrollRunId,
      users,
      payslip,
    });

    editor
      .querySelector("[data-cancel-payslip-edit]")
      ?.addEventListener("click", () => {
        renderEditor();
      });

    editor
      .querySelector("[data-payslip-form]")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();

        submitPayslipForm({
          dialog,
          payrollRun,
          form: event.currentTarget,
          onChanged,
        });
      });
  };

  renderEditor();

  list
    .querySelectorAll("[data-edit-payslip]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const payslip = payslips.find(
          (item) =>
            item.payslipId ===
            button.dataset.editPayslip
        );

        if (!payslip) {
          showToast(
            "The selected payslip is unavailable.",
            "coral"
          );
          return;
        }

        renderEditor(payslip);
        editor.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
}

async function loadPayslipManager({
  dialog,
  payrollRun,
  onChanged,
}) {
  payslipRequest?.abort();

  const controller = new AbortController();
  payslipRequest = controller;

  const list = dialog.querySelector(
    "[data-payslip-list]"
  );
  const editor = dialog.querySelector(
    "[data-payslip-editor]"
  );

  if (!list || !editor) {
    return;
  }

  list.innerHTML = renderPayslipLoading();

  if (payrollRun.status === "DRAFT") {
    editor.innerHTML = renderPayslipLoading();
  }

  try {
    const { users, payslips } =
      await fetchPayslipManagerData(
        payrollRun,
        controller.signal
      );

    if (
      payslipRequest !== controller ||
      !dialog.isConnected
    ) {
      return;
    }

    bindPayslipEditor({
      dialog,
      payrollRun,
      users,
      payslips,
      onChanged,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }

    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Payslips unavailable</div>
        <div style="font-size:13px; max-width:360px;">
          ${escapeHtml(apiErrorMessage(error))}
        </div>
        <button
          class="btn btn-primary"
          type="button"
          data-retry-payslips
          style="margin-top:14px;"
        >
          Retry
        </button>
      </div>
    `;

    list
      .querySelector("[data-retry-payslips]")
      ?.addEventListener("click", () => {
        loadPayslipManager({
          dialog,
          payrollRun,
          onChanged,
        });
      });
  } finally {
    if (payslipRequest === controller) {
      payslipRequest = null;
    }
  }
}

async function submitPayslipForm({
  dialog,
  payrollRun,
  form,
  onChanged,
}) {
  if (payslipMutationInProgress) {
    return;
  }

  const payslipId =
    form.dataset.payslipId || "";
  const editing = Boolean(payslipId);
  let body;

  try {
    body = buildPayslipBody(form, editing);
  } catch (error) {
    showToast(error.message, "amber");
    return;
  }

  setPayslipMutationState(dialog, true);

  try {
    const runId = encodeURIComponent(
      payrollRun.payrollRunId
    );

    const payload = editing
      ? await apiPatch(
          `/payroll/runs/${runId}/payslips/${encodeURIComponent(
            payslipId
          )}`,
          {
            body,
          }
        )
      : await apiPost(
          `/payroll/runs/${runId}/payslips`,
          {
            body,
          }
        );

    showToast(
      payload?.message ||
        (editing
          ? "Draft payslip updated successfully."
          : "Payslip added successfully."),
      "mint"
    );

    await loadPayslipManager({
      dialog,
      payrollRun,
      onChanged,
    });

    if (typeof onChanged === "function") {
      await onChanged();
    }
  } catch (error) {
    showToast(apiErrorMessage(error), "coral");
  } finally {
    if (dialog.isConnected) {
      setPayslipMutationState(dialog, false);
    } else {
      payslipMutationInProgress = false;
    }
  }
}

export function openPayrollPayslips({
  payrollRun,
  onChanged,
}) {
  if (
    !payrollRun?.payrollRunId ||
    !payrollRun?.cafeId
  ) {
    showToast(
      "The payroll run could not be opened.",
      "coral"
    );
    return;
  }

  document
    .querySelector(
      "[data-payroll-payslip-dialog]"
    )
    ?.remove();

  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.dataset.payrollPayslipDialog = "";
  overlay.innerHTML =
    renderPayslipManagerShell(payrollRun);

  const close = () => {
    payslipRequest?.abort();
    payslipRequest = null;
    payslipMutationInProgress = false;
    document.removeEventListener(
      "keydown",
      handleKeydown
    );
    overlay.remove();
  };

  const handleKeydown = (event) => {
    if (
      event.key === "Escape" &&
      !payslipMutationInProgress
    ) {
      close();
    }
  };

  overlay
    .querySelector("[data-close-payslips]")
    .addEventListener("click", close);

  overlay
    .querySelector("[data-refresh-payslips]")
    .addEventListener("click", () => {
      loadPayslipManager({
        dialog: overlay,
        payrollRun,
        onChanged,
      });
    });

  overlay.addEventListener("click", (event) => {
    if (
      event.target === overlay &&
      !payslipMutationInProgress
    ) {
      close();
    }
  });

  document.addEventListener(
    "keydown",
    handleKeydown
  );
  document.body.appendChild(overlay);

  loadPayslipManager({
    dialog: overlay,
    payrollRun,
    onChanged,
  });
}
