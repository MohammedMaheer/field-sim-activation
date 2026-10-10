# October 2026 client clarification

This update follows the owner's 9 October answers and the supplied October incentive emails. It supersedes earlier payment gates and unconfigured CRR/DRR notes for new submissions. Historical receipts remain unchanged.

## Sale and evidence workflow

1. Capture the externally activated checkout customer-details screen.
2. Capture order details and record the product, package, phone, request ID and charges actually shown. Required customer/phone/request fields must be bound to readable captured evidence. Unknown values are **Not recorded**. New flow has no barcode/signature requirement.
3. Review and submit the sale. A payment receipt can be attached here, but it is optional and requires no separate backend payment approval. Stored receipt means **Payment recorded**, not gateway settlement. The compact animated sale receipt uses recorded fields only.
4. Backend staff independently compare the customer and order evidence. Confirmation closes the recorded sale and, where a known matching branch SIM is recorded, deducts it once. Team leaders receive read-only updates; agents and leaders cannot reassign staff.
5. Backend staff upload the daily Excel/CSV SR report, preview every sale result and apply a checked import. SR state is independent of activation state: **Matched**, **Mismatch**, or **Pending SR verification**. A missing/mismatched SR does not undo an already recorded activation. Report cancellation updates the sale's original day's/month's net totals.

### Branch management and display clarification — 9 October

- Administrators retain transaction history, independent backend review, SR reconciliation and management, but cannot capture new sales, read capture OCR or create capture drafts. These restrictions apply to API writes as well as web and mobile actions. Operations staff and sales agents retain authorized capture access.
- Branches can have multiple team leaders. Sales agents have one explicitly assigned leader. Adding/editing a team leader or a branch roster does not reassign sales agents. Assignment changes require authorized management, a reason and an audit trail. A stale branch roster is rejected; a leader with assigned sales agents cannot be removed until those agents are reassigned. Historical sales and recipient notifications keep the leader recorded at submission.
- Client-facing labels use **Sales agents**. Internal roles and API paths remain compatible. Backend verification and daily SR reconciliation are prioritized in navigation. The top notification bell remains; duplicate sidebar Notifications and Manage workspace navigation are removed. Their necessary controls remain in dedicated branch, leader, sales agent and stock pages.
- The selected authorized branch persists across tabs within the signed-in account, including lists, targets and exports. It never broadens role access. The daily SR upload deliberately covers all branches, with that scope shown explicitly. Commission branch selection filters accounts and shows selected-branch counts; approved monthly account commission slabs and eligibility are not recalculated from an arbitrary branch slice.
- All seven product types (NEW, MNP, P2P, HW, ELIFE, WASEL and VISITOR) appear in daily/monthly target management and performance. Missing category targets show **Not configured** rather than a fabricated number. Aggregate targets use an explicit ALL target when present, otherwise sum configured product targets without double-counting.
- Customer views include captured customer details, SR/request numbers, plan/order data and authorized sale history. Sensitive document numbers remain masked in directories; original evidence remains available through authorized backend review.
- Externally activated screenshot sales show **Activated · pending SR verification** or **Activated · SR mismatch** as appropriate. A matched SR with unfinished evidence review shows **Activated · pending backend review**. **Fully activated** requires both independent backend confirmation and matched SR. Cancellation remains visible, and canonical sale/review statuses continue to drive reports, calls and commission.
- Reports default From/To to today's UAE business date on entry; users can change the period. Filters are passed to exports. SIM stock, additions, movements and requests remain branch-scoped.

## Performance and calls

### Record integrity and latest evaluation refresh — 10 October

Sales agents retain their own history after branch or team leader reassignment, including access to their previous branches as history filters. The original branch and leader on a sale are preserved. Optional receipt upload extracts only explicitly printed SR numbers, bound to the receipt and signed-in account; a request ID is never used as an SR fallback. Missing SR stays Not recorded and does not block recording the externally activated sale.

