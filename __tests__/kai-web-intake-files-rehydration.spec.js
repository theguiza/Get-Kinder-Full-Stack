// Files persistence/rehydration: ImpactEvidenceLibrary and
// ClientKnowledgeStudio mount KaiWebIntake only while the Files tab is
// active, and KaiWebIntake previously began every mount with no batch
// identity, never read the persisted batch list on its own, and refused to
// read batch files without a selected batch - so persisted files appeared to
// disappear after any tab round-trip or refresh. The reconstruction
// decisions now live in kaiWebIntakeLogic.js (exercised behaviorally below
// against a fake server) and KaiWebIntake/its parents wire them into the
// mount lifecycle (source-contract style, matching this repo's convention
// for these components - no jsdom render harness exists for this tree).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INTAKE_READ_STATUS,
  batchFilesPath,
  batchesPath,
  engagementScopedBatches,
  readEngagementIntakeBatches,
  readIntakeBatchFiles,
  resolveIntakeBatchSelection,
} from "../frontend/kaiWebIntakeLogic.js";

const webIntakeSource = readFileSync("frontend/KaiWebIntake.jsx", "utf8");
const libSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");
const clientStudioSource = readFileSync("frontend/knowledgeStudio/ClientKnowledgeStudio.jsx", "utf8");
const dashboardSource = readFileSync("frontend/adminDashboard.jsx", "utf8");

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ORG = "00000000-0000-4000-8000-0000000000a2";
const PROJECT_A = "00000000-0000-4000-8000-0000000000e1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000e2";
const BATCH_A = "00000000-0000-4000-8000-0000000000b1";
const BATCH_A2 = "00000000-0000-4000-8000-0000000000b3";
const BATCH_B = "00000000-0000-4000-8000-0000000000b2";

function batch(intakeBatchId, engagementId, extra = {}) {
  return {
    intake_batch_id: intakeBatchId,
    organization_id: ORG,
    engagement_id: engagementId,
    batch_code: `code-${intakeBatchId.slice(-2)}`,
    processing_status: "received",
    review_status: "not_reviewed",
    created_at: "2026-09-20T10:00:00.000Z",
    updated_at: "2026-09-20T10:00:00.000Z",
    ...extra,
  };
}

function file(intakeFileId, intakeBatchId) {
  return { intake_file_id: intakeFileId, intake_batch_id: intakeBatchId, safe_filename: `${intakeFileId}.csv` };
}

// A deterministic stand-in for the two existing server reads. Every request
// path is recorded so a test can prove which routes were (and were not) hit.
function fakeServer({ batches = [], filesByBatch = {}, failBatches = false, failFilesFor = [] } = {}) {
  const calls = [];
  async function getJsonFn(path) {
    calls.push(path);
    if (path === batchesPath(ORG)) {
      if (failBatches) return { statusCode: 503, body: { ok: false, error: { message: "Batches unavailable." } } };
      return { statusCode: 200, body: { ok: true, data: { organization_id: ORG, batches } } };
    }
    for (const [intakeBatchId, items] of Object.entries(filesByBatch)) {
      if (path === batchFilesPath(ORG, intakeBatchId)) {
        if (failFilesFor.includes(intakeBatchId)) {
          return { statusCode: 500, body: { ok: false, error: { message: "Files unavailable." } } };
        }
        return { statusCode: 200, body: { ok: true, data: { items } } };
      }
    }
    return { statusCode: 404, body: { ok: false, error: { message: "Not found." } } };
  }
  return { getJsonFn, calls };
}

// Mirrors the KaiWebIntake mount lifecycle in the order its effects run:
// bootstrap the batch list (with whatever the parent retained), then - only
// if a validated batch was established - read that batch's files.
async function mountFiles(server, { engagementId, retainedIntakeBatchId = "" }) {
  const batchesOutcome = await readEngagementIntakeBatches(
    { organizationId: ORG, engagementId, retainedIntakeBatchId },
    server.getJsonFn,
  );
  const filesOutcome = batchesOutcome.intakeBatchId
    ? await readIntakeBatchFiles({ organizationId: ORG, intakeBatchId: batchesOutcome.intakeBatchId }, server.getJsonFn)
    : null;
  return { batchesOutcome, filesOutcome };
}

