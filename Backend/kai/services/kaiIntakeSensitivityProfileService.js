import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { createPostgresIntakeSensitivityProfileRepository } from "../dictionary/postgresIntakeSensitivityProfileRepository.js";

/**
 * KAI P1-05 dormant intake sensitivity and allowed-use profile service seam.
 *
 * This module contains no SQL and imports no database pool: persistence is
 * delegated entirely to the injected P1-05 intake-sensitivity-profile repository.
 * It is not composed into any route, listener, or production path.
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

function isPersistIntakeSensitivityProfileInput(value) {
  const allowedKeys = new Set(["organizationId", "fileProfileId", "dataDictionaryId", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.fileProfileId) &&
    isNonEmptyString(value.dataDictionaryId) &&
    isNormalizedNow(value.now)
  );
}

/**
 * Organization-scoped idempotent persist/replay of one intake sensitivity and
 * allowed-use profile for the committed profile identified by `fileProfileId` and
 * the committed data-dictionary bundle identified by `dataDictionaryId`. The caller
 * supplies only the lookup identity: `intakeFileId`, the committed profile, its
 * canonical hash, and the bound dictionary lineage are always re-read from the
 * authoritative `kai.intake_file_profiles` and `kai.data_dictionaries` rows by the
 * injected repository and are never accepted from this input.
 */
export async function persistIntakeSensitivityProfile(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isPersistIntakeSensitivityProfileInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const intakeSensitivityProfileRepository =
    dependencies.intakeSensitivityProfileRepository || createPostgresIntakeSensitivityProfileRepository();

  const result = await intakeSensitivityProfileRepository.persistIntakeSensitivityProfile({
    identity: {
      organizationId: input.organizationId,
      fileProfileId: input.fileProfileId,
      dataDictionaryId: input.dataDictionaryId,
    },
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}
