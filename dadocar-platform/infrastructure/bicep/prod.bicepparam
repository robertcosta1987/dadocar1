// ─────────────────────────────────────────────────────────────────────────────
// prod.bicepparam — PLACEHOLDER ONLY. Not deployed by any script in MVP.
//
// When prod is in scope, this file will need:
//   - APIM tier change from Consumption to Premium (multi-region, VNet)
//   - Cosmos: multi-region writes + ZRS + autoscale RU
//   - Storage: ZRS or GRS + soft delete
//   - Key Vault: enablePurgeProtection set true
//   - Event Hub: Standard or Premium tier with capture enabled
//   - Distinct publisherEmail/publisherName
//   - Distinct deployer SP with stricter scope
// ─────────────────────────────────────────────────────────────────────────────
using 'main.bicep'

param env                = 'prod'
param location           = 'brazilsouth'
param resourceGroupName  = 'rg-dadocar-prod-brs'
param namePrefix         = 'dadocar-prod'

param apimPublisherEmail = 'dpo@dadocar.com.br'
param apimPublisherName  = 'Dadocar'

param deployerPrincipalId = readEnvironmentVariable('DADOCAR_DEPLOYER_PRINCIPAL_ID', '')

param tags = {
  project:   'dadocar'
  env:       'prod'
  managedBy: 'bicep'
}
