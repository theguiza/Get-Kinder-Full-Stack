import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";

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

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

// P14-02 foundation-only input contract: exactly organizationId +
// engagementId + actorContext, mirroring the existing Grant Response Packet
// composite input (kaiGrantResponsePacketService.js). packetAudience is not
// accepted from the caller - it is pinned to the same single supported
// value the packet DTO already pins, never taken from the request.
function isGetOrCreateGrantResponsePacketExportIdentityInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && isMappedHumanActor(input.actorContext);
}

const PACKET_AUDIENCE = "funder";

async function insertIdentity(tx, { identityId, input }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.grant_response_packet_export_identities (
       grant_response_packet_export_identity_id, organization_id, engagement_id,
       packet_audience, created_by, created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,'human')
     ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING
     RETURNING grant_response_packet_export_identity_id::text AS grant_response_packet_export_identity_id`,
    [identityId, input.organizationId, input.engagementId, PACKET_AUDIENCE, input.actorContext.actorUserId],
  );
  return rows[0] || null;
}

async function loadExistingIdentity(tx, { organizationId, engagementId }) {
  const { rows } = await tx.query(
    `SELECT grant_response_packet_export_identity_id::text AS grant_response_packet_export_identity_id
       FROM kai.grant_response_packet_export_identities
      WHERE organization_id = $1::uuid AND engagement_id = $2::uuid AND packet_audience = $3`,
    [organizationId, engagementId, PACKET_AUDIENCE],
  );
  return rows[0] || null;
}

// Read-only lookup: never mints a row. Used by a later, separately
// authorized package that needs to know whether a durable packet export
// identity already exists without creating one as a side effect.
export async function loadGrantResponsePacketExportIdentityInTransaction(tx, { organizationId, engagementId }) {
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(engagementId)) {
    return { grantResponsePacketExportIdentityId: null };
  }
  const existing = await loadExistingIdentity(tx, { organizationId, engagementId });
  return { grantResponsePacketExportIdentityId: existing ? existing.grant_response_packet_export_identity_id : null };
}

export function createPostgresGrantResponsePacketExportIdentityRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    // Idempotent get-or-create: the same organizationId + engagementId
    // always converges to the same durable identity row. This function does
    // not read packet membership, drafts, export candidates, export
    // manifests, or any governed authority/eligibility state, and does not
    // grant any export or finalization authority by itself - it only
    // guarantees a stable identity exists for a later, separately
    // authorized package to bind such state to.
    async getOrCreateGrantResponsePacketExportIdentity(input) {
      if (!isGetOrCreateGrantResponsePacketExportIdentityInput(input)) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const identityId = crypto.randomUUID();
          const insertedRow = await insertIdentity(tx, { identityId, input });

          let grantResponsePacketExportIdentityId;
          let created;
          if (insertedRow) {
            grantResponsePacketExportIdentityId = insertedRow.grant_response_packet_export_identity_id;
            created = true;
          } else {
            const existing = await loadExistingIdentity(tx, {
              organizationId: input.organizationId,
              engagementId: input.engagementId,
            });
            if (!existing) return failure("system_error");
            grantResponsePacketExportIdentityId = existing.grant_response_packet_export_identity_id;
            created = false;
          }

          return success({
            grantResponsePacketExportIdentityId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            packetAudience: PACKET_AUDIENCE,
            created,
          });
        });
      } catch (error) {
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },
  });
}

export const __grantResponsePacketExportIdentityRepositoryTestables = Object.freeze({
  isGetOrCreateGrantResponsePacketExportIdentityInput,
  PACKET_AUDIENCE,
});
