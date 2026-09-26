## Focused KYC and visual usability release — 26 September 2026, build 14

- Web: simplified KYC into a single capture/review workspace. Searchable history opens in a drawer, upload disappears during review, and secondary file integrity, OCR and audit details are collapsible. The three stages remain Capture transaction, Review details, Submit & track. The Qanawat ZIP was inspected for its focused stage structure; external biometrics and carrier activation were not copied into Relay.
- Mobile: compact current-stage progress, upload hidden during review, guarded New capture action, clearer record detail sheets, readable detail text and customer-card spacing. Fixed Support's unbounded loading viewport. The login description now describes screenshot review accurately.
- Shared visual refinements: stronger violet, teal, blue and amber accents; consistent form gaps, aligned report buttons, compact phone-width headers, fitting live roster, clickable record names, task/incentive/support drawers, paginated web support history and direct mobile KPI destinations.
- Demo data: explicit opt-in `python -m app.demo_refresh` with `RELAY_DEMO_REFRESH=1` adds audited synthetic daily sales plus task/support examples for original seeded agents. Added 91 sales to the hosted demo; repeat execution created zero duplicate sales. Existing records and history were preserved. This is a manual demo tool, not a production scheduler.
- Verification: 41 backend tests passed; Flutter analysis clean; seven Flutter tests passed including full screen rendering with a scoped synthetic fixture and large-text/detail/loading checks. Hosted web: 19 passed plus one skipped initially; one historical-order locator assumed the old RLY prefix and was fixed to include explicitly marked DEMO records. All five scope scenarios then passed. All 20 enabled scenarios passed across those runs. Administrator creation remains intentionally skipped against the shared hosted demo.
- Visual evidence outside Git: `output/qa/audit-visual` (14 routes, desktop and phone widths), `output/qa/flutter-render` (all primary and secondary app screens and detail sheets), and `output/qa/capture-web-*.png` (live OCR/review workflow). Flutter rendering uses real widgets with captured synthetic API data; it is not a physical-device execution claim.
- Device limitation: Android repeatedly rejected test and normal APK installs with `INSTALL_FAILED_USER_RESTRICTED`. The emulator also failed to boot. Build 14 is published, but installation and final physical-phone verification remain pending. The failed Flutter install attempt removed the earlier client package; install the downloaded normal APK to restore the usable client app.
- APK `1.0.0+14`: SHA-256 `c462a988e6d852418a178c71f317344b51afd965455b86e39fb8483032bc4b95` matches local and VPS copies. Download: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=14
- Web: https://relay-client.187-127-162-233.sslip.io/kyc-capture
- Before the current deployment/data refresh, database, web and prior APK were backed up under `/opt/relay-client/backups/visual-20260926T084142Z`. No schema migration or API restart was required. Web rollback restores `web.tar.gz`; APK rollback restores `previous.apk`. Demo data is additive; preserve subsequent user data when planning a database restore. Client and full-edition API/database container identities remain unchanged and healthy. Only `/opt/relay-client` was modified.

## Admin usability and setup release — 25 September 2026, build 13

- Added audited administrator branch, team-leader, outlet and agent creation within the existing Agents and Branch teams screens. Teams use the established leader/branch membership. Newly created agents can sign in to the shared mobile backend.
- Shortened dashboard previews, improved branch charts, aligned setup fields, removed duplicate headings, linked team rosters to agent details and fixed detail-close URLs. Capture upload/history use both desktop columns; review hides the upload form and retains access to new capture. The mobile profile no longer repeats Branch.
- Verification: 40 backend tests and Ruff passed; web production build passed; 18 hosted browser tests passed, including live VPS OCR, Excel, reports, scope, navigation, popups and responsive views. The complete account-provisioning browser test passed on an isolated local database and is intentionally skipped on the hosted demo. Flutter analysis and all four widget tests passed.
- APK build 13 installed successfully on the connected Android phone. Home and corrected Profile were visually inspected against the hosted backend. This release did not repeat physical-camera capture testing.
- Backup: `/opt/relay-client/backups/usability-20260925T095606Z` includes database, app/web assets and prior APK. Previous API image: `relay-client-api:before-usability-20260925T095606Z`. Migration remains 005; no schema change. Rollback restores the archived app/web assets and previous API image; new users remain compatible with the prior schema. The earlier full edition containers retained their identities and remain healthy.
- APK SHA-256, matching VPS: `44e2c0e19e917d6c60a38a5246048bd2343d2b231f3ce3b5e2e0b7a90d8e89be`.
- Web: https://relay-client.187-127-162-233.sslip.io/
- APK: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=13

