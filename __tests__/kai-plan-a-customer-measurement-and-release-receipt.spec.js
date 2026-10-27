import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import { getClientReleasedReportMarkdown, __clientGeneratedContentServiceContract } from "../Backend/kai/services/kaiClientGeneratedContentService.js";
import { getSourceRecordCountMeasurementBasis } from "../Backend/kai/services/kaiSourceMeasurementService.js";
import { describeMeasurementLimitationCode, measurementLimitationCodes } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { serializeExportManifestRenderModelToMarkdown } from "../Backend/kai/services/kaiExportManifestMarkdownSerializer.js";
import sprint2IntakeApiRouter, { __testables as routeTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { clientReleasedReportMarkdownPath, projectClientInternalDraft } from "../frontend/impactEvidenceLibraryLogic.js";
import {
  EMPTY_MEASUREMENT_FORM,
  measurementDefinitionBody,
  measurementFailureMessage,
  measurementFormReadiness,
  projectMeasurementBasis,
  sourceRecordCountMeasurementPath,
} from "../frontend/knowledgeStudio/clientSourceMeasurementLogic.js";

/**
 * Plan A Prompt 8 boundaries: the organization administrator's read-only
 * measurement basis and receipt of an already GK-released internal report.
 * The real-PostgreSQL proof is in
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js (normal
 * migration chain) and the browser proof in
 * kai-client-admin-measurement-to-released-report-browser-acceptance.integration.spec.js.
 */
const ORG = "0f000000-0000-4000-8000-000000000a01";
const OTHER_ORG = "0f000000-0000-4000-8000-000000000b01";
const ENGAGEMENT = "0f000000-0000-4000-8000-0000000000e1";
const OTHER_ENGAGEMENT = "0f000000-0000-4000-8000-0000000000e2";
const MANIFEST = "0f000000-0000-4000-8000-000000000601";
const DRAFT = "0f000000-0000-4000-8000-000000000301";
const CLAIM = "0f000000-0000-4000-8000-000000000901";
const EVIDENCE = "0f000000-0000-4000-8000-000000000902";
const SOURCE = "0f000000-0000-4000-8000-000000000a02";
const VERSION = "0f000000-0000-4000-8000-000000000b02";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" });

const actor = (roleName, organizationId = ORG, extra = {}) => ({
  actorType: "human",
  actorUserId: `9f000000-0000-4000-8000-00000000000${roleName.length % 10}`,
  kaiRoles: [],
  platformSuperuser: false,
  organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: roleName }],
  ...extra,
});

const RENDER_MODEL = Object.freeze({
  renderModelContractVersion: "kai-sprint2-export-manifest-render-model-v1",
  exportCandidate: { contentType: "evidence_summary", requestedAudience: "internal" },
  content: { blocks: [{ ordinal: 1, text: "The source records 5 programme sessions.", citationRefs: ["CIT-001"] }] },
  citations: [{ citationRef: "CIT-001", claimId: CLAIM, evidenceItemId: EVIDENCE, sourceId: SOURCE, sourceVersionId: VERSION }],
  limitations: [],
  methodNotes: { limitationEntries: [{ citationRef: "CIT-001", claimId: CLAIM, evidenceItemId: EVIDENCE, limitationCodes: ["measurement.blank_records_excluded", "sample_size_small"] }] },
});

function receiptDependencies({ scope = { exportManifestId: MANIFEST, generatedContentDraftId: DRAFT, requestedAudience: "internal", contentType: "evidence_summary" },
  draftEngagement = ENGAGEMENT, rendered = { ok: true, data: RENDER_MODEL, error: null }, env = ENV, calls = [] } = {}) {
  return {
    env,
    getEngagementForOrganization: async ({ organizationId, engagementId }) => (organizationId === ORG && [ENGAGEMENT, OTHER_ENGAGEMENT].includes(engagementId)
      ? { engagement_id: engagementId, organization_id: organizationId } : null),
    readGeneratedDraftEngagementId: async () => draftEngagement,
    releasedReportRepository: {
      async readReleasedReportScope(input) { calls.push(["scope", input]); return scope; },
      async readLatestInternalReleaseForDraft() { throw new Error("not used"); },
    },
    renderModelRepository: {
      async composeExportManifestRenderModel(input) { calls.push(["render", input]); return rendered; },
    },
  };
}
const receive = (overrides = {}, deps = receiptDependencies()) => getClientReleasedReportMarkdown(
  { organizationId: ORG, engagementId: ENGAGEMENT, exportManifestId: MANIFEST, actorContext: actor("client_admin"), ...overrides }, deps);

