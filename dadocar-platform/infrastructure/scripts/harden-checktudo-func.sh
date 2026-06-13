#!/usr/bin/env bash
# harden-checktudo-func.sh — PLACEHOLDER / TEMPLATE (do not run as-is).
#
# Goal: lock the CheckTudo Function App so ONLY our known callers (the
# webclient-fipe Vercel app that fronts the /api/v1/fipe API, and our admins)
# can hit it — defense-in-depth on top of the function key already required.
#
# The function is the "API service" that consults reach; today it accepts any
# caller that has the function key. This template adds IP/source allow-listing
# (Azure App Service "Access Restrictions") so requests from unknown endpoints
# are rejected at the platform edge.
#
# ⚠ Fill in the real values before running. The egress IPs are PLACEHOLDERS.
set -euo pipefail

RG="rg-dadocar-dev-brs"
APP="dadocar-dev-func-checktudo-brs"

# 1) Source endpoints allowed to call the function.
#    Vercel does NOT give fixed egress IPs on standard plans — to use an IP
#    allow-list you need Vercel static egress (Enterprise / Secure Compute) or
#    route the outbound call through a fixed-IP proxy/NAT. Put those CIDRs here.
#    Until then this stays a placeholder and the function key remains the guard.
ALLOWED_CIDRS=(
  "0.0.0.0/0"          # PLACEHOLDER — replace with Vercel egress CIDR(s)
  # "203.0.113.10/32"  # e.g. fixed proxy/NAT IP for the webclient-fipe app
  # "198.51.100.0/24"  # e.g. office / admin range
)

echo ">> Hardening ${APP} (access restrictions)"

# 2) Add an allow rule per CIDR (lower priority number = evaluated first).
prio=100
for cidr in "${ALLOWED_CIDRS[@]}"; do
  az functionapp config access-restriction add \
    -g "$RG" -n "$APP" \
    --rule-name "allow-${prio}" --action Allow \
    --ip-address "$cidr" --priority "$prio"
  prio=$((prio+10))
done

# 3) Default-deny everything else (App Service denies once any allow rule exists;
#    this makes the intent explicit and also covers the SCM/advanced site).
az functionapp config access-restriction set -g "$RG" -n "$APP" --use-same-restrictions-for-scm-site true || true

# 4) (Optional, stronger) Private networking instead of public IP allow-list:
#    - Put the Function App behind a VNet + Private Endpoint and disable public
#      access (requires Elastic Premium / dedicated plan, not Consumption Y1).
#    - az functionapp update -g "$RG" -n "$APP" --set publicNetworkAccess=Disabled
#    Left commented — Consumption (Y1) does not support private endpoints.

echo ">> Done. Verify: az functionapp config access-restriction show -g $RG -n $APP"
echo ">> NOTE: placeholder CIDRs in place — replace before relying on this."
