# Modern Trade verification and release — 30 September 2026

This supersedes the earlier release audit for the fields, assignment history, targets and external-activation workflow. The supplied Modern Trade document was read in full. Commission and forecast rules remain unconfigured with the owner's explicit agreement.

## Verified behavior

- Screenshot customer details → order/package details → order-created/request-ID evidence → review/submit → independent backend verification → saved sale closes → matching owned SIM consumed once → saved branch leader receives a read-only update. Relay does not initiate carrier activation; no carrier/Grabba API is required for this workflow.
- Customer/order evidence is bound to the saved fields. Missing/replaced evidence and ordinary unrelated images are rejected. Unknown values remain Not recorded. Request ID never infers payment method, amount, VAT or settlement.
- Seven order types; Home Wireless requires router serial. Predefined account, SIM, router, advance transaction, SR and alternate-phone fields; full detail views and restricted identity exports.
- Effective assignment and Sales Manager snapshots preserve future submissions through staff moves. Pre-migration unknown assignments remain null. Changing a daily target preserves the designated branch leader. Assignment changes revoke affected sessions.
- Operations staff can manage permitted staff/branches; permanent deletion remains Administrator-only. Eleven role/account visibility cases, scoped filters and revoked-session denial were checked.
- Target Excel download, CSV preview/apply and stale/duplicate/invalid/scope rejection. An uploaded target was visible to the independently signed-in phone demo agent.
- Separate tele-verification/welcome queues; tele outcome releases the next stage, with scoped alerts and history. No automated calling API is needed.
- Support resolution reaches the originating agent. Stock requests, urgency, fulfilment/response, shortage alerts, Excel export, over-issue rejection and competing issue/fulfilment operations reconcile.
- Branch stock checklist selections survive URL navigation. Equipment transfers/stock-return protection and scoped reports retain historical records.

## Checks and evidence

| Check | Result |
| --- | --- |
| Backend | 89 tests passed; full app/test lint and undefined-name checks passed. Existing Python dependency deprecation warnings remain. |
| Web build | TypeScript/Vite release build passed; existing bundle-size advisory remains. |
| Flutter | Analysis clean; 26 tests passed and one pre-existing skip. Native APK and framed browser build completed. |
| Isolated PostgreSQL/browser | 35 distinct scenarios passed across the main run, stock-test reruns and added sign-out regression. Main run passed 32; two fixed-category stock fixtures initially counted batches retained from an earlier test run. Fixtures now use a unique category per run; both balance and concurrency tests then passed. No production records were changed by these mutation tests. |
| Responsive views | Sales detail at desktop and 390px; 32 sales/stock/administration subviews at both desktop and narrow sizes; call-role screens and phone draft/capture/invoice flow. Screenshots were visually reviewed. A final full capture rerun exposed a recognition-inserted space in a labelled request ID; narrowly joining split numeric groups fixed it, the full capture flow passed again, and missing/unreadable reference rejection remains covered. |
| Hosted after release | Seven browser checks passed: app sales/assets, sale detail, Operations workspace, Administrator/Field Agent/Compliance visibility and phone sign-out. Hosted split-digit request-ID parsing and evidence proof were checked without creating a sale. Hosted web entry, JS/CSS and phone-demo entry/bootstrap/main.dart.js matched local build bytes. |
| Physical Android | Final release APK versionCode 52 installed successfully on the connected phone. Existing agent sign-in, live camera, absent-document continuation guard, sales detail, target view and read-only branch-leader confirmation checked. Call-team queue and sign-out checked. Nested sales sign-out was physically verified to return to sign-in with the old sale hidden; its regression also passes in Flutter and hosted phone demo. No real customer/carrier transaction or payment settlement was performed. |
| Migration and rollback | A restored PostgreSQL copy passed 012 → 013 → 012 → 013 with unchanged record counts. Unknown historical manager/date fields remained null. Production migrated to 013; API and database healthy. |
| Data preservation | Stopped-write database backup taken. Before/after users, plans, agents, captures, sales and SIM counts matched. Exact account/plan hashes matched. No seed/reset was run against production. |

Evidence is kept outside Git in `client-version/output/qa/`: `shared-backend-order-comparison.png`, `shared-payment-invoice.png`, `shared-backend-confirmed.png`, `shared-leader-confirmation.png`, `modern-trade-sale-detail.png`, `modern-trade-sale-detail-phone.png`, `modern-trade-mobile-targets.png`, `android-customer-guard.png`, `android-agent-targets.png`, `android-leader-updates.png`, `android-call-team.png`, `android-signed-out.png`, `modern-trade-mobile-signed-out.png`; test traces/report directories are also excluded from Git. Physical camera evidence is internal and is not published.

## Release

- Client deployment only: `/opt/relay-client`.
- Backup: `/opt/relay-client/backups/modern-trade-before-20260930T075253Z`; database dump, restore manifest, file backup, old image and preservation checks retained.
- Follow-up backups: `/opt/relay-client/backups/modern-trade-ocr-before-20260930T081856Z` (request-ID correction/API and database) and `/opt/relay-client/backups/modern-trade-mobile-before-20260930T081915Z` (phone demo/APK sign-out correction). No schema or stored-record rewrite in either follow-up.
- Schema: 013. Android: 1.0.0+52.
- APK SHA-256: `abf0c97fffdc62f03622fda19fd84aeaaccabbb5c41fbf4462ffcd3f6ac74c5d`.
- Portal: https://relay-client.187-127-162-233.sslip.io/
- Phone demo: https://relay-client.187-127-162-233.sslip.io/mobile-demo/
- APK: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk

## Limits and outstanding inputs

Recognition is not a guarantee of identity authenticity or perfect extraction; independent human evidence review remains required. The shared browser capture shortcut uses synthetic evidence and does not prove a physical carrier device workflow. Complete real-device/carrier capture, real customer identity and gateway settlement were not tested. Historical interfaces/receipts are preserved.

Commission slabs, CRR/DRR/projection formulas and deduction/reversal rules await approved management input. The Sales Manager's exact access area also awaits confirmation; assigned-branch reporting is the implemented restricted default. These dependencies are explicitly distinguished from implemented internal workflow.

## GitHub checks after push

Source was pushed to `master` (implementation commit `bfcb958`). GitHub Actions run [36690025542](https://github.com/MohammedMaheer/field-sim-activation/actions/runs/36690025542) did not execute either job: both had no steps, and the API/web check annotation states “The job was not started because your account is locked due to a billing issue.” The local equivalent backend tests/lint, web build and Flutter analysis/tests passed. This is an account-level CI blocker, not a claimed successful GitHub run. Account billing must be resolved by the owner before hosted Actions can execute again.