test("receipt: an active client_admin of the organization receives the released internal Markdown, re-rendered (and so re-gated) on every request", async () => {
  const calls = [];
  const result = await receive({}, receiptDependencies({ calls }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.markdown, serializeExportManifestRenderModelToMarkdown(RENDER_MODEL));
  assert.deepEqual(calls, [["scope", { organizationId: ORG, exportManifestId: MANIFEST }], ["render", { organizationId: ORG, exportManifestId: MANIFEST }]]);
  assert.deepEqual([...__clientGeneratedContentServiceContract.CLIENT_RELEASED_REPORT_READ_ROLES], ["client_admin"]);
});

test("receipt: other roles, other tenants, inactive memberships, AI and system actors, and a disabled flag are refused before any read", async () => {
  for (const [label, actorContext, code] of [
    ["client_reviewer", actor("client_reviewer"), "authorization_denied"],
    ["client_contributor", actor("client_contributor"), "authorization_denied"],
    ["gk_reviewer", actor("gk_reviewer"), "authorization_denied"],
    ["gk_admin (not a customer receipt role)", actor("gk_admin"), "authorization_denied"],
    ["another organization's client_admin", actor("client_admin", OTHER_ORG), "missing_active_organization_membership"],
    ["inactive client_admin", { ...actor("client_admin"), organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }] }, "missing_active_organization_membership"],
    ["AI actor", { ...actor("client_admin"), actorType: "ai" }, "authorization_denied"],
  ]) {
    const calls = [];
    const refused = await receive({ actorContext }, receiptDependencies({ calls }));
    assert.equal(refused.ok, false, label);
    assert.ok([code, "authorization_denied"].includes(refused.error.code), `${label}: ${refused.error.code}`);
    assert.deepEqual(calls, [], `${label}: nothing is read`);
  }
  for (const env of [{ ...ENV, KAI_PUBLIC_EXPORT_ENABLED: "false" }, { ...ENV, KAI_SPRINT2_ENABLED: "false" }, { ...ENV, KAI_GENERATION_ENABLED: "false" }]) {
    const calls = [];
    assert.equal((await receive({}, receiptDependencies({ env, calls }))).error.code, "feature_disabled");
    assert.deepEqual(calls, []);
  }
});

test("receipt: another audience, content type, Project, organization's report, or a missing report is not_found; a release no longer valid is a conflict", async () => {
  for (const [label, deps] of [
    ["funder audience", receiptDependencies({ scope: { exportManifestId: MANIFEST, generatedContentDraftId: DRAFT, requestedAudience: "funder", contentType: "evidence_summary" } })],
    ["public audience", receiptDependencies({ scope: { exportManifestId: MANIFEST, generatedContentDraftId: DRAFT, requestedAudience: "public", contentType: "evidence_summary" } })],
    ["GK-only content type", receiptDependencies({ scope: { exportManifestId: MANIFEST, generatedContentDraftId: DRAFT, requestedAudience: "internal", contentType: "data_gap_memo" } })],
    ["no such manifest", receiptDependencies({ scope: null })],
    ["draft of another Project", receiptDependencies({ draftEngagement: OTHER_ENGAGEMENT })],
  ]) {
    const result = await receive({}, deps);
    assert.deepEqual([result.ok, result.error.code], [false, "not_found"], label);
  }
  assert.equal((await receive({ engagementId: "0f000000-0000-4000-8000-0000000000e9" })).error.code, "not_found", "unknown Project");
  const revoked = await receive({}, receiptDependencies({ rendered: { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409, reason: "release_authority_not_effective" } } }));
  assert.deepEqual([revoked.ok, revoked.error.code], [false, "conflict_current_state_changed"]);
  assert.equal(JSON.stringify(revoked).includes("release_authority_not_effective"), false, "the internal reason is not disclosed");
  assert.equal((await receive({ exportManifestId: "NOT-A-UUID" })).error.code, "validation_blocker");
});

test("limitation descriptions: every measured-claim code is stated in words, accepted limitations stay limitations, and other codes have none", () => {
  const codes = [
    ...measurementLimitationCodes({ measurementRow: { period_start: "2026-09-01", blank_record_count: 1, duplicate_record_count: 2 }, dimensions: null }),
    "measurement.no_reporting_period",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.small_cell_risk.accepted_internal_limitation",
    "coverage.requirement_alignment.unresolved",
  ];
  for (const code of codes) assert.match(describeMeasurementLimitationCode(code) || "", /\w{4,}/, code);
  assert.match(describeMeasurementLimitationCode("coverage.small_cell_risk.accepted_internal_limitation"), /not resolved; accepted as a limitation for internal use only/);
  assert.match(describeMeasurementLimitationCode("measurement.duplicate_records_included"), /not of distinct events/);
  assert.match(describeMeasurementLimitationCode("measurement.period_human_attested_not_row_verified"), /not checked against dates in the records/);
  for (const code of ["sample_size_small", "coverage.unknown_dimension.unresolved", "coverage.missingness.resolved_clear", null]) {
    assert.equal(describeMeasurementLimitationCode(code), null, String(code));
  }
  const markdown = serializeExportManifestRenderModelToMarkdown(RENDER_MODEL);
  assert.match(markdown, /- \[CIT-001\] limitation codes: `measurement\.blank_records_excluded`, `sample_size_small`\.\n  - `measurement\.blank_records_excluded`: Blank records were excluded from the count\.\n/);
  assert.doesNotMatch(markdown, /`sample_size_small`: /, "a code without a description is listed as before");
});

