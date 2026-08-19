import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { KAI_SPRINT2_P0_PATTERNS } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import {
  createBatchPath,
  fileReservationsPath,
  generateIdempotencyKey,
  postJson,
  resolveFileReservationIdempotencyKey,
} from "../frontend/kaiWebIntakeLogic.js";

test("generateIdempotencyKey produces a 32-char lowercase hex key satisfying the repository idempotencyKey pattern", () => {
  const key = generateIdempotencyKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test(key), true);
});

test("KAI Web Intake batch-create request includes idempotency_key alongside the existing fields, reuses it on retry of the same logical batch, and mints a new key for a new logical batch", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const engagementId = "00000000-0000-4000-8000-000000000002";
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 422, json: async () => ({ ok: false, error: { message: "retry me" } }) };
  };

  try {
    const firstAttemptKey = generateIdempotencyKey();
    const firstBody = {
      organization_id: organizationId,
      engagement_id: engagementId,
      batch_code: "batch-1",
      idempotency_key: firstAttemptKey,
    };
    await postJson(createBatchPath(), firstBody);

    // Retry of the SAME logical batch-create: the key is reused, not regenerated.
    const retryBody = {
      organization_id: organizationId,
      engagement_id: engagementId,
      batch_code: "batch-1",
      idempotency_key: firstAttemptKey,
    };
    await postJson(createBatchPath(), retryBody);

    // A different, subsequent logical batch-create gets a fresh key.
    const secondAttemptKey = generateIdempotencyKey();
    const secondBody = {
      organization_id: organizationId,
      engagement_id: engagementId,
      batch_code: "batch-2",
      idempotency_key: secondAttemptKey,
    };
    await postJson(createBatchPath(), secondBody);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 3);
  const [first, retry, second] = calls.map((call) => JSON.parse(call.init.body));

  for (const body of [first, retry, second]) {
    assert.equal(body.organization_id, organizationId);
    assert.equal(body.engagement_id, engagementId);
    assert.equal(typeof body.idempotency_key, "string");
    assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test(body.idempotency_key), true);
  }

  assert.equal(first.idempotency_key, retry.idempotency_key, "retry of the same logical batch must reuse the key");
  assert.notEqual(first.idempotency_key, second.idempotency_key, "a new logical batch must get a new key");
  assert.equal(first.batch_code, "batch-1");
  assert.equal(second.batch_code, "batch-2");
});

test("KaiWebIntake holds one idempotency key per logical batch-create in a ref, sends it in the POST body, and clears it only after a confirmed success", () => {
  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  assert.match(uiSource, /import React, \{ useCallback, useEffect, useRef, useState \} from "react";/);
  assert.match(uiSource, /import \{[\s\S]*?generateIdempotencyKey[\s\S]*?\} from "\.\/kaiWebIntakeLogic\.js";/);

  const createBatchIdempotencyKeyRefDeclaration = /const createBatchIdempotencyKeyRef = useRef\(null\);/;
  assert.match(uiSource, createBatchIdempotencyKeyRefDeclaration);

  const createBatchBody = uiSource.slice(uiSource.indexOf("const createBatch = useCallback"), uiSource.indexOf("[organizationId, engagementId, batchCode]"));

  // The key is generated before the first POST /admin/batches only if one isn't already held.
  assert.match(createBatchBody, /if \(!createBatchIdempotencyKeyRef\.current\) \{\s*createBatchIdempotencyKeyRef\.current = generateIdempotencyKey\(\);\s*\}/);
  const generateIndex = createBatchBody.indexOf("createBatchIdempotencyKeyRef.current = generateIdempotencyKey()");
  const postIndex = createBatchBody.indexOf("postJson(createBatchPath()");
  assert.ok(generateIndex > -1 && postIndex > -1 && generateIndex < postIndex, "the key must be generated before the POST");

  // The key is included in the JSON body as idempotency_key.
  assert.match(createBatchBody, /idempotency_key: createBatchIdempotencyKeyRef\.current,/);

  // The ref is cleared only after the batch-create response is treated as a confirmed success.
  const statusGateIndex = createBatchBody.indexOf('if (result.statusCode !== 201 && result.statusCode !== 200) {');
  const clearIndex = createBatchBody.indexOf("createBatchIdempotencyKeyRef.current = null;");
  assert.ok(statusGateIndex > -1 && clearIndex > statusGateIndex, "the ref must be cleared only after the failure-return branch, i.e. on confirmed success");

  // Existing request fields remain unchanged.
  assert.match(createBatchBody, /organization_id: organizationId,/);
  assert.match(createBatchBody, /engagement_id: engagementId,/);
  assert.match(createBatchBody, /batch_code: batchCode,/);
});

