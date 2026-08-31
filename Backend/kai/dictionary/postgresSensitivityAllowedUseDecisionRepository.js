/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use decision ledger repository: pure SQL
 * read/write primitives against kai.intake_sensitivity_review_decisions (see
 * migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql). No
 * business rules, no HTTP-shaped errors - the caller
 * (Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js) owns
 * the CAS/queue-transition/audit orchestration and interprets these results.
 *
 * Mirrors postgresHumanReviewDecisionRepository.js's style exactly: a
 * head-finding query using the NOT EXISTS "no successor" pattern that fails
 * closed (throws) if lineage is ambiguous rather than silently picking one, and
 * a pure INSERT ... RETURNING that leaves lineage integrity to the database's
 * own unique/FK constraints.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DECISION_COLUMNS = `d.decision_id, d.organization_id, d.intake_sensitivity_profile_id,
            d.review_queue_item_id, d.decision_outcome,
            d.reviewed_personal_data_status, d.reviewed_minor_data_status,
            d.reviewed_health_housing_justice_immigration_status,
            d.reviewed_indigenous_governance_status, d.reviewed_staff_notes_status,
            d.reviewed_story_testimonial_status, d.reviewed_small_cell_risk_status,
            d.reviewed_financial_records_status, d.reviewed_consent_basis_status,
            d.reviewed_allowed_use_status, d.reviewed_llm_processing_allowed,
            d.reviewed_product_learning_allowed, d.reviewed_public_use_allowed,
            d.reviewed_funder_use_allowed, d.decided_by, d.decided_by_role,
            d.target_updated_at, d.supersedes_decision_id, d.created_by_type, d.created_at`;

export class AmbiguousSensitivityDecisionLineageError extends Error {
  constructor() {
    super("intake_sensitivity_review decision lineage is ambiguous: more than one head row found");
    this.name = "AmbiguousSensitivityDecisionLineageError";
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  return (
    isPlainObject(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key))
  );
}

function isNullablePresence(value) {
  return value === null || value === "unknown" || value === "present" || value === "absent";
}

function isNullableAllowedUse(value) {
  return value === null || value === "unknown" || value === "allowed" || value === "not_allowed";
}

function isNullableBoolean(value) {
  return value === null || typeof value === "boolean";
}

/**
 * Read the current lineage-head Phase-5 decision for one sensitivity profile
 * (the row with no successor). Returns null if no decision has ever been
 * recorded - which the contract module's authority projection treats as "nothing
 * permitted". Throws AmbiguousSensitivityDecisionLineageError if more than one
 * head row is found (lineage corruption): this deliberately fails closed rather
 * than guessing which decision is current.
 */
export async function findCurrentSensitivityAllowedUseDecision(tx, { organizationId, intakeSensitivityProfileId }) {
  if (!isUuid(organizationId) || !isUuid(intakeSensitivityProfileId)) {
    throw new TypeError(
      "findCurrentSensitivityAllowedUseDecision requires organizationId and intakeSensitivityProfileId UUIDs.",
    );
  }
  const { rows } = await tx.query(
    `SELECT ${DECISION_COLUMNS}
       FROM kai.intake_sensitivity_review_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.intake_sensitivity_profile_id = $2::uuid
        AND NOT EXISTS (
              SELECT 1 FROM kai.intake_sensitivity_review_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )`,
    [organizationId, intakeSensitivityProfileId],
  );
  if (rows.length > 1) throw new AmbiguousSensitivityDecisionLineageError();
  return rows[0] || null;
}

const INSERT_INPUT_ALLOWED_KEYS = new Set([
  "organizationId",
  "intakeSensitivityProfileId",
  "reviewQueueItemId",
  "decisionOutcome",
  "reviewedSnapshot",
  "decidedBy",
  "decidedByRole",
  "targetUpdatedAt",
  "supersedesDecisionId",
]);

function isInsertSensitivityAllowedUseDecisionInput(input) {
  if (!hasExactKeys(input, INSERT_INPUT_ALLOWED_KEYS)) return false;
  const snapshot = input.reviewedSnapshot;
  if (snapshot !== null && !isPlainObject(snapshot)) return false;
  return (
    isUuid(input.organizationId)
    && isUuid(input.intakeSensitivityProfileId)
    && isUuid(input.reviewQueueItemId)
    && isNonEmptyString(input.decisionOutcome)
    && isUuid(input.decidedBy)
    && isNonEmptyString(input.decidedByRole)
    && isNonEmptyString(input.targetUpdatedAt)
    && (input.supersedesDecisionId === null || isUuid(input.supersedesDecisionId))
  );
}

