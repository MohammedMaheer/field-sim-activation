# Deep workflow verification — release 91

This pass uses the maintained client product and current October workflow. Hosted operational records are not reset. Mutating checks run on a disposable, internally networked PostgreSQL service with fresh synthetic records, current backend sources and SMTP disabled.

## Issues found and fixed

1. **Concurrent sales shared an exclusive branch/leader lock.** Two different sales agents could receive an assignment-update conflict during ordinary simultaneous submissions. Branch and leader validation now take shared row locks. Agent mutation locks remain exclusive and nonblocking; branch closure and leader reassignment still conflict with active capture validation. Two new real PostgreSQL tests failed before the change and passed after it.
2. **Starting a new web transaction could race an upload into the old intake.** The previous capture form remained usable while its draft reset was in flight. The form now shows Preparing your transaction until reset completes. Failure restores the previous fields and an actionable error. A deterministic delayed-reset regression failed before the fix. Successful reset, rejected reset, scanner backpressure and order recapture now pass.
3. **The missing-team-leader handoff lost the selected branch.** Moving from an agent form to Team leaders now preserves the authorized shared branch. The dedicated team-leader form starts in the intended branch. Its regression failed before the one-line fix and passes afterward.

## Final automated coverage

| Area | Evidence |
| --- | --- |
| Full backend suite | 772 passed, 3 PostgreSQL-specific skips in SQLite. The two new membership-lock cases pass separately on PostgreSQL; the existing withdrawal race is exercised through real PostgreSQL HTTP requests. |
| Flutter | Analysis has no issues; all 310 tests passed, with one existing skipped test. |
| Consolidated browser suite | All 118 checks passed in one run. Includes role/grant restrictions, notifications, assignment forms, scanner retries, stale responses, geofencing controls, exports/printing, responsive dialogs and large text. |
| PostgreSQL browser workflows | Independent evidence comparison; correction/resubmission; customer-call requirement; agent/leader read-only confirmation; agent withdrawal; shared drafts and cleared new captures; receipt SR OCR reaching the same admin record; branch location and stale edits; approved commission preview/import/replay; daily Admin versus Super admin; shared branch boundaries; historical sales preserved after leader/branch changes. |
| Real downloads | All eight report types in CSV, Excel and PDF, plus all three final incentive formats. 27 real files checked for nonempty content, expected signatures/names and shared branch/date parameters. |
| Real concurrency | Exact sale retries return one capture/sale; competing receipt/request/SR submissions give 201/409 with duplicate messages; repeated withdrawal returns one feedback; submit versus withdrawal produces one terminal outcome. |
| Scanner capacity/privacy | Concurrent exact OCR operations retain one job; busy admission returns 429 with Retry-After and safe replay. Another sales agent gets 404 for the job. A random solid-color image reaches FAILED rather than a usable identity proof. |
| Stock consistency | Concurrent backend reviews produce 200/409, a closed sale, activated SIM and exactly one new stock movement. |
| Bounded parallel reads | 24 requests over six workers all returned200 on the isolated API. This is a contention smoke check, not a production capacity guarantee. |

The earlier broad run exposed stale test selectors for retired report cards, the old sequential setup wizard and the hidden commission-estimate view. Those tests now exercise the current selector-based reports, separate management dialogs and explicit Estimates action. All access restrictions remain asserted. Three SR fixture teardown errors were corrected by deleting newly created transaction outcomes before their referenced captures. Production deletion behavior was not changed.

A busy earlier QA run reached the real sign-in rate limit on two evaluation accounts. The final suite passed after restarting only the disposable service, with normal rate limits unchanged. No authentication safeguard was relaxed to make tests pass.

## Physical Android check

The connected phone runs normal build 88. Inspected stock requests, notifications, grouped workspace navigation and support. No ticket, sale, work session or location collection was started. Three stationary samples, eight seconds apart, retained identical app labels and control bounds on Sales management. Screenshots were inspected; this short observation does not establish the absence of every possible rendering issue.

## Release and limits

This changes shared API membership locking and two web interactions. The Android APK and mobile-demo bundle are unchanged; both use the shared API fix. Schema remains 023. Publishing is limited to `/opt/relay-client` with deployment/database backup, isolated restore and table-fingerprint comparison, unchanged environment/APK checks, manifest verification and a retained previous API image for rollback.

Evidence, screenshots, traces, download samples and release logs are retained outside Git in `output/qa/deep91-*`. No credentials, database snapshots, captured images or generated binaries are committed.

Passing these checks does not prove every possible device, poor-quality camera image or production load level. Carrier activation, gateway settlement and real email Inbox delivery are not simulated as successful. Client-policy inputs that remain unapproved, including the held projection/commission interpretation questions, are unchanged.

## Published verification

All 13 PostgreSQL browser workflows passed together in the final rerun. After publication, all seven focused regressions passed against the hosted web assets, and the Super admin navigation tour passed all 38 desktop/phone-width destinations. Public HTML/JavaScript and all eight published files matched their manifest. The shared API was healthy, with zero restarts and OOM false. The installed Android app remained connected after release.

The production backup was restored into an isolated database; every table fingerprint matched and no operational records changed. Environment, compose configuration, APK and mobile-demo bundle hashes were preserved. Only runtime sources/assets and this report were published; regression tests are maintained in Git.
