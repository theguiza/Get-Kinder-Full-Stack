import { withTransaction } from "../db/kaiDb.js";
import { HUMAN_AUTHORITY_DECISION_TYPES } from "./humanAuthorityDecisionContract.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
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

// ---------------------------------------------------------------------------
// Private, read-only currentness helper. Checks only whether the bound P3-16
// export candidate's limitation snapshot is still the current (non-
// superseded) one - the same cheap first check P3-16's own currentness
// evaluator performs before any full canonical-fingerprint recomputation.
// Read-only: neither the candidate row nor the snapshot row is ever rewritten.
// ---------------------------------------------------------------------------
async function isExportCandidateCurrentForAuthority(tx, { organizationId, exportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT limitation_snapshot_id::text AS limitation_snapshot_id
       FROM kai.export_candidates
      WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid`,
    [organizationId, exportCandidateId],
  );
  const candidate = rows[0];
  if (!candidate) return { current: false, reason: "export_candidate_missing" };

  const successorRows = await tx.query(
    `SELECT 1 FROM kai.limitation_snapshots WHERE supersedes_snapshot_id = $1::uuid LIMIT 1`,
    [candidate.limitation_snapshot_id],
  );
  if (successorRows.rows.length > 0) return { current: false, reason: "limitation_snapshot_superseded" };
  return { current: true, reason: null };
}

// ---------------------------------------------------------------------------
// Private, read-only effective-authority evaluator
// (OWNER_SEMANTICS: effective = current head exists AND current head action
// = grant AND the bound P3-16 export candidate is still current). Fails
// closed on no decision, a revoke head, ambiguous lineage, or a stale bound
// candidate. Not wired into VAL-EXP-001, any human grant/revoke operation
// (none exists in this package), or any route.
// ---------------------------------------------------------------------------
async function evaluateHumanAuthorityEffectivenessInTransaction(tx, input) {
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

  const currentness = await isExportCandidateCurrentForAuthority(tx, input);
  if (!currentness.current) {
    return success({ effective: false, reason: currentness.reason, headDecisionId: head.decision_id });
  }

  return success({ effective: true, reason: null, headDecisionId: head.decision_id });
}

export function createPostgresHumanAuthorityDecisionRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async evaluateEffectiveness(input) {
      if (!isEvaluateEffectivenessInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction((tx) => evaluateHumanAuthorityEffectivenessInTransaction(tx, input));
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __humanAuthorityDecisionRepositoryTestables = Object.freeze({
  isEvaluateEffectivenessInput,
  isExportCandidateCurrentForAuthority,
  evaluateHumanAuthorityEffectivenessInTransaction,
});

export const __humanAuthorityDecisionRepositoryContract = Object.freeze({
  UUID_PATTERN,
});
