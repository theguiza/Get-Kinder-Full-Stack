import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { loadBoardReportingCandidateForReview } from "./postgresBoardReportingCandidateRepository.js";
import {
  BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
  BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_CREATED_OPERATION,
  BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_AUDIT_CONTRACT,
  BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE,
} from "./boardReportingCandidateExportManifestContract.js";

// ---------------------------------------------------------------------------
// Board Reporting candidate export-manifest persistence - the Board-scoped
// analogue of the existing P3-19 postgresExportManifestRepository.js
// (member-level) and P14-08A postgresGrantResponsePacketExportManifestRepository.js
// (packet-level), bound instead to the existing, immutable BR-02
// board_reporting_candidates row and its exact effective BR-04
// export_authority_granted decision, writing into the already-created
// kai.board_reporting_candidate_export_manifests foundation table - never
// kai.export_manifests or kai.grant_response_packet_export_manifests (those
// tables are structurally disjoint; see the manifest foundation migration
// notes).
//
// Exactly like P14-08A, a Board candidate's current semantic state can only
// be recomposed through the existing, actor-gated
// evaluateBoardReportingFinalEligibility composition (candidate contract +
// review-resolved + BR-04 authority-effectiveness + fresh render-model
// fingerprint recomposition), which opens its own connections and cannot run
// inside an open tx. So eligibility (the real, unmodified
// evaluateBoardReportingFinalEligibility) and the effective-authority-
// decision id are both resolved BEFORE the write transaction; the
// transaction itself re-loads the exact candidate row via the existing BR-02/
// BR-04 loadBoardReportingCandidateForReview helper and re-checks that it
// still belongs to this organization/engagement, closing the same TOCTOU gap
// P14-08A's own repository closes, before ever writing a manifest row.
//
// This file reimplements neither the final-eligibility gate nor BR-04's
// authority-effectiveness lineage logic - it delegates to both, unmodified.
// ---------------------------------------------------------------------------

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class BoardReportingCandidateExportManifestRollbackResultError extends Error {
  constructor(result) {
    super("rollback board-reporting-candidate-export-manifest transaction");
    this.name = "BoardReportingCandidateExportManifestRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new BoardReportingCandidateExportManifestRollbackResultError(failure(code));
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

// Manifest identity is a deterministic hash over the Board candidate and the
// exact effective BR-04 decision resolved before this insert - this is what
// gives replay (the same eligible state submitted twice) exactly one
// manifest row, mirroring the P3-19/P14-08A fingerprint shape exactly
// (organizationId + candidateId + effectiveAuthorityDecisionId).
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

// Exact-keys input contract: no fingerprint, member list, requestedAudience,
// review status, eligibility, authority, or manifest identity is ever
// accepted from a caller - all of that is re-derived, from these ids alone,
// by the real evaluateBoardReportingFinalEligibility and BR-04
// authorityRepository.evaluateEffectiveness this function delegates to.
function isCreateBoardReportingCandidateExportManifestInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isReadExportManifestByIdInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "boardReportingCandidateExportManifestId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.boardReportingCandidateExportManifestId);
}

function isResolveExportManifestStateForCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "boardReportingCandidateId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.boardReportingCandidateId);
}

async function createDefaultDependencies() {
  const { evaluateBoardReportingFinalEligibility } = await import(
    "../services/kaiBoardReportingFinalEligibilityGateService.js"
  );
  const { createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository } = await import(
    "./postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js"
  );
  return {
    evaluateEligibility: evaluateBoardReportingFinalEligibility,
    authorityRepository: createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository(),
  };
}

