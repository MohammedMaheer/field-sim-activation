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
