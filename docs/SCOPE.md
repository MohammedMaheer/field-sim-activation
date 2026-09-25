# Approved client scope

The source of scope is the final `Field_Sales_Proposal_KYC_Incentives_150Users_AED6000.pdf`, clarified by the owner on 24 September 2026. This document governs `client-version/`.

## Included

- Web management: live field activity, branch teams and outlets, agent productivity, audited administrator target/assignment controls, sales targets, customer and historical order records, SIM inventory and allocation, KYC transaction tracking, compliance review, immutable audit history, CSV/PDF reports.
- Incentives: authorized manual entry, validated CSV/XLSX import, history and CSV export. Payroll execution is excluded.
- Flutter field app: dashboard/targets, shift and branch/team assignment, tasks, customer search, stock balances and own-SIM return/damage reporting, daily report, support, sync and KYC capture/review/status.
- KYC stages: (1) Emirates ID and source OCR, (2) customer information, (3) plan information, (4) order and customer details, (5) completed screenshot capture, server OCR, editable rows, Excel and image handoff, (6) authorized backend verification and live status.
- Supporting services: authentication, role-scoped access, PostgreSQL, audit events, encrypted capture storage, live web updates and encrypted offline mobile drafts.

Stages 1-4 happen in Etisalat's external software. Relay's guide does not enter data into that system or claim identity authenticity, face matching, liveness or carrier activation. The Qanawat sample informs the broad identity → allocation → completion sequence and presentation. The final proposal controls functional scope. Sample identity data and third-party branding are not copied.

## Excluded by the owner

Location, territories, GPS collection, maps, geofence alerts and geofence reports are removed from the client edition. The mobile dependency/permissions and API collection routes are disabled. Legacy database fields remain inaccessible for historical compatibility; immutable audit history is preserved.

Third-party AI/biometric services, SMS/WhatsApp/email gateways, BI/ERP/billing integrations, real carrier access, infrastructure costs and ongoing maintenance require separate inputs. The proposal's 150-user sizing is not a performance certification.

All seed records are synthetic. See [setup](../client-version/README.md) and [workflow](KYC-TRANSACTION-FLOW.md). The earlier full Relay demonstration is preserved locally and is outside the GitHub handoff.
