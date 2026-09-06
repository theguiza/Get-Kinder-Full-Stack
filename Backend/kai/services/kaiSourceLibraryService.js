import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  listScopedSourcesForOrganization,
  listScopedSourceVersionsForSourceIds,
} from "../db/kaiIntakeQueries.js";

/**
 * KAI Data Sources completion package: organization-scope browse read of
 * governed `kai.sources` + `kai.source_versions` rows for the /impact-library
 * Data Sources section. Same role boundary already governing the P2-01
 * evidence-extraction and P2-02 evidence-coverage-assessment routes this
 * section feeds into (`kaiEvidenceLineageService`/
 * `kaiEvidenceCoverageAssessmentService`'s EVIDENCE_LINEAGE_ALLOWED_ROLES /
 * EVIDENCE_COVERAGE_ASSESSMENT_ALLOWED_ROLES) - listing discloses nothing a
 * caller already authorized to extract evidence from, or assess coverage
 * for, an arbitrary sourceVersionId could not already learn one version at a
 * time. Never lists raw intake files or unpromoted `intake_source_candidates`
 * rows as if they were governed sources.
 */
const SOURCE_LIBRARY_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const SOURCE_LIBRARY_OPERATION = "list_organization_sources";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isListOrganizationSourcesInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return isNonEmptyString(value.organizationId) && isPlainObject(value.actorContext);
}

function toSafeSourceVersion(row) {
  return {
    source_version_id: row.source_version_id,
    source_id: row.source_id,
    is_current: row.is_current,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function toSafeSource(row) {
  return {
    source_id: row.source_id,
    source_code: row.source_code,
    reviewed_source_type: row.reviewed_source_type,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/**
 * Read-only. Contains no SQL: delegates entirely to the two narrow
 * organization-scoped `kaiIntakeQueries.js` reads. Never mutates anything,
 * never writes an audit row.
 */
export async function listOrganizationSources(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListOrganizationSourcesInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    SOURCE_LIBRARY_OPERATION,
    input.organizationId,
    { allowedRoles: SOURCE_LIBRARY_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const listSources = dependencies.listScopedSourcesForOrganization || listScopedSourcesForOrganization;
  const listVersions = dependencies.listScopedSourceVersionsForSourceIds || listScopedSourceVersionsForSourceIds;

  const sourceRows = await listSources({ organizationId: input.organizationId });
  const sourceIds = sourceRows.map((row) => row.source_id);
  const versionRows = await listVersions({ organizationId: input.organizationId, sourceIds });

  const versionsBySourceId = new Map();
  for (const row of versionRows) {
    const existing = versionsBySourceId.get(row.source_id) || [];
    existing.push(toSafeSourceVersion(row));
    versionsBySourceId.set(row.source_id, existing);
  }

  const sources = sourceRows.map((row) => ({
    ...toSafeSource(row),
    source_versions: versionsBySourceId.get(row.source_id) || [],
  }));

  return { ok: true, data: { sources }, error: null };
}

export const __sourceLibraryServiceContract = Object.freeze({
  SOURCE_LIBRARY_ALLOWED_ROLES,
  SOURCE_LIBRARY_OPERATION,
});

export const __sourceLibraryServiceTestables = Object.freeze({
  isListOrganizationSourcesInput,
  isMappedHumanActor,
  toSafeSource,
  toSafeSourceVersion,
});
