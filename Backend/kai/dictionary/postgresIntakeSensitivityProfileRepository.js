import { withTransaction } from "../db/kaiDb.js";

/**
 * KAI P1-05 intake sensitivity and allowed-use profile repository adapter.
 *
 * This module is the only authorized location for P1-05 SQL and row locking. It
 * consumes only the tenant-scoped, already-committed `kai.intake_file_profiles`
 * lineage identified by `organizationId` + `fileProfileId`, and the already-committed
 * `kai.data_dictionaries` bundle identified by `organizationId` + `fileProfileId` +
 * `dataDictionaryId`: `intake_file_id` and `profile_canonical_sha256` are always
 * re-read from those rows, never accepted from the caller. It never reads raw bytes,
 * calls storage, invokes a parser or profiler, uses an LLM, performs an external
 * lookup, or infers facts from filenames or field names. No currently authorized
 * profiler, validator, review service, or producer emits a classification, consent,
 * sensitivity, or permission fact, so this repository does not read the
 * `kai.intake_file_profiles.profile` JSON column at all: it is machine-generated
 * profiling metadata, not authoritative classification or consent input. Every
 * classification dimension always persists as the fail-closed `unknown` state, never
 * a derived guess. This package does not execute retention, delete data, change
 * storage lifecycle, activate a job, or grant any approval or external-release
 * authority - it only records the fail-closed restrictions themselves.
 */

const SENSITIVITY_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const SENSITIVITY_AUDIT_CONTRACT = "p1_intake_sensitivity_and_allowed_use_v1";
const SENSITIVITY_AUDIT_VALIDATOR_KEY = "VAL-KAI-P1-05-001";
const SENSITIVITY_AUDIT_OPERATION = "intake_sensitivity_profile_persisted";

/**
 * Dimensions that persist as one of 'unknown' | 'present' | 'absent'. 'unknown' is a
 * real, distinct, queryable value - it never collapses into false/absent/clear/safe.
 * PII, minor data, health/housing/justice/immigration data, Indigenous/OCAP-like
 * governance-sensitive data, staff notes, story/testimonial content, small-cell risk,
 * consent basis, and financial records are each their own dimension and are never
 * merged into one another (Indigenous governance and financial records are always
 * kept distinct from generic PII). This foundation package persists every dimension
 * as `unknown` unconditionally: this array only enumerates the column vocabulary for
 * test and catalog-check reuse, it is never used to read a classification value from
 * any source.
 */
const PRESENT_ABSENT_DIMENSIONS = Object.freeze([
  // Named "personal_data" (not "pii"): the persisted SQL column for this dimension is
  // still named `pii_status`.
  "personal_data",
  "minor_data",
  "health_housing_justice_immigration",
  "indigenous_governance",
  "staff_notes",
  "story_testimonial",
  "small_cell_risk",
  "financial_records",
  "consent_basis",
]);

/** Dimensions that persist as one of 'unknown' | 'allowed' | 'not_allowed'. */
const ALLOWED_NOT_ALLOWED_DIMENSIONS = Object.freeze(["allowed_use"]);

function sensitivityFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: SENSITIVITY_RESULT_STATUS[code],
    },
  };
}

