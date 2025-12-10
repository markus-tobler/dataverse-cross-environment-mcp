targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

param dataverseMcpExists bool

@description('Id of the user or app to assign application roles')
param principalId string

@description('Azure AD Tenant ID for OAuth authentication (required)')
param azureAdTenantId string

@description('Azure AD Client ID for OAuth authentication (required)')
param azureAdClientId string

@description('Session secret for express-session (required)')
@secure()
param sessionSecret string

@description('Dataverse URL (e.g., https://yourorg.crm.dynamics.com) (required)')
param dataverseUrl string

@description('Dataverse API Version (default: v9.2)')
param dataverseApiVersion string = 'v9.2'

// Tags that should be applied to all resources.
// 
// Note that 'azd-service-name' tags should be applied separately to service host resources.
// Example usage:
//   tags: union(tags, { 'azd-service-name': <service name in azure.yaml> })
var tags = {
  'azd-env-name': environmentName
}

// Organize resources in a resource group
resource rg 'Microsoft.Resources/resourceGroups@2021-04-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  scope: rg
  name: 'resources'
  params: {
    location: location
    tags: tags
    principalId: principalId
    dataverseMcpExists: dataverseMcpExists
    azureAdTenantId: azureAdTenantId
    azureAdClientId: azureAdClientId
    sessionSecret: sessionSecret
    dataverseUrl: dataverseUrl
    dataverseApiVersion: dataverseApiVersion
  }
}
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_RESOURCE_DATAVERSE_MCP_ID string = resources.outputs.AZURE_RESOURCE_DATAVERSE_MCP_ID
