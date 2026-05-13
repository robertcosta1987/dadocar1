// ─────────────────────────────────────────────────────────────────────────────
// storage.bicep
// Storage Account with hierarchical namespace (Data Lake Gen2). Hosts:
//   - query-log     (private) — Data Lake filesystem for query event archive
//   - token-lock    (private) — distributed lock blobs for Infocar token mgmt
//   - function-host (private) — required by the Function App's runtime
//
// Cost (idle dev volumes):
//   Storage LRS Hot: ~R$5-10/month
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Suffix from uniqueString(resourceGroup().id) to avoid global-name collisions')
param uniqueSuffix string

// Storage names: 3-24 chars, lowercase alphanumerics only.
// Compact form per the brief: dadocardevstbrs + 4-char suffix.
var storageName = 'dadocardevstbrs${uniqueSuffix}'

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: storageName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    // Hierarchical namespace turns this into Data Lake Gen2. Required by
    // the brief for `query-log`. With HNS on, all containers in this account
    // are addressable as filesystems via the dfs endpoint as well.
    isHnsEnabled: true
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: false
    }
  }
}

// Private containers.
resource containerQueryLog 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'query-log'
  properties: {
    publicAccess: 'None'
  }
}

resource containerTokenLock 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'token-lock'
  properties: {
    publicAccess: 'None'
  }
}

resource containerFunctionHost 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'function-host'
  properties: {
    publicAccess: 'None'
  }
}

// Storage Blob Data Contributor role assignment for the Function App's
// Managed Identity lives in main.bicep (as `storageRbac` module) to break
// the storage ↔ functions cycle: functions needs storageName/id; the role
// assignment needs functionMI. Cleanest fix is a separate post-pass.

output storageId        string = storage.id
output storageName      string = storage.name
output blobEndpoint     string = storage.properties.primaryEndpoints.blob
output dfsEndpoint      string = storage.properties.primaryEndpoints.dfs
