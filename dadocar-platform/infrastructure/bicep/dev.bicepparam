// ─────────────────────────────────────────────────────────────────────────────
// dev.bicepparam — the CURRENTLY-DEPLOYED stack (legacy 'dadocar-dev-*' names).
//
// IMPORTANT: despite the names, this stack IS Placas360 PRODUCTION (the only
// "dev" is the Vercel frontend preview). Names are kept here so a redeploy does
// NOT recreate resources; the tags reflect production. The rename to
// 'placas360-prd-*' is a migration (see prod.bicepparam + docs/INFRA/RESOURCE_CATALOG.md).
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
  project:    'Placas360'
  env:        'prd'
  managedBy:  'bicep'
  costCenter: 'placas360-prod'
}
