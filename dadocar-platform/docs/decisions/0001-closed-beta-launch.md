# 0001 — Closed-beta launch + immediate data-lake foundations

- **Status**: Active
- **Date**: 2026-05-13
- **Owners**: Robert (product), Claude (build)
- **Supersedes**: —

## Context

The Dadocar dev environment is end-to-end operational:

- Browser → Vercel proxy (`dadocar1.vercel.app`) → Azure Function App aggregator (`dadocar-dev-func-enrich-brs`) → Infocar.
- One provider live (`infocar`, Codificação FIPE).
- Cosmos cache-aside on plate lookups (~8× speed-up on hits, ~R$ saved per duplicate query).
- Telemetry flowing into App Insights / Log Analytics.
- Gate-secret authentication on the Vercel app; function-key authentication on the Function App.

Original brief had a long list of production-shaped items deferred from MVP: APIM products + subscriptions, customer model + Stripe billing, CI/CD, monitor alerts, network hardening, prod environment, OTel distro, data lake pipeline, de-identification, etc. A comprehensive gap audit is in [`next-steps/`](next-steps/).

Two viable next moves were considered:

1. **Open it up for closed beta now** — give the URL to a handful of trusted users, accumulate real traffic, let actual usage inform what to harden next.
2. **Wait until a defined set of "production-blocker" gaps close** — APIM, Stripe, CI/CD, alerts, network hardening — then launch.

## Decision

**Take both — sequentially.** Specifically:

1. **Deploy as a closed beta today.** Mark it alpha / no-SLA. Function key + gate secret is acceptable for a small handful of trusted users. Don't market and don't take payments. The Cosmos cache reduces vendor cost on repeats; telemetry captures everything for later analysis.
2. **Start emitting query events to Event Hub `query-events` immediately.** The data-lake foundation already exists (Storage account is Data Lake Gen2; `query-log` container is provisioned). What's been missing is the producer. Wiring it now means historical data starts accumulating from day one — by the time we build the analytics layer (Synapse / Databricks / AI training), there's a backlog of real traffic to feed it.
3. **Defer everything else** to the [`next-steps/`](next-steps/) catalog. Drive ordering off observed needs from the closed-beta cohort.

## Consequences

What this enables:

- Real-world feedback on response shape, latency, error patterns.
- Data-lake input starts flowing from day one (assuming Event Hub emission ships in this same milestone — see "Current state" below).
- Cosmos cache hits compound: each new plate query funds the next 30 days of repeats.
- Operator time is preserved for value-add work instead of speculative hardening.

What we accept:

- No SLA; we can break things and roll forward, no rollback procedure.
- No per-customer attribution or rate limit beyond the function key. A leaked key = open access.
- No alerts; failures depend on a human noticing.
- Single region (Brazil South), no DR.
- Network is fully public; only credential-based defence.
- All customer-facing items (sign-up, billing, dashboard) are absent.

## Current state

### Wired today (closed-beta surface)

| Item | Where | Status |
|---|---|---|
| Vercel frontend + gate | `dadocar1.vercel.app` | ✅ |
| Vercel proxy → Function App | `apps/infocar-test/lib/aggregator.js` | ✅ |
| Function App + provider registry | `services/enrichment-function/src/` | ✅ |
| Infocar provider (FIPE) | `src/providers/infocar.js` | ✅ |
| Key Vault secret reads via MI | `src/lib/secrets.js` | ✅ |
| Cosmos plate cache (cache-aside) | `src/lib/cache.js` | ✅ |
| App Insights / Log Analytics telemetry | workspace-based, `App*` tables | ✅ |
| Event Hub `query-events` emission | `src/lib/queryEvents.js` | ✅ wired + verified (events confirmed in hub via direct consumer read) |

### Deferred to `next-steps/` (not in closed beta)

Run `ls docs/decisions/next-steps/` for the live list. Top-priority blockers when we promote past closed beta:

- APIM products + subscription keys ([001](next-steps/001-apim-products-subscriptions.md))
- Customer model + multi-tenancy ([002](next-steps/002-customer-model-multi-tenancy.md))
- Stripe wiring ([003](next-steps/003-stripe-and-provisioning.md))
- CI/CD pipelines ([004](next-steps/004-cicd-github-actions.md))
- Monitor alerts ([005](next-steps/005-monitor-alerts-and-slos.md))
- Network hardening ([006](next-steps/006-network-hardening.md))
- Production environment ([014](next-steps/014-production-environment.md))

## Closed-beta operating posture

| Topic | Policy |
|---|---|
| Audience | Up to 10 trusted users; no public discovery |
| Auth | DADOCAR_GATE_SECRET (UI) + function key (server-to-server) |
| Vendor quota | Infocar test credentials; do not exceed quota — Cosmos cache absorbs repeats |
| Cost ceiling | ~R$200/month idle + minor query-driven; alert manually if cost dashboard goes 2× |
| Incident protocol | None; Robert is on-call by default; data loss is acceptable |
| Rollback | `git revert` + `func azure functionapp publish` from local |
| Data retention | Cosmos TTL 30d on `vehicles`; App Insights 30d; Event Hub Basic 24h until Capture is wired |

## Triggers for revisiting / superseding this decision

- A revenue commitment to any customer (must promote past closed beta first).
- Plate-query volume exceeds **30k/month** sustained (likely needs Cosmos autoscale + APIM rate limiting).
- A second data provider is wired (re-evaluate de-identification timing).
- An outage we can't reconstruct from logs (push alerts + OTel distro forward).
- We add a feature that touches PII not currently in vendor responses (LGPD review).

## Updates

Append a dated note here when material things change. Keep older notes for traceability.

- **2026-05-13**: Event Hub `query-events` emission verified end-to-end. Sent 8 events (7 from Function App, 1 from a laptop consumer test). The EH Basic `IncomingMessages` metric is misleading at low volume — direct consumer reads are the authoritative check. Temporary diagnostic roles on the EH namespace (Data Sender + Data Receiver for the deployer SP) were granted and then revoked after verification.
