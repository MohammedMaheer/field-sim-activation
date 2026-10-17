# Usability update 88

This update simplifies existing work without removing capabilities or changing transaction, assignment, incentive, SR, geofencing or authorization policies. Existing records, accounts, edited plans and saved assignments are preserved.

## Changes

- Reports: choose a report, optional search and file format in one place. All eight existing report types remain available to their authorized roles. Shared branch scope, date validation, Today/This month, incentive tracking and the sales-report shortcut remain available.
- Assets and supplies: receive/import, add, move and issue still work. Import and less common fields are disclosed on demand. Add/move/issue use focused dialogs. Destination-branch assignment choices and explicit save/cancel actions reduce mistakes; custom categories remain supported.
- Sales-agent table: the initial columns emphasize name, branch, designated leader, activations, target and stock. Show all columns restores the remaining fields, and Clear filters recovers an empty search. Exports and record details still include their original data.
- Team leaders: cards have more room and share one authorized backend-verification shortcut. Editing and intentional reassignment remain separate operations.
- Mobile and mobile demo: the workspace menu groups its existing destinations by task and watches current permissions. Assets and Requests have separate views. Reports offer Today/This month. Asset/request cards have visible spacing.
- Live updates: a connection acknowledgement no longer restarts initial data loading. Later events are coalesced without cancelling an in-flight snapshot; if it predates an event, a follow-up retrieves current data. Ending a session prevents queued follow-up work.
- Read efficiency: authorized agent lists batch their related lookups. Customer and inventory lists retain small related rows only within the request session, and sales-list metadata reads defer encrypted image blobs. No cross-user or global record cache was introduced.

## Verification

- Backend: 266 passing tests covering the client contract, grants, notification access, exports, write consistency, inventory presentation and new read-efficiency regression checks. Agent serialization matches the original output with a bounded query count. A separate session sees updated user data.
- Flutter: all 310 tests passed with one existing skip, including the new grouped-menu, permission-revocation, stock-section and report-shortcut tests. Analysis reported no issues before the final spacing-only change; compilation and the full test suite also passed after it.
- Focused browser checks: 35 passed across 390, 800 and 1440px layouts, report formats and failure recovery, missing/inverted dates, token renewal, sign-out isolation, leader assignments, optional asset fields, custom categories, destination-branch choices and key/all table columns.
- Another 45 browser checks passed for effective grants, notification visibility, final-incentive export permissions and stock adjustment. Two connected report/recovery checks and five mobile-demo sign-in/sales/assets checks passed.
- The read-only administrator tour passed across all 19 visible destinations at desktop and phone widths (38 page views), checking browser exceptions, server errors, page readiness and whole-page overflow. Screenshots and logs are kept in the ignored local `output/qa/usability88-*` evidence folders. Earlier failed tours exposed repeated customer/inventory lookups and were used to diagnose the fixes; they are not counted as passing tours.
- Physical Android: the normal build88 APK installed successfully. Signed-in agent checks opened the grouped workspace menu, branch assets and requests against hosted data. Screenshot inspection caught and corrected touching stock cards. No stock request, sale, work session or location was fabricated during these checks.
- After publishing: six public file hashes, including the mobile demo and APK, matched the release manifest; the installed APK matched the public APK. API health passed with zero restarts/OOM. Reports, assets, sales agents and team leaders loaded on the hosted portal with no browser/server errors or operational writes. A hosted team-leader demo check passed through the grouped menu, Today/This month report controls and Assets/Requests views. The final physical APK's card spacing was visually inspected.

## Release controls

Only `/opt/relay-client` is updated. Deployment verifies previous file identities, backs up the application and database, restores the dump into a disposable PostgreSQL database and compares every table fingerprint. Schema remains 023. Environment, connection-pool settings and operational records are preserved. An error restores the previous client files and API image. Release manifests, final screenshots, APK hashes and backup paths remain outside Git.

This is a targeted usability and regression review, not a claim that every possible future device, network condition or policy combination has been exhaustively tested. No new external integration, live staff location or operational demo reset is included.
