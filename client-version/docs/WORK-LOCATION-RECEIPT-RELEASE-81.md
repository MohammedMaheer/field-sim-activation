# Work location and reference-bill release audit

13 October 2026. This records the implemented work-location feature from build 80 and the reference-bill presentation changes published in build 81. The maintained client deployment is `/opt/relay-client`; the earlier full edition and its territory endpoints are independent.

## Release status

Build 80 was published with schema **020**. Hosted assets and the installed normal Android APK were checked against the release hashes. The hosted work-location policy remained disabled, with no invented branch boundaries or member positions. The deployment and database backup is `/opt/relay-client/backups/geofence80-release-20261013T073231Z`.

Build 81 is published to the portal, mobile demo and APK download, and the normal APK is installed on the connected Android phone. Six public file hashes and the installed APK match the package. The backup is `/opt/relay-client/backups/receipt81-release-20261013T083409Z`; operational-record fingerprints and environment hashes were preserved, schema remains 020, and the API reported zero restarts and no OOM. APK SHA256: `535be7be50daa3c3f3c427c45dbb7975bb822ea6c040e65ff8beba22731a2c6d`.

The saved demo reference bill was opened in the hosted portal, hosted Flutter demo and normal Android app. Each receipt assembly has one paper logo and Reference details instead of a repeated document title. Android Print reference bill opened a one-page system print preview. The downloaded hosted PDF has one document heading, a distinct Reference details section and the recorded customer/order/SR fields. Replay and direct Home were exercised; no paper was sent to a hardware printer.

## Work location behavior

All signed-in member roles have their own work-location controls. Collection begins only after the member visibly starts work and grants device permission. The web portal, mobile demo and Android app collect while open and visible; work-session end and sign-out stop collection. Closed-app or continuous background tracking is not implemented. Another device's active session must be explicitly ended before starting one here.

Authorized administrators and operations managers configure real branch or member boundaries using coordinates, a radius or map selection. Enable enforcement only after checking actual boundaries and assignments. When enforcement is enabled, the server and clients block shift start and sale capture unless a fresh position establishes that the member is inside. Missing, stale, known mocked, excessively inaccurate or boundary-overlapping location cannot establish that result. Accepted OCR jobs may finish after the session ends; submitting a sale is checked again.

Management views and CSV/Excel exports follow authorized member and branch scope. A UI filter cannot broaden access. Location history stores encrypted coordinates and the branch, leader and boundary snapshot from recording. Reassignment does not expose the previous assignment's location history to a new restricted manager. Per-member locking, bounded contention and a unique active-session constraint protect concurrent requests; identical point retries do not duplicate history.

Street maps retain OpenStreetMap/OpenMapTiles attribution. Optional 3D buildings depend on source coverage. NASA satellite imagery is a **dated 250-metre regional overview**, potentially affected by clouds or missing coverage; it is not live or suitable for precise worksite boundary placement. Provider failure does not authorize a capture, and typed coordinates/radius remain available.

For controls, role scope, retention, migration and rollback details, see [Work location and boundaries](WORK-LOCATION.md). Migration 020 is additive. Restoring the prior API can retain the new tables; deliberately downgrading 020 removes its location records and requires any necessary export first. The migration test covers an existing 019 PostgreSQL schema through upgrade, downgrade and re-upgrade; it does not establish a complete migration replay from an empty historic schema.

## Reference-bill presentation

The virtual printer uses a printer icon and state/replay controls. The paper contains **one Qanawat logo**. Its first information group is **Reference details**, avoiding a second document title beneath the page's Reference bill heading. Standalone printed paper retains its document heading once. Cached `Invoice`, `Payment invoice`, `Sale receipt` and `Reference bill` section titles normalize to Reference details without renaming the compatible `invoice` API property.

Customer, order, recorded charges, SR and verification fields remain available. Supporting information may be collapsed in the interactive screen but is included in print/PDF output. Missing values remain Not recorded, identity numbers remain masked, and current activation/backend/SR states are preserved. The downward paper animation, replay, reduced-motion behavior, direct Home navigation and printing access checks remain part of the tested flow.