Request IDs, SR numbers and repeated order/receipt images have database-enforced duplicate claims. Simultaneous duplicate submissions receive an already-recorded/processing message; accepted exact-operation retries remain safe. Separate orders for one customer are allowed, and cancelled/rejected events retain their claims. The latest small evaluation dataset uses customer/order screenshots, optional receipts, SR and call queues, product targets and branch stock rather than retired barcode/signature/payment gates. Accounts, assignments and edited plans are preserved. [Capacity and integrity notes](CLIENT-CAPACITY-AND-INTEGRITY.md) describe the measured load safeguards and scaling limits.

- CRR = net closed sales / elapsed calendar days in the reporting month.
- DRR = (monthly target − net closed sales) / remaining calendar days. No remaining days gives Not available; achievement above target can produce a negative DRR under the supplied formula.
- Projection remains unconfigured because no formula was supplied.
- Home Wireless options are Delivery, On spot and Without router. On spot requires the router serial. New HW captures must choose a fulfilment option explicitly.
- NEW, MNP, P2P, HW and eLife require tele-verification and welcome calls. Tele-verification is due on the sale day; documented technical deferral can extend it to the next day. Welcome calls require successful tele-verification and a closed sale, due within two days of sale. Externally completed activation can still be recorded; incorrect sequencing is flagged instead of hiding it.
- Sales Managers can read all branches and teams. This does not grant administrator editing permissions.
- SIM stock stays scoped by branch. Cancelling a used SIM does not automatically make it reusable; an authorized, audited stock adjustment is required. Missing serials never create fictional stock movements.

## Approved incentive calculations

The four unique email policies are stored as versioned approved rates: MBO staff, Postpaid team leader, MBO team leader and Sales Manager gates. The duplicate staff email does not create a second policy. Calculations use current closed sales attributed to original sale dates. Cancelled sales are excluded retroactively.

Administrator/Operations staff can configure account policy, targets, plan slab mappings and approved eligibility inputs with an audit note and version check. Agents and leaders see their own calculation; Sales Managers can read all. Web and mobile use the same backend result. Unknown eligibility or allocation inputs produce **Awaiting configuration**, never an invented zero or payout.

Still requiring approved client input: PP slab assignments, individual named-profile mapping, contract/quality/disconnection definitions, applicable kiosk/group targets, higher gate versus cumulative gate payout, above-220 MRC uplift stacking, below-185 MRC treatment, store payout splits and the ambiguous SM gate entitlement/allocation wording. eLife 80–89% eligibility and attainment basis also need confirmation. Approved table values are displayed; incomplete payout configurations remain on hold.

## Alerts and operational configuration

SR mismatch/pending updates create account-scoped clickable notifications for the salesperson and the sale's saved branch leader, plus a durable encrypted email queue. Delivery requires approved SMTP host, sender and credentials. Without SMTP, the queue remains persisted and the admin SR screen shows **Email configuration required**. Test/evaluation email domains are skipped, and resolved alerts or recipients who lost access are not mailed. SMTP acceptance must not be described as confirmed inbox delivery.

An unchanged SR report is safe to retry. Uploading the same report after a late sale or an SR correction creates a new audited reconciliation instead of skipping the new work. Applying a stale preview is rejected. SR imports require an authorized backend role and its review permission. Evidence review cannot revive a cancelled sale or deduct its stock; rejection preserves cancellation.

The explicit separate payment-confirmation gate and later-named duplicate navigation modules were removed. The owner-authorized evaluation refresh replaces operational samples while preserving existing accounts, assignments, edited plans, approved commission settings and the append-only audit log. Normal assignment edits preserve historical transactions and saved recipient scopes.

## Verification

The final build 70 backend passed all 404 tests in the packaged Python 3.12 image. Flutter passed 147 tests with one existing skip and clean analysis, including narrow screens and enlarged text. Nineteen focused portal checks passed, including classification of current sale submissions using the summary API without detailed customer intake. Seven final browser checks against the shared isolated API verified multiple-leader management, every product target, branch persistence, current-day exports, customer history, receipt SR extraction through the stored administrator record, independent review and daily SR reconciliation, and read-only Sales Manager commission access.

