# Qanawat build 82 verification — 13 October 2026

## Delivered changes

The web portal, phone-framed mobile demo and normal Android APK share the maintained client API. Build 82 improves readable body text and labels, shows each sales agent's explicit designated team leader, adds safe individual work boundaries alongside branch boundaries, and makes daily SR differences visible per sale. Existing screenshot capture, independent backend review, external activation recording and separate SR reconciliation remain intact. Administrators cannot capture sales; team leaders receive read-only updates.

Work-location management offers public-place search, typed coordinates, a draggable map pin, radius presets and a slider. Selecting a branch or member shows the assigned circle even when that member has not recorded a GPS point. A personal boundary is copied from a shared boundary before editing, so editing one member cannot silently move another member's boundary. Concurrent assignment and edit operations serialize in PostgreSQL; current authorized membership controls location reads and exports after reassignment. Map position remains stable across background refreshes.

The satellite option uses the commercially permitted EOX Sentinel-2 cloudless **2016** composite at **10 m** resolution. The map displays the date, resolution, attribution and limitation. It is not current imagery or a building-level view. Separate Google satellite and Street View links open the selected worksite for finer detail where available; their availability and age are controlled by Google. Street and 3D controls remain available in the application. No Google API key or paid provider was added.

SR verification shows the recorded SR and request ID beside the uploaded report values, report status, row number and a specific reason. Matched, mismatch and pending filters include counts, search and a direct sale link. A report row with the same request ID is a diagnostic hint, never an exact SR match. Missing SR, an unchecked report, a missing report row and a request-ID difference remain distinct. New imported comparisons are saved; older batches without a saved comparison are explicitly labelled as a comparison against the current sale. The responsive layout was checked at 1440, 1280, 1024 and 390 pixels, including cell overflow and visibility of the result column.

## Additional examples, preservation and location defaults

The explicit additive expansion added 218 related synthetic records: two team leaders, four sales agents, nine sales covering all seven product categories and all three Home Wireless router options, branch stock, product targets, drafts, support, assets and call queues. Marina and Downtown now demonstrate multiple team leaders and explicit sales-agent assignments. Examples include matched, mismatched and pending SR states, independent review, original-date cancellation and read-only notifications.

The expansion verified all **5,447 pre-existing database rows** remained unchanged. Accounts, passwords, edited plans, assignments, historical sales, stock, active sessions and location settings were preserved. A second invocation added zero rows. It is not a new operational reset. No employee positions, branch coordinates or geofences were invented. Hosted enforcement remains off until management supplies genuine boundaries. An existing work session on another device was preserved; this browser does not collect that device's location.

## Verification evidence

| Area | Verified result |
|---|---|
| Backend | Full Python suite: **634 passed**. |
| Flutter | **257 passed, one pre-existing optional fixture skip**; analysis clean. Normal release APK and the project phone-frame preview build succeeded. |
| SR comparisons | **11 browser tests passed**: exact SR/request differences, related-row hints, pending and missing fields, saved/legacy comparisons, manager read-only access, apply result and four responsive widths. |
| Geofence UI | Five individual-boundary browser checks passed, including search, pin/radius editing, selection, circle visibility, and dated cloudless imagery links. Other location checks are retained in the regression suite. |
| PostgreSQL | Six disposable-database checks passed: current schema 020 compatibility, additive preservation/idempotence, four concurrent personal edits, cross-member sharing/edit ordering, location preservation and rate limiting across two independent search workers. No external provider requests in the concurrency test. |
| Real OCR and shared workflow | A Linux test image using the deployed OCR engine passed receipt SR extraction into the same administrator record. A separate connected current screenshot-sale test passed correction/resubmission, independent backend review, retained SR state, agent/TL forbidden review requests, authorized record reads and read-only confirmation notifications. |
| Role access | Eleven portal role checks, seven forbidden mobile deep-link checks and five mobile notification-category checks passed in isolated environments. Hosted read checks passed for all **18 curated evaluation accounts**, including new team-leader assignments, nine new SR comparisons and imagery metadata. |
| Notifications | Eight portal notification checks passed after updating tests to use the existing top bell. Sidebar Notifications remains removed as requested. |
| Physical Android | Installed normal **1.0.0+82**; installed APK hash matches the hosted download. Sales agent Maya Brooks sees Marina Branch and designated leader Emery Ross. Home/Profile typography and single-line navigation were inspected. A live camera pointed at unrelated cloth left fields empty; Continue was blocked. Back returned home and closed the camera. |
| Published artifacts | Six public release hashes, API health and the installed APK hash verified. Source and asset manifests were checked before and after publishing. |

Private logs and screenshots are in `client-version/output/qa/`, excluded from Git. Test environments used synthetic evidence and disabled SMTP. The Windows QA machine does not supply Tesseract; actual OCR proof therefore uses the isolated Linux deployment image. A superseded payment-confirmation browser fixture is correctly rejected by the current evidence guard; the current screenshot workflow test above is the relevant replacement. An SSH QA tunnel interruption was resolved before the final connected passes.

## Release and rollback

Only `/opt/relay-client` was changed. Primary deployment/database backup: `/opt/relay-client/backups/demo82-release-20261013T120031Z`. Final SR label/layout follow-up backup: `/opt/relay-client/backups/demo82-sr-labels-20261013T124325Z`. Schema remains **020**, deployment environment unchanged, and the follow-up changes only web source/assets; it leaves the API image and APK unchanged. Prior hashed assets remain available while the new entry page is published last. Rollback restores the backed-up client files/image; the additive demo transaction has a verified database backup. No historical migration replay was claimed for the fresh-model PostgreSQL smoke test.

Final APK SHA-256: `1921a62d1528ec8517c61570cfcc6abd59f7170df8a617343052212354ed8d97`.

## Practical limits and outstanding configuration

Real SMTP delivery is unconfigured on the hosted service; in-app notifications work, but agent/team-leader email delivery and Inbox receipt are not verified. Existing approved incentive rates and CRR/DRR remain implemented. Unknown eligibility/allocation interpretations, projection and unspecified branch closure/agency policies still need the client decisions identified in the [requirements matrix](MODERN-TRADE-STATUS.md).

OCR is tested against readable synthetic source screens and rejection cases; this is not a promise of perfect recognition for every camera/photo/language. Physical carrier activation, actual paper printing, iOS and maximum production load were not verified by this release. SR display is capped at 5,000 daily sales after the scoped daily read; this release does not establish large-volume capacity.

Public-place search follows the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): explicit public-place queries only, no autocomplete/bulk or employee-coordinate reverse lookup, cache, identifying headers, configurable HTTPS provider and at most one aggregate external request per 1.1 seconds across PostgreSQL-backed workers. The public service has no availability guarantee; pin and coordinates remain available on search failure. A private/contracted compatible provider is needed if usage grows beyond the public service policy.

Provider references: [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), [Google Maps Embed setup](https://developers.google.com/maps/documentation/embed/quickstart), [EOX live WMTS metadata](https://tiles.maps.eox.at/wmts?service=WMTS&request=GetCapabilities). Maps URLs need no API key; an embedded Google map requires the Cloud setup even where Embed usage has no charge.
