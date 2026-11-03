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

// A3: a multi-source measurement's citation, as the export candidate's
// representation carries it (primary and reference contributing sources).
const CLAIM_X = "00000000-0000-4000-8000-000000000905";
const EVIDENCE_X = "00000000-0000-4000-8000-000000000906";
const SOURCE_VERSION_A_CORRECTED = "00000000-0000-4000-8000-000000000b03";

function crossSourceRenderModel(primaryVersionId, blockText = "Cross-source block.") {
  return __exportManifestRenderModelRepositoryTestables.composeRenderModel({
    manifest: { export_manifest_id: MANIFEST, organization_id: ORG, export_candidate_id: CANDIDATE, effective_authority_decision_id: DECISION,
      effective_authority_decision_type: "export_authority_granted", fingerprint_contract_version: "v", canonical_fingerprint: "a".repeat(64), created_at: "2026-09-06T10:20:00.000Z" },
    candidate: { exportCandidateId: CANDIDATE, generatedContentDraftId: DRAFT, contentType: "evidence_summary", requestedAudience: "internal",
      limitationSnapshotId: SNAPSHOT, fingerprintContractVersion: "v", canonicalFingerprint: "b".repeat(64) },
    representation: {
      organizationId: ORG, generatedContentDraftId: DRAFT, contentType: "evidence_summary", requestedAudience: "internal",
      blocks: [{
        ordinal: 1,
        text: blockText,
        citations: [
          { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, sourceId: SOURCE_A, sourceVersionId: SOURCE_VERSION_A },
          { claimId: CLAIM_X, evidenceItemId: EVIDENCE_X, sourceId: SOURCE_A, sourceVersionId: primaryVersionId, contributingSources: [
            { sourceRole: "primary", sourceId: SOURCE_A, sourceVersionId: primaryVersionId },
            { sourceRole: "reference", sourceId: SOURCE_B, sourceVersionId: SOURCE_VERSION_B },
          ] },
        ],
      }],
      limitations: [
        { claimId: CLAIM_A, evidenceItemId: EVIDENCE_A, limitationCodes: ["self_reported"] },
        { claimId: CLAIM_X, evidenceItemId: EVIDENCE_X, limitationCodes: ["linkage_exact_identifier_match"] },
      ],
    },
  });
}

test("a multi-source citation names every contributing source version in the existing columns, its own version first", () => {
  const model = crossSourceRenderModel(SOURCE_VERSION_A);
  const rows = parseCsv(serializeExportManifestRenderModelToCsv(model));

  assert.deepEqual(rows[0], __exportManifestCsvSerializerTestables.CSV_HEADER);
  assert.equal(rows.length, 1 + model.citations.length, "still one row per citation");
  for (const row of rows) assert.equal(row.length, 6);
  assert.deepEqual(rows[2], ["CIT-002", CLAIM_X, EVIDENCE_X, `${SOURCE_A};${SOURCE_B}`, `${SOURCE_VERSION_A};${SOURCE_VERSION_B}`, "linkage_exact_identifier_match"]);
  // Pairs align by position, and the first pair is the value the column carried before.
  const [sourceIds, versionIds] = [rows[2][3].split(";"), rows[2][4].split(";")];
  assert.deepEqual(sourceIds.map((id, i) => [id, versionIds[i]]), [[SOURCE_A, SOURCE_VERSION_A], [SOURCE_B, SOURCE_VERSION_B]]);
  assert.deepEqual(rows[1], ["CIT-001", CLAIM_A, EVIDENCE_A, SOURCE_A, SOURCE_VERSION_A, "self_reported"], "the single-source row is unchanged");
});

test("a corrected multi-source citation names the corrected version and the reference, never the version it replaced", () => {
  const csv = serializeExportManifestRenderModelToCsv(crossSourceRenderModel(SOURCE_VERSION_A_CORRECTED));
  const row = parseCsv(csv)[2];
  assert.deepEqual(row.slice(3, 5), [`${SOURCE_A};${SOURCE_B}`, `${SOURCE_VERSION_A_CORRECTED};${SOURCE_VERSION_B}`]);
  assert.equal(row[4].includes(SOURCE_VERSION_A), false);
});

test("cited source versions come only from structured citations, never from block text", () => {
  const prose = `Linked to ${SOURCE_VERSION_A_CORRECTED} and source ${SOURCE_B}.`;
  const csv = serializeExportManifestRenderModelToCsv(crossSourceRenderModel(SOURCE_VERSION_A, prose));
  assert.equal(csv.includes(SOURCE_VERSION_A_CORRECTED), false);
  assert.equal(csv, serializeExportManifestRenderModelToCsv(crossSourceRenderModel(SOURCE_VERSION_A)));
});

test("single-source CSV bytes are exactly the established v1 output", () => {
  assert.equal(serializeExportManifestRenderModelToCsv(renderModel()), [
    "citation_ref,claim_id,evidence_item_id,source_id,source_version_id,limitation_codes",
    `CIT-001,${CLAIM_A},${EVIDENCE_A},${SOURCE_A},${SOURCE_VERSION_A},sample_size_small;self_reported`,
    `CIT-002,${CLAIM_B},${EVIDENCE_B},${SOURCE_B},${SOURCE_VERSION_B},`,
    "",
  ].join("\r\n"));
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

function csvFor(claimId) {
  const model = renderModel({
    citations: [
      { citationRef: "CIT-001", claimId, evidenceItemId: EVIDENCE_A, sourceId: SOURCE_A, sourceVersionId: SOURCE_VERSION_A },
    ],
    methodNotes: { limitationSnapshotId: SNAPSHOT, limitationEntries: [] },
  });
  return serializeExportManifestRenderModelToCsv(model);
}

test("cells with a leading formula-injection-dangerous prefix are escaped with a leading apostrophe before CSV escaping", () => {
  const dangerous = [
    ["equals", "=SUM(A1:A2)"],
    ["plus", "+cmd"],
    ["minus", "-1+2"],
    ["at", "@SUM(A1:A2)"],
    ["tab", "\t=SUM(A1:A2)"],
    ["carriage return", "\r=SUM(A1:A2)"],
  ];

  for (const [label, value] of dangerous) {
    const csv = csvFor(value);
    assert.equal(csv.includes(`,${value},`), false, `${label}: raw dangerous value must not reach the cell unescaped`);
    assert.match(csv, new RegExp(`(,|")'${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(,|")`), label);
  }
});

test("formula-leading values with a comma, quote, or newline remain both formula-safe and valid CSV", () => {
  const withComma = csvFor("=SUM(A1),A2");
  assert.match(withComma, /"'=SUM\(A1\),A2"/);
  assert.equal(withComma.includes(",=SUM(A1),A2,"), false);

  const withQuote = csvFor('=cmd("x")');
  assert.match(withQuote, /"'=cmd\(""x""\)"/);

  const withNewline = csvFor("=cmd\nX");
  assert.match(withNewline, /"'=cmd\nX"/);
});

test("ordinary text cells are preserved unchanged and standard comma/quote/newline escaping is unaffected", () => {
  const csv = csvFor("claim,with,commas");
  assert.match(csv, /"claim,with,commas"/);

  const quotedCsv = csvFor('evidence"with"quotes');
  assert.match(quotedCsv, /"evidence""with""quotes"/);

  const newlineCsv = csvFor("source\nwith\nnewline");
  assert.match(newlineCsv, /"source\nwith\nnewline"/);

  const ordinaryCsv = csvFor(CLAIM_A);
  assert.match(ordinaryCsv, new RegExp(`,${CLAIM_A},`));
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
