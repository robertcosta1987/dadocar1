// ─────────────────────────────────────────────────────────────────────────────
// prod.bicepparam — Placas360 PRODUCTION (target naming: placas360-prd-*).
//
// This is the deploy target for the resource RENAME/migration (dadocar-dev-* →
// placas360-prd-*). Deploying it creates a NEW stack; data + consumers must then
// be migrated and the old stack retired. See docs/INFRA/RESOURCE_CATALOG.md.
//
// Hardening recommended for a fresh prod build: APIM Premium, Cosmos multi-region
// + autoscale, Storage ZRS/GRS + soft delete, KV purge protection, Event Hub
// Standard + capture.
// ─────────────────────────────────────────────────────────────────────────────
using 'main.bicep'

param env                = 'prd'
param location           = 'brazilsouth'
param resourceGroupName  = 'rg-placas360-prd-brs'
param namePrefix         = 'placas360-prd'

param apimPublisherEmail = 'dpo@placas360.com.br'
param apimPublisherName  = 'Placas360'

param deployerPrincipalId = readEnvironmentVariable('PLACAS360_DEPLOYER_PRINCIPAL_ID', '')

param tags = {
  project:    'Placas360'
  env:        'prd'
  managedBy:  'bicep'
  costCenter: 'placas360-prod'
}
