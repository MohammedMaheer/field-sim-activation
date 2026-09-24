# Continue Relay on either computer

Clone `https://github.com/MohammedMaheer/field-sim-activation` on the other computer, open the repository folder in Codex, and paste the prompt below. On this computer, open the existing project folder instead of cloning over it.

Before switching computers, ask Codex to save, commit and push the current work and report its branch and commit. GitHub synchronizes committed source; it does not transfer your Codex conversation, secrets, local databases, SDKs or APK signing keys. Transfer any needed secrets/signing keys separately through a secure channel. Never commit them.

## Copy-ready prompt

Continue my Relay Client field-sales application in this repository:
https://github.com/MohammedMaheer/field-sim-activation

First inspect the checkout, Git status, active branch, remotes and remote changes. Preserve all uncommitted work. If no checkout exists, clone the repository into a new folder. Never overwrite an existing project or force-push.

Read AGENTS.md, README.md, client-version/README.md, docs/SCOPE.md, docs/KYC-TRANSACTION-FLOW.md and client-version/docs/FINAL-PROPOSAL-RELEASE.md before editing. These files carry the current handoff; do not assume access to my earlier Codex conversations.

Work only on the proposal edition under client-version/: React/TypeScript/Vite web, Flutter mobile and a shared FastAPI/PostgreSQL backend. Update web and mobile together when changing a shared feature. Teams belong to branches and all filters must respect backend authorization. Location, territories and geofencing are excluded. Preserve the current colourful navy/burgundy/violet/teal design, readable DM Sans/Manrope typography and dashboard charts. Use synthetic demo data.

The six-stage workflow is Emirates ID/OCR, customer information, plan information, order/customer details, screenshot capture/OCR/handoff, then backend verification/live status. The first four stages happen externally in Etisalat. Relay captures or uploads screenshots, runs English/Arabic Tesseract on the VPS, supports row correction/validation, generates Excel, preserves the original image and records authorized human verification. Do not claim biometric or carrier integration.

Latest documented release is Android build 10. At that release, 36 backend tests, 15 hosted browser tests and 4 Flutter widget tests passed. Recheck the latest release notes and actual code rather than treating these as current proof. GitHub Actions was unable to start because of an account billing lock; verify its current status.

Set up missing dependencies from the README, using private local configuration. Do not assume the other computer's paths, credentials, SSH access, Android device or SDKs exist here. Ask only for genuinely missing access needed for the task, and continue independent local work meanwhile. Do not reset hosted demo data or run seed scripts against production.

Use GitHub to coordinate both computers. Before work, fetch and inspect differences. For a clean shared branch, pull with --ff-only. For new work create a descriptive codex/ branch from the latest origin/master and push it with upstream tracking. If continuing an existing branch, use its exact name and sync it first. If both computers are working simultaneously, use separate branches and separate tasks; integrate through reviewed pull requests. If branches diverge, inspect and preserve both sets of changes; never discard commits or force-push. Do not merge or deploy merely because this setup prompt was pasted.

For each completed change, run relevant backend tests and Ruff, web build and relevant Playwright tests, Flutter analysis/tests and a build when mobile changes. Run the UI and visually inspect desktop and mobile layouts. Distinguish hosted browser testing from physical-phone testing. Commit and push completed source changes, then report branch, commit, checks, remaining limitations and the next step. Before a computer handoff, push any unfinished work to its feature branch as a clearly labelled checkpoint and document what remains.

Hosted client web: https://relay-client.187-127-162-233.sslip.io/
APK: https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk?v=10
API base: https://relay-client.187-127-162-233.sslip.io/api
VPS, when deployment is requested: root@187.127.162.233, /opt/relay-client, Compose project relay-client, API loopback port 8119. Back up before releases and inspect the current migration state; do not blindly rerun one-off migration scripts. The original full edition at /opt/relay-demo, port 8118, and every other VPS app must remain untouched.

My next requested change is: [PASTE THE TASK HERE]. If no task is supplied, finish repository/setup checks, summarize the current state and ask what I want to change; do not invent new features.
