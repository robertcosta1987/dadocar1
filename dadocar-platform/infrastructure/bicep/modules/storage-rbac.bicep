// ─────────────────────────────────────────────────────────────────────────────
// storage-rbac.bicep
// Post-pass: grants the Function App's Managed Identity the Storage Blob
// Data Contributor role on the Storage Account.
//
// Exists as a separate module to break the storage ↔ functions cycle:
//   - functions.bicep needs storageName/id  →  storage.bicep is first
//   - the role assignment needs functionMI  →  functions.bicep is first
// Cleanest fix is a third pass that consumes both outputs.
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Storage account name to scope the role assignment')
param storageAccountName string

@description('Function App Managed Identity principal ID')
param functionPrincipalId string

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

resource roleBlobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  // Built-in role: Storage Blob Data Contributor — ba92f5b4-2d11-453d-a403-e96b0029c9fe.
  name: guid(storage.id, functionPrincipalId, 'blob-data-contributor')
  scope: storage
  properties: {
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}
