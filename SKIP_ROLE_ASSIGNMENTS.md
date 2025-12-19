# Deploying with Skip Role Assignments

If you're deploying to an existing resource group where:

- ✅ Resource providers are already registered on the subscription
- ✅ You have **Owner** role on the resource group
- ❌ You're still getting role assignment errors during deployment

You can skip automatic role assignments and configure them manually after deployment.

## Why This Helps

The Bicep deployment tries to automatically assign the **AcrPull** role to the Container App's managed identity so it can pull images from Azure Container Registry. Even with Owner permissions, this can sometimes fail due to:

- Azure Policy restrictions
- Custom RBAC configurations
- Timing issues with Azure Resource Manager

## How to Deploy with Skip Role Assignments

### Using azd

```powershell
# Set the environment variable to skip role assignments
azd env set SKIP_ROLE_ASSIGNMENTS true

# Deploy normally
azd up
```

### Manual Deployment

In your `infra/manual-deploy.parameters.json`, set:

```json
{
  "skipRoleAssignments": {
    "value": true
  }
}
```

Then deploy:

```powershell
az deployment group create `
  --resource-group $RESOURCE_GROUP `
  --template-file infra/main.bicep `
  --parameters infra/manual-deploy.parameters.json
```

## Post-Deployment: Manual Role Assignment

After deployment completes, you need to manually grant the Container App's managed identity permission to pull from ACR:

### Step 1: Get the Managed Identity Principal ID

```powershell
$RESOURCE_GROUP = "your-resource-group-name"

# Get the managed identity principal ID
$IDENTITY_PRINCIPAL_ID = az identity show `
  --resource-group $RESOURCE_GROUP `
  --name (az identity list --resource-group $RESOURCE_GROUP --query "[?contains(name, 'dataverse-mcp')].name" -o tsv) `
  --query principalId -o tsv

Write-Host "Managed Identity Principal ID: $IDENTITY_PRINCIPAL_ID"
```

### Step 2: Get the Container Registry Name

```powershell
$ACR_NAME = az acr list `
  --resource-group $RESOURCE_GROUP `
  --query "[0].name" -o tsv

Write-Host "Container Registry Name: $ACR_NAME"
```

### Step 3: Assign AcrPull Role

```powershell
# Assign the AcrPull role to the managed identity
az role assignment create `
  --assignee $IDENTITY_PRINCIPAL_ID `
  --role "AcrPull" `
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

Write-Host "✅ Role assignment completed successfully"
```

### Step 4: Verify the Assignment

```powershell
# List role assignments on the container registry
az role assignment list `
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME" `
  --output table
```

You should see the managed identity with the **AcrPull** role.

### Step 5: Restart the Container App

```powershell
# Restart to pick up the new permissions
az containerapp revision restart `
  --resource-group $RESOURCE_GROUP `
  --name dataverse-mcp `
  --revision (az containerapp revision list --resource-group $RESOURCE_GROUP --name dataverse-mcp --query "[0].name" -o tsv)
```

## Complete Script

Here's a complete PowerShell script to handle the manual role assignment:

```powershell
# Configuration
$RESOURCE_GROUP = "your-resource-group-name"

# Get managed identity
$IDENTITY_NAME = az identity list `
  --resource-group $RESOURCE_GROUP `
  --query "[?contains(name, 'dataverse-mcp')].name" -o tsv

$IDENTITY_PRINCIPAL_ID = az identity show `
  --resource-group $RESOURCE_GROUP `
  --name $IDENTITY_NAME `
  --query principalId -o tsv

Write-Host "Managed Identity: $IDENTITY_NAME"
Write-Host "Principal ID: $IDENTITY_PRINCIPAL_ID"

# Get container registry
$ACR_NAME = az acr list `
  --resource-group $RESOURCE_GROUP `
  --query "[0].name" -o tsv

Write-Host "Container Registry: $ACR_NAME"

# Get subscription ID
$SUBSCRIPTION_ID = az account show --query id -o tsv

# Assign role
Write-Host "Assigning AcrPull role..."
az role assignment create `
  --assignee $IDENTITY_PRINCIPAL_ID `
  --role "AcrPull" `
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

Write-Host "✅ Role assignment completed"

# Verify
Write-Host "`nVerifying role assignment..."
az role assignment list `
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME" `
  --assignee $IDENTITY_PRINCIPAL_ID `
  --output table

# Restart container app
Write-Host "`nRestarting container app..."
$REVISION_NAME = az containerapp revision list `
  --resource-group $RESOURCE_GROUP `
  --name dataverse-mcp `
  --query "[0].name" -o tsv

az containerapp revision restart `
  --resource-group $RESOURCE_GROUP `
  --name dataverse-mcp `
  --revision $REVISION_NAME

Write-Host "✅ Container app restarted"
```

## Alternative: Enable Admin User on ACR

If role assignments continue to fail, you can temporarily use ACR admin credentials (not recommended for production):

```powershell
# Enable admin user
az acr update --name $ACR_NAME --admin-enabled true

# Get credentials
$ACR_USERNAME = az acr credential show --name $ACR_NAME --query username -o tsv
$ACR_PASSWORD = az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv

# Update container app with admin credentials
az containerapp update `
  --resource-group $RESOURCE_GROUP `
  --name dataverse-mcp `
  --registry-server "$ACR_NAME.azurecr.io" `
  --registry-username $ACR_USERNAME `
  --registry-password $ACR_PASSWORD
```

⚠️ **Warning**: Admin credentials should only be used for testing. For production, use managed identity with AcrPull role.

## Troubleshooting

### "The role assignment already exists"

This is fine - it means the role was already assigned. Continue with the deployment.

### Container App fails to pull image

Check the logs:

```powershell
az containerapp logs show `
  --resource-group $RESOURCE_GROUP `
  --name dataverse-mcp `
  --follow
```

If you see "unauthorized: authentication required", the role assignment hasn't propagated yet. Wait 1-2 minutes and restart the container app.

### Check Current Role Assignments

```powershell
# On the managed identity
az role assignment list --assignee $IDENTITY_PRINCIPAL_ID --output table

# On the container registry
az role assignment list `
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME" `
  --output table
```

## When to Use This Approach

✅ Use skip role assignments when:

- You have Owner permissions on the resource group
- Automatic role assignments fail with authorization errors
- Your organization has custom RBAC policies
- You prefer explicit control over role assignments

❌ Don't use skip role assignments if:

- You have automated CI/CD pipelines (role assignments should be in IaC)
- You don't have permissions to create role assignments manually
- You're deploying to multiple environments (automation is better)
