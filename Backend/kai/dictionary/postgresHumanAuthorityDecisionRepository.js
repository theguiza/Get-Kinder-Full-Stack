import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import {
  HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE,
  HUMAN_AUTHORITY_DECISION_TYPES,
  roleRequiredForDecisionType,
} from "./humanAuthorityDecisionContract.js";
import { evaluateExportCandidateCurrentnessInTransaction } from "./postgresExportCandidateRepository.js";

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

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isEvaluateEffectivenessInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "exportCandidateId", "decisionType"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType);
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

function isRecordDecisionInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "exportCandidateId",
    "decisionType",
    "decisionAction",
    "requestedAudience",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType)
    && ["grant", "revoke"].includes(input.decisionAction)
    && ["internal", "funder", "public"].includes(input.requestedAudience)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function deriveDecidedByRole(actorContext, organizationId, decisionType) {
  const requiredRole = roleRequiredForDecisionType(decisionType);
  if (!requiredRole) return null;
  const membership = (actorContext?.organizationMemberships || []).find((entry) =>
    String(entry.organization_id) === String(organizationId)
    && entry.membership_status === "active"
    && entry.role_name === requiredRole);
  return membership ? requiredRole : null;
}

async function loadExportCandidateForAuthority(tx, { organizationId, exportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT export_candidate_id::text AS export_candidate_id,
            organization_id::text AS organization_id,
            generated_content_draft_id::text AS generated_content_draft_id,
            requested_audience
       FROM kai.export_candidates
      WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid`,
    [organizationId, exportCandidateId],
  );
  return rows[0] || null;
}

async function loadCurrentDecisionHeadForUpdate(tx, { organizationId, exportCandidateId, decisionType }) {
  const { rows } = await tx.query(
    `SELECT d.decision_id::text AS decision_id, d.decision_action
       FROM kai.human_authority_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.export_candidate_id = $2::uuid
        AND d.decision_type = $3
        AND NOT EXISTS (
              SELECT 1 FROM kai.human_authority_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )
      FOR UPDATE OF d`,
    [organizationId, exportCandidateId, decisionType],
  );
  return rows;
}

async function loadAuditFileContext(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT f.intake_file_id::text AS intake_file_id, f.upload_state
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations c
         ON c.generated_content_block_id = b.generated_content_block_id
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
       JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
       JOIN kai.intake_source_candidates isc
         ON isc.organization_id = sv.organization_id AND isc.intake_source_candidate_id = sv.intake_source_candidate_id
       JOIN kai.intake_files f
         ON f.organization_id = isc.organization_id AND f.intake_file_id = isc.intake_file_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid
      ORDER BY b.ordinal ASC, c.claim_id ASC
      LIMIT 1`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

function buildDecisionAuditMetadata({ input, candidate, decisionId, supersedesDecisionId, decidedByRole, effectiveness }) {
  return {
    contract: "p3_17_human_authority_decision_v1",
    organization_id: input.organizationId,
    generated_content_draft_id: candidate.generated_content_draft_id,
    export_candidate_id: input.exportCandidateId,
    requested_audience: input.requestedAudience,
    decision_id: decisionId,
    decision_type: input.decisionType,
    decision_action: input.decisionAction,
    supersedes_decision_id: supersedesDecisionId,
    decided_by: input.actorContext.actorUserId,
    decided_by_role: decidedByRole,
    actor_type: "human",
    effective: effectiveness.data.effective,
    effectiveness_reason: effectiveness.data.reason,
    head_decision_id: effectiveness.data.headDecisionId,
    decision_timestamp: input.now,
  };
}

async function insertDecisionAudit(tx, { input, auditFileContext, metadata }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid,$2::uuid,'human_authority_decision_recorded',$3,$3,'success',$4::jsonb,$5::timestamptz)`,
    [
      input.organizationId,
      auditFileContext.intake_file_id,
      auditFileContext.upload_state,
      JSON.stringify(metadata),
      input.now,
    ],
  );
}

export class HumanAuthorityDecisionRollbackResultError extends Error {
  constructor(result) {
    super("rollback human-authority-decision transaction");
    this.name = "HumanAuthorityDecisionRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new HumanAuthorityDecisionRollbackResultError(failure(code));
}

// ---------------------------------------------------------------------------
// Private, read-only currentness helper. Delegates to P3-16's own
// authoritative evaluateExportCandidateCurrentnessInTransaction - full
// currentness (limitation-snapshot currentness AND recomputed-fingerprint
// match against current authoritative state), never a narrower reduction of
// it. Read-only: neither the candidate row nor the snapshot row is ever
// rewritten. evaluateCurrentness is injectable only for boundary testing;
// the real repository always uses the P3-16 evaluator.
// ---------------------------------------------------------------------------
async function isExportCandidateCurrentForAuthority(
  tx,
  { organizationId, exportCandidateId },
  evaluateCurrentness = evaluateExportCandidateCurrentnessInTransaction,
) {
  const result = await evaluateCurrentness(tx, { organizationId, exportCandidateId });
  if (!result.ok) return { current: false, reason: "export_candidate_missing" };
  return result.data;
}

// ---------------------------------------------------------------------------
// Private, read-only effective-authority evaluator
// (OWNER_SEMANTICS: effective = current head exists AND current head action
// = grant AND the bound P3-16 export candidate is still current). Fails
// closed on no decision, a revoke head, ambiguous lineage, or a stale bound
// candidate. Not wired into VAL-EXP-001, any human grant/revoke operation
// (none exists in this package), or any route.
// ---------------------------------------------------------------------------
async function evaluateHumanAuthorityEffectivenessInTransaction(
  tx,
  input,
  evaluateCurrentness = evaluateExportCandidateCurrentnessInTransaction,
) {
  if (!isEvaluateEffectivenessInput(input)) return failure("validation_blocker");

  const headRows = await tx.query(
    `SELECT d.decision_id::text AS decision_id, d.decision_action
       FROM kai.human_authority_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.export_candidate_id = $2::uuid
        AND d.decision_type = $3
        AND NOT EXISTS (
              SELECT 1 FROM kai.human_authority_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )`,
    [input.organizationId, input.exportCandidateId, input.decisionType],
  );

  if (headRows.rows.length === 0) {
    return success({ effective: false, reason: "no_decision", headDecisionId: null });
  }
  if (headRows.rows.length > 1) {
    return success({ effective: false, reason: "lineage_ambiguous", headDecisionId: null });
  }

  const head = headRows.rows[0];
  if (head.decision_action !== "grant") {
    return success({ effective: false, reason: "head_is_revoke", headDecisionId: head.decision_id });
  }

  const currentness = await isExportCandidateCurrentForAuthority(tx, input, evaluateCurrentness);
  if (!currentness.current) {
    return success({ effective: false, reason: currentness.reason, headDecisionId: head.decision_id });
  }

  return success({ effective: true, reason: null, headDecisionId: head.decision_id });
}

export function createPostgresHumanAuthorityDecisionRepository({
  runInTransaction = withTransaction,
  evaluateCandidateCurrentness = evaluateExportCandidateCurrentnessInTransaction,
} = {}) {
  return Object.freeze({
    async recordDecision(input, dependencies = {}) {
      if (!isRecordDecisionInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
      const decidedByRole = deriveDecidedByRole(input.actorContext, input.organizationId, input.decisionType);
      if (!decidedByRole) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadExportCandidateForAuthority(tx, input);
          if (!candidate) return failure("not_found");
          if (candidate.requested_audience !== input.requestedAudience) return failure("validation_blocker");
          const requiredAudience = HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE[input.decisionType];
          if (requiredAudience && requiredAudience !== candidate.requested_audience) return failure("validation_blocker");

          const currentness = await isExportCandidateCurrentForAuthority(tx, input, evaluateCandidateCurrentness);
          if (!currentness.current) return failure("conflict_current_state_changed");

          const headRows = await loadCurrentDecisionHeadForUpdate(tx, input);
          if (headRows.length > 1) return failure("conflict_current_state_changed");
          const head = headRows[0] || null;
          const effectivenessInput = {
            organizationId: input.organizationId,
            exportCandidateId: input.exportCandidateId,
            decisionType: input.decisionType,
          };
          if (!head && input.decisionAction === "revoke") return failure("validation_blocker");
          if (head?.decision_action === input.decisionAction) {
            const effectiveness = await evaluateHumanAuthorityEffectivenessInTransaction(tx, effectivenessInput, evaluateCandidateCurrentness);
            return success({
              decisionId: head.decision_id,
              exportCandidateId: input.exportCandidateId,
              decisionType: input.decisionType,
              decisionAction: input.decisionAction,
              requestedAudience: input.requestedAudience,
              supersedesDecisionId: null,
              decidedByRole,
              effective: effectiveness.data.effective,
              effectivenessReason: effectiveness.data.reason,
              headDecisionId: effectiveness.data.headDecisionId,
              replayed: true,
            });
          }

          const decisionId = crypto.randomUUID();
          const supersedesDecisionId = head?.decision_id || null;
          await tx.query(
            `INSERT INTO kai.human_authority_decisions (
               decision_id, organization_id, export_candidate_id, decision_type, decision_action,
               decided_by, decided_by_role, supersedes_decision_id, created_by_type, created_at
             )
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,'human',$9::timestamptz)`,
            [
              decisionId,
              input.organizationId,
              input.exportCandidateId,
              input.decisionType,
              input.decisionAction,
              input.actorContext.actorUserId,
              decidedByRole,
              supersedesDecisionId,
              input.now,
            ],
          );

          const effectiveness = await evaluateHumanAuthorityEffectivenessInTransaction(tx, effectivenessInput, evaluateCandidateCurrentness);
          if (!effectiveness.ok) rollbackFailure(effectiveness.error.code);

          const auditFileContext = await loadAuditFileContext(tx, {
            organizationId: input.organizationId,
            generatedContentDraftId: candidate.generated_content_draft_id,
          });
          if (!auditFileContext) rollbackFailure("system_error");
          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: {
              attempted_operation: "human_authority_decision_recorded",
              actor_type: "human",
              object_type: "human_authority_decision",
              request_scope: "organization_export_candidate",
              contract: "p3_17_human_authority_decision_v1",
            },
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          const metadata = buildDecisionAuditMetadata({
            input,
            candidate,
            decisionId,
            supersedesDecisionId,
            decidedByRole,
            effectiveness,
          });
          await insertDecisionAudit(tx, { input, auditFileContext, metadata });
          await preparedAudit.publish();

          return success({
            decisionId,
            exportCandidateId: input.exportCandidateId,
            decisionType: input.decisionType,
            decisionAction: input.decisionAction,
            requestedAudience: input.requestedAudience,
            supersedesDecisionId,
            decidedByRole,
            effective: effectiveness.data.effective,
            effectivenessReason: effectiveness.data.reason,
            headDecisionId: effectiveness.data.headDecisionId,
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof HumanAuthorityDecisionRollbackResultError) return error.result;
        if (error?.code === "23505" || error?.code === "25001") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    async evaluateEffectiveness(input) {
      if (!isEvaluateEffectivenessInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction((tx) => evaluateHumanAuthorityEffectivenessInTransaction(tx, input, evaluateCandidateCurrentness));
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __humanAuthorityDecisionRepositoryTestables = Object.freeze({
  isEvaluateEffectivenessInput,
  isRecordDecisionInput,
  deriveDecidedByRole,
  isExportCandidateCurrentForAuthority,
  evaluateHumanAuthorityEffectivenessInTransaction,
});

export const __humanAuthorityDecisionRepositoryContract = Object.freeze({
  UUID_PATTERN,
});
