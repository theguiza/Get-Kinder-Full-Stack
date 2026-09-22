import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Home (Package C, KAI Impact Library redesign). Per owner decision:
 * real evidence-system metrics only, no Programs KPI, no fabricated
 * recommendation-engine copy, no fabricated Recent Activity, Next Action
 * and the Needs Attention preview built only from real, already-governed
 * read paths (governed Claim Library, Review Queue, Gaps and Risks).
 * Source-contract style, matching this repo's established pattern.
 */

const homeSource = readFileSync("frontend/ImpactHomeView.jsx", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");

test("Home's stats and Needs-Attention data come only from existing governed read paths - no Programs, no Recent Activity, no recommendation-engine call", () => {
  assert.match(homeSource, /claimLibraryCandidatesPath/);
  assert.match(homeSource, /organizationReviewQueuePath/);
  assert.match(homeSource, /projectOrganizationGapsAndRisks/);
  // No fabricated stat tile or rendered section for concepts with no real backing.
  assert.doesNotMatch(homeSource, /label="Programs"/);
  assert.doesNotMatch(homeSource, />Recent [Aa]ctivity</);
});

test("the Impact Facts stat counts only claims with the real, migration-verified 'reviewed' claim_review_status value", () => {
  assert.match(homeSource, /claim\.claimReviewStatus === "reviewed"/);
});

test("the Recommendations stat is a real count of governed gap items plus coverage findings, not an invented number", () => {
  assert.match(homeSource, /const recommendationsCount = gapsAndRisks\.gapItems\.length \+ gapsAndRisks\.coverageFindings\.length;/);
});

test("Needs your attention is never shown as a conclusive number unless the review queue rollup actually completed", () => {
  assert.match(homeSource, /const attentionCount = reviewQueueComplete \? reviewQueueItems\.length : null;/);
  assert.match(homeSource, /reviewQueueIsComplete\(reviewQueueCompleteness\)/);
});

test("Next Action is derived from a real actionable Review Queue item (reviewQueueBlockerActionability), never hardcoded recommendation copy", () => {
  assert.match(homeSource, /reviewQueueBlockerActionability\(item\.blockerCodes\[0\], item\)/);
  assert.match(homeSource, /item\.actionability === "ACTION_REQUIRED"/);
  assert.doesNotMatch(homeSource, /Track training attendance/);
});

test("Home never fabricates a claim statement/title that the DTO does not provide - it labels by claim id and real blocker text only", () => {
  assert.match(homeSource, /function reviewQueueItemLabel/);
  assert.match(homeSource, /blockerDisplayText\(blockerCode, item\.requestedAudience\)/);
});

test("first-time state is derived from real signals (no claims and a conclusively empty review queue), not a manual toggle", () => {
  assert.match(
    homeSource,
    /const isFirstTime = claimsLoaded && candidateClaims\.length === 0 && reviewQueueComplete && reviewQueueItems\.length === 0;/,
  );
});

test("ImpactLibraryApp wires Home to the real ImpactHomeView, not a placeholder, and Home does not show the Project context bar (it does not yet consume it)", () => {
  assert.match(appSource, /import ImpactHomeView from "\.\/ImpactHomeView\.jsx";/);
  assert.match(
    appSource,
    /activeSection === "home"\) \{\s*sectionContent = \(\s*<ImpactHomeView/,
  );
  assert.match(appSource, /const SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object\.freeze\(\{\s*knowledgeStudio: true,\s*\}\);/);
});

test("Home is the default landing section for /impact-library, matching the approved design's IA", () => {
  assert.match(appSource, /initialSection = "home"/);
});
