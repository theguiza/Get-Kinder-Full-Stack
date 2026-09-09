import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { composeGrantResponsePacketRenderModel } from "../services/kaiGrantResponsePacketRenderModelService.js";
import { composeGrantResponsePacketExportCandidateFingerprint } from "../services/kaiGrantResponsePacketExportCandidateFingerprintService.js";
import {
  GRANT_RESPONSE_PACKET_AUDIENCE,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_CREATED_OPERATION,
  GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_AUDIT_CONTRACT,
} from "./grantResponsePacketExportCandidateContract.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
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
  });
}

export const __grantResponsePacketExportCandidateRepositoryTestables = Object.freeze({
  isCreateGrantResponsePacketExportCandidateInput,
  UUID_PATTERN,
});
