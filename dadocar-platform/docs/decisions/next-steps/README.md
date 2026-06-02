# Next steps — the production backlog

Tracked work items that the platform needs to reach a real production posture. Each file describes a single concrete deliverable with its own scope, dependencies, and effort estimate. Living docs — update status in the file when work starts / finishes.

## How to use this

- **Pick an item by ID** when starting work; reference it in commits (`feat(007): cosmos autoscale`).
- **Update its Status** in the file (`Open → In Progress → Done` or `Blocked: <reason>`).
- **Close out** by either deleting the file (rare — usually keep for history) or moving it to a `done/` folder and crossing it off here.
- **Add new items** as new files. Pick the next free 3-digit number.

## Catalog (ordered roughly by what would block a paying-customer launch)

| ID | Title | Status | Effort |
|---|---|---|---|
| [001](001-apim-products-subscriptions.md) | APIM products + subscriptions + rate-limit policies | Open | 1-2 weeks |
| [002](002-customer-model-multi-tenancy.md) | Customer model in Cosmos + per-customer attribution | Open | 1 week |
| [003](003-stripe-and-provisioning.md) | Stripe billing + provisioning-orchestrator + webhook handler | Open | 2-3 weeks |
| [004](004-cicd-github-actions.md) | CI/CD pipelines for Function App and Bicep | Open | 3-5 days |
| [005](005-monitor-alerts-and-slos.md) | Azure Monitor alerts + SLO/SLI definitions | Open | 2-3 days |
| [006](006-network-hardening.md) | Private endpoints + service-tag restrictions on KV / Cosmos / Function App | Open | 1 week |
| [007](007-cosmos-autoscale-and-ru-sizing.md) | Cosmos autoscale RU + sizing review | Open | 1-2 days |
| [008](008-data-lake-pipeline.md) | Data lake ingestion (EH → Capture → Synapse / Databricks) | Open | 1-2 weeks |
| [009](009-deidentification-job.md) | LGPD de-identification job over `query-log` partitions | Open | 1 week |
| [010](010-token-manager-shared-cache.md) | Cross-instance Infocar token cache via Cosmos `secrets` | Open | 2-3 days |
| [011](011-fipe-monthly-refresh.md) | FIPE pricing monthly refresh job (`fipe_prices` container) | Open | 3-5 days |
| [012](012-vin-cache-vehicle-index.md) | VIN cache via `vehicle_index` (resolve VIN→plate, then read `vehicles`) | Open | 2 days |
| [013](013-otel-distro-deps-exceptions.md) | OpenTelemetry distro for `AppDependencies` + `AppExceptions` | Open | 1 day |
| [014](014-production-environment.md) | Production environment provisioning + promotion process | Open | 1-2 weeks |
| [015](015-multi-region-dr.md) | Multi-region / disaster recovery strategy | Open | 2-3 weeks |

## Notes

- "Effort" is calendar wall-time for one focused engineer; real elapsed time depends on availability and review cycles.
- Items aren't strictly sequenced — some can land in parallel (e.g. 004 CI/CD and 005 monitors).
- Common dependency: 002 (customer model) gates 001 (APIM subscriptions) and 003 (Stripe).
- The data-layer chain is 008 + 009; 008 ships before 009 has anything to anonymize.