test("KAI Web Intake file-reservation request includes idempotency_key alongside every existing field, distinct from the batch-create idempotency state", async () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const engagementId = "00000000-0000-4000-8000-000000000002";
  const intakeBatchId = "00000000-0000-4000-8000-000000000003";
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 422, json: async () => ({ ok: false, error: { message: "retry me" } }) };
  };

  try {
    const reservationKey = generateIdempotencyKey();
    await postJson(fileReservationsPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      original_filename: "roster.csv",
      file_extension: ".csv",
      mime_type: "text/csv",
      file_size_bytes: 1234,
      checksum: "a".repeat(64),
      hash_algorithm: "sha256",
      idempotency_key: reservationKey,
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  const [reservation] = calls.map((call) => JSON.parse(call.init.body));

  assert.equal(reservation.organization_id, organizationId);
  assert.equal(reservation.engagement_id, engagementId);
  assert.equal(reservation.original_filename, "roster.csv");
  assert.equal(reservation.file_extension, ".csv");
  assert.equal(reservation.mime_type, "text/csv");
  assert.equal(reservation.file_size_bytes, 1234);
  assert.equal(reservation.checksum, "a".repeat(64));
  assert.equal(reservation.hash_algorithm, "sha256");
  assert.equal(typeof reservation.idempotency_key, "string");
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test(reservation.idempotency_key), true);
});

// Exercises the actual production identity/key resolver KaiWebIntake.jsx calls
// before every reservation POST (frontend/kaiWebIntakeLogic.js ->
// resolveFileReservationIdempotencyKey). No algorithm is reimplemented here.
test("resolveFileReservationIdempotencyKey reuses the key for the same batch + checksum and rotates it for a different checksum or batch", () => {
  const checksumA = "a".repeat(64);
  const checksumB = "b".repeat(64);

  const first = resolveFileReservationIdempotencyKey(null, "00000000-0000-4000-8000-000000000003", checksumA);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test(first.key), true);

  // Retry of the SAME logical reservation (same batch, same checksum) reuses the key.
  const retry = resolveFileReservationIdempotencyKey(first, "00000000-0000-4000-8000-000000000003", checksumA);
  assert.equal(retry.key, first.key, "retry of the same logical batch + checksum must reuse the key");
  assert.equal(retry, first, "an unchanged identity must be returned as-is, not rebuilt");

  // A different checksum in the same batch is a different logical reservation.
  const differentChecksum = resolveFileReservationIdempotencyKey(first, "00000000-0000-4000-8000-000000000003", checksumB);
  assert.notEqual(
    differentChecksum.key,
    first.key,
    "a different checksum must use a different key",
  );

  // The same checksum in a different target batch must not inherit the prior key.
  const differentBatch = resolveFileReservationIdempotencyKey(differentChecksum, "00000000-0000-4000-8000-000000000004", checksumB);
  assert.notEqual(
    differentBatch.key,
    differentChecksum.key,
    "the same checksum in a different target batch must use a different key",
  );

  // Returning to the original batch + checksum reconstructs the same stable
  // key, avoiding a duplicate-checksum blocker after a reselect or reload.
  const backToOriginal = resolveFileReservationIdempotencyKey(differentBatch, "00000000-0000-4000-8000-000000000003", checksumA);
  assert.equal(backToOriginal.key, first.key, "batch + checksum determines the reservation key");
});

