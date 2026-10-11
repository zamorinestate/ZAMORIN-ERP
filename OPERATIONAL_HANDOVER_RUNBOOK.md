# ZAMORIN CAFÉ ERP — OPERATIONAL HANDOVER RUNBOOK
## Package P22: Acceptance Pilot, Operational Readiness, and Engineering Handover

> **Document Status**: Authoritative Final Operational Handover  
> **Package Reference**: P22 (Final Package in P01–P22 Programme)  
> **Target Branch**: `feature/foundation-five-windows`  
> **Environment Context**: Local Verification & Controlled Pilot Environment  
> **Governance Authority**: Chief Enterprise Architect / Primary Master  

---

## 1. Executive Summary & Acceptance Scope

Package P22 represents the formal acceptance pilot and operational handover programme for the **Zamorin Café ERP** platform, concluding the multi-package implementation lifecycle (Packages P01 through P22).

This runbook provides unambiguous, reproducible instructions for operating, verifying, maintaining, and troubleshooting the platform. All procedures and invariants documented herein are verified against executable application code.

### 1.1 Acceptance Principles
1. **Evidence-Driven Verification**: No capability is accepted based on Markdown claims, mocks, or placeholder UI alone. Every material workflow is validated against executable models, APIs, and business invariants.
2. **Truthful Classification**: System components and gates are classified strictly into one of:
   - `PASS_VERIFIED`: Executed against production-grade code with reproducible evidence.
   - `PASS_WITH_LIMITATIONS`: Executed within local simulation or memory-backed adapter boundaries.
   - `BLOCKED_EXTERNAL_DEPENDENCY`: Cannot be validated live due to absence of external credentials, merchant agreements, or cloud services.
   - `FAIL`: Executed and failed acceptance criteria.
   - `NOT_APPLICABLE`: Requirement intentionally excluded by governance freeze.
3. **Absolute KDS Freeze**: Kitchen Display Systems (Petpooja benchmark records `F275`–`F292`) remain permanently excluded. Any route or service request targeting KDS fails closed with HTTP `403 KDS_ACTIVATION_EXCLUDED_BY_FREEZE`.
4. **Decoupled Financial Invariants**: Printing, kicking cash drawers, barcode scanning, forecasting simulations, and data migration dry-runs strictly produce **zero financial ledger mutations** and **zero stock movement mutations**.

---

## 2. Platform Architecture & Security Governance Matrix

### 2.1 Persona Topology & Server-Side Enforcement
The system enforces a strict four-persona internal authority model, a read-only vendor boundary, and a permanently decommissioned Normal Master:

| Persona / Role | Scope & Permissions | Mutations Allowed | Forbidden Actions (Enforced with HTTP 403) |
| :--- | :--- | :--- | :--- |
| **PRIMARY_MASTER** (`MASTER`) | Universal enterprise governance authority across all cafés. | All approved operational and configuration mutations. | Live production database overwrite during restore rehearsal. |
| **OWNER** (`OWNER`) | Executive portfolio oversight, financial read-only analytics, sandbox scenarios. | Advisory simulation only (zero ledger effect). | Operational mutations, live price edits, direct PO creation (`403 OWNER_READ_ONLY`). |
| **CAFE_ADMIN** (`CAFE_ADMIN`) | Operations management strictly scoped to assigned café (`primaryCafeId`). | Operational orders, GRN receipt, till management within assigned café. | Cross-café access (`403 CAFE_ACCESS_DENIED`), enterprise governance edits. |
| **STAFF** (`STAFF`) | Floor staff, cashier, barista self-service and assigned tasks. | POS checkout within shift, task completion evidence submission. | Governance, pricing, master data, raw inventory deletion (`403 INSUFFICIENT_PERMISSIONS`). |
| **VENDOR** (`VENDOR`) | External partner portal (dairy, beans, packaging). | Read-only PO inspection, dispatch acknowledgement. | Internal POS, financial records, tenant data (`403 INSUFFICIENT_PERMISSIONS`). |
| **NORMAL_MASTER** (`NORMAL_MASTER`) | **Permanently Decommissioned**. | **None**. | Any authentication or API request fails closed (`403 ROLE_RETIRED`). |

