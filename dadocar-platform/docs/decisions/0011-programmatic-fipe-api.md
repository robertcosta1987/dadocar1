# 0011 — Programmatic FIPE API for customers (metered, key-authenticated)

- **Status**: Active
- **Date**: 2026-06-12
- **Supersedes**: —

## Context

A customer wants to call us programmatically: their app takes a license plate and needs the **FIPE current price, FIPE code and 12-month history** back (CheckTudo querycode **202**, "Decodificador e Precificador"). It must be **accounted for, monitored and charged** through the systems we already have ([0008](0008-api-usage-metering.md) metering + [0009](0009-subscription-provisioning-and-limits.md) consumption plans), not a separate billing path. APIM today is only a billing *catalog* — CheckTudo isn't routed through the gateway — so gateway-log billing would be a parallel, separate ledger.

## Decision

Expose a **unified-ledger API** in the internal webclient (`apps/webclient`):

1. **Endpoint**: `GET /api/v1/fipe/plate/{placa}` (Node runtime, `maxDuration=60`). Returns `{ ok, placa, source: live|cache, consultaId, fipe: { marca, modelo, versao, anoModelo, anoFabricacao, chassi, numMotor, combustivel, corVeiculo, tipoVeiculo, especieVeiculo, nacional, potencia, cilindradas, eixos, capMaxTracao, capacidadePassageiro, caixaCambio, numCarroceria, codigoFipe, fipeId, versaoFipe, valorAtual, historico[] } }`.
2. **Auth = per-customer API key** sent as `Authorization: Bearer <key>` (or `x-api-key`). The key is a `p360_`+40-hex secret, **bound to the customer's existing login user** (and thus its `subscription`). Stored as a **SHA-256 hash** on `users.api_key_hash` (migration 0016, unique index); plaintext shown once at issue. No new identity model, no APIM dependency.
3. **Metering reuses the UI path verbatim** (`lib/api/fipeConsult.ts`): per-tenant cache read (the customer's own prior lookup of a plate is reused → recorded `source=cache`, **not charged**); otherwise `reserveConsult` against the plan (consultas/cash/ondemand caps, 402 if exceeded) → live CheckTudo 202 → refund on failure → cache insert → `recordUsage(source=live)`. So API calls land in the **same `api_usage` ledger and `/admin/uso-apis` report** as the webclient, with the same caps.
4. **Issuance**: an operator script `scripts/issue-api-key.ts <email> [priceBRL]`, a full-provisioning script `scripts/create-api-customer.ts`, and an **admin UI** ("Acesso por API" on `/admin/assinaturas`, `actions/apiKeys.ts`). All ensure `api_products('checktudo',202)` exists (priced) and is contracted on the subscription (`subscription_quotas`), then issue/rotate the key. Re-issuing rotates.
5. **Provisioning**: create the customer in `/admin/assinaturas` (or `create-api-customer.ts`) → user + subscription + plan, then issue/assign an API key. The plan's cap (query count or R$ budget) governs the API too.
6. **Access gate (migration 0017)**: `subscriptions.api_access` — the route requires the caller's subscription to be API-enabled (403 otherwise). Issued keys on non-enabled subscriptions can't be used programmatically, so programmatic access is restricted to designated API customers; everyone else stays on the authenticated web app. `create-api-customer.ts` enables it per subscription.
7. **Audit log (migration 0017)**: every call — including rejected ones — writes `api_request_logs` (ip, geo country/city, user-agent, placa, outcome `ok`/`error`/`auth_failed`, `source` live/cache, `charged` flag, error code, http status, duration, key prefix, consultaId). The write is **awaited before responding** (serverless drops fire-and-forget work). This gives request-level parity with the web path's tracking and lets us verify legitimacy + reconcile that only completed live consults are charged.
8. **First live customer — `Moneycar_Profitcar_API_FIPE`**: subscription `sub_key` `SUB-MONEYCAR-3C9F`, plan **`ondemand`** (no cap → billed end of cycle), `api_access=1`; user `profitcar-api@moneycar.com.br` (login disabled) holds the key (prefix `p360_c67bd43`); product `checktudo/202` at **R$ 0,51**/live consult. Hosted on Vercel (`webclient-fipe` → www.placas360.com.br); data plane + vendor function in Azure `rg-dadocar-dev-brs` (Brazil South). See IaaS §2.10.

## Consequences

**Enables**: a customer integrates one authenticated endpoint; every call is reserved/charged against their plan, recorded live-vs-cache, and visible in the existing billing report. Pricing is the `api_products` unit price for code 202 (default seeded R$0,50; set per issuance). An APIM subscription key can still be layered in front later for gateway throttling without changing this.

**Accepts**: billing is **per-customer** (per-tenant cache), so two customers consulting the same plate are each charged one live consult (the vendor is paid twice) — intentional, fair-per-customer, matches the per-owner UI model. Hard quota enforcement is app-side (the atomic `reserveConsult` UPDATE), not APIM. Keys are bound to a user row; a subscription with multiple users keys off whichever user's key is used. Only querycode 202 is exposed for now; more products = more routes or a `product` param later.

## Current state

| Item | State |
|---|---|
| `GET /api/v1/fipe/plate/{placa}` (Bearer/x-api-key) | ✅ live |
| `users.api_key_hash/prefix/created_at` (migration 0016) + seed `api_products` 202 | ✅ live |
| Metered consult (cache/reserve/refund/record) via shared ledger | ✅ live |
| Access gate `subscriptions.api_access` (migration 0017) — route requires it | ✅ live |
| Audit log `api_request_logs` (migration 0017), awaited before responding | ✅ live |
| Issuance: `issue-api-key.ts`, `create-api-customer.ts`, admin UI | ✅ live |
| Live customer `Moneycar_Profitcar_API_FIPE` (ondemand, 202 @ R$0,51) | ✅ live |
| APIM gateway in front (throttling/keys) | 🔭 optional, later |
| More products / `?product=` | 🔭 later |
