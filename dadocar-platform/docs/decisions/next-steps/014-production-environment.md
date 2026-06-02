# 014 — Production environment provisioning + promotion process

- **Status**: Open
- **Effort**: 1-2 weeks
- **Depends on**: [004](004-cicd-github-actions.md) (the promotion needs a pipeline), [006](006-network-hardening.md) (prod should not ship with public data-plane endpoints), [007](007-cosmos-autoscale-and-ru-sizing.md) (prod should be autoscaled), [005](005-monitor-alerts-and-slos.md) (prod must be alerted)
- **Blocks**: charging any real customer

## Why

Everything in Azure today lives under the `dadocar-dev-rg-brs` resource group with `-dev-` suffixes. There is no `prod` environment. Closing the first paid contract means we need:

- An isolated `dadocar-prod-rg-brs` resource group with its own data plane (no shared Cosmos with dev).
- A documented promotion process: dev → prod, gated by something (manual approval / tag / GitHub environment).
- Real-domain DNS + a TLS cert that isn't a `*.azurewebsites.net` host.
- A pre-launch readiness checklist (alerts firing, network rules verified, secrets rotated, backups configured).

## Scope

In:

- New resource group + a `bicep deploy --parameters env=prod` flow that emits identical infra with `prod` naming.
- Separate Key Vault, separate Cosmos account, separate APIM instance (or a separate product within the same APIM if cost matters).
- A `prod.parameters.json` (or env-driven) parameter file under `infrastructure/bicep/parameters/`.
- Custom domain on APIM (e.g. `api.dadocar.com`).
- A GitHub `production` environment with manual approval gate (depends on item 004).
- A pre-launch checklist as `docs/runbooks/prod-launch-checklist.md`.

Out:

- Multi-region prod (item 015).
- Blue/green or canary deploys — not worth the complexity at the customer scale we're targeting; rolling with health-gated promotion is enough.

## Approach

1. Parameterise the existing Bicep with `env` (already partially done — review).
2. Stand up prod resources in a stage when no real traffic exists yet.
3. Validate the prod environment with the same end-to-end smoke test as dev (same Vercel frontend, just pointed at the prod URL).
4. Document the cutover plan: dev URL stays for staging; prod URL is what goes to customers.

## Success criteria

- A `git tag v1.0.0 && git push --tags` (or a manual workflow_dispatch) deploys to prod after approval, including the function code.
- Prod alerts (item 005) are wired and tested with a deliberate broken canary.
- The pre-launch checklist passes end-to-end before the first paying customer is invited.

## References

- [IaaS.MD §0 environments](../../IaaS.MD#0-environments--naming)
- [004 CI/CD](004-cicd-github-actions.md)
