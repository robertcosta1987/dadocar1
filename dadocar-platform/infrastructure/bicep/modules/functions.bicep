// ─────────────────────────────────────────────────────────────────────────────
// functions.bicep
// Linux Consumption Function App, Node 20 runtime. Empty host — no code is
// deployed by Bicep. System-assigned Managed Identity is enabled so other
// modules can grant it data-plane roles.
//
// IMPORTANT: this module ONLY creates the plan + function app. It does NOT
// create the Storage Account or App Insights — those come from sibling
// modules and are wired via app settings in main.bicep so the
// dependency graph stays one-directional.
//
// Cost (idle dev volumes):
//   Function App Consumption: ~R$0 idle (pay per execution)
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Resource name prefix, e.g. dadocar-dev')
param namePrefix string

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Storage account name (the runtime needs AzureWebJobsStorage)')
param storageAccountName string

@description('Storage account resource ID — used for the connection-string lookup')
param storageAccountId string

@description('Application Insights connection string')
param appInsightsConnString string

resource hostingPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  // Y1 = Linux Consumption. Name must be globally unique within RG, but is
  // an internal artifact — users never see it.
  name: '${namePrefix}-asp-func-brs'
  location: location
  tags: tags
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'functionapp,linux'
  properties: {
    reserved: true   // required for Linux plans
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: '${namePrefix}-func-enrich-brs'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      use32BitWorkerProcess: false
      appSettings: [
        // Functions runtime essentials.
        {
          name: 'AzureWebJobsStorage'
          // listKeys() returns a SecureString; Bicep handles that fine.
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(storageAccountId, '2024-01-01').keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(storageAccountId, '2024-01-01').keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower('${namePrefix}-func-enrich-brs')
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        // Telemetry.
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnString
        }
      ]
    }
  }
}

output functionAppId       string = functionApp.id
output functionAppName     string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
@description('Function App system-assigned Managed Identity principalId. Other modules consume this to assign data-plane roles.')
output functionPrincipalId string = functionApp.identity.principalId
