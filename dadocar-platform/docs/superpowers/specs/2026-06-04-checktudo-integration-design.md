# CheckTudo Integration — Design

**Date:** 2026-06-04
**Status:** Approved (design phase)

## Goal

Add a second, fully independent vehicle-data integration — **CheckTudo**
(`api.checktudo.com.br`) — alongside the existing KBB/Molicar pricing
integration. Deliver:

1. A **new, separate Azure Function App** (`pricing-function-checktudo`) in the
   **same resource group** as the existing pricing function, mirroring it, not
   replacing it. The two functions run independently.
2. A new webclient page **"CheckTudo"**, placed in the top nav **to the right of
   "Histórico KBB"**, that mirrors the `/precos` experience: cached searches and
   saved-search history behave the same.

The existing KBB function, pages, cache, and history are left untouched.

## Verified API contract (confirmed live, 0 query credits spent)

Auth and the async query flow were probed against the live API using the
credentials in `apps/webclient/.creds`.

1. **Login** — `POST https://api.checktudo.com.br/auth/login`
   `{ "username", "password" }` → `body.token` (JWT, `exp - iat = 86400s` ≈ 24h).
2. **Create order** — `POST https://api.checktudo.com.br/api/query/order`
   - Header **`Authorization: <login token>`** (NOT the generated apiKey — proven:
     login token → `410 Consulta inválida` = auth OK; apiKey → `401 Token de
     navegação inválido` = auth fail).
   - Body `{ "querycode": <int>, "keys": { "placa" | "chassi" | "uf" | ... }, "duplicity": false }`.
   - → `body { orderId, queryId, status: "enqueued", createdAt }`.
3. **Fetch result** — `GET https://api.checktudo.com.br/api/query/json-response/:queryId`
   - Header `Authorization: <login token>`.
   - → `body { _id, refClass, responseJSON: { ... } }` once the query completes.
4. **Order status (optional poll aid)** — `GET /api/query/order/:orderId`
   → `body { status, finishedAt, ... }`.

The PDF's `generate-api-key` step is **not** used by this async flow (it belongs
to the synchronous `/api/vehicle/:userid` path) and is dropped.

`querycode` catalog (vehicle subset used here): 66 Veículo Total, 67 Veículo
Essencial, 13 Decodificador e Precificador, 71 Dados Cadastrais, 76
Decodificador + Histórico FIPE, 241 Decodificador V.4. (Full catalog of ~70
codes captured during research; only the vehicle decoder family is exposed.)

`duplicity:false` avoids re-billing a recently-run document (per the PDF's
Duplicity slide).

## Part 1 — Azure Function (`services/pricing-function-checktudo`)

Mirrors the KBB function's structure (secrets.js, validation.js, providers
registry, host.json routePrefix=api, Key Vault via Managed Identity).

- **`providers/checktudo.js`** — rewritten to the verified contract:
  - In-process login-token cache (~23h TTL; refresh on 401).
  - `submitOrder(querycode, keys)` with `Authorization: <token>`.
  - `pollUntilReady(queryId)` — GET json-response until `responseJSON` lands or a
    ~28s budget expires (keeps inside the 30s sync invocation budget). Treats a
    "still processing" body / 404 as pending.
  - `lookupByPlate(plate, querycode)` / `lookupByVin(vin, querycode)`.
  - Dead `apikey` header and webhook code removed.
- **`functions/checktudoLookup.js`** — HTTP triggers (authLevel `function`):
  - `GET /api/checktudo/plate/{plate}?product=<querycode>` (default 66).
  - `GET /api/checktudo/vin/{vin}?product=<querycode>`.
  - `GET /api/products` — returns the selectable querycode allow-list + labels.
  - `GET /api/health` — liveness, leaks nothing about credentials.
  - `product` validated against the allow-list `{66,67,13,71,76,241}`; unknown →
    400. Response envelope:
    `{ ok, product:{code,name}, queryId, data, latency_ms, raw, error?, message? }`.
- **Secrets:** `checktudo-username`, `checktudo-password` in the existing dev Key
  Vault. `package.json` name/description updated; README rewritten for CheckTudo.

## Part 2 — Webclient (`apps/webclient`, Next.js 16 / Azure SQL)

Mirrors `/precos` + `/historico-kbb`. DB engine is Azure SQL (mssql), same as
`kbb_consultas`.

- **`src/lib/checktudo/types.ts`** — Zod schema for the function envelope. The
  inner `data` is kept permissive (`.passthrough()`, recursive) because the
  shape varies per product; a small typed core (placa, chassi, renavam, marca,
  modelo, ano, combustível, FIPE) is extracted for table columns.
