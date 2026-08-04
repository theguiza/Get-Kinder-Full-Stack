import { withTransaction } from "../db/kaiDb.js";

/**
 * KAI P1-04 draft data-dictionary and quality-finding repository adapter.
 *
 * This module is the only authorized location for P1-04 SQL and row locking. It
 * consumes only the tenant-scoped, already-committed metadata/redacted
 * `kai.intake_file_profiles` row identified by `organizationId` + `fileProfileId`:
 * `intake_file_id` and `profile_canonical_sha256` are always re-read from that row,
 * never accepted from the caller. It never reads raw bytes, calls storage, invokes a
 * parser or profiler, uses an LLM, performs an external lookup, or infers facts from
 * filenames or field names. It adds no route, listener, scheduler, or production
 * composition.
 */

const DICTIONARY_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const DICTIONARY_AUDIT_CONTRACT = "p1_draft_data_dictionary_and_quality_v1";
const DICTIONARY_AUDIT_VALIDATOR_KEY = "VAL-KAI-P1-04-001";
const DICTIONARY_AUDIT_OPERATION = "data_dictionary_draft_persisted";

const FILE_LEVEL_FIELD_KEY = "file_level";
const FIELD_TYPE_CATEGORIES = Object.freeze(["boolean", "number", "date_like", "text_like"]);

/**
 * Authoritative finite inclusive range for `kai.data_dictionary_fields.mapping_confidence`.
 * The column is nullable with no default: absence of an explicit committed
 * profile-provided confidence is persisted as NULL, never as certainty.
 */
const MAPPING_CONFIDENCE_MIN = 0;
const MAPPING_CONFIDENCE_MAX = 1;

const UNSAFE_TEXT_PATTERN =
  /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;

function dictionaryFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: DICTIONARY_RESULT_STATUS[code],
    },
  };
}

