# Admin panel scope and control audit — 25 September 2026

The admin panel is an operations workspace for the approved client proposal. This audit retains the existing navigation and places new controls inside existing screens. It is not a carrier provisioning console or an unrestricted editor of historical evidence.

## Coverage

| Area | Monitor | Authorized control |
| --- | --- | --- |
| Overview | Branch-filtered sales, targets, capture pipeline, stock and priorities | Open the corresponding operational screen |
| Live operations | Shift state, sync timestamp, team, outlet and productivity | Open an agent and request synchronization; push delivery remains simulated |
| Agents / branch teams | Scoped roster, branch, targets, performance, stock and history | Administrator can change target, outlet and branch-compatible leader in Agents → Manage; reason and audit event required |
| Field tasks | Search, status, overdue and completed work | Assign, start and complete tasks |
| Customers / activations | Scoped customer data and historical lifecycle records | Search and inspect; external carrier records are not silently rewritten |
| KYC transactions | Search all scoped capture references, status filter and paginated history | Upload, retry failed OCR, correct/validate rows, export original/Excel, submit and independently verify/reject |
| SIM inventory | Balances, assignment and movement history | Authorized stock movement with required reason; reserved/activated/blocked/damaged states are protected |
| Incentives | Period totals, entries and import history | Manual entry, validated file import and CSV export; no payroll execution |
| Support | Scoped requests, status and response | Open, investigate and resolve requests |
| Compliance | Alerts and investigation notes | Record investigation and resolution |
| Reports | Nine proposal report types with filters | CSV/PDF generation |
| Audit | Actor, time, action, entity, before/after and reason | Search/filter/export; history remains immutable |

## Fixes made

- Added admin-only target and assignment controls inside the existing agent drawer, without adding a settings section or more sidebar pages.
- Reject invalid targets, leader/outlet branch mismatches, stale edits and unauthorized changes. Block outlet changes while available/assigned/reserved stock is held. Assignment and inventory transactions synchronize on the agent lock.
- Exposed KYC search, status filters and paging so older captures are no longer hidden behind the first 50 records. Queries intersect the authenticated scope before filtering/paging. Added empty-result recovery.
- Made the default agent order deterministic after edits; PostgreSQL row-update order must not change which employees appear on the first page.
- Removed raw internal identifiers from the team detail summary.

## Verification and practical limits

Backend suite: 39 tests passed, including all eight seeded role scopes, authentication requirements, inventory restrictions, tasks/support/incentives, CSV/PDF reports, capture validation/encryption/versioning/reviewer separation, branch scope, assignment permissions/conflicts and a 62-record paging test. Ruff passed. Flutter analysis and all four widget tests passed. All 17 hosted browser tests passed, including admin save/restore, KYC search, real OCR and verification, popup interactions and responsive views. Both admin browser tests passed again after the form-layout refinement.

This is a demo with synthetic data. Actual Etisalat/biometric approval, telecom activation, notification delivery, payroll and unrestricted account/role provisioning are outside the approved implementation. The admin cannot bypass independent KYC review or mutate audit history. A passing functional suite does not prove absence of all bugs, independent penetration-test results, or 150-user load capacity. No such certification is claimed.

The changes are API-compatible with mobile build 12; no mobile workflow or field names changed in this audit. No database migration was required. Only the client deployment is updated, with database, source and web backups before release.
