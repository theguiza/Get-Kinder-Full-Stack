import { publicReconciliationJob } from "../parsing/crossSourceReconciliationJobContract.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { validateRecordCountDefinition } from "../validators/kaiSourceMeasurementValidators.js";
import { validatePairedOutcomeDefinition } from "../validators/kaiPairedOutcomeMeasurementValidators.js";
import {
  DERIVED_MEASUREMENT_FAMILIES,
  validateDerivedMeasurementInterpretation,
  validateCrossSourceReachMapping,
  validateTabularMeasurementDefinition,
} from "../validators/kaiDerivedMeasurementValidators.js";
import { __evidenceLineageServiceContract } from "./kaiEvidenceLineageService.js";

// The P2-01 evidence-extraction authority (organization membership only):
// whoever may create evidence from a promoted source may record what one of
// its records represents and the resulting measurement evidence. Defining the
// counted unit is the organization's factual input; it approves nothing and
// the evidence stays GK-review-gated.
const SOURCE_MEASUREMENT_ALLOWED_ROLES = __evidenceLineageServiceContract.EVIDENCE_LINEAGE_ALLOWED_ROLES;
const SOURCE_MEASUREMENT_OPERATION = "record_source_record_count_measurement";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isRecordInput(value) {
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "definition", "worksheetKey", "actorContext", "now"]);
  return isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && isNonEmptyString(value.organizationId)
    && isNonEmptyString(value.sourceVersionId)
    && isPlainObject(value.actorContext)
    && isNormalizedNow(value.now);
}

// One admission for the write and the read-only basis: a mapped human with
// the P2-01 extraction authority in this organization, before any read.
function admitMeasurementActor(actorContext, organizationId) {
  if (actorContext?.actorType !== "human" || !isNonEmptyString(actorContext?.actorUserId)) {
    return buildKaiError("authorization_denied");
  }
  const auth = validateActorCanPerformOperation(actorContext, SOURCE_MEASUREMENT_OPERATION, organizationId, {
    allowedRoles: SOURCE_MEASUREMENT_ALLOWED_ROLES,
  });
  if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  return null;
}

async function createDefaultRepository() {
  const { createPostgresSourceMeasurementRepository } = await import("../dictionary/postgresSourceMeasurementRepository.js");
  return createPostgresSourceMeasurementRepository();
}

/**
 * KAI P2-01M: record a human definition of what one data record of a promoted,
 * current source version represents, and the record-count measurement KAI
 * derives deterministically from that version's committed P1 profile (no
 * model, no raw file read, no row-level data persisted). The measurement
 * becomes internal-only, GK-review-gated `source_record_count_measurement`
 * evidence with a whole-version locator; nothing is approved, and no claim,
 * gap, or client follow-up is created here. Without a complete definition
 * nothing is written and the structured blocker names what is missing.
 */
