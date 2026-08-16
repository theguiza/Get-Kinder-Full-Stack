import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import sprint2IntakeApiRouter from "../Backend/kai/routes/sprint2IntakeApi.js";
import {
  claimGapFollowupsPath,
  claimProposalPath,
  coverageInternalAcceptancePath,
  evidenceCoverageAssessmentPath,
  evidenceExtractionPath,
  potentialConflictsPath,
  postJson,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  batchFilesPath,
  confirmUploadPath,
  createBatchPath,
  fileDetailPath,
  fileReservationsPath,
  postBytes,
  uploadPath,
} from "../frontend/kaiWebIntakeLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementId = "00000000-0000-4000-8000-000000000002";
const claimId = "00000000-0000-4000-8000-000000000101";
const secondClaimId = "00000000-0000-4000-8000-000000000102";
const evidenceItemId = "00000000-0000-4000-8000-000000000201";
const sourceVersionId = "00000000-0000-4000-8000-000000000301";
const intakeBatchId = "00000000-0000-4000-8000-000000000401";
const intakeFileId = "00000000-0000-4000-8000-000000000501";

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
  assert.ok(postPaths.includes("/admin/files/:intakeFileId/upload"));
  assert.ok(postPaths.includes("/admin/files/:intakeFileId/confirm-upload"));
  assert.ok(getPaths.includes("/admin/batches/:intakeBatchId/files"));
  assert.ok(getPaths.includes("/admin/files/:intakeFileId"));

  assert.equal(createBatchPath(), "/api/kai/sprint2/intake/admin/batches");
  assert.equal(
    fileReservationsPath(intakeBatchId),
    `/api/kai/sprint2/intake/admin/batches/${intakeBatchId}/file-reservations`,
  );
  assert.equal(
    uploadPath(organizationId, engagementId, intakeBatchId, intakeFileId),
    `/api/kai/sprint2/intake/admin/files/${intakeFileId}/upload`
      + `?organization_id=${organizationId}&engagement_id=${engagementId}&intake_batch_id=${intakeBatchId}`,
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
});

test("KAI UAT-enablement raw-byte upload sends application/octet-stream with the file as the body, no multipart wrapper", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 201, json: async () => ({ ok: true, data: {} }) };
  };
  try {
    await postBytes(uploadPath(organizationId, engagementId, intakeBatchId, intakeFileId), "synthetic-bytes");
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/octet-stream");
  assert.equal(calls[0].init.body, "synthetic-bytes");
});

test("KAI UAT-enablement new frontend surfaces add no export, assistant, eligibility, or unsafe-field composition", () => {
  const sources = [
    readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8"),
    readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8"),
    readFileSync("frontend/KaiWebIntake.jsx", "utf8"),
    readFileSync("frontend/kaiWebIntakeLogic.js", "utf8"),
  ].join("\n");

  assert.doesNotMatch(sources, /\bPUT\b|\bPATCH\b|\bDELETE\b/);
  assert.doesNotMatch(sources, /export-review|export candidate|assistant/i);
  assert.doesNotMatch(sources, /raw_content|signed_url|storage_object|storage_uri|storage_bucket|api[_-]?key|secret/i);
  assert.doesNotMatch(sources, /computeEligibility|calculateEligibility|isEligible\s*=\s*(?!.*server)/i);
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
