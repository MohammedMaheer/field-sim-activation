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
- Android **1.0.0+60 is installed** on the connected phone. The phone was locked during the attempted final screen check, so no new completed physical screen inspection is claimed here.
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

No new complete valid native three-screenshot journey, native iOS run, real-device capture accuracy certification, sustained load test or penetration-test certification is claimed. The phone-framed browser demonstration is not a native iOS test. The connected phone remains securely locked at this point, so final physical screen verification is still unavailable.
