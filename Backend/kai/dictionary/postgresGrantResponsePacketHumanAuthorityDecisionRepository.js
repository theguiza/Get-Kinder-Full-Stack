import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { composeGrantResponsePacketRenderModel } from "../services/kaiGrantResponsePacketRenderModelService.js";
import { composeGrantResponsePacketExportCandidateFingerprint } from "../services/kaiGrantResponsePacketExportCandidateFingerprintService.js";
import {
  GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES,
  roleRequiredForGrantResponsePacketHumanAuthorityDecisionType,
} from "./grantResponsePacketHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// P14-07B1: Grant Response Packet human final-release authority decision
// persistence foundation. Same semantic decision family as the existing
// P3-17 kai.human_authority_decisions ledger (export_authority_granted /
// grant / revoke / append-only supersession lineage / gk_admin-only), bound
// instead to an exact, existing, immutable P14-03 packet export candidate in
// its own sibling table (kai.grant_response_packet_human_authority_decisions)
// - kai.human_authority_decisions and its existing hard
// FOREIGN KEY (export_candidate_id, organization_id) REFERENCES
// kai.export_candidates(...) are never touched, weakened, or made
// polymorphic. This file creates no final-eligibility evaluation, no packet
// manifest, and no packet bytes.
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

export class GrantResponsePacketHumanAuthorityDecisionRollbackResultError extends Error {
  constructor(result) {
    super("rollback grant-response-packet-human-authority-decision transaction");
    this.name = "GrantResponsePacketHumanAuthorityDecisionRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new GrantResponsePacketHumanAuthorityDecisionRollbackResultError(failure(code));
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
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

// Exact-keys input contract: organizationId + engagementId +
// grantResponsePacketExportCandidateId + decisionType + decisionAction +
// actorContext + now, and NOTHING else. In particular, no fingerprint,
// member list, requestedAudience, or manifest identity is ever accepted from
// a caller - a Grant Response Packet's audience is always exactly "funder",
// so unlike the member-level ledger there is no ambiguity to resolve.
function isRecordGrantResponsePacketHumanAuthorityDecisionInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "decisionType",
    "decisionAction",
    "actorContext",
    "decidedByRole",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType)
    && ["grant", "revoke"].includes(input.decisionAction)
    && isMappedHumanActor(input.actorContext)
    && typeof input.decidedByRole === "string" && input.decidedByRole.length > 0
    && isCanonicalUtcTimestamp(input.now);
}

function isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "decisionType",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType)
    && isMappedHumanActor(input.actorContext);
}

// decidedByRole is resolved by the service layer (from the actor's own
// successful validateActorCanPerformOperation result, via the shared
// resolveAuthorizedHumanRole helper), not derived here from
// actorContext.organizationMemberships. This repository still validates the
// supplied role is the exact canonical role required for the decisionType
// before writing it, independent of how it was resolved.
function isCanonicalDecidedByRole(decidedByRole, decisionType) {
  const requiredRole = roleRequiredForGrantResponsePacketHumanAuthorityDecisionType(decisionType);
  return Boolean(requiredRole) && decidedByRole === requiredRole;
}