The product remains a synthetic-data demo of the approved proposal. These checks are not a guarantee of zero defects, an independent security audit or a 150-user load certification.

# Relay Client release history

## Current web/API release: admin control audit, 25 September 2026

Added a compact administrator-only Manage tab inside the agent drawer for daily targets and branch-compatible outlet/leader assignments. Updates require a reason, are audited, reject stale edits and protect assigned SIM stock. Added scoped KYC reference search, verification-status filters and paging beyond the former 50-record UI limit. Default agent ordering is now stable after updates, and team details omit internal database IDs. No extra sidebar sections were added.

Verification: 39 backend tests and Ruff passed; web build passed; all 17 hosted Playwright tests passed, including real VPS OCR through reviewer completion, exports, admin target save/restore, history search, popups, role-sensitive views and responsive layouts. A subsequent form-layout refinement was checked with both admin browser tests. Desktop and phone-width agent-management screenshots were visually reviewed. Flutter analysis and all four widget tests passed. Mobile build 12 remains compatible; there is no new APK for this admin-only update. Physical-device tests were not repeated in this pass.

See [admin control coverage and boundaries](ADMIN-CONTROL-AUDIT.md). Tests establish the enumerated behavior, not a guarantee of no bugs, a penetration test or a 150-user load certification. Carrier services and notification delivery retain their documented demo boundaries.

Backups: `/opt/relay-client/backups/admin-audit-20260925T045438Z` (pre-audit) and `/opt/relay-client/backups/admin-audit-20260925T045946Z` (follow-up). Each includes database and source/web backups; the corresponding prior API image is tagged `relay-client-api:before-admin-<timestamp>`. No migration was required. Restoring source/web and the previous image is the rollback path. The original full edition remains separate and healthy.


## Earlier release: balanced colour refresh, APK build 12, 24 September 2026

Added a restrained shared surface palette: lavender capture areas, teal history/review accents, blue panel headers and warm report/summary accents. Page headers and app bars use soft tinted surfaces; input fields remain white and existing status colours are retained. The transaction workflow and backend are unchanged.

Web build passed. Seven hosted browser checks passed, covering all-route responsive screenshot/overflow checks, branches, capture progress, popup actions and keyboard focus. Flutter analysis and all four widget tests passed. Build 12 installed on the connected phone; its capture screen was visually inspected alongside desktop capture/reports and phone-width web screenshots. This visual-only pass did not repeat the complete OCR or physical camera-submission test.

Backups: `/opt/relay-client/backups/colour-build12/` contains the database snapshot, previous web bundle and build 11 APK. No migration or backend restart was needed. Other VPS apps and the full Relay edition were not changed.

APK local/hosted SHA-256: `9758aa0435fef32a54f3147b1977dfebec1f3fd6124aa46d04effa5af325a85e`.

Download: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=12


## Earlier release: three-stage capture, APK build 11, 24 September 2026

Combined the reference demo's three-stage presentation with the proposal's functional screenshot flow: **Capture transaction → Review details → Submit & track**. Removed the separate six-stage instructional navigator and duplicate progress bar. Progress follows persisted capture status; failed extraction remains in capture, rejection returns to review, and only a saved backend decision is shown as verified. External Etisalat prerequisites are summarized once; no selfie, signature, plan-selection or telecom-activation forms were added.

Web and Flutter share the stages and wording. Existing encrypted capture, VPS OCR, editable rows, validation, Excel, submission and backend review remain intact. No backend schema or API changes were needed.

