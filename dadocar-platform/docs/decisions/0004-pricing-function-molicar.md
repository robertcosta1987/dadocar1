# 0004 — Pricing aggregator (KBB / Molicar) as a second Function App

- **Status**: Active
- **Date**: 2026-06-02
- **Owners**: Robert
- **Supersedes**: —

## Context

The enrichment function `dadocar-dev-func-enrich-brs` aggregates Brazilian vehicle data from Infocar (FIPE pricing + vehicle decode). The webclient CRM demo at `apps/webclient/` needed a parallel surface for **KBB-aligned market pricing** broken down by sale channel (NewVehicle, UsedDealer, SellPrivateParty, SellDealer, FPP), sourced from **Molicar** via the PricingAPI v3.0.6.

Two routes were considered:

1. **Add Molicar as a third provider inside the existing enrichment Function App.** Shares Cosmos cache, MI, deploy pipeline, and the `sources[]` aggregator shape — at the cost of conflating two vendor relationships, two billing models, and two response payloads under one host.
2. **Stand up a second Function App `dadocar-dev-func-pricing-brs`** dedicated to pricing-channel data. Independent Key Vault secrets, independent host key, independent deploy lifecycle. The webclient calls each Function App directly with its own function key.

We chose (2).

## Decision

The KBB / Molicar pricing aggregator lives in a **separate Function App** `dadocar-dev-func-pricing-brs` (Linux Y1 Consumption, brazilsouth, **Node 22**) with its own provider registry, mirroring the enrichment function's pattern:

```
services/pricing-function/
├── host.json
├── package.json
└── src/
    ├── functions/pricingLookup.js   # GET /api/health (anon), /api/providers, /api/pricing/plate/{plate}, /api/pricing/vin/{vin}
    ├── lib/{secrets.js, validation.js}
    └── providers/
        ├── _types.js                 # contract: { id, displayName, isReady, lookupByPlate, lookupByVin }
        ├── index.js                  # PROVIDERS registry
        └── molicar.js                # OAuth2 client_credentials + decoder calls
```

The webclient consumes it via `src/lib/pricing/client.ts` (server-only adapter) and renders the unified payload on `/precos`. Two env vars: `PRICING_API_APP_ID` (Function App name, expanded to `https://<id>.azurewebsites.net/api`) and `PRICING_API_KEY` (host key).

## Why a separate Function App

- **Lifecycle independence.** Molicar credentials, rate-limit envelope, and SLA differ from Infocar. Rotating one vendor's secrets or scaling out pricing requests can't touch enrichment availability.
- **Failure isolation.** A bad Molicar deploy can't tank enrichment, and vice versa. Both apps run on Y1 Consumption (cold start: a few seconds), so the redundancy is free.
- **Cleaner provider registry.** The enrichment-function provider contract is keyed on Brazilian vehicle data shape; the pricing-function contract returns the vendor payload verbatim under `sources[].data` and lets the webclient shape it for display. Mixing them blurs the contract.
- **APIM mapping later.** Each app becomes a distinct APIM backend, so APIM products can map one-to-one to a Function App (`dadocar-vehicle-api` ↔ enrichment, future `dadocar-pricing-api` ↔ pricing) without per-route routing rules.

## Operational decisions made today

| Decision | Value | Rationale |
|---|---|---|
| Runtime | Node 22 LTS | Node 24 on brazilsouth Y1 is **broken** as of 2026-06 (every route 503s, SCM never warms up, App Insights logs nothing — reproduced twice with fresh apps). Node 20 is EOL-blocked by Azure for new apps. Node 22 worked first try. |
| Plan | New Y1 Consumption auto-created via `--consumption-plan-location brazilsouth` | Reusing the existing `dadocar-dev-asp-func-brs` plan triggered an `AlwaysOn cannot be set` conflict on app create. Cleaner to let CLI create a fresh plan. |
| Auth model | System-assigned MI → `Key Vault Secrets User` on `dadocardevkvbrso3uo` | Same pattern as enrichment. No vendor secrets in app settings — only `KEYVAULT_URL`. |
| Token cache | In-process, refreshed 5 min before `expires_in` | Wasteful at scale but correct. Cosmos shared cache deferred — see [next-steps/010](next-steps/010-token-manager-shared-cache.md). |
| Caching of pricing responses | None today | Pricing changes per `MY/Mileage/UF/Color` query; small payload, slow vendor (~1.5s upstream). A future shared `pricing` Cosmos container is the right place when call volume justifies it. |
| Deploy method | `func azure functionapp publish <app> --javascript --no-build` | The `az functionapp deployment` flows (`config-zip`, `deploy --type zip`, Run From Package via SAS URL) all 503'd on the stuck Node 24 apps and were never re-tested on Node 22. `func` core tools just work. |

## Vendor HTTP code mapping (per PricingAPI v3.0.6 §6)

Mirrored at both the function layer (`pricingLookup.js`) and the webclient adapter (`apps/webclient/src/lib/pricing/client.ts`):

| Upstream | Function surface in `sources[i]` | Webclient error tag → user message |
|---|---|---|
| 200 | `ok: true, data: {…}` | (render) |
| 400 | function returns 400 with `invalid_plate` | `invalid_plate` → "Placa inválida." |
| 401 | `ok: false, error: "upstream_401"` | `pricing_auth_invalid` → "Credenciais inválidas." (rotate `molicar-client-secret`) |
| 403 | `ok: false, error: "upstream_403"` | `pricing_forbidden` → "Sem permissão no plano atual." |
| 404 | `ok: false, error: "upstream_404"` | `plate_not_found` → "Placa não encontrada na base de preços." |
| 429 | `ok: false, error: "upstream_429"` | `pricing_rate_limited` → "Limite excedido. Tente novamente em instantes." |
| 502 | `ok: false, error: "upstream_502"` | `pricing_upstream_timeout` → "Fornecedor demorou demais." |

## Consequences

- **Two Function Apps to monitor.** Both write to the same `dadocar-dev-log-brs` workspace via their own App Insights instances (`dadocar-dev-func-pricing-brs` was auto-created; enrichment uses `dadocar-dev-appi-brs`). The `App*` query tables work identically; the only delta is filtering by `AppRoleName`.
- **Two host keys to rotate.** Each app's `default` function key is independent. Vercel env var `PRICING_API_KEY` belongs to the pricing app only.
- **Brazilsouth runtime caveat documented.** The Node 24 + Y1 + brazilsouth bug cost ~30 min of teardown / recreate / fresh-app / etc. Captured here, in `IaaS.MD §2.1`, and in `~/.claude/projects/-Users-robertcosta/memory/reference_azure_functions_brazilsouth.md` so it doesn't bite the next person.

## References

- Function code: `services/pricing-function/`
- Webclient adapter + UI: `apps/webclient/src/lib/pricing/`, `apps/webclient/src/app/precos/`
- Vendor docs PDF: `apps/webclient/PricingAPI.pdf`
- Enrichment function (pattern source): `services/enrichment-function/`
