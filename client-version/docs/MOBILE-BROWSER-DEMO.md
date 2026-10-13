# Mobile browser demo

The separate `/mobile-demo/` page embeds the real Flutter UI inside a responsive phone frame. It uses `lib/preview_main.dart` and the same signed-in backend as the management portal and Android app. The demo account picker preselects an account and fills its evaluation password. This browser surface is not a native iOS build.

## Behaviour

- Role access follows the signed-in evaluation account. Refresh app reloads the page; it does not delete saved backend sales, drafts or stock.
- Customer and order capture shortcuts generate synthetic images. Those images pass through the real OCR and image-bound submission checks, and submitted sales appear in the portal and Android app.
- The synthetic order contains a unique sample SR. Its optional payment receipt uses the same SR. Independent backend review and daily SR reconciliation remain separate real workflows; the demo does not simulate carrier approval.
- Home, transactions, stock, customer history, reports, incentives, support, notifications and profile use the shared mobile screens and role scope.
- Work location uses actual browser permission and foreground GPS when the member starts work. See [Work location and boundaries](WORK-LOCATION.md) before enabling configured geofences. Synthetic capture shortcuts do not invent staff positions.
- Reference bills use one paper logo, distinct Reference details, downward printing/replay, direct Home and complete standalone print output.
- Build 82 adds two team leaders and four sales agents to the curated picker without resetting existing accounts or edited plans. Home and Profile show each sales agent's explicit designated leader. New branch examples include multiple leaders, pending/mismatched/matched SRs, original-date cancellation and the Home Wireless delivery/on-spot/without-router options. No GPS or boundary is simulated.
- Native device camera, Android print integration and OS sharing need separate physical checks; browser checks alone do not verify them.

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

Before publication, back up the client deployment and database, recording the current migration. Shared workflow changes require the API, React panel, Flutter demo and Android APK to remain compatible. Publish only within `/opt/relay-client`. Preserve `/web/dist/mobile-demo` when publishing the React panel.

For an assets-only rollback, restore the previous web/demo assets without replacing database records. Shared releases use their recorded deployment/image and migration rollback procedure. The full edition and all other VPS applications remain independent. Current evidence is recorded in [the build 81 release audit](WORK-LOCATION-RECEIPT-RELEASE-81.md).

## Historical standalone preview verification — 28 September 2026

The following describes the old isolated preview before shared-backend sign-in. It is retained as historical evidence and does not describe the current demo.

URL: https://relay-client.187-127-162-233.sslip.io/mobile-demo/

- Flutter analysis: clean; Flutter tests: 14 passed, 1 skipped.
- Backend regression: 44 passed (no backend changes).
- Browser workflow passed locally and on the published URL: navigation, receipt extraction simulation, validation, Excel download, simulated approval, secondary screens, reset, 390px layout and expanded mode. No live API calls observed.
- Desktop and narrow-screen images visually reviewed; evidence retained outside Git.
- Client API health and existing web panel HTTP 200 verified after publication.
- Backup: `/opt/relay-client/backups/mobile-preview-20260928T062920Z`; migration `005 (head)`. APK build 21 preserved.
- Native camera/OS sharing and native iOS installation are outside this browser preview's verification.
