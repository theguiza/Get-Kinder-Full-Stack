/**
 * Pure: the shape of a cross-source reconciliation job a caller outside the
 * worker may see (postgresCrossSourceReconciliationJobRepository.js holds
 * the job itself). No claim token and no requester leave the worker.
 */
export function publicReconciliationJob(job) {
  if (!job) return null;
  return {
    reconciliation_job_id: job.reconciliation_job_id,
    primary_source_version_id: job.primary_source_version_id,
    reference_source_version_id: job.reference_source_version_id,
    job_state: job.job_state,
    attempt_count: job.attempt_count,
    next_eligible_at: job.next_eligible_at,
    error_code: job.last_error_code,
    measurement_ids: job.measurement_ids,
    created_at: job.created_at,
    completed_at: job.completed_at,
  };
}

