import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError, unstructuredExportManifestDiagnosticBlocker } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  CREATE_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_EXPORT_MANIFEST_OPERATION,
} from "../dictionary/exportManifestContract.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCreateExportManifestInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "exportCandidateId",
    "exportReviewQueueItemId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

async function createDefaultDependencies(organizationId, exportCandidateId, actorContext, now) {
  const { createPostgresExportManifestRepository } = await import(
    "../dictionary/postgresExportManifestRepository.js"
  );
  const { createProductionMetadataOnlyAuditForExportManifest } = await import(
    "./kaiMetadataOnlyAuditComposition.js"
  );
  return {
    repository: createPostgresExportManifestRepository(),
    // Bound only to organizationId/exportCandidateId - known upfront. The
    // manifest's own id does not exist yet and is never taken here; the
    // repository's own payload supplies it (as export_manifest_id) once the
    // insert (or replay re-select) completes, and this composition derives
    // the audited object's identity from that payload at prepare time.
    metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({
      organizationId,
      exportCandidateId,
      actorContext,
      now,
    }),
  };
}

// Minimum service layer: feature-flag guard, human-actor guard, gk_admin-only
// authorization, then delegates the entire eligibility+write composition to
// the repository. Not route-mounted in this package.
export async function createExportManifest(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateExportManifestInput(input)) {
    return buildKaiError("validation_blocker", {
      data: null,
      blockers: unstructuredExportManifestDiagnosticBlocker({
        failureStage: "service_input_contract",
      }),
    });
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_EXPORT_MANIFEST_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_EXPORT_MANIFEST_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const now = dependencies.now || new Date().toISOString();
  const needsDefaults = !dependencies.repository || !dependencies.metadataOnlyAudit;
  const defaults = needsDefaults
    ? await createDefaultDependencies(input.organizationId, input.exportCandidateId, input.actorContext, now)
    : null;
  const repository = dependencies.repository || defaults.repository;
  const metadataOnlyAudit = dependencies.metadataOnlyAudit || defaults.metadataOnlyAudit;

  const repositoryInput = {
    organizationId: input.organizationId,
    exportCandidateId: input.exportCandidateId,
    exportReviewQueueItemId: input.exportReviewQueueItemId,
    actorContext: input.actorContext,
    now,
  };

  const result = await repository.createExportManifest(repositoryInput, { metadataOnlyAudit });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      data: result.data ?? null,
      ...(result.blockers ? { blockers: result.blockers } : {}),
    };
  }
  return { ok: true, data: result.data, error: null };
}

export const __exportManifestServiceContract = Object.freeze({
  CREATE_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_EXPORT_MANIFEST_OPERATION,
});

export const __exportManifestServiceTestables = Object.freeze({
  isCreateExportManifestInput,
  isMappedHumanActor,
});
