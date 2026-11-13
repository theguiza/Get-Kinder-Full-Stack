import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as DOC from "../Backend/kai/validators/kaiDocumentEvidenceValidators.js";
import { runPdfTextWorkerBoundary } from "../Backend/kai/validators/pdfAssessorWorkerBoundary.js";
import { composeEvidenceSummaryMeasurementDisclosures, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { serializeInternalReportToMarkdown } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";

/**
 * Owner Package 4 (2026-11-10): a source document's preliminary estimate,
 * methodological instruction, limitation or interpretation must keep that
 * meaning through claims and drafting, and never become a KAI-calculated or
 * independently established impact fact.
 *
 * Pure checks on the ORIGINAL synthetic Project B documents (skipped when the
 * package is not on this machine): the real extractor, the real claim
 * composition the claim-proposal route uses, the real generation validators
 * and the real internal report serializer. The connected proof (persisted
 * evidence, claims, admission, model input, saved draft, browser) is
 * kai-community-project-b-document-evidence-acceptance.integration.spec.js.
 *
 * Every helper added by Package 4 is read through the module namespace with
 * a fallback, so this spec also runs, unchanged, on the revision before the
 * repair and records what that revision did.
 */

const PACKAGE = process.env.KAI_COMMUNITY_PROJECT_B_PACKAGE || join(homedir(), "Downloads", "KAI_Synthetic_Community_Impact_Project_B");
const UPLOAD = join(PACKAGE, "01_UPLOAD_TO_KAI");
const HAVE_PACKAGE = existsSync(join(UPLOAD, "05_Programme_Coordination_Notes.txt")) && existsSync(join(UPLOAD, "06_Community_Review.pdf"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Package 4 helpers (absent before the repair).
const generationCodes = (claimStatement) => (typeof DOC.documentGenerationLimitationCodes === "function"
  ? DOC.documentGenerationLimitationCodes(claimStatement)
  : []);

// The three owner-named statements, chosen by text the reader can find in the
// original files (the locators below are what the extractor records for them).
const CASES = Object.freeze({
  A: { file: "notes", anchor: "both patterns are legitimate", locator: { unit: "text_lines", line_start: 7, line_end: 7, sentence_start: 3, sentence_end: 5 } },
  B: { file: "review", anchor: "must be deduplicated for the organization-wide reach figure", locator: { unit: "pdf_page_blocks", page_number: 1, block_start: 10, block_end: 10, sentence_start: 4, sentence_end: 4 } },
  C: { file: "review", anchor: "at least 90 different people", locator: { unit: "pdf_page_blocks", page_number: 2, block_start: 3, block_end: 5, sentence_start: 1, sentence_end: 2 } },
});

async function extractedCases() {
  const notesBytes = readFileSync(join(UPLOAD, "05_Programme_Coordination_Notes.txt"));
  const reviewBytes = readFileSync(join(UPLOAD, "06_Community_Review.pdf"));
  const pdf = await runPdfTextWorkerBoundary({ bytes: reviewBytes, byteSize: reviewBytes.byteLength, extension: ".pdf", declaredMime: "application/pdf" });
  assert.equal(pdf.status, "extracted");
  const documents = {
    notes: DOC.identifyDocumentStatementCandidates({ format: "txt", lines: notesBytes.toString("utf8").split(/\r?\n/) }),
    review: DOC.identifyDocumentStatementCandidates({ format: "pdf", pages: pdf.pages }),
  };
  const out = {};
  for (const [key, spec] of Object.entries(CASES)) {
    const candidate = documents[spec.file].candidates.find((c) => c.excerpt.includes(spec.anchor));
    assert.ok(candidate, `case ${key}: the statement is a candidate`);
    const claimStatement = DOC.composeDocumentClaimStatement({ excerpt: candidate.excerpt, coordinates: candidate.coordinates });
    out[key] = { ...candidate, claimStatement };
  }
  return { out, documents, notesBytes, reviewBytes };
}

const ids = Object.freeze({
  A: ["c0000000-0000-4000-8000-00000000000a", "e0000000-0000-4000-8000-00000000000a"],
  B: ["c0000000-0000-4000-8000-00000000000b", "e0000000-0000-4000-8000-00000000000b"],
  C: ["c0000000-0000-4000-8000-00000000000c", "e0000000-0000-4000-8000-00000000000c"],
  people: ["c0000000-0000-4000-8000-000000000067", "e0000000-0000-4000-8000-000000000067"],
});
// The persisted Project B people claim (Package 2/3), as the claim-proposal route composes it.
const PEOPLE_STATEMENT = "People served: 67 distinct register participants served, each counted once, among 190 eligible encounters: field_1 events, field_6 = completed, "
  + "field_4 in reporting period 2024-04-01 to 2025-03-31 by day, field_2 in register 5a000000-0000-4000-8000-000000000002 field_1; 11 in several field_3 counted once; "
  + "2 duplicate copies counted once; excluded 5 outside period, 2 unmatched, 0 conflicting.";
const PEOPLE_CODES = ["derived.cross_source_linked", "derived.duplicate_event_copies_counted_once", "derived.each_identifier_counted_once", "derived.engagement_period_applied",
  "derived.meaning_human_stated", "derived.organization_records", "derived.people_counted_once_across_groups", "derived.unmatched_identifiers_excluded", "derived.values_not_verified"];

function generationClaim(key, statement, codes) {
  const [claimId, evidenceItemId] = ids[key];
  return { claimId, evidenceItemId, claimStatement: statement, limitationCodes: codes, revalidatedForGeneration: true, requestedAudience: "internal", audienceAuthority: { internal: true } };
}
const block = (ordinal, text, keys) => ({ ordinal, text, citations: keys.map((key) => ({ claimId: ids[key][0], evidenceItemId: ids[key][1] })) });
// As the generation route does: the server appends each cited measured
// claim's composed disclosure, then every validator runs on the result.
function verdict(claims, modelBlocks) {
  const composed = composeEvidenceSummaryMeasurementDisclosures({ blocks: modelBlocks, claims });
  assert.equal(composed.ok, true);
  const blocks = composed.blocks;
  const result = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: claims, blocks, contentType: "evidence_summary" });
  const v4 = result.results.find((r) => r.validator_key === "VAL-GEN-004");
  return { ok: result.ok, keys: result.blockers.map((b) => b.validator_key), classes: v4?.evidence?.assertion_classes ?? [] };
}

test("document guidance: an exact source statement with nested quotation marks remains usable in composed findings", () => {
  const excerpt = 'Records marked "confirmed" should be reconciled before the annual review is completed.';
  const statement = DOC.composeDocumentClaimStatement({ excerpt,
    coordinates: { unit: "text_lines", line_start: 11, line_end: 11, sentence_start: 5, sentence_end: 5 } });
  const claim = generationClaim("B", statement, generationCodes(statement));
  assert.ok(claim.limitationCodes.includes("document.method_or_instruction"));
  const composed = `[[assessment:evidence_findings]]\n${statement}`;
  assert.deepEqual(verdict([claim], [block(7, composed, ["B"])]), { ok: true, keys: [], classes: [] });
  // Recognizing the quoted source must not hide a new assertion beside it,
  // nor authorize a rewritten quotation that says the work was completed.
  for (const own of ["KAI confirmed and reconciled the records.", "The records were reconciled before the annual review."]) {
    const result = verdict([claim], [block(7, `${composed} ${own}`, ["B"])]);
    assert.equal(result.ok, false, own);
    assert.ok(result.classes.includes("document_guidance_presented_as_completed"), own);
  }
});

test("Package 4 document meaning: the original documents match the package manifest", { skip: !HAVE_PACKAGE && "Project B package not present" }, () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Community_File_Checksums.json"), "utf8"));
  for (const name of ["05_Programme_Coordination_Notes.txt", "06_Community_Review.pdf"]) {
    const bytes = readFileSync(join(UPLOAD, name));
    const entry = manifest.find((candidate) => candidate.relative_path === `01_UPLOAD_TO_KAI/${name}`);
    assert.deepEqual([sha256(bytes), bytes.byteLength], [entry.sha256, entry.bytes], name);
  }
});

