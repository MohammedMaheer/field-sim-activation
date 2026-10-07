# Implementation recheck - 7 October 2026

## Status

**The reviewed fixes are published, and fresh hosted checks passed.** This report records the completed checks for this turn and identifies the remaining business-rule decisions and physical-testing limits. It does not claim complete coverage of every requirement or every screen. An additional backend rerun in the exact released container is still in progress at this update.

The acceptance basis is the complete `Modern_Trade_Software_Project.docx`, extracted again into ignored `output/qa/client-requirements-20261007.txt`, together with the owner's later workflow and access clarifications. The maintained product is the client edition only. Previous evidence is recorded in [REQUIREMENTS-AUDIT-2026-10-02.md](REQUIREMENTS-AUDIT-2026-10-02.md); its earlier results are not counted as new checks today.

Requirements document SHA-256: `4184d9cf7881980880e552e0153a90903aea5af66e6d7ad38aa3e33019d7f6cb`.

## Workflow and scope checked

Activation occurs outside Relay on the salesperson's existing device. The current shared journey captures the customer-details screen, the order-details screen and the order-created/request-ID confirmation; the agent checks and submits the captured information. Backend staff independently compare the stored evidence with the fields and confirm or return the transaction. The sale's saved branch leader receives a read-only update after backend confirmation, without an approval or verification action.

The request ID is an agent payment record, not a payment method or proof of payment settlement. Current receipts use **Payment recorded / Pending backend confirmation** until independent review. Missing information remains **Not recorded**. Historical activation receipts and assignments remain available. Barcode/signature capture is not part of the new screenshot flow. Location, territory and geofencing remain excluded.

Web, Android and the signed-in phone-framed web demonstration use the same role-scoped API and records. Tests that change operational data use isolated PostgreSQL QA; they do not reset the hosted dataset, accounts or edited plans.

## Corrections made during this recheck

| Area | Change and expected behavior |
|---|---|
| Closed-agent stock assignment | New SIM and field-asset assignments reject exited agents on the server. Assignment selectors exclude closed agents. Historical stock can still be returned or accounted for. |
| Transfer history | Previously consumed, returned and retired equipment stays attached to its original branch/assignee history. It is not carried or relabelled as current stock when the agent transfers. |
| Branch leader editing | The generic leader editor cannot move a leader into a closing branch or create a second leader in the destination branch. Replacement uses the designated branch-leader assignment flow. |
| Lifecycle concurrency | Agent and active-branch lock reads refresh cached database state. A conflicting update returns a retryable 409 promptly and rolls back partial work, avoiding the tested stock/agent-transfer lock cycle. |
| Target lifecycle and scope | New target writes reject exited agents. Single-entry and file-import writes recheck current leadership/access after locking, preventing a previous leader from writing targets after a concurrent transfer. Historical targets remain available. |
| Branch statistics | Branch totals are accumulated without a separate outlet lookup for every order. The reconciliation test checks unchanged counts and the bounded outlet-query count. |
| Call notification links | Completed, blocked and unauthorized-stage calls open a readable queue item without exposing an outcome form. Cancelling a selected call removes the selection so background refresh does not reopen the form. |
| Mobile request/call forms | Stock-request forms scroll with the keyboard. Call-card actions wrap on narrow screens. Request and call forms no longer dispose an externally owned text controller during the closing transition. |
| Evidence comparison | Download original follows the selected customer/order/confirmation evidence. Current screenshot transactions use customer/order wording and **Backend confirmation complete** after review. |
| Compact screen labels | Status badges wrap without clipping, and long record IDs are contained on narrow screens. The shared journey rerun and a 390px manual review checked the final corrections. |

## Executed checks this turn

