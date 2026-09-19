import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { evaluateFinalExportEligibilityInTransaction } from "../services/kaiFinalExportEligibilityGateService.js";
import {
  EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
  EXPORT_MANIFEST_CREATED_OPERATION,
  EXPORT_MANIFEST_AUDIT_CONTRACT,
} from "./exportManifestContract.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code, blockers, data = null) {
  return {
    ok: false,
    data,
    error: { code, status: RESULT_STATUS[code] || 500 },
    ...(blockers ? { blockers } : {}),
  };
}

function success(data) {
  return { ok: true, data, error: null };
}

const AUTHORITY_ABSENT_FAILED_GATE = "affirmative_human_export_authority_absent";
const MACHINE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

// Extends the authoritative VAL-EXP-001 validatorResult with the
// already-computed P3-17 effectiveness reason - but only when the authority
// gate is the one that actually failed, and only with a bounded,
// machine-code-shaped value. Never mutates validatorResult itself, never
// touches failed_gates, and never attaches a reason for an unrelated gate.
function withAuthorityEffectivenessReasonEvidence(validatorResult, effectivenessReason) {
  const failedGates = validatorResult?.evidence?.failed_gates;
  if (!Array.isArray(failedGates) || !failedGates.includes(AUTHORITY_ABSENT_FAILED_GATE)) {
    return validatorResult;
  }
  if (typeof effectivenessReason !== "string" || !MACHINE_CODE_PATTERN.test(effectivenessReason)) {
    return validatorResult;
  }
  return {
    ...validatorResult,
    evidence: {
      ...validatorResult.evidence,
      authority_effectiveness_reason: effectivenessReason,
    },
  };
}

