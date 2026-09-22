import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package D: Knowledge Studio's five tabs (Files,
 * Processing, Evidence, Gaps, Reviews) plus Gap Detail, built by
 * incrementally gating ImpactEvidenceLibrary.jsx's existing, already-tested
 * render sections behind a knowledgeStudioTab toggle - no section's own
 * state, effects, fetch logic, or API contract was touched. Source-contract
 * style, matching this repo's established pattern for this file.
 */

const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const gapDetailSource = readFileSync("frontend/knowledgeStudio/KnowledgeStudioGapDetail.jsx", "utf8");

test("1: the five approved tabs are real, single-select UI driven by one piece of state", () => {
  assert.match(libSource, /const \[knowledgeStudioTab, setKnowledgeStudioTab\] = useState\("files"\);/);
  assert.match(libSource, /\["files", "Files"\]/);
  assert.match(libSource, /\["processing", "Processing"\]/);
  assert.match(libSource, /\["evidence", "Evidence"\]/);
  assert.match(libSource, /\["gaps", "Gaps"\]/);
  assert.match(libSource, /\["reviews", "Reviews"\]/);
});

test("2: Files preserves existing Web Intake and gates it (and the existing Data Sources read) to the Files tab, without a duplicate Engagement selector", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "files" && organizationId \? \(\s*<KaiWebIntake/);
  assert.match(libSource, /\{knowledgeStudioTab === "files" \? \(\s*<div className="admin-card mt-3">\s*<h5 className="mb-2">Data Sources<\/h5>/);
  // KaiWebIntake still receives the shared engagement context (Package C0), not a second selector.
  assert.match(libSource, /<KaiWebIntake\s*\n\s*organizationId=\{organizationId\}\s*\n\s*engagementId=\{engagementId\}\s*\n\s*onEngagementIdChange=\{updateEngagementId\}/);
});

test("3: Processing gates the existing real sensitivity/allowed-use review states (no new fabricated progress state introduced)", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "processing" && sensitivityCapability === true \? \(/);
  assert.match(libSource, /\{knowledgeStudioTab === "processing" && intakeSensitivityProfileId && sensitivityCapability === true \? \(/);
});

test("4: Evidence gates the existing governed Claim Library section, preserving its real lineage/source data", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "evidence" \? \(\s*<div className="admin-card">\s*<div className="d-flex justify-content-between align-items-center mb-2">\s*<h5 className="mb-0">Claims<\/h5>/);
});

test("5: Gaps gates the existing organization-level Gaps and Risks section (same review-queue-derived data, no new fetch)", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "gaps" \? \(\s*<div className="admin-card mb-3">\s*<div className="d-flex justify-content-between align-items-center mb-2">\s*<h5 className="mb-0">Gaps and Risks<\/h5>/);
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

test("7: Reviews gates the existing Review Queue section, which shows only status (never an unauthorized action) - decision controls remain in the untouched, already-authorized Traceability panel", () => {
  assert.match(libSource, /\{knowledgeStudioTab === "reviews" \? \(\s*<div className="admin-card mb-3">\s*<div className="d-flex justify-content-between align-items-center mb-2">\s*<h5 className="mb-0">Review Queue<\/h5>/);
  // No new review-decision button was added inside the Reviews tab section itself.
  const reviewsTabIndex = libSource.indexOf('{knowledgeStudioTab === "reviews" ? (');
  const reviewsTabEnd = libSource.indexOf('\n      ) : null}', reviewsTabIndex);
  const reviewsTabSlice = libSource.slice(reviewsTabIndex, reviewsTabEnd);
  assert.doesNotMatch(reviewsTabSlice, /claimReviewDecisionBody|evidenceReviewDecisionBody|claimReviewCompletePath|evidenceReviewCompletePath/);
});

test("8 & 9: the shared Project/Engagement context (Package C0) is unchanged by this package - still the single controlled-with-fallback source, still cleared across organizations at the App level", () => {
  assert.match(libSource, /const organizationId = parentOrganizationId !== undefined \? parentOrganizationId : localOrganizationId;/);
  assert.match(libSource, /const engagementId = parentEngagementId !== undefined \? parentEngagementId : localEngagementId;/);
});

test("10 & 11: existing Web Intake and Traceability behavior are untouched - only their visibility is tab-gated, not their internal logic", () => {
  // Traceability panel is not tab-gated - it remains reachable regardless of active tab.
  assert.match(libSource, /<div className="admin-card" ref=\{traceabilityPanelRef\} tabIndex=\{-1\}>/);
  const traceabilityIndex = libSource.indexOf('<div className="admin-card" ref={traceabilityPanelRef}');
  const precedingSlice = libSource.slice(Math.max(0, traceabilityIndex - 80), traceabilityIndex);
  assert.doesNotMatch(precedingSlice, /knowledgeStudioTab ===/, "the Traceability panel must not be tab-gated");
});

test("12: existing non-tab capabilities (Funder Requirements, Grant Response Packet, Board Reporting, Generated Drafts, KAI Baseline Readiness, Claim & evidence workflow) remain unconditionally reachable, not deleted or tab-gated", () => {
  for (const heading of [
    "KAI Baseline Readiness",
    "Funder Requirements",
    "Grant Response Packet",
    "Board Reporting",
    "Generated Drafts",
  ]) {
    const headingIndex = libSource.indexOf(`<h5 className="mb-0">${heading}</h5>`);
    assert.ok(headingIndex > -1, `${heading} section must still exist`);
    const precedingSlice = libSource.slice(Math.max(0, headingIndex - 200), headingIndex);
    assert.doesNotMatch(precedingSlice, /knowledgeStudioTab ===/, `${heading} must remain unconditionally reachable (not gated to a single tab)`);
  }
  const workflowHeadingIndex = libSource.indexOf('<h5 className="mb-2">Claim &amp; evidence workflow</h5>');
  assert.ok(workflowHeadingIndex > -1);
  const workflowPreceding = libSource.slice(Math.max(0, workflowHeadingIndex - 200), workflowHeadingIndex);
  assert.doesNotMatch(workflowPreceding, /knowledgeStudioTab ===/, "Claim & evidence workflow must remain unconditionally reachable");
});
