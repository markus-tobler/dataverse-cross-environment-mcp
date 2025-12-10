// Jest setup: mock global fetch and minimal Response/Headers as needed

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

// Helper to create common Dataverse mock responses
export const createDataverseResponse = {
  whoAmI: (
    overrides?: Partial<{
      UserId: string;
      BusinessUnitId: string;
      OrganizationId: string;
    }>
  ) =>
    new MockResponse(
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
    new MockResponse(
      429,
      { error: { message: "Rate limited" } },
      { "Retry-After": String(retryAfterSeconds) }
    ),
  error: (status = 400, message = "Bad Request") =>
    new MockResponse(status, { error: { message } }),
  ok: (body: any, headers?: MockHeadersInit) =>
    new MockResponse(200, body, headers),
};

// Global fetch mock with programmable handler
type FetchHandler = (url: string, init?: RequestInit) => Promise<MockResponse>;
let handler: FetchHandler | null = null;

export function setFetchHandler(h: FetchHandler) {
  handler = h;
}

// @ts-ignore
global.Headers = MockHeaders as any;
// @ts-ignore
global.Response = MockResponse as any;
// @ts-ignore
global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
  if (!handler) {
    // Default: respond with 404 for unexpected requests
    return new MockResponse(404, { error: { message: "Not Found" } });
  }
  return handler(url, init);
});

// AbortSignal.timeout polyfill for Node/Jest if missing
if (!(AbortSignal as any).timeout) {
  // @ts-ignore
  (AbortSignal as any).timeout = function (ms: number) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}
