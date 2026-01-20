// Initialize Application Insights FIRST before other imports to ensure all telemetry is captured
import { appInsightsService } from "./services/telemetry/ApplicationInsightsService.js";
appInsightsService.initialize();

import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { expressjwt, GetVerificationKey } from "express-jwt";
import jwksRsa from "jwks-rsa";
import session from "express-session";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";
import { DataverseClient } from "./services/dataverse/DataverseClient.js";
import {
  registerDataverseTools,
  RequestContextProvider,
} from "./tools/dataverse/toolRegistration.js";
import { registerDataverseResourceHandlers } from "./tools/dataverse/resourceHandlers.js";
import { logger, LogMode } from "./utils/logger.js";

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set logger to HTTP mode
logger.setMode(LogMode.HTTP);

// AsyncLocalStorage for request context
const requestContext = new AsyncLocalStorage<Request>();

// Load configuration
const configPath =
  process.env.NODE_ENV === "production"
    ? path.join(__dirname, "../config.json")
    : path.join(__dirname, "../config.Development.json");

let config: any = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (error) {
  logger.warn(
    `Could not load config from ${configPath}, using environment variables`
  );
}

// Merge config file with environment variables (env vars take precedence)
config = {
  AzureAd: {
    Instance:
      process.env.AZURE_AD_INSTANCE ||
      config.AzureAd?.Instance ||
      "https://login.microsoftonline.com/",
    TenantId: process.env.AZURE_AD_TENANT_ID || config.AzureAd?.TenantId || "",
    ClientId: process.env.AZURE_AD_CLIENT_ID || config.AzureAd?.ClientId || "",
    Audience: process.env.AZURE_AD_AUDIENCE || config.AzureAd?.Audience || "",
    ClientSecret:
      process.env.AZURE_AD_CLIENT_SECRET || config.AzureAd?.ClientSecret || "",
    ManagedIdentityClientId: process.env.AZURE_CLIENT_ID || config.AzureAd?.ManagedIdentityClientId || "",
  },
  Dataverse: {
    Url: process.env.DATAVERSE_URL || config.Dataverse?.Url || "",
    ApiVersion:
      process.env.DATAVERSE_API_VERSION ||
      config.Dataverse?.ApiVersion ||
      "v9.2",
  },
  McpServer: {
    SessionTimeoutMinutes: parseInt(
      process.env.SESSION_TIMEOUT_MINUTES ||
        config.McpServer?.SessionTimeoutMinutes?.toString() ||
        "60"
    ),
    RequestTimeoutMinutes: parseInt(
      process.env.REQUEST_TIMEOUT_MINUTES ||
        config.McpServer?.RequestTimeoutMinutes?.toString() ||
        "60"
    ),
  },
};

const server = new McpServer({
  name: "dataverse-mcp-server",
  version: "1.0.0",
});

// Initialize Dataverse service
const dataverseClient = new DataverseClient(config);

// This is a temporary measure until we have versioned caches
logger.info("Clearing important columns cache on startup...");
// DataverseService.clearImportantColumnsCache();

// Context provider for HTTP mode (OBO)
const httpContextProvider: RequestContextProvider = {
  getContext: () => requestContext.getStore(),
  getUserInfo: () => {
    const req = requestContext.getStore();
    return (
      (req as any)?.auth?.upn ||
      (req as any)?.auth?.preferred_username ||
      "Unknown"
    );
  },
};

// Register all Dataverse tools
registerDataverseTools(server, dataverseClient, httpContextProvider);
// Register all Dataverse resource handlers
registerDataverseResourceHandlers(server, dataverseClient, httpContextProvider);

const app = express();

// Global request logger - logs ALL requests
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.debug(`\n=== INCOMING REQUEST ===`);
  logger.debug(`Method: ${req.method}`);
  logger.debug(`URL: ${req.url}`);
  logger.debug(`Path: ${req.path}`);
  logger.debug(
    `Authorization header: ${
      req.headers.authorization ? "Present (Bearer...)" : "MISSING"
    }`
  );
  logger.debug(`Content-Type: ${req.headers["content-type"] || "not set"}`);
  logger.debug(`========================\n`);
  next();
});

app.use(express.json());

// CORS configuration for SSE
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Mcp-Session-Id"],
  })
);

// Session management
app.use(
  session({
    secret:
      process.env.SESSION_SECRET || "mcp-server-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: config.McpServer.SessionTimeoutMinutes * 60 * 1000,
    },
  })
);

