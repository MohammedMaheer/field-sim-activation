# Modern Trade proposal implementation status

Checked against `Modern_Trade_Software_Project.docx` on 30 September 2026. This is an internal implementation record, not client-facing copy.

## Implemented in the Relay client edition

- Agents submit the current screenshot-order workflow. New submissions create a sales-register entry linked to the agent, current team leader, branch and outlet at submission time. The assignment snapshot remains on the sale when current assignments change.
- Agents can record no-sale feedback separately. It does not count as a sale.
- Sales support New, MNP, P2P, Home Wireless, eLife, Wasel and Visitor categories. Backend managers can correct a category and router serial with an audited reason. Missing data remains Not recorded.
- Management can set monthly and daily targets; team leaders can set targets only for their assigned agents. Role-scoped sales, target, feedback and performance views are available in the web panel; agents have sales and feedback in the app and phone-framed demo.
- Performance counts closed, in-progress and cancelled sales, monthly target, remaining sales, achievement percentage and closed sales by product.
- Managers can export the sale register, preview validated CSV/XLSX status changes and apply them with audit history. The import uses unique sale IDs and rejects duplicate, unmatched or stale rows.
- Authorized backend/compliance staff can record independent tele-verification and welcome-call attempts and remarks without overwriting the other stage.
- Non-SIM field assets have branch stock records, agent assignment, movement history and agent requests. SIM inventory remains separate.
- Sales Manager is a separate branch-scoped reporting role. Administrators can create and reassign Sales Manager and dedicated call-team accounts; these roles do not gain transaction verification or stock-edit access.
- Tele-verification and welcome-call teams have separate work queues, recorded outcomes, remarks and history. Welcome calls wait until tele-verification passes or authorized management records an audited skip. In-app queue counts refresh automatically. Cancelled sales are not actionable calls.
- Stock supports serialised equipment, bulk supplies and partial issue quantities; branch, warehouse, batch, size and condition; balance adjustments with reasons; urgent requests; quantity-matched fulfilment; minimum levels and shortage alerts; movement and balance reports; filtered CSV/XLSX exports. Activated SIMs count as consumed; no stock is deducted from an order-created message alone.
- Administrators can transfer agents with assigned stock transferred or returned, and close agent access only after outstanding stock is accounted for. Sessions are revoked when assignment or employment status changes. Branch return checklists are available. Historical sale assignments remain unchanged.
- The web panel, Android app and signed-in phone demo share the same backend. Agents see permitted branch stock and can submit requests; dedicated call roles can record their queue outcomes in the app and demo.
- The existing screenshot capture, backend evidence review, external activation record and leader read-only notification remain the transaction path. Carrier activation and payment settlement are not claimed by Relay.

## Still open

The detailed 30 September audit is in [RIGOROUS-VERIFICATION-2026-09-30.md](RIGOROUS-VERIFICATION-2026-09-30.md). It also identifies bulk target upload and a historical Sales Manager assignment snapshot as unfinished; the current Sales Manager access is branch-scoped. Do not treat the implemented role as proof of the complete proposal hierarchy.

- Grabba device integration and Etisalat carrier activation require provider SDK/API access and a supported device. The app records submitted sales; it cannot initiate or attest carrier activation.
- Gateway payment settlement requires a payment-provider integration. An order-created request ID is only an agent payment record pending backend confirmation.
- Exact commission forecasts, CRR/DRR projections and month-end deduction warnings require the missing commission structure and management-approved formulas. Existing incentives do not establish those rules.
- The exact commission and projection formulas remain an input dependency, not an external API dependency. Management must supply them before calculated forecasts can be accurate.
- A configurable SIM deduction trigger by sale status would conflict with the owner's current rule: SIM activation is recorded only after independent backend verification and externally completed activation. This release preserves that rule. A branch checklist does not itself perform a branch closure or relocation.
- Calling, SMS and off-device push delivery are not integrated. Queue alerts and call outcomes work inside the signed-in web panel and app without those services.
- Old historical activation records were preserved; they were not all backfilled into the new sales register. New screenshot-order submissions enter it automatically.
- No OCR or screenshot parser can guarantee correct recognition of every carrier screen. Staff must review captured values and evidence.

## Verification boundary

The newer rigorous audit supersedes the test results below for the current release. It records the connection-pool fix, current-register dashboard, duplicate consolidation, live preservation checks and the final APK installation restriction.

Migration 012 was deployed after rehearsing PostgreSQL upgrade, downgrade and upgrade again on an isolated copy of the live database. Existing account, plan, sale and stock counts were preserved. Release backup: `/opt/relay-client/backups/operations-before-20260929T211118Z`.

The final backend suite passed 73 tests and lint passed. Web production build, Flutter analysis and 25 Flutter tests passed (one skipped). Local browser checks covered the cross-account call handoff, role-scoped screens, stock reports and the phone call-record form. Seven focused hosted browser checks passed; the destructive queue-handoff test was intentionally skipped on the hosted dataset and passed locally instead. The APK was installed on the connected phone; physical navigation checked the existing agent home, profile, SIM stock, branch equipment, shortage banner and stock-request form. Dedicated call-role physical testing is not claimed.

These checks do not prove Grabba, carrier, payment-gateway or live call-center integration. The older broad browser suite includes selectors for superseded screens and was not treated as a passing release gate.
