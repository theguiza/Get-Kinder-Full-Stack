import { Storage } from "@google-cloud/storage";
import { GoogleAuth, Impersonated } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

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
