# ZAMORIN CAFÉ ERP — COGS VALUATION ENGINE & HISTORICAL BACKFILL GUIDE
## Architectural Specification, Valuation Methodology & Operational Runbook
**Reference**: SCR-022 / Issue #2 (`[Reports] COGS reports return 'UNAVAILABLE', no cost-posting model exists`)  
**Resolution Strategy**: Option 3 (MVP) — `LAST_PO_PRICE` Snapshot against Recipe BOM Composition & POS Sales  
**Compliance Authority**: `.agents/rules/vendor_order_lifecycle_freeze.md` (Zero Procurement Mutations)  
**Publication Date**: October 2026

---

## 1. Executive Summary & Problem Context

Prior to this implementation, all enterprise P&L statements and margin reports in Zamorin Café ERP returned:
```json
{
  "cogsPaisa": null,
  "costPerUnitPaisa": null,
  "status": "UNAVAILABLE",
  "reason": "Unposted Cost Ledger / No Cost-Posting Step Exists"
}
```

Because full perpetual inventory double-entry debit/credit ledger posting had not yet been commissioned, reporting surfaces were unable to compute Gross Profit, Gross Margin %, or Store Operating Profit (EBITDA). 

Rather than waiting for a heavyweight accounting sub-ledger or fabricating artificial transactional journal lines, **Option 3 (MVP)** was selected in direct alignment with senior engineering leadership:
1. Snapshot the latest inbound Purchase Order / Goods Received Note (GRN) unit price (`unitPricePaisa`) on each inventory ingredient.
2. Explode Recipe Bills of Materials (BOM), including recursive sub-recipes and prep loss factors.
3. Apply standard portion costs against POS Bill sales quantities to calculate authoritative, honest Cost of Goods Sold and product-level gross margins.
4. Expose clear metadata (`"basis": "LAST_PO_PRICE"`, `"actuality": "ESTIMATED"`, `"status": "AVAILABLE"`) to maintain GAAP/auditor transparency.

---

## 2. Valuation Architecture & Cost Precedence

The COGS engine (`backend/src/services/cogsService.js`) resolves item costs using a deterministic two-tier hierarchy:

```
┌────────────────────────────────────────────────────────┐
│  Tier 1: Latest Approved / Received Purchase Order      │
│  - Query PurchaseOrder lineItems in reverse createdAt   │
│  - Filter status: APPROVED, ORDERED, RECEIVED, CLOSED  │
│  - Basis: "LAST_PO_PRICE"                              │
└───────────────────────────┬────────────────────────────┘
                            │ (If no PO exists)
                            ▼
┌────────────────────────────────────────────────────────┐
│  Tier 2: Global Inventory Item Master Catalogue         │
│  - Query GlobalInventoryItem.unitCostPaisa             │
│  - Baseline standard cost established at SKU creation  │
│  - Basis: "CATALOGUE_STANDARD"                         │
└────────────────────────────────────────────────────────┘
```

### Precedence Invariants:
1. **Latest Verified PO Rate**: When a café receives items via an approved PO/GRN, the most recent verified `unitPricePaisa` automatically becomes the valuation basis for that SKU.
2. **Catalogue Standard Fallback**: For stock received prior to digital ERP cut-over or items without PO purchase history, the engine falls back to `GlobalInventoryItem.unitCostPaisa`.
3. **No Zero Fabrication**: If an ingredient has no cost information in either source, its cost is treated as ₹0.00 with appropriate data quality warnings, avoiding runtime exceptions while logging provenance.

---

## 3. Recipe BOM Explosion & Prep Loss Engine

Restaurant dishes and beverages frequently comprise pre-batched sub-recipes (e.g., espresso shots, sauces, marinades, syrups) subject to yield variance and preparation loss.

The engine recursively resolves recipes up to a maximum safety depth of 4:

$$\text{Ingredient Cost} = \text{Quantity} \times \text{Unit Cost} \times \left(1 + \frac{\text{Loss Factor \%}}{100}\right)$$

$$\text{Portion Unit Cost} = \frac{\sum \text{Ingredient Costs}}{\text{Batch Yield}}$$

### Example Calculation (Flat White):
- **Sub-Recipe (Espresso Shot)**:
  - 18g Espresso Beans @ ₹1.50/g (150 paisa)
  - Grind loss: 5%
  - Sub-unit cost = $18 \times 150 \times 1.05 = 2,835\text{ paisa}$ (₹28.35)
