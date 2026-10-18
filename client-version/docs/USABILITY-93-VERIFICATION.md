# Everyday workflow simplification — release 93

Reviewed the current web Reports, Assets & supplies, Incentives, SR verification, Work locations, Team leaders and Sales agents screens. Initial navigation used the hosted application without operational writes. Changes focus on the stock and verification tasks that still required unnecessary scrolling, exposed technical labels or made recovery difficult. Existing features, role checks and historical records remain available.

## Changes

- **Stock register:** combined the separate receiving instructions/import panel with the asset list. Add asset, exports and import now belong to the same section. Category, sales-agent, status and date controls sit behind Filter items; its active count stays visible when collapsed. Clear item filters preserves the authorized shared branch selection. Empty filtered lists explain how to recover. Desktop controls align; phone-width export controls stay on one line with the primary action beneath them.
- **Stock requests:** replaced technical status/action codes with readable labels. Approve, Reject and Mark fulfilled open a named dialog showing the request, quantity and sales agent. The reason stays available after a rejected save. Request date filters now affect the displayed rows, and request exports no longer inherit an invisible stock-only status.
- **Mobile assets:** show quantities, assignment, category and status in readable text. Request stock has spaced fields, explicit Cancel/Close, quantity validation and a retained error message. Failed submissions keep all entries in the form; pending submission disables repeat actions. Network errors do not claim the request was saved offline. Stock now provides a direct, permission-scoped Assets & supplies shortcut for members who previously had to find the Home shortcut.
- **SR verification:** Today and This month are direct choices. A period with no sales shows a useful explanation rather than four zero-count filters. An empty search/result filter offers Clear result filters. Preview/apply, daily/monthly coverage, independent SR states and authorization remain unchanged.

## Verification

Evidence and build/release artifacts are retained outside Git under `output/qa/usability93-*`. Mutating connected checks use a fresh, internally networked PostgreSQL QA service with SMTP disabled. Production data is not reset. Regression tests cover request recovery, duplicate button protection while sending, shared branch preservation, visible/export filter parity, role grants, keyboard/narrow-screen layouts, SR comparison and import recovery.

This is a targeted usability release; it does not claim to eliminate every possible usability issue or change backend business rules. Reports, Incentives, Work locations and staff management were reviewed and retained where their current task-based layouts were already useful.


## Completed checks

- Flutter analysis: no issues. Full suite: 314 passed, one existing skip. Normal Android and shared web-demo release builds succeeded.
- Focused browser coverage: 40 passed for stock workflows, responsive report controls, SR comparison, imports and effective access grants. All nine stock/report usability cases passed again after the final alignment adjustments.
- Relevant backend regression: 15 passed for stock and SR behaviour; API business logic is unchanged.
- Real PostgreSQL browser tour: all current sales and supply subpages passed at desktop and 390px; eight report types and final incentives downloaded in CSV, Excel and PDF, with 27 files checked.
- Connected stock request: the mobile demo retained a rejected request, retried to the shared API, and displayed the backend's Approved status after the admin reviewed it in the new dialog. Synthetic records and SMTP-disabled isolated services were used.
- Physical Android: final normal build 93 installed successfully. Direct Stock → Assets & supplies navigation, readable quantities/statuses, branch stock and request cards were visually inspected. No production request, sale or work session was submitted.

An initial harness attempted to open a management-only workspace menu from the sales-agent Home page. The final connected check uses the direct Stock shortcut. A temporary SSH forwarding connection also dropped during QA; it was restored with keepalives, and the complete request/review round trip then passed. These were isolated-test conditions, not hosted application outages. An overlapping Flutter test run regenerated an integration-test plugin registration during an Android build; the final normal APK and demo were rebuilt sequentially and verified.

Publication is limited to the client web/mobile sources, compiled assets and APK. Database schema, API image, environment and other VPS applications are preserved. Deployment and database backups, isolated restore/fingerprint verification, changed-file hashes and rollback are required before handoff.


## Published checks

All 22 focused stock/report/SR checks passed against the published assets. A fresh signed-in read-only tour verified the seven reviewed portal destinations and request-decision dialogs at 1440px and 390px without browser/server errors or operational writes. Public HTML, CSS, JavaScript and the mobile demo match the release manifest. The installed Android APK hash matches the downloadable normal build 93.

The deployment/database backup restored successfully, with every table fingerprint matching. Schema remains 023; API image, environment and compose configuration are unchanged. The API is healthy with zero restarts and OOM false. The previous deployment and database backup are retained for rollback.
