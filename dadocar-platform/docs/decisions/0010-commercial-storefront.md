# 0010 — Public commercial storefront (Placas360, `apps/webclient_commercial`)

- **Status**: Active
- **Date**: 2026-06-12
- **Supersedes**: —

## Context

The internal webclient ([0007](0007-webclient-productization.md)) is login-gated and multi-tenant — built for operators and contracted customers, not for an anonymous buyer who lands from an ad and wants a single report. Selling consults to the public needs a no-login, pay-per-plate funnel. Rather than bolt a public mode onto the authenticated app, we ship a **separate Vercel app** that reuses the same Azure SQL database, the same CheckTudo Function, and the same cache.

## Decision

1. **Third Vercel app** — `apps/webclient_commercial`, deployed to `placas360.vercel.app`, repo `robertcosta1987/placas360`, prod branch `main`. Next.js 16 (App Router). It is the public **Placas360 storefront**; `apps/webclient` remains the internal authenticated app.
2. **No login — order-GUID capability model.** A purchase creates a row in `commercial_orders`; the order **GUID is the access capability** (`/consulta/<id>`). Payment is **simulated** (Stripe pending). Server actions are scoped to the order — e-mail delivery goes only to the order's own address (no open relay).
3. **Catalog, plans, bundles.** The full CheckTudo price sheet (**51 products**, `catalog.ts`) is priced at vendor base **+60% markup** and seeded into `api_products`. Plans: **Total Plus** (65), **Essencial** (67), **Decod v4** (241). Private-party **bundles** apply **−10% floored** (`Math.floor(subtotal*0.9)`), with codes + price pinned server-side by slug.
4. **Consulta Personalizada.** À-la-carte selection — **13 main codes** shown by default (`MAIN_CODES`), "Ver todas (51)" for the rest; each item billed individually. **Plate OCR ("Foto")** sends a photo to **Azure AI Vision Image Analysis 4.0** (`dadocar-dev-vision-eus`, eastus — brazilsouth lacked 4.0/Read 3.2) and a BR-plate parser fills the field.
5. **Report delivery.** Graphical render with the IA **Parecer de Compra** + Placas360 logo, plus **Baixar PDF**, **Enviar por e-mail** (Azure Communication Services `dadocar-dev-acs-brs`, data in Brazil) and **Compartilhar** (WhatsApp / Facebook).
6. **Passkey gate (temporary).** Every consult run is gated by an internal passkey verified **server-side, constant-time (`timingSafeEqual`), before any vendor call** (`CONSULT_PASSKEY`, env-only, fail-safe blocks if unset) — to prevent unwanted billed consults while the funnel is internal-only.
7. **Lisa WhatsApp bot.** WaSender webhook + on-site widget (GPT-5 Nano), per-contact history in `whatsapp_messages`, number +55 13 99138-0212. Hard rule: never ask for the plate, just hand the consult link.
8. **Rich admin logs.** `/admin/logs` (login-gated) records per consult: customer, IP + geo, OS/device/browser, screen, and an end-to-end `trace` (`consult_logs`, migration 0006 of the commercial app).

## Data model & cache

Shared `carros_ativos_db`, **15 tables**. **Cache (3, one per provider)**: `checktudo_consultas` (used by Placas360), `kbb_consultas`, `infocar_consultas` — one row per consult, kept indefinitely. **Orders**: `commercial_orders`, `consult_logs`, `admin_users`. **Metering**: `api_products` (52), `api_usage`, `subscriptions`, `subscription_quotas`, `customers`. **Internal**: `users`, `invite_codes`, `carros_ativos`. **WhatsApp**: `whatsapp_messages`.

The CheckTudo cache is keyed by **`(placa, product_code)`**, read cross-tenant. An exact plate+code repeat is reused and never re-billed (cache hits write `api_usage` with `source=cache`). **Each querycode is cached independently — combos are NOT decomposed.** Running **65 (Veículo Total +)** then **5 (Renajud)** stores `product_code=65`, then looks up `product_code=5`, finds nothing, and runs a **new billable** query — even though 65's payload already contained the Renajud data. There is **no "65 covers 3/4/5/…" map**, so buying 65 then 5 is **billed twice** at the vendor.

## Consequences

**Enables**: an anonymous buyer can purchase a single report by plate, fill it via plate OCR, read an IA buy/avoid verdict, and receive it by PDF/e-mail/share — with full diagnostic logging and a passkey guard while the funnel is internal.

**Accepts**: payment is still simulated (Stripe pending); the order GUID is an unguessable but unauthenticated capability; the passkey gate is a temporary stopgap, not per-user auth. The cache does **not** decompose combos, so atomic sub-code consults after a parent combo are re-billed — an optimization (combo→sub-codes map serving atomics from the parent's cached payload) is noted but not built. The ACS custom sender domain `email.placas360.com` is still pending SPF verification (Azure-managed sender in use meanwhile).

## Current state

| Item | State |
|---|---|
| `apps/webclient_commercial` on `placas360.vercel.app` (shared Azure SQL + CheckTudo) | ✅ live |
| No-login order-GUID model; simulated payment | ✅ live |
| 51-product catalog (+60% markup); plans 65/67/241; bundles (−10% floored) | ✅ live |
| Consulta Personalizada (main 13 + ver todas 51), per-item billing | ✅ live |
| Plate OCR "Foto" (Azure AI Vision 4.0, eastus) | ✅ live |
| Report render + PDF + e-mail (ACS) + share (WhatsApp/Facebook), Placas360 logo | ✅ live |
| Passkey gate, server-side constant-time, env-only fail-safe | ✅ live |
| Lisa WhatsApp bot (WaSender + widget), +55 13 99138-0212 | ✅ live |
| `/admin/logs` rich consult logging (IP/geo/device/screen/trace) | ✅ live |
| ACS custom sender `email.placas360.com` SPF verification | ⏳ pending |
| Stripe payment capture | ⏳ pending |
| Combo→sub-codes cache decomposition | 🔭 not built (optimization) |
