import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { createPostgresDataDictionaryRepository } from "../dictionary/postgresDataDictionaryRepository.js";

/**
 * KAI P1-04 dormant draft data-dictionary service seam.
 *
 * This module contains no SQL and imports no database pool: persistence is
 * delegated entirely to the injected P1-04 data-dictionary repository. It is not
 * composed into any route, listener, or production path.
 */

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
