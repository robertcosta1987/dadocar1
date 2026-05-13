#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# destroy-dev.sh
# Deletes the Dadocar DEV resource group, including everything in it.
# Requires the operator to type the resource group name verbatim as a
# guardrail against accidental destruction.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/login-sp.sh"

RG_NAME="${DADOCAR_RG_NAME:-rg-dadocar-dev-brs}"

if ! az group show --name "$RG_NAME" >/dev/null 2>&1; then
  note "Resource group $RG_NAME does not exist. Nothing to delete."
  exit 0
fi

warn "About to delete EVERYTHING in resource group: $RG_NAME"
warn "Subscription:                                  $ACTIVE_SUB_NAME ($ACTIVE_SUB_ID)"
echo
read -r -p "Type the resource group name exactly to confirm: " TYPED
if [[ "$TYPED" != "$RG_NAME" ]]; then
  err "Confirmation did not match. Aborted."
  exit 1
fi

note "Deleting $RG_NAME …"
az group delete --name "$RG_NAME" --yes --no-wait
ok "Delete initiated (running async on the Azure side)."
note "Track with: az group show --name $RG_NAME --query properties.provisioningState -o tsv"
