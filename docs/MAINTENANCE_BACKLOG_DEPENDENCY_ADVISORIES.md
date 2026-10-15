# Zamorin Café ERP — Maintenance Backlog: Dependency Advisories

**Recorded Date:** 2026-10-15  
**Accepted Baseline Commit:** `cee71c069413ac4dcdb5f70a4b7ff341c7d0d666`  
**Tracking Source:** `npm run audit:deps` (`scripts/audit_dependencies.mjs` executing against `Backend/package.json`)  
**Status:** Queued for separate risk-based investigation. Pre-existing third-party dependency items; isolated from UI/UX and dead-code refactoring streams.

---

## 1. Inventory of Identified Dependency Advisories

The repository dependency scan identified three pre-existing vulnerabilities in backend dependencies:

| Package | Severity | Affected Version Range | Direct / Transitive | Context / Risk Assessment | Recommended Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`proxy-addr`** | **Critical** | `1.1.0 - 2.0.7` | Transitive (via `express`) | IP parsing and CIDR evaluation risk when parsing client IPs behind reverse proxies. | Investigate Express 4.x / 5.x upgrade path or selective override via `npm overrides` in dedicated dependency update cycle. |
| **`multer`** | **Moderate** | `2.2.0 - 2.3.0` | Direct dependency | Multipart form-data parser DoS / boundary parsing advisory. | Review upload routes in `Backend/src/routes/` and update to patched `multer` version during dedicated backend maintenance. |
| **`ip-address`** | **Moderate** | `<=10.7.0` | Direct / Transitive | IPv6/IPv4 address parsing validation advisory. | Review usage in `clientIp.js` and update to `>=10.7.1` during dedicated backend maintenance. |

---

## 2. Policy & Operational Constraints

1. **Zero Modification During UI/UX Phase:** In accordance with the mandate, dependencies must not be touched or upgraded during UI/UX and frontend refinement tasks.
2. **Dedicated Investigation:** A separate security maintenance task must perform integration testing before any dependency version bump to ensure no breakage occurs in authentication middleware or multi-tenant IP filtering.

---

## 3. Operational & Hardware Environment Limitation

- **Thermal Receipt-Printer USB Handshake:** Physical 58mm/80mm ESC/POS hardware print execution requires an active physical USB/serial interface. In automated CI/CD and remote headless audit environments, printer commands and byte compilation are verified via virtual print adapters and unit test suites (`ext13RealPrinterAcceptance.test.js`, `ReceiptPrinterAdapter.js`), while physical paper feed and hardware cut handshakes remain subject to on-site cafe till verification.

