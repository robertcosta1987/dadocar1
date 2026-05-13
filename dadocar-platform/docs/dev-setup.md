# Dadocar — DEV environment setup

End-to-end runbook for provisioning the **DEV** Azure environment and running the local Infocar test app. The two parts are independent — you can do them in any order.

## 1. Prerequisites

| Tool | Minimum | Used for |
|---|---|---|
| Azure CLI | 2.60+ | All infrastructure scripts |
| Bicep CLI | bundled with Azure CLI 2.60+ | Template build + what-if |
| Node | 20+ | Infocar test app |
| `jq` | any recent | parsing deploy outputs in `deploy-dev.sh` |

Service Principal:

- An existing Azure AD app registration with permission on the target subscription.
- Roles required: either **Owner**, or **Contributor + User Access Administrator** (the second is needed because Bicep creates role assignments).
- You'll need the SP's `clientId`, `clientSecret`, `tenantId`, plus the target `subscriptionId`.

## 2. Repo layout (TL;DR)

```
infrastructure/
  bicep/                  modules + main.bicep + dev.bicepparam + prod.bicepparam (placeholder)
  scripts/                deploy-dev.sh / destroy-dev.sh / verify-dev.sh / login-sp.sh

apps/infocar-test/        local proxy + frontend (no Azure)

services/                 empty .gitkeep placeholders (future work)

docs/                     this file
```

## 3. Set environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

```
AZURE_CLIENT_ID=<your-sp-client-id>
AZURE_CLIENT_SECRET=<your-sp-secret>
AZURE_TENANT_ID=<tenant-id>
AZURE_SUBSCRIPTION_ID=<subscription-id>
```

`.env` is gitignored. Every script reads from environment first, then falls back to this file.

## 4. Deploy the DEV environment

```bash
./infrastructure/scripts/deploy-dev.sh
```

What the script does:

1. Validates the four `AZURE_*` env vars and the presence of `az` + Bicep.
2. `az login --service-principal` (via `login-sp.sh`).
3. Prints the active subscription and asks for confirmation.
4. Resolves the SP's object ID — the deploy needs it to assign Key Vault Secrets Officer on itself (so secrets can be seeded later via `az` without re-running Bicep).
5. Builds the Bicep template locally (syntax check).
6. Runs `az deployment sub what-if` and shows the plan.
7. Asks for a second confirmation.
8. Deploys (subscription-scoped — `main.bicep` creates the resource group).
9. Prints a summary block with key resource names and URLs.
10. Prints the Infocar-credentials reminder (Key Vault is provisioned **empty**).

Total wall-clock: ~10–15 minutes in Brazil South. APIM Consumption is the slowest at ~5–10 minutes.

The script is **idempotent** — running it again with no changes produces no changes.

## 5. Verify

```bash
./infrastructure/scripts/verify-dev.sh
```

Checks (one per line, PASS/FAIL):

- Resource group exists in `brazilsouth`.
- Each resource (Function App, Storage, Cosmos, Key Vault, Event Hub namespace, APIM, Log Analytics, App Insights) is in a healthy state.
- Storage has hierarchical namespace enabled.
- The three storage containers exist (`query-log`, `token-lock`, `function-host`).
- All five Cosmos containers exist with the correct partition keys.
- Key Vault is in RBAC authorization mode.
- Event Hub `query-events` exists.
- Function App's system-assigned Managed Identity exists and has the four expected role assignments.

At the end, the script prints a reminder that Infocar credentials are not yet in Key Vault — that's expected at MVP.

## 6. Seed Infocar secrets later

When the customer's Infocar credentials are activated, write them to Key Vault. **No Bicep change needed**:

```bash
# Get the Key Vault name from the deploy summary or from:
KV_NAME=$(az keyvault list -g rg-dadocar-dev-brs --query "[0].name" -o tsv)

az keyvault secret set --vault-name "$KV_NAME" --name infocar-id-key   --value '<your-id-key>'
az keyvault secret set --vault-name "$KV_NAME" --name infocar-username --value '<your-username>'
az keyvault secret set --vault-name "$KV_NAME" --name infocar-password --value '<your-password>'
```

The Function App's Managed Identity already has Key Vault Secrets User — it can read these at runtime once the Functions code is deployed (out of scope for MVP).

## 7. Run the Infocar test app

Independent of Azure:

```bash
cd apps/infocar-test
cp .env.example .env       # fill in INFOCAR_* values when credentials are activated
npm install
node server/proxy.js
open http://localhost:3001
```

The proxy and frontend boot even with missing credentials — every `/api/*` call returns `HTTP 503 credentials_missing`, and the frontend renders that as a warning card. Once you fill in `.env` and restart, submissions return real Infocar payloads with no code change.

See `apps/infocar-test/README.md` for details.

## 8. Tear down

```bash
./infrastructure/scripts/destroy-dev.sh
```

You'll be asked to type the resource group name verbatim. Delete is async (`--no-wait`); track with:

```bash
az group show --name rg-dadocar-dev-brs --query properties.provisioningState -o tsv
```

Because `enablePurgeProtection` is disabled on the Key Vault, the deleted name frees up quickly and the environment can be redeployed without collisions.

## 9. Estimated idle cost

Per `infrastructure/bicep/modules/*.bicep`:

```
APIM Consumption:        ~R$0 idle (pay per call, ~R$18/million calls)
Cosmos 400 RU/s shared:  ~R$120/month
Function App Consumption:~R$0 idle (pay per execution)
Storage LRS Hot:         ~R$5-10/month at dev volumes
Event Hub Basic 1 TU:    ~R$60/month
Key Vault Standard:      ~R$0 (negligible at dev operation volume)
Log Analytics + App I.:  ~R$0-20/month at dev volumes
                         ------
Total idle:              ~R$185-210/month
```

The dominant fixed costs are Cosmos (~R$120) and Event Hub Basic (~R$60). When the environment is idle and you're not testing, consider running `destroy-dev.sh` to take it to ~R$0 and redeploying on demand.

## 10. Out of scope (future work)

- All application code in `services/` — enrichment Function, token manager, provisioning orchestrator, Stripe webhook handler, de-identification job.
- Customer-facing apps (sign-up, dashboard, marketing site).
- Stripe integration.
- APIM products, subscriptions, OpenAPI specs, policies.
- Production environment (`prod.bicepparam` is a placeholder; no script deploys to prod).
- CI/CD pipelines.

When these come into scope, add them under the existing folder tree without restructuring the mono-repo.
