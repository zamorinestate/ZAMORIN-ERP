# ZAMORIN CAFÉ ERP — EXT-01R STORAGE ENVIRONMENT MATRIX
## Cloudflare R2 Environment & Configuration Specification

**Gate Identifier:** EXT-01R
**Classification:** Environment Specification & Secret Storage Standard
**Audit Date:** 2026-09-17

---

## 1. Sanitized Environment Variable Register

The following configuration variables configure `DocumentStorageAdapter` and `S3CompatibleStorageAdapter` for Cloudflare R2. **No real secret values are recorded in this document.**

> **Note on Variable Naming:**
> The variable names retain standard AWS S3-compatible names (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`) because Cloudflare R2 uses the official S3 API protocol. Retaining these names avoids cosmetic breaking changes and migration risk.

| Environment Variable | Canonical Value / Pattern | Secret? | Production Required? | Staging / Prod Distinct? |
| :--- | :--- | :---: | :---: | :---: |
| `DOCUMENT_STORAGE_PROVIDER` | `s3` | No | **YES** | Identical |
| `S3_BUCKET` | `zamorin-production-documents` | No | **YES** | **MANDATORY DISTINCT** (`zamorin-staging-documents` vs `zamorin-production-documents`) |
| `AWS_REGION` | `auto` | No | **YES** | Identical (`auto` is R2 standard) |
| `S3_ENDPOINT` | `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` | No | **YES** | Same account endpoint |
| `AWS_ACCESS_KEY_ID` | Dedicated R2 Token Access Key ID | **YES** | **YES** | **MANDATORY DISTINCT** |
| `AWS_SECRET_ACCESS_KEY` | Dedicated R2 Token Secret Access Key | **YES** | **YES** | **MANDATORY DISTINCT** |
| `DOCUMENT_STORAGE_MAX_BYTES` | `15728640` (15 MB) | No | Optional (Defaults to 15MB) | Identical |
| `DOCUMENT_STORAGE_SIGNED_URL_TTL` | `180` (seconds) | No | Optional (Defaults to 180s) | Identical |

---

## 2. Environment Isolation & Separation Invariants

1. **Bucket Separation:**
   - **Staging Bucket:** `zamorin-staging-documents`
   - **Production Bucket:** `zamorin-production-documents`
   - Staging test operations must never write objects to or read objects from the production bucket.
2. **Token Separation:**
   - The Staging R2 API token must be restricted strictly to `zamorin-staging-documents`.
   - The Production R2 API token must be restricted strictly to `zamorin-production-documents`.
3. **Secret Storage Location:**
   - Storage credentials belong **strictly in the Render Dashboard** under Environment Variables (marked Secret).
   - Zero credentials in Git, frontend code, HTML, MongoDB, or logs.
