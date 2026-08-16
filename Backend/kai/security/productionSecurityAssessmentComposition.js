import { readVerifiedAssessmentBytes } from "./assessmentReadIntegrityBridge.js";
import { assessBoundedFileSecurity } from "./boundedFileSecurityAssessor.js";
import { createConfiguredClamavCloudRunMalwareScanAdapter } from "./clamavCloudRunMalwareScanAdapter.js";
import {
  createInternalSecurityAssessmentExecutor,
  executeInjectedInternalSecurityAssessment,
} from "./internalSecurityAssessmentExecutor.js";
import { policyDecisionOutcomeForAssessmentResult } from "./assessmentPolicyOutcome.js";

const PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE = /^ov_[a-f0-9]{32}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXTENSION_RE = /^\.[a-z0-9]{1,31}$/;

function isNonEmptyLowercaseUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

/**
 * Trusted server-side facts only. No caller/request input reaches this
 * composition: confirmUpload's own verified confirmation result and stored,
 * validated intake_files columns are the only source for these fields.
 */
function isValidTrustedFacts(facts) {
  return Boolean(
    facts
    && typeof facts === "object"
    && isNonEmptyLowercaseUuid(facts.organizationId)
    && isNonEmptyLowercaseUuid(facts.intakeFileId)
    && typeof facts.objectVersionId === "string"
    && PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE.test(facts.objectVersionId)
    && typeof facts.verifiedChecksum === "string"
    && SHA256_HEX_RE.test(facts.verifiedChecksum)
    && Number.isSafeInteger(facts.verifiedSizeBytes)
    && facts.verifiedSizeBytes >= 0
    && typeof facts.declaredMime === "string"
    && facts.declaredMime.length > 0
    && typeof facts.extension === "string"
    && EXTENSION_RE.test(facts.extension),
  );
}

function isGcsExactGenerationProvider(provider) {
  return (
    provider
    && provider.enabled === true
    && typeof provider.openExactGenerationReadStream === "function"
  );
}

function isGcsBindingRepository(repository) {
  return (
    repository
    && typeof repository.resolveGcsGenerationBinding === "function"
  );
}

/**
 * Adapts a provider byte source into the assessment-side contract required by
 * assessmentReadIntegrityBridge (async iteration + async close()), without
 * buffering or otherwise touching the bytes it yields.
 *
 * A source that already exposes both an async iterator and a close() is
 * returned unchanged - its own cleanup operation is authoritative. A raw
 * Node Readable (async iterator + destroy(), no close()) is wrapped so that
 * the first close() call synchronously initiates destroy() (unless already
 * destroyed) and returns a resolved, memoized promise - assessmentReadIntegrityBridge's
 * closeByteSource() treats close() as best-effort cleanup and never depends
 * on underlying stream teardown completing, so waiting for a "close" event
 * here would be unobserved latency with no correctness benefit. Anything
 * lacking async iteration, or lacking any supported cleanup mechanism, is
 * rejected (returns null) so the caller fails closed.
 */
function adaptAssessmentByteSource(source) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") return null;
  if (typeof source.close === "function") return source;
  if (typeof source.destroy !== "function") return null;

  let closePromise = null;
  return {
    [Symbol.asyncIterator]() {
      return source[Symbol.asyncIterator]();
    },
    close() {
      if (!closePromise) {
        if (source.destroyed !== true) {
          source.destroy();
        }
        closePromise = Promise.resolve();
      }
      return closePromise;
    },
  };
}

/**
 * Resolves reads against the exact, already-bound GCS generation for this
 * object_version_id. Never accepts bucket, object key, or generation from
 * request input - the object key comes only from the trusted facts computed
 * server-side from stored intake_files columns, and the generation is
 * resolved from the existing Gate C-1 binding, not re-derived.
 */
