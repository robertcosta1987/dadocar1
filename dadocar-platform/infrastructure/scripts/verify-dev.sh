#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# verify-dev.sh
# Post-deploy structural checks. PASS / FAIL per check. Non-zero exit on any
# structural failure. Does NOT verify Infocar secrets — they're intentionally
# absent at MVP stage; this script prints a notice instead.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail   # NOTE: no -e so we collect all failures before exiting

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/login-sp.sh"

RG_NAME="${DADOCAR_RG_NAME:-rg-dadocar-dev-brs}"
LOCATION="${DADOCAR_LOCATION:-brazilsouth}"

FAIL_COUNT=0
PASS_COUNT=0

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    ok "$label"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    err "$label"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

check_eq() {
  local label="$1"; local expected="$2"; shift 2
  local actual; actual=$("$@" 2>/dev/null)
  if [[ "$actual" == "$expected" ]]; then
    ok "$label  (= $expected)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    err "$label  (expected '$expected', got '$actual')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "Verifying DEV environment in $RG_NAME …"
echo

# ─── Resource group ────────────────────────────────────────────────────────
check_eq "Resource group exists in $LOCATION" "$LOCATION" \
  az group show --name "$RG_NAME" --query location -o tsv

# Discover resource names from RG.
FUNC_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.Web/sites --query "[0].name" -o tsv 2>/dev/null)
STORAGE_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.Storage/storageAccounts --query "[0].name" -o tsv 2>/dev/null)
COSMOS_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.DocumentDB/databaseAccounts --query "[0].name" -o tsv 2>/dev/null)
KV_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.KeyVault/vaults --query "[0].name" -o tsv 2>/dev/null)
EHNS_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.EventHub/namespaces --query "[0].name" -o tsv 2>/dev/null)
APIM_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.ApiManagement/service --query "[0].name" -o tsv 2>/dev/null)
LA_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.OperationalInsights/workspaces --query "[0].name" -o tsv 2>/dev/null)
AI_NAME=$(az resource list -g "$RG_NAME" --resource-type Microsoft.Insights/components --query "[0].name" -o tsv 2>/dev/null)

# ─── Existence + provisioning state ────────────────────────────────────────
check_eq "Function App running"          "Running"   az functionapp show -g "$RG_NAME" -n "$FUNC_NAME" --query state -o tsv
check_eq "Storage account provisioned"   "Succeeded" az storage account show -g "$RG_NAME" -n "$STORAGE_NAME" --query provisioningState -o tsv
check_eq "Cosmos account provisioned"    "Succeeded" az cosmosdb show -g "$RG_NAME" -n "$COSMOS_NAME" --query provisioningState -o tsv
check_eq "Key Vault provisioned"         "Succeeded" az keyvault show -g "$RG_NAME" -n "$KV_NAME" --query properties.provisioningState -o tsv
check_eq "Event Hub namespace status"    "Active"    az eventhubs namespace show -g "$RG_NAME" -n "$EHNS_NAME" --query status -o tsv
check_eq "APIM provisioned"              "Succeeded" az apim show -g "$RG_NAME" -n "$APIM_NAME" --query provisioningState -o tsv
check_eq "Log Analytics provisioned"     "Succeeded" az monitor log-analytics workspace show -g "$RG_NAME" -n "$LA_NAME" --query provisioningState -o tsv
check    "App Insights present"          az resource show -g "$RG_NAME" -n "$AI_NAME" --resource-type Microsoft.Insights/components

# ─── Storage: hierarchical namespace ───────────────────────────────────────
# az CLI returns booleans as lowercase 'true'/'false' in tsv output.
check_eq "Storage hierarchical namespace enabled" "true" \
  az storage account show -g "$RG_NAME" -n "$STORAGE_NAME" --query isHnsEnabled -o tsv

# ─── Storage containers ────────────────────────────────────────────────────
for c in query-log token-lock function-host; do
  check "Storage container '$c' exists" \
    az storage container show --account-name "$STORAGE_NAME" --name "$c" --auth-mode login
done

