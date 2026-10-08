# Backend review validation hotfix — 9 October 2026

The reported review submission failed with HTTP 500 because the saved historical intake used `Emirates ID`, while the intake schema accepted only `National ID` or `Passport`. Revalidating the stored intake raised an unhandled Pydantic validation error before a review decision could be saved.

## Change

- Canonicalize known identity labels (`Emirates ID`, `National Identity Card`, `UAE Identity card`, and case/whitespace variations) for validation. Unsupported document types remain invalid.
- Preserve the original intake and historical document label in stored captures; this is a compatibility fix, not a record migration or a conversion to the screenshot-order workflow.
- Return a controlled HTTP 422 for malformed saved intake instead of crashing. Validate before changing review, version, audit, notification, sale or stock state.
- Retain the existing independent-review, role/branch scope, optimistic-version and repeat-review guards. Valid records can be verified; invalid dictionary details can still be returned for correction.

## Verification

- Complete backend suite: **182 passed**. Ruff (`app` and `tests`) and whitespace checks passed.
- Regression cases cover known identity labels, the historical flow without `capture_mode`, invalid document types/schema/dates/images/order fields, malformed non-object intake, empty intake, failure atomicity, independent reviewers, cross-agent access, prohibited agent/leader review, stale versions and repeated decisions.
- The exact reported capture was tested before deployment in a restored PostgreSQL copy with the candidate source, then again after deployment in another restored copy using the actual released API image. Both returned HTTP 200, `VERIFIED` and one version increment. Leader/creator, stale-version and repeat-review attempts were denied. The original `Emirates ID` label stayed intact; zero stock movements and no linked sale were created. A stored notice was added for the assigned leader. This probe checks the notification row, not its rendering in a notification inbox.
- Temporary probe databases were removed. No live review decision was submitted by the test. A post-release read-only query found the live record still `SUBMITTED`, version `1`.
- Hosted portal check at 1440px and 390px passed all six evidence views (identity, payment confirmation and signature) and six data-tab checks. Images loaded, comparison panes and fields aligned, and the page had no horizontal overflow. A local note plus the evidence checkbox enabled the verification button at both widths; neither decision button was clicked. The final review/history/activation fingerprint matched the initial state, with zero attempted transaction mutations, browser errors or failed API responses. Screenshots were visually inspected.

## Release and rollback

Only the client backend file `backend/app/captures.py` was deployed. No schema migration, operational reset, frontend rebuild or APK replacement was performed. The client API is healthy over the public HTTPS endpoint.

- Release backup: `/opt/relay-client/backups/captures-review-before-20261008T192618Z` (UTC timestamp).
- Release source SHA-256: `3e32e75dae6edc94cf3b40cd5dfd0b8c6d9040f50b916dc4673a8378153827fe`.
- The deployment paused client API writers, backed up the source/environment/database and tagged the actual previous running API image. A restored database matched the stable live snapshot, including accounts, plans, captures, sales and SIM state; schema stayed at `015`.
- Portal/demo entry files, browser-demo code, APK and environment checksums remained unchanged. The existing build 66 clients consume the corrected shared API.
- `deploy/review-validation-release.sh` restricts its archive to one regular backend source file, validates it before extraction, and restores the prior source/environment/image automatically on release failure. It changes only `/opt/relay-client`.

Private logs, manifests, captures and screenshots remain outside Git under the ignored QA output directory or private VPS backups.
