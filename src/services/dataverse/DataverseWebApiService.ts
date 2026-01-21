import { DataverseConfig, WhoAmIResponse } from "../../types/dataverse.js";
import { logger } from "../../utils/logger.js";
import { appInsightsService } from "../telemetry/ApplicationInsightsService.js";

/**
 * Service class for interacting with Dataverse Web API
 * Handles HTTP requests to Dataverse with proper authentication and retry logic
 */
export class DataverseWebApiService {
  private config: DataverseConfig;
  private baseUrl: string;
  private dataverseUrl: string;
  private sessionToken?: string;
  private recommendedDegreeOfParallelism: number = 1;
  private userId?: string;
  private businessUnitId?: string;
  private organizationId?: string;

  constructor(config: DataverseConfig) {
    this.config = {
      timeoutInSeconds: 120,
      maxRetries: 3,
      disableCookies: false,
      ...config,
    };

    this.dataverseUrl = this.config.url;
    // Remove 'v' prefix from version if present to avoid double 'v'
    const version = this.config.apiVersion?.replace(/^v/i, "") || "9.2";
    this.baseUrl = `${this.config.url}/api/data/v${version}/`;
  }

  getDataverseUrl(): string {
    return this.dataverseUrl;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  /**
   * Initialize the connection by calling WhoAmI
   */
  async initialize(): Promise<void> {
    try {
      const response = await this.sendRequest("WhoAmI", "GET");
      const data = (await response.json()) as WhoAmIResponse;

      this.userId = data.UserId;
      this.businessUnitId = data.BusinessUnitId;
      this.organizationId = data.OrganizationId;

      // Get recommended degree of parallelism if available
      const dopHint = response.headers.get("x-ms-dop-hint");
      if (dopHint) {
        this.recommendedDegreeOfParallelism = parseInt(dopHint, 10);
      }

      logger.info(
        `Successfully connected to Dataverse. User ID: ${this.userId}, Organization ID: ${this.organizationId}`,
      );
    } catch (error) {
      logger.exception(
        "Failed to initialize service with WhoAmI request",
        error,
        {
          component: "DataverseWebApiService",
          operation: "initialize",
        },
      );
      throw new Error("Failed to initialize Dataverse Web API service");
    }
  }

  /**
   * Send an HTTP request to Dataverse Web API.
   * Only retries on 429 (rate limiting) responses.
   */
  async sendRequest(
    path: string,
    method: string = "GET",
    body?: any,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
      const accessToken = await this.config.getAccessToken();

      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      // Add session token for GET requests (elastic tables strong consistency)
      if (this.sessionToken && method === "GET") {
        headers["MSCRM.SessionToken"] = this.sessionToken;
      }

      const options: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.config.timeoutInSeconds! * 1000),
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      // Capture session token if present
      const sessionToken = response.headers.get("x-ms-session-token");
      if (sessionToken) {
        this.sessionToken = sessionToken;
      }

      // Handle 429 (Too Many Requests) with retry
      if (response.status === 429) {
        if (attempt === this.config.maxRetries) {
          throw new Error("Rate limit exceeded after maximum retries");
        }
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt) * 1000;

        logger.warn(
          `Rate limited (429). Retrying after ${waitTime / 1000} seconds...`,
        );
        await this.sleep(waitTime);
        continue;
      }

      // Handle other HTTP errors (no retry)
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Dataverse API request failed with status ${response.status}: ${errorText}`,
        );
      }

      return response;
    }

    throw new Error("Failed to send request to Dataverse");
  }

  /**
   * Send an HTTP request and return response as string.
   * Only retries on 429 (rate limiting) responses.
   */
  async sendRequestString(
    accessToken: string,
    method: string,
    path: string,
    body?: any,
    additionalHeaders?: Record<string, string>,
  ): Promise<string> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= this.config.maxRetries!; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Accept: "application/json",
        "Content-Type": "application/json",
      };

      // Add session token for GET requests (elastic tables strong consistency)
      if (this.sessionToken && method === "GET") {
        headers["MSCRM.SessionToken"] = this.sessionToken;
      }

      // Merge additional headers if provided
      if (additionalHeaders) {
        Object.assign(headers, additionalHeaders);
      }

      const options: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.config.timeoutInSeconds! * 1000),
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      // Capture session token if present
      const sessionToken = response.headers.get("x-ms-session-token");
      if (sessionToken) {
        this.sessionToken = sessionToken;
      }

      // Handle 429 (Too Many Requests) with retry
      if (response.status === 429) {
        if (attempt === this.config.maxRetries) {
          throw new Error("Rate limit exceeded after maximum retries");
        }
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.pow(2, attempt) * 1000;

        logger.warn(
          `Rate limited (429). Retrying after ${waitTime / 1000} seconds...`,
        );
        await this.sleep(waitTime);
        continue;
      }

      // Handle other HTTP errors (no retry)
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Dataverse API request failed with status ${response.status}: ${errorText}`,
        );
      }

      return await response.text();
    }

    throw new Error("Failed to send request to Dataverse");
  }

  /**
   * Get the access token function
   */
  getAccessTokenFunc(): () => Promise<string> {
    return this.config.getAccessToken;
  }

  /**
   * Helper method to sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the business unit ID
   */
  getBusinessUnitId(): string | undefined {
    return this.businessUnitId;
  }

  /**
   * Get the organization ID
   */
  getOrganizationId(): string | undefined {
    return this.organizationId;
  }

  /**
   * Get recommended degree of parallelism
   */
  getRecommendedDegreeOfParallelism(): number {
    return this.recommendedDegreeOfParallelism;
  }

  /**
   * Create a new record in Dataverse
   */
  async createRecord(entitySetName: string, data: any): Promise<Response> {
    return this.sendRequest(entitySetName, "POST", data);
  }

  /**
   * Update an existing record in Dataverse
   */
  async updateRecord(
    entitySetName: string,
    recordId: string,
    data: any,
  ): Promise<Response> {
    return this.sendRequest(`${entitySetName}(${recordId})`, "PATCH", data);
  }

  /**
   * Retrieve records by attribute value (filter query)
   */
  async retrieveRecordByAlternateKey(
    entitySetName: string,
    attributeName: string,
    value: string,
  ): Promise<any> {
    const response = await this.sendRequest(
      `${entitySetName}?$filter=${attributeName} eq '${value}'&$top=2`,
      "GET",
    );
    if (response.ok) {
      return response.json();
    }
    return null;
  }

  /**
   * Get the organization's base currency ID
   */
  async getOrganizationBaseCurrencyId(): Promise<string> {
    const response = await this.sendRequest(
      `organizations(${this.organizationId})?$select=_basecurrencyid_value`,
      "GET",
    );
    if (response.ok) {
      const org = await response.json();
      return org["_basecurrencyid_value"];
    }
    throw new Error("Failed to retrieve organization's base currency.");
  }
}
