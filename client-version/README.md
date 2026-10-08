# Relay Client edition

Independent edition aligned to the final field-sales/KYC/incentives proposal. The original full Relay source, deployment and Android package remain intact. Scope authority and boundaries: [../docs/SCOPE.md](../docs/SCOPE.md).

Admin scope and controls: [audit matrix](docs/ADMIN-CONTROL-AUDIT.md).

Current document alignment: [docs/MODERN-TRADE-STATUS.md](docs/MODERN-TRADE-STATUS.md). Latest release and verification: [docs/DEMO-AND-LAYOUT-UPDATE-2026-10-08.md](docs/DEMO-AND-LAYOUT-UPDATE-2026-10-08.md). Earlier proposal release: [docs/FINAL-PROPOSAL-RELEASE.md](docs/FINAL-PROPOSAL-RELEASE.md).

Web: https://relay-client.187-127-162-233.sslip.io/

Android: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk

## Proposal features

| Proposal area | Relay Client implementation |
| --- | --- |
| Web management portal | Live operations, scoped branches/agents/customers, branch leaders, sales register and targets, stock/assets, call queues, backend verification, notifications, reports and audit |
| Incentives | Historical manual records, validated CSV/XLSX upload and export; new commission/formula calculations remain unconfigured pending client guidance |
| Flutter field app | Customer/order/confirmation capture, drafts, targets, role-scoped sales and stock, notifications, support, daily report and sync |
| Screenshot evidence workflow | External checkout customer screen, order screen and confirmation/request ID, image parsing and predefined fields, independent side-by-side backend review, synchronized sale/stock/call updates and read-only leader notifications |
| Supporting foundation | Auth/RBAC, PostgreSQL, audit, HTTPS hosting, encrypted capture storage, offline draft retry, live web events |

Only synthetic records are seeded. Activation occurs outside Relay on the salesperson's existing device; screenshot evidence is then collected in Relay. No carrier API is required for this workflow. A request ID records the agent's order/payment evidence and does not establish payment method or gateway settlement. Parsing never replaces independent backend review or certifies identity authenticity. Location and geofencing are excluded: no device permission or collection endpoint is enabled. Branches contain agents and a designated leader; leader confirmation notifications are read-only.

## Setup

Python 3.12+, Node 22+, Flutter 3.41+/Dart 3.11+, PostgreSQL 17.

Backend: install `backend/requirements.txt`, set environment variables from `.env.example`, then from `backend` run `python -m alembic upgrade head`, `python -m app.seed`, `python -m app.proposal_seed`, and `python -m uvicorn app.main:app --port 8001`.

Web: from `web`, run `npm ci` and `npm run dev` (port 5174 proxies API 8001). Build with `npm run build`.

Mobile: from `mobile`, run `flutter pub get`, then `flutter run --dart-define=API_URL=https://relay-client.187-127-162-233.sslip.io/api`.

Tests: install `backend/requirements-dev.txt`, then backend `python -m pytest`; web set `DEMO_PASSWORD` and optionally `RELAY_WEB_URL`, then `npm test`; mobile `flutter analyze`, `flutter test`. Device integration uses `test_driver/integration_test.dart` and `integration_test/client_scope_test.dart`, with API_URL and TEST_PASSWORD supplied using a private dart-define file.

## Isolation and architecture

React/TypeScript web and Flutter use one FastAPI backend. PostgreSQL stores normalized demo records, audit events and sessions. `backend/app/client_scope.py` defines the edition API allowlist and report boundaries; omitted routes are not registered or exposed in OpenAPI. Existing underlying domain models support seeded historical records. Role scopes remain enforced in the backend.

API contract: `/docs` and `/openapi.json` on the backend service. Public API endpoints are under `/api`.

VPS: `/opt/relay-client`, Compose project `relay-client`, private Postgres volume/network, loopback API port 8119, separate Nginx site and TLS certificate. The full edition remains `/opt/relay-demo` on port 8118.

Deployment configuration lives in `deploy/`. `bootstrap.sh` is first-install only and refuses to overwrite an existing Nginx site. Never run it against the full edition. Secrets and local device defines belong in `output/private/` and must not be published.

