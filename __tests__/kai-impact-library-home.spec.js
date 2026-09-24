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
  assert.match(homeSource, /impactHomeSummaryPath/);
  assert.match(homeSource, /organizationReviewQueuePath/);
  assert.match(homeSource, /projectOrganizationGapsAndRisks/);
  // No fabricated stat tile or rendered section for concepts with no real backing.
  assert.doesNotMatch(homeSource, /label="Programs"/);
  assert.doesNotMatch(homeSource, />Recent [Aa]ctivity</);
});

test("Home never reads the GK-internal claim-library index; the Impact Facts stat is the server's governed aggregate count only", () => {
  assert.doesNotMatch(homeSource, /claimLibraryCandidatesPath|projectCandidateClaims|claimReviewStatus/);
  assert.match(homeSource, /summary\.reviewedImpactFactCount/);
});

test("Home requests the internal Review Queue only when the client-safe summary reports internalReviewAvailable", () => {
  assert.match(homeSource, /if \(!projected\?\.internalReviewAvailable\) return;\s*setReviewQueueRequestState\("loading"\);\s*const queueResult = await getJson\(organizationReviewQueuePath\(organizationId\)\);/);
  assert.match(homeSource, /\{internalReviewAvailable \? \(\s*<StatTile n=\{reviewQueueComplete \? recommendationsCount : "…"\} label="Recommendations" \/>/);
});

test("the Recommendations stat is a real count of governed gap items plus coverage findings, not an invented number", () => {
  assert.match(homeSource, /const recommendationsCount = gapsAndRisks\.gapItems\.length \+ gapsAndRisks\.coverageFindings\.length;/);
});

test("Needs your attention is never shown as a conclusive number unless its source (internal Review Queue or client-safe summary) actually resolved", () => {
  assert.match(homeSource, /const attentionResolved = internalReviewAvailable \? reviewQueueComplete : Boolean\(summary\);/);
  assert.match(homeSource, /const attentionCount = !attentionResolved\s*\? null/);
  assert.match(homeSource, /: summary\.clientActionCount;/);
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

test("first-time state is derived only from client-visible summary state (plus a conclusively empty internal queue for internal reviewers), not a manual toggle", () => {
  assert.match(
    homeSource,
    /const isFirstTime =\s*summary\?\.isFirstTime === true && \(!internalReviewAvailable \|\| \(reviewQueueComplete && reviewQueueItems\.length === 0\)\);/,
  );
});

test("ImpactLibraryApp wires Home to the real ImpactHomeView, not a placeholder, and Home does not show the Project context bar (it does not yet consume it)", () => {
  assert.match(appSource, /import ImpactHomeView from "\.\/ImpactHomeView\.jsx";/);
  assert.match(
    appSource,
    /activeSection === "home"\) \{\s*sectionContent = \(\s*<ImpactHomeView/,
  );
  assert.match(appSource, /const SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object\.freeze\(\{\s*knowledgeStudio: true,\s*improvementPlan: true,\s*\}\);/);
});

test("Home is the default landing section for /impact-library, matching the approved design's IA", () => {
  assert.match(appSource, /initialSection = "home"/);
});
