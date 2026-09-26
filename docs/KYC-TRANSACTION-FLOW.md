# Transaction workflows

## Current reference demo (owner approved 26 September 2026)

The ZIP mobile flow has **exactly three main stages**, reproduced on web and Flutter:

1. **Identity & eKYC:** national ID or passport selection, synthetic document capture/upload, real server OCR, correction of extracted fields, and an explicitly simulated selfie/liveness outcome.
2. **SIM & Plan Allocation:** physical SIM/eSIM, agent-assigned ICCID, plan selection, synthetic phone number, and drawn signature. Allocation is saved before dispatch; inventory is reserved atomically on submission.
3. **Activation & Receipt:** processing and simulated carrier result, downloadable printable PDF receipt, simulated SMS action and return to the dashboard.

Use document, SIM and receipt icons. Completed stages use a check mark; purple marks the current stage, teal completed stages and a neutral background upcoming stages. These are progress indicators, not buttons that bypass required actions. At enlarged mobile text sizes, the three indicators stack vertically.

Identity images and signatures are encrypted in existing order draft storage; no schema migration is required. Synthetic DEMO- identity numbers only. No real payment is collected, no SMS is sent and no telecom service is activated. Saved identity and allocation drafts can be resumed; this new demo does not claim offline document submission. The original screenshot queue retains its offline behavior.

Web: `/kyc-capture`. Flutter: `/ekyc`. The separate screenshot workflow is linked from the demo and available at `/screenshot-capture` in both clients.

## Retained proposal screenshot workflow


The web portal and Flutter app combine the demo's compact three-stage presentation with the approved proposal's real screenshot processing. There is one progress indicator, driven by saved backend status, and no separate clickable six-stage guide.

| Stage | Actions | Saved status |
| --- | --- | --- |
| 1. Capture transaction | Take/upload the completed transaction screenshot; server OCR runs; retry extraction failures | New, QUEUED, OCR_FAILED |
| 2. Review details | Compare OCR rows with the original, correct and validate; generate Excel; address rejection feedback | EXTRACTED, VALIDATED, REJECTED |
| 3. Submit & track | Submit the original and validated rows to the backend team; follow the synchronized verification decision | SUBMITTED, VERIFIED |

Before capture, the agent completes Emirates ID/identity, customer information, plan/SIM information and order details in Etisalat. These remain external prerequisites, summarized once beside the new capture form. These external prerequisites apply to the screenshot workflow; the separately labelled demo above is not external carrier approval. VERIFIED means human backend verification of the captured transaction, not carrier activation.

## Screenshot processing

The API validates PNG/JPEG content (4 MB maximum, 6 megapixels, single frame), encrypts the original and queues Tesseract English/Arabic extraction on the VPS. Measured confidence belongs to OCR text recognition. It is not an identity authenticity score. Unsupported layouts remain available as OCR text for human review.

State transitions: QUEUED → EXTRACTED → VALIDATED → SUBMITTED → VERIFIED or REJECTED. Extraction failure has a retry path. Row corrections and verification decisions are audited, with version checks to prevent overwriting a newer review. Excel writes input as strings, preserving leading zeros and preventing formula execution. Each extracted line has its own row and source image reference.

Web status changes refresh automatically. Mobile capture screens poll while open. Offline screenshot drafts are encrypted on the device and retry while the capture screen is open; reopening it resumes saved work after restart. OS-terminated background uploads are not claimed.

The first four stages require access to the external telecom system. Relay does not provide that access, simulate biometric approval or activate a telecom service.

## Reproducible checks

Use `client-version/web/tests/capture.spec.ts` against a running API with Tesseract installed. The checked-in PNG fixture is synthetic. It covers upload, real extraction, row correction, Excel output, separate reviewer authorization and refreshed status. Use the Flutter tests for status-to-stage mapping (including OCR failure and rejection) and narrow-screen rendering. Device integration scripts accept private API/account defines; never commit them.

## Focused workspace (26 September 2026)

The web page shows one capture or review workspace. Capture history/search lives in a drawer. Selecting a record hides the upload form; New transaction capture starts a separate capture and confirms before discarding unsaved row edits. OCR text, file integrity and lifecycle history expand on demand. The Flutter app uses a compact current-stage header, hides its upload form during review and keeps history below the active transaction. Both editions retain the same saved-state transitions and server OCR API.
