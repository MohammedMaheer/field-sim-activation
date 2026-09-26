# Relay client proposal workspace

The maintained product is `client-version/`: FastAPI/PostgreSQL, React/TypeScript and Flutter share one API. The source of scope is `docs/SCOPE.md`; the current workflow is documented in `docs/KYC-TRANSACTION-FLOW.md`.

- Update web and mobile together for changes to shared workflows and field names.
- Teams belong to branches. Intersect branch filters with the authenticated user's authorized agents; never broaden access through a UI filter.
- Location, territory and geofencing are excluded. Do not add location permissions, collection, maps or geofence reports to the client edition.
- The owner approved the full ZIP three-stage demo on 26 September: identity/eKYC, SIM/plan allocation, activation/receipt. Label identity, liveness, carrier and SMS simulations explicitly; do not claim real biometric verification or carrier approval. Preserve the separate screenshot capture, server OCR, row review, Excel generation, backend verification and status synchronization workflow. Real Etisalat operations remain external.
- Use synthetic demo data. Keep secrets, device credentials, captured customer images, database snapshots and generated binaries outside Git.
- Run relevant backend, web and Flutter tests. Visually inspect changed desktop/mobile screens and preserve evidence outside Git.
- Repository: `https://github.com/MohammedMaheer/field-sim-activation`. The owner requests that completed changes be committed and pushed here. Check for remote changes first, use meaningful commits, and never force-push or overwrite work from another computer.
- Before a release, back up the client deployment and database, verify its migration and rollback path, and change only `/opt/relay-client`. Other VPS applications and the earlier full edition are independent.
