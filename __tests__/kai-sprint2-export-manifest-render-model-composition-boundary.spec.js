import test from "node:test";
import assert from "node:assert/strict";

import {
  createPostgresExportManifestRenderModelRepository,
  __exportManifestRenderModelRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportManifestRenderModelRepository.js";
import {
  composeExportManifestRenderModel,
  __exportManifestRenderModelServiceTestables,
} from "../Backend/kai/services/kaiExportManifestRenderModelService.js";
import {
  __exportCandidateRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const MANIFEST = "00000000-0000-4000-8000-000000000601";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const SNAPSHOT = "00000000-0000-4000-8000-000000000701";
const DECISION = "00000000-0000-4000-8000-000000000501";
const CLAIM_A = "00000000-0000-4000-8000-000000000901";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000902";
const CLAIM_B = "00000000-0000-4000-8000-000000000903";
const EVIDENCE_B = "00000000-0000-4000-8000-000000000904";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const gkAdmin = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});

function manifestRow(overrides = {}) {
  return {
    export_manifest_id: MANIFEST,
    organization_id: ORG,
    export_candidate_id: CANDIDATE,
    effective_authority_decision_id: DECISION,
    effective_authority_decision_type: "export_authority_granted",
    fingerprint_contract_version: "kai-sprint2-p3-19-export-manifest-fingerprint-v1",
    canonical_fingerprint: "a".repeat(64),
    created_at: "2026-09-06T10:20:00.000Z",
    ...overrides,
  };
}