test("Package 4 document meaning: the three original statements, their locators, roles and claims", { skip: !HAVE_PACKAGE && "Project B package not present" }, async () => {
  const { out, documents } = await extractedCases();
  assert.deepEqual([documents.notes.candidates.length, documents.review.candidates.length], [17, 30], "the historical observation still holds for this extractor method");
  for (const [key, spec] of Object.entries(CASES)) {
    const { coordinates } = out[key];
    assert.deepEqual(Object.fromEntries(Object.keys(spec.locator).map((k) => [k, coordinates[k]])), spec.locator, `case ${key} locator`);
    // The claim restates the exact excerpt as source-reported.
    assert.ok(out[key].claimStatement.startsWith("Source-reported, not independently verified ("), key);
    assert.ok(out[key].claimStatement.includes(out[key].excerpt), key);
  }
  // Every meaning is recomputed from the persisted words alone (no new column).
  const codes = Object.fromEntries(Object.entries(out).map(([key, c]) => [key, generationCodes(c.claimStatement)]));
  assert.ok(codes.A.includes("document.source_reported_not_verified"));
  assert.ok(!codes.A.includes("document.source_estimate") && !codes.A.includes("document.method_or_instruction"), `A is programme context: ${codes.A}`);
  assert.ok(codes.B.includes("document.method_or_instruction"), `B is a method instruction: ${codes.B}`);
  assert.ok(!codes.B.includes("document.source_estimate"));
  assert.ok(codes.C.includes("document.source_estimate"), `C is a source estimate: ${codes.C}`);
  assert.ok(codes.C.includes("document.contains_uncertainty"));
  assert.equal(DOC.documentStatementRole?.(out.A.excerpt), "source_limitation");
  assert.equal(DOC.documentStatementRole?.(out.B.excerpt), "source_method_or_instruction");
  assert.equal(DOC.documentStatementRole?.(out.C.excerpt), "source_estimate");
  // The FY label and the locator never make a statement an estimate.
  assert.equal(DOC.documentStatementRole?.("Source note: internal management draft; all counts and denominators require reconciliation from the separate FY 2024-25 source records."), "source_method_or_instruction");
});

