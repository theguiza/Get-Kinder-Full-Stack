import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  serializeGrantResponsePacketRenderModelToMarkdown,
  serializeGrantResponsePacketToMarkdown,
} from "../Backend/kai/services/kaiGrantResponsePacketMarkdownSerializer.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const DRAFT_A = "00000000-0000-4000-8000-000000000911";
const DRAFT_B = "00000000-0000-4000-8000-000000000921";
const BLOCK_A1 = "00000000-0000-4000-8000-000000000931";
const BLOCK_A2 = "00000000-0000-4000-8000-000000000932";
const BLOCK_B1 = "00000000-0000-4000-8000-000000000933";
const CITATION_A1 = "00000000-0000-4000-8000-000000000941";
const CITATION_A2 = "00000000-0000-4000-8000-000000000942";
const CITATION_B1 = "00000000-0000-4000-8000-000000000943";
const CLAIM_A = "00000000-0000-4000-8000-000000000951";
const CLAIM_B = "00000000-0000-4000-8000-000000000952";
const CLAIM_C = "00000000-0000-4000-8000-000000000953";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000961";
const EVIDENCE_B = "00000000-0000-4000-8000-000000000962";
const EVIDENCE_C = "00000000-0000-4000-8000-000000000963";
const SOURCE_A = "00000000-0000-4000-8000-000000000971";
const SOURCE_B = "00000000-0000-4000-8000-000000000972";
const SOURCE_C = "00000000-0000-4000-8000-000000000973";
const SOURCE_VERSION_A = "00000000-0000-4000-8000-000000000981";
const SOURCE_VERSION_B = "00000000-0000-4000-8000-000000000982";
const SOURCE_VERSION_C = "00000000-0000-4000-8000-000000000983";
const MEMBER_MANIFEST = "00000000-0000-4000-8000-000000000991";
const MEMBER_CANDIDATE = "00000000-0000-4000-8000-000000000992";

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});

function citation(overrides = {}) {
  return {
    generatedContentCitationId: CITATION_A1,
    claimId: CLAIM_A,
    evidenceItemId: EVIDENCE_A,
    sourceId: SOURCE_A,
    sourceVersionId: SOURCE_VERSION_A,
    supportStrength: "strong",
    claimReviewStatus: "approved",
    evidenceReviewStatus: "approved",
    currentEligible: true,
    blockerCodes: ["source_version_superseded"],
    affectedDimensionKeys: ["currency"],
    affectedObjectIds: ["source-version:1"],
    ...overrides,
  };
}

function member(overrides = {}) {
  return {
    generationRunId: "00000000-0000-4000-8000-000000000901",
    generatedContentDraftId: DRAFT_A,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "funder",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000902",
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewVisible: true,
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000903",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    exportManifestId: MEMBER_MANIFEST,
    exportManifestHistory: [{
      exportManifestId: MEMBER_MANIFEST,
      exportCandidateId: MEMBER_CANDIDATE,
      createdAt: "2026-08-07T09:00:00.000Z",
    }],
    blocks: [{
      generatedContentBlockId: BLOCK_A1,
      ordinal: 1,
      text: "First member, first block.",
      citations: [citation()],
    }, {
      generatedContentBlockId: BLOCK_A2,
      ordinal: 2,
      text: "First member, second block.",
      citations: [citation({
        generatedContentCitationId: CITATION_A2,
        claimId: CLAIM_B,
        evidenceItemId: EVIDENCE_B,
        sourceId: SOURCE_B,
        sourceVersionId: SOURCE_VERSION_B,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      })],
    }],
    ...overrides,
  };
}

function renderModel(overrides = {}) {
  return {
    renderModelContractVersion: "kai-sprint2-grant-response-packet-render-model-v1",
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "funder",
    members: [
      member(),
      member({
        generationRunId: "00000000-0000-4000-8000-000000000904",
        generatedContentDraftId: DRAFT_B,
        reviewQueueItemId: "00000000-0000-4000-8000-000000000905",
        exportReviewQueueItemId: null,
        exportReviewQueueStatus: null,
        exportReviewStatus: null,
        exportManifestId: null,
        exportManifestHistory: [],
        blocks: [{
          generatedContentBlockId: BLOCK_B1,
          ordinal: 1,
          text: "Second member block.",
          citations: [citation({
            generatedContentCitationId: CITATION_B1,
            claimId: CLAIM_C,
            evidenceItemId: EVIDENCE_C,
            sourceId: SOURCE_C,
            sourceVersionId: SOURCE_VERSION_C,
            blockerCodes: ["manual_review_required"],
            affectedDimensionKeys: ["method"],
            affectedObjectIds: ["claim:3"],
          })],
        }],
      }),
    ],
    ...overrides,
  };
}

