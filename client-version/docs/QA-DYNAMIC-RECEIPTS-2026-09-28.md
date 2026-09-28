# Receipt-specific field release

New receipts retain their own labels/values rather than requiring four predefined columns. Web, native Flutter and the isolated browser demo share the flexible editor. Legacy records remain compatible. No database migration; current migration remains 005.

Validation:
- Backend suite: 45 passed; final capture regression after old-client overwrite guard: 5 passed.
- Flutter analyze: clean; Flutter tests: 14 passed, 1 skipped.
- Web production build passed.
- Hosted real VPS OCR workflow passed: extraction, label/value correction, custom field, validation, Excel download, submission, separate compliance approval and refreshed status. Desktop/tablet/mobile widths checked.
- Hosted Flutter browser demo workflow passed, including dynamic fields, export, simulated approval and reset. Screenshots visually inspected outside Git.
- APK build 22 SHA-256: 78e7ca3e82ca92d48284a37215dfe81d273e8aaafe35d6c1e3ff7a814420168b. Hosted hash matches.
- Build 22 installed and launched on connected Android phone. Physical capture integration test was blocked by Android install restrictions; do not claim that native end-to-end test passed. Normal release APK restored successfully after reconnection.

Deployment backup: /opt/relay-client/backups/dynamic-receipt-20260928T071003Z. Includes database, backend/web files, prior APK and prior API image tag. Only client deployment changed. Browser demo remains under web/dist/mobile-demo. No unrelated application or full-edition changes.

Rollback: restore backed-up backend/web and prior API image using the release script. Do not roll back the database after new submissions. Existing dynamic payloads must remain preserved; prefer a forward fix for editing/exporting new-format records if rollback is necessary. Original images and audit revisions remain encrypted.

Known extraction boundary: labelled colon-separated receipt text is recognized; unknown layouts remain editable receipt-text fields for human correction. No claim of perfect arbitrary table/receipt parsing. Public browser demo extraction is synthetic; the portal/native workflow uses VPS Tesseract.
