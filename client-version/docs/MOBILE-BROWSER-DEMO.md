# Mobile browser demo

The separate `/mobile-demo/` page embeds the real Flutter UI inside a responsive phone frame. It uses `lib/preview_main.dart`, never the production login or API. Visitors need no credentials. This is a browser demonstration, not a native iOS build.

## Behaviour

- Synthetic fixtures only. Each browser session keeps changes in memory; Reset demo/reload restores the fixture.
- Home, tasks, stock, customers, reports, incentives, support and profile use the existing mobile screens.
- Capture buttons load a bundled synthetic receipt. OCR and reviewer approval are explicitly simulated. Edited rows generate a real Excel download. Activation remains external in Etisalat.
- All Dio requests are intercepted locally, including unknown routes (rejected). No live account, upload, customer image, location permission or backend mutation is involved.
- Native camera, device barcode scanning and OS sharing are not represented as physical-device tests.

## Build and test

From the repository root, set FLUTTER_BIN if Flutter is not on PATH, then run:

```text
python client-version/mobile/preview/build.py
cd client-version/mobile
flutter analyze
flutter test
```

Output is `mobile/build/web/` (ignored by Git). The build temporarily installs a bootstrap template and restores it on completion. Local CanvasKit assets avoid CDN dependencies. Publish all output under `/mobile-demo/`, not over the admin panel root.

Browser regression: from `client-version/web`, set `MOBILE_PREVIEW_URL` to the hosted demo URL and run `npx playwright test tests/mobile-preview.spec.ts --workers=1`.

## Deployment and rollback

Before publication, back up `/opt/relay-client/web/dist` and the client database, recording the current migration. No migrations, API changes, nginx changes or APK replacements are required. Publish only to `/opt/relay-client/web/dist/mobile-demo`. Preserve this subdirectory when deploying the separate React panel later.

Rollback: restore the previous mobile-demo directory if present; for first publication, remove only that verified directory. The backup contains the previous full web tree. Never restore a database for this static-only rollback. The full edition and all other VPS applications remain independent.

## Published verification — 28 September 2026

URL: https://relay-client.187-127-162-233.sslip.io/mobile-demo/

- Flutter analysis: clean; Flutter tests: 14 passed, 1 skipped.
- Backend regression: 44 passed (no backend changes).
- Browser workflow passed locally and on the published URL: navigation, receipt extraction simulation, validation, Excel download, simulated approval, secondary screens, reset, 390px layout and expanded mode. No live API calls observed.
- Desktop and narrow-screen images visually reviewed; evidence retained outside Git.
- Client API health and existing web panel HTTP 200 verified after publication.
- Backup: `/opt/relay-client/backups/mobile-preview-20260928T062920Z`; migration `005 (head)`. APK build 21 preserved.
- Native camera/OS sharing and native iOS installation are outside this browser preview's verification.
