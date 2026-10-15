# Branch and individual work boundaries

15 October 2026. This update changes the administration screen and shared API; the existing Android and mobile-demo clients read their effective boundary through the same API.

## Using the assignment filter

1. Open **Work locations → Manage boundaries**.
2. Under **Assign work boundaries**, choose **Branches** or **Individuals**.
3. For a branch, select **Assign branch boundary**, choose an active saved boundary and inspect its radius on the map. Create or edit the worksite first if necessary.
4. If members have individual boundaries, acknowledge replacing them. Select **Apply to all branch members**. Everyone assigned to that branch then inherits its boundary, including branch-linked leaders and sales agents. New members without a personal override inherit it automatically.
5. For a single member, choose **Individuals → Assign boundary**. Use their branch default, another saved worksite or a personal location/radius.

The shared branch selection filters both lists. No branch or team-leader assignment changes. Old location records retain their original boundary snapshots. Applying a saved worksite from another branch copies its center/radius into the selected branch; it does not move the source boundary or change an outside member's saved assignment. Individual overrides are replaced only after explicit acknowledgement, including accounts currently not displayed as active sales agents.

## Checks

- 77 backend tests passed for whole-branch assignment, individual boundaries, location/privacy gates and branch-location setup. The 12 new assignment cases were rerun after extending reassignment/history assertions.
- 24 browser cases cover assignment filters, shared branch selection, 390/800/1440px layouts, member configuration, role visibility, retry feedback and existing location controls.
- Connected browser/API testing uses a disposable PostgreSQL database. It applies the branch boundary through the UI, checks every current branch member and the signed-in member API, rejects a sales-agent management request, verifies inside capture eligibility and immediate outside classification after the boundary moves, then restores temporary enforcement off and ends the work session.
- No database schema change, Android permission change, fabricated location or production enforcement change is required.

Deployment must back up the client files and PostgreSQL database, preserve the existing connection-pool settings, verify the database archive/restore and publish matching API/web source. Rollback restores the previous API image and web entry/assets; no migration downgrade is necessary.
