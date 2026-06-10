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
| Edge / Frontend | **Two Vercel apps**: the legacy test/admin UI (`dadocar1.vercel.app`, `apps/infocar-test`) and the productized **Placas360** customer app (`apps/webclient`) — authenticated (login + invite-gated registration), per-user **tenant isolation**, an enterprise UI, calling the pricing + CheckTudo functions and caching results in **Azure SQL**. See §2.8. | Self-serve sign-up + paywall + automatic per-customer provisioning + CRM (see [next-steps/016](decisions/next-steps/016-crm.md), [017](decisions/next-steps/017-paywall-self-serve-provisioning.md)). |
| API gateway | Direct function key. | Azure APIM (Consumption tier already provisioned) with products + subscriptions + rate-limit policies. |
| Aggregator | Azure Function App fans out to a registry of provider modules; merges into a single `sources[]` response. | Same, plus Cosmos cache reads/writes + Event Hub `query-events` emission for analytics. |
| Providers / vendors | **Three live**, across three Function Apps: **Infocar** (Codificação FIPE) as a provider module on the enrichment aggregator; **Molicar / KBB** pricing (`dadocar-dev-func-pricing-brs`); **CheckTudo** vehicle data (`dadocar-dev-func-checktudo-brs`). The Placas360 webclient consumes the pricing + CheckTudo functions. | Many more: Denatran, Checagem.tech, B3 scoring, vehicle-history, accident-history, etc. |
| Data plane | Cosmos DB (5 containers), Storage (Data Lake Gen2 + token-lock blob), Event Hub (`query-events`). | Same containers, populated and consumed. |
| Secrets | Key Vault (dev: `dadocardevkvbrso3uo`), RBAC mode. | Same. |
| Observability | App Insights + Log Analytics. | Same, plus a /admin dashboard. |
| Identity | Function App's system-assigned Managed Identity has data-plane roles to Cosmos, Storage, Key Vault, Event Hub. | Same. |

The MVP still skips: Stripe/paywall, self-serve provisioning, a CRM, APIM products/policies, prod environment, CI/CD. **New since the closed beta**: the webclient (Placas360) now has real authentication, per-user tenant isolation, a Master role, and an Anthropic-powered recall check — all on Azure SQL. See §2.8 and [decisions/0007](decisions/0007-webclient-productization.md).

---

## 2. Current state (dev environment — `rg-dadocar-dev-brs`, Brazil South)

When refreshing this section, run `az resource list -g rg-dadocar-dev-brs -o table` and cross-check.

### 2.1 Azure resources

