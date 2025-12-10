import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DataverseClient } from "./services/dataverse/DataverseClient.js";
import {
  ConnectionStringParams,
  parseConnectionString,
} from "./utils/connectionStringParser.js";
import { logger, LogMode } from "./utils/logger.js";
import {
  registerDataverseTools,
  RequestContextProvider,
} from "./tools/dataverse/toolRegistration.js";
import { registerDataverseResourceHandlers } from "./tools/dataverse/resourceHandlers.js";

/**
 * STDIO MCP Server for local Dataverse access
 * Uses interactive OAuth authentication with device code flow
 */

// Set logger to STDIO mode (all output to stderr)
logger.setMode(LogMode.STDIO);

// Get connection string from command line argument
const connectionStringArg = process.argv.find((arg) =>
  arg.startsWith("--connection-string=")
);

if (!connectionStringArg) {
  logger.error(
    "Error: --connection-string argument is required for STDIO mode"
  );
  logger.error(
    '\nUsage: node dist/server.stdio.js --connection-string="AuthType=OAuth;Url=...;Username=...;ClientId=...;RedirectUri=...;LoginPrompt=Auto"'
  );
  process.exit(1);
}

// Extract connection string - everything after "--connection-string="
const connectionString = connectionStringArg.substring(
  "--connection-string=".length
);
let connectionParams: ConnectionStringParams;

try {
  connectionParams = parseConnectionString(connectionString);
  logger.info(`Parsed connection string successfully`);
  logger.info(`Dataverse URL: ${connectionParams.url}`);
  logger.info(`Client ID: ${connectionParams.clientId}`);
  if (connectionParams.username) {
    logger.info(`Username: ${connectionParams.username}`);
  }
} catch (error: any) {
  logger.error(`Error parsing connection string: ${error.message}`);
  process.exit(1);
}

const server = new McpServer({
  name: "dataverse-mcp-server",
  version: "1.0.0",
});

// Initialize Dataverse service with connection string
const dataverseClient = new DataverseClient(connectionParams);

// Initialize authentication
logger.info("Initializing authentication...");
await dataverseClient.initialize();
logger.info("Authentication initialized");

// Context provider for STDIO mode (Interactive)
const stdioContextProvider: RequestContextProvider = {
  getContext: () => undefined, // No HTTP request context in STDIO mode
  getUserInfo: () => connectionParams.username || "Interactive User",
};

// Register all Dataverse tools
registerDataverseTools(server, dataverseClient, stdioContextProvider);

// Register all Dataverse resource handlers
registerDataverseResourceHandlers(
  server,
  dataverseClient,
  stdioContextProvider
);

// Setup and start the server
const transport = new StdioServerTransport();

logger.info("Starting Dataverse MCP Server (STDIO mode)...");

await server.connect(transport);

logger.info("Dataverse MCP Server running in STDIO mode");