---

## 3. Local Environment Prerequisites & Startup Procedure

### 3.1 Prerequisites
- **Runtime**: Node.js (v18.x or v20.x LTS) with NPM.
- **Database**: MongoDB instance (v6.x or v7.x) running locally or MongoDB Memory Server for test execution.
- **Optional Services**: Redis daemon on port 6379 (if unavailable, system falls back safely to in-memory coordination adapter).
- **Network Isolation**: Execution is strictly local; zero external outbound requests required.

### 3.2 Configuration Verification (`.env`)
Ensure local environment file `Backend/.env` contains valid non-secret operational parameters:
```bash
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://localhost:27017/zamorin_cafe_erp
JWT_SECRET=local_pilot_jwt_signing_secret_do_not_use_in_prod
BACKUP_STORAGE_DIR=./backups
RESTORE_VERIFICATION_MODE=true
```

> [!WARNING]
> Never commit production credentials, live payment gateway tokens, or live GST e-invoice credentials to source control. Probe routines strictly report missing secrets as `BLOCKED_UNCONFIGURED` without leaking data.

### 3.3 Starting the Backend & Frontend Services
```powershell
# 1. From workspace root, verify syntax of all backend modules:
npm --prefix Backend run check

# 2. Verify frontend router imports and page contracts:
node Frontend/verifyRouterImports.mjs

# 3. Start Backend API Server:
cd Backend
node src/server.js

# 4. Start Frontend Static Server (in separate terminal):
cd Frontend
# Serve static assets via local development server
```

### 3.4 Confirming Application Health
Verify endpoints using curl or browser:
```powershell
# Application Liveness Probe
curl http://localhost:5000/health
# Expected: {"status":"UP","timestamp":"..."}

# Core Service Readiness Probe
curl http://localhost:5000/api/health
# Expected: {"status":"HEALTHY","dbConnected":true,"redisMode":"IN_MEMORY_FALLBACK"}
```

---

## 4. Distinguishing Core Application Health from Optional Providers

The ERP cleanly isolates internal core transactions from external third-party service dependencies:

```
+-----------------------------------------------------------------------------------+
|                            CORE APPLICATION ENGINE                                |
|  POS / Billing / 3-Way Match / Inventory Lots / Cash Drawer / Governance Security |
|  STATUS: FULLY FUNCTIONAL (PASS_VERIFIED)                                         |
+-----------------------------------------------------------------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+-------------------------------+   +-----------------------------------------------+
|     HARDWARE ADAPTERS         |   |             EXTERNAL INTEGRATIONS             |
| - ESC/POS Printer Bytecode    |   | - Pine Labs / Razorpay POS Terminals          |
| - Cash Drawer Kick Pulse      |   | - NIC GST E-Invoice / E-Way Bill              |
| - Barcode Scanner Input       |   | - Swiggy / Zomato Aggregator Order Intake     |
| STATUS: PASS_WITH_LIMITATIONS |   | STATUS: BLOCKED_EXTERNAL_DEPENDENCY           |
| (Local bytecode verified;     |   | (Requires live merchant contracts, physical   |
| physical hardware simulated)  |   | devices, or statutory portal credentials)     |
+-------------------------------+   +-----------------------------------------------+
```

When an external provider is not configured:
- Probe response: `{ "operationalHealth": "BLOCKED_UNCONFIGURED", "configured": false, "secretsExposed": 0 }`.
- System behaviour: Fails gracefully with user-friendly notices; **never** fabricates false success or crashes the core application.

---

## 5. Release Test Runner & Quality Assurance Gates

### 5.1 Executing the Curated Release Suite
The release suite runs all 19 mission-critical gate suites covering security, procurement, POS atomicity, cash custody, inventory FEFO, forecasting, BCDR, external scope, and the P22 acceptance pilot:
```powershell
# Run the curated release test suite:
npm --prefix Backend run test:release
```
**Expected Outcome**: 19 out of 19 test files pass with 0 failures.

