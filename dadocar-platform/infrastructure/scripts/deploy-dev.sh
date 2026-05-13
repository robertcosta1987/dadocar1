#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-dev.sh
# Provisions the Dadocar DEV environment. Idempotent — running twice with no
# changes produces no changes.
#
# Flow:
#   1. Tool + env-var prereq checks
#   2. SP login via login-sp.sh
#   3. Confirm subscription with the operator
#   4. bicep build (syntax check)
#   5. what-if (preview)
#   6. Confirm and deploy (subscription-scoped — main.bicep creates the RG)
#   7. Print deployed-resource summary + Infocar-credentials reminder
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BICEP_DIR="$REPO_ROOT/infrastructure/bicep"
PARAM_FILE="$BICEP_DIR/dev.bicepparam"
TEMPLATE_FILE="$BICEP_DIR/main.bicep"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/login-sp.sh"

# Tooling checks specific to this script.
command -v bicep >/dev/null 2>&1 || az bicep version >/dev/null 2>&1 \
  || { err "Bicep CLI not available (neither standalone nor via 'az bicep')."; exit 1; }

# ─── Subscription confirmation ─────────────────────────────────────────────
note "Active subscription: ${ACTIVE_SUB_NAME} (${ACTIVE_SUB_ID})"
note "Target region:       brazilsouth"
note "Resource group:      rg-dadocar-dev-brs"
read -r -p "Continue? [y/N] " CONFIRM
[[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]] || { warn "Aborted by operator."; exit 0; }

# ─── Resolve the deployer's principal ID for Key Vault RBAC ────────────────
# Service Principals are addressed by clientId on the user side, but role
# assignments need the *object id*. We look it up once.
DADOCAR_DEPLOYER_PRINCIPAL_ID=$(
  az ad sp show --id "$AZURE_CLIENT_ID" --query id -o tsv 2>/dev/null \
  || az ad sp list --filter "appId eq '$AZURE_CLIENT_ID'" --query "[0].id" -o tsv
)
if [[ -z "$DADOCAR_DEPLOYER_PRINCIPAL_ID" ]]; then
  err "Could not resolve the deployer SP's object ID. Does the SP have read access to AAD?"
  exit 1
fi
export DADOCAR_DEPLOYER_PRINCIPAL_ID
ok "Deployer principal ID: $DADOCAR_DEPLOYER_PRINCIPAL_ID"

# ─── Local syntax check ────────────────────────────────────────────────────
note "Building Bicep template locally…"
az bicep build --file "$TEMPLATE_FILE" --stdout >/dev/null
ok "Bicep build clean."

# ─── what-if ───────────────────────────────────────────────────────────────
DEPLOYMENT_NAME="dadocar-dev-$(date +%Y%m%d-%H%M%S)"

note "Running what-if (preview only, nothing is changed)…"
az deployment sub what-if \
  --name "$DEPLOYMENT_NAME" \
  --location brazilsouth \
  --template-file "$TEMPLATE_FILE" \
  --parameters "$PARAM_FILE" \
  --no-pretty-print false

read -r -p "Apply the changes above? [y/N] " APPLY_CONFIRM
[[ "$APPLY_CONFIRM" == "y" || "$APPLY_CONFIRM" == "Y" ]] || { warn "Aborted by operator before apply."; exit 0; }

# ─── Deploy ────────────────────────────────────────────────────────────────
note "Deploying… (APIM Consumption typically completes in ~5-10 minutes in Brazil South)"
if ! DEPLOYMENT_JSON=$(az deployment sub create \
  --name "$DEPLOYMENT_NAME" \
  --location brazilsouth \
  --template-file "$TEMPLATE_FILE" \
  --parameters "$PARAM_FILE" \
  --output json); then
  err "Deployment failed. Operation: $DEPLOYMENT_NAME"
  err "Inspect with: az deployment sub show --name $DEPLOYMENT_NAME --query properties.error"
  exit 1
fi

ok "Deployment succeeded."

# ─── Summary ───────────────────────────────────────────────────────────────
echo
echo "Deployed resources:"
echo "  Resource group:     $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.resourceGroupName.value)"
echo "  Location:           $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.location.value)"
echo "  APIM gateway URL:   $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.apimGatewayUrl.value)"
echo "  Cosmos endpoint:    $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.cosmosEndpoint.value)"
echo "  Cosmos account:     $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.cosmosAccountName.value)"
echo "  Function App:       $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.functionAppName.value)"
echo "  Function hostname:  $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.functionAppHostname.value)"
echo "  Key Vault URI:      $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.keyVaultUri.value)"
echo "  Key Vault name:     $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.keyVaultName.value)"
echo "  Storage account:    $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.storageAccountName.value)"
echo "  Event Hub namespace:$(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.eventHubNamespaceName.value)"
echo "  App Insights:       $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.appInsightsName.value)"
echo "  Log Analytics:      $(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.logAnalyticsName.value)"
echo

# ─── Infocar reminder ──────────────────────────────────────────────────────
KV_NAME=$(echo "$DEPLOYMENT_JSON" | jq -r .properties.outputs.keyVaultName.value)
echo "${C_YLW}Reminder${C_RST} — Infocar credentials are not yet written to Key Vault."
echo "When the customer's credentials are active, run:"
echo
echo "  az keyvault secret set --vault-name $KV_NAME --name infocar-id-key   --value '<your-id-key>'"
echo "  az keyvault secret set --vault-name $KV_NAME --name infocar-username --value '<your-username>'"
echo "  az keyvault secret set --vault-name $KV_NAME --name infocar-password --value '<your-password>'"
