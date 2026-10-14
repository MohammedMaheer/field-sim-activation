# Shared web controls

Control rows use a 44px height. The branch selector, export-format selector and adjacent action buttons share upper and lower edges. Composite branch and table-search controls own their padding; their child controls do not inherit global field margins.

Grid-form labels use grid spacing rather than a second bottom margin. Single-line fields have consistent height; text areas retain their natural multiline height. Compact forms use two columns on tablet widths so action labels have room. Standalone forms retain their existing spacing.

Backend-verification list rows use stable reference, date/status and action columns. The date/status column has a consistent start position independent of reference length. Narrow rows place the reference above the metadata and action. Badges retain their content width.

Regression coverage checks Work locations, SR verification, Sales management, Backend verification, Sales agents and Reports at 1440, 1024, 800 and 390px. Tests measure control edges and metadata-column positions, verify no horizontal overflow, and reject operational write requests. Published assets were checked against the patch manifest.

Changes are styling-only. Role permissions, recorded transactions, location enforcement, API, mobile demo and installed APK remain unchanged.
