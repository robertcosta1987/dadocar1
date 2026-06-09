# 018 — Ready to Market? — readiness to sell, scale, stabilize, secure, profit

- **Status**: Open (tracking dashboard)
- **Effort**: rollup of the items below
- **Purpose**: a single readiness view — what still has to be true before Dadocar / Placas360 can be **sold to the public, scale, stay up, be secure, and make money**. This is a synthesis of the backlog, not new scope; each gap links to its tracked item.

## TL;DR

The platform **works end-to-end** (aggregator + KBB + CheckTudo live; the webclient is authenticated, multi-tenant, with recall AI and indefinite caching — [0007](../0007-webclient-productization.md)). It is **not yet a sellable product**: there is no payment, no self-serve onboarding, no CRM, no hardened/observable production environment, and no CI/CD. The critical path to first revenue is **002 → 003 → 016 → 017** with **001** for metered API access.

## Readiness by dimension

### 💰 Sellable (can a stranger pay and use it?)
- ✅ Access is closed (auth + invite gate) and isolated per tenant ([0007](../0007-webclient-productization.md)).
- ❌ No paywall / pricing page / Stripe checkout — [003](003-stripe-and-provisioning.md), [017](017-paywall-self-serve-provisioning.md).
- ❌ No self-serve sign-up → automatic tenant provisioning — [017](017-paywall-self-serve-provisioning.md).
- ❌ No customer/plan model of record — [002](002-customer-model-multi-tenancy.md).
- ❌ Metered API for API customers (vs. the UI) — APIM products/subscriptions/quotas — [001](001-apim-products-subscriptions.md).

### 📈 Scalable (does it hold up as customers and volume grow?)
- ✅ Stateless functions + indefinite cache cut vendor calls; KBB token reuse.
- ⚠️ Cosmos RU sizing/autoscale unreviewed — [007](007-cosmos-autoscale-and-ru-sizing.md).
- ⚠️ Cross-instance vendor-token cache (avoid per-instance re-login) — [010](010-token-manager-shared-cache.md).
- ⚠️ App-local tenancy is Azure SQL `owner_id`; consolidate into the platform customer model as volume grows — [002](002-customer-model-multi-tenancy.md).
- ❌ Data-lake/analytics pipeline for usage at scale — [008](008-data-lake-pipeline.md).

### 🟢 Stable (does it stay up, and do we know when it doesn't?)
- ✅ App Insights + Log Analytics wired; webclient builds gated by tsc/eslint.
- ❌ No alerts / SLOs — [005](005-monitor-alerts-and-slos.md).
- ❌ No CI/CD (deploys are manual `func publish` / `git push`) — [004](004-cicd-github-actions.md).
- ❌ No production environment / promotion process — [014](014-production-environment.md).
- ❌ No multi-region / DR — [015](015-multi-region-dr.md).
- ⚠️ Dependency/exception telemetry needs the OTel distro — [013](013-otel-distro-deps-exceptions.md).
- ⚠️ Vendor-quota failures surface to the user (e.g. CheckTudo "limite atingido") but there's no proactive quota alerting.

### 🔒 Secured (is customer data and access protected?)
- ✅ App auth: scrypt passwords, signed httpOnly sessions, route gate, per-tenant isolation ([0007](../0007-webclient-productization.md)); secrets in Key Vault / Vercel env (not in repo).
- ❌ Network hardening — private endpoints / service-tag restrictions on KV / Cosmos / SQL / Functions — [006](006-network-hardening.md).
- ❌ LGPD de-identification over stored query data — [009](009-deidentification-job.md).
- ⚠️ No password reset / MFA / rate-limiting on the login form yet (Vercel sits in front); revisit if abused — [0007](../0007-webclient-productization.md).
- ⚠️ Vercel Deployment Protection should be **off** for the public domain (app auth replaces it) — confirm per launch.

### 🤑 Profitable (do we know we make money, per customer?)
- ❌ No CRM / payment ledger / profit & spend tracking — [016](016-crm.md).
- ❌ No per-query vendor-cost attribution (Molicar / CheckTudo product / Anthropic / Azure) — [016](016-crm.md).
- ✅ Caching already suppresses repeat vendor spend (indefinite cache + dedup).

## Critical path to first paid customer

1. [002](002-customer-model-multi-tenancy.md) customer model → 2. [003](003-stripe-and-provisioning.md) Stripe + provisioning → 3. [016](016-crm.md) CRM (payments/profit/spend) → 4. [017](017-paywall-self-serve-provisioning.md) paywall + self-serve provisioning wired to CRM. In parallel: [001](001-apim-products-subscriptions.md) (metered API), [004](004-cicd-github-actions.md) (CI/CD), [005](005-monitor-alerts-and-slos.md) (alerts/SLOs), [014](014-production-environment.md) (prod env), [006](006-network-hardening.md) (network hardening).

## References

- [decisions/0007](../0007-webclient-productization.md), [IaaS.MD](../../IaaS.MD), and the catalog in [next-steps/README.md](README.md).
