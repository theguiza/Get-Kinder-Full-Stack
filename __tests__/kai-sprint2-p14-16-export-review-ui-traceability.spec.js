// PHASE 14 EXPORT-REVIEW UI TRACEABILITY CLOSURE
//
// Proves the seven governed traceability concepts required on the GK
// export-review page. Five were already conformant end-to-end (why-can-KAI-
// say-this, evidence strength, conflicts/gaps, reviewer status - and
// sourceId/sourceVersionId for source identity). Two governed fields already
// reached the backend export-review DTO but were dropped before the
// frontend render model (`sourceCode`, `approvedAudiences`) - a pure
// frontend projection fix. One concept (limitations) had only a boolean
// (`limitationSnapshotConfirmed`) reaching the export-review packet even
// though real per-(claim,evidence) limitation codes already exist in
// `kai.limitation_snapshot_entries` (written by the existing P3-16
// `confirmLimitationSnapshot` and already exposed downstream by the
// export-manifest render model) - this package adds the smallest coherent
// projection (`loadCurrentLimitationSnapshotEntries` ->
// `evaluateGeneratedDraftExportReviewPacketInTransaction`'s
// `blocksWithLimitationCodes` -> `CITATION_KEYS`/`limitationCodes` in
// kaiExportReviewService.js -> `toRenderModel`/`CitationDetail` in the
// frontend) using only the existing governed table, never new persistence.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import { __exportReviewServiceTestables } from "../Backend/kai/services/kaiExportReviewService.js";
import { toRenderModel } from "../frontend/gkExportReviewDetailLogic.js";

const { loadCurrentLimitationSnapshotEntries } = __generatedContentRepositoryTestables;

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const SNAPSHOT = "00000000-0000-4000-8000-000000000901";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";

function fakeTx({ snapshots = [], entries = [] } = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("FROM kai.limitation_snapshots ls")) {
        const [organizationId, generatedContentDraftId] = params;
        const current = snapshots.find((snap) => snap.organization_id === organizationId
          && snap.generated_content_draft_id === generatedContentDraftId
          && !snapshots.some((successor) => successor.supersedes_snapshot_id === snap.limitation_snapshot_id));
        return { rows: current ? [{ limitation_snapshot_id: current.limitation_snapshot_id }] : [] };
      }
      if (s.includes("FROM kai.limitation_snapshot_entries")) {
        const [limitationSnapshotId] = params;
        return { rows: entries.filter((entry) => entry.limitation_snapshot_id === limitationSnapshotId) };
      }
      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

test("LIMITATIONS: no current limitation snapshot yields [] entries - never invented codes before confirmation", async () => {
  const tx = fakeTx({ snapshots: [], entries: [] });
  const entries = await loadCurrentLimitationSnapshotEntries(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
  });
  assert.deepEqual(entries, []);
});

test("LIMITATIONS: a confirmed current snapshot's real per-(claim,evidence) limitation codes are returned - the exact existing governed table, no invented data", async () => {
  const tx = fakeTx({
    snapshots: [{ limitation_snapshot_id: SNAPSHOT, organization_id: ORG, generated_content_draft_id: DRAFT, supersedes_snapshot_id: null }],
    entries: [
      { limitation_snapshot_id: SNAPSHOT, claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["retrospective_reporting", "retrospective_reporting", "self_reported"] },
    ],
  });
  const entries = await loadCurrentLimitationSnapshotEntries(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].claim_id, CLAIM);
  assert.equal(entries[0].evidence_item_id, EVIDENCE);
  assert.deepEqual(entries[0].limitation_codes, ["retrospective_reporting", "retrospective_reporting", "self_reported"]);
});

test("LIMITATIONS: a superseded (non-current) snapshot is never treated as current - same currentness rule the existence check already uses", async () => {
  const superseded = "00000000-0000-4000-8000-000000000902";
  const tx = fakeTx({
    snapshots: [
      { limitation_snapshot_id: superseded, organization_id: ORG, generated_content_draft_id: DRAFT, supersedes_snapshot_id: null },
      { limitation_snapshot_id: SNAPSHOT, organization_id: ORG, generated_content_draft_id: DRAFT, supersedes_snapshot_id: superseded },
    ],
    entries: [
      { limitation_snapshot_id: superseded, claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["stale_code"] },
      { limitation_snapshot_id: SNAPSHOT, claim_id: CLAIM, evidence_item_id: EVIDENCE, limitation_codes: ["current_code"] },
    ],
  });
  const entries = await loadCurrentLimitationSnapshotEntries(tx, {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
  });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].limitation_codes, ["current_code"]);
});

test("ALLOWED_AUDIENCE / SOURCE / LIMITATIONS: the export-review service DTO validator already requires (or now requires) all three governed fields on every citation, distinct from requestedExportAudience", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiExportReviewService.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /"sourceCode"/);
  assert.match(source, /"approvedAudiences"/);
  assert.match(source, /"limitationCodes"/);
  // approvedAudiences is validated against the AUDIENCES set on the
  // CITATION (per-claim governance decision), never derived from the
  // packet-level requestedExportAudience field.
  assert.match(source, /citation\.approvedAudiences\.every\(\(value\) => AUDIENCES\.has\(value\)\)/);
  assert.match(source, /isLimitationCodeSet\(citation\.limitationCodes\)/);
});

