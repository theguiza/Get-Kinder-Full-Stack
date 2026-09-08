import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  packetPath,
  errorText,
  toRenderModel,
  decideOutcome,
  SAFE_ERROR_CODES,
  getJson,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";

const validDto = Object.freeze({
  generationRunId: "00000000-0000-4000-8000-000000000700",
  generatedContentDraftId,
  contentType: "evidence_summary",
  draftStatus: "draft",
  requestedExportAudience: "funder",
  generatedContentReviewQueueStatus: "resolved",
  generatedContentReviewStatus: "resolved",
  exportReviewQueueItemId,
  exportReviewQueueStatus: "open",
  exportReviewStatus: "needs_gk_review",
  currentUseEligible: true,
  exportEligible: false,
  validatorResult: {
    validator_key: "VAL-EXP-001",
    severity: "blocker",
    object_type: "generated_content_draft",
    object_code: "export_manifest_eligibility",
    object_id: generatedContentDraftId,
    message: "internal validator message must not render",
    blocking_reason: "claim_review_incomplete",
    required_fix: "internal remediation note must not render",
    evidence: { secret_internal_note: "must not render" },
  },
  blocks: [
    {
      ordinal: 1,
      text: "KAI's first block of generated text.",
      citations: [
        {
          claimId: "00000000-0000-4000-8000-000000000705",
          evidenceItemId: "00000000-0000-4000-8000-000000000706",
          sourceId: "00000000-0000-4000-8000-000000000707",
          sourceVersionId: "00000000-0000-4000-8000-000000000708",
          supportStrength: "strong",
          claimReviewStatus: "approved",
          evidenceReviewStatus: "approved",
          currentEligible: true,
          blockerCodes: [],
          affectedDimensionKeys: [],
          affectedObjectIds: [],
        },
      ],
    },
  ],
  exportReviewUpdatedAt: "2026-08-06T09:00:00.000Z",
});

test("P3-08 packetPath builds the exact P3-07 route from the three route parameters", () => {
  assert.equal(
    packetPath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/generated-content-drafts/00000000-0000-4000-8000-000000000702"
      + "/export-review-queue/00000000-0000-4000-8000-000000000710/packet",
  );
});

test("P3-08 getJson uses the existing authenticated fetch convention (same-origin cookies, GET, Accept header)", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, data: validDto, warnings: [] }) };
  };
  try {
    const result = await getJson(packetPath(organizationId, generatedContentDraftId, exportReviewQueueItemId));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.headers.Accept, "application/json");
    assert.equal(calls[0].init.body, undefined);
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.ok, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("P3-08 success renders only allowlisted P3-06 fields and drops everything else", () => {
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: validDto, warnings: [] } });
  assert.equal(outcome.kind, "success");
  assert.deepEqual(outcome.model, {
    requestedExportAudience: "funder",
    draftStatus: "draft",
    generatedContentReviewStatus: "resolved",
    exportReviewStatus: "needs_gk_review",
    currentUseEligible: true,
    exportEligible: false,
    exportReviewQueueStatus: "open",
    exportReviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    exportManifestId: null,
    exportManifestHistory: [],
    validatorSeverity: "blocker",
    validatorFailedGate: "claim_review_incomplete",
    blocks: [
      {
        ordinal: 1,
        text: "KAI's first block of generated text.",
        citations: [
          {
            claimId: "00000000-0000-4000-8000-000000000705",
            evidenceItemId: "00000000-0000-4000-8000-000000000706",
            sourceId: "00000000-0000-4000-8000-000000000707",
            sourceVersionId: "00000000-0000-4000-8000-000000000708",
            supportStrength: "strong",
            claimReviewStatus: "approved",
            evidenceReviewStatus: "approved",
            currentEligible: true,
            blockerCodes: [],
            affectedDimensionKeys: [],
            affectedObjectIds: [],
          },
        ],
      },
    ],
  });
  const rendered = JSON.stringify(outcome.model);
  assert.equal(rendered.includes("must not render"), false);
  assert.equal(rendered.includes("generationRunId"), false);
  assert.equal(rendered.includes("secret_internal_note"), false);
});

test("durable read recovery: toRenderModel surfaces the exact backend-persisted exportManifestId when the packet carries one", () => {
  const withManifest = { ...validDto, exportManifestId: "00000000-0000-4000-8000-000000000901" };
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: withManifest, warnings: [] } });
  assert.equal(outcome.kind, "success");
  assert.equal(outcome.model.exportManifestId, "00000000-0000-4000-8000-000000000901");
});

