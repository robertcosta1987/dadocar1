#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# provision-checktudo-func.sh
#
# Creates the CheckTudo Function App (services/pricing-function-checktudo) as a
# NEW, independent app in the SAME resource group as the existing enrichment /
# pricing functions — mirroring them, not replacing them.
#
# It reuses the shared resources (Consumption plan, storage account, App
# Insights, Key Vault) but gets its own content share and its own
# system-assigned Managed Identity, which is granted "Key Vault Secrets User"
# so the function can read the CheckTudo credentials at runtime.
#
# Idempotent: re-running updates settings / re-grants the role without error.
#
# Requirements: az login (a principal with rights to create the app + role
# assignments + set Key Vault secrets), Azure Functions Core Tools (`func`).
#
# Usage:
#   ./provision-checktudo-func.sh                 # create/update app + grant + settings
#   SEED_SECRETS=1 ./provision-checktudo-func.sh  # also seed checktudo-username/password
#   PUBLISH=1 ./provision-checktudo-func.sh        # also `func azure functionapp publish`
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
RG="${RG:-rg-dadocar-dev-brs}"
LOCATION="${LOCATION:-brazilsouth}"
# The shared plan dadocar-dev-asp-func-brs is a Windows-kind Y1 plan, so a Linux
# app cannot be created on it (AlwaysOn conflict). Give CheckTudo its OWN Linux
# Consumption plan — auto-created by --consumption-plan-location. ~R$0 idle.
STORAGE="${STORAGE:-dadocardevstbrso3uo}"           # existing storage account
APPINSIGHTS="${APPINSIGHTS:-dadocar-dev-appi-brs}"  # existing App Insights
KEYVAULT="${KEYVAULT:-dadocardevkvbrso3uo}"         # existing Key Vault
APP="${APP:-dadocar-dev-func-checktudo-brs}"        # NEW function app name
RUNTIME_VERSION="${RUNTIME_VERSION:-22}"            # Node 22 — Node 20 is EOL; Node 24 is broken on Linux Y1 in brazilsouth

FUNC_SRC_DIR="${FUNC_SRC_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../services/pricing-function-checktudo" && pwd)}"

echo "▶ RG=$RG  APP=$APP  STORAGE=$STORAGE  KV=$KEYVAULT  (own Linux Consumption plan)"

# ── 1. Create the Function App (Linux Consumption, Node) ─────────────────────
if az functionapp show -g "$RG" -n "$APP" >/dev/null 2>&1; then
  echo "✓ Function App $APP already exists — skipping create."
else
  echo "▶ Creating Function App $APP …"
  az functionapp create \
    --resource-group "$RG" \
    --name "$APP" \
    --consumption-plan-location "$LOCATION" \
    --storage-account "$STORAGE" \
    --runtime node \
    --runtime-version "$RUNTIME_VERSION" \
    --functions-version 4 \
    --os-type Linux \
    --assign-identity '[system]' \
    --app-insights "$APPINSIGHTS" \
    --https-only true \
    --output none
  echo "✓ Created."
fi

# ── 2. App settings (own content share + Key Vault URL + Node version) ───────
KV_URI="$(az keyvault show -n "$KEYVAULT" --query properties.vaultUri -o tsv)"
echo "▶ Setting app settings (KEYVAULT_URL=$KV_URI) …"
az functionapp config appsettings set -g "$RG" -n "$APP" --settings \
  "KEYVAULT_URL=$KV_URI" \
  "WEBSITE_NODE_DEFAULT_VERSION=~${RUNTIME_VERSION}" \
  "WEBSITE_CONTENTSHARE=$(echo "$APP" | tr '[:upper:]' '[:lower:]')" \
  --output none
echo "✓ App settings applied."

# ── 3. Grant the MI "Key Vault Secrets User" on the Key Vault (RBAC) ─────────
PRINCIPAL_ID="$(az functionapp identity show -g "$RG" -n "$APP" --query principalId -o tsv)"
KV_ID="$(az keyvault show -n "$KEYVAULT" --query id -o tsv)"
echo "▶ Granting Key Vault Secrets User to MI $PRINCIPAL_ID …"
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" \
  --scope "$KV_ID" \
  --output none 2>/dev/null && echo "✓ Role granted." || echo "✓ Role already present (or insufficient rights — grant manually)."

# ── 4. (optional) Seed CheckTudo credentials into Key Vault ──────────────────
if [[ "${SEED_SECRETS:-0}" == "1" ]]; then
  : "${CHECKTUDO_USERNAME:?set CHECKTUDO_USERNAME}"
  : "${CHECKTUDO_PASSWORD:?set CHECKTUDO_PASSWORD}"
  echo "▶ Seeding checktudo-username / checktudo-password …"
  az keyvault secret set --vault-name "$KEYVAULT" --name checktudo-username --value "$CHECKTUDO_USERNAME" --output none
  az keyvault secret set --vault-name "$KEYVAULT" --name checktudo-password --value "$CHECKTUDO_PASSWORD" --output none
  echo "✓ Secrets seeded."
fi

# ── 5. (optional) Publish the function code ──────────────────────────────────
if [[ "${PUBLISH:-0}" == "1" ]]; then
  echo "▶ Publishing code from $FUNC_SRC_DIR …"
  ( cd "$FUNC_SRC_DIR" && func azure functionapp publish "$APP" --javascript )
fi

# ── 6. Output the default function key (for CHECKTUDO_API_KEY) ───────────────
echo "▶ Function host + default key:"
echo "   host: https://$(az functionapp show -g "$RG" -n "$APP" --query defaultHostName -o tsv)"
KEY="$(az functionapp keys list -g "$RG" -n "$APP" --query functionKeys.default -o tsv 2>/dev/null || echo '')"
if [[ -n "$KEY" ]]; then
  echo "   CHECKTUDO_API_APP_ID=$APP"
  echo "   CHECKTUDO_API_KEY=$KEY"
else
  echo "   (no key yet — available after first deploy: az functionapp keys list -g $RG -n $APP)"
fi
echo "✓ Done."
