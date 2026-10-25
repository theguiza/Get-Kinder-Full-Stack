import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { serializeInternalReportToMarkdown } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";

/**
 * Focused checks of the paste-ready browser-console canary
 * (scripts/kai-production-browser-console-canary.js) without a browser or a
 * database: it is plain browser JavaScript, it can only send GET requests,
 * its fixture has the Plan A counts, and its report and draft validation
 * accept the deployed format and refuse unsupported findings. The assembled
 * browser acceptance runs the same file against the real local app.
 */
const SOURCE = await readFile(new URL("../scripts/kai-production-browser-console-canary.js", import.meta.url), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const ENG = "22222222-2222-4222-8222-222222222222";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

// Loads the canary as a console paste would, with a fetch that answers from
// `routes` and records every request.
function loadCanary(routes = {}) {
  const requests = [];
  const silent = { log() {}, warn() {}, error() {}, table() {} };
  const fetch = async (path, init = {}) => {
    requests.push({ path, method: init.method });
    const route = Object.entries(routes).find(([suffix]) => path.split("?")[0].endsWith(suffix));
    const [status, body] = route ? route[1] : [404, { ok: false, error: { code: "not_found" } }];
    return {
      status,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  const context = {
    console: silent,
    TextEncoder,
    URL,
    setTimeout,
    fetch,
    localStorage: memoryStorage(),
    location: { origin: "https://app.example.test", pathname: "/impact-library", protocol: "https:", hostname: "app.example.test" },
  };
  vm.runInNewContext(SOURCE, context);
  return { canary: context.KAI_CANARY, requests, context };
}
// Values made inside the vm context carry its own prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));

const CUSTOMER_CAPABILITIES = {
  intakeContribution: true,
  workflowOperations: {
    reviewSensitivity: true, promoteSource: true, recordSourceMeasurement: true, proposeClaim: true, generateDrafts: true,
    readInternalDrafts: true, reviewInternalDraftFactualContent: true, releaseInternalReports: true, readReleasedInternalReports: true,
  },
};
const signedInRoutes = (capabilities = CUSTOMER_CAPABILITIES) => ({
  "/admin/organizations": [200, { ok: true, data: { items: [{ organization_id: ORG }] } }],
  "/access-capabilities": [200, { ok: true, data: capabilities }],
  "/engagements": [200, { ok: true, data: { items: [{ engagement_id: ENG, engagement_code: "SYNTH" }] } }],
  "/client-internal-drafts": [200, { ok: true, data: { items: [], nextCursor: null } }],
});

test("the canary is plain browser JavaScript with no module, Node, or non-GET request surface", () => {
  assert.doesNotMatch(SOURCE, /\bimport\s|\brequire\(|\bprocess\.|\bBuffer\b|node:/);
  assert.doesNotMatch(SOURCE, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/i);
  assert.doesNotMatch(SOURCE, /\.click\(\)[^;]*(approve|release|submit|promote|generate)/i, "no approval or release is clicked");
  assert.match(SOURCE, /^\/\* KAI production browser-console canary/);
});

test("pasting initializes window.KAI_CANARY and runs a GET-only preflight against the signed-in session", async () => {
  const { canary, requests } = loadCanary(signedInRoutes());
  for (const name of ["preflight", "makeFixture", "start", "next", "status", "report", "resume"]) assert.equal(typeof canary[name], "function", name);
  const result = await canary.preflight({ organizationId: ORG, engagementId: ENG });
  const byCheck = Object.fromEntries(result.checks.map((check) => [check.Check, check.Status]));
  assert.equal(byCheck["Customer workspace & capabilities"], "PASS");
  assert.equal(byCheck["Origin class"], "PASS");
  assert.ok(requests.length > 0 && requests.every((request) => request.method === "GET"), JSON.stringify(requests));
  assert.ok(requests.every((request) => request.path.startsWith("/api/kai/sprint2/intake/")));
});

test("a signed-out session and a missing capability are reported, not bypassed", async () => {
  const signedOut = loadCanary({ "/admin/organizations": [401, { ok: false, error: { code: "authentication_required" } }] });
  const out = await signedOut.canary.preflight({ organizationId: ORG, engagementId: ENG });
  assert.equal(out.checks.find((check) => check.Check === "Signed-in session").Status, "BLOCKED");
  const noDrafts = loadCanary(signedInRoutes({ ...CUSTOMER_CAPABILITIES, workflowOperations: { ...CUSTOMER_CAPABILITIES.workflowOperations, readInternalDrafts: false } }));
  const blocked = await noDrafts.canary.preflight({ organizationId: ORG, engagementId: ENG });
  const workspace = blocked.checks.find((check) => check.Check === "Customer workspace & capabilities");
  assert.equal(workspace.Status, "BLOCKED");
  assert.match(workspace.Observed, /readInternalDrafts/);
  // Owner decision 2026-10-25: no review or release capability is required.
  const noRelease = loadCanary(signedInRoutes({ ...CUSTOMER_CAPABILITIES, workflowOperations: {
    ...CUSTOMER_CAPABILITIES.workflowOperations, reviewInternalDraftFactualContent: false, releaseInternalReports: false, readReleasedInternalReports: false } }));
  const passed = await noRelease.canary.preflight({ organizationId: ORG, engagementId: ENG });
  assert.equal(passed.checks.find((check) => check.Check === "Customer workspace & capabilities").Status, "PASS");
});

test("start requires the owner's exact phrase and writes nothing to the server", async () => {
  const { canary, requests, context } = loadCanary(signedInRoutes());
  await assert.rejects(canary.start({ organizationId: ORG, engagementId: ENG }), /explicit authorization/);
  await assert.rejects(canary.start({ organizationId: ORG, engagementId: ENG, confirm: "yes" }), /explicit authorization/);
  assert.equal(context.localStorage.getItem("kai.productionConsoleCanary.v1"), null);
  const started = await canary.start({ organizationId: ORG, engagementId: ENG, confirm: canary.confirmPhrase });
  assert.equal(started.stages.workspace, "PASS");
  assert.equal(started.stages.fixture, "WAITING_FOR_HUMAN", "the fixture is produced only by makeFixture/attachFixture");
  assert.ok(requests.every((request) => request.method === "GET"));
  await assert.rejects(canary.start({ organizationId: ORG, engagementId: ENG, confirm: canary.confirmPhrase }), /already exists/);
  const saved = JSON.parse(context.localStorage.getItem("kai.productionConsoleCanary.v1"));
  assert.doesNotMatch(JSON.stringify(saved), /cookie|token|password|signed|session_date|literacy/i, "only correlation state is stored");
});

test("the synthetic fixture has six data rows, one blank, two exact duplicates, and five counted records", () => {
  const { canary } = loadCanary();
  const text = canary._test.fixtureText("kc202610231200abcdef");
  assert.deepEqual(plain(canary._test.countFixture(text)), { dataRecords: 6, blankRecords: 1, duplicateRecords: 2, counted: 5 });
  assert.equal(text.split("\n")[0], "session_date,programme,attendees,canary_run");
  assert.equal(canary._test.fixtureFilename("kc202610231200abcdef"), "kai_canary_kc202610231200abcdef.csv");
  assert.throws(() => canary._test.fixtureText("../x"), /invalid_canary_tag/);
});

test("report validation accepts the internal report Markdown contract and rejects raw rows and unsupported findings", () => {
  const { canary } = loadCanary();
  const ids = { claimId: "33333333-3333-4333-8333-333333333333", evidenceItemId: "44444444-4444-4444-8444-444444444444", sourceVersionId: "55555555-5555-4555-8555-555555555555" };
  const state = { organizationId: ORG, engagementId: ENG, tag: "kc202610231200abcdef", ids, period: { start: "2026-09-01", end: "2026-09-30" }, unit: { unitLabel: "programme sessions" } };
  const codes = ["coverage.duplicates.resolved_risk_flagged", "measurement.blank_records_excluded", "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined"];
  // The real serializer's output (kaiInternalReportMarkdownSerializer.js).
  const markdown = serializeInternalReportToMarkdown({
    available: true,
    report: { generatedContentDraftId: "66666666-6666-4666-8666-666666666666", contentType: "evidence_summary", audience: "internal", createdAt: "2026-10-25T10:00:00.000Z", validatorKeys: ["VAL-GEN-004"] },
    context: { organizationId: ORG, organizationName: "Synthetic Org", engagementId: ENG, engagementCode: "SYNTH", engagementType: null },
    blocks: [{ ordinal: 1, citationRefs: ["CIT-001"], text: "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30. "
      + "1 blank record was excluded and 2 exact-duplicate records were included, so this is not a count of distinct events or of participants." }],
    citations: [],
    facts: [{
      citationRefs: ["CIT-001"], claimId: ids.claimId, evidenceItemId: ids.evidenceItemId, sourceId: "77777777-7777-4777-8777-777777777777", sourceCode: null,
      sourceVersionId: ids.sourceVersionId, sourceVersionCreatedAt: null, sourceVersionCurrent: true, profileCanonicalSha256: null,
      claimStatement: "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30.",
      evidenceStatement: "Source version record count: 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30, counting each CSV data record after the header row as one programme session.",
      currentlyEligible: true, blockerCodes: [], evidenceReviewOutcome: null, claimReviewOutcome: null, limitationCodes: codes,
      measurement: { measuredValue: 5, unitLabel: "programme sessions", countedUnit: "programme session", totalRecordCount: 6, blankRecordCount: 1, duplicateRecordCount: 2,
        calculationMethod: "p1_csv_profile_data_records_excluding_blank_v1", periodStart: "2026-09-01", periodEnd: "2026-09-30",
        definitionText: "Each row records one delivered programme session.", inclusionRule: "Non-empty rows.", exclusionRule: "Empty rows.", definitionRecordedAt: null },
    }],
  });
  const ok = canary._test.validateMarkdown(markdown, state);
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  assert.deepEqual(plain(ok.coverageCodes), ["coverage.duplicates.resolved_risk_flagged"]);
  assert.equal(ok.negated.length, 1, "a negated mention in the narrative is reported, not failed");
  const leaked = canary._test.validateMarkdown(`${markdown}\n2026-09-16,mentoring,8`, state);
  assert.equal(leaked.checks.noRawRowsOrFileNames, false);
  const invented = canary._test.validateMarkdown(markdown.replace("or of participants. [CIT-001]", "or of participants. Attendance improved by 40%. [CIT-001]"), state);
  assert.equal(invented.checks.noUnsupportedFindings, false);
  const otherOrg = canary._test.validateMarkdown(markdown.replace(`(\`${ORG}\`)`, "(`99999999-9999-4999-8999-999999999999`)"), state);
  assert.equal(otherOrg.checks.organizationLine, false);
  const released = canary._test.validateMarkdown(markdown.replace("# Internal Evidence Summary", "# Export Manifest"), state);
  assert.equal(released.checks.internalEvidenceSummary, false, "only the internal report contract");
});
