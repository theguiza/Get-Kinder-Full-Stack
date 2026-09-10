import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import {
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_CREATED_OPERATION,
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_AUDIT_CONTRACT,
  GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE,
} from "./grantResponsePacketExportManifestContract.js";

// ---------------------------------------------------------------------------
// P14-08A: Grant Response Packet export-manifest persistence foundation. The
// packet-level analogue of the existing P3-19
// postgresExportManifestRepository.js, bound instead to an exact, existing,
// immutable P14-03 grant_response_packet_export_candidates row and its exact
// effective P14-07B1 export_authority_granted decision - never a member-level
// export_candidate_id or kai.human_authority_decisions row (those tables are
// structurally disjoint; see the P14-08A migration notes).
//
// Unlike P3-19 (whose eligibility composition is entirely pure-SQL and runs
// inside the same write transaction as the insert), a packet's current
// semantic state can only be recomposed through the existing, actor-gated
// composeGrantResponsePacketRenderModel chain, which opens its own
// connections and cannot run inside an open tx - exactly the same structural
// constraint P14-06D/P14-07B1/P14-07 already document and design around. So
// eligibility (the real, unmodified evaluateGrantResponsePacketFinalExportEligibility)
// and the effective-authority-decision id are both resolved BEFORE the write
// transaction; the transaction itself re-loads the exact candidate row and
// re-checks that its own stored canonical_fingerprint is unchanged, closing
// the same TOCTOU gap P14-07B1's own recordDecision closes, before ever
// writing a manifest row.
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

