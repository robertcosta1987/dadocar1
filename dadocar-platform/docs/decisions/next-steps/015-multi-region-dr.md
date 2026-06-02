# 015 — Multi-region / disaster recovery strategy

- **Status**: Open
- **Effort**: 2-3 weeks
- **Depends on**: [014](014-production-environment.md) (single-region prod must exist first), and realistically [008](008-data-lake-pipeline.md) so data-lake state is captured in Storage GRS, not just in EH
- **Blocks**: enterprise contracts that ask for an RPO / RTO

## Why

Everything today is single-region (`brazilsouth`). Azure regional outages do happen (the 2024 East US event lasted ~6h). For a B2B API a customer will reasonably ask:

- What's our RPO (max tolerable data loss)?
- What's our RTO (max tolerable downtime)?
- Where does data go if the region is gone?

Today the honest answer is "we wait for the region to come back, and any in-flight events in EH are lost." That's fine for closed beta; it's a customer-blocker at enterprise scale.

## Scope

In (target):

- Cosmos: enable a second write region (`brazilsoutheast`) with auto-failover. RPO ~seconds, RTO ~1-2 min for the data plane.
- Storage: switch to GRS (geo-redundant) at minimum, RA-GRS if we want read access from the secondary. RPO ~15 min.
- Key Vault: enable Standard backup/restore; secrets are small, restore is cheap.
- Function App + APIM: stand up an idle warm replica in the secondary region behind a Front Door instance with health probes. Front Door fails over automatically.
- Event Hub: enable Geo-DR pairing. RPO is metadata only (events in flight may be lost); document this as a known limitation.
- Document the RPO/RTO table in `docs/runbooks/disaster-recovery.md`.
- Quarterly DR drill: simulate primary-region outage, verify customer requests still succeed.

In (minimum if cost is a concern):

- Cosmos auto-failover read-region only (cheaper than full multi-write).
- Storage GRS.
- No active replica of Function App; rely on the secondary region's Function App being cold-start-able in ~5 min on a runbook.

Out:

- Active-active globally (we're a Brazil-market product; latency-based routing across continents isn't relevant).
- Per-customer region pinning (data sovereignty isn't a requirement we've heard from any customer yet).

## Approach

1. Decide target RPO/RTO with stakeholders. Document the choice.
2. Pick the cost tier (active-active vs warm-standby vs cold-restore).
3. Add the multi-region config to Bicep behind an `enableMultiRegion` parameter, default false (closed beta stays single-region).
4. Test the failover in dev (or a dedicated `dadocar-dr-rg-brs` group) before enabling prod.
5. Add the quarterly drill to the runbook.

## Success criteria

- A documented RPO/RTO table customers can see (e.g. RPO: 5 min, RTO: 15 min).
- A successful DR drill: kill primary Function App, customer requests continue within RTO.
- Cosmos data is readable from the secondary region during a primary outage.

## References

- [IaaS.MD §1.6 networking](../../IaaS.MD#16-networking) and §1.4 data
- Azure docs: Cosmos multi-region, Front Door, EH Geo-DR
