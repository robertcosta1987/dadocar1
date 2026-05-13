// ─────────────────────────────────────────────────────────────────────────────
// apim.bicep
// API Management — Consumption tier. Empty: no products, no APIs, no
// policies. The DEV MVP only provisions the instance so downstream work can
// import APIs into it later.
//
// Cost (idle dev volumes):
//   APIM Consumption: ~R$0 idle (pay per call, ~R$18/million calls)
//
// NOTE: Consumption tier in Brazil South provisions in ~5-10 min — much
// faster than Developer/Standard tiers, which take 30-45 min.
// ─────────────────────────────────────────────────────────────────────────────
targetScope = 'resourceGroup'

@description('Resource name prefix, e.g. dadocar-dev')
param namePrefix string

@description('Azure region')
param location string

@description('Common tags')
param tags object

@description('Publisher email shown in the developer portal')
param publisherEmail string

@description('Publisher (organization) name shown in the developer portal')
param publisherName string

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: '${namePrefix}-apim-brs'
  location: location
  tags: tags
  sku: {
    // Consumption tier requires capacity = 0.
    name: 'Consumption'
    capacity: 0
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName:  publisherName
    publicNetworkAccess: 'Enabled'
  }
}

output apimId            string = apim.id
output apimName          string = apim.name
@description('Default gateway URL (https://<apim>.azure-api.net)')
output apimGatewayUrl    string = apim.properties.gatewayUrl
