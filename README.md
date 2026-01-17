# Dataverse MCP Server

A Model Context Protocol (MCP) server that provides secure access to Microsoft Dataverse through OAuth 2.0 authentication. This server enables AI agents and applications to interact with Dataverse data using the MCP standard.

> [!NOTE]
> The main purpose for this MCP is to provide Dataverse Access (e.g. CRM) accross environment boundaries. Thus, users can build Agents in a Copilot Studio environment while safely accessing CRM Data in another environment.

## Getting Started

For step-by-step installation and registration instructions, see the **[Installation Guide](./INSTALLATION_GUIDE.md)**.

## Local Development

### Prerequisites

- **Node.js**: Version 18 or higher
- **npm**: Version 8 or higher
- **Visual Studio Code**: Latest version recommended
- **Dataverse Environment**: Access to a Microsoft Dataverse environment
- **Entra ID App Registration**: Create an app registration with:
  - Delegated permission: `Dynamics CRM` > `user_impersonation`
  - Redirect URI: `http://localhost` (Public client/native)

### Setup

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd dataverse-cross-environment-mcp
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Build the project**:

   ```bash
   npm run build
   ```

### Running in VS Code

#### STDIO Mode (Recommended for local development)

STDIO mode uses interactive OAuth authentication and requires a Dataverse connection string.

**Connection String Format:**

```txt
AuthType=OAuth;Url=<dataverse-url>;ClientId=<app-client-id>;RedirectUri=http://localhost;LoginPrompt=Auto
```

Optional: Add `Username=user@domain.com` to pre-fill the login prompt.

**Option 1: Using command line**

```bash
node dist/index.js --connection-string="AuthType=OAuth;Url=https://yourorg.crm.dynamics.com;ClientId=your-client-id;RedirectUri=http://localhost;LoginPrompt=Auto"
```

**Option 2: Using npx (recommended for quick testing)**

```bash
npx dataverse-mcp-server --connection-string="AuthType=OAuth;Url=https://yourorg.crm.dynamics.com;ClientId=your-client-id;RedirectUri=http://localhost;LoginPrompt=Auto"
```

**Option 3: Using VS Code debugger**

1. Create a `.vscode/launch.json` file (see VS Code Configuration section below)
2. Update the `--connection-string` argument with your values
3. Open the Run and Debug view (Ctrl+Shift+D or Cmd+Shift+D)
4. Select "Launch STDIO Server" from the dropdown
5. Press F5 to start debugging

This will:

- Build the TypeScript code
- Launch the server in STDIO mode
- Open a browser for OAuth authentication
- Attach the debugger for breakpoint debugging

**Option 4: Using MCP Inspector**

For testing MCP tools interactively with a web UI, you need to create a wrapper script due to the MCP Inspector's handling of semicolons in arguments.

Create a file named `run-stdio.bat` (Windows) or `run-stdio.sh` (Mac/Linux):

**Windows (run-stdio.bat):**

```batch
@echo off
node dist/index.js --connection-string="AuthType=OAuth;Url=https://yourorg.crm.dynamics.com;ClientId=your-client-id;RedirectUri=http://localhost;LoginPrompt=Auto"
```

**Mac/Linux (run-stdio.sh):**

```bash
#!/bin/bash
node dist/index.js --connection-string="AuthType=OAuth;Url=https://yourorg.crm.dynamics.com;ClientId=your-client-id;RedirectUri=http://localhost;LoginPrompt=Auto"
```

Then run the Inspector:

```bash
# Windows
npx @modelcontextprotocol/inspector run-stdio.bat

# Mac/Linux
chmod +x run-stdio.sh
npx @modelcontextprotocol/inspector ./run-stdio.sh
```

This opens a web interface where you can:

- Browse available tools
- Test tool invocations
- See request/response payloads
- Monitor server logs

### VS Code Configuration

Create a `.vscode/launch.json` file for debugging:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch STDIO Server",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/dist/index.js",
      "args": [
        "--connection-string=AuthType=OAuth;Url=https://yourorg.crm.dynamics.com;ClientId=your-client-id;RedirectUri=http://localhost;LoginPrompt=Auto"
      ],
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "sourceMaps": true
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch HTTP Server",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/dist/index.js",
      "args": ["--mode=http"],
      "preLaunchTask": "npm: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "sourceMaps": true,
      "env": {
        "AZURE_AD_TENANT_ID": "your-tenant-id",
        "AZURE_AD_CLIENT_ID": "your-client-id",
        "AZURE_AD_CLIENT_SECRET": "your-secret",
        "DATAVERSE_URL": "https://yourorg.crm.dynamics.com",
        "DATAVERSE_API_VERSION": "v9.2"
      }
    }
  ]
}
```

> **Note:** Replace the placeholder values (`yourorg`, `your-client-id`, etc.) with your actual Dataverse and Entra ID configuration.

### Testing

Run unit tests:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run tests with coverage:

```bash
npm run test:coverage
```

### Troubleshooting Local Development

**Authentication Issues:**

- Ensure your app registration has the correct redirect URI: `http://localhost` (Public client/native)
- Verify `Dynamics CRM` > `user_impersonation` permission is granted
- Check that your connection string has the correct Client ID and Dataverse URL
- For HTTP mode, verify `config.json` or environment variables are set correctly