## Hosted demo SR

The mobile demo renders an explicit unique sample SR on the synthetic order and uses the same SR on its optional sample receipt. These images go through the normal OCR and image-bound proof path. Production captures do not invent an SR from a Request ID.

The following authorized sample was submitted through the hosted mobile demo and verified in backend data and the reference bill:

- Request ID: `SAMPLE-REQ-1791877730455000`
- SR number: `SAMPLE-SR-1791877730455000`
- Capture: `71da016b-aa30-4397-881b-c139f4d58b86`
- Submission state: `SUBMITTED`; SR state: `PENDING_SR_VERIFICATION`

This demonstrates saved OCR data shared with the backend. It does not claim backend evidence approval or a matched daily carrier SR report.

## Verification evidence

Evidence files are private under `client-version/output/qa/` and are deliberately excluded from Git. Test counts below describe individual runs; overlapping reruns must not be added together as unique coverage.

| Check | Result | Evidence file |
| --- | --- | --- |
| Build 80 full backend suite | 606 passed; 3,161 warnings | `geofence80-backend-full-final.log` |
| Final bounded-lock/backend focused rerun | 55 passed | `geofence80-backend-focused-final.log` |
| Build 80 full Flutter suite | 232 passed, 1 skipped | `geofence80-mobile-full-final.log` |
| Build 80 mocked browser workflow/role/UI checks | 46 passed | `geofence80-web-tests.log` |
| Final location/logout browser rerun | 9 passed | `geofence80-logout-final.log` |
| Connected disposable API/browser flow | 1 passed: boundary, shift, outside capture block, notification and exports | `geofence80-connected-browser-replay.log` |
| Real Android GPS integration against disposable QA | 1 passed: start, management connection, outside capture/start blocking and session end | `geofence80-device-test.log` |
| PostgreSQL migration and concurrent start | 019 → 020 → 019 → 020 passed; operational fingerprints preserved; four concurrent starts yielded one active session; encrypted GPS checked | `geofence80-postgres-migration-final.log` |
| Hosted member-role reads and export scope | 12 account checks passed without recording hosted GPS | `geofence80-live-read-results.json` |
| Build 80 public release identity | Web/demo/APK hashes and installed normal APK matched | `geofence80-public-hashes.json` |
| Hosted sample SR persistence | Backend and reference bill contain the explicit OCR SR | `geofence80-demo-sr-result.json` |
| Build 81 focused receipt/backend/export checks | 38 passed | `receipt81-backend.log` |
| Build 81 focused Flutter printing, layout and navigation checks | 80 passed | `receipt81-mobile.log` |
| Build 81 browser printing and narrow-screen checks | 4 passed | `receipt81-web.log` |
| Build 81 builds and analysis | React, Flutter demo and normal APK built; Flutter analysis clean | `receipt81-web-build.log`, `receipt81-demo-build.log`, `receipt81-apk-build.log`, `receipt81-mobile-analysis.log` |
| Build 81 release and identity | 220 manifest files published; database/environment preserved; public assets and installed APK match | `receipt81-release.log`, `receipt81-public-hashes.json` |
| Hosted reference-bill PDF | One page, one document heading, Reference details and sample SR/customer/order retained | `receipt81-hosted-paper-result.json`, `receipt81-hosted-reference-bill.pdf` |
| Normal Android reference bill and print preview | One paper logo; replay, system one-page print dialog and direct Home inspected | `reference78-phone-receipt81-bill.png`, `reference78-phone-receipt81-print-dialog.png`, `reference78-phone-receipt81-home.png` |

The physical GPS test changed only disposable QA boundaries. No real hosted staff positions or client branch coordinates were seeded. Passed automated tests and the specific connected/physical checks above do not guarantee perfect OCR on every photograph, all device models or arbitrary production load.

## Configuration still required

Enter actual branch/member boundaries and verify their assignments before enabling enforcement. Hosted enforcement is intentionally off; no real branch coordinates or staff positions were invented. Foreground work-session tracking is implemented; closed-app background tracking remains outside this release. The approved unknown commission/policy inputs documented elsewhere remain unchanged.