// JWT authentication middleware
const checkJwt = expressjwt({
  secret: jwksRsa.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: `${config.AzureAd.Instance}${config.AzureAd.TenantId}/discovery/v2.0/keys`,
  }) as GetVerificationKey,
  audience: [config.AzureAd.ClientId, `api://${config.AzureAd.ClientId}`],
  // Accept multiple issuer formats to match Microsoft.Identity.Web behavior
  // Copilot Studio may send tokens from either issuer format
  issuer: [
    `${config.AzureAd.Instance}${config.AzureAd.TenantId}/v2.0`,
    `https://sts.windows.net/${config.AzureAd.TenantId}/`,
  ],
  algorithms: ["RS256"],
});

// Authorization middleware to check for required scopes
const requireScope = (requiredScope: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = (req as any).auth;

    if (!auth) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message: "Unauthorized: No authentication token provided",
        },
        id: null,
      });
      return;
    }

    const scopes = auth.scp ? auth.scp.split(" ") : [];

    if (!scopes.includes(requiredScope)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32002,
          message: `Forbidden: Required scope '${requiredScope}' not found`,
        },
        id: null,
      });
      return;
    }

    next();
  };
};

const transport: StreamableHTTPServerTransport =
  new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // set to undefined for stateless servers
  });

// Setup routes for the server
const setupServer = async () => {
  await server.connect(transport);
};

// OAuth metadata endpoint (RFC 8414)
app.get(
  "/.well-known/oauth-authorization-server",
  (req: Request, res: Response) => {
    logger.debug(">>> OAuth metadata endpoint called");
    const tenantId = config.AzureAd.TenantId;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    res.json({
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      token_endpoint: tokenEndpoint,
      refresh_url: tokenEndpoint, // Power Platform custom connectors expect this field
      registration_endpoint: `${baseUrl}/oauth/register`,
      scopes_supported: [
        "mcp:tools",
        "mcp:resources",
        "mcp:prompts",
        "offline_access",
      ],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    });
  }
);

// Dynamic Client Registration endpoint (RFC 7591)
app.post("/oauth/register", (req: Request, res: Response) => {
  logger.debug(">>> OAuth registration endpoint called");
  logger.debug("Request body:", JSON.stringify(req.body, null, 2));
  const clientId = config.AzureAd.ClientId;
  const clientSecret = config.AzureAd.ClientSecret;
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  // Return the pre-registered Entra ID app details
  res.json({
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: "Dataverse MCP Server",
    redirect_uris: [
      "https://unitedstates.api.powerplatform.com/tpa/auth/redirect",
      "https://europe.api.powerplatform.com/tpa/auth/redirect",
      "https://asia.api.powerplatform.com/tpa/auth/redirect",
    ],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: `api://${clientId}/mcp:tools offline_access openid profile`,
  });
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  logger.debug(">>> Health check endpoint called");
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.post(
  "/mcp",
  checkJwt,
  requireScope("mcp:tools"),
  async (req: Request, res: Response) => {
    logger.debug("=== POST /mcp Request ===");
    logger.debug("Headers:", JSON.stringify(req.headers, null, 2));
    logger.debug("Auth info:", JSON.stringify((req as any).auth, null, 2));
    logger.debug("Body:", JSON.stringify(req.body, null, 2));
    logger.debug("========================");

    // Run the request handler within the async local storage context
    await requestContext.run(req, async () => {
      try {
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        logger.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal server error",
            },
            id: null,
          });
        }
      }
    });
  }
);

// Error handler for JWT authentication errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.name === "UnauthorizedError") {
    logger.debug("=== JWT Authentication Error ===");
    logger.debug("Error name:", err.name);
    logger.debug("Error message:", err.message);
    logger.debug("Error code:", err.code);
    logger.debug("Request URL:", req.url);
    logger.debug("Request method:", req.method);
    logger.debug(
      "Authorization header:",
      req.headers.authorization ? "Present (Bearer...)" : "Missing"
    );
    logger.debug("Full error:", JSON.stringify(err, null, 2));
    logger.debug("================================");
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message: "Unauthorized: Invalid or expired token",
        data: err.message,
      },
      id: null,
    });
  } else {
    next(err);
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  logger.debug("=== GET /mcp Request ===");
  logger.debug("Headers:", JSON.stringify(req.headers, null, 2));
  logger.debug("Query params:", JSON.stringify(req.query, null, 2));
  logger.debug("Auth header present:", !!req.headers.authorization);
  logger.debug("========================");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

app.delete("/mcp", async (req: Request, res: Response) => {
  logger.debug("=== DELETE /mcp Request ===");
  logger.debug("Headers:", JSON.stringify(req.headers, null, 2));
  logger.debug("Auth header present:", !!req.headers.authorization);
  logger.debug("===========================");
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    })
  );
});

// Start the server
const PORT = process.env.PORT || 3000;
setupServer()
  .then(() => {
    app.listen(PORT, () => {
      logger.info(`MCP Streamable HTTP Server listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    logger.error("Failed to set up the server:", error);
    process.exit(1);
  });