- **Parent Recipe (Flat White)**:
  - 1 Espresso Shot: 2,835 paisa
  - 180ml Fresh Milk @ ₹0.60/ml (60 paisa), 0% loss: 10,800 paisa
  - Total Recipe Cost = $2,835 + 10,800 = 13,635\text{ paisa}$ (₹136.35)
  - Batch yield = 1 cup $\rightarrow$ Portion Unit Cost = ₹136.35.

When sold at ₹220.00:
- Gross Sales: ₹220.00
- COGS: ₹136.35
- Gross Profit: ₹83.65 (38.02% gross margin)

---

## 4. Strict Procurement Lifecycle Freeze Compliance

The COGS implementation strictly adheres to `.agents/rules/vendor_order_lifecycle_freeze.md`:

| Requirement | Implementation Verification |
| :--- | :--- |
| **Zero Procurement Mutations** | `cogsService.js` contains **only read-only** queries (`.find().lean()`). No `.create()`, `.updateOne()`, or `.save()` is called on PurchaseOrder or InventoryLot. |
| **No GRN State Machine Bypass** | Inbound rates are read from existing PO line items without triggering lifecycle transitions. |
| **No Schema Alterations** | Reuses existing fields: `PurchaseOrder.lineItems.unitPricePaisa` and `GlobalInventoryItem.unitCostPaisa`. |
| **Read-Model Isolation** | The calculation is executed on demand or during export compilation; it does not introduce locks on transactional tables. |

---

## 5. Historical Stock Backfill & Cut-Over Runbook

For stock on hand prior to the ERP cut-over date, follow this operational runbook to ensure accurate margins:

### Step 1: Baseline Catalogue Standard Cost Seeding
Ensure all active catalogue items in `GlobalInventoryItem` have their initial cost set in `unitCostPaisa`:
```javascript
// Bulk update catalogue standard cost for opening items
await GlobalInventoryItem.updateMany(
  { organisationId: 'ZAMORIN', itemId: 'INV-COFFEE-BEANS' },
  { $set: { unitCostPaisa: 5000 } } // ₹50.00 per kg
);
```

### Step 2: Historical PO Digitization (Optional)
If historical POs are digitized, their line items should include:
- `itemId`: Alphanumeric item code matching catalogue SKU
- `orderedQuantityBase`: Number of units
- `unitPricePaisa`: Inbound rate in integer paise
- `totalLinePaisa`: Total line commitment in paise
- `status`: `RECEIVED` or `CLOSED`

The COGS engine will automatically pick up the newest PO based on `createdAt`.

### Step 3: Zero-Migration Cut-Over
Because the engine queries in reverse chronological order with catalogue fallback:
- **No data migration script is required.**
- As new POs are approved and received in the normal course of business, the COGS engine immediately reflects new purchasing rates without administrative intervention.
- The P&L statement dynamically shifts from `source: CATALOGUE_STANDARD` to `source: LAST_PO_PRICE` item by item.

---

## 6. Governed API & Reporting Interfaces

### 1. Dedicated COGS Report Endpoint
- **Method**: `GET /api/v1/reports/cogs`
- **Permissions**: `REPORTS_READ` (Roles: `MASTER`, `OWNER`, `CAFE_ADMIN`)
- **Query Parameters**:
  - `period`: e.g., `today`, `this_month`, `last_month`, `ytd`
  - `dateFrom`: ISO Date `YYYY-MM-DD`
  - `dateTo`: ISO Date `YYYY-MM-DD`
  - `cafeId`: Specific café identifier (or omitted for all authorized cafés)
- **Period scoping**: `dateFrom`/`dateTo` filter on `Bill.businessDate` (the IST calendar day the
  sale belongs to), **not** `createdAt` — a bill rung up at 23:59 IST still belongs to that
  business day. This matches how the rest of the reporting engine scopes periods. Purchase-order
  *rate* precedence remains ordered by PO `createdAt` (latest PO wins).
