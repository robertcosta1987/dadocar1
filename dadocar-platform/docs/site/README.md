# docs/site — Dadocar architecture & status site

A single-page static site that renders [`docs/IaaS.MD`](../IaaS.MD) and [`docs/decisions/`](../decisions/) as the source of truth, with the 9 Mermaid diagrams from §3 authored alongside.

## Live URL

<https://polite-rock-090b4930f.7.azurestaticapps.net>

Backed by Azure Static Web App `dadocar-dev-stapp-docs-brs` (Free tier, `eastus2`, in `rg-dadocar-dev-brs`).

## Layout

```
docs/site/
  index.html              page shell (marked + mermaid via CDN, fetches content/ at runtime)
  style.css               two-pane layout
  staticwebapp.config.json  MIME types, no-cache headers
  diagrams/*.mmd          hand-authored Mermaid for IaaS.MD §3 briefs
  refresh.mjs             copies live IaaS.MD + decisions/** into content/ and writes manifest.json
  content/                generated, .gitignored — produced by refresh.mjs
```

The HTML fetches the markdown at runtime — no build step, no JS bundler. To update the site after editing source markdown:

```bash
# 1. Refresh content/ from the live source files
node docs/site/refresh.mjs

# 2. Deploy. The token lives in az; pull it once per session:
TOK=$(az staticwebapp secrets list \
  -n dadocar-dev-stapp-docs-brs -g rg-dadocar-dev-brs \
  --query properties.apiKey -o tsv)

# 3. Deploy (must run from docs/, not from docs/site/)
cd docs && SWA_CLI_DEPLOYMENT_TOKEN="$TOK" \
  npx -y @azure/static-web-apps-cli@latest deploy ./site --env production --no-use-keychain
```

`refresh.mjs` stamps a `content/manifest.json` with the current commit hash and timestamp; the site footer shows it.

## Update triggers

Per [`IaaS.MD` §5](../IaaS.MD#5-updating-this-document), any change to the architecture, resources, or decisions implies an IaaS.MD or `decisions/` edit. After those edits, run the two-step deploy above. The site auto-reflects whatever's in source.

## Why no GitHub Action?

CI/CD is tracked as [next-steps/004](../decisions/next-steps/004-cicd-github-actions.md). When that lands, the deploy script above becomes a workflow with the token in repo secrets.
