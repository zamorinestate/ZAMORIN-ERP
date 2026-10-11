# ZAMORIN CAFÉ ERP — EXT-01R TO EXT-04 DOCUMENT RESTORE HANDOFF
## Cloudflare R2 Restore Model & Disaster Recovery Specification

**Handoff From:** EXT-01R (Cloudflare R2 Object Storage Architecture)
**Handoff To:** EXT-04 (Document Restore & Disaster Recovery Certification)
**Status:** RESTORE CAPABILITIES ARCHITECTED (IMMUTABLE KEY LEDGER MODEL)
**Audit Date:** 2026-09-17

---

## 1. R2 Versioning Clarification & Restore Model

Because Cloudflare R2 does **not** implement native AWS S3 bucket versioning APIs (`GetBucketVersioning`, `ListObjectVersions`, delete markers), EXT-04 document restoration relies on Zamorin's application-level immutable ledger architecture.

### 1.1 Application-Level Immutable Revisions
1. **No In-Place Overwrite:** When an approved business document is replaced or updated with a new revision, the previous object is **never overwritten**.
2. **Unique Opaque Object Keys:** Each revision receives a newly generated opaque object key:
   - Revision 1: `<org>/<cafe>/<classification>/<documentId>_v1-<hex1>.<ext>` -> Object A preserved
   - Revision 2: `<org>/<cafe>/<classification>/<documentId>_v2-<hex2>.<ext>` -> Object B created
3. **MongoDB Version Ledger:** `BusinessDocument.versions[]` stores historical records including previous `version`, `originalFilename`, `storageObjectKey`, `sha256`, `sizeBytes`, `mimeType`, and `uploadedAt`.
4. **Historical Revision Recovery:** Authorised historical/audit users can retrieve prior revisions directly by resolving the historical `storageObjectKey` from `versions[]`.

### 1.2 Soft Delete vs. Permanent Destruction
- **Soft Delete:** Sets `isDeleted: true` and `documentStatus: 'ARCHIVED'`. The underlying R2 object is preserved untouched. Restorable via `POST /api/v1/documents/:id/restore` by MASTER or OWNER.
- **Permanent Destruction:** Strictly restricted to `MASTER` role and blocked during statutory retention (72 months for GST records) or active legal holds.

---

## 2. Cloudflare R2 Backup Strategy for EXT-04

To safeguard document binaries against regional disruption or storage account failure, the following backup specification is certified for EXT-04:

| Parameter | Specification |
| :--- | :--- |
| **Primary Object Store** | Cloudflare R2 (`zamorin-production-documents`) |
| **Secondary Backup Store** | Cloudflare R2 separate backup bucket (`zamorin-backup-documents`) or cold cloud archive |
| **Backup Frequency** | Daily scheduled automated replication / sync |
| **Retention Period** | Aligned with statutory 72 months (CGST Section 36) |
| **Encryption** | Provider-managed AES-256 at rest; TLS 1.2+ in transit |
| **Manifest Format** | Canonical JSON manifest export (`documentId`, `storageObjectKey`, `sha256`, `sizeBytes`, `timestamp`) |
| **Restore Procedure** | Rehydrate missing R2 binaries from secondary backup bucket matching manifest checksums |
| **Integrity Validation** | SHA-256 cryptographic checksum matching against MongoDB `BusinessDocument.sha256` |
| **RPO Target (Recovery Point Objective)** | **<= 24 hours** (Daily replication) |
| **RTO Target (Recovery Time Objective)** | **<= 2 hours** (Bucket rehydration drill) |
