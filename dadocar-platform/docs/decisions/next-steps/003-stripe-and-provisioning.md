# 003 — Stripe billing + provisioning-orchestrator + webhook handler

- **Status**: Open
- **Effort**: 2-3 weeks
- **Depends on**: [001](001-apim-products-subscriptions.md), [002](002-customer-model-multi-tenancy.md)
- **Blocks**: any paying-customer launch

## Why

`services/stripe-webhook-handler/` and `services/provisioning-orchestrator/` are empty placeholders. Without them:

- No way to take payment.
- No automated tier upgrades / downgrades.
- No way to onboard a new customer without manual `az apim subscription create` + manual Cosmos insert.

## Scope

In:

- Stripe account setup (test mode → live).
- Two products in Stripe matching the APIM Free/Pro tiers (Pro: monthly subscription, e.g. R$ 199/mo for 100k calls).
- `services/provisioning-orchestrator/` — Azure Function triggered by sign-up. Creates: Stripe customer → APIM subscription → Cosmos customer doc → welcome email.
- `services/stripe-webhook-handler/` — Function triggered by Stripe webhooks. Syncs subscription status to Cosmos `customers.tier` and to APIM product membership.
- A sign-up page (could live on the Vercel app, or a separate marketing site).

Out:

- Multi-currency / international billing — BRL only for now.
- Invoicing for enterprise tier — start with self-serve only.

## Approach

1. Decide the pricing tiers in Stripe (Free/Pro/Enterprise).
2. Build `provisioning-orchestrator` as a separate Function App or a new HTTP trigger on the existing one.
3. Stripe webhook secret in Key Vault.
4. Webhook handler updates Cosmos + APIM via SDKs.
5. Sign-up UI: simplest path is a form on the Vercel app posting to provisioning-orchestrator.

## Success criteria

- Sign up via the form → receive APIM subscription key + welcome email.
- Subscribe to Pro via Stripe Checkout → tier flips in Cosmos and APIM rate-limit policy lifts within 60s.
- Cancel via Stripe → tier flips back to Free; key remains valid (only quota drops).

## References

- [IaaS.MD §1 layers (APIM + Stripe)](../../IaaS.MD#1-solution-overview)
