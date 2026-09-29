# Transaction capture and payment invoice flow

## Current sequence

| Stage | Agent action | Stored state |
| --- | --- | --- |
| 1. Identity | Capture ID/passport; check extracted customer name, number, nationality and dates; optional selfie | Encrypted versioned draft |
| 2. SIM & plan | Scan/enter serial, choose current plan, enter phone, sign | Same draft; plan validated server-side |
| 3. Payment | Capture/upload payment confirmation image; optional payment reference | `QUEUED` then `EXTRACTED` or `OCR_FAILED` |
| Review | Agent checks/corrects dynamic fields, saves and submits | `VALIDATED` then `SUBMITTED` |
| Independent verification | Reviewer compares original evidence, identity/signature and fields; enters a reason | `VERIFIED` or `REJECTED` |
| External activation | Backend team records carrier outcome/reference after verification | Capture retains `VERIFIED`; separate activation state `ACTIVATED` or `FAILED`; linked order/event and SIM movement when the serial matches assigned inventory |

The Identity step starts the live camera inside its animated document card automatically. Tapping the card expands the same camera session. It checks candidate frames while the guide is visible. A readable name and document number cause automatic capture and prefill; the agent still checks the fields. Dark/empty scenes do not trigger extraction, and Capture/Upload photo remain available when automatic reading cannot complete. The signed-in web capture uses the same server extraction on live camera frames. The isolated browser phone preview retains synthetic sample extraction and does not claim to verify a real identity.

A new payment invoice is available only after the uploaded image is stored. It feeds downward from a virtual kiosk on web, native Flutter and phone preview. Its compact view includes invoice number/date, customer, masked document number, SIM, plan and captured payment fields; supporting details can be expanded or printed in full. Every absent known value is `Not recorded`; the plan price never substitutes for the paid amount. The heading `Payment successful` acknowledges the uploaded payment evidence; `Pending verification` makes the outstanding human decision clear. When review or activation changes, both clients refresh the invoice. PDF exports carry the same grouped information and identity masking.

The current capture POST sets `document_kind=PAYMENT_CONFIRMATION`. Existing `ACTIVATION_RECEIPT` captures remain readable, downloadable, editable and reviewable for history. No new client asks for an Etisalat activation receipt. The server preserves original images encrypted, runs OCR, retains unknown/repeated fields, audits changes and enforces optimistic versions. A reviewer cannot verify their own submission. Only authorized backoffice roles with both `compliance.write` and `ekyc.write` may record external activation; the caller must provide a carrier reference and completion note. A verified capture cannot be activated twice.

The review inbox filters `SUBMITTED`, payment captures ready for activation, completed activations, rejected submissions and historical records after intersecting with the authenticated user's agent scope. Backend status updates flow to the web panel and mobile through their existing refresh/synchronization mechanisms. The isolated phone preview uses synthetic records and has no access to customer data or privileged API calls.

No kiosk payment-provider authorization, carrier API activation or biometric approval occurs inside Relay. Real-world document and payment evidence must be inspected by trained authorized staff. Identity capture and barcode scanning keep manual correction paths for unreadable images or unsupported browser hardware.


### Review and sample refresh (29 September)

The review workspace compares payment confirmation, identity document and signature beside payment fields or customer/SIM details. Administrators retain workspace management; agents see their own working screens and data; compliance officers see review, customer context, reporting and audit without management or external activation controls. API permissions and agent scope remain authoritative for mutations, downloads and records.

Invoices feed down from the printer over 2.2 seconds, support replay, and honor reduced motion. The app returns to the invoice immediately after storing the payment image; supporting payment rows/history stay collapsed once submitted.

The explicit `RELAY_RESET_OPERATIONAL_SAMPLES=KEEP_ACCOUNTS_AND_PLANS python -m app.sample_reset` maintenance command replaces operational samples only in a transaction. It preserves accounts, passwords, role permissions, sessions and complete plan configuration. Release requires a stopped-writer PostgreSQL backup and verifies preservation fingerprints; rollback restores the original database and client files. Historical captures remain in the backup; append-only audit events remain in the database and a new reset event records this maintenance.

Extraction accepts arbitrary colon/gap-separated labels and multiline values. Original text stays inspectable; missing fields are not fabricated and payment totals are never inferred from subscriber plan price.


Identity capture requires readable printed name, document number, birth date and expiry date. The server binds those extracted values to the exact image and capturing account with an encrypted, time-limited capture check. Advancing a draft or submitting new payment confirmation rejects missing checks, image substitutions, changed identity details and checks belonging to another account. This is a readability and consistency check, not proof of document authenticity; independent staff review remains required. Historical records are unchanged. The isolated browser preview animates capture and upload using a synthetic identity image and never issues a production capture check.


## Explicit drafts and SIM progress (29 September 2026)

New transactions start empty. Save draft creates an encrypted, account-private saved transaction; Drafts is the only entry point for resuming it. Discard releases unsubmitted SIM claims. Offline mobile drafts remain on the device and synchronize when Drafts is reopened online. Working caches are not automatically treated as a new transaction.

SIM pack scanning recognizes labelled ICCID/serial/type values and plain ICCID barcodes. Unknown/ambiguous packs require correction rather than invented identifiers. Agent scans require assigned available stock and a transaction identifier; repeat scans are idempotent and conflicting claims are rejected. Administrators receive a notification and see activation progress alongside stock and payment states. Unsubmitted abandoned claims can be cleared from stock management.

Stock remains available while a distinct progress record moves through In progress, Pending verification, Ready for activation and Activated/Failed. Payment states are Not uploaded, Uploaded, Verified or Rejected. Uploaded payment evidence does not imply authorized or settled gateway payment. Only independent review followed by an authorized external activation completion changes the SIM to Activated. Historical activation receipts are preserved.

Document continuation requires readable printed identity fields with identity-document context bound to the captured image/account. Random pictures and manually substituted fields cannot satisfy it. This is a readability and consistency gate, not document authenticity certification; staff still compare the original evidence.
