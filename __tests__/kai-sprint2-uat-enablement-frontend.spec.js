import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  canCompleteClaimReview,
  canCompleteEvidenceReview,
  claimGapFollowupsPath,
  claimProposalPath,
  claimReviewCompletePath,
  coverageInternalAcceptancePath,
  evidenceCoverageAssessmentPath,
  evidenceExtractionPath,
  evidenceReviewCompletePath,
  potentialConflictsPath,
  postJson,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  batchFilesPath,
  confirmUploadPath,
  createBatchRequestBody,
  createBatchPath,
  engagementsPath,
  fileDetailPath,
  fileReservationRequestBody,
  fileReservationsPath,
  organizationsPath,
  putToSignedUrl,
  requestUploadUrlPath,
} from "../frontend/kaiWebIntakeLogic.js";
import {
  canCompleteClientFollowup,
  clientFollowupCompletePath,
  clientFollowupsPath,
} from "../frontend/kaiClientFollowupReviewLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementId = "00000000-0000-4000-8000-000000000002";
const claimId = "00000000-0000-4000-8000-000000000101";
const secondClaimId = "00000000-0000-4000-8000-000000000102";
const evidenceItemId = "00000000-0000-4000-8000-000000000201";
const sourceVersionId = "00000000-0000-4000-8000-000000000301";
const intakeBatchId = "00000000-0000-4000-8000-000000000401";
const intakeFileId = "00000000-0000-4000-8000-000000000501";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mountedRoutePaths(methods) {
  return sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route && layer.route.methods && methods.every((method) => layer.route.methods[method]))
    .map((layer) => layer.route.path);
}

test("KAI UAT-enablement claim/evidence governance frontend paths reuse the exact existing mounted P2 routes", () => {
  const postPaths = mountedRoutePaths(["post"]);
  const getPaths = mountedRoutePaths(["get"]);

  assert.ok(postPaths.includes("/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-extraction"));
  assert.ok(getPaths.includes("/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-coverage-assessment"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/evidence-items/:evidenceItemId/claim-proposal"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/claims/:claimId/claim-gap-followups"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/claims/:firstClaimId/potential-conflicts/:secondClaimId"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/claims/:claimId/coverage-dimensions/:dimensionKey/internal-acceptance"));

  assert.equal(
    evidenceExtractionPath(organizationId, sourceVersionId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/source-versions/${sourceVersionId}/evidence-extraction`,
  );
  assert.equal(
    evidenceCoverageAssessmentPath(organizationId, sourceVersionId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/source-versions/${sourceVersionId}/evidence-coverage-assessment`,
  );
  assert.equal(
    claimProposalPath(organizationId, evidenceItemId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/evidence-items/${evidenceItemId}/claim-proposal`,
  );
  assert.equal(
    claimGapFollowupsPath(organizationId, claimId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claims/${claimId}/claim-gap-followups`,
  );
  assert.equal(
    potentialConflictsPath(organizationId, claimId, secondClaimId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claims/${claimId}/potential-conflicts/${secondClaimId}`,
  );
  assert.equal(
    coverageInternalAcceptancePath(organizationId, claimId, "definition_clarity"),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claims/${claimId}/coverage-dimensions/definition_clarity/internal-acceptance`,
  );
});

test("KAI UAT-enablement governance mutation calls send only an empty body, matching the routes' empty-body requirement", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, data: {} }) };
  };
  try {
    await postJson(evidenceExtractionPath(organizationId, sourceVersionId), {});
    await postJson(claimProposalPath(organizationId, evidenceItemId), {});
    await postJson(claimGapFollowupsPath(organizationId, claimId), {});
    await postJson(potentialConflictsPath(organizationId, claimId, secondClaimId), {});
    await postJson(coverageInternalAcceptancePath(organizationId, claimId, "definition_clarity"), {});
  } finally {
    global.fetch = originalFetch;
  }
  for (const call of calls) {
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(call.init.body), {});
  }
});