| Resource type | Name | Purpose |
|---|---|---|
| Resource Group | `rg-dadocar-dev-brs` | All dev resources. Location: `brazilsouth`. |
| API Management (Consumption) | `dadocar-dev-apim-brs` | Public API entry point. Gateway: `https://dadocar-dev-apim-brs.azure-api.net`. **Wired** for closed beta: API `dadocar-vehicle-api` at path `/v1` (operation `GET /vehicle/plate/{placa}`); product `dadocar-beta` (subscription required, published); one customer subscription (`moneycar-tenanta-beta`). Inbound policy injects `x-functions-key` from named-value secret `func-key-enrich` on the backend hop. Gateway logs → `dadocar-dev-log-brs` Log Analytics (table: `ApiManagementGatewayLogs`). **Soft limits only** (180/min, 10k/mo) — hard `rate-limit`/`quota` policies require a tier upgrade above Consumption; see [next-steps/001](decisions/next-steps/001-apim-products-subscriptions.md). Customer one-pager: [apps/webclient/CUSTOMER.md](../apps/webclient/CUSTOMER.md). |
| Function App (Linux Y1, Node 20) | `dadocar-dev-func-enrich-brs` | The enrichment aggregator. URL: `https://dadocar-dev-func-enrich-brs.azurewebsites.net`. System-assigned MI granted Cosmos Data Contributor, KV Secrets User, Storage Blob Data Contributor, Event Hubs Data Sender. |
| Function App (Linux Y1, Node 22) | `dadocar-dev-func-pricing-brs` | KBB / Molicar pricing aggregator. URL: `https://dadocar-dev-func-pricing-brs.azurewebsites.net`. Routes: `GET /api/health` (anonymous), `GET /api/providers`, `GET /api/pricing/plate/{plate}`, `GET /api/pricing/vin/{vin}` (function key). System-assigned MI granted `Key Vault Secrets User`. Code: `services/pricing-function/`. Node 24 is **broken** in brazilsouth Y1 as of 2026-06 (TLS handshake OK but every route 503s, SCM never warms); Node 22 worked first try. Deploy: `cd services/pricing-function && func azure functionapp publish dadocar-dev-func-pricing-brs --javascript --no-build`. |
| Function App (Linux Y1, Node 22) | `dadocar-dev-func-checktudo-brs` | CheckTudo vehicle-data integration (independent of the pricing app). URL: `https://dadocar-dev-func-checktudo-brs.azurewebsites.net`. Routes: `GET /api/health` (anonymous), `GET /api/products`, `GET /api/checktudo/plate/{plate}?product=<querycode>`, `GET /api/checktudo/vin/{vin}?product=<querycode>` (function key). Async flow: vendor login token → `POST /api/query/order` → poll `GET /api/query/json-response/:id` (up to 55s). Selectable products (querycodes): 66 Veículo Total (default), 67 Essencial, 13 Decod+Precificador, 71 Dados Cadastrais, 76 Decod+FIPE, 241 Decodificador V.4. System-assigned MI granted `Key Vault Secrets User`. Code: `services/pricing-function-checktudo/`. Provision: `infrastructure/scripts/provision-checktudo-func.sh`; deploy: `func azure functionapp publish dadocar-dev-func-checktudo-brs --javascript`. |
| App Service Plan | `dadocar-dev-asp-func-brs` | Y1 Consumption plan backing `dadocar-dev-func-enrich-brs`. The pricing and CheckTudo functions each got their own Consumption plan auto-created (separate plans in the same RG) — the shared plan is Windows-kind, so Linux apps can't reuse it (AlwaysOn conflict). |
| Cosmos DB (NoSQL) | `dadocardevcosbrso3uo` | 400 RU/s shared at database `dadocar`. Containers: `vehicles` (PK `/placa`, TTL 30d), `fipe_prices` (`/codigoFipe`, no TTL), `vehicle_index` (`/lookup_key`, TTL 30d), `customers` (`/customer_id`, no TTL), `secrets` (`/secret_name`, no TTL). Local-auth disabled — RBAC only. |
| Storage (Data Lake Gen2) | `dadocardevstbrso3uo` | StandardLRS, Hot, `isHnsEnabled: true`. Containers: `query-log`, `token-lock`, `function-host`. |
| Event Hub Namespace (Basic) | `dadocar-dev-evhns-brs` | 1 throughput unit. Single hub: `query-events`, 1 partition, 1-day retention. |
| Key Vault (Standard, RBAC) | `dadocardevkvbrso3uo` | Secrets today: `infocar-id-key`, `infocar-username`, `infocar-password`, `molicar-client-id`, `molicar-client-secret`, `checktudo-username`, `checktudo-password`. Purge protection disabled so dev can be torn down and rebuilt. |
| Application Insights (workspace-based) | `dadocar-dev-appi-brs` | Wired to the Function App via `APPLICATIONINSIGHTS_CONNECTION_STRING`. |
| Log Analytics workspace | `dadocar-dev-log-brs` | Pay-as-you-go, 30-day retention. |
| Static Web App (Free) | `dadocar-dev-stapp-docs-brs` | Architecture & status site rendered from this `IaaS.MD` + `docs/decisions/`. Location: `eastus2` (SWA Free is not offered in `brazilsouth`; content is CDN-served globally). URL: <https://polite-rock-090b4930f.7.azurestaticapps.net>. Deploy: see `docs/site/README.md`. |
| Static Web App (Free) | `dadocar-dev-stapp-www-brs` | Commercial / visual-architecture site (PT-BR), single-page, self-contained. Source: `docs/dadocar_diagrams_v2.html`; deploy snapshot: `docs/commercial-site/`. Location: `eastus2`. URL: <https://orange-island-0c113d10f.7.azurestaticapps.net>. Deploy: see `docs/commercial-site/README.md`. |
| SQL Server (Standard) | `dadocar-dev-sql-webclient-dv02-brs` | Backs the customer-CRM simulator at `apps/webclient/`. SQL auth (`dadocaradmin`). Firewall: Azure services + operator IP. Suffix `dv02` was generated at first provision and is pinned in `apps/webclient/.azure-provision.state`. |
| SQL Database (Serverless GP_S_Gen5_1) | `carros_ativos_db` on `dadocar-dev-sql-webclient-dv02-brs` | Tables: `carros_ativos` (CRM demo stock), `kbb_consultas` (KBB / Molicar consultation history + 90-day cache for `/precos` — payload stored verbatim under NVARCHAR(MAX), key fields extracted into columns for list rendering). Min 0.5 vCore, auto-pause 60 min, LRS backup. Idle cost ≈ R$ 25–40/mo. Provision script: `apps/webclient/scripts/provision-azure.sh`. Migrations: `apps/webclient/db/migrations/`. |

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
| Layout | `dadocar-platform/` mono-repo containing `infrastructure/` (Bicep + scripts), `apps/infocar-test/` (Vercel), `apps/webclient/` (Next.js CRM demo, Vercel), `services/enrichment-function/` (Azure Function), `services/pricing-function/` (Azure Function), `services/pricing-function-checktudo/` (Azure Function), `docs/` |