The PostgreSQL migration was applied, rolled back and reapplied through 017 → 018 → 017 → 018 on a restored deployment copy; previous records compared unchanged. A sample refresh on that copy preserved account/catalog fingerprints. The constrained API load check passed 120 requests at concurrency eight, with no restart or out-of-memory event; PostgreSQL simultaneously accepted exactly one of two conflicting identity claims. [Capacity notes](CLIENT-CAPACITY-AND-INTEGRITY.md) record measured latency and limits.

Access checks now use saved sale branch/leader snapshots after transfers. Unknown unlinked legacy evidence is retained for its owner and administrators rather than exposed to a new branch. New sales require a valid explicitly designated branch leader. Effective capture permissions are required on direct sale and feedback endpoints as well as screenshot submissions. Notification reads and read/unread actions require an effective general or calling read grant; web/mobile hide the corresponding bell and call queue when that grant is absent. Team leader profiles omit sales agent shift actions.

Final physical Android checks verified the live camera behind the capture animation, an empty new customer form, required-field and unreadable-photo rejection, role menus, authorized calling branches, read-only team leader updates and notification destinations, leader profile identity, current-day reports and sign-out. Timed screen captures verified the receipt feeding down from the printer; starting New from that receipt cleared previous customer data. The normal build 70 APK remains installed. Original camera evidence and screenshots stay outside Git.

Live-update database polling now runs off the event loop. A short pool-capacity interruption keeps the stream alive and its cursor unchanged, while each poll rechecks the current session and read permission. Five additional regressions cover responsiveness during a blocked checkout, recovery without lost events, revoked/expired sessions and removed read grants.

Read-only hosted API checks passed for all eleven evaluation accounts. Loaded-screen checks covered eighteen desktop pages, six narrow pages and the signed-in framed demo. Six live event streams remained connected during one hundred requests at concurrency eight, both against a restored PostgreSQL copy and the hosted API. Revoking one session ended only its stream and made its token unauthorized. Final API logs contained no tracebacks or 5xx responses, and the API/database containers had no restart or out-of-memory event after the live-update fix. These observations cover the tested runs, not a guarantee of unlimited load.

The phone-framed browser demo is built with `client-version/mobile/preview/build.py`, which installs its custom host bootstrap and frame. A plain Flutter web build does not include that presentation wrapper.

### Earlier portal stability follow-up — 9 October

Fixed the Live operations render crash caused by an obsolete positional column reference. Named column definitions now keep Activations, Daily target and Stock aligned with their actual fields. A page recovery boundary preserves workspace navigation if a view cannot render. Temporary request limits show an explicit wait-and-retry message. Commission tables and configuration drawers stay contained at narrow widths without removing any information.

The packaged backend passed all 286 tests again. Thirty-four distinct browser checks passed across isolated QA and hosted read-only verification: connected sale/review/SR workflows, role-scoped notifications, ten roles' navigation, Live operations, commission layouts and recovery states. Detailed navigation evidence covers 38 administrator page visits, 17 Operations Manager destinations and 44 administrator subviews. Hosted Live operations and Incentives were visually checked at 1440 and 390 pixels after publication. Available server logs showed no 5xx responses or tracebacks; API and database containers had no restarts or out-of-memory events. This portal-only release preserves the database schema, accounts, API image, phone-framed demo and Android build 68, with a fresh deployment/database backup and an index rollback path.

The PostgreSQL migration was exercised through 015 → 017 → 015 → 017 on a restored deployment copy. Existing operational data compared unchanged, and the live cutover is backed up. No carrier API or payment gateway is invoked. Real email delivery remains unverified until SMTP is configured; incomplete commission eligibility/allocation and the projection formula remain awaiting client input.
