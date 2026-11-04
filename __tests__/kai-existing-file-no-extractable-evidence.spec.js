import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createPostgresEvidenceLineageRepository } from "../Backend/kai/dictionary/postgresEvidenceLineageRepository.js";
import { getClientEvidencePipeline } from "../Backend/kai/services/kaiClientEvidencePipelineService.js";
import {
  PIPELINE_REASONS,
  nextActionText,
  pipelineReasonMessage,
  projectClientEvidencePipeline,
  stageStatusLabel,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";
import {
  NO_EVIDENCE_FROM_PROMOTION_MESSAGE,
  NO_EXTRACTABLE_EVIDENCE_MESSAGE,
  USE_FOR_IMPACT_MAX_STEPS,
  extractionResultMessage,
  isUseForImpactCandidate,
  sourcePreparationFiles,
  sourcePromotionResultMessage,
  useForImpactStep,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Existing-file incident (Cedar Bridge, 2026-11-03): a promoted PDF or TXT
 * source has no committed data-dictionary fields (the PDF worker profiles
 * pages and text blocks only), so P2-01, which composes one evidence item per
 * field, can never create evidence for it. Before this repair the pipeline
 * still reported the file as `evidence_extraction_ready` with the
 * administrator's `extract_evidence` action, "Use for impact" re-ran a no-op
 * extraction until its step limit and asked the person to try again, and the
 * P2-01 response (`replayed: true`, empty arrays, even on the first call) was
 * shown as "Evidence was already extracted ... (0 evidence item(s))".
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const fileId = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claimId = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN_ACCESS = Object.freeze({ reviewSensitivity: true, promoteSource: true, extractEvidence: true, continueSourcePreparation: true });

function boundAdminActor() {
  return {
    actorType: "human",
    actorUserId: "user-bound-admin",
    kaiUserStatus: "active",
    kaiRoles: [],
    platformSuperuser: false,
    organizationMemberships: [{
      organization_id: ORG,
      role_name: "client_admin",
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: 4242,
    }],
  };
}

function row(n, overrides = {}) {
  return {
    intake_file_id: fileId(n),
    safe_filename: `file-${n}`,
    upload_state: "confirmed",
    file_policy_status: "passed",
    created_at: new Date(`2026-11-03T0${n}:00:00Z`),
    parser_status: "completed",
    parser_error_code: null,
    file_profile_complete: true,
    data_dictionary_complete: true,
    sensitivity_profile_complete: true,
    sensitivity_decision_outcome: null,
    source_candidate_count: 0,
    source_candidate_needs_review_count: 0,
    source_candidate_promoted_count: 0,
    source_candidate_rejected_count: 0,
    source_version_count: 0,
    evidence_item_count: 0,
    evidence_needs_review_count: 0,
    evidence_reviewed_count: 0,
    claim_count: 0,
    claim_needs_review_count: 0,
    claim_ids: [],
    open_client_followup_count: 0,
    sensitivity_permission_predicate: true,
    source_candidate_actionable_count: 0,
    ...overrides,
  };
}

const promoted = { sensitivity_decision_outcome: "reviewed", source_candidate_count: 1, source_candidate_promoted_count: 1, source_version_count: 1 };

async function readPipeline(rows, facts = []) {
  const result = await getClientEvidencePipeline(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: boundAdminActor() },
    {
      env: ENV,
      getClientEvidencePipelineEngagement: async () => ({ engagement_id: ENGAGEMENT, organization_id: ORG }),
      listClientEvidencePipelineFiles: async () => rows,
      listClientImpactFacts: async () => ({ ok: true, data: { items: facts, truncated: false } }),
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  // Through the HTTP JSON envelope into the client projection.
  const data = projectClientEvidencePipeline(JSON.parse(JSON.stringify(result.data)), ENGAGEMENT);
  assert.ok(data, "the client projection admits every server reason");
  return data;
}

const fileOf = (data, n) => data.files.find((entry) => entry.intakeFileId === fileId(n));

// The "Use for impact" control flow of ClientEvidenceWorkflow.runUseForImpact
// (the repository's tests do not render JSX), with P2-01 a no-op as it is for
// a source with no dictionary fields: the re-read returns the same file.
function runUseForImpact(startFile, reread) {
  let file = startFile;
  let extractions = 0;
  for (let step = 0; step < USE_FOR_IMPACT_MAX_STEPS; step += 1) {
    const next = useForImpactStep(file, ADMIN_ACCESS);
    if (next.kind !== "extract" && next.kind !== "continue") return { outcome: next.kind, text: next.text, extractions };
    extractions += 1;
    file = reread(file);
  }
  return { outcome: "interrupted", extractions };
}

// 2026-11-04: a PDF or plain-text document is no longer "no extractable
// evidence" (see kai-document-statement-evidence.spec.js); this state now
// belongs to a promoted non-document source with no dictionary field.
test("a promoted source with no dictionary fields is not offered extraction: truthful terminal state, no Use for impact loop", async () => {
  const pdf = row(1, { ...promoted, safe_filename: "empty_export.csv", current_profile_format: "csv", current_dictionary_field_count: 0 });
  const tabular = row(2, { ...promoted, current_dictionary_field_count: 10 });
  const data = await readPipeline([pdf, tabular]);

  const pdfFile = fileOf(data, 1);
  assert.deepEqual(
    [pdfFile.currentStage, pdfFile.currentStatus, pdfFile.responsibleParty, pdfFile.nextAction, pdfFile.reason],
    ["evidence_extraction", "closed", "none", "none", "no_extractable_evidence"],
  );
  const stage = pdfFile.stages.find((entry) => entry.key === "evidence_extraction");
  assert.equal(stageStatusLabel(stage), "Not available for this file");
  assert.match(nextActionText(pdfFile), /^No action required from you\. This file's source is promoted, but KAI cannot create evidence from it: it is not a PDF or plain-text document and it has no data fields/);
  assert.match(pipelineReasonMessage("no_extractable_evidence", 1), /has been promoted, but KAI cannot create evidence from it: it is not a PDF or plain-text document/);
  assert.ok(PIPELINE_REASONS.includes("no_extractable_evidence"));
  assert.deepEqual(data.reasons.find((r) => r.reason === "no_extractable_evidence")?.fileCount, 1);

  // Not an actionable Use for impact / source-preparation file any more.
  assert.equal(isUseForImpactCandidate(pdfFile, ADMIN_ACCESS), false);
  assert.deepEqual(sourcePreparationFiles(data, ADMIN_ACCESS).map((f) => f.intakeFileId), [fileId(2)]);
  const flow = runUseForImpact(pdfFile, (file) => file);
  assert.equal(flow.outcome, "blocked");
  assert.equal(flow.extractions, 0);
  assert.match(flow.text, /KAI cannot create evidence from it/);

  // A source with fields keeps the administrator's extraction step unchanged.
  const tabularFile = fileOf(data, 2);
  assert.deepEqual([tabularFile.currentStatus, tabularFile.nextAction, tabularFile.reason], ["waiting_for_client", "extract_evidence", "evidence_extraction_ready"]);
  assert.equal(isUseForImpactCandidate(tabularFile, ADMIN_ACCESS), true);
});

test("reproduction: without the field count (the pre-repair read) the same PDF stays extraction-ready and Use for impact loops to its step limit", async () => {
  const legacy = await readPipeline([row(1, { ...promoted })]);
  const file = fileOf(legacy, 1);
  assert.deepEqual([file.nextAction, file.reason], ["extract_evidence", "evidence_extraction_ready"]);
  const flow = runUseForImpact(file, (same) => same);
  assert.deepEqual([flow.outcome, flow.extractions], ["interrupted", USE_FOR_IMPACT_MAX_STEPS]);
});

test("existing evidence and closed allowed use take precedence over the field count", async () => {
  const data = await readPipeline([
    row(1, { ...promoted, current_dictionary_field_count: 0, evidence_item_count: 1, evidence_needs_review_count: 1 }),
    row(2, { ...promoted, current_dictionary_field_count: 0, effective_allowed_use_not_allowed: true }),
  ]);
  assert.deepEqual([fileOf(data, 1).currentStage, fileOf(data, 1).reason], ["evidence_review", "evidence_awaiting_review"]);
  assert.deepEqual([fileOf(data, 2).currentStage, fileOf(data, 2).reason], ["evidence_extraction", "allowed_use_not_allowed"]);
});

test("the reported five-file summary (1 failed, 3 extraction-ready, 1 complete) is reproduced by the synthetic Cedar Bridge states, and now reads truthfully", async () => {
  // States established locally with the real profiler/assessor on the
  // synthetic files: the original FY2025-26 PDF is blocked by the PDF policy
  // (pdf_active_or_embedded_content); the verified PDF, the programme-review
  // PDF and the operations-notes TXT profile with 0 dictionary fields; the
  // workbook carries a reviewed Impact Fact. Which production file holds which
  // state is NOT established here.
  // 2026-11-04: the three zero-field documents carry their profiled format;
  // their state now follows the document-statement capability.
  const document = (withCount, format, supported) => (withCount
    ? { current_dictionary_field_count: 0, current_profile_format: format, document_evidence_supported: supported }
    : {});
  const states = (withCount, supported = false) => [
    row(1, { ...promoted, ...document(withCount, "pdf", supported) }),
    row(2, { file_policy_status: "blocked" }),
    row(3, { ...promoted, evidence_item_count: 11, evidence_reviewed_count: 11, claim_count: 11, claim_ids: [claimId(3)], ...(withCount ? { current_dictionary_field_count: 10, current_profile_format: "xlsx", document_evidence_supported: supported } : {}) }),
    row(4, { ...promoted, ...document(withCount, "pdf", supported) }),
    row(5, { ...promoted, ...document(withCount, "txt", supported) }),
  ];
  const facts = [{ claimId: claimId(3), statement: "Reviewed fact", claimType: "outcome", limitationDimensionKeys: ["small_cell_risk"] }];
  const summary = (data) => Object.fromEntries(data.reasons.map((r) => [r.reason, r.fileCount]));

  assert.deepEqual(summary(await readPipeline(states(false), facts)), { failed: 1, evidence_extraction_ready: 3, complete: 1 });
  const repaired = await readPipeline(states(true), facts);
  assert.deepEqual(summary(repaired), { failed: 1, document_evidence_not_enabled: 3, complete: 1 });
  // With the document-evidence schema installed the same documents are the
  // administrator's extraction step again, now one that can write.
  assert.deepEqual(summary(await readPipeline(states(true, true), facts)), { failed: 1, evidence_extraction_ready: 3, complete: 1 });
  const blocked = fileOf(repaired, 2);
  assert.deepEqual([blocked.currentStage, blocked.failureCategory, blocked.nextAction], ["security_check", "file_blocked_by_policy", "upload_new_file"]);
});

// ---------------------------------------------------------------------------
// The real P2-01 repository for a source version with no dictionary fields
// ---------------------------------------------------------------------------

const SOURCE_VERSION = "70000000-0000-4000-8000-000000000001";
const SOURCE = "71000000-0000-4000-8000-000000000001";
const CANDIDATE = "90000000-0000-4000-8000-000000000001";
const SENSITIVITY = "80000000-0000-4000-8000-000000000001";
const FILE_PROFILE = "50000000-0000-4000-8000-000000000001";
const DATA_DICTIONARY = "60000000-0000-4000-8000-000000000001";
const INTAKE_FILE = "20000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const NOW = "2026-11-03T10:00:00.000Z";

function zeroFieldQuery(sql) {
  if (/^INSERT\b|^UPDATE\b|^DELETE\b/.test(sql)) throw new Error(`unexpected write: ${sql.split("\n")[0]}`);
  if (sql.includes("FROM kai.source_versions")) {
    return { rows: [{ source_version_id: SOURCE_VERSION, organization_id: ORG, source_id: SOURCE, intake_source_candidate_id: CANDIDATE, intake_sensitivity_profile_id: SENSITIVITY, profile_canonical_sha256: SHA, is_current: true, created_at: NOW }] };
  }
  if (sql.includes("FROM kai.sources")) return { rows: [{ source_id: SOURCE, organization_id: ORG, source_code: "code", reviewed_source_type: "survey", created_at: NOW }] };
  if (sql.includes("FROM kai.intake_source_candidates")) {
    return { rows: [{ intake_source_candidate_id: CANDIDATE, organization_id: ORG, intake_file_id: INTAKE_FILE, file_profile_id: FILE_PROFILE, data_dictionary_id: DATA_DICTIONARY, intake_sensitivity_profile_id: SENSITIVITY, profile_canonical_sha256: SHA, candidate_status: "promoted", created_at: NOW }] };
  }
  if (sql.includes("FROM kai.intake_promotion_decisions")) {
    return { rows: [{ organization_id: ORG, source_id: SOURCE, source_version_id: SOURCE_VERSION, decision_status: "promoted", created_at: NOW }] };
  }
  if (sql.includes("FROM kai.intake_sensitivity_review_decisions")) return { rows: [] };
  if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
    return { rows: [{ organization_id: ORG, intake_sensitivity_profile_id: SENSITIVITY, file_profile_id: FILE_PROFILE, data_dictionary_id: DATA_DICTIONARY, profile_canonical_sha256: SHA, human_review_required: true, public_use_allowed: false, funder_use_allowed: false, llm_processing_allowed: false, product_learning_allowed: false, retention_posture: "restricted_pending_review" }] };
  }
  if (sql.includes("FROM kai.data_dictionaries")) return { rows: [{ data_dictionary_id: DATA_DICTIONARY, organization_id: ORG, file_profile_id: FILE_PROFILE, profile_canonical_sha256: SHA, created_at: NOW }] };
  if (sql.includes("FROM kai.data_dictionary_fields")) return { rows: [] };
  if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 0 }] };
  throw new Error(`unexpected query: ${sql.split("\n")[0]}`);
}

