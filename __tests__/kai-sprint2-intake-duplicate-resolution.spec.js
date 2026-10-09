import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  __testables as intakeServiceTestables,
  reserveIntakeFileMetadata,
} from "../Backend/kai/services/kaiIntakeService.js";
import {
  classifyExistingIntakeFileState,
  classifyIntakeFileDuplicate,
} from "../Backend/kai/services/kaiIntakeDuplicateResolution.js";
import { duplicate_checksum_blocked } from "../Backend/kai/validators/idempotencyValidators.js";
import {
  buildSuccessfulMutationAuditEventRecord,
} from "../Backend/kai/db/kaiAuditQueries.js";
import {
  insertIntakeFileNewVersionMetadata,
  listIntakeFileChecksumMatches,
  lockIntakeFileChecksumOriginal,
} from "../Backend/kai/db/kaiIntakeQueries.js";
import { __parserProfileWorkerTestables } from "../Backend/kai/parsing/parserProfileWorkerOrchestration.js";
import router, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  declaredMimeTypeForFile,
  duplicateResolutionFromResult,
  duplicateResolutionView,
  uploadUrlResultRequiresConfirmOnly,
} from "../frontend/kaiWebIntakeLogic.js";

// Synthetic identifiers and bytes only: no client data, database, or storage.
const ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const OTHER_ORG = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ENG = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const OTHER_ENG = "3e426ea1-2be3-4e48-b80f-9783ddbacda0";
const BATCH_A = "8e426ea1-2be3-4e48-b80f-9783ddbacd0a";
const BATCH_B = "8e426ea1-2be3-4e48-b80f-9783ddbacd0b";
const BATCH_OTHER_ENG = "8e426ea1-2be3-4e48-b80f-9783ddbacd0c";
const BATCH_OTHER_ORG = "8e426ea1-2be3-4e48-b80f-9783ddbacd0d";
const NOW = "2026-10-09T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const RESERVATION_ROUTE = "/admin/batches/:intakeBatchId/file-reservations";

const GK_OPERATOR = Object.freeze({
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [{ organization_id: ORG, role_name: "gk_operator", membership_status: "active" }],
});
const GK_REVIEWER = Object.freeze({
  actorType: "human",
  actorUserId: "6fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_reviewer"],
  organizationMemberships: [{ organization_id: ORG, role_name: "gk_reviewer", membership_status: "active" }],
});

const FORMATS = Object.freeze([
  {
    name: "CSV",
    extension: ".csv",
    mime: "text/csv",
    bytes: Buffer.from("name,value\nkindness,1\n", "utf8"),
    modified: Buffer.from("name,value\nkindness,2\n", "utf8"),
  },
  {
    name: "XLSX",
    extension: ".xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01]),
    modified: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0x02]),
  },
  {
    name: "MD",
    extension: ".md",
    mime: "text/markdown",
    bytes: Buffer.from("# Program notes\n\nKindness outcomes.\n", "utf8"),
    modified: Buffer.from("# Program notes\n\nKindness outcomes, revised.\n", "utf8"),
  },
  {
    name: "TXT",
    extension: ".txt",
    mime: "text/plain",
    bytes: Buffer.from("Program notes: kindness outcomes.\n", "utf8"),
    modified: Buffer.from("Program notes: kindness outcomes, revised.\n", "utf8"),
  },
  {
    name: "PDF",
    extension: ".pdf",
    mime: "application/pdf",
    bytes: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1"),
    modified: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Lang (en) >>\nendobj\ntrailer\n<<>>\n%%EOF\n", "latin1"),
  },
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * In-memory stand-in for the kai.intake_files behaviors this workflow relies
 * on: organization-scoped lookups, the declared-checksum unique index
 * (organization_id, checksum) WHERE force_new_version = false (23505 on
 * conflict), serialized transactions (the FOR UPDATE lock on the original
 * row) with rollback, and required/blocked audit writes. Every lookup yields
 * to the event loop so concurrent requests genuinely interleave.
 */
