# 012 — VIN cache via `vehicle_index` (resolve VIN→plate, then read `vehicles`)

- **Status**: Open
- **Effort**: 2 days
- **Depends on**: nothing
- **Blocks**: VIN queries don't benefit from cache the way plate queries do — every VIN lookup hits Infocar

## Why

Cache-aside is keyed by `/plate` in the `vehicles` container. That works for plate queries. For VIN queries:

- Today we call Infocar by VIN, get a result that includes the plate, but we don't backfill anything that would make a *second* VIN query for the same vehicle a cache hit.
- The next request for the same VIN re-hits Infocar.
- We pay vendor cost again and add ~2s latency.

## Scope

In:

- A `vehicle_index` container (or repurpose `vehicles` with a secondary index pattern), partitioned by `/vin`, holding `{ vin, plate, last_seen_at }`.
- On a VIN lookup that misses both caches:
  - Call Infocar by VIN.
  - Get the response (which contains the plate).
  - Write to **both** `vehicle_index` (vin→plate pointer) **and** `vehicles` (full payload keyed by plate).
- On a subsequent VIN lookup:
  - Read `vehicle_index` by VIN → get plate.
  - Read `vehicles` by plate → cache hit.
  - Vendor call avoided entirely.

Out:

- Reverse: plate→vin pointer. Not needed — Infocar's plate response already includes the VIN, so the plate cache implicitly covers it.

## Approach

1. Add the `vehicle_index` container to Bicep with `/vin` as the partition key.
2. Update the aggregator: on a successful Infocar VIN response, double-write.
3. Update the VIN read path: index lookup → plate read.
4. Add a small back-fill pass: for the existing `vehicles` documents that have a VIN in them, populate `vehicle_index`.

## Success criteria

- Two identical VIN queries result in **one** Infocar call (the first), not two.
- p95 latency for repeat VIN queries drops from ~2s to <100ms (same as plate cache hits today).
- Logs show `[cache] vin-index hit` for the second call.

## References

- [`aggregator.js`](../../../services/enrichment-function/src/lib/aggregator.js) — the cache-aside path
- [IaaS.MD §1.4 data — Cosmos DB](../../IaaS.MD#14-data--cosmos-db)