### 5.2 Executing the Dedicated P22 Acceptance Suite
```powershell
# Run the integrated P22 acceptance pilot test suite:
node --test Backend/test/p22_acceptancePilotOperationalHandover.test.js
```
**Subtest Results**:
1. `Master Data & Procurement: PO Does Not Increase Stock; Only Accepted GRN Posts Stock-In` -> `PASS`
2. `POS Sales & Cash Custody: Decoupled Payment State Machine & Zero Mutation Invariant` -> `PASS`
3. `Inventory & Finance: Expired Stock Excluded from Usable Stock; Integer-Paise Accuracy` -> `PASS`
4. `Forecasting & Scenario Advisory Guard: Strictly Non-Mutating (0 Bills, 0 POs, 0 Stock)` -> `PASS`
5. `System Operations: Protected Field Exclusion & Isolated Backup Restore Guard` -> `PASS`
6. `Security Matrix: Primary Master Universal, Owner Read-Only, Cross-Café & Staff Denied` -> `PASS`
7. `KDS Architectural Exclusion Invariant: Activation Attempts Permanently Rejected with 403` -> `PASS`
8. `Operational Infrastructure Truths: Truthful Classification of Redis & Hardware Peripheral Gates` -> `PASS`

---

## 6. Backup, Cryptographic Verification, and Restore Rehearsals

### 6.1 Creating a Cryptographic Backup
Database backups capture document state and calculate SHA-256 integrity checksums across collections:
```javascript
const { backupRecoveryService } = require('./src/services/backupRecoveryService');

const backup = await backupRecoveryService.createBackup({
  scope: 'FULL_ENTERPRISE',
  actor: { role: 'PRIMARY_MASTER', isPrimaryMaster: true, userId: 'USR-MASTER-01' },
});
// Generates backup archive with SHA-256 hash in backup directory
```

### 6.2 Verifying Backup Checksum Integrity
```javascript
const verification = await backupRecoveryService.verifyBackupIntegrity(backup.backupId);
// Validates that computed SHA-256 matches persisted manifest
```

### 6.3 Isolated Restore Rehearsal Safeguards
To safeguard operational data, restore rehearsal enforces four mandatory security checks:
1. **Primary Master Authorization**: Rehearsal can only be initiated by authenticated Primary Master.
2. **Restore Verification Mode**: Must have `RESTORE_VERIFICATION_MODE=true`.
3. **Explicit Confirmation Token**: Must pass `CONFIRM_ISOLATED_RESTORE_TARGET`.
4. **Production Target Protection**: Any target matching `production`, `zamorin_erp_production`, or `zamorin_prod` is immediately blocked with `403 PRODUCTION_TARGET_PROTECTION`.

```powershell
# Safe Restore Rehearsal Command (Targeting isolated sandbox):
node -e "
const { backupRecoveryService } = require('./Backend/src/services/backupRecoveryService');
backupRecoveryService.executeRestoreRehearsal({
  backupId: 'BKP-20261011-XXXX',
  targetDbName: 'zamorin_isolated_rehearsal_target',
  targetConfirmation: 'CONFIRM_ISOLATED_RESTORE_TARGET',
  restoreVerificationMode: true,
  actor: { isPrimaryMaster: true, role: 'PRIMARY_MASTER', userId: 'USR-MASTER-01' }
}).then(console.log).catch(console.error);
"
```

### 6.4 RPO and RTO Targets (Open Operational Decision)
- **Observed Local Rehearsal Duration**: ~180ms – 250ms for baseline data.
- **Business Target RPO / RTO**: Remain an outstanding operational decision pending executive stakeholder determination for multi-outlet live scale. Local benchmarks demonstrate sub-second recovery for local pilot databases.

---

## 7. Background Jobs, Notification Outbox & Troubleshooting

### 7.1 Notification Outbox Health
The notification system decouples email/SMS generation from live dispatch:
- Unsent or failed notifications remain stored in `notifications` with `status: 'PENDING'` or `'FAILED'`.
- Run outbox inspection:
```javascript
const { Notification } = require('./src/models/Notification');
const pending = await Notification.countDocuments({ status: { $in: ['PENDING', 'FAILED'] } });
console.log(`Pending/Failed Notifications: ${pending}`);
```

### 7.2 Distributed Job Coordination & Stale Lock Reclamation
- Jobs acquire atomic leases using `DistributedLock` schema.
- Stale locks older than 5 minutes expire automatically without manual intervention.