test("KAI UAT-enablement web-intake frontend paths reuse the exact existing mounted intake routes", () => {
  const postPaths = mountedRoutePaths(["post"]);
  const getPaths = mountedRoutePaths(["get"]);

  assert.ok(postPaths.includes("/admin/batches"));
  assert.ok(postPaths.includes("/admin/batches/:intakeBatchId/file-reservations"));
  assert.ok(postPaths.includes("/admin/batches/:intakeBatchId/files/upload-url"));
  assert.ok(postPaths.includes("/admin/files/:intakeFileId/confirm-upload"));
  assert.ok(getPaths.includes("/admin/batches/:intakeBatchId/files"));
  assert.ok(getPaths.includes("/admin/files/:intakeFileId"));
  assert.ok(getPaths.includes("/admin/organizations/:organizationId/engagements"));
  assert.ok(getPaths.includes("/admin/organizations"));

  assert.equal(organizationsPath(), "/api/kai/sprint2/intake/admin/organizations");
  assert.equal(createBatchPath(), "/api/kai/sprint2/intake/admin/batches");
  assert.equal(
    fileReservationsPath(intakeBatchId),
    `/api/kai/sprint2/intake/admin/batches/${intakeBatchId}/file-reservations`,
  );
  assert.equal(
    requestUploadUrlPath(intakeBatchId),
    `/api/kai/sprint2/intake/admin/batches/${intakeBatchId}/files/upload-url`,
  );
  assert.equal(
    confirmUploadPath(organizationId, intakeFileId),
    `/api/kai/sprint2/intake/admin/files/${intakeFileId}/confirm-upload?organization_id=${organizationId}`,
  );
  assert.equal(
    batchFilesPath(organizationId, intakeBatchId),
    `/api/kai/sprint2/intake/admin/batches/${intakeBatchId}/files?organization_id=${organizationId}`,
  );
  assert.equal(
    fileDetailPath(organizationId, intakeFileId),
    `/api/kai/sprint2/intake/admin/files/${intakeFileId}?organization_id=${organizationId}`,
  );
  assert.equal(
    engagementsPath(organizationId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements`,
  );
});

test("KAI Web Intake bootstraps its organization/engagement selection from the server, never from a typed or fabricated id", () => {
  const intakeUiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");

  // No free-text organization id input: the browser can no longer type/guess one.
  assert.doesNotMatch(intakeUiSource, /<input[^>]*value=\{organizationId\}/);
  assert.doesNotMatch(intakeUiSource, /onChange=\{\(event\) => setOrganizationId\(event\.target\.value\.trim\(\)\)\}/);

  // The organization list bootstraps from the server on mount and auto-selects a single result.
  assert.match(intakeUiSource, /useEffect\(\(\) => \{[\s\S]*?getJson\(organizationsPath\(\)\)/);
  assert.match(intakeUiSource, /items\.length === 1[\s\S]{0,80}setOrganizationId\(items\[0\]\.organization_id\)/);

  // Selecting an organization automatically chains into the existing engagements read.
  assert.match(intakeUiSource, /loadEngagements\(organizationId\)/);
  assert.match(intakeUiSource, /setEngagementId\(items\.length === 1 \? items\[0\]\.engagement_id : ""\)/);

  // Explicit empty states are rendered rather than fabricating an id.
  assert.match(intakeUiSource, /No KAI organization is available for this account\./);
  assert.match(intakeUiSource, /No existing engagement is available for this organization\./);

  // Create batch is gated on both an organization and an engagement being selected.
  assert.match(intakeUiSource, /disabled=\{busy \|\| !organizationId \|\| !engagementId\}/);
});

test("KAI Web Intake create-batch request sends the backend-required idempotency contract and reuses it only for the same logical retry", () => {
  const control = { current: null };
  const first = createBatchRequestBody(control, {
    organizationId,
    engagementId,
    batchCode: "  august-manual-upload  ",
  });
  const retry = createBatchRequestBody(control, {
    organizationId,
    engagementId,
    batchCode: "august-manual-upload",
  });
  const changedOrg = createBatchRequestBody(control, {
    organizationId: "00000000-0000-4000-8000-000000000099",
    engagementId,
    batchCode: "august-manual-upload",
  });
  const changedEngagement = createBatchRequestBody(control, {
    organizationId: "00000000-0000-4000-8000-000000000099",
    engagementId: "00000000-0000-4000-8000-000000000098",
    batchCode: "august-manual-upload",
  });
  const changedBatchCode = createBatchRequestBody(control, {
    organizationId: "00000000-0000-4000-8000-000000000099",
    engagementId: "00000000-0000-4000-8000-000000000098",
    batchCode: "september-manual-upload",
  });

  assert.equal(first.organization_id, organizationId);
  assert.equal(first.engagement_id, engagementId);
  assert.equal(first.batch_code, "august-manual-upload");
  assert.equal(first.intake_method, "manual_upload");
  assert.match(first.idempotency_key, uuidRe);
  assert.equal(retry.idempotency_key, first.idempotency_key);
  assert.notEqual(changedOrg.idempotency_key, first.idempotency_key);
  assert.notEqual(changedEngagement.idempotency_key, changedOrg.idempotency_key);
  assert.notEqual(changedBatchCode.idempotency_key, changedEngagement.idempotency_key);
  assert.deepEqual(Object.keys(first).sort(), [
    "batch_code",
    "engagement_id",
    "idempotency_key",
    "intake_method",
    "organization_id",
  ]);
});

test("KAI Web Intake keeps idempotency keys out of rendered UI and browser storage", () => {
  const intakeUiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  const intakeLogicSource = readFileSync("frontend/kaiWebIntakeLogic.js", "utf8");
  const sources = `${intakeUiSource}\n${intakeLogicSource}`;

  assert.doesNotMatch(intakeUiSource, /useState\([^)]*idempotency/i);
  assert.doesNotMatch(intakeUiSource, />[^<>{}]*idempotency[^<>{}]*</i);
  assert.doesNotMatch(intakeUiSource, /idempotency_key/);
  assert.doesNotMatch(intakeUiSource, /ValueRow[^>]*idempotency/i);
  assert.doesNotMatch(sources, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(sources, /console\.(log|warn|error)\([^)]*idempotency/i);
});

test("KAI UAT-enablement Gate-C2A browser flow: the UAT UI no longer invokes the server-streaming admin upload route", () => {
  const postPaths = mountedRoutePaths(["post"]);
  assert.ok(postPaths.includes("/admin/files/:intakeFileId/upload"), "the route may still exist for other callers");

  const intakeLogicSource = readFileSync("frontend/kaiWebIntakeLogic.js", "utf8");
  const intakeUiSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
  assert.doesNotMatch(intakeLogicSource, /admin\/files\/\$\{[^}]*\}\/upload/);
  assert.doesNotMatch(intakeUiSource, /postBytes|uploadPath\(/);
  assert.doesNotMatch(intakeUiSource, /Generate engagement|generateEngagementId|crypto\.randomUUID/);
});

test("KAI UAT-enablement Gate-C2A browser flow sends a signed PUT with only the server-issued Content-Type, no app credentials/headers", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, ok: true };
  };
  try {
    await putToSignedUrl(
      "https://storage.googleapis.com/bucket/object?X-Goog-Signature=abc",
      "PUT",
      { "Content-Type": "text/csv" },
      "synthetic-bytes",
    );
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "PUT");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "text/csv" });
  assert.equal(calls[0].init.credentials, undefined);
  assert.equal(Object.keys(calls[0].init).includes("credentials"), false);
  assert.equal(calls[0].init.body, "synthetic-bytes");
});

test("KAI UAT-enablement Gate-C2A browser flow composes reserve -> requestUploadUrl -> signed PUT -> confirmUpload", async () => {
  const calls = [];
  const signedUrl = "https://storage.googleapis.com/bucket/object?X-Goog-Signature=abc";
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    if (path === signedUrl) return { status: 200, ok: true };
    if (String(path).includes("/file-reservations")) {
      return { status: 201, json: async () => ({ ok: true, data: { intake_file_id: intakeFileId } }) };
    }
    if (String(path).includes("/files/upload-url")) {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          data: { upload_url: signedUrl, upload_method: "PUT", upload_headers: { "Content-Type": "text/csv" } },
        }),
      };
    }
    if (String(path).includes("/confirm-upload")) {
      return { status: 200, json: async () => ({ ok: true, data: { upload_state: "confirmed" } }) };
    }
    throw new Error(`unexpected fetch: ${path}`);
  };
  const { postJson: postJsonIntake, putToSignedUrl: putSigned, requestUploadUrlPath: uploadUrlPath, confirmUploadPath: confirmPath, fileReservationsPath: reservationsPath } =
    await import("../frontend/kaiWebIntakeLogic.js");
  try {
    const reserved = await postJsonIntake(reservationsPath(intakeBatchId), { organization_id: organizationId, engagement_id: engagementId });
    const uploadUrl = await postJsonIntake(uploadUrlPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_file_id: reserved.body.data.intake_file_id,
    });
    const putResult = await putSigned(
      uploadUrl.body.data.upload_url,
      uploadUrl.body.data.upload_method,
      uploadUrl.body.data.upload_headers,
      "synthetic-bytes",
    );
    assert.equal(putResult.ok, true);
    await postJsonIntake(confirmPath(organizationId, reserved.body.data.intake_file_id), { organization_id: organizationId });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls.length, 4);
  assert.match(calls[0].path, /\/file-reservations$/);
  assert.match(calls[1].path, /\/files\/upload-url$/);
  assert.equal(calls[2].path, signedUrl);
  assert.match(calls[3].path, /\/confirm-upload/);
  const otherCalls = [calls[0], calls[1], calls[3]];
  const serialized = JSON.stringify(otherCalls);
  assert.doesNotMatch(serialized, /X-Goog-Signature/, "the signed URL must never leak into any other call's path or body");
});

test("KAI Web Intake file-reservation request sends and retries with a stable idempotency key", () => {
  const control = { current: null };
  const baseInput = {
    organizationId,
    engagementId,
    intakeBatchId,
    originalFilename: "intake.csv",
    fileExtension: ".csv",
    mimeType: "text/csv",
    fileSizeBytes: 42,
    checksum: "a".repeat(64),
    hashAlgorithm: "sha256",
  };
  const first = fileReservationRequestBody(control, baseInput);
  const retry = fileReservationRequestBody(control, { ...baseInput });
  const changedChecksum = fileReservationRequestBody(control, { ...baseInput, checksum: "b".repeat(64) });

  assert.equal(first.organization_id, organizationId);
  assert.equal(first.engagement_id, engagementId);
  assert.equal(first.original_filename, "intake.csv");
  assert.equal(first.file_extension, ".csv");
  assert.equal(first.mime_type, "text/csv");
  assert.equal(first.file_size_bytes, 42);
  assert.equal(first.checksum, "a".repeat(64));
  assert.equal(first.hash_algorithm, "sha256");
  assert.match(first.idempotency_key, uuidRe);
  assert.equal(retry.idempotency_key, first.idempotency_key);
  assert.notEqual(changedChecksum.idempotency_key, first.idempotency_key);
});

test("KAI UAT-enablement client-followup review page composes the exact P2-11 read/completion routes and the accepted disposition wording", () => {
  const getPaths = mountedRoutePaths(["get"]);
  const postPaths = mountedRoutePaths(["post"]);
  assert.ok(getPaths.includes("/admin/organizations/:organizationId/client-followups"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/claims/:claimId/client-followups/:clientFollowupItemId/complete"));

  assert.equal(
    clientFollowupsPath(organizationId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/client-followups`,
  );
  assert.equal(
    clientFollowupCompletePath(organizationId, claimId, "f1"),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claims/${claimId}/client-followups/f1/complete`,
  );
  assert.equal(canCompleteClientFollowup({ queueStatus: "waiting_on_client", reviewStatus: "proposed" }), true);
  assert.equal(canCompleteClientFollowup({ queueStatus: "resolved", reviewStatus: "resolved" }), false);

  const indexSource = readFileSync("index.js", "utf8");
  assert.match(indexSource, /app\.get\(["']\/kai\/client-followups["'],\s*ensureAuthenticated,/);
  assert.doesNotMatch(
    indexSource.slice(indexSource.indexOf('"/kai/client-followups"'), indexSource.indexOf('"/kai/client-followups"') + 200),
    /ensureAdmin/,
  );
});

test("KAI UAT-enablement evidence/claim review controls send only the server-supplied expected_updated_at", () => {
  const postPaths = mountedRoutePaths(["post"]);
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/evidence-items/:evidenceItemId/evidence-review/:reviewQueueItemId/complete"));
  assert.ok(postPaths.includes("/admin/organizations/:organizationId/claims/:claimId/claim-review/:reviewQueueItemId/complete"));

  assert.equal(
    evidenceReviewCompletePath(organizationId, evidenceItemId, "q1"),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/evidence-items/${evidenceItemId}/evidence-review/q1/complete`,
  );
  assert.equal(
    claimReviewCompletePath(organizationId, claimId, "q2"),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/claims/${claimId}/claim-review/q2/complete`,
  );

  assert.equal(canCompleteEvidenceReview({ review_queue_status: "open", review_status: "needs_gk_review" }), true);
  assert.equal(canCompleteEvidenceReview({ review_queue_status: "resolved", review_status: "resolved" }), false);
  assert.equal(
    canCompleteClaimReview(
      { review_status: "resolved" },
      { queue_status: "open", review_status: "needs_gk_review" },
    ),
    true,
  );
  assert.equal(
    canCompleteClaimReview(
      { review_status: "needs_gk_review" },
      { queue_status: "open", review_status: "needs_gk_review" },
    ),
    false,
    "claim review must stay gated on evidence review already being resolved",
  );
});

test("KAI UAT-enablement new frontend surfaces add no export, assistant, eligibility, or unsafe-field composition", () => {
  const nonUploadSources = [
    readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8"),
    readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8"),
    readFileSync("frontend/KaiClientFollowupReview.jsx", "utf8"),
    readFileSync("frontend/kaiClientFollowupReviewLogic.js", "utf8"),
  ].join("\n");
  const uploadSources = [
    readFileSync("frontend/KaiWebIntake.jsx", "utf8"),
    readFileSync("frontend/kaiWebIntakeLogic.js", "utf8"),
  ].join("\n");
  const allSources = `${nonUploadSources}\n${uploadSources}`;

  // Every route these files call against this app's own /api/kai backend is
  // GET/POST only. The one legitimate PUT is the Gate-C2A browser-to-GCS
  // signed upload, which never targets an /api/kai path.
  assert.doesNotMatch(nonUploadSources, /\bPUT\b|\bPATCH\b|\bDELETE\b/);
  assert.doesNotMatch(uploadSources, /\bPATCH\b|\bDELETE\b/);

  assert.doesNotMatch(allSources, /export-review|export candidate|assistant/i);
  assert.doesNotMatch(allSources, /raw_content|storage_object|storage_uri|storage_bucket|api[_-]?key|secret/i);
  assert.doesNotMatch(allSources, /computeEligibility|calculateEligibility|isEligible\s*=\s*(?!.*server)/i);
  assert.doesNotMatch(allSources, /console\.(log|warn|error)\([^)]*(upload_url|uploadUrl|signed)/i);
  assert.doesNotMatch(allSources, /localStorage|sessionStorage|indexedDB/);
});

test("KAI UAT-enablement review-cockpit host page reuses the unchanged existing component and entry point", () => {
  const viewSource = readFileSync("views/kai-review-cockpit.ejs", "utf8");
  const indexSource = readFileSync("index.js", "utf8");
  const cockpitSource = readFileSync("frontend/kaiReviewCockpit.jsx", "utf8");
  const entrySource = readFileSync("frontend/entry.jsx", "utf8");

  assert.match(viewSource, /kai-review-cockpit-root/);
  assert.match(viewSource, /window\.renderKaiReviewCockpit/);
  assert.match(indexSource, /\/gk-admin\/kai-review-cockpit/);
  assert.match(indexSource, /ensureAuthenticated,\s*ensureAdmin/);
  assert.match(entrySource, /window\.renderKaiReviewCockpit/);
  assert.doesNotMatch(cockpitSource, /\bPUT\b|\bPATCH\b|\bDELETE\b/);
});
