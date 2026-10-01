# Role access audit — 1 October 2026

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
