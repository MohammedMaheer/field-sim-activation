# Relay verification — 30 September 2026

This audit covers the maintained client edition. It is an internal evidence record, not client-facing copy. Requirements were checked against the supplied Modern Trade document and the latest owner clarifications. The latest screenshot-order workflow takes precedence over the older barcode/signature and leader-approval workflows.

## Changes released

- Live updates no longer retain database transactions while waiting for events. The old implementation exhausted the connection pool with multiple open screens.
- Business forms trim text before checking required lengths. Blank names, labels, support messages and reasons are rejected. Passwords retain their exact characters; staff passwords over bcrypt's byte limit return validation errors.
- Administration links open the requested section and support Back and reload. Asset sections also support direct links; the dashboard's stock-request shortcut opens Requests.
- The overview uses the current sales register for sales totals, charts, branch performance, plan distribution and recent records. Historical activation records remain on their dedicated page. Pending review, calls, support and stock requests use role/branch-scoped records.
- The owner approved consolidating the duplicate branch dashboard sections and setup shortcuts. One branch-performance section remains; workspace setup links lead to the dedicated management pages. Other features and historical data were preserved.
- The overview uses compact colored action cards and consistent headings. Sales statuses have appropriate success, warning and cancellation colors. Unauthorized dashboard destinations are disabled or omitted.
- Phone call forms now include Cancel. Phone-demo samples use a new request ID for each order, and matching confirmation evidence, so repeated demonstrations do not collide with previously submitted sample orders. Real duplicate-order protection remains enabled.

## Evidence and coverage

Destructive tests ran against a separate PostgreSQL database and container. Hosted checks used existing accounts without submitting, resetting or deleting operational records.

| Layer | Evidence |
|---|---|
| Backend | 73 tests passed; selected application-file lint passed. |
| Web/API workflows | 52 distinct selected scenarios passed across the isolated runs, including corrected regressions. This is not a claim that every legacy test file passed. |
| Final hosted checks | 15 passed; one destructive call-handoff scenario skipped on hosted data because it already passed in isolation. Includes the current sales dashboard, all active routes, subpages and role screens. |
| Roles | Administrator, operations, compliance, inventory, both branch leaders, branch manager, Sales Manager, agent and both dedicated call roles checked for permitted and forbidden reads/actions. |
| Capture | Real server image extraction; automatic live-camera parsing using a synthetic camera stream; preview upload/capture; missing evidence, substituted evidence, invalid images and ordinary non-document images rejected. |
| Transaction | Customer screen → order screen → stored confirmation → compact invoice → independent backend image comparison/review → read-only leader update passed twice with different request IDs. Unknown fields remain Not recorded. |
| Connected work | Saved draft appears in the signed-in web workspace; starting a new transaction clears fields; agent support → staff response → agent read-back; plan edits/remove/restore/permanent deletion; tele-verification → released welcome call across separate accounts. |
| Stock | Branch scope, bulk issue, urgent request, exact fulfilment, shortage thresholds, reports/Excel exports and returns; simultaneous issue requests cannot overdraw stock; repeated fulfilment is rejected. |
| Imports | Sales-status preview/apply, stale/duplicate/unmatched rows, atomic failure and audit behavior checked. |
| Visual | All 18 active web routes at desktop and 390px; 32 sales, stock and administration subpage views; dashboard also at 768px; navigation, keyboard drawers and responsive overflow checked. Screenshots inspected. |
| Live streams | 24 simultaneous streams remained open while health and dashboard returned 200 in 0.572 seconds. PostgreSQL no longer showed their idle transactions. |
| Flutter | Analysis: no issues. 25 tests passed, one skipped. Release APK and framed web build completed. |
| Physical Android | Ten agent views captured without Flutter layout exceptions, including camera initialization. The complete leader/call-role physical run did not finish. Final APK installation repeatedly returned INSTALL_FAILED_USER_RESTRICTED, including the owner's requested retry. The final APK is available for manual installation; it is not claimed installed. |

The first rapid hosted sweep exceeded the existing request limit and received 429 responses. Hosted visual tests were paced for the final run; rate-limit protection was not disabled. A successful build alone was not treated as visual or workflow proof.

Local evidence is excluded from Git under `client-version/output/qa/`, including `rigorous-unique-checks.json`, PostgreSQL/API results, stream results, hosted results, screenshots and Android installation logs. Test data is synthetic. Credentials, captures, database backups and generated binaries are not committed.

## Release and preservation

- Client-only release; migration remains 012. No migration, sample reset or seed operation was performed on the live database.
- File and database rollback backup: `/opt/relay-client/backups/rigorous-before-20260930T054826Z`. The database backup was successfully restored into an isolated database, checked and removed before release.
- Preserved counts: 23 accounts, 8 plans, 12 agents, 9 captures, 3 sales and 96 SIMs. The backup and live counts matched after release.
- Android version: 1.0.0+50. SHA-256: `af8236a97e2d4f510a4fc09ffacb74b9433a955500f059ba07e9aaad25b9f07d`.
- Web: https://relay-client.187-127-162-233.sslip.io/
- Phone demo: https://relay-client.187-127-162-233.sslip.io/mobile-demo/
- APK: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk

## Completion limits and remaining requirements

The tested workflows function together; this audit does not certify every proposal requirement as complete or guarantee recognition of arbitrary images.

- Grabba hardware, carrier activation, gateway settlement, outbound calling/SMS and off-device push require provider/device access. Order-created evidence is an agent payment record pending backend confirmation, not proof of settlement. Leaders do not verify transactions.
- Commission rules/formulas and CRR/DRR projections remain missing inputs. The supplied Word file mentions an attached commission structure but contains no embedded attachment or formula table. Commission forecasts and configurable commission-rule upload are not implemented.
- Targets can be set and viewed, but bulk target-file upload is not implemented.
- Sales Manager visibility is branch-scoped. Historical sales snapshot the agent, leader, branch and outlet; they do not snapshot a separate Sales Manager assignment. Exact multi-branch Manager scope/hierarchy needs confirmation and implementation before claiming the full proposal report hierarchy.
- Branch return checklists and agent transfer/exit work; complete branch closure/relocation is not implemented. Configurable SIM-deduction status remains superseded by the owner's independent-verification/external-activation rule.
- Older activation history was preserved, not backfilled into the current sales register. The current overview now uses the current register explicitly.
- No real customer document, physical Grabba, carrier, biometric authenticity or payment settlement was tested. The final APK's remaining physical role checks are blocked by Android installation restrictions.

These are disclosed scope/input/device gaps, not features silently removed during this audit.