export async function recordSourceRecordCountMeasurement(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  if (!isRecordInput(input)) return buildKaiError("validation_blocker");

  const { actorContext } = input;
  const denied = admitMeasurementActor(actorContext, input.organizationId);
  if (denied) return denied;

  const definition = validateRecordCountDefinition(input.definition);
  if (!definition.ok) return buildKaiError(definition.code, { blockers: definition.blockers });

  const repository = dependencies.sourceMeasurementRepository || (await createDefaultRepository());
  const result = await repository.recordSourceRecordCountMeasurement({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    definition: definition.definition,
    worksheetKey: input.worksheetKey ?? null,
    actorUserId: actorContext.actorUserId,
    now: input.now,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Read-only basis for recording the measurement (Plan A Prompt 8): the
 * authoritative profile counts and calculation for the exact promoted,
 * current, permitted version (or the structured reason it cannot be
 * measured), and any definition, measurement, limitations, and claim already
 * recorded for it. Same admission as the write; writes nothing.
 */
export async function getSourceRecordCountMeasurementBasis(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "worksheetKey", "actorContext"]);
  if (!isPlainObject(input) || !Object.keys(input).every((key) => allowedKeys.has(key))
    || !["organizationId", "sourceVersionId", "actorContext"].every((key) => Object.hasOwn(input, key))
    || !isNonEmptyString(input.organizationId) || !isNonEmptyString(input.sourceVersionId) || !isPlainObject(input.actorContext)) {
    return buildKaiError("validation_blocker");
  }
  const denied = admitMeasurementActor(input.actorContext, input.organizationId);
  if (denied) return denied;
  const repository = dependencies.sourceMeasurementRepository || (await createDefaultRepository());
  const result = await repository.readSourceRecordCountMeasurementBasis({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Read-only paired baseline/follow-up measurements (Measurement MVP) of one
 * worksheet of a promoted, current, permitted version: KAI's proposed fields
 * and the numeric change of every proposed outcome field, under the same
 * admission as the record count. A definition of what a field measures and
 * its scoring direction is accepted only from an admitted person, who holds
 * the authority that records a record-count definition. It is applied to
 * this answer and is not recorded (the schema has no paired-outcome
 * definition yet).
 */
export async function getPairedOutcomeMeasurementBasis(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "worksheetKey", "definitions", "actorContext"]);
  if (!isPlainObject(input) || !Object.keys(input).every((key) => allowedKeys.has(key))
    || !isNonEmptyString(input.organizationId) || !isNonEmptyString(input.sourceVersionId) || !isPlainObject(input.actorContext)
    || (input.definitions !== undefined && !Array.isArray(input.definitions))) {
    return buildKaiError("validation_blocker");
  }
  const denied = admitMeasurementActor(input.actorContext, input.organizationId);
  if (denied) return denied;
  const definitions = [];
  for (const candidate of input.definitions ?? []) {
    const definition = validatePairedOutcomeDefinition(candidate);
    if (!definition.ok) return buildKaiError(definition.code, { blockers: definition.blockers });
    definitions.push(definition.definition);
  }
  const repository = dependencies.sourceMeasurementRepository || (await createDefaultRepository());
  const result = await repository.readPairedOutcomeMeasurementBasis({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
    definitions,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

async function createDefaultDerivedRepository() {
  const { createPostgresDerivedMeasurementRepository } = await import("../dictionary/postgresDerivedMeasurementRepository.js");
  return createPostgresDerivedMeasurementRepository();
}

async function createDefaultReconciliationJobRepository() {
  const { createPostgresCrossSourceReconciliationJobRepository } = await import("../parsing/postgresCrossSourceReconciliationJobRepository.js");
  return createPostgresCrossSourceReconciliationJobRepository();
}

async function defaultReconciliationDispatcher() {
  const { getCrossSourceReconciliationDispatcher } = await import("../parsing/crossSourceReconciliationJobRuntime.js");
  return getCrossSourceReconciliationDispatcher();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasOnly(input, keys, required) {
  return isPlainObject(input)
    && Object.keys(input).every((key) => keys.includes(key))
    && required.every((key) => Object.hasOwn(input, key));
}

function repositoryResult(result) {
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

// Measurement MVP: the same admission as the record count - the feature flag,
// a mapped human with the P2-01 extraction authority in this organization,
// and the tenant - before any read. Calculating and retaining a measurement
// approves nothing: its evidence and claim stay review-gated.
function admitDerivedInput(input, keys, required, dependencies) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  if (!hasOnly(input, keys, required) || !isNonEmptyString(input.organizationId) || !isPlainObject(input.actorContext)) {
    return buildKaiError("validation_blocker");
  }
  if (input.now !== undefined && !isNormalizedNow(input.now)) return buildKaiError("validation_blocker");
  return admitMeasurementActor(input.actorContext, input.organizationId);
}

/** Read-only: what can be measured on a version and what is recorded for it. */
export async function getDerivedMeasurementBasis(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "sourceVersionId", "worksheetKey", "actorContext"], ["organizationId", "sourceVersionId", "actorContext"], dependencies);
  if (denied) return denied;
  if (!isNonEmptyString(input.sourceVersionId)) return buildKaiError("validation_blocker");
  const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
  return repositoryResult(await repository.readDerivedMeasurementBasis({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
  }));
}

/**
 * Package A: retain every available paired baseline/follow-up outcome of one
 * worksheet as a proposed numerical result - no meaning, direction or other
 * human definition is required - with its evidence under no interpretation.
 */
export async function recordPairedOutcomeMeasurements(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "sourceVersionId", "worksheetKey", "actorContext", "now"], ["organizationId", "sourceVersionId", "actorContext", "now"], dependencies);
  if (denied) return denied;
  if (!isNonEmptyString(input.sourceVersionId)) return buildKaiError("validation_blocker");
  const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
  return repositoryResult(await repository.recordPairedOutcomeMeasurements({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
    actorUserId: input.actorContext.actorUserId,
    now: input.now,
  }));
}

/**
 * Package B: one content-aware tabular count or rate under a person's
 * selection of fields, values and the engagement reporting period, with an
 * optional interpretation of what it means.
 */
export async function recordTabularMeasurement(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "sourceVersionId", "worksheetKey", "definition", "interpretation", "actorContext", "now"], ["organizationId", "sourceVersionId", "definition", "actorContext", "now"], dependencies);
  if (denied) return denied;
  if (!isNonEmptyString(input.sourceVersionId)) return buildKaiError("validation_blocker");
  const definition = validateTabularMeasurementDefinition(input.definition);
  if (!definition.ok) return buildKaiError(definition.code, { blockers: definition.blockers });
  let interpretation = null;
  if (input.interpretation !== undefined && input.interpretation !== null) {
    const family = definition.definition.operation === "rate" ? DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE : DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT;
    const validated = validateDerivedMeasurementInterpretation(input.interpretation, { family });
    if (!validated.ok) return buildKaiError(validated.code, { blockers: validated.blockers });
    interpretation = validated.interpretation;
  }
  const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
  return repositoryResult(await repository.recordTabularMeasurement({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    worksheetKey: input.worksheetKey ?? null,
    definition: definition.definition,
    interpretation,
    actorUserId: input.actorContext.actorUserId,
    now: input.now,
  }));
}