- The final complete backend suite passed **136 tests**. Ruff is clean. This includes the cached-lifecycle regression; focused reruns are not added to the suite total.
- **7 focused backend regressions passed** after the lifecycle changes: target file validation/scope, exited-agent stock rejection, leader branch guards, exited-agent target rejection and cached agent/branch refresh. The Windows sandbox prevented SQLite access in the first attempt; the normal temporary local test database passed outside that sandbox.
- **4 deterministic PostgreSQL lifecycle checks passed** in isolated `relay_rigorous_qa_20260930063656`: stock edit versus agent transfer returns 409 without a partial edit and lets the transfer complete; cached EXITED/CLOSING rows refresh; previous-leader single and CSV target writes are rejected after a transfer between scope checks; held branch locks return 409. The runner preserves append-only audits and removes its synthetic business records. These checks are in `backend/tests/postgres_lifecycle_check.py` and are not part of the default SQLite suite.
- **64 distinct browser/API workflow scenarios passed across the final main run and one necessary rerun.** The main run passed 63 and failed the shared journey only at a CSS computed-display assertion: an `inline-flex` badge in a flex layout computed as `flex`. The test was corrected to measure the badge's actual height and containment; the complete shared journey then passed in 39.7 seconds. Application source was unchanged between those two runs. This is not a claim that all 64 were green in a single suite, and the repeated scenario is counted once. Logs and evidence are retained in the final-e2e and final-shared folders under ignored `output/qa/recheck-20261007*`.
- Flutter: **37 tests passed**, with **one optional fixture visual test skipped**. Current web, phone-demo and APK builds were published; the served assets matched the local release outputs.
- **9 visual/navigation scenarios passed**, covering **68 desktop/narrow route and subpage views**. The last badge/record-ID corrections were additionally checked by the complete shared-flow rerun and a manual 390px backend-review inspection. Screenshots and traces are retained under ignored `output/qa/recheck-20261007*`; automated visibility/layout assertions do not certify every pixel.
- The earlier Android **1.0.0+60** check stopped at a locked phone. The later unlocked physical follow-up is recorded below and supersedes that limitation.
- **37 fresh hosted scenarios passed** after publication: 11 web role/direct-link cases, 7 phone-demo role/direct-link cases, 13 notification cases, 4 call-selection cases, one stock-assignment-options case and one read-only stock/lifecycle case. Log: ignored `output/qa/recheck-20261007-hosted.log`. These are published role/UI checks, separate from the isolated mutating workflow tests.
- GitHub automated runs are blocked by the account's reported billing restriction. Local/isolated checks are reported separately; no passing hosted CI run is claimed.

## Requirement coverage and remaining decisions

The reviewed implementation contains individual sign-in and server-side role/branch scopes; staff and current/historical supervision; all seven sale types; manual entry and screenshot submission; no-sale feedback; daily/monthly/product targets and uploads; filtered sales/status import/export; separate tele-verification and welcome-call queues/history; categorized in-app notices; independent backend evidence review; stock/assets/SIM categories, requests, shortage thresholds and reports; and guarded staff/branch departure workflows. This is an implementation inventory, not a new claim that every area passed exhaustive testing today.

The SIM business categories and explicit branch closure/relocation added in the 2 October follow-up are present. They are no longer reported as missing internal work. Reports retain saved sale assignments after a transfer; current assignments do not rewrite that sales history. Branch completion requires outstanding stock, active agents and pending work to be accounted for.

These items still require approved business decisions or remain explicitly on hold:

1. **Commission and forecasting rules:** commission slabs, eligibility, cancellations/reversals, CRR, DRR, projections and performance-deduction forecasts remain unconfigured as instructed. The document references a commission attachment, but the supplied file contains no usable commission table or formulas. Client rules are needed before calculation and commission-rule upload/configuration can be finalized.
2. **Configurable stock deduction:** the existing fixed trigger consumes a matching owned SIM exactly once on independently confirmed CLOSED status. A management-configurable trigger and cancellation/return policy are not complete; the client must approve their behavior while retaining the independent evidence gate.
3. **Sales Manager boundaries:** assigned-branch reporting is the current restricted default. The document explicitly asks to confirm the exact teams/locations and cross-branch access area.
4. **Product-specific calls:** separate tele/welcome queues work with the current sequential default. The applicable products and any exceptions need the client's routing decision.