test("Package 4 document meaning: a preliminary 90-person estimate cannot become KAI's established result; a qualified attribution can", { skip: !HAVE_PACKAGE && "Project B package not present" }, async () => {
  const { out } = await extractedCases();
  const claims = [generationClaim("C", out.C.claimStatement, generationCodes(out.C.claimStatement)), generationClaim("people", PEOPLE_STATEMENT, PEOPLE_CODES)];
  const permitted = verdict(claims, [
    block(1, "The management review reports a preliminary estimate that at least 90 different people received a direct CC or RA service in FY 2024-25; "
      + "the review says it came from a rough tally, not a distinct-person calculation, and it remains unverified.", ["C"]),
  ]);
  assert.deepEqual(permitted, { ok: true, keys: [], classes: [] }, "qualified, attributed estimate");
  // The stub's restatement of the claim itself is also permitted.
  assert.equal(verdict(claims, [block(1, out.C.claimStatement, ["C"])]).ok, true);
  const prohibited = {
    kai_established: "KAI established that at least 90 distinct people were served in FY 2024-25.",
    unattributed: "At least 90 different people received a direct CC or RA service.",
    qualifier_dropped: "The management review reports that 90 different people received a direct CC or RA service.",
    as_verified_result: "The review's figure of at least 90 people is the independently verified distinct-person result.",
    replaces_measurement: "The organization reached at least 90 distinct people, as the review's preliminary estimate shows.",
  };
  const observed = {};
  for (const [label, text] of Object.entries(prohibited)) {
    observed[label] = verdict(claims, [block(1, text, ["C"])]);
    assert.equal(observed[label].ok, false, `${label} must be refused`);
    assert.ok(observed[label].keys.includes("VAL-GEN-004"), label);
  }
  // The numeral 90 is not prohibited as such: the measured 67 sentence beside it is fine.
  assert.equal(verdict(claims, [block(1, "KAI's linked-reach measurement counted 67 distinct register participants, each counted once. "
    + "Separately, the management review reports a preliminary estimate of at least 90 different people from a rough tally; the two figures are not established as comparable.", ["people", "C"])]).ok, true);
});

test("Package 4 document meaning: source guidance to deduplicate cannot be written up as a completed calculation", { skip: !HAVE_PACKAGE && "Project B package not present" }, async () => {
  const { out } = await extractedCases();
  const claims = [generationClaim("B", out.B.claimStatement, generationCodes(out.B.claimStatement)), generationClaim("people", PEOPLE_STATEMENT, PEOPLE_CODES)];
  assert.equal(verdict(claims, [block(1, "The management review states that a participant who appears in both activity counts must be deduplicated for an organisation-wide reach figure.", ["B"])]).ok, true,
    "guidance reported as guidance");
  assert.equal(verdict(claims, [block(1, out.B.claimStatement, ["B"])]).ok, true);
  for (const text of [
    "Participants appearing in both CC and RA were deduplicated for the organization-wide reach figure.",
    "KAI deduplicated participants for the organization-wide reach figure, as the review requires.",
    "Participants were deduplicated and reconciled as the review requires.",
  ]) {
    const result = verdict(claims, [block(1, text, ["B"])]);
    assert.equal(result.ok, false, text);
  }
  // KAI's own calculation, cited, may say it counted each person once.
  assert.equal(verdict(claims, [block(1, "KAI calculated 67 distinct register participants, each counted once across programmes, as the review's method asks.", ["people", "B"])]).ok, true);
});

