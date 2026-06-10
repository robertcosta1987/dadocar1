# 0009 — Subscription provisioning, consumption limits & forced password change

- **Status**: Active
- **Date**: 2026-06-10
- **Supersedes**: —

## Context

[0008](0008-api-usage-metering.md) added metering (count live CheckTudo consults, price them, report per subscription). To actually sell, the operator needs to (a) onboard a customer end-to-end without SQL, (b) cap what a customer can consume, and (c) hand them a login they secure themselves. This decision adds provisioning + enforcement on top of the metering layer.

## Decision

1. **Admin "Adicionar Assinatura" page** (`/admin/assinaturas`, admin/master only). One form — Nome, Empresa, E-mail, Tipo de Consumo, Produtos — creates **in one step**: a login **user** (`role=user`, `must_change_password=1`, linked to the subscription), a **subscription** with a consumption plan, the **product entitlements**, and a **customer/CRM record** (`customers`). It returns a **one-time temporary password** for the admin to hand over.
2. **Three consumption models**, chosen per subscription via `subscriptions.plan_type`:
   - **`consultas`** — a single **hard cap on the TOTAL number of live queries** (`query_limit`/`query_used`), pooled across the contracted products.
   - **`cash`** — a mandatory prepaid R$ budget (`spend_limit_brl`/`spent_brl`) across the contracted products.
   - **`ondemand`** — open-ended, billed at end of cycle, with an **OPTIONAL** R$ cap (`spend_limit_brl` NULL = no cap; if set, blocks to prevent overspend).
   The checkbox-selected products are the contracted set (`subscription_quotas` rows; `granted` now just marks "allowed").
3. **Enforcement on the live path only** (`actions/checktudo.ts`). Before the vendor call, atomically **reserve** against the plan — a query (`UPDATE … SET query_used=query_used+1 WHERE query_used<query_limit`) for `consultas`, or budget (`UPDATE … SET spent_brl=spent_brl+price WHERE spend_limit_brl IS NULL OR spent_brl+price<=spend_limit_brl`) for `cash`/`ondemand` (an on-demand sub with no cap never blocks). `@@ROWCOUNT=0` → block with a friendly message and no call. **Refund** on a failed vendor call. **Cache hits are never enforced** (they return earlier), so cached consults never consume the allowance. **Master and plan-less subscriptions (`plan_type` NULL) are unlimited** — so Moneycar/TestSubInternal and the operator are unaffected.
4. **Forced password change on first login.** `users.must_change_password` is carried into the session (`mustChange`); `middleware.ts` confines such a user to `/trocar-senha` until they set a new password (`changePassword` action clears the flag and re-issues the session). New password is scrypt-hashed like the rest of auth.
5. **APIM subscription created from the app.** Provisioning also creates a matching subscription in API Management (all-APIs scope, id = `sub_key`) via a **service principal** (`lib/apim.ts`, client-credentials → ARM PUT), gated on `AZURE_*`/`APIM_*` env. Best-effort: the result reports the APIM status; an APIM failure doesn't block the app-side creation. SP `dadocar-webclient-apim` holds **API Management Service Contributor** on the APIM; secrets live in Vercel env + `.env.local` (gitignored).

## Consequences

**Enables**: a customer can be onboarded from one admin screen, with a hard consumption cap (count or spend), a self-secured login, and full attribution in the Usage Report — the last missing pieces before charging. The cash cap blocks when the *next* consult wouldn't fit the remaining budget (variable prices), which is surfaced as remaining budget.

**Accepts**: still app-local on Azure SQL (not APIM-gated traffic, not the platform `customers` model). Concurrency is handled by the single guarded `UPDATE`, not a distributed lock. No payment capture yet — granting credits/budget is the admin action; Stripe will later increment the same fields. No admin UI yet to *edit* an existing subscription's plan/top-up (re-running the page would create a new one); top-ups are a SQL/script op for now. A rare mid-create failure can leave an orphan subscription (email uniqueness is checked first to make this unlikely).

## Current state

| Item | State |
|---|---|
| `subscriptions.plan_type` / `spend_limit_brl` / `spent_brl`; `subscription_quotas`; `customers`; `users.must_change_password` (migration 0011) | ✅ live |
| Pooled `query_limit`/`query_used` + `ondemand` plan (migration 0012) | ✅ live |
| `/admin/assinaturas` provisioning page (admin-only) + temp password | ✅ live |
| Three plans: Quantidade de Consultas (pooled hard cap), Valor em Reais, On-Demand (optional cap) | ✅ live |
| Consumption enforcement on live CheckTudo consults; cache never counts; master/plan-less unlimited | ✅ live |
| APIM subscription auto-created on provisioning (service principal `dadocar-webclient-apim`) | ✅ live |
| Forced first-login password change (`/trocar-senha` + middleware gate) | ✅ live |
| Admin nav link "Adicionar Assinatura" | ✅ live |
| Show used/remaining (queries) or spent/cap (R$) in the Usage Report | ⏳ next |
| Edit/top-up an existing subscription from the UI | ⏳ next |
| Payment capture → auto-grant credits/budget | ⏳ [next-steps/017](next-steps/017-paywall-self-serve-provisioning.md) |

## Triggers for revisiting

- Stripe/paywall lands → the provisioning page's create step is driven by a paid checkout; top-ups increment `granted`/`spend_limit_brl`.
- Routing CheckTudo through APIM → enforcement could move to APIM products/quotas (but cache-aware counting stays app-side).
- Multi-user customers needing self-service admin → a customer-scoped admin surface over `customers`/`subscriptions`.
