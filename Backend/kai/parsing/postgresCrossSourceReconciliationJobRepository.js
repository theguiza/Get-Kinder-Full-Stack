import { createHash, randomUUID } from "node:crypto";
import { withTransaction } from "../db/kaiDb.js";

export { publicReconciliationJob } from "./crossSourceReconciliationJobContract.js";

/**
 * KAI cross-source reconciliation jobs (kai.cross_source_reconciliation_jobs).
 *
 * The HTTP request records a job inside its own admission transaction
 * (`enqueueInTransaction`); the worker claims it, commits the measurements
 * together with `completeSucceededInTransaction` under the claim's fencing
 * token, or records a safe failure. The lifecycle follows the P1 downstream
 * attempts (postgresP1DownstreamRecoveryRepository.js): a PostgreSQL-owned
 * claim with a lease, at most three attempts, a 1 then 5 minute cooldown
 * after a retryable failure, and a lease that expires into a retry (or into
 * `exhausted` on the third attempt). Only `system_error` and an unreadable
 * object are retryable; a refusal about the sources or the mapping fails the
 * job at once. A job holds identities, profile SHAs, the validated mapping
 * (field and value keys, the period) and counters: never a cell value.
 */
export const MAX_RECONCILIATION_ATTEMPTS = 3;
export const RECONCILIATION_RETRY_COOLDOWN_SECONDS = Object.freeze({ 1: 60, 2: 300 });
export const RECONCILIATION_CLAIM_LEASE_SECONDS = 300;
export const RECONCILIATION_LEASE_EXPIRED_ERROR_CODE = "attempt_lease_expired";
export const RECONCILIATION_SWEEP_LIMIT = 25;

const SAFE_CODE_RE = /^[a-z0-9_]{1,64}$/;

const JOB_COLUMNS = `
  reconciliation_job_id::text AS reconciliation_job_id,
  organization_id::text AS organization_id,
  primary_source_version_id::text AS primary_source_version_id,
  reference_source_version_id::text AS reference_source_version_id,
  primary_profile_canonical_sha256,
  reference_profile_canonical_sha256,
  mapping,
  job_state,
  attempt_count,
  claim_token::text AS claim_token,
  claim_expires_at,
  last_attempt_at,
  next_eligible_at,
  last_error_code,
  measurement_ids::text[] AS measurement_ids,
  requested_by::text AS requested_by,
  created_at,
  updated_at,
  completed_at`;

