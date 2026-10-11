# ZAMORIN CAFÉ ERP — EXT-01R STORAGE SECURITY MATRIX
## Cloudflare R2 Storage Security & Access Control Matrix

**Gate Identifier:** EXT-01R
**Classification:** Security Architecture & Access Control Specification
**Effective Date:** 2026-09-17

---

## 1. Cloudflare R2 Perimeter & Access Control Matrix

| Security Dimension | Specification | Implementation in Cloudflare R2 | Enforcement Point |
| :--- | :--- | :--- | :--- |
| **Anonymous Access** | **DENIED** | Public `r2.dev` access **DISABLED**; no anonymous read/list | Cloudflare R2 Bucket Config |
| **Public Custom Domain** | **DISABLED** | No custom domain attached; direct web access blocked | Cloudflare R2 Bucket Config |
| **Bucket Policy** | **Private by Default** | Only authenticated API token requests or presigned URLs accepted | Cloudflare R2 Bucket Config |
| **API Token Scope** | **Least Privilege** | Dedicated token with `Object Read & Write` scoped strictly to `zamorin-production-documents` | Cloudflare API Tokens |
| **Admin / Global Token** | **PROHIBITED** | Cloudflare Global API Key or Account Admin tokens strictly forbidden | Cloudflare IAM Governance |
| **CORS Policy** | **Strict Origin** | Restricted exclusively to canonical Vercel production origin (`https://estate-erp.vercel.app`); **NO `*`** | Cloudflare R2 CORS Config |
| **Data Location** | **APAC Hint** | Location hint set to `APAC` (Asia-Pacific best-effort placement; no exact Mumbai claim) | Cloudflare R2 Bucket Config |
| **Transport Security** | **TLS 1.2+** | HTTPS strictly enforced on S3 endpoint and presigned URLs | Cloudflare Perimeter |
| **Encryption at Rest** | **AES-256** | All R2 objects automatically encrypted at rest using provider-managed AES-256 | Cloudflare R2 Core |

---

## 2. Cloudflare R2 Bucket Lock Strategy

Cloudflare R2 Bucket Lock provides WORM (Write Once, Read Many) protection against object deletion or overwriting during an active retention period:

### 2.1 Policy Scope
- **DO NOT lock the entire bucket globally:** Quarantined objects (`quarantine/`) and temporary artifacts must remain deletable upon scanner rejection or expiration.
- **Prefix-Based Retention Lock:** Apply bucket lock rules specifically to statutory/evidentiary prefixes:
  - `*/procurement/*` -> Lock duration: 72 months (statutory Section 36 CGST)
  - `*/compliance/*` -> Lock duration: 72 months
  - `*/financial/*` -> Lock duration: 96 months (statutory 8 years)
- **Quarantine Exemption:** `quarantine/*` prefix remains unlocked to permit safe deletion of rejected or malware-infected files.

---

## 3. Server-Side Role-Based Authorization Matrix

All file access is evaluated dynamically by `DocumentAttachmentService.assertDocumentAuthorization` before generating a presigned GET grant or streaming binary content:

| Role | Procurement Attachments | Financial / Banking Records | HR Confidential | General Attachments | Permanent Deletion |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **MASTER (Primary/Normal)** | ALLOW (Global) | ALLOW (Global) | ALLOW (Global) | ALLOW (Global) | **ALLOW** (Subject to retention & holds) |
| **OWNER** | ALLOW (Global) | ALLOW (Global) | ALLOW (Global) | ALLOW (Global) | **DENY** (Master authority required) |
| **REGIONAL_MANAGER** | ALLOW (Assigned Cafés) | ALLOW (Assigned Cafés) | DENY | ALLOW (Assigned Cafés) | **DENY** |
| **CAFE_ADMIN** | ALLOW (Assigned Café) | DENY | DENY | ALLOW (Assigned Café) | **DENY** |
| **STAFF** | **DENY** (403) | **DENY** (403) | Self-only (`HR_SELF`) | Assigned Café only | **DENY** |
| **ANONYMOUS** | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) | **DENY** (401) |

---

## 4. Cryptographic Checksum & Quarantine Gate

- **Cryptographic SHA-256:** Computed during streaming and verified during `/finalize`. Immutable `sha256` stored in `BusinessDocument`.
- **Presigned URL Expiry:** Presigned upload PUT URLs expire in 300 seconds; presigned download GET URLs expire in 180 seconds.
- **Scan Gate:** Files in `PENDING_SCAN` or `INFECTED` are blocked from normal user retrieval (returning HTTP 423 or 403).
