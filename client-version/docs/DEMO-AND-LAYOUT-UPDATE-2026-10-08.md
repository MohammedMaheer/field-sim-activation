# Demo account selection and compact layouts — 8 October 2026

The mobile web demo selects a sample account from a prefilled, role-labelled dropdown. It has no email/password typing. Normal Android and portal sign-in retain their password forms. The demo still uses the shared hosted API, permissions, account and branch scopes.

## Implemented

- Default-off server opt-in (`MOBILE_DEMO_LOGIN_ENABLED`). Exactly eleven curated email/expected-role pairs are eligible. Employment status, current permissions and server password-hash checks remain enforced; no wildcard accounts, embedded passwords or broad synthetic-session bypass.
- Demo login, refresh and logout leave the portal's cookie intact. Old preview browser tokens are discarded locally on startup; the new demo has a separate refresh-token namespace. The native token key is unchanged.
- Customer/order/payment layouts have clear field and action gaps, consistent compact typography, top-aligned paired fields, padded readable step labels and a full heading in the narrow phone frame. Long captured names, packages and request IDs remain visible. Invoice reference wrapping affects display only, with original values retained for storage, semantics and exports.
- A recovered network connection clears its own stale payment-screen warning without clearing unrelated form or review errors.
- Branch **Completed sales** and **Sales today** use scoped CLOSED sales and the saved sale branch, matching the dashboard's sales model. Historical supervision and branch assignments remain intact after staff transfers. Legacy activation fields remain available for older API consumers.

## Verification

- Final backend suite: **163 passed**; Ruff clean. The new branch regression covers completed versus unfinished sales, administrator/agent/leader scopes, filtered former branches and preserved historical assignment after transfer.
- Final Flutter suite: **62 passed**, **one optional fixture visual test skipped**; Dart analysis clean. Fourteen layout tests include 300px, 360px and 390px actual-font layouts. Other new regressions cover account selection, missing catalog/retry, native password forms, legacy-token isolation, token rotation and reconnect warning recovery.
- Four built-browser account-picker tests passed on the final demo. They cover the default account, role switching, dropdown scrolling to the last role and normal portal password entry.
- Hosted authentication probe: **eleven accounts, 97 checks, zero errors**. Verified role identity, agent scope, refresh rotation, logout revocation, unchanged administrator portal cookie, normal password enforcement, unlisted-account denial and cross-origin denial.
- **37 hosted role, notification, call-selection and stock scenarios passed** on build 64. Build 65 adds layout/reconnect changes and the scoped branch sales metric; the same auth behavior remains covered by the final backend suite.
- Final build 65: **four hosted visual/navigation scenarios passed**, covering eighteen portal routes at desktop and narrow widths (**36 route views**), customer/incentive details, keyboard focus, live roster and export-card alignment. The initial detail tests used an empty current incentive period and assumed every report card had a button; they now inspect a recorded period and compare actual export cards within each grid row.
- **Six final read-only evidence review views passed**: customer, order and confirmation images at 1440px and 390px. Images loaded, comparison panes aligned/stacked, label/value rows and page bounds stayed within their containers. No review decision was changed.
- Final hosted demo customer/order capture, matching plan selection, payment-upload page and the preserved verified invoice passed at **360px and 390px**, with no browser exceptions. Flutter's unfocused semantics inputs do not expose drawn values through DOM `.value`; the first probe was corrected to validate parser responses, gated progression and rendered screenshots. The old confirmation-text assertion was also corrected to the current Invoice page/replay control.
- Android **1.0.0+65** installed on the connected Xiaomi phone. Its byte hash matches the published APK. Physical checks captured both synthetic customer/order screens, checked empty/fresh fields, field spacing, step labels, plan selection and the payment-upload page, and replayed header-first downward printing of the preserved verified invoice. App-only logs had **zero matched Flutter exceptions, overflows or disposed-controller errors**.

Running the same agent's web and phone draft simultaneously exercised the existing optimistic conflict guard. The native draft was blocked rather than overwriting the newer browser draft. A fresh native journey was then rerun after browser testing ended and reached Payment normally. No confirmation was submitted during these layout probes, and no new operational transaction was created by them.

Screenshots, private test logs, uploaded artifacts, device dumps and release manifests remain in ignored `output/qa/`. Public artifact hashes, backup identity and final publication results are recorded below for the final client-only release. These checks do not certify every pixel, native iOS, real document authenticity, sustained load or penetration-test coverage. Commission/formula guidance and previously documented client-policy decisions remain on hold; this update does not change their scope.

## Release

The release updates only `/opt/relay-client`; schema remains **015**. The release procedure backs up source, web assets, APK, environment and database, restores the dump into an isolated database, compares account/plan hashes and record counts, and retains the previous API image for rollback. The sample-account flag is covered by environment rollback. Existing accounts, edited plans and operational records are preserved.

Final release backup: `/opt/relay-client/backups/recheck-before-20261008T051633Z`. The isolated restore matched the live database: 23 accounts, eight plans, twelve agents, fourteen captures, four sales and 96 SIMs. Account and plan row hashes matched; the temporary restore database was removed. Public health and page checks passed. A subsequent read-only hosted probe confirmed that branch completed-sales totals and sales-today totals match the current dashboard; it signed out its temporary demo session afterward.

Final published artifact identities (SHA-256):

| Artifact | SHA-256 |
| --- | --- |
| Android 1.0.0+65 | `2055d35eb6a4850e13b6f707731c52f7687b8b8bf77a564549567bd85c6e23e6` |
| Portal entry | `ea277ea377ffa7d2c3de8bf585ca23f2a67e92d4e5de37e5bd5aee9faef6ab26` |
| Demo entry | `b990859b00f066b1fab6e8c4a65976121732d0ac231e91302eb93f5fbfee585d` |
| Demo application | `8cbff2c0fac96f51cbd3bd448bd06400d8d658ef0d1e7a108738e824e91c652f` |
| Demo bootstrap | `47deadc0e9da7bad8bb4351c17a0924f14581465ff609bdc2c3da0836dd52b2c` |

The release archive hash is `c59be57d36991c88f686b8eb7577a215718c4d6547eeffde5c13e5baabb517f6`. All five downloaded public artifacts matched these final local byte hashes. The installed phone APK matched the same APK hash, and the deployed backend `main.py` and `client_scope.py` also matched the workspace byte hashes.

GitHub hosted CI remains subject to the previously reported account billing restriction. Local, isolated and hosted checks above are reported separately; no green CI run is claimed.
