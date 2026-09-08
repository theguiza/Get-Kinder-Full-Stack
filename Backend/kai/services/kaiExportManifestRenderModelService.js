import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { CREATE_EXPORT_MANIFEST_ALLOWED_ROLES, CREATE_EXPORT_MANIFEST_OPERATION } from "../dictionary/exportManifestContract.js";
import { buildKaiError } from "../errors/kaiErrors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isComposeExportManifestRenderModelInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "exportManifestId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportManifestId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

async function createDefaultDependencies() {
  const { createPostgresExportManifestRenderModelRepository } = await import(
    "../dictionary/postgresExportManifestRenderModelRepository.js"
  );
  return { repository: createPostgresExportManifestRenderModelRepository() };
}

export async function composeExportManifestRenderModel(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isComposeExportManifestRenderModelInput(input)) return buildKaiError("validation_blocker", { data: null });
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

  const defaults = dependencies.repository ? null : await createDefaultDependencies();
  const repository = dependencies.repository || defaults.repository;
  return repository.composeExportManifestRenderModel({
    organizationId: input.organizationId,
    exportManifestId: input.exportManifestId,
  });
}

export const __exportManifestRenderModelServiceTestables = Object.freeze({
  isComposeExportManifestRenderModelInput,
  isMappedHumanActor,
});
