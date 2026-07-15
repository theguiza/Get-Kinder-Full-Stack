import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createIntakeBatch,
  registerIntakeFileMetadata,
} from "../Backend/kai/services/intakeService.js";

const serviceSource = readFileSync("Backend/kai/services/intakeService.js", "utf8");

const validInput = Object.freeze({
  actorContext: Object.freeze({ actorUserId: "actor-1", actorType: "human" }),
  tenantContext: Object.freeze({ organizationId: "org-1" }),
  organizationId: "org-1",
  idempotencyKey: "pass1f-metadata-001",
  checksum: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  storageProvider: "gcs",
  filePolicyStatus: "pending",
});

const enabled = Object.freeze({ env: Object.freeze({ KAI_SPRINT2_ENABLED: "true" }) });

function writeGuardedDependencies() {
  return {
    ...enabled,
    async insertIntakeBatchMetadata() {
      throw new Error("DB write must not be called");
    },
    async insertIntakeFileMetadata() {
      throw new Error("DB write must not be called");
    },
    async query() {
      throw new Error("DB query must not be called");
    },
  };
}

test("metadata write stubs require actor context", async () => {
  const result = await createIntakeBatch({
    tenantContext: { organizationId: "org-1" },
    organizationId: "org-1",
    idempotencyKey: "pass1f-metadata-002",
  }, enabled);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "missing_actor_context");
});

test("metadata write stubs require tenant context", async () => {
  const result = await createIntakeBatch({
    actorContext: { actorUserId: "actor-1" },
    idempotencyKey: "pass1f-metadata-003",
  }, enabled);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.ok(result.blockers.some((blocker) => blocker.blocking_reason === "missing_tenant_context"));
});

test("metadata write stubs require validator pass before contract blocker", async () => {
  const result = await registerIntakeFileMetadata({
    ...validInput,
    checksum: "not-a-checksum",
  }, writeGuardedDependencies());

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].blocking_reason, "invalid_checksum");
});

test("metadata write stubs do not execute DB writes after validators pass", async () => {
  const batchResult = await createIntakeBatch(validInput, writeGuardedDependencies());
  const fileResult = await registerIntakeFileMetadata(validInput, writeGuardedDependencies());

  assert.equal(batchResult.ok, false);
  assert.equal(batchResult.error.code, "not_implemented");
  assert.equal(batchResult.data.metadata_write_enabled, false);
  assert.equal(fileResult.ok, false);
  assert.equal(fileResult.error.code, "not_implemented");
  assert.equal(fileResult.data.metadata_write_enabled, false);
});

test("metadata write contract source contains no write SQL or DB adapter import", () => {
  assert.doesNotMatch(serviceSource, /\b(?:SELECT|INSERT|UPDATE|DELETE|UPSERT|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(serviceSource, /from\s+["'][^"']*(?:kaiDb|db\/pg|pg|kaiQueries|kaiIntakeQueries)\.js["']/);
  assert.doesNotMatch(serviceSource, /\bnew\s+Pool\b|\bpool\.query\b|\bconnect\s*\(/);
});
