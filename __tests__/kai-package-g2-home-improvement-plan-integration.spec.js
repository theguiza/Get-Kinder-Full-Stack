import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package G2 Home integration: real, persisted
 * Improvement Practice state surfaced on Impact Home - no fabricated
 * recommendation or sample practice, honest empty state when none exist.
 */

const homeSource = readFileSync("frontend/ImpactHomeView.jsx", "utf8");
const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");

test("Home fetches the real, organization-wide improvement-practices list (no engagement filter) - never a fabricated count", () => {
  assert.match(homeSource, /import \{ improvementPracticesPath \} from "\.\/kaiWebIntakeLogic\.js";/);
  assert.match(homeSource, /getJson\(improvementPracticesPath\(organizationId\)\)/);
  assert.doesNotMatch(homeSource, /improvementPracticesPath\(organizationId, *(selectedEngagementId|engagementId)/);
});

test("Home's Improvement Plan stat tile and preview are gated on improvementPracticesLoaded, never shown as a fabricated number before it resolves", () => {
  assert.match(homeSource, /const \[improvementPracticesLoaded, setImprovementPracticesLoaded\] = useState\(false\);/);
  assert.match(homeSource, /n=\{improvementPracticesLoaded \? activeImprovementPracticesCount : "…"\}/);
});

test("Home renders an honest empty state when no active/recommended practices exist - never a sample/fabricated practice", () => {
  assert.match(homeSource, /No active or recommended Improvement Practices yet\./);
});

test("Home's Improvement Plan preview humanizes status via the shared improvementPlanLogic.js labels", () => {
  assert.match(homeSource, /import \{ humanizeImprovementPracticeStatus \} from "\.\/improvementPlan\/improvementPlanLogic\.js";/);
  assert.match(homeSource, /humanizeImprovementPracticeStatus\(practice\.status\)/);
});

test("ImpactLibraryApp wires a real onGoToImprovementPlan navigation callback into Home", () => {
  assert.match(appSource, /onGoToImprovementPlan=\{\(\) => setActiveSection\("improvementPlan"\)\}/);
});
