# Relay Client edition

Independent edition aligned to the final field-sales/KYC/incentives proposal. The original full Relay source, deployment and Android package remain intact. Scope authority and boundaries: [../docs/SCOPE.md](../docs/SCOPE.md).

Admin scope and controls: [audit matrix](docs/ADMIN-CONTROL-AUDIT.md).

Latest proposal release and verification: [docs/FINAL-PROPOSAL-RELEASE.md](docs/FINAL-PROPOSAL-RELEASE.md).

Web: https://relay-client.187-127-162-233.sslip.io/

Android: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk

## Proposal features

| Proposal area | Relay Client implementation |
| --- | --- |
| Web management portal | Live operations, scoped team/outlet/customer and historical order views, sales targets, inventory allocation, reports, compliance and audit |
| Incentives | Manual records, validated CSV/XLSX upload, tracking and CSV export |
| Flutter field app | Targets, tasks, customer search, inventory and own-SIM return/damage reporting, daily report, support, shift and sync |
| Staged Etisalat KYC | External stages guide, screenshot capture, VPS OCR, multiple editable line rows, Excel/image handoff, authorized backend review, synchronized result |
| Supporting foundation | Auth/RBAC, PostgreSQL, audit, HTTPS hosting, encrypted capture storage, offline draft retry, live web events |

Only synthetic records are seeded. The external Etisalat workflow is guidance until access and integration specifications are supplied. OCR is operational for transaction screenshots, while Emirates ID authenticity, face match and liveness are not certified services. Location and geofencing are excluded: no device permission or collection endpoint is enabled. Teams and outlet assignments are organized by branch.

## Setup

Python 3.12+, Node 22+, Flutter 3.41+/Dart 3.11+, PostgreSQL 17.

Backend: install `backend/requirements.txt`, set environment variables from `.env.example`, then from `backend` run `python -m alembic upgrade head`, `python -m app.seed`, `python -m app.proposal_seed`, and `python -m uvicorn app.main:app --port 8001`.

Web: from `web`, run `npm ci` and `npm run dev` (port 5174 proxies API 8001). Build with `npm run build`.

Mobile: from `mobile`, run `flutter pub get`, then `flutter run --dart-define=API_URL=https://relay-client.187-127-162-233.sslip.io/api`.

Tests: backend `python -m pytest`; web set `DEMO_PASSWORD` and optionally `RELAY_WEB_URL`, then `npm test`; mobile `flutter analyze`, `flutter test`. Device integration uses `test_driver/integration_test.dart` and `integration_test/client_scope_test.dart`, with API_URL and TEST_PASSWORD supplied using a private dart-define file.

## Isolation and architecture

React/TypeScript web and Flutter use one FastAPI backend. PostgreSQL stores normalized demo records, audit events and sessions. `backend/app/client_scope.py` defines the edition API allowlist and report boundaries; omitted routes are not registered or exposed in OpenAPI. Existing underlying domain models support seeded historical records. Role scopes remain enforced in the backend.

API contract: `/docs` and `/openapi.json` on the backend service. Public API endpoints are under `/api`.

VPS: `/opt/relay-client`, Compose project `relay-client`, private Postgres volume/network, loopback API port 8119, separate Nginx site and TLS certificate. The full edition remains `/opt/relay-demo` on port 8118.

Deployment configuration lives in `deploy/`. `bootstrap.sh` is first-install only and refuses to overwrite an existing Nginx site. Never run it against the full edition. Secrets and local device defines belong in `output/private/` and must not be published.

## Demo accounts

All accounts use the demo password requested by the owner; see `output/private/credentials.md` for the private handoff. Accounts: admin, ops, leader, leader2, cluster, compliance, inventory, agent1 through agent12, each at `@relay.demo`. Use agent1 on mobile.

The downloadable APK uses the demo signing key. Production distribution requires managed release signing, real provider integrations and an independent security/privacy review.

## Development configuration

For a quick local run, the backend defaults to SQLite (`relay.db`). Set `DEMO_PASSWORD` to a private local test password and `WEB_ORIGIN=http://localhost:5174` before migration/seeding. Install Tesseract with English and Arabic languages for real OCR; set `TESSERACT_BIN` if the executable is not on PATH. The backend does not automatically read `.env`; export the variables in your shell or use Docker Compose's env file.

For PostgreSQL, set `DATABASE_URL` from the environment example and run all Alembic migrations. Revision 005 migrates existing clusters into explicit branches without dropping users, outlets or audit records. The old `cluster@relay.demo` login is retained for compatibility and now has the Branch Manager role.

Web fonts are self-hosted under `web/public/fonts`; the same licensed DM Sans and Manrope assets are bundled in Flutter. UI colour/typography tokens are in `web/src/premium.css` and Flutter theme/widgets.

Run browser tests against a local or hosted API: set `DEMO_PASSWORD`, optionally `RELAY_WEB_URL`, then `npx playwright install chromium` and `npm test`. Synthetic fixtures are included in `web/tests/fixtures`. Tests write screenshots to ignored `output/qa`.

Generated APKs, data, keys and test output are excluded from Git. This repository holds the proposal edition only; the earlier full Relay demonstration is not required to run it.