function asIso(value) {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function addSeconds(iso, seconds) {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

function rowToJob(row) {
  if (!row) return null;
  return {
    reconciliation_job_id: row.reconciliation_job_id,
    organization_id: row.organization_id,
    primary_source_version_id: row.primary_source_version_id,
    reference_source_version_id: row.reference_source_version_id,
    primary_profile_canonical_sha256: row.primary_profile_canonical_sha256,
    reference_profile_canonical_sha256: row.reference_profile_canonical_sha256,
    mapping: row.mapping,
    job_state: row.job_state,
    attempt_count: Number(row.attempt_count),
    claim_token: row.claim_token,
    claim_expires_at: asIso(row.claim_expires_at),
    last_attempt_at: asIso(row.last_attempt_at),
    next_eligible_at: asIso(row.next_eligible_at),
    last_error_code: row.last_error_code,
    measurement_ids: row.measurement_ids ?? null,
    requested_by: row.requested_by,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    completed_at: asIso(row.completed_at),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * One request's identity: both versions, the profiles they were admitted
 * under, the mapping and the period. Repeating the request finds this job;
 * a change to either source or to the period is another request.
 */
export function reconciliationRequestFingerprint({ primarySourceVersionId, referenceSourceVersionId, primaryProfileCanonicalSha256, referenceProfileCanonicalSha256, mapping }) {
  return createHash("sha256").update(canonicalJson({
    contract: "kai_cross_source_reconciliation_request_v1",
    primarySourceVersionId,
    referenceSourceVersionId,
    primaryProfileCanonicalSha256,
    referenceProfileCanonicalSha256,
    mapping,
  })).digest("hex");
}

async function selectJobForUpdate(tx, { organizationId, reconciliationJobId, skipLocked = false }) {
  const { rows } = await tx.query(
    `SELECT ${JOB_COLUMNS} FROM kai.cross_source_reconciliation_jobs
      WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid
      FOR UPDATE${skipLocked ? " SKIP LOCKED" : ""}`,
    [organizationId, reconciliationJobId],
  );
  return rowToJob(rows[0]);
}

export function createPostgresCrossSourceReconciliationJobRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Inside the request's admission transaction: the job for this exact
     * request, created queued or found. A repeated request that passed
     * admission again re-queues a settled-unsuccessful job (failed, or
     * exhausted on infrastructure failures) with a fresh attempt budget: the
     * person's explicit retry, under the same job identity. A queued,
     * running, retrying or succeeded job is returned as it is.
     */
    async enqueueInTransaction(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, primaryProfileCanonicalSha256, referenceProfileCanonicalSha256, mapping, requestedBy, now }) {
      const requestFingerprint = reconciliationRequestFingerprint({
        primarySourceVersionId, referenceSourceVersionId, primaryProfileCanonicalSha256, referenceProfileCanonicalSha256, mapping,
      });
      const inserted = await tx.query(
        `INSERT INTO kai.cross_source_reconciliation_jobs (
           organization_id, primary_source_version_id, reference_source_version_id,
           primary_profile_canonical_sha256, reference_profile_canonical_sha256,
           request_fingerprint, mapping, job_state, attempt_count, requested_by, created_at, updated_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, 'queued', 0, $8::uuid, $9::timestamptz, $9::timestamptz)
         ON CONFLICT (organization_id, request_fingerprint) DO NOTHING
         RETURNING ${JOB_COLUMNS}`,
        [organizationId, primarySourceVersionId, referenceSourceVersionId, primaryProfileCanonicalSha256, referenceProfileCanonicalSha256,
          requestFingerprint, JSON.stringify(mapping), requestedBy, now],
      );
      if (inserted.rows[0]) return { job: rowToJob(inserted.rows[0]), fresh: true, requeued: false };
      const { rows } = await tx.query(
        `SELECT ${JOB_COLUMNS} FROM kai.cross_source_reconciliation_jobs
          WHERE organization_id = $1::uuid AND request_fingerprint = $2 FOR UPDATE`,
        [organizationId, requestFingerprint],
      );
      const existing = rowToJob(rows[0]);
      if (!existing) throw new Error("cross_source_reconciliation_job_not_found_after_conflict");
      if (existing.job_state !== "exhausted" && existing.job_state !== "failed") return { job: existing, fresh: false, requeued: false };
      const requeued = await tx.query(
        `UPDATE kai.cross_source_reconciliation_jobs
            SET job_state = 'queued', attempt_count = 0, claim_token = NULL, claim_expires_at = NULL, last_attempt_at = NULL,
                next_eligible_at = NULL, last_error_code = NULL, completed_at = NULL, updated_at = $3::timestamptz
          WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid AND job_state IN ('exhausted', 'failed')
          RETURNING ${JOB_COLUMNS}`,
        [organizationId, existing.reconciliation_job_id, now],
      );
      return { job: rowToJob(requeued.rows[0]) ?? existing, fresh: false, requeued: Boolean(requeued.rows[0]) };
    },

    /**
     * Claims one job for an attempt, or says why not: `claimed` (with the
     * token), `settled`, `exhausted`, `busy` (claimed elsewhere, or locked by
     * a concurrent claim), `deferred` (cooling down) or `not_found`. An
     * expired lease is the attempt's timeout: it is counted, and a third
     * expired attempt exhausts the job.
     */
    async claim({ organizationId, reconciliationJobId, now }) {
      return runInTransaction(async (tx) => {
        const job = await selectJobForUpdate(tx, { organizationId, reconciliationJobId, skipLocked: true });
        if (!job) {
          const { rows } = await tx.query(
            "SELECT 1 FROM kai.cross_source_reconciliation_jobs WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid",
            [organizationId, reconciliationJobId],
          );
          return { decision: rows.length > 0 ? "busy" : "not_found", job: null };
        }
        if (job.job_state === "succeeded" || job.job_state === "failed") return { decision: "settled", job };
        if (job.job_state === "exhausted") return { decision: "exhausted", job };
        if (job.job_state === "in_progress" && Date.parse(job.claim_expires_at) > Date.parse(now)) return { decision: "busy", job };
        if (job.job_state === "retry_scheduled" && Date.parse(job.next_eligible_at) > Date.parse(now)) return { decision: "deferred", job };
        if (job.job_state === "in_progress" && job.attempt_count >= MAX_RECONCILIATION_ATTEMPTS) {
          const { rows } = await tx.query(
            `UPDATE kai.cross_source_reconciliation_jobs
                SET job_state = 'exhausted', claim_token = NULL, claim_expires_at = NULL, next_eligible_at = NULL,
                    last_error_code = $3, completed_at = $4::timestamptz, updated_at = $4::timestamptz
              WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid AND job_state = 'in_progress'
              RETURNING ${JOB_COLUMNS}`,
            [organizationId, reconciliationJobId, RECONCILIATION_LEASE_EXPIRED_ERROR_CODE, now],
          );
          return { decision: "exhausted", job: rowToJob(rows[0]) };
        }
        const claimToken = randomUUID();
        const { rows } = await tx.query(
          `UPDATE kai.cross_source_reconciliation_jobs
              SET job_state = 'in_progress', attempt_count = attempt_count + 1, claim_token = $3::uuid,
                  claim_expires_at = $4::timestamptz, last_attempt_at = $5::timestamptz, next_eligible_at = NULL,
                  last_error_code = CASE WHEN job_state = 'in_progress' THEN $6 ELSE last_error_code END,
                  updated_at = $5::timestamptz
            WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid
            RETURNING ${JOB_COLUMNS}`,
          [organizationId, reconciliationJobId, claimToken, addSeconds(now, RECONCILIATION_CLAIM_LEASE_SECONDS), now, RECONCILIATION_LEASE_EXPIRED_ERROR_CODE],
        );
        return { decision: "claimed", job: rowToJob(rows[0]) };
      });
    },

    /** Inside the worker's commit transaction: the job, only while this claim still holds it. */
    async fenceInTransaction(tx, { organizationId, reconciliationJobId, claimToken, now }) {
      const job = await selectJobForUpdate(tx, { organizationId, reconciliationJobId });
      if (!job || job.job_state !== "in_progress" || job.claim_token !== claimToken || Date.parse(job.claim_expires_at) <= Date.parse(now)) return null;
      return job;
    },

    async completeSucceededInTransaction(tx, { organizationId, reconciliationJobId, claimToken, measurementIds, now }) {
      const { rows } = await tx.query(
        `UPDATE kai.cross_source_reconciliation_jobs
            SET job_state = 'succeeded', claim_token = NULL, claim_expires_at = NULL, next_eligible_at = NULL,
                last_error_code = NULL, measurement_ids = $4::uuid[], completed_at = $5::timestamptz, updated_at = $5::timestamptz
          WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid AND claim_token = $3::uuid AND job_state = 'in_progress'
          RETURNING ${JOB_COLUMNS}`,
        [organizationId, reconciliationJobId, claimToken, measurementIds, now],
      );
      if (!rows[0]) throw new Error("cross_source_reconciliation_claim_lost");
      return rowToJob(rows[0]);
    },

    /** Records a failed attempt under its claim; a lost claim records nothing. */
    async completeFailed({ organizationId, reconciliationJobId, claimToken, errorCode, retryable, now }) {
      const code = SAFE_CODE_RE.test(errorCode ?? "") ? errorCode : "unclassified_reconciliation_failure";
      return runInTransaction(async (tx) => {
        const job = await selectJobForUpdate(tx, { organizationId, reconciliationJobId });
        if (!job || job.job_state !== "in_progress" || job.claim_token !== claimToken) return { acknowledged: false, job };
        const retry = retryable && job.attempt_count < MAX_RECONCILIATION_ATTEMPTS;
        const state = retry ? "retry_scheduled" : retryable ? "exhausted" : "failed";
        const { rows } = await tx.query(
          `UPDATE kai.cross_source_reconciliation_jobs
              SET job_state = $3, claim_token = NULL, claim_expires_at = NULL,
                  next_eligible_at = $4::timestamptz, last_error_code = $5,
                  completed_at = $6::timestamptz, updated_at = $7::timestamptz
            WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid AND claim_token = $8::uuid
            RETURNING ${JOB_COLUMNS}`,
          [organizationId, reconciliationJobId, state,
            retry ? addSeconds(now, RECONCILIATION_RETRY_COOLDOWN_SECONDS[job.attempt_count]) : null,
            code, retry ? null : now, now, claimToken],
        );
        return { acknowledged: true, job: rowToJob(rows[0]) };
      });
    },

    async read({ organizationId, reconciliationJobId }) {
      return runInTransaction(async (tx) => {
        const { rows } = await tx.query(
          `SELECT ${JOB_COLUMNS} FROM kai.cross_source_reconciliation_jobs
            WHERE organization_id = $1::uuid AND reconciliation_job_id = $2::uuid`,
          [organizationId, reconciliationJobId],
        );
        return rowToJob(rows[0]);
      });
    },

    async list({ organizationId, limit = 20 }) {
      return runInTransaction(async (tx) => {
        const { rows } = await tx.query(
          `SELECT ${JOB_COLUMNS} FROM kai.cross_source_reconciliation_jobs
            WHERE organization_id = $1::uuid ORDER BY created_at DESC, reconciliation_job_id LIMIT $2`,
          [organizationId, limit],
        );
        return rows.map(rowToJob);
      });
    },

    /** The sweep: jobs due an attempt, across organizations, oldest first and bounded. */
    async listDue({ now, limit = RECONCILIATION_SWEEP_LIMIT }) {
      return runInTransaction(async (tx) => {
        const { rows } = await tx.query(
          `SELECT organization_id::text AS organization_id, reconciliation_job_id::text AS reconciliation_job_id
             FROM kai.cross_source_reconciliation_jobs
            WHERE job_state = 'queued'
               OR (job_state = 'retry_scheduled' AND next_eligible_at <= $1::timestamptz)
               OR (job_state = 'in_progress' AND claim_expires_at <= $1::timestamptz)
            ORDER BY created_at, reconciliation_job_id
            LIMIT $2`,
          [now, limit],
        );
        return rows;
      });
    },
  });
}
