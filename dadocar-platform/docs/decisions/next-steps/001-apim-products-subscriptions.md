# 001 — APIM products + subscriptions + rate-limit policies

- **Status**: In Progress (MVP slice live; hard quotas + multi-tier deferred)
- **Effort**: 1-2 weeks
- **Depends on**: [002](002-customer-model-multi-tenancy.md) (customers needed to issue subscription keys)
- **Blocks**: any paying-customer launch

## What landed on 2026-05-14 (MVP slice)

- API `dadocar-vehicle-api` created at gateway path `/v1` with operation `GET /vehicle/plate/{placa}`.
- Inbound policy at the API scope: injects `x-functions-key` from named-value secret `func-key-enrich`; strips `Ocp-Apim-Subscription-Key` before forwarding.
- Product `dadocar-beta` (published, subscription required, no approval needed).
- One subscription issued: `moneycar-tenanta-beta` for the TenantA simulator (`webclient_fipe`).
- APIM Gateway diagnostic logs → Log Analytics `dadocar-dev-log-brs` (table `ApiManagementGatewayLogs`); per-customer usage query is in [apps/webclient/CUSTOMER.md](../../../apps/webclient/CUSTOMER.md).
- Webclient cut over: `DADOCAR_API_URL` now `https://dadocar-dev-apim-brs.azure-api.net/v1`, header swapped to `Ocp-Apim-Subscription-Key`. Function-key direct route kept live as emergency fallback (will rotate once APIM is the only path used in prod).

## What's still open

- **Hard rate-limit + quota policies** are NOT installable on APIM Consumption tier (`rate-limit`, `rate-limit-by-key`, `quota`, `quota-by-key` all error with `Policy is not allowed in 'Consumption' sku`). Two ways forward:
  - **Upgrade APIM tier**: Developer (~$50/mo, no SLA) or Basic (~$150/mo, 99.95% SLA) — unblocks hard quotas immediately.
  - **Middleware in the Function App**: implement per-subscription counters in Cosmos (`secrets`/`usage` container) with a 60-second sliding window; reject in the function before vendor call. Cheaper, integrates with [002](002-customer-model-multi-tenancy.md), but more code to maintain.
- **Multi-tier products** (Free/Pro/Enterprise) — deferred until [003](003-stripe-and-provisioning.md) lands (we need pricing tiers + Stripe webhooks to drive the product split).
- **OpenAPI import** — currently the operation was hand-defined. The v4 Node.js Functions model doesn't emit OpenAPI automatically; either hand-author `dadocar.openapi.yaml` or add a small reflection step in `services/enrichment-function/scripts/`.
- **Bicep wrap** — APIM API + product + named-value + policies were created via `az rest`. They should be moved into `infrastructure/bicep/modules/apim-api.bicep` so the state is reproducible.
- **`/vehicle/chassi/{vin}` + `/providers`** operations not yet mapped in APIM — they still respond on the legacy function-key route.
- **JWT validation** (Entra / customer's own IdP) — out of scope for closed beta.
- **Soft limits at 180/min + 10k/mo** are documented to the customer but not enforced.

## Why

APIM `dadocar-dev-apim-brs` is deployed (Consumption tier) but empty — no products, no APIs, no policies. Customer traffic today hits the Function App directly with a raw function key. That means:

- One leaked key = open access for everyone.
- No per-customer rate limits.
- No quota enforcement per tier.
- No JWT/OIDC validation, no IP allowlists, no header normalization.
- No API versioning.

## Scope

In:

- Import the Function App's OpenAPI (we'll need to generate one — currently the function host doesn't auto-emit OpenAPI for the v4 model).
- Create one API in APIM: `dadocar-vehicle` mapping to the Function App.
- Two products (Free / Pro) with different rate-limit policies and quotas.
- Subscription-key auth on the products.
- `validate-jwt` policy stub for future JWT auth.
- Update the Vercel proxy to call APIM URL instead of the function URL.

Out:

- Developer Portal customization (cosmetic).
- Multi-tier pricing logic (lives in 003).

## Approach

1. Hand-write or generate an OpenAPI spec for `/api/vehicle/plate/{plate}`, `/api/vehicle/chassi/{chassi}`, `/api/providers`, `/api/healthz`.
2. Create the API in APIM via Bicep (extend `infrastructure/bicep/modules/apim.bicep`).
3. Add two products with rate-limit policies (e.g. Free: 100/day; Pro: 100k/month).
4. Wire APIM backend to the Function App with a Named Value for the function key. Eventually swap to APIM MI + Function App `authLevel: anonymous` so APIM is the only gate.
5. Move the Vercel proxy to call APIM with a subscription key.

## Success criteria

- A customer with a Free subscription key hits the published URL, gets a response, exceeds 100 calls/day → 429.
- The function key on the Function App can be rotated without customer impact.
- APIM dashboard shows per-product call counts.

## References

- [IaaS.MD §1 layer table](../../IaaS.MD#1-solution-overview)
- Brief 3.6 (deployment / promotion topology) — APIM in front of the Function App