test("Package 4 document meaning: Case A programme context stays usable as qualified context", { skip: !HAVE_PACKAGE && "Project B package not present" }, async () => {
  const { out } = await extractedCases();
  const claims = [generationClaim("A", out.A.claimStatement, generationCodes(out.A.claimStatement))];
  assert.equal(verdict(claims, [block(1, "The programme notes state that some participants used both CC and RA and several attended more than once, and that both patterns are legitimate.", ["A"])]).ok, true);
  assert.equal(verdict(claims, [block(1, "KAI verified that overlapping CC and RA attendance was legitimate.", ["A"])]).ok, false, "KAI did not verify the notes");
});

test("Package 4 document meaning: the internal report keeps each statement's role", { skip: !HAVE_PACKAGE && "Project B package not present" }, async () => {
  const { out } = await extractedCases();
  const fact = (key, ref) => ({ claimId: ids[key][0], evidenceItemId: ids[key][1], claimStatement: out[key].claimStatement, evidenceType: "source_document_statement",
    citationRefs: [ref], limitationCodes: generationCodes(out[key].claimStatement), currentlyEligible: false, blockerCodes: ["claim_review_unresolved"],
    sourceId: "50000000-0000-4000-8000-000000000001", sourceCode: "doc", sourceVersionId: "5b000000-0000-4000-8000-000000000001", sourceVersionCurrent: true,
    sourceVersionCreatedAt: "2026-11-10T00:00:00.000Z", profileCanonicalSha256: "c".repeat(64), evidenceStatement: null, evidenceReviewOutcome: null, claimReviewOutcome: null,
    measurement: null, derivedMeasurement: null, linkedSources: [] });
  const model = {
    modelContractVersion: "kai-sprint2-internal-report-model-v1", available: true, getKinderReviewReasons: [], blockedReasons: [],
    report: { generatedContentDraftId: "d0000000-0000-4000-8000-000000000001", generationRunId: "a0000000-0000-4000-8000-000000000001", contentType: "evidence_summary",
      audience: "internal", createdAt: "2026-11-10T00:00:00.000Z", validatorKeys: ["VAL-GEN-004"] },
    context: { organizationId: "0c000000-0000-4000-8000-000000000001", organizationName: "Project B (synthetic)", engagementId: "7c000000-0000-4000-8000-000000000001", engagementCode: "Project B", engagementType: "pilot_assessment" },
    blocks: [{ ordinal: 1, text: "x", citationRefs: ["CIT-001", "CIT-002", "CIT-003"] }],
    citations: ["A", "B", "C"].map((key, index) => ({ citationRef: `CIT-00${index + 1}`, claimId: ids[key][0], evidenceItemId: ids[key][1], sourceId: "50000000-0000-4000-8000-000000000001", sourceCode: "doc", sourceVersionId: "5b000000-0000-4000-8000-000000000001" })),
    facts: [fact("A", "CIT-001"), fact("B", "CIT-002"), fact("C", "CIT-003")],
  };
  let markdown;
  try { markdown = serializeInternalReportToMarkdown(model); } catch (error) { markdown = `render failed: ${error.message}`; }
  assert.match(markdown, /Source-reported preliminary estimate[^\n]*CIT-003|CIT-003[^\n]*Source-reported preliminary estimate/, "C is an estimate, not an observation");
  assert.match(markdown, /CIT-002[^\n]*Source-reported method or guidance/, "B is guidance");
  assert.doesNotMatch(markdown, /CIT-002\)? \*\*Source-reported observation/);
  assert.doesNotMatch(markdown, /CIT-003\)? \*\*Source-reported observation/);
  assert.match(markdown, /does not show that the step was carried out/);
  assert.match(markdown, /not calculated or verified by KAI|KAI did not calculate or verify it/);
});