function sensitivitySuccess(data) {
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

function isSensitivityIdentity(value) {
  const allowedKeys = new Set(["organizationId", "fileProfileId", "dataDictionaryId"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.fileProfileId) &&
    isNonEmptyString(value.dataDictionaryId)
  );
}

function validatePersistInput(input) {
  const allowedKeys = new Set(["identity", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isSensitivityIdentity(input.identity) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function validateReadInput(input) {
  const allowedKeys = new Set(["identity"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return isSensitivityIdentity(input.identity);
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

async function readScopedProfile(tx, identity) {
  const result = await tx.query(
    `SELECT organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            profile_canonical_sha256
       FROM kai.intake_file_profiles
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid`,
    [identity.organizationId, identity.fileProfileId],
  );
  return result.rows[0] ?? null;
}

async function readScopedDictionary(tx, identity) {
  const result = await tx.query(
    `SELECT data_dictionary_id::text AS data_dictionary_id,
            organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id
       FROM kai.data_dictionaries
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid
        AND data_dictionary_id = $3::uuid`,
    [identity.organizationId, identity.fileProfileId, identity.dataDictionaryId],
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

async function lockExistingSensitivityProfile(tx, organizationId, fileProfileId, dataDictionaryId) {
  const result = await tx.query(
    `SELECT intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            data_dictionary_id::text AS data_dictionary_id,
            profile_canonical_sha256,
            pii_status,
            minor_data_status,
            health_housing_justice_immigration_status,
            indigenous_governance_status,
            staff_notes_status,
            story_testimonial_status,
            small_cell_risk_status,
            financial_records_status,
            consent_basis_status,
            allowed_use_status,
            llm_processing_allowed,
            product_learning_allowed,
            public_use_allowed,
            funder_use_allowed,
            human_review_required,
            retention_posture,
            created_at
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid
        AND data_dictionary_id = $3::uuid
      FOR UPDATE`,
    [organizationId, fileProfileId, dataDictionaryId],
  );
  return result.rows[0] ?? null;
}

function rowToSensitivityRecord(row) {
  return {
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    data_dictionary_id: row.data_dictionary_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    pii_status: row.pii_status,
    minor_data_status: row.minor_data_status,
    health_housing_justice_immigration_status: row.health_housing_justice_immigration_status,
    indigenous_governance_status: row.indigenous_governance_status,
    staff_notes_status: row.staff_notes_status,
    story_testimonial_status: row.story_testimonial_status,
    small_cell_risk_status: row.small_cell_risk_status,
    financial_records_status: row.financial_records_status,
    consent_basis_status: row.consent_basis_status,
    allowed_use_status: row.allowed_use_status,
    llm_processing_allowed: row.llm_processing_allowed,
    product_learning_allowed: row.product_learning_allowed,
    public_use_allowed: row.public_use_allowed,
    funder_use_allowed: row.funder_use_allowed,
    human_review_required: row.human_review_required,
    retention_posture: row.retention_posture,
    created_at: asIso(row.created_at),
  };
}

function buildSensitivityAuditMetadata(record) {
  return {
    metadata_only: true,
    contract: SENSITIVITY_AUDIT_CONTRACT,
    file_profile_id: record.file_profile_id,
    data_dictionary_id: record.data_dictionary_id,
    profile_canonical_sha256: record.profile_canonical_sha256,
    human_review_required: record.human_review_required,
    validator_key: SENSITIVITY_AUDIT_VALIDATOR_KEY,
  };
}

function buildSensitivityAuditPayload(record) {
  return {
    attempted_operation: SENSITIVITY_AUDIT_OPERATION,
    actor_type: "internal_service",
    contract: SENSITIVITY_AUDIT_CONTRACT,
    object_type: "intake_file",
    request_scope: "organization_file_profile_dictionary",
    route_contract: "unwired_synthetic_intake_sensitivity_profile",
    sprint_phase: "kai_sprint2_p1_05",
    validator_key: SENSITIVITY_AUDIT_VALIDATOR_KEY,
    human_review_required: record.human_review_required,
  };
}

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, SENSITIVITY_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

/**
 * Rejection of the required metadata-only audit must roll back the sensitivity
 * profile write in the same transaction, so it is raised as an error rather than
 * returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-04's `prepareRequiredAudit`: an own-property descriptor read (never a getter)
 * whose `value` is exactly `true`, alongside a callable `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, record) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildSensitivityAuditPayload(record),
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

function shapeSensitivityError(error) {
  if (error instanceof RequiredAuditRejectedError) return sensitivityFailure("validation_blocker");
  if (error?.code === "23505") return sensitivityFailure("conflict_current_state_changed");
  if (error?.code === "23503") return sensitivityFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return sensitivityFailure("validation_blocker");
  }
  return sensitivityFailure("system_error");
}

export function createPostgresIntakeSensitivityProfileRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Organization-scoped idempotent persist/replay keyed by the accepted P1-05
     * identity (organizationId + fileProfileId + dataDictionaryId). `intakeFileId`,
     * the committed profile, and `profile_canonical_sha256` are always re-read from
     * the authoritative committed `kai.intake_file_profiles` row; the bound
     * dictionary lineage is always re-read from the authoritative committed
     * `kai.data_dictionaries` row. The caller cannot provide or override any of
     * these, nor any classification, consent, permission, retention, or
     * allowed-use fact.
     *
     * Same identity and the same stored profile hash: replays the existing row.
     * Same identity with a different bound profile hash: `conflict_current_state_changed`.
     *
     * Concurrent identical creation is resolved by PostgreSQL conflict handling
     * inside this same transaction (`ON CONFLICT (...) DO NOTHING` plus an
     * authoritative re-read), never by an in-process lock.
     */
    async persistIntakeSensitivityProfile(input) {
      if (!validatePersistInput(input)) return sensitivityFailure("validation_blocker");
      const { identity, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const profileRow = await readScopedProfile(tx, identity);
          if (!profileRow) return sensitivityFailure("not_found");

          const dictionaryRow = await readScopedDictionary(tx, identity);
          if (!dictionaryRow) return sensitivityFailure("not_found");
          if (dictionaryRow.intake_file_id !== profileRow.intake_file_id) {
            return sensitivityFailure("not_found");
          }

          const existing = await lockExistingSensitivityProfile(
            tx,
            identity.organizationId,
            identity.fileProfileId,
            identity.dataDictionaryId,
          );
          if (existing) {
            if (existing.profile_canonical_sha256 !== profileRow.profile_canonical_sha256) {
              return sensitivityFailure("conflict_current_state_changed");
            }
            return sensitivitySuccess({ sensitivityProfile: rowToSensitivityRecord(existing), replayed: true });
          }

          const uploadState = await readScopedUploadState(tx, profileRow.organization_id, profileRow.intake_file_id);
          if (!uploadState) return sensitivityFailure("not_found");

          const insertResult = await tx.query(
            `INSERT INTO kai.intake_sensitivity_profiles (
               organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256,
               created_at
             )
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)
             ON CONFLICT (organization_id, file_profile_id, data_dictionary_id) DO NOTHING
             RETURNING intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
                       organization_id::text AS organization_id,
                       intake_file_id::text AS intake_file_id,
                       file_profile_id::text AS file_profile_id,
                       data_dictionary_id::text AS data_dictionary_id,
                       profile_canonical_sha256,
                       pii_status,
                       minor_data_status,
                       health_housing_justice_immigration_status,
                       indigenous_governance_status,
                       staff_notes_status,
                       story_testimonial_status,
                       small_cell_risk_status,
                       financial_records_status,
                       consent_basis_status,
                       allowed_use_status,
                       llm_processing_allowed,
                       product_learning_allowed,
                       public_use_allowed,
                       funder_use_allowed,
                       human_review_required,
                       retention_posture,
                       created_at`,
            [
              profileRow.organization_id,
              profileRow.intake_file_id,
              profileRow.file_profile_id,
              identity.dataDictionaryId,
              profileRow.profile_canonical_sha256,
              now,
            ],
          );

          let record;
          let replayed;
          if (insertResult.rowCount === 1) {
            record = rowToSensitivityRecord(insertResult.rows[0]);
            replayed = false;
          } else {
            // A concurrent transaction created the authoritative row for this exact
            // identity and committed first. PostgreSQL conflict handling - not an
            // in-process lock - resolves the race: re-read the committed
            // authoritative row inside this same transaction and replay it when the
            // bound profile hash still matches, so no duplicate row or audit row is
            // written and no raw unique violation reaches the caller.
            const concurrent = await lockExistingSensitivityProfile(
              tx,
              identity.organizationId,
              identity.fileProfileId,
              identity.dataDictionaryId,
            );
            if (!concurrent) return sensitivityFailure("system_error");
            if (concurrent.profile_canonical_sha256 !== profileRow.profile_canonical_sha256) {
              return sensitivityFailure("conflict_current_state_changed");
            }
            record = rowToSensitivityRecord(concurrent);
            replayed = true;
          }

          if (replayed) {
            return sensitivitySuccess({ sensitivityProfile: record, replayed: true });
          }

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, record);
          await insertAudit(tx, {
            organizationId: profileRow.organization_id,
            intakeFileId: profileRow.intake_file_id,
            uploadState,
            metadata: buildSensitivityAuditMetadata(record),
            now,
          });
          await preparedAudit.publish();

          return sensitivitySuccess({ sensitivityProfile: record, replayed: false });
        });
      } catch (error) {
        return shapeSensitivityError(error);
      }
    },

    async getIntakeSensitivityProfile(input) {
      if (!validateReadInput(input)) return sensitivityFailure("validation_blocker");
      const { identity } = input;
      try {
        return await runInTransaction(async (tx) => {
          const existing = await lockExistingSensitivityProfile(
            tx,
            identity.organizationId,
            identity.fileProfileId,
            identity.dataDictionaryId,
          );
          if (!existing) return sensitivityFailure("not_found");
          return sensitivitySuccess({ sensitivityProfile: rowToSensitivityRecord(existing) });
        });
      } catch (error) {
        return shapeSensitivityError(error);
      }
    },
  });
}

export const __intakeSensitivityProfileRepositoryContract = Object.freeze({
  SENSITIVITY_AUDIT_CONTRACT,
  SENSITIVITY_AUDIT_VALIDATOR_KEY,
  SENSITIVITY_AUDIT_OPERATION,
  PRESENT_ABSENT_DIMENSIONS,
  ALLOWED_NOT_ALLOWED_DIMENSIONS,
});

export const __intakeSensitivityProfileRepositoryTestables = Object.freeze({
  prepareRequiredAudit,
  RequiredAuditRejectedError,
});