test("durable read recovery: toRenderModel reports null (never a fabricated identity) when the packet carries no exportManifestId", () => {
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: validDto, warnings: [] } });
  assert.equal(outcome.kind, "success");
  assert.equal(outcome.model.exportManifestId, null);
});

test("exportManifestHistory projection: zero/one/two/three packet history entries project to zero/one/two/three render-model entries, in the exact given order", () => {
  const entryA = { exportManifestId: "00000000-0000-4000-8000-000000000901", exportCandidateId: "00000000-0000-4000-8000-000000000801", createdAt: "2026-09-08T10:00:00.000Z" };
  const entryB = { exportManifestId: "00000000-0000-4000-8000-000000000902", exportCandidateId: "00000000-0000-4000-8000-000000000802", createdAt: "2026-09-08T10:05:00.000Z" };
  const entryC = { exportManifestId: "00000000-0000-4000-8000-000000000903", exportCandidateId: "00000000-0000-4000-8000-000000000803", createdAt: "2026-09-08T10:10:00.000Z" };

  assert.deepEqual(decideOutcome({ statusCode: 200, body: { ok: true, data: { ...validDto, exportManifestHistory: [] } } }).model.exportManifestHistory, []);
  assert.deepEqual(decideOutcome({ statusCode: 200, body: { ok: true, data: { ...validDto, exportManifestHistory: [entryA] } } }).model.exportManifestHistory, [entryA]);
  assert.deepEqual(decideOutcome({ statusCode: 200, body: { ok: true, data: { ...validDto, exportManifestHistory: [entryA, entryB] } } }).model.exportManifestHistory, [entryA, entryB]);
  assert.deepEqual(decideOutcome({ statusCode: 200, body: { ok: true, data: { ...validDto, exportManifestHistory: [entryA, entryB, entryC] } } }).model.exportManifestHistory, [entryA, entryB, entryC]);
});

test("exportManifestHistory projection: only exportManifestId/exportCandidateId/createdAt survive per entry, and a missing field on the packet is never invented", () => {
  const outcome = decideOutcome({
    statusCode: 200,
    body: {
      ok: true,
      data: {
        ...validDto,
        exportManifestHistory: [{
          exportManifestId: "00000000-0000-4000-8000-000000000901",
          exportCandidateId: "00000000-0000-4000-8000-000000000801",
          createdAt: "2026-09-08T10:00:00.000Z",
          isLatest: true,
          isCurrent: true,
          preferred: true,
        }],
      },
    },
  });
  assert.deepEqual(outcome.model.exportManifestHistory, [{
    exportManifestId: "00000000-0000-4000-8000-000000000901",
    exportCandidateId: "00000000-0000-4000-8000-000000000801",
    createdAt: "2026-09-08T10:00:00.000Z",
  }]);
});

test("exportManifestHistory projection: a non-array packet field never produces a fabricated non-empty history", () => {
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: { ...validDto, exportManifestHistory: null } } });
  assert.deepEqual(outcome.model.exportManifestHistory, []);
});

test("P3-12 P3-08 projection retains exportReviewQueueStatus and exportReviewUpdatedAt internally for Start Review control-state logic only", () => {
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: validDto, warnings: [] } });
  assert.equal(outcome.kind, "success");
  assert.equal(outcome.model.exportReviewQueueStatus, "open");
  assert.equal(outcome.model.exportReviewUpdatedAt, "2026-08-06T09:00:00.000Z");
});

test("P3-08 malformed/extra response fields are dropped, never rejected as an error and never silently promoted into new fields", () => {
  const withExtras = {
    ...validDto,
    unexpectedTopLevelField: "must not render",
    blocks: [
      {
        ...validDto.blocks[0],
        unexpectedBlockField: "must not render",
        citations: [{ ...validDto.blocks[0].citations[0], unexpectedCitationField: "must not render" }],
      },
    ],
  };
  const outcome = decideOutcome({ statusCode: 200, body: { ok: true, data: withExtras, warnings: [] } });
  assert.equal(outcome.kind, "success");
  const rendered = JSON.stringify(outcome.model);
  assert.equal(rendered.includes("must not render"), false);
  assert.equal(rendered.includes("unexpectedTopLevelField"), false);
  assert.equal(rendered.includes("unexpectedBlockField"), false);
  assert.equal(rendered.includes("unexpectedCitationField"), false);
});

test("P3-08 every listed safe error code is rejected outright: no packet model is ever produced", () => {
  for (const code of SAFE_ERROR_CODES) {
    const result = {
      statusCode: 400,
      body: { ok: false, error: { code, message: `safe message for ${code}` }, data: null, blockers: [], warnings: [] },
    };
    const outcome = decideOutcome(result);
    assert.equal(outcome.kind, "error", code);
    assert.equal(outcome.message, `safe message for ${code}`, code);
    assert.equal("model" in outcome, false, code);
  }
});

