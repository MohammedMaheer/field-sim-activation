# Reference bill and direct Home — 13 October 2026

Build **1.0.0+78** changes generated sale/payment documents to **Reference bill** across Flutter, the signed-in browser demo, portal review, paper printing and PDF names. Cached projections with the former Invoice title render with the current name. The sale reference is included in the compact primary section. Historical activation-receipt records retain their document type and contents; internal API keys remain compatible.

The Flutter bill header now has a direct **Home** action, available while reading any part of the document. New transaction and Refresh use a secondary menu at narrow widths or larger text scales to keep the title readable. The portal bill has a Home link above the virtual printer. Bottom Home actions remain available.

Verification:

- 78 focused Flutter receipt, draft navigation, compact layout and typography tests passed. After the compact-header adjustment, 11 focused navigation/render cases passed; these counts overlap. Full analysis and the changed-header analysis passed.
- Four React browser cases passed for complete/private printing, current-state/permission checks, preserved historical receipts and direct Home navigation at 390 px. Five focused backend cases passed against an isolated SQLite test database for PDF output, cancellation, access and legacy payment projection.
- Flutter renders at 320/390 px and normal/larger text were visually inspected. React desktop/narrow layouts were also inspected.
- Build 78 was installed on the Redmi phone. The same Avery Stone sale shown in the owner's screenshot displays Reference bill, the sale reference and the saved customer/order details. Tapping header Home returned immediately to the dashboard. The installed APK hash matches the published download.
- Hosted demo verification opened the existing sale and checked the current title and direct Home route without creating or changing a sale. Public portal/demo assets and APK hashes match the release artifacts; the API is healthy with zero restarts and no OOM.

Release backup: `/opt/relay-client/backups/reference78-release-20261012T212453Z`. The database dump restore listing was checked. Schema remains **019**, with no migration or data reset. Before/after operational-record fingerprints and environment hashes match. Code rollback restores the backed-up deployment and `relay-client-api:before-reference78`; database restoration is not required for this presentation-only release.

Private screenshots, logs and manifest are under `output/qa/reference78-*`, outside Git. APK SHA-256: `d9f8618a619ec5f3ff2e7d505a858a961b7f535d1a5c7d248fe6789717888994`.