function createSyntheticIntakeStore() {
  const batches = new Map([
    [BATCH_A, { intake_batch_id: BATCH_A, organization_id: ORG, engagement_id: ENG }],
    [BATCH_B, { intake_batch_id: BATCH_B, organization_id: ORG, engagement_id: ENG }],
    [BATCH_OTHER_ENG, { intake_batch_id: BATCH_OTHER_ENG, organization_id: ORG, engagement_id: OTHER_ENG }],
    [BATCH_OTHER_ORG, { intake_batch_id: BATCH_OTHER_ORG, organization_id: OTHER_ORG, engagement_id: ENG }],
  ]);
  const rows = [];
  const successAudits = [];
  const blockedAudits = [];
  const calls = [];
  const transactions = { started: 0, rolledBack: 0 };
  let sequence = 0;
  let transactionTail = Promise.resolve();

  function persist(file, { force, original = null, supersedes = null }) {
    sequence += 1;
    const row = {
      intake_file_id: file.intakeFileId,
      intake_batch_id: file.intakeBatchId,
      organization_id: file.organizationId,
      engagement_id: file.engagementId,
      original_filename: file.originalFilename,
      safe_filename: file.safeFilename,
      storage_uri: file.storageUri,
      storage_provider: file.storageProvider,
      storage_object_key: file.storageObjectKey,
      mime_type: file.mimeType,
      file_extension: file.fileExtension,
      file_size_bytes: file.fileSizeBytes,
      checksum: file.checksum,
      hash_algorithm: file.hashAlgorithm,
      upload_state: "reserved",
      upload_expires_at: new Date(Date.parse(NOW) + DAY_MS).toISOString(),
      file_policy_status: file.filePolicyStatus,
      malware_scan_status: file.malwareScanStatus,
      processing_status: "quarantined",
      parse_status: "quarantined",
      review_status: "proposed",
      force_new_version: force,
      original_intake_file_id: original,
      supersedes_intake_file_id: supersedes,
      file_metadata: file.fileMetadata,
      created_at: new Date(Date.parse(NOW) + sequence * 1000).toISOString(),
    };
    rows.push(row);
    return { ...row };
  }

  const unforcedOriginal = (organizationId, checksum) => rows.find(
    (row) => row.organization_id === organizationId && row.checksum === checksum && row.force_new_version === false,
  );

  const dependencies = {
    env: { KAI_SPRINT2_ENABLED: "true" },
    now: () => Date.parse(NOW),
    async getIntakeBatchTenantState(intakeBatchId, organizationId) {
      calls.push("getIntakeBatchTenantState");
      const batch = batches.get(intakeBatchId);
      return batch && batch.organization_id === organizationId ? { ...batch } : null;
    },
    async findIntakeFileReservationByIdempotencyKey({ organizationId, intakeBatchId, idempotencyKey, engagementId }) {
      calls.push("findIntakeFileReservationByIdempotencyKey");
      await tick();
      const row = rows.find((candidate) => (
        candidate.organization_id === organizationId
        && candidate.intake_batch_id === intakeBatchId
        && candidate.file_metadata?.idempotency_key === idempotencyKey
        && (!engagementId || candidate.engagement_id === engagementId)
      ));
      return row ? { ...row } : null;
    },
    async findIntakeFileReservationByChecksum({ organizationId, checksum }) {
      calls.push("findIntakeFileReservationByChecksum");
      await tick();
      const row = unforcedOriginal(organizationId, checksum);
      return row ? { ...row } : null;
    },
    async listIntakeFileChecksumMatches({ organizationId, checksum }) {
      calls.push("listIntakeFileChecksumMatches");
      await tick();
      return rows
        .filter((row) => row.organization_id === organizationId && row.checksum === checksum)
        .map((row) => ({ ...row }));
    },
    async lockIntakeFileChecksumOriginal({ organizationId, checksum }) {
      calls.push("lockIntakeFileChecksumOriginal");
      await tick();
      const row = unforcedOriginal(organizationId, checksum);
      return row ? { intake_file_id: row.intake_file_id } : null;
    },
    async insertIntakeFileMetadata(file) {
      calls.push("insertIntakeFileMetadata");
      await tick();
      if (unforcedOriginal(file.organizationId, file.checksum)) {
        const error = new Error("duplicate key value violates unique constraint");
        error.code = "23505";
        error.constraint = "ux_intake_files_gate_a_org_declared_checksum";
        throw error;
      }
      return persist(file, { force: false });
    },
    async insertIntakeFileNewVersionMetadata(file) {
      calls.push("insertIntakeFileNewVersionMetadata");
      await tick();
      return persist(file, {
        force: true,
        original: file.originalIntakeFileId,
        supersedes: file.supersedesIntakeFileId,
      });
    },
    async insertRequiredSuccessfulAuditEvent(metadata) {
      calls.push("insertRequiredSuccessfulAuditEvent");
      successAudits.push(buildSuccessfulMutationAuditEventRecord(metadata, "other"));
      return { ok: true, auditEventId: null };
    },
    async insertBlockedAttemptAuditEvent(record) {
      calls.push("insertBlockedAttemptAuditEvent");
      blockedAudits.push(record);
      return { ok: true, auditEventId: null };
    },
    async runInTransaction(callback) {
      calls.push("runInTransaction");
      transactions.started += 1;
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const rowCount = rows.length;
      const auditCount = successAudits.length;
      try {
        return await callback({ synthetic_transaction: true });
      } catch (error) {
        transactions.rolledBack += 1;
        rows.length = rowCount;
        successAudits.length = auditCount;
        throw error;
      } finally {
        release();
      }
    },
  };

  return {
    rows,
    successAudits,
    blockedAudits,
    calls,
    transactions,
    dependencies,
    row(intakeFileId) {
      return rows.find((candidate) => candidate.intake_file_id === intakeFileId);
    },
    setRow(intakeFileId, patch) {
      Object.assign(rows.find((candidate) => candidate.intake_file_id === intakeFileId), patch);
    },
  };
}

function reserve(store, {
  format,
  bytes = format.bytes,
  batchId = BATCH_A,
  engagementId = ENG,
  organizationId = ORG,
  filename = `program-results${format.extension}`,
  extension = format.extension,
  mime = format.mime,
  sizeBytes = bytes.length,
  checksum = sha256(bytes),
  key,
  actor = GK_OPERATOR,
  extra = {},
}) {
  return reserveIntakeFileMetadata({
    actorContext: actor,
    organizationId,
    engagementId,
    intakeBatchId: batchId,
    payload: {
      idempotency_key: key,
      original_filename: filename,
      mime_type: mime,
      file_extension: extension,
      file_size_bytes: sizeBytes,
      checksum,
      hash_algorithm: "sha256",
      ...extra,
    },
  }, store.dependencies);
}

function forced(duplicateOfIntakeFileId) {
  return { force_new_version: true, duplicate_of_intake_file_id: duplicateOfIntakeFileId };
}

function confirmPassed(store, intakeFileId) {
  store.setRow(intakeFileId, { upload_state: "confirmed", file_policy_status: "passed" });
}

function assertDuplicateBlocker(result, { status, actions, restriction = null }) {
  assert.equal(result.ok, false);
  assert.equal(result.error.status, 422);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].validator_key, "VAL-IDEMP-006");
  assert.equal(result.blockers[0].blocking_reason, "duplicate_checksum");
  const resolution = result.data.duplicate_resolution;
  assert.equal(resolution.contract, "kai_intake_duplicate_resolution_v1");
  assert.equal(resolution.duplicate_status, status);
  assert.deepEqual(resolution.available_actions, actions);
  assert.equal(resolution.restriction_code, restriction);
  return resolution;
}

function assertNoUnsafeResolutionFields(resolution, checksum) {
  const serialized = JSON.stringify(resolution);
  assert.equal(serialized.includes(checksum), false, "the resolution never echoes a checksum");
  for (const forbidden of ["storage_object_key", "storage_uri", "storage_bucket", "original_filename", "file_metadata", "upload_url", "reservation://"]) {
    assert.equal(serialized.includes(forbidden), false, `the resolution never carries ${forbidden}`);
  }
}

function syntheticObjectVersionAdapter(objectVersionId, bytes) {
  return {
    async openObjectVersionReadStream({ objectVersionId: requested }) {
      assert.equal(requested, objectVersionId);
      return {
        ok: true,
        data: {
          object_version_id: objectVersionId,
          size_bytes: bytes.length,
          byte_source: {
            async *[Symbol.asyncIterator]() {
              yield bytes;
            },
            async close() {},
          },
        },
      };
    },
  };
}

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function reserveThroughRoute(store, { format, bytes = format.bytes, batchId, key, extra = {} }) {
  const layer = router.stack.find((candidate) => candidate.route?.path === RESERVATION_ROUTE && candidate.route?.methods?.post);
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async reserveIntakeFileMetadata(input) {
      return reserveIntakeFileMetadata({ ...input, actorContext: GK_OPERATOR }, store.dependencies);
    },
  });
  try {
    const res = createResponse();
    await layer.route.stack[0].handle({
      is() {
        return false;
      },
      params: { intakeBatchId: batchId },
      user: { id: 46 },
      body: {
        organization_id: ORG,
        engagement_id: ENG,
        idempotency_key: key,
        original_filename: `program-results${format.extension}`,
        mime_type: format.mime,
        file_extension: format.extension,
        file_size_bytes: bytes.length,
        checksum: sha256(bytes),
        hash_algorithm: "sha256",
        ...extra,
      },
    }, res);
    return res;
  } finally {
    restore();
  }
}

