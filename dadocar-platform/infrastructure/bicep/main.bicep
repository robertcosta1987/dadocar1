// ─────────────────────────────────────────────────────────────────────────────
// main.bicep — Dadocar DEV environment (subscription-scoped)
//
// Subscription-scoped so the resource group is declared as a resource.
//
// Deploy order (Bicep figures this out from outputs, but for the reader):
//   1. resource group
//   2. monitoring   (no deps)
//   3. storage      (no deps — RBAC pulled out to break a cycle, see step 7)
//   4. functions    (needs storage outputs + monitoring outputs)
//   5. cosmos       (needs functions.functionPrincipalId)
//   6. eventhub     (needs functions.functionPrincipalId)
//   7. keyvault     (needs functions.functionPrincipalId + deployer principalId)
//   8. storage-rbac (needs storage + functions  — the cycle-breaker)
//   9. apim         (independent, runs in parallel with the above)
//
// Total idle cost (dev): ~R$185-210/month — see modules/* for line items.
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'subscription'

@description('Environment short name. Used in resource names and tags.')
param env string = 'dev'

@description('Azure region for the resource group and all resources.')
param location string = 'brazilsouth'

@description('Resource group name. Default: rg-dadocar-<env>-brs.')
param resourceGroupName string = 'rg-dadocar-${env}-brs'

@description('Resource name prefix. Default: dadocar-<env>.')
param namePrefix string = 'dadocar-${env}'

@description('APIM publisher email shown in the developer portal.')
param apimPublisherEmail string = 'dpo@dadocar.com.br'

@description('APIM publisher (organization) name shown in the developer portal.')
param apimPublisherName string = 'Dadocar'

@description('Tenant ID of the Service Principal running the deployment.')
param tenantId string = subscription().tenantId

@description('Object ID of the deployer (Service Principal). Gets Key Vault Secrets Officer so secrets can be seeded later via az CLI without re-deploying Bicep.')
param deployerPrincipalId string

@description('Common tags applied to every resource.')
param tags object = {
  project: 'dadocar'
  env: env
  managedBy: 'bicep'
}

// ─── Resource Group ─────────────────────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

// Stable suffix derived from (subscription, RG name). Same across runs,
// distinct per environment — perfect for the global-name suffix on storage,
// key vault, and Cosmos.
var uniqueSuffix = take(uniqueString(subscription().subscriptionId, resourceGroupName), 4)

// ─── Monitoring ─────────────────────────────────────────────────────────────
module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    namePrefix: namePrefix
    location:   location
    tags:       tags
  }
}

// ─── Storage (no RBAC; cycle-breaking) ──────────────────────────────────────
module storage 'modules/storage.bicep' = {
  scope: rg
  name: 'storage'
  params: {
    location:     location
    tags:         tags
    uniqueSuffix: uniqueSuffix
  }
}

// ─── Function App ──────────────────────────────────────────────────────────
module functions 'modules/functions.bicep' = {
  scope: rg
  name: 'functions'
  params: {
    namePrefix:            namePrefix
    location:              location
    tags:                  tags
    storageAccountName:    storage.outputs.storageName
    storageAccountId:      storage.outputs.storageId
    appInsightsConnString: monitoring.outputs.appInsightsConnString
  }
}

// ─── Storage RBAC (post-pass to break storage ↔ functions cycle) ───────────
module storageRbac 'modules/storage-rbac.bicep' = {
  scope: rg
  name: 'storage-rbac'
  params: {
    storageAccountName:  storage.outputs.storageName
    functionPrincipalId: functions.outputs.functionPrincipalId
  }
}

// ─── Cosmos ────────────────────────────────────────────────────────────────
module cosmos 'modules/cosmos.bicep' = {
  scope: rg
  name: 'cosmos'
  params: {
    location:            location
    tags:                tags
    uniqueSuffix:        uniqueSuffix
    functionPrincipalId: functions.outputs.functionPrincipalId
  }
}

// ─── Event Hub ─────────────────────────────────────────────────────────────
module eventhub 'modules/eventhub.bicep' = {
  scope: rg
  name: 'eventhub'
  params: {
    namePrefix:          namePrefix
    location:            location
    tags:                tags
    functionPrincipalId: functions.outputs.functionPrincipalId
  }
}

// ─── Key Vault ─────────────────────────────────────────────────────────────
module keyvault 'modules/keyvault.bicep' = {
  scope: rg
  name: 'keyvault'
  params: {
    location:            location
    tags:                tags
    uniqueSuffix:        uniqueSuffix
    tenantId:            tenantId
    deployerPrincipalId: deployerPrincipalId
    functionPrincipalId: functions.outputs.functionPrincipalId
  }
}

// ─── APIM (Consumption ~5-10 min in Brazil South) ──────────────────────────
module apim 'modules/apim.bicep' = {
  scope: rg
  name: 'apim'
  params: {
    namePrefix:     namePrefix
    location:       location
    tags:           tags
    publisherEmail: apimPublisherEmail
    publisherName:  apimPublisherName
  }
}

// ─── Outputs — surfaced by deploy-dev.sh as the summary block. ─────────────
output resourceGroupName     string = rg.name
output location              string = location
output apimGatewayUrl        string = apim.outputs.apimGatewayUrl
output cosmosEndpoint        string = cosmos.outputs.cosmosEndpoint
output cosmosAccountName     string = cosmos.outputs.cosmosAccountName
output functionAppName       string = functions.outputs.functionAppName
output functionAppHostname   string = functions.outputs.functionAppHostname
output keyVaultUri           string = keyvault.outputs.keyVaultUri
output keyVaultName          string = keyvault.outputs.keyVaultName
output storageAccountName    string = storage.outputs.storageName
output eventHubNamespaceName string = eventhub.outputs.eventHubNamespaceName
output appInsightsName       string = monitoring.outputs.appInsightsName
output logAnalyticsName      string = monitoring.outputs.logAnalyticsName