### 2.4 Identities & secrets

- **Deployer Service Principal** (object id `6839daed-…`): `Contributor` + `User Access Administrator` on the subscription. Used by `infrastructure/scripts/deploy-dev.sh` to create resources and assign roles. Also has `Key Vault Secrets Officer` on the dev vault so it can write secrets via CLI without re-running Bicep.
- **Enrichment Function MI** (object id `707fc169-…`): runtime identity for `dadocar-dev-func-enrich-brs`. Reads from KV + Cosmos + Storage + Event Hub via RBAC.
- **Pricing Function MI** (object id `6d443573-…`): runtime identity for `dadocar-dev-func-pricing-brs`. KV Secrets User only — no Cosmos / Storage / Event Hub roles yet (provider is stateless today).
- **CheckTudo Function MI** (object id `0a0812f7-…`): runtime identity for `dadocar-dev-func-checktudo-brs`. KV Secrets User only (reads `checktudo-username` / `checktudo-password`).
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
| Vehicle lookup responses (plate mode) | Cosmos `vehicles` container, PK `/placa`, TTL 30d | ✅ wired today (cache-aside, fail-open) |
| Vehicle lookup responses (VIN mode) | Cosmos `vehicle_index` → `vehicles` (resolve VIN→plate first) | ⏳ not yet wired |
| Query events | Event Hub `query-events` | ✅ wired today (fail-open emission per request; see [decisions/0001](decisions/0001-closed-beta-launch.md) + [next-steps/008](decisions/next-steps/008-data-lake-pipeline.md) for Capture wiring) |
| Audit logs | App Insights via `context.log()` calls | ✅ wired today |
| Molicar bearer token | In-process cache per pricing Function instance, refreshed 5 min before vendor `expires_in` | ✅ wired today |
| KBB / Molicar pricing responses | Webclient Azure SQL `kbb_consultas` — full payload + extracted plate/brand/model/version/MY/fair-price/molicar-price. **Indefinite** cache (kept until cleared manually — re-queries skipped if any row exists for the placa, regardless of age) and the saved-search feed on the **Tabela KBB** page. Owner-scoped via `owner_id` (per-tenant); Master reads all. | ✅ wired today |
| CheckTudo responses | Webclient Azure SQL `checktudo_consultas` — full `data` payload + extracted brand/model/year/chassi, keyed by `placa + product_code`. **Indefinite** cache (per placa+product) and the saved-search feed on **Checa Tudo**. Also stores the AI recall verdict (`recall_afetado` / `recall_motivo`). Owner-scoped via `owner_id`; Master reads all. | ✅ wired today |
| CheckTudo login token | In-process cache per CheckTudo Function instance (JWT, ~24h; re-login on 401) | ✅ wired today |
| App users + invite codes | Webclient Azure SQL `users` + `invite_codes` — scrypt-hashed passwords (per-user salt), role (`admin`/`user`), single-use invite codes. First registered user becomes admin. | ✅ wired today |
| Session | Signed **httpOnly** cookie (HMAC-SHA256 via `AUTH_SECRET`, ~7d) — stateless; verified in middleware (edge) and server. No server-side session store. | ✅ wired today |
| Recall affected-chassi verdict | Computed once per consult by Claude (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`) and persisted on `checktudo_consultas`. | ✅ wired today |
| Parecer de Compra (buy/risk verdict) | Computed once per consult by Claude (`claude-haiku-4-5`) from compact signals; persisted on `checktudo_consultas` (`parecer_veredito` / `parecer_motivo`). | ✅ wired today |
| Infocar (FIPE) responses | Webclient Azure SQL `infocar_consultas` — flattened vehicle payload + FIPE options, keyed by `placa`. **Indefinite** cache + saved-search feed on the **Infocar** tab. Owner-scoped via `owner_id`; Master reads all. | ✅ wired today |
| Customer subscriptions + API products | Webclient Azure SQL `subscriptions` (billable customer + `sub_key`, e.g. **Moneycar** `SUB-MONEYCAR-001`) and `api_products` (sellable consult types per API + unit price). `users.subscription_id` links a user to the customer their usage bills to. | ✅ wired today (migration 0009; CheckTudo only) |
| API usage metering | Webclient Azure SQL `api_usage` — one row per consult, snapshotting subscription, product name and unit price, tagged `source` = **live** (a real CheckTudo call — **billable**) or **cache** (served from the SQL cache — **counted but never charged**). Feeds the admin "Usage Report for APIs" ("A cobrar" = live only; cache shown separately). See [decisions/0008](decisions/0008-api-usage-metering.md). | ✅ wired today |

### 2.7 Observability & log access

App Insights `dadocar-dev-appi-brs` is **workspace-based** — telemetry is stored in the Log Analytics workspace `dadocar-dev-log-brs`, not in classic App Insights storage. This matters because the **table names differ from the classic App Insights schema**, and the wrong table name silently returns zero rows.

| Telemetry kind | Classic table (don't use here) | Workspace-based table (use this) |
|---|---|---|
| HTTP requests to the Function App | `requests` | `AppRequests` |
| `context.log()` + host runtime messages | `traces` | `AppTraces` |
| Outbound HTTP calls (Infocar etc.) | `dependencies` | `AppDependencies` |
| Unhandled errors | `exceptions` | `AppExceptions` |
| Custom metrics | `customMetrics` | `AppMetrics` |
| Custom events | `customEvents` | `AppEvents` |

Direct CLI access (the SP needs `Log Analytics Reader` or higher on the workspace; the dev deployer already has `Contributor`):

```bash
WS_ID=$(az monitor log-analytics workspace show -g rg-dadocar-dev-brs -n dadocar-dev-log-brs --query customerId -o tsv)

# Function App request log, last hour
az monitor log-analytics query --workspace "$WS_ID" --analytics-query \
  'AppRequests | where TimeGenerated > ago(1h) | order by TimeGenerated desc | take 50
   | project TimeGenerated, Name, ResultCode, DurationMs, AppRoleName' -o table

# context.log() output + the host's per-invocation start/finish messages
az monitor log-analytics query --workspace "$WS_ID" --analytics-query \
  'AppTraces | where TimeGenerated > ago(1h) | order by TimeGenerated desc | take 50
   | project TimeGenerated, Message, SeverityLevel' -o table

# Outbound dependency calls (Key Vault, Infocar, etc.) — once dependency
# tracking is enabled via the OpenTelemetry distro (not yet wired in MVP).
az monitor log-analytics query --workspace "$WS_ID" --analytics-query \
  'AppDependencies | where TimeGenerated > ago(1h) | order by TimeGenerated desc | take 20
   | project TimeGenerated, Name, Target, ResultCode, DurationMs' -o table
```

Portal path: **App Insights `dadocar-dev-appi-brs` → Logs**, then run any `App*` query. The portal's "transactions search" and "live metrics" surfaces both work; the *classic* logs blade does not because there's no classic backing store.

Gotcha: `az monitor app-insights query` targets the classic schema and will return empty for a workspace-based component. Always query through `az monitor log-analytics query` against the workspace customer ID.

**Vercel-side logs** (separate from Azure) live in the Vercel runtime logs for the `dadocar1` project. Pull with `vercel logs --no-follow --since 30m -x` from inside the project root, or via the Deployments tab.

The Function App's host invocation traces appear automatically. App-code `context.log()` calls also flow through `AppTraces`. Outbound dependency tracking (Infocar latency per call) and exception capture require the `@azure/monitor-opentelemetry` distro — not yet wired in MVP; see section 4.5 when adding it.

### 2.8 Webclient app — Placas360 (`apps/webclient`)

The customer-facing app, Next.js 16 (App Router) on Vercel, talking to the **pricing** and **CheckTudo** Azure Functions and persisting to **Azure SQL**. Branded **Placas360**; enterprise/ASP.NET-style UI. This is where the productization work landed (see [decisions/0007](decisions/0007-webclient-productization.md)).

| Aspect | Detail |
|---|---|
| Vercel project | `webclient-fipe` (team `robertcostait-6892's projects`), repo `robertcosta1987/webclient_fipe`, prod branch `main`, root `apps/webclient`. Deploy = `git push` (auto). |
| Database | Azure SQL `dadocar-dev-sql-webclient-dv02-brs` / DB `carros_ativos_db`. Tables: `carros_ativos`, `kbb_consultas`, `checktudo_consultas`, `infocar_consultas`, `users`, `invite_codes`, `subscriptions`, `api_products`, `api_usage`. Migrations in `apps/webclient/db/migrations/*.sql` (run `npm run db:migrate`). |
| Auth | Custom: scrypt password hashing (Node `crypto`, no native deps), signed httpOnly session cookie (HMAC-SHA256 via Web Crypto so it verifies in both edge middleware and Node). `middleware.ts` gates every route except `/login` + `/register`. Registration requires a valid single-use **invite code**; first user becomes `admin`; admins mint codes at `/admin/convites`. |
| Tenant isolation | Every per-user table carries `owner_id`; all reads/writes filter by the logged-in user, so a tenant only sees its own cars + KBB + CheckTudo history/cache. |
| Master role | `admin@3ahub.com.br` (set in `lib/auth/server.ts` `MASTER_EMAILS`) reads **across all tenants** — history lists and the cache check drop the owner filter (incl. legacy `owner_id = NULL` rows). Writes still record the acting user. |
| Recall AI | On each CheckTudo consult, the vehicle chassi is compared against the recall campaign ranges by Claude (`claude-sonnet-4-6`); the verdict ("Chassi com Recall?" SIM/NÃO/Indeterminado + a one-line motivo) is persisted and shown in the full report (hover reveals the reason). `lib/checktudo/recallVerdict.ts`. |
| Parecer de Compra (AI) | On each CheckTudo consult, the decision signals (risk index, recall verdict, sinistro, roubo/furto, leilão, gravame/restrições, situação, nº donos, KM/rollback, débitos, FIPE 12-month trend) are distilled into a compact object (`lib/checktudo/parecer.ts`) and sent to Claude (`claude-haiku-4-5`) for a buy verdict — **COMPRAR / ATENÇÃO / EVITAR** + a one-line reason. Persisted (`parecer_veredito` / `parecer_motivo`), shown as a banner at the top of the report and a colored badge on each history card. `lib/checktudo/parecerVerdict.ts`. |
| FIPE price chart | Hovering "FIPE / Preço" shows an inline 12-month price-variation SVG chart, rendered directly from `informacoesFipe.historicoPreco` (no API call). |
| Cache policy | KBB + CheckTudo + Infocar results are cached **indefinitely** (kept until cleared manually) — no TTL expiry. |
| API metering & subscriptions | A customer (`subscriptions`, e.g. **Moneycar** `SUB-MONEYCAR-001`) is linked to users via `users.subscription_id`; sellable consult types + prices live in `api_products`. Each CheckTudo consult writes one `api_usage` row tagged `source` **live** (billable) or **cache** (counted, not charged). All current regular users are under Moneycar; the admin/Master is excluded; new users carry no subscription until configured. **APIM** also holds one **product per consult type** (`checktudo-veiculo-total`/`-essencial`/`-decod-precificador`/`-dados-cadastrais`/`-decod-fipe`/`-decod-v4`) with Moneycar subscriptions — the billing catalog; CheckTudo isn't routed through the APIM gateway yet, so counting stays app-side. See [decisions/0008](decisions/0008-api-usage-metering.md). |
| Nav | Tabs: **Infocar** (`/infocar`), **Tabela KBB** (`/precos`) and **CheckTudo** (`/checktudo`), each with inline saved-search history, plus admin-only **Convites** and **Usage Report** (`/admin/uso-apis`). Carros Ativos / Buscar / Relatórios tabs and the "+ Adicionar Veículo" button are hidden. |
| Usage report (admin) | `/admin/uso-apis` "Usage Report for APIs", visible only to the Master/admin. Aggregates `api_usage` **API → subscription → product** with quantities, amounts to charge, and timestamps; `usageReport({ subscriptionId })` supports a future per-customer view. |
| Env vars (Vercel prod + `.env.local`) | `DATABASE_URL` (Azure SQL conn string), `AUTH_SECRET` (session HMAC key), `ANTHROPIC_API_KEY` (recall + Parecer de Compra verdicts), `PRICING_API_APP_ID` / `PRICING_API_KEY`, `CHECKTUDO_API_APP_ID` / `CHECKTUDO_API_KEY`. |

> Note: the webclient's Azure SQL server is a separate resource from the aggregator's Cosmos/Storage data plane in §2.1 — it is the app's own store, not the platform cache. The longer-term plan folds customer/billing/tenant state into the platform's `customers` model (Cosmos) + a CRM; see [next-steps/002](decisions/next-steps/002-customer-model-multi-tenancy.md), [016](decisions/next-steps/016-crm.md), [017](decisions/next-steps/017-paywall-self-serve-provisioning.md).

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
- Query events — emitted to Event Hub `query-events` per request (annotate "future: EH Capture → Storage `query-log/`, see next-steps/008")

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

### Brief 3.8 — Cache-aside flow for plate lookups

**Context**: see section 2.6 (data flow) — plate-mode lookups read/write Cosmos `vehicles`. Cache helper is `src/lib/cache.js`; integration is in `src/functions/vehicleLookup.js`.

**Prompt**: Generate a Mermaid `sequenceDiagram` showing the three states of a plate lookup against the cache. Actors:
- Vercel proxy
- Function App handler (`vehicleLookup.js`)
- Cosmos `vehicles` container
- Provider (`infocar`)
- Infocar API

Show three flows side-by-side or as `alt` branches:
1. **MISS** — handler reads `vehicles` PK=plate → 404 → fan-out to providers → Infocar token + lookup → upsert into `vehicles` (fire-and-forget) → return `{cached: false, sources: [...]}`. Wall time ~3-5s on cold start, ~700ms warm.
2. **HIT** — handler reads `vehicles` PK=plate → point-read returns doc → return `{cached: true, cached_at, sources: [...]}` directly. No Infocar call. Wall time ~500ms.
3. **`?fresh=1`** — handler skips cache read, runs MISS path, still writes on success. For debug + cache poisoning recovery.

Annotate edges with the actual code paths: `cache.getCachedByPlate(plate)`, `cache.setCachedByPlate(plate, payload)`. Mark the cache write as `fire-and-forget — never fails the response`. Add a note that read errors (non-404) also fail-open: log + treat as miss.

### Brief 3.9 — Telemetry topology

**Context**: see section 2.7. App Insights `dadocar-dev-appi-brs` is workspace-based; telemetry lives in `dadocar-dev-log-blr` and is queried via the `App*` tables.

**Prompt**: Generate a Mermaid `graph LR` showing how observability data flows today and where each table sits. Nodes:
- Function App `dadocar-dev-func-enrich-brs` (writer)
- App Insights component `dadocar-dev-appi-brs` (ingestion endpoint, no backing store)
- Log Analytics workspace `dadocar-dev-log-brs` (storage)
- Operator / Portal (reader)

Edges:
- Function App → App Insights: `APPLICATIONINSIGHTS_CONNECTION_STRING` env var, labeled `instrumentation key …28ac…`
- App Insights → Log Analytics: `workspace-based ingestion`, with the table mapping (`AppRequests`, `AppTraces`, `AppDependencies`, `AppExceptions`, `AppMetrics`, `AppEvents`)
- Operator → Log Analytics: `az monitor log-analytics query`, `Portal Logs blade`
- Operator → App Insights: `Portal Live Metrics`, `Transactions Search`

Mark dashed edges:
- Function App → App Insights for `AppDependencies` (planned — requires `@azure/monitor-opentelemetry`, not yet wired)
- Function App → App Insights for `AppExceptions` (same)

Add a callout box: "Querying via `az monitor app-insights query` targets the classic schema and returns empty for workspace-based components. Always use `az monitor log-analytics query` against the workspace customer ID."

### Brief 3.10 — Webclient auth + tenant isolation (sequence)

**Context**: see §2.8. The Placas360 webclient (`apps/webclient`) gates every route via `middleware.ts`; sessions are signed httpOnly cookies (HMAC via `AUTH_SECRET`); data is owner-scoped by `owner_id`; the Master (`admin@3ahub.com.br`) reads across all tenants.

**Prompt**: Generate a Mermaid `sequenceDiagram` with participants: Browser, `middleware.ts` (edge), Server Action (`actions/checktudo.ts`), Azure SQL (`carros_ativos_db`). Show:
- Browser → middleware: any request; middleware verifies the `dc_session` cookie (HMAC). No/invalid session on a protected route → 302 `/login`; valid session on `/login`|`/register` → 302 `/precos`.
- Login: `POST` login action → `users` lookup by email → scrypt verify → `Set-Cookie dc_session` (signed) → redirect `/precos`.
- Register: requires a valid single-use `invite_codes` row → create `users` row (first ever = `admin`) → claim invite → set session.
- A consult: action calls `requireScope()` → `{ userId, master }`; cache check `findFreshByPlaca(placa, master ? null : userId)` against `checktudo_consultas` (owner filter dropped for Master). Hit → return cached; miss → vendor call → insert with `owner_id = userId`.
Label edges with the table + the owner-filter condition. Add a note: "Master drops `WHERE owner_id = @owner` for reads; writes always record the acting user."

### Brief 3.11 — Recall affected-chassi verdict (Anthropic)

**Context**: see §2.8. On a CheckTudo consult, the vehicle chassi is compared against the recall campaign ranges by Claude; the verdict is persisted on `checktudo_consultas` and shown in the report.

**Prompt**: Generate a Mermaid `flowchart LR`. Nodes: CheckTudo consult result (`data.recall`), `extractRecall()` (chassi + campaign text), `computeRecallVerdict()` → Anthropic Messages API (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`), parse `VEREDITO`/`MOTIVO`, persist `recall_afetado`/`recall_motivo` on `checktudo_consultas`, render "Chassi com Recall?" (SIM=red / NÃO=green / Indeterminado) with hover-motivo. Mark the API node as `requires ANTHROPIC_API_KEY — degrades to "Indisponível" without it`. Note: "computed once per consult (also on the persist path); the report/history read the stored verdict — no per-view API call."

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

### 4.5 Wiring dependency + exception tracking (future)

`AppRequests` and `AppTraces` flow automatically. `AppDependencies` (outbound HTTP timing per vendor) and `AppExceptions` (auto-captured thrown errors) require the OpenTelemetry distro. When ready:

1. `npm install @azure/monitor-opentelemetry` in `services/enrichment-function/`.
2. In every entry file (today only `src/functions/vehicleLookup.js`), add at the top:
   ```js
   const { useAzureMonitor } = require("@azure/monitor-opentelemetry");
   useAzureMonitor();
   ```
3. Redeploy with `func azure functionapp publish dadocar-dev-func-enrich-brs --javascript`.
4. Update section 2.7 (table mapping) and brief 3.9 (promote the dashed edges to solid).

Cost note: dependency + exception telemetry roughly doubles ingestion volume vs. requests+traces alone. Adjust the `host.json` sampling settings (already configured to exclude `Request` from sampling) if dev costs spike.

### 4.6 Wiring the VIN/chassi cache (future)

Plate-mode cache is wired today via `vehicles` PK `/placa`. VIN-mode bypasses the cache. Schema already supports the proper pattern via `vehicle_index` (PK `/lookup_key`, TTL 30d).

Recommended pattern when ready:

1. On a successful **plate** fan-out, write **both**:
   - `vehicles` doc: `{ id: plate, placa: plate, payload, fetched_at }` (already done)
   - `vehicle_index` doc(s): one per cross-reference, e.g. `{ id: vin, lookup_key: vin, plate, fetched_at }` so a future VIN lookup can resolve to the plate.
2. On a **VIN** lookup:
   - Read `vehicle_index` PK=VIN → get the plate.
   - Read `vehicles` PK=plate → return cached payload with `cached: true`.
   - Either lookup misses → fan out to providers via VIN; on the response, extract the plate from `data.dados.dadosDoVeiculo.placa` and write both docs.

The cross-reference write should be fire-and-forget (same fail-open semantics as the plate cache). Extract the plate from the provider response defensively — providers that don't return it just skip the index write.

Watch for: two providers returning **different** plates for the same VIN. Today's data shows one source, so this is theoretical, but when a second vehicle-data provider lands, decide upfront whether to (a) pick one as authoritative, (b) cache under both keys, or (c) refuse to write the index until they agree. Recommend (a) with `infocar` as default, configurable per provider.

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
| Telemetry config changes (sampling, OTel distro, classic vs workspace) | 2.7 table mapping + 3.9 diagram brief + 4.5 wiring steps |
| Cache layer wiring changes (containers, TTL, miss/hit semantics, VIN mode) | 2.6 row + 3.8 diagram brief + 4.6 extension pattern |
| Webclient auth / tenancy / Master / session changes | 2.8 + 3.10 diagram brief + [decisions/0007](decisions/0007-webclient-productization.md) |
| Webclient AI features (recall verdict, new model/prompt) | 2.6 + 2.8 + 3.11 diagram brief |
| Webclient DB schema (new table / column / migration) | 2.6 + 2.8 |

When in doubt: search this file for the old name or pattern before deciding what changes.

---

## 6. Conventions for generated diagrams

- **Mermaid first.** Render with the VS Code "Markdown Preview Mermaid Support" extension or paste into <https://mermaid.live>.
- **No invented names.** If a brief refers to a resource by its kind ("the Function App"), substitute the dev name from section 2.1.
- **Mark planned-but-not-yet-wired** as a dashed edge or with the literal label `(planned)`.
- **One concept per diagram.** Don't combine "request flow" and "data flow" — keep them separate so each can grow without becoming a hairball.
- **Source of truth is this file.** If a diagram in another markdown file disagrees with section 2 here, this file wins.
