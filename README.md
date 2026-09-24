# Relay — Field Sales & KYC

The client proposal edition: a connected web portal, Flutter field app and shared API for branch teams, sales targets, screenshot KYC capture, inventory, incentives, reports and backend review.

**Start here:** [Setup and architecture](client-version/README.md) · [Agreed scope](docs/SCOPE.md) · [Verification flow](docs/KYC-TRANSACTION-FLOW.md)

## Continue on another computer

Use the [copy-ready Codex handoff prompt and two-computer workflow](docs/CONTINUE-IN-CODEX.md).

1. Clone this repository and open `client-version/`.
2. Follow its README to configure a local database/API, web app and Flutter SDK.
3. Copy `client-version/.env.example` to a private environment file and generate your own secrets. Hosted credentials are supplied separately; they are never stored in this repository.
4. Run the relevant tests before committing. Pull before starting work and push completed changes to this repository.

```sh
git clone https://github.com/MohammedMaheer/field-sim-activation.git
cd field-sim-activation/client-version
```

## Product structure

| Folder | Purpose |
| --- | --- |
| `client-version/backend` | FastAPI, PostgreSQL models, migrations, OCR, scoped services and tests |
| `client-version/web` | React dashboard, branch teams, KYC capture/review, reports and workflow tests |
| `client-version/mobile` | Flutter field app, encrypted offline drafts, camera/upload, tasks and stock |
| `client-version/deploy` | Isolated Docker and VPS release configuration |

The capture UI uses three stages: capture transaction → review details → submit and track. The first four stages happen in Etisalat; Relay captures the completed screenshot, extracts its rows on the server, generates Excel and records a human backend verification decision. It does not simulate real identity checks or carrier approval. Location and geofencing are excluded.

The demo web panel is [Relay Client](https://relay-client.187-127-162-233.sslip.io/). [Android demo download](https://relay-client.187-127-162-233.sslip.io/downloads/relay-client-scope.apk).

GitHub Actions checks the API, web build and Flutter analysis/tests. Browser OCR testing additionally needs a running API with English/Arabic Tesseract installed. All seeded records and test images are synthetic.