function dictionarySuccess(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
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

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

function isDraftIdentity(value) {
  const allowedKeys = new Set(["organizationId", "fileProfileId"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return isNonEmptyString(value.organizationId) && isNonEmptyString(value.fileProfileId);
}

function validateDraftInput(input) {
  const allowedKeys = new Set(["identity", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isDraftIdentity(input.identity) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function validateReadInput(input) {
  const allowedKeys = new Set(["identity"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isDraftIdentity(input.identity);
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function isSafeLabelText(value, maxLength) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    !UNSAFE_TEXT_PATTERN.test(value)
  );
}

function isSafeControlledToken(value) {
  return typeof value === "string" && /^[a-z0-9_]{1,64}$/.test(value);
}

function isStableProfileFieldKey(value) {
  return typeof value === "string" && /^[a-z0-9_]{1,128}$/.test(value);
}

/**
 * Dominant primitive-type category for one profile-committed field, derived only
 * from the already-committed `primitive_type_hints` counts. Never inferred from the
 * field name or any value sample.
 */
function deriveDataType(primitiveTypeHints) {
  if (!isPlainObject(primitiveTypeHints)) return "unknown";
  const nonZeroCategories = FIELD_TYPE_CATEGORIES.filter(
    (category) => Number.isFinite(primitiveTypeHints[category]) && primitiveTypeHints[category] > 0,
  );
  if (nonZeroCategories.length === 0) return "unknown";
  if (nonZeroCategories.length > 1) return "mixed";
  return nonZeroCategories[0];
}

function deriveBusinessMeaning(entry) {
  if (isSafeLabelText(entry.meaning, 200) && entry.meaning !== "unknown") return entry.meaning;
  return "unknown";
}

function deriveEntityLevel(entry) {
  if (isSafeControlledToken(entry.entity_level) && entry.entity_level !== "unknown") return entry.entity_level;
  return "unknown";
}

/**
 * A profile-committed count is a fact only when the committed profile states it.
 * An absent count is never substituted with 0, a denominator, or a total.
 */
function isCommittedCount(value) {
  return Number.isFinite(value);
}

/**
 * Quality note text records only the counts the committed profile actually states.
 * Both counts absent yields no note at all; one count present records exactly that
 * one count, with no fabricated counterpart and no fabricated denominator.
 */
function deriveQualityNotesSafe(entry) {
  const parts = [];
  if (isCommittedCount(entry.present_count)) parts.push(`present_count=${entry.present_count}`);
  if (isCommittedCount(entry.missing_count)) parts.push(`missing_count=${entry.missing_count}`);
  if (parts.length === 0) return null;
  return parts.join(", ");
}

/**
 * Mapping confidence is copied only when the committed profile provides an explicit
 * finite numeric value inside the authoritative inclusive range. Anything else -
 * absent, non-numeric, NaN, Infinity, or out of range - persists as NULL. There is
 * no default confidence and never an assumed certainty.
 */
function deriveMappingConfidence(entry) {
  const value = entry?.mapping_confidence;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MAPPING_CONFIDENCE_MIN || value > MAPPING_CONFIDENCE_MAX) return null;
  return value;
}

/**
 * Pure, deterministic derivation of metadata-only dictionary fields from one
 * committed profile. Absence of a profile-provided fact always yields the
 * documented fail-closed default (`unknown`), never an inference.
 */
function deriveDictionaryFields(profile) {
  if (!isPlainObject(profile) || !Array.isArray(profile.fields)) return [];
  const fields = [];
  const seenKeys = new Set();
  for (const entry of profile.fields) {
    if (!isPlainObject(entry) || !isStableProfileFieldKey(entry.field_key)) continue;
    if (seenKeys.has(entry.field_key)) continue;
    seenKeys.add(entry.field_key);
    fields.push({
      profileFieldKey: entry.field_key,
      fieldLabelSafe: entry.field_key,
      dataType: deriveDataType(entry.primitive_type_hints),
      businessMeaning: deriveBusinessMeaning(entry),
      entityLevel: deriveEntityLevel(entry),
      qualityNotesSafe: deriveQualityNotesSafe(entry),
      mappingConfidence: deriveMappingConfidence(entry),
    });
  }
  return fields;
}

/**
 * Pure, deterministic derivation of quality findings from explicit committed
 * profile-stage facts only. A fact that is absent from the profile never produces a
 * finding: there is no denominator assessment, coverage analysis, or inference here.
 */
function deriveQualityFindings(profile, fields) {
  const findings = [];

  for (const field of fields) {
    const entry = profile.fields.find((candidate) => candidate.field_key === field.profileFieldKey);
    if (!isPlainObject(entry)) continue;

    if (isCommittedCount(entry.missing_count) && entry.missing_count > 0) {
      // A denominator exists only when the committed profile states both counts. A
      // missing present_count is never substituted with 0 to invent a total.
      const findingDetailSafe = isCommittedCount(entry.present_count)
        ? `${field.profileFieldKey} has ${entry.missing_count} missing values out of ${entry.present_count + entry.missing_count}`
        : `${field.profileFieldKey} has ${entry.missing_count} missing values`;
      findings.push({
        profileFieldKey: field.profileFieldKey,
        findingType: "missingness",
        findingDetailSafe,
      });
    }

    if (isPlainObject(entry.primitive_type_hints)) {
      const nonZeroCategories = FIELD_TYPE_CATEGORIES.filter(
        (category) => Number.isFinite(entry.primitive_type_hints[category]) && entry.primitive_type_hints[category] > 0,
      );
      if (nonZeroCategories.length > 1) {
        findings.push({
          profileFieldKey: field.profileFieldKey,
          findingType: "type_inconsistency",
          findingDetailSafe: `${field.profileFieldKey} has mixed primitive type hints: ${nonZeroCategories.join(", ")}`,
        });
      }
    }

    if (Number.isFinite(entry.invalid_date_count) && entry.invalid_date_count > 0) {
      findings.push({
        profileFieldKey: field.profileFieldKey,
        findingType: "invalid_date",
        findingDetailSafe: `${field.profileFieldKey} has ${entry.invalid_date_count} invalid-date indicators`,
      });
    }
  }

  const duplicateRowCount = Number.isFinite(profile.counts?.duplicate_row_count)
    ? profile.counts.duplicate_row_count
    : (Number.isFinite(profile.duplicate_row_hints?.duplicate_row_count) ? profile.duplicate_row_hints.duplicate_row_count : 0);
  if (duplicateRowCount > 0) {
    findings.push({
      profileFieldKey: FILE_LEVEL_FIELD_KEY,
      findingType: "duplicate_rows",
      findingDetailSafe: `${duplicateRowCount} duplicate rows detected`,
    });
  }

  const formulaCount = Number.isFinite(profile.counts?.formula_count) ? profile.counts.formula_count : 0;
  if (formulaCount > 0) {
    findings.push({
      profileFieldKey: FILE_LEVEL_FIELD_KEY,
      findingType: "formula_like_content",
      findingDetailSafe: `${formulaCount} formula-like value(s) detected`,
    });
  }

  if (Array.isArray(profile.warnings)) {
    for (const warning of profile.warnings) {
      if (isSafeLabelText(warning, 500)) {
        findings.push({
          profileFieldKey: FILE_LEVEL_FIELD_KEY,
          findingType: "safe_profiler_warning",
          findingDetailSafe: warning,
        });
      }
    }
  }

  return findings;
}

async function readScopedProfile(tx, identity) {
  const result = await tx.query(
    `SELECT organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            profile,
            profile_canonical_sha256
       FROM kai.intake_file_profiles
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid`,
    [identity.organizationId, identity.fileProfileId],
  );
  return result.rows[0] ?? null;
}

async function readScopedUploadState(tx, organizationId, intakeFileId) {
  const result = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return result.rows[0]?.upload_state ?? null;
}

async function lockExistingBundle(tx, organizationId, fileProfileId) {
  const result = await tx.query(
    `SELECT data_dictionary_id::text AS data_dictionary_id,
            organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            profile_canonical_sha256,
            dictionary_status,
            created_at
       FROM kai.data_dictionaries
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid
      FOR UPDATE`,
    [organizationId, fileProfileId],
  );
  return result.rows[0] ?? null;
}

async function readBundleCounts(tx, dataDictionaryId) {
  const [fieldsResult, mappingsResult, findingsResult] = await Promise.all([
    tx.query(`SELECT count(*)::int AS count FROM kai.data_dictionary_fields WHERE data_dictionary_id = $1::uuid`, [dataDictionaryId]),
    tx.query(`SELECT count(*)::int AS count FROM kai.data_dictionary_mappings WHERE data_dictionary_id = $1::uuid`, [dataDictionaryId]),
    tx.query(`SELECT count(*)::int AS count FROM kai.data_quality_findings WHERE data_dictionary_id = $1::uuid`, [dataDictionaryId]),
  ]);
  return {
    field_count: fieldsResult.rows[0].count,
    mapping_count: mappingsResult.rows[0].count,
    finding_count: findingsResult.rows[0].count,
  };
}

function rowToBundleRecord(row, counts) {
  return {
    data_dictionary_id: row.data_dictionary_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    dictionary_status: row.dictionary_status,
    created_at: asIso(row.created_at),
    ...counts,
  };
}

function buildDictionaryAuditMetadata(record) {
  return {
    metadata_only: true,
    contract: DICTIONARY_AUDIT_CONTRACT,
    file_profile_id: record.file_profile_id,
    profile_canonical_sha256: record.profile_canonical_sha256,
    dictionary_status: record.dictionary_status,
    field_count: record.field_count,
    mapping_count: record.mapping_count,
    finding_count: record.finding_count,
    validator_key: DICTIONARY_AUDIT_VALIDATOR_KEY,
  };
}

function buildDictionaryAuditPayload(record) {
  return {
    attempted_operation: "data_dictionary_draft_persisted",
    actor_type: "internal_service",
    contract: DICTIONARY_AUDIT_CONTRACT,
    object_type: "intake_file",
    dictionary_status: record.dictionary_status,
    request_scope: "organization_file_profile",
    route_contract: "unwired_synthetic_data_dictionary_draft",
    sprint_phase: "kai_sprint2_p1_04",
    validator_key: DICTIONARY_AUDIT_VALIDATOR_KEY,
  };
}

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, DICTIONARY_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

/**
 * Rejection of the required metadata-only audit must roll back every dictionary,
 * field, mapping, and finding write in the same transaction, so it is raised as an
 * error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function prepareRequiredAudit(metadataOnlyAudit, record) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildDictionaryAuditPayload(record),
  });

  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;

  const auditConfirmed =
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true &&
    typeof prepared.publish === "function";

  if (!auditConfirmed) {
    throw new RequiredAuditRejectedError();
  }

  return prepared;
}

function shapeDictionaryError(error) {
  if (error instanceof RequiredAuditRejectedError) return dictionaryFailure("validation_blocker");
  if (error?.code === "23505") return dictionaryFailure("conflict_current_state_changed");
  if (error?.code === "23503") return dictionaryFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return dictionaryFailure("validation_blocker");
  }
  return dictionaryFailure("system_error");
}

export function createPostgresDataDictionaryRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Organization-scoped idempotent draft/replay keyed by the accepted P1-04
     * identity (organizationId + fileProfileId). `intakeFileId`, `profile`, and
     * `profile_canonical_sha256` are always re-read from the authoritative committed
     * `kai.intake_file_profiles` row; the caller cannot provide or override them.
     *
     * Same profile identity and the same stored hash: replays the existing bundle.
     * Same profile identity with a different bound hash: `conflict_current_state_changed`.
     * A different profile identity always creates a separate bundle. There is no
     * revision number, predecessor link, or supersession link.
     *
     * Concurrent identical creation is resolved by PostgreSQL conflict handling inside
     * this same transaction (`ON CONFLICT (organization_id, file_profile_id) DO NOTHING`
     * plus an authoritative re-read), never by an in-process lock: the losing caller
     * replays the committed bundle when the bound hash matches and receives
     * `conflict_current_state_changed` when it does not.
     */
    async draftDataDictionary(input) {
      if (!validateDraftInput(input)) return dictionaryFailure("validation_blocker");
      const { identity, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const profileRow = await readScopedProfile(tx, identity);
          if (!profileRow) return dictionaryFailure("not_found");

          const existing = await lockExistingBundle(tx, identity.organizationId, identity.fileProfileId);
          if (existing) {
            if (existing.profile_canonical_sha256 !== profileRow.profile_canonical_sha256) {
              return dictionaryFailure("conflict_current_state_changed");
            }
            const counts = await readBundleCounts(tx, existing.data_dictionary_id);
            return dictionarySuccess({ dictionary: rowToBundleRecord(existing, counts), replayed: true });
          }

          const uploadState = await readScopedUploadState(tx, profileRow.organization_id, profileRow.intake_file_id);
          if (!uploadState) return dictionaryFailure("not_found");

          const derivedFields = deriveDictionaryFields(profileRow.profile);
          const derivedFindings = deriveQualityFindings(profileRow.profile, derivedFields);

          const dictionaryInsert = await tx.query(
            `INSERT INTO kai.data_dictionaries (
               organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
             )
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
             ON CONFLICT (organization_id, file_profile_id) DO NOTHING
             RETURNING data_dictionary_id::text AS data_dictionary_id, created_at`,
            [profileRow.organization_id, profileRow.intake_file_id, profileRow.file_profile_id, profileRow.profile_canonical_sha256, now],
          );
          if (dictionaryInsert.rowCount !== 1) {
            // A concurrent transaction created the authoritative bundle for this exact
            // (organization_id, file_profile_id) and committed first. PostgreSQL conflict
            // handling - not an in-process lock - resolves the race: re-read the committed
            // authoritative row inside this same transaction and replay it when the bound
            // profile hash still matches, so no duplicate bundle, field, mapping, finding,
            // or audit row is written and no raw unique violation reaches the caller.
            const concurrent = await lockExistingBundle(tx, identity.organizationId, identity.fileProfileId);
            if (!concurrent) return dictionaryFailure("system_error");
            if (concurrent.profile_canonical_sha256 !== profileRow.profile_canonical_sha256) {
              return dictionaryFailure("conflict_current_state_changed");
            }
            const concurrentCounts = await readBundleCounts(tx, concurrent.data_dictionary_id);
            return dictionarySuccess({
              dictionary: rowToBundleRecord(concurrent, concurrentCounts),
              replayed: true,
            });
          }
          const dataDictionaryId = dictionaryInsert.rows[0].data_dictionary_id;

          const fieldIdByKey = new Map();
          for (const field of derivedFields) {
            const fieldInsert = await tx.query(
              `INSERT INTO kai.data_dictionary_fields (
                 data_dictionary_id, organization_id, file_profile_id, profile_field_key,
                 field_label_safe, data_type, business_meaning, entity_level, quality_notes_safe,
                 mapping_confidence, created_at
               )
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::numeric, $11::timestamptz)
               RETURNING data_dictionary_field_id::text AS data_dictionary_field_id`,
              [
                dataDictionaryId,
                profileRow.organization_id,
                profileRow.file_profile_id,
                field.profileFieldKey,
                field.fieldLabelSafe,
                field.dataType,
                field.businessMeaning,
                field.entityLevel,
                field.qualityNotesSafe,
                field.mappingConfidence,
                now,
              ],
            );
            fieldIdByKey.set(field.profileFieldKey, fieldInsert.rows[0].data_dictionary_field_id);

            await tx.query(
              `INSERT INTO kai.data_dictionary_mappings (
                 data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key, created_at
               )
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)`,
              [
                fieldInsert.rows[0].data_dictionary_field_id,
                dataDictionaryId,
                profileRow.organization_id,
                profileRow.file_profile_id,
                field.profileFieldKey,
                now,
              ],
            );
          }

          for (const finding of derivedFindings) {
            await tx.query(
              `INSERT INTO kai.data_quality_findings (
                 data_dictionary_id, organization_id, file_profile_id, profile_field_key, finding_type, finding_detail_safe, created_at
               )
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::timestamptz)`,
              [
                dataDictionaryId,
                profileRow.organization_id,
                profileRow.file_profile_id,
                finding.profileFieldKey,
                finding.findingType,
                finding.findingDetailSafe,
                now,
              ],
            );
          }

          const record = {
            data_dictionary_id: dataDictionaryId,
            organization_id: profileRow.organization_id,
            intake_file_id: profileRow.intake_file_id,
            file_profile_id: profileRow.file_profile_id,
            profile_canonical_sha256: profileRow.profile_canonical_sha256,
            dictionary_status: "draft",
            created_at: asIso(dictionaryInsert.rows[0].created_at),
            field_count: derivedFields.length,
            mapping_count: fieldIdByKey.size,
            finding_count: derivedFindings.length,
          };

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, record);
          await insertAudit(tx, {
            organizationId: profileRow.organization_id,
            intakeFileId: profileRow.intake_file_id,
            uploadState,
            metadata: buildDictionaryAuditMetadata(record),
            now,
          });
          await preparedAudit.publish();

          return dictionarySuccess({ dictionary: record, replayed: false });
        });
      } catch (error) {
        return shapeDictionaryError(error);
      }
    },

    async getDataDictionary(input) {
      if (!validateReadInput(input)) return dictionaryFailure("validation_blocker");
      const { identity } = input;
      try {
        return await runInTransaction(async (tx) => {
          const existing = await lockExistingBundle(tx, identity.organizationId, identity.fileProfileId);
          if (!existing) return dictionaryFailure("not_found");
          const counts = await readBundleCounts(tx, existing.data_dictionary_id);
          return dictionarySuccess({ dictionary: rowToBundleRecord(existing, counts) });
        });
      } catch (error) {
        return shapeDictionaryError(error);
      }
    },
  });
}

export const __dataDictionaryRepositoryContract = Object.freeze({
  DICTIONARY_AUDIT_CONTRACT,
  DICTIONARY_AUDIT_VALIDATOR_KEY,
  DICTIONARY_AUDIT_OPERATION,
  FILE_LEVEL_FIELD_KEY,
  MAPPING_CONFIDENCE_MIN,
  MAPPING_CONFIDENCE_MAX,
});

export const __dataDictionaryRepositoryTestables = Object.freeze({
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  deriveDictionaryFields,
  deriveQualityFindings,
  deriveDataType,
  deriveQualityNotesSafe,
  deriveMappingConfidence,
});
