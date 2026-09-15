import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canPrepareExportCandidate,
  createExportCandidateRequest,
  createExportManifestRequest,
  decideCreateExportCandidateResult,
  decideCreateExportManifestResult,
  decideGrantFinalReleaseAuthorityResult,
  exportCandidatePath,
  exportManifestMarkdownPath,
  exportManifestsPath,
  finalReleaseAuthorityPath,
  grantFinalReleaseAuthorityRequest,
  revokeFinalReleaseAuthorityRequest,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportCandidateId = "00000000-0000-4000-8000-000000000701";
const exportManifestId = "00000000-0000-4000-8000-000000000901";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";

const jsxSource = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");

test("governed export finalization route paths match the exact accepted backend routes", () => {
  assert.equal(
    exportCandidatePath(organizationId, generatedContentDraftId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/generated-content-drafts/00000000-0000-4000-8000-000000000702/export-candidates",
  );
  assert.equal(
    finalReleaseAuthorityPath(organizationId, exportCandidateId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/export-candidates/00000000-0000-4000-8000-000000000701/final-release-authority",
  );
  assert.equal(
    exportManifestsPath(organizationId, exportCandidateId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/export-candidates/00000000-0000-4000-8000-000000000701/export-manifests",
  );
  assert.equal(
    exportManifestMarkdownPath(organizationId, exportManifestId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/export-manifests/00000000-0000-4000-8000-000000000901/markdown",
  );
});

test("createExportCandidateRequest sends exactly {} and no other field", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 201, json: async () => ({ ok: true, data: { exportCandidateId }, warnings: [] }) };
  };
  try {
    const path = exportCandidatePath(organizationId, generatedContentDraftId);
    await createExportCandidateRequest(path);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(calls[0].init.body), {});
  } finally {
    global.fetch = originalFetch;
  }
});

test("grantFinalReleaseAuthorityRequest sends exactly { requested_audience, decision_action: \"grant\" }", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 201, json: async () => ({ ok: true, data: { effective: true }, warnings: [] }) };
  };
  try {
    const path = finalReleaseAuthorityPath(organizationId, exportCandidateId);
    await grantFinalReleaseAuthorityRequest(path, "funder");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { requested_audience: "funder", decision_action: "grant" });
  } finally {
    global.fetch = originalFetch;
  }
});

test("revokeFinalReleaseAuthorityRequest sends exactly { requested_audience, decision_action: \"revoke\" }", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 201, json: async () => ({ ok: true, data: { effective: false }, warnings: [] }) };
  };
  try {
    const path = finalReleaseAuthorityPath(organizationId, exportCandidateId);
    await revokeFinalReleaseAuthorityRequest(path, "funder");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { requested_audience: "funder", decision_action: "revoke" });
  } finally {
    global.fetch = originalFetch;
  }
});

test("createExportManifestRequest sends exactly { export_review_queue_item_id } and no finalGate/authority field", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 201, json: async () => ({ ok: true, data: { exportManifestId }, warnings: [] }) };
  };
  try {
    const path = exportManifestsPath(organizationId, exportCandidateId);
    await createExportManifestRequest(path, exportReviewQueueItemId);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { export_review_queue_item_id: exportReviewQueueItemId });
  } finally {
    global.fetch = originalFetch;
  }
});

test("canPrepareExportCandidate does not expose the 04dad19 invalid transition for resolved/current-use packets that are still export-ineligible", () => {
  // This is the production-regression state: the packet's review lanes are
  // resolved and current-use eligibility remains true, but the server-derived
  // exportEligible gate is false. The P3-16 candidate service can still reject
  // this state with conflict_current_state_changed when the current limitation
  // snapshot prerequisite is absent/stale, so the generic UI must not offer the
  // POST.
  assert.equal(canPrepareExportCandidate({
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    exportEligible: false,
    limitationSnapshotConfirmed: false,
    candidateReadyToPrepare: false,
  }), false);
});