export function createBoundGcsAssessmentStorageAdapter({ facts, gcsProvider, uploadLifecycleRepository }) {
  if (
    !isGcsExactGenerationProvider(gcsProvider)
    || !isGcsBindingRepository(uploadLifecycleRepository)
    || facts.storageProvider !== "gcs"
    || typeof facts.storageObjectKey !== "string"
    || facts.storageObjectKey.length === 0
  ) {
    return null;
  }

  return {
    async openObjectVersionReadStream({ objectVersionId, signal } = {}) {
      if (objectVersionId !== facts.objectVersionId) return { ok: false };

      const binding = await uploadLifecycleRepository.resolveGcsGenerationBinding({
        organizationId: facts.organizationId,
        intakeFileId: facts.intakeFileId,
      });
      if (
        binding?.ok !== true
        || binding.data?.object_version_id !== facts.objectVersionId
        || typeof binding.data?.gcs_generation !== "string"
      ) {
        return { ok: false };
      }

      const opened = await gcsProvider.openExactGenerationReadStream({
        objectKey: facts.storageObjectKey,
        gcsGeneration: binding.data.gcs_generation,
        ...(signal ? { signal } : {}),
      });
      if (opened?.ok !== true) return opened;
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          size_bytes: opened.data?.size_bytes,
          byte_source: adaptAssessmentByteSource(opened.data?.byte_source),
        },
      };
    },
  };
}

function executorInputFromFacts(facts, bytes) {
  return {
    extension: facts.extension,
    declaredMime: facts.declaredMime,
    bytes,
    sha256: facts.verifiedChecksum,
  };
}

function integrityFailureResult(integrityFailure) {
  return {
    ok: false,
    error: {
      code: "assessment_read_integrity_failure",
      integrity_failure: integrityFailure,
    },
  };
}

function createProductionInternalSecurityAssessmentExecutor({ env = process.env, clamavAdapterDependencies = {} } = {}) {
  const malwareScanAdapter = createConfiguredClamavCloudRunMalwareScanAdapter(env, clamavAdapterDependencies);
  return createInternalSecurityAssessmentExecutor({
    assessor(input) {
      return assessBoundedFileSecurity(input, { malwareScanAdapter });
    },
  });
}

/**
 * Production-neutral post-confirmation security-assessment composition:
 * trusted confirmed facts -> exact-version read via the existing integrity
 * bridge -> internal security executor -> bounded file-security assessor ->
 * sanitized assessment result + policy-decision outcome mapping.
 *
 * Reaches no synthetic malware adapter, test fixture, or in-memory enqueue
 * state. Valid Gate C ClamAV config injects the ClamAV adapter into the
 * existing executor/assessor chain; missing config keeps the existing
 * not_configured path without constructing or calling the scanner adapter.
 */
export async function runProductionSecurityAssessment(trustedFacts, dependencies = {}) {
  if (!isValidTrustedFacts(trustedFacts)) {
    return { ok: false, error: { code: "validation_blocker" } };
  }

  const {
    storageAdapter,
    gcsProvider,
    gcsParserReaderProvider,
    uploadLifecycleRepository,
    signal,
    internalSecurityAssessmentExecutor,
    env,
    clamavAdapterDependencies,
  } = dependencies;

  const exactGenerationReadProvider = gcsParserReaderProvider || gcsProvider;
  const effectiveStorageAdapter = storageAdapter || createBoundGcsAssessmentStorageAdapter({
    facts: trustedFacts,
    gcsProvider: exactGenerationReadProvider,
    uploadLifecycleRepository,
  });

  const readResult = await readVerifiedAssessmentBytes({
    objectVersionId: trustedFacts.objectVersionId,
    expectedChecksum: trustedFacts.verifiedChecksum,
    expectedSize: trustedFacts.verifiedSizeBytes,
    storageAdapter: effectiveStorageAdapter,
    ...(signal ? { signal } : {}),
  });
  if (readResult?.ok !== true) {
    return integrityFailureResult(readResult?.integrity_failure || { type: "assessment_read_integrity_failure", kind: "read_failed" });
  }

  const executor = internalSecurityAssessmentExecutor || createProductionInternalSecurityAssessmentExecutor({
    env,
    clamavAdapterDependencies,
  });
  const execution = await executeInjectedInternalSecurityAssessment(
    executorInputFromFacts(trustedFacts, readResult.data.bytes),
    { internalSecurityAssessmentExecutor: executor },
  );
  if (execution?.ok !== true) {
    return { ok: false, error: { code: "internal_security_executor_failed" } };
  }

  const assessmentResult = execution.data.result;
  const policyDecisionOutcome = policyDecisionOutcomeForAssessmentResult(assessmentResult);

  return {
    ok: true,
    data: {
      assessmentResult,
      policyDecisionOutcome,
    },
  };
}

export const __testables = Object.freeze({
  isValidTrustedFacts,
  createBoundGcsAssessmentStorageAdapter,
  createProductionInternalSecurityAssessmentExecutor,
  executorInputFromFacts,
  adaptAssessmentByteSource,
});