## Demo accounts

All accounts use the demo password requested by the owner; see `output/private/credentials.md` for the private handoff. Accounts: admin, ops, leader, leader2, cluster, compliance, inventory, agent1 through agent12, each at `@relay.demo`. Use agent1 on mobile.

The downloadable APK uses the demo signing key. Production distribution requires managed release signing and an independent security/privacy review.

## Development configuration

For a quick local run, the backend defaults to SQLite (`relay.db`). Set `DEMO_PASSWORD` to a private local test password and `WEB_ORIGIN=http://localhost:5174` before migration/seeding. Install Tesseract with English and Arabic languages for real OCR; set `TESSERACT_BIN` if the executable is not on PATH. The backend does not automatically read `.env`; export the variables in your shell or use Docker Compose's env file.

For PostgreSQL, set `DATABASE_URL` from the environment example and run all Alembic migrations. Revision 005 migrates existing clusters into explicit branches without dropping users, outlets or audit records. The old `cluster@relay.demo` login is retained for compatibility and now has the Branch Manager role.

Web fonts are self-hosted under `web/public/fonts`; the same licensed DM Sans and Manrope assets are bundled in Flutter. UI colour/typography tokens are in `web/src/premium.css` and Flutter theme/widgets.

Run browser tests against a local or hosted API: set `DEMO_PASSWORD`, optionally `RELAY_WEB_URL`, then `npx playwright install chromium` and `npm test`. Synthetic fixtures are included in `web/tests/fixtures`. Tests write screenshots to ignored `output/qa`.

Generated APKs, data, keys and test output are excluded from Git. This repository holds the proposal edition only; the earlier full Relay demonstration is not required to run it.

## Shared interaction design (build 16)

The web colour/motion layer is `web/src/experience.css`; Flutter navigation/motion helpers are in `mobile/lib/experience.dart`. Keep burgundy for primary actions, violet for current navigation, teal for successful states, and amber/red for warnings/errors. Motion lasts 160–240 ms and respects reduced-motion preferences. Avoid perpetual decorative animation.

Web has workspace breadcrumbs, history-aware back navigation, a keyboard-contained mobile menu, click-outside/Escape dismissal, and a skip-to-content link. Flutter direct routes have a safe Home fallback; tab state and search remain intact, and Android Back from a secondary tab returns Home. New journeys use the current customer/order/confirmation flow; historical captures retain their evidence.

Before publishing a UI build, browser tests can preview local `web/dist` files against the hosted demo API using `RELAY_PREVIEW_DIST=1` and `RELAY_WEB_URL` set to the demo host. Set `DEMO_PASSWORD` privately. This preview replaces HTML/assets in the test browser only; it does not deploy files. Clear `RELAY_PREVIEW_DIST` for hosted-release checks. Tests that modify records must use synthetic demo data only.


### Administrator controls and printable receipts

Role-scoped management pages provide branch/agent/customer editing, leader and manager assignments, plan management, stock registration and inventory movements. Server permissions enforce administrative and operational roles; destructive master-data changes remain Administrator actions. Unused master records can be deleted; linked history and operational evidence are protected.

New screenshot-order receipts can be printed or exported before final staff review, marked **Payment recorded / Pending backend confirmation**. Independent backend verification updates their review status and connected records. Etisalat activation remains external. Build the phone-framed browser version with `python mobile/preview/build.py`; copying a plain Flutter web build does not include the phone wrapper.

The phone-framed evaluation demo offers a preselected sample-account dropdown instead of password entry. Enable `MOBILE_DEMO_LOGIN_ENABLED=true` only on the evaluation host; it defaults to false. The server accepts only the curated active sample accounts with their expected roles and matching server-side sample password. Passwords are never embedded in the demo. Demo sessions use a separate browser token key and preserve the portal session cookie. Normal Android and portal sign-in still require passwords. See `docs/DEMO-AND-LAYOUT-UPDATE-2026-10-08.md` for release and verification evidence.
