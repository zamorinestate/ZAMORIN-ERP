# ZAMORIN CAFÉ ERP — EXT-01R PRODUCTION OBJECT STORAGE AUDIT
## Cloudflare R2 Live Object Storage Provider Finalization

**Gate Identifier:** EXT-01R (Live Production Object Storage Configuration, Security & Acceptance)
**Governance Framework:** OWASP ASVS 5.0 / Statutory Record Retention (CGST Section 36) / Cloudflare R2 S3-Compatible Architecture
**Audit Date:** 2026-09-17
**Audited By:** Senior Cloud Infrastructure Architect, Storage Security Lead & DevOps Engineer

---

## 1. Authoritative Architecture Baseline

The enterprise production infrastructure architecture for Zamorin Café ERP is certified as:

```text
  ┌─────────────────────────────────────────────────────────────┐
  │                    Vercel Edge Platform                     │
  │                  (Frontend Web Application)                 │
  └──────────────────────────────┬──────────────────────────────┘
                                 │ HTTPS
                                 ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    Render Cloud Platform                    │
  │             (Node.js / Express Backend REST API)            │
  └──────────────┬───────────────────────────────┬──────────────┘
                 │ TLS                           │ S3 API over TLS
                 ▼                               ▼
  ┌─────────────────────────────┐ ┌─────────────────────────────┐
  │        MongoDB Atlas        │ │        Cloudflare R2        │
  │  (Authoritative ERP Records │ │ (Private Binary Documents:  │
  │  & Document Metadata Ledger)│ │  Invoices, Receipts, POs,   │
  │                             │ │  Challans, Evidence, PDFs)  │
  └─────────────────────────────┘ └─────────────────────────────┘
```

### Invariants:
1. **MongoDB Atlas** remains the **ONLY** business/ERP database (orders, POS, ledger, inventory, audit logs, and document metadata).
2. **Cloudflare R2** is strictly dedicated to storing raw document binaries (supplier invoices, purchase orders, delivery challans, quotations, credit notes, employee documents, expense evidence, compliance files, maintenance records, and generated PDF reports).
3. No business data is migrated from MongoDB to Cloudflare. No second database (PostgreSQL, Prisma, Firebase) is introduced.
4. REC-19 / REC-19A remains frozen.
5. EXT-01 remains **BLOCKED** until the live, business-owned R2 bucket is provisioned, credentials are tied into Render, and live smoke-tested.

---

## 2. Storage Abstraction & Provider Decision

- **Document Storage Provider:** `CLOUDFLARE_R2`
- **Classification:** `EXISTING_S3_COMPATIBLE_ADAPTER_REUSED`
- **Codebase Reuse:** Zero duplicate abstraction created. Reuses `DocumentStorageAdapter` -> `S3CompatibleStorageAdapter` connected to Cloudflare R2's S3-compatible API endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

| Area | Implementation | Repository Evidence | Production Ready? |
| :--- | :--- | :--- | :--- |
| **Storage Abstraction** | `DocumentStorageAdapter` facade delegating to provider factory | [`backend/src/services/documentStorageAdapter.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/services/documentStorageAdapter.js) | **YES** |
| **S3 / R2 Adapter** | `S3CompatibleStorageAdapter` with `region: "auto"`, R2 path-style endpoint support, streams, and HMAC presigned grants | [`backend/src/services/storage/S3CompatibleStorageAdapter.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/services/storage/S3CompatibleStorageAdapter.js) | **YES** |
| **BusinessDocument Model** | Authoritative metadata ledger tracking immutable revision history in `versions[]` array | [`backend/src/models/BusinessDocument.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/models/BusinessDocument.js) | **YES** |
| **Upload Flow** | 2-phase direct-to-R2 upload: intent presigned PUT (`/upload-intent`) -> R2 direct upload -> finalize (`/finalize`) | [`backend/src/routes/documentRoutes.js:L189-228`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/routes/documentRoutes.js) | **YES** |
| **Download / Preview Flow** | Post-authorization presigned GET grant (`/:id/download-grant`, 180s TTL) & backend stream fallback (`/:id/download`) | [`backend/src/routes/documentRoutes.js:L266-358`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/routes/documentRoutes.js) | **YES** |
| **Object Key Structure** | Opaque tenant-isolated keys: `<org>/<cafe>/<classification>/<documentId>/<revisionId>-<randomHex>.<ext>` | [`backend/src/services/documentStorageAdapter.js:L142-155`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/services/documentStorageAdapter.js) | **YES** |
| **Quarantine Isolation** | `quarantine/<org>/<cafe>/<documentId>-<randomHex>.<ext>` staging; `PENDING_SCAN` enforced | [`backend/src/services/documentAttachmentService.js:L450-464`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/services/documentAttachmentService.js) | **YES** |
| **Document Retention** | Statutory 72-month CGST Section 36 retention, active legal/appeal holds; Master-only permanent deletion | [`backend/src/services/retentionPolicyService.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/services/retentionPolicyService.js) | **YES** |
| **Cloudflare R2 Bucket Resource** | Live `zamorin-production-documents` bucket under Zamorin Cloudflare account | External Cloud Console | **PENDING (BLOCKED_REC12)** |

---

## 3. Critical R2 Versioning Correction

Cloudflare R2 does **not** currently implement AWS S3 bucket-versioning APIs (`GetBucketVersioning`, `PutBucketVersioning`, `ListObjectVersions`, or delete markers).

### Application Invariant: Immutable Revision Model
1. **No S3-Style Native Versioning Claims:** The application does **not** rely on S3 bucket versioning APIs.
2. **Immutable Object Key per Revision:** When a document revision/replacement is uploaded (`replaceVersion`), a **NEW** opaque object key is created:
   - Revision 1: `<org>/<cafe>/<class>/<documentId>_v1-<rand1>.<ext>` (Object A remains untouched)
   - Revision 2: `<org>/<cafe>/<class>/<documentId>_v2-<rand2>.<ext>` (Object B created)
3. **MongoDB Version Ledger:** `BusinessDocument.versions[]` stores historical records including previous `storageObjectKey`, `sha256`, `sizeBytes`, `mimeType`, and `uploadedAt`.
4. **Zero Overwrite:** An approved document binary is **never overwritten**.
5. **Soft Deletion:** Deletion marks `isDeleted: true` and `documentStatus: 'ARCHIVED'` in MongoDB without destroying the physical object until legal and statutory retention requirements have lapsed.

---

## 4. Multi-Instance Stateless Backend Compatibility

By utilizing Cloudflare R2 as the authoritative document binary store:
- Render backend instances operate completely statelessly.
- Any horizontally scaled container instance accesses R2 concurrently using scoped credentials over TLS.
- Dependency on Render's ephemeral container disk (`/var/data/zamorin_documents`) is eliminated for document authority.
