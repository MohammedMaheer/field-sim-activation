# Qanawat build 83 verification — 14 October 2026

Build 83 updates the shared client API, portal, phone-framed mobile demo and Android application. Current operating instructions are in [Operations update 83](OPERATIONS-UPDATE-83.md). Historical QA documents apply to their dated release.

## Verified behavior

| Area | Current evidence |
| --- | --- |
| Backend | 709 tests passed in the Linux Python 3.12 test image, using a disposable database, SMTP disabled and local OCR dependencies. |
| Flutter | 284 tests passed with one pre-existing skip. Analysis clean. Release APK and shared-backend demo compiled. |
| Portal | 48 focused browser tests passed: 12 session/export regressions, 9 effective-grant checks, 5 notification cases, 2 current subpage/export checks, 1 connected sale/review case, 4 new operations workflows, 2 mobile-demo/shared-record flows and 13 final-commission visibility regressions. |
| New operations UI | Branch location creation and radius validation, stale edit recovery under live refetch, final commission import/preview/replay/filters, sales-agent data isolation, Admin vs Super-admin controls and rapid document navigation. Desktop and 390px screenshots inspected. |
| Exports | All 27 report-format downloads in the current portal export check produced valid CSV, XLSX or PDF responses with shared date/branch filters. This covers historical report exports and final commission exports; current sales exports remain separate. |
| PostgreSQL writes | Concurrent sale corrections/imports respect review locks; duplicate identity and stock writes do not silently overwrite. Eight simultaneous token renewals returned one replacement; sign-out revoked both current and recovery tokens. |
| Migration | PostgreSQL 020 → 022 → 020 → 022 passed. Original tables, rows and original session columns were preserved. Commission storage and nullable refresh-recovery fields are additive. |
| Hosted access | All ten demo roles signed in. Authorized core reads, restricted account controls and commission visibility agreed with effective role policy. Call-team accounts are denied the general dashboard and use their call queue. |
| Android | Physical isolated tests exercised all ten role destinations. The normal final APK was restored; package versionCode is 83. Final hosted checks confirmed support navigation, required capture validation, designated leader display and sign-out/login. No test-build remains installed. |
| Release identity | Portal entry point, mobile entry point, main Dart bundle, bootstrap, preview wrapper and hosted APK hashes matched the release manifest. Installed APK matches the hosted file: `325c0067ba5e4b612d7d61054513d187d32c530f8ad5c7bca5d05cbde17a8e69`. |

The first deployment backup is `/opt/relay-client/backups/demo83-release-20261013T184829Z`. The deployment and PostgreSQL dump were saved before mutation. Pre/post checksums for users, plans, sales, branches, sales agents, SIM inventory, captures, targets, drafts and support records matched. The existing environment file was unchanged. Only `/opt/relay-client` was released; other applications and the full edition were not changed. Portal-only corrections close navigation/access drawers on sign-out or session expiry, restore narrow-screen login scrolling, and hide final commissions and their exports from roles the API does not authorize. Historical incentive views remain available within their original scope; the API, demo and APK remain the same build.

## Practical limits and outstanding inputs

- SMTP is not configured on the hosted API. In-app notifications and durable SR email queue exist; recipient email delivery has not been verified.
- Final approved commissions can be imported and exported. Remaining commission-policy eligibility/allocation inputs and projection require client guidance; no unsupported formula was invented. Conflicting imported amounts require Super-admin review; no final-amount adjustment screen is provided yet.
- Geofencing remains off until actual branch/member locations are configured. No fictional coordinates or staff positions were seeded. Permission, accuracy, freshness and boundary checks do not provide hardware attestation against sophisticated spoofing.
- OCR checks supported readable screenshots and preserves unknown values. It cannot guarantee perfect extraction or prove authenticity of every altered image. Backend review remains independent.
- Public mapping depends on coverage. The satellite overview is the attributed dated EOX cloudless 2016 overview, not live Street View or guaranteed building-level imagery.
- This evidence is not iOS device certification, hardware paper-printer compatibility, every possible edge-case coverage or a production peak-load guarantee.

Private logs, original phone captures, browser traces, credentials, database dumps and binaries remain outside Git. Initial harness runs with a wrong port/URL, missing test-image assets/dependencies or outdated role expectations were corrected; they are not represented as successful product checks.
