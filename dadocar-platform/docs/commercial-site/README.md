# docs/commercial-site — Dadocar commercial / visual-architecture page

Single-page commercial site (PT-BR) showcasing the platform's architecture for prospects. The canonical source lives one level up at [`docs/dadocar_diagrams_v2.html`](../dadocar_diagrams_v2.html); this folder is the deploy snapshot.

## Live URL

<https://orange-island-0c113d10f.7.azurestaticapps.net>

Backed by Azure Static Web App `dadocar-dev-stapp-www-brs` (Free tier, `eastus2`, in `rg-dadocar-dev-brs`).

## Update workflow

```bash
# 1. Refresh the deploy snapshot from the source HTML
cp docs/dadocar_diagrams_v2.html docs/commercial-site/index.html

# 2. Pull the deployment token from az (per-session)
TOK=$(az staticwebapp secrets list \
  -n dadocar-dev-stapp-www-brs -g rg-dadocar-dev-brs \
  --query properties.apiKey -o tsv)

# 3. Deploy (must run from docs/, not from docs/commercial-site/)
cd docs && SWA_CLI_DEPLOYMENT_TOKEN="$TOK" \
  npx -y @azure/static-web-apps-cli@latest deploy ./commercial-site --env production --no-use-keychain
```

The file is fully self-contained — no external assets, no build step. If we later split it into HTML + CSS + assets, drop them into this folder and re-deploy.