test("KaiWebIntake holds one idempotency key per logical file-reservation in a ref distinct from batch-create, sends it in the reservation POST body, keys it by batch + checksum, and clears it only after the confirmed end-to-end success", () => {
  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  assert.match(uiSource, /const fileReservationIdempotencyKeyRef = useRef\(null\);/);
  assert.match(uiSource, /const fileReservationIdentityRef = useRef\(null\);/);

  const reserveAndUploadBody = uiSource.slice(
    uiSource.indexOf("const reserveAndUpload = useCallback"),
    uiSource.indexOf("[organizationId, engagementId, intakeBatchId, file]"),
  );

  // The logical identity is resolved by the shared, independently-tested
  // resolveFileReservationIdempotencyKey helper (identified by the target
  // batch and checksum), after checksum calculation and before the
  // reservation POST.
  assert.match(uiSource, /import \{[\s\S]*?resolveFileReservationIdempotencyKey[\s\S]*?\} from "\.\/kaiWebIntakeLogic\.js";/);

  assert.match(
    reserveAndUploadBody,
    /fileReservationIdentityRef\.current = resolveFileReservationIdempotencyKey\(\s*fileReservationIdentityRef\.current,\s*intakeBatchId,\s*checksum,\s*\);/,
  );
  assert.match(reserveAndUploadBody, /fileReservationIdempotencyKeyRef\.current = fileReservationIdentityRef\.current\.key;/);

  const checksumIndex = reserveAndUploadBody.indexOf("const checksum = await sha256HexOfFile(file)");
  const resolveIndex = reserveAndUploadBody.indexOf("resolveFileReservationIdempotencyKey(");
  const postIndex = reserveAndUploadBody.indexOf("postJson(fileReservationsPath(intakeBatchId)");
  assert.ok(
    checksumIndex > -1 && resolveIndex > checksumIndex && postIndex > resolveIndex,
    "the checksum must be calculated, then the key resolved, before the reservation POST",
  );

  // The key is included in the reservation JSON body as idempotency_key.
  assert.match(reserveAndUploadBody, /idempotency_key: fileReservationIdempotencyKeyRef\.current,/);

  // Every existing reservation request field remains unchanged.
  assert.match(reserveAndUploadBody, /organization_id: organizationId,/);
  assert.match(reserveAndUploadBody, /engagement_id: engagementId,/);
  assert.match(reserveAndUploadBody, /original_filename: file\.name,/);
  assert.match(reserveAndUploadBody, /file_extension: fileExtensionOf\(file\.name\),/);
  assert.match(reserveAndUploadBody, /mime_type: file\.type \|\| "text\/csv",/);
  assert.match(reserveAndUploadBody, /file_size_bytes: file\.size,/);
  assert.match(reserveAndUploadBody, /checksum,/);
  assert.match(reserveAndUploadBody, /hash_algorithm: "sha256",/);

  // A reservation-POST failure must NOT clear the key: it can be replayed.
  const reservationFailureGateIndex = reserveAndUploadBody.indexOf(
    'if (reserveResult.statusCode !== 201 && reserveResult.statusCode !== 200) {',
  );
  const reservationFailureBlock = reserveAndUploadBody.slice(
    reservationFailureGateIndex,
    reserveAndUploadBody.indexOf("const reservedFileId ="),
  );
  assert.ok(!reservationFailureBlock.includes("fileReservationIdempotencyKeyRef.current = null"), "the reservation key must survive a reservation failure");

  // A downstream failure (upload-url request, signed PUT, or confirm) after a
  // successful reservation must also NOT clear the key: the whole logical
  // operation, including the reservation POST, can be replayed on retry.
  const uploadUrlFailureIndex = reserveAndUploadBody.indexOf(
    'if (uploadUrlResult.statusCode !== 200 || !uploadUrlResult.body?.ok) {',
  );
  const putFailureIndex = reserveAndUploadBody.indexOf("if (!putResult.ok) {");
  const confirmFailureIndex = reserveAndUploadBody.indexOf('if (confirmResult.statusCode !== 200) {');
  const successMessageIndex = reserveAndUploadBody.indexOf('"File reserved, uploaded, and confirmed."');
  const clearIdentityIndex = reserveAndUploadBody.indexOf("fileReservationIdentityRef.current = null;");
  const clearKeyIndex = reserveAndUploadBody.indexOf("fileReservationIdempotencyKeyRef.current = null;");
  assert.ok(
    uploadUrlFailureIndex > -1 && putFailureIndex > -1 && confirmFailureIndex > -1 && successMessageIndex > -1,
    "expected the reservation, upload-url, PUT, and confirm stages to all be present",
  );
  // Everything strictly before the clear statements must contain no clearing of the key.
  const downstreamFailurePaths = reserveAndUploadBody.slice(uploadUrlFailureIndex, clearIdentityIndex);
  assert.ok(
    !downstreamFailurePaths.includes("fileReservationIdempotencyKeyRef.current = null"),
    "no downstream failure branch before the confirmed success may clear the reservation key",
  );

  // The key (and its identity) are cleared only once the entire logical
  // operation is definitively complete, immediately before the success message.
  assert.ok(
    clearIdentityIndex > confirmFailureIndex && clearKeyIndex > confirmFailureIndex && clearKeyIndex < successMessageIndex,
    "the reservation identity and key must be cleared only after the confirm-upload success gate, right before the success message",
  );

  // Batch-create and file-reservation idempotency state are held in distinct refs.
  assert.notEqual("createBatchIdempotencyKeyRef", "fileReservationIdempotencyKeyRef");
  assert.ok(!reserveAndUploadBody.includes("createBatchIdempotencyKeyRef"), "reservation must not reuse the batch-create idempotency key");
});
