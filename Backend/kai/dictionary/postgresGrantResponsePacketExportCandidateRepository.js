import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { composeGrantResponsePacketRenderModel } from "../services/kaiGrantResponsePacketRenderModelService.js";
import { composeGrantResponsePacketExportCandidateFingerprint } from "../services/kaiGrantResponsePacketExportCandidateFingerprintService.js";
import {
  GRANT_RESPONSE_PACKET_AUDIENCE,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_CREATED_OPERATION,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_AUDIT_CONTRACT,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_REQUESTED_OPERATION,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_STARTED_OPERATION,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_COMPLETED_OPERATION,
} from "./grantResponsePacketExportCandidateContract.js";

const PACKET_EXPORT_REVIEW_LIFECYCLE_PROFILES = Object.freeze([
  Object.freeze({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "resolved", reviewStatus: "resolved" }),
]);
const PACKET_EXPORT_REVIEW_OPEN_LIFECYCLE_PROFILE = PACKET_EXPORT_REVIEW_LIFECYCLE_PROFILES[0];
const PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE = PACKET_EXPORT_REVIEW_LIFECYCLE_PROFILES[1];
const PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE = PACKET_EXPORT_REVIEW_LIFECYCLE_PROFILES[2];

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class GrantResponsePacketExportCandidateRollbackResultError extends Error {
  constructor(result) {
    super("rollback grant-response-packet-export-candidate transaction");
    this.name = "GrantResponsePacketExportCandidateRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new GrantResponsePacketExportCandidateRollbackResultError(failure(code));
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

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

// Frontend contract-defect fix: the packet review-queue row's own
// `updated_at` is the exact CAS token a caller must echo back as
// `expectedUpdatedAt` on the next START/COMPLETE call - without it, no
// caller of requestGrantResponsePacketExportReview or
// startGrantResponsePacketExportReview could ever construct a valid
// follow-on START/COMPLETE request. Mirrors the existing single-draft
// `asCanonicalUtcTimestamp` helper in postgresGeneratedContentRepository.js.
function asCanonicalUtcTimestamp(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Exact-keys input contract: organizationId + engagementId + actorContext +
// now, and NOTHING else. In particular, no memberIds,
// generatedContentDraftIds, exportCandidateId(s), exportManifestId(s), or
// canonicalFingerprint is ever accepted from a caller - every one of those
// is derived, inside this same transaction, exclusively from the
// authoritative render model this function composes itself. A caller that
// passes any such field is rejected outright by hasExactKeys, never
// silently ignored.
function isCreateGrantResponsePacketExportCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function loadExistingIdentity(tx, { organizationId, engagementId }) {
  const { rows } = await tx.query(
    `SELECT grant_response_packet_export_identity_id::text AS grant_response_packet_export_identity_id
       FROM kai.grant_response_packet_export_identities
      WHERE organization_id = $1::uuid AND engagement_id = $2::uuid AND packet_audience = $3`,
    [organizationId, engagementId, GRANT_RESPONSE_PACKET_AUDIENCE],
  );
  return rows[0] || null;
}

// Resolves (get-or-create, converging) the exact same P14-02 durable packet
// identity `getOrCreateGrantResponsePacketExportIdentity` would produce, but
// inline in THIS transaction so identity resolution and candidate creation
// are atomic. This never mints a second identity table or a second identity
// for the same (organization, engagement, funder) triple - it targets the
// literal P14-02 table and its literal replay-convergence key.
async function resolveGrantResponsePacketExportIdentityInTransaction(tx, { organizationId, engagementId, actorContext }) {
  const identityId = crypto.randomUUID();
  const { rows } = await tx.query(
    `INSERT INTO kai.grant_response_packet_export_identities (
       grant_response_packet_export_identity_id, organization_id, engagement_id,
       packet_audience, created_by, created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,'human')
     ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING
     RETURNING grant_response_packet_export_identity_id::text AS grant_response_packet_export_identity_id`,
    [identityId, organizationId, engagementId, GRANT_RESPONSE_PACKET_AUDIENCE, actorContext.actorUserId],
  );
  if (rows[0]) return rows[0].grant_response_packet_export_identity_id;
  const existing = await loadExistingIdentity(tx, { organizationId, engagementId });
  return existing ? existing.grant_response_packet_export_identity_id : null;
}

async function insertCandidate(tx, { candidateId, organizationId, identityId, fingerprint, actorContext, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.grant_response_packet_export_candidates (
       grant_response_packet_export_candidate_id, organization_id, grant_response_packet_export_identity_id,
       fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,'human',$7::timestamptz)
     ON CONFLICT (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) DO NOTHING
     RETURNING grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id`,
    [
      candidateId,
      organizationId,
      identityId,
      GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      actorContext.actorUserId,
      now,
    ],
  );
  return rows[0] || null;
}

async function loadExistingCandidate(tx, { organizationId, identityId, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id
       FROM kai.grant_response_packet_export_candidates
      WHERE organization_id = $1::uuid AND grant_response_packet_export_identity_id = $2::uuid
        AND canonical_fingerprint = $3`,
    [organizationId, identityId, fingerprint],
  );
  return rows[0] || null;
}

async function loadCandidateMembers(tx, { organizationId, candidateId }) {
  const { rows } = await tx.query(
    `SELECT generated_content_draft_id::text AS generated_content_draft_id, ordinal
       FROM kai.grant_response_packet_export_candidate_members
      WHERE organization_id = $1::uuid AND grant_response_packet_export_candidate_id = $2::uuid
      ORDER BY ordinal ASC`,
    [organizationId, candidateId],
  );
  return rows;
}

async function insertCandidateMembers(tx, { organizationId, candidateId, orderedGeneratedContentDraftIds, now }) {
  for (let ordinal = 0; ordinal < orderedGeneratedContentDraftIds.length; ordinal += 1) {
    await tx.query(
      `INSERT INTO kai.grant_response_packet_export_candidate_members (
         grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal, created_at
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz)`,
      [candidateId, organizationId, orderedGeneratedContentDraftIds[ordinal], ordinal, now],
    );
  }
}

async function defaultComposeRenderModel(input, dependencies) {
  return composeGrantResponsePacketRenderModel(
    { organizationId: input.organizationId, engagementId: input.engagementId, actorContext: input.actorContext },
    dependencies,
  );
}

// P14-05 packet export-review binding: exact-keys input contract -
// organizationId + engagementId + grantResponsePacketExportCandidateId +
// actorContext + now, and NOTHING else. No members, no fingerprint, no
// memberCount, no manifest identity, no approval/final-release decision is
// ever accepted from a caller.
function isRequestGrantResponsePacketExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

// Resolves the exact, existing, immutable P14-03 candidate row server-side
// and proves - in the same transaction as the review-queue insert below -
// that it belongs to this organizationId AND that its P14-02 packet
// identity belongs to this engagementId. Never trusts a client-supplied
// engagement/organization pairing without this proof.
async function loadGrantResponsePacketExportCandidateForReview(tx, { organizationId, engagementId, grantResponsePacketExportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT c.grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
            c.organization_id::text AS organization_id,
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
  if (!row || row.engagement_id !== engagementId) return null;
  return row;
}

async function insertGrantResponsePacketExportReviewQueueRow(tx, { reviewQueueItemId, organizationId, engagementId, candidateId }) {
  const contract = GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
  const { rows } = await tx.query(
    `INSERT INTO kai.review_queue_items (
       review_queue_item_id, organization_id, engagement_id, queue_type, target_object_type, target_object_id,
       priority, queue_status, review_status, summary, required_action, queue_metadata, created_by, created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,'open','needs_gk_review',$8,$9,'{}'::jsonb,NULL,$10)
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id) WHERE queue_type = 'export_review'
     DO NOTHING
     RETURNING review_queue_item_id::text AS review_queue_item_id, queue_status, review_status, updated_at`,
    [
      reviewQueueItemId,
      organizationId,
      engagementId,
      contract.queueType,
      contract.targetObjectType,
      candidateId,
      contract.priority,
      contract.summary,
      contract.requiredAction,
      contract.createdByType,
    ],
  );
  return rows[0] || null;
}

async function loadGrantResponsePacketExportReviewQueueRow(tx, { organizationId, candidateId }) {
  const contract = GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id, organization_id::text AS organization_id,
            queue_type, target_object_type, target_object_id::text AS target_object_id,
            priority, queue_status, review_status, summary, required_action, blocked_reason,
            assigned_to::text AS assigned_to, due_at, queue_metadata, created_by::text AS created_by, created_by_type,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = $3
        AND target_object_id = $4::uuid`,
    [organizationId, contract.queueType, contract.targetObjectType, candidateId],
  );
  return rows[0] || null;
}

function isValidGrantResponsePacketExportReviewQueueRow(
  row,
  { organizationId, candidateId },
  allowedLifecycleProfiles = PACKET_EXPORT_REVIEW_LIFECYCLE_PROFILES,
) {
  const contract = GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
  if (!row) return false;
  if (row.organization_id !== organizationId) return false;
  if (row.target_object_id !== candidateId) return false;
  if (row.queue_type !== contract.queueType) return false;
  if (row.target_object_type !== contract.targetObjectType) return false;
  if (row.priority !== contract.priority) return false;
  if (row.summary !== contract.summary) return false;
  if (row.required_action !== contract.requiredAction) return false;
  if (row.blocked_reason !== null) return false;
  if (row.assigned_to !== null) return false;
  if (row.due_at !== null) return false;
  if (row.created_by !== null) return false;
  if (row.created_by_type !== contract.createdByType) return false;
  if (!row.queue_metadata || typeof row.queue_metadata !== "object" || Array.isArray(row.queue_metadata)) return false;
  if (Object.keys(row.queue_metadata).length !== 0) return false;
  return allowedLifecycleProfiles.some(
    (profile) => row.queue_status === profile.queueStatus && row.review_status === profile.reviewStatus,
  );
}

// P14-06A packet export-review START: exact-keys input contract -
// organizationId + engagementId + grantResponsePacketExportCandidateId +
// exportReviewQueueItemId + expectedUpdatedAt + actorContext + now, and
// NOTHING else. No members, no fingerprint, no memberCount, no manifest
// identity, and no approval/final-release decision is ever accepted from a
// caller.
function isStartGrantResponsePacketExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "exportReviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

// P14-06B packet export-review COMPLETE: exact-keys input contract -
// identical shape to the P14-06A START input (organizationId + engagementId
// + grantResponsePacketExportCandidateId + exportReviewQueueItemId +
// expectedUpdatedAt + actorContext + now), and NOTHING else. No members, no
// fingerprint, no memberCount, no manifest identity, and no approval/
// final-release decision is ever accepted from a caller.
function isCompleteGrantResponsePacketExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "exportReviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

// P14-06D authoritative READ ONLY current-candidate state: exact-keys input
// contract mirrors the authoritative packet/render-model chain it uses, but
// accepts no candidate id, queue id, timestamp, fingerprint, member list, or
// authority/finalization-shaped field from a caller.
function isReadCurrentGrantResponsePacketExportCandidateReviewStateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && isMappedHumanActor(input.actorContext);
}

// P14-07 final-export eligibility: exact-keys input contract for reading the
// governed export_review queue state of an EXACT, already-identified packet
// export candidate id (never "current" - the literal candidate row the
// caller identifies, which may or may not still be the current one). No
// fingerprint, member list, or authority/finalization-shaped field is ever
// accepted from a caller.
function isReadGrantResponsePacketExportCandidateReviewStateByIdInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "grantResponsePacketExportCandidateId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId);
}

async function loadGrantResponsePacketExportReviewQueueRowById(tx, { organizationId, exportReviewQueueItemId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id, organization_id::text AS organization_id,
            engagement_id::text AS engagement_id, queue_type, target_object_type,
            target_object_id::text AS target_object_id, priority, queue_status, review_status,
            blocked_reason, assigned_to::text AS assigned_to, due_at, summary, required_action,
            queue_metadata, created_by::text AS created_by, created_by_type, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid`,
    [organizationId, exportReviewQueueItemId],
  );
  return rows[0] || null;
}

export function createPostgresGrantResponsePacketExportCandidateRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    // Creates (or converges on) exactly one grant-response-packet export
    // candidate plus its server-derived, ordered member snapshot, atomically.
    // Accepts ONLY {organizationId, engagementId, actorContext, now}: no
    // membership, draft id, candidate id, manifest id, or fingerprint is
    // ever taken from the caller. Creating a candidate grants no approval,
    // export authority, final release, or manifest state - no such table is
    // read or written here.
    async createGrantResponsePacketExportCandidate(input, dependencies = {}) {
      if (!isCreateGrantResponsePacketExportCandidateInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const composeRenderModel = dependencies.composeRenderModel || defaultComposeRenderModel;
      const renderModelResult = await composeRenderModel(input, dependencies.renderModelDependencies || dependencies);
      if (!renderModelResult?.ok) {
        // Propagate the authoritative render-model/packet failure verbatim -
        // this repository invents no substitute error code (e.g. never
        // reports an authorization or feature-disabled failure as
        // "not_found" or "validation_blocker").
        return {
          ok: false,
          data: null,
          error: renderModelResult?.error || { code: "system_error", status: 500 },
        };
      }

      const { fingerprint, orderedGeneratedContentDraftIds, error: fingerprintError } =
        composeGrantResponsePacketExportCandidateFingerprint(renderModelResult.data);
      if (!fingerprint) {
        // "not_funder_audience" and "no_eligible_members" are both
        // legitimate, expected authoritative packet states (wrong audience,
        // or a packet with nothing currently eligible to export) - the
        // existing validation_blocker vocabulary, not a system_error. Any
        // other fingerprint error means the render model was structurally
        // malformed, which stays a system_error.
        const isExpectedBlocker = fingerprintError === "not_funder_audience" || fingerprintError === "no_eligible_members";
        return failure(isExpectedBlocker ? "validation_blocker" : "system_error");
      }

      try {
        return await runInTransaction(async (tx) => {
          const identityId = await resolveGrantResponsePacketExportIdentityInTransaction(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            actorContext: input.actorContext,
          });
          if (!identityId) rollbackFailure("system_error");

          const candidateId = crypto.randomUUID();
          const insertedRow = await insertCandidate(tx, {
            candidateId,
            organizationId: input.organizationId,
            identityId,
            fingerprint,
            actorContext: input.actorContext,
            now: input.now,
          });

          let grantResponsePacketExportCandidateId;
          let members;
          let replayed;
          if (insertedRow) {
            grantResponsePacketExportCandidateId = insertedRow.grant_response_packet_export_candidate_id;
            await insertCandidateMembers(tx, {
              organizationId: input.organizationId,
              candidateId: grantResponsePacketExportCandidateId,
              orderedGeneratedContentDraftIds,
              now: input.now,
            });
            members = orderedGeneratedContentDraftIds;
            replayed = false;
          } else {
            const existing = await loadExistingCandidate(tx, {
              organizationId: input.organizationId,
              identityId,
              fingerprint,
            });
            if (!existing) rollbackFailure("system_error");
            grantResponsePacketExportCandidateId = existing.grant_response_packet_export_candidate_id;
            const existingMembers = await loadCandidateMembers(tx, {
              organizationId: input.organizationId,
              candidateId: grantResponsePacketExportCandidateId,
            });
            members = existingMembers.map((row) => row.generated_content_draft_id);
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_CREATED_OPERATION,
                actor_type: "human",
                object_type: "grant_response_packet_export_candidate",
                contract: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_AUDIT_CONTRACT,
                grant_response_packet_export_candidate_id: grantResponsePacketExportCandidateId,
                engagement_id: input.engagementId,
                grant_response_packet_export_identity_id: identityId,
                canonical_fingerprint: fingerprint,
                member_count: members.length,
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            grantResponsePacketExportCandidateId,
            grantResponsePacketExportIdentityId: identityId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            fingerprintContractVersion: GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
            canonicalFingerprint: fingerprint,
            memberGeneratedContentDraftIds: members,
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23505") {
          // Concurrent convergent insert already committed the same
          // (identity, fingerprint) row - this is not a failure, but this
          // repository does not retry automatically; the caller may call
          // again to observe the converged row.
          return failure("system_error");
        }
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // P14-05: requests governed export review for the EXACT existing,
    // immutable P14-03 packet export candidate identified by
    // grantResponsePacketExportCandidateId - never a client-supplied
    // membership/fingerprint/manifest identity. Reuses the one existing
    // 'export_review' queue_type and its one existing lifecycle matrix via
    // the P14-05 widened review_queue_items contract. Requesting review
    // grants no approval, no funder/public readiness, no export authority,
    // no final release, and no manifest - no such table is read or written
    // here.
    async requestGrantResponsePacketExportReview(input, dependencies = {}) {
      if (!isRequestGrantResponsePacketExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          });
          if (!candidate) rollbackFailure("not_found");

          const reviewQueueItemId = crypto.randomUUID();
          const insertedRow = await insertGrantResponsePacketExportReviewQueueRow(tx, {
            reviewQueueItemId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            candidateId: input.grantResponsePacketExportCandidateId,
          });

          let queueRow;
          let replayed;
          if (insertedRow) {
            queueRow = insertedRow;
            replayed = false;
          } else {
            const existing = await loadGrantResponsePacketExportReviewQueueRow(tx, {
              organizationId: input.organizationId,
              candidateId: input.grantResponsePacketExportCandidateId,
            });
            if (!isValidGrantResponsePacketExportReviewQueueRow(existing, {
              organizationId: input.organizationId,
              candidateId: input.grantResponsePacketExportCandidateId,
            })) {
              rollbackFailure("conflict_current_state_changed");
            }
            queueRow = existing;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: GRANT_RESPONSE_PACKET_EXPORT_REVIEW_REQUESTED_OPERATION,
                actor_type: "human",
                object_type: "grant_response_packet_export_candidate",
                grant_response_packet_export_candidate_id: input.grantResponsePacketExportCandidateId,
                engagement_id: input.engagementId,
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            reviewQueueItemId: queueRow.review_queue_item_id,
            queueStatus: queueRow.queue_status,
            reviewStatus: queueRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(queueRow.updated_at),
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // P14-06A: START ONLY - transitions the EXACT existing governed
    // 'export_review' queue row identified by exportReviewQueueItemId from
    // open/needs_gk_review to in_progress/needs_gk_review, for the EXACT
    // existing, immutable P14-03 packet export candidate identified by
    // grantResponsePacketExportCandidateId. Never a client-supplied
    // membership/fingerprint/manifest identity, never a client-selected
    // latest/newest/preferred candidate or queue item. Reuses the optimistic
    // expectedUpdatedAt CAS contract - a stale expectedUpdatedAt fails
    // closed with conflict_current_state_changed, and a caller that already
    // observed the started state may safely replay. Starting review grants
    // no final eligibility evaluation, no approval, no funder/public
    // readiness, no export authority, no final release, and no manifest -
    // no such table is read or written here.
    async startGrantResponsePacketExportReview(input, dependencies = {}) {
      if (!isStartGrantResponsePacketExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          });
          if (!candidate) rollbackFailure("not_found");

          const contract = GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
          const queueRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!queueRow) rollbackFailure("not_found");
          if (
            queueRow.target_object_type !== contract.targetObjectType
            || queueRow.target_object_id !== input.grantResponsePacketExportCandidateId
            || queueRow.engagement_id !== input.engagementId
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    updated_at = $2::timestamptz
              WHERE organization_id = $3::uuid
                AND review_queue_item_id = $4::uuid
                AND engagement_id = $5::uuid
                AND queue_type = $6
                AND target_object_type = $7
                AND target_object_id = $8::uuid
                AND queue_status = $9
                AND review_status = $10
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $11::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
              input.now,
              input.organizationId,
              input.exportReviewQueueItemId,
              input.engagementId,
              contract.queueType,
              contract.targetObjectType,
              input.grantResponsePacketExportCandidateId,
              PACKET_EXPORT_REVIEW_OPEN_LIFECYCLE_PROFILE.queueStatus,
              PACKET_EXPORT_REVIEW_OPEN_LIFECYCLE_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            const currentRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
              organizationId: input.organizationId,
              exportReviewQueueItemId: input.exportReviewQueueItemId,
            });
            if (!currentRow) rollbackFailure("not_found");
            if (!isValidGrantResponsePacketExportReviewQueueRow(currentRow, {
              organizationId: input.organizationId,
              candidateId: input.grantResponsePacketExportCandidateId,
            }, [PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE])) {
              rollbackFailure("conflict_current_state_changed");
            }
            return success({
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
              reviewQueueItemId: input.exportReviewQueueItemId,
              queueStatus: currentRow.queue_status,
              reviewStatus: currentRow.review_status,
              reviewUpdatedAt: asCanonicalUtcTimestamp(currentRow.updated_at),
              replayed: true,
            });
          }

          const postWriteRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!postWriteRow) rollbackFailure("system_error");
          if (!isValidGrantResponsePacketExportReviewQueueRow(postWriteRow, {
            organizationId: input.organizationId,
            candidateId: input.grantResponsePacketExportCandidateId,
          }, [PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE])) {
            rollbackFailure("conflict_current_state_changed");
          }

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: {
              attempted_operation: GRANT_RESPONSE_PACKET_EXPORT_REVIEW_STARTED_OPERATION,
              actor_type: "human",
              object_type: "grant_response_packet_export_candidate",
              grant_response_packet_export_candidate_id: input.grantResponsePacketExportCandidateId,
              engagement_id: input.engagementId,
              review_queue_item_id: input.exportReviewQueueItemId,
              expected_updated_at: input.expectedUpdatedAt,
              previous_queue_status: PACKET_EXPORT_REVIEW_OPEN_LIFECYCLE_PROFILE.queueStatus,
              resulting_queue_status: PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
              previous_review_status: PACKET_EXPORT_REVIEW_OPEN_LIFECYCLE_PROFILE.reviewStatus,
              resulting_review_status: PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus,
            },
            db: tx,
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          await preparedAudit.publish();

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            reviewQueueItemId: postWriteRow.review_queue_item_id,
            queueStatus: postWriteRow.queue_status,
            reviewStatus: postWriteRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(postWriteRow.updated_at),
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // P14-06B: COMPLETE ONLY - transitions the EXACT existing governed
    // 'export_review' queue row identified by exportReviewQueueItemId from
    // in_progress/needs_gk_review to resolved/resolved, for the EXACT
    // existing, immutable P14-03 packet export candidate identified by
    // grantResponsePacketExportCandidateId. Never a client-supplied
    // membership/fingerprint/manifest identity, never a client-selected
    // latest/newest/preferred candidate or queue item. Reuses the same
    // optimistic expectedUpdatedAt CAS contract the START transition above
    // uses - a stale expectedUpdatedAt fails closed with
    // conflict_current_state_changed, and a caller that already observed
    // the resolved state may safely replay. Completion means only that a
    // gk_admin completed the governed human export review of this exact
    // immutable packet candidate - it grants NO final eligibility
    // evaluation, NO approval, NO funder/public readiness, NO export
    // authority, NO final release, and NO manifest - no such table is read
    // or written here.
    async completeGrantResponsePacketExportReview(input, dependencies = {}) {
      if (!isCompleteGrantResponsePacketExportReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          });
          if (!candidate) rollbackFailure("not_found");

          const contract = GRANT_RESPONSE_PACKET_EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
          const queueRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!queueRow) rollbackFailure("not_found");
          if (
            queueRow.target_object_type !== contract.targetObjectType
            || queueRow.target_object_id !== input.grantResponsePacketExportCandidateId
            || queueRow.engagement_id !== input.engagementId
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    review_status = $2,
                    updated_at = $3::timestamptz
              WHERE organization_id = $4::uuid
                AND review_queue_item_id = $5::uuid
                AND engagement_id = $6::uuid
                AND queue_type = $7
                AND target_object_type = $8
                AND target_object_id = $9::uuid
                AND queue_status = $10
                AND review_status = $11
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $12::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id`,
            [
              PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE.queueStatus,
              PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE.reviewStatus,
              input.now,
              input.organizationId,
              input.exportReviewQueueItemId,
              input.engagementId,
              contract.queueType,
              contract.targetObjectType,
              input.grantResponsePacketExportCandidateId,
              PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
              PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          if (updateResult.rowCount !== 1) {
            const currentRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
              organizationId: input.organizationId,
              exportReviewQueueItemId: input.exportReviewQueueItemId,
            });
            if (!currentRow) rollbackFailure("not_found");
            if (!isValidGrantResponsePacketExportReviewQueueRow(currentRow, {
              organizationId: input.organizationId,
              candidateId: input.grantResponsePacketExportCandidateId,
            }, [PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE])) {
              rollbackFailure("conflict_current_state_changed");
            }
            return success({
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
              reviewQueueItemId: input.exportReviewQueueItemId,
              queueStatus: currentRow.queue_status,
              reviewStatus: currentRow.review_status,
              reviewUpdatedAt: asCanonicalUtcTimestamp(currentRow.updated_at),
              replayed: true,
            });
          }

          const postWriteRow = await loadGrantResponsePacketExportReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            exportReviewQueueItemId: input.exportReviewQueueItemId,
          });
          if (!postWriteRow) rollbackFailure("system_error");
          if (!isValidGrantResponsePacketExportReviewQueueRow(postWriteRow, {
            organizationId: input.organizationId,
            candidateId: input.grantResponsePacketExportCandidateId,
          }, [PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE])) {
            rollbackFailure("conflict_current_state_changed");
          }

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: {
              attempted_operation: GRANT_RESPONSE_PACKET_EXPORT_REVIEW_COMPLETED_OPERATION,
              actor_type: "human",
              object_type: "grant_response_packet_export_candidate",
              grant_response_packet_export_candidate_id: input.grantResponsePacketExportCandidateId,
              engagement_id: input.engagementId,
              review_queue_item_id: input.exportReviewQueueItemId,
              expected_updated_at: input.expectedUpdatedAt,
              previous_queue_status: PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.queueStatus,
              resulting_queue_status: PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE.queueStatus,
              previous_review_status: PACKET_EXPORT_REVIEW_START_LIFECYCLE_PROFILE.reviewStatus,
              resulting_review_status: PACKET_EXPORT_REVIEW_COMPLETE_LIFECYCLE_PROFILE.reviewStatus,
            },
            db: tx,
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          await preparedAudit.publish();

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            reviewQueueItemId: postWriteRow.review_queue_item_id,
            queueStatus: postWriteRow.queue_status,
            reviewStatus: postWriteRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(postWriteRow.updated_at),
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // P14-07 final-export eligibility: READ ONLY governed export_review queue
    // state for the EXACT existing, immutable packet export candidate id the
    // caller identifies - reuses the exact existing
    // loadGrantResponsePacketExportCandidateForReview +
    // loadGrantResponsePacketExportReviewQueueRow +
    // isValidGrantResponsePacketExportReviewQueueRow helpers this file already
    // uses for REQUEST/START/COMPLETE/current-read - no new SQL. Unlike
    // readCurrentGrantResponsePacketExportCandidateReviewState below, this
    // never recomposes a render model/fingerprint and never resolves the
    // current candidate - it proves org/engagement ownership of the exact
    // given candidate id and returns that exact candidate's own review-queue
    // state (or nulls if none exists), whether or not it is still the
    // current candidate for its packet identity. Never creates/replays a
    // candidate, never requests/starts/completes a review, never selects a
    // preferred row, and never touches final-release/manifest state.
    async readGrantResponsePacketExportCandidateReviewStateById(input) {
      if (!isReadGrantResponsePacketExportCandidateReviewStateByIdInput(input)) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadGrantResponsePacketExportCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          });
          if (!candidate) return failure("not_found");

          const queueRow = await loadGrantResponsePacketExportReviewQueueRow(tx, {
            organizationId: input.organizationId,
            candidateId: input.grantResponsePacketExportCandidateId,
          });
          if (queueRow && !isValidGrantResponsePacketExportReviewQueueRow(queueRow, {
            organizationId: input.organizationId,
            candidateId: input.grantResponsePacketExportCandidateId,
          })) {
            rollbackFailure("conflict_current_state_changed");
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            reviewQueueItemId: queueRow?.review_queue_item_id ?? null,
            queueStatus: queueRow?.queue_status ?? null,
            reviewStatus: queueRow?.review_status ?? null,
            reviewUpdatedAt: asCanonicalUtcTimestamp(queueRow?.updated_at),
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    // P14-06D: READ ONLY authoritative state for the current semantic Grant
    // Response Packet. It composes the current render model, computes the
    // existing P14-03 fingerprint, reads an already-existing P14-02 identity,
    // reads an already-existing exact candidate by (identity, fingerprint),
    // and then reads that candidate's governed export_review row if present.
    // It never creates/replays a candidate, never requests/starts/completes a
    // review, never chooses latest/newest/preferred rows, and never touches
    // final-release/manifest state.
    async readCurrentGrantResponsePacketExportCandidateReviewState(input, dependencies = {}) {
      if (!isReadCurrentGrantResponsePacketExportCandidateReviewStateInput(input)) return failure("validation_blocker");

      const composeRenderModel = dependencies.composeRenderModel || defaultComposeRenderModel;
      const renderModelResult = await composeRenderModel(input, dependencies.renderModelDependencies || dependencies);
      if (!renderModelResult?.ok) {
        return {
          ok: false,
          data: null,
          error: renderModelResult?.error || { code: "system_error", status: 500 },
        };
      }

      const { fingerprint, error: fingerprintError } =
        composeGrantResponsePacketExportCandidateFingerprint(renderModelResult.data);
      if (!fingerprint) {
        const isNoCurrentCandidateState = fingerprintError === "no_eligible_members";
        return isNoCurrentCandidateState
          ? success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId: null,
            reviewQueueItemId: null,
            queueStatus: null,
            reviewStatus: null,
            reviewUpdatedAt: null,
          })
          : failure(fingerprintError === "not_funder_audience" ? "validation_blocker" : "system_error");
      }

      try {
        return await runInTransaction(async (tx) => {
          const identity = await loadExistingIdentity(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
          });
          if (!identity) {
            return success({
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              grantResponsePacketExportCandidateId: null,
              reviewQueueItemId: null,
              queueStatus: null,
              reviewStatus: null,
              reviewUpdatedAt: null,
            });
          }

          const candidate = await loadExistingCandidate(tx, {
            organizationId: input.organizationId,
            identityId: identity.grant_response_packet_export_identity_id,
            fingerprint,
          });
          if (!candidate) {
            return success({
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              grantResponsePacketExportCandidateId: null,
              reviewQueueItemId: null,
              queueStatus: null,
              reviewStatus: null,
              reviewUpdatedAt: null,
            });
          }

          const grantResponsePacketExportCandidateId = candidate.grant_response_packet_export_candidate_id;
          const queueRow = await loadGrantResponsePacketExportReviewQueueRow(tx, {
            organizationId: input.organizationId,
            candidateId: grantResponsePacketExportCandidateId,
          });
          if (queueRow && !isValidGrantResponsePacketExportReviewQueueRow(queueRow, {
            organizationId: input.organizationId,
            candidateId: grantResponsePacketExportCandidateId,
          })) {
            rollbackFailure("conflict_current_state_changed");
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            grantResponsePacketExportCandidateId,
            reviewQueueItemId: queueRow?.review_queue_item_id ?? null,
            queueStatus: queueRow?.queue_status ?? null,
            reviewStatus: queueRow?.review_status ?? null,
            reviewUpdatedAt: asCanonicalUtcTimestamp(queueRow?.updated_at),
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },
  });
}

export const __grantResponsePacketExportCandidateRepositoryTestables = Object.freeze({
  isCreateGrantResponsePacketExportCandidateInput,
  isRequestGrantResponsePacketExportReviewInput,
  isStartGrantResponsePacketExportReviewInput,
  isCompleteGrantResponsePacketExportReviewInput,
  isReadCurrentGrantResponsePacketExportCandidateReviewStateInput,
  isReadGrantResponsePacketExportCandidateReviewStateByIdInput,
  isValidGrantResponsePacketExportReviewQueueRow,
  UUID_PATTERN,
});