export class ExportManifestRollbackResultError extends Error {
  constructor(result) {
    super("rollback export-manifest transaction");
    this.name = "ExportManifestRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new ExportManifestRollbackResultError(failure(code));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Manifest identity is a deterministic hash over the export candidate and
// the exact effective P3-17 grant decision read inside the SAME transaction
// as this insert (never re-queried afterward) - this is what gives replay
// (the same eligible state submitted twice) exactly one manifest row.
function canonicalFingerprint(representation) {
  return crypto.createHash("sha256").update(canonicalJson(representation)).digest("hex");
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

// Exact-keys input contract: no requestedAudience, finalGate,
// affirmativeHumanExportAuthority, eligibility, or currentness field is
// accepted from a caller - audience/authority/eligibility are always
// derived, inside this same transaction, from the shared P3-18/VAL-EXP-001
// composition, never taken on faith from the request.
function isCreateExportManifestInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "exportCandidateId",
    "exportReviewQueueItemId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultEligibilityDependencies() {
  const { evaluateGeneratedDraftExportReviewPacketInTransaction } = await import(
    "./postgresGeneratedContentRepository.js"
  );
  const { evaluateClaimTraceabilityInTransaction } = await import("./postgresClaimTraceabilityRepository.js");
  const {
    loadExportCandidateForAuthority,
    evaluateHumanAuthorityEffectivenessInTransaction,
  } = await import("./postgresHumanAuthorityDecisionRepository.js");
  const { evaluateExportCandidateCurrentnessInTransaction } = await import("./postgresExportCandidateRepository.js");
  return {
    evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
    evaluator: evaluateClaimTraceabilityInTransaction,
    loadCandidate: loadExportCandidateForAuthority,
    // The genuinely transaction-scoped P3-17 evaluator (not the repository's
    // evaluateEffectiveness() wrapper, which opens its own separate
    // transaction) - this is what closes the TOCTOU gap between "authority
    // checked" and "manifest written".
    evaluateAuthorityEffectiveness: evaluateHumanAuthorityEffectivenessInTransaction,
    evaluateCandidateCurrentness: evaluateExportCandidateCurrentnessInTransaction,
  };
}

async function insertExportManifest(tx, { manifestId, input, effectiveAuthorityDecisionId, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.export_manifests (
       export_manifest_id, organization_id, export_candidate_id,
       effective_authority_decision_id, effective_authority_decision_type,
       fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id,
       created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'export_authority_granted',$5,$6,$7::uuid,$8::uuid,'human',$9::timestamptz)
     ON CONFLICT (organization_id, export_candidate_id, canonical_fingerprint) DO NOTHING
     RETURNING export_manifest_id::text AS export_manifest_id`,
    [
      manifestId,
      input.organizationId,
      input.exportCandidateId,
      effectiveAuthorityDecisionId,
      EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      input.exportReviewQueueItemId,
      input.actorContext.actorUserId,
      input.now,
    ],
  );
  return rows[0] || null;
}

async function loadExistingExportManifest(tx, { organizationId, exportCandidateId, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT export_manifest_id::text AS export_manifest_id
       FROM kai.export_manifests
      WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid AND canonical_fingerprint = $3`,
    [organizationId, exportCandidateId, fingerprint],
  );
  return rows[0] || null;
}

// Durable read recovery (P3-20 binding): a tenant-scoped lookup of the exact
// persisted exportManifestId this review item's governed finalization
// produced, using only the exact FK'd relationship P3-20 added
// (export_manifests.export_review_queue_item_id) - no join, no ORDER BY, no
// created_at/timestamp of any kind. If zero rows match, no finalization has
// happened yet for this review item - there is nothing to recover, never a
// fabricated identity. If more than one row matches (a review item may
// legitimately back multiple historical manifests - see the accepted
// FUNCTIONAL_DEPENDENCY_PROOF/DIRECT_MANIFEST_REVIEW_BINDING model), this
// function refuses to pick one: recovering a single "exact" identity out of
// several independently valid governed finalizations would require an
// owner decision this package does not make, so it returns null exactly as
// it does when none exist - never a newest/latest/best-effort substitute.
function isLoadExportManifestIdentityInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "exportReviewQueueItemId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId);
}

export async function loadExportManifestIdentityForReviewQueueItemInTransaction(tx, input) {
  if (!isLoadExportManifestIdentityInput(input)) return { exportManifestId: null };
  const { rows } = await tx.query(
    `SELECT export_manifest_id::text AS export_manifest_id
       FROM kai.export_manifests
      WHERE organization_id = $1::uuid AND export_review_queue_item_id = $2::uuid`,
    [input.organizationId, input.exportReviewQueueItemId],
  );
  if (rows.length !== 1) return { exportManifestId: null };
  return { exportManifestId: rows[0].export_manifest_id };
}

// Exact export-manifest history (read-model cardinality repair): a review
// item may legitimately back MULTIPLE historical manifests (see the
// accepted FUNCTIONAL_DEPENDENCY_PROOF/DIRECT_MANIFEST_REVIEW_BINDING
// model, proven for real by the P3-20 revoke/re-grant integration case).
// This function returns every one of them - never LIMIT 1, never a
// latest/current/active selection, never dropping a row because more than
// one exists. `created_at ASC, export_manifest_id ASC` is presentation
// ordering only; it does not mark any entry as current.
function isLoadExportManifestHistoryInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "exportReviewQueueItemId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId);
}

export async function loadExportManifestHistoryForReviewQueueItemInTransaction(tx, input) {
  if (!isLoadExportManifestHistoryInput(input)) return { exportManifestHistory: [] };
  const { rows } = await tx.query(
    `SELECT export_manifest_id::text AS export_manifest_id,
            export_candidate_id::text AS export_candidate_id,
            created_at
       FROM kai.export_manifests
      WHERE organization_id = $1::uuid AND export_review_queue_item_id = $2::uuid
      ORDER BY created_at ASC, export_manifest_id ASC`,
    [input.organizationId, input.exportReviewQueueItemId],
  );
  return {
    exportManifestHistory: rows.map((row) => ({
      exportManifestId: row.export_manifest_id,
      exportCandidateId: row.export_candidate_id,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    })),
  };
}

