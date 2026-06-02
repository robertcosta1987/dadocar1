# 002 — Customer model in Cosmos + per-customer attribution

- **Status**: Open
- **Effort**: 1 week
- **Depends on**: —
- **Blocks**: [001](001-apim-products-subscriptions.md), [003](003-stripe-and-provisioning.md)

## Why

The `customers` Cosmos container is provisioned (PK `/customer_id`, no TTL) but unused. Without a customer model:

- All traffic is anonymous; can't attribute, can't bill, can't quota.
- APIM subscriptions (item 001) need a customer entity to map to.
- Stripe integration (item 003) needs a customer entity to sync with.

## Scope

In:

- Cosmos document shape for a customer: `{ id, customer_id, email, display_name, tier, status, apim_subscription_id, stripe_customer_id, created_at, updated_at }`.
- CRUD library in the Function App (`src/lib/customers.js`) using the MI's Cosmos role.
- A small admin endpoint (gated by an admin-only secret) to create/list customers — until the proper sign-up flow lands.
- Reflect customer ID in query events (`queryEvents.js`) once known.

Out:

- Sign-up UI / flow — that's part of 003.
- API key issuance — APIM handles that under 001.

## Approach

1. Define the document shape + JSDoc typedef.
2. Write `src/lib/customers.js` with `getById`, `create`, `update`, `list`. Mirror the cache.js fail-open pattern.
3. Add `customer_id` to the query event payload — optional, populated from APIM subscription metadata once APIM is in front.
4. Add an `/api/admin/customers` HTTP trigger (function-key auth + an additional `x-admin-token` env-var check) for manual provisioning.

## Success criteria

- Can create a customer via admin endpoint and see it in `customers` container.
- Query events include the customer_id once APIM is in front (paired with 001).
- Manual cleanup of test customers possible via the same admin endpoint.

## References

- [IaaS.MD §2.1 Cosmos containers](../../IaaS.MD#21-azure-resources)