test("Grant Response Packet Markdown delivery consumes the composite render model and preserves packet/member/block/citation identity", async () => {
  const serviceCalls = [];
  const result = await serializeGrantResponsePacketToMarkdown(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext },
    {
      async composeGrantResponsePacketRenderModel(input) {
        serviceCalls.push(input);
        return { ok: true, data: renderModel(), error: null };
      },
    },
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(serviceCalls, [{ organizationId: ORG, engagementId: ENGAGEMENT, actorContext }]);
  assert.equal(result.data.deliveryClass, "PREVIEW_READ_ONLY");

  const markdown = result.data.markdown;
  assert.match(markdown, /^# Grant Response Packet\n\nMarkdown contract: kai-sprint2-grant-response-packet-markdown-preview-v1\n/);
  assert.match(markdown, /Delivery class: `PREVIEW_READ_ONLY`/);
  assert.match(markdown, new RegExp(`Organization: \`${ORG}\``));
  assert.match(markdown, new RegExp(`Engagement: \`${ENGAGEMENT}\``));
  assert.match(markdown, /Packet audience: `funder`/);
  assert.match(markdown, new RegExp(`Generated content draft: \`${DRAFT_A}\``));
  assert.match(markdown, new RegExp(`Generated content draft: \`${DRAFT_B}\``));
  assert.ok(markdown.indexOf(DRAFT_A) < markdown.indexOf(DRAFT_B));
  assert.ok(markdown.indexOf(`Block 1 (${BLOCK_A1})`) < markdown.indexOf(`Block 2 (${BLOCK_A2})`));
  assert.ok(markdown.indexOf(`Block 2 (${BLOCK_A2})`) < markdown.indexOf(`Block 1 (${BLOCK_B1})`));
  assert.match(markdown, new RegExp(`citation \`${CITATION_A1}\``));
  assert.match(markdown, new RegExp(`citation \`${CITATION_A2}\``));
  assert.match(markdown, new RegExp(`citation \`${CITATION_B1}\``));
  assert.match(markdown, new RegExp(`claim \`${CLAIM_A}\`; evidence \`${EVIDENCE_A}\`; source \`${SOURCE_A}\`; source version \`${SOURCE_VERSION_A}\``));
  assert.match(markdown, /blockers `source_version_superseded`/);
  assert.match(markdown, /blockers `manual_review_required`/);
  assert.match(markdown, /affected dimensions `method`/);
  assert.match(markdown, /affected objects `claim:3`/);

  const memberBStart = markdown.indexOf(DRAFT_B);
  const memberBSlice = markdown.slice(memberBStart);
  assert.match(memberBSlice, new RegExp(`claim \`${CLAIM_C}\`; evidence \`${EVIDENCE_C}\`; source \`${SOURCE_C}\`; source version \`${SOURCE_VERSION_C}\``));
  assert.doesNotMatch(memberBSlice, new RegExp(`claim \`${CLAIM_A}\`; evidence \`${EVIDENCE_A}\``));
});

test("Grant Response Packet Markdown delivery never promotes member manifest or candidate identity to packet identity", () => {
  const markdown = serializeGrantResponsePacketRenderModelToMarkdown(renderModel());
  const header = markdown.slice(0, markdown.indexOf("## Members"));

  assert.doesNotMatch(header, /exportManifestId|exportCandidateId|Manifest|Candidate/i);
  assert.match(markdown, new RegExp(`Member export manifest metadata: \`${MEMBER_MANIFEST}\``));
  assert.equal(Object.prototype.hasOwnProperty.call(renderModel(), "exportManifestId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(renderModel(), "exportCandidateId"), false);
});

test("Grant Response Packet Markdown delivery is deterministic and exposes no raw evidence, storage, signed URL, generation, or mutation surface", () => {
  const first = serializeGrantResponsePacketRenderModelToMarkdown(renderModel());
  const second = serializeGrantResponsePacketRenderModelToMarkdown(renderModel());
  assert.equal(first, second);

  for (const forbidden of [
    "rawEvidence",
    "evidenceBody",
    "sourceBody",
    "sourceText",
    "rawSource",
    "sourceContent",
    "storageLocation",
    "signedUrl",
    "gs://",
    "s3://",
  ]) {
    assert.equal(first.includes(forbidden), false, forbidden);
  }

  const source = readFileSync("Backend/kai/services/kaiGrantResponsePacketMarkdownSerializer.js", "utf8");
  assert.doesNotMatch(source, /latest|newest|preferred|LIMIT\s+1|ORDER BY/i);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b|FOR\s+UPDATE|metadataOnlyAudit|final-release|final release/i);
  assert.doesNotMatch(source, /Anthropic|OpenAI|completion|messages\.create|responses\.create/i);
});

test("Grant Response Packet Markdown delivery preserves existing tenant/actor authority by delegating to the composite service before rendering", async () => {
  let repositoryCalls = 0;
  const result = await serializeGrantResponsePacketToMarkdown(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: { actorType: "system", actorUserId: "svc" } },
    {
      renderModelDependencies: {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        generatedContentRepository: {
          async getGrantResponsePacket() {
            repositoryCalls += 1;
            throw new Error("must not read");
          },
        },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(repositoryCalls, 0);
});
