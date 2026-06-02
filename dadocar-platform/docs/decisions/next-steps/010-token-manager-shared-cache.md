# 010 — Cross-instance Infocar token cache via Cosmos `secrets`

- **Status**: Open
- **Effort**: 2-3 days
- **Depends on**: nothing
- **Blocks**: nothing for closed beta, but every cold start re-authenticates with Infocar, which is wasteful and could trigger their rate limits if scale-out is aggressive

## Why

Right now the Infocar provider authenticates per Function App instance. Each cold start = one auth call. The token has a TTL (currently treated as ~1h in code). With a single-instance Consumption plan that's fine, but:

- Function Consumption can scale to N instances under load; we'd do N auths in parallel for the same vendor account.
- Infocar treats excessive auth calls as suspicious; we've already seen one short rate-limit window during development.
- The token is per-account, so sharing it across instances is correct, not a workaround.

## Scope

In:

- A `secrets` (or `vendor_tokens`) container in Cosmos with one document per vendor: `{ id: "infocar", access_token, expires_at, issued_at, issuer_instance }`.
- A small `tokenManager.js` in the Function App that:
  - Reads the cached token; if `expires_at - now > 5min`, use it.
  - If expired/missing, acquires a fresh token, writes it to Cosmos with an `If-Match` etag to avoid two instances thundering.
  - On etag conflict, re-read and use the winner's token.
- Strip the in-memory token cache from `providers/infocar.js`; that path becomes "ask `tokenManager`."

Out:

- Per-customer Infocar accounts (item 002 + 003 land first; for now there's one shared account).
- Token rotation alerts — covered by 005.

## Approach

1. Add the container + RBAC role assignment for the Function MI (Cosmos Built-in Data Contributor scoped to the container).
2. Implement `tokenManager.js` with the etag dance.
3. Add a fault injection test: simulate two concurrent acquisitions, verify only one Infocar auth call happens.
4. Update `providers/infocar.js` to use it.

## Success criteria

- Across a scale-out test (force 5 instances), Infocar auth-endpoint hit count over a 10-min window is **1**, not 5.
- Cold start of a second instance reuses the already-issued token from Cosmos (no auth call in its first request).

## References

- [`providers/infocar.js`](../../../services/enrichment-function/src/providers/infocar.js)
- [IaaS.MD §1.4 data — Cosmos DB](../../IaaS.MD#14-data--cosmos-db) for container conventions
