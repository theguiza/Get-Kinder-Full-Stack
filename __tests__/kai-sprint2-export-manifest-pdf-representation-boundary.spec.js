import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  serializeExportManifestRenderModelToPdf,
  serializeExportManifestToPdf,
  __exportManifestPdfSerializerTestables,
} from "../Backend/kai/services/kaiExportManifestPdfSerializer.js";
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
      blocks,
      limitations: [],
    },
  });
  return base;
}

async function pageTexts(pdfBuffer) {
  const mupdf = await import("mupdf");
  mupdf.setLog(null);
  const document = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const pageCount = document.countPages();
  const texts = [];
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.loadPage(index);
    texts.push(page.toStructuredText().asText());
  }
  return { pageCount, texts, fullText: texts.join("\n") };
}

test("valid render-model DTO serializes to a byte-identical, valid PDF across repeated calls", async () => {
  const model = renderModel();
  const first = await serializeExportManifestRenderModelToPdf(model);
  const second = await serializeExportManifestRenderModelToPdf(model);

  assert.ok(Buffer.isBuffer(first));
  assert.equal(first.slice(0, 5).toString("latin1"), "%PDF-");
  assert.equal(first.equals(second), true);
  assert.equal(__exportManifestPdfSerializerTestables.PDF_CONTRACT_VERSION, "kai-sprint2-export-manifest-pdf-v1");
});

test("malformed render model is rejected before any PDF bytes are produced", () => {
  assert.throws(() => serializeExportManifestRenderModelToPdf(null), /render-model DTO/);
  assert.throws(() => serializeExportManifestRenderModelToPdf({}), /render-model DTO/);
  assert.throws(
    () => serializeExportManifestRenderModelToPdf({ renderModelContractVersion: "v1" }),
    /render-model DTO/,
  );
});

test("authoritative content-block order and generated block text are preserved", async () => {
  const { fullText } = await pageTexts(await serializeExportManifestRenderModelToPdf(renderModel()));
  assert.ok(fullText.indexOf("Block 1") < fullText.indexOf("Block 2"));
  assert.match(fullText, /First block\./);
  assert.match(fullText, /Preserve generated text\./);
  assert.match(fullText, /Second block\./);
});

test("citation markers appear with their content and the citation appendix lists every citation", async () => {
  const model = renderModel();
  const { fullText } = await pageTexts(await serializeExportManifestRenderModelToPdf(model));
  for (const citation of model.citations) {
    assert.match(fullText, new RegExp(`\\[${citation.citationRef}\\]`));
  }
  assert.match(fullText, /Citation Appendix/);
  for (const citation of model.citations) {
    assert.match(
      fullText,
      new RegExp(`\\[${citation.citationRef}\\]\\s+Claim\\s+${citation.claimId};\\s*evidence\\s+${citation.evidenceItemId};\\s*source\\s+${citation.sourceId};\\s*source\\s+version\\s+${citation.sourceVersionId}`),
    );
  }
});

test("limitations and method notes are represented and bound to render-model entries only", async () => {
  const model = renderModel();
  const { fullText } = await pageTexts(await serializeExportManifestRenderModelToPdf(model));
  assert.match(fullText, /Limitations and Method Notes/);
  assert.match(fullText, /sample_size_small, self_reported/);
  assert.match(fullText, /\[CIT-002\] limitation codes: none/);
});

test("multi-page content renders every page and does not truncate later blocks", async () => {
  const model = manyBlocksRenderModel(80);
  const buffer = await serializeExportManifestRenderModelToPdf(model);
  const { pageCount, fullText } = await pageTexts(buffer);
  assert.ok(pageCount > 1, `expected multiple pages, got ${pageCount}`);
  assert.match(fullText, /Block 1\b/);
  assert.match(fullText, /Block 80\b/);
});

test("user-visible content keeps manifest, candidate, authority, and fingerprint trace internal", async () => {
  const { fullText } = await pageTexts(await serializeExportManifestRenderModelToPdf(renderModel()));
  for (const hidden of [MANIFEST, CANDIDATE, DRAFT, SNAPSHOT, DECISION, "a".repeat(64), "b".repeat(64)]) {
    assert.equal(fullText.includes(hidden), false, hidden);
  }
  assert.match(fullText, /Content type: evidence_summary/);
  assert.match(fullText, /Requested audience: internal/);
});

test("private paths, storage material, credentials, and raw diagnostics are not introduced", async () => {
  const { fullText } = await pageTexts(await serializeExportManifestRenderModelToPdf(renderModel()));
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
    assert.equal(fullText.includes(forbidden), false, forbidden);
  }
});

test("pure serializer source has no database, storage, artifact, route, or recomputation behavior", () => {
  const source = fs.readFileSync(new URL("../Backend/kai/services/kaiExportManifestPdfSerializer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /withTransaction|\.query\(|SELECT |INSERT |UPDATE |DELETE |kai\.|DATABASE_URL|storage|Storage|writeFile|createWriteStream|artifact|canonicalFingerprint|evaluateExportCandidateCurrentness|loadExportCandidateCanonicalRepresentation/i);
});

test("pure serializer accepts only the render-model DTO and no upstream identifiers or actor context", () => {
  assert.equal(serializeExportManifestRenderModelToPdf.length, 1);
  assert.equal(__exportManifestPdfSerializerTestables.validateRenderModel({
    exportManifestId: MANIFEST,
    organizationId: ORG,
    actorContext: {},
  }), false);
});

test("thin wrapper reuses render-model service and returns PDF bytes only after success", async () => {
  let calls = 0;
  const result = await serializeExportManifestToPdf(
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
  assert.ok(Buffer.isBuffer(result.data.pdf));
  assert.equal(result.data.pdf.slice(0, 5).toString("latin1"), "%PDF-");
  assert.equal(result.data.pdfContractVersion, "kai-sprint2-export-manifest-pdf-v1");
});

test("thin wrapper propagates stale/current-state failures unchanged and does not render", async () => {
  let serializerInputTouched = false;
  const stale = {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409, reason: "fingerprint_mismatch" },
  };
  const result = await serializeExportManifestToPdf(
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
  const result = await serializeExportManifestToPdf(
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
