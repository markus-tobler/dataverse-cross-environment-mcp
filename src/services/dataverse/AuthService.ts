import { OboAuthProvider } from "../auth/OboAuthProvider.js";
import { InteractiveAuthProvider } from "../auth/InteractiveAuthProvider.js";
import {
  ConnectionStringParams,
  validateOAuthConnectionString,
} from "../../utils/connectionStringParser.js";
import { Request } from "express";
import { logger } from "../../utils/logger.js";

export type AuthMode = "http-obo" | "stdio-interactive";

export class AuthService {
  private config: any;
  private authMode: AuthMode;
  private oboAuthProvider?: OboAuthProvider;
  private interactiveAuthProvider?: InteractiveAuthProvider;
  private connectionParams?: ConnectionStringParams;

  constructor(configOrParams: any) {
    if (this.isConnectionStringParams(configOrParams)) {
      this.authMode = "stdio-interactive";
      this.connectionParams = configOrParams;
      validateOAuthConnectionString(this.connectionParams);
      this.config = {
        Dataverse: {
          url: this.connectionParams.url,
          apiVersion: "v9.2",
        },
      };
      this.interactiveAuthProvider = new InteractiveAuthProvider(
        this.connectionParams,
      );
    } else {
      this.authMode = "http-obo";
      this.config = configOrParams;
      this.oboAuthProvider = new OboAuthProvider(this.config);
    }
  }

  private isConnectionStringParams(obj: any): obj is ConnectionStringParams {
    return (
      obj &&
      typeof obj === "object" &&
      "authType" in obj &&
      "url" in obj &&
      "clientId" in obj &&
      "redirectUri" in obj
    );
  }

  async initialize(): Promise<void> {
    if (this.authMode === "stdio-interactive" && this.interactiveAuthProvider) {
      await this.interactiveAuthProvider.initialize();
    }
  }

  getAuthMode(): AuthMode {
    return this.authMode;
  }

  getConfig(): any {
    return this.config;
  }

  async getAccessToken(req?: Request): Promise<string> {
    logger.debug("[AuthService] Acquiring access token", {
      hasRequest: !!req,
      authMode: this.authMode,
    });

    try {
      let token: string;

      if (this.authMode === "http-obo" && this.oboAuthProvider && req) {
        token = await this.oboAuthProvider.getAccessToken(req);
      } else if (
        this.authMode === "stdio-interactive" &&
        this.interactiveAuthProvider
      ) {
        token = await this.interactiveAuthProvider.getAccessToken(
          this.config.Dataverse.url,
        );
      } else {
        throw new Error("Authentication provider not initialized correctly.");
      }

      logger.debug("[AuthService] Access token acquired successfully");
      return token;
    } catch (error) {
      logger.exception("[AuthService] Failed to acquire access token", error);
      throw error;
    }
  }
}
