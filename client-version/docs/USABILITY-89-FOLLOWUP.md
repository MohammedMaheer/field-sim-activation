# Follow-up checks and fixes

Release 89 is a web/backend follow-up. Android and the mobile-demo bundle remain build88.

## Fixed

- Stock imports clear the browser's actual file selection after a successful import or branch change, keeping it consistent with the preview and receiving branch.
- Add/Issue dialogs start without the previous attempt's error. Required fields and server validation remain in place.
- Stock form submissions use a synchronous guard against duplicate submissions. Save buttons show Saving… and Cancel stays disabled until the request finishes. Stock mutation actions cannot open another form while a save/import is running.
- The call-count header endpoint uses scoped task progress rather than loading full customer, evidence and SR views for every task. Detailed queues and badges share the same state/timing rules. Counts, overdue behavior, sequence warnings and branch/role restrictions are unchanged.

## Evidence

- Five stock edge cases reproduced against the previous UI before fixing them. The final focused UI run passed 30 tests, including those five cases, existing stock adjustment behavior, grant restrictions and responsive layouts.
- Backend regression run: 280 tests passed, including 30 summary/queue equivalence cases across ten roles and all/selected/missing branches. The summary test fails if sale/evidence serialization is attempted.
- A read-only comparison against hosted records matched all six summary fields for eight evaluation roles. PostgreSQL transactions explicitly rejected writes during this comparison. Queries fell from 24–59 to 6–9 per summary, without customer/evidence/SR serialization.
- Additional hosted navigation passed for sales agent, team leader and tele-verification roles. The initial administrator subpage tour exposed a slow background call-summary request; it is retained as diagnostic evidence rather than counted as passing.
- Production build passed. Screenshots, logs, raw before/after measurements, release manifests and backup/restore evidence are retained in ignored `output/qa/usability89-*` files.
- After publishing, the administrator subpage tour passed all 44 desktop/phone-width views. Sales-agent, leader and tele-verification tours covered another 28 views. Six hosted Add/Move/Issue dialogs passed focus containment, Escape, focus restoration and horizontal-overflow checks without submitting operational changes. Public web hashes matched; the API was healthy with zero restarts/OOM.

No operational records, assignments, incentive rules, payment/SR requirements or role grants were changed. Release is limited to `/opt/relay-client`, with a deployment/database backup, restore verification and rollback image. Schema remains 023.