- **Response Structure**:
```json
{
  "success": true,
  "data": {
    "organisationId": "ZAMORIN",
    "cafeScope": "ZC-0001",
    "period": { "dateFrom": "2026-10-01", "dateTo": "2026-10-31" },
    "status": "AVAILABLE",
    "basis": "LAST_PO_PRICE",
    "isApproximate": true,
    "basisNote": "Estimated Cost of Goods Sold derived from POS sales volumes, recipe BOM composition, and most recent Purchase Order / Inbound GRN unit rates.",
    "cogsPaisa": 12500000,
    "cogs": 125000.00,
    "costPerUnitPaisa": 6250,
    "costPerUnit": 62.50,
    "totalUnitsSold": 2000,
    "pricedUnitsSold": 1950,
    "costCoveragePct": 97.5,
    "grossSalesPaisa": 45000000,
    "grossSales": 450000.00,
    "netSalesPaisa": 45000000,
    "netSales": 450000.00,
    "grossProfitPaisa": 32500000,
    "grossProfit": 325000.00,
    "grossMarginPct": 72.22,
    "items": [
      {
        "menuItemId": "MENU-01",
        "name": "House Brew Coffee",
        "unitsSold": 1200,
        "revenue": 180000.00,
        "cogs": 45000.00,
        "unitCost": 37.50,
        "grossMargin": 135000.00,
        "grossMarginPct": 75.00
      }
    ],
    "generatedAt": "2026-10-20T21:45:00.000Z"
  }
}
```
- **Cost coverage**: `costCoveragePct` is the share of sold units whose recipe/SKU could be priced
  from a real cost source. Below `100` means the COGS figure is *understated* (unpriced lines
  contribute ₹0 cost) — read it alongside `cogs` before trusting a margin percentage.

### 2. Finance Analytics P&L & Waterfall (`GET /api/v1/reports/finance`)
`plStatement` and the `waterfall` array consume the same engine (via the honest gate
`deriveFinanceCogsBlock`):
- **With real sales AND a real cost basis**: `plStatement.cogs` is populated,
  `cogsStatus: "AVAILABLE (Basis: LAST_PO_PRICE, ESTIMATED)"`, `cogsAvailability: "ESTIMATED"`,
  `grossProfit = Net Sales − COGS`, `grossMarginPct` derived, `primeCost = COGS + Gross Payroll`
  (`PARTIAL_SOURCE`, because labour excludes employer statutory overheads), and the waterfall's
  *Cost of Goods (COGS)* row is a real negative deduction with the estimate basis disclosed.
- **Without a cost basis** (no PO rate, no catalogue cost, no recipe): everything stays
  `null` / `UNAVAILABLE` and the waterfall row stays `null` — never a fabricated `₹0`, which would
  silently report a 100 % gross margin. The reason is exposed
  (`NO_SALES_IN_PERIOD` / `NO_COST_BASIS` / `SOURCE_ERROR`).
- The data-quality warnings shift from `COGS_UNAVAILABLE_*` to
  `COGS_ESTIMATED_LAST_PO_PRICE_NOT_A_POSTED_LEDGER` when the estimate is in use.

### 3. Universal Corporate Export (ZURF v1) P&L Statement Integration
In `POST /api/v1/reports/export` with `reportId: "pl-statement"`:
- **Cost of Goods Sold (COGS)**: Populated with `-₹XX,XXX.XX`, `actuality: "ESTIMATED"`, `status: "AVAILABLE (Basis: LAST_PO_PRICE)"`.
- **Gross Profit**: Populated with `Net Sales - COGS`, `actuality: "ESTIMATED"`, `status: "AVAILABLE (Basis: LAST_PO_PRICE)"`.
- **Store Operating Profit (EBITDA)**: Populated with `Gross Profit - Opex - Labour`, `actuality: "ESTIMATED"`, `status: "AVAILABLE (Estimated EBITDA)"`.

---

## 7. Verification & Test Evidence

The implementation is verified by an automated integration test suite:
- **Test File**: `backend/test/cogsReportIntegration.test.js`
- **Results**: 10/10 test cases passing (0 failures):
  1. Latest PO unit price precedence over catalogue baseline (`LAST_PO_PRICE`).
  2. Un-ordered catalogue standard fallback (`CATALOGUE_STANDARD`).
  3. Recipe BOM explosion with sub-recipe recursion and yield loss factor.
  4. POS sales aggregation, gross sales, gross profit, and margin % calculations.
  5. Controller endpoint `GET /api/v1/reports/cogs` returns 200 with structured data.
  6. Role authorization: `MASTER`, `OWNER`, `CAFE_ADMIN` allowed; `STAFF` rejected.
  7. ZURF P&L Statement export reflects estimated COGS, Gross Profit, and EBITDA.
  8. `/reports/finance` P&L + waterfall derive COGS/gross profit from real cost data.
  8b. `/reports/finance` stays honestly `UNAVAILABLE` when the sale cannot be priced.
  9. Full regression verification against `npm --prefix backend test` (canonical 551/551).
