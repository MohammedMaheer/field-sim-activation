# Role access audit � 1 October 2026

## Enforced access

| Role | Allowed responsibilities | Restrictions |
| --- | --- | --- |
| Administrator | Workspace setup, plans, stock, staff, reports, capture and backend review | Cannot verify a capture they created; existing record-state and historical deletion protections remain |
| Operations Manager | Organization and operational management, stock, support and independent backend review | No subscriber-plan/settings grants |
| Compliance Officer | Read evidence, independent backend verification, audit and reports | No capture/draft editing, inventory writes or workspace administration |
| Field Agent | Own captures, drafts, sales, stock use and support requests | No other agent records, backend verification, plan edits or staff administration |
| Team Leader | Assigned branch/agent reporting, read-only transaction history and backend-confirmed notifications | Cannot capture, change evidence, submit or verify transactions; saved sale leader remains authoritative after transfers |
| Branch Manager | Assigned branch reporting and operational support | Cannot capture, change evidence, submit or verify transactions |
| Sales Manager | Assigned/saved sales scope, performance, reports and branch stock visibility | No capture edits, backend verification or administration |
| Inventory Manager | Stock and asset management, existing operational reporting | No capture evidence access, backend verification or workspace administration |
| Tele Verification Officer | Assigned tele-verification work and notifications | No welcome-call outcomes or general customer/capture/stock pages |
| Welcome Call Officer | Released welcome-call work and notifications | No tele-verification outcomes or general customer/capture/stock pages |

Branch and agent filters continue to intersect authorized records. Notification read state and saved drafts remain user-specific. Historical assignment and self-review protections are preserved.

## Corrections

- Central supported-role permission ceilings intersect database grants on every authenticated request. Old elevated grants cannot silently escalate an agent; unknown roles fail closed.
- Unknown/unconfigured accounts cannot sign in or refresh sessions. Inactive agents cannot refresh; revoked sessions remain blocked.
- Removed legacy evidence-write grants from leader and branch-manager roles without rewriting existing records. Reporting users retain authorized read access.
- Web navigation denies unsupported destinations and provides a readable access-denied page. Leader history has no capture/draft/edit/submit controls.
- Flutter and its shared phone demo enforce direct-route guards, including signed-out routes. Evidence fields and submission actions honor current permissions. Staff land in role-appropriate workspaces; inventory has notifications, assets and sign-out access.
- Call-team background synchronization requests their queues and notifications rather than unauthorized general dashboards.

## Verification

- Backend full suite: **112 passed**; Ruff clean. Tests include unknown roles, stale elevated grants, login/refresh denial, reporting-role write denial and authentication dependency coverage for every mounted private endpoint.
- Flutter: **31 passed**, analysis clean; one existing optional fixture visual test skipped. Web and APK production builds passed.
- Isolated PostgreSQL: **28** API/notification regression scenarios passed, plus **19** web/mobile direct-route and dashboard-navigation scenarios. Follow-up session/eleven-account checks: **12 passed**.
- Hosted: **19** role/direct-route/navigation scenarios passed after deployment. Visual screenshots inspected for leader history, denied inventory capture access and phone role workspaces.
- Interrupted local test-server and wrong preview URL runs were corrected and rerun; they are not counted as passing runs.
- APK build **55** SHA-256: `93568549b3a12d5c7513f353199d116431af2fbf509d6cb581873edb4d315ed7`; hosted and local copies match. Android cancelled both update attempts, so physical installation of build 55 is not confirmed.

## Release and limits

Only `/opt/relay-client` changed. Schema remains 014; no migration or operational-data rewrite. Database dumps were checked using pg_restore listing. Source/image rollback and asset rollback copies exist under:

- `/opt/relay-client/backups/role-access-before-20261001T062427Z`
- `/opt/relay-client/backups/role-access-before-20261001T062844Z`
- `/opt/relay-client/backups/client-assets-before-20261001T062521Z`
- `/opt/relay-client/backups/client-assets-before-20261001T062932Z`

This is a focused implementation and role-access regression audit, not an exhaustive penetration-test certification. Native iOS was not tested. Client commission rules remain unconfigured. Evidence, APK files and deployment secrets remain outside Git.

