# Branch management and access clarification - 9 October 2026

Administrators review and manage transactions but cannot capture new sales. Operations staff and sales agents retain authorized capture access. Use Sales agent in client-facing labels while preserving internal role/API identifiers. A branch may have multiple team leaders; every sales agent has an explicit designated leader. Creating or editing a leader never silently reassigns sales agents. Only authorized management may change assignments; historical sales and notifications retain the saved leader. Branch selection is shared across pages and account-scoped. Reports start with today's date. Product targets cover NEW, MNP, P2P, HW, ELIFE, WASEL and VISITOR. Manage workspace and sidebar Notifications are removed from navigation; the top notification bell remains. This supersedes earlier single-leader and administrator capture notes.

# October client clarification - 9 October 2026

See [October client update](docs/OCTOBER-2026-CLIENT-UPDATE.md) for the latest rules. New sales capture customer and order screens, then review and submit with an optional payment receipt; there is no separate payment-confirmation gate. Backend evidence review is independent, team leaders receive read-only updates, and daily SR reconciliation has a separate pending/mismatch state that does not block recording external activation. Approved incentive rates and CRR/DRR are implemented; unknown policy inputs and projection remain on hold. Cancelled sales are excluded from original-date net totals. This supersedes earlier workflow notes below.

# Branch leader clarification - 29 September 2026

Backend staff independently verify transactions. Branch team leaders receive read-only notifications and transaction updates after backend confirmation; they do not verify, approve or confirm transactions. This supersedes the earlier leader-confirmation handoff.

# Payment-record clarification - 29 September 2026

For new screenshot-order submissions, the uploaded order-created confirmation and request ID are the agent payment record. Show `Payment recorded` with `Pending backend confirmation` until independent backend review. Omit payment-value, VAT and payment-method fields from this flow; a request ID does not establish a payment method or gateway settlement. Keep explicitly captured order charges in order details. Preserve historical receipts.

# Latest owner workflow - 29 September 2026

New transactions capture the external checkout customer-details screen, then the order-details screen (product, package, MSISDN, request ID and explicitly shown charges). Barcode and signature are not part of this new capture flow. Preserve historical records. Step 3 uploads confirmation evidence; an order-created success message alone does not establish payment settlement. Unknown values remain Not recorded. Backend independently verifies evidence and the branch team leader then confirms in their signed-in app. Each branch has one designated team leader. The phone-framed web demo now signs in and uses the same backend, with synthetic capture shortcuts and no embedded credentials. Scope all data by account and branch.

# Latest owner workflow - 28 September 2026

This clarification supersedes earlier payment exclusions and Etisalat receipt-upload steps. Relay collects identity/document capture (selfie optional), SIM barcode, subscriber plan, phone and signature, then uploads payment confirmation. No Etisalat activation receipt upload is required for new submissions. The animated payment invoice appears only after an uploaded payment image has been stored, with Pending verification status. Payment successful is the owner-requested acknowledgement heading for uploaded payment confirmation, not gateway authorization. Paid amount and tax are never inferred from plan price. Missing values are Not recorded. Independent authorized staff verify evidence; backend staff record external activation completion with a reference and note. No simulated carrier or biometric approval. Historical activation-receipt records remain unchanged.

# Relay client proposal workspace

The maintained product is `client-version/`: FastAPI/PostgreSQL, React/TypeScript and Flutter share one API. The source of scope is `docs/SCOPE.md`; the current workflow is documented in `docs/KYC-TRANSACTION-FLOW.md`.

- Update web and mobile together for changes to shared workflows and field names.
- Teams belong to branches. Intersect branch filters with the authenticated user's authorized agents; never broaden access through a UI filter.
- Location, territory and geofencing are excluded. Do not add location permissions, collection, maps or geofence reports to the client edition.
- Current flow: identity capture, SIM/plan/phone/signature, payment-confirmation image upload, independent review, then externally completed activation recorded by backend staff. Preserve historical activation-receipt records. No simulated carrier or biometric approval.
- Retain synthetic records; keep demo and technical paragraphs out of client-facing screens.
- Use synthetic demo data. Keep secrets, device credentials, captured customer images, database snapshots and generated binaries outside Git.
- Run relevant backend, web and Flutter tests. Visually inspect changed desktop/mobile screens and preserve evidence outside Git.
- Repository: `https://github.com/MohammedMaheer/field-sim-activation`. The owner requests that completed changes be committed and pushed here. Check for remote changes first, use meaningful commits, and never force-push or overwrite work from another computer.
- Before a release, back up the client deployment and database, verify its migration and rollback path, and change only `/opt/relay-client`. Other VPS applications and the earlier full edition are independent.
