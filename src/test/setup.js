// Jest setup: mock global fetch and minimal Response/Headers as needed (plain JS)

class MockHeaders {
  constructor(init) {
    this.store = new Map();
    if (init) {
      Object.entries(init).forEach(([k, v]) => this.store.set(k.toLowerCase(), v));
    }
  }
  get(name) {
    const v = this.store.get(name.toLowerCase());
    return v ?? null;
  }
  set(name, value) {
    this.store.set(name.toLowerCase(), value);
  }
}

class MockResponse {
  constructor(status, body, headers) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this._bodyText = typeof body === 'string' ? body : JSON.stringify(body ?? '');
    this.headers = new MockHeaders(headers);
  }
  async json() { return JSON.parse(this._bodyText || '{}'); }
  async text() { return this._bodyText ?? ''; }
}

const createDataverseResponse = {
  whoAmI: (overrides) => new MockResponse(200, {
    UserId: overrides?.UserId ?? '00000000-0000-0000-0000-000000000001',
    BusinessUnitId: overrides?.BusinessUnitId ?? '00000000-0000-0000-0000-000000000002',
    OrganizationId: overrides?.OrganizationId ?? '00000000-0000-0000-0000-000000000003',
  }, { 'x-ms-dop-hint': '4', 'x-ms-session-token': 'session-token-abc' }),
  rateLimited: (retryAfterSeconds = 1) => new MockResponse(429, { error: { message: 'Rate limited' } }, { 'Retry-After': String(retryAfterSeconds) }),
  error: (status = 400, message = 'Bad Request') => new MockResponse(status, { error: { message } }),
  ok: (body, headers) => new MockResponse(200, body, headers),
};

let handler = null;
function setFetchHandler(h) { handler = h; }

global.Headers = MockHeaders;
global.Response = MockResponse;
global.fetch = jest.fn(async (url, init) => {
  if (!handler) return new MockResponse(404, { error: { message: 'Not Found' } });
  return handler(url, init);
});

if (!AbortSignal.timeout) {
  AbortSignal.timeout = function (ms) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

// attach helpers if needed
global.__dv_createResponse = createDataverseResponse;
global.__dv_setFetchHandler = setFetchHandler;
