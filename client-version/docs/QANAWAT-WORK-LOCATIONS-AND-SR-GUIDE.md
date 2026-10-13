# Work locations and SR verification

## Configure a branch or individual boundary

1. Sign in as an authorized Administrator or Operations Manager and open **Work locations**.
2. For a branch, choose the branch and create/edit its boundary. For one member, select the member and choose the personal-boundary control.
3. Search for the public worksite, enter latitude/longitude, or enable **Drop pin** and click the map. Drag the pin to adjust it.
4. Set the radius with the slider, preset or numeric field. The circle previews the proposed boundary before saving.
5. Save the boundary and assignment. Editing a personal boundary affects that member; it does not move the branch or other members' circles.
6. Enable enforcement only after real boundaries and assignments have been checked. A member outside the assigned boundary cannot start a shift or capture a sale. Missing, stale, mocked or uncertain GPS also cannot establish that they are inside.

Select a member or branch to view its assigned radius. A missing live point means no location was recorded, not that the member is at the branch. Members start visible work tracking with device permission and end it when their work session finishes. Collection stops on sign-out. Managers see only currently authorized members; location exports follow that scope.

Street/3D maps help position the pin. **Satellite overview** is a clearly labelled 2016 cloudless composite; it is not a current building-level photograph. **Google satellite** and **Street View** open the chosen worksite externally for finer detail where available. Use the map pin or coordinates if public-place search is unavailable.

## Find an SR difference

1. Open **SR verification** with an authorized backend account. Select the sales date. The shared branch filter narrows the displayed comparisons.
2. Upload the day's SR Excel/CSV report and choose **Preview matches**. Applying the daily file reconciles authorized daily sales across branches, as explained beside the control.
3. Compare **Recorded** and **Report** SR/request ID values. The report row number identifies the corresponding spreadsheet row.
4. Use **Mismatches**, **Pending** or **Matched**, then search by customer, SR, request ID or sales agent. Click a customer to open the linked sale.
5. Read the reason. **Not checked** means comparison is pending; **SR not recorded** means the sale needs its real SR; **Not found** means no exact SR row was found. A related row found by request ID is only a hint and does not turn a different SR into a match.
6. After checking the preview, apply verification. The comparison remains available in verification history. Backend evidence verification and external activation remain separate from the SR result; a mismatch does not undo a recorded external activation.

Sales agents and their saved designated team leaders receive read-only updates. Team leaders do not approve transactions. Email delivery requires configured SMTP; the portal shows that configuration status separately.

## Build 82 evaluation examples

Marina and Downtown include multiple team leaders. Maya Brooks is assigned to Emery Ross in Marina; Leila Quinn is assigned to Robin Ellis in Downtown. The mobile demo's account dropdown includes these new examples. The APK uses normal sign-in. Customer/order sample capture and demo SR capture use the shared backend, so their saved records are visible to authorized portal users. No sample GPS or work boundary is invented.

See [build 82 verification](QANAWAT-BUILD-82-VERIFICATION-2026-10-13.md) for release evidence and limits. Evaluation credentials remain in the private access handover, outside Git.