test("P3-08 SAFE_ERROR_CODES matches the exact nine safe failure codes this page must handle", () => {
  assert.deepEqual(
    [...SAFE_ERROR_CODES].sort(),
    [
      "authorization_denied",
      "conflict_current_state_changed",
      "feature_disabled",
      "invalid_request",
      "mapped_kai_user_required",
      "not_found",
      "system_error",
      "tenant_boundary_violation",
      "unauthorized",
    ],
  );
});

test("P3-08 an ok:true body paired with a non-200 status, or ok:false paired with 200, is still rejected", () => {
  assert.equal(decideOutcome({ statusCode: 409, body: { ok: true, data: validDto } }).kind, "error");
  assert.equal(decideOutcome({ statusCode: 200, body: { ok: false, data: null, error: { message: "x" } } }).kind, "error");
  assert.equal(decideOutcome({ statusCode: 200, body: null }).kind, "error");
});

test("P3-08 errorText falls back to a safe generic message when the server sends no message", () => {
  assert.equal(errorText({ statusCode: 500, body: null }), "Request failed (500).");
  assert.equal(errorText({ statusCode: 404, body: { error: { message: "Not found." } } }), "Not found.");
});

test("P3-08 toRenderModel never reads raw evidence text, filenames, storage paths, signed URLs, or actor context", () => {
  const dtoWithForbiddenShape = {
    ...validDto,
    validatorResult: {
      ...validDto.validatorResult,
      evidence: { raw_source_text: "forbidden", signed_url: "https://forbidden", filename: "forbidden.pdf" },
    },
  };
  const model = toRenderModel(dtoWithForbiddenShape);
  const rendered = JSON.stringify(model);
  assert.equal(rendered.includes("forbidden"), false);
});

// Superseded by the governed export finalization package: this page now
// issues exactly the P3-12/P3-15 queue transitions plus the P3-16 candidate,
// P3-17 authority-grant, and P3-19 manifest-finalization mutations, and links
// to Download Markdown - each an existing, separately-authorized backend
// operation invoked one at a time by explicit GK-admin action. Further
// superseded by the CSV evidence appendix package: this page now also links
// to Download CSV Evidence Appendix, reusing the exact same governed
// exportManifestId identity and delivery-route pattern as Download Markdown
// - no new mutation, no client-side rendering, no artifact-byte handling.
// What remains pinned: no PUT/PATCH/DELETE, no raw approve/reject/mark-ready
// wording, no client-side eligibility/authority/finalGate derivation, and no
// PDF/DOCX or artifact-byte handling.
test("P3-08 frontend source issues only the accepted queue-transition and governed-finalization mutations, never a broader mutation surface", () => {
  const source = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");
  assert.doesNotMatch(source, /\bmethod:\s*["'](PUT|PATCH|DELETE)["']/i);
  assert.doesNotMatch(source, /putJson|patchJson|deleteJson/i);
  assert.doesNotMatch(source, /\b(approve|reject|mark-ready|markReady)\b/i);
  assert.doesNotMatch(source, /finalGate\s*=\s*true|VAL-EXP-001.*=.*(true|false)|pdf|docx|artifact_bytes|signed_url/i);
  assert.match(source, /Why can KAI say this\?/);
});

test("P3-08 route is registered with existing site authentication and no other admin route is touched", () => {
  const source = readFileSync("index.js", "utf8");
  assert.match(
    source,
    /app\.get\(\s*\n\s*"\/gk-admin\/organizations\/:organizationId\/generated-content-drafts\/:generatedContentDraftId\/export-review-queue\/:exportReviewQueueItemId",\s*\n\s*ensureAuthenticated,\s*\n\s*ensureAdmin,/,
  );
  const matches = source.match(/app\.get\(\s*\n?\s*"\/gk-admin\//g) || [];
  // KAI UAT-enablement package additively mounted a second /gk-admin page
  // route (the internal review cockpit host page) after this P3-08 route was
  // accepted; this assertion is updated additively to reflect that.
  assert.equal(matches.length, 2);
});

test("P3-08 entry.jsx mounts exactly one new render function and leaves existing render functions intact", () => {
  const source = readFileSync("frontend/entry.jsx", "utf8");
  assert.match(source, /window\.renderGkExportReviewDetail\s*=/);
  assert.match(source, /window\.renderAdmin\s*=/);
  assert.match(source, /window\.renderKaiReviewCockpit\s*=/);
  assert.match(source, /window\.renderOrgPortal\s*=/);
});
