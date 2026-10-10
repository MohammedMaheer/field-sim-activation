# Client capacity and record integrity

The client edition keeps authoritative state in PostgreSQL. Web, Flutter and the signed-in framed demo share the API. A sales agent keeps ownership of their submitted records across reassignment; each sale retains the branch and designated team leader saved at submission. Historical filters use those saved assignments and never grant access to another agent's records.

## Duplicate submissions

Schema 018 adds durable unique identity claims for normalized request IDs, explicitly recorded SR numbers and exact order/receipt image hashes. Request and SR namespaces remain separate. A customer's identity document is not a duplicate key: another legitimate order for that customer remains allowed. The database resolves simultaneous submissions atomically; clients show a clear already-recorded/processing message and keep entered details. Exact accepted operation retries return their original result. Cancellation/rejection preserves claims so the same event is not counted twice. Earlier duplicate history remains unchanged during migration.

## Load safeguards

- PostgreSQL connections are bounded per process: `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2`, `DB_POOL_TIMEOUT=5` by default. A capacity timeout returns 503 with a retry hint; queries do not open unlimited connections. SQL logs hide bound parameters.
- OCR uses one local Tesseract process at a time per API process by default (`OCR_CONCURRENCY=1`, configurable up to four). Input sizes, decoded pixels and subprocess duration are bounded. Busy OCR returns a retryable response, and queued OCR remains queued.
- Capture, activation and email workers persist their work and use row locks with `SKIP LOCKED`. Independent processes can claim different queued work without claiming the same row.
- Composite branch/agent/leader and creation-date indexes support historical lists. Status/date indexes support queued capture work and user/date indexes support notifications. Duplicate claims use a unique indexed key rather than scanning all historical evidence per submission.
- Existing list limits and account authorization still apply. Exports retain explicit branch/date scope. Optional receipt OCR does not add a backend payment gate.
- Live-update streams open and close each database poll in a worker thread. Waiting for a pool connection cannot block the event loop that releases other requests. Temporary capacity waits retain the event cursor and continue heartbeats; revoked sessions and removed read permissions end their streams.

## Scaling and limits

The current deployment has one API process, limited CPU/memory, and PostgreSQL capped at 30 connections. More workers require a measured CPU/memory increase and a connection budget: `workers × (pool size + overflow) + migration/worker/admin reserve` must stay below the database limit. Preserve a stable shared JWT secret and PII encryption key across replicas. Request-rate counters currently protect each process; multiple replicas require a shared gateway limiter before claiming a global rate limit. OCR remains local and should be moved to dedicated persisted workers before increasing scan concurrency substantially.

The 11 October release check used a restored PostgreSQL copy with the same 384 MiB API memory limit and 0.75 CPU allowance. All 120 requests at concurrency eight succeeded: median 433 ms, p95 985 ms, maximum 1231 ms. API memory was approximately 97 MiB; no container restart or out-of-memory event occurred. A simultaneous two-connection PostgreSQL claim test accepted one transaction and rejected the other, leaving one durable claim. Independent backend review and the completed-capture filter also passed against the restored PostgreSQL database. These figures describe that test, not a maximum supported user count.

The final live-stream check opened six event streams while sending one hundred read requests at concurrency eight. Both the restored PostgreSQL copy and hosted API passed, with heartbeats continuing after the load. The hosted run took 14.74 seconds for those requests: median 919 ms, p95 2706 ms and maximum 3166 ms. Logging out one session closed only its stream and denied its token; other sessions stayed connected. No tracebacks or 5xx responses occurred in the tested hosted run after the event-loop fix.

Load verification reports the tested concurrency and latency, not an unsupported maximum user count. Backups and restored-copy migration checks precede release. An explicitly authorized evaluation refresh replaces operational samples while keeping account identities, passwords, branch/leader assignments, edited plans and approved commission policies/configuration; references to retired operational sale IDs are cleared from configuration.

The refresh preserves the append-only audit log and adds a maintenance audit event. Synthetic SR email entries are explicitly marked skipped, including when a preserved account uses a real email address. Evaluation data never triggers external email delivery.