// Resolves the exact, existing, immutable P14-03 packet candidate row
// server-side and proves - in the same transaction as every read/write below
// - that it belongs to this organizationId AND that its P14-02 packet
// identity belongs to this engagementId. Never trusts a client-supplied
// engagement/organization pairing without this proof, and never accepts a
// member-level export_candidate_id or a packet structural identity id in
// place of this exact candidate id (this query only ever matches rows of
// kai.grant_response_packet_export_candidates itself).
async function loadGrantResponsePacketExportCandidateForAuthority(tx, { organizationId, grantResponsePacketExportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT c.grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
            c.organization_id::text AS organization_id,
            c.grant_response_packet_export_identity_id::text AS grant_response_packet_export_identity_id,
            c.canonical_fingerprint,
            i.engagement_id::text AS engagement_id
       FROM kai.grant_response_packet_export_candidates c
       JOIN kai.grant_response_packet_export_identities i
         ON i.grant_response_packet_export_identity_id = c.grant_response_packet_export_identity_id
        AND i.organization_id = c.organization_id
      WHERE c.organization_id = $1::uuid
        AND c.grant_response_packet_export_candidate_id = $2::uuid`,
    [organizationId, grantResponsePacketExportCandidateId],
  );
  const row = rows[0];
  return row || null;
}

async function loadCurrentDecisionHead(tx, { organizationId, grantResponsePacketExportCandidateId, decisionType, forUpdate }) {
  const { rows } = await tx.query(
    `SELECT d.decision_id::text AS decision_id, d.decision_action
       FROM kai.grant_response_packet_human_authority_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.grant_response_packet_export_candidate_id = $2::uuid
        AND d.decision_type = $3
        AND NOT EXISTS (
              SELECT 1 FROM kai.grant_response_packet_human_authority_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )${forUpdate ? "\n      FOR UPDATE OF d" : ""}`,
    [organizationId, grantResponsePacketExportCandidateId, decisionType],
  );
  return rows;
}

function buildDecisionAuditPayload({ input, candidate, decisionId, supersedesDecisionId, decidedByRole, effectiveness }) {
  return {
    grant_response_packet_export_candidate_id: candidate.grant_response_packet_export_candidate_id,
    engagement_id: input.engagementId,
    attempted_operation: "grant_response_packet_human_authority_decision_recorded",
    decision_id: decisionId,
    decision_type: input.decisionType,
    decision_action: input.decisionAction,
    decided_by_role: decidedByRole,
    supersedes_decision_id: supersedesDecisionId,
    effective: effectiveness.data.effective,
    effectiveness_reason: effectiveness.data.reason,
    head_decision_id: effectiveness.data.headDecisionId,
  };
}

// ---------------------------------------------------------------------------
// Packet-native currentness: unlike the member-level P3-16 evaluator (pure
// SQL against limitation_snapshots), a packet's current semantic state can
// only be recomposed through the existing, actor-gated
// composeGrantResponsePacketRenderModel -> getGrantResponsePacket chain (the
// same chain P14-06D's readCurrentGrantResponsePacketExportCandidateReviewState
// already uses), which opens its own connections and cannot run inside an
// open tx. So - exactly like P14-06D - the current canonical fingerprint is
// always recomposed BEFORE any transaction here, then only compared inside
// the transaction against the exact loaded candidate row's own stored
// canonical_fingerprint. Because
// (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint)
// is a UNIQUE convergence key on the candidate table, an equal recomputed
// fingerprint proves this exact candidate is still THE current candidate for
// its packet identity - never a latest/newest/superseded selection, and a
// changed fingerprint (any member revision, re-review, or a superseded
// candidate) makes the exact same candidate id ineligible without any row
// being rewritten.
// ---------------------------------------------------------------------------
async function resolveCurrentGrantResponsePacketExportCandidateFingerprint(
  { organizationId, engagementId, actorContext },
  dependencies = {},
) {
  const composeRenderModel = dependencies.composeRenderModel || composeGrantResponsePacketRenderModel;
  const renderModelResult = await composeRenderModel(
    { organizationId, engagementId, actorContext },
    dependencies.renderModelDependencies || dependencies,
  );
  if (!renderModelResult?.ok) {
    const code = renderModelResult?.error?.code === "not_found" ? "not_found" : "system_error";
    return { fingerprint: null, error: code };
  }
  const { fingerprint } = composeGrantResponsePacketExportCandidateFingerprint(renderModelResult.data);
  if (!fingerprint) return { fingerprint: null, error: "conflict_current_state_changed" };
  return { fingerprint, error: null };
}

// Pure, transaction-scoped effectiveness read: current head exists AND
// current head action = grant AND the exact loaded candidate's own stored
// canonical_fingerprint still equals the pre-resolved current fingerprint.
// Fails closed on no decision, a revoke head, ambiguous lineage, a missing
// candidate, or a stale/superseded candidate.
async function evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(
  tx,
  { organizationId, grantResponsePacketExportCandidateId, decisionType, candidate, currentFingerprint },
) {
  const headRows = await loadCurrentDecisionHead(tx, {
    organizationId,
    grantResponsePacketExportCandidateId,
    decisionType,
    forUpdate: false,
  });
  if (headRows.length === 0) return { effective: false, reason: "no_decision", headDecisionId: null };
  if (headRows.length > 1) return { effective: false, reason: "lineage_ambiguous", headDecisionId: null };

  const head = headRows[0];
  if (head.decision_action !== "grant") {
    return { effective: false, reason: "head_is_revoke", headDecisionId: head.decision_id };
  }
  if (!candidate || !currentFingerprint || candidate.canonical_fingerprint !== currentFingerprint) {
    return { effective: false, reason: "packet_candidate_superseded", headDecisionId: head.decision_id };
  }
  return { effective: true, reason: null, headDecisionId: head.decision_id };
}

export function createPostgresGrantResponsePacketHumanAuthorityDecisionRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    // Grant/revoke the exact same "human final-release authority" concept as
    // P3-17, for the exact grantResponsePacketExportCandidateId given -
    // never a member exportCandidateId, never a packet structural identity
    // id, never a latest/newest candidate. Append-only: a repeated call with
    // the same current head action replays the current head unchanged (no
    // new row, no audit); a genuinely new action supersedes the current
    // head. Creates no final-eligibility state, no packet manifest, no
    // packet bytes.
    async recordDecision(input, dependencies = {}) {
      if (!isRecordGrantResponsePacketHumanAuthorityDecisionInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
      if (!isCanonicalDecidedByRole(input.decidedByRole, input.decisionType)) return failure("validation_blocker");
      const { decidedByRole } = input;

      const { fingerprint: currentFingerprint, error: fingerprintError } =
        await resolveCurrentGrantResponsePacketExportCandidateFingerprint(input, dependencies);
      if (fingerprintError) return failure(fingerprintError);

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForAuthority(tx, input);
          if (!candidate || candidate.engagement_id !== input.engagementId) return failure("not_found");
          if (candidate.canonical_fingerprint !== currentFingerprint) return failure("conflict_current_state_changed");

          const headRows = await loadCurrentDecisionHead(tx, {
            organizationId: input.organizationId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            decisionType: input.decisionType,
            forUpdate: true,
          });
          if (headRows.length > 1) return failure("conflict_current_state_changed");
          const head = headRows[0] || null;
          if (!head && input.decisionAction === "revoke") return failure("validation_blocker");

          if (head?.decision_action === input.decisionAction) {
            const effectiveness = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
              organizationId: input.organizationId,
              grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
              decisionType: input.decisionType,
              candidate,
              currentFingerprint,
            });
            return success({
              decisionId: head.decision_id,
              grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
              decisionType: input.decisionType,
              decisionAction: input.decisionAction,
              supersedesDecisionId: null,
              decidedByRole,
              effective: effectiveness.effective,
              effectivenessReason: effectiveness.reason,
              headDecisionId: effectiveness.headDecisionId,
              replayed: true,
            });
          }

          const decisionId = crypto.randomUUID();
          const supersedesDecisionId = head?.decision_id || null;
          await tx.query(
            `INSERT INTO kai.grant_response_packet_human_authority_decisions (
               decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action,
               decided_by, decided_by_role, supersedes_decision_id, created_by_type, created_at
             )
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,'human',$9::timestamptz)`,
            [
              decisionId,
              input.organizationId,
              input.grantResponsePacketExportCandidateId,
              input.decisionType,
              input.decisionAction,
              input.actorContext.actorUserId,
              decidedByRole,
              supersedesDecisionId,
              input.now,
            ],
          );

          const effectiveness = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
            organizationId: input.organizationId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            decisionType: input.decisionType,
            candidate,
            currentFingerprint,
          });

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit({
            payload: buildDecisionAuditPayload({
              input,
              candidate,
              decisionId,
              supersedesDecisionId,
              decidedByRole,
              effectiveness: { data: effectiveness },
            }),
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          await preparedAudit.publish();

          return success({
            decisionId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            decisionType: input.decisionType,
            decisionAction: input.decisionAction,
            supersedesDecisionId,
            decidedByRole,
            effective: effectiveness.effective,
            effectivenessReason: effectiveness.reason,
            headDecisionId: effectiveness.headDecisionId,
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketHumanAuthorityDecisionRollbackResultError) return error.result;
        if (error?.code === "23505" || error?.code === "25001") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    // Read-only. Not wired into any final-eligibility evaluation, manifest,
    // route, or frontend in this package.
    async evaluateEffectiveness(input, dependencies = {}) {
      if (!isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput(input)) return failure("validation_blocker");

      const { fingerprint: currentFingerprint, error: fingerprintError } =
        await resolveCurrentGrantResponsePacketExportCandidateFingerprint(input, dependencies);

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForAuthority(tx, input);
          if (!candidate || candidate.engagement_id !== input.engagementId) {
            return success({ effective: false, reason: "candidate_missing", headDecisionId: null });
          }
          if (fingerprintError) {
            return success({ effective: false, reason: "packet_candidate_superseded", headDecisionId: null });
          }
          const effectiveness = await evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction(tx, {
            organizationId: input.organizationId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            decisionType: input.decisionType,
            candidate,
            currentFingerprint,
          });
          return success(effectiveness);
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __grantResponsePacketHumanAuthorityDecisionRepositoryTestables = Object.freeze({
  isRecordGrantResponsePacketHumanAuthorityDecisionInput,
  isEvaluateGrantResponsePacketHumanAuthorityEffectivenessInput,
  isCanonicalDecidedByRole,
  loadGrantResponsePacketExportCandidateForAuthority,
  evaluateGrantResponsePacketHumanAuthorityEffectivenessInTransaction,
});

export const __grantResponsePacketHumanAuthorityDecisionRepositoryContract = Object.freeze({
  UUID_PATTERN,
});