test("Case 1: a single persisted batch for the active Project is read, selected, and its files read automatically", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_A, PROJECT_A)],
    filesByBatch: { [BATCH_A]: [file("f1", BATCH_A), file("f2", BATCH_A)] },
  });
  const { batchesOutcome, filesOutcome } = await mountFiles(server, { engagementId: PROJECT_A });

  assert.equal(batchesOutcome.status, INTAKE_READ_STATUS.SUCCESS_WITH_DATA);
  assert.equal(batchesOutcome.intakeBatchId, BATCH_A);
  assert.equal(batchesOutcome.requiresChoice, false);
  assert.equal(filesOutcome.status, INTAKE_READ_STATUS.SUCCESS_WITH_DATA);
  assert.deepEqual(filesOutcome.items.map((item) => item.intake_file_id), ["f1", "f2"]);
  assert.deepEqual(server.calls, [batchesPath(ORG), batchFilesPath(ORG, BATCH_A)]);
});

test("Case 2: Files -> another tab -> Files restores the same retained batch for the same Project and re-reads its files", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_A, PROJECT_A), batch(BATCH_A2, PROJECT_A)],
    filesByBatch: { [BATCH_A]: [file("f1", BATCH_A)], [BATCH_A2]: [file("f9", BATCH_A2)] },
  });
  // First visit: two batches, so the user explicitly chooses BATCH_A2 and the
  // parent retains it (what onIntakeBatchIdChange records).
  const first = await mountFiles(server, { engagementId: PROJECT_A });
  assert.equal(first.batchesOutcome.intakeBatchId, "");
  const parentRetained = BATCH_A2;

  // Return to Files: a fresh KaiWebIntake mount receives the retained id.
  server.calls.length = 0;
  const second = await mountFiles(server, { engagementId: PROJECT_A, retainedIntakeBatchId: parentRetained });
  assert.equal(second.batchesOutcome.intakeBatchId, BATCH_A2);
  assert.equal(second.batchesOutcome.retainedStale, false);
  assert.deepEqual(second.filesOutcome.items.map((item) => item.intake_file_id), ["f9"]);
  assert.deepEqual(server.calls, [batchesPath(ORG), batchFilesPath(ORG, BATCH_A2)]);
});

test("Case 2 (wiring): the retained batch lives in each parent outside the tab-gated mount, is passed to KaiWebIntake, and is cleared on organization/Project change", () => {
  for (const source of [libSource, clientStudioSource]) {
    assert.match(source, /const \[filesIntakeBatchId, setFilesIntakeBatchId\] = useState\(""\);/);
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*\n\s*setFilesIntakeBatchId\(""\);\s*\n\s*\}, \[organizationId, engagementId\]\);/,
    );
    assert.match(
      source,
      /intakeBatchId=\{filesIntakeBatchId\}\s*\n\s*onIntakeBatchIdChange=\{setFilesIntakeBatchId\}\s*\n\s*embedded/,
    );
  }
  // The retained state is declared before (outside) the Files-tab conditional mount.
  assert.ok(libSource.indexOf("const [filesIntakeBatchId") < libSource.indexOf('knowledgeStudioTab === "files" && organizationId ? ('));
  assert.ok(clientStudioSource.indexOf("const [filesIntakeBatchId") < clientStudioSource.indexOf('tab === "files" && organizationId ? ('));
  // Every validated selection flows back to the parent: bootstrap results
  // and explicit chooser selections alike.
  assert.match(webIntakeSource, /reportIntakeBatchSelection\(outcome\.intakeBatchId\);/);
  assert.match(
    webIntakeSource,
    /setIntakeBatchId\(item\.intake_batch_id\);\s*\n\s*reportIntakeBatchSelection\(item\.intake_batch_id\);/,
  );
});

