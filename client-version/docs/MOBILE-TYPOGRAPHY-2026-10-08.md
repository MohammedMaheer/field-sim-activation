# Mobile typography and arrangement — 8 October 2026

This pass applies to the shared Flutter app and its phone-framed browser demo. It preserves the capture workflow, stored values, role permissions and hosted records.

## Research and choice

Material's [applying-type guidance](https://m3.material.io/styles/typography/applying-type) separates headings, titles, body and labels by purpose, rather than making every text element equally prominent. The [Google Fonts description of DM Sans](https://github.com/google/fonts/blob/main/ofl/dmsans/DESCRIPTION.en_us.html) describes its intended use at smaller text sizes. [Manrope](https://github.com/google/fonts/blob/main/ofl/manrope/DESCRIPTION.en_us.html) is a modern sans-serif variable family. [Inter](https://rsms.me/inter/) was considered for its interface-focused text designs and numeric features.

The design decision is to retain the existing licensed, offline-bundled DM Sans / Manrope pairing: DM Sans for body text, fields, labels and actions; Manrope for headings and numeric totals. This keeps Relay's existing character and avoids introducing a third similar sans-serif. The visible problem was inconsistent hierarchy, heavy routine weights, default tracking, cramped columns and fixed-height containers. The same fonts now have explicit shared roles. This is a design judgment for this product, not a claim that one font is universally best.

The bundled font metadata was inspected. DM Sans has optical-size and weight axes; Manrope has a weight axis and a `tnum` feature. Tabular figures are explicitly enabled for Manrope numeric roles. The existing Open Font License files remain bundled; no runtime font download or additional font dependency was introduced.

## Shared roles and arrangement

| Role | Font / normal size | Use |
| --- | --- | --- |
| Page title | Manrope 20 / 700 | App bars and principal headings |
| Section | Manrope 17 / 700 | Capture sections, grouped details and cards |
| Reading text | DM Sans 14–15 / 400 | Values, messages and ordinary content |
| Strong reading text | DM Sans 14 / 600 | Important values and actions |
| Label | DM Sans 13 / 500 | Field labels and secondary facts |
| Caption | DM Sans 12 / 500 | Dates, categories and compact supporting text |
| Numeric | Manrope 14 / 600, tabular figures | Aligned counts/charges; enlarged for summary totals |

Reading text uses 1.25–1.4 line heights and zero extra tracking. Titles use restrained negative tracking. Normal capture fields retain their compact 14px value size and consistent outline/padding/gaps. Short customer names no longer reserve an empty second line; long names grow naturally.

The production theme is shared with layout tests. Paired actions/fields, detail rows, scanner content and the printer header respond to available width and the system text scaler. Larger text can stack fields and scroll rather than shrink or cut off content. Main actions retain 48px minimum targets. Notification titles, category, message and timestamp are separate reading elements. Compact sales pages group secondary toolbar actions in an accessible menu. Call outcomes retain field gaps.

## Verification and release

- Final Flutter suite: **107 passed**, **one optional fixture visual test skipped**; analysis clean. The 45 added real-font layout cases cover 300px, 360px and 390px widths, normal/150%/200% text scaling, readable complete values, action and field gaps, scanner/preview labels, invoice rows and printer replay. Large text wraps or stacks rather than being shrunk to fit.
- Four built-browser sign-in tests passed: prefilled default account, role switching, a dropdown account below the first page and the normal portal password form.
- **36 mobile browser views across ten sample accounts** were inspected, including agent, both branch leaders, administrator, operations, inventory, compliance, sales manager and both call teams. These are ten accounts, not ten distinct role definitions. The final capture styling/payment inset was additionally checked in **18 agent views** before publication and **18 hosted agent views** after publication, including customer/order/Payment at 360px and 390px, the preserved verified invoice and ten supporting routes. Capture responses, automatic plan selection and gated progression passed, without browser exceptions.
- Final Android **1.0.0+66** installed on the connected Xiaomi phone. Physical checks captured the synthetic customer and order screenshots, reached Payment, checked the brighter scan/upload controls and history inset, replayed the header-first downward invoice feed, and inspected invoice details, notifications and SIM stock. App-only logs had **zero matched Flutter exceptions, overflow or disposed-controller errors**. The installed APK's byte hash matches the public download.
- A separate read-only source review found no blocking regression in role/page guards, capture validation, shared endpoint usage, notification handlers or the changed layouts. Backend logic, database schema and React portal source are unchanged in this typography release; the previous backend/portal verification is recorded in `DEMO-AND-LAYOUT-UPDATE-2026-10-08.md`.

Capture probes store and parse synthetic evidence through the shared API and update the current wizard draft. They did not upload a final confirmation or submit a new operational transaction. Existing accounts, edited plans and recorded transactions were preserved. Images, device dumps, logs and generated artifacts remain in ignored `output/qa/`.

No new backend logic or schema migration is part of this typography change. Commission guidance and other previously documented client-rule decisions remain on hold. Visual checks are representative; they do not certify every pixel, every phone, native iOS or penetration-test coverage.

## Published build 66

The client-only release completed with backup `/opt/relay-client/backups/recheck-before-20261008T074002Z`. Source, assets, APK, environment and database were backed up; the database dump restored successfully into an isolated database at schema **015**. Restored counts and account/plan hashes matched the live database: 23 accounts, eight plans, twelve agents, fourteen captures, four sales and 96 SIMs. The temporary restore database was removed, and the previous API image remains available for rollback. Public health and page checks passed.

All five public files matched their final local hashes, and the installed phone APK matched the same Android artifact:

| Artifact | SHA-256 |
| --- | --- |
| Android 1.0.0+66 | `518f3d407d1c3a3ab875d9be2b19d89fb96970337f23e83c8d402b1d529dab23` |
| Portal entry | `ea277ea377ffa7d2c3de8bf585ca23f2a67e92d4e5de37e5bd5aee9faef6ab26` |
| Demo entry | `b990859b00f066b1fab6e8c4a65976121732d0ac231e91302eb93f5fbfee585d` |
| Demo application | `304e01bddd976ea9ea3d3058b7dba845e71b9083dc4fd7bb50b0755820a0374e` |
| Demo bootstrap | `47deadc0e9da7bad8bb4351c17a0924f14581465ff609bdc2c3da0836dd52b2c` |

The final release archive SHA-256 is `7623cfa93392e55fb8066036b06ee4fe5c36dd31c6f2533eef61d07e5b799242`; all 62 members matched the prepared source/artifact files. The unchanged portal entry retains its previous hash. GitHub hosted CI remains subject to the previously reported account billing restriction; no green hosted CI run is claimed here.