test("LIMITATIONS: malformed limitationCodes (not a governed code set) fails the DTO closed", () => {
  const { isGeneratedDraftExportReviewPacketDto } = __exportReviewServiceTestables;
  const dto = validExportReviewPacketDto();
  const malformed = {
    ...dto,
    blocks: [{
      ...dto.blocks[0],
      citations: [{ ...dto.blocks[0].citations[0], limitationCodes: ["Not A Valid Code With Spaces"] }],
    }],
  };
  assert.equal(isGeneratedDraftExportReviewPacketDto(dto), true);
  assert.equal(isGeneratedDraftExportReviewPacketDto(malformed), false);
});

function validExportReviewPacketDto() {
  const draftId = "00000000-0000-4000-8000-000000000702";
  return {
    generationRunId: "00000000-0000-4000-8000-000000000700",
    generatedContentDraftId: draftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedExportAudience: "funder",
    generatedContentReviewQueueStatus: "resolved",
    generatedContentReviewStatus: "resolved",
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000710",
    exportReviewQueueStatus: "open",
    exportReviewStatus: "needs_gk_review",
    currentUseEligible: true,
    exportEligible: false,
    limitationSnapshotConfirmed: true,
    candidateReadyToPrepare: false,
    validatorResult: {
      validator_key: "VAL-EXP-001",
      severity: "blocker",
      object_type: "generated_content_draft",
      object_code: "export_manifest_eligibility",
      object_id: draftId,
      message: "Export manifest eligibility gates failed.",
      blocking_reason: "claim_review_incomplete",
      required_fix: null,
      evidence: {},
    },
    blocks: [{
      ordinal: 1,
      text: "KAI's first block of generated text.",
      citations: [{
        claimId: CLAIM,
        evidenceItemId: EVIDENCE,
        sourceId: "00000000-0000-4000-8000-000000000707",
        sourceCode: "src-707",
        sourceVersionId: "00000000-0000-4000-8000-000000000708",
        supportStrength: "strong",
        claimReviewStatus: "approved",
        evidenceReviewStatus: "approved",
        currentEligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        approvedAudiences: ["internal", "funder"],
        limitationCodes: ["retrospective_reporting"],
      }],
    }],
    exportReviewUpdatedAt: "2026-08-06T09:00:00.000Z",
  };
}

test("FRONTEND PROJECTION: toRenderModel carries sourceCode, approvedAudiences, and limitationCodes through to the render model - no longer dropped before the export-review page", () => {
  const model = toRenderModel(validExportReviewPacketDto());
  const citation = model.blocks[0].citations[0];
  assert.equal(citation.sourceCode, "src-707");
  assert.deepEqual(citation.approvedAudiences, ["internal", "funder"]);
  assert.deepEqual(citation.limitationCodes, ["retrospective_reporting"]);
});

test("FRONTEND PROJECTION: approvedAudiences preserves null (no claim-review decision recorded) distinctly from an empty array - never fabricated from requestedExportAudience/currentEligible", () => {
  const dto = validExportReviewPacketDto();
  dto.blocks[0].citations[0].approvedAudiences = null;
  const model = toRenderModel(dto);
  assert.equal(model.blocks[0].citations[0].approvedAudiences, null);
  // requestedExportAudience remains a distinct, separately-rendered field -
  // it is never substituted for the citation-level approvedAudiences.
  assert.equal(model.requestedExportAudience, "funder");
});

test("SAFE DTO BOUNDARY: the new fields never carry raw evidence text, storage paths, signed URLs, or actor context - sourceCode/limitationCodes are governed codes only, matching the same safe-value pattern the backend validator enforces", () => {
  const dto = validExportReviewPacketDto();
  const model = toRenderModel(dto);
  const rendered = JSON.stringify(model);
  for (const forbidden of ["http://", "https://", "/storage/", "signed_url", "credentials", "actorContext", "actor_user_id"]) {
    assert.equal(rendered.includes(forbidden), false, `render model must not contain ${forbidden}`);
  }
  // limitationCodes are governed short codes (LIMITATION_CODE_PATTERN-
  // shaped: lowercase, no spaces), never a free-text sentence.
  for (const code of model.blocks[0].citations[0].limitationCodes) {
    assert.match(code, /^[a-z][a-z0-9_.:-]{0,95}$/);
  }
});

test("frontend renders the new Source code / Allowed audiences / Limitation codes rows on the export-review detail page", () => {
  const source = readFileSync(new URL("../frontend/gkExportReviewDetail.jsx", import.meta.url), "utf8");
  assert.match(source, /label="Source code"/);
  assert.match(source, /label="Allowed audiences"/);
  assert.match(source, /label="Limitation codes"/);
  assert.match(source, /citation\.sourceCode/);
  assert.match(source, /citation\.approvedAudiences/);
  assert.match(source, /citation\.limitationCodes/);
});
