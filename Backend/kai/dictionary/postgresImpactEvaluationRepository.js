import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import { validateImpactEvaluationResults } from "../validators/kaiImpactEvaluationValidators.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);
// A1.2 owner decision: framework_status is draft -> active -> retired. A
// retired version is superseded and must never be selected for a new
// evaluation; draft and active versions are both usable inputs here --
// choosing which one is appropriate for a given call is a caller concern.
const FRAMEWORK_USABLE_STATUSES = new Set(["draft", "active"]);
const MAX_CLAIM_IDS = 50;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  return isPlainObject(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function validateInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "impactOutcomeContextId",
    "frameworkVersionId",
    "requestedAudience",
    "claimIds",
  ]))) return false;
  return UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.impactOutcomeContextId)
    && UUID_PATTERN.test(input.frameworkVersionId)
    && AUDIENCES.has(input.requestedAudience)
    && Array.isArray(input.claimIds)
    && input.claimIds.length >= 1
    && input.claimIds.length <= MAX_CLAIM_IDS
    && input.claimIds.every((claimId) => typeof claimId === "string" && UUID_PATTERN.test(claimId))
    && input.claimIds.length === new Set(input.claimIds).size
    && input.claimIds.every((claimId, index, arr) => index === 0 || arr[index - 1] < claimId);
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function validateCreateInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "impactOutcomeContextId",
    "frameworkVersionId",
    "requestedAudience",
    "claimIds",
    "createdBy",
    "now",
  ]))) return false;
  if (!validateInput({
    organizationId: input.organizationId,
    impactOutcomeContextId: input.impactOutcomeContextId,
    frameworkVersionId: input.frameworkVersionId,
    requestedAudience: input.requestedAudience,
    claimIds: input.claimIds,
  })) return false;
  return (input.createdBy === null || (typeof input.createdBy === "string" && UUID_PATTERN.test(input.createdBy)))
    && isCanonicalUtcTimestamp(input.now);
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

async function loadOutcomeContext(tx, { organizationId, impactOutcomeContextId }) {
  const { rows } = await tx.query(
    `SELECT impact_outcome_context_id::text AS impact_outcome_context_id,
            organization_id::text AS organization_id,
            outcome_key, outcome_statement, stakeholder_key, stakeholder_label
       FROM kai.impact_outcome_contexts
      WHERE organization_id = $1::uuid AND impact_outcome_context_id = $2::uuid`,
    [organizationId, impactOutcomeContextId],
  );
  return rows[0] || null;
}

async function loadFrameworkVersion(tx, { frameworkVersionId }) {
  const { rows } = await tx.query(
    `SELECT framework_version_id::text AS framework_version_id,
            framework_code, framework_name, version_label, framework_status
       FROM kai.impact_evaluation_framework_versions
      WHERE framework_version_id = $1::uuid`,
    [frameworkVersionId],
  );
  return rows[0] || null;
}

async function loadCriteria(tx, { frameworkVersionId }) {
  const { rows } = await tx.query(
    `SELECT criterion_id::text AS criterion_id, criterion_key, criterion_label,
            description, evaluation_guidance, display_order
       FROM kai.impact_evaluation_criteria
      WHERE framework_version_id = $1::uuid
      ORDER BY display_order ASC`,
    [frameworkVersionId],
  );
  return rows;
}

async function loadGovernedClaimProjection(tx, { organizationId, claimIds }) {
  const { rows } = await tx.query(
    `SELECT c.claim_id::text AS claim_id,
            c.statement AS claim_statement,
            c.claim_type,
            c.evidence_item_id::text AS evidence_item_id,
            e.source_id::text AS source_id,
            e.source_version_id::text AS source_version_id
       FROM kai.claims c
       JOIN kai.evidence_items e
         ON e.organization_id = c.organization_id
        AND e.evidence_item_id = c.evidence_item_id
      WHERE c.organization_id = $1::uuid
        AND c.claim_id = ANY($2::uuid[])
      ORDER BY c.claim_id ASC`,
    [organizationId, claimIds],
  );
  if (rows.length !== claimIds.length) return null;
  return rows.map((row) => ({
    claimId: row.claim_id,
    claimStatement: row.claim_statement,
    claimType: row.claim_type,
    evidenceItemId: row.evidence_item_id,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
  }));
}

