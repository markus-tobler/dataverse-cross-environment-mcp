import {
  PublicClientApplication,
  InteractiveRequest,
  AccountInfo,
  SilentFlowRequest,
  AuthenticationResult,
} from "@azure/msal-node";
import { ConnectionStringParams } from "../../utils/connectionStringParser.js";
import { logger } from "../../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Interactive authentication provider for local OAuth flows
 * Uses MSAL PublicClientApplication with interactive browser authentication
 */
export class InteractiveAuthProvider {
  private pca: PublicClientApplication;
  private params: ConnectionStringParams;
  private account: AccountInfo | null = null;
  private tokenCachePath: string;

  constructor(params: ConnectionStringParams) {
    this.params = params;

    // Determine token cache path
    this.tokenCachePath =
      params.tokenCacheStorePath ||
      path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".dataverse-mcp",
        "token-cache.json"
      );

    // Ensure cache directory exists
    const cacheDir = path.dirname(this.tokenCachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Initialize MSAL Public Client Application
    this.pca = new PublicClientApplication({
      auth: {
        clientId: params.clientId,
        // Use 'organizations' tenant for multi-tenant apps
        authority: "https://login.microsoftonline.com/organizations",
      },
      cache: {
        cachePlugin: this.createCachePlugin(),
      },
    });
  }

  /**
   * Create a cache plugin for persistent token storage
   */
  private createCachePlugin() {
    const beforeCacheAccess = async (cacheContext: any) => {
      try {
        if (fs.existsSync(this.tokenCachePath)) {
          const cacheData = fs.readFileSync(this.tokenCachePath, "utf-8");
          cacheContext.tokenCache.deserialize(cacheData);
        }
      } catch (error) {
        logger.error("Error reading token cache:", error);
      }
    };

    const afterCacheAccess = async (cacheContext: any) => {
      if (cacheContext.cacheHasChanged) {
        try {
          const cacheData = cacheContext.tokenCache.serialize();
          fs.writeFileSync(this.tokenCachePath, cacheData, "utf-8");
        } catch (error) {
          logger.error("Error writing token cache:", error);
        }
      }
    };

    return {
      beforeCacheAccess,
      afterCacheAccess,
    };
  }

  /**
   * Get access token for Dataverse
   * Attempts silent acquisition first, falls back to interactive browser flow
   */
  async getAccessToken(dataverseUrl: string): Promise<string> {
    const scopes = [`${dataverseUrl}/.default`];

    // Try silent token acquisition first (from cache)
    if (this.account) {
      try {
        const silentRequest: SilentFlowRequest = {
          account: this.account,
          scopes: scopes,
        };

        const response = await this.pca.acquireTokenSilent(silentRequest);
        logger.info("Access token acquired silently from cache");
        return response.accessToken;
      } catch (error) {
        logger.info(
          "Silent token acquisition failed, will prompt for interactive login"
        );
      }
    }

    // Fall back to interactive browser authentication
    return await this.acquireTokenInteractive(scopes);
  }

  /**
   * Acquire token using interactive browser flow
   * Opens the system browser for user authentication
   */
  private async acquireTokenInteractive(scopes: string[]): Promise<string> {
    const interactiveRequest: InteractiveRequest = {
      scopes: scopes,
      // Note: redirectUri is not supported in interactive flow - MSAL Node uses http://localhost by default
      openBrowser: async (url: string) => {
        // Open the system default browser with the authorization URL
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        logger.info("\nOpening browser for authentication...");
        logger.info("If the browser doesn't open automatically, please visit:");
        logger.info(url);

        try {
          if (process.platform === "win32") {
            // Windows: use cmd /c start to open URL
            await execAsync(`cmd /c start "" "${url}"`);
          } else if (process.platform === "darwin") {
            // macOS
            await execAsync(`open "${url}"`);
          } else {
            // Linux
            await execAsync(`xdg-open "${url}"`);
          }
        } catch (error: any) {
          logger.error(
            `Failed to open browser automatically: ${error.message}`
          );
          logger.error("Please open the URL manually in your browser.");
        }
      },
      successTemplate:
        "<html><body><h1>Authentication successful!</h1><p>You can close this window and return to your application.</p></body></html>",
      errorTemplate:
        "<html><body><h1>Authentication failed</h1><p>Error: {{error}}</p><p>{{error_description}}</p></body></html>",
    };

    // Add login hint if username is provided
    if (this.params.username) {
      interactiveRequest.loginHint = this.params.username;
    }

    // Configure prompt behavior based on LoginPrompt setting
    if (this.params.loginPrompt === "Always") {
      interactiveRequest.prompt = "login";
    } else if (this.params.loginPrompt === "Never") {
      interactiveRequest.prompt = "none";
    } else {
      // Auto - let MSAL decide
      interactiveRequest.prompt = "select_account";
    }

    try {
      const response = await this.pca.acquireTokenInteractive(
        interactiveRequest
      );

      if (!response) {
        throw new Error("Authentication failed: No response received");
      }

      // Store account for future silent acquisitions
      if (response.account) {
        this.account = response.account;
        logger.info(
          `\nAuthentication successful! Signed in as: ${
            response.account.username || response.account.name || "Unknown"
          }`
        );
      }

      return response.accessToken;
    } catch (error: any) {
      logger.error("Interactive authentication failed:", error);
      throw new Error(
        `Authentication failed: ${error.message || "Unknown error"}`
      );
    }
  }

  /**
   * Clear cached tokens
   */
  async clearCache(): Promise<void> {
    try {
      if (fs.existsSync(this.tokenCachePath)) {
        fs.unlinkSync(this.tokenCachePath);
        logger.info("Token cache cleared");
      }
      this.account = null;
    } catch (error) {
      logger.error("Error clearing token cache:", error);
    }
  }

  /**
   * Get the current authenticated account
   */
  getAccount(): AccountInfo | null {
    return this.account;
  }

  /**
   * Initialize and validate authentication
   * Attempts to load account from cache
   */
  async initialize(): Promise<void> {
    const cache = this.pca.getTokenCache();
    const accounts = await cache.getAllAccounts();

    if (accounts.length > 0) {
      // Use the first account (or filter by username if provided)
      if (this.params.username) {
        this.account =
          accounts.find(
            (acc) =>
              acc.username.toLowerCase() === this.params.username!.toLowerCase()
          ) || accounts[0];
      } else {
        this.account = accounts[0];
      }

      logger.info(
        `Found cached account: ${
          this.account.username || this.account.name || "Unknown"
        }`
      );
    }
  }
}
