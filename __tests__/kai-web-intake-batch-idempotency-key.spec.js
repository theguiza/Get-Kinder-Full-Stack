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
test("resolveFileReservationIdempotencyKey reuses the key only for a retry of the same selection, batch, checksum, and new-version intent", () => {
  const checksumA = "a".repeat(64);
  const checksumB = "b".repeat(64);
  const batchA = "00000000-0000-4000-8000-000000000003";
  const batchB = "00000000-0000-4000-8000-000000000004";
  const existingFileId = "00000000-0000-4000-8000-000000000009";

  const first = resolveFileReservationIdempotencyKey(null, { selectionId: 1, intakeBatchId: batchA, checksum: checksumA });
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test(first.key), true);
  assert.equal(first.key.includes(checksumA), false, "the key is not derived from the checksum");

  // Retry of the SAME logical reservation reuses the identity unchanged.
  const retry = resolveFileReservationIdempotencyKey(first, { selectionId: 1, intakeBatchId: batchA, checksum: checksumA });
  assert.equal(retry, first, "an unchanged identity must be returned as-is, not rebuilt");

  // Each of these is a new intent and must mint a new key.
  const intents = [
    resolveFileReservationIdempotencyKey(first, { selectionId: 1, intakeBatchId: batchA, checksum: checksumB }),
    resolveFileReservationIdempotencyKey(first, { selectionId: 1, intakeBatchId: batchB, checksum: checksumA }),
    // Choosing the same bytes again is a new selection, not a replay.
    resolveFileReservationIdempotencyKey(first, { selectionId: 2, intakeBatchId: batchA, checksum: checksumA }),
    resolveFileReservationIdempotencyKey(first, {
      selectionId: 1,
      intakeBatchId: batchA,
      checksum: checksumA,
      duplicateOfIntakeFileId: existingFileId,
    }),
  ];
  const keys = new Set([first.key, ...intents.map((identity) => identity.key)]);
  assert.equal(keys.size, 5, "every new intent must use a distinct key");

  // A retry of the new-version intent reuses that intent's key.
  const newVersion = intents[3];
  assert.equal(
    resolveFileReservationIdempotencyKey(newVersion, {
      selectionId: 1,
      intakeBatchId: batchA,
      checksum: checksumA,
      duplicateOfIntakeFileId: existingFileId,
    }),
    newVersion,
  );

  // The minted key is injected, so it is deterministic under test.
  const deterministic = resolveFileReservationIdempotencyKey(
    null,
    { selectionId: 7, intakeBatchId: batchA, checksum: checksumA },
    () => "0123456789abcdef0123456789abcdef",
  );
  assert.equal(deterministic.key, "file-0123456789abcdef0123456789abcdef");
});

