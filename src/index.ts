#!/usr/bin/env node

/**
 * Main entry point for Dataverse MCP Server
 * Supports two modes:
 * 1. HTTP mode (default) - For deployment with Copilot Studio and remote access
 * 2. STDIO mode - For local execution via npx with connection string
 */

import { parseArgs } from "node:util";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
let values: Record<string, any>;
try {
  const parsed = parseArgs({
    options: {
      "connection-string": {
        type: "string",
        short: "c",
      },
      help: {
        type: "boolean",
        short: "h",
      },
      mode: {
        type: "string",
        short: "m",
      },
    },
    allowPositionals: true,
  });
  values = parsed.values;
} catch (error: any) {
  console.error(`Error parsing arguments: ${error.message}`);
  process.exit(1);
}

// Show help if requested
if (values.help) {
  console.log(`
Dataverse MCP Server - Dual Mode Support

USAGE:
  dataverse-mcp-server [OPTIONS]

MODES:

  1. HTTP Mode (Default - for Copilot Studio/Remote Access):
     npm start
     node dist/index.js

     Starts an Express HTTP server with OAuth On-Behalf-Of authentication.
     Requires configuration via config.json or environment variables.

  2. STDIO Mode (Local execution via npx):
     npx dataverse-mcp-server --connection-string="AuthType=OAuth;Url=...;ClientId=...;RedirectUri=...;LoginPrompt=Auto"
     node dist/index.js --connection-string="..."

     Runs as a local MCP server using stdio transport with interactive OAuth.
     Requires a Dataverse connection string.

OPTIONS:
  -c, --connection-string <string>  Connection string for STDIO mode
                                     Format: AuthType=OAuth;Url=<url>;Username=<user>;ClientId=<id>;RedirectUri=<uri>;LoginPrompt=Auto
  -m, --mode <http|stdio>           Explicitly set the mode (auto-detected by default)
  -h, --help                        Show this help message

EXAMPLES:

  Start HTTP server:
    npm start

  Start STDIO server with connection string:
    npx dataverse-mcp-server --connection-string="AuthType=OAuth;Url=https://org.crm4.dynamics.com/;Username=user@domain.com;ClientId=51f81489-12ee-4a9e-aaae-a2591f45987d;RedirectUri=http://localhost/;LoginPrompt=Auto"

  Show help:
    npx dataverse-mcp-server --help

ENVIRONMENT VARIABLES (HTTP Mode):
  AZURE_AD_TENANT_ID              Azure AD Tenant ID
  AZURE_AD_CLIENT_ID              Azure AD Client ID
  AZURE_AD_CLIENT_SECRET          Azure AD Client Secret
  DATAVERSE_URL                   Dataverse instance URL
  PORT                            HTTP server port (default: 3000)

For more information, see README.md
`);
  process.exit(0);
}

// Determine mode
let mode: "http" | "stdio";

if (values.mode) {
  // Explicit mode specified
  if (values.mode !== "http" && values.mode !== "stdio") {
    console.error(
      `Error: Invalid mode '${values.mode}'. Valid modes are: http, stdio`
    );
    process.exit(1);
  }
  mode = values.mode as "http" | "stdio";
} else if (values["connection-string"]) {
  // Connection string provided - use STDIO mode
  mode = "stdio";
} else {
  // Default to HTTP mode
  mode = "http";
}

console.log(`Starting Dataverse MCP Server in ${mode.toUpperCase()} mode...`);

// Launch appropriate server
if (mode === "stdio") {
  // Validate connection string is provided
  if (!values["connection-string"]) {
    console.error("Error: --connection-string is required for STDIO mode\n");
    console.error(
      'Use --help for usage information or provide a connection string:\n  --connection-string="AuthType=OAuth;Url=...;ClientId=...;RedirectUri=...;LoginPrompt=Auto"\n'
    );
    process.exit(1);
  }

  // Pass connection string as command line argument to stdio server
  process.argv = [
    process.argv[0],
    path.join(__dirname, "server.stdio.js"),
    `--connection-string=${values["connection-string"]}`,
  ];

  // Import and run STDIO server
  await import("./server.stdio.js");
} else {
  // Import and run HTTP server
  await import("./server.js");
}
