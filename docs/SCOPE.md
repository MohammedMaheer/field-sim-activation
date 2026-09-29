# Branch leader clarification - 29 September 2026

Backend staff independently verify transactions. Branch team leaders receive read-only notifications and transaction updates after backend confirmation; they do not verify, approve or confirm transactions. This supersedes the earlier leader-confirmation handoff.

# Payment-record clarification - 29 September 2026

For new screenshot-order submissions, the uploaded order-created confirmation and request ID are the agent payment record. Show `Payment recorded` with `Pending backend confirmation` until independent backend review. Omit payment-value, VAT and payment-method fields from this flow; a request ID does not establish a payment method or gateway settlement. Keep explicitly captured order charges in order details. Preserve historical receipts.

# Current capture flow - 29 September 2026

1. Capture/upload the external checkout customer-details screen. Extract the name, document details, nationality and dates. Required readable values are bound to the saved image and account.
2. Capture/upload the order-details screen. Extract product/package, MSISDN, request ID, monthly charge and prepayment exactly as shown. Match the package to the active plan catalog by name; require explicit plan selection if no unique match exists. No barcode or signature is required for new screen-based transactions. Missing SIM identifiers remain Not recorded and do not mutate inventory.
3. Upload confirmation evidence. The animated compact invoice follows stored evidence. A carrier order-success image is not payment settlement; amounts and tax are never inferred from monthly charges.
4. Independent backend staff compare customer, order and confirmation images and review fields. Once verified, the designated branch team leader receives an in-app confirmation request and records confirmation. External carrier activation stays external.

The phone-framed web experience signs in to the same role-scoped API as the APK and admin panel. Its synthetic capture shortcuts are parsed and stored by that API, enabling bidirectional meeting demonstrations. No credentials are embedded in the build. Previous records retain their original workflow.

## Prior workflow history

# Relay client edition scope

The final field-sales proposal and the owner's 28 September 2026 clarification govern `client-version/`. The earlier full edition is independent. The maintained stack is React/TypeScript, Flutter and FastAPI/PostgreSQL through one API.

## Field workflow

1. Capture an Emirates ID or passport. Server extraction can prefill fields; the agent checks and corrects them. Selfie capture is optional. No liveness or authenticity approval is simulated.
2. Scan or enter the SIM serial, choose an administrator-configured subscriber plan, allocate a phone number and capture the customer's signature. Every required field is saved as a recoverable draft.
3. Photograph or upload the payment confirmation. After the server stores the image, show an animated, printable payment invoice. The requested heading is `Payment successful`; `Pending verification` remains visible until an independent staff member checks the evidence. The upload is not a payment-gateway authorization.
4. Authorized independent staff compare the original image, extracted fields, customer document and signature, correct or reject the submission, and record a reason. Backend staff then perform activation externally and record its outcome and reference. The app does not call or simulate carrier activation.

The invoice is projected from saved data. The chosen plan's price is distinct from the amount actually evidenced by payment confirmation. Unknown amount, tax, payment method, optional selfie or other unrecorded values read `Not recorded`. Corrections, review and activation update the same invoice through polling/live refresh. Generated PDF uses the same projection and masks identity numbers. Historical activation-receipt records remain readable and their original lifecycle is unchanged.

## Included

- Web operations dashboard, live field activity, branch and agent monitoring, independent backend verification, and administrator management of branches, agents, customers, plans, SIM stock and incentives. Branches are the sales outlets; agents are assigned directly to a branch. Historic team assignments remain in stored records.
- Mobile field dashboard, orders, customer search, own SIM stock, return/damage reporting, daily reports, agent support, offline drafts, synchronization and the three-stage transaction flow.
- Payment confirmation extraction into flexible labelled rows, editable with an audited reason; original-image comparison; scoped CSV/XLSX/PDF export and immutable audit events. An agent raises support requests; administrators review and resolve them.
- Administrators may edit individual SIMs, import up to 500 new SIMs from the Excel template with a movement/audit record per SIM, and permanently delete unused plans. Plans linked to saved transactions cannot be deleted.
- Role and branch scoped access, encrypted capture storage, PostgreSQL, live updates and synthetic example records.

## Excluded or external

Location, territory and geofencing are excluded. Etisalat activation and payment-provider authorization are external. No live biometric verification, carrier activation, payroll execution or real customer identity data is claimed. The separate phone-framed browser experience is an isolated synthetic demonstration of the mobile screens; the installed APK uses the shared backend.

The earlier receipt-upload and payment-excluded flows are historical decisions superseded by this document. See `docs/KYC-TRANSACTION-FLOW.md` for current API states and review controls.
