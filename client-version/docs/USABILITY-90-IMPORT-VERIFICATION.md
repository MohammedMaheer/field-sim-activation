# Import recovery and remaining-role verification

This is a web follow-up to release89. The backend runtime, database schema023, mobile-demo bundle and Android build88 are unchanged.

## Changes

- SIM Excel import resets the actual browser file picker after success and when the receiving branch changes. Old success/error messages clear with a new selection.
- SIM import ignores simultaneous submissions and locks the file, branch and reason while saving. Escape cannot dismiss an in-flight import. Controls recover after a rejected request.
- Monthly SR preview uses the selected month independently of the daily date. Clearing a daily date and then switching to monthly no longer leaves an enabled preview button that does nothing.
- SR preview and apply each ignore repeated clicks while a request is running. Rejected requests release the guard and remain retryable. Empty uploads are rejected locally.
- The workbook-dimension regression explicitly selects an active branch. A closed synthetic branch left by lifecycle tests previously caused the combined run to exit before workbook validation. Import limits and branch restrictions are unchanged.

## Verification

- Five focused browser regressions failed against the old implementation with the expected causes: retained native file selection, two SIM requests, no monthly request, and duplicated SR preview/apply requests. All five pass after the fix. Three additional rejected-request/retry checks pass.
- 46 distinct mocked browser checks passed across import recovery, SR comparison, branded exports and earlier stock/usability cases. This includes invalid dates, disconnected/empty/HTML exports, expired authentication, sign-out races, read-only controls and responsive layouts. The main combined run passed43 tests; the expanded import run passed8, including the five already counted.
- 254 isolated backend tests passed across client workflow/access contracts, exports, forged workbook dimensions, final commission imports and refresh recovery. These tests use temporary synthetic SQLite data; they do not modify hosted operational records.
- Hosted read-only navigation passed75 destinations across Operations Manager18, Branch Manager15, Compliance Officer12, Inventory Manager14, Sales Manager14 and Welcome Call Officer2. Pages had no rendering errors, server errors, unresolved loading states or whole-page horizontal overflow during these tours.
- Hosted mobile-demo checks passed forbidden deep-link handling for seven roles and incomplete-support-form validation. No support request was submitted.
- Manually inspected desktop backend-review, inventory, sales-management and welcome-call screenshots, plus the changed SIM import dialog and390px monthly SR preview. Evidence remains outside Git in `output/qa/usability90-*`.
- The production web build passed. Its existing large-chunk advisory and Python framework deprecation warnings remain warnings, not failed checks.

## Limits and release scope

The browser import regressions intercept API responses so repeated submissions and failure recovery can be tested without creating hosted stock or reconciliation batches. Backend parsing, persistence and access are covered separately by isolated tests. No new physical Android check was performed for this web-only change. This pass does not claim every possible device or load condition is covered.

Publishing is limited to changed client web files and their corresponding sources/tests/documentation. The release procedure backs up the current deployment and PostgreSQL database, restores the dump into an isolated database, compares table fingerprints and retains a file rollback path before publication. Release logs and exact manifests are kept in ignored QA evidence. Existing data, role grants, assignments, commission rules, geofences and APK remain intact.