Carrier APIs, payment gateways, automated calls, SMS, external push and biometric approval are not unfinished requirements of the clarified screenshot/manual-call workflow. Recognition does not establish identity authenticity or payment settlement and does not replace independent staff review.

## Release and limits

The client-only release completed. Backup: `/opt/relay-client/backups/recheck-before-20261007T121712Z`. Its database restore rehearsal matched live schema **015**, business-record counts and account/plan hashes. The preserved counts were accounts **23**, plans **8**, agents **12**, captures **12**, sales **3** and SIMs **96**. No production operational reset was performed.

All six released backend source files, the web index, phone-demo `main.dart.js` and APK matched the local release files. Published Android package: **1.0.0+60**, SHA-256 `f9f8fa3b034b9bd378a54240a8fb45b3008d14eeeea35d3b036cb94dcd0b6fab`. Fresh hosted checks passed as recorded above. Only `/opt/relay-client` was changed; other VPS applications remain independent.

The exact released backend image also passed **136 tests** in a separate offline Docker container using temporary SQLite records. The first attempt encountered two missing test-only PDF-reading dependency errors; the declared development `pypdf` dependency was supplied, and the complete rerun passed. Log: ignored `output/qa/recheck-20261007-runtime-final.log`. This repeats the workspace suite and is not added to its unique test count.

The later physical follow-up completed a synthetic native three-screenshot journey. Native iOS, real-device capture accuracy certification, sustained load testing and penetration-test certification remain outside the executed checks. The phone-framed browser demonstration is not a native iOS test.

## Unlocked physical follow-up — 7–8 October

The USB connection was initially intermittent, then remained usable for the physical checks. The phone is a Xiaomi 24116RNC1I running the normal hosted-API Relay Client package. No lock-screen bypass or device security change was used.

The physical checks and related regressions found six issues:

- Drafts replaced the navigation stack when starting or resuming a transaction. New and Resume now preserve the return route; Android Back returns root Drafts to Home, and capture has an explicit Back button.
- Empty saved-image strings falsely displayed **Selfie saved** and suppressed an uncaptured order camera. Empty/whitespace images remain uncaptured, while actual saved images remain available.
- The empty phone-demo scanner overflowed by 6px at 390px. Its inner spacing was reduced without hiding text.
- Offline draft loading lost the saved order stage and skipped the account-scoped cached plan catalog. A network-failure regression now checks stage and cached plan restoration. This offline case was tested with controlled widget responses, not by changing the phone's network settings.
- The printer animation revealed the footer before the receipt heading. It now reveals the heading first and grows downwards; tests check visible clipping, hit targets, replay and reduced motion.
- **New** on an opened invoice cleared its loaded record while retaining the old record route, resulting in **Transaction unavailable**. It now pushes a fresh customer-capture route with blank fields and preserves the invoice return route.

### Connected native workflow

One synthetic customer/order/confirmation journey was performed on build 61 through the Android photo picker and shared API. Customer name, document number, nationality and dates were extracted from the customer screenshot. The order screenshot supplied the package, matching plan, order type, phone, request ID and explicitly shown monthly/prepayment charges. No missing SIM or selfie was invented. The later builds change client navigation, draft restoration and printing; the shared submission/review API remains unchanged.

The final confirmation upload produced **Payment recorded / Pending backend confirmation**, an animated invoice and a shareable PDF. The agent saved the extracted rows and submitted them through the native UI. Independent Administrator review compared all three original images and fields in the hosted web panel, downloaded matching originals, exported Excel and verified this one record. The same transaction then appeared as VERIFIED in the agent API and native leader invoice, and CLOSED in scoped sales views. The assigned leader received a read-only confirmation; another branch leader could not access the capture. Tele-verification became PENDING and welcome call remained BLOCKED. SIM stock did not change because the screenshot contained no SIM identifier.