test("Case 3: a fresh mount (full-refresh equivalent) reconstructs purely from server reads, and the mount effect bootstraps without any manual button", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_A, PROJECT_A)],
    filesByBatch: { [BATCH_A]: [file("f1", BATCH_A)] },
  });
  // No retained id: nothing survives from a previous page instance.
  const { batchesOutcome, filesOutcome } = await mountFiles(server, { engagementId: PROJECT_A, retainedIntakeBatchId: "" });
  assert.equal(batchesOutcome.intakeBatchId, BATCH_A);
  assert.equal(filesOutcome.items.length, 1);

  // Mount wiring: the bootstrap effect runs on mount for a parent-owned
  // engagement, the file read follows any validated selection, and no
  // browser-only cache participates.
  assert.match(webIntakeSource, /const engagementScoped = Boolean\(parentEngagementId\);/);
  assert.match(
    webIntakeSource,
    /if \(!engagementScoped \|\| !organizationId\) return undefined;\s*\n\s*bootstrapEngagementBatches\(retainedIntakeBatchIdRef\.current\);/,
  );
  assert.match(webIntakeSource, /\}, \[engagementScoped, organizationId, bootstrapEngagementBatches\]\);/);
  assert.match(
    webIntakeSource,
    /if \(!engagementScoped \|\| !organizationId \|\| !intakeBatchId\) return undefined;[\s\S]{0,200}readIntakeBatchFiles\(\{ organizationId, intakeBatchId \}\)/,
  );
  assert.match(webIntakeSource, /\}, \[engagementScoped, organizationId, intakeBatchId\]\);/);
  assert.doesNotMatch(webIntakeSource, /localStorage|sessionStorage|indexedDB/);
});

test("Case 4: Project isolation - only the active Project's batch is selectable/restorable, and switching Projects reconstructs independently", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_B, PROJECT_B), batch(BATCH_A, PROJECT_A)],
    filesByBatch: { [BATCH_A]: [file("fa", BATCH_A)], [BATCH_B]: [file("fb", BATCH_B)] },
  });

  const onA = await mountFiles(server, { engagementId: PROJECT_A });
  assert.deepEqual(onA.batchesOutcome.batches.map((item) => item.intake_batch_id), [BATCH_A]);
  assert.equal(onA.batchesOutcome.intakeBatchId, BATCH_A);
  assert.deepEqual(onA.filesOutcome.items.map((item) => item.intake_file_id), ["fa"]);
  assert.ok(!server.calls.includes(batchFilesPath(ORG, BATCH_B)));

  // Switch to Project B while A's id is still the retained hint (the child
  // bootstraps before the parent's clearing effect runs): A is rejected.
  server.calls.length = 0;
  const onB = await mountFiles(server, { engagementId: PROJECT_B, retainedIntakeBatchId: BATCH_A });
  assert.deepEqual(onB.batchesOutcome.batches.map((item) => item.intake_batch_id), [BATCH_B]);
  assert.equal(onB.batchesOutcome.intakeBatchId, BATCH_B);
  assert.equal(onB.batchesOutcome.retainedStale, true);
  assert.deepEqual(onB.filesOutcome.items.map((item) => item.intake_file_id), ["fb"]);
  assert.ok(!server.calls.includes(batchFilesPath(ORG, BATCH_A)));

  // Scope is the persisted organization_id + engagement_id only.
  assert.deepEqual(
    engagementScopedBatches(
      [batch(BATCH_A, PROJECT_A, { organization_id: OTHER_ORG }), batch(BATCH_B, null), { engagement_id: PROJECT_A }],
      ORG,
      PROJECT_A,
    ),
    [],
  );
  assert.deepEqual(engagementScopedBatches([batch(BATCH_A, PROJECT_A)], ORG, ""), []);
});

