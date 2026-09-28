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

A new payment invoice is available only after the uploaded image is stored. It feeds downward from a virtual kiosk on web, native Flutter and phone preview. Its compact view includes invoice number/date, customer, masked document number, SIM, plan and captured payment fields; supporting details can be expanded or printed in full. Every absent known value is `Not recorded`; the plan price never substitutes for the paid amount. The heading `Payment successful` acknowledges the uploaded payment evidence; `Pending verification` makes the outstanding human decision clear. When review or activation changes, both clients refresh the invoice. PDF exports carry the same grouped information and identity masking.

The current capture POST sets `document_kind=PAYMENT_CONFIRMATION`. Existing `ACTIVATION_RECEIPT` captures remain readable, downloadable, editable and reviewable for history. No new client asks for an Etisalat activation receipt. The server preserves original images encrypted, runs OCR, retains unknown/repeated fields, audits changes and enforces optimistic versions. A reviewer cannot verify their own submission. Only authorized backoffice roles with both `compliance.write` and `ekyc.write` may record external activation; the caller must provide a carrier reference and completion note. A verified capture cannot be activated twice.

The review inbox filters `SUBMITTED`, payment captures ready for activation, completed activations, rejected submissions and historical records after intersecting with the authenticated user's agent scope. Backend status updates flow to the web panel and mobile through their existing refresh/synchronization mechanisms. The isolated phone preview uses synthetic records and has no access to customer data or privileged API calls.

No kiosk payment-provider authorization, carrier API activation or biometric approval occurs inside Relay. Real-world document and payment evidence must be inspected by trained authorized staff. Identity capture and barcode scanning keep manual correction paths for unreadable images or unsupported browser hardware.
