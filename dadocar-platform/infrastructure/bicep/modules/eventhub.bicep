// ─────────────────────────────────────────────────────────────────────────────
// eventhub.bicep
// Event Hub namespace (Basic, 1 TU) + single hub `query-events`
// (1 partition, 1-day retention).
//
// Cost (idle dev volumes):
//   Event Hub Basic 1 TU: ~R$60/month
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Resource name prefix, e.g. dadocar-dev')
param namePrefix string

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Function App Managed Identity principal ID — gets Azure Event Hubs Data Sender at namespace scope')
param functionPrincipalId string

resource eventHubNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = {
  name: '${namePrefix}-evhns-brs'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    // Basic tier doesn't support zone redundancy, auto-inflate, Kafka, etc.
    isAutoInflateEnabled: false
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = {
  parent: eventHubNamespace
  name: 'query-events'
  properties: {
    partitionCount: 1
    // Basic tier caps retention at 1 day, which is the value the brief asks for.
    retentionDescription: {
      cleanupPolicy: 'Delete'
      retentionTimeInHours: 24
    }
  }
}

// ─── Azure Event Hubs Data Sender for the Function App's Managed Identity.
// Built-in role ID: 2b629674-e913-4c01-ae53-ef4638d8f975.
resource roleEventHubsSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(eventHubNamespace.id, functionPrincipalId, 'eventhubs-data-sender')
  scope: eventHubNamespace
  properties: {
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '2b629674-e913-4c01-ae53-ef4638d8f975')
  }
}

output eventHubNamespaceId   string = eventHubNamespace.id
output eventHubNamespaceName string = eventHubNamespace.name
output eventHubName          string = eventHub.name
