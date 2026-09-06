import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { createPostgresDataDictionaryRepository } from "../dictionary/postgresDataDictionaryRepository.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

/**
 * KAI P1-04 data-dictionary service seam.
 *
 * This module contains no SQL and imports no database pool: persistence is
 * delegated entirely to the injected P1-04 data-dictionary repository.
 */

const DATA_DICTIONARY_ENTRY_READ_OPERATION = "read_intake";
const DATA_DICTIONARY_ENTRY_READ_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const DICTIONARY_ENTRY_KEYS = new Set([
  "data_dictionary_field_id",
  "data_dictionary_id",
  "profile_field_key",
  "field_label_safe",
  "business_meaning",
  "entity_level",
  "data_type",
  "sensitivity",
  "allowed_use",
  "quality_notes_safe",
  "mapping_confidence",
  "review_status",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_TOKEN_RE = /^[a-z0-9_:-]{1,128}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isDraftDataDictionaryInput(value) {
  const allowedKeys = new Set(["organizationId", "fileProfileId", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.fileProfileId) &&
    isNormalizedNow(value.now)
  );
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isDataDictionaryEntryReadInput(value) {
  const allowedKeys = new Set(["organizationId", "dataDictionaryId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.dataDictionaryId) &&
    isPlainObject(value.actorContext)
  );
}

function safeOptionalText(value, maxLength) {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function safeDictionaryEntry(row, dataDictionaryId) {
  if (!isPlainObject(row) || !Object.keys(row).every((key) => DICTIONARY_ENTRY_KEYS.has(key))) return null;
  if (
    !UUID_RE.test(row.data_dictionary_field_id) ||
    row.data_dictionary_id !== dataDictionaryId ||
    !SAFE_TOKEN_RE.test(row.profile_field_key) ||
    typeof row.field_label_safe !== "string" ||
    row.field_label_safe.length < 1 ||
    row.field_label_safe.length > 200 ||
    !safeOptionalText(row.business_meaning, 200) ||
    !SAFE_TOKEN_RE.test(row.entity_level) ||
    !SAFE_TOKEN_RE.test(row.data_type) ||
    !SAFE_TOKEN_RE.test(row.sensitivity) ||
    !SAFE_TOKEN_RE.test(row.allowed_use) ||
    !safeOptionalText(row.quality_notes_safe, 1000) ||
    !(row.mapping_confidence === null || (typeof row.mapping_confidence === "number" && row.mapping_confidence >= 0 && row.mapping_confidence <= 1)) ||
    !SAFE_TOKEN_RE.test(row.review_status)
  ) {
    return null;
  }
  return Object.fromEntries([...DICTIONARY_ENTRY_KEYS].map((key) => [key, row[key]]));
}

function safeDictionaryEntriesDto(data, dataDictionaryId) {
  if (
    !isPlainObject(data) ||
    !Object.keys(data).every((key) => key === "data_dictionary_id" || key === "entries") ||
    data.data_dictionary_id !== dataDictionaryId ||
    !Array.isArray(data.entries)
  ) {
    return null;
  }
  const entries = data.entries.map((entry) => safeDictionaryEntry(entry, dataDictionaryId));
  if (entries.some((entry) => !entry)) return null;
  return { data_dictionary_id: dataDictionaryId, entries };
}

/**
 * Organization-scoped idempotent draft/replay of one data-dictionary bundle for the
 * committed profile identified by `fileProfileId`. The caller supplies only the
 * lookup identity: `intakeFileId`, the committed profile, and its canonical hash are
 * always re-read from the authoritative `kai.intake_file_profiles` row by the
 * injected repository and are never accepted from this input.
 */
export async function createDraftDataDictionary(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isDraftDataDictionaryInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const dataDictionaryRepository =
    dependencies.dataDictionaryRepository || createPostgresDataDictionaryRepository();

  const result = await dataDictionaryRepository.draftDataDictionary({
    identity: { organizationId: input.organizationId, fileProfileId: input.fileProfileId },
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export async function listDataDictionaryEntries(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isDataDictionaryEntryReadInput(input)) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const genericAuth = validateActorCanPerformOperation(
    input.actorContext,
    DATA_DICTIONARY_ENTRY_READ_OPERATION,
    input.organizationId,
  );
  if (!genericAuth.ok) {
    return buildKaiError(genericAuth.error_code || "authorization_denied", { blockers: genericAuth.blockers });
  }

  const roleAuth = validateActorCanPerformOperation(
    input.actorContext,
    DATA_DICTIONARY_ENTRY_READ_OPERATION,
    input.organizationId,
    { allowedRoles: DATA_DICTIONARY_ENTRY_READ_ROLES },
  );
  if (!roleAuth.ok) {
    return buildKaiError(roleAuth.error_code || "authorization_denied", { blockers: roleAuth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const dataDictionaryRepository =
    dependencies.dataDictionaryRepository || createPostgresDataDictionaryRepository();
  const result = await dataDictionaryRepository.listDataDictionaryEntries({
    identity: {
      organizationId: input.organizationId,
      dataDictionaryId: input.dataDictionaryId,
    },
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  const data = safeDictionaryEntriesDto(result.data, input.dataDictionaryId);
  if (!data) return buildKaiError("system_error");
  return { ok: true, data, error: null };
}

export const __dataDictionaryServiceContract = Object.freeze({
  DATA_DICTIONARY_ENTRY_READ_OPERATION,
  DATA_DICTIONARY_ENTRY_READ_ROLES,
});
