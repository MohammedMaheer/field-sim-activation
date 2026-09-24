# Relay Client: final proposal edition, 23 September 2026

## Visual refresh, 24 September 2026

The proposal-scoped web and field app now share a stronger burgundy, teal and charcoal visual system. The web dashboard leads with a live field summary, current review workload and direct workflow actions. Its KPI cards have clearer hierarchy and take the manager to the relevant working screen. Task, incentive and KYC forms have improved spacing, labels and compact empty states. The mobile home puts transaction capture, activations and target progress within immediate reach; its KYC screen shows the external carrier stages, capture actions and expandable history. A location update older than 15 minutes is shown as stale rather than presented as a current in-territory reading.

The attached Qanawat archive was used solely to understand screen sequencing and visual hierarchy. Its branding and location/territory concepts were not adopted. The Relay Client workflow remains bounded by the approved proposal: carrier entry, identity authenticity and biometrics are external to Relay.

- Hosted web release: 13 of 13 Playwright scenarios passed, covering dashboard actions and responsive views, capture and VPS OCR, review and Excel output, task/incentive/support interactions, reports, popup actions and overflow checks. The desktop and phone-width dashboard, capture, task and team screens were visually inspected after deployment.
- Flutter release: analysis had no issues and both widget tests passed. APK `1.0.0+9` was installed on the connected Android phone and visually inspected. Capture transaction navigation, camera launch with Android permission, gallery picker launch, and capture-history expansion were verified on the phone. No new physical camera image was submitted in this visual-refresh pass.
- Published APK build 9: local and VPS SHA-256 match `5e7a3205123666f2fcd3cc9ce29cb4a6b368c3c2f6ba3be533ce6d41ac885aa2`. The original full Relay Field edition was not changed.
- Updated Android download: <https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=9>. Web: <https://relay-client.187-127-162-233.sslip.io/>.

Scope source: the owner's nine-page `Field_Sales_Proposal_KYC_Incentives_150Users_AED6000.pdf`. The implementation boundaries are in [../../docs/SCOPE.md](../../docs/SCOPE.md). The separate full Relay Field edition was not modified for this release.

## Delivered client journey

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
