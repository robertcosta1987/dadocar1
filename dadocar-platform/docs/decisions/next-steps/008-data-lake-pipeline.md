# 008 — Data lake ingestion (Event Hub → Capture → Synapse / Databricks)

- **Status**: Open
- **Effort**: 1-2 weeks
- **Depends on**: query events emission (DONE — see [0001](../0001-closed-beta-launch.md))
- **Blocks**: [009](009-deidentification-job.md) (de-identification needs historical partitions to operate on)

## Why

Events are flowing into Event Hub `query-events` from day one, but EH Basic only retains 24 hours and has no Capture. That means right now we *don't actually have* the historical record — we have a rolling 24h window. To build any AI / analytics layer on top of vehicle-lookup history we need the events to land in Storage (Data Lake Gen2 `query-log/` container) as Parquet/Avro and stay there forever.

The `query-log` Storage container already exists from the original Bicep provisioning. It just has nothing writing to it.

## Scope

In:

- Upgrade Event Hub namespace to **Standard tier** (Capture is a Standard+ feature).
- Enable Event Hub Capture on `query-events` writing to `query-log/dt=YYYY-MM-DD/hr=HH/` in Avro.
- Set Capture window (5 min / 300 MB), test it with a synthetic burst.
- Add a small Databricks (or Synapse Serverless) job that reads Avro and writes daily-partitioned Parquet to a sibling `query-log-parquet/` path.
- Document the schema in `docs/data/query-events-schema.md`.

Out:

- The de-identification job (item 009).
- Cosmos-side change-feed mirroring (we may want it later, but EH is sufficient for now since every write to Cosmos already triggers an EH event upstream).
- A real warehouse / serving layer — that's the AI/analytics product, not infra.

## Approach

1. Upgrade EH namespace via Bicep (`sku: { name: 'Standard' }`).
2. Add Capture config to the hub (`captureDescription`).
3. Confirm the Function App MI (writer) still has Data Sender; Capture itself uses the namespace's system identity to write to Storage — that needs Storage Blob Data Contributor on `query-log/`.
4. Synapse Serverless SQL over the Avro: a single external table is enough for ad-hoc queries.
5. Document a one-shot `bun run scripts/replay-eh.ts` for replaying captured events if/when we change schemas.

## Success criteria

- Within 10 minutes of an event being sent, it appears as an Avro file under `query-log/dt=…/hr=…/` in Storage.
- A Synapse query returns the day's events with the expected schema.
- 30 days after enable, we can produce a query like "top 10 most-queried plates per week" from the parquet table.

## References

- [IaaS.MD §1.5 streams + data lake](../../IaaS.MD#15-streams--data-lake)
- [`queryEvents.js`](../../../services/enrichment-function/src/lib/queryEvents.js) — event producer
- [0001 closed beta launch](../0001-closed-beta-launch.md) — established why we're emitting today
