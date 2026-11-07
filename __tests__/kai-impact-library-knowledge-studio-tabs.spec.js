import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package D (superseded 2026-11-06 by the four-view
 * MVP: Impact, Evidence, Sources, Drafts): Knowledge Studio's tabs plus Gap Detail, built by
 * incrementally gating ImpactEvidenceLibrary.jsx's existing, already-tested
 * render sections behind a knowledgeStudioTab toggle - no section's own
 * state, effects, fetch logic, or API contract was touched. Source-contract
 * style, matching this repo's established pattern for this file.
 */

const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const gapDetailSource = readFileSync("frontend/knowledgeStudio/KnowledgeStudioGapDetail.jsx", "utf8");

// Four-view MVP refactor (owner direction 2026-11-06): Impact | Evidence |
// Sources | Drafts replace the five Package D tabs and the always-visible
// stacked sections. Each assertion below replaces the Package D assertion
// for the same section with its accepted four-view placement.
const viewsLogicSource = readFileSync("frontend/knowledgeStudio/knowledgeStudioViewsLogic.js", "utf8");

test("1: exactly four views, Impact by default, driven by one piece of state", () => {
  assert.match(viewsLogicSource, /export const KNOWLEDGE_STUDIO_VIEWS = Object\.freeze\(\[\s*\["impact", "Impact"\],\s*\["evidence", "Evidence"\],\s*\["sources", "Sources"\],\s*\["drafts", "Drafts"\],\s*\]\);/);
  assert.match(viewsLogicSource, /export const DEFAULT_KNOWLEDGE_STUDIO_VIEW = "impact";/);
  assert.match(libSource, /const \[knowledgeStudioTab, setKnowledgeStudioTab\] = useState\(DEFAULT_KNOWLEDGE_STUDIO_VIEW\);/);
  assert.match(libSource, /<KnowledgeStudioNav view=\{knowledgeStudioTab\} onSelect=\{setKnowledgeStudioTab\} idPrefix="ks-gk" singlePanelId="ks-gk-panel" \/>/);
  for (const old of ["files", "processing", "gaps", "reviews"]) {
    assert.doesNotMatch(libSource, new RegExp(`knowledgeStudioTab === "${old}"`), `no ${old} tab remains`);
  }
});