// Phase-14: the exportEligible-only approximation above is now replaced by
// the packet's own server-derived candidateReadyToPrepare field, which folds
// in export-review resolution, current limitation-snapshot existence, and
// authorized content type - exactly the prerequisites createExportCandidate
// itself enforces before it ever reaches currentness/fingerprint checks.
test("canPrepareExportCandidate follows the server-derived candidateReadyToPrepare gate exactly", () => {
  assert.equal(canPrepareExportCandidate({
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    exportEligible: true,
    limitationSnapshotConfirmed: true,
    candidateReadyToPrepare: true,
  }), true);
  // exportEligible true alone is not sufficient once a current limitation
  // snapshot is missing - the packet reports candidateReadyToPrepare false,
  // and the UI must not offer Prepare Export Candidate.
  assert.equal(canPrepareExportCandidate({
    generatedContentReviewStatus: "resolved",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    currentUseEligible: true,
    exportEligible: true,
    limitationSnapshotConfirmed: false,
    candidateReadyToPrepare: false,
  }), false);
  assert.equal(canPrepareExportCandidate(null), false);
  assert.equal(canPrepareExportCandidate(undefined), false);
});

test("decideCreateExportCandidateResult surfaces the exact returned exportCandidateId on success", () => {
  const success = decideCreateExportCandidateResult({ statusCode: 201, body: { ok: true, data: { exportCandidateId } } });
  assert.deepEqual(success, { kind: "success", exportCandidateId });

  const error = decideCreateExportCandidateResult({ statusCode: 422, body: { ok: false, error: { code: "validation_blocker" } } });
  assert.equal(error.kind, "error");
});

test("decideGrantFinalReleaseAuthorityResult reports effectiveness exactly as returned, never inferred", () => {
  assert.deepEqual(
    decideGrantFinalReleaseAuthorityResult({ statusCode: 201, body: { ok: true, data: { effective: true } } }),
    { kind: "success", effective: true },
  );
  assert.deepEqual(
    decideGrantFinalReleaseAuthorityResult({ statusCode: 201, body: { ok: true, data: { effective: false } } }),
    { kind: "success", effective: false },
  );
});

test("decideCreateExportManifestResult surfaces the exact returned exportManifestId, and treats a P3-19 conflict as no manifest created", () => {
  const success = decideCreateExportManifestResult({ statusCode: 201, body: { ok: true, data: { exportManifestId } } });
  assert.deepEqual(success, { kind: "success", exportManifestId });

  const conflict = decideCreateExportManifestResult({
    statusCode: 409,
    body: { ok: false, error: { code: "conflict_current_state_changed" } },
  });
  assert.equal(conflict.kind, "conflict");
});

test("the export-review page never derives finalGate/eligibility/authority itself and downloads only the exact returned exportManifestId", () => {
  assert.doesNotMatch(jsxSource, /finalGate\s*=\s*true|VAL-EXP-001.*=.*(true|false)|ORDER BY|LIMIT 1|latest manifest/i);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, exportManifestId\)/);
  assert.match(jsxSource, /decideCreateExportManifestResult/);
});

test("history/current-state separation: the page never restores the packet's compatibility exportManifestId (or any history entry) into current-session manifest state", () => {
  assert.doesNotMatch(jsxSource, /ORDER BY|LIMIT 1|latest manifest|is_current|isLatest/i);
  assert.doesNotMatch(jsxSource, /setExportManifestId\(recovered\)/);
  assert.doesNotMatch(jsxSource, /setExportManifestId\(outcome\.model\.exportManifestId\)/);
});

test("every exportManifestHistory entry renders its own exact Download Markdown link, never one selected as latest/current/preferred/active", () => {
  assert.match(jsxSource, /exportManifestHistory\.map/);
  assert.match(jsxSource, /exportManifestMarkdownPath\(organizationId, entry\.exportManifestId\)/);
  assert.doesNotMatch(jsxSource, /is_current|isLatest|isPreferred|isActive|latest manifest/i);
});

test("durable read recovery: Prepare/Grant controls do not reappear once an exact exportManifestId is already known (recovered or same-session)", () => {
  assert.match(jsxSource, /showPrepareCandidateControl\s*=\s*canPrepareExportCandidate\(model\)\s*&&\s*!exportCandidateId\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showGrantAuthorityControl\s*=\s*!!exportCandidateId\s*&&\s*!authorityEffective\s*&&\s*!exportManifestId/);
  assert.match(jsxSource, /showRevokeAuthorityControl\s*=\s*!!exportCandidateId\s*&&\s*authorityEffective\s*&&\s*!exportManifestId/);
});

test("effective human authority exposes an explicit Revoke Final Release Authority control before manifest creation", () => {
  assert.match(jsxSource, /Revoke Final Release Authority/);
  assert.match(jsxSource, /className="gk-export-review-revoke-authority-button"/);
  assert.match(jsxSource, /onClick=\{handleRevokeFinalReleaseAuthority\}/);
});