/**
 * Normalize the (possibly null) reviewed snapshot into the exact 14 positional
 * values the INSERT below binds. A 'needs_more_information' decision passes
 * `reviewedSnapshot: null` and every one of these becomes SQL NULL, so such a
 * row is structurally incapable of carrying a permission (the ledger's own
 * snapshot-completeness CHECK independently enforces the same thing).
 */
function snapshotValues(snapshot) {
  const source = isPlainObject(snapshot) ? snapshot : {};
  const values = [
    source.reviewed_personal_data_status ?? null,
    source.reviewed_minor_data_status ?? null,
    source.reviewed_health_housing_justice_immigration_status ?? null,
    source.reviewed_indigenous_governance_status ?? null,
    source.reviewed_staff_notes_status ?? null,
    source.reviewed_story_testimonial_status ?? null,
    source.reviewed_small_cell_risk_status ?? null,
    source.reviewed_financial_records_status ?? null,
    source.reviewed_consent_basis_status ?? null,
    source.reviewed_allowed_use_status ?? null,
    source.reviewed_llm_processing_allowed ?? null,
    source.reviewed_product_learning_allowed ?? null,
    source.reviewed_public_use_allowed ?? null,
    source.reviewed_funder_use_allowed ?? null,
  ];
  for (let index = 0; index < 9; index += 1) {
    if (!isNullablePresence(values[index])) return null;
  }
  if (!isNullableAllowedUse(values[9])) return null;
  for (let index = 10; index < 14; index += 1) {
    if (!isNullableBoolean(values[index])) return null;
  }
  return values;
}

/**
 * Insert one new Phase-5 decision row. Pure INSERT ... RETURNING: no CAS, no
 * queue write, no audit, and no write of any kind to
 * kai.intake_sensitivity_profiles - the caller orchestrates those in the same
 * transaction. supersedesDecisionId must be null for a lineage root or the
 * current head's decision_id to append a successor; the database's own
 * unique/FK/CHECK constraints (see the b1a_02 migration) are the final authority
 * on lineage integrity and on every permission-basis rule.
 */
export async function insertSensitivityAllowedUseDecision(tx, input) {
  if (!isInsertSensitivityAllowedUseDecisionInput(input)) {
    throw new TypeError("insertSensitivityAllowedUseDecision received a malformed input.");
  }
  const values = snapshotValues(input.reviewedSnapshot);
  if (!values) {
    throw new TypeError("insertSensitivityAllowedUseDecision received a malformed reviewed snapshot.");
  }
  const { rows } = await tx.query(
    `INSERT INTO kai.intake_sensitivity_review_decisions (
       organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
       reviewed_personal_data_status, reviewed_minor_data_status,
       reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
       reviewed_staff_notes_status, reviewed_story_testimonial_status,
       reviewed_small_cell_risk_status, reviewed_financial_records_status,
       reviewed_consent_basis_status, reviewed_allowed_use_status,
       reviewed_llm_processing_allowed, reviewed_product_learning_allowed,
       reviewed_public_use_allowed, reviewed_funder_use_allowed,
       decided_by, decided_by_role, target_updated_at, supersedes_decision_id
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4,
             $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15::boolean, $16::boolean, $17::boolean, $18::boolean,
             $19::uuid, $20, $21::timestamptz, $22::uuid)
     RETURNING decision_id, organization_id, intake_sensitivity_profile_id, review_queue_item_id,
               decision_outcome, reviewed_personal_data_status, reviewed_minor_data_status,
               reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
               reviewed_staff_notes_status, reviewed_story_testimonial_status,
               reviewed_small_cell_risk_status, reviewed_financial_records_status,
               reviewed_consent_basis_status, reviewed_allowed_use_status,
               reviewed_llm_processing_allowed, reviewed_product_learning_allowed,
               reviewed_public_use_allowed, reviewed_funder_use_allowed,
               decided_by, decided_by_role, target_updated_at, supersedes_decision_id,
               created_by_type, created_at`,
    [
      input.organizationId,
      input.intakeSensitivityProfileId,
      input.reviewQueueItemId,
      input.decisionOutcome,
      ...values,
      input.decidedBy,
      input.decidedByRole,
      input.targetUpdatedAt,
      input.supersedesDecisionId,
    ],
  );
  return rows[0];
}

export const __sensitivityAllowedUseDecisionRepositoryTestables = Object.freeze({
  UUID_PATTERN,
  isInsertSensitivityAllowedUseDecisionInput,
  snapshotValues,
});
