# Installation Guide

This guide provides step-by-step instructions for registering and installing the Dataverse MCP Server for use with Microsoft Copilot Studio.

## Overview

The installation process consists of four main steps:

1. Register the MCP Server App in Entra ID
2. Deploy the server to Azure using `azd up`
3. Register the MCP Server Connector App in Entra ID
4. Create a Custom Connector in Power Platform

## Prerequisites

- Azure subscription with appropriate permissions
- Azure Developer CLI (`azd`) installed ([Install Guide](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd))
- Docker installed and running
- Microsoft Dataverse environment
- Power Platform environment with Copilot Studio access
- Permissions to create app registrations in Entra ID

## Step 1: Register the MCP Server App in Entra ID

The MCP Server App is the backend service that will run in Azure Container Apps and access Dataverse on behalf of users.

### 1.1 Create App Registration

1. Navigate to [Azure Portal](https://portal.azure.com)
2. Go to **Microsoft Entra ID** > **App registrations**
3. Click **New registration**
4. Configure the registration:
   - **Name**: `Dataverse MCP Server`
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   - **Redirect URI**: Leave blank for now (will be configured after deployment)
5. Click **Register**

### 1.2 Note Registration Details

After registration, on the **Overview** page, copy and save:

- **Application (client) ID**
- **Directory (tenant) ID**

> _Note:_ This setup uses a User-Assigned Managed Identity for secure, secret-less authentication in Azure. After deploying the infrastructure, you will configure a **Federated Credential** to establish trust between your App Registration and the Managed Identity running in Azure.

### 1.3 Configure API Permissions

The MCP Server needs permission to access Dataverse on behalf of users.

1. In your app registration, go to **API permissions**
2. Click **Add a permission**
3. Select **Dynamics CRM** (or search for "Dynamics CRM")
4. Choose **Delegated permissions**
5. Select **user_impersonation**
6. Click **Add permissions**
7. If required by your organization, click **Grant admin consent**

### 1.4 Expose an API

The MCP Server must expose an API that the Connector App will call.

1. In your app registration, go to **Expose an API**
2. Click **Add** next to "Application ID URI"
3. Accept the default value (`api://<client-id>`) or customize it
4. Click **Save**
5. Click **Add a scope**
6. Configure the scope:
   - **Scope name**: `mcp:tools`
   - **Who can consent**: `Admins and users`
   - **Admin consent display name**: `Access Dataverse MCP tools`
   - **Admin consent description**: `Allows the application to access Dataverse MCP tools on behalf of the signed-in user`
   - **User consent display name**: `Access Dataverse MCP tools`
   - **User consent description**: `Allows the application to access Dataverse MCP tools on your behalf`
   - **State**: `Enabled`
7. Click **Add scope**

## Step 2: Deploy the Server to Azure

Deploy the MCP Server to Azure Container Apps using Azure Developer CLI.

### 2.1 Authenticate with Azure

```bash
azd auth login
```

This will open a browser window to authenticate with your Azure account.

### 2.2 Deploy with azd

```bash
azd up
```

You'll be prompted for the following information:

- **Environment name**: Choose a name (e.g., `dataverse-mcp`)
- **Azure subscription**: Select your subscription
- **Location**: Select a region (e.g., `eastus`, `westeurope`)

Then provide the configuration values:

- **Azure AD Tenant ID**: From Step 1.2
- **Azure AD Client ID**: From Step 1.2 (MCP Server App)
- **Dataverse URL**: Your Dataverse environment URL (e.g., `https://yourorg.crm.dynamics.com`)
- **Dataverse API Version**: `v9.2` (or latest)

### 2.3 Note the Deployment URL

After deployment completes, note the Container App URL (e.g., `https://your-app.azurecontainerapps.io`).

### 2.4 Configure Federated Credential

This is the critical step to enable secret-less authentication. You will link your `Dataverse MCP Server` App Registration to the User-Assigned Managed Identity that was created during deployment.

> **Note**: This setup uses **two different Client IDs**:
>
> - **App Registration Client ID** (`AZURE_AD_CLIENT_ID`): The Client ID of the `Dataverse MCP Server` App Registration from Step 1.2
> - **Managed Identity Client ID** (`AZURE_CLIENT_ID`): The Client ID of the User-Assigned Managed Identity created by `azd`
>
> The Federated Credential establishes trust between these two identities, allowing the Managed Identity to obtain tokens on behalf of the App Registration.

1. **Find the Managed Identity Client ID**:

   - In the [Azure Portal](https://portal.azure.com), navigate to the resource group created by `azd` (e.g., `rg-dataverse-mcp`).
   - Find the **User-Assigned Managed Identity**. Its name will be similar to `uai-dataverse-mcp-<unique_string>`.
   - Click on it, and from the **Overview** page, copy its **Client ID**.
   - **Save this value** - you'll need it for verification later (this becomes the `AZURE_CLIENT_ID` environment variable).

2. **Add the Federated Credential**:
   - Return to your `Dataverse MCP Server` App Registration in **Microsoft Entra ID**.
   - Go to the **Certificates & secrets** blade and click the **Federated credentials** tab.
   - Click **Add credential**.
   - For the **Federated credential scenario**, select **Managed Identity**.
   - Click **Select a managed identity**.
   - Choose your **Subscription** and select the **User-assigned managed identity** that was created by `azd` (its name will be similar to `uai-dataverse-mcp-...`).
   - Click **Select**.
   - The **Issuer** and **Subject identifier** fields will be populated automatically.
   - **Verify** that the Subject identifier matches the **Managed Identity Client ID** you copied in step 1.
   - Provide a **Name** for the credential (e.g., `mcp-server-managed-identity`).
   - Click **Add**.

This configuration tells Entra ID to trust tokens issued by the Managed Identity as if they are coming from your application.

### 2.5 Verify Deployment

Test the health endpoint to confirm deployment:

```bash
curl https://<your-app-url>.azurecontainerapps.io/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2025-12-10T..."
}
```

> **Note:** You might need to restart your app service after configuring the federated credential for changes to take effect.

## Step 3: Register the MCP Server Connector App in Entra ID

The Connector App is used by Power Platform to authenticate users and call the MCP Server on their behalf.

> _Note:_ For more instructions on creating connector and app registration with On-Behalf-Of (OBO) flow, visit the official Microsoft documentation:
>
> **[Configure custom connector authentication with On-Behalf-Of](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-custom-connector-on-behalf-of)**

### 3.1 Create Connector App Registration

1. Navigate to [Azure Portal](https://portal.azure.com)
2. Go to **Microsoft Entra ID** > **App registrations**
3. Click **New registration**
4. Configure the registration:
   - **Name**: `Dataverse MCP Connector`
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   - **Redirect URI**: Leave blank (will be configured after creating the connector)
5. Click **Register**

### 3.2 Note Registration Details

Copy and save:

- **Application (client) ID** (Connector App)
- **Directory (tenant) ID**

### 3.3 Configure API Permissions

The Connector App needs permission to call the MCP Server API.

1. Go to **API permissions**
2. Click **Add a permission**
3. Click **APIs my organization uses** tab
4. Search for your MCP Server App (e.g., "Dataverse MCP Server")
5. Click on your MCP Server App
6. Select **Delegated permissions**
7. Check the `mcp:tools` scope you created earlier
8. Click **Add permissions**
9. If required, click **Grant admin consent**

## Step 4: Create a Custom Connector in Power Platform

Create a custom connector in Power Platform that uses the MCP Server.

### 4.1 Navigate to Custom Connectors

1. Go to [Power Platform Maker Portal](https://make.powerapps.com)
2. Select your environment
3. Navigate to **Custom connectors** under **Data** > **Custom connectors**
4. Click **New custom connector**

### 4.2 Import from GitHub

1. Select **Import from GitHub**
2. Configure the import:
   - **Connector Type**: Select **Custom**
   - **Branch**: Select **dev**
   - **Connector**: Select **MCP-Streamable-HTTP**
3. Click **Continue**

### 4.3 Configure General Information

On the **General** tab:

1. **Host**: Enter your Container App hostname (e.g., `your-app.azurecontainerapps.io`)
2. **Base URL**: `/mcp`
3. **Scheme**: `HTTPS`
4. **Connector Name**: E.g. `Dataverse MCP Connector`

### 4.4 Configure Security

On the **Security** tab, you will configure OAuth 2.0 to use a Managed Identity, which avoids the need for a client secret.

1. **Authentication type**: Select **OAuth 2.0**.
2. **Identity Provider**: Select **Azure Active Directory**.
3. **Client ID**: Your **Connector App** Client ID (from Step 3.2).
4. **Secret options**: Select **Use managed identity** (the connector will generate its own managed identity).
5. **Authorization URL**: `https://login.microsoftonline.com` (default).
6. **Tenant ID**: Enter your tenant ID from Step 1.2, or use `common` for multi-tenant scenarios.
7. **Resource URL**: Your **MCP Server App** Application ID URI (from Step 1.4, e.g., `api://<server-app-client-id>`).
8. **Enable on-behalf-of login**: Set to `true`.
9. **Scope**: The full scope including the Application ID URI, e.g., `api://<server-app-client-id>/mcp:tools`.
10. Click **Create connector**.
11. After the connector is saved, note the following values:
    - Scroll down to the **Managed identity** section and copy the **Issuer** and **Subject identifier** values (under "Federated Identity Credentials").
    - At the bottom of the Security tab, copy the **Redirect URL** (it will be something like `https://global.consent.azure-apim.net/redirect/mcp-2dstreamable-2dhttp-5f...`).

### 4.5 Add Redirect URI to Connector App Registration

Now that the connector has been created and generated a redirect URL, you need to add it to the Connector App Registration.

1. Return to the **Microsoft Entra ID** portal.
2. Go to **App registrations** and select your `Dataverse MCP Connector` app.
3. Go to **Authentication**.
4. Click **Add a platform**.
5. Select **Web**.
6. Enter the **Redirect URL** you copied from the Power Platform connector.
7. Click **Configure**.

### 4.6 Configure Federated Credential for Connector App

Now, you will configure the `Dataverse MCP Connector` App Registration to trust the Managed Identity of the custom connector.

1. Return to the **Microsoft Entra ID** portal.
2. Go to **App registrations** and select your `Dataverse MCP Connector` app.
3. Go to the **Certificates & secrets** blade and click the **Federated credentials** tab.
4. Click **Add credential**.
5. For **Federated credential scenario**, select **Other issuer**.
6. Under **Connect your account**, configure the following:
   - **Issuer**: Paste the **Issuer** value you copied from the custom connector (e.g., `https://login.microsoftonline.com/{tenant-id}/v2.0`).
   - **Type**: Select **Explicit subject identifier** (should be selected by default).
   - **Value**: Paste the **Subject identifier** value you copied from the custom connector (this is a long path starting with `/eid1/c/pub/...`).
7. Under **Credential details**:
   - **Name**: Give it a descriptive name (e.g., `power-platform-connector`).
   - **Description**: Optionally add a description.
   - **Audience**: This should be pre-filled as `api://AzureADTokenExchange` (leave as is).
8. Click **Add**.

### 4.7 Review Definition and Test

1. Return to your custom connector in the Power Platform Maker Portal.
2. Review the **Definition** tab to see imported operations.
3. Go to the **Test** tab.
4. Click **New connection**.
5. Sign in with a user account that has Dataverse access. The connection should now succeed without prompting for a secret.
6. Test operations to verify connectivity.

### 4.8 Use in Copilot Studio

1. Navigate to [Copilot Studio](https://copilotstudio.microsoft.com)
2. Create or open a Copilot
3. Go to **Actions** > **Add an action**
4. Select **Custom connector**
5. Choose your Dataverse MCP connector
6. Select the operations you want to use
7. Configure and test your Copilot with the MCP Server

## Troubleshooting

### Common Issues

#### Authentication Failed

- Verify all Client IDs are correct:
  - `AZURE_AD_CLIENT_ID` should be the **App Registration Client ID** (Dataverse MCP Server)
  - `AZURE_CLIENT_ID` should be the **Managed Identity Client ID** (auto-set by Container Apps)
- For the MCP Server App, ensure the **Federated Credential** is correctly configured:
  - The subject identifier should match the **Managed Identity Client ID** (`AZURE_CLIENT_ID`)
  - The issuer should be the Microsoft Entra ID token endpoint
- For the Connector App, ensure the **Federated Credential** is correctly configured with the issuer and subject from the Power Platform connector's security page.
- Ensure admin consent has been granted for API permissions.
- Check that redirect URIs are correctly configured.
- Restart the Container App after configuring federated credentials.

#### Cannot Connect to Server

- Verify the Container App is running: `az containerapp show --name <app-name> --resource-group <rg-name>`
- Check the health endpoint
- Review Container App logs for errors

#### OBO Flow Errors

- Ensure the Connector App has permission to call the MCP Server API (`mcp:tools` scope)
- Verify the MCP Server App has exposed the API correctly
- Check that the Resource URL matches the Application ID URI exactly

#### Dataverse Access Denied

- Ensure the user has appropriate security roles in Dataverse
- Verify the MCP Server App has `user_impersonation` permission for Dynamics CRM
- Check that users have granted consent to the applications

#### Deployment Failures and Resource Cleanup

If `azd up` times out or fails during deployment, Azure may leave resources in a failed provisioning state. Subsequent deployments will fail because Azure cannot update resources that are in a failed state.

**When to use this solution:**

- First deployment attempt times out
- You see errors like "ResourceDeploymentFailure" or "reached terminal provisioning state 'Failed'"
- Deployment fails with "dataverse-mcp-fetch-image" errors
- Resources are stuck in "Failed" provisioning state

**Quick cleanup and retry:**

```powershell
# Set your resource group name
$RESOURCE_GROUP = "your-resource-group-name"

# Clean up failed resources
Write-Host "Cleaning up failed resources..."
az containerapp delete --resource-group $RESOURCE_GROUP --name dataverse-mcp --yes 2>$null
az deployment group delete --resource-group $RESOURCE_GROUP --name dataverse-mcp-fetch-image 2>$null
az deployment group delete --resource-group $RESOURCE_GROUP --name dataverseMcp 2>$null
az deployment group delete --resource-group $RESOURCE_GROUP --name resources 2>$null

# Reset deployment flags
azd env set SERVICE_DATAVERSE_MCP_RESOURCE_EXISTS false

# If you have Owner permissions and role assignments are failing, skip them
# (see "Role Assignment Failures" below)
# azd env set SKIP_ROLE_ASSIGNMENTS true

# Retry deployment
Write-Host "`nRetrying deployment..."
azd up
```

**If you need to start completely fresh:**

```powershell
# List all resources to verify before deleting
az resource list --resource-group $RESOURCE_GROUP --output table

# Delete all resources in the resource group
az resource list --resource-group $RESOURCE_GROUP --query "[].id" -o tsv | ForEach-Object {
    az resource delete --ids $_ --verbose
}

# Then retry deployment
azd up
```

#### Role Assignment Failures

Even with Owner permissions on the resource group, the automatic role assignment during deployment can fail due to Azure Policy restrictions, custom RBAC configurations, or timing issues.

**Symptoms:**

- Deployment fails with "AuthorizationFailed for roleAssignments" errors
- Error mentions "Microsoft.Authorization/roleAssignments/write" permission
- You have confirmed you have Owner role on the resource group

**Solution: Skip role assignments during deployment and configure manually:**

```powershell
# Skip automatic role assignments
azd env set SKIP_ROLE_ASSIGNMENTS true

# Deploy
azd up
```

**After deployment succeeds, manually assign the required role:**

```powershell
$RESOURCE_GROUP = "your-resource-group-name"

# Get managed identity principal ID
$IDENTITY_PRINCIPAL_ID = az identity list `
  --resource-group $RESOURCE_GROUP `
  --query "[?contains(name, 'dataverse-mcp')].principalId" -o tsv

# Get ACR name
$ACR_NAME = az acr list `
  --resource-group $RESOURCE_GROUP `
  --query "[0].name" -o tsv

# Get subscription ID
$SUBSCRIPTION_ID = az account show --query id -o tsv

# Assign AcrPull role to the managed identity
az role assignment create `
  --assignee $IDENTITY_PRINCIPAL_ID `
  --role "AcrPull" `
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

Write-Host "✅ Role assignment completed successfully"

# Restart container app to pick up new permissions
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

**Verify the role assignment:**

```powershell
# Check role assignments on the ACR
az role assignment list `
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME" `
  --output table
```

For more details on deploying with skip role assignments, see [SKIP_ROLE_ASSIGNMENTS.md](./SKIP_ROLE_ASSIGNMENTS.md).

### Getting Help

For issues and questions:

- Check the [Support](./SUPPORT.md) documentation
- File an issue in the GitHub repository
- Review Azure Container App logs for detailed error messages

## Security Considerations

- **Secrets Management**: Use Managed Identity and Federated Credentials for Azure resources and Power Platform connectors to avoid managing secrets.
- **Consent**: Ensure users understand what data access they're granting.
- **Monitoring**: Enable logging and monitoring for the Container App.
- **Regular Updates**: Keep app registration secrets (like the one for the Connector App) rotated according to your security policy.
- **Least Privilege**: Grant only necessary permissions to users and apps

## Next Steps

After successful installation:

1. Review the [README](./README.md) for implementation details
2. Configure logging levels if needed
3. Monitor cache performance and adjust TTLs if required
4. Set up alerts for the Container App
5. Train users on available MCP tools and capabilities
