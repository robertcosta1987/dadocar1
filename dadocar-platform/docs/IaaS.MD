# Dadocar — IaaS & Architecture Reference

This document is a reference for **Claude** (and humans) to understand the current shape of the Dadocar platform and to generate consistent diagrams whenever the architecture is presented, reviewed, or extended.

It is intentionally written so that pasting any of the **Diagram brief** sections below into a fresh Claude session produces a usable diagram with the right components and relationships. Keep this file up to date as the architecture evolves; otherwise generated diagrams will drift.

---

## How to use this document

- **Reading**: section 1 ("Solution overview") and section 2 ("Current state") describe the system as it exists today.
- **Generating diagrams**: section 3 contains numbered *Diagram briefs*. Each is a self-contained prompt — paste it (and its context block) into a Claude session and you'll get back Mermaid (preferred) or PlantUML markup ready to drop into another markdown file or render in VS Code.
- **Extending the platform**: section 4 describes the standard patterns — adding a new provider, a new function, a new resource — so the diagrams stay consistent across iterations.
- **Updating this file**: section 5 lists the triggers that require updating it.

When generating a diagram, Claude should:

1. Use **Mermaid** unless the brief explicitly asks for PlantUML / drawio / C4-DSL.
2. Prefer **direction `LR`** for flows that have an obvious left-to-right axis (customer → vendor), and `TD` for hierarchies.
3. Label edges with what's flowing (`HTTP+key`, `JSON body`, `secret read`), not just an arrow.
4. Annotate each node with `<br/>` followed by the resource name in the current dev environment (see section 2). Never invent names.
5. Include a small legend at the top of the diagram when symbols are non-obvious.

---

## 1. Solution overview

