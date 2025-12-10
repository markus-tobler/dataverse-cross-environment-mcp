type MockHeadersInit = Record<string, string>;

class MockHeaders {
  private store: Map<string, string> = new Map();
  constructor(init?: MockHeadersInit) {
    if (init) {
      Object.entries(init).forEach(([k, v]) =>
        this.store.set(k.toLowerCase(), v)
      );
    }
  }
  get(name: string): string | null {
    const v = this.store.get(name.toLowerCase());
    return v ?? null;
  }
  set(name: string, value: string) {
    this.store.set(name.toLowerCase(), value);
  }
}

class MockResponse {
  status: number;
  ok: boolean;
  private _bodyText: string;
  headers: MockHeaders;

  constructor(status: number, body: any, headers?: MockHeadersInit) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this._bodyText =
      typeof body === "string" ? body : JSON.stringify(body ?? "");
    this.headers = new MockHeaders(headers);
  }

  async json() {
    return JSON.parse(this._bodyText || "{}");
  }
  async text() {
    return this._bodyText ?? "";
  }
}

export const createDataverseResponse = {
  whoAmI: (
    overrides?: Partial<{
      UserId: string;
      BusinessUnitId: string;
      OrganizationId: string;
    }>
  ) =>
    new (MockResponse as any)(
      200,
      {
        UserId: overrides?.UserId ?? "00000000-0000-0000-0000-000000000001",
        BusinessUnitId:
          overrides?.BusinessUnitId ?? "00000000-0000-0000-0000-000000000002",
        OrganizationId:
          overrides?.OrganizationId ?? "00000000-0000-0000-0000-000000000003",
      },
      { "x-ms-dop-hint": "4", "x-ms-session-token": "session-token-abc" }
    ),
  rateLimited: (retryAfterSeconds = 1) =>
    new (MockResponse as any)(
      429,
      { error: { message: "Rate limited" } },
      { "Retry-After": String(retryAfterSeconds) }
    ),
  error: (status = 400, message = "Bad Request") =>
    new (MockResponse as any)(status, { error: { message } }),
  ok: (body: any, headers?: MockHeadersInit) =>
    new (MockResponse as any)(200, body, headers),
};

export type FetchHandler = (url: string, init?: RequestInit) => Promise<any>;
let handler: FetchHandler | null = null;

export function setFetchHandler(h: FetchHandler) {
  handler = h;
}
