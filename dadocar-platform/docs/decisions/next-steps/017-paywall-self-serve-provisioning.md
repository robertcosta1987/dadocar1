# 017 — Paywall + self-serve registration → per-customer tenant provisioning → CRM

- **Status**: Open
- **Effort**: 3-4 weeks
- **Depends on**: [002](002-customer-model-multi-tenancy.md), [003](003-stripe-and-provisioning.md), [016](016-crm.md)
- **Blocks**: opening the product to the public for self-serve paid use
- **Related**: [0007](../0007-webclient-productization.md) (invite-gated registration today)

## Why

Registration today is **invite-gated and manual** ([0007](../0007-webclient-productization.md)): an admin mints a code, the person registers, and they get a tenant. To sell at scale the customer must be able to **self-register, pay, and be provisioned automatically** — and that registration must be **wired to the CRM** ([016](016-crm.md)) for tracking. This closes the loop from "anonymous visitor" to "paying, isolated tenant performing queries."

## Scope

In:

- **Paywall / pricing page**: public page with plans (e.g. Free trial / Pro / Enterprise) and a Stripe Checkout flow.
- **Self-serve sign-up**: replace (or sit alongside) the invite gate — a visitor creates an account and subscribes.
- **Post-payment provisioning** (the wiring): on a successful Stripe payment/subscription webhook, automatically:
  1. create/activate the customer's **tenant** (the `owner_id` scope the webclient already enforces — see [0007](../0007-webclient-productization.md)) so they can immediately run queries;
  2. create the **CRM customer record** ([016](016-crm.md)) with plan + Stripe linkage;
  3. (when APIM is in front) issue the **APIM subscription key** ([001](001-apim-products-subscriptions.md));
  4. send a welcome email.
- **Plan enforcement**: gate query volume / products by plan; reflect upgrades/downgrades/cancellations from Stripe webhooks.
- **De-provisioning**: on cancellation/non-payment, downgrade or suspend the tenant.

Out:

- Multi-currency (BRL first).
- Enterprise contract/invoice billing — self-serve first.

## Approach

1. Build on [003](003-stripe-and-provisioning.md)'s `provisioning-orchestrator` + `stripe-webhook-handler`, but target the **webclient tenant** model (Azure SQL `owner_id`) as the immediate provisioning effect, with the platform `customers` model ([002](002-customer-model-multi-tenancy.md)) as the system of record.
2. Pricing page + Stripe Checkout (test → live).
3. Webhook handler: `checkout.session.completed` / `customer.subscription.*` → provision tenant + CRM record + (optional) APIM key, idempotently.
4. Map Stripe plan → tenant entitlements (query quota, allowed CheckTudo products).
5. Replace the invite gate with the paid flow (keep invite codes for staff/comp accounts).

## Success criteria

- A brand-new visitor can: pick a plan → pay via Stripe → immediately log in and run a query in their **own isolated tenant** — with no manual step.
- The customer appears in the **CRM** with the right plan and Stripe linkage.
- Subscription changes (upgrade/cancel) flip entitlements within ~60s.
- Failed/cancelled payment suspends the tenant; no orphaned access.

## References

- [next-steps/003](003-stripe-and-provisioning.md) (Stripe + orchestrator), [002](002-customer-model-multi-tenancy.md), [016](016-crm.md), [001](001-apim-products-subscriptions.md)
- [decisions/0007](../0007-webclient-productization.md) — tenant isolation already enforced; this automates tenant creation