for (const format of FORMATS) {
  test(`${format.name}: one shared duplicate workflow covers first upload, replay, same/other batch, modified content, explicit new version, security re-entry, and verified bytes`, async () => {
    const store = createSyntheticIntakeStore();
    const checksum = sha256(format.bytes);
    const tag = format.name.toLowerCase();

    // 1. A valid first upload follows the existing reservation flow.
    const first = await reserve(store, { format, key: `kai-dup-${tag}-first` });
    assert.equal(first.ok, true);
    assert.deepEqual(first.warnings, []);
    assert.equal(store.rows.length, 1);
    const original = store.row(first.data.intake_file_id);
    assert.equal(original.force_new_version, false);
    assert.equal(original.upload_state, "reserved");
    assert.equal(original.file_policy_status, "pending");
    assert.equal(original.original_intake_file_id, null);
    assert.equal(original.file_metadata.duplicate_resolution, undefined);

    // 2. An identical replay returns the earlier result and creates nothing.
    const replay = await reserve(store, { format, key: `kai-dup-${tag}-first` });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.intake_file_id, first.data.intake_file_id);
    assert.equal(store.rows.length, 1);
    // A conflicting request on the same identity creates nothing either.
    const conflicting = await reserve(store, {
      format,
      key: `kai-dup-${tag}-first`,
      filename: `renamed${format.extension}`,
    });
    assert.equal(conflicting.ok, false);
    assert.equal(conflicting.error.code, "duplicate_conflict");
    assert.equal(store.rows.length, 1);

    // 3. The same bytes chosen again in the same batch: VAL-IDEMP-006 with a
    // resolution matching the existing record's real lifecycle state.
    const whileIncomplete = await reserve(store, { format, key: `kai-dup-${tag}-same-batch-1` });
    const incompleteResolution = assertDuplicateBlocker(whileIncomplete, {
      status: "duplicate_in_batch",
      actions: ["continue_upload", "cancel"],
      restriction: "upload_in_progress",
    });
    assert.equal(incompleteResolution.existing_file.intake_file_id, first.data.intake_file_id);
    assert.equal(incompleteResolution.existing_file.upload_state, "reserved");
    assertNoUnsafeResolutionFields(incompleteResolution, checksum);

    confirmPassed(store, first.data.intake_file_id);
    const whileConfirmed = await reserve(store, { format, key: `kai-dup-${tag}-same-batch-2` });
    const confirmedResolution = assertDuplicateBlocker(whileConfirmed, {
      status: "duplicate_in_batch",
      actions: ["use_existing_file", "upload_new_intake_version", "cancel"],
    });
    assert.deepEqual(confirmedResolution.existing_file, {
      intake_file_id: first.data.intake_file_id,
      intake_batch_id: BATCH_A,
      engagement_id: ENG,
      safe_filename: original.safe_filename,
      file_extension: format.extension,
      upload_state: "confirmed",
      file_policy_status: "passed",
      processing_status: "quarantined",
      existing_state: "confirmed",
    });
    assert.equal(confirmedResolution.same_filename, true);
    assert.equal(store.rows.length, 1);

    // 4. The same bytes in another batch of the same engagement: a duplicate
    // candidate, executable only as an explicit linked intake record.
    const otherBatchKey = `kai-dup-${tag}-other-batch`;
    const otherBatch = await reserve(store, { format, batchId: BATCH_B, key: otherBatchKey });
    assertDuplicateBlocker(otherBatch, {
      status: "duplicate_in_other_batch",
      actions: ["upload_new_intake_version", "cancel"],
    });
    const candidate = await reserve(store, {
      format,
      batchId: BATCH_B,
      key: `${otherBatchKey}-linked`,
      extra: forced(first.data.intake_file_id),
    });
    assert.equal(candidate.ok, true);
    assert.deepEqual(candidate.warnings.map((warning) => warning.code), ["duplicate_candidate_recorded"]);
    const candidateRow = store.row(candidate.data.intake_file_id);
    assert.equal(candidateRow.intake_batch_id, BATCH_B);
    assert.equal(candidateRow.force_new_version, true);
    assert.equal(candidateRow.original_intake_file_id, first.data.intake_file_id);
    assert.equal(candidateRow.supersedes_intake_file_id, null);
    assert.deepEqual(candidateRow.file_metadata.duplicate_resolution, {
      force_new_version: true,
      duplicate_of_intake_file_id: first.data.intake_file_id,
      duplicate_status: "duplicate_in_other_batch",
    });

    // 5. A genuinely modified file with the same filename is not a duplicate.
    const modified = await reserve(store, { format, bytes: format.modified, key: `kai-dup-${tag}-modified` });
    assert.equal(modified.ok, true);
    assert.deepEqual(modified.warnings, []);
    assert.equal(store.row(modified.data.intake_file_id).force_new_version, false);
    assert.equal(store.row(modified.data.intake_file_id).safe_filename, original.safe_filename);

    // 6. An explicit new intake version in the same batch succeeds only when
    // authorized, against the file actually presented.
    const deniedActor = await reserve(store, {
      format,
      key: `kai-dup-${tag}-reviewer`,
      actor: GK_REVIEWER,
      extra: forced(first.data.intake_file_id),
    });
    assert.equal(deniedActor.ok, false);
    assert.equal(deniedActor.error.status, 403);
    const stale = await reserve(store, {
      format,
      key: `kai-dup-${tag}-stale`,
      extra: forced(candidate.data.intake_file_id),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict_current_state_changed");
    assert.equal(stale.data.duplicate_resolution.existing_file.intake_file_id, first.data.intake_file_id);
    const rowsBeforeVersion = store.rows.length;
    const newVersion = await reserve(store, {
      format,
      key: `kai-dup-${tag}-new-version`,
      extra: forced(first.data.intake_file_id),
    });
    assert.equal(newVersion.ok, true);
    assert.deepEqual(newVersion.warnings.map((warning) => warning.code), ["duplicate_in_batch"]);
    assert.equal(store.rows.length, rowsBeforeVersion + 1);
    const versionRow = store.row(newVersion.data.intake_file_id);
    assert.equal(versionRow.supersedes_intake_file_id, first.data.intake_file_id);
    assert.equal(versionRow.original_intake_file_id, first.data.intake_file_id);
    // The superseded record keeps its own state and history.
    assert.equal(store.row(first.data.intake_file_id).upload_state, "confirmed");
    assert.equal(store.row(first.data.intake_file_id).file_policy_status, "passed");
    const versionAudit = store.successAudits.at(-1);
    assert.equal(versionAudit.action, "reserve_intake_file_new_version");
    assert.equal(versionAudit.reason_code, "duplicate_in_batch");
    assert.equal(versionAudit.metadata.duplicate_of_intake_file_id, first.data.intake_file_id);
    assert.equal(versionAudit.metadata.supersedes_intake_file_id, first.data.intake_file_id);
    assert.equal(versionAudit.metadata.original_intake_file_id, first.data.intake_file_id);
    assert.equal(versionAudit.metadata.metadata_only, true);

    // 7. Every new record re-enters the full file-security path: it starts
    // reserved/pending/quarantined (the only state the post-confirm security
    // assessment acts on), and reservation-time type checks still run first.
    for (const row of [candidateRow, versionRow]) {
      assert.equal(row.upload_state, "reserved");
      assert.equal(row.file_policy_status, "pending");
      assert.equal(row.malware_scan_status, "not_configured");
      assert.equal(row.processing_status, "quarantined");
      assert.equal(row.parse_status, "quarantined");
      assert.equal(row.review_status, "proposed");
      assert.equal(row.mime_type, format.mime);
      assert.equal(row.file_extension, format.extension);
    }
    const transactionsBefore = store.transactions.started;
    const mismatchedMime = await reserve(store, {
      format,
      key: `kai-dup-${tag}-mime-mismatch`,
      mime: format.extension === ".pdf" ? "text/plain" : "application/pdf",
      extra: forced(first.data.intake_file_id),
    });
    assert.equal(mismatchedMime.ok, false);
    assert.equal(mismatchedMime.blockers[0].validator_key, "VAL-STO-005");
    assert.equal(store.transactions.started, transactionsBefore);

    let assessedFacts = null;
    await intakeServiceTestables.applyConfirmedSecurityAssessment({
      organizationId: ORG,
      intakeFileId: versionRow.intake_file_id,
      objectVersionId: "ov_0123456789abcdef0123456789abcdef",
      verifiedChecksum: checksum,
      verifiedSizeBytes: format.bytes.length,
    }, {
      async getScopedIntakeFileSecurityAssessmentFacts() {
        return {
          organization_id: ORG,
          intake_file_id: versionRow.intake_file_id,
          intake_batch_id: BATCH_A,
          engagement_id: ENG,
          object_version_id: "ov_0123456789abcdef0123456789abcdef",
          verified_checksum: checksum,
          verified_size_bytes: format.bytes.length,
          mime_type: versionRow.mime_type,
          file_extension: versionRow.file_extension,
          file_policy_status: versionRow.file_policy_status,
          storage_provider: "gcs",
          storage_object_key: versionRow.storage_object_key,
        };
      },
      async runProductionSecurityAssessment(facts) {
        assessedFacts = facts;
        return { ok: false };
      },
    });
    assert.equal(assessedFacts.intakeFileId, versionRow.intake_file_id);
    assert.equal(assessedFacts.extension, format.extension);
    assert.equal(assessedFacts.declaredMime, format.mime);
    assert.equal(assessedFacts.verifiedChecksum, checksum);

    // 8. Confirmation trusts only server-streamed bytes: the selected bytes
    // verify against the declared checksum; different bytes never do.
    const objectVersionId = "ov_fedcba9876543210fedcba9876543210";
    const verified = await intakeServiceTestables.verifyExactObjectVersionStreamed({
      storageAdapter: syntheticObjectVersionAdapter(objectVersionId, format.bytes),
      objectVersionId,
      declaredChecksum: checksum,
      expectedSizeBytes: format.bytes.length,
      hashAlgorithm: "sha256",
    });
    assert.equal(verified.ok, true);
    assert.equal(verified.data.verifiedChecksum, checksum);
    const sameSizeOtherBytes = Buffer.from(format.bytes);
    sameSizeOtherBytes[sameSizeOtherBytes.length - 1] ^= 0x01;
    const mismatch = await intakeServiceTestables.verifyExactObjectVersionStreamed({
      storageAdapter: syntheticObjectVersionAdapter(objectVersionId, sameSizeOtherBytes),
      objectVersionId,
      declaredChecksum: checksum,
      expectedSizeBytes: format.bytes.length,
      hashAlgorithm: "sha256",
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error.code, "checksum_mismatch");

    // 9. Through the real route: the sanitized 422 carries the resolution,
    // and the frontend presents exactly the server's executable actions.
    const routed = await reserveThroughRoute(store, { format, batchId: BATCH_A, key: `kai-dup-${tag}-route` });
    assert.equal(routed.statusCode, 422);
    assert.equal(routed.body.blockers[0].validator_key, "VAL-IDEMP-006");
    assertNoUnsafeResolutionFields(routed.body.data.duplicate_resolution, checksum);
    const frontendResolution = duplicateResolutionFromResult({ statusCode: routed.statusCode, body: routed.body });
    assert.ok(frontendResolution);
    const view = duplicateResolutionView(frontendResolution);
    assert.equal(view.heading, "This file has already been added.");
    assert.deepEqual(view.actions.map((item) => item.action), routed.body.data.duplicate_resolution.available_actions);
    assert.ok(view.actions.every((item) => typeof item.label === "string" && item.label.length > 0));
    const routedNewVersion = await reserveThroughRoute(store, {
      format,
      batchId: BATCH_OTHER_ENG,
      key: `kai-dup-${tag}-route-linked`,
      extra: forced(first.data.intake_file_id),
    });
    // The other-engagement request names engagement ENG for a batch in
    // OTHER_ENG, so the existing tenant boundary still rejects it first.
    assert.equal(routedNewVersion.statusCode, 422);
    assert.equal(routedNewVersion.body.blockers[0].validator_key, "VAL-TEN-003");

    // 10. Ordinary non-duplicate uploads were unaffected throughout: the
    // first and modified reservations used the unchanged insert, and only
    // the explicit requests used the new-version insert.
    assert.equal(store.calls.filter((name) => name === "insertIntakeFileMetadata").length, 2);
    assert.equal(store.calls.filter((name) => name === "insertIntakeFileNewVersionMetadata").length, 2);
  });
}

test("reported failure: VAL-IDEMP-006 / duplicate_checksum reproduces from the unchanged predicate, and the response now carries an executable resolution", async () => {
  const format = FORMATS[0];
  const checksum = sha256(format.bytes);

  // The unchanged validator predicate: any declared-checksum match blocks.
  const predicate = duplicate_checksum_blocked({ checksum, duplicateChecksums: [checksum] });
  assert.equal(predicate.validator_key, "VAL-IDEMP-006");
  assert.equal(predicate.blocking_reason, "duplicate_checksum");

  // The owner-reported sequence: the same file reserved in one batch, then
  // in another batch with the pre-repair browser key file-{batch}-{checksum}.
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: `file-${BATCH_A}-${checksum}`.slice(0, 128) });
  assert.equal(first.ok, true);
  const reported = await reserve(store, { format, batchId: BATCH_B, key: `file-${BATCH_B}-${checksum}`.slice(0, 128) });
  assert.equal(reported.ok, false);
  assert.equal(reported.error.status, 422);
  assert.equal(reported.blockers[0].validator_key, "VAL-IDEMP-006");
  assert.equal(reported.blockers[0].blocking_reason, "duplicate_checksum");
  assert.equal(store.rows.length, 1);

  // Corrected: the same blocker now carries the permitted resolution, and
  // executing it creates exactly one linked record.
  const resolution = reported.data.duplicate_resolution;
  assert.deepEqual(resolution.available_actions, ["upload_new_intake_version", "cancel"]);
  const resolved = await reserve(store, {
    format,
    batchId: BATCH_B,
    key: "kai-reported-resolution-0001",
    extra: forced(resolution.existing_file.intake_file_id),
  });
  assert.equal(resolved.ok, true);
  assert.equal(store.rows.length, 2);
  assert.equal(store.row(resolved.data.intake_file_id).original_intake_file_id, first.data.intake_file_id);
});

