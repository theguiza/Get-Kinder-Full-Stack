import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package F: Projects, over the existing
 * kai.engagements capability. "Project" is the user-facing term; no new
 * Project table/model/service was created.
 */

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const projectsViewSource = readFileSync("frontend/projects/ProjectsView.jsx", "utf8");

test("Projects consumes the same shared engagements list/selection ImpactLibraryApp already owns (Package C0) - no second, independent fetch or selector", () => {
  assert.match(appSource, /import ProjectsView from "\.\/projects\/ProjectsView\.jsx";/);
  assert.match(
    appSource,
    /<ProjectsView\s*\n\s*engagements=\{engagements\}\s*\n\s*engagementsLoaded=\{engagementsLoaded\}\s*\n\s*selectedEngagementId=\{selectedEngagementId\}\s*\n\s*onSelectEngagement=\{setSelectedEngagementId\}/,
  );
  assert.doesNotMatch(projectsViewSource, /useEffect|getJson\(engagementsPath/);
});

test("selecting a Project updates the same shared selectedEngagementId Knowledge Studio consumes", () => {
  assert.match(projectsViewSource, /onClick=\{\(\) => onSelectEngagement\(engagement\.engagement_id\)\}/);
});

test("Projects shows only real engagement fields - name/code, type, status - and never a fabricated reporting period", () => {
  assert.match(projectsViewSource, /engagement\.engagement_code \|\| engagement\.engagement_id/);
  assert.match(projectsViewSource, /engagement\.engagement_type \|\| "Type not set"/);
  assert.match(projectsViewSource, /engagement\.engagement_status/);
  const renderedSource = projectsViewSource.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(renderedSource, /reporting.?period|reportingPeriod/i);
});

test("+ New Project is wired to the real, newly-authorized create-engagement action - not a dead button", () => {
  assert.match(projectsViewSource, /onClick=\{\(\) => setShowCreateForm/);
  assert.match(projectsViewSource, /await onCreateEngagement\(name, newProjectType\.trim\(\) \|\| undefined\)/);
  assert.match(appSource, /const createEngagement = useCallback\(async \(engagementCode, engagementType\) => \{/);
  assert.match(appSource, /postJson\(createEngagementPath\(selectedOrganizationId\), body\)/);
});

test("+ New Project accepts an optional Project type, reusing the existing engagement_type column instead of a fabricated one", () => {
  assert.match(projectsViewSource, /placeholder="Type \(optional\)"/);
  assert.match(appSource, /if \(engagementType\) body\.engagement_type = engagementType;/);
});

test("a successful Project creation re-fetches the one shared list (preserving the current selection) and selects the new Project - never a second list", () => {
  assert.match(appSource, /await refetchEngagements\(selectedOrganizationId, \{ preserveSelection: true \}\);/);
  assert.match(appSource, /const createdEngagementId = result\.body\.data\?\.engagement_id;/);
  assert.match(appSource, /if \(createdEngagementId\) setSelectedEngagementId\(createdEngagementId\);/);
});

test("Batch is never elevated to a user-facing Project concept anywhere in the Projects view", () => {
  assert.doesNotMatch(projectsViewSource, /batch/i);
});

test("Projects does not show the shared Project context bar (it is the Project picker itself)", () => {
  assert.doesNotMatch(appSource, /SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object\.freeze\(\{[^}]*projects:/s);
});