Record: capture `8cfd9cb5-cfdf-45ba-a818-74111a65b713`, request `NATIVE-20261007-2230`, linked sale `2ae4a9ce-f4c6-4217-8e95-096461eca57e`. This single sample is retained for evaluation. Temporary native regression drafts were discarded through their own UI; pre-existing drafts, accounts and plans were preserved.

### Other physical checks

- Agent dashboard shortcuts, daily report, stock view, evidence progression, saved/blank/resumed drafts, native Back and support required-field validation.
- Live camera behind the scanner; a photo of a surface without customer details was rejected with **Customer details weren't captured clearly. Try again.** Continue remained blocked and no fields were populated from that photo. This demonstrates rejection of the tested image, not identity-authenticity certification.
- Stock-request, target and tele-call forms with the keyboard open: controls remained reachable; cancellation/reopening reset temporary form values. Cancelling a selected call stayed cancelled after queue refresh.
- Administrator, agent, branch leader, Compliance Officer, Sales Manager, tele-verification and welcome-call account views. Leader confirmation was read-only; Compliance Officer and Sales Manager lacked the Administrator target editor; call roles had only their queues/notifications. The Sales Manager saw its assigned branch records, while Compliance Officer saw its wider authorized register.
- Categorized native notifications and permitted links, pending/verified invoice state, PDF share-sheet opening without sending, and sign-out followed by Android Back/relaunch returning to sign-in.
- App-only runtime log checks found no Flutter exception, layout-overflow or disposed-controller errors in the inspected final-build session.

Evidence is retained outside Git in ignored `output/qa/native60-*`, `native61-*`, `native62-*`, `native63-*` and `phone63-*` artifacts. Screenshots/IDs contain synthetic records; no real customer data was used.

### Final build 63 checks and release

- The final Flutter suite passed **45 tests**, with **one optional fixture visual test skipped**; Dart analysis reported **No issues found**. The new regressions cover draft stack behavior, empty/captured images, offline stage/cached-plan restoration, narrow scanner layout, printing geometry/replay/reduced motion, and fresh capture from an existing invoice with both Back actions. The initial invoice fixture omitted a required `source_reference`; it was repaired to match the API contract. A native imperative-push URL expectation was removed because GoRouter does not reflect that push in route information by default; visible blank fields and invoice restoration remain asserted.
- **12 hosted mobile role/deep-link/notification scenarios passed** on build 62. After the final build 63 publication, a targeted hosted journey passed New-from-Drafts, Resume-and-Back, root-Drafts-to-Home, and New-from-existing-invoice-and-Back, with no browser errors. These focused reruns are separate from the earlier 37 hosted scenarios and are not presented as additional unique broad coverage.
- Normal **1.0.0+63** installed successfully. Its installed APK byte hash matches the packaged release. Physical New showed blank customer fields, no old evidence and an active camera; a no-document view left those fields empty. Android Back and app-bar Back both restored the original verified invoice. Three final native animation frames show the heading first, then the details printing downwards. The app-only log contained **zero matched Flutter exceptions, layout overflows or disposed-controller errors**. The phone was left signed in on the agent Home screen.
- The client-only final release completed with backup `/opt/relay-client/backups/recheck-before-20261007T184404Z`. Its isolated database restore matched live schema **015**, account/plan hashes and counts: accounts **23**, plans **8**, agents **12**, captures **13**, sales **4**, SIMs **96**. The extra capture/sale is the retained native synthetic journey described above. Existing accounts, edited plans and operational records were preserved.
- APK SHA-256: `74e88166b4476134110f3ec7d9632e89b079a52e646a5675e26925a541f85e0e`. Phone-demo `main.dart.js` SHA-256: `1c076ebff396972f535f97f7e22d557d6a74d254c5a8b8e4a25be42ca59704e1`. Full public downloads of the web index, phone wrapper, demo JavaScript, bootstrap and APK matched the final local byte hashes; public health returned OK. The final client changes do not alter backend schema or business rules. Other VPS applications were not changed.
