# Interrupted capture and draft recovery — release 92

This extends the release 91 audit with interrupted uploads/saves and repeated draft requests. Hosted records are preserved. All mutations in verification use a disposable PostgreSQL service on an internal network with SMTP disabled.

## Fixed

- A photo still being decoded could repopulate a new web transaction after its original intake was unmounted. Photo preparation now checks the originating intake and capture revision before changing fields or starting OCR.
- A late progress-save or saved-copy response could replace the next web transaction, clear its fields and open Drafts. Obsolete intake callbacks now stop before updating the parent or navigating. Three deterministic browser regressions failed before the fixes and pass afterward.
- Repeating Save draft after a committed response was lost created another saved copy. The shared API now uses its existing creator lock and transaction ID to find the user's encrypted saved draft, including a Flutter offline retry carrying a local draft ID. Existing historical copies are preserved. Unidentified legacy drafts remain separate; no database migration or global customer-data index is introduced.

## Evidence

| Check | Result |
| --- | --- |
| Relevant backend suites | 202 passed, 1 PostgreSQL-specific withdrawal-race skip. Covers current client scope, customer withdrawal and four new draft recovery/capacity/privacy checks. |
| Browser checks | 39 passed against the compiled web UI and isolated API. Includes lost committed response, three late-response regressions, automatic camera frames during a partial save, scanner backpressure/replacement, withdrawal, role/grant restrictions, reference-bill printing and the shared mobile-demo/web draft flow. Most role/printing cases use controlled API responses; the lost-response and mobile shared-draft cases use PostgreSQL. |
| Real lost response | Browser interception let the API commit Save draft, then aborted its response. Fields survived the error; retry showed one saved entry with the same server ID. |
| PostgreSQL concurrency | Eight simultaneous HTTP saves returned 201 and the same draft ID, with exactly one saved database row. A retry with a local offline ID reused it; a different agent received 404. |
| Permission changed during sign-in | The same previously issued agent token received 403 for Save draft after its role was restricted on the isolated service. The current-user response showed the revised permissions. |
| Flutter | 12 focused tests passed for draft navigation, queue/account isolation and recovery. Two new cases verify offline queuing after a lost committed response and refusing to convert a 403 into a pending offline draft. No native source/binary change is required. |
| Build/static checks | Web TypeScript/production build and focused Python Ruff checks passed. Existing bundle-size warnings remain. |

Screenshots of the recovered Drafts drawer and cleared mobile-demo capture were visually inspected. Read-only Android navigation was also inspected on the connected, unlocked phone; no sale, draft or work session was started. The installed normal APK remains build 88. The shared API change applies to both native and web-demo clients.

## Release

Publish only the changed shared API file, React intake source, compiled web assets and this report under `/opt/relay-client`. Back up deployment/database, restore the dump to an isolated database and compare every table fingerprint before publication. Verify schema 023, immutable source preconditions, final file hashes, previous-image rollback and preservation of environment, compose, APK and mobile-demo bundle. Tests are maintained in Git; evidence and private release artifacts remain outside Git in `output/qa/recovery92-*`.

This pass does not claim a new exhaustive native-device audit, all possible camera inputs, real mail delivery or production load capacity. Earlier release 91 evidence remains separate from the additional checks above.

## Publication checks

The database backup restored successfully with every table fingerprint unchanged. Schema remains 023; environment, compose, APK and mobile-demo bundle identities are preserved. The API is healthy with zero restarts and OOM false. Final compiled-asset regressions and source/asset hashes are checked before handoff. The original deployment backup and previous API image are retained for rollback.
