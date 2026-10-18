# Call workflow usability — release 94

Continued the usability review through Call work queue, Support and account-access forms. The concrete changes address call actions that were difficult to find or recover after a failed submission. Support keeps its existing searchable, status-filtered history and response drawer. This is a targeted follow-up, not a claim that every possible application issue has been eliminated.

## Changes

- Web call outcomes now open in a focused dialog at the current task. Previously, choosing a card near the bottom of the queue opened an inline form above the viewport. Customer, plan, stage, phone and SR/request ID appear together so the caller can check the record before saving.
- Technical postponement uses a named form with a required reason and Cancel, replacing a browser prompt. Call history also opens beside the task and explains when no attempts exist.
- Web and mobile queues support search by customer, SR/request ID, phone, sales agent, branch or package. Outcomes use readable labels while preserving API values and existing permissions.
- Mobile outcome/postponement forms stay open until the API confirms saving. A failed request retains the chosen outcome and remark/reason with an inline error. Pending saves disable repeat submission and closing. A change of account, branch or calling permission prevents an open mobile form from submitting under a different scope.
- Historical records, call sequencing, postponement deadlines, independent backend review and all role grants remain unchanged. No API or database migration is required.

## Verification

Evidence is retained outside Git under `output/qa/usability94-*`. Connected writes used a fresh internally networked PostgreSQL QA service with SMTP disabled. Production records were not used for test mutations or reset.

- Flutter analysis: no issues. Full suite: **317 passed, one existing skip**. Includes call failure/retry, pending-submit controls, changed-branch rejection and a small-screen keyboard/cancel check.
- Browser regression: **23 passed** across revised call actions, effective workspace grants, stock request/adjustment recovery and responsive report controls. **Four additional call-notification selection checks** passed against the isolated API. The four new call usability cases were rerun after final label/layout adjustments.
- Backend call regressions: **50 passed**, including role and branch scopes, call sequencing, permitted products, technical-postponement rules and scoped queue summaries. API business logic is unchanged.
- Connected web/mobile check: a current synthetic sale was created in QA; an intentionally rejected web save retained the entry; retry received HTTP 201; the exact remark appeared in call history; the shared mobile demo showed No answer for the same request. Its customer-context sheet and Cancel were checked visually.
- Desktop and 390px call dialogs were inspected for readable hierarchy, wrapping and accessible controls. The mobile demo sheet was inspected after a real shared-API round trip.
- Normal Android **build 94** installed successfully and opened the existing sales-agent session. Its off-shift Home screen was inspected; the installed APK hash matches the downloadable build. The physical check did not submit a call, sale or work session. Call action checks used Flutter tests and the shared browser demo.

Normal Android and mobile-demo release builds succeeded. The release requires a deployment/database backup, an isolated restore with matching table fingerprints, unchanged API image/schema/environment checks and published-asset verification. Only `/opt/relay-client` is in scope; other applications and the earlier full edition are independent.

## Published verification

The deployment and database backup is `/opt/relay-client/backups/usability94-release-20261018T185527Z`. Its database restored into an isolated clone with every table fingerprint matching. Schema remains 023; environment, compose configuration and API image are unchanged. The API is healthy, with zero restarts and OOM false. The previous deployment and database dump remain available for rollback.

All **23 browser regression cases passed again against the published assets**, using synthetic API fixtures. A separate hosted read-only tour inspected Call work queue, Support, outcome/postponement dialogs and Accounts & role access at desktop and phone widths. It recorded no browser/server errors or operational writes. All 11 published file hashes matched the release manifest; public HTML, CSS, JavaScript and the demo assets matched local build 94. The downloadable normal APK is available and matches the installed phone build.

The connected test initially relied on an old sample call being actionable for a specific officer. The final harness creates its own current, branch-appropriate synthetic sale. Its mobile assertion also accounts for Flutter's merged accessibility labels. Both were test-fixture issues; the complete isolated web-to-mobile check then passed.