- **`src/lib/checktudo/client.ts`** — server-only adapter. Base URL from
  `CHECKTUDO_API_APP_ID` (app name → `https://<app>.azurewebsites.net/api`, or a
  full URL for local), `CHECKTUDO_API_KEY` in `x-functions-key`. HTTP-code →
  stable error tag mapping like `pricing/client.ts`.
- **`db/migrations/0003_checktudo_consultas.sql`** — `checktudo_consultas`
  mirroring `kbb_consultas` plus `product_code SMALLINT NOT NULL` and
  `product_name NVARCHAR(60)`. Index on `(placa, product_code, consulted_at DESC)`.
- **`src/lib/db/checktudoConsultas.ts`** — repo: `findFreshByPlaca(placa,
  productCode)` (90-day cache, per product), `insert`, `listRecent`, `getById`.
- **`src/app/actions/checktudo.ts`** — `lookupPlacaChecktudo(placa, productCode,
  opts)`: normalize → cache check keyed by **(placa, productCode)** → live call →
  persist (fire-and-forget). `forceRefresh` bypasses cache. pt-BR error map.
- **`src/app/checktudo/page.tsx` + `CheckTudoClient.tsx`** — product `<select>`
  (default 66) + placa input. **Tailored, dictionary-driven renderer**: a
  field-label dictionary maps known keys → `{ label, section, formatter }`,
  grouping into labeled pt-BR sections (Identificação · Motor & Câmbio ·
  Características · FIPE / Preço · Procedência & Local · Restrições & Débitos).
  Nested objects are flattened; unknown keys are humanized into an "Outros
  dados" section. Includes the inline saved-search history list + raw-JSON
  viewer, mirroring the KBB pages. Cache-hit badge + "forçar nova consulta".
- **`src/components/TopBar.tsx`** — add `{ href: "/checktudo", label: "CheckTudo" }`
  immediately after the "Histórico KBB" entry (rightmost nav item).

History: a single "CheckTudo" tab carrying the inline saved-search list (the
"cached/saved searches stay the same" requirement). No separate history tab is
added unless requested.

## Part 3 — Provisioning (new app + resources, same RG)

The existing pricing app was created ad-hoc (not in committed Bicep). Deliver
both an IaC module and a runnable script; reuse shared resources, isolate the
app:

- **`infrastructure/scripts/provision-checktudo-func.sh`** — `az functionapp
  create` for `dadocar-dev-func-checktudo-brs` in `rg-dadocar-dev-brs`, Linux
  Consumption (Y1), Node 20, reusing the existing storage account (own
  `WEBSITE_CONTENTSHARE`), App Insights, and Key Vault; system-assigned MI +
  `Key Vault Secrets User` grant; `KEYVAULT_URL` app setting. Then `func azure
  functionapp publish`.
- **`infrastructure/bicep/modules/functions-checktudo.bicep`** — IaC parity
  mirror of `functions.bicep` (optional path; not wired into a full-stack
  redeploy to avoid disturbing other resources).
- **Webclient env:** add `CHECKTUDO_API_APP_ID` + `CHECKTUDO_API_KEY`; document
  in `.env.example`. (Note: `.env.local` currently has CheckTudo Client/Secret
  mis-stored under `PRICING_API_*` — left as-is unless restoring KBB wiring is
  in scope; CheckTudo gets its own vars.)

Cloud execution (provision, Key Vault secret seeding, SQL migration, publish) is
run via Bash with `az login` present; each billable/outward-facing step is
confirmed before running.

## Error handling

- Function never throws upstream errors out of the handler; failures become
  `{ ok:false, error, message, upstream_status }`. Poll timeout → `poll_timeout`.
- Client adapter maps HTTP codes to stable tags; action translates to pt-BR.
- Cache failures never block a live consult (try/catch + fall through), matching
  the KBB action.

## Testing / verification

- Function: local `func start` (port 7073 to avoid clashing with enrichment 7072
  / KBB 7072), `curl /api/health`, `/api/products`, and one real
  `/api/checktudo/plate/{plate}?product=66` (one paid query, confirmed first).
- Webclient: `pnpm build` typecheck; manual page load; cache-hit on repeat.
- Docs: update `docs/IaaS.MD`, `docs/decisions` (new ADR), and both web docs per
  the standing deploy-docs workflow.

## Out of scope

- The synchronous `/api/vehicle/:userid` + apiKey path.
- Person/PJ products (`/api/person`), débitos-only / leilão / gravame as
  first-class pages (the generic renderer still displays them if selected).
- Webhook-based async delivery (polling is sufficient within budget).
