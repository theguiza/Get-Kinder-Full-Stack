import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { runValidators } from "../Backend/kai/validators/runValidators.js";
import { blockerResult, passResult, warningResult } from "../Backend/kai/validators/types.js";
import {
  actor_context_required,
  file_policy_status_supported,
  intakeValidatorGroups,
  organization_id_required,
  parser_raw_file_work_blocked_in_p0,
  raw_upload_blocked_in_p0,
  signed_url_blocked_in_p0,
  source_promotion_blocked_in_p0,
  storage_provider_supported,
  tenant_context_required,
  validateReviewQueueType,
  VALID_REVIEW_QUEUE_TYPES,
} from "../Backend/kai/validators/intakeValidators.js";

const validatorsSource = readFileSync("Backend/kai/validators/intakeValidators.js", "utf8");
const runnerSource = readFileSync("Backend/kai/validators/runValidators.js", "utf8");

test("review queue uses DDL-valid queue_type values only", () => {
  assert.equal(validateReviewQueueType({ queueType: "intake_file_review" }).severity, "pass");
  assert.equal(validateReviewQueueType({ queueType: "client_followup" }).severity, "pass");
  assert.equal(validateReviewQueueType({ queueType: "file_policy_blocked" }).severity, "blocker");
  assert.equal(validateReviewQueueType({ queueType: "source_candidate_review_stub" }).severity, "blocker");
  assert.equal(VALID_REVIEW_QUEUE_TYPES.includes("file_policy_blocked"), false);
});

test("intake validators are pure and deterministic", () => {
  const context = Object.freeze({
    actorContext: Object.freeze({ actorUserId: "actor-1" }),
    organizationId: "org-1",
    storageProvider: "gcs",
    filePolicyStatus: "pending",
  });

  const first = intakeValidatorGroups.intake_preflight.map((validator) => validator(context));
  const second = intakeValidatorGroups.intake_preflight.map((validator) => validator(context));

  assert.deepEqual(first, second);
  assert.equal(context.organizationId, "org-1");
});

test("validator runner collects blockers and warnings", async () => {
  const result = await runValidators(
    [
      () => passResult("VAL-TEST-001"),
      () => warningResult("VAL-TEST-002", "warning"),
      () => blockerResult("VAL-TEST-003", "blocker"),
    ],
    {},
    { group_key: "test_group" },
  );

  assert.equal(result.ok, false);
  assert.equal(result.group_key, "test_group");
  assert.equal(result.results.length, 3);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.blockers.length, 1);
});

test("validator runner fails closed on thrown validator errors", async () => {
  const result = await runValidators([
    function throwingValidator() {
      throw new TypeError("hidden details");
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].validator_key, "VAL-RUN-001");
  assert.equal(result.blockers[0].blocking_reason, "validator_exception");
  assert.equal(result.blockers[0].evidence.error_name, "TypeError");
  assert.equal(JSON.stringify(result).includes("hidden details"), false);
});

test("actor and tenant precondition validators block missing required context", () => {
  assert.equal(actor_context_required({ organizationId: "org-1" }).severity, "blocker");
  assert.equal(actor_context_required({ actorContext: { actorUserId: "actor-1" } }).severity, "pass");

  assert.equal(tenant_context_required({ actorContext: { actorUserId: "actor-1" } }).severity, "blocker");
  assert.equal(organization_id_required({ actorContext: { actorUserId: "actor-1" } }).severity, "blocker");
  assert.equal(organization_id_required({ organizationId: "org-1" }).severity, "pass");
});

test("DDL-confirmed intake policy vocabulary is accepted and unsupported values block", () => {
  for (const filePolicyStatus of ["pending", "passed", "blocked", "failed", "skipped"]) {
    assert.equal(file_policy_status_supported({ filePolicyStatus }).severity, "pass");
  }

  assert.equal(file_policy_status_supported({ filePolicyStatus: "stub" }).severity, "blocker");
  assert.equal(storage_provider_supported({ storageProvider: "gcs" }).severity, "pass");
  assert.equal(storage_provider_supported({ storageProvider: "local_dev" }).severity, "pass");
  assert.equal(storage_provider_supported({ storageProvider: "google_cloud_storage" }).severity, "blocker");
});

test("P0-blocked behavior validators block raw upload, signed URLs, parser raw-file work, and source promotion", () => {
  assert.equal(raw_upload_blocked_in_p0({ rawUploadRequested: true }).blocking_reason, "raw_upload_blocked_in_p0");
  assert.equal(signed_url_blocked_in_p0({ signedUploadUrlRequested: true }).blocking_reason, "signed_url_blocked_in_p0");
  assert.equal(signed_url_blocked_in_p0({ signedReadUrlRequested: true }).blocking_reason, "signed_url_blocked_in_p0");
  assert.equal(
    parser_raw_file_work_blocked_in_p0({ parserRawFileWorkRequested: true }).blocking_reason,
    "parser_raw_file_work_blocked_in_p0",
  );
  assert.equal(source_promotion_blocked_in_p0({ sourcePromotionRequested: true }).blocking_reason, "source_promotion_blocked_in_p0");
});

test("Pass 1D validators and runner stay pure and do not import DB wiring", () => {
  for (const source of [validatorsSource, runnerSource]) {
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
    assert.doesNotMatch(source, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
    assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  }
});
