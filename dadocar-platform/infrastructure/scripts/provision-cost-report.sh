#!/usr/bin/env bash
# Provision the monthly Azure cost-report function in a dedicated REPORTS resource
# group, wire its managed identity to Cost Management, and deploy the code.
#
#   bash infrastructure/scripts/provision-cost-report.sh
#
# Idempotent-ish: re-running reuses existing resources where possible. The storage
# account name is read from / written to .reports-storage-name so re-runs are stable.
set -euo pipefail

SUB="${SUB:-587a98de-d3a2-417d-9dbf-33459f464a6c}"
LOC="${LOC:-brazilsouth}"
RG="${RG:-rg-reports-brs}"
COST_RG="${COST_RG:-rg-dadocar-dev-brs}"
ACS_RG="${ACS_RG:-rg-dadocar-dev-brs}"
ACS_NAME="${ACS_NAME:-dadocar-dev-acs-brs}"
ACS_SENDER="${ACS_SENDER:-DoNotReply@1a6b5336-9248-482e-a7f5-dbe5cafe4cd9.azurecomm.net}"
RECIPIENTS="${RECIPIENTS:-rcosta1987@icloud.com,suporte@moneycar.com.br,suporte@profitcar.com.br}"
HERE="$(cd "$(dirname "$0")/../../services/cost-report-function" && pwd)"
NAMEFILE="$HERE/.reports-storage-name"

az account set --subscription "$SUB"

echo "▸ Resource group $RG ($LOC)"
az group create -n "$RG" -l "$LOC" -o none

if [ -f "$NAMEFILE" ]; then ST="$(cat "$NAMEFILE")"; else ST="streports${RANDOM}brs"; echo "$ST" > "$NAMEFILE"; fi
FUNC="${FUNC:-func-cost-report-brs}"
echo "▸ Storage account $ST"
az storage account create -n "$ST" -g "$RG" -l "$LOC" --sku Standard_LRS --kind StorageV2 --allow-blob-public-access true -o none
az storage blob service-properties update --account-name "$ST" --static-website --index-document index.html --404-document index.html -o none
KEY="$(az storage account keys list -n "$ST" -g "$RG" --query "[0].value" -o tsv)"
ST_CONN="$(az storage account show-connection-string -n "$ST" -g "$RG" -o tsv)"
az storage container create --account-name "$ST" --account-key "$KEY" -n reports -o none
WEB="$(az storage account show -n "$ST" -g "$RG" --query "primaryEndpoints.web" -o tsv)"

echo "▸ Function App $FUNC (Linux, Node 22, consumption)"
az functionapp create -n "$FUNC" -g "$RG" --storage-account "$ST" \
  --consumption-plan-location "$LOC" --os-type Linux \
  --runtime node --runtime-version 22 --functions-version 4 \
  --assign-identity '[system]' -o none

ACS_CONN="$(az communication list-key -n "$ACS_NAME" -g "$ACS_RG" --query primaryConnectionString -o tsv)"

echo "▸ App settings"
az functionapp config appsettings set -n "$FUNC" -g "$RG" -o none --settings \
  "COST_SUBSCRIPTION_ID=$SUB" \
  "COST_RESOURCE_GROUP=$COST_RG" \
  "REPORTS_STORAGE_CONNECTION=$ST_CONN" \
  "REPORTS_WEB_ENDPOINT=$WEB" \
  "ACS_CONNECTION_STRING=$ACS_CONN" \
  "ACS_SENDER=$ACS_SENDER" \
  "REPORT_RECIPIENTS=$RECIPIENTS"

echo "▸ Grant Cost Management Reader to the function identity (subscription scope)"
PID="$(az functionapp identity show -n "$FUNC" -g "$RG" --query principalId -o tsv)"
az role assignment create --assignee-object-id "$PID" --assignee-principal-type ServicePrincipal \
  --role "Cost Management Reader" --scope "/subscriptions/$SUB" -o none || \
  echo "  ! Could not assign Cost Management Reader (need elevated rights) — assign manually to principal $PID"

echo "▸ Deploy code"
cd "$HERE"
npm install --omit=dev --no-audit --no-fund
if command -v func >/dev/null 2>&1; then
  func azure functionapp publish "$FUNC"
else
  rm -f deploy.zip
  zip -qr deploy.zip host.json package.json src node_modules
  az functionapp deployment source config-zip -n "$FUNC" -g "$RG" --src deploy.zip -o none
  rm -f deploy.zip
fi

echo "✓ Done."
echo "  Static site : ${WEB}"
echo "  Manual run  : az functionapp function show ... ; or call GET /api/cost-report?month=YYYY-MM with the function key"
echo "  Identity    : $PID"
