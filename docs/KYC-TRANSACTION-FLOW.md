# Proposal KYC transaction workflow

The web portal and Flutter app share the same six-stage guide. It follows the reference demo's identity, allocation and completion sequence with the approved proposal's detailed stages.

| Stage | Where | Work |
| --- | --- | --- |
| 1. Emirates ID & OCR | Etisalat | Enter/scan identity and complete required source checks |
| 2. Customer information | Etisalat | Complete customer details |
| 3. Plan information | Etisalat | Confirm plan, SIM/eSIM, number and terms |
| 4. Order & customer details | Etisalat | Complete order, consent and remaining details; retain transaction screen |
| 5. Capture, OCR & handoff | Relay | Camera/upload, extraction, row review, validation, Excel and original-image handoff |
| 6. Verification & live status | Relay | Authorized human review and synchronized result |

Guide navigation is instructional; moving to the next step is not proof of identity verification or carrier activation.

## Screenshot processing

The API validates PNG/JPEG content (4 MB maximum, 6 megapixels, single frame), encrypts the original and queues Tesseract English/Arabic extraction on the VPS. Measured confidence belongs to OCR text recognition. It is not an identity authenticity score. Unsupported layouts remain available as OCR text for human review.

State transitions: QUEUED → EXTRACTED → VALIDATED → SUBMITTED → VERIFIED or REJECTED. Extraction failure has a retry path. Row corrections and verification decisions are audited, with version checks to prevent overwriting a newer review. Excel writes input as strings, preserving leading zeros and preventing formula execution. Each extracted line has its own row and source image reference.

Web status changes refresh automatically. Mobile capture screens poll while open. Offline screenshot drafts are encrypted on the device and retry while the capture screen is open; reopening it resumes saved work after restart. OS-terminated background uploads are not claimed.

The first four stages require access to the external telecom system. Relay does not provide that access, simulate biometric approval or activate a telecom service.

## Reproducible checks

Use `client-version/web/tests/capture.spec.ts` against a running API with Tesseract installed. The checked-in PNG fixture is synthetic. It covers upload, real extraction, row correction, Excel output, separate reviewer authorization and refreshed status. Use the Flutter tests for stage order, callbacks and narrow-screen rendering. Device integration scripts accept private API/account defines; never commit them.