test("Case 4 (wiring): a parent-owned Project change clears the previous Project's batch/file/selection state before the new bootstrap", () => {
  const resetStart = webIntakeSource.indexOf("A parent-owned engagement change invalidates");
  const resetEnd = webIntakeSource.indexOf("}, [parentEngagementId]);", resetStart);
  assert.ok(resetStart > -1 && resetEnd > resetStart, "engagement-change reset effect not found");
  const reset = webIntakeSource.slice(resetStart, resetEnd);
  for (const clear of [
    "batchBootstrapTokenRef.current += 1;",
    "setBatches([]);",
    'setIntakeBatchId("");',
    "setBatchFiles([]);",
    'setIntakeFileId("");',
    "setFileStatus(null);",
    "reportSensitivityProfileDiscovered(null);",
  ]) {
    assert.ok(reset.includes(clear), `engagement-change reset must include ${clear}`);
  }
  // Declared (and therefore run) before the bootstrap effect.
  assert.ok(resetEnd < webIntakeSource.indexOf("bootstrapEngagementBatches(retainedIntakeBatchIdRef.current);"));
  // A late response for a superseded context is discarded.
  assert.match(webIntakeSource, /if \(token !== batchBootstrapTokenRef\.current\) return;/);
});

test("Case 5: several batches for the active Project are never chosen arbitrarily; files load only after an explicit choice", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_A2, PROJECT_A, { created_at: "2026-09-21T00:00:00.000Z" }), batch(BATCH_A, PROJECT_A)],
    filesByBatch: { [BATCH_A]: [file("f1", BATCH_A)], [BATCH_A2]: [file("f2", BATCH_A2)] },
  });
  const { batchesOutcome, filesOutcome } = await mountFiles(server, { engagementId: PROJECT_A });
  assert.equal(batchesOutcome.intakeBatchId, "");
  assert.equal(batchesOutcome.requiresChoice, true);
  assert.equal(batchesOutcome.batches.length, 2);
  assert.equal(filesOutcome, null);
  assert.deepEqual(server.calls, [batchesPath(ORG)]);

  // The user explicitly selects BATCH_A (the chooser's Select button sets
  // intakeBatchId, which the file effect then reads automatically).
  const chosen = await readIntakeBatchFiles({ organizationId: ORG, intakeBatchId: BATCH_A }, server.getJsonFn);
  assert.deepEqual(chosen.items.map((item) => item.intake_file_id), ["f1"]);
  assert.match(webIntakeSource, /This project has more than one batch\. Select a batch to view its files\./);
});

