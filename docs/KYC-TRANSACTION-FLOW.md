# Transaction workflows

## Current owner clarification — 28 September 2026

Three stages: identity capture and extracted details, SIM/plan/phone and signature, then external Etisalat receipt upload and independent staff review. The printable receipt appears only after an Etisalat receipt image has been uploaded and accepted by the backend; it never appears from identity/SIM details alone. It shows Final review pending until an independent backend decision verifies it. Payment verification has been explicitly removed by the owner. Preserve historical payment evidence but do not require or collect new payment verification. Selfie is optional; carrier activation stays external. No location or geofencing. Keep synthetic records, remove demo/technical paragraphs from customer-facing screens. Apply the same concise, colorful presentation to web, Flutter and the isolated phone preview.

### Verification boundary

Receipt OCR extracts printed text; unknown identity layouts require manual correction. Selfie capture is optional and does not verify liveness. Browser barcode scanning depends on BarcodeDetector support, with manual serial entry available; native Flutter uses the device barcode scanner. Real-world document and kiosk-provider validation require human review; no provider integration is claimed.


## Current receipt workflow — owner clarification, 27 September 2026

Activation, identity verification and SIM/plan processing happen externally in Etisalat. Relay starts after activation: the agent photographs or uploads the Etisalat activation receipt, the VPS performs OCR, the agent checks/corrects the extracted rows, then submits the original and rows for authorized backend review. VERIFIED means receipt review, never carrier activation.

Both web `/kyc-capture` and Flutter `/ekyc` now open this receipt workflow. `/screenshot-capture` remains a compatible entry point. The previously approved synthetic activation demonstration is superseded and has no active product navigation. Historical records remain preserved.

## Retained proposal screenshot workflow


The web portal and Flutter app combine the demo's compact three-stage presentation with the approved proposal's real screenshot processing. There is one progress indicator, driven by saved backend status, and no separate clickable six-stage guide.

| Stage | Actions | Saved status |
| --- | --- | --- |
| 1. Capture transaction | Take/upload the completed transaction screenshot; server OCR runs; retry extraction failures | New, QUEUED, OCR_FAILED |
| 2. Review details | Compare OCR rows with the original, correct and validate; generate Excel; address rejection feedback | EXTRACTED, VALIDATED, REJECTED |
| 3. Submit & track | Submit the original and validated rows to the backend team; follow the synchronized verification decision | SUBMITTED, VERIFIED |

Before capture, the agent completes Emirates ID/identity, customer information, plan/SIM information and order details in Etisalat. These remain external prerequisites, summarized once beside the new capture form. Relay never requests carrier activation. VERIFIED means human backend verification of the captured transaction, not carrier activation.

## Screenshot processing

The API validates PNG/JPEG content (4 MB maximum, 6 megapixels, single frame), encrypts the original and queues Tesseract English/Arabic extraction on the VPS. Measured confidence belongs to OCR text recognition. It is not an identity authenticity score. Unsupported layouts remain available as OCR text for human review.

State transitions: QUEUED → EXTRACTED → VALIDATED → SUBMITTED → VERIFIED or REJECTED. Extraction failure has a retry path. Row corrections and verification decisions are audited, with version checks to prevent overwriting a newer review. Excel writes input as strings, preserving leading zeros and preventing formula execution. Each extracted line has its own row and source image reference.

Web status changes refresh automatically. Mobile capture screens poll while open. Offline screenshot drafts are encrypted on the device and retry while the capture screen is open; reopening it resumes saved work after restart. OS-terminated background uploads are not claimed.

The first four stages require access to the external telecom system. Relay does not provide that access, simulate biometric approval or activate a telecom service.

## Reproducible checks

Use `client-version/web/tests/capture.spec.ts` against a running API with Tesseract installed. The checked-in PNG fixture is synthetic. It covers upload, real extraction, row correction, Excel output, separate reviewer authorization and refreshed status. Use the Flutter tests for status-to-stage mapping (including OCR failure and rejection) and narrow-screen rendering. Device integration scripts accept private API/account defines; never commit them.

## Focused workspace (26 September 2026)

The web page shows one capture or review workspace. Capture history/search lives in a drawer. Selecting a record hides the upload form; New transaction capture starts a separate capture and confirms before discarding unsaved row edits. OCR text, file integrity and lifecycle history expand on demand. The Flutter app uses a compact current-stage header, hides its upload form during review and keeps history below the active transaction. Both editions retain the same saved-state transitions and server OCR API.

## Receipt-specific fields — 28 September 2026

New OCR results contain transaction rows with an ordered `fields` list: label, value, source_line and confidence. Labels come from the receipt, not a fixed customer/account/plan schema. Repeated labels remain separate; no field is silently overwritten. Colon-labelled content is recognized in English or Arabic; unclassified lines remain editable Receipt text entries. Reviewers must compare with the original: OCR does not guarantee recognition of arbitrary receipt layouts or tables.

Web and Flutter allow editing field names/values, adding/removing fields and adding/removing transactions. A transaction needs at least one nonblank value and every field needs a name. The API bounds labels, values, field count and source indices, preserves version conflicts, audit revisions, encryption and scoped access. Legacy four-column records stay readable/exportable. Older apps cannot replace flexible rows with their fixed format.

Dynamic Excel exports use one row per receipt field (transaction, field, value, confidence and provenance), preserving repeated labels, leading zeros and formula-like text safely. No database migration is required because the existing encrypted JSON payload holds the schema. APK build 22 is required to edit new captures. The separate mobile browser preview uses the same fields with explicitly synthetic extraction.

## Backend review workspace — 28 September 2026

Users with compliance.write now land in an automatically refreshed review inbox, filtered to submitted receipts. Entries identify their assigned agent and capture reference; search, status filters and pagination remain scoped by the API. Selecting a record opens its authenticated original image beside read-only transaction fields. Image zoom/fit, download, raw OCR and Excel are available in the same workspace. Smaller screens stack the two panes.

Reviewers compare the evidence, check the comparison acknowledgement and enter a note, then Verify receipt or Request correction. Verification remains blocked without a loaded image, comparison acknowledgement or note. The API still enforces independent reviewer, submitted state, authorized-agent scope and version checks. Rejection returns the capture for agent corrections and resubmission; decisions appear through polling on both clients. Own drafts remain editable by their creator, but own submissions cannot be self-verified.

Images use authenticated blob requests, abort on navigation and revoke object URLs on cleanup. Failed image loads offer retry. Captures expose creator_id so the portal can clearly explain the independent-review restriction before an action.

## Printable receipt before final review — 28 September 2026

The owner permits receipt printing/PDF generation before independent staff verification. Pending receipts explicitly show Final review pending, rejected receipts show Correction required, and only a VERIFIED backend decision shows success. The receipt endpoint retains authentication, scoped access and identity masking. This removes the final-review gate from printing, not from confirmation or carrier activation. Native clients share/download the generated PDF; the web panel can print directly.