test("KaiWebIntake holds one idempotency key per file-reservation intent in a ref distinct from batch-create, hashes the current selection, sends the key, and clears it only after the confirmed end-to-end success", () => {
  const uiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  assert.match(uiSource, /const fileReservationIdempotencyKeyRef = useRef\(null\);/);
  assert.match(uiSource, /const fileReservationIdentityRef = useRef\(null\);/);
  // Every file-input change starts a new selection and drops any resolution.
  assert.match(
    uiSource,
    /setFile\(event\.target\.files\?\.\[0\] \|\| null\);\s*setFileSelectionId\(\(value\) => value \+ 1\);\s*setDuplicateResolution\(null\);/,
  );

  const reserveAndUploadBody = uiSource.slice(
    uiSource.indexOf("const reserveAndUpload = useCallback"),
    uiSource.indexOf("[organizationId, engagementId, intakeBatchId, file, fileSelectionId, transferAndConfirm]"),
  );
  const transferBody = uiSource.slice(
    uiSource.indexOf("const transferAndConfirm = useCallback"),
    uiSource.indexOf("const reserveAndUpload = useCallback"),
  );

  assert.match(uiSource, /import \{[\s\S]*?resolveFileReservationIdempotencyKey[\s\S]*?\} from "\.\/kaiWebIntakeLogic\.js";/);
  assert.match(
    reserveAndUploadBody,
    /fileReservationIdentityRef\.current = resolveFileReservationIdempotencyKey\(\s*fileReservationIdentityRef\.current,\s*\{ selectionId, intakeBatchId, checksum, duplicateOfIntakeFileId \},\s*\);/,
  );
  assert.match(reserveAndUploadBody, /fileReservationIdempotencyKeyRef\.current = fileReservationIdentityRef\.current\.key;/);

  const selectionIndex = reserveAndUploadBody.indexOf("const selectedFile = file;");
  const checksumIndex = reserveAndUploadBody.indexOf("const checksum = await sha256HexOfFile(selectedFile)");
  const resolveIndex = reserveAndUploadBody.indexOf("resolveFileReservationIdempotencyKey(");
  const postIndex = reserveAndUploadBody.indexOf("postJson(fileReservationsPath(intakeBatchId)");
  assert.ok(
    selectionIndex > -1 && checksumIndex > selectionIndex && resolveIndex > checksumIndex && postIndex > resolveIndex,
    "the current selection is hashed, then the key resolved, before the reservation POST",
  );

  assert.match(reserveAndUploadBody, /idempotency_key: fileReservationIdempotencyKeyRef\.current,/);
  assert.match(reserveAndUploadBody, /organization_id: organizationId,/);
  assert.match(reserveAndUploadBody, /engagement_id: engagementId,/);
  assert.match(reserveAndUploadBody, /original_filename: selectedFile\.name,/);
  assert.match(reserveAndUploadBody, /file_extension: fileExtensionOf\(selectedFile\.name\),/);
  assert.match(reserveAndUploadBody, /mime_type: declaredMimeTypeForFile\(selectedFile\),/);
  assert.match(reserveAndUploadBody, /file_size_bytes: selectedFile\.size,/);
  assert.match(reserveAndUploadBody, /checksum,/);
  assert.match(reserveAndUploadBody, /hash_algorithm: "sha256",/);
  // force_new_version is sent only with the existing file the actor chose.
  assert.match(
    reserveAndUploadBody,
    /duplicateOfIntakeFileId\s*\?\s*\{ force_new_version: true, duplicate_of_intake_file_id: duplicateOfIntakeFileId \}\s*:\s*\{\}/,
  );

  // A reservation-POST failure must NOT clear the key: it can be replayed.
  const reservationFailureGateIndex = reserveAndUploadBody.indexOf(
    "if (reserveResult.statusCode !== 201 && reserveResult.statusCode !== 200) {",
  );
  const reservationFailureBlock = reserveAndUploadBody.slice(
    reservationFailureGateIndex,
    reserveAndUploadBody.indexOf("const reservedFileId ="),
  );
  assert.ok(!reservationFailureBlock.includes("fileReservationIdempotencyKeyRef.current = null"), "the reservation key must survive a reservation failure");

  // Upload-url, PUT, and confirm stages report failure without clearing the key.
  for (const gate of [
    "if (uploadUrlResult.statusCode !== 200 || !uploadUrlResult.body?.ok) {",
    "if (!putResult.ok) {",
    "if (confirmResult.statusCode !== 200) {",
  ]) {
    assert.ok(transferBody.includes(gate), `expected transfer stage gate: ${gate}`);
  }
  assert.ok(!transferBody.includes("fileReservationIdempotencyKeyRef.current = null"));

  const transferFailureIndex = reserveAndUploadBody.indexOf("if (!transfer.ok) {");
  const clearIdentityIndex = reserveAndUploadBody.indexOf("fileReservationIdentityRef.current = null;");
  const clearKeyIndex = reserveAndUploadBody.indexOf("fileReservationIdempotencyKeyRef.current = null;");
  const successMessageIndex = reserveAndUploadBody.indexOf('"File reserved, uploaded, and confirmed."');
  assert.ok(
    transferFailureIndex > postIndex
      && clearIdentityIndex > transferFailureIndex
      && clearKeyIndex > transferFailureIndex
      && clearKeyIndex < successMessageIndex,
    "the reservation identity and key must be cleared only after the confirmed transfer, right before the success message",
  );

  assert.ok(!reserveAndUploadBody.includes("createBatchIdempotencyKeyRef"), "reservation must not reuse the batch-create idempotency key");
});
