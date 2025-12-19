# Manual Deployment Guide - Dataverse MCP Server

This guide provides step-by-step instructions for manually provisioning and deploying the Dataverse MCP Server to an existing Azure resource group.

## Prerequisites

### Required Tools

- [Azure CLI](https://docs.microsoft.com/cli/azure/install-azure-cli) (`az`)
- [Docker](https://docs.docker.com/get-docker/) (for building container images)
- [Node.js 18+](https://nodejs.org/) (for local build)
- [PowerShell](https://docs.microsoft.com/powershell/scripting/install/installing-powershell) (optional, for automation)

### Required Permissions

- **On Subscription**:
  - Permission to register resource providers (one-time, can be done by admin)
- **On Resource Group**:
  - **Owner** role (includes Contributor + User Access Administrator)
  - OR **Contributor** + **User Access Administrator** roles combined

### Azure Entra ID Application Registration

You'll need an App Registration for OAuth authentication:

1. Go to [Azure Portal](https://portal.azure.com) → Entra ID → App Registrations
2. Create a new registration or use an existing one
3. Note down:
   - **Application (client) ID**
   - **Directory (tenant) ID**
4. Under "Certificates & secrets", create a **client secret** (if using OBO flow)
5. Under "API permissions", add required Dataverse permissions
6. Under "Authentication", add redirect URIs if needed

---

## Step 1: Prepare Your Environment

### 1.1 Login to Azure

```powershell
az login
az account set --subscription <your-subscription-id>
```

### 1.2 Set Variables

```powershell
# Replace these values with your own
$RESOURCE_GROUP = "isol-p1-rg-mcp-01"  # Your existing resource group
$LOCATION = "switzerlandnorth"         # Must match resource group location
$ENV_NAME = "dataverse-mcp"            # Environment name (used for tagging)

# Entra ID / OAuth Configuration
$TENANT_ID = "your-tenant-id"
$CLIENT_ID = "your-client-id"
$CLIENT_SECRET = "your-client-secret"  # If using OBO authentication
$SESSION_SECRET = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})  # Generate random session secret

# Dataverse Configuration
$DATAVERSE_URL = "https://yourorg.crm.dynamics.com"
$DATAVERSE_API_VERSION = "v9.2"

# Your user/service principal ID (for role assignments)
$PRINCIPAL_ID = az ad signed-in-user show --query id -o tsv
```

### 1.3 Register Required Resource Providers

**(Requires subscription-level permissions - may need admin assistance)**

```powershell
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights
az provider register --namespace Microsoft.ContainerRegistry
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.ManagedIdentity

# Wait for registration to complete (takes a few minutes)
az provider show --namespace Microsoft.App --query "registrationState"
```

---

## Step 2: Deploy Infrastructure Using Bicep

### 2.1 Navigate to Your Repository

```powershell
Set-Location c:\repo\mtob128\dataverse-cross-environment-mcp
```

### 2.2 Create Parameters File

Create a file `infra/manual-deploy.parameters.json`:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "environmentName": {
      "value": "dataverse-mcp"
    },
    "dataverseMcpExists": {
      "value": false
    },
    "principalId": {
      "value": "<your-principal-id>"
    },
    "azureAdTenantId": {
      "value": "<your-tenant-id>"
    },
    "azureAdClientId": {
      "value": "<your-client-id>"
    },
    "sessionSecret": {
      "value": "<your-session-secret>"
    },
    "dataverseUrl": {
      "value": "https://yourorg.crm.dynamics.com"
    },
    "dataverseApiVersion": {
      "value": "v9.2"
    }
  }
}
```

### 2.3 Deploy Infrastructure

```powershell
az deployment group create `
  --resource-group $RESOURCE_GROUP `
  --template-file infra/main.bicep `
  --parameters infra/manual-deploy.parameters.json
```

### 2.4 Capture Outputs

```powershell
# Get the container registry login server
$ACR_NAME = az deployment group show `
  --resource-group $RESOURCE_GROUP `
  --name main `
  --query "properties.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT.value" -o tsv

Write-Host "Container Registry: $ACR_NAME"
```

---

## Step 3: Build and Push Container Image

### 3.1 Build the Docker Image Locally

```powershell
# From the repository root
docker build -t dataverse-mcp:latest .
```

### 3.2 Login to Azure Container Registry

```powershell
# Get registry name (without .azurecr.io suffix)
$ACR_REGISTRY_NAME = $ACR_NAME -replace '\.azurecr\.io$',''

# Login using Azure CLI credentials
az acr login --name $ACR_REGISTRY_NAME
```

### 3.3 Tag and Push the Image

```powershell
docker tag dataverse-mcp:latest "$ACR_NAME/dataverse-mcp:latest"
docker push "$ACR_NAME/dataverse-mcp:latest"
```

---

## Step 4: Update Container App with New Image

### 4.1 Get Container App Name

```powershell
$CONTAINER_APP_NAME = "dataverse-mcp"
```

### 4.2 Update the Container App

```powershell
az containerapp update `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --image "$ACR_NAME/dataverse-mcp:latest"
```

---

## Step 5: Verify Deployment

### 5.1 Check Container App Status

```powershell
az containerapp show `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --query "properties.provisioningState"
```

### 5.2 Get Application URL

```powershell
$APP_URL = az containerapp show `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host "Application URL: https://$APP_URL"
```

### 5.3 Test Health Endpoint

```powershell
Invoke-RestMethod -Uri "https://$APP_URL/health"
```

Expected response:

```json
{ "status": "ok" }
```

### 5.4 View Application Logs

```powershell
az containerapp logs show `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --follow
```

---

## Step 6: Configure for Production Use

### 6.1 Update Environment Variables (if needed)

```powershell
az containerapp update `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --set-env-vars `
    "DATAVERSE_URL=$DATAVERSE_URL" `
    "DATAVERSE_API_VERSION=$DATAVERSE_API_VERSION" `
    "AZURE_AD_TENANT_ID=$TENANT_ID" `
    "AZURE_AD_CLIENT_ID=$CLIENT_ID"
```

### 6.2 Update Secrets (if needed)

```powershell
az containerapp secret set `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --secrets "session-secret=$SESSION_SECRET"
```

### 6.3 Scale Configuration

```powershell
az containerapp update `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --min-replicas 1 `
  --max-replicas 10
```

---

## Updating the Application

### Quick Update (Code Changes Only)

```powershell
# 1. Build new image
docker build -t dataverse-mcp:latest .

# 2. Tag with version
$VERSION = Get-Date -Format "yyyyMMdd-HHmmss"
docker tag dataverse-mcp:latest "$ACR_NAME/dataverse-mcp:$VERSION"
docker tag dataverse-mcp:latest "$ACR_NAME/dataverse-mcp:latest"

# 3. Push to ACR
az acr login --name $ACR_REGISTRY_NAME
docker push "$ACR_NAME/dataverse-mcp:$VERSION"
docker push "$ACR_NAME/dataverse-mcp:latest"

# 4. Update container app
az containerapp update `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --image "$ACR_NAME/dataverse-mcp:$VERSION"
```

### Infrastructure Changes

```powershell
# Update infrastructure via Bicep
az deployment group create `
  --resource-group $RESOURCE_GROUP `
  --template-file infra/main.bicep `
  --parameters infra/manual-deploy.parameters.json
```

---

## Troubleshooting

### Check Resource Provider Registration Status

```powershell
az provider show --namespace Microsoft.App --query "registrationState"
az provider show --namespace Microsoft.OperationalInsights --query "registrationState"
az provider show --namespace Microsoft.ContainerRegistry --query "registrationState"
```

### View Container App Revision History

```powershell
az containerapp revision list `
  --resource-group $RESOURCE_GROUP `
  --name $CONTAINER_APP_NAME `
  --output table
```

### Check Role Assignments

```powershell
# View role assignments on the resource group
az role assignment list `
  --resource-group $RESOURCE_GROUP `
  --assignee $PRINCIPAL_ID `
  --output table
```

### Common Error: "AuthorizationFailed for roleAssignments"

**Solution**: You need the **Owner** role or **User Access Administrator** role on the resource group.

```powershell
# Request admin to grant Owner role
az role assignment create `
  --role "Owner" `
  --assignee $PRINCIPAL_ID `
  --resource-group $RESOURCE_GROUP
```

### Common Error: "MissingSubscriptionRegistration"

**Solution**: Resource providers need to be registered (see Step 1.3)

### Common Error: "ResourceDeploymentFailure" or Resources in Failed State

If a deployment times out or fails, resources may be left in a failed state. Clean them up before retrying:

```powershell
# Delete failed container app
az containerapp delete --resource-group $RESOURCE_GROUP --name dataverse-mcp --yes 2>$null

# Delete failed deployments
az deployment group delete --resource-group $RESOURCE_GROUP --name dataverse-mcp-fetch-image 2>$null
az deployment group delete --resource-group $RESOURCE_GROUP --name dataverseMcp 2>$null
az deployment group delete --resource-group $RESOURCE_GROUP --name resources 2>$null

# If using azd, reset the resource exists flag
azd env set SERVICE_DATAVERSE_MCP_RESOURCE_EXISTS false

# Clear any cached deployment state
Remove-Item .azure\*\*.env.backup -Force -ErrorAction SilentlyContinue

# Retry the deployment
azd up
```

Or delete all resources and start completely fresh:

```powershell
# List all resources to verify before deleting
az resource list --resource-group $RESOURCE_GROUP --output table

# Delete all resources (WARNING: This deletes everything in the resource group)
az resource list --resource-group $RESOURCE_GROUP --query "[].id" -o tsv | ForEach-Object {
    az resource delete --ids $_ --verbose
}
```

### Deployment Name in Section 2.4

The deployment name in step 2.4 should be `main` by default. If it's different, check with:

```powershell
# List all deployments to find the correct name
az deployment group list --resource-group $RESOURCE_GROUP --output table

# Use the most recent deployment name
$DEPLOYMENT_NAME = az deployment group list --resource-group $RESOURCE_GROUP --query "[0].name" -o tsv

# Get outputs using the correct deployment name
$ACR_NAME = az deployment group show `
  --resource-group $RESOURCE_GROUP `
  --name $DEPLOYMENT_NAME `
  --query "properties.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT.value" -o tsv
```

---

## Clean Up

### Delete All Deployed Resources

```powershell
# Get all resources in the resource group created by this deployment
az resource list `
  --resource-group $RESOURCE_GROUP `
  --tag azd-env-name=$ENV_NAME `
  --output table

# Delete resources (one by one or use --ids)
az containerapp delete --resource-group $RESOURCE_GROUP --name dataverse-mcp --yes
az containerregistry delete --resource-group $RESOURCE_GROUP --name $ACR_REGISTRY_NAME --yes
# ... continue for other resources
```

**Note**: If you want to delete the entire resource group:

```powershell
az group delete --name $RESOURCE_GROUP --yes --no-wait
```

---

## Next Steps

- Review the [Installation Guide](./INSTALLATION_GUIDE.md) for configuring MCP clients
- Set up monitoring and alerts in Application Insights
- Configure custom domains and SSL certificates
- Implement CI/CD pipelines for automated deployments

## Support

For issues and questions, see [SUPPORT.md](./SUPPORT.md)
