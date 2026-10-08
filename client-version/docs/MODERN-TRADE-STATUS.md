# Modern Trade document alignment — 30 September 2026

The complete `Modern_Trade_Software_Project.docx` was read again and compared with the maintained client edition. This record supersedes the earlier status notes. The owner confirmed that calculations must remain unconfigured until management supplies approved commission slabs, CRR/DRR/projection formulas and deduction rules.

## Current workflow

External activation on the salesperson's existing device → customer-details screenshot → order-details screenshot → order-created confirmation/request ID → agent reviews and submits → independent backend evidence review → confirmed sale/report/stock updates → read-only notification to the sale's saved branch leader.

Relay does not initiate carrier activation, perform Grabba verification or require a carrier API. The screenshots are evidence of work performed outside Relay. The request ID is an agent payment record, not a payment method or proof of gateway settlement. New invoices say **Payment recorded / Pending backend confirmation** until backend review. Historical workflows and receipts remain available.

## Requirement coverage

| Document requirement | Implemented path and behavior |
| --- | --- |
| Agent, employee ID, TL, SM, branch/outlet, effective assignment date | Sales register and detail drawer/app detail; submission snapshots TL, SM, branch/outlet and the known effective date. Transfers retain previous sale assignments and revoke changed staff sessions. Missing historic dates/SM assignments remain Not recorded; missing supervision is flagged. |
| Manual entry or screenshots after activation | Web sales-entry form and shared screenshot capture in web, Android and phone demo. No barcode or signature in new screenshot submissions. |
| Customer/EID/nationality/plan/order type/account/request/SIM/router/advance/SR/alternate phone/status/time | Predefined shared capture fields, full manual-entry fields, grouped invoice/details and CSV/XLSX exports. Seven order types; Home Wireless requires router serial. EID is masked in reports, protected in storage and available with evidence only to permitted reviewers. Optional unknown fields are Not recorded. |
| No-sale feedback | Separate agent interaction record, including contact and rejection reason, excluded from completed sale counts. |
| Daily/monthly/product targets | Scoped target editor in web/app; Excel template and validated CSV/XLSX preview/apply upload with duplicate, stale, invalid and unauthorized row rejection. TL edits only assigned agents. |
| Actual sales, target, achievement, remaining, daily product counts | Sales performance and current-register dashboard; closed/in-progress/cancelled counts, all seven daily product counts and monthly product summaries. Feedback does not increase sales. |
| Historical TL/agency/SM assignment | Saved sale assignments remain unchanged after current staff reassignment. Unknown pre-migration SM/date values are not fabricated. |
| Reporting by product/date/agent/TL/branch | Filtered sales register and matching Excel/CSV export; extra date/TL filters are collapsed initially. Full call columns, saved supervision, employee ID and explicitly captured order charges are included. Reports link to current sales; historical activation exports retain their original records. |
| Backend staff add/update staff and locations | Operations Manager and Administrator can provision/update branch/agent and sales/call staff assignments. Permanent master-data deletion and account closure remain Administrator actions. Reporting/call roles cannot gain these controls. |
| Download/edit/upload/preview/apply sale statuses | Unique record IDs, independent verification gate for screenshot sales, stale/duplicate/unmatched checks, atomic apply and uploader/change audit. Counts and call queues refresh after changes. |
| Tele-verification and welcome calls | Separate role-scoped queues/alerts, outcomes, remarks, timestamps, actor and history. Welcome call remains blocked until tele-verification passes or an audited management skip; one stage never overwrites the other. These are staff-made calls. |
| Categorized notification inbox | Web, Android and phone demo share account-specific read/unread state, search, category filters, unread counts and clickable record/workspace links. Transaction updates, call work, stock requests/shortages, support and workspace notices obey existing server-side scopes. Reading never changes a business status. The inbox shows up to 500 recent/current items; audit history remains separate. |
| Branch-leader notification | Backend verifies independently. The leader saved on the sale receives a read-only confirmation; leaders have no transaction approval action. |
| Stock/assets | Serialized Grabba/equipment/router records and bulk supplies, custom categories, central-store/warehouse, branch/agent, batch, size, condition, issue/partial issue/return/transfer/adjustment/write-off history. Existing SIM register and bulk import remain connected. |
| Automatic SIM deduction | Independent verification closes the linked external sale and consumes a matching owned SIM once. A request ID, failed extraction or incomplete transaction cannot consume stock. A missing SIM identifier does not invent a deduction. The owner's verification gate supersedes arbitrary earlier deduction triggers. |
| Stock requests and alerts | Agent request includes item/quantity/branch/urgency/remarks; TL/backend views are scoped, with pending counts and low-level alerts. Latest backend response, actor and time are returned to agent web/app views. |
| Stock reports | Balance, assigned/consumed SIM stock, movement, requests, damaged/lost, adjustment reports and CSV/XLSX exports, with scoped date/category/branch/agent/status filters and configurable minimum levels. |
| Staff transfer/exit and branch closure/relocation checklist | Stock return checklist lists all outstanding equipment and SIMs. Branch management links directly to its checklist. Transfer returns or carries accounted stock; admin cannot close agent access until stock is accounted for. Linked branches cannot be deleted to bypass stock history. A checklist does not itself close or relocate a branch. |
| Account isolation and audit | Individual sign-in, server-side account/role/branch scope, masked sensitive exports, audited corrections/imports/stock actions, optimistic changes, session revocation and the existing regular client database backup. |
| Web/mobile/demo connectivity | One shared API/database; stored drafts, captures, plans, sales, stock requests, targets and backend/leader updates use the same role-scoped records. Synthetic browser capture shortcuts still store and parse evidence through the API. No embedded credentials. |