test("measurement basis service: the extraction authority only, exact input keys, no repository call when refused", async () => {
  const calls = [];
  const repository = { async readSourceRecordCountMeasurementBasis(input) { calls.push(input); return { ok: true, data: { ok: "basis" }, error: null }; } };
  const call = (input, env = ENV) => getSourceRecordCountMeasurementBasis(input, { env, sourceMeasurementRepository: repository });
  const base = { organizationId: ORG, sourceVersionId: VERSION, actorContext: actor("client_admin") };
  assert.deepEqual(await call(base), { ok: true, data: { ok: "basis" }, error: null });
  assert.deepEqual(calls, [{ organizationId: ORG, sourceVersionId: VERSION, worksheetKey: null }]);
  for (const [label, input] of [
    ["client_reviewer", { ...base, actorContext: actor("client_reviewer") }],
    ["client_contributor", { ...base, actorContext: actor("client_contributor") }],
    ["other organization", { ...base, actorContext: actor("client_admin", OTHER_ORG) }],
    ["extra key", { ...base, definition: {} }],
  ]) {
    assert.equal((await call(input)).ok, false, label);
  }
  assert.equal((await call(base, { KAI_SPRINT2_ENABLED: "false" })).error.code, "feature_disabled");
  assert.equal(calls.length, 1);
});

test("measurement form: the server's counts are shown as given, the definition is the organization's own, and an attested period is explicit", () => {
  const projected = projectMeasurementBasis({
    sourceVersion: { source_version_id: VERSION, is_current: true },
    source: { source_code: "sessions" },
    basis: { measurable: true, data_record_count: 6, blank_record_count: 1, duplicate_record_count: 2, counted_record_count: 5 },
    recorded: null,
  });
  assert.deepEqual(projected.counts, { measurable: true, dataRecordCount: 6, blankRecordCount: 1, duplicateRecordCount: 2, countedRecordCount: 5, worksheet: null, worksheetName: null, worksheetOptions: [] });
  const workbook = projectMeasurementBasis({
    sourceVersion: { source_version_id: VERSION, is_current: true },
    basis: { measurable: true, source_format: "xlsx", worksheet: { sheet_key: "sheet_1" }, data_record_count: 6, blank_record_count: 1, duplicate_record_count: 2, counted_record_count: 5 },
  });
  assert.equal(workbook.counts.worksheet, "sheet_1", "a workbook count names its worksheet");
  assert.equal(projectMeasurementBasis({ sourceVersion: { source_version_id: VERSION }, basis: { measurable: true, data_record_count: -1 } }), null, "malformed counts fail closed");
  assert.deepEqual(projectMeasurementBasis({ sourceVersion: { source_version_id: VERSION }, basis: { measurable: false, blockers: [{ message: "Not a CSV." }] } }).counts,
    { measurable: false, blockers: [{ blockingReason: null, message: "Not a CSV.", requiredFix: null }], worksheetOptions: [] });
  assert.deepEqual(projectMeasurementBasis({ sourceVersion: { source_version_id: VERSION }, basis: { measurable: false, blockers: [{
    blocking_reason: "measurement_xlsx_formula_cells_present", message: "Formulas are not evaluated.", required_fix: "Replace them with values.",
  }] } }).counts.blockers, [{
    blockingReason: "measurement_xlsx_formula_cells_present", message: "Formulas are not evaluated.", requiredFix: "Replace them with values.",
  }], "the customer projection preserves the structured blocker and safe explanation");

  const filled = { ...EMPTY_MEASUREMENT_FORM, countedUnit: "programme session", unitLabel: "programme sessions", definitionText: "One row is one session.",
    inclusionRule: "Rows with a value.", exclusionRule: "Empty rows." };
  assert.deepEqual(measurementFormReadiness(EMPTY_MEASUREMENT_FORM), { ready: false, reason: "definition_incomplete" });
  assert.deepEqual(measurementFormReadiness(filled), { ready: true, reason: null });
  assert.deepEqual(measurementFormReadiness({ ...filled, periodStart: "2026-09-01" }), { ready: false, reason: "period_incomplete" });
  assert.deepEqual(measurementFormReadiness({ ...filled, periodStart: "2026-09-01", periodEnd: "2026-09-30" }), { ready: false, reason: "period_not_attested" });
  assert.deepEqual(measurementFormReadiness({ ...filled, periodStart: "2026-09-01", periodEnd: "2026-09-30", periodAttested: true }), { ready: true, reason: null });
  assert.deepEqual(measurementDefinitionBody(filled), {
    counted_unit: "programme session", unit_label: "programme sessions", definition_text: "One row is one session.", inclusion_rule: "Rows with a value.", exclusion_rule: "Empty rows.",
  });
  assert.deepEqual(Object.keys(measurementDefinitionBody({ ...filled, periodStart: "2026-09-01", periodEnd: "2026-09-30", periodAttested: true })).sort(),
    ["counted_unit", "definition_text", "exclusion_rule", "inclusion_rule", "period_end", "period_start", "unit_label"]);
  assert.match(measurementFailureMessage({ statusCode: 409, body: { blockers: [{ blocking_reason: "measurement_definition_already_recorded" }] } }), /cannot be changed.*new version of the source/);
  assert.equal(measurementFailureMessage({ statusCode: 422, body: { blockers: [{ message: "Missing field.", required_fix: "Enter it." }] } }), "Missing field. Enter it.");
  assert.equal(sourceRecordCountMeasurementPath(ORG, VERSION), `/api/kai/sprint2/intake/admin/organizations/${ORG}/source-versions/${VERSION}/record-count-measurement`);
});

