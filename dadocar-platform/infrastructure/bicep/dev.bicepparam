// ─────────────────────────────────────────────────────────────────────────────
// dev.bicepparam — Dadocar DEV environment parameters
//
// The values here are baseline. Anything not overridden falls back to
// main.bicep defaults. `deployerPrincipalId` is read from an env var so the
// Service Principal running the deployment is never hardcoded in repo.
// ─────────────────────────────────────────────────────────────────────────────
using 'main.bicep'

param env                = 'dev'
param location           = 'brazilsouth'
param resourceGroupName  = 'rg-dadocar-dev-brs'
param namePrefix         = 'dadocar-dev'

// Empty APIM dev portal — these fields are visible if anyone hits the portal
// URL, but no APIs/products are surfaced in MVP.
param apimPublisherEmail = 'dpo@dadocar.com.br'
param apimPublisherName  = 'Dadocar'

// Identity of the Service Principal running the deployment. The SP needs this
// to receive Key Vault Secrets Officer at deploy time so it (or a human
// using `az login --service-principal …`) can later seed Infocar secrets
// without re-deploying Bicep.
//
// deploy-dev.sh exports DADOCAR_DEPLOYER_PRINCIPAL_ID from the SP's object ID
// before invoking the deployment.
param deployerPrincipalId = readEnvironmentVariable('DADOCAR_DEPLOYER_PRINCIPAL_ID', '')

param tags = {
  project:   'dadocar'
  env:       'dev'
  managedBy: 'bicep'
  costCenter: 'dadocar-mvp'
}
