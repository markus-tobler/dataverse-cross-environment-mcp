/**
 * Connection string parser for XRM Tooling-style Dataverse connection strings
 * Supports the format used by Microsoft.PowerPlatform.Dataverse.Client
 */

export interface ConnectionStringParams {
  authType: string;
  url: string;
  username?: string;
  password?: string;
  clientId: string;
  redirectUri: string;
  loginPrompt: "Auto" | "Always" | "Never";
  requireNewInstance?: boolean;
  tokenCacheStorePath?: string;
}

/**
 * Parse a Dataverse connection string into structured parameters
 * Format: "Key1=Value1;Key2=Value2;..."
 * Keys are case-insensitive
 *
 * Example:
 * AuthType=OAuth;Url=https://org.crm.dynamics.com/;Username=user@domain.com;ClientId=xxx;RedirectUri=http://localhost/;LoginPrompt=Auto
 */
export function parseConnectionString(
  connectionString: string
): ConnectionStringParams {
  if (!connectionString || connectionString.trim() === "") {
    throw new Error("Connection string cannot be empty");
  }

  const params: Record<string, string> = {};

  // Split by semicolon and parse key=value pairs
  const parts = connectionString.split(";");

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;

    const separatorIndex = trimmedPart.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid connection string format: missing '=' in '${trimmedPart}'`
      );
    }

    const key = trimmedPart.substring(0, separatorIndex).trim().toLowerCase();
    const value = trimmedPart.substring(separatorIndex + 1).trim();

    params[key] = value;
  }

  // Validate and extract required parameters
  const authType = getParam(params, ["authtype", "authenticationtype"]);
  if (!authType) {
    throw new Error(
      "Connection string must include 'AuthType' or 'AuthenticationType'"
    );
  }

  const url = getParam(params, ["url", "serviceuri", "service uri", "server"]);
  if (!url) {
    throw new Error(
      "Connection string must include 'Url', 'ServiceUri', or 'Server'"
    );
  }

  const clientId = getParam(params, ["clientid", "appid", "applicationid"]);
  if (!clientId) {
    throw new Error(
      "Connection string must include 'ClientId', 'AppId', or 'ApplicationId'"
    );
  }

  const redirectUri = getParam(params, ["redirecturi", "replyurl"]);
  if (!redirectUri) {
    throw new Error(
      "Connection string must include 'RedirectUri' or 'ReplyUrl'"
    );
  }

  // Optional parameters
  const username = getParam(params, [
    "username",
    "user name",
    "userid",
    "user id",
  ]);
  const password = getParam(params, ["password"]);
  const loginPromptValue = getParam(params, ["loginprompt"]);
  const requireNewInstanceValue = getParam(params, ["requirenewinstance"]);
  const tokenCacheStorePath = getParam(params, ["tokencachestorepath"]);

  // Validate LoginPrompt value
  let loginPrompt: "Auto" | "Always" | "Never" = "Auto";
  if (loginPromptValue) {
    const normalizedPrompt = loginPromptValue.toLowerCase();
    if (normalizedPrompt === "auto") {
      loginPrompt = "Auto";
    } else if (normalizedPrompt === "always") {
      loginPrompt = "Always";
    } else if (normalizedPrompt === "never") {
      loginPrompt = "Never";
    } else {
      throw new Error(
        `Invalid LoginPrompt value: '${loginPromptValue}'. Valid values are: Auto, Always, Never`
      );
    }
  }

  // Parse boolean for RequireNewInstance
  let requireNewInstance: boolean | undefined = undefined;
  if (requireNewInstanceValue) {
    const normalizedValue = requireNewInstanceValue.toLowerCase();
    if (normalizedValue === "true") {
      requireNewInstance = true;
    } else if (normalizedValue === "false") {
      requireNewInstance = false;
    } else {
      throw new Error(
        `Invalid RequireNewInstance value: '${requireNewInstanceValue}'. Valid values are: true, false`
      );
    }
  }

  return {
    authType,
    url,
    username,
    password,
    clientId,
    redirectUri,
    loginPrompt,
    requireNewInstance,
    tokenCacheStorePath,
  };
}

/**
 * Get parameter value by checking multiple possible key names (case-insensitive)
 */
function getParam(
  params: Record<string, string>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const normalizedKey = key.toLowerCase();
    if (params[normalizedKey] !== undefined) {
      return params[normalizedKey];
    }
  }
  return undefined;
}

/**
 * Validate that the connection string is for OAuth authentication
 */
export function validateOAuthConnectionString(
  params: ConnectionStringParams
): void {
  if (params.authType.toLowerCase() !== "oauth") {
    throw new Error(
      `Only OAuth authentication is supported for local execution. AuthType '${params.authType}' is not supported.`
    );
  }

  // Validate URL format
  try {
    new URL(params.url);
  } catch (error) {
    throw new Error(`Invalid Url format: '${params.url}'`);
  }

  // Validate RedirectUri format
  try {
    new URL(params.redirectUri);
  } catch (error) {
    throw new Error(`Invalid RedirectUri format: '${params.redirectUri}'`);
  }

  // Validate ClientId is a GUID
  const guidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guidRegex.test(params.clientId)) {
    throw new Error(`ClientId must be a valid GUID. Got: '${params.clientId}'`);
  }
}
