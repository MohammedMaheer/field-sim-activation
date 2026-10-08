# October 2026 client clarification

This update follows the owner's 9 October answers and the supplied October incentive emails. It supersedes earlier payment gates and unconfigured CRR/DRR notes for new submissions. Historical receipts remain unchanged.

## Sale and evidence workflow

1. Capture the externally activated checkout customer-details screen.
2. Capture order details and record the product, package, phone, request ID and charges actually shown. Required customer/phone/request fields must be bound to readable captured evidence. Unknown values are **Not recorded**. New flow has no barcode/signature requirement.
3. Review and submit the sale. A payment receipt can be attached here, but it is optional and requires no separate backend payment approval. Stored receipt means **Payment recorded**, not gateway settlement. The compact animated sale receipt uses recorded fields only.
4. Backend staff independently compare the customer and order evidence. Confirmation closes the recorded sale and, where a known matching branch SIM is recorded, deducts it once. Team leaders receive read-only updates; agents and leaders cannot reassign staff.
5. Backend staff upload the daily Excel/CSV SR report, preview every sale result and apply a checked import. SR state is independent of activation state: **Matched**, **Mismatch**, or **Pending SR verification**. A missing/mismatched SR does not undo an already recorded activation. Report cancellation updates the sale's original day's/month's net totals.

## Performance and calls

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

No broader modules were removed because the requested extra modules were not named. The explicit separate payment-confirmation gate was removed. The release preserves existing accounts, edited plans and operational history.

## Verification

The release backend passed 286 tests in the packaged Python 3.12 image. Flutter passed 120 tests with one existing skip and clean analysis, including small screens and doubled text size. All 17 final browser checks passed, exercising role-scoped notifications, support validation, shared sales/assets, screenshot submission without a receipt, independent evidence review, repeated daily SR imports and read-only Sales Manager views. Hosted checks cover all 11 evaluation accounts and the main admin screens. Physical Android checks cover live camera visibility, unreadable-image blocking, branch stock, notifications and incentive screens; build 68 is installed.

The phone-framed browser demo is built with `client-version/mobile/preview/build.py`, which installs its custom host bootstrap and frame. A plain Flutter web build does not include that presentation wrapper.

The PostgreSQL migration was exercised through 015 → 017 → 015 → 017 on a restored deployment copy. Existing operational data compared unchanged, and the live cutover is backed up. No carrier API or payment gateway is invoked. Real email delivery remains unverified until SMTP is configured; incomplete commission eligibility/allocation and the projection formula remain awaiting client input.
