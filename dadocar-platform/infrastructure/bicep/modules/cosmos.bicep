// ─────────────────────────────────────────────────────────────────────────────
// cosmos.bicep
// Cosmos DB (NoSQL API) — provisioned 400 RU/s shared at database level,
// single region (Brazil South), no zone redundancy in dev.
//
// Five containers:
//   vehicles       /placa          TTL 2592000 (30d)
//   fipe_prices    /codigoFipe     TTL -1 (manual)
//   vehicle_index  /lookup_key     TTL 2592000 (30d)
//   customers      /customer_id    TTL -1 (manual)
//   secrets        /secret_name    TTL -1 (manual)
//
// Cost (idle dev volumes):
//   Cosmos 400 RU/s shared: ~R$120/month
//
// Data-plane RBAC: the Function App's Managed Identity gets the built-in
// Cosmos DB Built-in Data Contributor role (00000000-0000-0000-0000-000000000002).
// NOTE: Cosmos data RBAC uses a Cosmos-specific resource type
// (Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments), not the
// general Microsoft.Authorization/roleAssignments.
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Suffix from uniqueString(resourceGroup().id) to avoid global-name collisions')
param uniqueSuffix string

@description('Function App Managed Identity principal ID — gets Cosmos Data Contributor')
param functionPrincipalId string

@description('Compact (no-hyphen, lowercase) name prefix, e.g. dadocardev or placas360prd')
param compactPrefix string

// Cosmos account names: 3-44 chars, lowercase alphanumerics + hyphens.
// Compact form: <compactPrefix>cosbrs + 4-char suffix (e.g. placas360prdcosbrs####).
var cosmosName = '${compactPrefix}cosbrs${uniqueSuffix}'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: cosmosName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: []
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    // Disable local-auth keys so the only path is RBAC + Managed Identity.
    // This is a security best practice that costs nothing.
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    networkAclBypass: 'AzureServices'
  }
}

// ─── Database: 400 RU/s shared across containers.
resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmosAccount
  name: 'dadocar'
  properties: {
    resource: {
      id: 'dadocar'
    }
    options: {
      throughput: 400
    }
  }
}

// ─── Containers. Each declared explicitly for clarity over a loop.
resource containerVehicles 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'vehicles'
  properties: {
    resource: {
      id: 'vehicles'
      partitionKey: {
        paths: [ '/placa' ]
        kind: 'Hash'
      }
      defaultTtl: 2592000
    }
  }
}

resource containerFipePrices 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'fipe_prices'
  properties: {
    resource: {
      id: 'fipe_prices'
      partitionKey: {
        paths: [ '/codigoFipe' ]
        kind: 'Hash'
      }
      defaultTtl: -1
    }
  }
}

resource containerVehicleIndex 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'vehicle_index'
  properties: {
    resource: {
      id: 'vehicle_index'
      partitionKey: {
        paths: [ '/lookup_key' ]
        kind: 'Hash'
      }
      defaultTtl: 2592000
    }
  }
}

resource containerCustomers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'customers'
  properties: {
    resource: {
      id: 'customers'
      partitionKey: {
        paths: [ '/customer_id' ]
        kind: 'Hash'
      }
      defaultTtl: -1
    }
  }
}

resource containerSecrets 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: cosmosDb
  name: 'secrets'
  properties: {
    resource: {
      id: 'secrets'
      partitionKey: {
        paths: [ '/secret_name' ]
        kind: 'Hash'
      }
      defaultTtl: -1
    }
  }
}

// ─── Cosmos Data Contributor for the Function App's Managed Identity.
// Built-in role ID 00000000-0000-0000-0000-000000000002 is the Cosmos DB
// Built-in Data Contributor. This is a Cosmos-specific role assignment.
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionPrincipalId, 'cosmos-data-contributor')
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: functionPrincipalId
    scope: cosmosAccount.id
  }
}

output cosmosAccountId   string = cosmosAccount.id
output cosmosAccountName string = cosmosAccount.name
output cosmosEndpoint    string = cosmosAccount.properties.documentEndpoint
output cosmosDatabaseId  string = cosmosDb.id