test("existing-reservation lifecycle states map to the actual repository status semantics", () => {
  const nowMs = Date.parse(NOW);
  const future = new Date(nowMs + DAY_MS).toISOString();
  const past = new Date(nowMs - 1).toISOString();
  const cases = [
    [{ upload_state: "reserved", upload_expires_at: future, file_policy_status: "pending" }, "upload_in_progress"],
    [{ upload_state: "upload_started", upload_expires_at: future, file_policy_status: "pending" }, "upload_in_progress"],
    [{ upload_state: "uploaded_unconfirmed", upload_expires_at: future, file_policy_status: "pending" }, "upload_in_progress"],
    [{ upload_state: "reserved", upload_expires_at: past, file_policy_status: "pending" }, "upload_not_completed"],
    [{ upload_state: "reserved", upload_expires_at: "not-a-time", file_policy_status: "pending" }, "unknown"],
    [{ upload_state: "abandoned", file_policy_status: "pending" }, "upload_not_completed"],
    [{ upload_state: "expired", file_policy_status: "pending" }, "upload_not_completed"],
    [{ upload_state: "confirmed", file_policy_status: "pending" }, "confirmed"],
    [{ upload_state: "confirmed", file_policy_status: "passed" }, "confirmed"],
    [{ upload_state: "confirmed", file_policy_status: "failed" }, "security_check_failed"],
    [{ upload_state: "confirmed", file_policy_status: "blocked" }, "blocked_by_policy"],
    [{ upload_state: "policy_blocked", file_policy_status: "pending" }, "blocked_by_policy"],
    [{ upload_state: "confirmed", file_policy_status: "skipped" }, "unknown"],
    [{ upload_state: "mystery", file_policy_status: "passed" }, "unknown"],
  ];
  for (const [row, expected] of cases) {
    assert.equal(classifyExistingIntakeFileState(row, nowMs), expected, JSON.stringify(row));
  }
});