function toGeneratorInput({ outcomeContext, framework, criteria, governedClaims }) {
  return {
    outcomeContext: {
      outcomeKey: outcomeContext.outcome_key,
      outcomeStatement: outcomeContext.outcome_statement,
      stakeholderKey: outcomeContext.stakeholder_key,
      stakeholderLabel: outcomeContext.stakeholder_label,
    },
    framework: {
      frameworkCode: framework.framework_code,
      versionLabel: framework.version_label,
    },
    criteria: criteria.map((criterion) => ({
      criterionId: criterion.criterion_id,
      criterionKey: criterion.criterion_key,
      criterionLabel: criterion.criterion_label,
      description: criterion.description,
      evaluationGuidance: criterion.evaluation_guidance,
    })),
    governedEvidence: governedClaims.map((claim) => ({
      claimId: claim.claimId,
      claimStatement: claim.claimStatement,
      claimType: claim.claimType,
      evidenceItemId: claim.evidenceItemId,
    })),
  };
}

function isImpactEvaluationGeneratorResult(result) {
  if (!hasExactKeys(result, new Set(["results"])) || !Array.isArray(result.results)) return false;
  for (const entry of result.results) {
    if (!hasExactKeys(entry, new Set([
      "criterionId",
      "assessmentState",
      "safeExplanation",
      "limitationNotes",
      "claimIds",
      "evidenceItemIds",
    ]))) return false;
    if (typeof entry.criterionId !== "string" || !UUID_PATTERN.test(entry.criterionId)) return false;
    if (typeof entry.assessmentState !== "string") return false;
    if (typeof entry.safeExplanation !== "string") return false;
    if (entry.limitationNotes !== null && typeof entry.limitationNotes !== "string") return false;
    if (!Array.isArray(entry.claimIds) || !entry.claimIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))) {
      return false;
    }
    if (
      !Array.isArray(entry.evidenceItemIds)
      || !entry.evidenceItemIds.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
    ) {
      return false;
    }
  }
  return true;
}

