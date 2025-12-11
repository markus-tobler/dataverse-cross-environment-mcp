# Dataverse MCP Server

A Model Context Protocol (MCP) server that provides secure access to Microsoft Dataverse through OAuth 2.0 authentication. This server enables AI agents and applications to interact with Dataverse data using the MCP standard.

> [!NOTE]
> The main purpose for this MCP is to provide Dataverse Access (e.g. CRM) accross environment boundaries. Thus, users can build Agents in a Copilot Studio environment while safely accessing CRM Data in another environment.

## Getting Started

For step-by-step installation and registration instructions, see the **[Installation Guide](./INSTALLATION_GUIDE.md)**.

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
import { logger, LogLevel } from './utils/logger.js';

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
import { MetadataService } from './services/dataverse/MetadataService.js';

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
