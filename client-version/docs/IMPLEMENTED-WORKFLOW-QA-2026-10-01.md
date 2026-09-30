# Implemented workflow audit — 1 October 2026

## Scope

Tested the implemented client edition against the clarified screenshot workflow. Commission/CRR/DRR/projection formulas and undecided business rules were excluded from completion claims. Mutation tests used isolated PostgreSQL `relay_rigorous_qa_20260930063656` through the local 5191 preview. Production accounts, plans and operational records were not reset.

## Defects corrected

- Mobile target queries used device-local month while the web/API used UTC reporting month. At the September/October boundary, imported targets were missing in the phone demo. Targets and performance now use the same reporting period, including target edits. Added boundary regression coverage.
- Mobile home and daily report used historical activation totals. They now display the current register's confirmed sales and achievement. The confirmed-sales shortcut opens Sales management. Historical activation records remain available.
- Reports and management links marked as buttons were missing normal button sizing. They now have padding, border, alignment and minimum height; desktop and narrow navigation were tested.
- The leader confirmation list and capture access used current agent assignment. They now use the saved sale leader where a linked sale exists, preserving original-leader access after transfers and denying the replacement leader access to previous confirmations. Unlinked historical records retain their existing scope. Added a transfer regression covering list, inbox and detail access.

## Executed checks

- Backend: **101 passed**, full application/test lint clean. Python dependency deprecation warnings remain.
- Flutter: **27 passed**, analysis clean. One optional fixture-driven visual unit test remains skipped; actual Android and browser screenshots were checked separately.
- Web: TypeScript and production build passed. Existing chunk-size advisory remains.
- **54 distinct isolated browser/API scenarios passed across the audit and focused reruns.** This is a scenario count, not a claim that every possible input/device combination was tested.
- After the saved-leader correction, the **32-case** permissions, notifications, evidence, stock/support and complete capture/review/leader suite passed again against PostgreSQL.
- Desktop 1440px and narrow 390px sweeps covered **18 main routes** and **16 sales/stock/administration subviews at each width**. Detail drawers, keyboard focus, Escape, back navigation and page overflow checks were included.
- Physical Android integration journey passed for agent, leader, tele-verification and welcome-call accounts, including 22 captured app views and camera-screen opening. Final release APK build **54** installed, signed into the hosted service, and confirmed-sales navigation and target display were physically checked.
- Hosted checks after both asset and backend follow-ups: **13 passed**, covering role visibility, categorized notifications, shared read-state/record links, confirmed-sale counts/navigation and report shortcut sizing.

## Connected workflows exercised

- Customer image → order image → confirmation/request ID → stored capture → agent review/submission → independent backend comparison/verification → read-only leader update.
- Required evidence binding and ordinary/unrelated image rejection; invalid inputs, stale changes, foreign records and revoked sessions.
- Shared phone/web drafts and empty new transactions; imported targets visible in signed-in phone demo.
- Dashboard/register totals, branch filters and eleven account/role scopes.
- Tele outcome releasing welcome work; separate outcomes/history and scoped queues.
- Agent support submission → backend response/resolution → originating agent visibility.
- Stock requests, urgency, minimum levels, fulfilment, exports, over-issue prevention and competing inventory operations.
- Branch creation/edit/deletion, designated leader and agent creation/sign-in; SIM edit/restore; plan price editing, removal/restore and permanent deletion of an unused test plan.
- Recovery after an interrupted sales request; sign-out removes nested private screens.

## Test failures investigated

- Month-boundary target failure was a product defect and was fixed.
- The initial leader test selected the other branch's leader; the correctly assigned leader received the confirmation. The later historical-transfer defect was separately reproduced in a regression and fixed.
- Old organization/administration tests referenced removed team/outlet setup shortcuts. They were updated to exercise current branch/leader/agent controls; creation and deletion passed.
- A local SSH tunnel interruption caused empty responses and aborted runs. The hosted test server stayed healthy; the tunnel was restored and affected cases rerun successfully.
- Local remote-backed page loading exceeded old five-second assertions. Loading assertions now allow 15 seconds and still fail on real errors. The serial responsive sweep passed.

## Release

- Client-only web/mobile-demo/APK backup: `/opt/relay-client/backups/client-assets-before-20260930T200221Z`.
- Web entry, JS/CSS, Flutter compiled code/bootstrap matched published bytes. APK SHA-256: `e199d19cd16768d84157dd05f98ac3969a289894dfd7988355288766f1c155f3`.
- Backend history-scope backup: `/opt/relay-client/backups/audit-history-before-20260930T200754Z`.
- Schema remains **014**; these fixes require no migration or stored-data rewrite. Asset and backend release scripts retain rollback copies; database backups are kept outside Git.
- Production health passed and the initial post-asset-release log check found no API 500 responses.
- Evidence and traces are excluded from Git under `client-version/output/qa/`.

## Limits

This verifies the implemented internal workflows with synthetic records. It does not certify every handset/browser, all OCR conditions, real carrier activation, identity authenticity or payment settlement. OCR still requires independent review. Native iOS was not tested; the phone-framed browser demo was. Commission and client decisions from the requirements audit remain open. GitHub Actions had an account billing lock in the previous release; local checks are reported independently.
