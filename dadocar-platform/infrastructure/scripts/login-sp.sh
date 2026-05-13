#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# login-sp.sh
# Authenticates the Azure CLI session using a Service Principal whose
# credentials are passed via env vars. Sourced by the other scripts; not
# meant to be run on its own.
#
# Required env vars:
#   AZURE_CLIENT_ID
#   AZURE_CLIENT_SECRET
#   AZURE_TENANT_ID
#   AZURE_SUBSCRIPTION_ID
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Pretty colors when stdout is a tty.
if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_GRN=$'\e[32m'; C_YLW=$'\e[33m'; C_BLU=$'\e[34m'; C_RST=$'\e[0m'
else
  C_RED=; C_GRN=; C_YLW=; C_BLU=; C_RST=
fi

err() { echo "${C_RED}✗${C_RST} $*" >&2; }
ok()  { echo "${C_GRN}✓${C_RST} $*"; }
note(){ echo "${C_BLU}ℹ${C_RST} $*"; }
warn(){ echo "${C_YLW}!${C_RST} $*"; }

# Pull from .env if present and the vars aren't already set. We don't
# overwrite anything already exported — env wins over file.
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    err "$name is not set. Refusing to continue."
    err "Set it in your shell or in dadocar-platform/.env (see .env.example)."
    exit 1
  fi
}

require_env AZURE_CLIENT_ID
require_env AZURE_CLIENT_SECRET
require_env AZURE_TENANT_ID
require_env AZURE_SUBSCRIPTION_ID

# Tooling checks — fail fast on outdated machines.
command -v az >/dev/null 2>&1 || { err "Azure CLI 'az' is not on PATH."; exit 1; }

# Authenticate. --only-show-errors keeps the output clean; if anything goes
# wrong, az writes to stderr and exits non-zero.
note "Logging in as Service Principal ($AZURE_CLIENT_ID)…"
az login --service-principal \
  --username "$AZURE_CLIENT_ID" \
  --password "$AZURE_CLIENT_SECRET" \
  --tenant "$AZURE_TENANT_ID" \
  --only-show-errors >/dev/null

az account set --subscription "$AZURE_SUBSCRIPTION_ID" --only-show-errors

ACTIVE_SUB_NAME=$(az account show --query name -o tsv)
ACTIVE_SUB_ID=$(az account show --query id -o tsv)
ok "Logged in. Active subscription: $ACTIVE_SUB_NAME ($ACTIVE_SUB_ID)"
