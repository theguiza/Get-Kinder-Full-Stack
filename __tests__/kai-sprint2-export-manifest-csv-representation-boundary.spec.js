import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  serializeExportManifestRenderModelToCsv,
  serializeExportManifestToCsv,
  __exportManifestCsvSerializerTestables,
} from "../Backend/kai/services/kaiExportManifestCsvSerializer.js";
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
          ordinal: 1,
          text: "First block.",
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

function parseCsv(csv) {
  return csv.split("\r\n").filter((line) => line.length > 0).map((line) => line.split(","));
}

test("valid render-model DTO serializes to deterministic CSV with a stable header row", () => {
  const model = renderModel();
  const first = serializeExportManifestRenderModelToCsv(model);
  const second = serializeExportManifestRenderModelToCsv(model);

  assert.equal(first, second);
  assert.equal(first.endsWith("\r\n"), true);
  const rows = parseCsv(first);
  assert.deepEqual(rows[0], __exportManifestCsvSerializerTestables.CSV_HEADER);
  assert.equal(__exportManifestCsvSerializerTestables.CSV_CONTRACT_VERSION, "kai-sprint2-export-manifest-csv-v1");
});

test("one row is emitted per citation, in stable citation order, with matching limitation codes", () => {
  const model = renderModel();
  const rows = parseCsv(serializeExportManifestRenderModelToCsv(model));

  assert.equal(rows.length, 1 + model.citations.length);
  assert.deepEqual(rows[1], ["CIT-001", CLAIM_A, EVIDENCE_A, SOURCE_A, SOURCE_VERSION_A, "sample_size_small;self_reported"]);
  assert.deepEqual(rows[2], ["CIT-002", CLAIM_B, EVIDENCE_B, SOURCE_B, SOURCE_VERSION_B, ""]);
});

test("no citation is dropped or orphaned, and row order is deterministic across calls", () => {
  const model = renderModel();
  const first = serializeExportManifestRenderModelToCsv(model);
  const second = serializeExportManifestRenderModelToCsv(model);
  assert.equal(first, second);

  const refs = parseCsv(first).slice(1).map((row) => row[0]);
  assert.deepEqual(refs, model.citations.map((citation) => citation.citationRef));
});

test("CSV field values containing commas, quotes, or newlines are correctly escaped", () => {
  const model = renderModel({
    citations: [
      { citationRef: "CIT-001", claimId: "claim,with,commas", evidenceItemId: 'evidence"with"quotes', sourceId: "source\nwith\nnewline", sourceVersionId: SOURCE_VERSION_A },
    ],
    methodNotes: { limitationSnapshotId: SNAPSHOT, limitationEntries: [] },
  });
  const csv = serializeExportManifestRenderModelToCsv(model);
  assert.match(csv, /"claim,with,commas"/);
  assert.match(csv, /"evidence""with""quotes"/);
  assert.match(csv, /"source\nwith\nnewline"/);
});

test("user-visible fields keep manifest, candidate, authority, and fingerprint trace internal", () => {
  const csv = serializeExportManifestRenderModelToCsv(renderModel());
  for (const hidden of [MANIFEST, CANDIDATE, DRAFT, SNAPSHOT, DECISION, "a".repeat(64), "b".repeat(64)]) {
    assert.equal(csv.includes(hidden), false, hidden);
  }
});

test("private paths, storage material, credentials, prompts, and raw diagnostics are not introduced", () => {
  const csv = serializeExportManifestRenderModelToCsv(renderModel());
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
    assert.equal(csv.includes(forbidden), false, forbidden);
  }
});

test("pure serializer source has no database, storage, artifact, PDF, DOCX, route, or recomputation behavior", () => {
  const source = fs.readFileSync(new URL("../Backend/kai/services/kaiExportManifestCsvSerializer.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /withTransaction|\.query\(|SELECT |INSERT |UPDATE |DELETE |kai\.|DATABASE_URL|storage|Storage|writeFile|createWriteStream|artifact|pdf|docx|canonicalFingerprint|evaluateExportCandidateCurrentness|loadExportCandidateCanonicalRepresentation/i);
});

test("pure serializer accepts only the render-model DTO and no upstream identifiers or actor context", () => {
  assert.equal(serializeExportManifestRenderModelToCsv.length, 1);
  assert.equal(__exportManifestCsvSerializerTestables.validateRenderModel({
    exportManifestId: MANIFEST,
    organizationId: ORG,
    actorContext: {},
  }), false);
  assert.throws(() => serializeExportManifestRenderModelToCsv(null), /render-model DTO/);
});

test("thin wrapper reuses render-model service and returns CSV only after success", async () => {
  let calls = 0;
  const result = await serializeExportManifestToCsv(
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
  assert.match(result.data.csv, /^citation_ref,claim_id,evidence_item_id,source_id,source_version_id,limitation_codes\r\n/);
  assert.equal(result.data.csvContractVersion, "kai-sprint2-export-manifest-csv-v1");
});

test("thin wrapper propagates stale/current-state failures unchanged and does not serialize", async () => {
  let serializerInputTouched = false;
  const stale = {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409, reason: "fingerprint_mismatch" },
  };
  const result = await serializeExportManifestToCsv(
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
