# Usability update — build 84

## Incentives

- Final commissions opens by default. Approved imported amounts, calculated estimates and earlier records have separate views and totals.
- Import approved amounts opens a guided template, file selection, preview and confirmation drawer. A preview does not write records.
- Each preview row shows its spreadsheet line, person, email, role, original branch/leader, date, amount, reference, note and new/already-recorded status.
- Exact repeated imports skip existing entries; conflicting amounts or notes remain rejected by the server. A file containing no new entries cannot be applied from the UI.
- Today and This month shortcuts complement custom dates. Management filters include historical recipients after reassignment. Own-role views omit irrelevant people selectors.
- Export visibility follows the effective grant. Missing/reversed dates disable downloads, and loading/error states do not show a false zero.
- Estimate configuration shows fields for the chosen approved policy. Unknown client inputs remain unconfigured; final imported amounts need no policy setup.
- The mobile app/demo use the same three views, date shortcuts and clearer amount/error/empty states. Estimates load and poll only when selected. Regular text sizes show all three tabs; enlarged text can scroll them.

## Web panel arrangement

- Reporting-period controls precede exports, with Today/This month shortcuts, explicit branch scope and search guidance.
- Asset quantity adjustments use Add/Remove, a projected balance, reason and review before saving. A failed save retains the values for correction.
- Import dialogs use their available width instead of a page-wide four-column grid. File selection and preview controls align; narrow dialogs stack them.
- Plan dialog fields no longer inherit duplicate margins. Long titles and staff names retain space beside fixed icons and close controls.
- Team-leader header actions form a consistent two-column arrangement on narrow screens.

## Verification

- Connected import preview/apply/replay and own-role scope passed against a disposable PostgreSQL API.
- All ten web-role navigation checks passed, including desktop/narrow administration subviews; actual sales/assets subpages and CSV/XLSX/PDF exports passed.
- Financial grants, invalid dates, legacy-ledger failure isolation, stock review/error recovery and branded export browser regressions passed.
- All 33 add/edit/import dialog views passed at 1440, 1024 and 390 pixels, including reachable actions, close-button spacing, filename width, keyboard close and focus restoration.
- Mobile suite: 289 passed, one existing skip; analysis clean. The final tab-layout checks passed at 300/390 pixels and normal/doubled text sizes.
- Sales-agent, team-leader and super-admin mobile-demo page checks passed. The normal Android build was installed and its three incentive views were checked physically.
- Backend full run: 708 passed, two branding tests failed because the isolated source package omitted the logo. After restoring the logo and its directory permissions, all 38 export/receipt tests passed. No production branding source change was needed.

No operational data reset, schema migration, commission-rate change or new payment approval is included in this release. Existing final amounts and historical assignments are preserved.