### 7.3 Multi-Outlet Copy Protection (F193 Guard)
When copying settings between cafés (e.g. from Flagship to Beach Outpost):
- **Mandatory Excluded Fields**: `gstin`, `pan`, `paymentGatewayCredentials`, `premisesAddress`, `sequenceCounters`.
- These fields are stripped by `controlledDataMigrationService.previewOutletCopySettings` and cannot be overwritten across café boundaries.

---

## 8. Incident Response, Preserving Audit Trails & Escalation

### 8.1 Audit Log Integrity
All sensitive operations (role changes, bank account modifications, price adjustments, CAPEX decisions, backups, and restores) write immutable audit records to `AuditLog`. Audit records cannot be altered or deleted.

### 8.2 Escalation Tree
```
Level 1: Floor Supervisor / Barista
  │  (POS checkout, cash drawer reconciliation, local bill reprinting)
  ▼
Level 2: Café Operations Admin (CAFE_ADMIN)
  │  (Supplier GRN receipt, partial receipt dispute, employee shift approvals)
  ▼
Level 3: Executive Estate Owner (OWNER)
  │  (Financial analytics, CAPEX request review, scenario advisory)
  ▼
Level 4: Chief Enterprise Architect (PRIMARY_MASTER)
  │  (Tenant provisioning, database backups, restore rehearsal, system configuration)
```

---

## 9. Final Acceptance Matrix & Traceability Disposition

| Business Domain | Core Invariant Verified | Execution Result | Evidence Reference | Outstanding Prerequisites |
| :--- | :--- | :--- | :--- | :--- |
| **Master Data & Procurement** | PO alone does NOT increase stock; only accepted GRN creates stock; AP 3-way match split enforced. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 1) | None for local pilot. |
| **POS Sales & Payments** | Decoupled payment terminal state; initiated payment never marks bill paid; drawer kick zero ledger mutation. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 2) | Physical payment terminal requires merchant contract. |
| **Inventory & Finance** | Expired stock excluded from usable lot queries; integer-paise financial precision; customer loyalty ledger. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 3) | None. |
| **Forecasting & Scenarios** | Advisory forecasting strictly creates 0 bills, 0 purchase orders, and 0 stock movements. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 4) | None. |
| **Governance & BCDR** | F193 protected settings excluded from outlet copy; SHA-256 backup checksum; restore rehearsal safety guard. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 5) | RTO/RPO approved targets pending executive decision. |
| **Security & Personas** | Universal Primary Master; Owner read-only 403; Café Admin cross-café 403; Staff 403; Retired Master 403. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 6) | None. |
| **KDS Freeze** | KDS records F275–F292 activation attempts permanently fail closed with 403. | `PASS_VERIFIED` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 7) | Architectural exclusion is permanent. |
| **Local Hardware Peripherals** | ESC/POS bytecode, pulse buffers, scanner format validation verified via adapters. | `PASS_WITH_LIMITATIONS` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 8) | Physical printer/scanner USB hardware attachment. |
| **Distributed Redis Cluster** | In-memory Redis protocol test-double active; local single-node fallback functional. | `BLOCKED_EXTERNAL_DEPENDENCY` | Port 6379 probe confirms no live external Redis daemon. | Local/cloud Redis daemon installation for clustering. |
| **Government GST E-Invoice** | Provider probe confirms unconfigured state without exposing credentials. | `BLOCKED_EXTERNAL_DEPENDENCY` | `test/p22_acceptancePilotOperationalHandover.test.js` (Subtest 8) | Production NIC / IRP credentials & GSP agreement. |

---

## 10. Operational Handover Sign-Off Recommendation

- **Disposition**: `ACCEPTED_FOR_LOCAL_PILOT`
- **Conditions**:
  1. Live production deployment is **strictly withheld** until official Redis daemon, live payment gateway acquiring agreements, and NIC GST e-invoicing credentials are provisioned.
  2. Physical hardware peripherals (receipt printers, barcode scanners, payment terminals) operate under software adapter verification; physical device sign-off requires attached hardware.
  3. Formal business sign-off remains reserved for the authorized human estate owner and executive leadership.
