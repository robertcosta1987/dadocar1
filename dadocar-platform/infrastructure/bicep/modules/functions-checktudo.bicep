// ─────────────────────────────────────────────────────────────────────────────
// functions-checktudo.bicep
// The CheckTudo Function App — a SECOND, independent Linux Consumption app in
// the same resource group, mirroring functions.bicep (the enrichment app). It
// reuses the existing hosting plan + storage account + App Insights and gets a
// system-assigned Managed Identity so the Key Vault module can grant it
// data-plane read access (Key Vault Secrets User).
//
// IaC-parity module. Not wired into main.bicep by default — the app is normally
// provisioned via infrastructure/scripts/provision-checktudo-func.sh so a full
// `az deployment sub create` doesn't have to touch every other resource. Wire it
// in (and grant its functionPrincipalId in keyvault.bicep) when you want the
// app fully tracked by the stack deploy.
//
// Cost (idle dev volumes): ~R$0 idle (Consumption, pay per execution).
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Resource name prefix, e.g. dadocar-dev')
param namePrefix string

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Existing hosting plan (serverfarm) resource ID to run on')
param hostingPlanId string

@description('Storage account name (the runtime needs AzureWebJobsStorage)')
param storageAccountName string

@description('Storage account resource ID — used for the connection-string lookup')
param storageAccountId string

@description('Application Insights connection string')
param appInsightsConnString string

@description('Key Vault URI the function reads CheckTudo credentials from, e.g. https://<kv>.vault.azure.net/')
param keyVaultUri string

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: '${namePrefix}-func-checktudo-brs'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlanId
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      use32BitWorkerProcess: false
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(storageAccountId, '2024-01-01').keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${environment().suffixes.storage};AccountKey=${listKeys(storageAccountId, '2024-01-01').keys[0].value}'
        }
        {
          // Own content share — keeps this app isolated from the enrichment app.
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower('${namePrefix}-func-checktudo-brs')
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
          value: '~22'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnString
        }
        {
          // CheckTudo credentials live in Key Vault; the function reads them via
          // its Managed Identity. Seed checktudo-username / checktudo-password
          // and grant this MI "Key Vault Secrets User".
          name: 'KEYVAULT_URL'
          value: keyVaultUri
        }
      ]
    }
  }
}

output functionAppId       string = functionApp.id
output functionAppName     string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
@description('System-assigned Managed Identity principalId — grant Key Vault Secrets User in keyvault.bicep.')
output functionPrincipalId string = functionApp.identity.principalId
