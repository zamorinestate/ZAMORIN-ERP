# ZAMORIN CAFÉ ERP — P07 PURCHASE APPROVAL, IMMUTABLE REVISION & DISPATCH REPORT

## Package Summary
- **Package**: P07 Café Operations Purchase Review, Approval, Immutable PO Revision & Vendor Dispatch
- **Branch**: `feature/foundation-five-windows`
- **Working Tree**: Clean, verified
- **Test Suite Result**: 18/18 PASS (`backend/test/p07ProcurementApprovalDispatch.test.js`)
- **P06 Regression Result**: 16/16 PASS (`backend/test/p06ReplenishmentRecommendation.test.js`)
- **P05 Regression Result**: 14/14 PASS (`backend/test/p05DataFoundationStockPolicy.test.js`)
- **Release Suite Result**: 88/88 PASS (`npm run test:release`)
- **Syntax Verification**: 629/629 Backend JS files passed, Frontend JS passed (`npm run check`)

---

## 1. Procurement Architecture Reuse
The implementation deliberately reused existing core models and infrastructure rather than inventing duplicate subsystems:
1. **PurchaseOrder Model**: Extended with `currentRevision`, `activeApprovedRevision`, `revisions` (immutable history array), `sourceRecommendationIds`, `dispatchStatus`, `vendorResponseStatus`, and `vendorResponseDetails`.
2. **ProcurementDispatchJob Model**: Dedicated durable outbox model for asynchronous outbound order dispatching with lifecycle: `QUEUED`, `CLAIMED`, `SENDING`, `ACCEPTED_BY_PROVIDER`, `DELIVERED`, `FAILED`, `UNKNOWN`, `CHANNEL_SETUP_REQUIRED`, `CANCELLED`.
3. **ApprovalPolicyService**: Leveraged for data-driven, versioned financial authority threshold resolution.
4. **DataFoundationService & P06 Engine**: Revalidated item data-quality eligibility, active approved vendor contracts, contracted rates, and deterministic deferral suppression.
5. **ScheduledJobRegistry**: Registered `JOB-PROCUREMENT-DISPATCH-WORKER` into the canonical durable scheduled worker architecture.
6. **PDF Generation Infrastructure**: Vendor-facing binary PDF documents (`%PDF-1.4`) generated from exact approved revisions without internal stock, confidence, or margin leakage.

---

## 2. Invariants Preserved
1. **Zero Stock Mutation**:
   - `StockMovement.countDocuments`: 0
   - `InventoryLot.countDocuments`: 0
   - `GRN receipts`: 0
   - *Physical stock enters inventory authoritatively ONLY through verified GRN receiving in P08.*
2. **Zero Financial Liabilities**:
   - `APInvoice.countDocuments`: 0
   - `VendorLedgerEntry.countDocuments`: 0
   - `Journal.countDocuments`: 0
   - `CashTransaction.countDocuments`: 0
   - *Approval and dispatch represent a purchase commitment, never an AP liability or cash disbursement.*
3. **Role & Persona Boundaries**:
   - **Primary Master**: Global exception and escalation authority.
   - **Café Operations (`CAFE_ADMIN`)**: Routine approval strictly within assigned café and below configured policy threshold.
   - **Owner**: Strategic read-only; denied purchasing mutations (HTTP 403 `ROLE_NOT_ALLOWED`).
   - **Staff**: Completely excluded from procurement (HTTP 403 `ROLE_NOT_ALLOWED`).
   - **Vendor**: Read-only external portal; mutations restricted to authenticated operator-recorded confirmations.
   - **Cross-Café**: Denied (HTTP 403 `CAFE_ACCESS_DENIED`).

---

## 3. Core Architectural Modules Implemented
- [Backend/src/models/ProcurementDispatchJob.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/models/ProcurementDispatchJob.js): Outbox job model.
- [Backend/src/models/PurchaseOrder.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/models/PurchaseOrder.js): Immutable revision and approval schema.
- [Backend/src/services/procurementApprovalService.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/services/procurementApprovalService.js): Domain logic for recommendation conversion, revision management, atomic approval + outbox queueing, supplier alternatives, and vendor acknowledgement.
- [Backend/src/services/procurementDispatchService.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/services/procurementDispatchService.js): Outbox worker, email provider adapter, pre-send revocation recheck, PDF generation, and UNKNOWN status reconciliation.
- [Backend/src/services/replenishmentRecommendationService.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/services/replenishmentRecommendationService.js): Deterministic deferral suppression check and material escalation reopening.
- [Backend/src/controllers/procurementController.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/controllers/procurementController.js): REST API endpoints for all P07 review and dispatch operations.
- [Backend/src/routes/procurementRoutes.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Backend/src/routes/procurementRoutes.js): Route registration with role-based authorization middleware.
- [Frontend/src/js/pages/procurement.js](file:///D:/Zamorin%20Cafe%20ERP/A%20Main%20Workspace/Frontend/src/js/pages/procurement.js): Manager review modal, vendor order grouping, inline approval, supplier response recording.

---

## 4. Concurrency & Idempotency Proof
- 50 parallel identical approval requests yielded exactly 1 PO state and 1 active dispatch job.
- Double-clicking or retrying after a lost response returns the existing authoritative commitment (`alreadyApproved: true`) without creating duplicate records.

---

## 5. Live Dispatch Dependency Notice
- Development and automated regression suites utilize the deterministic `ConsoleTestEmailProvider`.
- Live production outbound delivery requires genuine SMTP/Gmail/SendGrid credentials.
- When unconfigured, dispatch jobs transition safely to `CHANNEL_SETUP_REQUIRED` without marking orders falsely as `SENT`.

---

## 6. Verdict
**PASS WITH CONDITIONS — P07 IMPLEMENTED, LIVE DISPATCH DEPENDENCY REMAINS**
