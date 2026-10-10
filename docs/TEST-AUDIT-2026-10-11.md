# Implemented workflow test audit — 11 October 2026

This is a fresh test run against the current October client workflow and build 71. It covers implemented behavior; it does not claim every possible device, image or load condition. Transaction-changing tests ran in isolated SQLite/PostgreSQL databases. Hosted checks changed authentication sessions only. Hosted operational samples, accounts, assignments and edited plans were preserved.

## Failures found and fixed

1. **SIM Excel import permission:** the administrator-only import helper did not enforce the effective `inventory.write` grant. A real PostgreSQL/HTTP test reproduced a 201 response after that grant was removed. The import and template now require the grant, and the web hides Add SIM/Import Excel without it. Regression tests assert 403 and no new stock, movement or audit rows.
2. **Capture validation:** after trying Continue with missing fields, successful OCR populated those fields but left their Required labels visible. Customer and order capture now clear missing-field flags only for populated, valid values. A widget regression and a physical build 71 screen check confirmed the correction.

Outdated test assumptions were corrected: calling mocks now match branch query strings; organization tests select an explicit reporting leader, use the accessible select control and do not assume a particular agent is on the first table page. A concurrent browser burst reached the isolated server's existing 600/minute limiter; paced reruns passed. Production rate limits were unchanged.

## Verified coverage

| Surface | Fresh result | What was checked |
| --- | --- | --- |
| Packaged backend | 405 passed, 3 warnings | Authentication, effective grants, branch/saved-owner scope, evidence validation, duplicate claims, drafts, independent review, stock, lifecycle rules, targets, calls, SR reports, commissions and exports |
| PostgreSQL HTTP/database workflows | 47 passed | Atomic invalid/duplicate Excel imports; simultaneous duplicate submissions; safe retries; original-date cancellations; SR matched/mismatch/pending state; preserved history after branch/leader transfer; stock and call sequencing; append-only audit and reduced import grants |
| Flutter | 148 passed; analysis clean | Capture/reset/reconnect, required evidence, receipt SR binding, roles, read-only destinations, invoice/printer, long values, spacing and larger text |
| Current browser workflow tests | 32 distinct tests passed across final runs | 22 focused portal tests plus 10 connected tests: actual branch/TL/agent management, targets, branch persistence, customer/SR history, optional receipt and no-receipt submission, backend/SR review, policies/manager access and shared drafts |
| Portal route/layout audit | 263 passed | All 11 demo accounts; 20 direct routes including denied destinations; administrator desktop/narrow views and sales/assets subpages; no page recovery, document overflow or recorded render/server errors |
| Hosted API roles | 11 accounts passed | Authorized reads and denied actions, caller scope, administrator capture restriction, current nine-sale dataset and approved policies |
| Hosted UI | 18 desktop, 6 narrow pages and signed-in framed demo passed | Real data loading, role controls and absence of render/5xx failures in this run |
| Physical Android | Capture and handoff passed | Live camera, unrelated-photo rejection, required-field blocking, real gallery customer/order/receipt extraction, save/resume draft, empty new transaction, receipt SR, invoice/printer, backend update and final build 71 validation fix |
| Physical submission to backend | 7 checks passed | Exact captured references/images stored; optional payment receipt recorded; independent review closes sale; phone/agent updates; SR independently pending; saved leader notified and denied review |
| Hosted stream/load check | 100/100 reads at concurrency 8, with 6 live streams | Heartbeats continue under load; revoking one session closes its stream and denies its token while other sessions remain connected |

The hosted stream run took 13.90 seconds: median 894 ms, p95 2701 ms, maximum 3198 ms. The API remained healthy with zero restarts and no out-of-memory event. These figures are measured test conditions, not a maximum supported user count.

## Release verification

Build 71 was released after deployment/database backup and rollback preparation, restricted to `/opt/relay-client`. Database schema remains 018. The environment checksum stayed unchanged. Seven public artifact hashes matched the release manifest, including the portal entry/bundles, framed demo entry/Flutter bundle and APK. The installed phone APK matched the normal release SHA-256 `fed4ee503f706eb3c1f00d3e1857db2a56b74fc08e947a485a88cd8e51364569`, with version code 71. The temporary QA connection and generated gallery test files were removed; the phone was left signed in to the production service as the sales agent.

## Limits and items still on hold

- One optional Flutter screenshot-fixture test remains skipped in the default suite because no fixture is configured. It is an older opt-in rendering harness, not a failed business test; current browser and physical rendering checks were run separately.
- Email delivery remains unverified because hosted SMTP is not configured. In-app notifications and persisted SR notice/outbox behavior were tested; no external delivery is claimed.
- Projection and incentive inputs not supplied by the client remain unconfigured under the existing agreement. Approved rates and the supplied CRR/DRR formulas were tested.
- OCR checks confirm readable evidence and bind parsed values to captures. They do not establish carrier settlement, document authenticity or universal accuracy on arbitrary photos. External activation remains evidence recorded by the salesperson and independently reviewed by backend staff.

Detailed logs, traces, isolated database evidence, screenshots, manifests, backups and generated binaries are retained outside Git in the private QA output/deployment backup locations.