class ImpactEvaluationRollbackError extends Error {
  constructor(result) {
    super("rollback impact-evaluation transaction");
    this.name = "ImpactEvaluationRollbackError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new ImpactEvaluationRollbackError(failure(code));
}

async function insertEvaluation(tx, { organizationId, impactOutcomeContextId, frameworkVersionId, createdBy, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.impact_evaluations (
       organization_id, impact_outcome_context_id, framework_version_id,
       created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'human',$5::timestamptz)
     RETURNING impact_evaluation_id::text AS impact_evaluation_id`,
    [organizationId, impactOutcomeContextId, frameworkVersionId, createdBy, now],
  );
  return rows[0].impact_evaluation_id;
}

async function insertResult(tx, { organizationId, impactEvaluationId, frameworkVersionId, result, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.impact_evaluation_results (
       organization_id, impact_evaluation_id, framework_version_id, criterion_id,
       assessment_state, safe_explanation, limitation_notes, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::timestamptz)
     RETURNING impact_evaluation_result_id::text AS impact_evaluation_result_id`,
    [
      organizationId,
      impactEvaluationId,
      frameworkVersionId,
      result.criterionId,
      result.assessmentState,
      result.safeExplanation,
      result.limitationNotes,
      now,
    ],
  );
  return rows[0].impact_evaluation_result_id;
}

async function insertEvidenceLink(tx, { organizationId, impactEvaluationResultId, evidenceItemId, now }) {
  await tx.query(
    `INSERT INTO kai.impact_evaluation_result_evidence_links (
       organization_id, impact_evaluation_result_id, evidence_item_id, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::timestamptz)`,
    [organizationId, impactEvaluationResultId, evidenceItemId, now],
  );
}

async function insertClaimLink(tx, { organizationId, impactEvaluationResultId, claimId, now }) {
  await tx.query(
    `INSERT INTO kai.impact_evaluation_result_claim_links (
       organization_id, impact_evaluation_result_id, claim_id, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::timestamptz)`,
    [organizationId, impactEvaluationResultId, claimId, now],
  );
}

async function persistValidatedEvaluation(tx, { organizationId, impactOutcomeContextId, frameworkVersionId, createdBy, now, results }) {
  const impactEvaluationId = await insertEvaluation(tx, {
    organizationId,
    impactOutcomeContextId,
    frameworkVersionId,
    createdBy,
    now,
  });

  const persistedResults = [];
  for (const result of results) {
    const impactEvaluationResultId = await insertResult(tx, {
      organizationId,
      impactEvaluationId,
      frameworkVersionId,
      result,
      now,
    });
    for (const evidenceItemId of result.evidenceItemIds) {
      await insertEvidenceLink(tx, { organizationId, impactEvaluationResultId, evidenceItemId, now });
    }
    for (const claimId of result.claimIds) {
      await insertClaimLink(tx, { organizationId, impactEvaluationResultId, claimId, now });
    }
    persistedResults.push({ impactEvaluationResultId, ...result });
  }
  return { impactEvaluationId, results: persistedResults };
}

async function rereadPersistedEvaluation(tx, { organizationId, impactEvaluationId }) {
  const evaluationRows = await tx.query(
    `SELECT impact_evaluation_id::text AS impact_evaluation_id,
            organization_id::text AS organization_id,
            impact_outcome_context_id::text AS impact_outcome_context_id,
            framework_version_id::text AS framework_version_id,
            created_at
       FROM kai.impact_evaluations
      WHERE organization_id = $1::uuid AND impact_evaluation_id = $2::uuid`,
    [organizationId, impactEvaluationId],
  );
  const resultRows = await tx.query(
    `SELECT impact_evaluation_result_id::text AS impact_evaluation_result_id,
            criterion_id::text AS criterion_id, assessment_state, safe_explanation, limitation_notes
       FROM kai.impact_evaluation_results
      WHERE organization_id = $1::uuid AND impact_evaluation_id = $2::uuid
      ORDER BY impact_evaluation_result_id ASC`,
    [organizationId, impactEvaluationId],
  );
  const resultIds = resultRows.rows.map((row) => row.impact_evaluation_result_id);
  const evidenceLinkRows = resultIds.length === 0
    ? { rows: [] }
    : await tx.query(
        `SELECT impact_evaluation_result_id::text AS impact_evaluation_result_id,
                evidence_item_id::text AS evidence_item_id
           FROM kai.impact_evaluation_result_evidence_links
          WHERE organization_id = $1::uuid AND impact_evaluation_result_id = ANY($2::uuid[])`,
        [organizationId, resultIds],
      );
  const claimLinkRows = resultIds.length === 0
    ? { rows: [] }
    : await tx.query(
        `SELECT impact_evaluation_result_id::text AS impact_evaluation_result_id,
                claim_id::text AS claim_id
           FROM kai.impact_evaluation_result_claim_links
          WHERE organization_id = $1::uuid AND impact_evaluation_result_id = ANY($2::uuid[])`,
        [organizationId, resultIds],
      );
  return {
    evaluation: evaluationRows.rows[0] || null,
    results: resultRows.rows,
    evidenceLinks: evidenceLinkRows.rows,
    claimLinks: claimLinkRows.rows,
  };
}

/**
 * Post-write validation (the round-trip check the A2.2 write path requires
 * before it will audit and commit): rereads exactly what was just inserted
 * inside the same transaction and proves it matches the already-validated,
 * in-memory result set byte-for-byte -- same evaluation identity, same
 * result count/criteria/assessment_state/explanation/limitation text, same
 * evidence/claim citation sets per result. This defends against a
 * persistence bug or a concurrent mutation inside this same transaction; it
 * is not a second pass of the AI-output safety validators (VAL-IEV-*), which
 * already ran against the in-memory result before any write occurred.
 */
function persistedEvaluationMatchesExpected(persisted, expected) {
  if (!persisted.evaluation) return false;
  if (
    persisted.evaluation.organization_id !== expected.organizationId
    || persisted.evaluation.impact_outcome_context_id !== expected.impactOutcomeContextId
    || persisted.evaluation.framework_version_id !== expected.frameworkVersionId
  ) return false;
  if (persisted.results.length !== expected.results.length) return false;

  const evidenceByResult = new Map();
  for (const link of persisted.evidenceLinks) {
    if (!evidenceByResult.has(link.impact_evaluation_result_id)) evidenceByResult.set(link.impact_evaluation_result_id, []);
    evidenceByResult.get(link.impact_evaluation_result_id).push(link.evidence_item_id);
  }
  const claimsByResult = new Map();
  for (const link of persisted.claimLinks) {
    if (!claimsByResult.has(link.impact_evaluation_result_id)) claimsByResult.set(link.impact_evaluation_result_id, []);
    claimsByResult.get(link.impact_evaluation_result_id).push(link.claim_id);
  }

  const persistedById = new Map(persisted.results.map((row) => [row.impact_evaluation_result_id, row]));
  for (const expectedResult of expected.results) {
    const row = persistedById.get(expectedResult.impactEvaluationResultId);
    if (!row) return false;
    if (
      row.criterion_id !== expectedResult.criterionId
      || row.assessment_state !== expectedResult.assessmentState
      || row.safe_explanation !== expectedResult.safeExplanation
      || (row.limitation_notes ?? null) !== (expectedResult.limitationNotes ?? null)
    ) return false;
    const persistedEvidenceIds = [...(evidenceByResult.get(expectedResult.impactEvaluationResultId) || [])].sort();
    const persistedClaimIds = [...(claimsByResult.get(expectedResult.impactEvaluationResultId) || [])].sort();
    const expectedEvidenceIds = [...expectedResult.evidenceItemIds].sort();
    const expectedClaimIds = [...expectedResult.claimIds].sort();
    if (JSON.stringify(persistedEvidenceIds) !== JSON.stringify(expectedEvidenceIds)) return false;
    if (JSON.stringify(persistedClaimIds) !== JSON.stringify(expectedClaimIds)) return false;
  }
  return true;
}

function prepareRequiredAudit(metadataOnlyAudit, tx, payload) {
  const prepared = metadataOnlyAudit?.prepareMetadataOnlyAudit?.({ payload, db: tx });
  const descriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== true || typeof prepared.publish !== "function") {
    throw new Error("impact_evaluation_required_audit_prepare_failed");
  }
  return prepared;
}

