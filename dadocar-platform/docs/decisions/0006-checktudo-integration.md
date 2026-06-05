# 0006 — CheckTudo vehicle-data integration

- **Status**: Active
- **Date**: 2026-06-04
- **Owners**: Robert
- **Supersedes**: —

## Context

The platform needed a second vehicle-data source — **CheckTudo**
(`api.checktudo.com.br`) — alongside the existing KBB/Molicar pricing
integration. The brief: a new operator-facing page **"CheckTudo"** in the
webclient (to the right of "Histórico KBB"), backed by a **new, separate Azure
Function App** in the same resource group, mirroring the pricing function rather
than replacing it. Cached/saved searches should behave like the KBB page.

CheckTudo's documented integration manual (PDF) showed endpoints but not the
request bodies or the exact auth semantics. The contract was confirmed live (0
query credits spent) against the vendor's apiDoc + safe auth probes.

## Decision

### Vendor contract (verified)

1. `POST /auth/login {username,password}` → `body.token` (JWT, ~24h).
2. `POST /api/query/order` with header **`Authorization: <login token>`** and
   body `{ querycode, keys:{ placa|chassi|uf }, duplicity:false }` →
   `{ orderId, queryId, status:"enqueued" }`.
3. Poll `GET /api/query/json-response/:queryId` (same `Authorization` token) →
   `{ refClass, responseJSON }` once complete.

The login **token** authenticates the query endpoints — **not** the
`generate-api-key` value from the manual (which belongs to the synchronous
`/api/vehicle/:userid` path). Proven by a zero-cost probe: the order endpoint
returns `410 Consulta inválida` (auth OK) with the login token and `401 Token de
navegação inválido` with the apiKey. `duplicity:false` avoids re-billing a
recently-run document.

### Components

- **`services/pricing-function-checktudo/`** — independent Linux Y1 (Node 22)
  Function App `dadocar-dev-func-checktudo-brs`. Login→order→poll flow with a
  55s poll budget (Veículo Total observed at ~27s). Routes: `/api/health`,
  `/api/products`, `/api/checktudo/plate/{plate}?product=<code>`,
  `/api/checktudo/vin/{vin}?product=<code>`. Selectable products (querycodes):
  66 Veículo Total (default), 67 Essencial, 13 Decod+Precificador, 71 Dados
  Cadastrais, 76 Decod+FIPE, 241 Decodificador V.4. Credentials
  (`checktudo-username` / `checktudo-password`) read from Key Vault via the
  app's system-assigned MI (`Key Vault Secrets User`).
- **Webclient** — `/checktudo` page (product selector + placa input + a
  dictionary-driven tailored renderer that groups whatever `responseJSON`
  returns into pt-BR sections), the inline saved-search history, a server action
  with a 90-day Azure SQL cache (`checktudo_consultas`, keyed by `placa +
  product_code`), and a "CheckTudo" nav tab. New env: `CHECKTUDO_API_APP_ID` /
  `CHECKTUDO_API_KEY`.
- **Infra** — `infrastructure/scripts/provision-checktudo-func.sh` (create app +
  own Linux Consumption plan + MI + KV grant + settings + optional seed/publish)
  and `infrastructure/bicep/modules/functions-checktudo.bicep` (IaC parity).

### Why a separate function (not a provider in the pricing app)

CheckTudo is async (order→poll) with a different auth model and a per-product
response shape — a poor fit for the pricing app's synchronous `sources[]`
fan-out. Isolating it keeps each app's failure domain, scaling, and deploy
cadence independent, as the brief required.

## Consequences

- A second Consumption plan + content share exist in the RG (the shared
  `dadocar-dev-asp-func-brs` is Windows-kind, so Linux apps can't reuse it).
  Idle cost ~R$0.
- Each CheckTudo product is billed separately, so the cache key includes
  `product_code`.
- The poll budget (55s) bounds worst-case page latency; slow products can still
  `poll_timeout` and surface a retry message.

## Follow-ups

- The webclient `.env.local` had CheckTudo's Client/Secret mis-stored under
  `PRICING_API_*` (a prior-session slip). The KBB pricing app is
  `dadocar-dev-func-pricing-brs`; restore `PRICING_API_APP_ID`/`PRICING_API_KEY`
  to it when reconciling the KBB wiring.
- Optional: webhook-based delivery instead of polling; expose person/PJ
  products; share the login token via Cosmos `secrets` (see
  [next-steps/010](next-steps/010-token-manager-shared-cache.md)).

## References

- Design spec: `docs/superpowers/specs/2026-06-04-checktudo-integration-design.md`.
- Function README: `services/pricing-function-checktudo/README.md`.
- Pricing precedent: [0004](0004-pricing-function-molicar.md),
  [0005](0005-kbb-consultas-cache-and-history.md).
- Doc-update workflow: [0003](0003-doc-update-workflow.md).