test("release projection: only a released state carries a report id, and a malformed release fails closed", () => {
  const draft = (release) => projectClientInternalDraft({
    generatedContentDraftId: DRAFT, contentType: "evidence_summary", audience: "internal", reviewState: "reviewed_by_get_kinder",
    citedClaimsCurrentlyEligible: true, limitations: ["internal_use_only", "not_approved_for_external_use"],
    blocks: [{ ordinal: 1, text: "T", supportingClaimIds: [CLAIM] }], release,
  });
  assert.deepEqual(draft({ state: "released_for_internal_use", releasedReportId: MANIFEST }).release, { state: "released_for_internal_use", releasedReportId: MANIFEST });
  assert.deepEqual(draft({ state: "awaiting_get_kinder_release", releasedReportId: MANIFEST }).release, { state: "awaiting_get_kinder_release", releasedReportId: null });
  assert.equal(draft({ state: "released_for_internal_use", releasedReportId: null }).release, null);
  assert.equal(draft({ state: "approved", releasedReportId: MANIFEST }).release, null);
  assert.equal(clientReleasedReportMarkdownPath(ORG, ENGAGEMENT, MANIFEST),
    `/api/kai/sprint2/intake/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/client-released-reports/${MANIFEST}/markdown`);
});

test("routes: the basis GET and the receipt GET forward only path ids and the server-resolved actor; the receipt is a Markdown attachment", async (t) => {
  const calls = [];
  const restore = routeTestables.setIntakeServiceForTest({
    async getSourceRecordCountMeasurementBasis(input) { calls.push(["basis", input]); return { ok: true, data: { basis: true }, error: null }; },
    async getClientReleasedReportMarkdown(input) { calls.push(["receipt", input]); return { ok: true, data: { markdown: "# Export Manifest\n" }, error: null }; },
  });
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const app = express();
  app.use((req, _res, next) => { req.kaiSprint2ActorContext = actor("client_admin"); req.user = { id: 1 }; req.isAuthenticated = () => true; next(); });
  app.use(sprint2IntakeApiRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => {
    restore();
    if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED; else process.env.KAI_SPRINT2_ENABLED = previous;
    await new Promise((resolve) => server.close(resolve));
  });
  const get = (path) => new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: server.address().port, path: `${path}?x=1` }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
  const basis = await get(`/admin/organizations/${ORG}/source-versions/${VERSION}/record-count-measurement`);
  assert.equal(basis.statusCode, 200, basis.body);
  const receipt = await get(`/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/client-released-reports/${MANIFEST}/markdown`);
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.match(receipt.headers["content-disposition"], /attachment; filename="kai-export-manifest\.md"/);
  assert.equal(receipt.body, "# Export Manifest\n");
  assert.deepEqual(calls.map(([kind, input]) => [kind, Object.keys(input).sort()]), [
    ["basis", ["actorContext", "organizationId", "sourceVersionId", "worksheetKey"]],
    ["receipt", ["actorContext", "engagementId", "exportManifestId", "organizationId"]],
  ]);
  assert.equal((await get(`/admin/organizations/${ORG}/engagements/${ENGAGEMENT}/client-released-reports/NOT-A-UUID/markdown`)).statusCode, 422);
  assert.equal(calls.length, 2, "a malformed path never reaches the service");
});
