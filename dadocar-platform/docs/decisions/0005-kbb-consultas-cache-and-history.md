# 0005 — KBB consultation history + 90-day cache on Azure SQL

- **Status**: Active
- **Date**: 2026-06-02
- **Owners**: Robert
- **Supersedes**: —

## Context

After ADR [0004](0004-pricing-function-molicar.md) shipped the pricing
Function App `dadocar-dev-func-pricing-brs`, every webclient call to
`/precos` triggered a fresh Molicar `oauth2/token` + `GET /v3/plate/{plate}`
round-trip. Two problems:

1. **No reuse.** Repeating the same plate twice ate two vendor quota units
   even though the answer hadn't changed.
2. **No memory.** A consultation done on Monday was gone by Tuesday — no way
   for the operator to revisit what was looked up, by whom, and what the
   numbers were.

Both wants point at the same artefact: a persisted record of every Molicar
response, indexed by placa + timestamp.

## Decision

Add table `kbb_consultas` to the webclient's Azure SQL database
(`carros_ativos_db`) — the same DB that already backs `/carros-ativos`.

The table doubles as **cache** and **history**:

- The server action `lookupPlacaPrecos` reads `kbb_consultas` first;
  if a row exists for the placa with `consulted_at >= NOW - 90 days`,
  it returns that row's payload and skips the function call.
- The new page `/historico-kbb` lists rows newest-first, each one
  collapsible to show the extracted fields + a deep link back to
  `/precos?placa=X` (which itself cache-hits and renders the full report).
- A "Forçar nova consulta" button on the cache-hit view bypasses the cache
  (writes a brand-new row).

The pricing Function App stays **stateless**. The cache lives where the
consumer lives.

### Schema

```sql
CREATE TABLE kbb_consultas (
  id                      UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
  placa                   NVARCHAR(10)     NOT NULL,
  brand                   NVARCHAR(60)     NULL,
  model                   NVARCHAR(120)    NULL,
  version                 NVARCHAR(240)    NULL,
  model_year              SMALLINT         NULL,
  fair_price_used_dealer  DECIMAL(12,2)    NULL,
  molicar_price           DECIMAL(12,2)    NULL,
  source_id               NVARCHAR(40)     NOT NULL DEFAULT 'molicar',
  upstream_latency_ms     INT              NULL,
  payload                 NVARCHAR(MAX)    NOT NULL,   -- full vendor JSON
  consulted_at            DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_kbb_consultas_placa_consulted_at ON kbb_consultas(placa, consulted_at DESC);
CREATE INDEX ix_kbb_consultas_consulted_at       ON kbb_consultas(consulted_at DESC);
```

### Why Azure SQL and not Cosmos

Both stores were on the table. We chose SQL because:

- **Existing infrastructure.** The webclient already speaks to
  `carros_ativos_db` via `src/lib/db/{pool,carros}.ts`. Adding one more
  table is a tiny incremental change.
- **Feature ownership.** Consultation history is a CRM-style feature
  consumed only by the webclient. Putting it next to `carros_ativos`
  keeps "things the operator sees" in one place.
- **Cost.** SQL Serverless auto-pauses after 60 min idle (R$ 25–40/mo at
  rest). One extra table is free.
- **Reads.** The history feed is a `TOP 200 … ORDER BY consulted_at DESC`
  — a relational sweet spot.

We **didn't** choose Cosmos (the enrichment-function uses Cosmos for its
plate cache) for these reasons:

- The pricing Function App would need a new Cosmos role + container + sync
  with the webclient's view. Two stores, two writes per consult.
- No second consumer of the pricing function exists today (APIM products
  for the pricing API are not yet defined; see [next-steps/001](next-steps/001-apim-products-subscriptions.md)).
  If/when they land, we can add a Cosmos layer on the function side without
  touching the webclient SQL flow.

### Cache semantics

- **Hit**: `consulted_at >= DATEADD(day, -90, SYSUTCDATETIME())` — return
  the saved payload + a "Cache · 90 dias / Última consulta em DD de MMM de
  AAAA / · N dias atrás" badge + a "Forçar nova consulta" button.
- **Miss**: call the pricing function. On success, insert a new row.
- **Insert failure** does NOT fail the lookup — the user still gets a
  result, the history just misses that row (matches the fail-open semantics
  the enrichment-function uses for Cosmos cache writes).
- **Force refresh**: bypasses step 1, always calls the function, always
  inserts.

We deliberately do NOT dedupe by deleting older rows for the same plate.
The history feed shows every consultation; cache check just needs the
newest one.

## UI changes

- `TopBar` nav gets `Histórico KBB` next to `Relatórios`.
- `/precos` accepts `?placa=X` and auto-runs the action — used by history
  cards' "Ver resultado completo →" deep link.
- Cache-hit badge replaces silent reuse: operator can tell at a glance
  whether they're looking at fresh or saved data, with an explicit override.

## Consequences

- **Vendor quota goes down.** Every repeat lookup within 90 days is now a
  zero-call answer.
- **History is auditable.** Every consultation is timestamped + traceable to
  the source_id and upstream latency.
- **One more migration to keep in sync.** Adding columns later (e.g. who
  ran the query) is the standard ALTER TABLE workflow; no schema-versioning
  table yet (migrations are idempotent IF NOT EXISTS guards).
- **No personal data** is added. `kbb_consultas` is keyed on placa; no
  customer/user attribution is stored today. When the platform grows a
  user model (see [next-steps/002](next-steps/002-customer-model-multi-tenancy.md)),
  add a `consulted_by` column then.

## Updates

- **2026-06-08** — The 90-day TTL was **removed**: cached consults are now kept **indefinitely** (reused regardless of age, cleared only manually), and the "90 dias" labels were dropped from the UI. Rows are also now owner-scoped (`owner_id`) and the history feed moved onto the **Tabela KBB** page. See [0007](0007-webclient-productization.md). The title's "90-day" wording is retained for history; the live policy is indefinite.

## References

- Migration: `apps/webclient/db/migrations/0002_kbb_consultas.sql` (+ `0005_tenant_owner.sql` for `owner_id`)
- Repository: `apps/webclient/src/lib/db/kbbConsultas.ts`
- Server action: `apps/webclient/src/app/actions/precos.ts`
- History page: now inline on `apps/webclient/src/app/precos/` (Tabela KBB); `historico-kbb/` retained
- Cache badge + force-refresh: `apps/webclient/src/app/precos/PrecosClient.tsx`
