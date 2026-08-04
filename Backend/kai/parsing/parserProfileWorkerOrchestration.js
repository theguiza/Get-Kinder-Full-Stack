import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { profileLocalTrustedFile } from "../profiling/localProfilingKernel.js";
import { runPdfProfilingWorkerBoundary } from "../validators/pdfAssessorWorkerBoundary.js";

/**
 * KAI P1-03 dormant parser/profile worker orchestration.
 *
 * This module contains no SQL, imports no database pool, and holds no transaction
 * or row-locking logic: every persistence step is delegated to the injected P1-03
 * parser-run repository. It registers no route, listener, scheduler, timer, startup
 * hook, or polling loop, is not exported from any barrel, and is not composed into
 * any production path. Exact object-version bytes are read through the existing
 * storage byte-source seam, held only for the duration of one deterministic
 * profiler call, and are never persisted, returned, logged, or audited.
 *
 * Scope of a completed run is exactly: deterministic profiler completion, one
 * metadata-only/redacted profile, its canonical hash, the linked output profile,
 * and the existing required metadata-only audit. Sensitivity, dictionary, review,
 * source, evidence, claim, and generation records are out of scope and are never
 * created here.
 */

const LOCAL_PROFILING_KERNEL_PARSER = Object.freeze({
  parserName: "kai_local_profiling_kernel",
  parserVersion: "1.0.0",
});

const PDF_PROFILING_WORKER_PARSER = Object.freeze({
  parserName: "kai_pdf_profiling_worker_boundary",
  parserVersion: "1.0.0",
});

const PARSER_REGISTRY = Object.freeze({
  ".csv": LOCAL_PROFILING_KERNEL_PARSER,
  ".xlsx": LOCAL_PROFILING_KERNEL_PARSER,
  ".md": LOCAL_PROFILING_KERNEL_PARSER,
  ".txt": LOCAL_PROFILING_KERNEL_PARSER,
  ".pdf": PDF_PROFILING_WORKER_PARSER,
});

const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;
const UNSAFE_ERROR_MESSAGE_PATTERN =
  /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;
const FALLBACK_ERROR_CODE = "safe_parser_error";
const FALLBACK_ERROR_MESSAGE = "Deterministic profiling could not safely profile this file.";
const BYTE_SOURCE_ERROR_CODE = "byte_source_unavailable";
const BYTE_SOURCE_ERROR_MESSAGE = "The exact object version could not be read for deterministic profiling.";
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

const WORKER_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  system_error: 500,
});

function workerFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: WORKER_RESULT_STATUS[code],
    },
  };
}

function workerSuccess(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

/**
 * Trusted, already-confirmed intake-file facts. This orchestration never derives
 * these from a request body, and never reads or returns storage paths or URLs.
 */
function isTrustedProfilingFileFacts(value) {
  const allowedKeys = new Set([
    "organizationId",
    "intakeFileId",
    "objectVersionId",
    "checksum",
    "verifiedSizeBytes",
    "declaredMime",
    "extension",
  ]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeFileId) &&
    isNonEmptyString(value.objectVersionId) &&
    typeof value.checksum === "string" &&
    CHECKSUM_PATTERN.test(value.checksum) &&
    Number.isSafeInteger(value.verifiedSizeBytes) &&
    value.verifiedSizeBytes >= 1 &&
    isNonEmptyString(value.declaredMime) &&
    value.declaredMime.trim().toLowerCase() === value.declaredMime &&
    isNonEmptyString(value.extension) &&
    value.extension.startsWith(".") &&
    value.extension.toLowerCase() === value.extension &&
    Object.hasOwn(PARSER_REGISTRY, value.extension)
  );
}

