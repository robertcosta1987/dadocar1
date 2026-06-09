# 0007 — Webclient productization: auth, tenant isolation, Master, recall AI

- **Status**: Active
- **Date**: 2026-06-08

## Context

The webclient (`apps/webclient`) started as an internal "Concessionária Demo" CRM test UI. With a public domain on the way, it needed to become a real, access-controlled, multi-customer product rather than an open demo. It runs on Vercel + **Azure SQL** (`carros_ativos_db`) and calls the pricing (Molicar/KBB) and CheckTudo Azure Functions. This decision records the productization done on top of the closed-beta platform ([0001](0001-closed-beta-launch.md)) and the CheckTudo integration ([0006](0006-checktudo-integration.md)).

## Decision

Make the webclient a closed, multi-tenant app — **Placas360** — with custom authentication on the existing Azure SQL, owner-scoped data, a cross-tenant Master, and an AI recall check. Specifically:

1. **Authentication (custom, on Azure SQL).** `users` + single-use `invite_codes` tables. Passwords hashed with Node `crypto.scrypt` (per-user salt, timing-safe compare — no native deps, safe on Vercel). Sessions are stateless **signed httpOnly cookies** (HMAC-SHA256 via Web Crypto, so verification works in both edge middleware and Node). `middleware.ts` gates every route except `/login` + `/register`. Chose custom over Clerk/Auth.js to avoid a new vendor and keep everything in the existing stack (see the auth-method decision captured at build time).
2. **Closed registration.** Sign-up requires a valid single-use invite code; the first user ever created becomes `admin`; admins mint/copy codes at `/admin/convites`.
3. **Tenant isolation via `owner_id`.** Every per-user table (`carros_ativos`, `kbb_consultas`, `checktudo_consultas`) carries an `owner_id`; all reads/writes filter by the logged-in user. Chosen over table-per-tenant for simplicity/safety (no dynamic SQL).
4. **Master role.** `admin@3ahub.com.br` reads across all tenants (history lists + cache check drop the owner filter, incl. legacy `owner_id = NULL` rows); writes still record the acting user.
5. **Recall AI verdict.** On each CheckTudo consult, the chassi is compared against the recall campaign ranges by Claude (`claude-sonnet-4-6`); the verdict + reason are persisted (`recall_afetado` / `recall_motivo`) and shown as "Chassi com Recall?" with a hover motivo.
6. **Indefinite cache.** KBB + CheckTudo results are kept until cleared manually (no 90-day TTL).
7. **Enterprise UI + rebrand.** ASP.NET-WebForms-style theme, brand **Placas360**, tabs reduced to **Tabela KBB** + **Checa Tudo** (+ admin **Convites**); Carros Ativos / Buscar / Relatórios and "+ Adicionar Veículo" hidden.

## Consequences

**Enables**: a public domain can be opened with access controlled at the app layer; each customer (tenant) sees only their own data; a privileged operator (Master) can support/audit across tenants; recall exposure is surfaced automatically; repeat lookups never re-bill vendors.

**Accepts**: this is an app-local identity/tenant model on Azure SQL — *not yet* the platform's `customers` model (Cosmos) or APIM subscriptions. New env dependencies: `AUTH_SECRET` (session signing) and `ANTHROPIC_API_KEY` (recall verdict). Legacy `owner_id = NULL` rows are visible only to the Master until backfilled/assigned. No self-serve sign-up or payment yet — registration is invite-gated and manual.

## Current state

| Item | State |
|---|---|
| Login / invite-gated registration / logout | ✅ live |
| `middleware.ts` route gate + signed cookie sessions | ✅ live |
| `owner_id` on `carros_ativos` / `kbb_consultas` / `checktudo_consultas` (migration 0005) | ✅ live |
| Master cross-tenant reads (`admin@3ahub.com.br`) | ✅ live |
| Recall verdict via Claude (migration 0006) + backfill | ✅ live |
| Indefinite cache (90-day TTL removed) | ✅ live |
| `AUTH_SECRET` / `ANTHROPIC_API_KEY` set in Vercel + `.env.local` | ✅ live |
| Self-serve sign-up + paywall + auto provisioning | ⏳ [next-steps/017](next-steps/017-paywall-self-serve-provisioning.md) |
| CRM (customers, payments, profit/spend) | ⏳ [next-steps/016](next-steps/016-crm.md) |
| Fold tenant/customer state into platform `customers` (Cosmos) / APIM | ⏳ [next-steps/002](next-steps/002-customer-model-multi-tenancy.md) |

## Triggers for revisiting

- Moving customer/tenant identity into the platform's Cosmos `customers` model + APIM subscriptions (then the app-local `users`/`owner_id` model becomes the UI session layer only).
- Adding self-serve sign-up → the invite-gate is replaced by paywall-driven provisioning ([017](next-steps/017-paywall-self-serve-provisioning.md)).
- Outgrowing custom auth (SSO, MFA, password reset at scale) → revisit a managed provider.
- Recall accuracy / cost concerns → revisit model choice or prompt.