# ─── Cosmos containers + partition keys ────────────────────────────────────
declare -a EXPECTED_CONTAINERS=(
  "vehicles:/placa"
  "fipe_prices:/codigoFipe"
  "vehicle_index:/lookup_key"
  "customers:/customer_id"
  "secrets:/secret_name"
)
for entry in "${EXPECTED_CONTAINERS[@]}"; do
  name="${entry%%:*}"
  pk="${entry##*:}"
  actual_pk=$(az cosmosdb sql container show \
    -g "$RG_NAME" -a "$COSMOS_NAME" -d dadocar -n "$name" \
    --query "resource.partitionKey.paths[0]" -o tsv 2>/dev/null)
  if [[ "$actual_pk" == "$pk" ]]; then
    ok "Cosmos container '$name' partition key = $pk"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    err "Cosmos container '$name'  (expected pk '$pk', got '$actual_pk')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

# ─── Key Vault: RBAC mode ──────────────────────────────────────────────────
check_eq "Key Vault RBAC authorization enabled" "true" \
  az keyvault show -g "$RG_NAME" -n "$KV_NAME" --query properties.enableRbacAuthorization -o tsv

# ─── Event Hub: 'query-events' present ─────────────────────────────────────
check "Event Hub 'query-events' exists" \
  az eventhubs eventhub show -g "$RG_NAME" --namespace-name "$EHNS_NAME" -n query-events

# ─── Function App Managed Identity + role assignments ──────────────────────
FUNC_MI=$(az functionapp identity show -g "$RG_NAME" -n "$FUNC_NAME" --query principalId -o tsv 2>/dev/null)
if [[ -n "$FUNC_MI" ]]; then
  ok "Function App system-assigned MI present ($FUNC_MI)"
  PASS_COUNT=$((PASS_COUNT + 1))

  # Verify the four expected role assignments. Each is scoped to its own
  # resource, so we list scoped assignments and grep for the MI.
  STORAGE_ID=$(az storage account show -g "$RG_NAME" -n "$STORAGE_NAME" --query id -o tsv)
  KV_ID=$(az keyvault show -g "$RG_NAME" -n "$KV_NAME" --query id -o tsv)
  EHNS_ID=$(az eventhubs namespace show -g "$RG_NAME" -n "$EHNS_NAME" --query id -o tsv)

  check "MI → Storage Blob Data Contributor (storage)" \
    az role assignment list --assignee "$FUNC_MI" --scope "$STORAGE_ID" \
      --role "Storage Blob Data Contributor" --query "[0].id" -o tsv
  check "MI → Key Vault Secrets User (keyvault)" \
    az role assignment list --assignee "$FUNC_MI" --scope "$KV_ID" \
      --role "Key Vault Secrets User" --query "[0].id" -o tsv
  check "MI → Azure Event Hubs Data Sender (eventhub namespace)" \
    az role assignment list --assignee "$FUNC_MI" --scope "$EHNS_ID" \
      --role "Azure Event Hubs Data Sender" --query "[0].id" -o tsv

  # Cosmos data-plane RBAC is a separate API surface.
  COSMOS_DATA_ASSIGNMENTS=$(az cosmosdb sql role assignment list \
    -g "$RG_NAME" -a "$COSMOS_NAME" \
    --query "[?principalId=='$FUNC_MI'].id" -o tsv 2>/dev/null)
  if [[ -n "$COSMOS_DATA_ASSIGNMENTS" ]]; then
    ok "MI → Cosmos DB Built-in Data Contributor (Cosmos account)"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    err "MI → Cosmos DB Built-in Data Contributor — not found"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  err "Function App system-assigned MI not found"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo
echo "─────────────────────────────────────────────────────────────"
echo "  PASS: $PASS_COUNT     FAIL: $FAIL_COUNT"
echo "─────────────────────────────────────────────────────────────"
echo
warn "Reminder: Infocar credentials are not yet written to Key Vault."
warn "Run when the customer's credentials are active:"
warn "  az keyvault secret set --vault-name $KV_NAME --name infocar-id-key   --value '<…>'"
warn "  az keyvault secret set --vault-name $KV_NAME --name infocar-username --value '<…>'"
warn "  az keyvault secret set --vault-name $KV_NAME --name infocar-password --value '<…>'"

[[ "$FAIL_COUNT" -eq 0 ]] || exit 1