function validateQueueInput(input) {
  const allowedKeys = new Set(["trustedFileFacts", "now"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isTrustedProfilingFileFacts(input.trustedFileFacts) && isNormalizedNow(input.now);
}

function validateExecutionInput(input) {
  const allowedKeys = new Set(["trustedFileFacts", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isTrustedProfilingFileFacts(input.trustedFileFacts) &&
    isNormalizedNow(input.now) &&
    Boolean(input.metadataOnlyAudit) &&
    typeof input.metadataOnlyAudit.prepareMetadataOnlyAudit === "function"
  );
}

function parserRunIdentity(trustedFileFacts) {
  const parser = PARSER_REGISTRY[trustedFileFacts.extension];
  return {
    organizationId: trustedFileFacts.organizationId,
    intakeFileId: trustedFileFacts.intakeFileId,
    parserName: parser.parserName,
    parserVersion: parser.parserVersion,
    checksum: trustedFileFacts.checksum,
  };
}

function safeErrorCode(candidate) {
  if (typeof candidate === "string" && SAFE_ERROR_CODE_PATTERN.test(candidate)) return candidate;
  return FALLBACK_ERROR_CODE;
}

function safeErrorMessage(candidate) {
  if (
    typeof candidate === "string" &&
    candidate.length >= 1 &&
    candidate.length <= 500 &&
    !UNSAFE_ERROR_MESSAGE_PATTERN.test(candidate)
  ) {
    return candidate;
  }
  return FALLBACK_ERROR_MESSAGE;
}

/**
 * Invoke the existing deterministic profiler for this trusted file. CSV, XLSX,
 * Markdown, and TXT use the installed local profiling kernel; machine-readable PDF
 * uses the installed governed PDF profiling worker boundary. No new profiler,
 * parser, or OCR path is introduced.
 */
async function invokeDeterministicProfiler(trustedFileFacts, bytes) {
  const profilerInput = {
    extension: trustedFileFacts.extension,
    declaredMime: trustedFileFacts.declaredMime,
    byteSize: bytes.byteLength,
    bytes,
  };
  if (trustedFileFacts.extension === ".pdf") {
    return await runPdfProfilingWorkerBoundary(profilerInput);
  }
  return await profileLocalTrustedFile(profilerInput);
}

function profilerOutcome(result) {
  if (isPlainObject(result) && result.status === "profiled") {
    return { profiled: true, profile: result };
  }
  if (isPlainObject(result) && result.status === "not_profilable") {
    return {
      profiled: false,
      errorCode: safeErrorCode(result.reason),
      errorMessageSafe: safeErrorMessage("Deterministic profiling produced no profile for this file."),
    };
  }
  return {
    profiled: false,
    errorCode: safeErrorCode(isPlainObject(result) ? result?.error?.category : undefined),
    errorMessageSafe: safeErrorMessage(isPlainObject(result) ? result?.error?.safe_message : undefined),
  };
}

export function createParserProfileWorkerOrchestration({
  parserRunRepository,
  objectVersionByteSource,
  env = process.env,
} = {}) {
  if (!parserRunRepository || typeof parserRunRepository.ensureQueuedParserRun !== "function") {
    throw new TypeError("createParserProfileWorkerOrchestration requires an injected parser-run repository.");
  }
  if (!objectVersionByteSource || typeof objectVersionByteSource.readObjectVersion !== "function") {
    throw new TypeError("createParserProfileWorkerOrchestration requires an injected object-version byte source.");
  }

  async function claimAndProfile({ trustedFileFacts, now, metadataOnlyAudit }) {
    const identity = parserRunIdentity(trustedFileFacts);
    const claim = await parserRunRepository.claimQueuedParserRun({ identity, now, metadataOnlyAudit });
    if (!claim.ok) return claim;

    const parserRunId = claim.data.run.parser_run_id;

    const read = await objectVersionByteSource.readObjectVersion({
      objectVersionId: trustedFileFacts.objectVersionId,
    });
    if (!read?.ok || !isPlainObject(read.data) || !(read.data.bytes instanceof Uint8Array)) {
      return await parserRunRepository.failParserRunSafely({
        identity,
        parserRunId,
        errorCode: BYTE_SOURCE_ERROR_CODE,
        errorMessageSafe: BYTE_SOURCE_ERROR_MESSAGE,
        now,
        metadataOnlyAudit,
      });
    }

    let outcome;
    try {
      // Bytes stay transient: they are only handed to the deterministic profiler and
      // are never persisted, returned, logged, or audited.
      outcome = profilerOutcome(await invokeDeterministicProfiler(trustedFileFacts, read.data.bytes));
    } catch {
      outcome = {
        profiled: false,
        errorCode: FALLBACK_ERROR_CODE,
        errorMessageSafe: FALLBACK_ERROR_MESSAGE,
      };
    }

    if (!outcome.profiled) {
      return await parserRunRepository.failParserRunSafely({
        identity,
        parserRunId,
        errorCode: outcome.errorCode,
        errorMessageSafe: outcome.errorMessageSafe,
        now,
        metadataOnlyAudit,
      });
    }

    return await parserRunRepository.completeParserRunWithProfile({
      identity,
      parserRunId,
      profile: JSON.parse(JSON.stringify(outcome.profile)),
      now,
      metadataOnlyAudit,
    });
  }

  return Object.freeze({
    /**
     * Organization-scoped idempotent queue/ensure. Performs no byte read and no
     * profiler call: an identical queued, running, or completed identity replays the
     * stored run (and, for a completed run, the stored profile metadata and canonical
     * hash) without re-profiling.
     */
    async queueParserProfileWork(input) {
      if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
      if (!validateQueueInput(input)) return workerFailure("validation_blocker");
      return await parserRunRepository.ensureQueuedParserRun({
        identity: parserRunIdentity(input.trustedFileFacts),
        now: input.now,
      });
    },

    /**
     * Claim one queued run for this identity, read the exact object version through
     * the existing byte-source seam, invoke the existing deterministic profiler, and
     * commit either the atomic completion or the atomic safe failure.
     */
    async runQueuedParserProfileWork(input) {
      if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
      if (!validateExecutionInput(input)) return workerFailure("validation_blocker");
      return await claimAndProfile(input);
    },

    /**
     * Explicit internal retry. There is no scheduler, listener, timer, or automatic
     * retry loop. When the stored retry count has reached the contract cap the run is
     * not re-queued, no bytes are read, and no profiler is invoked: the derived
     * `requires_manual_review` value is returned instead.
     */
    async retryParserProfileWork(input) {
      if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
      if (!validateExecutionInput(input)) return workerFailure("validation_blocker");
      const identity = parserRunIdentity(input.trustedFileFacts);
      const requeued = await parserRunRepository.requeueFailedParserRunForRetry({
        identity,
        now: input.now,
        metadataOnlyAudit: input.metadataOnlyAudit,
      });
      if (!requeued.ok) return requeued;
      if (requeued.data.requires_manual_review === true) return requeued;
      return await claimAndProfile(input);
    },
  });
}

export const __parserProfileWorkerContract = Object.freeze({
  PARSER_REGISTRY,
  LOCAL_PROFILING_KERNEL_PARSER,
  PDF_PROFILING_WORKER_PARSER,
  FALLBACK_ERROR_CODE,
  BYTE_SOURCE_ERROR_CODE,
});

export const __parserProfileWorkerTestables = Object.freeze({
  safeErrorCode,
  safeErrorMessage,
  parserRunIdentity,
  profilerOutcome,
});