async function insertBoardReportingCandidateExportManifest(tx, { manifestId, input, effectiveAuthorityDecisionId, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.board_reporting_candidate_export_manifests (
       board_reporting_candidate_export_manifest_id, organization_id, board_reporting_candidate_id,
       effective_authority_decision_id, effective_authority_decision_type,
       fingerprint_contract_version, canonical_fingerprint,
       created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'export_authority_granted',$5,$6,$7::uuid,'human',$8::timestamptz)
     ON CONFLICT (organization_id, board_reporting_candidate_id, canonical_fingerprint) DO NOTHING
     RETURNING board_reporting_candidate_export_manifest_id::text AS board_reporting_candidate_export_manifest_id`,
    [
      manifestId,
      input.organizationId,
      input.boardReportingCandidateId,
      effectiveAuthorityDecisionId,
      BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      input.actorContext.actorUserId,
      input.now,
    ],
  );
  return rows[0] || null;
}

async function loadExistingBoardReportingCandidateExportManifest(tx, { organizationId, boardReportingCandidateId, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_export_manifest_id::text AS board_reporting_candidate_export_manifest_id
       FROM kai.board_reporting_candidate_export_manifests
      WHERE organization_id = $1::uuid AND board_reporting_candidate_id = $2::uuid AND canonical_fingerprint = $3`,
    [organizationId, boardReportingCandidateId, fingerprint],
  );
  return rows[0] || null;
}

