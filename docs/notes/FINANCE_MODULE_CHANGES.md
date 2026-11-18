# Finance Module — Changes & Rationale (Session Work)

This document records the finance-module changes made during the current working session,
why each was done, and what remains open. All paths are relative to `ZAMORIN-ERP/`.

## 1. Why this work was done

The Finance section (Sales & Cash Book, Bills & Receipts, Expenses, Finance & Accounting)
had a large amount of **UI that looked wired but was not actually connected** to the backend:
several modals showed "Not connected: this form is not linked to the server yet. Nothing
was saved." Some backend endpoints returned **hardcoded mock data** (budgets, tax review,
financial statements). The goal of this session was to:

- Remove false "connected" UI by wiring modals to real endpoints where they exist.
- Add the missing backend endpoints needed for bank accounts and budgets.
- Replace at least the budget mock with real database-backed aggregation.
- Verify syntax, router imports, and finance tests.

## 2. Backend changes

### 2.1 New endpoints

| Endpoint | Controller | Route | Purpose |
|---|---|---|---|
| `POST /api/v1/finance/bank-accounts` | `createBankAccount` | `financeRoutes.js` | Register a bank account (alias, bank, masked account, IFSC, GL code, opening balance). |
| `POST /api/v1/finance/budgets` | `createBudget` | `financeRoutes.js` | Allocate a departmental budget as an approved `BudgetPlan`. |

Both are guarded by `authorize('FINANCE:WRITE', { allowedRoles: ['MASTER'] })`.

### 2.2 Controller logic

- `createBankAccount` generates `BA-NNNN` via `BankAccount.countDocuments`, validates required
  fields, and persists a `BankAccount`.
- `createBudget` generates `BUD-NNNN`, creates a `BudgetPlan` with one budget line, status
  `APPROVED`, and audit history entry.
- `getBudgetsAndAllocations` was rewritten from a static 4-row array to aggregate real
  `BudgetPlan` lines by category and actual `Expense` totals by category, returning
  `monthlyBudgetPaisa`, `committedPaisa`, `actualPaisa`, and `variancePaisa`.

### 2.3 Model change

- `backend/src/models/BudgetPlan.js`: relaxed `budgetLineSchema.category` from a fixed enum
  (`BUDGET_CATEGORIES`) to a free-form trimmed string.
  **Why:** the frontend budget modal uses free-form category names (e.g. `COFFEE_RAW_BEANS`),
  which are not in the enum. Relaxing the enum keeps existing enum-based callers working
  (backward compatible) while allowing UI-driven categories.

## 3. Frontend changes

`frontend/src/js/pages/financeAccounts.js`

- **New Journal modal** now calls `POST /finance/journals` with double-entry lines instead of
  showing "Not connected".
- **Record AP Bill modal** now calls `POST /finance/ap/invoices` (vendor, invoice number,
  dates, amount, cafe) instead of showing "Not connected".
- **Add Bank Account modal** now collects IFSC and calls `POST /finance/bank-accounts`.
- **Allocate Budget modal** now calls `POST /finance/budgets`.
- The `NOT_SAVED` constant remains declared but is no longer used by these modals.

## 4. Verification performed

- `npm --prefix backend run check` -> all 727 backend JS files pass syntax validation.
- `node scripts/verify_all.js` -> 862 JS files verified, 0 errors.
- `node frontend/verifyRouterImports.mjs` -> all router imports/exports resolve.
- `node scripts/master_system_verification.mjs` -> 36/36 checks pass.
- Manual API smoke tests against the dev server:
  - Journal creation OK
  - AP invoice creation OK
  - Bank account creation OK
  - Budget allocation OK
  - Budgets list reflects real DB data OK
- `financeAccounting.test.js` -> 12/12 pass.

## 5. Known issues / not changed

- `billManagement.test.js` and `expenseManagement.test.js` use `token_normal_master`, but
  Normal Master is permanently decommissioned (`403 ROLE_RETIRED`). Those subtests fail
  because they expect `200` for a retired role. This is a test/auth migration issue, not a
  finance code regression. Tests were left untouched.
- `getTaxReview` and `getFinancialStatements` still return hardcoded mock data.
- IRN/e-way bill generation is payload-only; live NIC submission needs GSP credentials.
- Fixed-asset depreciation remains unavailable (`financeCalculations.js`).
- `rec17b`/`rec17c` reconciliation tests remain flaky (`WriteConflict`).

## 6. Next steps

1. Replace remaining hardcoded mocks (`getTaxReview`, `getFinancialStatements`) with DB-backed
   aggregations once statutory/accounting data is available.
2. Wire or remove the AR Collection modal (currently informational).
3. Migrate Normal Master test tokens to Primary Master where appropriate.
4. Investigate `rec17b`/`rec17c` write conflicts.
5. Port real master/transactional data via seed scripts or import endpoints.
