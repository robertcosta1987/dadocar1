# 011 — FIPE pricing monthly refresh job (`fipe_prices` container)

- **Status**: Open
- **Effort**: 3-5 days
- **Depends on**: nothing
- **Blocks**: customers that ask for FIPE pricing won't get fresh data; right now we either pass-through Infocar's value or have nothing if Infocar omits it

## Why

FIPE publishes a new price table monthly (the *tabela de referência*). Customers expect the response to reflect the current month's table. Today:

- We don't have an `fipe_prices` container — the Bicep references it but nothing populates it.
- The Infocar response includes a price field, but it's only the FIPE value if Infocar happens to have refreshed; we have no SLA from them on freshness.
- For a vehicle that's in cache from last month, the price is stale.

## Scope

In:

- An `fipe_prices` container in Cosmos, partitioned by `/year_month` (e.g. `2026-05`), document keyed by FIPE code.
- A scheduled timer-triggered Function (or a separate small worker) that:
  - On the first Monday of each month, scrapes (or calls) the official FIPE feed.
  - Bulk-loads into the new partition.
  - Tags the partition as "active."
- Modify the vehicle-lookup path to:
  - After Infocar returns the FIPE code, look up `fipe_prices` and overlay the price into the response.
  - If FIPE is unavailable, fall back to Infocar's value with a `price_source: "vendor"` flag.

Out:

- Historical FIPE backfill — start with the month of go-live, accumulate forward.
- A FIPE-only API endpoint (it's a different product if we want to sell that).

## Approach

1. Decide the source — official site scrape, official API (paid), or an existing community feed. Document the choice and licensing in the file.
2. Write the loader. Idempotent: re-running the same month is a no-op.
3. Add a smoke test: pull a known FIPE code, verify the price matches the public site.
4. Add a monthly Monitor alert: "no new FIPE partition by the 5th of the month" → page.

## Success criteria

- Looking up a vehicle on the 5th of any month returns the *current* month's FIPE price.
- A spot-check of 5 vehicles matches the public FIPE site within R$1.

## References

- [IaaS.MD §1.4 data — Cosmos DB](../../IaaS.MD#14-data--cosmos-db)
- FIPE site: https://veiculos.fipe.org.br/