/**
 * A2.1 evaluator: organization + engagement (via the outcome context) +
 * selected A1.2 framework version + its persisted criteria + eligible
 * governed evidence/claims -> one bounded AI call -> validated structured
 * criterion results. Read-only: this function never writes kai.* tables. It
 * does not persist an evaluation snapshot or provenance link -- that is
 * deferred to A2.2 -- and the AI seam (`dependencies.generator`) never
 * touches the database or decides eligibility/approval.
 */
export function createPostgresImpactEvaluationRepository({ runInTransaction, evaluator } = {}) {
  return Object.freeze({
    async evaluateImpactOutcomeContext(input, dependencies = {}) {
      if (!validateInput(input)) return failure("validation_blocker");
      if (typeof dependencies.generator !== "function") return failure("validation_blocker");

      const { organizationId, impactOutcomeContextId, frameworkVersionId, requestedAudience, claimIds } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const evaluate = evaluator || evaluateClaimTraceabilityInTransaction;

      try {
        return await run(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

          const outcomeContext = await loadOutcomeContext(tx, { organizationId, impactOutcomeContextId });
          if (!outcomeContext) return failure("not_found");

          const framework = await loadFrameworkVersion(tx, { frameworkVersionId });
          if (!framework) return failure("not_found");
          if (!FRAMEWORK_USABLE_STATUSES.has(framework.framework_status)) return failure("validation_blocker");

          const criteria = await loadCriteria(tx, { frameworkVersionId });
          if (criteria.length === 0) return failure("validation_blocker");

          // Every requested claim must be a fresh, tenant-valid, currently
          // eligible (for requestedAudience) governed claim -- an unknown,
          // cross-tenant, or currently-ineligible claim id fails the whole
          // evaluation closed rather than being silently dropped.
          for (const claimId of claimIds) {
            const traceability = await evaluate(tx, { organizationId, claimId, requestedAudience });
            if (
              !traceability.ok
              || traceability.data?.claim?.claim_id !== claimId
              || traceability.data?.requestedAudience !== requestedAudience
              || traceability.data?.eligible !== true
            ) {
              return failure("validation_blocker");
            }
          }

          const governedClaims = await loadGovernedClaimProjection(tx, { organizationId, claimIds });
          if (!governedClaims) return failure("conflict_current_state_changed");

          const generatorInput = toGeneratorInput({ outcomeContext, framework, criteria, governedClaims });
          const generatorResult = await dependencies.generator(generatorInput);
          if (!isImpactEvaluationGeneratorResult(generatorResult)) return failure("validation_blocker");

          const validation = validateImpactEvaluationResults({
            criteria: criteria.map((criterion) => ({ criterionId: criterion.criterion_id })),
            governedEvidence: governedClaims.map((claim) => ({
              claimId: claim.claimId,
              evidenceItemId: claim.evidenceItemId,
            })),
            results: generatorResult.results,
          });
          if (!validation.ok) return failure("validation_blocker");

          return success({
            impactOutcomeContextId,
            frameworkVersionId,
            frameworkCode: framework.framework_code,
            versionLabel: framework.version_label,
            requestedAudience,
            results: generatorResult.results.map((result) => ({
              criterionId: result.criterionId,
              assessmentState: result.assessmentState,
              safeExplanation: result.safeExplanation,
              limitationNotes: result.limitationNotes,
              claimIds: [...result.claimIds].sort(),
              evidenceItemIds: [...result.evidenceItemIds].sort(),
            })),
          });
        });
      } catch (error) {
        if (error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    /**
     * A2.2 write path: validate -> transaction -> write evaluation -> write
     * criterion results -> write A1.4 provenance -> post-write validation ->
     * audit -> commit. If validation of the AI output fails, execution never
     * reaches a single INSERT -- the transaction's only statements before
     * that point are reads (outcome context, framework, criteria, governed
     * claims, traceability revalidation). Every write happens inside one
     * transaction; any failure past that point (post-write mismatch, a
     * rejected required audit) throws to roll the whole write back, so a
     * failed evaluation persists nothing.
     */
    async createImpactEvaluationSnapshot(input, dependencies = {}) {
      if (!validateCreateInput(input)) return failure("validation_blocker");
      if (typeof dependencies.generator !== "function") return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const {
        organizationId,
        impactOutcomeContextId,
        frameworkVersionId,
        requestedAudience,
        claimIds,
        createdBy,
        now,
      } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      const evaluate = evaluator || evaluateClaimTraceabilityInTransaction;

      try {
        return await run(async (tx) => {
          const outcomeContext = await loadOutcomeContext(tx, { organizationId, impactOutcomeContextId });
          if (!outcomeContext) return failure("not_found");

          const framework = await loadFrameworkVersion(tx, { frameworkVersionId });
          if (!framework) return failure("not_found");
          if (!FRAMEWORK_USABLE_STATUSES.has(framework.framework_status)) return failure("validation_blocker");

          const criteria = await loadCriteria(tx, { frameworkVersionId });
          if (criteria.length === 0) return failure("validation_blocker");

          // Same fail-closed eligibility revalidation as A2.1's read path --
          // this is a read (evaluateClaimTraceabilityInTransaction never
          // writes kai.claims/kai.evidence_items), never an approval, and
          // never an audience-eligibility mutation.
          for (const claimId of claimIds) {
            const traceability = await evaluate(tx, { organizationId, claimId, requestedAudience });
            if (
              !traceability.ok
              || traceability.data?.claim?.claim_id !== claimId
              || traceability.data?.requestedAudience !== requestedAudience
              || traceability.data?.eligible !== true
            ) {
              return failure("validation_blocker");
            }
          }

          const governedClaims = await loadGovernedClaimProjection(tx, { organizationId, claimIds });
          if (!governedClaims) return failure("conflict_current_state_changed");

          const generatorInput = toGeneratorInput({ outcomeContext, framework, criteria, governedClaims });
          const generatorResult = await dependencies.generator(generatorInput);
          if (!isImpactEvaluationGeneratorResult(generatorResult)) return failure("validation_blocker");

          const validation = validateImpactEvaluationResults({
            criteria: criteria.map((criterion) => ({ criterionId: criterion.criterion_id })),
            governedEvidence: governedClaims.map((claim) => ({
              claimId: claim.claimId,
              evidenceItemId: claim.evidenceItemId,
            })),
            results: generatorResult.results,
          });
          if (!validation.ok) return failure("validation_blocker");

          // Nothing above this line has written anything. From here on,
          // every failure must roll the transaction back instead of
          // returning directly, so a partially-written evaluation can never
          // be observed or committed.
          const criterionById = new Map(criteria.map((criterion) => [criterion.criterion_id, criterion]));
          const validatedResults = generatorResult.results.map((result) => ({
            criterionId: result.criterionId,
            criterionKey: criterionById.get(result.criterionId)?.criterion_key || null,
            criterionLabel: criterionById.get(result.criterionId)?.criterion_label || null,
            assessmentState: result.assessmentState,
            safeExplanation: result.safeExplanation,
            limitationNotes: result.limitationNotes,
            claimIds: [...new Set(result.claimIds)].sort(),
            evidenceItemIds: [...new Set(result.evidenceItemIds)].sort(),
          }));

          const persisted = await persistValidatedEvaluation(tx, {
            organizationId,
            impactOutcomeContextId,
            frameworkVersionId,
            createdBy,
            now,
            results: validatedResults,
          });

          const reread = await rereadPersistedEvaluation(tx, {
            organizationId,
            impactEvaluationId: persisted.impactEvaluationId,
          });
          if (!persistedEvaluationMatchesExpected(reread, {
            organizationId,
            impactOutcomeContextId,
            frameworkVersionId,
            results: persisted.results,
          })) {
            rollbackFailure("system_error");
          }

          let preparedAudit;
          try {
            preparedAudit = prepareRequiredAudit(dependencies.metadataOnlyAudit, tx, {
              attempted_operation: "a2_02_impact_evaluation_created",
              impact_evaluation_id: persisted.impactEvaluationId,
              validator_key: "VAL-IEV-ALL",
            });
          } catch {
            rollbackFailure("system_error");
          }
          await preparedAudit.publish();

          return success({
            impactEvaluationId: persisted.impactEvaluationId,
            impactOutcomeContextId,
            frameworkVersionId,
            frameworkCode: framework.framework_code,
            versionLabel: framework.version_label,
            requestedAudience,
            createdAt: now,
            results: persisted.results.map((result) => ({
              impactEvaluationResultId: result.impactEvaluationResultId,
              criterionId: result.criterionId,
              criterionKey: result.criterionKey,
              criterionLabel: result.criterionLabel,
              assessmentState: result.assessmentState,
              safeExplanation: result.safeExplanation,
              limitationNotes: result.limitationNotes,
              claimIds: result.claimIds,
              evidenceItemIds: result.evidenceItemIds,
            })),
          });
        });
      } catch (error) {
        if (error instanceof ImpactEvaluationRollbackError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },
  });
}

export const __impactEvaluationRepositoryTestables = Object.freeze({
  isImpactEvaluationGeneratorResult,
  toGeneratorInput,
  FRAMEWORK_USABLE_STATUSES,
  persistedEvaluationMatchesExpected,
});