function canonicalRepresentation({ blockOrder = [2, 1], citationOrder = [1, 0], limitationCodes = ["sample_size_small"] } = {}) {
  const baseBlocks = [
    {
      ordinal: 1,
      text: "First block.",
      citations: [
        { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, sourceId: "00000000-0000-4000-8000-000000000a01", sourceVersionId: "00000000-0000-4000-8000-000000000b01" },
        { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, sourceId: "00000000-0000-4000-8000-000000000a02", sourceVersionId: "00000000-0000-4000-8000-000000000b02" },
      ],
    },
    { ordinal: 2, text: "Second block.", citations: [] },
  ];
  const blocks = blockOrder.map((ordinal) => baseBlocks.find((block) => block.ordinal === ordinal));
  blocks[blockOrder.indexOf(1)] = {
    ...blocks[blockOrder.indexOf(1)],
    citations: citationOrder.map((index) => baseBlocks[0].citations[index]),
  };
  return {
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    blocks,
    limitations: [
      { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes },
      { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
    ],
  };
}

function candidateProjection(fingerprint = "b".repeat(64)) {
  return {
    exportCandidateId: CANDIDATE,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    limitationSnapshotId: SNAPSHOT,
    fingerprintContractVersion: "kai-sprint2-p3-16-export-candidate-fingerprint-v1",
    canonicalFingerprint: fingerprint,
  };
}

function fakeTx(row = manifestRow()) {
  return {
    async query(sql, params) {
      if (/SET TRANSACTION/.test(sql)) return { rows: [] };
      if (/FROM kai\.export_manifests/.test(sql)) {
        return params[0] === ORG && params[1] === MANIFEST ? { rows: [row] } : { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function repositoryDeps({
  row = manifestRow(),
  currentness = { ok: true, data: { current: true, reason: null }, error: null },
  representation = canonicalRepresentation({ blockOrder: [1, 2], citationOrder: [0, 1] }),
  fingerprint,
  calls = {},
} = {}) {
  const computedFingerprint = fingerprint
    || __exportCandidateRepositoryTestables.canonicalFingerprint(
      __exportCandidateRepositoryTestables.buildCanonicalRepresentation({
        organizationId: representation.organizationId,
        generatedContentDraftId: representation.generatedContentDraftId,
        contentType: representation.contentType,
        requestedAudience: representation.requestedAudience,
        blocks: representation.blocks.map((block) => ({
          ordinal: block.ordinal,
          text: block.text,
          citations: block.citations.map((citation) => ({
            claim_id: citation.claimId,
            evidence_item_id: citation.evidenceItemId,
            source_id: citation.sourceId,
            source_version_id: citation.sourceVersionId,
          })),
        })),
        snapshotEntries: representation.limitations.map((limitation) => ({
          claim_id: limitation.claimId,
          evidence_item_id: limitation.evidenceItemId,
          limitation_codes: limitation.limitationCodes,
        })),
      }),
    );
  return {
    runInTransaction: async (callback) => callback(fakeTx(row)),
    evaluateCandidateCurrentness: async (...args) => {
      calls.currentness = (calls.currentness || 0) + 1;
      calls.currentnessArgs = args;
      return currentness;
    },
    loadCandidateRepresentation: async (...args) => {
      calls.representation = (calls.representation || 0) + 1;
      calls.representationArgs = args;
      return {
        ok: true,
        data: {
          candidate: candidateProjection(computedFingerprint),
          representation,
          fingerprint: computedFingerprint,
          reason: null,
        },
        error: null,
      };
    },
  };
}

function serviceInput(overrides = {}) {
  return { organizationId: ORG, exportManifestId: MANIFEST, actorContext: gkAdmin, ...overrides };
}

test("valid current manifest composes one deterministic manifest-bound render model", async () => {
  const calls = {};
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps({ calls }));
  const first = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  const second = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.data, second.data);
  assert.equal(first.data.renderModelContractVersion, "kai-sprint2-export-manifest-render-model-v1");
  assert.equal(first.data.manifest.exportManifestId, MANIFEST);
  assert.equal(first.data.exportCandidate.exportCandidateId, CANDIDATE);
  assert.equal(first.data.authority.effectiveAuthorityDecisionId, DECISION);
  assert.equal(first.data.content.blocks.length, 2);
  assert.deepEqual(first.data.content.blocks[0].citationRefs, ["CIT-001", "CIT-002"]);
  assert.deepEqual(first.data.citations.map((citation) => citation.citationRef), ["CIT-001", "CIT-002"]);
  assert.equal(first.data.limitations[0].citationRef, "CIT-001");
  assert.equal(first.data.methodNotes.limitationSnapshotId, SNAPSHOT);
  assert.equal(calls.currentness, 2);
  assert.equal(calls.representation, 2);
});

test("repository fails closed on missing manifest and cross-tenant manifest without an existence leak", async () => {
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps());
  assert.equal((await repository.composeExportManifestRenderModel({ organizationId: OTHER_ORG, exportManifestId: MANIFEST })).error.code, "not_found");
  assert.equal((await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: "00000000-0000-4000-8000-000000000999" })).error.code, "not_found");
});

test("stale P3-16 candidate fails closed before representation composition", async () => {
  const calls = {};
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps({
    currentness: { ok: true, data: { current: false, reason: "fingerprint_mismatch" }, error: null },
    calls,
  }));
  const result = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.reason, "fingerprint_mismatch");
  assert.equal(calls.representation || 0, 0);
});

test("changed candidate-bound citation or limitation state cannot silently render under the manifest", async () => {
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps({
    currentness: { ok: true, data: { current: false, reason: "limitation_snapshot_superseded" }, error: null },
  }));
  const result = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.reason, "limitation_snapshot_superseded");
});

test("representation fingerprint mismatch also fails closed", async () => {
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps({ fingerprint: "c".repeat(64) }));
  const result = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  assert.equal(result.ok, true);

  const mismatchedRepository = createPostgresExportManifestRenderModelRepository({
    ...repositoryDeps(),
    loadCandidateRepresentation: async () => ({
      ok: true,
      data: {
        candidate: candidateProjection("d".repeat(64)),
        representation: canonicalRepresentation({ blockOrder: [1, 2], citationOrder: [0, 1] }),
        fingerprint: "e".repeat(64),
        reason: null,
      },
      error: null,
    }),
  });
  const mismatch = await mismatchedRepository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error.reason, "fingerprint_mismatch");
});

