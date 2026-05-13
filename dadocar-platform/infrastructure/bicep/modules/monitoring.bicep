// ─────────────────────────────────────────────────────────────────────────────
// monitoring.bicep
// Log Analytics workspace + workspace-based Application Insights.
//
// Cost (idle dev volumes):
//   Log Analytics + App Insights: ~R$0-20/month
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Resource name prefix, e.g. dadocar-dev')
param namePrefix string

@description('Azure region')
param location string

@description('Common tags applied to every resource')
param tags object

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-log-brs'
  location: location
  tags: tags
  properties: {
    sku: {
      // PerGB2018 is the modern Pay-as-you-go SKU in this API version.
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi-brs'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    // Workspace-based instance — required since 2025; classic AI is retired.
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output logAnalyticsId           string = logAnalytics.id
output logAnalyticsName         string = logAnalytics.name
output appInsightsId            string = appInsights.id
output appInsightsName          string = appInsights.name
output appInsightsConnString    string = appInsights.properties.ConnectionString
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey
