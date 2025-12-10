import { parseConnectionString } from "../connectionStringParser.js";

describe("connectionStringParser", () => {
  it("should parse a valid connection string with all parts", () => {
    const cs =
      "AuthType=OAuth;Url=https://myorg.crm.dynamics.com;Username=user@org.com;Password=pass;AppId=app-id;RedirectUri=http://localhost;LoginPrompt=Auto";
    const result = parseConnectionString(cs);
    expect(result).toEqual({
      authType: "OAuth",
      url: "https://myorg.crm.dynamics.com",
      username: "user@org.com",
      password: "pass",
      clientId: "app-id",
      redirectUri: "http://localhost",
      loginPrompt: "Auto",
      requireNewInstance: undefined,
      tokenCacheStorePath: undefined,
    });
  });

  it("should handle extra whitespace around keys and values", () => {
    const cs =
      " AuthType = OAuth ; Url = https://myorg.crm.dynamics.com ; ClientId = app-id ; RedirectUri = http://localhost ";
    const result = parseConnectionString(cs);
    expect(result).toEqual({
      authType: "OAuth",
      url: "https://myorg.crm.dynamics.com",
      clientId: "app-id",
      redirectUri: "http://localhost",
      username: undefined,
      password: undefined,
      loginPrompt: "Auto",
      requireNewInstance: undefined,
      tokenCacheStorePath: undefined,
    });
  });

  it("should handle a connection string with missing optional parts", () => {
    const cs =
      "AuthType=OAuth;Url=https://myorg.crm.dynamics.com;AppId=app-id;RedirectUri=http://localhost";
    const result = parseConnectionString(cs);
    expect(result).toEqual({
      authType: "OAuth",
      url: "https://myorg.crm.dynamics.com",
      clientId: "app-id",
      redirectUri: "http://localhost",
      username: undefined,
      password: undefined,
      loginPrompt: "Auto",
      requireNewInstance: undefined,
      tokenCacheStorePath: undefined,
    });
  });

  it("should be case-insensitive for keys", () => {
    const cs =
      "authtype=OAuth;URL=https://myorg.crm.dynamics.com;clientid=appid;replyurl=http://localhost";
    const result = parseConnectionString(cs);
    expect(result).toEqual({
      authType: "OAuth",
      url: "https://myorg.crm.dynamics.com",
      clientId: "appid",
      redirectUri: "http://localhost",
      username: undefined,
      password: undefined,
      loginPrompt: "Auto",
      requireNewInstance: undefined,
      tokenCacheStorePath: undefined,
    });
  });

  it("should throw for an empty string", () => {
    const cs = "";
    expect(() => parseConnectionString(cs)).toThrow(
      "Connection string cannot be empty"
    );
  });

  it("should handle values with equal signs", () => {
    const cs =
      "AuthType=OAuth;ClientId=app;RedirectUri=http://x;Url=https://myorg.crm.dynamics.com?a=b&c=d";
    const result = parseConnectionString(cs);
    expect(result.url).toBe("https://myorg.crm.dynamics.com?a=b&c=d");
  });
});
