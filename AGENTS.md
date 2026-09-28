# Relay client proposal workspace

The maintained product is `client-version/`: FastAPI/PostgreSQL, React/TypeScript and Flutter share one API. The source of scope is `docs/SCOPE.md`; the current workflow is documented in `docs/KYC-TRANSACTION-FLOW.md`.

- Update web and mobile together for changes to shared workflows and field names.
- Teams belong to branches. Intersect branch filters with the authenticated user's authorized agents; never broaden access through a UI filter.
- Location, territory and geofencing are excluded. Do not add location permissions, collection, maps or geofence reports to the client edition.
- Owner clarification on 28 September: collect identity details from ID/passport capture, optional selfie, SIM barcode/plan/phone and signature in Relay. Activation stays external in Etisalat. Then upload the activation receipt . Authorized independent staff verify the original, extracted rows before confirmation. Never simulate carrier activation or biometric approval; preserve historical records.
- Latest owner clarification removes payment verification from all clients. Retain synthetic records but remove demo and technical UI paragraphs.
- Use synthetic demo data. Keep secrets, device credentials, captured customer images, database snapshots and generated binaries outside Git.
- Run relevant backend, web and Flutter tests. Visually inspect changed desktop/mobile screens and preserve evidence outside Git.
- Repository: `https://github.com/MohammedMaheer/field-sim-activation`. The owner requests that completed changes be committed and pushed here. Check for remote changes first, use meaningful commits, and never force-push or overwrite work from another computer.
- Before a release, back up the client deployment and database, verify its migration and rollback path, and change only `/opt/relay-client`. Other VPS applications and the earlier full edition are independent.
