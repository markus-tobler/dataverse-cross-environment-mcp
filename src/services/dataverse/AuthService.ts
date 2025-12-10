import { OboAuthProvider } from "../auth/OboAuthProvider.js";
import { InteractiveAuthProvider } from "../auth/InteractiveAuthProvider.js";
import {
  ConnectionStringParams,
  validateOAuthConnectionString,
} from "../../utils/connectionStringParser.js";
import { Request } from "express";

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
        this.connectionParams
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
    if (this.authMode === "http-obo" && this.oboAuthProvider && req) {
      return this.oboAuthProvider.getAccessToken(req);
    } else if (
      this.authMode === "stdio-interactive" &&
      this.interactiveAuthProvider
    ) {
      return this.interactiveAuthProvider.getAccessToken(
        this.config.Dataverse.url
      );
    }
    throw new Error("Authentication provider not initialized correctly.");
  }
}
