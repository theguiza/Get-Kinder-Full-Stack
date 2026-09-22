import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package E: Impact Library (list) + Impact Fact
 * Detail. "Impact Fact" is a UI projection of the existing governed
 * claim/evidence/traceability model - no kai.impact_facts persistence.
 * Source-contract style, matching this repo's established pattern.
 */

const listSource = readFileSync("frontend/impactLibrary/ImpactLibraryListView.jsx", "utf8");
const detailSource = readFileSync("frontend/impactLibrary/ImpactFactDetailView.jsx", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");

test("Impact Library list reuses the existing governed Claim Library read path - no new persistence path is imported or called", () => {
  assert.match(listSource, /import \{\s*claimLibraryCandidatesPath,\s*getJson,\s*projectCandidateClaims,\s*\} from "\.\.\/impactEvidenceLibraryLogic\.js";/);
  assert.doesNotMatch(listSource, /impactFactsPath\(|getJson\(impactFacts/);
});

test("Impact Library never shows a fabricated Program/Period/tags field that the read model does not provide", () => {
  const renderedSource = listSource.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(renderedSource, /"Program"|programLabel|periodLabel|\.tags\b|claim\.program\b|claim\.period\b/);
});

test("Impact Fact Detail is built entirely over the existing per-claim Traceability read (claimTraceabilityPath/projectTraceability) - no second data source", () => {
  assert.match(detailSource, /claimTraceabilityPath,\s*\n\s*getJson,\s*\n\s*projectTraceability,/);
});

test("Impact Fact Detail's five approved tabs are present and Overview is the default", () => {
  for (const key of ["overview", "sources", "limitations", "allowedUse", "history"]) {
    assert.match(detailSource, new RegExp(`activeTab === "${key}"`));
  }
  assert.match(detailSource, /const \[activeTab, setActiveTab\] = useState\("overview"\);/);
});

test("Sources tab shows real source/version/locator lineage from the existing traceability projection, not a raw id alone", () => {
  assert.match(detailSource, /traceability\.source\.reviewed_source_type \|\| traceability\.source\.source_id/);
  assert.match(detailSource, /traceability\.sourceVersion\.is_current/);
  assert.match(detailSource, /traceability\.locator\.coordinates\?\.column_name/);
});

test("Limitations are derived only from real dimension/gap/conflict state already in the traceability projection - never invented", () => {
  assert.match(detailSource, /dimension\.displayStatus === "known_limitation"/);
  assert.match(detailSource, /traceability\.gapItems/);
  assert.match(detailSource, /traceability\.potentialConflictGroups/);
});

test("Allowed use distinguishes internal/funder/public suitability from real evidence use-authority flags and real audience eligibility, with a suitability-is-not-approval disclaimer", () => {
  assert.match(detailSource, /traceability\.evidence\?\.internal_only/);
  assert.match(detailSource, /traceability\.evidence\?\.funder_use_allowed/);
  assert.match(detailSource, /traceability\.evidence\?\.public_use_allowed/);
  assert.match(detailSource, /traceability\.eligible/);
  assert.match(detailSource, /Suitability reflects evidence quality, not final publication authority/);
});

test("History shows only the real current review state, not a fabricated timeline, and says so honestly when no state exists", () => {
  assert.match(detailSource, /traceability\.claimReviewDecision\?\.decisionOutcome \|\| traceability\.evidenceReviewDecision\?\.decisionOutcome/);
  assert.match(detailSource, /A timestamped history is not yet available for this Impact Fact/);
});

test("\"Use this\" is intentionally not wired - no fabricated generic reuse action - and this is recorded, not silently omitted", () => {
  assert.doesNotMatch(detailSource, />\s*Use this\s*</);
  assert.match(detailSource, /"Use this" is intentionally not wired/);
});

test("Impact Library and Impact Fact Detail are classified organization-wide and do not show the shared Project context bar (their reads take no engagementId)", () => {
  assert.match(appSource, /impactLibrary: true,/);
  assert.doesNotMatch(listSource, /engagementId/);
  assert.doesNotMatch(detailSource, /engagementId/);
});

test("ImpactLibraryApp wires the real list/detail views, drills in by claimId, and resets the selection on organization change", () => {
  assert.match(appSource, /import ImpactLibraryListView from "\.\/impactLibrary\/ImpactLibraryListView\.jsx";/);
  assert.match(appSource, /import ImpactFactDetailView from "\.\/impactLibrary\/ImpactFactDetailView\.jsx";/);
  assert.match(appSource, /const \[selectedImpactFactClaimId, setSelectedImpactFactClaimId\] = useState\(null\);/);
  assert.match(appSource, /setSelectedImpactFactClaimId\(null\);\s*\}, \[activeSection, selectedOrganizationId\]\);/);
});
