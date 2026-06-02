# 006 — Network hardening (private endpoints + service-tag restrictions)

- **Status**: Open
- **Effort**: 1 week
- **Depends on**: nothing (can start any time, but easier after 004 so the deploy pipeline isn't fighting with new network rules)
- **Blocks**: most enterprise/regulated customers will ask for "is the data plane reachable from the public internet" — answer today is "yes"

## Why

Current data-plane posture is public + RBAC. That's fine for closed beta but a hard "no" for B2B contracts and a real LGPD risk surface:

- Cosmos DB: public endpoint, AAD RBAC only.
- Key Vault: public endpoint, RBAC.
- Storage (Data Lake Gen2): public endpoint.
- Event Hub namespace: public endpoint.
- Function App: public inbound (needed for APIM → Function call), no VNet integration.

A leaked Function App MI today can still only do what RBAC allows, but there's no defense-in-depth — every data-plane service is one identity compromise away from exposure.

## Scope

In:

- Private endpoints for Cosmos, Key Vault, Storage, Event Hub.
- A small VNet (`dadocar-dev-vnet-brs`) with two subnets: one for private endpoints, one for Function App VNet integration.
- Function App VNet integration so outbound calls to Cosmos/KV/EH go over the private endpoint.
- Storage firewall: allow only the VNet subnet + Azure trusted services.
- Cosmos firewall: allow only the VNet + the deployer SP's public IP (for Bicep `az` deployments).
- Document the deployer flow: if you `cd infrastructure && bicep deploy`, you need to be on the allowed IP list (or use a self-hosted runner inside the VNet, which is item 004).

Out:

- Azure Bastion / jump host (not needed — `az` CLI is enough).
- Web Application Firewall in front of APIM (separate item if we ever care).
- Express Route / VPN (single-region, no on-prem footprint).

## Approach

1. Add `infrastructure/bicep/modules/network.bicep` — VNet + subnets + NSGs.
2. Add `infrastructure/bicep/modules/private-endpoints.bicep` — one PE per service, plus private DNS zones.
3. Flip each service to `publicNetworkAccess: 'Disabled'` (or `'SecuredByPerimeter'` where supported) after the PE is up.
4. Enable Function App `vnetRouteAllEnabled` + integrate with the function subnet.
5. **Migration risk**: do this in dev first, with a rollback plan. The deploy pipeline (item 004) needs to either run from inside the VNet or have its egress IP allow-listed.

## Success criteria

- `curl https://<cosmos>.documents.azure.com` from a random laptop returns 403/connection refused.
- The Function App still works end-to-end via APIM.
- `az` deployments from the operator's IP still work.
- A documented runbook for "the deployer changed IPs, how do I get back in."

## References

- [IaaS.MD §1.6 networking](../../IaaS.MD#16-networking)
- Azure docs: private endpoints, VNet integration for Function Apps.