Validation: web production build passed; all 15 hosted Playwright scenarios passed, including real VPS OCR, three-stage transitions, Excel and reviewer completion. Flutter analysis and four widget tests passed, covering every capture status including rejection/OCR failure at narrow width. APK build 11 installed successfully on the connected phone; its capture screen was visually inspected. Desktop and phone-width web capture screens were also inspected. The end-to-end upload test ran in the hosted browser; a new phone camera submission was not performed in this pass.

Client web/database backups: `/opt/relay-client/backups/capture-build11/`. No migration was run. Rollback web by restoring `web-before.tar.gz` into `/opt/relay-client`; the prior APK is `build10.apk`. Full edition and other services were not modified.

APK SHA-256, matching local and hosted files: `25f53609796ef89e9c9dc603e6be0e9ed4e3f58e246f1a438141dd6c0e43a3f1`.

Download: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=11


## Earlier release: branch dashboard and APK build 10, 24 September 2026

The proposal edition now uses explicit branches, branch-scoped teams, and a shared colourful design system with self-hosted DM Sans and Manrope typography. Web charts show capture/sales activity, verification status, branch performance and plan mix. Mobile shows matching metric cards, a weekly chart and verification progress.

Territory/geofence navigation, reports, map data and mobile location collection have been removed from this edition. Android build 10 requests no fine/coarse location permission. Historical database/audit data is preserved. The separate full Relay edition is unchanged.

The reference archive's identity / SIM-plan / synchronization sequence is represented by the six detailed proposal stages on web and Flutter. Stages 1–4 remain external Etisalat work; Relay implements screenshot capture, VPS OCR, correction, Excel handoff and human backend review. No carrier or biometric integration is implied.

- Backend: 36 tests passed; Ruff passed. Branch migration upgrade, downgrade and re-upgrade checked on a copied local database; hosted PostgreSQL migration completed with a database/source backup.
- Web: production build passed. All 15 hosted Playwright scenarios passed, including real VPS OCR, editable rows, Excel output, backend verification, branches, popups, task/incentive/support persistence and CSV/PDF exports. Responsive desktop and phone-width screens were visually inspected.
- Flutter: analysis passed; 4 widget tests passed; release build 1.0.0+10 installed on connected Android device. Visually checked home, branch/leader card, weekly chart and capture guide. Selecting stage 5 and Go to capture worked. This pass did not submit a new camera image from the phone; screenshot OCR is exercised by the hosted web suite.
- APK SHA-256 (local and VPS match): `362101b0ce67f9644a324ede328737ccc1f4f15a3eb95b09e566b6b8e1611353`.
- Source published to https://github.com/MohammedMaheer/field-sim-activation. GitHub Actions could not start because the account is locked for a billing issue; no CI pass is claimed.
- Deployment changed only the client API and web assets. The client database container and both original full-edition containers retained their identities and remain healthy.
- A hosted check exposed newly assigned tasks hidden below overdue work. Task creation now reveals the assigned task through the visible search filter, keeping the due-date ordering intact.

Web: https://relay-client.187-127-162-233.sslip.io/

APK: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=10


## Earlier build 9 visual refresh (superseded), 24 September 2026

The proposal-scoped web and field app now share a stronger burgundy, teal and charcoal visual system. The web dashboard leads with a live field summary, current review workload and direct workflow actions. Its KPI cards have clearer hierarchy and take the manager to the relevant working screen. Task, incentive and KYC forms have improved spacing, labels and compact empty states. The mobile home puts transaction capture, activations and target progress within immediate reach; its KYC screen shows the external carrier stages, capture actions and expandable history. A location update older than 15 minutes is shown as stale rather than presented as a current in-territory reading.

The attached Qanawat archive was used solely to understand screen sequencing and visual hierarchy. Its branding and location/territory concepts were not adopted. The Relay Client workflow remains bounded by the approved proposal: carrier entry, identity authenticity and biometrics are external to Relay.

