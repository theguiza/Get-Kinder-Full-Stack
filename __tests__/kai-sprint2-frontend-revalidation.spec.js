import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Frontend authorization freshness: the browser re-reads server answers at
// meaningful boundaries; the server stays authoritative for every write.
const hookSource = readFileSync("frontend/useRevalidateOnReturn.js", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const clientStudioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
const followupSource = readFileSync("frontend/KaiClientFollowupReview.jsx", "utf8");
const needsAttentionSource = readFileSync("frontend/needsAttention/useNeedsAttention.js", "utf8");
const gkStudioSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const sourcePanelSource = readFileSync("frontend/KaiSourceReviewPanel.jsx", "utf8");

test("revalidation hook: runs on focus and on becoming visible, throttled, with no polling or timer", () => {
  assert.match(hookSource, /window\.addEventListener\("focus", run\)/);
  assert.match(hookSource, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(hookSource, /window\.removeEventListener\("focus", run\)/);
  assert.match(hookSource, /document\.removeEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(hookSource, /if \(now - lastRunAt < MIN_INTERVAL_MS\) return;/);
  assert.doesNotMatch(hookSource, /setInterval|setTimeout/);
});

test("Impact Library shell: returning re-reads access capabilities, the review-cockpit capability, and client facts in place", () => {
  assert.match(appSource, /useRevalidateOnReturn\(\(\) => \{\s*refreshAccessCapabilities\(\);\s*needsAttention\.revalidate\(\);\s*if \(clientFactsNeeded\) refreshClientImpactFacts\(\);\s*\}, Boolean\(selectedOrganizationId\)\);/);
  assert.match(appSource, /onRefreshFacts=\{refreshClientImpactFacts\}/);
  assert.match(clientStudioSource, /if \(key !== tab && key === "evidence"\) onRefreshFacts\?\.\(\);/);
  assert.match(clientStudioSource, /useRevalidateOnReturn\(\(\) => \{\s*if \(PIPELINE_TABS\.has\(tab\)\) refreshPipeline\(\);\s*\}, Boolean\(organizationId && engagementId\)\);/);
});

test("needs-attention revalidation updates the review-cockpit answer in place and discards another organization's answer", () => {
  const revalidate = needsAttentionSource.slice(needsAttentionSource.indexOf("const revalidate = useCallback"), needsAttentionSource.indexOf("const sensitivityAttention = useMemo"));
  assert.match(revalidate, /if \(organizationIdRef\.current !== requestedOrganizationId\) return;/);
  assert.match(revalidate, /if \(result\.statusCode !== 200 \|\| !result\.body\?\.ok\) return;/);
  assert.doesNotMatch(revalidate, /requestState: "loading"/, "an unchanged answer never passes through loading");
  assert.match(needsAttentionSource, /revalidate,\n\s+\};/);
});

test("client follow-ups: only the latest load applies, an organization change discards the list, and a refused completion re-reads it", () => {
  assert.match(followupSource, /if \(loadSeqRef\.current !== loadSeq\) return;/);
  const change = followupSource.slice(followupSource.indexOf("const changeOrganization"), followupSource.indexOf("const completeWorkflow"));
  assert.match(change, /loadSeqRef\.current \+= 1;[\s\S]*setWorkflows\(\[\]\);[\s\S]*setLoadedOrganizationId\(""\);/);
  const complete = followupSource.slice(followupSource.indexOf("const completeWorkflow"), followupSource.indexOf("return ("));
  assert.match(complete, /const workflowOrganizationId = loadedOrganizationId;/);
  assert.match(complete, /clientFollowupCompletePath\(workflowOrganizationId, item\.claimId, item\.clientFollowupItemId\)/);
  assert.match(complete, /await loadWorkflows\(workflowOrganizationId\);\s*setMessage\(refusal\);/);
  assert.match(followupSource, /useRevalidateOnReturn\(\(\) => \{\s*if \(loadedOrganizationId\) loadWorkflows\(loadedOrganizationId\);\s*\}, Boolean\(loadedOrganizationId\)\);/);
});

test("GK Studio: returning re-reads both review-cockpit capabilities; a refused source decision re-reads the candidate detail", () => {
  assert.match(gkStudioSource, /useRevalidateOnReturn\(async \(\) => \{[\s\S]*?getJson\(sensitivityCapabilitiesPath\(requestedOrganizationId\)\)[\s\S]*?setSourceReviewCapability\(result\.body\.data\?\.can_review_source_candidates === true\);[\s\S]*?\}, Boolean\(organizationId\)\);/);
  assert.match(sourcePanelSource, /const refusal = errorText\(result\);\s*await loadDetail\(candidateId\);/);
});

test("no frontend role policy: the revalidated surfaces read server answers only", () => {
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const source of [hookSource, followupSource, needsAttentionSource, sourcePanelSource]) {
    assert.doesNotMatch(code(source), /gk_admin|gk_operator|gk_reviewer|client_admin|client_reviewer|kaiRoles|organizationMemberships|is_admin/);
  }
});