test("failed transfer: only a new intake version is offered; it supersedes the failed attempt and leaves its history intact", async () => {
  const format = FORMATS[3];
  for (const failedState of ["abandoned", "expired"]) {
    const store = createSyntheticIntakeStore();
    const first = await reserve(store, { format, key: `kai-failed-${failedState}-first` });
    store.setRow(first.data.intake_file_id, { upload_state: failedState });
    const blocked = await reserve(store, { format, key: `kai-failed-${failedState}-again` });
    assertDuplicateBlocker(blocked, { status: "duplicate_in_batch", actions: ["upload_new_intake_version", "cancel"] });
    const retry = await reserve(store, {
      format,
      key: `kai-failed-${failedState}-version`,
      extra: forced(first.data.intake_file_id),
    });
    assert.equal(retry.ok, true);
    assert.equal(store.row(retry.data.intake_file_id).supersedes_intake_file_id, first.data.intake_file_id);
    assert.equal(store.row(first.data.intake_file_id).upload_state, failedState);
  }

  // A reservation past its expiry that was never transitioned is treated the
  // same way: the lifecycle trigger would deny continuing it.
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-failed-lapsed-first" });
  store.setRow(first.data.intake_file_id, { upload_expires_at: new Date(Date.parse(NOW) - 1).toISOString() });
  const lapsed = await reserve(store, { format, key: "kai-failed-lapsed-again" });
  assertDuplicateBlocker(lapsed, { status: "duplicate_in_batch", actions: ["upload_new_intake_version", "cancel"] });
});

test("incomplete reservation: Continue upload only, and an explicit new version is denied while it can still complete", async () => {
  const format = FORMATS[0];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-incomplete-first" });
  for (const state of ["reserved", "upload_started", "uploaded_unconfirmed"]) {
    store.setRow(first.data.intake_file_id, { upload_state: state });
    const again = await reserve(store, { format, key: `kai-incomplete-${state}` });
    const resolution = assertDuplicateBlocker(again, {
      status: "duplicate_in_batch",
      actions: ["continue_upload", "cancel"],
      restriction: "upload_in_progress",
    });
    assert.equal(resolution.existing_file.upload_state, state);
    const denied = await reserve(store, {
      format,
      key: `kai-incomplete-${state}-force`,
      extra: forced(first.data.intake_file_id),
    });
    assertDuplicateBlocker(denied, {
      status: "duplicate_in_batch",
      actions: ["continue_upload", "cancel"],
      restriction: "upload_in_progress",
    });
  }
  assert.equal(store.rows.length, 1);

  // The browser continues a "reserved" record with a signed upload and
  // confirmation, and any later state with confirmation only (the existing
  // GCS confirm accepts those states and re-verifies the stored bytes).
  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  const transferBody = uiSource.slice(
    uiSource.indexOf("const transferAndConfirm = useCallback"),
    uiSource.indexOf("const reserveAndUpload = useCallback"),
  );
  assert.match(transferBody, /if \(uploadState === "reserved"\) \{[\s\S]*requestUploadUrlPath[\s\S]*putToSignedUrl[\s\S]*\}\s*const confirmResult/);
});

test("policy-blocked and security-check-failed content stays unavailable everywhere in the organization, and an override is denied", async () => {
  const format = FORMATS[0];
  for (const [patch, restriction] of [
    [{ upload_state: "policy_blocked", file_policy_status: "blocked" }, "blocked_by_policy"],
    [{ upload_state: "confirmed", file_policy_status: "blocked" }, "blocked_by_policy"],
    [{ upload_state: "confirmed", file_policy_status: "failed" }, "security_check_failed"],
  ]) {
    const store = createSyntheticIntakeStore();
    const blockedFile = await reserve(store, { format, batchId: BATCH_B, key: `kai-blocked-${restriction}-first` });
    store.setRow(blockedFile.data.intake_file_id, patch);
    for (const batchId of [BATCH_A, BATCH_B, BATCH_OTHER_ENG]) {
      const engagementId = batchId === BATCH_OTHER_ENG ? OTHER_ENG : ENG;
      const again = await reserve(store, { format, batchId, engagementId, key: `kai-blocked-${restriction}-${batchId.slice(-2)}` });
      const resolution = assertDuplicateBlocker(again, {
        status: again.data.duplicate_resolution.duplicate_status,
        actions: ["cancel"],
        restriction,
      });
      assert.equal(resolution.existing_file.intake_file_id, blockedFile.data.intake_file_id);
      const override = await reserve(store, {
        format,
        batchId,
        engagementId,
        key: `kai-blocked-${restriction}-${batchId.slice(-2)}-force`,
        extra: forced(blockedFile.data.intake_file_id),
      });
      assertDuplicateBlocker(override, { status: override.data.duplicate_resolution.duplicate_status, actions: ["cancel"], restriction });
    }
    assert.equal(store.rows.length, 1);
    assert.equal(store.calls.includes("insertIntakeFileNewVersionMetadata"), false);
    assert.ok(store.blockedAudits.length > 0, "every denial writes a metadata-only blocked-attempt audit");
  }
});