test("2: Sources holds Web Intake and the Data Sources read, without a duplicate Engagement selector", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "sources" && organizationId \? \(\s*<KaiWebIntake/);
  assert.match(libSource, /\{knowledgeStudioTab === "sources" \? \(\s*<div className="admin-card mt-3">\s*<h5 className="mb-2">Data Sources<\/h5>/);
  // KaiWebIntake still receives the shared engagement context (Package C0), not a second selector.
  assert.match(libSource, /<KaiWebIntake\s*\n\s*organizationId=\{organizationId\}\s*\n\s*engagementId=\{engagementId\}\s*\n\s*onEngagementIdChange=\{updateEngagementId\}/);
  // The Project scope is passed to the existing Sources read.
  assert.match(libSource, /getJson\(organizationSourcesPath\(organizationId, engagementId \|\| null\)\)/);
});

test("3: Sources gates the existing real sensitivity/allowed-use review states (no new fabricated progress state introduced)", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "sources" && sensitivityCapability === true \? \(/);
  assert.match(libSource, /\{knowledgeStudioTab === "sources" && intakeSensitivityProfileId && sensitivityCapability === true \? \(/);
});

test("4 (E1 correction): Evidence is enumerated from the evidence-native read model so unclaimed evidence is included; Claims is part of the Evidence view", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "evidence" \? \(\s*<div className="admin-card">\s*<div className="d-flex justify-content-between align-items-center mb-2">\s*<h5 className="mb-0">Evidence<\/h5>/);
  assert.match(libSource, /evidenceLibraryCandidatesPath,\s*\n\s*projectEvidenceLibraryItems,/);
  assert.match(libSource, /\{item\.statement \? <FindingText statement=\{item\.statement\} \/> : <div className="fw-semibold">Evidence statement not yet available<\/div>\}/);
  assert.match(libSource, /item\.supportStrength/);
  assert.match(libSource, /item\.evidenceReviewStatus/);
  assert.match(libSource, /No claim proposed yet/);
  // Grouped by recorded type; structural facts stay available on request.
  assert.match(libSource, /\{gkEvidenceSections\.map\(\(\{ category, items: categoryItems \}\) => \(/);
  assert.match(libSource, /\.filter\(\(category\) => category !== "technical" \|\| showGkTechnicalEvidence\)/);
  const claimsHeadingIndex = libSource.indexOf('<h5 className="mb-0">Claims</h5>');
  assert.ok(claimsHeadingIndex > -1, "Claims section must still exist");
  const precedingSlice = libSource.slice(Math.max(0, claimsHeadingIndex - 250), claimsHeadingIndex);
  assert.match(precedingSlice, /\{knowledgeStudioTab === "evidence" \? \(/, "Claims is shown in the Evidence view");
});

test("evidence read-model addition: the claim-library query joins kai.evidence_items read-only (no new persistence, no schema change) and the service/frontend project the real evidence fields", () => {
  const readModelSource = readFileSync("Backend/kai/db/kaiClaimLibraryReadModels.js", "utf8");
  const serviceSource = readFileSync("Backend/kai/services/kaiClaimLibraryService.js", "utf8");
  const logicSource = readFileSync("frontend/impactEvidenceLibraryLogic.js", "utf8");
  assert.match(readModelSource, /LEFT JOIN kai\.evidence_items e/);
  assert.doesNotMatch(readModelSource, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|FOR UPDATE|CREATE TABLE|ALTER TABLE/i);
  assert.match(serviceSource, /evidenceStatement: row\.evidence_statement \?\? null,/);
  assert.match(logicSource, /evidenceStatement: claim\.evidenceStatement \?\? null,/);
});

test("5: Gaps and Risks is organization-wide review work in Evidence, shown on request and labelled as organization-wide (same review-queue-derived data, no new fetch)", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "evidence" && showOrganizationReviewWork \? \(\s*<div className="admin-card mb-3">\s*<div className="d-flex justify-content-between align-items-center mb-2">\s*<h5 className="mb-0">Gaps and Risks<\/h5>/);
  assert.match(libSource, /Organization-wide review work<\/span>/);
  assert.match(libSource, /This is not limited to the selected Project\./);
  assert.match(libSource, /import KnowledgeStudioGapDetail from "\.\/knowledgeStudio\/KnowledgeStudioGapDetail\.jsx";/);
});

test("6: Gap Detail resolves the exact governed item selected from the Gaps list - not a re-derived or fabricated one - and never wires Add to Plan", () => {
  assert.match(libSource, /const \[selectedGap, setSelectedGap\] = useState\(null\);/);
  assert.match(libSource, /onClick=\{\(\) => setSelectedGap\(\{ \.\.\.gap, category: "gap" \}\)\}/);
  assert.match(libSource, /onClick=\{\(\) => setSelectedGap\(\{ \.\.\.finding, category: "coverageFinding" \}\)\}/);
  assert.match(libSource, /onClick=\{\(\) => setSelectedGap\(\{ \.\.\.conflict, category: "conflict" \}\)\}/);
  assert.match(libSource, /onClick=\{\(\) => setSelectedGap\(\{ \.\.\.followup, category: "followup" \}\)\}/);
  assert.match(libSource, /<KnowledgeStudioGapDetail\s*\n\s*gap=\{selectedGap\}/);
  assert.doesNotMatch(gapDetailSource, />\s*Add to Plan\s*</i, "no rendered button/label may offer Add to Plan in Package D");
  assert.match(gapDetailSource, /does NOT\s*\*?\s*wire or simulate "Add to Plan"/);
});

test("7: the Review Queue is organization-wide review work in Evidence and shows only status (never an unauthorized action) - decision controls remain in the already-authorized Traceability panel", () => {
  const marker = '{knowledgeStudioTab === "evidence" && showOrganizationReviewWork ? (\n      <div className="admin-card mb-3">\n        <div className="d-flex justify-content-between align-items-center mb-2">\n          <h5 className="mb-0">Review Queue</h5>';
  const reviewsIndex = libSource.indexOf(marker);
  assert.ok(reviewsIndex > -1, "Review Queue section in Evidence");
  const reviewsEnd = libSource.indexOf('\n      ) : null}', reviewsIndex);
  const reviewsSlice = libSource.slice(reviewsIndex, reviewsEnd);
  assert.doesNotMatch(reviewsSlice, /claimReviewDecisionBody|evidenceReviewDecisionBody|claimReviewCompletePath|evidenceReviewCompletePath/);
});

test("8 & 9: the shared Project/Engagement context (Package C0) is unchanged by this package - still the single controlled-with-fallback source, still cleared across organizations at the App level", () => {
  assert.match(libSource, /const organizationId = parentOrganizationId !== undefined \? parentOrganizationId : localOrganizationId;/);
  assert.match(libSource, /const engagementId = parentEngagementId !== undefined \? parentEngagementId : localEngagementId;/);
});

test("10 & 11: Web Intake and Traceability keep their internal logic; Traceability is the Evidence view's detail panel", () => {
  assert.match(libSource, /<div className="admin-card" ref=\{traceabilityPanelRef\} tabIndex=\{-1\}>/);
  const traceabilityIndex = libSource.indexOf('<div className="admin-card" ref={traceabilityPanelRef}');
  const precedingSlice = libSource.slice(Math.max(0, traceabilityIndex - 120), traceabilityIndex);
  assert.match(precedingSlice, /\{knowledgeStudioTab === "evidence" \? \(/, "Traceability is shown with Evidence");
  // Its review decision controls are unchanged.
  assert.match(libSource, /<GkFindingReviewPanel/);
});

test("12: every existing capability keeps exactly one view - drafting and reporting in Drafts, the claim workflow in Evidence, extraction in Sources", () => {
  const draftsStart = libSource.indexOf('{knowledgeStudioTab === "drafts" && !generatedDraftPacket ? (');
  assert.ok(draftsStart > -1, "Drafts view section");
  const draftsEnd = libSource.indexOf('<div className={knowledgeStudioTab === "evidence" ? "col-12 col-xl-7" : "col-12"}>');
  const drafts = libSource.slice(draftsStart, draftsEnd);
  for (const heading of ["KAI Baseline Readiness", "Funder Requirements", "Grant Response Packet", "Board Reporting", "Generated Drafts"]) {
    assert.ok(drafts.includes(`<h5 className="mb-0">${heading}</h5>`), `${heading} is in Drafts`);
  }
  for (const generator of ["generateFreeImpactAssessment", "generateEvidenceSummary", "generateImpactNarrative", "generateReadinessAssessment", "generateDataGapMemo", "generateFunderEvidenceSummary"]) {
    assert.ok(drafts.includes(`onClick={${generator}}`), `${generator} is in Drafts`);
  }
  // The selected draft opens in a focused reader with a way back.
  assert.match(libSource, /\{knowledgeStudioTab === "drafts" \? \(\s*<>\s*\{generatedDraftPacket \? \(\s*<div className="admin-card" data-gk-draft-reader="">/);
  assert.match(libSource, /data-gk-draft-back=""/);
  // Selection stays in Evidence and is shared state, so it survives switching views.
  assert.match(libSource, /onChange=\{\(\) => toggleGenerationClaim\(claim\)\}/);
  const workflowHeadingIndex = libSource.indexOf('<h5 className="mb-2">Claim &amp; evidence workflow</h5>');
  assert.match(libSource.slice(Math.max(0, workflowHeadingIndex - 200), workflowHeadingIndex), /\{knowledgeStudioTab === "evidence" \? \(/);
  const extractionHeadingIndex = libSource.indexOf('<h5 className="mb-2">Extract evidence from a source version</h5>');
  assert.match(libSource.slice(Math.max(0, extractionHeadingIndex - 200), extractionHeadingIndex), /\{knowledgeStudioTab === "sources" \? \(/);
  assert.match(libSource, /onClick=\{runExtractEvidence\}/);
});

test("D-Correction 3: Gap Detail no longer shows a raw claim UUID or a validator key as normal user-facing content", () => {
  assert.doesNotMatch(gapDetailSource, /Claim \{typeof gap\.claimId/, "no truncated claim UUID display");
  assert.doesNotMatch(gapDetailSource, /gap\.validatorKey/, "no validator key display");
  assert.doesNotMatch(gapDetailSource, />\s*Governed by\s*</, "no 'Governed by' validator-key section");
});

test("D-Correction 3: known status enums are translated to human-readable text rather than shown as raw backend vocabulary", () => {
  assert.match(gapDetailSource, /const STATUS_LABELS = Object\.freeze\(\{/);
  assert.match(gapDetailSource, /unresolved: "Not yet resolved",/);
  assert.match(gapDetailSource, /function humanizeStatus\(status\)/);
});

test("D-Correction 2: Processing states its real, honest scope and never fabricates progress for unimplemented stages", () => {
  assert.match(libSource, /Processing currently covers sensitivity &amp; allowed-use classification/);
  assert.match(libSource, /Other processing stages \(intake,\s*\n\s*profiling, data-dictionary mapping, source promotion\) are not yet exposed here\./);
  assert.doesNotMatch(libSource, /progress\s*:\s*\d|percentComplete|progressPercent/i, "no fabricated progress metric anywhere in this file");
});

test("sensitivity review reachability: every entry point outside Processing opens the one review card on Processing", () => {
  const open = libSource.match(/const openSensitivityReview = useCallback\(\(profileId\) => \{([\s\S]*?)\}, \[\]\);/);
  assert.ok(open, "one shared opener");
  assert.match(open[1], /setSelectedSensitivityProfileId\(profileId\);/);
  assert.match(open[1], /setKnowledgeStudioTab\("sources"\);/);
  // Review Queue (organization-wide review work in Evidence) entry.
  const reviews = libSource.slice(libSource.indexOf('{knowledgeStudioTab === "evidence" && showOrganizationReviewWork ? (\n      <div className="admin-card mb-3">\n        <div className="d-flex justify-content-between align-items-center mb-2">\n          <h5 className="mb-0">Review Queue</h5>'), libSource.indexOf('<h5 className="mb-0">Claims</h5>'));
  assert.ok(reviews.length > 0);
  assert.match(reviews, /onClick=\{\(\) => openSensitivityReview\(item\.intakeSensitivityProfileId\)\}/);
  assert.doesNotMatch(reviews, /onClick=\{\(\) => setSelectedSensitivityProfileId\(/, "no selection-only entry that leaves the card hidden");
  // Web Intake (Sources) entry for a selected (file-derived) profile, capability-gated.
  assert.match(libSource, /\{knowledgeStudioTab === "sources" && sensitivityCapability === true && intakeSensitivityProfileId \? \(/);
  assert.match(libSource, /onClick=\{\(\) => openSensitivityReview\(intakeSensitivityProfileId\)\}\s*>\s*Open sensitivity &amp; allowed-use review/);
  // The card itself is unchanged in its gating and receives focus.
  assert.match(libSource, /\{knowledgeStudioTab === "sources" && intakeSensitivityProfileId && sensitivityCapability === true \? \(\s*<div className="admin-card mt-3" ref=\{sensitivityReviewPanelRef\} tabIndex=\{-1\}>/);
  assert.doesNotMatch(libSource, /select the file above in KAI/, "Processing no longer points to a Web Intake that is on another tab");
  assert.match(libSource, /select the file in KAI Web\s+Intake above \(Sources\)/);
});
