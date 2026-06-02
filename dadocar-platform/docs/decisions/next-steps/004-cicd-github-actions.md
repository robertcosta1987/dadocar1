# 004 — CI/CD pipelines for Function App and Bicep

- **Status**: Open
- **Effort**: 3-5 days
- **Depends on**: —
- **Blocks**: nothing critical (everything can ship manually) but reduces operator risk

## Why

Today every change is published from a developer laptop:

- `func azure functionapp publish dadocar-dev-func-enrich-brs --javascript` for app code.
- `./infrastructure/scripts/deploy-dev.sh` for Bicep.

That means: no automated tests on PRs, no preview environments, no auditable deploy trail, no rollback to a known-good commit, no protection against the wrong commit going to prod (when prod exists).

## Scope

In:

- GitHub Actions workflow `function-app.yml` triggered on `main` push when `services/enrichment-function/**` changes:
  - Install, lint, test (when tests exist), publish via `Azure/functions-action@v1` using a Service Principal stored as a GH secret.
- GitHub Actions workflow `bicep.yml`:
  - On PR: `bicep build` + `az deployment sub what-if` against the dev subscription.
  - On `main` merge: optionally auto-apply to dev (or gate behind manual approval).
- Vercel auto-deploy already works (item is not needed for the frontend).

Out:

- Prod deploys via CI — that's coupled to item 014 (prod environment).
- Test infrastructure beyond syntax check — we don't have meaningful unit tests yet.

## Approach

1. Create `.github/workflows/function-app.yml` and `bicep.yml`.
2. Create a new SP for CI (`dadocar-ci-sp`) with the same role set as the deployer SP. Store credentials in GH Actions secrets.
3. Lock down the deployer SP afterward — rotate keys, scope to dev only.

## Success criteria

- Push to `main` touching `services/enrichment-function/**` → green build → Function App auto-published within 5 min.
- PR touching `infrastructure/bicep/**` → comment on the PR with the `what-if` output.
- Manual button to re-publish a specific commit's artifact (for rollback).

## References

- [IaaS.MD Brief 3.6 — deployment / promotion topology](../../IaaS.MD#brief-36--deployment--promotion-topology)
