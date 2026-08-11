import { Storage } from "@google-cloud/storage";
import { GoogleAuth, Impersonated } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGES = new Set([
  "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.",
  "Unable to find credentials in current environment. \nTo learn more about authentication and Google APIs, visit: \nhttps://cloud.google.com/docs/authentication/getting-started",
]);

export function isUsableGcsTargetPrincipal(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createImpersonatedStorageClient({ targetPrincipal } = {}) {
  if (!isUsableGcsTargetPrincipal(targetPrincipal)) {
    throw new Error("GCS target principal is unavailable.");
  }
  const sourceClient = await new GoogleAuth({
    scopes: [CLOUD_PLATFORM_SCOPE],
  }).getClient();
  wrapSourceCredentialDiagnostics(sourceClient);
  const authClient = new Impersonated({
    sourceClient,
    targetPrincipal,
    targetScopes: [CLOUD_PLATFORM_SCOPE],
    lifetime: 900,
  });
  const storage = new Storage({ authClient });
  storage.authClient.authorizeRequest = async (reqOpts) => {
    const authHeaders = await authClient.getRequestHeaders();
    const normalizedAuthHeaders =
      typeof authHeaders?.entries === "function" ? Object.fromEntries(authHeaders.entries()) : authHeaders;
    return {
      ...reqOpts,
      headers: {
        ...(reqOpts.headers || {}),
        ...normalizedAuthHeaders,
      },
    };
  };
  storage._kaiGcsSigner = authClient;
  storage._kaiGcsSigningPrincipal = targetPrincipal;
  return storage;
}

export function createImpersonatedStorageClientFactory({ targetPrincipal } = {}) {
  return () => createImpersonatedStorageClient({ targetPrincipal });
}

function providerStatus(error) {
  const value = error?.response?.data?.error?.status || error?.status;
  return typeof value === "string" && /^[A-Z_]{1,64}$/.test(value) ? value : null;
}

function providerHttpStatus(error) {
  for (const value of [error?.response?.status, error?.status, error?.code, error?.response?.data?.error?.code]) {
    if (Number.isSafeInteger(value) && value >= 100 && value <= 599) return value;
  }
  return null;
}

function sourceCredentialDiagnosticCode(error) {
  if (SOURCE_CREDENTIAL_UNAVAILABLE_MESSAGES.has(error?.message)) return "source_credentials_unavailable";
  const status = providerStatus(error);
  const httpStatus = providerHttpStatus(error);
  if (status === "UNAVAILABLE" || status === "RESOURCE_EXHAUSTED" || [429, 500, 502, 503, 504].includes(httpStatus)) {
    return "provider_unavailable_rate_limited";
  }
  if (status === "UNAUTHENTICATED" || status === "PERMISSION_DENIED" || httpStatus === 401 || httpStatus === 403) {
    return "source_credentials_rejected";
  }
  return "unclassified_signing_failure";
}

function wrapSourceCredentialDiagnostics(sourceClient) {
  if (!sourceClient || typeof sourceClient.getAccessToken !== "function" || sourceClient._kaiGcsSourceCredentialWrapped) {
    return;
  }
  const originalGetAccessToken = sourceClient.getAccessToken.bind(sourceClient);
  sourceClient.getAccessToken = async (...args) => {
    try {
      return await originalGetAccessToken(...args);
    } catch (error) {
      if (error && typeof error === "object") {
        error._kaiGcsDiagnostic = {
          diagnostic_code: sourceCredentialDiagnosticCode(error),
          provider_http_status: providerHttpStatus(error),
          provider_status: providerStatus(error),
        };
      }
      throw error;
    }
  };
  sourceClient._kaiGcsSourceCredentialWrapped = true;
}