## Notification and UI follow-up — build 56

Notification categories now come from the backend role policy rather than a fixed set of tabs. Web and Flutter also check destination access before displaying or opening a notification. Record queries and read-state updates retain user/branch scope; foreign notification IDs cannot be marked read.

- Administrator/Operations: Transactions, Calls, Stock, Support, Workspace.
- Compliance: Transactions, Calls, Workspace. Flutter now also blocks stock, assets, incentives and support destinations, matching the web UI.
- Agents, Team Leaders and Branch Managers: Transactions, Stock, Support, Workspace. Leaders/managers receive confirmed sales updates with read-only destinations; no verification handoff.
- Sales Managers: Transactions, Stock, Workspace.
- Inventory Managers: Stock, Support, Workspace.
- Tele-verification and Welcome Call officers: Calls, Workspace. General workspace notices open their call workspace, not the restricted dashboard.

Verification for this follow-up:

- Full backend suite: **125 passed**, Ruff clean. Added category coverage across eleven accounts, authorized record destinations, and call-officer workspace notice routing.
- Full Flutter suite: **32 passed**, one existing optional visual-fixture test skipped; analysis clean. Production web, phone-demo and APK builds passed.
- Local browser regression: **32 passed**, covering role routes, dashboard links and notification visibility.
- Hosted notification checks: **13 passed**, covering eight web roles and five phone-demo roles, including notification navigation. Loaded desktop compliance and mobile notification screenshots visually inspected; evidence remains outside Git.
- Published web index, phone-demo JavaScript and APK match local SHA-256 values. No API HTTP 500 entries in the five-minute post-release log check.
- APK **56** SHA-256: `3668d68af7054b344d6eb200fbe0b879fb622beafd7dd9cc36a059cb8263b338`. Physical installation/testing of build 56 was not performed in this follow-up.

Client-only release: schema remains 014, with no operational data reset. Database dump manifests, old backend/image and assets were retained for rollback:

- `/opt/relay-client/backups/role-access-before-20261001T072553Z`
- `/opt/relay-client/backups/client-assets-before-20261001T072606Z`

## Physical Android follow-up — 2 October 2026, build 57

The connected Xiaomi Android device successfully installed the normal release APK, first build 56 and then build 57. Device package inspection confirms versionCode 57, versionName 1.0.0. This closes the earlier unverified-installation limitation for this Android device.

Manually exercised seven signed-in roles against the hosted backend: Field Agent, Team Leader, Compliance Officer, Inventory Manager, Sales Manager, Tele Verification Officer and Welcome Call Officer. Checked role-specific landing screens, notification category visibility, navigation and sign-out. Agent notifications opened the matching pending-confirmation invoice. The leader's branch update opened the confirmed historical invoice without verification controls. Call officers showed their call workspace and Calls/Workspace categories. Inventory and Sales Manager showed their own permitted categories.

A physical UI finding was corrected: the invoice header's New shortcut was visible to read-only users. It now requires evidence-write permission. Reinstalled build 57 and verified the shortcut is absent on the leader invoice. The shared phone demo was rebuilt with the same correction.

Camera permission, inline live camera and expanded capture view worked on the phone. Continue with empty customer fields remained in stage one and displayed required inputs/evidence. Capturing an ordinary room scene returned Customer details weren't captured clearly. Try again; no customer fields were populated and no transaction was submitted. This tests the observed negative case, not all possible false-document images. No valid document/order/confirmation journey was replayed during this focused role-access follow-up.

Flutter analysis passed; full Flutter suite 32 passed with one existing optional fixture skip. Production APK and phone-demo builds passed. Physical screenshots and UI dumps are under ignored output/qa/phone56-* and phone57-* paths. The sampled Android log check contained no fatal exception entries.

APK 57 SHA-256: `1aeb6863f7b6f1eb60a00554516275bbf06f2707e396ec42757a075bba8e787e`; hosted and local copies match. Client asset-only release backed up the database and prior files under `/opt/relay-client/backups/client-assets-before-20261001T210948Z` (UTC timestamp). Backend schema and business records were not reset.

After publication, the 13 hosted notification-category/navigation checks passed again against build 57's shared phone demo. The phone was left on the agent home screen with the normal release app installed.
