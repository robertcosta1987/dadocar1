# Dadocar — Vehicle Data API Platform

A vehicle data API platform that resells Infocar's FIPE pricing API with caching, billing, and analytics layers on top.

This repository is the **mono-repo** for the platform. Today it contains:

- `infrastructure/` — Azure infrastructure as code (Bicep) for the **DEV** environment and the scripts that deploy / destroy / verify it.
- `apps/infocar-test/` — a small local web app (Node proxy + vanilla HTML/JS) that queries Infocar's API end-to-end. Used to validate Infocar's response shape; **no Azure involvement**.
- `services/` — placeholder folders for future application code (enrichment Function, token manager, provisioning orchestrator, Stripe webhook handler, de-identification job). All empty in the MVP.
- `docs/` — operational documentation.

## MVP scope

This iteration deploys the **DEV** environment only. The following are explicitly out of scope and live as empty placeholders:

- Application logic in `services/*`
- Customer-facing apps (sign-up, dashboard, marketing site)
- Stripe integration
- APIM products, subscriptions, OpenAPI specs, or policies (the APIM instance is provisioned empty)
- Production environment (`prod.bicepparam` is a placeholder; nothing deploys to prod)
- CI/CD pipelines

## Quick start

1. Set the four `AZURE_*` env vars (copy `.env.example` → `.env` and fill in).
2. Read [docs/dev-setup.md](docs/dev-setup.md).
3. Deploy: `./infrastructure/scripts/deploy-dev.sh`
4. Verify: `./infrastructure/scripts/verify-dev.sh`
5. Tear down when done: `./infrastructure/scripts/destroy-dev.sh`

The Infocar test app is independent of Azure:

```bash
cd apps/infocar-test
cp .env.example .env       # fill in Infocar creds when activated
npm install
node server/proxy.js
open http://localhost:3001
```

See [apps/infocar-test/README.md](apps/infocar-test/README.md).