test("render-model composition uses deterministic block, citation, appendix, and limitation ordering from P3-16 representation", () => {
  const model = __exportManifestRenderModelRepositoryTestables.composeRenderModel({
    manifest: manifestRow(),
    candidate: candidateProjection(),
    representation: canonicalRepresentation({ blockOrder: [1, 2], citationOrder: [1, 0], limitationCodes: ["z_code", "a_code"] }),
  });
  assert.deepEqual(model.content.blocks.map((block) => block.ordinal), [1, 2]);
  assert.deepEqual(model.content.blocks[0].citationRefs, ["CIT-001", "CIT-002"]);
  assert.deepEqual(model.citations.map((citation) => citation.claimId), [CLAIM_B, CLAIM_A]);
  assert.deepEqual(model.limitations.map((entry) => entry.claimId), [CLAIM_A, CLAIM_B]);
  assert.deepEqual(model.limitations[0].limitationCodes, ["a_code", "z_code"]);
});

test("render model exposes no artifact, storage, credential, prompt, raw row, or rendered-format fields", async () => {
  const repository = createPostgresExportManifestRenderModelRepository(repositoryDeps());
  const result = await repository.composeExportManifestRenderModel({ organizationId: ORG, exportManifestId: MANIFEST });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.data);
  for (const forbidden of [
    "markdown",
    "pdf",
    "docx",
    "artifactBytes",
    "storageKey",
    "storagePath",
    "signedUrl",
    "downloadUrl",
    "credential",
    "secret",
    "prompt",
    "rawRows",
    "rawFileContent",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("service reuses P3-19 feature flags and gk_admin human authorization without adding a new gate", async () => {
  let calls = 0;
  const repository = { async composeExportManifestRenderModel() { calls += 1; return { ok: true, data: { ok: true }, error: null }; } };
  assert.equal((await composeExportManifestRenderModel(serviceInput(), { env: enabledEnv, repository })).ok, true);
  assert.equal(calls, 1);
  assert.equal((await composeExportManifestRenderModel(serviceInput(), { env: {}, repository })).error.code, "feature_disabled");
  assert.equal((await composeExportManifestRenderModel(serviceInput({ actorContext: { actorType: "ai", actorUserId: "x" } }), { env: enabledEnv, repository })).error.code, "authorization_denied");
  const reviewer = {
    ...gkAdmin,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  assert.equal((await composeExportManifestRenderModel(serviceInput({ actorContext: reviewer }), { env: enabledEnv, repository })).error.code, "authorization_denied");
  assert.equal(calls, 1);
});

test("service and repository input contracts are exact-key and tenant-shaped", () => {
  assert.equal(__exportManifestRenderModelServiceTestables.isComposeExportManifestRenderModelInput(serviceInput()), true);
  assert.equal(__exportManifestRenderModelServiceTestables.isComposeExportManifestRenderModelInput({ ...serviceInput(), exportCandidateId: CANDIDATE }), false);
  assert.equal(__exportManifestRenderModelRepositoryTestables.isComposeExportManifestRenderModelInput({ organizationId: ORG, exportManifestId: MANIFEST }), true);
  assert.equal(__exportManifestRenderModelRepositoryTestables.isComposeExportManifestRenderModelInput({ organizationId: ORG, exportManifestId: MANIFEST, actorContext: gkAdmin }), false);
});

test("existing P3-16 canonical representation and fingerprint helpers remain unchanged and reusable", () => {
  const { buildCanonicalRepresentation, canonicalFingerprint } = __exportCandidateRepositoryTestables;
  const representation = buildCanonicalRepresentation({
    organizationId: ORG,
    generatedContentDraftId: DRAFT,
    contentType: "evidence_summary",
    requestedAudience: "internal",
    blocks: [{
      ordinal: 1,
      text: "Text.",
      citations: [{ claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, source_id: "s1", source_version_id: "sv1" }],
    }],
    snapshotEntries: [{ claim_id: CLAIM_A, evidence_item_id: EVIDENCE_A, limitation_codes: [] }],
  });
  assert.deepEqual(Object.keys(representation), ["organizationId", "generatedContentDraftId", "contentType", "requestedAudience", "blocks", "limitations"]);
  assert.match(canonicalFingerprint(representation), /^[a-f0-9]{64}$/);
});
