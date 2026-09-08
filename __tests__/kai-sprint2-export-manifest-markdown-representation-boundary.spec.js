import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  serializeExportManifestRenderModelToMarkdown,
  serializeExportManifestToMarkdown,
  __exportManifestMarkdownSerializerTestables,
} from "../Backend/kai/services/kaiExportManifestMarkdownSerializer.js";
import {
  __exportManifestRenderModelRepositoryTestables,
} from "../Backend/kai/dictionary/postgresExportManifestRenderModelRepository.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const MANIFEST = "00000000-0000-4000-8000-000000000601";
const CANDIDATE = "00000000-0000-4000-8000-000000000401";
const DRAFT = "00000000-0000-4000-8000-000000000301";
const SNAPSHOT = "00000000-0000-4000-8000-000000000701";
const DECISION = "00000000-0000-4000-8000-000000000501";
const CLAIM_A = "00000000-0000-4000-8000-000000000901";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000902";
const CLAIM_B = "00000000-0000-4000-8000-000000000903";
const EVIDENCE_B = "00000000-0000-4000-8000-000000000904";
const SOURCE_A = "00000000-0000-4000-8000-000000000a01";
const SOURCE_VERSION_A = "00000000-0000-4000-8000-000000000b01";
const SOURCE_B = "00000000-0000-4000-8000-000000000a02";
const SOURCE_VERSION_B = "00000000-0000-4000-8000-000000000b02";

function renderModel(overrides = {}) {
  const base = __exportManifestRenderModelRepositoryTestables.composeRenderModel({
    manifest: {
      export_manifest_id: MANIFEST,
      organization_id: ORG,
      export_candidate_id: CANDIDATE,
      effective_authority_decision_id: DECISION,
      effective_authority_decision_type: "export_authority_granted",
      fingerprint_contract_version: "kai-sprint2-p3-19-export-manifest-fingerprint-v1",
      canonical_fingerprint: "a".repeat(64),
      created_at: "2026-09-06T10:20:00.000Z",
    },
    candidate: {
      exportCandidateId: CANDIDATE,
      generatedContentDraftId: DRAFT,
      contentType: "evidence_summary",
      requestedAudience: "internal",
      limitationSnapshotId: SNAPSHOT,
      fingerprintContractVersion: "kai-sprint2-p3-16-export-candidate-fingerprint-v1",
      canonicalFingerprint: "b".repeat(64),
    },
    representation: {
      organizationId: ORG,
      generatedContentDraftId: DRAFT,
      contentType: "evidence_summary",
      requestedAudience: "internal",
      blocks: [
        {
          ordinal: 2,
          text: "Second block.",
          citations: [],
        },
        {
          ordinal: 1,
          text: "First block.\n\nPreserve generated text.",
          citations: [
            { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, sourceId: SOURCE_A, sourceVersionId: SOURCE_VERSION_A },
            { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, sourceId: SOURCE_B, sourceVersionId: SOURCE_VERSION_B },
          ],
        },
      ],
      limitations: [
        { claimId: CLAIM_B, evidenceItemId: EVIDENCE_B, limitationCodes: [] },
        { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["sample_size_small", "self_reported"] },
      ],
    },
  });
  return {
    ...base,
    ...overrides,
    content: { ...base.content, ...(overrides.content || {}) },
    exportCandidate: { ...base.exportCandidate, ...(overrides.exportCandidate || {}) },
    methodNotes: { ...base.methodNotes, ...(overrides.methodNotes || {}) },
  };
}

function emittedBodyRefs(markdown) {
  const content = markdown.slice(markdown.indexOf("## Content"), markdown.indexOf("## Citation Appendix"));
  return [...content.matchAll(/\[CIT-\d{3}\]/g)].map((match) => match[0].slice(1, -1));
}

function appendixRefs(markdown) {
  const appendix = markdown.slice(markdown.indexOf("## Citation Appendix"), markdown.indexOf("## Limitations and Method Notes"));
  return [...appendix.matchAll(/\[CIT-\d{3}\]/g)].map((match) => match[0].slice(1, -1));
}