Dadocar is a vehicle-data API platform that resells Brazilian vehicle data (today: Infocar's FIPE-pricing API) with caching, billing, and analytics layers on top. Customers query one endpoint per vehicle (plate or chassi); the platform fans out to one-or-more registered data providers in parallel and returns a unified JSON.

**High-level layers**:

| Layer | Today's role | Future role |
|---|---|---|
| Edge / Frontend | Vercel-hosted test/admin UI (`dadocar1.vercel.app`) proxying to the aggregator. | A real customer-facing dashboard + sign-up + Stripe. The test app stays as an internal tool. |
| API gateway | Direct function key. | Azure APIM (Consumption tier already provisioned) with products + subscriptions + rate-limit policies. |
| Aggregator | Azure Function App fans out to a registry of provider modules; merges into a single `sources[]` response. | Same, plus Cosmos cache reads/writes + Event Hub `query-events` emission for analytics. |
| Providers | One: `infocar` (Codificação FIPE). | Many: Denatran, Checagem.tech, B3 scoring, vehicle-history, accident-history, etc. |
| Data plane | Cosmos DB (5 containers), Storage (Data Lake Gen2 + token-lock blob), Event Hub (`query-events`). | Same containers, populated and consumed. |
| Secrets | Key Vault (dev: `dadocardevkvbrso3uo`), RBAC mode. | Same. |
| Observability | App Insights + Log Analytics. | Same, plus a /admin dashboard. |
| Identity | Function App's system-assigned Managed Identity has data-plane roles to Cosmos, Storage, Key Vault, Event Hub. | Same. |

The MVP intentionally skips: customer apps, Stripe, APIM products/policies, prod environment, CI/CD.

---

## 2. Current state (dev environment — `rg-dadocar-dev-brs`, Brazil South)

When refreshing this section, run `az resource list -g rg-dadocar-dev-brs -o table` and cross-check.

### 2.1 Azure resources

| Resource type | Name | Purpose |
|---|---|---|
| Resource Group | `rg-dadocar-dev-brs` | All dev resources. Location: `brazilsouth`. |
| API Management (Consumption) | `dadocar-dev-apim-brs` | Public API entry point. Empty (no products/APIs) in MVP. URL: `https://dadocar-dev-apim-brs.azure-api.net`. |
| Function App (Linux Y1, Node 20) | `dadocar-dev-func-enrich-brs` | The enrichment aggregator. URL: `https://dadocar-dev-func-enrich-brs.azurewebsites.net`. System-assigned MI granted Cosmos Data Contributor, KV Secrets User, Storage Blob Data Contributor, Event Hubs Data Sender. |
| App Service Plan | `dadocar-dev-asp-func-brs` | Y1 Consumption plan backing the Function App. |
| Cosmos DB (NoSQL) | `dadocardevcosbrso3uo` | 400 RU/s shared at database `dadocar`. Containers: `vehicles` (PK `/placa`, TTL 30d), `fipe_prices` (`/codigoFipe`, no TTL), `vehicle_index` (`/lookup_key`, TTL 30d), `customers` (`/customer_id`, no TTL), `secrets` (`/secret_name`, no TTL). Local-auth disabled — RBAC only. |
| Storage (Data Lake Gen2) | `dadocardevstbrso3uo` | StandardLRS, Hot, `isHnsEnabled: true`. Containers: `query-log`, `token-lock`, `function-host`. |
| Event Hub Namespace (Basic) | `dadocar-dev-evhns-brs` | 1 throughput unit. Single hub: `query-events`, 1 partition, 1-day retention. |
| Key Vault (Standard, RBAC) | `dadocardevkvbrso3uo` | Secrets: `infocar-id-key`, `infocar-username`, `infocar-password` (today). Purge protection disabled so dev can be torn down and rebuilt. |
| Application Insights (workspace-based) | `dadocar-dev-appi-brs` | Wired to the Function App via `APPLICATIONINSIGHTS_CONNECTION_STRING`. |
| Log Analytics workspace | `dadocar-dev-log-brs` | Pay-as-you-go, 30-day retention. |

### 2.2 Vercel resources

| Resource | Identifier | Purpose |
|---|---|---|
| Vercel project | `dadocar1` (team `robertcostait-6892's projects`) | The test/admin app. Connected to GitHub repo `robertcosta1987/dadocar1`, production branch `main`, root directory `dadocar-platform/apps/infocar-test`. |
| Public URL | `https://dadocar1.vercel.app` | Frontend + serverless functions. |
| Env vars (prod + preview) | `AZURE_FUNCTION_URL`, `AZURE_FUNCTION_KEY`, `DADOCAR_GATE_SECRET` (prod only) | The Vercel proxy uses the function key to call Azure; the gate secret protects the public URL from random callers. No Infocar credentials live here. |

### 2.3 GitHub repo

| | |
|---|---|
| Repo | `robertcosta1987/dadocar1` (was `DADOCAR` — GitHub redirects the old name) |
| Default branch | `main` |
| Layout | `dadocar-platform/` mono-repo containing `infrastructure/` (Bicep + scripts), `apps/infocar-test/` (Vercel), `services/enrichment-function/` (Azure Function), `docs/` |

### 2.4 Identities & secrets

- **Deployer Service Principal** (object id `6839daed-…`): `Contributor` + `User Access Administrator` on the subscription. Used by `infrastructure/scripts/deploy-dev.sh` to create resources and assign roles. Also has `Key Vault Secrets Officer` on the dev vault so it can write secrets via CLI without re-running Bicep.
- **Function App Managed Identity** (object id `707fc169-…`): runtime identity. Reads from KV + Cosmos + Storage + Event Hub via RBAC.
- **APIM Managed Identity**: not yet wired (APIM is empty in MVP).
- **Vercel app**: holds only the function key + gate secret. Never sees Infocar credentials.

### 2.5 Request flow (canonical)

1. Browser loads `https://dadocar1.vercel.app/`. If `sessionStorage` has no token, the gate prompt is shown.
2. User submits a plate or VIN. Frontend POSTs to its own `/api/vehicle/plate/{plate}` with `Authorization: Bearer <DADOCAR_GATE_SECRET>`.
3. The Vercel serverless function (`apps/infocar-test/api/vehicle/plate/[plate].js`) gate-checks, validates the plate format, then calls the Function App at `https://dadocar-dev-func-enrich-brs.azurewebsites.net/api/vehicle/plate/{plate}` with `x-functions-key: <AZURE_FUNCTION_KEY>`.
4. The Function App's HTTP trigger (`services/enrichment-function/src/functions/vehicleLookup.js`) validates again, then calls every ready provider in parallel via `Promise.allSettled`.
5. For each provider (today only `infocar`):
   - `isReady()` checks KV for required secrets, cached for up to 5 min.
   - `lookupByPlate()` reuses or refreshes the Infocar bearer token (Infocar `POST /api/Token/GerarToken`), then calls `GET /api/v1.0/CodificacaoFipe/placa/{plate}`.
6. Function App assembles the unified response: `{ query, generated_at, ran_providers, sources: [{ id, ok, data, latency_ms, … }] }`.
7. Vercel forwards the body verbatim.
8. Frontend renders the first OK source's data into the `Dados do Veículo` + `Preços FIPE` cards and shows every source's status (id, ok/fail, latency) in the meta band.

### 2.6 Data flow (what gets persisted)

| What | Where | Status |
|---|---|---|
| Vendor credentials | Key Vault | ✅ wired today |
| Infocar bearer token | In-process cache, per Function instance | ✅ wired today |
| Vehicle lookup responses | Cosmos `vehicles` container (PK `/placa`) | ⏳ not yet wired |
| Query events | Event Hub `query-events` | ⏳ not yet wired |
| Audit logs | App Insights via `context.log()` calls | ✅ wired today |

---

## 3. Diagram briefs

Each brief is self-contained. To regenerate any diagram, paste the brief (including the **Context** block) into Claude.

### Brief 3.1 — End-to-end request flow (sequence)

**Context**: see section 2.1 (resources) + 2.5 (canonical request flow).

**Prompt**: Generate a Mermaid `sequenceDiagram` showing a successful plate lookup. Actors:
- Browser (the user's tab on `dadocar1.vercel.app`)
- Vercel proxy (`apps/infocar-test/api/vehicle/plate/[plate].js`)
- Azure Function App (`dadocar-dev-func-enrich-brs`)
- Key Vault (`dadocardevkvbrso3uo`)
- Infocar (`api.datacast3.com`)

Show: gate-secret bearer on the Browser→Vercel hop, function key on the Vercel→Function hop, KV secret reads (cached after the first), the Infocar token-exchange round-trip on the first call only, and the unified `sources[]` response shape returned all the way back. Label each arrow with the HTTP verb and a one-word payload tag. Add a note that the token is cached for ~7h45m and the KV secrets for 5 min.

### Brief 3.2 — Azure resource map (component)

**Context**: see section 2.1.

**Prompt**: Generate a Mermaid `graph LR` showing every resource currently in `rg-dadocar-dev-brs`. Group resources by purpose (Compute, Data, Identity, Observability, API gateway). Edges show:
- Function App → Cosmos: `RBAC: Cosmos DB Built-in Data Contributor`
- Function App → Key Vault: `RBAC: Key Vault Secrets User`
- Function App → Storage: `RBAC: Storage Blob Data Contributor` + `AzureWebJobsStorage runtime`
- Function App → Event Hub Namespace: `RBAC: Azure Event Hubs Data Sender`
- Function App → App Insights: `APPLICATIONINSIGHTS_CONNECTION_STRING`
- App Insights → Log Analytics: `workspace-based`
- APIM → Function App: (planned, dashed) `route + subscription key`

Annotate each node with its actual dev name from section 2.1. Mark currently-unused resources (APIM, Event Hub, Cosmos containers other than `vehicles`/`secrets`) with a dashed border or a "(unused in MVP)" label.

### Brief 3.3 — Data flow

**Context**: see section 2.6 (data flow table) + 2.5 (request flow).

**Prompt**: Generate a Mermaid `flowchart LR` showing where each kind of data lives, who writes it, and who reads it. Categories:
- Customer query (plate/VIN) — in-flight only, never persisted
- Vendor credentials — written by operator via `az keyvault secret set`, read by Function App MI
- Infocar bearer token — written/read by Function App in-process cache (annotate "future: Cosmos `secrets` container for shared cache")
- Vehicle response data — currently in-flight only (annotate "future: Cosmos `vehicles` container, TTL 30 days")
- Query events — currently logged only via App Insights (annotate "future: Event Hub `query-events`")

Distinguish read vs write edges with different arrow styles. Mark dashed edges for future-but-unwired flows.

### Brief 3.4 — How to add a new provider (workflow)

**Context**: see section 4.1.

**Prompt**: Generate a Mermaid `flowchart TD` showing the steps to add a new vehicle-data provider (e.g. Denatran). Start node: "Need: support new vendor X". Steps:
1. Decide secret names (`<vendor>-api-key`, etc.) and seed them in Key Vault.
2. Create `services/enrichment-function/src/providers/<id>.js` implementing the contract from `_types.js`.
3. Add the new module to `PROVIDERS` in `src/providers/index.js`.
4. Update `docs/IaaS.MD` section 2.1 (KV secrets) and section 4 (vendor catalog).
5. Run `func azure functionapp publish dadocar-dev-func-enrich-brs --javascript`.
6. Verify via `GET /api/providers` → new provider with `ready: true`.
7. Verify via `GET /api/vehicle/plate/{plate}?sources=<id>` → expected response under `sources[]`.

End node: "New source appears in `sources[]` on every aggregator call". Branch off at step 6 if `ready: false` — point back to "Re-check KV secret names".

### Brief 3.5 — How to add a new entry-point Function (workflow)

**Context**: a future need beyond plate/VIN — for example a `/api/vehicle/{id}/history` route that consolidates history reports.

**Prompt**: Generate a Mermaid `flowchart TD` showing how to add a new HTTP-triggered function on the enrichment Function App, leveraging the same provider abstraction:
1. Decide route shape and method.
2. Add a new file `src/functions/<routeName>.js` registering an `app.http(...)` trigger.
3. Reuse the existing provider registry by importing `providers` (call a new contract method, e.g. `lookupHistory(plate)`, if the existing provider methods aren't enough — and update `_types.js`).
4. Backfill the new method in each provider that supports it; throw `not_supported` from those that don't.
5. Publish + verify (`func azure functionapp publish`, hit the new route).

End node: "New endpoint live, gated by the same function key, surfaced under APIM later". Note the alternative path: if the new endpoint doesn't aggregate (single-source admin task), it can sit outside the provider registry — call out that exception.

### Brief 3.6 — Deployment / promotion topology

**Context**: see section 2.1, 2.2, 2.3.

**Prompt**: Generate a Mermaid `graph LR` showing the deploy paths:
- Git push to `main` on `robertcosta1987/dadocar1` →
  - GitHub webhook → Vercel auto-build (from `dadocar-platform/apps/infocar-test/`) → `dadocar1.vercel.app`
  - (no auto-deploy to Azure today — operator runs `func azure functionapp publish` from `services/enrichment-function/`)
- Bicep deploy: operator runs `infrastructure/scripts/deploy-dev.sh` with the deployer SP → subscription-scoped deployment creating `rg-dadocar-dev-brs` + all resources

Mark "future" edges (dashed):
- CI workflow → Function App publish on changes to `services/enrichment-function/**`
- CI workflow → Bicep what-if + deploy on changes to `infrastructure/bicep/**`
- prod environment with a separate RG, KV, Cosmos, etc.

### Brief 3.7 — Identity & secret-access chain

**Context**: see section 2.4 + KV secret names in section 2.1.

**Prompt**: Generate a Mermaid `graph LR` showing every principal that can read/write secrets:
- Deployer SP (`6763aeb5-…`) → KV (`Secrets Officer`): can read + write infocar-* and any new secret
- Function App MI (`707fc169-…`) → KV (`Secrets User`): can read infocar-*, denatran-*, etc.
- Operator (human, via az CLI as the SP) → KV (`Secrets Officer`)
- APIM MI (planned) → KV (`Secrets User`, future)

Show how the secrets reach Infocar: KV → Function App (DefaultAzureCredential) → Infocar `POST /Token/GerarToken` → bearer cached in-process. Annotate the cache TTL.

---

## 4. Extension patterns

### 4.1 Adding a new data provider

This is the most common extension. The provider contract is documented in `services/enrichment-function/src/providers/_types.js` as a JSDoc typedef. **Three things change**:

1. **Key Vault**: pick stable secret names (e.g. `denatran-api-key`, `denatran-tenant-id`). Seed with `az keyvault secret set --vault-name dadocardevkvbrso3uo --name … --value …`. The deployer SP already has Secrets Officer.
2. **`src/providers/<id>.js`**: mirror `infocar.js`. Read secrets with `getSecrets([...])` from `../lib/secrets`. Export `{ id, displayName, isReady, lookupByPlate, lookupByVin }`. Return the `ProviderResponse` shape — never transform vendor data; the aggregator namespaces it under `sources[].data`.
3. **`src/providers/index.js`**: add the new module to the `PROVIDERS` array.

Nothing in the HTTP triggers changes. Customers see one more entry under `sources[]`.

Then publish: `cd services/enrichment-function && func azure functionapp publish dadocar-dev-func-enrich-brs --javascript`.

### 4.2 Adding a new function (new entry point)

Use this pattern when a query doesn't fit `plate` or `chassi` (e.g. dashboard-stats, customer admin, batch-by-list).

1. Add `src/functions/<name>.js` registering one or more `app.http(...)` triggers.
2. Set `authLevel: "function"` for protected routes, `"anonymous"` only for health probes or anything you'd be comfortable exposing publicly with no key.
3. Reuse `providers` if the new endpoint aggregates across vendors. If it's a single-source admin task, call the relevant module directly.
4. Update `host.json` only if you need to change route-prefix or per-function timeouts.

### 4.3 Adding a new Azure resource

Bicep modules live in `infrastructure/bicep/modules/`. Each one is a self-contained scope-`resourceGroup` template. Add:

1. New `<resource>.bicep` mirroring the existing module structure (params at top, resource, RBAC if applicable, outputs).
2. A `module` invocation in `main.bicep`, wiring it into the dependency graph by referencing the outputs it needs.
3. A few lines in `verify-dev.sh` confirming it exists post-deploy.
4. A new row in section 2.1 of this file.

If the new resource needs the Function App MI to read/write it, wire the role assignment in the same module — except when that would create a cycle with `functions.bicep` (the Storage account already hit this case; resolved via the standalone `storage-rbac.bicep` module). Keep the same pattern for any future cycle-breakers.

### 4.4 When NOT to extend

- Do not add per-customer logic to the enrichment function — it's a fan-out worker, not a billing or tenant boundary. Customer routing belongs in APIM products + subscriptions (future work).
- Do not commit vendor credentials to the repo. Always: KV + DefaultAzureCredential.

---

## 5. Updating this document

This file must be updated alongside any change in the following categories:

| Change | Sections to update |
|---|---|
| New / removed Azure resource | 2.1, the affected diagram briefs (3.2 minimum), 4.3 if a new module was added |
| New provider added | 2.1 (KV secrets), 2.6 (data flow row if applicable), 4.1 catalog |
| New env var on Vercel or Function App | 2.2 or 2.4 |
| New function-app HTTP route | 2.5 if it changes the canonical flow, 3.5 if it's a different shape |
| Renaming resources or repos | every place the literal name appears |
| Production environment lands | new "Current state — prod" section, parallel to section 2 |
| CI/CD pipelines land | section 3.6 update — promote dashed "future" edges to solid |

When in doubt: search this file for the old name or pattern before deciding what changes.

---

## 6. Conventions for generated diagrams

- **Mermaid first.** Render with the VS Code "Markdown Preview Mermaid Support" extension or paste into <https://mermaid.live>.
- **No invented names.** If a brief refers to a resource by its kind ("the Function App"), substitute the dev name from section 2.1.
- **Mark planned-but-not-yet-wired** as a dashed edge or with the literal label `(planned)`.
- **One concept per diagram.** Don't combine "request flow" and "data flow" — keep them separate so each can grow without becoming a hairball.
- **Source of truth is this file.** If a diagram in another markdown file disagrees with section 2 here, this file wins.
