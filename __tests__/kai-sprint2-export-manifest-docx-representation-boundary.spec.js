import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import JSZip from "jszip";

import {
  serializeExportManifestRenderModelToDocx,
  serializeExportManifestToDocx,
  __exportManifestDocxSerializerTestables,
} from "../Backend/kai/services/kaiExportManifestDocxSerializer.js";
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

function manyBlocksRenderModel(blockCount) {
  const blocks = [];
  for (let ordinal = 1; ordinal <= blockCount; ordinal += 1) {
    blocks.push({
      ordinal,
      text: `Block ${ordinal} body text that is long enough to occupy meaningful vertical space on the page and force pagination across the document when repeated many times over.`,
      citations: [],
    });
  }
  return __exportManifestRenderModelRepositoryTestables.composeRenderModel({
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
      blocks,
      limitations: [],
    },
  });
}

async function documentXml(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  return zip.file("word/document.xml").async("string");
}

async function fullText(docxBuffer) {
  const xml = await documentXml(docxBuffer);
  return xml.replace(/<[^>]+>/g, " ");
}

test("valid render-model DTO serializes to a valid DOCX (OOXML zip package) with the required Word parts", async () => {
  const model = renderModel();
  const buffer = await serializeExportManifestRenderModelToDocx(model);

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 2).toString("latin1"), "PK");

  const zip = await JSZip.loadAsync(buffer);
  for (const requiredPart of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
  ]) {
    assert.ok(zip.file(requiredPart), `missing required part ${requiredPart}`);
  }
  assert.equal(
    __exportManifestDocxSerializerTestables.DOCX_CONTRACT_VERSION,
    "kai-sprint2-export-manifest-docx-v1",
  );
});

test("malformed render model is rejected before any DOCX bytes are produced", () => {
  assert.throws(() => serializeExportManifestRenderModelToDocx(null), /render-model DTO/);
  assert.throws(() => serializeExportManifestRenderModelToDocx({}), /render-model DTO/);
  assert.throws(
    () => serializeExportManifestRenderModelToDocx({ renderModelContractVersion: "v1" }),
    /render-model DTO/,
  );
});

test("authoritative content-block order and generated block text are preserved", async () => {
  const text = await fullText(await serializeExportManifestRenderModelToDocx(renderModel()));
  assert.ok(text.indexOf("Block 1") < text.indexOf("Block 2"));
  assert.match(text, /First block\./);
  assert.match(text, /Preserve generated text\./);
  assert.match(text, /Second block\./);
});

test("citation markers appear with their content and the citation appendix lists every citation", async () => {
  const model = renderModel();
  const text = await fullText(await serializeExportManifestRenderModelToDocx(model));
  for (const citation of model.citations) {
    assert.match(text, new RegExp(`\\[${citation.citationRef}\\]`));
  }
  assert.match(text, /Citation Appendix/);
  for (const citation of model.citations) {
    assert.match(
      text,
      new RegExp(`\\[${citation.citationRef}\\]\\s+Claim\\s+${citation.claimId};\\s*evidence\\s+${citation.evidenceItemId};\\s*source\\s+${citation.sourceId};\\s*source\\s+version\\s+${citation.sourceVersionId}`),
    );
  }
});

test("limitations and method notes are represented and bound to render-model entries only", async () => {
  const model = renderModel();
  const text = await fullText(await serializeExportManifestRenderModelToDocx(model));
  assert.match(text, /Limitations and Method Notes/);
  assert.match(text, /sample_size_small, self_reported/);
  assert.match(text, /\[CIT-002\] limitation codes: none/);
});

test("long content is not truncated across many content blocks", async () => {
  const model = manyBlocksRenderModel(80);
  const buffer = await serializeExportManifestRenderModelToDocx(model);
  const text = await fullText(buffer);
  assert.match(text, /Block 1\b/);
  assert.match(text, /Block 80\b/);
});

test("user-visible content keeps manifest, candidate, authority, and fingerprint trace internal", async () => {
  const text = await fullText(await serializeExportManifestRenderModelToDocx(renderModel()));
  for (const hidden of [MANIFEST, CANDIDATE, DRAFT, SNAPSHOT, DECISION, "a".repeat(64), "b".repeat(64)]) {
    assert.equal(text.includes(hidden), false, hidden);
  }
  assert.match(text, /Content type: evidence_summary/);
  assert.match(text, /Requested audience: internal/);
});

test("private paths, storage material, credentials, and raw diagnostics are not introduced", async () => {
  const text = await fullText(await serializeExportManifestRenderModelToDocx(renderModel()));
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
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test("document.xml content is semantically deterministic across repeated calls with the same render model", async () => {
  const model = renderModel();
  const first = await serializeExportManifestRenderModelToDocx(model);
  const second = await serializeExportManifestRenderModelToDocx(model);
  const firstXml = await documentXml(first);
  const secondXml = await documentXml(second);
  assert.equal(firstXml, secondXml);
});

test("full DOCX package bytes are not byte-identical across repeated calls (library-embedded docProps timestamp)", async () => {
  const model = renderModel();
  const first = await serializeExportManifestRenderModelToDocx(model);
  const second = await serializeExportManifestRenderModelToDocx(model);
  // The `docx` package hardcodes `new Date()` into docProps/core.xml
  // (dcterms:created / dcterms:modified) with no override hook, unlike
  // pdfkit's Info.CreationDate. Full-package byte determinism is therefore
  // not achievable with this library; semantic determinism (document.xml)
  // is verified separately above.
  assert.equal(first.equals(second), false);
});

test("pure serializer source has no database, storage, artifact, route, or recomputation behavior", () => {
  const source = fs.readFileSync(new URL("../Backend/kai/services/kaiExportManifestDocxSerializer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /withTransaction|\.query\(|SELECT |INSERT |UPDATE |DELETE |kai\.|DATABASE_URL|storage|Storage|writeFile|createWriteStream|artifact|canonicalFingerprint|evaluateExportCandidateCurrentness|loadExportCandidateCanonicalRepresentation/i);
});

test("pure serializer accepts only the render-model DTO and no upstream identifiers or actor context", () => {
  assert.equal(serializeExportManifestRenderModelToDocx.length, 1);
  assert.equal(__exportManifestDocxSerializerTestables.validateRenderModel({
    exportManifestId: MANIFEST,
    organizationId: ORG,
    actorContext: {},
  }), false);
});

test("thin wrapper reuses render-model service and returns DOCX bytes only after success", async () => {
  let calls = 0;
  const result = await serializeExportManifestToDocx(
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
  assert.ok(Buffer.isBuffer(result.data.docx));
  assert.equal(result.data.docx.slice(0, 2).toString("latin1"), "PK");
  assert.equal(result.data.docxContractVersion, "kai-sprint2-export-manifest-docx-v1");
});

test("thin wrapper propagates stale/current-state failures unchanged and does not render", async () => {
  let serializerInputTouched = false;
  const stale = {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409, reason: "fingerprint_mismatch" },
  };
  const result = await serializeExportManifestToDocx(
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

test("AI/system actors are denied by the existing governed render-model service before rendering", async () => {
  let renderCalls = 0;
  const result = await serializeExportManifestToDocx(
    { organizationId: ORG, exportManifestId: MANIFEST, actorContext: { actorType: "system", actorUserId: "svc" } },
    {
      renderModelDependencies: {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" },
        repository: { async composeExportManifestRenderModel() { renderCalls += 1; throw new Error("must not render"); } },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(renderCalls, 0);
});
