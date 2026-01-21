import {
  ConfidentialClientApplication,
  OnBehalfOfRequest,
} from "@azure/msal-node";
import { ManagedIdentityCredential } from "@azure/identity";
import { Request } from "express";
import * as jwt from "jsonwebtoken";
import { logger } from "../../utils/logger.js";

/**
 * On-Behalf-Of (OBO) authentication provider for HTTP server mode
 * Uses the user's token to acquire a Dataverse token via OBO flow
 */
export class OboAuthProvider {
  private confidentialClient: ConfidentialClientApplication;
  private dataverseUrl: string;
  private useManagedIdentity: boolean;
  private managedIdentityCredential?: ManagedIdentityCredential;
  private clientId: string;
  private authority: string;
  private tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(config: any) {
    this.dataverseUrl = config.Dataverse.Url;
    this.clientId = config.AzureAd.ClientId;
    this.authority = `${config.AzureAd.Instance}${config.AzureAd.TenantId}`;
    this.useManagedIdentity = !config.AzureAd.ClientSecret;

    if (this.useManagedIdentity) {
      // Use Managed Identity credential with the Managed Identity Client ID
      const managedIdentityClientId =
        config.AzureAd.ManagedIdentityClientId || process.env.AZURE_CLIENT_ID;
      if (!managedIdentityClientId) {
        throw new Error(
          "AZURE_CLIENT_ID environment variable is required when using Managed Identity",
        );
      }
      this.managedIdentityCredential = new ManagedIdentityCredential(
        managedIdentityClientId,
      );

      // Create MSAL client with client assertion callback
      const msalConfig = {
        auth: {
          clientId: this.clientId,
          authority: this.authority,
          clientAssertion: async () => {
            return await this.getClientAssertion();
          },
        },
      };

      this.confidentialClient = new ConfidentialClientApplication(msalConfig);
    } else {
      // Use client secret
      const msalConfig = {
        auth: {
          clientId: this.clientId,
          authority: this.authority,
          clientSecret: config.AzureAd.ClientSecret,
        },
      };

      this.confidentialClient = new ConfidentialClientApplication(msalConfig);
    }
  }

  /**
   * Generate a client assertion using Managed Identity
   */
  private async getClientAssertion(): Promise<string> {
    if (!this.managedIdentityCredential) {
      throw new Error("Managed Identity credential not initialized");
    }

    try {
      // Request a token for the App Registration (client assertion)
      // The scope must be the App Registration's Application ID URI or client ID
      // This is what allows the Managed Identity to authenticate as the App Registration
      const scope = `api://AzureADTokenExchange`;

      logger.debug(`Requesting client assertion token with scope: ${scope}`);

      const tokenResponse =
        await this.managedIdentityCredential.getToken(scope);

      if (!tokenResponse || !tokenResponse.token) {
        throw new Error("Failed to acquire token from Managed Identity");
      }

      logger.debug(
        "Successfully acquired client assertion from Managed Identity",
      );
      return tokenResponse.token;
    } catch (error) {
      logger.exception(
        "Error acquiring client assertion from Managed Identity",
        error,
        {
          component: "OboAuthProvider",
          operation: "getClientAssertion",
        },
      );
      throw error;
    }
  }

  /**
   * Validate the user's access token
   */
  private async validateUserToken(token: string): Promise<any> {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded !== "object" || !decoded.payload) {
        throw new Error("Invalid token structure");
      }
      const payload = decoded.payload as jwt.JwtPayload;

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("Token has expired");
      }

      // Basic checks for Azure AD token
      if (!payload.iss || !payload.aud || !payload.sub) {
        throw new Error("Token missing required claims");
      }

      // For Azure AD, issuer should be from a valid Microsoft identity endpoint
      const validIssuers = [
        "login.microsoftonline.com",
        "sts.windows.net",
        "login.windows.net",
        "login.microsoft.com",
      ];

      const isValidIssuer = validIssuers.some((issuer) =>
        payload.iss!.toLowerCase().includes(issuer),
      );

      if (!isValidIssuer) {
        logger.warn(`Token issuer not recognized: ${payload.iss}`);
        // Don't throw - let MSAL validate during OBO flow
      }

      return payload;
    } catch (error) {
      logger.exception("Token validation failed", error, {
        component: "OboAuthProvider",
        operation: "validateUserToken",
      });
      throw new Error("Invalid user token");
    }
  }

  /**
   * Get access token for Dataverse using OBO flow
   */
  async getAccessToken(req: Request): Promise<string> {
    try {
      // Extract the user's token from the request
      const userToken = req.headers.authorization?.replace("Bearer ", "");
      if (!userToken) {
        throw new Error("No authorization token found in request");
      }

      // Validate the user token
      const userPayload = await this.validateUserToken(userToken);
      const userId = userPayload.sub || userPayload.oid; // Use sub or oid as user identifier
      if (!userId) {
        throw new Error("Unable to identify user from token");
      }

      // Check cache for existing token
      const cached = this.tokenCache.get(userId);
      const now = Date.now();
      const bufferTime = 5 * 60 * 1000; // 5 minutes buffer before expiration

      if (cached && cached.expiresAt > now + bufferTime) {
        logger.debug(`Using cached Dataverse token for user ${userId}`);
        return cached.token;
      }

      // Acquire new token via OBO flow
      const oboRequest: OnBehalfOfRequest = {
        oboAssertion: userToken,
        scopes: [`${this.dataverseUrl}/.default`],
      };

      const response =
        await this.confidentialClient.acquireTokenOnBehalfOf(oboRequest);

      if (!response || !response.accessToken || !response.expiresOn) {
        throw new Error("Failed to acquire Dataverse token via OBO flow");
      }

      // Cache the token
      this.tokenCache.set(userId, {
        token: response.accessToken,
        expiresAt: response.expiresOn.getTime(),
      });

      logger.debug(
        `Acquired and cached Dataverse access token for user ${userId} via OBO flow`,
      );
      return response.accessToken;
    } catch (error) {
      logger.exception("Error acquiring token via OBO flow", error, {
        component: "OboAuthProvider",
        operation: "getAccessToken",
      });
      throw error;
    }
  }
}
