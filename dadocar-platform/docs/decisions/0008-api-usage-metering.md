# 0008 — API usage metering + customer subscriptions (CheckTudo)

- **Status**: Active
- **Date**: 2026-06-10
- **Supersedes**: —

## Context

The webclient was productized ([0007](0007-webclient-productization.md)) with auth, tenant isolation and a Master role, but there was **no way to count or bill API usage**. To move toward go-to-market we need: a catalog of sellable consult types with prices, a notion of a paying **customer** (subscription), a usage ledger that counts only *billable* calls, and an admin view that says **who to charge and how much**. The first customer is **Moneycar** (the `vaner@moneycar.com.br` user). Scope of this change is the **CheckTudo API only** — the mechanism is generic, but only CheckTudo is wired.

## Decision

Add a metering + subscription layer on the webclient's Azure SQL, and an admin-only usage report. Specifically:

1. **`subscriptions`** — a billable customer: `name`, a customer-facing `sub_key` (the "subscription ID"), `status`. Seeded with the first customer **Moneycar** (`sub_key = SUB-MONEYCAR-001`).
2. **`api_products`** — the sellable consult types per API (`api`, `code`, `name`, `unit_price_brl`). Seeded with the 6 CheckTudo products at the Placas360 storefront prices (66 Veículo Total R$44,90; 67 Essencial R$29,90; 13 Decod+Precificador R$19,90; 71 Cadastrais R$9,90; 76 Decod+FIPE R$17,90; 241 Decod V.4 R$12,90).
3. **`users.subscription_id`** — which customer a user's usage is billed to. **All current regular users** are placed under Moneycar; the **Master/admin is excluded** (it's the operator, not a payer). New users carry no subscription until one is configured.
4. **`api_usage`** — the ledger. One row per **billable** consult, written by a single `INSERT…SELECT` that snapshots the user's `subscription_id`, the `product_name` and the `unit_price_brl` at the moment of use (so later price/name changes don't rewrite history).
5. **Count live calls only.** `actions/checktudo.ts` records usage **only on a successful live consult** — cache hits return earlier in the action and are therefore never counted. Recording is best-effort (a metering failure never breaks a consult).
6. **Admin "Usage Report for APIs"** (`/admin/uso-apis`, admin-only). Aggregates the ledger **API → subscription → product** with quantities, amounts to charge, and first/last timestamps. `usageReport({ subscriptionId })` already accepts a per-customer scope so the same view can later be shown to a paying customer for their own usage.

## Consequences

**Enables**: end-to-end count → price → "charge Moneycar R$X" is in place; repeat (cached) lookups are explicitly free; adding KBB/Infocar metering is a one-line `recordUsage` call per action + seeding their `api_products`; the report is already structured for future per-customer self-service views.

**Accepts**: this is still an **app-local** billing model on Azure SQL, not APIM subscriptions/products or the platform `customers` model — when billing moves to APIM, `sub_key` maps to the APIM subscription key. There is **no UI yet to create subscriptions or assign them to users** (done via SQL/migration); new users have `subscription_id = NULL` and their live usage is recorded as "Sem assinatura" until configured. Prices are per-consult retail defaults, editable in `api_products`. No payment capture yet (see paywall next-step).

## Current state

| Item | State |
|---|---|
| `subscriptions` / `api_products` / `api_usage` + `users.subscription_id` (migration 0009) | ✅ live |
| Moneycar subscription seeded (`SUB-MONEYCAR-001`) | ✅ live |
| 6 CheckTudo products seeded with prices | ✅ live |
| All current regular users placed under Moneycar (admin excluded) | ✅ live |
| Usage recorded on live CheckTudo consults only (cache hits not counted) | ✅ live |
| `/admin/uso-apis` "Usage Report for APIs" (admin-only) | ✅ live |
| KBB / Infocar metering | ⏳ not wired (CheckTudo-only by scope) |
| Admin UI to create subscriptions / assign to users | ⏳ next step |
| Per-customer self-service usage report (paid users) | ⏳ next step |
| Payment capture + auto subscription provisioning | ⏳ [next-steps/017](next-steps/017-paywall-self-serve-provisioning.md) |
| Fold into platform `customers` / APIM subscriptions | ⏳ [next-steps/002](next-steps/002-customer-model-multi-tenancy.md) |

## Triggers for revisiting

- Metering a second API (KBB/Infocar) — wire `recordUsage` in its action and seed `api_products`.
- Moving billing to APIM — `sub_key` becomes the APIM subscription key; `api_usage` either feeds or is replaced by APIM analytics.
- Self-serve paywall lands → subscriptions are created on payment and the report page is exposed per customer ([017](next-steps/017-paywall-self-serve-provisioning.md)).
- Charging the operator's own/admin usage, or differential (wholesale) pricing per customer → revisit the price model in `api_products`.