## Deliberately unconfigured

Commission slabs, eligibility, cancellation/reversal/deduction rules, CRR, DRR and projection calculations remain unconfigured. No guessed formula or estimated commission is presented as an approved calculation. Existing recorded incentive history is not a commission forecast. Management must supply the missing rules before calculation and commission-rule configuration can be finalized.

The Sales Manager's exact access area is listed as requiring confirmation in the document. The implemented default is assigned-branch reporting with saved manager history; no unrestricted manager access is granted.

External carrier/device integration, payment gateway settlement, automated calling, SMS and off-device push are not requirements for this manual screenshot/call workflow. They are not reported as unfinished requirements. In-app alerts and recorded call outcomes work without those integrations. Recognition remains subject to evidence review; recognition scores never replace independent verification.

See [MODERN-TRADE-VERIFICATION-2026-09-30.md](MODERN-TRADE-VERIFICATION-2026-09-30.md) for release evidence and limitations.


## Re-audit corrections - 2 October 2026

The fresh whole-document audit does not classify all stock requirements as complete. The serialized SIM register currently supports Physical/eSIM form factor, without an independent Wasel/Prepaid, Postpaid, HW and Visitor business category. Automatic SIM deduction is guarded and idempotent at backend-confirmed CLOSED status, but there is no management-configurable deduction trigger. Branch stock return checklists and agent transfer/exit controls exist; a dedicated branch closure/relocation event and automatic required checklist workflow do not. These are remaining internal work, separate from the explicitly deferred commission/forecast rules.

Regular client database backups were not scheduled at the start of this re-audit. A client-only daily cron schedule has now been enabled at 03:30 UTC. Its backup script ran successfully, and the resulting archive was restored into a fresh isolated database at schema 014 before the temporary database was removed. Future scheduled executions have not yet occurred at the time of this report. See REQUIREMENTS-AUDIT-2026-10-02.md for current evidence, limitations and outstanding decisions.


## 2 October stock and branch follow-up

SIM business categories and explicit branch closure/relocation are now implemented and released at schema 015 / Android build 59. Category add/edit, legacy-compatible Excel imports, balances/thresholds/reports and signed-in phone inventory share the same data. Branch departure completion requires stock accounting, agent transfer/exit and resolution of pending work; historical records remain. See REQUIREMENTS-AUDIT-2026-10-02.md for new test evidence and the outstanding client-rule decisions. Existing confirmed-CLOSED stock deduction remains unchanged pending the approved configurable trigger/return policy.

## 7 October recheck

The recheck corrected closed-agent stock/target assignment, concurrent transfer safeguards, leader branch-edit guards, historical equipment handling, call notification links and compact evidence/form layouts. The subsequent unlocked Android checks corrected six draft, camera, restart and invoice-animation issues. The final client update is schema 015 / Android build 63, installed on the connected phone and published with the phone-framed web demo. The earlier backend suite passed 136 tests in both the workspace and exact released image; 64 distinct isolated browser/API workflows passed across the main run and necessary shared-flow rerun, and 37 hosted checks passed. The final Flutter suite passed 45 tests with one optional fixture skipped, and code analysis is clean.

The physical synthetic journey reached independent web-panel verification, the linked CLOSED sale, correctly staged call queues and a read-only confirmation to the assigned branch leader. Fresh capture, saved drafts, Back navigation, invalid-image rejection, native role views and header-first printing were checked. See [RECHECK-AUDIT-2026-10-07.md](RECHECK-AUDIT-2026-10-07.md) for exact release/restore evidence, test scope and remaining decisions. Commission/formula configuration remains on hold; configurable stock deduction/returns, exact manager boundaries and product-specific call exceptions still need client rules. No exhaustive-coverage or native-iOS claim is made.

## 8 October demo sign-in and layout update

The current client release is schema 015 / Android build 65. The mobile web demo alone now has a preselected sample-account dropdown and requires no password typing; native and portal password forms remain. Compact capture layouts, readable step headings, separated field borders, long-value wrapping and reconnect-warning recovery were verified in the browser and on the connected Android phone. Branch completed-sales and sales-today cards now use the same scoped current sales as the dashboard. The final backend suite passed 163 tests; Flutter passed 62 tests with one optional fixture skipped, with clean analysis. Hosted role checks, final portal/review/capture visual checks, publication identities and backup/restore evidence are detailed in [DEMO-AND-LAYOUT-UPDATE-2026-10-08.md](DEMO-AND-LAYOUT-UPDATE-2026-10-08.md). Previously documented client-rule decisions remain on hold.


## 8 October typography and capture styling

The current client release is schema 015 / Android build 66. Shared DM Sans reading styles and Manrope headings/numbers improve capture fields, detail rows, role dashboards, notifications, call screens, scanner and invoice readability. Capture actions use consistent burgundy/pink colors, step labels remain legible in the narrow phone frame, and enlarged system text can wrap or stack without shrinking. Flutter passed 107 tests with one optional fixture skipped; analysis is clean. Final physical customer/order capture, Payment, invoice printing and published artifact identities passed. See [MOBILE-TYPOGRAPHY-2026-10-08.md](MOBILE-TYPOGRAPHY-2026-10-08.md) for research, browser/phone checks and the client-only backup/restore. Backend logic and role scopes are unchanged; previously documented client-rule decisions remain on hold.
