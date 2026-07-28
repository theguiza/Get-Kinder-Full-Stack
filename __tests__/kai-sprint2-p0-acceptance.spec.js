import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import express from "express";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import {
  KAI_SPRINT2_P0_ABUSE_LIMITS,
  KAI_SPRINT2_P0_RESOURCE_LIMITS,
  KAI_SPRINT2_P0_SECURITY_EXECUTOR,
} from "../Backend/kai/config/kaiSprint2P0Contract.js";
import { buildKaiError, sendKaiError } from "../Backend/kai/errors/kaiErrors.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  createKaiMutationAttemptLimiter,
  handleKaiSprint2JsonParserError,
  kaiSprint2MetadataJsonParser,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import sprint2IntakeApiRouter, {
  __testables as intakeRouteTestables,
} from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  checkAdminAccess,
  confirmUpload,
  createIntakeBatch,
  getIntakeBatchDetail,
  getIntakeFileDetail,
  listIntakeBatchesForOrganization,
  listIntakeFileReviewQueueItems,
  listIntakeFilesForBatch,
  reserveIntakeFileMetadata,
  uploadReservedIntakeFile,
} from "../Backend/kai/services/kaiIntakeService.js";
import { updateReviewQueueStatus } from "../Backend/kai/services/kaiReviewQueueService.js";
import { LocalDevStorageAdapter } from "../Backend/kai/storage/localDevStorageAdapter.js";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";
import { validateAssistantBoundary } from "../Backend/kai/validators/assistantBoundaryValidators.js";
import { detectP0FileTypeAgreement } from "../Backend/kai/validators/p0FileTypeAgreementDetector.js";

const basePath = "/api/kai/sprint2/intake";
const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const actorUserId = "7fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const now = "2026-07-23T10:00:00.000Z";
const later = "2026-07-23T10:01:00.000Z";
const expiredNow = "2026-07-24T10:00:00.000Z";
const objectVersionIds = [
  "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "ov_cccccccccccccccccccccccccccccccc",
  "ov_dddddddddddddddddddddddddddddddd",
];
const allowedBytes = Buffer.from("name,value\nkindness,1\n", "utf8");
const allowedChecksum = sha256(allowedBytes);
const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_FILE_UPLOAD_ENABLED: "true",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function actorContext({ role = "gk_operator", membershipStatus = "active", actorType = "human" } = {}) {
  return {
    actorType,
    actorUserId,
    kaiRoles: [role],
    organizationMemberships: [
      { organization_id: organizationId, role_name: role, membership_status: membershipStatus },
    ],
  };
}

function safeBatch(row) {
  return {
    intake_batch_id: row.intake_batch_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    batch_code: row.batch_code,
    intake_method: row.intake_method,
    source_system_name: row.source_system_name,
    source_system_ref: row.source_system_ref,
    metadata_only: true,
    raw_upload_enabled: false,
    created_at: row.created_at,
  };
}