**Connection String Required Error:**

- STDIO mode requires a `--connection-string` argument
- The npm script `npm run start:stdio` won't work without modifying it to include the connection string
- Use the command line or VS Code debugger with the full connection string instead

**MCP Inspector Connection String Issues:**

- The Inspector splits arguments at semicolons, breaking connection strings
- Create a wrapper script (`.bat` or `.sh` file) that contains the full connection string
- Run the wrapper script with the Inspector instead of passing the connection string directly
- See "Option 4: Using MCP Inspector" in the Running in VS Code section for details

**Build Errors:**

- Delete `node_modules` and `dist` folders, then run `npm install` and `npm run build`
- Ensure TypeScript version is compatible (check `package.json`)

**Connection Issues:**

- Verify the Dataverse URL is correct and accessible
- Check network connectivity and firewall settings
- Ensure your user account has access to the Dataverse environment

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) is an open protocol that standardizes how applications provide context to LLMs. MCP provides a standardized way to connect AI models to different data sources and tools, allowing seamless integration of Dataverse capabilities into AI-powered applications.

## Features

- **Dual Mode Operation**:
  - **HTTP Mode**: Production deployment with On-Behalf-Of (OBO) authentication for Copilot Studio
  - **STDIO Mode**: Local execution with interactive OAuth for development and CLI tools
- **OAuth 2.0 Authentication**: Secure authentication using Microsoft Entra ID
- **Dataverse Integration**: Direct access to Microsoft Dataverse Web API
- **MCP Compliant**: Fully implements the Model Context Protocol specification
- **Azure Native**: Designed for deployment on Azure Container Apps
- **Production Ready**: Includes health checks, logging, security best practices, and user-isolated caching

## MCP Tools

The server provides the following tools for interacting with Dataverse:

### whoami

Returns information about the authenticated user.

**Returns:**

- User ID (systemuser)
- Business Unit ID
- Organization ID

### list_tables

Lists all Dataverse tables accessible to the authenticated user.

**Returns:**

- Array of tables with:
  - Logical name (e.g., `account`, `contact`)
  - Display name (e.g., "Account", "Contact")
  - Collection name (for API operations)
  - Description

### search

Searches for records across Dataverse tables using the Dataverse Search API.

**Parameters:**

- `searchTerm` (string, required): The term to search for
- `tableFilter` (string, optional): Limit search to specific table (e.g., `account`)
- `top` (number, optional): Maximum results to return (default: 10)

**Returns:**

- Array of matching records with basic information
- Total record count
- Deep links to records

### retrieve_record

Retrieves a single record with complete details.

**Parameters:**

- `tableName` (string, required): Logical name of the table (e.g., `account`)
- `recordId` (string, required): GUID of the record or primary name value
- `allColumns` (boolean, optional): Return all columns instead of important columns only

**Returns:**

- Full record with all requested attributes
- Formatted values for lookups and option sets

### describe_table

Gets detailed schema information for a Dataverse table.

**Parameters:**

- `tableName` (string, required): Logical name of the table
- `full` (boolean, optional): Include all columns (default: false, returns important columns only)

**Returns:**

- Table metadata (logical name, display name, description)
- Primary ID and name attributes
- Column definitions with types and constraints
- Sample record structure

### create_record

Creates a new record in a Dataverse table.

**Parameters:**

- `table` (string, required): The logical name of the table to create the record in.
- `data` (object, required): A JSON object containing the data for the new record.

**Data Conversion:**
The tool automatically handles data conversion for the following types:

- **Lookups**:
  - GUID: `"lookup_attribute": "00000000-0000-0000-0000-000000000001"`
  - Web API style: `"lookup_attribute@odata.bind": "/contacts(00000000-0000-0000-0000-000000000001)"`
  - Primary name: `"lookup_attribute": "Contact Name"`
- **Option Sets**:
  - Integer value: `"optionset_attribute": 100000000`
  - Label: `"optionset_attribute": "Option Label"`
- **Transaction Currency**:
  - If `transactioncurrencyid` is not provided, it defaults to the organization's base currency.

**Returns:**

- The ID of the newly created record.
- A resource link to the new record.

### update_record

Updates an existing record in a Dataverse table.

**Parameters:**

- `table` (string, required): The logical name of the table to update the record in.
- `record_id` (string, required): The ID of the record to update.
- `data` (object, required): A JSON object containing the data to update on the record.

**Data Conversion:**
The tool automatically handles data conversion for the same types as `create_record`.

**Returns:**

- A success message.
- A resource link to the updated record.

### get_predefined_queries

Lists saved queries (views) available for a table.

**Parameters:**