test("real P2-01 on a zero-field source version: the FIRST call writes nothing and reports replayed with empty arrays; the client says why, not 'already extracted'", async () => {
  const statements = [];
  const repository = createPostgresEvidenceLineageRepository({
    runInTransaction: async (callback) => callback({
      async query(sql) {
        const trimmed = sql.trim();
        statements.push(trimmed);
        return zeroFieldQuery(trimmed);
      },
    }),
  });
  const result = await repository.extractEvidenceFromSourceVersion({
    organizationId: ORG,
    sourceVersionId: SOURCE_VERSION,
    actorUserId: "user-bound-admin",
    now: NOW,
    metadataOnlyAudit: { prepareMetadataOnlyAudit: () => { throw new Error("no audit expected for zero writes"); } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    [result.data.replayed, result.data.evidenceItems, result.data.sourceLocators, result.data.reviewQueueItems],
    [true, [], [], []],
  );
  assert.equal(statements.some((sql) => /^INSERT\b/.test(sql)), false);

  const message = extractionResultMessage(JSON.parse(JSON.stringify(result.data)));
  assert.equal(message, NO_EXTRACTABLE_EVIDENCE_MESSAGE);
  assert.doesNotMatch(message, /already extracted/);
  // Existing evidence still reads as before.
  assert.match(extractionResultMessage({ replayed: true, evidenceItems: [{}, {}] }), /^Evidence was already extracted from this source version \(2 evidence item\(s\)\)/);
  assert.match(extractionResultMessage({ replayed: false, evidenceItems: [{}] }), /^Evidence extracted: 1 evidence item\(s\) created/);
});

test("promotion handoff with zero evidence items no longer says evidence is awaiting Get Kinder review", () => {
  for (const status of ["created", "replayed"]) {
    const text = sourcePromotionResultMessage({
      promotion_decision: { decision_status: "promoted" },
      evidence_extraction_handoff: { status, evidence_item_count: 0 },
      replayed: false,
    });
    assert.equal(text, `Source promoted. ${NO_EVIDENCE_FROM_PROMOTION_MESSAGE}`, status);
    assert.doesNotMatch(text, /awaiting Get Kinder evidence review|already/);
  }
  assert.match(sourcePromotionResultMessage({
    promotion_decision: { decision_status: "promoted" },
    evidence_extraction_handoff: { status: "created", evidence_item_count: 2 },
    replayed: false,
  }), /created 2 evidence item\(s\), awaiting Get Kinder evidence review/);
});

test("the read model selects the current source version's dictionary field count, scoped like every other lineage join", () => {
  const sql = readFileSync(new URL("../Backend/kai/db/kaiClientEvidencePipelineReadModel.js", import.meta.url), "utf8");
  assert.match(sql, /dfc\.current_dictionary_field_count,/);
  assert.match(sql, /count\(df\.data_dictionary_field_id\)::int AS current_dictionary_field_count/);
  assert.match(sql, /df\.organization_id = ic\.organization_id\s+AND df\.data_dictionary_id = ic\.data_dictionary_id/);
  assert.match(sql, /HAVING count\(v\.source_version_id\) > 0\s+\) dfc ON true/);
});
