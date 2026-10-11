# ZAMORIN CAFÉ ERP — EXT-01R STORAGE ACCEPTANCE EVIDENCE
## Automated Testing, Integrity Validation & Acceptance Log

**Gate Identifier:** EXT-01R
**Classification:** Test Execution Log & Acceptance Certification
**Audit Date:** 2026-09-17

---

## 1. Automated Test Suite Execution Evidence

All document storage durability, security, and runtime suites executed with zero failures:

### Suite 1: Document Storage Durability & Production Lifecycle
- **File:** [`backend/test/documentStorageDurability.test.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/test/documentStorageDurability.test.js)
- **Results:** 14 passed / 0 failed (duration: 131.5ms)
- **Key Verifications:**
  - `✔ Permanent save writes binary under persistent storage root`
  - `✔ Server restart recovery: New adapter instance recovers previously saved document`
  - `✔ Checksum preservation across full upload-stream-persist lifecycle`
  - `✔ Missing storage fail-safe: Production fails if storage root/credentials absent`
  - `✔ Ephemeral storage disallowed in production if path is inside application directory`
  - `✔ Concurrency: 10 concurrent writes complete without race conditions or key collisions`
  - `✔ Health check probe confirms read/write readiness`

### Suite 2: REC-06 Universal Durable Private Document Storage & Security
- **File:** [`backend/test/rec06DocumentStorageSecurity.test.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/test/rec06DocumentStorageSecurity.test.js)
- **Results:** 40 passed / 0 failed (duration: 4175.9ms)
- **Key Verifications:**
  - `✔ Canonical DocumentStorageProvider abstraction defines all required operations`
  - `✔ Production configuration rejects local/ephemeral canonical storage (fail-closed)`
  - `✔ Private object storage generates non-public keys and grants without public static exposure`
  - `✔ Generated object keys are opaque, tenant-partitioned, and expose zero PII/GSTIN/emails`
  - `✔ Directory traversal, double extensions, and disguised executables strictly rejected`
  - `✔ File signature verified via magic-byte validation (%PDF, PNG, JPEG)`
  - `✔ Cryptographic SHA-256 checksum computed and verified`
  - `✔ Initial upload intent creates record in INITIATED with quarantineKey`
  - `✔ Finalization promotes quarantined clean file to AVAILABLE in durable storage`
  - `✔ Infected EICAR file rejected with MALWARE_REJECTED and never made AVAILABLE`
  - `✔ Cross-café and cross-organisation download attempts strictly denied (403)`
  - `✔ Authorized download grant is short-lived and expires in seconds (180s)`
  - `✔ MongoDB BusinessDocument record stores objectKey but NEVER permanent signed URLs`
  - `✔ Version replacement creates new version object without mutating Version 1`
  - `✔ Old Version 1 object binary remains accessible on storage provider`
  - `✔ Soft delete marks document as ARCHIVED and DELETED with audit reason`
  - `✔ Statutory 72-month GST retention & active legal holds block permanent deletion`
  - `✔ Storage outage during upload fails safely without corrupting database state`

### Suite 3: REC-06A Production Malware Scanner & Storage Runtime Certification
- **File:** [`backend/test/rec06aProductionMalwareAndStorageRuntime.test.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/test/rec06aProductionMalwareAndStorageRuntime.test.js)
- **Results:** 14 passed / 0 failed (duration: 38.5ms)
- **Key Verifications:**
  - `✔ Production mode without configured malware provider fails closed`
  - `✔ Test/mock scanner strictly prohibited in production (fail closed)`
  - `✔ Download/preview strictly denied while scan is PENDING, QUARANTINED, or INFECTED`
  - `✔ Production-capable S3-compatible storage adapter operates correctly`

---

## 2. Frontend Source & Bundle Secret Scan

- **Target:** `frontend/src/` and `frontend/dist/`
- **Results:**
  - `AWS_SECRET_ACCESS_KEY` / `STORAGE_SECRET_KEY`: **0 matches**
  - `AWS_ACCESS_KEY_ID` / `STORAGE_ACCESS_KEY`: **0 matches**
  - `CLOUDINARY_API_SECRET`: **0 matches**
  - `mongodb+srv` / `mongodb://`: **0 matches**
  - **Verdict:** **PASS (Zero secret leakage)**

---

## 3. Live Production Smoke Testing Status

- **Status:** **`BLOCKED_REC12`**
- **Pending Actions:** Awaiting human provisioning of the Cloudflare R2 bucket (`zamorin-production-documents`) and configuration of R2 credentials in Render to execute live smoke uploads (`EXT01-test-clean.pdf`, `EXT01-test-small.jpg`, `EXT01-test-text.txt`).
