@description('The location used for all deployed resources')
param location string = resourceGroup().location

@description('Tags that will be applied to all resources')
param tags object = {}

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

@description('Skip automatic role assignments (use when you have Owner permissions and will configure manually)')
param skipRoleAssignments bool = false

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = uniqueString(subscription().id, resourceGroup().id, location)

// Only include OAuth secrets if values are provided
var hasOAuthConfig = !empty(sessionSecret)

// Base environment variables
var baseEnvVars = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: monitoring.outputs.applicationInsightsConnectionString
  }
  {
    name: 'AZURE_CLIENT_ID'
    value: dataverseMcpIdentity.outputs.clientId
  }
  {
    name: 'PORT'
    value: '3000'
  }
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]

// OAuth environment variables (only added if OAuth is configured)
var oauthEnvVars = hasOAuthConfig
  ? [
      {
        name: 'AZURE_AD_INSTANCE'
        value: environment().authentication.loginEndpoint
      }
      {
        name: 'AZURE_AD_TENANT_ID'
        value: azureAdTenantId
      }
      {
        name: 'AZURE_AD_CLIENT_ID'
        value: azureAdClientId
      }
      {
        name: 'AZURE_AD_AUDIENCE'
        value: azureAdClientId
      }
      {
        name: 'SESSION_SECRET'
        secretRef: 'session-secret'
      }
      {
        name: 'DATAVERSE_URL'
        value: dataverseUrl
      }
      {
        name: 'DATAVERSE_API_VERSION'
        value: dataverseApiVersion
      }
    ]
  : []

// Combine base and OAuth environment variables
var allEnvVars = concat(baseEnvVars, oauthEnvVars)

// Monitor application with Azure Monitor
module monitoring 'br/public:avm/ptn/azd/monitoring:0.1.0' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceToken}'
    applicationInsightsDashboardName: '${abbrs.portalDashboards}${resourceToken}'
    location: location
    tags: tags
  }
}
// Container registry
module containerRegistry 'br/public:avm/res/container-registry/registry:0.1.1' = {
  name: 'registry'
  params: {
    name: '${abbrs.containerRegistryRegistries}${resourceToken}'
    location: location
    tags: tags
    publicNetworkAccess: 'Enabled'
    roleAssignments: skipRoleAssignments ? [] : [
      {
        principalId: dataverseMcpIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: subscriptionResourceId(
          'Microsoft.Authorization/roleDefinitions',
          '7f951dda-4ed3-4680-a7ca-43fe172d538d'
        )
      }
    ]
  }
}

// Container apps environment
module containerAppsEnvironment 'br/public:avm/res/app/managed-environment:0.4.5' = {
  name: 'container-apps-environment'
  params: {
    logAnalyticsWorkspaceResourceId: monitoring.outputs.logAnalyticsWorkspaceResourceId
    name: '${abbrs.appManagedEnvironments}${resourceToken}'
    location: location
    zoneRedundant: false
  }
}

module dataverseMcpIdentity 'br/public:avm/res/managed-identity/user-assigned-identity:0.2.1' = {
  name: 'dataverseMcpIdentity'
  params: {
    name: '${abbrs.managedIdentityUserAssignedIdentities}dataverse-mcp-${resourceToken}'
    location: location
  }
}
module dataverseMcpFetchLatestImage './modules/fetch-container-image.bicep' = {
  name: 'dataverse-mcp-fetch-image'
  params: {
    exists: dataverseMcpExists
    name: 'dataverse-mcp'
  }
}

module dataverseMcp 'br/public:avm/res/app/container-app:0.8.0' = {
  name: 'dataverseMcp'
  params: {
    name: 'dataverse-mcp'
    ingressTargetPort: 3000
    scaleMinReplicas: 1
    scaleMaxReplicas: 10
    secrets: {
      secureList: hasOAuthConfig
        ? [
            {
              name: 'session-secret'
              value: sessionSecret
            }
          ]
        : []
    }
    containers: [
      {
        image: dataverseMcpFetchLatestImage.outputs.?containers[?0].?image ?? 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
        name: 'main'
        resources: {
          cpu: json('0.5')
          memory: '1.0Gi'
        }
        env: allEnvVars
      }
    ]
    managedIdentities: {
      systemAssigned: false
      userAssignedResourceIds: [dataverseMcpIdentity.outputs.resourceId]
    }
    registries: [
      {
        server: containerRegistry.outputs.loginServer
        identity: dataverseMcpIdentity.outputs.resourceId
      }
    ]
    environmentResourceId: containerAppsEnvironment.outputs.resourceId
    location: location
    tags: union(tags, { 'azd-service-name': 'dataverse-mcp' })
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_RESOURCE_DATAVERSE_MCP_ID string = dataverseMcp.outputs.resourceId
