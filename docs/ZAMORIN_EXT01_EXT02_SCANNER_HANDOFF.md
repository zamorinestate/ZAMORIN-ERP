# ZAMORIN CAFÉ ERP — EXT-01R TO EXT-02 MALWARE SCANNER HANDOFF

**Handoff From:** EXT-01R (Cloudflare R2 Object Storage Architecture)
**Handoff To:** EXT-02 (Live Anti-Malware / AV Service Integration)
**Status:** ARCHITECTURE READY FOR LIVE SCANNER ATTACHMENT
**Audit Date:** 2026-09-17

---

## 1. Storage Architecture Interface for EXT-02

The Cloudflare R2 storage architecture provides a pre-scan isolation mechanism designed to connect to the EXT-02 live Anti-Malware scanning service.

### 1.1 Quarantine Prefix & Path
- **Prefix:** `quarantine/`
- **Format:** `quarantine/<organisationId>/<cafeId>/<documentId>-<randomHex6>.<extension>`
- **Isolation Guarantee:** Quarantined objects reside solely in the quarantine prefix. They are never directly accessible to standard users and cannot be resolved by standard download routes.

### 1.2 Status Fields & Finite State Machine
In [`backend/src/models/BusinessDocument.js`](file:///d:/Zamorin_Cafe_ERP_Build/15_INTEGRATION_WORKSPACE/backend/src/models/BusinessDocument.js):
- `uploadStatus`: `INITIATED` -> `SCANNING` -> `AVAILABLE` (or `MALWARE_REJECTED`, `SCAN_FAILED`)
- `securityScanStatus`: `PENDING_SCAN` -> `CLEAN` (or `REJECTED`, `SCAN_FAILED`)
- `scanStatus`: `PENDING` -> `CLEAN` (or `INFECTED`, `SCAN_ERROR`)

### 1.3 Scanner Input Mechanism
The EXT-02 scanner service reads the quarantined binary stream from Cloudflare R2 via:
```javascript
const stream = await documentStorageAdapter.getStream({ storageKey: doc.quarantineObjectKey });
```
Zero temporary local container disk writes are required; streaming scan is fully supported.

### 1.4 State Transitions

```text
               ┌───────────────────────┐
               │   Upload Completed    │
               │ status: PENDING_SCAN  │
               └──────────┬────────────┘
                          │
                          ▼
               ┌───────────────────────┐
               │    EXT-02 AV Scan     │
               └────┬──────────────┬───┘
                    │              │
           CLEAN    │              │   INFECTED / MALWARE
                    ▼              ▼
     ┌──────────────────────┐    ┌────────────────────────┐
     │ 1. Copy to Canonical │    │ 1. Delete Quarantine   │
     │ 2. Delete Quarantine │    │ 2. uploadStatus:       │
     │ 3. uploadStatus:     │    │    MALWARE_REJECTED    │
     │    AVAILABLE         │    │ 3. securityScanStatus: │
     │ 4. securityScanStatus│    │    REJECTED            │
     │    CLEAN             │    │ 4. Log Security Event  │
     └──────────────────────┘    └────────────────────────┘
```

### 1.5 Scanner Outage / Retry Behavior
- If the EXT-02 scanner times out or fails, status transitions to `SCAN_FAILED` / `SCAN_ERROR`.
- Quarantined binary remains intact in the `quarantine/` prefix for retry.
- Standard users attempting download receive HTTP 423 `SCAN_FAILED` (fail-closed).
- No unscanned file is ever promoted to `AVAILABLE` or made downloadable.