/**
 * Cross-source linked reach: a person's confirmed mapping of the service-event
 * fields (event identifier, participant identifier, status and its completed
 * value, date, optional group) and the register's participant identifier,
 * applied to two promoted CSV versions of this organization with the events
 * engagement's recorded reporting period.
 *
 * This request reads no source byte. It admits the person, checks both
 * versions (lineage, currentness, effective allowed use, bound profile) and
 * the mapping against both committed profiles, and records one queued
 * reconciliation job for exactly this request - or finds the existing one -
 * in the same transaction; after commit the job is handed to the
 * reconciliation worker, which reads the bytes, revalidates everything and
 * commits the measurements. Their evidence stays review-gated.
 */
export async function requestCrossSourceReachMeasurements(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "primarySourceVersionId", "referenceSourceVersionId", "mapping", "actorContext", "now"], ["organizationId", "primarySourceVersionId", "referenceSourceVersionId", "mapping", "actorContext", "now"], dependencies);
  if (denied) return denied;
  if (!UUID_RE.test(input.primarySourceVersionId ?? "") || !UUID_RE.test(input.referenceSourceVersionId ?? "")) return buildKaiError("validation_blocker");
  const mapping = validateCrossSourceReachMapping(input.mapping);
  if (!mapping.ok) return buildKaiError(mapping.code, { blockers: mapping.blockers });
  const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
  const jobs = dependencies.reconciliationJobRepository || (await createDefaultReconciliationJobRepository());
  const result = await repository.requestCrossSourceReachMeasurements({
    organizationId: input.organizationId,
    primarySourceVersionId: input.primarySourceVersionId,
    referenceSourceVersionId: input.referenceSourceVersionId,
    mapping: mapping.mapping,
    enqueue: (tx, admitted) => jobs.enqueueInTransaction(tx, {
      organizationId: input.organizationId,
      primarySourceVersionId: input.primarySourceVersionId,
      referenceSourceVersionId: input.referenceSourceVersionId,
      primaryProfileCanonicalSha256: admitted.primaryProfileCanonicalSha256,
      referenceProfileCanonicalSha256: admitted.referenceProfileCanonicalSha256,
      mapping: { ...mapping.mapping, period: admitted.period },
      requestedBy: input.actorContext.actorUserId,
      now: input.now,
    }),
  });
  if (!result.ok) return repositoryResult(result);
  const { job, fresh, requeued } = result.data;
  if (["queued", "retry_scheduled", "in_progress"].includes(job.job_state)) {
    try {
      const dispatcher = dependencies.reconciliationDispatcher || (await defaultReconciliationDispatcher());
      dispatcher.dispatch({ organizationId: input.organizationId, reconciliationJobId: job.reconciliation_job_id }, { env: dependencies.env || process.env });
    } catch {
      // The job is committed; the scheduled sweep remains its recovery path.
    }
  }
  return { ok: true, data: { reconciliationJob: publicReconciliationJob(job), fresh, requeued }, error: null };
}

