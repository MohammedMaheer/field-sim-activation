# Qanawat implementation audit — 12 October 2026

The maintained client edition was checked against the current October clarification, existing implementation and role permissions. This audit uses fresh synthetic transactions in isolated PostgreSQL copies. It does not replace hosted operational records, accounts or edited plans.

## Fixes made

- Management writes now require effective permissions as well as the correct role. This covers organization setup, staff assignments, master records, stock changes/requests, targets, sales correction, status imports and call outcomes. Reduced permissions hide corresponding web/mobile actions and also prevent direct API writes. Read access and separately granted stock/commission permissions remain independent.
- Queued SR emails no longer qualify a recipient whose data-read permission has been revoked. Regression tests use mocked delivery; no customer email was sent.
- The sales agent's Daily target dashboard shortcut now opens their authorized product-target page rather than an inaccessible report page.
- Long sales agent and branch names wrap in Live operations, keeping the Details column visible at desktop width and preserving the mobile card layout.
- Audit fixtures now follow the current screenshot-sale workflow, Qanawat labels and real role grants. The browser account-picker test waits for the Flutter menu to open before scrolling. The packaged browser demo includes its required phone-frame wrapper.

## Evidence and coverage

| Surface | Fresh verification |
| --- | --- |
| Backend | 516 tests passed in the deployment Python 3.12 runtime; three warnings. SMTP disabled, disposable test database. |
| Flutter | Analysis clean; 208 tests passed, one existing skipped test. Separate visual rendering passed and generated 22 private screenshots. |
| PostgreSQL races | Four lifecycle groups and five durable OCR queue groups passed against PostgreSQL 17 using the actual release image. |
| Connected HTTP workflow | Nine groups passed: branch/leader/agent setup, actual Tesseract customer/order/receipt extraction, drafts, same-record admin evidence, idempotent retry and duplicate rejection, independent review/one-time stock deduction, ordered calls, SR reconciliation/cancellation totals, all seven targets, support/feedback and filtered exports. |
| Physical Android | All ten roles completed their authorized-page checks on the Redmi phone. Evidence includes permitted/forbidden capture, management visibility, sales/details/targets, stock, drafts, notifications, support, commission and call views as applicable. |
| Browser | The broad run executed 140 cases: 129 initially passed, eight required investigation, and three stock/lifecycle cases were initially gated. All failed/gated cases subsequently passed: the final framed-demo/layout/stock/support run passed 41 cases, and the previously timed-out Compliance Officer navigation passed separately. Additional focused permission checks passed 48 cases. Counts overlap and are not added together. |
| Documents | Actual sale receipt PDF, sales/stock PDFs and Excel exports inspected. Receipt is one page; report text lies within page bounds, uses Qanawat branding and preserves all report fields. Sample first/last report pages were rendered and visually inspected. |

The broad browser audit includes ten roles' visible navigation, direct forbidden links, account/branch scope, backend comparison and review, SR import, customers, sales, calls, branches/leaders/agents, inventory edits/imports, plans, reports, support, notification categories/links, current desktop/narrow dialogs, recovery/retry states and receipt printing. Physical checks include lower sections and subviews, rather than only each page's first screen. Private screenshots and traces are retained outside Git under `client-version/output/qa/audit77-*` and `output/qa/android/audit77-*`.

The initial browser failures were: long-name roster overflow; four bottom-account selection checks racing the menu animation; one transient Audit log load timeout; and two checks using the phone host while the local preview was incorrectly packaged without its wrapper. No blanket success is inferred from that first run.

## Boundaries

- Actual OCR was tested on controlled synthetic checkout screens, with invalid/ambiguous evidence cases covered by the backend suite. This is recognition and evidence consistency checking, not document authenticity verification or a guarantee of perfect transcription of every photograph.
- Approved rate tables and CRR/DRR calculations are implemented and tested. Unapproved commission eligibility/allocation/slab mapping and projection policy remain awaiting the client's guidance, as documented in the October clarification.
- SMTP configuration and actual recipient inbox delivery remain unverified. Notification visibility, saved recipients and queued-email access revocation are tested independently.
- PDF/browser receipt printing is checked; a physical paper printer was not available for a paper-output test.
- Tests exercise bounded concurrency and worker recovery. They do not establish an unlimited-load or production-scale capacity guarantee.

## Final release verification

Build **1.0.0+77** is published. Schema remains **019**; this release contains no data reset or migration.

- Fresh deployment/database backup: `/opt/relay-client/backups/audit77-release-20261012T063512Z`. The database archive's restore listing was checked. Deployment rollback restores the previous files and API image (`relay-client-api:before-audit77-final`); no database restore is required for this code-only rollback.
- All **250** packaged files were verified before and after publication. Before/after fingerprints match for users, edited plans, sales, branches, agents, stock, captures, targets, drafts and support records. Environment settings are unchanged.
- Deployed API image matches the tested image: `058fc4f39eebcf92fde987a674f78f54cd5e1a007d1630e7f304cb2fd7268a70`. Health check passed; zero restarts and no OOM at release verification.
- Public HTTPS hashes match the local portal entry point, phone-demo wrapper/compiled script/bootstrap and final APK. APK SHA-256: `d7ed228831f2da82fea5ae20584a7ba2d29bf1b752dd41084a1d263e1e9af101`.
- The owned isolated API/database containers were stopped after testing; operational audit records exist only in their private backup/evidence. The production database was not seeded or reset. Other VPS applications and the older full edition were not changed.
- Hosted verification after publication passed **17 cases**: all ten roles' visible navigation, administrator subviews at desktop/narrow widths, account selection and Live operations. The three failures from the earlier hosted baseline did not recur. Post-release log inspection showed no traceback or 5xx response during this run; health remained healthy with zero restarts and no OOM.
- The normal APK is installed on the physical Redmi phone and signed into the hosted service as the sales agent. Installed version code is **77** and its APK hash matches the published release. The Daily target card opened the Targets tab with all seven products. Android initially cancelled installation; after the owner's approval, the visible Qanawat USB installation prompt was accepted successfully. The temporary QA app is no longer installed and its local API forwarding has been removed.
