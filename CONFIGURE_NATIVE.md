# Copilot Studio Custom Connector — Dataverse Native MCP

Connect Copilot Studio to the **Dataverse native MCP endpoint** (`/api/mcp`) using delegated user context and secretless authentication. The connector acts as an MCP client, so only the `mcp.tools` delegated permission is needed — no `user_impersonation`, no client secret. A Power Platform managed identity + federated identity credential replaces the secret, and Dataverse security roles are enforced per the signed-in user.

**MCP endpoint pattern:** `https://<org>.crm.dynamics.com/api/mcp`

---

## Prerequisites

- Access to the target Dataverse environment (MCP enabled, Managed Environment)
- Permission to create Entra ID app registrations and grant admin consent
- Permission to create custom connectors in the Power Platform environment

---

## Step 1 — Create the Entra ID App Registration

1. **Microsoft Entra admin center** > App registrations > **New registration**
   - Name: `Dataverse MCP Custom Connector`
   - Supported account types: single-tenant
   - Redirect URI: leave empty for now
2. Copy the **Application (client) ID** and **Directory (tenant) ID**.

---

## Step 2 — Add the `mcp.tools` API Permission

API permissions > Add a permission > **Dynamics CRM** > Delegated > `mcp.tools`

Grant admin consent if required. Do **not** add `user_impersonation`.

---

## Step 3 — Expose an API

1. Expose an API > Set **Application ID URI** to `api://<APP_CLIENT_ID>` > Save.
2. Add a scope:
   - Scope name: `access_as_user`
   - Who can consent: Admins and users
   - State: Enabled
3. Under **Authorized client applications**, add:
   - Client ID: `7ab7862c-4c57-491e-8a45-d52a7e023983`
   - Authorized scope: `api://<APP_CLIENT_ID>/access_as_user`

---

## Step 4 — Enable Dataverse MCP and Register the Connector

### 4.1 — Enable the MCP server

1. Open the [Power Platform admin center](https://admin.powerplatform.microsoft.com) > **Manage > Environments** > select the target environment.
2. Go to **Settings > Product > Features** > **Dataverse Model Context Protocol**.
3. Turn on **Allow MCP clients to interact with Dataverse MCP server** > Save.

### 4.2 — Register the connector as an allowed MCP client

Dataverse must explicitly allow the connector's App ID to authenticate via OBO.

1. In the same section, select **Advanced Settings**.
2. Find the client in the list, or create a new entry:
   - Name: `Dataverse MCP Custom Connector`
   - App ID: `<APP_CLIENT_ID>` (from Step 1)
   - Is Enabled: `Yes`
3. Save & Close.

> Copilot Studio is pre-registered by default — step 4.2 only applies to custom connectors and other non-Copilot-Studio clients.

---

## Step 5 — Create the Custom Connector

> [!NOTE]
> Use `https://make.preview.powerapps.com` — the **Use managed identity** option is only available in the preview portal.

> [!TIP]
> **Use environment variables for all environment-specific fields** (Host, Client ID, Tenant ID, Resource URL, Scope). This lets you deploy the connector via a managed solution and promote it across environments without editing values manually. See [Use environment variables in solution custom connectors](https://learn.microsoft.com/en-us/connectors/custom-connectors/environment-variables) for setup steps. In any connector field, reference a variable with the syntax `@environmentVariables("your_variable_name")`.

> [!TIP]
> **Deploy with managed solutions.** Create the custom connector inside a Dataverse solution and export it as a **managed solution** to promote it to test/production environments. Strip the environment variable _current values_ from the solution before export so that each target environment supplies its own values on import. See [Export solutions](https://learn.microsoft.com/en-us/powerapps/maker/data-platform/export-solutions) and [Import solutions](https://learn.microsoft.com/en-us/powerapps/maker/data-platform/import-update-export-solutions).

1. More > Discover all > **Custom connectors** > New custom connector.
2. **General** tab:
   - Host: `<org>.crm.dynamics.com` (or `@environmentVariables("your_ConnectorHost")` if using environment variables)
   - Base URL: `/api/mcp`
3. **Security** tab:
   - Authentication type: `OAuth 2.0`
   - Identity provider: `Microsoft Entra ID`
   - Client ID: `<APP_CLIENT_ID>` (or `@environmentVariables("your_ClientId")`)
   - Tenant ID: `<TENANT_ID>` (or `@environmentVariables("your_TenantId")`)
   - Secret option: **Use managed identity** (do not enter a client secret)
   - Resource URL: `https://<org>.crm.dynamics.com` — the root URL of the target Dataverse environment (or `@environmentVariables("your_ResourceUrl")`)
   - Scope: `https://<org>.crm.dynamics.com/.default` (or `@environmentVariables("your_Scope")`)
4. Save the connector and copy the **Redirect URI** shown in the Security tab.

---

## Step 6 — Add the Redirect URI to the App Registration

Authentication > Add a platform > **Web** > paste the redirect URI from Step 5 > Save.

---

## Step 7 — Add the Federated Identity Credential

Certificates & secrets > **Federated credentials** > Add credential > **Other issuer**

Enter the **Issuer**, **Subject identifier**, and **Audience** values shown in the connector's managed identity configuration. The audience is typically `api://AzureADTokenExchange`.

This step replaces the client secret. Do not create a client secret.

---

## Step 8 — Create a Connection and Test

1. In the connector, go to **Test** > **New connection** > sign in with a Dataverse-licensed user.
2. Test with a read-only tool first: `list_tables` or `describe_table`.
3. Once confirmed, add the connector as an action in your Copilot Studio agent.

---

## Troubleshooting

| Symptom                                 | Check                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| Auth fails on connection creation       | Redirect URI in app reg exactly matches the connector URI                           |
| `invalid_client` / missing secret error | Reopen connector security, confirm **Use managed identity** is selected, re-save    |
| Token exchange fails                    | Federated credential issuer/subject/audience must match connector values exactly    |
| Consent prompt loop                     | Confirm `7ab7862c-4c57-491e-8a45-d52a7e023983` is authorized for `access_as_user`   |
| MCP calls return 403                    | User lacks required Dataverse security roles; `mcp.tools` admin consent not granted |

---

## Validation Checklist

- [ ] Dataverse MCP server enabled in Power Platform admin center (Settings > Product > Features)
- [ ] Custom connector app ID registered in Dataverse MCP Advanced Settings and enabled
- [ ] App registration: single-tenant, no client secret
- [ ] API permission: `Dynamics CRM / mcp.tools` (delegated), admin consent granted
- [ ] Exposed scope: `api://<APP_CLIENT_ID>/access_as_user`
- [ ] Authorized client `7ab7862c-4c57-491e-8a45-d52a7e023983` for `access_as_user`
- [ ] App registration redirect URI matches the connector URI
- [ ] Federated identity credential configured
- [ ] Connector created in `make.preview.powerapps.com`, secret option = **Use managed identity**
- [ ] Security tab: Resource URL = `https://<org>.crm.dynamics.com`, Scope = `https://<org>.crm.dynamics.com/.default`
- [ ] Connector is part of a Dataverse solution and environment-specific fields use environment variables (`@environmentVariables("...")` syntax)
- [ ] Solution exported as managed (environment variable current values stripped before export)
- [ ] Connection creates and MCP tools respond successfully
