# Customer withdrawals and simpler work locations — build 86

## Customer backed out

In the web capture screen, choose **Customer backed out** beside the current step heading. In the Android app or mobile demo, open **Transaction options** and select it. This is available during customer capture, order capture and unfinished review.

Review the customer/product summary, add an optional note, then confirm. The customer name, phone and suggested product are recorded in **Sales management → No-sale feedback**. Missing details remain **Not recorded**. This action closes the interaction and all of its saved draft copies after the server confirms success. It does not upload the draft's photographs, create a sale/reference bill, or change a submitted sale.

**Keep editing** preserves the draft. A failed request also preserves it for retry. Duplicate confirmation returns the same feedback record. A submitted transaction cannot be closed this way; authorized sale cancellation is separate. Starting a new transaction after closure starts with empty fields. Historical sales and independently saved drafts for other customers remain intact.

## Work locations

- **Live locations** shows current authorized members, their location state and assigned radius. Choose a member or branch to inspect its boundary, even without a fresh GPS position.
- **Manage boundaries** contains worksite creation/editing, member assignment and the separate enforcement control.
- The boundary editor guides worksite selection, radius and naming/assignment. Search, pin placement, radius presets/slider and optional manual coordinates remain available.
- **Assign boundary** offers the branch default, a saved worksite or an individual boundary. It does not change the member's branch or team leader.
- Satellite imagery/options have been removed from shared maps and branch setup. Street maps and available 3D buildings remain, with attribution; external Street View depends on coverage.
- Location consent, work-session start/end, GPS freshness/accuracy checks, role/branch scope and export scope are unchanged. Enforcement is not automatically enabled by this release.

## Verification scope

- 18 dedicated PostgreSQL tests cover roles, ownership, saved/active draft closure, duplicate confirmation, concurrent withdrawal versus submission, and stock/sale preservation.
- 212 existing backend capture/client regression tests pass.
- Migration 023 upgrade, repeat upgrade, downgrade and re-upgrade were exercised in disposable PostgreSQL with existing-record preservation.
- Final Flutter suite: 303 passed, one existing skip; analyzer clean. The new phone workflow passed against isolated PostgreSQL, including feedback persistence, unchanged sales/captures and a fresh blank transaction. The final normal build 86 APK was restored and its SHA-256 verified.
- Web tests cover retry/cancel, partial capture, all unfinished stages, administrator restrictions, slow draft initialization, stale responses and preventing accidental sale submission.
- Responsive geofencing tests cover 390/800/1440px, individual assignments, missing boundaries, GPS/privacy/scope and exports. A real public street map and saved radius were visually inspected.
- The connected browser geofencing test covers a saved boundary, inside shift start, outside capture blocking before OCR, notification, CSV/Excel exports and ending work. Its temporary enforcement setting was restored off in the disposable QA system.

These checks cover the changed flows and related regressions. They are not an exhaustive certification of every possible device, third-party map outage or concurrent workload.

The client deployment uses a bounded pool of five persistent database connections, up to three temporary overflow connections, and a 15-second checkout wait. This remains below PostgreSQL's 30-connection ceiling and accommodates overlapping page/navigation loads without the former five-second capacity cutoff. Environment variables can further tune these validated bounds. This is a measured operating configuration, not a load-capacity certification.
