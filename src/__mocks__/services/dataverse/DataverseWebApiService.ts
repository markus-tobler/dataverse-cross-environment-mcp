import { DataverseConfig } from "../../../types/dataverse.js";

// Lightweight mock of DataverseWebApiService for tests.
export class DataverseWebApiService {
  private config: DataverseConfig;
  private baseUrl: string;
  private sessionToken?: string;
  private dop: number = 1;
  private userId?: string;
  private businessUnitId?: string;
  private organizationId?: string;

  constructor(config: DataverseConfig) {
    this.config = {
      timeoutInSeconds: 30,
      maxRetries: 0,
      disableCookies: false,
      ...config,
    } as DataverseConfig;
    const version = this.config.apiVersion?.replace(/^v/i, "") || "9.2";
    this.baseUrl = `${this.config.url}/api/data/v${version}/`;
  }

  async initialize(): Promise<void> {
    const res = await this.sendRequest("WhoAmI", "GET");
    const data = await res.json();
    this.userId = data?.UserId;
    this.businessUnitId = data?.BusinessUnitId;
    this.organizationId = data?.OrganizationId;
    const dopHint = res.headers.get("x-ms-dop-hint");
    if (dopHint) this.dop = parseInt(dopHint, 10);
  }

  async sendRequest(
    path: string,
    method = "GET",
    body?: any,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const accessToken = await this.config.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.sessionToken && method === "GET")
      headers["MSCRM.SessionToken"] = this.sessionToken;
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    } as any);
    const st = (res as any).headers?.get?.("x-ms-session-token");
    if (st) this.sessionToken = st;
    return res as any;
  }

  sendRequestString(
    accessToken: string,
    method: string,
    path: string,
    body?: any,
    additionalHeaders?: Record<string, string>,
  ): Promise<string> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(additionalHeaders ?? {}),
    };
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    } as any).then((r: any) => r.text());
  }

  getAccessTokenFunc(): () => Promise<string> {
    return this.config.getAccessToken;
  }
  getUserId(): string | undefined {
    return this.userId;
  }
  getBusinessUnitId(): string | undefined {
    return this.businessUnitId;
  }
  getOrganizationId(): string | undefined {
    return this.organizationId;
  }
  getRecommendedDegreeOfParallelism(): number {
    return this.dop;
  }
  getDataverseUrl(): string {
    return this.config.url;
  }
}