- `tableName` (string, required): Logical name of the table

**Returns:**

- Array of system views (savedqueries) and personal views (userqueries)
- Query IDs and names

### run_predefined_query

Executes a saved query by ID or name.

**Parameters:**

- `queryIdOrName` (string, required): Query GUID or name
- `tableName` (string, optional): Table name when using query name instead of ID

**Returns:**

- Query results with all columns defined in the view
- Deep links to records

### run_custom_query

Executes a custom FetchXML query.

**Parameters:**

- `fetchXml` (string, required): FetchXML query string
- `tableName` (string, optional): Table name if not specified in FetchXML

**Returns:**

- Query results
- Deep links to records

## Architecture

### HTTP Mode (Production)

- **Express Server**: Handles HTTP requests with JWT authentication
- **MCP Streamable HTTP Transport**: Implements MCP protocol over HTTP/SSE
- **MSAL Confidential Client**: Manages OAuth 2.0 On-Behalf-Of (OBO) token flow
- **Dataverse Web API Client**: Abstracts Dataverse interactions with retry logic and rate limiting
- **AsyncLocalStorage**: Maintains request context for multi-tenant scenarios

### STDIO Mode (Local Development)

- **MCP STDIO Transport**: Implements MCP protocol over standard input/output
- **MSAL Public Client**: Interactive OAuth with browser-based authentication
- **Token Cache**: Persistent file-based token storage for session continuity
- **Dataverse Web API Client**: Same client as HTTP mode with direct authentication

## Security

### HTTP Mode

- **JWT Authentication**: All requests require valid JWT tokens with `mcp:tools` scope
- **On-Behalf-Of Flow**: Accesses Dataverse using the authenticated user's identity
- **Session Management**: Configurable session timeouts
- **HTTPS Only**: Enforced in production deployments
- **Client Secret**: Required, stored securely in Azure Key Vault or environment variables
- **Request Validation**: express-jwt middleware with JWKS verification

### STDIO Mode

- **Interactive OAuth**: Browser-based authentication using device code flow
- **Public Client**: No client secret required
- **Local Token Cache**: File system storage with user permissions
- **User Context**: All operations execute under the authenticated user's identity
- **Trusted Environment**: Designed for local development only

### User Isolation

The server implements strict user isolation for all operations:

- Caches are segregated by user ID for user-specific data
- Each request operates in the context of the authenticated user
- No cross-user data leakage in multi-tenant deployments

## Logging and Caching

### Logging

The server uses a unified logging system with configurable log levels:

- **ERROR**: Critical errors and failures
- **WARN**: Warnings and potential issues (e.g., retries, fallbacks)
- **INFO**: Important operational events (startup, connections, cache operations)
- **DEBUG**: Detailed diagnostic information (requests, responses, token acquisition)

Default log level is `INFO`. Debug logging can be enabled programmatically:

```typescript
import { logger, LogLevel } from "./utils/logger.js";

// Enable debug logging
logger.setLogLevel(LogLevel.DEBUG);
```

**Note:** Debug logging is verbose and should only be enabled during development or troubleshooting.

### Caching

The server implements intelligent caching for metadata and user-specific data with automatic TTL-based expiration:

**Cached Data:**

- **Table Metadata**: Table definitions and attributes (24 hour TTL)
- **Table Descriptions**: Detailed table schemas (24 hour TTL)
- **Entity Set Names**: Mapping between logical and collection names (24 hour TTL)
- **Important Columns**: User-specific column selections based on data sampling (24 hour TTL, **user-isolated**)
- **Readable Entity Names**: User-specific permissions (24 hour TTL, **user-isolated**)

**User Isolation:**

User-specific cache data (important columns and readable entity names) is isolated per user ID to ensure:

- Each user sees only their authorized entities
- Column recommendations are based on data the user can access
- No data leakage between different users in multi-tenant scenarios

**Cache Keys:**

Non-user-specific data: `${dataverseUrl}_${cacheType}`
User-specific data: `${dataverseUrl}_${userId}_${tableName}_${cacheType}`

**Cache Management:**

Caches automatically expire based on TTL. Manual cache clearing:

```typescript
import { MetadataService } from "./services/dataverse/MetadataService.js";

// Clear important columns and table descriptions cache
MetadataService.clearImportantColumnsCache();
```

## Mode Comparison

| Feature            | STDIO Mode           | HTTP Mode                  |
| ------------------ | -------------------- | -------------------------- |
| **Use Case**       | Local dev, CLI tools | Production, Copilot Studio |
| **Authentication** | Interactive OAuth    | On-Behalf-Of (OBO)         |
| **Deployment**     | Local, npx           | Azure Container Apps       |
| **Client Secret**  | Not required         | Required                   |
| **Token Storage**  | Local file cache     | In-memory per request      |
| **Network**        | Direct to Dataverse  | HTTP API endpoint          |
| **Best For**       | Development, testing | Production workloads       |

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Trademarks

This project may contain trademarks or logos for projects, products, or services.
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