/**
 * Read-only: one reconciliation job of this organization - its state, its
 * safe error code, and, once it succeeded, the measurements it committed as
 * the derived-measurement read shows them.
 */
export async function getCrossSourceReconciliationJob(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "reconciliationJobId", "actorContext"], ["organizationId", "reconciliationJobId", "actorContext"], dependencies);
  if (denied) return denied;
  if (!UUID_RE.test(input.reconciliationJobId ?? "")) return buildKaiError("validation_blocker");
  const jobs = dependencies.reconciliationJobRepository || (await createDefaultReconciliationJobRepository());
  const job = await jobs.read({ organizationId: input.organizationId, reconciliationJobId: input.reconciliationJobId });
  if (!job) return buildKaiError("not_found");
  let measurements = [];
  if (job.job_state === "succeeded") {
    const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
    const basis = await repository.readDerivedMeasurementBasis({ organizationId: input.organizationId, sourceVersionId: job.primary_source_version_id, worksheetKey: null });
    // A version no longer readable (for example superseded) still names what the job committed.
    measurements = basis.ok ? basis.data.recorded.filter((entry) => job.measurement_ids.includes(entry.source_derived_measurement_id)) : [];
  }
  return { ok: true, data: { reconciliationJob: publicReconciliationJob(job), measurements }, error: null };
}

/** Read-only: this organization's most recent reconciliation jobs. */
export async function listCrossSourceReconciliationJobs(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "actorContext"], ["organizationId", "actorContext"], dependencies);
  if (denied) return denied;
  const jobs = dependencies.reconciliationJobRepository || (await createDefaultReconciliationJobRepository());
  return { ok: true, data: { reconciliationJobs: (await jobs.list({ organizationId: input.organizationId })).map(publicReconciliationJob) }, error: null };
}

/**
 * A person's clarification or correction of what a recorded measurement
 * means. It supersedes the current interpretation and states the unchanged
 * measurement under the new one; no count is recalculated or rewritten.
 */
export async function recordDerivedMeasurementInterpretation(input, dependencies = {}) {
  const denied = admitDerivedInput(input, ["organizationId", "measurementId", "interpretation", "actorContext", "now"], ["organizationId", "measurementId", "interpretation", "actorContext", "now"], dependencies);
  if (denied) return denied;
  if (!UUID_RE.test(input.measurementId ?? "") || !isPlainObject(input.interpretation)) return buildKaiError("validation_blocker");
  const repository = dependencies.derivedMeasurementRepository || (await createDefaultDerivedRepository());
  return repositoryResult(await repository.recordDerivedMeasurementInterpretation({
    organizationId: input.organizationId,
    measurementId: input.measurementId,
    interpretationInput: input.interpretation,
    actorUserId: input.actorContext.actorUserId,
    now: input.now,
  }));
}

export const __sourceMeasurementServiceContract = Object.freeze({
  SOURCE_MEASUREMENT_OPERATION,
  SOURCE_MEASUREMENT_ALLOWED_ROLES,
});