- Hosted web release: 13 of 13 Playwright scenarios passed, covering dashboard actions and responsive views, capture and VPS OCR, review and Excel output, task/incentive/support interactions, reports, popup actions and overflow checks. The desktop and phone-width dashboard, capture, task and team screens were visually inspected after deployment.
- Flutter release: analysis had no issues and both widget tests passed. APK `1.0.0+9` was installed on the connected Android phone and visually inspected. Capture transaction navigation, camera launch with Android permission, gallery picker launch, and capture-history expansion were verified on the phone. No new physical camera image was submitted in this visual-refresh pass.
- Published APK build 9: local and VPS SHA-256 match `5e7a3205123666f2fcd3cc9ce29cb4a6b368c3c2f6ba3be533ce6d41ac885aa2`. The original full Relay Field edition was not changed.
- Updated Android download: <https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=9>. Web: <https://relay-client.187-127-162-233.sslip.io/>.

Scope source: the owner's nine-page `Field_Sales_Proposal_KYC_Incentives_150Users_AED6000.pdf`. The implementation boundaries are in [../../docs/SCOPE.md](../../docs/SCOPE.md). The separate full Relay Field edition was not modified for this release.

## Earlier delivered journey (historical; location removed in build 10)

1. Manager signs into the web portal to review live operations, team and outlet performance, sales targets, customers and historical activation records, territory status, SIM inventory, compliance and audit history.
2. Manager assigns field tasks, records incentives manually or imports a validated CSV/XLSX sheet, and allocates available SIMs. Scoped audit events record changes.
3. Agent signs into the Flutter app to view shift, territory, targets, tasks, assigned stock, customer search, daily report, incentives and support. The agent can report return or damage of an assigned SIM with a required reason; manager allocation is done in the web portal. Task completion can be queued in encrypted local storage when transport is unavailable.
4. The agent performs identity, customer, plan and order stages in the **external Etisalat system**. Relay displays the stage guide but does not enter data into that system.
5. The agent takes or uploads a completed transaction screenshot. The VPS retains the encrypted original and runs English/Arabic OCR. The agent reviews and corrects multiple line items, then validates and submits them.
6. Relay generates an Excel file with one row per extracted line, source image reference, extraction status and verification status. Authorized backend staff inspect the original and rows and record the verification result. Web live events and mobile refresh show the updated status.

## Verification

- Backend: 35 business/API tests and Ruff passed after removal of the old identity-simulation endpoint from the client API and addition of scoped own-SIM actions. Existing-database migrations completed, and a hosted agent account received the new permission. Invalid stock-movement reasons are rejected by the hosted API. Task, incentive, support and stock changes are role scoped and audited.
- Hosted web: all 12 Playwright scenarios passed on the HTTPS client URL after the proposal deployment, including actual VPS OCR, editable rows, Excel generation, backend review/status, task/incentive/support actions, XLSX import, nine PDF report options, CSV export, popup actions and desktop/tablet/mobile-width visual checks. A subsequent narrow-screen dashboard refinement was deployed separately; its hosted desktop/tablet/phone-width regression passed, and the new phone-width screenshot was visually checked for status and action visibility.
- Flutter: static analysis reported no issues, two widget tests passed, and release APK `1.0.0+8` built for the hosted API. Build 8 was installed on the connected Android phone. Its home, task list, stock, profile, KYC capture and stage guide were inspected. An agent returned synthetic SIM `DEMO-ICCID-00-0017` with a required reason; the phone showed success, the hosted record changed to `RETURNED`, and the audit log recorded the actor, device, reason and before/after states. The manager restored the SIM to `AVAILABLE` after QA, leaving both movements in audit history. Reopening stock on the phone fetched `AVAILABLE` again. The KYC upload/OCR journey was exercised through the hosted web; a full physical-camera capture was not performed for this build.
- Published APK build 8: local and VPS SHA-256 match `9d207f2d94fe4b5b622f4037eb13756180b679a0e3bf9f6245a2b96ea280f03a`. The client API and database are healthy. Only the client API container was replaced; the full Relay Field deployment and other VPS containers retained their identities.

## Demo access and limits

- Web: <https://relay-client.187-127-162-233.sslip.io/>
- Android: <https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk>
- Private account handoff: `client-version/output/private/credentials.md`; do not publish it with the site.
- The seeded names, customer references and transactions are synthetic. OCR is real VPS text extraction, while telecom-system access, identity authenticity, biometrics, actual carrier activation and 150-user performance certification are not established. SMS/WhatsApp/email and advanced third-party integrations require the external accounts and approvals described in the proposal.
