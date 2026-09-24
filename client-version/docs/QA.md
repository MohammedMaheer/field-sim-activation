# Client edition acceptance evidence

Current verification: 20 September 2026. Synthetic demo data only.

See the consolidated [demo readiness audit](../../docs/DEMO-READINESS-AUDIT.md) for corrected findings, scope boundaries and evidence for both editions.

- Backend: 33 tests passed; lint passed.
- Hosted web: 11 tests passed; TypeScript and production build passed.
- Flutter: clean analysis, 2 widget tests and 2 physical Android integration tests passed.
- All 19 demo accounts and their expected visibility scopes verified.
- Desktop and mobile routes captured in 22 screenshots and visually reviewed.
- Normal release APK 1.0.0+3 installed and launched after testing. Local, published and installed SHA-256 match: `99f4e437b609bd3235eb902834c9742f663f924dd1926537914e8e897cbdb2f1`.
- Hosted backend healthy; separate full edition preserved. Both apps remain installed on the phone.

Evidence is under `output/qa/`, especially `audit-final-backend.log`, `audit-release-web.log` and `audit-phone-client.log`.

The 12 client capabilities are available for demonstration. eKYC remains a labeled synthetic concept; stock and activation records are read-only. Network failure tests use an unreachable API, not physical airplane mode. Background OS workers, iOS delivery, real biometric/provider integrations and production certification are outside this verified demo result.
