// ─────────────────────────────────────────────────────────────────────────────
// keyvault.bicep
// Key Vault with RBAC authorization (no access policies). Purge protection
// disabled so dev can be torn down + recreated freely.
//
// Cost (idle dev volumes):
//   Key Vault Standard: ~R$0 (negligible at dev operation volume)
//
// Note: secrets (infocar-id-key, infocar-username, infocar-password) are
// NOT written by Bicep. They're added manually via `az keyvault secret set`
// once Infocar credentials are activated. See docs/dev-setup.md.
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Tenant ID of the Service Principal running the deployment')
param tenantId string

@description('Service Principal object ID — receives Key Vault Secrets Officer to seed secrets manually later')
param deployerPrincipalId string

@description('Function App Managed Identity principal ID — receives Key Vault Secrets User to read at runtime')
param functionPrincipalId string

@description('Suffix derived from resourceGroup().id to avoid global-name collisions')
param uniqueSuffix string

@description('Compact (no-hyphen, lowercase) name prefix, e.g. dadocardev or placas360prd')
param compactPrefix string

// Globally unique. KV name must be 3-24 chars, alphanumerics + hyphens.
// Compact form: <compactPrefix>kvbrs + 4-char suffix (e.g. placas360prdkvbrs####).
var kvName = '${compactPrefix}kvbrs${uniqueSuffix}'

resource keyVault 'Microsoft.KeyVault/vaults@2024-04-01-preview' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    // Purge protection intentionally disabled in dev. With purge protection
    // OFF, a deleted-and-purged vault frees the name immediately, which is
    // what we want for an environment that gets recreated often.
    enablePurgeProtection: null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

// ─── RBAC: Secrets Officer for the deployer (so the user/SP can later seed
// secrets via az keyvault secret set without re-deploying Bicep).
// Built-in role: Key Vault Secrets Officer (b86a8fe4-44ce-4948-aee5-eccb2c155cd7)
resource roleSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerPrincipalId, 'secrets-officer')
  scope: keyVault
  properties: {
    principalId: deployerPrincipalId
    // The deployer SP usually has a "ServicePrincipal" principal type; Azure
    // accepts the role assignment without an explicit type here.
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
  }
}

// ─── RBAC: Secrets User for the Function App's Managed Identity.
// Built-in role: Key Vault Secrets User (4633458b-17de-408a-b874-0445c86b69e6)
resource roleSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionPrincipalId, 'secrets-user')
  scope: keyVault
  properties: {
    principalId: functionPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

output keyVaultId   string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri  string = keyVault.properties.vaultUri