test("valid render-model DTO serializes to deterministic Markdown with stable contract metadata", () => {
  const model = renderModel();
  const first = serializeExportManifestRenderModelToMarkdown(model);
  const second = serializeExportManifestRenderModelToMarkdown(model);

  assert.equal(first, second);
  assert.match(first, /^# Export Manifest\n\nMarkdown contract: kai-sprint2-export-manifest-markdown-v1\n/);
  assert.match(first, /Render model contract: `kai-sprint2-export-manifest-render-model-v1`/);
  assert.match(first, /Content type: `evidence_summary`/);
  assert.match(first, /Requested audience: `internal`/);
  assert.equal(__exportManifestMarkdownSerializerTestables.MARKDOWN_CONTRACT_VERSION, "kai-sprint2-export-manifest-markdown-v1");
});

test("authoritative content-block order and generated block text are preserved", () => {
  const markdown = serializeExportManifestRenderModelToMarkdown(renderModel());
  assert.ok(markdown.indexOf("### Block 1") < markdown.indexOf("### Block 2"));
  assert.match(markdown, /First block\.\n\nPreserve generated text\.\n\nReferences: \[CIT-001\] \[CIT-002\]/);
  assert.match(markdown, /### Block 2\n\nSecond block\./);
});

test("citation references serialize deterministically and every emitted body citation resolves", () => {
  const model = renderModel();
  const markdown = serializeExportManifestRenderModelToMarkdown(model);
  const bodyRefs = emittedBodyRefs(markdown);
  const appendix = new Set(appendixRefs(markdown));

  assert.deepEqual(bodyRefs, ["CIT-001", "CIT-002"]);
  assert.deepEqual([...appendix], ["CIT-001", "CIT-002"]);
  for (const ref of bodyRefs) assert.equal(appendix.has(ref), true, ref);
  assert.equal(new Set(bodyRefs).size, bodyRefs.length);
});

test("citation appendix relationships are not dropped or orphaned", () => {
  const model = renderModel();
  const markdown = serializeExportManifestRenderModelToMarkdown(model);

  for (const citation of model.citations) {
    assert.match(markdown, new RegExp(`\\[${citation.citationRef}\\] Claim \`${citation.claimId}\`; evidence \`${citation.evidenceItemId}\`; source \`${citation.sourceId}\`; source version \`${citation.sourceVersionId}\`\\.`));
  }
  assert.deepEqual(appendixRefs(markdown).sort(), model.citations.map((citation) => citation.citationRef).sort());
});

test("limitation and method-note output is deterministic and bound to render-model entries only", () => {
  const model = renderModel();
  const first = serializeExportManifestRenderModelToMarkdown(model);
  const second = serializeExportManifestRenderModelToMarkdown(model);

  assert.equal(first, second);
  assert.match(first, /\[CIT-001\] limitation codes: `sample_size_small`, `self_reported`\./);
  assert.match(first, /\[CIT-002\] limitation codes: none\./);
  assert.doesNotMatch(first, /limitation_snapshot_superseded|fingerprint_mismatch|newer limitation/i);
});

test("user-visible metadata boundary keeps manifest, candidate, authority, and fingerprint trace internal", () => {
  const markdown = serializeExportManifestRenderModelToMarkdown(renderModel());
  for (const hidden of [MANIFEST, CANDIDATE, DRAFT, SNAPSHOT, DECISION, "a".repeat(64), "b".repeat(64)]) {
    assert.equal(markdown.includes(hidden), false, hidden);
  }
  assert.match(markdown, /Content type: `evidence_summary`/);
  assert.match(markdown, /Requested audience: `internal`/);
});

test("private paths, storage material, credentials, prompts, and raw diagnostics are not introduced", () => {
  const markdown = serializeExportManifestRenderModelToMarkdown(renderModel());
  for (const forbidden of [
    "storageKey",
    "storagePath",
    "signedUrl",
    "downloadUrl",
    "credential",
    "secret",
    "prompt",
    "rawRows",
    "rawFileContent",
    "/private/",
    "gs://",
    "https://",
  ]) {
    assert.equal(markdown.includes(forbidden), false, forbidden);
  }
});

test("pure serializer source has no database, storage, artifact, PDF, DOCX, route, or recomputation behavior", () => {
  const source = fs.readFileSync(new URL("../Backend/kai/services/kaiExportManifestMarkdownSerializer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /withTransaction|\.query\(|SELECT |INSERT |UPDATE |DELETE |kai\.|DATABASE_URL|storage|Storage|writeFile|createWriteStream|artifact|pdf|docx|canonicalFingerprint|evaluateExportCandidateCurrentness|loadExportCandidateCanonicalRepresentation/i);
});

test("pure serializer accepts only the render-model DTO and no upstream identifiers or actor context", () => {
  assert.equal(serializeExportManifestRenderModelToMarkdown.length, 1);
  assert.equal(__exportManifestMarkdownSerializerTestables.validateRenderModel({
    exportManifestId: MANIFEST,
    organizationId: ORG,
    actorContext: {},
  }), false);
  assert.throws(() => serializeExportManifestRenderModelToMarkdown(null), /render-model DTO/);
});

test("thin wrapper reuses render-model service and returns Markdown only after success", async () => {
  let calls = 0;
  const result = await serializeExportManifestToMarkdown(
    { organizationId: ORG, exportManifestId: MANIFEST, actorContext: { actorType: "human" } },
    {
      renderModelDependencies: { env: { sentinel: "local" } },
      composeExportManifestRenderModel: async (input, dependencies) => {
        calls += 1;
        assert.equal(input.exportManifestId, MANIFEST);
        assert.deepEqual(dependencies, { env: { sentinel: "local" } });
        return { ok: true, data: renderModel(), error: null };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.match(result.data.markdown, /^# Export Manifest/);
  assert.equal(result.data.markdownContractVersion, "kai-sprint2-export-manifest-markdown-v1");
});

test("thin wrapper propagates stale/current-state failures unchanged and does not serialize", async () => {
  let serializerInputTouched = false;
  const stale = {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409, reason: "fingerprint_mismatch" },
  };
  const result = await serializeExportManifestToMarkdown(
    { organizationId: ORG, exportManifestId: MANIFEST, actorContext: { actorType: "human" } },
    {
      composeExportManifestRenderModel: async () => stale,
      renderModelDependencies: new Proxy({}, {
        get() {
          serializerInputTouched = true;
          return undefined;
        },
      }),
    },
  );
  assert.equal(result, stale);
  assert.equal(serializerInputTouched, false);
});

test("existing render-model behavior remains unchanged for serializer input", () => {
  const model = renderModel();
  assert.deepEqual(model.content.blocks.map((block) => block.ordinal), [1, 2]);
  assert.deepEqual(model.content.blocks[0].citationRefs, ["CIT-001", "CIT-002"]);
  assert.deepEqual(model.citations.map((citation) => citation.citationRef), ["CIT-001", "CIT-002"]);
  assert.equal(model.limitations[0].citationRef, "CIT-001");
  assert.equal(model.methodNotes.limitationSnapshotId, SNAPSHOT);
});
