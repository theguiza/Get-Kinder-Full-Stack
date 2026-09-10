import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
} from "../dictionary/grantResponsePacketExportManifestContract.js";

// ---------------------------------------------------------------------------
// P14-08B: governed Grant Response Packet export-manifest create/reuse - the
// packet-level analogue of the existing P3-19 kaiExportManifestService.js,
// wrapped around the new P14-08A
// postgresGrantResponsePacketExportManifestRepository.js instead of the
// member-level postgresExportManifestRepository.js. Minimum service layer:
// feature-flag guard, human-actor guard, gk_admin-only authorization, tenant
// boundary check, then delegates the entire eligibility+authority+write
// composition to the repository - the repository itself invokes the real,
// unmodified P14-07 evaluateGrantResponsePacketFinalExportEligibility and the
// real P14-07B1 authorityRepository.evaluateEffectiveness; this file
// reimplements neither. Creates no final packet bytes and publishes nothing
// externally.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

// Exact-keys input contract: organizationId + engagementId +
// grantResponsePacketExportCandidateId + actorContext, and NOTHING else -
// `now` is supplied separately via dependencies/derived, never by the
// caller. No fingerprint, member list, requestedAudience, review state,
// eligibility, authority state, or manifest identity is ever accepted.
function isCreateGrantResponsePacketExportManifestInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

async function createDefaultDependencies(organizationId, engagementId, grantResponsePacketExportCandidateId, actorContext, now) {
  const { createPostgresGrantResponsePacketExportManifestRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportManifestRepository.js"
  );
  const { createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest } = await import(
    "./kaiMetadataOnlyAuditComposition.js"
  );
  return {
    repository: createPostgresGrantResponsePacketExportManifestRepository(),
    // Bound only to organizationId/engagementId/grantResponsePacketExportCandidateId
    // - known upfront. The manifest's own id does not exist yet and is never
    // taken here; the repository's own payload supplies it once the insert
    // (or replay re-select) completes.
    metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest({
      organizationId,
      engagementId,
      grantResponsePacketExportCandidateId,
      actorContext,
      now,
    }),
  };
}

export async function createGrantResponsePacketExportManifest(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateGrantResponsePacketExportManifestInput(input)) {
    return buildKaiError("validation_blocker", { data: null });
  }
  // An assistant/system actorContext is refused here (before any repository
  // call) - only a mapped human actor may ever reach the gk_admin
  // authorization check below.
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }

  const now = dependencies.now || new Date().toISOString();
  const needsDefaults = !dependencies.repository || !dependencies.metadataOnlyAudit;
  const defaults = needsDefaults
    ? await createDefaultDependencies(
      input.organizationId,
      input.engagementId,
      input.grantResponsePacketExportCandidateId,
      input.actorContext,
      now,
    )
    : null;
  const repository = dependencies.repository || defaults.repository;
  const metadataOnlyAudit = dependencies.metadataOnlyAudit || defaults.metadataOnlyAudit;

  const repositoryInput = {
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
    actorContext: input.actorContext,
    now,
  };

  const result = await repository.createExportManifest(repositoryInput, {
    metadataOnlyAudit,
    evaluateEligibility: dependencies.evaluateEligibility,
    authorityRepository: dependencies.authorityRepository,
    eligibilityDependencies: dependencies.eligibilityDependencies,
    authorityEffectivenessDependencies: dependencies.authorityEffectivenessDependencies,
  });
  if (!result.ok) return { ok: false, error: result.error, data: null };

  // Explicit allowlist projection - never a passthrough spread - so the
  // public DTO is pinned by construction. No final artifact bytes and no
  // external publication identity is ever produced or returned here.
  const data = {
    grantResponsePacketExportManifestId: result.data.grantResponsePacketExportManifestId,
    grantResponsePacketExportCandidateId: result.data.grantResponsePacketExportCandidateId,
    effectiveAuthorityDecisionId: result.data.effectiveAuthorityDecisionId,
    fingerprintContractVersion: result.data.fingerprintContractVersion,
    canonicalFingerprint: result.data.canonicalFingerprint,
    replayed: result.data.replayed,
  };

  return { ok: true, data, error: null };
}

export const __grantResponsePacketExportManifestServiceContract = Object.freeze({
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
});

export const __grantResponsePacketExportManifestServiceTestables = Object.freeze({
  isCreateGrantResponsePacketExportManifestInput,
  isMappedHumanActor,
});
