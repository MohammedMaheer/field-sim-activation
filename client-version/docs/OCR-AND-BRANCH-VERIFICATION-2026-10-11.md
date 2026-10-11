# Branch setup and reliable OCR — build 76

## Implemented behavior

- Staff setup follows **Branch → Team leader → Sales agent**. Creating a branch retains that branch for leader setup; creating a leader retains that leader for agent setup. Agent choices are restricted to the selected branch. An agent cannot be created without a designated leader. Creating a leader does not reassign existing agents.
- Web capture, Flutter Android and the phone-framed web demo use the same persisted customer, order and receipt OCR jobs. The demo retains its synthetic photo shortcuts and uses the same authenticated API and database.
- Replacing a customer photo clears its old recognized fields and dependent order/receipt fields. Replacing an order photo clears old plan, request, charges and receipt/SR fields. Late results cannot fill a newer photo or another signed-in account. Retrying the same operation does not enqueue duplicate work.
- Required fields must come from readable evidence. Unrelated, blank, conflicting or low-confidence captures do not receive a usable recognition proof. Recognized supporting values are also bound to the photo; genuinely absent supporting values remain editable. The saved original image and extracted text remain available to independent backend review.
- Passport MRZ identity, birth and expiry check digits are checked before autofill. Only a unique active plan match is selected. Only an explicitly labelled, unambiguous SR is extracted; an order request ID is never treated as an SR or proof of payment settlement. Missing values remain **Not recorded**.
- Upload and submission limits now agree for receipts: PNG/JPEG up to 4 MB, with existing image safety checks retained.

## Queue design and operating limits

The existing PostgreSQL database owns admission and processing leases. This avoids a second queue service on the current small deployment. PostgreSQL explicitly supports `SKIP LOCKED` for queue-like consumers; FastAPI recommends a separate worker system when substantial background workloads require more independent processes/servers. Sources: [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html), [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).

| Control | Current behavior |
| --- | --- |
| Admission | Transaction-scoped lock makes count-and-insert atomic; at most 20 active jobs across stage and historical capture paths, at most 2 per user. Saturation returns retryable status, not an unbounded backlog. |
| Idempotency | Unique owner/operation identifier; retries return the same job. Reusing that identifier for a different image or stage returns a conflict. |
| Processing | One OCR resource lease across API processes and historical scanners on this deployment. Ordered stage-job claims use `SKIP LOCKED`; no database connection remains checked out during Tesseract execution. |
| Recovery | 90-second leases, token-fenced completion, maximum 3 crash/timeout attempts, bounded backoff. Expired workers cannot overwrite a newer result. |
| Bounds | Tesseract timeout 45 seconds; single-frame PNG/JPEG, 4 MB, 6 million pixels; queued jobs expire after 15 minutes. |
| Temporary data | Encrypted input/result. Stage input removed on completion or terminal failure; results retained at most 24 hours and the temporary table bounded to 500 rows. Historical submitted evidence remains permanent. |
| Client behavior | Polls queue status, retries temporary network/capacity failures, retains the photo after a 120-second wait, and permits retry of the same operation. Changed account/photo/stage cancels result publication. |
| Access | Capture role and effective permissions checked at creation, reads, processing and completion. Jobs are owner-private; another owner receives a non-disclosing 404. Administrators and reporting/review-only roles cannot capture. |

This is a bounded queue for the present CPU/memory budget, not a claim of unlimited throughput. If measured queue waits or rejection rates become sustained under the agreed concurrent-agent load, move consumers into dedicated workers and increase capacity in measured steps. Keep idempotency, encryption, ownership checks, token fencing and admission limits when doing so. A horizontally scaled worker system is a future deployment decision, not needed to serialize the current deployment safely.

## Verification

- Backend regression suite uses the production Python 3.12 image with SMTP disabled and a disposable database: **477 passed**, three warnings. A separate focused parser run also passed all 12 cases, including a real photo exceeding the previous receipt payload limit.
- Flutter analysis: no issues. Flutter tests: **200 passed**, one existing skipped integration test.
- Web role, capture and branch tests: **32 passed**, including branch creation at desktop and 390 px widths, multiple leaders, explicit agent selection, busy/retry behavior and clearing stale order values.
- Connected phone-framed demo → shared API → administrator evidence page: **passed**, including stored payment image, extracted SR and pending SR state. Screenshot evidence is private.
- Actual Tesseract processing of three concurrent synthetic customer/order/confirmation images: **passed**. Verified printed name, document number, dates, nationality, request, phone, package and shown charges. A confirmation containing only a request ID did not invent an SR.
- Actual negative recognition: unrelated photo, blank image, conflicting identity values and conflicting SR values did not receive usable proof. A clearly printed SR was extracted correctly.
- PostgreSQL 17 concurrency tests: **5 passed** for admission races, owner-private idempotency, single processing ownership, zero DB checkouts during extraction, lease recovery/stale completion rejection, and bounded crash retries.
- Physical Redmi Android phone: customer upload/autofill → order upload/autofill → optional receipt OCR → submit → animated invoice passed against the isolated API. Administrator API returned the same saved fields, receipt and SR. New transaction cleared the previous details. An unrelated image displayed a recapture error and could not advance.
- Migration 019 → 018 → 019 was rehearsed on an isolated PostgreSQL clone. The migration adds temporary OCR jobs and historical worker lease fields; downgrade does not remove sales, evidence, accounts or plans.

Recognition is not identity authenticity verification and cannot guarantee perfect transcription of arbitrary camera images. Current checks reject detectable ambiguity and missing evidence; backend staff still compare original evidence with the extracted values. The owner's older attached phone photographs were unavailable on disk during this run, so actual-engine accuracy checks used controlled synthetic screens, not those unavailable photographs.

## Release record

Build **1.0.0+76** is published to the existing client web portal, phone demo and APK download. Production schema is **019**. The deployed API image is exactly the tested image (`904e37970ee2`). Its container is healthy, with zero restarts and no OOM.

- Deployment/database backup: `/opt/relay-client/backups/ocr76-release-20261011T143353Z`.
- Before/after migration fingerprints match for users, plans, sales, branches, agents, SIM stock, captures (excluding the newly added lease fields), targets, current drafts and support tickets. The deployment environment file is unchanged. No seed/reset operation was performed.
- All **232** release files were hash-verified before and after publication. Public HTTPS hashes match the local portal entry point, compiled mobile demo, wrapper script and normal APK.
- Published concurrent actual-engine customer/order/receipt extraction, exact-operation replay, owner privacy and non-capture role restrictions passed. The test correctly retried the queue's admission-lock contention response using the same operation identifier. These checks created temporary OCR jobs, not operational sales.
- Published browser checks passed for setup tab order, desktop and narrow layout, branch-filtered leader dropdown, password-free demo account selection and stable home action position across a 22-second idle refresh. No JavaScript page errors were observed.
- The normal APK is restored and signed into the hosted service on the physical phone. Installed version code is **76**; its SHA-256 matches the downloaded release: `928256f33dcd30656e5fae633c712a94d02b855f6e2450f47db5467ffb3d9353`.

Rollback: stop the client API, restore the saved deployment and previous image (`relay-client-api:before-ocr76-final`), and leave the additive schema 019 in place for compatibility. If a schema downgrade is necessary, first drain OCR and use the rehearsed 019→018 migration. Database restoration is a separate recovery action because it would discard writes made after the backup; never restore it over active newer records casually. Other VPS applications and the earlier full edition were not changed.