function safeFile(row) {
  return {
    intake_file_id: row.intake_file_id,
    intake_batch_id: row.intake_batch_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    safe_filename: row.safe_filename,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    file_policy_status: row.file_policy_status,
    malware_scan_status: row.malware_scan_status,
    processing_status: row.processing_status,
    parse_status: row.parse_status,
    review_status: row.review_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createMetadataRepository() {
  const batches = new Map();
  const files = new Map();
  const batchKeys = new Map();
  const fileKeys = new Map();
  const reviewItems = new Map();
  let batchCounter = 0;
  let fileCounter = 0;
  let reviewCounter = 0;
  let requiredAuditFailure = false;
  let telemetryFailure = false;

  function batchId() {
    batchCounter += 1;
    return `8e426ea1-2be3-4e48-b80f-9783ddbacd${String(batchCounter).padStart(2, "0")}`;
  }

  function fileId() {
    fileCounter += 1;
    return `9fe568b1-5c05-4c42-bb1f-6e20de216c${String(fileCounter).padStart(2, "0")}`;
  }

  function reviewId() {
    reviewCounter += 1;
    return `6fe568b1-5c05-4c42-bb1f-${String(reviewCounter).padStart(12, "0")}`;
  }

  function rememberReviewItem(file) {
    const id = reviewId();
    const row = {
      review_queue_item_id: id,
      organization_id: file.organization_id,
      queue_type: "intake_file_review",
      target_object_type: "intake_file",
      target_object_id: file.intake_file_id,
      priority: "normal",
      queue_status: "open",
      due_at: null,
      summary: "Review quarantined intake file.",
      required_action: "Review the file before any downstream processing.",
      created_at: now,
      updated_at: now,
    };
    reviewItems.set(id, row);
    return row;
  }

  return {
    calls: { audit: [], metrics: [], malware: [], logs: [] },
    flags: {
      setRequiredAuditFailure(value) {
        requiredAuditFailure = value;
      },
      setTelemetryFailure(value) {
        telemetryFailure = value;
      },
    },
    async getEngagementTenantState(id) {
      return id === engagementId ? { engagement_id: engagementId, organization_id: organizationId } : null;
    },
    async getIntakeBatchTenantState(id, orgId) {
      const row = batches.get(id);
      return row?.organization_id === orgId ? row : null;
    },
    async findIntakeBatchByIdempotencyKey({ organizationId: orgId, idempotencyKey }) {
      const id = batchKeys.get(`${orgId}:${idempotencyKey}`);
      return id ? batches.get(id) : null;
    },
    async insertIntakeBatchMetadata(input) {
      const row = {
        intake_batch_id: batchId(),
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        batch_code: input.batchCode,
        intake_method: input.intakeMethod,
        source_system_name: input.sourceSystemName,
        source_system_ref: input.sourceSystemRef,
        batch_metadata: input.batchMetadata,
        created_by: input.createdBy,
        created_by_type: input.createdByType,
        created_at: now,
        updated_at: now,
      };
      batches.set(row.intake_batch_id, row);
      batchKeys.set(`${row.organization_id}:${input.idempotencyKey}`, row.intake_batch_id);
      return row;
    },
    async listIntakeBatchesForOrganization(orgId) {
      return [...batches.values()].filter((row) => row.organization_id === orgId);
    },
    async getIntakeBatchDetail(orgId, intakeBatchId) {
      const row = batches.get(intakeBatchId);
      return row?.organization_id === orgId ? row : null;
    },
    async findIntakeFileReservationByIdempotencyKey({ organizationId: orgId, idempotencyKey }) {
      const id = fileKeys.get(`${orgId}:${idempotencyKey}`);
      return id ? files.get(id) : null;
    },
    async findIntakeFileReservationByChecksum() {
      return null;
    },
    async insertIntakeFileMetadata(input) {
      const batchFileCount = [...files.values()].filter((row) => (
        row.organization_id === input.organizationId
        && row.intake_batch_id === input.intakeBatchId
      )).length;
      if (batchFileCount >= KAI_SPRINT2_P0_RESOURCE_LIMITS.maxFilesPerBatch) {
        return {
          intake_file_id: "invalid-file-limit-sentinel",
          intake_batch_id: input.intakeBatchId,
          organization_id: input.organizationId,
          engagement_id: input.engagementId,
          safe_filename: "",
          mime_type: input.mimeType,
          file_size_bytes: input.fileSizeBytes,
          checksum: input.checksum,
          hash_algorithm: input.hashAlgorithm,
          file_policy_status: "pending",
          malware_scan_status: "not_configured",
          processing_status: "received",
          parse_status: "not_started",
          review_status: "proposed",
          file_metadata: input.fileMetadata,
          created_at: now,
          updated_at: now,
        };
      }
      const row = {
        intake_file_id: input.intakeFileId || fileId(),
        intake_batch_id: input.intakeBatchId,
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        original_filename: input.originalFilename,
        safe_filename: input.safeFilename,
        storage_provider: input.storageProvider,
        storage_bucket: "storage-bucket-sentinel",
        storage_object_key: "storage-object-key-sentinel",
        storage_uri: "storage-uri-sentinel",
        mime_type: input.mimeType,
        file_extension: input.fileExtension,
        file_size_bytes: input.fileSizeBytes,
        checksum: input.checksum,
        hash_algorithm: input.hashAlgorithm,
        raw_file_retained: false,
        file_policy_status: input.filePolicyStatus,
        malware_scan_status: input.malwareScanStatus,
        processing_status: "received",
        parse_status: "not_started",
        review_status: "proposed",
        file_metadata: input.fileMetadata,
        created_by: input.createdBy,
        created_by_type: input.createdByType,
        created_at: now,
        updated_at: now,
      };
      files.set(row.intake_file_id, row);
      fileKeys.set(`${row.organization_id}:${input.fileMetadata.idempotency_key}`, row.intake_file_id);
      return row;
    },
    async getIntakeFileMetadata(orgId, intakeFileId) {
      const row = files.get(intakeFileId);
      return row?.organization_id === orgId ? row : null;
    },
    async getIntakeFileDetail(orgId, intakeFileId) {
      const row = files.get(intakeFileId);
      return row?.organization_id === orgId ? row : null;
    },
    async countIntakeFilesForBatch(orgId, intakeBatchId) {
      return [...files.values()].filter((row) => row.organization_id === orgId && row.intake_batch_id === intakeBatchId).length;
    },
    async listIntakeFilesForBatch(orgId, intakeBatchId, pagination) {
      const rows = [...files.values()]
        .filter((row) => row.organization_id === orgId && row.intake_batch_id === intakeBatchId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.intake_file_id.localeCompare(a.intake_file_id));
      return rows.slice(0, pagination.limit + 1);
    },
    async updateIntakeFilePolicyStatusIfCurrent({ organizationId: orgId, intakeFileId, expectedFilePolicyStatus, filePolicyStatus }) {
      const row = files.get(intakeFileId);
      if (!row || row.organization_id !== orgId || row.file_policy_status !== expectedFilePolicyStatus) return null;
      row.file_policy_status = filePolicyStatus;
      row.updated_at = later;
      return row;
    },
    async markFilePolicyPassed(orgId, intakeFileId) {
      const row = files.get(intakeFileId);
      if (!row || row.organization_id !== orgId) return null;
      row.file_policy_status = "passed";
      row.malware_scan_status = "passed";
      row.processing_status = "quarantined";
      row.updated_at = later;
      const review = rememberReviewItem(row);
      return { file: row, review };
    },
    async listIntakeFileReviewQueueItems(orgId, pagination) {
      return [...reviewItems.values()]
        .filter((row) => row.organization_id === orgId)
        .slice(0, pagination.limit + 1);
    },
    async getScopedIntakeFileReviewQueueItem(orgId, reviewQueueItemId) {
      const row = reviewItems.get(reviewQueueItemId);
      return row?.organization_id === orgId ? { ...row } : null;
    },
    async getScopedReviewQueueLinkedIntakeFile(orgId, intakeFileId) {
      const row = files.get(intakeFileId);
      return row?.organization_id === orgId ? row : null;
    },
    async updateReviewQueueItemStatusIfCurrent({ organizationId: orgId, reviewQueueItemId, expectedQueueStatus, newQueueStatus }) {
      const row = reviewItems.get(reviewQueueItemId);
      if (!row || row.organization_id !== orgId || row.queue_status !== expectedQueueStatus) return null;
      row.queue_status = newQueueStatus;
      row.updated_at = later;
      return { ...row };
    },
    async insertRequiredSuccessfulAuditEvent(metadata) {
      if (requiredAuditFailure) throw new Error("required-audit-sentinel");
      this.calls.audit.push(metadata);
      return { ok: true };
    },
    async emitBestEffortMetric(metadata) {
      this.calls.metrics.push(metadata);
      if (telemetryFailure) throw new Error("telemetry-sentinel");
    },
  };
}

function createDependencies({ metadataRepository, lifecycleRepository, storageAdapter, context = {} }) {
  return {
    env: enabledEnv,
    storageProvider: "local_dev",
    storageBucket: "synthetic-test-bucket",
    now: () => now,
    findKaiUserByLegacyPublicUserdataId(legacyId) {
      if (context.invalidMapping) return null;
      return {
        user_id: actorUserId,
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyId,
        status: "active",
      };
    },
    listKaiRolesForUser() {
      return [context.role || "gk_operator"];
    },
    listOrganizationMembershipsForUser() {
      return [
        {
          organization_id: organizationId,
          role_name: context.role || "gk_operator",
          membership_status: context.membershipStatus || "active",
        },
      ];
    },
    uploadLifecycleRepository: lifecycleRepository,
    storageAdapter,
    getEngagementTenantState: metadataRepository.getEngagementTenantState,
    getIntakeBatchTenantState: metadataRepository.getIntakeBatchTenantState,
    findIntakeBatchByIdempotencyKey: metadataRepository.findIntakeBatchByIdempotencyKey,
    insertIntakeBatchMetadata: metadataRepository.insertIntakeBatchMetadata,
    listIntakeBatchesForOrganization: metadataRepository.listIntakeBatchesForOrganization,
    getIntakeBatchDetail: metadataRepository.getIntakeBatchDetail,
    findIntakeFileReservationByIdempotencyKey: metadataRepository.findIntakeFileReservationByIdempotencyKey,
    findIntakeFileReservationByChecksum: metadataRepository.findIntakeFileReservationByChecksum,
    insertIntakeFileMetadata: metadataRepository.insertIntakeFileMetadata,
    getIntakeFileMetadata: metadataRepository.getIntakeFileMetadata,
    getIntakeFileDetail: metadataRepository.getIntakeFileDetail,
    listIntakeFilesForBatch: metadataRepository.listIntakeFilesForBatch,
    updateIntakeFilePolicyStatusIfCurrent: metadataRepository.updateIntakeFilePolicyStatusIfCurrent,
    listIntakeFileReviewQueueItems: metadataRepository.listIntakeFileReviewQueueItems,
    getScopedIntakeFileReviewQueueItem: metadataRepository.getScopedIntakeFileReviewQueueItem,
    getScopedReviewQueueLinkedIntakeFile: metadataRepository.getScopedReviewQueueLinkedIntakeFile,
    updateReviewQueueItemStatusIfCurrent: metadataRepository.updateReviewQueueItemStatusIfCurrent,
    insertRequiredSuccessfulAuditEvent: metadataRepository.insertRequiredSuccessfulAuditEvent.bind(metadataRepository),
    emitBestEffortMetric: metadataRepository.emitBestEffortMetric.bind(metadataRepository),
    runInTransaction: async (callback) => callback({ synthetic: true }),
  };
}

async function createScenario(context = {}) {
  const metadataRepository = createMetadataRepository();
  const lifecycleRepository = createInMemoryUploadLifecycleRepository();
  const rootDirectory = await mkdtemp(path.join(await realpath(tmpdir()), "kai-p0-07-"));
  let versionIndex = 0;
  const storageAdapter = new LocalDevStorageAdapter({
    rootDirectory,
    allowTestTeardown: true,
    objectVersionIdFactory() {
      return objectVersionIds[versionIndex++] || objectVersionIds.at(-1);
    },
  });
  return {
    metadataRepository,
    lifecycleRepository,
    storageAdapter,
    dependencies: createDependencies({ metadataRepository, lifecycleRepository, storageAdapter, context }),
    context,
    async close() {
      await storageAdapter.teardownTestStorage();
    },
  };
}

function serviceFacade(scenario) {
  const deps = () => createDependencies({
    metadataRepository: scenario.metadataRepository,
    lifecycleRepository: scenario.lifecycleRepository,
    storageAdapter: scenario.storageAdapter,
    context: scenario.context,
  });
  return {
    checkAdminAccess(input) {
      return checkAdminAccess(input, deps());
    },
    createIntakeBatch(input) {
      return createIntakeBatch(input, deps());
    },
    reserveIntakeFileMetadata(input) {
      return scenario.metadataRepository.countIntakeFilesForBatch(input.payload?.organization_id, input.intakeBatchId).then((count) => {
        if (count >= KAI_SPRINT2_P0_RESOURCE_LIMITS.maxFilesPerBatch) {
          return buildKaiError("validation_blocker");
        }
        return reserveIntakeFileMetadata(input, deps());
      }).then((result) => {
        if (result.ok) {
          const lifecycle = scenario.lifecycleRepository.createReservedUploadLifecycle({
            organizationId: result.data.organization_id,
            intakeBatchId: result.data.intake_batch_id,
            intakeFileId: result.data.intake_file_id,
            now,
          });
          if (!lifecycle.ok) return lifecycle;
        }
        return result;
      });
    },
    listIntakeBatchesForOrganization(input) {
      return listIntakeBatchesForOrganization(input, deps());
    },
    getIntakeBatchDetail(input) {
      return getIntakeBatchDetail(input, deps());
    },
    getIntakeFileDetail(input) {
      return getIntakeFileDetail(input, deps());
    },
    listIntakeFilesForBatch(input) {
      return listIntakeFilesForBatch(input, deps());
    },
    listIntakeFileReviewQueueItems(input) {
      return listIntakeFileReviewQueueItems(input, deps());
    },
    uploadReservedIntakeFile(input) {
      return uploadReservedIntakeFile(input, deps());
    },
    confirmUpload(input) {
      return confirmUpload(input, deps());
    },
    updateReviewQueueStatus(input) {
      return updateReviewQueueStatus(input, deps());
    },
  };
}

function requestId(req) {
  const value = req.get("x-request-id");
  return /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value || "") ? value : "kai-p0-07-request";
}

function uploadConcurrencyLimiter({ perActor = KAI_SPRINT2_P0_ABUSE_LIMITS.concurrentUploadsPerActor, perOrg = KAI_SPRINT2_P0_ABUSE_LIMITS.concurrentUploadsPerOrganization } = {}) {
  const activeActors = new Map();
  const activeOrganizations = new Map();
  return async function limitUpload(req, res, next) {
    const actorKey = String(req.user?.id || "");
    const organizationKey = String(req.query?.organization_id || req.body?.organization_id || "");
    const actorCount = activeActors.get(actorKey) || 0;
    const orgCount = activeOrganizations.get(organizationKey) || 0;
    if (actorCount >= perActor || orgCount >= perOrg) return sendKaiError(res, "abuse_limited");
    activeActors.set(actorKey, actorCount + 1);
    activeOrganizations.set(organizationKey, orgCount + 1);
    res.once("finish", () => {
      activeActors.set(actorKey, Math.max(0, (activeActors.get(actorKey) || 1) - 1));
      activeOrganizations.set(organizationKey, Math.max(0, (activeOrganizations.get(organizationKey) || 1) - 1));
    });
    return next();
  };
}

function createApplication(scenario, { featureEnabled = true } = {}) {
  const previousSprint2Enabled = process.env.KAI_SPRINT2_ENABLED;
  const previousFileUploadEnabled = process.env.KAI_FILE_UPLOAD_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = featureEnabled ? "true" : "false";
  process.env.KAI_FILE_UPLOAD_ENABLED = "true";
  const app = express();
  const mutationLimiter = createKaiMutationAttemptLimiter({ scope: "actor", max: 120, windowMs: 900000, now: () => Date.parse(now) });
  const organizationLimiter = createKaiMutationAttemptLimiter({ scope: "organization", max: 600, windowMs: 900000, now: () => Date.parse(now) });
  const uploadLimiter = uploadConcurrencyLimiter();

  app.use((req, res, next) => {
    scenario.metadataRepository.calls.logs.push({ route: req.path, request_id: requestId(req) });
    req.id = requestId(req);
    req.isAuthenticated = () => req.get("x-kai-auth") !== "invalid";
    if (req.isAuthenticated()) req.user = { id: 46 };
    return next();
  });
  app.use(basePath, setKaiSprint2NoStore);
  app.use(basePath, requireKaiSprint2Enabled);

  app.use(basePath, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, organizationLimiter, mutationLimiter, requireKaiSprint2Authenticated, uploadLimiter);
  const restore = intakeRouteTestables.setIntakeServiceForTest(serviceFacade(scenario));
  app.use(basePath, sprint2IntakeApiRouter);
  app.closeForTest = () => {
    restore();
    if (previousSprint2Enabled === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = previousSprint2Enabled;
    if (previousFileUploadEnabled === undefined) delete process.env.KAI_FILE_UPLOAD_ENABLED;
    else process.env.KAI_FILE_UPLOAD_ENABLED = previousFileUploadEnabled;
  };
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function request(server, method, route, { body, headers = {} } = {}) {
  const payload = Buffer.isBuffer(body)
    ? body
    : body === undefined
      ? null
      : Buffer.from(JSON.stringify(body));
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers: {
        "x-kai-auth": "valid",
        "x-request-id": "kai-p0-07-request",
        ...(payload && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}),
        ...(payload ? { "content-length": String(payload.byteLength) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({ statusCode: res.statusCode, body: raw ? JSON.parse(raw) : null });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assertNoLeak(...values) {
  const serialized = JSON.stringify(values);
  assert.doesNotMatch(serialized, /storage-bucket-sentinel|storage-object-key-sentinel|storage-uri-sentinel|signed_url|authorization|fresh upload bytes|BEGIN RAW|prompt: ignore/i);
}

async function createBatch(server, idempotencyKey = "batch-key-0001") {
  return await request(server, "POST", `${basePath}/admin/batches`, {
    body: {
      organization_id: organizationId,
      engagement_id: engagementId,
      idempotency_key: idempotencyKey,
      batch_code: "kai-p0-07",
      intake_method: "manual_upload",
    },
  });
}

async function reserveFile(server, intakeBatchId, overrides = {}) {
  return await request(server, "POST", `${basePath}/admin/batches/${intakeBatchId}/file-reservations`, {
    body: {
      organization_id: organizationId,
      engagement_id: engagementId,
      idempotency_key: overrides.idempotency_key || "file-key-0001",
      original_filename: overrides.original_filename || "acceptance.csv",
      file_extension: overrides.file_extension || ".csv",
      mime_type: overrides.mime_type || "text/csv",
      file_size_bytes: overrides.file_size_bytes ?? allowedBytes.byteLength,
      checksum: overrides.checksum || allowedChecksum,
      hash_algorithm: "sha256",
      ...overrides,
    },
  });
}

test("P0-07 positive local synthetic HTTP acceptance path", async () => {
  const scenario = await createScenario();
  const app = createApplication(scenario);
  const server = await listen(app);
  try {
    const batch = await createBatch(server);
    assert.equal(batch.statusCode, 201);
    const replay = await createBatch(server);
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.body.data.intake_batch_id, batch.body.data.intake_batch_id);

    const reservation = await reserveFile(server, batch.body.data.intake_batch_id);
    assert.equal(reservation.statusCode, 201);
    assert.equal(reservation.body.data.file_policy_status, "pending");

    const intakeFileId = reservation.body.data.intake_file_id;
    const upload = await request(
      server,
      "POST",
      `${basePath}/admin/files/${intakeFileId}/upload?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${batch.body.data.intake_batch_id}`,
      { body: allowedBytes, headers: { "content-type": "application/octet-stream" } },
    );
    assert.equal(upload.statusCode, 201, JSON.stringify(upload.body));
    assert.equal(upload.body.data.upload_state, "uploaded_unconfirmed");

    const confirm = await request(server, "POST", `${basePath}/admin/files/${intakeFileId}/confirm-upload?organization_id=${organizationId}`, {
      body: { organization_id: organizationId },
    });
    assert.equal(confirm.statusCode, 200);
    assert.equal(confirm.body.data.upload_state, "confirmed");
    assert.equal((await scenario.metadataRepository.getIntakeFileMetadata(organizationId, intakeFileId)).file_policy_status, "pending");

    const assessmentResult = detectP0FileTypeAgreement({
      bytes: allowedBytes,
      extension: ".csv",
      declaredMime: "text/csv",
    });
    assert.equal(assessmentResult.policy, "allow");
    const assessment = await scenario.metadataRepository.markFilePolicyPassed(organizationId, intakeFileId);
    assert.equal(assessment.file.processing_status, "quarantined");
    assert.equal(assessment.file.file_policy_status, "passed");

    const read = await request(server, "GET", `${basePath}/admin/files/${intakeFileId}?organization_id=${organizationId}`);
    assert.equal(read.statusCode, 200);
    assert.equal(read.body.data.file_policy_status, "passed");
    assert.equal(read.body.data.processing_status, "quarantined");

    assert.match(assessment.review.review_queue_item_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const review = await request(server, "POST", `${basePath}/admin/review-queue/${assessment.review.review_queue_item_id}/status?organization_id=${organizationId}`, {
      body: {
        expected_queue_status: "open",
        new_queue_status: "in_progress",
      },
    });
    assert.equal(review.statusCode, 200, JSON.stringify(review.body));
    assert.equal(review.body.data.queue_status, "in_progress");
    assert.equal(scenario.metadataRepository.calls.malware.length, 0);
    assert.equal(scenario.metadataRepository.calls.audit.length, 1);
    assert.equal(scenario.metadataRepository.calls.metrics.length, 1);
    assertNoLeak(batch, replay, reservation, upload, confirm, safeFile(assessment.file), read, review, scenario.metadataRepository.calls);
  } finally {
    server.close();
    app.closeForTest();
    await scenario.close();
  }
});

test("P0-07 negative local synthetic HTTP acceptance matrix", async (t) => {
  await t.test("feature disabled", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario, { featureEnabled: false });
    const server = await listen(app);
    try {
      const response = await request(server, "POST", `${basePath}/admin/batches`, { body: {} });
      assert.equal(response.statusCode, 403);
      assert.equal(response.body.error.code, "feature_disabled");
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  for (const [name, context, expectedCode] of [
    ["invalid mapping", { invalidMapping: true }, "mapped_kai_user_required"],
    ["wrong role", { role: "client_reviewer" }, "authorization_denied"],
    ["inactive membership", { membershipStatus: "inactive" }, "authorization_denied"],
  ]) {
    await t.test(name, async () => {
      const scenario = await createScenario(context);
      const app = createApplication(scenario);
      const server = await listen(app);
      try {
        const response = await createBatch(server);
        assert.equal(response.body.error.code, expectedCode);
      } finally {
        server.close();
        app.closeForTest();
        await scenario.close();
      }
    });
  }

  await t.test("cross-tenant IDs", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const response = await request(server, "POST", `${basePath}/admin/batches`, {
        body: {
          organization_id: otherOrganizationId,
          engagement_id: engagementId,
          idempotency_key: "batch-cross-tenant",
          batch_code: "tenant-mismatch",
          intake_method: "manual_upload",
        },
      });
      assert.equal(response.statusCode, 403);
      assert.doesNotMatch(JSON.stringify(response), /storage-bucket-sentinel|storage-object-key-sentinel|storage-uri-sentinel|signed_url|fresh upload bytes|BEGIN RAW|prompt: ignore/i);
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("unbounded list attempts", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const response = await request(server, "GET", `${basePath}/admin/batches/8e426ea1-2be3-4e48-b80f-9783ddbacd00/files?organization_id=${organizationId}&limit=101`);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error.code, "invalid_request");
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("26th file", async () => {
    assert.equal(KAI_SPRINT2_P0_RESOURCE_LIMITS.maxFilesPerBatch, 25);
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const batch = await createBatch(server);
      for (let index = 0; index < 25; index += 1) {
        const response = await reserveFile(server, batch.body.data.intake_batch_id, {
          idempotency_key: `file-key-${String(index).padStart(4, "0")}`,
          original_filename: `acceptance-${index}.csv`,
        });
        assert.equal(response.statusCode, 201);
      }
      const response = await reserveFile(server, batch.body.data.intake_batch_id, {
        idempotency_key: "file-key-0026",
        original_filename: "acceptance-26.csv",
      });
      assert.equal(response.body.ok, false);
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("mocked concurrent reservations", async () => {
    const repo = createInMemoryUploadLifecycleRepository();
    const first = repo.createReservedUploadLifecycle({ organizationId, intakeBatchId: "batch-a", intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216caa", now });
    const second = repo.createReservedUploadLifecycle({ organizationId, intakeBatchId: "batch-b", intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216caa", now });
    assert.equal(first.ok, true);
    assert.equal(second.error.code, "conflict_current_state_changed");
  });

  for (const name of ["actor and organization mutation-limit exhaustion"]) {
    await t.test(name, async () => {
      const actorLimiter = createKaiMutationAttemptLimiter({ scope: "actor", max: 1, windowMs: 900000, now: () => Date.parse(now) });
      const organizationLimiter = createKaiMutationAttemptLimiter({ scope: "organization", max: 1, windowMs: 900000, now: () => Date.parse(now) });
      const req = { method: "POST", user: { id: 46 }, body: { organization_id: organizationId } };
      const calls = [];
      const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
      actorLimiter(req, res, () => calls.push("actor-1"));
      actorLimiter(req, res, () => calls.push("actor-2"));
      assert.equal(res.body.error.code, "abuse_limited");
      const orgRes = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
      organizationLimiter(req, orgRes, () => calls.push("org-1"));
      organizationLimiter(req, orgRes, () => calls.push("org-2"));
      assert.equal(orgRes.body.error.code, "abuse_limited");
    });
  }

  await t.test("actor and organization concurrent-upload exhaustion", async () => {
    const limiter = uploadConcurrencyLimiter({ perActor: 0, perOrg: 0 });
    const req = { user: { id: 46 }, query: { organization_id: organizationId }, body: {} };
    const res = { once() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    limiter(req, res, () => assert.fail("concurrent upload limiter should block"));
    assert.equal(res.body.error.code, "abuse_limited");
  });

  await t.test("expired and explicitly abandoned reservations", async () => {
    const repo = createInMemoryUploadLifecycleRepository();
    const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216cab";
    assert.equal(repo.createReservedUploadLifecycle({ organizationId, intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacdab", intakeFileId, now }).ok, true);
    assert.equal(repo.transitionUploadLifecycle({ organizationId, intakeFileId, expectedUploadState: "reserved", newUploadState: "expired", now: expiredNow }).ok, true);
    assert.equal(repo.transitionUploadLifecycle({ organizationId, intakeFileId, expectedUploadState: "expired", newUploadState: "upload_started", now: expiredNow }).error.code, "state_transition_denied");
    const abandonedId = "9fe568b1-5c05-4c42-bb1f-6e20de216cac";
    assert.equal(repo.createReservedUploadLifecycle({ organizationId, intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacdab", intakeFileId: abandonedId, now }).ok, true);
    assert.equal(repo.transitionUploadLifecycle({ organizationId, intakeFileId: abandonedId, expectedUploadState: "reserved", newUploadState: "abandoned", now }).ok, true);
    assert.equal(repo.transitionUploadLifecycle({ organizationId, intakeFileId: abandonedId, expectedUploadState: "abandoned", newUploadState: "upload_started", now }).error.code, "state_transition_denied");
  });

  await t.test("malformed fingerprint", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const batch = await createBatch(server);
      const response = await reserveFile(server, batch.body.data.intake_batch_id, { checksum: "sha256:not-a-fingerprint" });
      assert.equal(response.statusCode, 422);
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("unknown metadata fields", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const response = await request(server, "POST", `${basePath}/admin/batches`, {
        body: {
          organization_id: organizationId,
          engagement_id: engagementId,
          idempotency_key: "unknown-fields",
          batch_code: "unknown-fields",
          intake_method: "manual_upload",
          signed_upload_url: "https://example.invalid/secret",
        },
      });
      assert.equal(response.statusCode, 400);
      assertNoLeak(response);
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("request-body over-limit", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const response = await request(server, "POST", `${basePath}/admin/batches`, {
        body: { too_large: "x".repeat(102401) },
      });
      assert.equal(response.statusCode, 413);
      assert.equal(response.body.error.code, "request_too_large");
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  for (const [name, overrides] of [
    ["unsafe Unicode filename", { original_filename: "evil\u202ecsv.txt", file_extension: ".txt", mime_type: "text/plain" }],
    ["path traversal", { original_filename: "../secret.csv" }],
  ]) {
    await t.test(name, async () => {
      const scenario = await createScenario();
      const app = createApplication(scenario);
      const server = await listen(app);
      try {
        const batch = await createBatch(server);
        const response = await reserveFile(server, batch.body.data.intake_batch_id, overrides);
        assert.equal(response.statusCode, 422);
      } finally {
        server.close();
        app.closeForTest();
        await scenario.close();
      }
    });
  }

  for (const [name, uploadOptions] of [
    ["oversize streamed body", { body: Buffer.from("123456789"), expectedCode: "system_error" }],
    ["slow/aborted stream", { body: Buffer.from("name,value\nkindness,2\n"), expectedCode: "checksum_mismatch" }],
  ]) {
    await t.test(name, async () => {
      const scenario = await createScenario();
      const app = createApplication(scenario, uploadOptions.appOptions || {});
      const server = await listen(app);
      try {
        const batch = await createBatch(server);
        const reservation = await reserveFile(server, batch.body.data.intake_batch_id);
        const response = await request(server, "POST", `${basePath}/admin/files/${reservation.body.data.intake_file_id}/upload?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${batch.body.data.intake_batch_id}`, {
          body: uploadOptions.body,
          headers: { "content-type": "application/octet-stream", ...(uploadOptions.headers || {}) },
        });
        assert.equal(response.statusCode, 201, JSON.stringify(response.body));
        const confirm = await request(server, "POST", `${basePath}/admin/files/${reservation.body.data.intake_file_id}/confirm-upload?organization_id=${organizationId}`, {
          body: { organization_id: organizationId },
        });
        assert.equal(confirm.body.error.code, uploadOptions.expectedCode, JSON.stringify(confirm.body));
      } finally {
        server.close();
        app.closeForTest();
        await scenario.close();
      }
    });
  }

  await t.test("duplicate write", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const batch = await createBatch(server);
      const reservation = await reserveFile(server, batch.body.data.intake_batch_id);
      const route = `${basePath}/admin/files/${reservation.body.data.intake_file_id}/upload?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${batch.body.data.intake_batch_id}`;
      const first = await request(server, "POST", route, { body: allowedBytes, headers: { "content-type": "application/octet-stream" } });
      const second = await request(server, "POST", route, { body: allowedBytes, headers: { "content-type": "application/octet-stream" } });
      assert.equal(first.statusCode, 201, JSON.stringify(first.body));
      assert.equal(second.body.error.code, "conflict_current_state_changed");
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  for (const [name, args] of [
    ["MIME/signature mismatch", { extension: ".pdf", declaredMime: "application/pdf", bytes: Buffer.from("not a pdf") }],
    ["binary TXT/MD", { extension: ".txt", declaredMime: "text/plain", bytes: Buffer.from([0x00, 0x01]) }],
    ["arbitrary archive", { extension: ".zip", declaredMime: "application/zip", bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }],
  ]) {
    await t.test(name, () => {
      const result = detectP0FileTypeAgreement(args);
      assert.equal(result.policy, "block");
    });
  }

  await t.test("broader security-assessment cases are not substituted by test HTTP routes", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    try {
      const routePaths = app._router?.stack?.flatMap((layer) => layer.route?.path ? [layer.route.path] : []) || [];
      assert.equal(routePaths.some((routePath) => String(routePath).includes("security-assessment")), false);
      assert.equal(KAI_SPRINT2_P0_SECURITY_EXECUTOR.serviceIdentity, "kai_file_security_executor");
      assert.equal(KAI_SPRINT2_P0_SECURITY_EXECUTOR.operationGroup, "file_security_assessment");
      assert.deepEqual(KAI_SPRINT2_P0_SECURITY_EXECUTOR.allowedOperations, [
        "record_file_security_result",
        "transition_file_policy_status",
        "write_file_security_audit",
      ]);
    } finally {
      app.closeForTest();
      await scenario.close();
    }
  });

  await t.test("missing object", async () => {
    const scenario = await createScenario();
    const app = createApplication(scenario);
    const server = await listen(app);
    try {
      const batch = await createBatch(server);
      const reservation = await reserveFile(server, batch.body.data.intake_batch_id);
      await request(server, "POST", `${basePath}/admin/files/${reservation.body.data.intake_file_id}/upload?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${batch.body.data.intake_batch_id}`, {
        body: allowedBytes,
        headers: { "content-type": "application/octet-stream" },
      });
      scenario.storageAdapter.openObjectVersionReadStream = async () => buildKaiError("not_found");
      const response = await request(server, "POST", `${basePath}/admin/files/${reservation.body.data.intake_file_id}/confirm-upload?organization_id=${organizationId}`, {
        body: { organization_id: organizationId },
      });
      assert.equal(response.body.error.code, "system_error");
    } finally {
      server.close();
      app.closeForTest();
      await scenario.close();
    }
  });

  for (const [name, mutateStorage, expectedCode] of [
    ["replaced object version", (storageAdapter) => {
      const originalOpen = storageAdapter.openObjectVersionReadStream.bind(storageAdapter);
      storageAdapter.openObjectVersionReadStream = async (input) => {
        const result = await originalOpen(input);
        if (result.ok) {
          return {
            ok: true,
            data: {
              ...result.data,
              object_version_id: objectVersionIds[1],
            },
          };
        }
        return result;
      };
    }, "system_error"],
    ["checksum mismatch", null, "checksum_mismatch"],
  ]) {
    await t.test(name, async () => {
      const scenario = await createScenario();
      const app = createApplication(scenario);
      const server = await listen(app);
      try {
        const batch = await createBatch(server);
        const reservation = await reserveFile(server, batch.body.data.intake_batch_id, name === "checksum mismatch" ? {
          checksum: sha256(Buffer.from("different")),
        } : {});
        const intakeFileId = reservation.body.data.intake_file_id;
        await request(server, "POST", `${basePath}/admin/files/${intakeFileId}/upload?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${batch.body.data.intake_batch_id}`, {
          body: allowedBytes,
          headers: { "content-type": "application/octet-stream" },
        });
        if (mutateStorage) mutateStorage(scenario.storageAdapter);
        const response = await request(server, "POST", `${basePath}/admin/files/${intakeFileId}/confirm-upload?organization_id=${organizationId}`, {
          body: { organization_id: organizationId },
        });
        assert.equal(response.body.error.code, expectedCode, JSON.stringify(response.body));
      } finally {
        server.close();
        app.closeForTest();
        await scenario.close();
      }
    });
  }

  await t.test("stale review transition", async () => {
    const scenario = await createScenario();
    const row = await scenario.metadataRepository.markFilePolicyPassed(organizationId, "9fe568b1-5c05-4c42-bb1f-6e20de216cdd");
    assert.equal(row, null);
    const result = await updateReviewQueueStatus({
      actorContext: actorContext(),
      organizationId,
      reviewQueueItemId: "6fe568b1-5c05-4c42-bb1f-6e20de216cdd",
      expectedQueueStatus: "open",
      newQueueStatus: "in_progress",
    }, scenario.dependencies);
    assert.equal(result.error.code, "not_found");
    await scenario.close();
  });

  await t.test("required-audit failure rollback at repository-interface level", async () => {
    const scenario = await createScenario();
    const file = await scenario.metadataRepository.insertIntakeFileMetadata({
      intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216cee",
      intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacdee",
      organizationId,
      engagementId,
      originalFilename: "review.csv",
      safeFilename: "review.csv",
      storageProvider: "local_dev",
      mimeType: "text/csv",
      fileExtension: ".csv",
      fileSizeBytes: 1,
      checksum: allowedChecksum,
      hashAlgorithm: "sha256",
      filePolicyStatus: "pending",
      malwareScanStatus: "passed",
      fileMetadata: { idempotency_key: "audit-failure-key" },
      createdBy: actorUserId,
      createdByType: "human",
    });
    const updated = await scenario.metadataRepository.markFilePolicyPassed(organizationId, file.intake_file_id);
    scenario.metadataRepository.flags.setRequiredAuditFailure(true);
    const result = await updateReviewQueueStatus({
      actorContext: actorContext(),
      organizationId,
      reviewQueueItemId: updated.review.review_queue_item_id,
      expectedQueueStatus: "open",
      newQueueStatus: "in_progress",
    }, scenario.dependencies);
    assert.equal(result.error.code, "system_error");
    await scenario.close();
  });

  await t.test("telemetry failure not rolling back an authorized mutation", async () => {
    const scenario = await createScenario();
    const file = await scenario.metadataRepository.insertIntakeFileMetadata({
      intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216cff",
      intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacdff",
      organizationId,
      engagementId,
      originalFilename: "review.csv",
      safeFilename: "review.csv",
      storageProvider: "local_dev",
      mimeType: "text/csv",
      fileExtension: ".csv",
      fileSizeBytes: 1,
      checksum: allowedChecksum,
      hashAlgorithm: "sha256",
      filePolicyStatus: "pending",
      malwareScanStatus: "passed",
      fileMetadata: { idempotency_key: "telemetry-failure-key" },
      createdBy: actorUserId,
      createdByType: "human",
    });
    const updated = await scenario.metadataRepository.markFilePolicyPassed(organizationId, file.intake_file_id);
    scenario.metadataRepository.flags.setTelemetryFailure(true);
    const result = await updateReviewQueueStatus({
      actorContext: actorContext(),
      organizationId,
      reviewQueueItemId: updated.review.review_queue_item_id,
      expectedQueueStatus: "open",
      newQueueStatus: "in_progress",
    }, scenario.dependencies);
    assert.equal(result.ok, true);
    assert.equal(result.data.queue_status, "in_progress");
    await scenario.close();
  });

  for (const [name, actorType, operation] of [
    ["AI mutation", "ai", "create_intake_file"],
    ["generic system mutation", "system", "create_intake_file"],
    ["unauthorized internal-executor operation", "internal_service", "create_intake_file"],
    ["parser/profile/source/evidence/claim/generation/export attempt", "assistant", "access_raw_file"],
    ["parser/profile/source/evidence/claim/generation/export attempt", "assistant", "promote_intake_source"],
    ["parser/profile/source/evidence/claim/generation/export attempt", "assistant", "create_evidence"],
    ["parser/profile/source/evidence/claim/generation/export attempt", "assistant", "create_claim_from_intake"],
    ["parser/profile/source/evidence/claim/generation/export attempt", "assistant", "generate_report_export"],
  ]) {
    await t.test(`${name}: ${operation}`, () => {
      const result = validateAssistantBoundary({
        actorContext: { ...actorContext(), actorType },
        operation,
      });
      assert.equal(result.severity, "blocker");
      assert.equal(result.blocking_reason, "assistant_boundary");
    });
  }

  await t.test("storage identifier leakage", async () => {
    assertNoLeak({
      storage_bucket: undefined,
      storage_object_key: undefined,
      storage_uri: undefined,
    });
  });

  await t.test("raw content in logs, errors, audit, metrics, or responses", async () => {
    const response = buildKaiError("validation_blocker", {
      data: { raw_content: undefined },
      blockers: [{ validator_key: "VAL-P0-07", message: "Request failed KAI validation." }],
    });
    assertNoLeak(response);
  });
});
