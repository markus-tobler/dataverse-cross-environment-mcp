targetScope = 'resourceGroup'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string = resourceGroup().location

param dataverseMcpExists bool

@description('Skip automatic role assignments (use when you have Owner permissions and will configure manually)')
param skipRoleAssignments bool = false

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

module resources 'resources.bicep' = {
  name: 'resources'
  params: {
    location: location
    tags: tags
    principalId: principalId
    dataverseMcpExists: dataverseMcpExists
    skipRoleAssignments: skipRoleAssignments
    azureAdTenantId: azureAdTenantId
    azureAdClientId: azureAdClientId
    sessionSecret: sessionSecret
    dataverseUrl: dataverseUrl
    dataverseApiVersion: dataverseApiVersion
  }
}
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_RESOURCE_DATAVERSE_MCP_ID string = resources.outputs.AZURE_RESOURCE_DATAVERSE_MCP_ID
