# Notifications and Modern Trade recheck — 30 September 2026

## Changes

- Shared categorized inbox in web, Android and the signed-in phone demo: transactions, calls, stock, support and workspace.
- Search, unread filter, category counts, mark read/unread, mark shown as read, refresh and account-specific persistent state.
- Transaction and call alerts open the relevant record; stock links open stock workspaces and support links open web ticket details. Source APIs retain authorization on every record.
- Leaders receive read-only confirmed-sale updates using the saved sale assignment. Reading never approves a sale or changes stock/call status.
- New business state produces a new unread item. Resolved call work leaves the actionable feed; the audit and record history remain available separately. Feed is bounded to 500 recent/current items.
- Corrected call-role redirection, mobile refresh flicker and mobile stock-request response visibility.

## Document review

Read the complete Modern_Trade_Software_Project.docx again. The requirement matrix is maintained in MODERN-TRADE-STATUS.md. External Grabba/carrier activation remains outside Relay; no carrier API is required. Customer/order/confirmation capture, independent review, manual sale entry, feedback, targets/imports, saved assignments, separate call stages, stock movements/requests/reports/checklists and role scopes are implemented.

Commission slabs, CRR, DRR, projections and deduction rules remain unconfigured by the owner's explicit direction. Sales Manager area is assigned-branch scope until the client confirms the exact access area, as the document requests. Neither is represented as a completed client decision.

## Verification

- Backend: 100 tests passed; Ruff clean. Eleven inbox tests cover ten account roles, foreign-account denial, atomic rejection of mixed authorized/unauthorized read IDs, persistence and repeated read updates.
- Flutter: analyze clean; 26 tests passed, one pre-existing skip. Web production build passed with the existing bundle-size advisory.
- Eight notification browser scenarios passed, including shared phone read-state persistence and opening a linked transaction.
- Broader regression: 29 scenarios passed initially (roles, imports, stock concurrency, support, calls and evidence validation). Full phone capture/review/leader flow and shared draft flow also passed.
- The local proxy/subpage run needed a longer data-loading assertion: trace showed successful remote responses arriving around 4.6 seconds, close to the former five-second cutoff. The application still reports real load errors; the test does not suppress them.

## Release and final checks

- Final nine-test run passed: eight inbox scenarios plus the desktop/narrow subpage sweep. The broader 29 regression cases and two capture/draft journeys passed separately, for 40 distinct browser scenarios in this follow-up.
- Hosted checks passed for six role inboxes and the phone-demo record link/read persistence. A test selector was refined for two historical sample records sharing the same reference; no record was deleted or rewritten.
- Schema 013 → 014 → 013 → 014 was rehearsed against a restored PostgreSQL copy, preserving business record counts. Production schema is 014. Accounts, edited plans and operational records preserved.
- Client-only backup: `/opt/relay-client/backups/notifications-before-20260930T090714Z`.
- Hosted web assets, mobile compiled code and bootstrap match local release hashes.
- Android build 53 installed successfully on connected device. Visually checked categorized inbox, selected Transactions, opened the selected invoice and returned to the inbox. The read state changed and the invoice retained Payment recorded / Pending backend confirmation.
- Published APK SHA-256: `da067507a4f5e3315a9a0744f3126fb33355ded78f41f1af2afbe19a76c70b00`.

 GitHub Actions previously could not start because of the repository account billing lock; local checks are reported separately.
