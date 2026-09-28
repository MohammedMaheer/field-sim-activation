# Relay client edition scope

The final field-sales proposal and the owner's 28 September 2026 clarification govern `client-version/`. The earlier full edition is independent. The maintained stack is React/TypeScript, Flutter and FastAPI/PostgreSQL through one API.

## Field workflow

1. Capture an Emirates ID or passport. Server extraction can prefill fields; the agent checks and corrects them. Selfie capture is optional. No liveness or authenticity approval is simulated.
2. Scan or enter the SIM serial, choose an administrator-configured subscriber plan, allocate a phone number and capture the customer's signature. Every required field is saved as a recoverable draft.
3. Photograph or upload the payment confirmation. After the server stores the image, show an animated, printable payment invoice. The requested heading is `Payment successful`; `Pending verification` remains visible until an independent staff member checks the evidence. The upload is not a payment-gateway authorization.
4. Authorized independent staff compare the original image, extracted fields, customer document and signature, correct or reject the submission, and record a reason. Backend staff then perform activation externally and record its outcome and reference. The app does not call or simulate carrier activation.

The invoice is projected from saved data. The chosen plan's price is distinct from the amount actually evidenced by payment confirmation. Unknown amount, tax, payment method, optional selfie or other unrecorded values read `Not recorded`. Corrections, review and activation update the same invoice through polling/live refresh. Generated PDF uses the same projection and masks identity numbers. Historical activation-receipt records remain readable and their original lifecycle is unchanged.

## Included

- Web operations dashboard, live field activity, branch teams/outlets, agent and target monitoring, administrator management of branches, teams, outlets, agents, customers, plans, stock, tasks and incentives.
- Mobile field dashboard, assignment, tasks, customer search, own SIM stock, return/damage reporting, daily reports, support, offline drafts, synchronization and the three-stage transaction flow.
- Payment confirmation extraction into flexible labelled rows, editable with an audited reason; original-image comparison; scoped CSV/XLSX/PDF export, compliance review and immutable audit events.
- Role and branch scoped access, encrypted capture storage, PostgreSQL, live updates and synthetic example records.

## Excluded or external

Location, territory and geofencing are excluded. Etisalat activation and payment-provider authorization are external. No live biometric verification, carrier activation, payroll execution or real customer identity data is claimed. The separate phone-framed browser experience is an isolated synthetic demonstration of the mobile screens; the installed APK uses the shared backend.

The earlier receipt-upload and payment-excluded flows are historical decisions superseded by this document. See `docs/KYC-TRANSACTION-FLOW.md` for current API states and review controls.