export function createPostgresExportManifestRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async createExportManifest(input, dependencies = {}) {
      if (!isCreateExportManifestInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const needsDefaults = !dependencies.evaluatePacket
        || !dependencies.evaluator
        || !dependencies.loadCandidate
        || !dependencies.evaluateAuthorityEffectiveness
        || !dependencies.evaluateCandidateCurrentness;
      const defaults = needsDefaults ? await createDefaultEligibilityDependencies() : null;
      const eligibilityDependencies = {
        evaluatePacket: dependencies.evaluatePacket || defaults.evaluatePacket,
        evaluator: dependencies.evaluator || defaults.evaluator,
        loadCandidate: dependencies.loadCandidate || defaults.loadCandidate,
        evaluateAuthorityEffectiveness:
          dependencies.evaluateAuthorityEffectiveness || defaults.evaluateAuthorityEffectiveness,
        evaluateCandidateCurrentness:
          dependencies.evaluateCandidateCurrentness || defaults.evaluateCandidateCurrentness,
      };

      try {
        return await runInTransaction(async (tx) => {
          // Single authoritative composition - the SAME function the public,
          // read-only evaluateFinalExportEligibility uses - executed inside
          // this write transaction. No P3-16 currentness, P3-17
          // effectiveness, or VAL-EXP-001 check is re-derived here.
          const eligibility = await evaluateFinalExportEligibilityInTransaction(
            tx,
            {
              organizationId: input.organizationId,
              exportCandidateId: input.exportCandidateId,
              exportReviewQueueItemId: input.exportReviewQueueItemId,
            },
            eligibilityDependencies,
          );
          if (!eligibility.ok) return eligibility;
          if (eligibility.data.finalExportEligible !== true) {
            // Preserve the authoritative VAL-EXP-001 validatorResult (including
            // evidence.failed_gates) that evaluateFinalExportEligibilityInTransaction
            // already computed, rather than collapsing it to a bare code - this is
            // what makes the ordinary manifest failure self-diagnosing.
            // effectivenessReason is also carried in `data` for internal-only
            // observability (the route's sanitizeServiceData allowlist does not
            // surface it publicly), and - when it explains the authority gate
            // specifically - copied into the blocker's own evidence so the HTTP
            // response is self-diagnosing for that case too.
            return failure(
              "validation_blocker",
              [withAuthorityEffectivenessReasonEvidence(eligibility.data.validatorResult, eligibility.data.effectivenessReason)],
              { effectivenessReason: eligibility.data.effectivenessReason },
            );
          }

          const effectiveAuthorityDecisionId = eligibility.data.effectiveAuthorityDecisionId;
          if (!effectiveAuthorityDecisionId) rollbackFailure("system_error");

          const fingerprint = canonicalFingerprint({
            organizationId: input.organizationId,
            exportCandidateId: input.exportCandidateId,
            effectiveAuthorityDecisionId,
          });

          const manifestId = crypto.randomUUID();
          const insertedRow = await insertExportManifest(tx, {
            manifestId,
            input,
            effectiveAuthorityDecisionId,
            fingerprint,
          });

          let exportManifestId;
          let replayed;
          if (insertedRow) {
            exportManifestId = insertedRow.export_manifest_id;
            replayed = false;
          } else {
            const existing = await loadExistingExportManifest(tx, {
              organizationId: input.organizationId,
              exportCandidateId: input.exportCandidateId,
              fingerprint,
            });
            if (!existing) rollbackFailure("system_error");
            exportManifestId = existing.export_manifest_id;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: EXPORT_MANIFEST_CREATED_OPERATION,
                actor_type: "human",
                object_type: "export_manifest",
                contract: EXPORT_MANIFEST_AUDIT_CONTRACT,
                export_manifest_id: exportManifestId,
                export_candidate_id: input.exportCandidateId,
              },
              // Same transaction as the manifest insert - the audit-event
              // write must be atomic with it, not a separate connection/pool.
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            exportManifestId,
            exportCandidateId: input.exportCandidateId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
            effectiveAuthorityDecisionId,
            fingerprintContractVersion: EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
            canonicalFingerprint: fingerprint,
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof ExportManifestRollbackResultError) return error.result;
        if (error?.code === "23505" || error?.code === "25001") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },
  });
}

export const __exportManifestRepositoryTestables = Object.freeze({
  isCreateExportManifestInput,
  canonicalFingerprint,
  isLoadExportManifestIdentityInput,
  isLoadExportManifestHistoryInput,
});
