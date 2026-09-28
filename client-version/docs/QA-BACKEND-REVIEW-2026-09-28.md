# Backend receipt review release

Published at /kyc-capture for compliance-authorized users. Original agent image on the left; transaction fields/raw OCR and Excel on the right. Reviewed evidence precedes a reasoned verify/correction decision. Agent upload and own-draft editing remain available.

Checks passed:
- Production web build and backend capture tests (5).
- Browser preview and hosted reviewer lifecycle: agent upload, VPS OCR, validation/submission, failed image-load recovery, image zoom/fit, Excel download, request correction, agent resubmission, verification and agent API status.
- Hosted original capture lifecycle and receipt entry tests (2). Covers self-review blocking and independent approval.
- Desktop and 390px screenshots visually inspected; no horizontal overflow. Evidence retained outside Git.
- API health passed after deployment. No Flutter source/API contract removal; APK build 22 and isolated mobile demo preserved.

Backup: /opt/relay-client/backups/review-workspace-20260928T072731Z. Database, migration marker, backend/web files, prior API image and prior APK preserved. No migration. Only client deployment changed. Rollback restores the prior backend/web files and API image; no database rollback is needed for this presentation/additive response change.
