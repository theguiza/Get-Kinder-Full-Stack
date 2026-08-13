import { GoogleAuth, Impersonated } from "google-auth-library";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const IMPERSONATION_LIFETIME_SECONDS = 900;

// Dedicated scanner-invoker identity contract for the Gate C ClamAV Cloud Run
// foundation. This intentionally does not import or share any code path with
// the existing GCS upload-signer or parser-reader identities
// (Backend/kai/storage/gcsImpersonatedStorageClientFactory.js) - the ClamAV
// scanner-invoker principal is a distinct identity, impersonated only to mint
// short-lived Google ID tokens whose audience is the scanner Cloud Run
// service URL. No IAM binding or service account is created here; that is
// deferred to the cloud package.
export function isUsableScannerInvokerTargetPrincipal(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function classifyIdTokenFailure(error) {
  const status = error?.response?.data?.error?.status || error?.status;
  const httpStatus = error?.response?.status || error?.code;
  if (
    status === "UNAVAILABLE" ||
    status === "RESOURCE_EXHAUSTED" ||
    [429, 500, 502, 503, 504].includes(httpStatus)
  ) {
    return "provider_unavailable_rate_limited";
  }
  if (
    status === "UNAUTHENTICATED" ||
    status === "PERMISSION_DENIED" ||
    httpStatus === 401 ||
    httpStatus === 403
  ) {
    return "source_credentials_rejected";
  }
  return "unclassified_id_token_failure";
}

export function createClamavScannerIdTokenClientFactory({ targetPrincipal } = {}) {
  if (!isUsableScannerInvokerTargetPrincipal(targetPrincipal)) {
    throw new Error("ClamAV scanner-invoker target principal is unavailable.");
  }

  return Object.freeze({
    async getIdToken(targetAudience) {
      if (typeof targetAudience !== "string" || targetAudience.length === 0) {
        throw new Error("ClamAV scanner target audience is unavailable.");
      }
      try {
        const sourceClient = await new GoogleAuth({
          scopes: [CLOUD_PLATFORM_SCOPE],
        }).getClient();
        const authClient = new Impersonated({
          sourceClient,
          targetPrincipal,
          targetScopes: [CLOUD_PLATFORM_SCOPE],
          lifetime: IMPERSONATION_LIFETIME_SECONDS,
        });
        return await authClient.fetchIdToken(targetAudience);
      } catch (error) {
        if (error && typeof error === "object") {
          error._kaiClamavDiagnosticCode = classifyIdTokenFailure(error);
        }
        throw error;
      }
    },
  });
}

export const __testables = Object.freeze({
  classifyIdTokenFailure,
});
