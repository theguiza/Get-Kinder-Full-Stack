import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package H: Needs Attention, the cross-product
 * human-action inbox reached only via the header bell. All included
 * domains reuse the same already-governed Review Queue / sensitivity
 * rollups Knowledge Studio's Reviews tab already uses - no second review
 * truth, no new backend read, no fabricated alert.
 */

const hookSource = readFileSync("frontend/needsAttention/useNeedsAttention.js", "utf8");
const viewSource = readFileSync("frontend/needsAttention/NeedsAttentionView.jsx", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");

test("Needs Attention reuses the exact same existing read paths as Knowledge Studio's Reviews tab - no second review truth, no new endpoint", () => {
  assert.match(hookSource, /organizationReviewQueuePath,\s*\n\s*projectReviewQueue,/);
  assert.match(hookSource, /sensitivityCapabilitiesPath,\s*\n\s*sensitivityReviewQueuePath,/);
  assert.match(hookSource, /reviewQueueBlockerActionability,\s*\n\s*blockerDisplayText,/);
});

test("the bell requests the internal Review Queue only when the client-safe summary reports internalReviewAvailable; client follow-ups come only from summary clientActions", () => {
  assert.match(hookSource, /impactHomeSummaryPath,\s*\n\s*projectImpactHomeSummary,/);
  assert.match(hookSource, /if \(!projectedSummary\.internalReviewAvailable\) \{\s*\/\/[^\n]*\n\s*setReviewQueueRequestState\("success"\);\s*return;\s*\}\s*const result = await getJson\(organizationReviewQueuePath\(organizationId\)\);/);
  assert.match(hookSource, /const clientActions = summary && !summary\.internalReviewAvailable \? summary\.clientActions : \[\];/);
});

test("the approved MVP domains (claim review, evidence review, sensitivity/allowed-use, client follow-ups) are all derived from the shared rollup - domain 5 (intake/file problems) is intentionally omitted, not fabricated", () => {
  assert.match(hookSource, /claim_review_unresolved/);
  assert.match(hookSource, /evidence_review_unresolved/);
  assert.match(hookSource, /client_followup_unresolved/);
  assert.match(hookSource, /sensitivityAttention/);
  assert.match(hookSource, /Domain 5 \(intake\/file problems requiring action\) is intentionally NOT/);
});

test("the header bell's hasAttention is never a fabricated positive or negative signal - it is only true once every underlying rollup has conclusively resolved", () => {
  assert.match(hookSource, /const resolved = reviewQueueComplete && sensitivityAttention\.status !== "loading" && sensitivityAttention\.status !== "error";/);
  assert.match(hookSource, /const hasAttention = resolved && totalCount > 0;/);
});

test("ImpactLibraryApp wires the real hook to both the bell and the full Needs Attention view - one shared state, not two", () => {
  assert.match(appSource, /const needsAttention = useNeedsAttention\(selectedOrganizationId\);/);
  assert.match(appSource, /hasAttention=\{needsAttention\.hasAttention\}/);
  assert.match(appSource, /<NeedsAttentionView\s*\n\s*organizationId=\{selectedOrganizationId\}\s*\n\s*resolved=\{needsAttention\.resolved\}/);
});

test("Needs Attention is reached only via the header bell, never added as a left-nav destination (unchanged from Package B)", () => {
  assert.doesNotMatch(shellSource, /"needsAttention"/);
});

test("Needs Attention never fabricates a claim statement/title - it labels items by claim id and the real, existing blockerDisplayText, matching the same convention already established for Home's Next Action", () => {
  assert.match(viewSource, /entry\.item\.claim\?\.claim_id/);
  assert.doesNotMatch(viewSource, /Track training attendance|"Review proposed Impact Fact"/);
});

test("Needs Attention does not show the shared Project context bar (its reads are organization-wide, same classification as Reviews)", () => {
  assert.doesNotMatch(appSource, /SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object\.freeze\(\{[^}]*needsAttention:/s);
});