test("Case 6: zero-data is shown only after a successful read establishes no matching batch", async () => {
  const server = fakeServer({ batches: [batch(BATCH_B, PROJECT_B)] });
  const { batchesOutcome, filesOutcome } = await mountFiles(server, { engagementId: PROJECT_A });
  assert.equal(batchesOutcome.status, INTAKE_READ_STATUS.SUCCESS_EMPTY);
  assert.equal(batchesOutcome.intakeBatchId, "");
  assert.equal(filesOutcome, null);

  const emptyFiles = await readIntakeBatchFiles(
    { organizationId: ORG, intakeBatchId: BATCH_A },
    fakeServer({ filesByBatch: { [BATCH_A]: [] } }).getJsonFn,
  );
  assert.equal(emptyFiles.status, INTAKE_READ_STATUS.SUCCESS_EMPTY);

  // The empty copy is gated on the successful-empty status, not on an
  // initial empty array.
  assert.match(
    webIntakeSource,
    /engagementScoped && batchesRequest\.status === INTAKE_READ_STATUS\.SUCCESS_EMPTY \? \(\s*\n\s*<div className="small text-muted mt-2">No intake batches exist for this project yet\.<\/div>/,
  );
  assert.match(
    webIntakeSource,
    /batchFilesRequest\.status === INTAKE_READ_STATUS\.SUCCESS_EMPTY \? \(\s*\n\s*<div className="text-muted small">This batch has no files yet\.<\/div>/,
  );
  assert.match(webIntakeSource, /useState\(\{ status: INTAKE_READ_STATUS\.NOT_STARTED, error: "" \}\)/);
});

test("Case 7: a failed batch-list or batch-file read is an error state, never 'no data', and selects nothing", async () => {
  const failedBatches = await mountFiles(fakeServer({ failBatches: true }), {
    engagementId: PROJECT_A,
    retainedIntakeBatchId: BATCH_A,
  });
  assert.equal(failedBatches.batchesOutcome.status, INTAKE_READ_STATUS.ERROR);
  assert.equal(failedBatches.batchesOutcome.error, "Batches unavailable.");
  assert.equal(failedBatches.batchesOutcome.intakeBatchId, "");
  assert.equal(failedBatches.filesOutcome, null);

  const server = fakeServer({ batches: [batch(BATCH_A, PROJECT_A)], filesByBatch: { [BATCH_A]: [] }, failFilesFor: [BATCH_A] });
  const failedFiles = await mountFiles(server, { engagementId: PROJECT_A });
  assert.equal(failedFiles.filesOutcome.status, INTAKE_READ_STATUS.ERROR);
  assert.equal(failedFiles.filesOutcome.error, "Files unavailable.");

  assert.match(webIntakeSource, /engagementScoped && batchesRequest\.status === INTAKE_READ_STATUS\.ERROR \? \(/);
  assert.match(webIntakeSource, /batchFilesRequest\.status === INTAKE_READ_STATUS\.ERROR \? \(/);
  // A failed bootstrap returns before any selection is established.
  assert.match(webIntakeSource, /if \(outcome\.status === INTAKE_READ_STATUS\.ERROR\) \{[\s\S]{0,400}?return;\s*\n\s*\}/);
});

test("Case 8: a stale retained batch is cleared, its file route is never called, and no other Project's data is exposed", async () => {
  const server = fakeServer({
    batches: [batch(BATCH_B, PROJECT_B), batch(BATCH_A, PROJECT_A), batch(BATCH_A2, PROJECT_A)],
    filesByBatch: { [BATCH_B]: [file("fb", BATCH_B)] },
  });
  const { batchesOutcome, filesOutcome } = await mountFiles(server, { engagementId: PROJECT_A, retainedIntakeBatchId: BATCH_B });
  assert.equal(batchesOutcome.retainedStale, true);
  assert.equal(batchesOutcome.intakeBatchId, "");
  assert.ok(!batchesOutcome.batches.some((item) => item.intake_batch_id === BATCH_B));
  assert.equal(filesOutcome, null);
  assert.ok(!server.calls.includes(batchFilesPath(ORG, BATCH_B)));

  // A deleted/unknown retained id resolves the same way.
  assert.deepEqual(resolveIntakeBatchSelection([], "00000000-0000-4000-8000-00000000dead"), {
    intakeBatchId: "",
    retainedStale: true,
    requiresChoice: false,
  });
  // The resolved (cleared) selection is always reported back to the parent.
  assert.match(webIntakeSource, /reportIntakeBatchSelection\(outcome\.intakeBatchId\);/);
});

test("Case 9: standalone KaiWebIntake keeps its existing manual contract", () => {
  assert.match(dashboardSource, /<KaiWebIntake \/>/);
  // No parent engagement -> not engagement-scoped: no automatic bootstrap,
  // no automatic file read, no selection reporting.
  assert.match(webIntakeSource, /intakeBatchId: retainedIntakeBatchId = "",/);
  assert.match(webIntakeSource, /const reportIntakeBatchSelection = useCallback\(\(value\) => \{\s*\n\s*if \(!engagementScoped\) return;/);
  // The standalone "Load existing batches" path is still the unfiltered,
  // organization-wide loadBatches read.
  assert.match(webIntakeSource, /onClick=\{engagementScoped \? \(\) => bootstrapEngagementBatches\(intakeBatchId\) : loadBatches\}/);
  assert.match(webIntakeSource, /const result = await getJson\(batchesPath\(organizationId\)\);\s*\n\s*setBusy\(false\);/);
  // The standalone batch-resume path still adopts the batch's engagement.
  assert.match(webIntakeSource, /if \(!parentEngagementId\) \{\s*\n\s*updateEngagementId\(item\.engagement_id \|\| ""\);\s*\n\s*\}/);
  // The manual file Load control remains available as an explicit refresh.
  assert.match(webIntakeSource, /onClick=\{loadBatchFiles\} disabled=\{busy \|\| !intakeBatchId\}>Load<\/button>/);
});

test("Project switch A: an authoritative engagementId change clears a profile discovered from the previous Project's file, and its dependent detail state resets", () => {
  const start = libSource.indexOf("const intakeDerivedSensitivityProfileIdRef = useRef(\"\");");
  assert.ok(start > -1, "intake-derived profile ref not found");
  const end = libSource.indexOf("}, [engagementId]);", start);
  assert.ok(end > start && end - start < 600, "Project-change reset effect must be keyed on engagementId");
  const reset = libSource.slice(start, end);
  // Only the still-selected file-derived id is cleared; the ref is consumed
  // so the reset applies to the Project it was discovered in.
  assert.match(reset, /intakeDerivedSensitivityProfileIdRef\.current = "";/);
  assert.match(
    reset,
    /setSelectedSensitivityProfileId\(\(current\) => \(current === intakeDerivedProfileId \? "" : current\)\);/,
  );
  // Organization-wide review data is not touched by a Project change.
  assert.doesNotMatch(reset, /setSensitivityReviewQueueItems|setSensitivityCapability|setReviewQueueItems/);

  // The intake handler records which id it set.
  const handlerStart = libSource.indexOf("const handleSensitivityProfileDiscoveredFromIntake");
  const handler = libSource.slice(handlerStart, handlerStart + 400);
  assert.match(
    handler,
    /intakeDerivedSensitivityProfileIdRef\.current = intakeSensitivityProfileId;\s*\n\s*setSelectedSensitivityProfileId\(intakeSensitivityProfileId\);/,
  );

  // Clearing the id drives the existing selected-profile-dependent resets:
  // detail/error/action result on id change, and the seeded form on null detail.
  assert.match(
    libSource,
    /useEffect\(\(\) => \{\s*\n\s*setSensitivityDetail\(null\);\s*\n\s*setSensitivityError\(""\);\s*\n\s*setSensitivityActionResult\(""\);\s*\n\s*if \(sensitivityCapability === true && intakeSensitivityProfileId\) \{\s*\n\s*loadSensitivityDetail\(\);\s*\n\s*\}\s*\n\s*\}, \[sensitivityCapability, intakeSensitivityProfileId, loadSensitivityDetail\]\);/,
  );
  assert.match(
    libSource,
    /const current = sensitivityDetail\?\.currentDecision;\s*\n\s*if \(!current\) \{\s*\n\s*setSensitivityFormState\(defaultSensitivityReviewFormState\(\)\);/,
  );
  // With no selected id the review card is not rendered, so no prior
  // Project's profile detail can be shown.
  assert.match(libSource, /\{knowledgeStudioTab === "processing" && intakeSensitivityProfileId && sensitivityCapability === true \? \(/);

  // Behavior of the reset's update rule: a file-derived id from Project A is
  // cleared; a different (queue/traceability) selection is kept.
  const PROFILE_A = "00000000-0000-4000-8000-0000000000c1";
  const QUEUE_PROFILE = "00000000-0000-4000-8000-0000000000c2";
  const update = (intakeDerivedProfileId) => (current) => (current === intakeDerivedProfileId ? "" : current);
  assert.equal(update(PROFILE_A)(PROFILE_A), "");
  assert.equal(update(PROFILE_A)(QUEUE_PROFILE), QUEUE_PROFILE);
});

test("Project switch B: a same-Project null report from KaiWebIntake still never clears the selected profile", () => {
  const handlerStart = libSource.indexOf("const handleSensitivityProfileDiscoveredFromIntake");
  const handler = libSource.slice(handlerStart, libSource.indexOf("}, []);", handlerStart));
  assert.match(handler, /if \(isRouteUuid\(intakeSensitivityProfileId\)\) \{/);
  assert.doesNotMatch(handler, /setSelectedSensitivityProfileId\(""\)/);
  assert.doesNotMatch(handler, /else/);
  // KaiWebIntake's same-Project file interactions still report null through
  // the seam (e.g. selecting another file), which the handler ignores.
  assert.match(webIntakeSource, /setIntakeFileId\(item\.intake_file_id\);\s*\n\s*setFileStatus\(null\);\s*\n\s*setMessage\(""\);\s*\n\s*reportSensitivityProfileDiscovered\(null\);/);
});
