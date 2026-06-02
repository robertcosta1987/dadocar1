# 0003 — Doc-update workflow on every deploy

- **Status**: Active
- **Date**: 2026-05-14
- **Owners**: Robert
- **Supersedes**: —

## Context

The Dadocar platform has two public documentation surfaces:

| Surface | Audience | URL | Updates how? |
|---|---|---|---|
| Status site | Internal / engineering / status checks | https://polite-rock-090b4930f.7.azurestaticapps.net | **Auto** — `docs/site/refresh.mjs` copies IaaS.MD + decisions/* into the deploy folder; the page fetches them at runtime. Re-deploy after each change. |
| Commercial diagrams page | Prospects / customers / sales | https://orange-island-0c113d10f.7.azurestaticapps.net | **Manual** — `docs/dadocar_diagrams_v2.html` is hand-authored HTML + inline SVG. Nothing auto-syncs from IaaS.MD. Every change has to be reflected by editing this file. |

Without an explicit rule, the commercial page drifts behind reality. Prospects open it and see a project that looks half-finished.

## Decision

Every meaningful change to the Dadocar platform — a resource added, a policy changed, a customer onboarded, a code change shipped, a new ADR — triggers an update to **both** documentation surfaces, not just one.

## The deploy checklist (run for every change)

```
□ 1. Source of truth — edit `docs/IaaS.MD` (resource table, observability section,
     request-flow text — wherever applicable).
□ 2. Decisions — add/update `docs/decisions/*.md` (new ADR or status flip on an
     existing next-steps entry).
□ 3. Status site — `cd docs && node site/refresh.mjs && \
     SWA_CLI_DEPLOYMENT_TOKEN=$(az staticwebapp secrets list -n \
     dadocar-dev-stapp-docs-brs -g rg-dadocar-dev-brs --query \
     properties.apiKey -o tsv) npx -y @azure/static-web-apps-cli@latest \
     deploy ./site --env production --no-use-keychain`.
□ 4. Commercial page — manually edit `docs/dadocar_diagrams_v2.html`:
       a. Add/edit a bullet in the top status callout describing what changed.
       b. Edit any affected SVG diagram (Visão Geral, Request Flow, Identity,
          Resource Map, etc.).
       c. Bump the version note if the change is material.
□ 5. Sync + deploy commercial — `cp docs/dadocar_diagrams_v2.html \
     docs/commercial-site/index.html && cd docs && \
     SWA_CLI_DEPLOYMENT_TOKEN=$(az staticwebapp secrets list -n \
     dadocar-dev-stapp-www-brs -g rg-dadocar-dev-brs --query \
     properties.apiKey -o tsv) npx -y @azure/static-web-apps-cli@latest \
     deploy ./commercial-site --env production --no-use-keychain`.
□ 6. Visual check — open both URLs, verify the change is visible.
```

## Mapping common changes → which diagrams to touch

Use as a lookup so I don't forget which diagrams a given change affects.

| Change type | Status callout? | SVG diagrams to update |
|---|---|---|
| New Azure resource | Yes | Diagram 9 (Resource Map). Maybe Diagram 1 (Visão Geral) if user-facing. |
| New API operation / route | Yes | Diagram 2 (Request Flow) if the route changes the customer hop. |
| Cache layer change (TTL, container, semantics) | If material | Diagram 3 (Cache-aside) + Diagram 4 (Data Flow). |
| New provider added | Yes | Diagram 4 (Data Flow) + Diagram 5 (Workflow). |
| New entry-point Function | Sometimes | Diagram 1 + Diagram 6 (Deployment Topology). |
| CI/CD wired | Yes | Diagram 6 — promote dashed edges to solid. |
| New secret or KV permission | Sometimes | Diagram 7 (Identity & Secret-Access). |
| Telemetry change (sampling, OTel) | Sometimes | Diagram 8 (Telemetry Topology). |
| APIM products/subscriptions/policies | Yes | Diagram 2 (insert APIM hop) + Diagram 7 (named-values) + Diagram 9 (status change). |
| Customer onboarded / off-boarded | Yes | Mention in callout only (subscription metadata, not architecture). |
| Production environment lands | Yes | Whole new section. Re-render most diagrams in a "prod" colour. |

## Rationale

- The commercial page is the persuasion surface; the status page is the engineering surface. Both need to track reality.
- Without a written rule, "I'll update it later" wins, and "later" never comes.
- The auto-refresh pipeline for the status page means edits to IaaS.MD propagate cheaply. The commercial page costs more (SVG edits) — so it has to be on a checklist, not a habit.

## References

- The aesthetics standard for both pages: [0002](0002-web-deploy-aesthetics-standard.md).
- Catalog of diagrams in IaaS.MD §3 (with descriptions of what each shows).