test("force_new_version is accepted only with the presented file, as a boolean, and only while a duplicate exists", async () => {
  const format = FORMATS[2];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-force-contract-first" });
  confirmPassed(store, first.data.intake_file_id);

  const withoutTarget = await reserve(store, { format, key: "kai-force-contract-1", extra: { force_new_version: true } });
  assert.equal(withoutTarget.error.code, "invalid_request");
  const targetWithoutForce = await reserve(store, {
    format,
    key: "kai-force-contract-2",
    extra: { duplicate_of_intake_file_id: first.data.intake_file_id },
  });
  assert.equal(targetWithoutForce.error.code, "invalid_request");
  const nonBoolean = await reserve(store, {
    format,
    key: "kai-force-contract-3",
    extra: { force_new_version: "true", duplicate_of_intake_file_id: first.data.intake_file_id },
  });
  assert.equal(nonBoolean.error.code, "invalid_request");
  const uppercaseTarget = await reserve(store, {
    format,
    key: "kai-force-contract-4",
    extra: forced(first.data.intake_file_id.toUpperCase()),
  });
  assert.equal(uppercaseTarget.error.code, "invalid_request");
  const noDuplicate = await reserve(store, {
    format,
    bytes: format.modified,
    key: "kai-force-contract-5",
    extra: forced(first.data.intake_file_id),
  });
  assert.equal(noDuplicate.error.code, "conflict_current_state_changed");
  assert.equal(store.rows.length, 1);

  // One idempotency identity cannot mean both an ordinary reservation and a
  // new version: replaying a key with a different intent conflicts.
  const versioned = await reserve(store, { format, key: "kai-force-contract-6", extra: forced(first.data.intake_file_id) });
  assert.equal(versioned.ok, true);
  const versionReplay = await reserve(store, { format, key: "kai-force-contract-6", extra: forced(first.data.intake_file_id) });
  assert.equal(versionReplay.ok, true);
  assert.equal(versionReplay.data.intake_file_id, versioned.data.intake_file_id);
  assert.deepEqual(versionReplay.warnings.map((warning) => warning.code), ["duplicate_in_batch"]);
  const intentFlip = await reserve(store, { format, key: "kai-force-contract-6" });
  assert.equal(intentFlip.error.code, "duplicate_conflict");
  const ordinaryReplayAsVersion = await reserve(store, {
    format,
    key: "kai-force-contract-first",
    extra: forced(first.data.intake_file_id),
  });
  assert.equal(ordinaryReplayAsVersion.error.code, "duplicate_conflict");
  assert.equal(store.rows.length, 2);

  // A caller cannot smuggle a duplicate_resolution record into metadata.
  const smuggled = await reserve(store, {
    format,
    bytes: Buffer.from("unrelated synthetic bytes\n"),
    key: "kai-force-contract-7",
    extra: { file_metadata: { duplicate_resolution: { force_new_version: true } } },
  });
  assert.equal(smuggled.ok, true);
  assert.equal(store.row(smuggled.data.intake_file_id).file_metadata.duplicate_resolution, undefined);
});

test("the request schema accepts only boolean force_new_version and a UUID duplicate_of_intake_file_id at the route", async () => {
  const format = FORMATS[0];
  const store = createSyntheticIntakeStore();
  for (const extra of [
    { force_new_version: "yes" },
    { duplicate_of_intake_file_id: "not-a-uuid" },
  ]) {
    const res = await reserveThroughRoute(store, { format, batchId: BATCH_A, key: "kai-route-schema-0001", extra });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
  }
  assert.equal(store.rows.length, 0);
});

