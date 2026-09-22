import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package C0: one shared Project/Engagement
 * context for the whole /impact-library application, backed by the
 * existing listAuthorizedEngagements() capability and kai.engagements -
 * no new Project data model. Source-contract style, matching this repo's
 * established pattern for React components with no jsdom render harness.
 */

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const webIntakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("1: the Project list is fetched from the existing engagementsPath()/listAuthorizedEngagements read path, scoped to the active organization", () => {
  assert.match(appSource, /import \{ organizationsPath, organizationProfilePath, engagementsPath, createEngagementPath, postJson \} from "\.\/kaiWebIntakeLogic\.js";/);
  assert.match(appSource, /getJson\(engagementsPath\(organizationId\)\)/);
});

test("2: engagements are re-fetched (not just re-filtered) whenever the active organization changes, so a stale cross-organization list can never be shown - via the same shared refetchEngagements used by Package F's create action", () => {
  assert.match(appSource, /const refetchEngagements = useCallback\(async \(organizationId, \{ preserveSelection = false \} = \{\}\) => \{/);
  const effectIndex = appSource.indexOf("useEffect(() => {\n    setEngagements([]);");
  assert.ok(effectIndex > -1, "organization-keyed engagement reset/fetch effect not found");
  const effectSlice = appSource.slice(effectIndex, appSource.indexOf("[selectedOrganizationId, refetchEngagements]);", effectIndex) + 40);
  assert.match(effectSlice, /await refetchEngagements\(selectedOrganizationId\);/);
  assert.match(appSource, /\}, \[selectedOrganizationId, refetchEngagements\]\);/, "the engagement fetch effect must be keyed on the active organization");
});

test("3: exactly one authorized Project auto-selects itself", () => {
  assert.match(appSource, /if \(items\.length === 1\) \{\s*setSelectedEngagementId\(items\[0\]\.engagement_id\);/);
});

test("5: changing organization clears the previous Project selection before the new organization's list resolves", () => {
  const effectIndex = appSource.indexOf("useEffect(() => {\n    setEngagements([]);");
  assert.ok(effectIndex > -1);
  const effectSlice = appSource.slice(effectIndex, effectIndex + 200);
  assert.match(effectSlice, /setSelectedEngagementId\(""\);/);
});

test("4 & 7: the selected Project propagates as controlled props into ImpactEvidenceLibrary, which no longer owns an independent organization/engagement selection when embedded here", () => {
  assert.match(
    appSource,
    /<ImpactEvidenceLibrary\s*\n\s*organizationId=\{selectedOrganizationId\}\s*\n\s*onOrganizationIdChange=\{setSelectedOrganizationId\}\s*\n\s*engagementId=\{selectedEngagementId\}\s*\n\s*onEngagementIdChange=\{setSelectedEngagementId\}/,
  );
  // ImpactEvidenceLibrary itself: controlled-with-fallback, never a second
  // independent source of truth when a parent supplies these.
  assert.match(libSource, /organizationId: parentOrganizationId,\s*\n\s*onOrganizationIdChange,\s*\n\s*engagementId: parentEngagementId,\s*\n\s*onEngagementIdChange,/);
  assert.match(libSource, /const organizationId = parentOrganizationId !== undefined \? parentOrganizationId : localOrganizationId;/);
  assert.match(libSource, /const engagementId = parentEngagementId !== undefined \? parentEngagementId : localEngagementId;/);
});

test("4: the active Project further propagates from ImpactEvidenceLibrary into KaiWebIntake (Web Intake), which hides its own engagement picker once a parent supplies one", () => {
  assert.match(libSource, /<KaiWebIntake\s*\n\s*organizationId=\{organizationId\}\s*\n\s*engagementId=\{engagementId\}\s*\n\s*onEngagementIdChange=\{updateEngagementId\}/);
  assert.match(webIntakeSource, /\{parentEngagementId \? null : \(\s*\n\s*<div className="col-12 col-lg-5">\s*\n\s*<label className="form-label small fw-semibold">Engagement<\/label>/);
});

test("6: KaiWebIntake's own engagement bootstrap fetch is skipped only when a parent engagement is supplied - standalone (non-embedded) callers are unaffected", () => {
  assert.match(
    webIntakeSource,
    /if \(parentEngagementId\) \{\s*setEngagements\(\[\]\);\s*setEngagementsLoaded\(true\);\s*return;\s*\}/,
  );
});

test("8: the Project selector never offers a Project outside the fetched (organization-scoped) list, so a cross-organization selection is not representable in the UI", () => {
  assert.match(shellSource, /\{engagements\.map\(\(eng\) => \(/);
  // No free-text/typed engagement id input anywhere in the shared control.
  assert.doesNotMatch(shellSource, /<input[^>]*engagementId/);
});

test("9: the Project selector prefers the human-readable engagement_code and only falls back to the raw id, never fabricating a name", () => {
  assert.match(shellSource, /\{eng\.engagement_code \|\| eng\.engagement_id\}/);
});

test("10: \"All organizational knowledge\" is only offered when the active section is explicitly classified as organization-wide", () => {
  assert.match(appSource, /const SECTION_ALLOWS_ORGANIZATION_WIDE = Object\.freeze\(\{\s*knowledgeStudio: true,\s*impactLibrary: true,\s*\}\);/);
  assert.match(appSource, /const allowOrganizationWide = SECTION_ALLOWS_ORGANIZATION_WIDE\[activeSection\] === true;/);
  assert.match(shellSource, /\{allowOrganizationWide \? <option value="">All organizational knowledge<\/option> : null\}/);
});
