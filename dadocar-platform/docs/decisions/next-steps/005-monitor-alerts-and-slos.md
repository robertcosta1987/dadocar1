# 005 — Azure Monitor alerts + SLO/SLI definitions

- **Status**: Open
- **Effort**: 2-3 days
- **Depends on**: [013](013-otel-distro-deps-exceptions.md) for richer signal (not strictly required)
- **Blocks**: nothing, but failures go unnoticed until someone looks

## Why

Telemetry flows into App Insights / Log Analytics but no one's paged when:

- Error rate spikes.
- p95 latency degrades.
- Cache hit rate drops to 0.
- Cosmos throttles (429).
- Infocar returns 5xx for >5 min.
- Function App stops accepting requests.

## Scope

In:

- 6-8 Azure Monitor alert rules wired to email + a webhook (Discord/Slack).
- SLO/SLI definitions document (in `docs/`) for: availability, p95 latency, cache hit rate, vendor success rate.
- Action group with the operator's email.
- Cost-budget alert at 2× idle and 3× idle thresholds.

Out:

- PagerDuty / on-call rotation (premature for a one-person operation).
- Dashboards beyond the App Insights workbook defaults.

## Approach

1. Define the SLIs (look at last 30 days of `AppRequests` / `AppTraces` first).
2. Set initial thresholds permissively to avoid alert fatigue (e.g. error rate > 5% for 10 min).
3. Define alerts as Bicep so they're under version control. Add an `infrastructure/bicep/modules/alerts.bicep` module.

## Success criteria

- A deliberate broken deploy (e.g. function that always throws) pages within 10 min.
- A monthly cost projection over the budget pages.
- The SLO doc is reviewed quarterly and adjusted from observed traffic.

## References

- [IaaS.MD §2.7 observability](../../IaaS.MD#27-observability--log-access)
