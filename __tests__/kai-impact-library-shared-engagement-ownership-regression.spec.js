// Board Reporting production regression repair (post Package C0): Package
// C0 (commit 19da350) lifted organization/engagement selection out of
// ImpactEvidenceLibrary/KaiWebIntake into one shared, parent-owned
// Project/Engagement context (frontend/ImpactLibraryApp.jsx), passing the
// shared engagementId + onEngagementIdChange down into KaiWebIntake. That
// same commit changed KaiWebIntake's "resume an existing batch" Select
// button from `setEngagementId(...)` (purely local) to
// `updateEngagementId(...)`, which - once a parent owns the engagement -
// routes straight to the parent's onEngagementIdChange. Since
// loadBatches() fetches ALL of an organization's batches (not scoped to
// the active engagement), clicking Select on a batch belonging to a
// different Project silently swapped the whole application's shared
// engagement out from under the user, which is what desynchronized Board
// Reporting (still keyed by organizationId + engagementId) from the rest
// of the redesigned app and produced the observed
// conflict_current_state_changed 409. Source-contract style, matching
// this repo's established convention for these components (see
// kai-impact-library-project-context.spec.js) - no jsdom render harness
// exists for this tree.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
const webIntakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("1: parent engagement is authoritative - Board Reporting's packet fetch is built from the same organizationId/engagementId ImpactEvidenceLibrary passes into KaiWebIntake, never a KaiWebIntake-local value", () => {
  // Board Reporting's request is built from ImpactEvidenceLibrary's own
  // organizationId/engagementId (the parent-fallback pair), not from
  // anything KaiWebIntake owns.
  assert.match(libSource, /getJson\(boardReportingPacketPath\(organizationId, engagementId\)\)/);
  // KaiWebIntake receives that exact same pair as controlled props.
  assert.match(
    libSource,
    /<KaiWebIntake\s*\n\s*organizationId=\{organizationId\}\s*\n\s*engagementId=\{engagementId\}\s*\n\s*onEngagementIdChange=\{updateEngagementId\}/,
  );
});

test("2: child bootstrap cannot replace the Project - KaiWebIntake's own engagement fetch/auto-select is skipped entirely once a parent supplies the engagement", () => {
  assert.match(
    webIntakeSource,
    /const loadEngagements = useCallback\(async \(orgId\) => \{\s*\n(?:[^\n]*\n){0,6}?\s*if \(parentEngagementId\) \{\s*\n\s*setEngagements\(\[\]\);\s*\n\s*setEngagementsLoaded\(true\);\s*\n\s*return;\s*\n\s*\}/,
  );
});

test("2b: resuming an existing batch (an internal intake action, not a Project selection) no longer overwrites the parent-controlled engagement - the regression's actual write path", () => {
  // Before the repair this unconditionally called
  // updateEngagementId(item.engagement_id || ""), which - once a parent
  // owns the engagement - forwards straight to onEngagementIdChange and
  // silently swaps the shared Project out from under the user for any
  // batch in this organization-wide list, regardless of which engagement
  // it actually belongs to.
  assert.doesNotMatch(
    webIntakeSource,
    /onClick=\{\(\) => \{\s*\n\s*updateEngagementId\(item\.engagement_id \|\| ""\);/,
  );
  // The write is now gated: only a standalone (no parent context) mount
  // ever routes a batch-resume selection into the engagement id.
  assert.match(
    webIntakeSource,
    /onClick=\{\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(!parentEngagementId\) \{\s*\n\s*updateEngagementId\(item\.engagement_id \|\| ""\);\s*\n\s*\}\s*\n\s*setIntakeBatchId\(item\.intake_batch_id\);/,
  );
});

test("3: explicit user Project change - the one real Project selector (ProjectContextBar, since KaiWebIntake's own picker is hidden whenever a parent supplies the engagement) still calls the shared setter exactly once and every dependent surface reads the same state", () => {
  // KaiWebIntake owns no reachable Project selector once a parent is
  // present - its own dropdown is unconditionally hidden.
  assert.match(webIntakeSource, /\{parentEngagementId \? null : \(/);
  // The application-wide selector lives in ProjectContextBar and calls the
  // parent's setter exactly once per explicit user change.
  assert.match(shellSource, /onChange=\{\(event\) => onSelectEngagement\?\.\(event\.target\.value\)\}/);
  assert.match(
    appSource,
    /<ProjectContextBar\s*\n\s*engagements=\{engagements\}\s*\n\s*engagementsLoaded=\{engagementsLoaded\}\s*\n\s*selectedEngagementId=\{selectedEngagementId\}\s*\n\s*onSelectEngagement=\{setSelectedEngagementId\}/,
  );
  // The same selectedEngagementId flows into every dependent surface this
  // package wires up - Knowledge Studio (and, through it, Board
  // Reporting/KaiWebIntake) and Improvement Plan - so one explicit change
  // updates every one of them from the same authoritative value.
  assert.match(appSource, /engagementId=\{selectedEngagementId\}\s*\n\s*onEngagementIdChange=\{setSelectedEngagementId\}/);
  assert.match(appSource, /selectedEngagementId=\{selectedEngagementId\}\s*\n\s*onCreatePractice=\{createImprovementPractice\}/);
});

test("4: Board Reporting never reads a stale/diverged KaiWebIntake-local engagement id - the packet fetch effect only depends on organizationId/engagementId, and KaiWebIntake's own localEngagementId is unreachable from it", () => {
  const effectIndex = libSource.indexOf("const [boardReportingPacket, setBoardReportingPacket] = useState(null);");
  assert.ok(effectIndex > -1, "Board Reporting packet state not found");
  const fetchIndex = libSource.indexOf("boardReportingPacketPath(organizationId, engagementId)", effectIndex);
  assert.ok(fetchIndex > -1, "Board Reporting packet fetch call not found after its state declarations");
  const dependencyArrayIndex = libSource.indexOf("}, [organizationId, engagementId]);", fetchIndex);
  assert.ok(
    dependencyArrayIndex > -1 && dependencyArrayIndex - fetchIndex < 4000,
    "Board Reporting packet fetch effect must be keyed only on organizationId/engagementId",
  );
  // ImpactEvidenceLibrary's own localEngagementId is only its standalone
  // (no-parent) fallback - it never reads KaiWebIntake's internal engagement
  // state. The only channel back out of KaiWebIntake is the guarded
  // onEngagementIdChange callback (updateEngagementId), and that callback
  // writes to ImpactEvidenceLibrary's shared engagementId exactly the same
  // way an explicit ProjectContextBar/Projects-view selection would.
  assert.match(libSource, /const updateEngagementId = useCallback\(\(value\) => \{\s*\n\s*if \(parentEngagementId !== undefined\) \{\s*\n\s*if \(typeof onEngagementIdChange === "function"\) onEngagementIdChange\(value\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*setLocalEngagementId\(value\);/);
});
