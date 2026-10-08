# ZAMORIN CAFE ERP - P08 DELIVERY VERIFICATION, INVOICE REVIEW & PAYABLES REPORT

## Package Summary
- **Package**: P08 Delivery Verification, 3-Way Match, AP Invoice & Vendor Payables
- **Branch**: `feature/foundation-five-windows`
- **Commit**: `1b98287`
- **Test Suite Result**: 31/31 PASS (`backend/test/p08DeliveryVerificationInvoicePayables.test.js`)
- **P07 Regression Result**: 18/18 PASS (`backend/test/p07ProcurementApprovalDispatch.test.js`)
- **P06 Regression Result**: 16/16 PASS (`backend/test/p06ReplenishmentRecommendation.test.js`)
- **P05 Regression Result**: 14/14 PASS (`backend/test/p05DataFoundationStockPolicy.test.js`)

---

## 1. Architecture Overview

P08 completes the downstream half of the purchase-to-pay cycle. It governs everything
that happens AFTER the vendor sends goods — from dock receipt through to Accounts Payable.

### Lifecycle Implemented

```
VERIFIED_PENDING_MASTER_APPROVAL  (GRN submitted by Cafe Admin)
  → Master reviews GRN + vendor bill attachment
  → masterApproveOrderAndBill() → [CLOSED / PARTIALLY_RECEIVED]
  → createApInvoiceFromGrn()   → APInvoice (VENDOR_BILL liability)
  → AP Invoice enters payables queue (DUE / ON_HOLD if variance)
  → Vendor Ledger Entry records running balance increase
```

---

## 2. New Service: `grnDeliveryService.js`

**Path**: `Backend/src/services/grnDeliveryService.js`

Six exported, independently-testable functions:

| Function | Purpose |
|---|---|
| `validateGrnPayload(po, deliveries)` | Validates delivery items vs PO; enforces discrepancy reason |
| `buildGrnRecord({ grnId, validatedItems, ... })` | Constructs GRN sub-document with ACCEPTED/PARTIAL status |
| `performThreeWayMatch({ po, grnItems, ... })` | Delegates to ThreeWayMatchService.reconcileProcurementDocuments |
| `computeApInvoiceAmounts({ po, validatedItems, ... })` | Three-value financial split (claimed / approved / held) |
| `createApInvoiceFromGrn({ organisationId, purchaseOrderId, ... })` | Full AP invoice creation pipeline with idempotency guard |
| `getGrnAndMatchStatus({ organisationId, purchaseOrderId })` | Read-only status query: GRN count, match result, AP invoice |

---

## 3. Invariants Preserved

1. **ZERO Additional Stock Mutation**:
   - `grnDeliveryService.js` does NOT import `StockMovement` or `InventoryLot`
   - Inventory was already posted atomically during `verifyDeliveryAndSubmitBill` (P05/GRN controller)
   - Verified by test 21 (static source analysis)

2. **ZERO GL/Cash Mutation**:
   - `grnDeliveryService.js` does NOT import `Journal` or `CashTransaction`
   - AP Invoice creation is a liability recognition, never a cash disbursement
   - Verified by test 22 (static source analysis)

3. **Three-Value Financial Architecture**:
   - `supplierClaimedAmountPaisa` — raw vendor invoice total
   - `approvedPayableAmountPaisa` — accepted qty × PO rate (what we actually owe)
   - `heldDisputedAmountPaisa` — variance held pending dispute resolution
   - Conservation invariant: `approved + held = claimed` (tests 19, 20)

4. **Idempotent AP Invoice Creation**:
   - Second call for same PO returns existing invoice with `alreadyExists: true`
   - No duplicate AP Invoice or VendorLedgerEntry created (test 14)

5. **GRN Guards**:
   - AP Invoice blocked if no GRN exists on PO (test 12)
   - Discrepancy reason mandatory when quantities short (tests 3, 25)
   - Unknown itemId rejected immediately (test 2)

---

## 4. 3-Way Match Integration

`ThreeWayMatchService.reconcileProcurementDocuments` evaluates:
- **NOT_READY**: No GRN or invoice documents yet
- **DOCUMENT_MISSING**: GRN without invoice (SUPPLIER_INVOICE), or invoice without GRN (GRN)
- **MATCHED**: Full quantity and price alignment within tolerance
- **QUANTITY_VARIANCE / PRICE_VARIANCE / TAX_VARIANCE**: Specific mismatch type

Tolerance config: `rateTolerancePaisa: 100`, `totalTolerancePaisa: 500`

---

## 5. AP Invoice Payment Status Logic

| Scenario | heldDisputedAmountPaisa | paymentStatus |
|---|---|---|
| Full delivery, prices match | 0 | DUE |
| Short delivery / quantity variance | > 0 | ON_HOLD |
| Disputed quantity released | 0 (after resolution) | DUE |

---

## 6. Existing Infrastructure Reused

- `APInvoice` model — extended three-value schema with holds sub-document
- `VendorLedgerEntry` model — immutable append-only subledger (VENDOR_BILL entry type)
- `vendorLedgerService.postVendorBillFromReceipt` — single source of truth for AP + ledger creation
- `ThreeWayMatchService` — 13-field PO/GRN/Invoice comparison engine
- `procurementController.verifyDeliveryAndSubmitBill` — GRN submission + inventory posting (unchanged)
- `procurementController.masterApproveOrderAndBill` — Master approval gate (unchanged)

---

## 7. Test Coverage: 31 Assertions

| Group | Tests | Coverage |
|---|---|---|
| validateGrnPayload | 1-5, 25-26 | All validation rules |
| buildGrnRecord | 6-7 | ACCEPTED / PARTIAL status |
| computeApInvoiceAmounts | 8-9, 19-20, 27 | Three-value split, zero-tax edge |
| performThreeWayMatch | 10-11 | MATCHED and QUANTITY_VARIANCE |
| ThreeWayMatchService | 23-24, 28-29 | MATCHED, NOT_READY, DOCUMENT_MISSING |
| createApInvoiceFromGrn | 12-14 | GRN_REQUIRED, PO_NOT_FOUND, idempotent |
| getGrnAndMatchStatus | 15-18 | NOT_READY, DOCUMENT_MISSING, has AP, PO_NOT_FOUND |
| Invariants (static) | 21-22 | No StockMovement/Journal imports |
| AP Status | 30 | DUE vs ON_HOLD |

---

## 8. Verdict

**PASS — P08 IMPLEMENTED**

The delivery verification → 3-way match → AP invoice creation pipeline is implemented,
tested at 31/31, and passes full P05/P06/P07 regression.
