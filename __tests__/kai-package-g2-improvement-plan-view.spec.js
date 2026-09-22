import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Impact Library redesign, Package G2: Improvement Plan real destination,
 * replacing the ComingSoonPanel placeholder, plus Gap Detail's "Add to
 * Plan" wiring.
 */

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const viewSource = readFileSync("frontend/improvementPlan/ImprovementPlanView.jsx", "utf8");
const logicSource = readFileSync("frontend/improvementPlan/improvementPlanLogic.js", "utf8");
const gapDetailSource = readFileSync("frontend/knowledgeStudio/KnowledgeStudioGapDetail.jsx", "utf8");
const libraryAppSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const kaiWebIntakeLogicSource = readFileSync("frontend/kaiWebIntakeLogic.js", "utf8");

test("Improvement Plan no longer renders the ComingSoonPanel placeholder", () => {
  assert.doesNotMatch(appSource, /ComingSoonPanel/);
  assert.match(
    appSource,
    /activeSection === "improvementPlan"\) \{\s*sectionContent = \(\s*<ImprovementPlanView/,
  );
});

test("ImpactLibraryApp wires the real improvement-practices list/create/status-change state into ImprovementPlanView", () => {
  assert.match(appSource, /import ImprovementPlanView from "\.\/improvementPlan\/ImprovementPlanView\.jsx";/);
  assert.match(appSource, /const \[improvementPractices, setImprovementPractices\] = useState\(\[\]\);/);
  assert.match(appSource, /const refetchImprovementPractices = useCallback\(/);
  assert.match(appSource, /improvementPracticesPath\(organizationId, engagementId\)/);
  assert.match(appSource, /const createImprovementPractice = useCallback\(/);
  assert.match(appSource, /const changeImprovementPracticeStatus = useCallback\(/);
  assert.match(appSource, /practices=\{improvementPractices\}/);
  assert.match(appSource, /onCreatePractice=\{createImprovementPractice\}/);
  assert.match(appSource, /onChangeStatus=\{changeImprovementPracticeStatus\}/);
});

test("Improvement Plan is classified organization-wide and shows the shared Project context bar", () => {
  assert.match(appSource, /const SECTION_ALLOWS_ORGANIZATION_WIDE = Object\.freeze\(\{[\s\S]*?improvementPlan: true,[\s\S]*?\}\);/);
  assert.match(appSource, /const SECTION_SHOWS_PROJECT_CONTEXT_BAR = Object\.freeze\(\{[\s\S]*?improvementPlan: true,[\s\S]*?\}\);/);
});

test("kaiWebIntakeLogic.js exposes improvement-practices path helpers matching the Package G routes", () => {
  assert.match(kaiWebIntakeLogicSource, /export function improvementPracticesPath\(organizationId, engagementId\)/);
  assert.match(kaiWebIntakeLogicSource, /export function improvementPracticePath\(organizationId, improvementPracticeId\)/);
  assert.match(kaiWebIntakeLogicSource, /export function improvementPracticeStatusPath\(organizationId, improvementPracticeId\)/);
});

test("kaiWebIntakeLogic.js still never introduces PATCH/DELETE (locked mutation-verb contract)", () => {
  assert.doesNotMatch(kaiWebIntakeLogicSource, /\bPATCH\b|\bDELETE\b/);
});

test("ImprovementPlanView shows only real, persisted fields - never a raw responsible_actor_user_id, and gap_log_item_id only as a boolean tag", () => {
  const renderedSource = viewSource.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(renderedSource, /practice\.responsible_actor_user_id/);
  assert.match(viewSource, /practice\.gap_log_item_id \? <span>Originated from a data gap<\/span> : null/);
  assert.match(viewSource, /No Improvement Practices yet for this organization\./);
});

test("ImprovementPlanView humanizes status/cadence - never exposes the raw enum vocabulary as the primary label", () => {
  assert.match(viewSource, /import \{[\s\S]*?humanizeImprovementPracticeStatus,[\s\S]*?\} from "\.\/improvementPlanLogic\.js";/);
  assert.match(viewSource, /humanizeImprovementPracticeStatus\("recommended"\)/);
  assert.match(viewSource, /humanizeImprovementPracticeCadence\(practice\.cadence\)/);
});

test("improvementPlanLogic.js defines exactly the approved status/cadence vocabularies", () => {
  assert.match(logicSource, /recommended: "Recommended"/);
  assert.match(logicSource, /active: "Active"/);
  assert.match(logicSource, /paused: "Paused"/);
  assert.match(logicSource, /completed: "Completed"/);
  for (const cadence of ["one_time", "every_session", "weekly", "monthly", "quarterly", "annually", "ongoing"]) {
    assert.match(logicSource, new RegExp(`${cadence}: "`));
  }
});

test("Gap Detail's Add to Plan is wired, but only for the gap category (the only one with a gap_log_item_id)", () => {
  assert.match(
    gapDetailSource,
    /const canAddToPlan = category === "gap" && Boolean\(gap\.gapLogItemId\) && typeof onAddToPlan === "function";/,
  );
  assert.match(gapDetailSource, /onClick=\{\(\) => onAddToPlan\(gap\.gapLogItemId\)\}/);
});

test("ImpactEvidenceLibrary wires Add to Plan through the real, authorized Improvement Practice create path - no simulated success", () => {
  assert.match(libraryAppSource, /onAddImprovementPractice,\s*\n\} = \{\}\) \{/);
  assert.match(libraryAppSource, /const handleAddToPlan = useCallback\(async \(gapLogItemId\) => \{/);
  assert.match(libraryAppSource, /if \(result\?\.ok\) \{\s*setAddedImprovementPracticeGapId\(gapLogItemId\);/);
  assert.match(libraryAppSource, /onAddToPlan=\{typeof onAddImprovementPractice === "function" \? handleAddToPlan : undefined\}/);
});

test("ImpactLibraryApp passes the real createImprovementPractice callback into ImpactEvidenceLibrary's Add to Plan wiring", () => {
  assert.match(appSource, /onAddImprovementPractice=\{createImprovementPractice\}/);
});
