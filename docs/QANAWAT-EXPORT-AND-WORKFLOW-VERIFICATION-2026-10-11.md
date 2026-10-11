# Qanawat release and workflow verification — 11 October 2026

## Released changes

The client portal, framed browser demo and normal Android build 72 use the supplied Qanawat company logo. The personal contact signature and e& logo from the reference banner are not used as application branding. Existing account addresses, URLs, package identifiers and historical records are preserved.

Receipt printing uses an isolated paper document in browsers and the Android print service on the phone. Preparing browser print rechecks current effective permissions and the saved record's access scope; paper reflects current backend/SR/cancellation state. All receipt sections are included even when their screen sections are collapsed. Document numbers remain masked. The tested current receipt fits one A4 page; longer records may paginate without dropping fields.

Reports, sales, calculated commissions, commission history and stock exports support CSV, Excel and PDF where appropriate. Excel includes styled headers, filters, frozen headings, printable layouts, native amounts/dates, identifiers stored as text, and export metadata. CSV protects spreadsheet formula injection and uses UTF-8. PDFs retain every column and long values, using repeated reference columns for wide reports. Import templates retain their machine headers and support identifiers with leading zeros. Download controls show progress and errors, retain branch/date filters, and permit retry. Sales agents can export their own scoped records with an effective read grant; management exports require report.read. General reports are still restricted to report.read.

## Client requirement review

| Requirement | Current behavior and verified evidence |
|---|---|
| Approved commissions | Four distinct versioned policies match the supplied staff, postpaid TL, MBO TL and manager gate rate tables. The repeated staff email does not create a duplicate policy. Explicit account eligibility/configuration is required; unknown inputs withhold amounts. test_commissions.py covers every staff band, TL rates, gates, eligibility boundaries, permissions and missing inputs. |
| Retroactive cancellation | Fifteen sales on 7 October, then three cancellations on 8 October, produces twelve net sales on the original day and month. Dependent incentives, performance, reports and dashboard recompute from current sale state. test_commissions.py, test_sales_policy_october.py and test_sr_reconciliation.py cover the supplied example. Cancellation and disconnection remain distinct. |
| CRR and DRR | CRR = net closed sales / elapsed calendar days. DRR = (target minus net achievement) / remaining calendar days. UAE business dates, leap years, month boundaries, zero denominators and negative overachievement DRR are tested. Missing targets return unconfigured, not an invented value. Projection remains unconfigured. |
| Sales Manager | Global read access to all branches and team leaders; a manager can oversee multiple branches. Scope filters narrow visible results without adding mutation permission. Direct sale edits, stock mutations, reassignment and target changes are denied. |
| Home Wireless | Delivery, On spot and Without router are explicit choices. On spot requires a router serial. Delivery and Without router permit no serial. Historical HW entries retain their previous validation. |
| Calling workflow | NEW, MNP, P2P, HW and ELIFE create tele-verification and welcome tasks. Tele-verification is due the sale day and a documented technical deferral can extend once to the next day. Welcome requires successful tele-verification plus backend-closed activation, due within two days of the sale. External activation can be recorded before calls; sequence violations are surfaced. Scoped calling-role checks and deferral boundaries are tested. |
| SIM deduction | A matching, available SIM in the sale's recorded branch is consumed once after backend review. Missing serials never create a stock movement. Used, duplicate or conflicting stock cannot be consumed twice. Cancellation never automatically makes a used SIM reusable; authorized management must record an audited adjustment. |
| Branch closure/relocation | Existing Administrator/Operations management can start and complete the operation with a reason. Completion is blocked until stock is accounted for, active agents transferred/exited and pending sales/evidence/requests resolved. New allocation into an inactive branch is blocked. Historical records and movements remain. A distinct second-person approval rule has not been supplied. |
| Agency/outlet/branch | The current agreed UI treats outlets as branches: one location with assigned sales agents and multiple team leaders. Internal legacy outlet references remain compatible. A separate agency hierarchy has not been defined. |
| Backend and SR verification | Independent backend evidence review remains; optional payment receipt means recorded, with no separate payment approval gate. SR reconciliation previews and applies daily Excel/CSV matches independently of activation state. Missing/mismatch SR does not undo external activation; saved salesperson and leader receive read-only notices. |

## Verification performed

- Packaged production Python 3.12 backend: **441 tests passed**.
- Restored isolated PostgreSQL workflow, integrity and permission checks: **47 passed**; no API restart or out-of-memory event.
- Flutter: **180 tests passed**, one pre-existing optional visual fixture skipped; analysis clean.
- Final browser print/download regressions: **6 passed**; mobile demo account/branding/sign-in regressions: **4 passed**. Earlier current-workflow portal regressions also passed.
- Connected local API and hosted API: **48 downloads each** across sixteen export types/formats, with twelve desktop/narrow page checks each and no JavaScript or server errors in those checks.
- Unmocked hosted portal cookie sign-in, live server updates, hidden administrator capture controls and mobile-demo sign-in against the shared backend all passed. Physical Excel export opened the native share sheet with the correct Qanawat .xlsx filename.
- Actual current browser print: all **49 fields across seven sections**, current authoritative status, no hidden-screen clipping, safe escaping and masked identity.
- Physical Android build 72: installed, company header/logo shown, current receipt opened in Android print preview as **one A4 page**. Save as PDF produced an 83,703-byte file; the pulled PDF was parsed and checked for required sections and masking. Physical paper output needs a configured printer and was not tested.
- Hosted portal, compiled mobile demo, logo files and APK checked against local hashes. API health remained healthy with zero restarts/OOM after cutover. Deployment and database backups were made, restore-list validated, schema 018 retained and environment fingerprint unchanged. Only /opt/relay-client was updated.

Evidence, source emails, customer screenshots, test downloads, private QA accounts and deployment backups remain outside Git. Test runs did not replace hosted operational data or edited plans.

## Inputs still needed

- Projection formula.
- PP plan-to-slab mapping, explicit account programme/MRC profile, applicable target scopes and quality/contract/disconnection definitions.
- Higher versus cumulative gate treatment, below-185 MRC treatment, above-220 uplift stacking, eLife 80–89% treatment/attainment basis, store payout splits and ambiguous manager gate allocation.
- Any required independent initiator/approver split for branch closure or relocation.
- A separate agency hierarchy, if the client intends one instead of the agreed outlet/branch mapping.

Approved values and formulas are implemented. Undefined payable-commission interpretations are shown as awaiting configuration, rather than silently assumed. SMTP inbox delivery remains dependent on approved mail configuration.