export class GrantResponsePacketExportManifestRollbackResultError extends Error {
  constructor(result) {
    super("rollback grant-response-packet-export-manifest transaction");
    this.name = "GrantResponsePacketExportManifestRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new GrantResponsePacketExportManifestRollbackResultError(failure(code));
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

// Manifest identity is a deterministic hash over the packet export candidate
// and the exact effective P14-07B1 grant decision resolved before this
// insert - this is what gives replay (the same eligible state submitted
// twice) exactly one manifest row, mirroring the P3-19 fingerprint shape
// exactly (organizationId + candidateId + effectiveAuthorityDecisionId).
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
// by the real evaluateGrantResponsePacketFinalExportEligibility and B1
// authorityRepository.evaluateEffectiveness this function delegates to.
function isCreateGrantResponsePacketExportManifestInput(input) {
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

function isReadExportManifestByIdInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "grantResponsePacketExportManifestId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.grantResponsePacketExportManifestId);
}

function isResolveExportManifestStateForCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "grantResponsePacketExportCandidateId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId);
}

async function createDefaultDependencies() {
  const { evaluateGrantResponsePacketFinalExportEligibility } = await import(
    "../services/kaiGrantResponsePacketFinalExportEligibilityGateService.js"
  );
  const { createPostgresGrantResponsePacketHumanAuthorityDecisionRepository } = await import(
    "./postgresGrantResponsePacketHumanAuthorityDecisionRepository.js"
  );
  return {
    evaluateEligibility: evaluateGrantResponsePacketFinalExportEligibility,
    authorityRepository: createPostgresGrantResponsePacketHumanAuthorityDecisionRepository(),
  };
}

// Resolves the exact, existing, immutable P14-03 packet candidate row
// server-side and proves that it belongs to this organizationId AND that its
// P14-02 packet identity belongs to this engagementId - mirrors P14-07B1's
// own loadGrantResponsePacketExportCandidateForAuthority exactly. Never
// matches a member-level kai.export_candidates row or a packet structural
// identity id in place of this exact candidate id.
async function loadGrantResponsePacketExportCandidateForManifest(tx, { organizationId, grantResponsePacketExportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT c.grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
            c.organization_id::text AS organization_id,
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
  return rows[0] || null;
}

async function insertGrantResponsePacketExportManifest(tx, { manifestId, input, effectiveAuthorityDecisionId, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.grant_response_packet_export_manifests (
       grant_response_packet_export_manifest_id, organization_id, grant_response_packet_export_candidate_id,
       effective_authority_decision_id, effective_authority_decision_type,
       fingerprint_contract_version, canonical_fingerprint,
       created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'export_authority_granted',$5,$6,$7::uuid,'human',$8::timestamptz)
     ON CONFLICT (organization_id, grant_response_packet_export_candidate_id, canonical_fingerprint) DO NOTHING
     RETURNING grant_response_packet_export_manifest_id::text AS grant_response_packet_export_manifest_id`,
    [
      manifestId,
      input.organizationId,
      input.grantResponsePacketExportCandidateId,
      effectiveAuthorityDecisionId,
      GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      input.actorContext.actorUserId,
      input.now,
    ],
  );
  return rows[0] || null;
}

async function loadExistingGrantResponsePacketExportManifest(tx, { organizationId, grantResponsePacketExportCandidateId, fingerprint }) {
  const { rows } = await tx.query(
    `SELECT grant_response_packet_export_manifest_id::text AS grant_response_packet_export_manifest_id
       FROM kai.grant_response_packet_export_manifests
      WHERE organization_id = $1::uuid AND grant_response_packet_export_candidate_id = $2::uuid AND canonical_fingerprint = $3`,
    [organizationId, grantResponsePacketExportCandidateId, fingerprint],
  );
  return rows[0] || null;
}

function manifestRowToDto(row) {
  return {
    grantResponsePacketExportManifestId: row.grant_response_packet_export_manifest_id,
    grantResponsePacketExportCandidateId: row.grant_response_packet_export_candidate_id,
    effectiveAuthorityDecisionId: row.effective_authority_decision_id,
    effectiveAuthorityDecisionType: row.effective_authority_decision_type,
    fingerprintContractVersion: row.fingerprint_contract_version,
    canonicalFingerprint: row.canonical_fingerprint,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export function createPostgresGrantResponsePacketExportManifestRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    // Create-or-reuse the exact packet manifest for the exact
    // grantResponsePacketExportCandidateId given. Manifest creation is
    // permitted ONLY when the real, unmodified
    // evaluateGrantResponsePacketFinalExportEligibility reports
    // finalExportEligible === true for this exact candidate id - never a
    // client-supplied eligibility/authority/fingerprint/member value. Creates
    // no final packet bytes and publishes nothing externally.
    async createExportManifest(input, dependencies = {}) {
      if (!isCreateGrantResponsePacketExportManifestInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const needsDefaults = !dependencies.evaluateEligibility || !dependencies.authorityRepository;
      const defaults = needsDefaults ? await createDefaultDependencies() : null;
      const evaluateEligibility = dependencies.evaluateEligibility || defaults.evaluateEligibility;
      const authorityRepository = dependencies.authorityRepository || defaults.authorityRepository;

      const eligibilityInput = {
        organizationId: input.organizationId,
        engagementId: input.engagementId,
        grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
        actorContext: input.actorContext,
      };

      const eligibility = await evaluateEligibility(eligibilityInput, dependencies.eligibilityDependencies || {});
      if (!eligibility.ok) return eligibility;
      if (eligibility.data.finalExportEligible !== true) return failure("validation_blocker");

      // The real B1 evaluateEffectiveness, called again here only to recover
      // the exact effective decision id the eligibility composition already
      // proved effective - never a second, independent effectiveness
      // determination and never a reimplementation of B1's own lineage logic.
      const effectiveness = await authorityRepository.evaluateEffectiveness(
        {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          decisionType: GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_EFFECTIVE_AUTHORITY_DECISION_TYPE,
          actorContext: input.actorContext,
        },
        dependencies.authorityEffectivenessDependencies || {},
      );
      if (!effectiveness.ok) return effectiveness;
      // "candidate_missing" covers a nonexistent candidate, a candidate from
      // another organization, and a candidate whose packet identity belongs
      // to a different engagement - none of those rows are ever matched by
      // the authority repository's own organization-/engagement-scoped
      // query - so it fails closed as not_found here, mirroring exactly how
      // the eligibility evaluator itself treats the same reason.
      if (effectiveness.data.reason === "candidate_missing") return failure("not_found");
      if (effectiveness.data.effective !== true || !effectiveness.data.headDecisionId) {
        return failure("validation_blocker");
      }
      const effectiveAuthorityDecisionId = effectiveness.data.headDecisionId;

      const fingerprint = canonicalFingerprint({
        organizationId: input.organizationId,
        grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
        effectiveAuthorityDecisionId,
      });

      try {
        return await runInTransaction(async (tx) => {
          // Transaction-scoped currentness re-check: the candidate row must
          // still exist, belong to this organization/engagement, and its own
          // stored canonical_fingerprint must be unchanged - closing the
          // TOCTOU gap between the pre-transaction eligibility/effectiveness
          // reads above and this insert, exactly as P14-07B1's own
          // recordDecision does before writing a decision row.
          const candidate = await loadGrantResponsePacketExportCandidateForManifest(tx, {
            organizationId: input.organizationId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
          });
          if (!candidate || candidate.engagement_id !== input.engagementId) return failure("not_found");

          const manifestId = crypto.randomUUID();
          const insertedRow = await insertGrantResponsePacketExportManifest(tx, {
            manifestId,
            input,
            effectiveAuthorityDecisionId,
            fingerprint,
          });

          let grantResponsePacketExportManifestId;
          let replayed;
          if (insertedRow) {
            grantResponsePacketExportManifestId = insertedRow.grant_response_packet_export_manifest_id;
            replayed = false;
          } else {
            const existing = await loadExistingGrantResponsePacketExportManifest(tx, {
              organizationId: input.organizationId,
              grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
              fingerprint,
            });
            if (!existing) rollbackFailure("system_error");
            grantResponsePacketExportManifestId = existing.grant_response_packet_export_manifest_id;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_CREATED_OPERATION,
                actor_type: "human",
                object_type: "grant_response_packet_export_manifest",
                contract: GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_AUDIT_CONTRACT,
                engagement_id: input.engagementId,
                grant_response_packet_export_manifest_id: grantResponsePacketExportManifestId,
                grant_response_packet_export_candidate_id: input.grantResponsePacketExportCandidateId,
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
            grantResponsePacketExportManifestId,
            grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
            effectiveAuthorityDecisionId,
            fingerprintContractVersion: GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_FINGERPRINT_CONTRACT_VERSION,
            canonicalFingerprint: fingerprint,
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof GrantResponsePacketExportManifestRollbackResultError) return error.result;
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
            `SELECT grant_response_packet_export_manifest_id::text AS grant_response_packet_export_manifest_id,
                    grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
                    effective_authority_decision_id::text AS effective_authority_decision_id,
                    effective_authority_decision_type,
                    fingerprint_contract_version,
                    canonical_fingerprint,
                    created_at
               FROM kai.grant_response_packet_export_manifests
              WHERE organization_id = $1::uuid AND grant_response_packet_export_manifest_id = $2::uuid`,
            [input.organizationId, input.grantResponsePacketExportManifestId],
          );
          if (rows.length !== 1) return failure("not_found");
          return success(manifestRowToDto(rows[0]));
        });
      } catch {
        return failure("system_error");
      }
    },

    // Exact manifest history for the exact packet candidate given - never
    // LIMIT 1, never a latest/current/active selection. `created_at ASC,
    // grant_response_packet_export_manifest_id ASC` is presentation ordering
    // only.
    async resolveExportManifestStateForCandidate(input) {
      if (!isResolveExportManifestStateForCandidateInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          const { rows } = await tx.query(
            `SELECT grant_response_packet_export_manifest_id::text AS grant_response_packet_export_manifest_id,
                    grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
                    effective_authority_decision_id::text AS effective_authority_decision_id,
                    effective_authority_decision_type,
                    fingerprint_contract_version,
                    canonical_fingerprint,
                    created_at
               FROM kai.grant_response_packet_export_manifests
              WHERE organization_id = $1::uuid AND grant_response_packet_export_candidate_id = $2::uuid
              ORDER BY created_at ASC, grant_response_packet_export_manifest_id ASC`,
            [input.organizationId, input.grantResponsePacketExportCandidateId],
          );
          return success({ manifests: rows.map(manifestRowToDto) });
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __grantResponsePacketExportManifestRepositoryTestables = Object.freeze({
  isCreateGrantResponsePacketExportManifestInput,
  isReadExportManifestByIdInput,
  isResolveExportManifestStateForCandidateInput,
  canonicalFingerprint,
});