test("audit failure on a new intake version rolls the record back and fails closed", async () => {
  const format = FORMATS[1];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-audit-required-first" });
  confirmPassed(store, first.data.intake_file_id);
  store.dependencies.insertRequiredSuccessfulAuditEvent = async () => ({ ok: false, skipped: true });
  const result = await reserve(store, { format, key: "kai-audit-required-version", extra: forced(first.data.intake_file_id) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(store.rows.length, 1);
  assert.equal(store.transactions.rolledBack, 1);
});

test("tenant isolation: another organization's identical file is never matched or disclosed, and the classifier drops foreign rows", async () => {
  const format = FORMATS[4];
  const store = createSyntheticIntakeStore();
  const otherOrgActor = {
    ...GK_OPERATOR,
    organizationMemberships: [{ organization_id: OTHER_ORG, role_name: "gk_operator", membership_status: "active" }],
  };
  const foreign = await reserve(store, {
    format,
    organizationId: OTHER_ORG,
    batchId: BATCH_OTHER_ORG,
    actor: otherOrgActor,
    key: "kai-tenant-foreign-0001",
  });
  assert.equal(foreign.ok, true);

  const own = await reserve(store, { format, key: "kai-tenant-own-0001" });
  assert.equal(own.ok, true, "a foreign organization's copy is not a duplicate here");
  assert.deepEqual(own.warnings, []);
  assert.equal(JSON.stringify(own).includes(foreign.data.intake_file_id), false);

  // Naming a foreign file as the version target cannot reach it.
  const again = await reserve(store, { format, key: "kai-tenant-own-0002" });
  const resolution = again.data.duplicate_resolution;
  assert.equal(resolution.existing_file.intake_file_id, own.data.intake_file_id);
  assert.equal(JSON.stringify(again).includes(foreign.data.intake_file_id), false);
  const foreignTarget = await reserve(store, { format, key: "kai-tenant-own-0003", extra: forced(foreign.data.intake_file_id) });
  assert.equal(foreignTarget.error.code, "conflict_current_state_changed");
  assert.equal(JSON.stringify(foreignTarget).includes(foreign.data.intake_file_id), false);

  // An actor without membership cannot use another organization's batch.
  const crossTenant = await reserve(store, { format, batchId: BATCH_OTHER_ORG, key: "kai-tenant-cross-0001" });
  assert.equal(crossTenant.ok, false);
  assert.notEqual(crossTenant.blockers?.[0]?.validator_key, "VAL-IDEMP-006");

  assert.equal(classifyIntakeFileDuplicate({
    matches: [{ ...store.row(foreign.data.intake_file_id) }],
    organizationId: ORG,
    intakeBatchId: BATCH_A,
    engagementId: ENG,
    now: NOW,
  }), null);
});

test("cross-engagement duplicates resolve only as a linked new intake record in the requesting project", async () => {
  const format = FORMATS[2];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-cross-engagement-first" });
  confirmPassed(store, first.data.intake_file_id);
  const otherProject = await reserve(store, {
    format,
    batchId: BATCH_OTHER_ENG,
    engagementId: OTHER_ENG,
    key: "kai-cross-engagement-other",
  });
  const resolution = assertDuplicateBlocker(otherProject, {
    status: "duplicate_in_other_engagement",
    actions: ["upload_new_intake_version", "cancel"],
  });
  assert.equal(resolution.existing_file.engagement_id, ENG);
  const linked = await reserve(store, {
    format,
    batchId: BATCH_OTHER_ENG,
    engagementId: OTHER_ENG,
    key: "kai-cross-engagement-linked",
    extra: forced(first.data.intake_file_id),
  });
  assert.equal(linked.ok, true);
  const row = store.row(linked.data.intake_file_id);
  assert.equal(row.engagement_id, OTHER_ENG);
  assert.equal(row.original_intake_file_id, first.data.intake_file_id);
  assert.equal(row.supersedes_intake_file_id, null);
  assert.deepEqual(linked.warnings.map((warning) => warning.code), ["duplicate_candidate_recorded"]);
});

test("concurrency: simultaneous duplicate requests never create unintended records", async () => {
  const format = FORMATS[0];

  // Two ordinary reservations of the same new content race: the unique index
  // admits one, and the loser receives the same VAL-IDEMP-006 resolution.
  const raceStore = createSyntheticIntakeStore();
  const [left, right] = await Promise.all([
    reserve(raceStore, { format, key: "kai-race-left-0001" }),
    reserve(raceStore, { format, key: "kai-race-right-0001" }),
  ]);
  const winners = [left, right].filter((result) => result.ok);
  const losers = [left, right].filter((result) => !result.ok);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assertDuplicateBlocker(losers[0], {
    status: "duplicate_in_batch",
    actions: ["continue_upload", "cancel"],
    restriction: "upload_in_progress",
  });
  assert.equal(raceStore.rows.length, 1);

  // Two explicit new versions against the same presented file race: the
  // lock serializes them, and the second sees the first and is refused.
  const versionStore = createSyntheticIntakeStore();
  const first = await reserve(versionStore, { format, key: "kai-race-version-first" });
  confirmPassed(versionStore, first.data.intake_file_id);
  const versions = await Promise.all([
    reserve(versionStore, { format, key: "kai-race-version-a", extra: forced(first.data.intake_file_id) }),
    reserve(versionStore, { format, key: "kai-race-version-b", extra: forced(first.data.intake_file_id) }),
  ]);
  assert.equal(versions.filter((result) => result.ok).length, 1);
  const refused = versions.find((result) => !result.ok);
  assert.equal(refused.error.code, "conflict_current_state_changed");
  assert.equal(versionStore.rows.length, 2);

  // The same new-version request sent twice at once is one record.
  const replayStore = createSyntheticIntakeStore();
  const original = await reserve(replayStore, { format, key: "kai-race-replay-first" });
  confirmPassed(replayStore, original.data.intake_file_id);
  const replays = await Promise.all([
    reserve(replayStore, { format, key: "kai-race-replay-same", extra: forced(original.data.intake_file_id) }),
    reserve(replayStore, { format, key: "kai-race-replay-same", extra: forced(original.data.intake_file_id) }),
  ]);
  assert.ok(replays.every((result) => result.ok));
  assert.equal(replays[0].data.intake_file_id, replays[1].data.intake_file_id);
  assert.equal(replayStore.rows.length, 2);
});

test("same bytes under a different filename, and as .md versus .txt, are content duplicates with their own file-type metadata", async () => {
  const shared = Buffer.from("Shared synthetic notes.\n", "utf8");
  const md = { ...FORMATS[2], bytes: shared };
  const txt = { ...FORMATS[3], bytes: shared };
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format: md, key: "kai-cross-type-md" });
  confirmPassed(store, first.data.intake_file_id);

  const renamed = await reserve(store, { format: md, filename: "different-name.md", key: "kai-cross-type-renamed" });
  const renamedResolution = assertDuplicateBlocker(renamed, {
    status: "duplicate_in_batch",
    actions: ["use_existing_file", "upload_new_intake_version", "cancel"],
  });
  assert.equal(renamedResolution.same_filename, false);
  assert.equal(renamedResolution.same_file_extension, true);

  const asText = await reserve(store, { format: txt, key: "kai-cross-type-txt" });
  const textResolution = assertDuplicateBlocker(asText, {
    status: "duplicate_in_batch",
    actions: ["use_existing_file", "upload_new_intake_version", "cancel"],
  });
  assert.equal(textResolution.same_file_extension, false);
  assert.equal(textResolution.existing_file.file_extension, ".md");

  const textVersion = await reserve(store, { format: txt, key: "kai-cross-type-txt-version", extra: forced(first.data.intake_file_id) });
  assert.equal(textVersion.ok, true);
  const textRow = store.row(textVersion.data.intake_file_id);
  assert.equal(textRow.file_extension, ".txt");
  assert.equal(textRow.mime_type, "text/plain");

  // Parser/profile idempotency stays intake-file-specific
  // (intake_file_id + parser + version + checksum): each record gets its own
  // identity, and one record always maps to the same identity.
  const { parserRunIdentity } = __parserProfileWorkerTestables;
  const facts = (row) => ({
    organizationId: ORG,
    intakeFileId: row.intake_file_id,
    checksum: row.checksum,
    extension: row.file_extension,
  });
  const mdIdentity = parserRunIdentity(facts(store.row(first.data.intake_file_id)));
  const txtIdentity = parserRunIdentity(facts(textRow));
  assert.equal(mdIdentity.checksum, txtIdentity.checksum);
  assert.notEqual(mdIdentity.intakeFileId, txtIdentity.intakeFileId);
  assert.deepEqual(parserRunIdentity(facts(textRow)), txtIdentity);
});

test("a stale or incorrect declared checksum cannot reuse an existing file", async () => {
  const format = FORMATS[0];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-stale-checksum-first" });
  confirmPassed(store, first.data.intake_file_id);

  // A modified selection sent with the earlier selection's checksum: the
  // size cannot match one digest, so nothing is offered for reuse.
  const stale = await reserve(store, {
    format,
    bytes: Buffer.from("name,value\nkindness,1\nextra,row\n"),
    checksum: sha256(format.bytes),
    key: "kai-stale-checksum-again",
  });
  assertDuplicateBlocker(stale, { status: "duplicate_in_batch", actions: ["cancel"], restriction: "declared_size_mismatch" });
  const staleForce = await reserve(store, {
    format,
    bytes: Buffer.from("name,value\nkindness,1\nextra,row\n"),
    checksum: sha256(format.bytes),
    key: "kai-stale-checksum-force",
    extra: forced(first.data.intake_file_id),
  });
  assertDuplicateBlocker(staleForce, { status: "duplicate_in_batch", actions: ["cancel"], restriction: "declared_size_mismatch" });
  assert.equal(store.rows.length, 1);
});

