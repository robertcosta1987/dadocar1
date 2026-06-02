# 007 — Cosmos autoscale + RU sizing review

- **Status**: Open
- **Effort**: 1-2 days
- **Depends on**: nothing
- **Blocks**: a small traffic burst could throttle the API (Cosmos 429) and we'd find out from a customer

## Why

Current Cosmos containers are provisioned with fixed manual RU/s at minimum tier (400 RU/s, sometimes 1000). For closed beta that's fine — actual usage is single-digit RU per request. But:

- Manual provisioning means we pay full price 24/7 for a workload that's bursty.
- A modest spike (say 50 req/s on the `vehicles` container with a cold cache and a few large documents) will throttle.
- There's no headroom plan; we'd notice via 429 errors hitting customers, not via a billing or RU alert.

## Scope

In:

- Switch each container to **autoscale** (typically 1000 RU/s max, billed at 10% when idle).
- Document the per-container RU pattern in a short RU sizing table inside [IaaS.MD §1.4](../../IaaS.MD#14-data--cosmos-db).
- Wire a Cosmos diagnostic alert on `TotalRequestUnits` and on the 429 metric (this overlaps with 005).
- Decide partition-key strategy review for `vehicles` — current is `/plate` which is fine for cache-aside reads but is hot if one fleet does many lookups; reconsider once we have multi-tenant traffic.

Out:

- Multi-region writes (item 015).
- Synapse Link (might come with item 008).

## Approach

1. Pull last 30 days of `RequestCharge` from Log Analytics, bucket by container, get p95 and p99.
2. For each container, set autoscale max = 4× observed p99, floor at 1000.
3. Update `infrastructure/bicep/modules/cosmos.bicep` to use `autoscaleSettings: { maxThroughput: N }` instead of `throughput: N`.
4. Re-deploy and verify the bill projection.

## Success criteria

- Throttle rate (`429`) over a 24h window is 0 in normal traffic.
- Monthly Cosmos spend at idle drops vs. the manual-RU baseline (autoscale at idle is 10% of max).
- A synthetic 10× burst doesn't 429.

## References

- [IaaS.MD §1.4 data — Cosmos DB](../../IaaS.MD#14-data--cosmos-db)
- Azure docs: Cosmos autoscale throughput.
