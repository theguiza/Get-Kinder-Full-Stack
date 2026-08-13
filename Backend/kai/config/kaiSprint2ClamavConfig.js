import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "./kaiSprint2P0Contract.js";

// Gate C ClamAV Cloud Run foundation: smallest non-secret configuration-key
// definitions. Nothing here contacts the scanner, selects a runtime factory,
// or enables the adapter for the running application - it only ever computes
// a fail-closed config fact.
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 30000;
const MAX_TARGET_PRINCIPAL_LENGTH = 320;
const MAX_SCANNER_URL_LENGTH = 2048;

function isUsableScannerUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SCANNER_URL_LENGTH) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

// Dedicated scanner-invoker identity contract: this must never be the
// existing GCS upload-signer or parser-reader target principal. Only shape
// validation happens here - the identity itself is resolved elsewhere.
function isUsableScannerInvokerTargetPrincipal(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TARGET_PRINCIPAL_LENGTH;
}

function readTimeoutMs(env) {
  const raw = Number.parseInt(env.KAI_GATE_C_CLAMAV_SCAN_TIMEOUT_MS, 10);
  if (!Number.isFinite(raw) || raw < MIN_TIMEOUT_MS || raw > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return raw;
}

// Missing or malformed configuration fails closed: returns { ok: false }
// rather than throwing, so a misconfigured environment never crashes request
// handling and never selects the ClamAV adapter or performs any network or
// auth activity - it simply leaves production on the not_configured default.
export function readKaiGateCClamavConfig(env = process.env) {
  const scannerUrl = env.KAI_GATE_C_CLAMAV_SCANNER_URL;
  if (!isUsableScannerUrl(scannerUrl)) {
    return { ok: false, reason: "missing_or_malformed_scanner_url" };
  }

  const scannerInvokerTargetPrincipal = env.KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL;
  if (!isUsableScannerInvokerTargetPrincipal(scannerInvokerTargetPrincipal)) {
    return { ok: false, reason: "missing_or_malformed_scanner_invoker_target_principal" };
  }

  return {
    ok: true,
    scannerUrl,
    scannerInvokerTargetPrincipal,
    timeoutMs: readTimeoutMs(env),
    maxBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
  };
}

export function isKaiGateCClamavScannerConfigured(env = process.env) {
  return readKaiGateCClamavConfig(env).ok === true;
}

export const __testables = Object.freeze({
  isUsableScannerUrl,
  isUsableScannerInvokerTargetPrincipal,
});