test("unsupported types, extension/MIME mismatches, unsafe names, and oversized files are blocked before any duplicate decision, with or without an override", async () => {
  const format = FORMATS[0];
  const store = createSyntheticIntakeStore();
  const first = await reserve(store, { format, key: "kai-file-policy-first" });
  confirmPassed(store, first.data.intake_file_id);
  const override = forced(first.data.intake_file_id);
  const callsBefore = store.calls.length;

  for (const [label, request, validatorKey] of [
    ["unsupported .exe", { extension: ".exe", mime: "application/octet-stream", filename: "tool.exe" }, null],
    ["unsupported .docx", { extension: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "notes.docx" }, null],
    ["md declared as pdf", { extension: ".md", mime: "application/pdf", filename: "notes.md" }, "VAL-STO-005"],
    ["pdf declared as text", { extension: ".pdf", mime: "text/plain", filename: "notes.pdf" }, "VAL-STO-005"],
    ["path traversal", { filename: "../escape.csv" }, "VAL-STO-004"],
  ]) {
    for (const extra of [{}, override]) {
      const result = await reserve(store, { format, key: `kai-file-policy-${label.replace(/\W+/g, "-")}-${extra.force_new_version ? "f" : "n"}`, ...request, extra });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.status, 422, label);
      if (validatorKey) assert.equal(result.blockers[0].validator_key, validatorKey, label);
      assert.notEqual(result.blockers[0].validator_key, "VAL-IDEMP-006", label);
    }
  }
  assert.equal(store.calls.slice(callsBefore).includes("findIntakeFileReservationByChecksum"), false);

  const oversized = await reserve(store, {
    format,
    sizeBytes: 25 * 1024 * 1024 + 1,
    key: "kai-file-policy-oversized",
    extra: override,
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.status, 413);
  assert.equal(store.transactions.started, 0);
  assert.equal(store.rows.length, 1);
});

test("no source, source version, evidence, claim, or approval is created by any duplicate decision", async () => {
  const format = FORMATS[0];
  const store = createSyntheticIntakeStore();
  const touched = new Set();
  store.dependencies = new Proxy(store.dependencies, {
    get(target, property) {
      if (typeof property === "string") touched.add(property);
      return target[property];
    },
  });
  const first = await reserve(store, { format, key: "kai-no-promotion-first" });
  confirmPassed(store, first.data.intake_file_id);
  await reserve(store, { format, key: "kai-no-promotion-again" });
  await reserve(store, { format, key: "kai-no-promotion-version", extra: forced(first.data.intake_file_id) });
  await reserve(store, { format, batchId: BATCH_B, key: "kai-no-promotion-linked", extra: forced(first.data.intake_file_id) });
  for (const name of touched) {
    assert.doesNotMatch(name, /source|evidence|claim|promot|approv|review_queue|reviewQueue/i, name);
  }

  // The new queries touch only kai.intake_files.
  const statements = [];
  const db = {
    async query(text) {
      statements.push(text);
      return { rows: [] };
    },
  };
  await listIntakeFileChecksumMatches({ organizationId: ORG, checksum: sha256(format.bytes), intakeBatchId: BATCH_A, engagementId: ENG }, db);
  await lockIntakeFileChecksumOriginal({ organizationId: ORG, checksum: sha256(format.bytes) }, db);
  await insertIntakeFileNewVersionMetadata({ organizationId: ORG, checksum: sha256(format.bytes), originalIntakeFileId: first.data.intake_file_id }, db);
  assert.equal(statements.length, 3);
  for (const text of statements) {
    const tables = [...text.matchAll(/kai\.([a-z_]+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(tables)], ["intake_files"]);
    assert.match(text, /organization_id/);
  }
  assert.match(statements[0], /WHERE organization_id = \$1\s+AND checksum = \$2/);
  assert.match(statements[1], /AND force_new_version = false\s+LIMIT 1\s+FOR UPDATE/);
  assert.match(statements[2], /force_new_version,\s+original_intake_file_id,\s+supersedes_intake_file_id/);
});

test("the browser declares a server-allowed MIME for every supported type when the browser reports none", () => {
  const expectations = {
    "a.csv": "text/csv",
    "a.xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "a.md": "text/markdown",
    "a.txt": "text/plain",
    "a.pdf": "application/pdf",
    "a.exe": "application/octet-stream",
  };
  for (const [name, mime] of Object.entries(expectations)) {
    assert.equal(declaredMimeTypeForFile({ name, type: "" }), mime);
  }
  assert.equal(declaredMimeTypeForFile({ name: "a.md", type: "text/plain" }), "text/plain");
  assert.equal(duplicateResolutionFromResult({ statusCode: 500, body: { data: { duplicate_resolution: {} } } }), null);
  assert.equal(duplicateResolutionFromResult({ statusCode: 422, body: { data: null } }), null);
});

test("a retried or continued upload whose record already left \"reserved\" is confirmed, never stopped at the signing 409", () => {
  // Only the server's own stale-state refusal to sign means "bytes already
  // transferred"; every other signing failure is still reported as an error.
  assert.equal(uploadUrlResultRequiresConfirmOnly({
    statusCode: 409,
    body: { ok: false, error: { code: "conflict_current_state_changed" } },
  }), true);
  for (const result of [
    { statusCode: 200, body: { ok: true, data: {} } },
    { statusCode: 409, body: { ok: false, error: { code: "duplicate_conflict" } } },
    { statusCode: 404, body: { ok: false, error: { code: "conflict_current_state_changed" } } },
    { statusCode: 503, body: { ok: false, error: { code: "storage_provider_not_configured" } } },
    { statusCode: 409, body: null },
    null,
  ]) {
    assert.equal(uploadUrlResultRequiresConfirmOnly(result), false);
  }

  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  const transferBody = uiSource.slice(
    uiSource.indexOf("const transferAndConfirm = useCallback"),
    uiSource.indexOf("const reserveAndUpload = useCallback"),
  );
  const fallbackIndex = transferBody.indexOf("if (!uploadUrlResultRequiresConfirmOnly(uploadUrlResult)) {");
  assert.ok(fallbackIndex > transferBody.indexOf("requestUploadUrlPath(intakeBatchId)"));
  assert.ok(fallbackIndex < transferBody.indexOf("if (uploadUrlResult.statusCode !== 200 || !uploadUrlResult.body?.ok) {"));
  assert.ok(transferBody.indexOf("putToSignedUrl") > fallbackIndex);
  assert.ok(transferBody.indexOf("const confirmResult") > transferBody.indexOf("putToSignedUrl"));
});