function manifestRowToDto(row) {
  return {
    boardReportingCandidateExportManifestId: row.board_reporting_candidate_export_manifest_id,
    boardReportingCandidateId: row.board_reporting_candidate_id,
    effectiveAuthorityDecisionId: row.effective_authority_decision_id,
    effectiveAuthorityDecisionType: row.effective_authority_decision_type,
    fingerprintContractVersion: row.fingerprint_contract_version,
    canonicalFingerprint: row.canonical_fingerprint,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export function createPostgresBoardReportingCandidateExportManifestRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    // Create-or-reuse the exact Board manifest for the exact
    // boardReportingCandidateId given. Manifest creation is permitted ONLY
    // when the real, unmodified evaluateBoardReportingFinalEligibility
    // reports finalEligibility === true for this exact candidate id - never
    // a client-supplied eligibility/authority/fingerprint/member value.
    // Creates no Board delivery artifact and publishes nothing externally.
    async createExportManifest(input, dependencies = {}) {
      if (!isCreateBoardReportingCandidateExportManifestInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const needsDefaults = !dependencies.evaluateEligibility || !dependencies.authorityRepository;
      const defaults = needsDefaults ? await createDefaultDependencies() : null;
      const evaluateEligibility = dependencies.evaluateEligibility || defaults.evaluateEligibility;
      const authorityRepository = dependencies.authorityRepository || defaults.authorityRepository;

      const eligibilityInput = {
        organizationId: input.organizationId,
        engagementId: input.engagementId,
        boardReportingCandidateId: input.boardReportingCandidateId,
        actorContext: input.actorContext,
      };

      const eligibility = await evaluateEligibility(eligibilityInput, dependencies.eligibilityDependencies || {});
      if (!eligibility.ok) return eligibility;
      if (eligibility.data.finalEligibility !== true) return failure("validation_blocker");

      // The real BR-04 evaluateEffectiveness, called again here only to
      // recover the exact effective decision id the eligibility composition
      // already proved effective - never a second, independent effectiveness
      // determination and never a reimplementation of BR-04's own lineage
      // logic.
      const effectiveness = await authorityRepository.evaluateEffectiveness(
        {
          organizationId: input.organizationId,
          boardReportingCandidateId: input.boardReportingCandidateId,
          decisionType: BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE,
        },
        dependencies.authorityEffectivenessDependencies || {},
      );
      if (!effectiveness.ok) return effectiveness;
      if (effectiveness.data.effective !== true || !effectiveness.data.headDecisionId) {
        return failure("validation_blocker");
      }
      const effectiveAuthorityDecisionId = effectiveness.data.headDecisionId;

      const fingerprint = canonicalFingerprint({
        organizationId: input.organizationId,
        boardReportingCandidateId: input.boardReportingCandidateId,
        effectiveAuthorityDecisionId,
      });

      try {
        return await runInTransaction(async (tx) => {
          // Transaction-scoped currentness re-check: the candidate row must
          // still exist and belong to this organization/engagement - closing
          // the TOCTOU gap between the pre-transaction eligibility/
          // effectiveness reads above and this insert, exactly as P14-08A's
          // own repository does before writing a manifest row. Reuses the
          // existing BR-02/BR-04 loadBoardReportingCandidateForReview helper
          // verbatim rather than duplicating the SELECT.
          const candidate = await loadBoardReportingCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
          });
          if (!candidate) return failure("not_found");

          const manifestId = crypto.randomUUID();
          const insertedRow = await insertBoardReportingCandidateExportManifest(tx, {
            manifestId,
            input,
            effectiveAuthorityDecisionId,
            fingerprint,
          });

          let boardReportingCandidateExportManifestId;
          let replayed;
          if (insertedRow) {
            boardReportingCandidateExportManifestId = insertedRow.board_reporting_candidate_export_manifest_id;
            replayed = false;
          } else {
            const existing = await loadExistingBoardReportingCandidateExportManifest(tx, {
              organizationId: input.organizationId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              fingerprint,
            });
            if (!existing) rollbackFailure("system_error");
            boardReportingCandidateExportManifestId = existing.board_reporting_candidate_export_manifest_id;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_CREATED_OPERATION,
                actor_type: "human",
                object_type: "board_reporting_candidate_export_manifest",
                contract: BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_AUDIT_CONTRACT,
                engagement_id: input.engagementId,
                board_reporting_candidate_export_manifest_id: boardReportingCandidateExportManifestId,
                board_reporting_candidate_id: input.boardReportingCandidateId,
              },
              // Same transaction as the manifest insert.
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            boardReportingCandidateExportManifestId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            effectiveAuthorityDecisionId,
            fingerprintContractVersion: BOARD_REPORTING_CANDIDATE_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
            canonicalFingerprint: fingerprint,
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateExportManifestRollbackResultError) return error.result;
        if (error?.code === "23505" || error?.code === "25001") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // Exact read by id - tenant-scoped, never a latest/newest selection.
    async readExportManifestById(input) {
      if (!isReadExportManifestByIdInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const { rows } = await tx.query(
            `SELECT board_reporting_candidate_export_manifest_id::text AS board_reporting_candidate_export_manifest_id,
                    board_reporting_candidate_id::text AS board_reporting_candidate_id,
                    effective_authority_decision_id::text AS effective_authority_decision_id,
                    effective_authority_decision_type,
                    fingerprint_contract_version,
                    canonical_fingerprint,
                    created_at
               FROM kai.board_reporting_candidate_export_manifests
              WHERE organization_id = $1::uuid AND board_reporting_candidate_export_manifest_id = $2::uuid`,
            [input.organizationId, input.boardReportingCandidateExportManifestId],
          );
          if (rows.length !== 1) return failure("not_found");
          return success(manifestRowToDto(rows[0]));
        });
      } catch {
        return failure("system_error");
      }
    },

    // Exact manifest history for the exact Board candidate given - never
    // LIMIT 1, never a latest/current/active selection. `created_at ASC,
    // board_reporting_candidate_export_manifest_id ASC` is presentation
    // ordering only.
    async resolveExportManifestStateForCandidate(input) {
      if (!isResolveExportManifestStateForCandidateInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const { rows } = await tx.query(
            `SELECT board_reporting_candidate_export_manifest_id::text AS board_reporting_candidate_export_manifest_id,
                    board_reporting_candidate_id::text AS board_reporting_candidate_id,
                    effective_authority_decision_id::text AS effective_authority_decision_id,
                    effective_authority_decision_type,
                    fingerprint_contract_version,
                    canonical_fingerprint,
                    created_at
               FROM kai.board_reporting_candidate_export_manifests
              WHERE organization_id = $1::uuid AND board_reporting_candidate_id = $2::uuid
              ORDER BY created_at ASC, board_reporting_candidate_export_manifest_id ASC`,
            [input.organizationId, input.boardReportingCandidateId],
          );
          return success({ manifests: rows.map(manifestRowToDto) });
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __boardReportingCandidateExportManifestRepositoryTestables = Object.freeze({
  isCreateBoardReportingCandidateExportManifestInput,
  isReadExportManifestByIdInput,
  isResolveExportManifestStateForCandidateInput,
  canonicalFingerprint,
});
