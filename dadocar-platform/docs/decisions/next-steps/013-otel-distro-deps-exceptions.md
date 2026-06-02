# 013 — OpenTelemetry distro for `AppDependencies` + `AppExceptions`

- **Status**: Open
- **Effort**: 1 day
- **Depends on**: nothing
- **Blocks**: richer alerts (item 005) — without dependency telemetry, "Infocar 5xx >5min" can only be inferred from log strings, not measured directly

## Why

App Insights right now is the classic schema fed by the Functions host: we get `AppRequests` and `AppTraces`, but not `AppDependencies` (outbound HTTP calls to Infocar, Cosmos, EH) nor `AppExceptions` (structured exception telemetry with stack traces).

That means:

- Latency to Infocar shows up only via our manual `latency_ms` logging.
- A 502 from Infocar surfaces as a console.error line, not as a dependency failure with the URL, status, and duration.
- Exception traces are emitted as multi-line console output, not as a queryable `AppExceptions` table.

The Azure Monitor OTEL distro for Node fixes all of that with one `require()` at the top of the function entrypoint.

## Scope

In:

- Add `@azure/monitor-opentelemetry` to `services/enrichment-function/package.json`.
- Require it at the very top of `services/enrichment-function/src/functions/vehicleLookup.js` (or in a dedicated `instrumentation.js` that's the first import).
- Verify both tables populate: AppDependencies for outbound HTTPS calls, AppExceptions for thrown errors.
- Document the small caveat: the distro auto-instruments `http`/`https` and most Azure SDK clients — but `@azure/event-hubs` already emits its own spans via OpenTelemetry, which the distro will collect automatically.

Out:

- Custom spans for business logic (e.g. "cache lookup," "infocar provider call") — nice-to-have but not necessary; auto-instrumentation already gives us most of it.
- Tracing across APIM → Function → Cosmos as a single trace ID — requires propagation work in APIM.

## Approach

1. `bun add @azure/monitor-opentelemetry` in the function workspace.
2. Add a 3-line `instrumentation.js` that calls `useAzureMonitor()`.
3. Make it the first import in the function entrypoint.
4. Re-deploy, run a few queries, confirm AppDependencies and AppExceptions populate.
5. Update IaaS.MD §2.7 observability to mention which tables are now populated.

## Success criteria

- A KQL query `AppDependencies | where target contains "infocar"` returns one row per Infocar call with `duration`, `success`, `resultCode`.
- A deliberate throw in the function shows up in `AppExceptions` with the stack trace.

## References

- [IaaS.MD §2.7 observability](../../IaaS.MD#27-observability--log-access)
- Azure docs: `@azure/monitor-opentelemetry`.
