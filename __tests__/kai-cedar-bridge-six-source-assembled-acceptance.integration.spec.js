import test from "node:test";
import * as DOCUMENT_EVIDENCE from "../Backend/kai/validators/kaiDocumentEvidenceValidators.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Cedar Bridge six-source assembled impact-evidence acceptance: the six
 * original synthetic source files through KAI's real local processing, on the
 * runner's disposable loopback PostgreSQL (the Plan A normal migration chain).
 * Run only by
 *   KAI_CEDAR_BRIDGE_PACKAGE=<package root> node scripts/kai-cedar-bridge-six-source-acceptance-local-postgres.js
 * Skipped otherwise. Stage E (tests D1-D4: the narrative documents through
 * evidence, review, claims, generation and release) also needs
 *   KAI_CEDAR_BRIDGE_SURVEY_PDF=<.../Cedar_Bridge_Survey_Results_Verified.pdf>
 *   KAI_CEDAR_BRIDGE_ORIGINAL_PDF=<.../Cedar_Bridge_Survey_Results_FY2025-26.pdf>
 * and is skipped without them. With KAI_CEDAR_BRIDGE_REPORT=<path>.json the
 * released Stage E document is also written to <path>.released-assessment.md.
 *
 * Real: the intake API (batch, reservation, signed upload, confirmation), the
 * bounded security assessment, the P1 worker and profiler on the original
 * bytes, the data dictionary, the human sensitivity / allowed-use decision and
 * promotion routes, P2-01 evidence extraction, the P2-01M record-count basis
 * and write, the paired-outcome governed read (service; it has no route),
 * P2-03 claim proposal, P2-06 traceability, Get Kinder's existing evidence /
 * claim / coverage review routes, internal Evidence Summary generation and the
 * client's internal Markdown, every SQL statement and constraint.
 * Simulated at external boundaries only: the Get Kinder session (harness
 * cookie), object storage (in-process signed PUT), the malware scanner (clean
 * adapter behind the real assessor), the model provider (patched SDK
 * Messages.create, which repeats each cited claim statement), and the human
 * decisions themselves (made by this spec as the synthetic organization's
 * administrator and Get Kinder's reviewer).
 *
 * Every stage each file reaches is recorded as observed, including refusals
 * and missing capabilities. The independent answer key is read only after
 * KAI's results exist, and only for comparison: it never reaches KAI.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_NAME;
const PACKAGE = process.env.KAI_CEDAR_BRIDGE_PACKAGE;
const REPORT_PATH = process.env.KAI_CEDAR_BRIDGE_REPORT;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Cedar Bridge acceptance refused a non-loopback database URL host: ${host}`);
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Minimal RFC 4180 reader for the answer key's own CSV files (test-side only).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index += 1; } else if (char === "\"") quoted = false; else cell += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; } else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += char;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
  return body.map((r) => Object.fromEntries(header.map((key, i) => [key, r[i]])));
}

test("Cedar Bridge acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !PACKAGE || !existsSync(join(PACKAGE, "01_UPLOAD_TO_KAI"))) {
  test("Cedar Bridge six-source acceptance requires its runner and KAI_CEDAR_BRIDGE_PACKAGE", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runCedarBridgeAcceptance();
}

async function runCedarBridgeAcceptance() {
  const J = JSON.stringify;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  // The model stub repeats each cited claim statement verbatim: no number,
  // cause or interpretation that KAI did not already state.
  // A test may replace the repeated statement of a block (modelBlockText) to
  // prove a fabricated or unsupported output is refused.
  let modelBlockText = null;
  // A Free Impact Assessment request (it carries an `assessment` context)
  // gets the same kind of deterministic stub, by section: no language model
  // and no intelligence. It restates each claim's human-stated label and its
  // figures (internal field keys dropped), one block per group of claims
  // with identical limitation codes, and quotes the document statements
  // exactly. The server composes the gaps, improvements and next steps.
  let assessmentStub = null;
  // The clause of a claim statement that states its figures, with internal
  // field and worksheet keys and register identifiers left out.
  const KEY = /\b(?:field|sheet)_\d+\b/;
  const stubFigure = (claim) => {
    const statement = claim.claimStatement;
    const open = statement.indexOf(" (");
    const close = statement.indexOf("): ");
    const label = open > 0 ? statement.slice(0, open) : statement.split(":")[0];
    const segments = (close > 0 ? statement.slice(close + 3) : statement).split(/:\s/)
      .map((segment) => segment.replace(/;?\s*linked to register [0-9a-f-]{36}\.?/g, "").trim())
      .filter((segment) => /\d/.test(segment.replace(new RegExp(KEY.source, "g"), "")));
    const clean = (segment) => segment
      .replace(/\s+(?:served\s+)?in field_\d+\s*=\s*[A-Za-z0-9_]+/g, (match) => (match.includes("served") ? " served" : ""))
      .replace(/\bmore than one field_\d+ value\b/g, "more than one group")
      .replace(/\s*in selected worksheet sheet_\d+/g, "")
      .replace(/\bfield_\d+\s*=\s*([A-Za-z0-9_]+)/g, (_, value) => value.replace(/_/g, " "))
      .replace(/,?[^,;]*\bfield_\d+[^,;]*/g, "")
      .replace(/\.\.$/, ".")
      .trim();
    const chosen = segments.find((segment) => !KEY.test(segment)) ?? segments[0] ?? "";
    return `${label}: ${clean(chosen).replace(/\.$/, "")}`;
  };
  const firstNumber = (claim) => Number((stubFigure(claim).match(/\d[\d,]*/) || ["0"])[0].replace(/,/g, ""));
  const stubAssessmentBlocks = (requestBody) => {
    const isDocument = (claim) => /^Source-reported, not independently verified/.test(claim.claimStatement);
    const cite = (claims) => claims.map((claim) => ({ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }));
    const groups = new Map();
    for (const claim of requestBody.claims.filter((c) => !isDocument(c))) {
      const key = [...claim.limitationCodes].sort().join(",");
      groups.set(key, [...(groups.get(key) || []), claim]);
    }
    const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
    const documents = requestBody.claims.filter(isDocument);
    const lead = ordered.slice(0, 2).map((group) => [...group].sort((a, b) => firstNumber(b) - firstNumber(a))[0]);
    const blocks = [];
    if (lead.length > 0) {
      blocks.push({ section: "executive_snapshot", text: `For the reporting period, the cited evidence records: ${lead.map(stubFigure).join("; ")}. `
        + "Alongside these figures, the organization's own documents describe how the programmes run and where their records are incomplete.", citations: cite(lead) });
    }
    for (const group of ordered) blocks.push({ section: "evidence_findings", text: `${group.map(stubFigure).join("; ")}.`, citations: cite(group) });
    if (documents.length > 0) {
      const quoted = documents.map((claim) => /\(([^)]*)\): ("[\s\S]*")$/.exec(claim.claimStatement)).map((match) => `${match[2]} (${match[1]})`);
      blocks.push({ section: "impact_stories", text: `The organization's own documents describe the programme in these words, each source-reported: ${quoted.join(" ")}`, citations: cite(documents) });
    }
    return assessmentStub ? assessmentStub(blocks, requestBody) : blocks;
  };
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims, assessment: requestBody.assessment ?? null, serialized: J(payload) });
    if (requestBody.assessment) return { content: [{ type: "text", text: J({ blocks: stubAssessmentBlocks(requestBody) }) }] };
    return { content: [{ type: "text", text: J({ approved: true, draftStatus: "released",
      blocks: requestBody.claims.map((claim) => ({ text: modelBlockText ? modelBlockText(claim) : claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })) }) }] };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
  const { getPairedOutcomeMeasurementBasis } = await import("../Backend/kai/services/kaiSourceMeasurementService.js");
  const {
    BASE_PATH, claimProposalPath, claimReviewCompletePath, claimReviewDecisionBody, claimTraceabilityPath, clientInternalReportMarkdownPath,
    evidenceExtractionPath, evidenceReviewCompletePath, evidenceReviewDecisionBody, sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const {
    crossSourceMeasurementsPath, crossSourceReconciliationJobPath, crossSourceReconciliationJobsPath, derivedMeasurementBasisPath, derivedMeasurementInterpretationPath,
    pairedOutcomeMeasurementsPath, tabularMeasurementPath,
  } = await import("../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js");
  const { clientInternalDraftReleasePath, clientReleasedReportMarkdownPath, coverageInternalAcceptancePath, generatedContentReviewCompletePath, generatedContentReviewStartPath } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const router = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const config = await import("../Backend/kai/config/kaiSprint2Config.js");
  const auth = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const runtimeService = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const upload = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const executor = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const assessor = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const dispatch = await import("../Backend/kai/parsing/p1FileDispatch.js");
  const reconciliationRuntime = await import("../Backend/kai/parsing/crossSourceReconciliationJobRuntime.js");
  const { createPostgresCrossSourceReconciliationJobRepository } = await import("../Backend/kai/parsing/postgresCrossSourceReconciliationJobRepository.js");

  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // --- the six baseline sources, exactly as the package supplies them -------
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const UPLOAD_DIR = join(PACKAGE, "01_UPLOAD_TO_KAI");
  const SOURCES = [
    { key: "context", name: "01_Project_Context.md", extension: ".md", mime: "text/markdown" },
    { key: "register", name: "02_Participant_Register.csv", extension: ".csv", mime: "text/csv" },
    { key: "events", name: "03_Service_Events.csv", extension: ".csv", mime: "text/csv" },
    { key: "workbook", name: "04_Assessments_and_Followups.xlsx", extension: ".xlsx", mime: XLSX_MIME },
    { key: "notes", name: "05_Operations_Notes.txt", extension: ".txt", mime: "text/plain" },
    { key: "review", name: "06_Programme_Review.pdf", extension: ".pdf", mime: "application/pdf" },
  ].map((source) => {
    const bytes = readFileSync(join(UPLOAD_DIR, source.name));
    return { ...source, bytes, checksum: sha256(bytes) };
  });
  const byKey = Object.fromEntries(SOURCES.map((source) => [source.key, source]));

  // The human sensitivity / allowed-use decision each file truthfully gets
  // from the synthetic organization's administrator (section 7.2 categories).
  // Participant-level files carry pseudonymous participant identifiers, so
  // personal information is recorded present; the narrative files contain no
  // participant records. AI processing is permitted for internal use only.
  const ABSENT = Object.freeze({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });
  const PARTICIPANT_LEVEL = Object.freeze({ ...ABSENT, reviewed_personal_data_status: "present" });
  const DECISIONS = {
    context: ABSENT, register: PARTICIPANT_LEVEL, events: PARTICIPANT_LEVEL, workbook: PARTICIPANT_LEVEL,
    notes: Object.freeze({ ...ABSENT, reviewed_staff_notes_status: "present" }), review: ABSENT,
  };

  // --- organization, engagement and people (authorized synthetic setup) -----
  const ORG = "0c000000-0000-4000-8000-0000000000c1";
  const PROJECT = "7c000000-0000-4000-8000-0000000000c1";
  // outsider: a signed-in person with no membership in the organization.
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 983, gkAdmin: 985, outsider: 987 });
  const ORG_NAME = "Cedar Bridge Community Pathways Society";
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'cedar-bridge-synthetic')", [ORG, ORG_NAME]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Community Skills and Employment Learning Review', '{}'::jsonb)", [PROJECT, ORG]);
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.clientAdmin]);
  const gkUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@cedar.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [ORG, gkUser.user_id]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkUser.user_id]);
  // Get Kinder's release administrator, used only by the existing release path (test 15).
  const gkAdminUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkAdmin, email: `user${USERS.gkAdmin}@cedar.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_admin', 'active')", [ORG, gkAdminUser.user_id]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_admin'", [gkAdminUser.user_id]);

  // --- external boundaries ---------------------------------------------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1780000000000001n;
  let baseUrl = "";
  const storage = Object.freeze({
    enabled: true,
    async createSignedUploadUrl({ objectKey, contentType }) {
      const token = randomUUID();
      signedTargets.set(token, { objectKey, contentType });
      return { ok: true, data: { url: `${baseUrl}/synthetic-storage/${token}`, method: "PUT", headers: { "Content-Type": contentType }, expires_in_seconds: 900 } };
    },
    async headObject({ objectKey }) {
      const stored = objects.get(objectKey);
      if (!stored) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { candidate_generation: stored.generation, size_bytes: stored.bytes.byteLength } };
    },
    async statExactGeneration({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength } };
    },
    async openExactGenerationReadStream({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength, byte_source: Readable.from([Buffer.from(stored.bytes)]) } };
    },
  });
  const malwareScanAdapter = Object.freeze({ async scan() { return { status: "clean", provenance: { adapter_id: "kai_synthetic_fixture_adapter", signature_set: "v1" } }; } });
  const restoreRuntime = runtimeService.setKaiIntakeRuntimeDependenciesForTest(Object.freeze({
    env: process.env,
    gcsProvider: storage,
    gcsUploadSignerProvider: storage,
    gcsParserReaderProvider: storage,
    uploadLifecycleRepository: upload.createPostgresUploadLifecycleRepository(),
    internalSecurityAssessmentExecutor: executor.createInternalSecurityAssessmentExecutor({
      assessor: (input) => assessor.assessBoundedFileSecurity(input, { malwareScanAdapter }),
    }),
  }));
  const dispatcher = dispatch.getKaiP1FileDispatcher();
  // The reconciliation worker's post-commit dispatcher (the one the request path uses).
  const reconciliationDispatcher = reconciliationRuntime.getCrossSourceReconciliationDispatcher();

  const harnessSession = (req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@cedar.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  };
  const app = express();
  app.put("/synthetic-storage/:token", express.raw({ type: () => true, limit: "10mb" }), (req, res) => {
    const target = signedTargets.get(req.params.token);
    if (!target || req.get("content-type") !== target.contentType) return res.status(403).end();
    generation += 1n;
    objects.set(target.objectKey, { bytes: Buffer.from(req.body), generation: generation.toString() });
    return res.status(200).end();
  });
  app.use(express.json());
  app.use(harnessSession);
  app.use("/api/kai/sprint2/intake", config.requireKaiSprint2Enabled, auth.requireKaiSprint2Authenticated, router);
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const client = (legacyUserId) => async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: `kai_harness_user=${legacyUserId}` },
      ...(body === undefined ? {} : { body: J(body) }),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  const adminApi = client(USERS.clientAdmin);
  const gkApi = client(USERS.gkReviewer);
  const gkAdminApi = client(USERS.gkAdmin);
  const outsiderApi = client(USERS.outsider);
  const orgPath = `${BASE_PATH}/admin/organizations/${ORG}`;
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const blockersOf = (response) => (response.body?.blockers || response.body?.error?.blockers || []).map((b) => b.blocking_reason || b.code || b.reason);
  // Owner Package 3 (2026-11-10), reconciling these assertions with the
  // draft-first contract (owner direction 2026-11-06; Operating Model v0.2
  // section 7.2: "The control applies to release, not drafting or analysis"):
  // the organization administrator's own read of its INTERNAL draft is an
  // internal read, not a release. Recorded personal information is shown with
  // the report as information; Get Kinder's release authority for that output
  // is unchanged (asserted separately where each test releases). A 200 read is
  // safe when it is this tenant's administrator reading its own internal draft,
  // the report says it is provisional and internal-only and carries the
  // personal-information note and its citations, no identifier appears, and
  // the read records no review, authority, candidate or manifest.
  const decisionAndReleaseRows = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_reviews,
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_reviews,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS authority,
      (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG]))[0];
  const readOwnInternalMarkdown = async (draftId) => {
    const before = await decisionAndReleaseRows();
    const response = await adminApi("GET", clientInternalReportMarkdownPath(ORG, PROJECT, draftId));
    assert.deepEqual(await decisionAndReleaseRows(), before, "the internal read records no review, authority or release");
    return response;
  };
  const assertOwnInternalMarkdownSafe = (response) => {
    assert.deepEqual([response.status, blockersOf(response)], [200, []], J(response.body));
    const markdown = typeof response.body === "string" ? response.body : response.body?.data?.markdown;
    assert.match(markdown, /\*\*Status:\*\* Provisional internal draft\. It can be used for internal planning and drafting now; it is not approved for release, funders or the public\./);
    assert.match(markdown, /## Information[\s\S]*A cited source may contain personal information\. Keep participant names and direct identifiers out of anything shared outside the organization\./);
    assert.match(markdown, /CIT-001/);
    assert.match(markdown, /## Source and evidence traceability/);
    assert.doesNotMatch(markdown, /CB0\d\d|EV0\d\d|FU0\d\d/, "no participant, event or follow-up identifier");
    return markdown;
  };
  // The released manifest's CSV evidence appendix: claim id -> its source_version_id cell (header pinned).
  const csvRowsByClaim = (response) => {
    assert.equal(response.status, 200, J(response.body));
    const [header, ...rows] = response.body.split("\r\n").filter(Boolean).map((line) => line.split(","));
    assert.deepEqual(header, ["citation_ref", "claim_id", "evidence_item_id", "source_id", "source_version_id", "limitation_codes"]);
    for (const row of rows) assert.equal(row.length, 6, J(row));
    return Object.fromEntries(rows.map((row) => [row[1], row[4]]));
  };

  // The boundary report: what each file and each finding actually reached.
  const report = {
    generated_at: new Date().toISOString(),
    repository_head: null,
    reporting_context: null,
    sources: Object.fromEntries(SOURCES.map((source) => [source.key, { file: source.name, sha256: source.checksum, bytes: source.bytes.byteLength, stages: [] }])),
    measurements: {},
    derived_measurements: {},
    human_supplied_semantics: {},
    claims: {},
    generation: {},
    comparison: [],
    expected_findings: [],
  };
  const stage = (key, name, outcome, detail = {}) => report.sources[key].stages.push({ stage: name, outcome, ...detail });
  const state = Object.fromEntries(SOURCES.map((source) => [source.key, {}]));
  try {

    // -------------------------------------------------------------------------
    await test("0: the six baseline files match the package's integrity manifest; nothing else is a source", () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "File_Integrity_Manifest.json"), "utf8"));
      const baseline = manifest.filter((entry) => entry.disposition === "BASELINE_UPLOAD");
      assert.deepEqual(baseline.map((entry) => entry.relative_path.replace("01_UPLOAD_TO_KAI/", "")), SOURCES.map((source) => source.name));
      for (const entry of baseline) {
        const source = SOURCES.find((candidate) => entry.relative_path.endsWith(candidate.name));
        assert.deepEqual([source.checksum, source.bytes.byteLength], [entry.sha256, entry.bytes], source.name);
      }
      assert.deepEqual(readdirSync(UPLOAD_DIR).filter((name) => !name.startsWith(".")).sort(), SOURCES.map((source) => source.name).sort(),
        "the corrected service-events version, README, runbook and answer key are not uploaded");
    });

    await test("1: the existing organization/engagement model carries the supplied reporting context (2025-04-01 to 2026-03-31)", async () => {
      const target = { reporting_period_start: "2025-04-01", reporting_period_end: "2026-03-31", report_identity: "Community Skills and Employment Learning Review" };
      // The organization administrator owns the Project's target (gk_reviewer is not an allowed role).
      const set = await adminApi("PUT", `${orgPath}/engagements/${PROJECT}/requirement-target`, { target });
      const [row] = await query("SELECT project_metadata FROM kai.engagements WHERE engagement_id = $1::uuid", [PROJECT]);
      report.reporting_context = { route: "PUT engagements/:id/requirement-target", status: set.status, blockers: blockersOf(set), stored: row.project_metadata };
      assert.ok([200, 201].includes(set.status), J(set.body));
    });

    // -------------------------------------------------------------------------
    await test("2: each file is uploaded through the intake API and processed by the real P1 worker; the boundary each reaches is recorded", async () => {
      const batch = await adminApi("POST", createBatchPath(), { organization_id: ORG, engagement_id: PROJECT, batch_code: "cedar-bridge-baseline", idempotency_key: `batch-${randomUUID()}` });
      assert.ok([200, 201].includes(batch.status), J(batch.body));
      const batchId = batch.body.data.intake_batch_id;
      for (const source of SOURCES) {
        const reserved = await adminApi("POST", fileReservationsPath(batchId), {
          organization_id: ORG, engagement_id: PROJECT, original_filename: source.name, file_extension: source.extension, mime_type: source.mime,
          file_size_bytes: source.bytes.byteLength, checksum: source.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
        });
        stage(source.key, "reservation", reserved.status < 300 ? "accepted" : "refused", { status: reserved.status, blockers: blockersOf(reserved) });
        if (reserved.status >= 300) continue;
        const intakeFileId = reserved.body.data.intake_file_id;
        state[source.key].intakeFileId = intakeFileId;
        const signed = await adminApi("POST", requestUploadUrlPath(batchId), { organization_id: ORG, engagement_id: PROJECT, intake_file_id: intakeFileId });
        const put = await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: source.bytes });
        const confirmed = await adminApi("POST", confirmUploadPath(ORG, intakeFileId), { organization_id: ORG });
        stage(source.key, "upload_and_confirmation", confirmed.status === 200 ? "confirmed" : "refused", { put: put.status, status: confirmed.status, blockers: blockersOf(confirmed) });
      }
      await dispatcher.whenIdle();
      for (const source of SOURCES) {
        const { intakeFileId } = state[source.key];
        if (!intakeFileId) continue;
        const [file] = await query("SELECT file_policy_status, processing_status, parse_status FROM kai.intake_files WHERE intake_file_id = $1::uuid", [intakeFileId]);
        const runs = await query("SELECT parser_status, error_code FROM kai.intake_parser_runs WHERE intake_file_id = $1::uuid ORDER BY started_at", [intakeFileId]);
        const [profileRow] = await query("SELECT file_profile_id::text, profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [intakeFileId]);
        const [dictionary] = await query("SELECT data_dictionary_id::text FROM kai.data_dictionaries WHERE intake_file_id = $1::uuid", [intakeFileId]);
        const fields = dictionary ? await query("SELECT profile_field_key, data_type FROM kai.data_dictionary_fields WHERE data_dictionary_id = $1::uuid ORDER BY profile_field_key", [dictionary.data_dictionary_id]) : [];
        const [sensitivity] = await query(
          `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
             JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
            WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
        const profile = profileRow?.profile;
        Object.assign(state[source.key], { fileProfileId: profileRow?.file_profile_id, profile, dataDictionaryId: dictionary?.data_dictionary_id, sensitivity });
        stage(source.key, "security_assessment", file.file_policy_status, { processing_status: file.processing_status });
        stage(source.key, "p1_profile", profile ? profile.status : "no_profile", {
          parser_runs: runs.map((run) => [run.parser_status, run.error_code]),
          format: profile?.format ?? null,
          counts: profile?.counts ?? null,
          sheets: profile?.sheets?.map((sheet) => ({
            sheet_key: sheet.sheet_key, record_count_basis: sheet.record_count_basis ? {
              data_record_count: sheet.record_count_basis.data_record_count, blank_record_count: sheet.record_count_basis.blank_record_count,
              duplicate_record_count: sheet.record_count_basis.duplicate_record_count } : null,
            paired_outcome_basis_status: sheet.paired_outcome_basis?.status ?? null,
          })) ?? null,
          record_count_basis: profile?.record_count_basis ? {
            data_record_count: profile.record_count_basis.data_record_count, blank_record_count: profile.record_count_basis.blank_record_count,
            duplicate_record_count: profile.record_count_basis.duplicate_record_count } : null,
        });
        const qualityFindings = dictionary ? await query(
          "SELECT profile_field_key, finding_type, finding_detail_safe FROM kai.data_quality_findings WHERE data_dictionary_id = $1::uuid ORDER BY finding_type, profile_field_key",
          [dictionary.data_dictionary_id]) : [];
        state[source.key].qualityFindings = qualityFindings;
        stage(source.key, "data_dictionary_proposal", dictionary ? "draft_fields" : "none", { field_count: fields.length, meanings_inferred: false });
        stage(source.key, "p1_04_data_quality_findings", `${qualityFindings.length} findings`, {
          by_type: qualityFindings.reduce((acc, f) => ({ ...acc, [f.finding_type]: (acc[f.finding_type] || 0) + 1 }), {}),
          file_level: qualityFindings.filter((f) => f.finding_type === "duplicate_rows" || f.finding_type === "formula_like_content").map((f) => f.finding_detail_safe) });
        stage(source.key, "sensitivity_review_item", sensitivity ? "created" : "none");
        // The P1 profile never stores a header or cell value.
        if (profile) assert.doesNotMatch(J(profile), /CB0\d\d|EV0\d\d|Cedar Bridge|Digital Skills|digital_confidence/, `${source.name}: no raw value in the profile`);
      }
      // What KAI does with each format, as observed (the boundary, not a wish).
      assert.equal(state.register.profile?.status, "profiled");
      assert.equal(state.events.profile?.status, "profiled");
      assert.equal(state.workbook.profile?.status, "profiled");
    });

    await test("3: the administrator's truthful sensitivity decision and promotion through the Review Cockpit routes", async () => {
      for (const source of SOURCES) {
        const { sensitivity } = state[source.key];
        if (!sensitivity) { stage(source.key, "promotion", "not_reachable", { reason: "no sensitivity profile: P1 produced no profile" }); continue; }
        const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${ORG}`, {
          expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id,
          decision: "reviewed", reviewed_snapshot: DECISIONS[source.key],
        });
        stage(source.key, "sensitivity_decision", decided.status === 200 ? "recorded" : "refused", { status: decided.status, blockers: blockersOf(decided) });
        if (decided.status !== 200) continue;
        const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
        const promoted = await adminApi("POST", sourceCandidateDecisionPath(ORG, candidate.intake_source_candidate_id), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
        const [version] = await query("SELECT source_version_id::text, source_id::text, is_current FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
        Object.assign(state[source.key], version ? { sourceVersionId: version.source_version_id, sourceId: version.source_id } : {});
        stage(source.key, "promotion", promoted.status === 200 && version ? "promoted" : "refused", { status: promoted.status, blockers: blockersOf(promoted), source_version_id: version?.source_version_id ?? null, is_current: version?.is_current ?? null });
      }
      for (const key of ["register", "events", "workbook"]) assert.ok(state[key].sourceVersionId, `${key} is promoted`);
    });

    // -------------------------------------------------------------------------
    await test("4: P2-01 evidence extraction on every promoted version (structural field-presence evidence)", async () => {
      for (const source of SOURCES) {
        const { sourceVersionId } = state[source.key];
        if (!sourceVersionId) continue;
        const extracted = await adminApi("POST", evidenceExtractionPath(ORG, sourceVersionId), {});
        const items = await query(
          `SELECT e.evidence_item_id::text, e.evidence_type, e.statement, l.locator_type, l.coordinates FROM kai.evidence_items e JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
            WHERE e.source_version_id = $1::uuid AND e.evidence_type = 'dictionary_field_presence_fact'`, [sourceVersionId]);
        state[source.key].structuralEvidence = items;
        stage(source.key, "p2_01_evidence_extraction", extracted.status < 300 ? `${items.length} field-presence evidence items` : "refused",
          { status: extracted.status, blockers: blockersOf(extracted), locator_types: [...new Set(items.map((item) => item.locator_type))],
            sample: items.slice(0, 2).map((item) => ({ statement: item.statement, coordinates: item.coordinates })) });
      }
    });

    // The human definitions an administrator states for each count. None says
    // more than the rows establish: no reporting period is attested for a whole
    // export whose rows are not all inside it.
    const COUNT_DEFINITIONS = {
      register: { worksheetKey: null, definition: {
        counted_unit: "participant register record", unit_label: "participant register records",
        definition_text: "Each data row of the participant register records one enrolled participant.",
        inclusion_rule: "Every data row after the header row that has at least one value.", exclusion_rule: "The header row and empty rows." } },
      events: { worksheetKey: null, definition: {
        counted_unit: "service event record", unit_label: "service event records",
        definition_text: "Each data row of the service-event export records one service event, whatever its delivery status or date.",
        inclusion_rule: "Every data row after the header row that has at least one value.", exclusion_rule: "The header row and empty rows." } },
      assessments: { source: "workbook", worksheetKey: "sheet_1", definition: {
        counted_unit: "assessment observation", unit_label: "assessment observations",
        definition_text: "Each data row of the Assessments worksheet records one self-rated assessment observation.",
        inclusion_rule: "Every data row after the header row that has at least one value.", exclusion_rule: "The header row and empty rows." } },
      followups: { source: "workbook", worksheetKey: "sheet_2", definition: {
        counted_unit: "follow-up contact attempt", unit_label: "follow-up contact attempts",
        definition_text: "Each data row of the Followups worksheet records one attempted follow-up contact.",
        inclusion_rule: "Every data row after the header row that has at least one value.", exclusion_rule: "The header row and empty rows." } },
    };

    await test("5: the record-count basis for every promoted version, and the administrator's counts where a person can state what a row is", async () => {
      for (const source of SOURCES) {
        const { sourceVersionId } = state[source.key];
        if (!sourceVersionId) continue;
        const basis = await adminApi("GET", sourceRecordCountMeasurementPath(ORG, sourceVersionId));
        stage(source.key, "record_count_basis", basis.body?.data?.basis?.measurable ? "measurable" : "not_measurable", {
          status: basis.status, blockers: (basis.body?.data?.basis?.blockers || []).map((b) => b.blocking_reason),
          worksheets: basis.body?.data?.basis?.worksheets?.map((w) => [w.sheet_key ?? w.sheetKey, w.measurable]) ?? null });
      }
      for (const [label, { source = label, worksheetKey, definition }] of Object.entries(COUNT_DEFINITIONS)) {
        const { sourceVersionId } = state[source];
        const recorded = await adminApi("POST", sourceRecordCountMeasurementPath(ORG, sourceVersionId, worksheetKey), definition);
        assert.equal(recorded.status, 200, `${label}: ${J(recorded.body)}`);
        const { measurement, evidenceItem, claim } = recorded.body.data;
        const [row] = await query(
          `SELECT m.measured_value::int, m.total_record_count::int, m.blank_record_count::int, m.duplicate_record_count::int, m.calculation_method, m.worksheet_key,
                  l.locator_type, l.coordinates, e.statement, e.evidence_type
             FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
             JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id WHERE m.evidence_item_id = $1::uuid`, [evidenceItem.evidence_item_id]);
        report.measurements[label] = { kind: "record_count", source: byKey[source].name, source_version_id: sourceVersionId, persisted: true, ...row,
          measurement_id: measurement.evidence_measurement_id ?? null };
        state[label] = { ...(state[label] || {}), evidenceItemId: evidenceItem.evidence_item_id, claimId: claim?.claim_id ?? null };
        stage(source, `record_count_measurement${worksheetKey ? `:${worksheetKey}` : ""}`, `persisted ${row.measured_value}`, { evidence_item_id: evidenceItem.evidence_item_id, claim_id: claim?.claim_id ?? null });
      }
    });

    await test("6: the paired-outcome governed read on the uploaded, promoted workbook (no route, no persistence)", async () => {
      const actor = await resolveKaiActorContext({ user: { id: USERS.clientAdmin, email: `user${USERS.clientAdmin}@cedar.test` } });
      assert.equal(actor.ok, true, J(actor));
      const { actorContext } = actor;
      const counts = async () => (await query(`SELECT (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
        (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims`, [ORG]))[0];
      const before = await counts();
      const sheets = {};
      for (const worksheetKey of ["sheet_1", "sheet_2", "sheet_3"]) {
        const read = await getPairedOutcomeMeasurementBasis({ organizationId: ORG, sourceVersionId: state.workbook.sourceVersionId, worksheetKey, actorContext });
        sheets[worksheetKey] = read;
        stage("workbook", `paired_outcome_read:${worksheetKey}`, !read.ok ? `refused ${read.error?.code}` : read.data.paired.measurable ? read.data.paired.status : "not_measurable",
          { measurable: read.data?.paired?.measurable ?? null, blockers: (read.data?.paired?.blockers || read.blockers || []).map((b) => b.blocking_reason) });
      }
      assert.deepEqual(await counts(), before, "the paired read persists nothing");
      const assessments = sheets.sheet_1;
      assert.equal(assessments.ok, true, J(assessments.error));
      for (const measurement of assessments.data.paired.measurements) {
        report.measurements[`paired_${measurement.outcomeFieldKey}`] = {
          kind: "paired_outcome", source: byKey.workbook.name, source_version_id: state.workbook.sourceVersionId, worksheet_key: "sheet_1", persisted: false,
          outcome_field_key: measurement.outcomeFieldKey, status: measurement.status, denominator: measurement.denominator, increased: measurement.increasedCount,
          unchanged: measurement.unchangedCount, decreased: measurement.decreasedCount, rate: measurement.rate, participant_count: measurement.participantCount,
          numerator_meaning: measurement.numeratorMeaning, calculation_method: measurement.calculationMethod,
          exclusions: measurement.exclusions?.map((e) => ({ reason: e.reason, participant_count: e.participantCount, rows: e.rows })),
          row_exclusions: measurement.rowExclusions?.map((e) => ({ reason: e.reason, rows: e.rows })),
          limitation_codes: measurement.limitationCodes, evidence_statement: measurement.evidenceStatement,
        };
      }
    });

    // -------------------------------------------------------------------------
    await test("7: claims from the persisted measurements, P2-06 traceability, and Get Kinder's existing review where the source decision requires it", async () => {
      const trace = async (claimId) => {
        const traced = await gkApi("GET", claimTraceabilityPath(ORG, claimId, "internal"));
        return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced),
          unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort() };
      };
      const queueOf = async (queueType, targetId) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
        [ORG, queueType, targetId]))[0];
      for (const label of Object.keys(COUNT_DEFINITIONS)) {
        let { claimId } = state[label];
        if (!claimId) {
          const proposed = await adminApi("POST", claimProposalPath(ORG, state[label].evidenceItemId), {});
          assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
          claimId = proposed.body.data.claim.claim_id;
          state[label].claimId = claimId;
        }
        const [claim] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        const initial = await trace(claimId);
        const entry = { source: label, claim_id: claimId, statement: claim.statement, traceability_initial: initial };
        if (!initial.eligible) {
          const evidenceQueue = await queueOf("evidence_review", state[label].evidenceItemId);
          const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG, state[label].evidenceItemId, evidenceQueue.review_queue_item_id),
            evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
          const claimQueue = await queueOf("claim_review", claimId);
          const reviewed = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
            claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
          const afterReview = await trace(claimId);
          const accepted = [];
          for (const dimensionKey of afterReview.unresolved) {
            const acceptance = await gkApi("POST", `${orgPath}/claims/${claimId}/coverage-dimensions/${dimensionKey}/internal-acceptance`, {});
            accepted.push([dimensionKey, acceptance.status]);
          }
          entry.gk_review = { evidence: evidence.status, claim: reviewed.status, coverage_accepted: accepted };
          entry.traceability_after_review = await trace(claimId);
        }
        for (const audience of ["funder", "public"]) {
          const closed = await gkApi("GET", claimTraceabilityPath(ORG, claimId, audience));
          entry[`${audience}_eligible`] = closed.body?.data?.eligible ?? null;
        }
        report.claims[label] = entry;
        stage(COUNT_DEFINITIONS[label].source || label, `claim_and_traceability:${label}`,
          (entry.traceability_after_review || initial).eligible ? "internally_eligible" : "not_eligible", { claim_id: claimId });
      }
      // A paired measurement cannot become evidence or a claim: there is no write path.
      stage("workbook", "paired_outcome_claim", "not_implemented", { missing: "paired-outcome evidence write path (evidence_type/locator/measurement CHECKs are record-count only)" });
    });

    await test("8: an internal Evidence Summary from the eligible measured claims, read back as the client's internal Markdown", async () => {
      const claimIds = Object.values(report.claims)
        .filter((entry) => (entry.traceability_after_review || entry.traceability_initial).eligible).map((entry) => entry.claim_id);
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: claimIds, idempotency_key: `cedar-summary-${randomUUID()}`, engagement_id: PROJECT });
      report.generation.evidence_summary = { status: created.status, blockers: blockersOf(created), claim_ids: claimIds, model_calls: modelCalls.length };
      if (created.status < 300) {
        const draftId = created.body.data.generatedContentDraftId;
        const markdown = await readOwnInternalMarkdown(draftId);
        const blocks = await query(
          `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
             JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
            WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [draftId]);
        const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${draftId}/review-packet`);
        Object.assign(report.generation.evidence_summary, { draft_id: draftId, markdown_status: markdown.status, markdown_blockers: blockersOf(markdown), blocks,
          markdown: typeof markdown.body === "string" ? markdown.body : null,
          gk_review_packet: { status: packet.status, blockers: blockersOf(packet), cited_claims: packet.body?.data?.claims?.length ?? packet.body?.data?.citations?.length ?? null },
          model_request_limitation_codes: modelCalls.at(-1)?.claims?.map((claim) => [claim.claimId, claim.limitationCodes]) ?? null });
        // Each count's limitation codes, as KAI sent them to the generator.
        for (const label of Object.keys(COUNT_DEFINITIONS)) {
          const sent = modelCalls.at(-1)?.claims?.find((claim) => claim.claimId === state[label].claimId);
          Object.assign(report.measurements[label], { claim_id: state[label].claimId, limitation_codes: sent?.limitationCodes ?? null });
        }
        for (const label of Object.keys(COUNT_DEFINITIONS)) {
          if (blocks.some((block) => block.claim_id === state[label].claimId)) stage(COUNT_DEFINITIONS[label].source || label, `internal_generated_finding:${label}`, "cited in Evidence Summary", { draft_id: draftId });
        }
        // The model never received a raw value from any source.
        for (const call of modelCalls) assert.doesNotMatch(call.serialized, /CB0\d\d|EV0\d\d/, "no participant or event identifier reaches the model");
      }
    });

    // -------------------------------------------------------------------------
    await test("9: comparison with the independent answer key, after KAI produced its results", () => {
      const expected = Object.fromEntries(parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Metrics.csv"), "utf8")).map((row) => [row.metric_id, row]));
      const m = report.measurements;
      const paired = (field) => m[`paired_${field}`];
      const exclusionCount = (field, reason) => paired(field)?.exclusions?.find((e) => e.reason === reason)?.participant_count ?? 0;
      // What KAI produced for each expected metric, or why it has nothing.
      const actualFor = {
        P01: m.register && { value: m.register.measured_value, how: "record count of register rows (not a distinct-identifier count)", provenance: m.register },
        E_ROWS: m.events && { value: m.events.total_record_count, how: "data rows after the header", provenance: m.events },
        // KAI counts every member of a repeated row group (and keeps them in the record count); the key counts the extra copies.
        E_EXACT_DUPLICATE_ROWS: m.events && { value: m.events.duplicate_record_count, how: "rows that exactly repeat another row (every member of a repeated group)", provenance: m.events, definitionDiffers: true },
        A_TOTAL_ASSESSMENT_ROWS: m.assessments && { value: m.assessments.measured_value, how: "record count of the Assessments worksheet", provenance: m.assessments },
        F_ATTEMPTED_CONTACTS: m.followups && { value: m.followups.measured_value, how: "record count of the Followups worksheet", provenance: m.followups },
      };
      // The key names the score columns; they are the Assessments worksheet's
      // 6th and 7th columns, so KAI's positional field keys field_6 and field_7.
      for (const [tag, field] of [["DIG", "field_6"], ["EMP", "field_7"]]) {
        const measurement = paired(field);
        if (!measurement) continue;
        Object.assign(actualFor, {
          [`A_${tag}_PAIRS`]: { value: measurement.denominator, how: "same-version complete-case pairs", provenance: measurement },
          [`A_${tag}_INCREASED`]: { value: measurement.increased, how: "numerically higher follow-up", provenance: measurement },
          [`A_${tag}_UNCHANGED`]: { value: measurement.unchanged, how: "equal follow-up", provenance: measurement },
          [`A_${tag}_DECREASED`]: { value: measurement.decreased, how: "numerically lower follow-up", provenance: measurement },
          [`A_${tag}_INCREASE_PERCENT`]: { value: Number(measurement.rate), how: "increased / comparable pairs, 2 dp", provenance: measurement },
        });
      }
      const anyPaired = Object.values(m).find((x) => x.kind === "paired_outcome");
      if (anyPaired) {
        Object.assign(actualFor, {
          A_PEOPLE_WITH_ANY_ASSESSMENT: { value: anyPaired.participant_count, how: "participants with any classified observation", provenance: anyPaired },
          A_VERSION_DRIFT_PAIRS: { value: exclusionCount(anyPaired.outcome_field_key, "instrument_version_mismatch"), how: "participants excluded for instrument version mismatch", provenance: anyPaired },
          A_BASELINE_ONLY_PEOPLE: { value: exclusionCount(anyPaired.outcome_field_key, "no_followup_observation"), how: "participants with no follow-up observation", provenance: anyPaired },
          A_FOLLOWUP_ONLY_PEOPLE: { value: exclusionCount(anyPaired.outcome_field_key, "no_baseline_observation"), how: "participants with no baseline observation", provenance: anyPaired },
        });
      }
      const missing = {
        E: "no filtered, deduplicated-by-key, period-bounded or cross-source-joined event count: the record count counts rows only",
        E_DISTINCT: "no distinct-key count and no join between the event log and the register",
        P: "no distinct or categorical value count (program enrolment) and no cross-source membership",
        F: "no categorical value count on a worksheet column (response status, self-reported next step)",
        T: "no planning-target classification: KAI proposes nothing on the Targets worksheet, and nothing reports it as an achievement",
        MEAN: "the paired calculation counts directions only; it has no mean",
        E_MONTH: "no grouping by date month",
        V2: "challenge version not part of this baseline",
      };
      const reasonFor = (id) => id.startsWith("E_MONTH") ? missing.E_MONTH : /MEAN/.test(id) ? missing.MEAN : id.startsWith("E_DISTINCT") ? missing.E_DISTINCT
        : id.startsWith("E_") ? missing.E : /^P0[2-4]$/.test(id) ? missing.P : id.startsWith("F_") ? missing.F : id.startsWith("T_") ? missing.T
        : id.startsWith("V2") ? missing.V2 : id === "A_NO_ASSESSMENT_PEOPLE" ? missing.E_DISTINCT
      : "KAI states the participant total and each exclusion reason, but not this subtotal";
      for (const [id, row] of Object.entries(expected)) {
        const actual = actualFor[id];
        const expectedValue = Number(row.expected_value);
        report.comparison.push(actual ? {
          metric_id: id, expected: expectedValue, actual: actual.value, difference: actual.value === expectedValue ? "match" : actual.definitionDiffers ? "different_definition" : "incorrect",
          calculation: actual.how, source_version_id: actual.provenance.source_version_id, worksheet_key: actual.provenance.worksheet_key ?? null,
          persisted: actual.provenance.persisted, limitation_codes: actual.provenance.limitation_codes ?? null,
        } : { metric_id: id, expected: expectedValue, actual: null, difference: id.startsWith("V2") ? "out_of_scope" : "unavailable", calculation: null, reason: reasonFor(id) });
      }
      const findings = parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Evidence_and_Claims.csv"), "utf8"));
      // What KAI did for each expected finding, stated from this run's own records.
      const reached = (label) => report.claims[label] && report.generation.evidence_summary?.blocks?.some((b) => b.claim_id === report.claims[label].claim_id)
        ? "persisted count -> claim -> internally eligible after GK review -> cited in Evidence Summary" : "not reached";
      const pairedField = (denominator) => Object.values(m).find((x) => x.kind === "paired_outcome" && x.denominator === denominator);
      const observed = {
        EB01: `row count only: ${m.events?.measured_value} service event records (${reached("events")}); no completed / in-period / roster-linked / key-deduplicated count`,
        EB02: "not available: no distinct-key count and no join between the event log and the register",
        EB03: "not available: no grouping by a column value",
        EB04: "not available: no distinct-per-group or cross-group overlap count",
        EB05: "not available: no grouping by date month",
        EB06: `calculated read-only (${pairedField(38)?.increased}/${pairedField(38)?.denominator}, ${pairedField(38)?.rate}%), not persisted, no claim`,
        EB07: `calculated read-only (${pairedField(40)?.increased}/${pairedField(40)?.denominator}, ${pairedField(40)?.rate}%), not persisted, no claim`,
        EB08: `detected read-only: ${exclusionCount(anyPaired?.outcome_field_key, "instrument_version_mismatch")} participants excluded for instrument_version_mismatch; not persisted`,
        EB09: "detected read-only: per-field missing-value and baseline/follow-up-only exclusions; not persisted",
        EB10: "not available: no categorical value count; only the 38 attempt rows are counted",
        EB11: `partly: ${m.followups?.measured_value} follow-up contact attempts (${reached("followups")}); answered / nonresponse not available`,
        EB12: "context respected by omission: KAI proposes no measurement on the Targets worksheet and no target value reaches a claim; KAI has no plan-vs-actual classification",
        EB13: "not detectable: the PDF is profiled structurally (pages, text blocks) and yields no evidence, so its estimate cannot be compared",
        EB14: `flagged: P1-04 "${state.events.qualityFindings?.find((f) => f.finding_type === "duplicate_rows")?.finding_detail_safe}" and measurement.duplicate_records_included; the duplicates stay in the count`,
        EB15: "not detectable: no join between the event log and the register",
        EB16: "not detectable: no record-date filter; every count states 'no reporting period defined'",
        EB17: "partly: P1-04 missingness finding on the event log (field key only), carried as coverage.missingness; no known-minutes subtotal",
        EB18: "not exercised here: no outcome or change claim exists, so none can be cited (the causal-language validators are proven in the P2-01M suite)",
        EB19: "respected in this run: allowed use and AI permission came only from the recorded human decisions; the profiles hold no source text",
        EB20: "out of scope for the baseline",
      };
      report.expected_findings = findings.map((row) => ({ id: row.id, finding: row.finding, expected_posture: row.expected_posture,
        supporting_source: row.supporting_source, kai_observed: observed[row.id] ?? "not assessed" }));
      // The two verified paired measurements are preserved end to end on real upload bytes.
      for (const id of ["A_DIG_PAIRS", "A_DIG_INCREASED", "A_DIG_UNCHANGED", "A_DIG_DECREASED", "A_EMP_PAIRS", "A_EMP_INCREASED", "A_EMP_UNCHANGED", "A_EMP_DECREASED"]) {
        assert.equal(report.comparison.find((c) => c.metric_id === id).difference, "match", id);
      }
      console.log(`Cedar Bridge comparison: ${J(report.comparison.map((c) => [c.metric_id, c.expected, c.actual, c.difference]))}`);
      console.log(`Cedar Bridge source boundaries: ${J(Object.fromEntries(Object.entries(report.sources).map(([key, value]) => [key, value.stages.map((s) => `${s.stage}=${s.outcome}`)])))}`);
    });
    await test("10: the observed processing boundary of each source is the regression baseline", () => {
      const outcome = (key, name) => report.sources[key].stages.find((s) => s.stage === name)?.outcome;
      const detail = (key, name) => report.sources[key].stages.find((s) => s.stage === name);
      // Every file is accepted, profiled and promoted through the real routes.
      for (const { key } of SOURCES) {
        assert.deepEqual(["reservation", "upload_and_confirmation", "security_assessment", "p1_profile", "promotion"].map((name) => outcome(key, name)),
          ["accepted", "confirmed", "passed", "profiled", "promoted"], key);
      }
      assert.deepEqual(SOURCES.map(({ key }) => detail(key, "p1_profile").format), ["markdown", "csv", "csv", "xlsx", "txt", "pdf"]);
      // Narrative sources: Markdown headings become structural field-presence
      // evidence on "column" locators; TXT and PDF yield no evidence at all.
      assert.equal(outcome("context", "p2_01_evidence_extraction"), "9 field-presence evidence items");
      assert.deepEqual(detail("context", "p2_01_evidence_extraction").locator_types, ["column"]);
      assert.equal(outcome("notes", "p2_01_evidence_extraction"), "0 field-presence evidence items");
      assert.equal(outcome("review", "p2_01_evidence_extraction"), "0 field-presence evidence items");
      assert.equal(detail("review", "p1_profile").counts.page_count, 3);
      for (const key of ["context", "notes", "review"]) assert.deepEqual(detail(key, "record_count_basis").blockers, ["measurement_source_not_single_table"], key);
      // Tabular sources: the four record counts persist and reach a cited internal finding.
      assert.deepEqual(["register", "events", "assessments", "followups"].map((label) => report.measurements[label].measured_value), [80, 246, 112, 38]);
      assert.deepEqual(detail("workbook", "record_count_basis").blockers, ["measurement_xlsx_worksheet_selection_required"]);
      for (const label of ["register", "events", "assessments", "followups"]) {
        const claim = report.claims[label];
        assert.deepEqual([claim.traceability_initial.eligible, claim.traceability_initial.blockerCodes.includes("evidence_review_unresolved")], [false, true],
          `${label}: personal information present needs Get Kinder review first`);
        assert.equal(claim.traceability_after_review.eligible, true, label);
        assert.deepEqual([claim.funder_eligible, claim.public_eligible], [false, false], label);
        // Package 1 contract: the count asserts source records; the period is attributed, never applied.
        assert.match(claim.statement, /Not applied by KAI: .*no reporting period was defined\./, `${label}: the engagement's reporting period is not applied to the count`);
      }
      // The engagement carries the reporting context, but no measurement reads it.
      assert.deepEqual(report.reporting_context.stored.engagement_requirement_target, {
        report_identity: "Community Skills and Employment Learning Review", reporting_period_start: "2025-04-01", reporting_period_end: "2026-03-31" });
      // Data quality: the event log's two exact-duplicate pairs are flagged; the
      // workbook, whose rows are all distinct, has no duplicate finding (repair).
      assert.deepEqual(detail("events", "p1_04_data_quality_findings").file_level, ["4 duplicate rows detected"]);
      assert.deepEqual(detail("workbook", "p1_04_data_quality_findings").file_level, []);
      assert.equal(report.measurements.events.duplicate_record_count, 4);
      // Paired outcomes: Assessments only; Followups and Targets propose nothing.
      assert.equal(outcome("workbook", "paired_outcome_read:sheet_1"), "available");
      assert.deepEqual(detail("workbook", "paired_outcome_read:sheet_2").blockers, ["paired_outcome_baseline_followup_stage_not_found"]);
      assert.deepEqual(detail("workbook", "paired_outcome_read:sheet_3").blockers, ["paired_outcome_participant_identifier_not_found"]);
      assert.ok(Object.values(report.measurements).filter((x) => x.kind === "paired_outcome").every((x) => x.persisted === false));
      // Generation: the persisted internal Evidence Summary cites all four counts;
      // the client's own internal read is open with the personal-information
      // note (draft first; Package 3 reconciliation above).
      const summary = report.generation.evidence_summary;
      assert.deepEqual([summary.status, summary.blocks.length, summary.markdown_status, summary.markdown_blockers, summary.gk_review_packet.status],
        [201, 4, 200, [], 200]);
      assertOwnInternalMarkdownSafe({ status: summary.markdown_status, body: summary.markdown });
      for (const block of summary.blocks) assert.match(block.text, /Measurement disclosure for the cited count/);
    });

    // =========================================================================
    // Measurement MVP: Package A (paired outcomes persisted) and Package B
    // (content-aware tabular measurements), on the same uploaded bytes, through
    // the same evidence, claim, traceability and generation paths.
    // =========================================================================
    const derivedRows = async (sourceVersionId) => query(
      `SELECT m.source_derived_measurement_id::text, m.source_version_id::text, m.worksheet_key, m.measurement_family, m.calculation_method, m.basis_version,
              m.measurement_key, m.definition, m.field_keys, m.measured_value::int, m.numerator::int, m.denominator::int, m.percentage::text,
              m.component_counts, m.exclusions, m.row_locators, m.profile_canonical_sha256, m.created_at
         FROM kai.source_derived_measurements m WHERE m.organization_id = $1::uuid AND m.source_version_id = $2::uuid ORDER BY m.created_at, m.source_derived_measurement_id`,
      [ORG, sourceVersionId]);
    const evidenceOf = async (measurementId) => query(
      `SELECT l.evidence_item_id::text, l.interpretation_id::text, e.statement, e.evidence_type, e.data_class, sl.locator_type, sl.coordinates
         FROM kai.evidence_derived_measurements l JOIN kai.evidence_items e ON e.evidence_item_id = l.evidence_item_id
         JOIN kai.source_locators sl ON sl.source_locator_id = e.source_locator_id
        WHERE l.organization_id = $1::uuid AND l.source_derived_measurement_id = $2::uuid ORDER BY l.created_at`, [ORG, measurementId]);
    const writeCounts = async () => (await query(`SELECT
        (SELECT count(*) FROM kai.source_derived_measurements WHERE organization_id = $1::uuid)::int AS measurements,
        (SELECT count(*) FROM kai.source_derived_measurement_interpretations WHERE organization_id = $1::uuid)::int AS interpretations,
        (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
        (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid)::int AS queue_items,
        (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audits`, [ORG]))[0];
    const recordCountRow = async (evidenceItemId) => (await query(
      `SELECT measured_value::int, total_record_count::int, blank_record_count::int, duplicate_record_count::int, calculation_method, profile_canonical_sha256, worksheet_key
         FROM kai.evidence_measurements WHERE evidence_item_id = $1::uuid`, [evidenceItemId]))[0];
    const versionSha = async (sourceVersionId) => (await query("SELECT profile_canonical_sha256 FROM kai.source_versions WHERE source_version_id = $1::uuid", [sourceVersionId]))[0].profile_canonical_sha256;
    const derived = {};

    // The meanings below are supplied by this acceptance's author (a person),
    // from the package's own project context; KAI did not infer any of them.
    const HUMAN_SEMANTICS = {
      paired_field_6: { indicator_label: "Digital confidence", score_direction: "higher_is_better", evidence_basis: "self_reported",
        meaning_text: "Human-supplied for this synthetic acceptance: the participant's self-rated digital confidence on a 1 to 5 scale." },
      paired_field_7_first: { indicator_label: "Employment readiness", score_direction: "not_established", evidence_basis: "self_reported",
        meaning_text: "Human-supplied for this synthetic acceptance: the participant's self-rated employment readiness." },
      paired_field_7: { indicator_label: "Employment readiness", score_direction: "higher_is_better", evidence_basis: "self_reported",
        meaning_text: "Human-supplied correction for this synthetic acceptance: self-rated employment readiness on a 1 to 5 scale, higher is better." },
    };
    report.human_supplied_semantics.paired = HUMAN_SEMANTICS;

    await test("11: Package A - KAI retains both paired outcomes without any human definition; a person's meaning then changes interpretation, never arithmetic", async () => {
      const sourceVersionId = state.workbook.sourceVersionId;
      const assessmentsBefore = await recordCountRow(state.assessments.evidenceItemId);
      // A person outside the organization cannot record its measurement; another tenant is refused.
      const asOutsider = await outsiderApi("POST", pairedOutcomeMeasurementsPath(ORG, sourceVersionId, "sheet_1"), {});
      const otherTenant = await adminApi("POST", pairedOutcomeMeasurementsPath("0c000000-0000-4000-8000-0000000000ff", sourceVersionId, "sheet_1"), {});
      const noPairs = await adminApi("POST", pairedOutcomeMeasurementsPath(ORG, sourceVersionId, "sheet_2"), {});
      const narrative = await adminApi("POST", pairedOutcomeMeasurementsPath(ORG, state.notes.sourceVersionId), {});
      report.derived_measurements.paired_refusals = { outsider: [asOutsider.status, blockersOf(asOutsider)], other_tenant: [otherTenant.status, blockersOf(otherTenant)],
        followups_sheet: [noPairs.status, blockersOf(noPairs)], txt_source: [narrative.status, blockersOf(narrative)] };
      assert.ok(asOutsider.status >= 400 && otherTenant.status >= 400, J(report.derived_measurements.paired_refusals));
      assert.deepEqual([noPairs.status, blockersOf(noPairs)], [422, ["paired_outcome_baseline_followup_stage_not_found"]]);
      assert.equal(narrative.status, 422);

      const beforeWrite = await writeCounts();
      const recorded = await adminApi("POST", pairedOutcomeMeasurementsPath(ORG, sourceVersionId, "sheet_1"), {});
      assert.equal(recorded.status, 200, J(recorded.body));
      assert.equal(recorded.body.data.replayed, false);
      const afterWrite = await writeCounts();
      assert.deepEqual([afterWrite.measurements - beforeWrite.measurements, afterWrite.interpretations - beforeWrite.interpretations, afterWrite.evidence - beforeWrite.evidence,
        afterWrite.claims - beforeWrite.claims, afterWrite.audits - beforeWrite.audits], [2, 0, 2, 0, 1], "two measurements, two evidence items, one audit, no claim");

      const rows = (await derivedRows(sourceVersionId)).filter((row) => row.measurement_family === "paired_outcome_change");
      const sha = await versionSha(sourceVersionId);
      const byField = Object.fromEntries(rows.map((row) => [row.definition.outcome_field_key, row]));
      for (const [field, [pairs, up, same, down, pct]] of Object.entries({ field_6: [38, 25, 10, 3, "65.79"], field_7: [40, 23, 13, 4, "57.50"] })) {
        const row = byField[field];
        assert.deepEqual([row.denominator, row.numerator, row.component_counts.unchanged_count, row.component_counts.decreased_count, row.percentage], [pairs, up, same, down, pct], field);
        assert.deepEqual([row.calculation_method, row.basis_version, row.worksheet_key, row.profile_canonical_sha256], ["p1_xlsx_paired_baseline_followup_numeric_change_v1", "kai_xlsx_paired_outcome_basis_v1", "sheet_1", sha], field);
        assert.ok(row.field_keys.includes(field) && row.field_keys.length >= 3, J(row.field_keys));
        const versionMismatch = row.exclusions.participants.find((e) => e.reason === "instrument_version_mismatch");
        assert.equal(versionMismatch?.participant_count, 8, `${field}: version-drifted participants stay excluded`);
        const [evidence] = await evidenceOf(row.source_derived_measurement_id);
        assert.deepEqual([evidence.evidence_type, evidence.data_class, evidence.interpretation_id, evidence.locator_type],
          ["source_derived_measurement", "source_derived_aggregate", null, "source_derived_measurement_fields"], field);
        assert.deepEqual(evidence.coordinates, { scope: "derived_measurement_fields", sheet_key: "sheet_1", field_keys: row.field_keys });
        assert.match(evidence.statement, /whether higher is better is not established/, "a proposed result asserts no direction");
        assert.match(evidence.statement, new RegExp(`${up} of ${pairs} comparable participant pairs \\(${pct.replace(".", "\\.")}%\\)`));
        derived[`paired_${field}`] = { measurementId: row.source_derived_measurement_id, proposedEvidenceItemId: evidence.evidence_item_id, row };
      }
      // Field-level exclusions: missing digital follow-ups exclude only the digital field; missing readiness baselines only readiness.
      const rowsOf = (row, reason) => row.exclusions.participants.find((e) => e.reason === reason)?.rows ?? [];
      assert.ok([15, 31, 61, 77].every((r) => rowsOf(byField.field_6, "missing_followup_value").includes(r)), J(byField.field_6.exclusions));
      assert.ok([18, 62].every((r) => rowsOf(byField.field_7, "missing_baseline_value").includes(r)), J(byField.field_7.exclusions));
      assert.deepEqual(await recordCountRow(state.assessments.evidenceItemId), assessmentsBefore, "the 112-row assessment record count is unchanged");

      // Replay: zero writes and no audit.
      const replay = await adminApi("POST", pairedOutcomeMeasurementsPath(ORG, sourceVersionId, "sheet_1"), {});
      assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
      assert.deepEqual(await writeCounts(), afterWrite, "a repeated record writes nothing and audits nothing");
    });

    await test("11a: unresolved meaning stays descriptive through proposal, actual eligibility gates and a saved six-section readiness assessment", async () => {
      const scenario = { surface: "disposable PostgreSQL / real HTTP services", provider: "deterministic stub", project_id: PROJECT, claims: [] };
      report.unresolved_outcome_assessment = scenario;
      const trace = async (claimId) => {
        const result = await gkApi("GET", claimTraceabilityPath(ORG, claimId, "internal"));
        assert.equal(result.status, 200, J(result.body));
        return result.body.data;
      };
      for (const field of ["field_6", "field_7"]) {
        const evidenceItemId = derived[`paired_${field}`].proposedEvidenceItemId;
        const proposed = await adminApi("POST", claimProposalPath(ORG, evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        const claimId = proposed.body.data.claim.claim_id;
        const [claim] = await query("SELECT statement, claim_review_status, claim_strength FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        assert.match(claim.statement, /whether higher is better is not established/);
        assert.doesNotMatch(claim.statement, /improv|caus|unique participants/i);
        const initial = await trace(claimId);
        assert.equal(initial.eligible, false, "this source records personal information; meaning is not inferred as the reason");
        assert.ok(initial.blockerCodes.includes("evidence_review_unresolved") && initial.blockerCodes.includes("claim_review_unresolved"), J(initial));
        scenario.claims.push({ field, claim_id: claimId, evidence_item_id: evidenceItemId, statement: claim.statement, initial });
      }
      const claimIds = scenario.claims.map((entry) => entry.claim_id);
      const draftCount = async () => (await query("SELECT count(*)::int AS n FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG]))[0].n;
      const draftsBefore = await draftCount();
      const callsBefore = modelCalls.length;
      const refused = await adminApi("POST", `${orgPath}/generated-content-drafts/free-impact-assessment`, {
        claim_ids: claimIds, engagement_id: PROJECT, idempotency_key: `unresolved-blocked-${randomUUID()}`,
      });
      scenario.before_review = { status: refused.status, body: refused.body };
      // Owner Package 3 reconciliation (draft first, 2026-11-06): these claims
      // are unreviewed, not rejected, and their measurements are intact, so an
      // internal assessment admits them provisionally and they DO reach the
      // provider; open review is carried as a limitation. The deterministic
      // stub's output is unusable (a required section missing): before the
      // 2026-11-10 wording fallback that refused the request (422
      // assessment_model_section_missing); now the required sections are
      // stated from the admitted claims' own wording and the provisional
      // draft is saved, with nothing from the unusable output in it.
      assert.equal(refused.status, 201, J(refused.body));
      const [savedAssessment] = await query("SELECT draft_status, review_status, validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [refused.body.data.generatedContentDraftId]);
      assert.deepEqual([savedAssessment.draft_status, savedAssessment.review_status], ["draft", "needs_gk_review"]);
      assert.equal(savedAssessment.validator_results.find((r) => r.validator_key === "VAL-GEN-ASSESSMENT-001").evidence.restated_model_block_ordinals, "all");
      const restatedBlocks = refused.body.data.blocks.map((block) => block.text).join("\n");
      for (const entry of scenario.claims) assert.ok(restatedBlocks.includes(entry.statement), "each admitted finding is stated in its own wording");
      // The restated model sections (not the server's own gap / improvement sections) assert no improvement or cause.
      const modelSections = refused.body.data.blocks.filter((block) => /^\[\[assessment:(executive_snapshot|evidence_findings|impact_stories)\]\]\n/.test(block.text))
        .map((block) => block.text.replace(/^\[\[assessment:[a-z_]+\]\]\n/, "").split(" Measurement disclosure for ")[0]).join("\n");
      assert.doesNotMatch(modelSections, /improv|caus/i);
      const sentForAssessment = modelCalls.slice(callsBefore);
      assert.ok(sentForAssessment.length >= 1 && sentForAssessment.length <= 2, "one model call, plus at most the single bounded correction");
      for (const call of sentForAssessment) assert.deepEqual(call.claims.map((claim) => claim.claimId).sort(), [...claimIds].sort(), "exactly the admitted claims");
      for (const call of sentForAssessment) for (const claim of call.claims) assert.ok(claim.limitationCodes.includes("claim_review_unresolved"), "open review travels as a limitation");
      assert.equal(await draftCount(), draftsBefore + 1, "the provisional assessment is saved");

      // These are new, attributed synthetic decisions on descriptive findings,
      // through the existing GK operations; no eligibility or approval is seeded.
      const queueOf = async (queueType, targetId) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
        [ORG, queueType, targetId]))[0];
      for (const entry of scenario.claims) {
        const evidenceQueue = await queueOf("evidence_review", entry.evidence_item_id);
        const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG, entry.evidence_item_id, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        const claimQueue = await queueOf("claim_review", entry.claim_id);
        const claim = await gkApi("POST", claimReviewCompletePath(ORG, entry.claim_id, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        assert.deepEqual([evidence.status, claim.status], [200, 200], J([evidence.body, claim.body]));
        entry.coverage_acceptances = [];
        for (const [key, dimension] of Object.entries((await trace(entry.claim_id)).dimensions)) {
          if (dimension.assessment_status !== "unresolved") continue;
          const accepted = await gkApi("POST", coverageInternalAcceptancePath(ORG, entry.claim_id, key), {});
          assert.equal(accepted.status, 201, J(accepted.body));
          entry.coverage_acceptances.push(key);
        }
        entry.after_review = await trace(entry.claim_id);
        assert.equal(entry.after_review.eligible, true, J(entry.after_review));
      }
      assessmentStub = (_blocks, request) => {
        const citations = request.claims.map((claim) => ({ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }));
        return [
          { section: "executive_snapshot", text: "The selected evidence describes baseline and follow-up comparisons for comparable pairs. Organizational meaning and favorable direction have not been established.", citations },
          ...request.claims.map((claim) => ({ section: "evidence_findings", text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })),
          { section: "impact_stories", text: "The selected evidence consists of measured comparisons. No consented participant story is supplied with these findings.", citations },
        ];
      };
      let created;
      try {
        created = await adminApi("POST", `${orgPath}/generated-content-drafts/free-impact-assessment`, {
          claim_ids: claimIds, engagement_id: PROJECT, idempotency_key: `unresolved-descriptive-${randomUUID()}`,
        });
      } finally { assessmentStub = null; }
      scenario.generation = { status: created.status, body: created.body };
      assert.equal(created.status, 201, J(created.body));
      scenario.draft_id = created.body.data.generatedContentDraftId;
      const blocks = await query("SELECT ordinal, text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid ORDER BY ordinal", [scenario.draft_id]);
      const { parseFreeImpactAssessment } = await import("../Backend/kai/services/kaiFreeImpactAssessmentComposition.js");
      const sections = parseFreeImpactAssessment(blocks);
      assert.equal(sections?.length, 6);
      const text = blocks.map((block) => block.text).join("\n");
      assert.match(text, /25 of 38 comparable participant pairs \(65\.79%\)/);
      assert.match(text, /23 of 40 comparable participant pairs \(57\.50%\)/);
      assert.match(text, /whether higher is better is not established/);
      assert.match(text, /not every participant/);
      assert.doesNotMatch(text, /participants? improved|programme (?:caused|improves)|unique participants|2025-04-01/);
      scenario.sections = sections.map((section) => section.title);
      const [draftState] = await query("SELECT draft_status, review_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [scenario.draft_id]);
      scenario.approval_representation = { ...draftState, next_steps: sections[5].blocks.map((block) => block.body).join("\n") };
      assert.equal(draftState.draft_status, "draft");
      assert.equal(draftState.review_status, "needs_gk_review");
      assert.doesNotMatch(scenario.approval_representation.next_steps, /(?:is|been) approved for internal use/i, "an unreviewed saved draft cannot describe itself as approved");
      const saved = await gkApi("GET", `${orgPath}/generated-content-drafts/${scenario.draft_id}/review-packet`);
      assert.equal(saved.status, 200, J(saved.body));
      assert.ok(J(saved.body).includes("65.79"), "a fresh application read retrieves the persisted outcome content");
      // A model cannot turn the same undefined comparison into an improvement.
      modelBlockText = (claim) => `${claim.claimStatement} The programme caused participants to improve.`;
      try {
        const unsupported = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, {
          claim_ids: claimIds, engagement_id: PROJECT, idempotency_key: `unresolved-overclaim-${randomUUID()}`,
        });
        // Owner direction 2026-11-10: detected and never saved; the blocks are
        // restated from the claims (before: 422, nothing saved).
        assert.equal(unsupported.status, 201, J(unsupported.body));
        const savedText = unsupported.body.data.blocks.map((block) => block.text).join("\n");
        assert.doesNotMatch(savedText, /The programme caused participants to improve/);
        const [unsupportedDraft] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [unsupported.body.data.generatedContentDraftId]);
        const detected = unsupportedDraft.validator_results.find((r) => r.validator_key === "KAI-GEN-WORDING-FALLBACK-001").evidence;
        assert.ok(detected.refused_classes.includes("causal_language"), J(detected));
        scenario.unsupported_output = { status: unsupported.status, detected };
      } finally { modelBlockText = null; }
      assert.equal(await draftCount(), draftsBefore + 3, "the restated first assessment, the descriptive assessment and the restated summary are saved; nothing unsupported is");
    });

    await test("11b: an authorized person records synthetic meaning and units; arithmetic is unchanged and approvals are not copied", async () => {
      const sourceVersionId = state.workbook.sourceVersionId;

      // A person states the meanings. Field 7 is first stated without a direction, then corrected.
      const interpret = (key, body) => adminApi("POST", derivedMeasurementInterpretationPath(ORG, derived[key].measurementId), body);
      const invalid = await interpret("paired_field_6", { indicator_label: "Digital confidence", meaning_text: "x" });
      assert.deepEqual([invalid.status, blockersOf(invalid)], [422, ["interpretation_score_direction_required"]]);
      const first6 = await interpret("paired_field_6", HUMAN_SEMANTICS.paired_field_6);
      const first7 = await interpret("paired_field_7", HUMAN_SEMANTICS.paired_field_7_first);
      assert.deepEqual([first6.status, first7.status], [200, 200], J([first6.body, first7.body]));
      // A claim on field 7 under its first meaning, then the meaning is corrected.
      const firstClaim7 = await adminApi("POST", claimProposalPath(ORG, first7.body.data.evidenceItem.evidence_item_id), {});
      assert.ok([200, 201].includes(firstClaim7.status), J(firstClaim7.body));
      const beforeCorrection = await writeCounts();
      const corrected7 = await interpret("paired_field_7", HUMAN_SEMANTICS.paired_field_7);
      assert.equal(corrected7.status, 200, J(corrected7.body));
      assert.equal(corrected7.body.data.supersededInterpretationId, first7.body.data.interpretation.interpretation_id);
      const afterCorrection = await writeCounts();
      assert.deepEqual([afterCorrection.measurements - beforeCorrection.measurements, afterCorrection.interpretations - beforeCorrection.interpretations,
        afterCorrection.evidence - beforeCorrection.evidence, afterCorrection.audits - beforeCorrection.audits], [0, 1, 1, 1]);
      const replayInterpretation = await interpret("paired_field_7", HUMAN_SEMANTICS.paired_field_7);
      assert.deepEqual([replayInterpretation.status, replayInterpretation.body.data.replayed], [200, true]);
      assert.deepEqual(await writeCounts(), afterCorrection, "restating the current meaning writes nothing");

      // The arithmetic is byte-for-byte the row KAI calculated before any meaning existed.
      const after = Object.fromEntries((await derivedRows(sourceVersionId)).filter((row) => row.measurement_family === "paired_outcome_change").map((row) => [row.definition.outcome_field_key, row]));
      for (const field of ["field_6", "field_7"]) assert.deepEqual(after[field], derived[`paired_${field}`].row, `${field}: interpretation does not rewrite arithmetic`);
      const history = await query(
        `SELECT interpretation_id::text, supersedes_interpretation_id::text, indicator_label, score_direction, evidence_basis FROM kai.source_derived_measurement_interpretations
          WHERE source_derived_measurement_id = $1::uuid ORDER BY created_at`, [derived.paired_field_7.measurementId]);
      assert.deepEqual(history.map((h) => [h.score_direction, h.supersedes_interpretation_id === null]), [["not_established", true], ["higher_is_better", false]]);

      derived.paired_field_6.evidenceItemId = first6.body.data.evidenceItem.evidence_item_id;
      derived.paired_field_7.evidenceItemId = corrected7.body.data.evidenceItem.evidence_item_id;
      derived.paired_field_7.supersededClaimId = firstClaim7.body.data.claim.claim_id;
      for (const entry of report.unresolved_outcome_assessment.claims) {
        const stale = await gkApi("GET", claimTraceabilityPath(ORG, entry.claim_id, "internal"));
        assert.equal(stale.status, 409, J(stale.body));
        assert.ok(J(stale.body).includes("derived_measurement_interpretation_superseded"));
      }
      // Proposed and superseded evidence are no longer current: no claim can be proposed from them.
      const staleProposed = await adminApi("POST", claimProposalPath(ORG, derived.paired_field_6.proposedEvidenceItemId), {});
      assert.deepEqual([staleProposed.status, blockersOf(staleProposed)], [422, ["derived_measurement_claim_basis_invalid"]]);
      for (const field of ["field_6", "field_7"]) {
        const [evidence] = (await evidenceOf(derived[`paired_${field}`].measurementId)).slice(-1);
        assert.match(evidence.statement, new RegExp(`^Derived measurement: ${field === "field_6" ? "Digital confidence" : "Employment readiness"} \\(meaning stated by the organization; values self-reported\\)`));
        assert.match(evidence.statement, /the organization states higher is better/);
        report.derived_measurements[`paired_${field}`] = {
          kind: "paired_outcome", persisted: true, source: byKey.workbook.name, source_version_id: sourceVersionId, ...after[field],
          evidence: await evidenceOf(derived[`paired_${field}`].measurementId), interpretation_history: field === "field_7" ? history : undefined,
        };
      }
      stage("workbook", "paired_outcome_persisted:sheet_1", "2 measurements persisted; meanings human-supplied", {
        measurement_ids: [derived.paired_field_6.measurementId, derived.paired_field_7.measurementId] });
    });

    // Package B: the administrator selects fields and values exactly as the
    // basis lists them (column position, listed value label). Labels below are
    // the person's statement of meaning, recorded as human-stated.
    const TABULAR = {};
    await test("12: Package B - content-aware counts and rates on the uploaded service events and Followups, persisted as derived measurements", async () => {
      const eventsBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
      const followupsBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.workbook.sourceVersionId, "sheet_2"));
      assert.deepEqual([eventsBasis.status, followupsBasis.status], [200, 200], J([eventsBasis.body, followupsBasis.body]));
      const eventFields = eventsBasis.body.data.tabular.fields;
      const followupFields = followupsBasis.body.data.tabular.fields;
      assert.deepEqual(eventsBasis.body.data.reporting_period && [eventsBasis.body.data.reporting_period.start, eventsBasis.body.data.reporting_period.end], ["2025-04-01", "2026-03-31"]);
      report.derived_measurements.options = { events: eventsBasis.body.data.tabular, followups: followupsBasis.body.data.tabular };
      // No identifier or free-text value is exposed: only listed category labels.
      assert.doesNotMatch(J(eventsBasis.body.data.tabular), /EV0\d\d|CB0\d\d/);
      const column = (fields, position, role) => {
        const field = fields.find((candidate) => candidate.column_position === position);
        assert.equal(field?.role, role, `column ${position} is proposed as ${role}`);
        return field;
      };
      const valueOf = (field, label) => {
        const value = field.values.find((candidate) => candidate.label === label);
        assert.ok(value, `${field.field_key} lists ${label}`);
        return { kind: "category", field_key: field.field_key, value_key: value.value_key };
      };
      const eventId = column(eventFields, 1, "identifier");
      const serviceDate = column(eventFields, 4, "date");
      const status = column(eventFields, 6, "categorical");
      const attempted = column(followupFields, 4, "categorical");
      const response = column(followupFields, 5, "categorical");
      const nextStep = column(followupFields, 6, "categorical");
      const eachEvent = { kind: "distinct_key", field_key: eventId.field_key, duplicate_policy: "count_each_key_once" };
      const period = (scope) => ({ kind: "period", field_key: serviceDate.field_key, period_source: "engagement_reporting_period", scope });
      const organizationRecord = (label, meaning) => ({ indicator_label: label, meaning_text: `Human-stated for this synthetic acceptance: ${meaning}`, evidence_basis: "organization_record" });
      const selfReported = (label, meaning) => ({ indicator_label: label, meaning_text: `Human-stated for this synthetic acceptance: ${meaning}`, evidence_basis: "self_reported" });
      const DEFINITIONS = {
        events_rows: { source: "events", definition: { operation: "count" } },
        events_distinct: { source: "events", definition: { operation: "count", unit: eachEvent },
          interpretation: organizationRecord("Distinct service events", "each event identifier in the service-event export is one service event.") },
        events_completed: { source: "events", definition: { operation: "count", unit: eachEvent, conditions: [valueOf(status, "completed")] },
          interpretation: organizationRecord("Completed service events", "service events whose delivery status is completed, on any date.") },
        events_cancelled: { source: "events", definition: { operation: "count", unit: eachEvent, conditions: [valueOf(status, "cancelled")] } },
        events_no_show: { source: "events", definition: { operation: "count", unit: eachEvent, conditions: [valueOf(status, "no_show")] } },
        events_completed_outside_period: { source: "events", definition: { operation: "count", unit: eachEvent, conditions: [valueOf(status, "completed"), period("outside")] },
          interpretation: organizationRecord("Completed events outside the period", "completed service events dated outside the engagement reporting period.") },
        events_completed_within_period: { source: "events", definition: { operation: "count", unit: eachEvent, conditions: [valueOf(status, "completed"), period("within")] } },
        followups_attempts: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(attempted, "yes")] } },
        followups_answered: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(response, "answered")] } },
        followups_nonresponse: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(response, "no_response")] } },
        followups_response_rate: { source: "workbook", worksheetKey: "sheet_2",
          definition: { operation: "rate", conditions: [valueOf(response, "answered")], population: [valueOf(attempted, "yes")] },
          interpretation: organizationRecord("Follow-up response rate", "attempted follow-up contacts that were answered.") },
        followups_paid_work: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(nextStep, "started_paid_work")] },
          interpretation: selfReported("Self-reported paid work", "answered follow-ups in which the participant reported starting paid work; not verified employment.") },
        followups_paid_work_among_answers: { source: "workbook", worksheetKey: "sheet_2",
          definition: { operation: "rate", conditions: [valueOf(nextStep, "started_paid_work")], population: [valueOf(response, "answered")] },
          interpretation: selfReported("Self-reported paid work among answers", "answered follow-ups reporting started paid work; not verified employment.") },
        followups_entered_training: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(nextStep, "entered_training")] } },
        followups_still_seeking: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(nextStep, "still_seeking")] } },
        followups_unknown: { source: "workbook", worksheetKey: "sheet_2", definition: { operation: "count", conditions: [valueOf(nextStep, "unknown")] } },
      };
      report.human_supplied_semantics.tabular = Object.fromEntries(Object.entries(DEFINITIONS).map(([label, entry]) => [label, entry.interpretation ?? null]));

      // Refusals: a category field is not an identifier; two category conditions; an unlisted value; a rate on one field; a reviewer.
      const post = (source, worksheetKey, body, api = adminApi) => api("POST", tabularMeasurementPath(ORG, state[source].sourceVersionId, worksheetKey ?? null), body);
      const refusals = {
        status_as_identifier: await post("events", null, { definition: { operation: "count", unit: { kind: "distinct_key", field_key: status.field_key, duplicate_policy: "count_each_key_once" } } }),
        two_categories: await post("events", null, { definition: { operation: "count", conditions: [valueOf(status, "completed"), { ...valueOf(status, "cancelled") }] } }),
        unlisted_value: await post("events", null, { definition: { operation: "count", conditions: [{ kind: "category", field_key: status.field_key, value_key: "value_99" }] } }),
        rate_same_field: await post("workbook", "sheet_2", { definition: { operation: "rate", conditions: [valueOf(response, "answered")], population: [valueOf(response, "no_response")] } }),
        typed_period: await post("events", null, { definition: { operation: "count", conditions: [{ kind: "period", field_key: serviceDate.field_key, period_start: "2025-01-01", period_end: "2025-12-31" }] } }),
        no_worksheet: await post("workbook", null, { definition: { operation: "count" } }),
        outsider: await post("events", null, { definition: { operation: "count" } }, outsiderApi),
      };
      report.derived_measurements.tabular_refusals = Object.fromEntries(Object.entries(refusals).map(([key, value]) => [key, [value.status, blockersOf(value)]]));
      assert.deepEqual(report.derived_measurements.tabular_refusals.status_as_identifier, [422, ["tabular_field_role_not_proposed"]]);
      assert.deepEqual(report.derived_measurements.tabular_refusals.two_categories, [422, ["tabular_condition_combination_not_supported"]]);
      assert.deepEqual(report.derived_measurements.tabular_refusals.unlisted_value, [422, ["tabular_category_value_not_listed"]]);
      assert.deepEqual(report.derived_measurements.tabular_refusals.rate_same_field, [422, ["tabular_rate_population_same_field"]]);
      assert.deepEqual(report.derived_measurements.tabular_refusals.typed_period, [422, ["tabular_condition_invalid"]]);
      assert.deepEqual(report.derived_measurements.tabular_refusals.no_worksheet, [422, ["tabular_worksheet_selection_required"]]);
      assert.ok(refusals.outsider.status >= 400);

      for (const [label, entry] of Object.entries(DEFINITIONS)) {
        const body = { definition: entry.definition, ...(entry.interpretation ? { interpretation: entry.interpretation } : {}) };
        const recorded = await post(entry.source, entry.worksheetKey, body);
        assert.equal(recorded.status, 200, `${label}: ${J(recorded.body)}`);
        const { measurement, evidenceItem, interpretation } = recorded.body.data;
        TABULAR[label] = { measurementId: measurement.source_derived_measurement_id, evidenceItemId: evidenceItem.evidence_item_id };
        const [row] = (await derivedRows(state[entry.source].sourceVersionId)).filter((candidate) => candidate.source_derived_measurement_id === measurement.source_derived_measurement_id);
        const [evidence] = await evidenceOf(measurement.source_derived_measurement_id);
        report.derived_measurements[label] = { kind: row.measurement_family, persisted: true, source: byKey[entry.source].name, source_version_id: state[entry.source].sourceVersionId,
          ...row, interpretation: interpretation ?? null, evidence };
        assert.equal(row.profile_canonical_sha256, await versionSha(state[entry.source].sourceVersionId), label);
        assert.equal(evidence.interpretation_id, interpretation?.interpretation_id ?? null, label);
      }
      const value = (label) => report.derived_measurements[label].measured_value;
      assert.deepEqual(["events_rows", "events_distinct", "events_completed", "events_cancelled", "events_no_show", "events_completed_outside_period"].map(value), [246, 244, 228, 10, 6, 5]);
      assert.deepEqual(["followups_attempts", "followups_answered", "followups_nonresponse", "followups_paid_work"].map(value), [38, 29, 9, 9]);
      const rate = report.derived_measurements.followups_response_rate;
      assert.deepEqual([rate.numerator, rate.denominator, rate.percentage, rate.component_counts.other_population_record_count], [29, 38, "76.32", 9]);
      // Both duplicate concepts, kept apart.
      const distinct = report.derived_measurements.events_distinct.component_counts;
      assert.deepEqual([distinct.exact_duplicate_member_records, distinct.exact_duplicate_excess_copies, distinct.source_repeated_key_count, distinct.source_records_in_repeated_keys],
        [4, 2, 2, 4]);
      // The period is the engagement's recorded period applied to the selected date field.
      const outside = report.derived_measurements.events_completed_outside_period.definition.conditions.find((c) => c.kind === "period");
      assert.deepEqual([outside.period_start, outside.period_end, outside.field_key, outside.scope], ["2025-04-01", "2026-03-31", serviceDate.field_key, "outside"]);
      assert.match(report.derived_measurements.followups_paid_work.evidence.statement, /values self-reported/);
      assert.doesNotMatch(report.derived_measurements.followups_paid_work.evidence.statement, /(?<!not )verified/);

      // Replay of a recorded definition writes nothing.
      const before = await writeCounts();
      const replay = await post("events", null, { definition: DEFINITIONS.events_distinct.definition, interpretation: DEFINITIONS.events_distinct.interpretation });
      assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
      assert.deepEqual(await writeCounts(), before);
      const conflicting = await post("events", null, { definition: DEFINITIONS.events_distinct.definition, interpretation: organizationRecord("Other label", "another meaning.") });
      assert.deepEqual([conflicting.status, blockersOf(conflicting)], [409, ["derived_measurement_interpretation_already_recorded"]]);
      stage("events", "tabular_measurements", "7 measurements persisted", { labels: Object.keys(DEFINITIONS).filter((l) => DEFINITIONS[l].source === "events") });
      stage("workbook", "tabular_measurements:sheet_2", "9 measurements persisted", { labels: Object.keys(DEFINITIONS).filter((l) => DEFINITIONS[l].source === "workbook") });
    });

    // The derived measurements that go on to claims and a cited internal finding.
    const DERIVED_CLAIM_LABELS = ["paired_field_6", "paired_field_7", "events_distinct", "events_completed", "events_completed_outside_period", "followups_response_rate", "followups_paid_work"];
    const derivedEvidenceItemId = (label) => (label.startsWith("paired_") ? derived[label].evidenceItemId : TABULAR[label].evidenceItemId);
    const derivedClaims = {};
    await test("13: claims from the derived evidence, P2-06 traceability and Get Kinder's existing review; a superseded meaning stays ineligible", async () => {
      const trace = async (claimId, audience = "internal") => {
        const traced = await gkApi("GET", claimTraceabilityPath(ORG, claimId, audience));
        return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced),
          unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort(),
          flagged: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "resolved_risk_flagged").map(([k]) => k).sort() };
      };
      const queueOf = async (queueType, targetId) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
        [ORG, queueType, targetId]))[0];
      const reviewToInternal = async (claimId, evidenceItemId) => {
        const evidenceQueue = await queueOf("evidence_review", evidenceItemId);
        const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG, evidenceItemId, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        const claimQueue = await queueOf("claim_review", claimId);
        const claim = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        const accepted = [];
        for (const dimensionKey of (await trace(claimId)).unresolved) {
          const acceptance = await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimensionKey), {});
          accepted.push([dimensionKey, acceptance.status]);
        }
        return { evidence: evidence.status, claim: claim.status, coverage_accepted: accepted };
      };
      for (const label of DERIVED_CLAIM_LABELS) {
        const evidenceItemId = derivedEvidenceItemId(label);
        const proposed = await adminApi("POST", claimProposalPath(ORG, evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
        const claimId = proposed.body.data.claim.claim_id;
        const [claim] = await query("SELECT statement, claim_type FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        const initial = await trace(claimId);
        const entry = { source: label, claim_id: claimId, evidence_item_id: evidenceItemId, statement: claim.statement, traceability_initial: initial };
        assert.equal(initial.eligible, false, `${label}: personal information present needs Get Kinder review first`);
        entry.gk_review = await reviewToInternal(claimId, evidenceItemId);
        entry.traceability_after_review = await trace(claimId);
        assert.equal(entry.traceability_after_review.eligible, true, `${label}: ${J(entry.traceability_after_review)}`);
        for (const audience of ["funder", "public"]) entry[`${audience}_eligible`] = (await trace(claimId, audience)).eligible;
        assert.deepEqual([entry.funder_eligible, entry.public_eligible], [false, false], label);
        // The claim restates the persisted arithmetic: its numbers are the measurement's.
        const measurement = report.derived_measurements[label];
        assert.ok(claim.statement.includes(String(measurement.measured_value)), `${label}: ${claim.statement}`);
        if (measurement.percentage) assert.ok(claim.statement.includes(`${measurement.percentage}%`), label);
        derivedClaims[label] = claimId;
        report.claims[`derived:${label}`] = entry;
      }
      // The claim proposed under field 7's first meaning, then corrected: like evidence of a superseded
      // source version, its evidence is no longer current and P2-06 refuses to trace it as current.
      const supersededResponse = await gkApi("GET", claimTraceabilityPath(ORG, derived.paired_field_7.supersededClaimId, "internal"));
      const superseded = { status: supersededResponse.status, reason: supersededResponse.body?.data?.traceability_conflict_reason ?? null, blockers: blockersOf(supersededResponse) };
      report.claims["derived:paired_field_7_superseded"] = { claim_id: derived.paired_field_7.supersededClaimId, traceability: superseded };
      assert.deepEqual([superseded.status, superseded.reason], [409, "derived_measurement_interpretation_superseded"], J(superseded));
      // An unreviewed proposed measurement: what its claim would carry (meaning proposed, risk-flagged, never resolved).
      const proposedClaim = await adminApi("POST", claimProposalPath(ORG, TABULAR.events_cancelled.evidenceItemId), {});
      assert.ok([200, 201].includes(proposedClaim.status), J(proposedClaim.body));
      const proposedTrace = await trace(proposedClaim.body.data.claim.claim_id);
      report.claims["derived:events_cancelled_proposed_meaning"] = { claim_id: proposedClaim.body.data.claim.claim_id, statement: proposedClaim.body.data.claim.statement, traceability: proposedTrace };
      assert.ok(proposedTrace.flagged.includes("definition_clarity"), J(proposedTrace));
      // Client follow-ups: the method answers what a client would be asked, so no claim waits on one.
      for (const label of DERIVED_CLAIM_LABELS) {
        assert.ok(!report.claims[`derived:${label}`].traceability_initial.blockerCodes.includes("client_followup_unresolved"), label);
      }
    });

    let derivedDraftId = null;
    await test("14: an internal Evidence Summary cites every derived claim with its measured numbers and material limitations", async () => {
      const claimIds = DERIVED_CLAIM_LABELS.map((label) => derivedClaims[label]);
      const callsBefore = modelCalls.length;
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: claimIds, idempotency_key: `cedar-derived-${randomUUID()}`, engagement_id: PROJECT });
      assert.equal(created.status, 201, J(created.body));
      derivedDraftId = created.body.data.generatedContentDraftId;
      const call = modelCalls.at(-1);
      assert.equal(modelCalls.length, callsBefore + 1);
      const blocks = await query(
        `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [derivedDraftId]);
      const validators = (await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [derivedDraftId]))[0]?.validator_results ?? null;
      report.generation.derived_evidence_summary = { status: created.status, draft_id: derivedDraftId, blocks, validator_results: validators,
        model_request: call.claims.map((claim) => ({ claimId: claim.claimId, claimStatement: claim.claimStatement, limitationCodes: claim.limitationCodes })) };
      assert.equal(blocks.length, DERIVED_CLAIM_LABELS.length);
      for (const label of DERIVED_CLAIM_LABELS) {
        const block = blocks.find((candidate) => candidate.claim_id === derivedClaims[label]);
        const measurement = report.derived_measurements[label];
        assert.ok(block, label);
        assert.equal(block.evidence_item_id, derivedEvidenceItemId(label), `${label}: cites its own current evidence item`);
        assert.ok(block.text.includes(String(measurement.measured_value)), `${label}: ${block.text}`);
        if (measurement.percentage) assert.ok(block.text.includes(`${measurement.percentage}%`), label);
        assert.match(block.text, /Measurement disclosure for the cited measurement: /);
        assert.match(block.text, /KAI did not check the recorded values against any other source\./);
        const sent = call.claims.find((claim) => claim.claimId === derivedClaims[label]);
        assert.ok(sent.limitationCodes.includes("derived.values_not_verified") && sent.limitationCodes.includes("derived.meaning_human_stated"), J(sent.limitationCodes));
        Object.assign(measurement, { claim_id: derivedClaims[label], limitation_codes: sent.limitationCodes, generated_finding: block.text });
      }
      const paired = blocks.find((b) => b.claim_id === derivedClaims.paired_field_6).text;
      assert.match(paired, /The result covers only participants with a comparable baseline and follow-up observation, not every participant\./);
      assert.match(paired, /Which direction is better was stated by a person at the organization, not determined by KAI\./);
      const paid = blocks.find((b) => b.claim_id === derivedClaims.followups_paid_work).text;
      assert.match(paid, /The recorded values are self-reported and were not independently verified\./);
      const rate = blocks.find((b) => b.claim_id === derivedClaims.followups_response_rate).text;
      assert.match(rate, /The rate applies only to the measured population named in the statement/);
      const period = blocks.find((b) => b.claim_id === derivedClaims.events_completed_outside_period).text;
      assert.match(period, /The reporting period is the one recorded for the engagement, applied to the dates in the selected date field\./);
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/, "no participant, event or follow-up identifier reaches the model");
      stage("workbook", "internal_generated_finding:derived", "cited in Evidence Summary", { draft_id: derivedDraftId });
      stage("events", "internal_generated_finding:derived", "cited in Evidence Summary", { draft_id: derivedDraftId });
    });

    await test("15: fabricated and unsupported wording is detected and never saved; a stale claim is refused, through the same generation path", async () => {
      // Owner direction 2026-11-10: model wording never fails an Evidence
      // Summary; a refused block is restated from its claim and the detection
      // is recorded on the draft (before: 422 with nothing saved).
      const attempt = async (labels, text, injected = null) => {
        modelBlockText = text;
        try {
          const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: labels.map((l) => derivedClaims[l] ?? l), idempotency_key: `cedar-negative-${randomUUID()}`, engagement_id: PROJECT });
          const draftId = created.body?.data?.generatedContentDraftId ?? null;
          const [draft] = draftId ? await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]) : [];
          const fallback = draft?.validator_results.find((r) => r.validator_key === "KAI-GEN-WORDING-FALLBACK-001")?.evidence ?? null;
          const saved = draftId ? (await query("SELECT text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid", [draftId])).map((row) => row.text).join("\n") : "";
          const validators = (created.body?.blockers || created.body?.error?.blockers || []).map((b) => [b.validator_key, b.blocking_reason]);
          return { status: created.status, validators, detected: fallback?.refused_validator_keys ?? [], classes: fallback?.refused_classes ?? [], injected_saved: injected ? saved.includes(injected) : null };
        } finally { modelBlockText = null; }
      };
      const results = {
        invented_number: await attempt(["followups_response_rate"], (claim) => `${claim.claimStatement} In total 412 people responded.`, "412 people responded"),
        causal_assertion: await attempt(["paired_field_6"], (claim) => `${claim.claimStatement} The programme improves digital confidence because of the workshops.`, "improves digital confidence"),
        verified_employment: await attempt(["followups_paid_work"], (claim) => `${claim.claimStatement} These are verified employment outcomes.`, "These are verified employment outcomes"),
        all_participants: await attempt(["followups_response_rate"], (claim) => `${claim.claimStatement} This holds for all participants.`, "This holds for all participants"),
        superseded_meaning: await attempt([derived.paired_field_7.supersededClaimId], null),
      };
      report.generation.derived_negative = results;
      for (const [label, key] of [["invented_number", "VAL-GEN-004"], ["causal_assertion", "VAL-GEN-004"], ["verified_employment", "VAL-GEN-008"], ["all_participants", "VAL-GEN-008"]]) {
        const result = results[label];
        assert.deepEqual([result.status, result.injected_saved], [201, false], `${label}: ${J(result)}`);
        assert.ok(result.detected.includes(key), `${label}: ${J(result)}`);
      }
      assert.ok(results.superseded_meaning.status >= 400, J(results.superseded_meaning));
    });

    await test("16: delivery - the client's own Markdown stays closed for personal information; Get Kinder's existing review and release path, then the client route", async () => {
      const draftPath = `${orgPath}/generated-content-drafts/${derivedDraftId}`;
      const delivery = { draft_id: derivedDraftId };
      // The existing release path is gated by KAI_PUBLIC_EXPORT_ENABLED. It is
      // set in this test process only, for this test only, as the existing
      // release acceptances do; nothing persistent changes.
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      try {
      const markdown = await readOwnInternalMarkdown(derivedDraftId);
      delivery.client_internal_markdown = [markdown.status, blockersOf(markdown)];
      delivery.client_internal_markdown_response = markdown;
      const ownRelease = await adminApi("POST", clientInternalDraftReleasePath(ORG, PROJECT, derivedDraftId), { decision: "release_for_internal_use", limitations_confirmed: true });
      delivery.client_admin_release = [ownRelease.status, blockersOf(ownRelease)];
      const queueOf = async (queueType) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid ORDER BY created_at DESC",
        [ORG, queueType, derivedDraftId]))[0];
      const contentQueue = await queueOf("generated_content_review");
      const started = await gkApi("POST", generatedContentReviewStartPath(ORG, derivedDraftId, contentQueue.review_queue_item_id), { expected_updated_at: new Date(contentQueue.updated_at).toISOString() });
      const inProgress = await queueOf("generated_content_review");
      const completed = await gkApi("POST", generatedContentReviewCompletePath(ORG, derivedDraftId, inProgress.review_queue_item_id), { expected_updated_at: new Date(inProgress.updated_at).toISOString() });
      delivery.gk_content_review = [started.status, completed.status, blockersOf(completed)];
      const requested = await gkAdminApi("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" });
      delivery.export_review_request = [requested.status, blockersOf(requested)];
      if (requested.status < 300) {
        for (const step of ["start", "complete"]) {
          const queue = await queueOf("export_review");
          const moved = await gkAdminApi("POST", `${draftPath}/export-review-queue/${queue.review_queue_item_id}/${step}`, { expected_updated_at: new Date(queue.updated_at).toISOString() });
          delivery[`export_review_${step}`] = [moved.status, blockersOf(moved)];
        }
        const exportReviewQueueItemId = (await queueOf("export_review")).review_queue_item_id;
        const snapshot = await gkApi("POST", `${draftPath}/limitation-snapshot`, {});
        delivery.limitation_snapshot = [snapshot.status, blockersOf(snapshot)];
        const entries = await query(
          `SELECT e.claim_id::text, e.limitation_codes FROM kai.limitation_snapshot_entries e
             JOIN kai.limitation_snapshots s ON s.limitation_snapshot_id = e.limitation_snapshot_id
            WHERE s.organization_id = $1::uuid AND s.generated_content_draft_id = $2::uuid`, [ORG, derivedDraftId]).catch(() => []);
        delivery.limitation_snapshot_entries = entries;
        const candidate = await gkAdminApi("POST", `${draftPath}/export-candidates`, {});
        delivery.export_candidate = [candidate.status, blockersOf(candidate)];
        const [candidateRow] = await query("SELECT export_candidate_id::text FROM kai.export_candidates WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid", [ORG, derivedDraftId]);
        if (candidateRow) {
          const authority = await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/final-release-authority`, { requested_audience: "internal", decision_action: "grant" });
          delivery.final_release_authority = [authority.status, blockersOf(authority)];
          const manifest = await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/export-manifests`, { export_review_queue_item_id: exportReviewQueueItemId });
          delivery.export_manifest = [manifest.status, blockersOf(manifest)];
          const [manifestRow] = await query("SELECT export_manifest_id::text FROM kai.export_manifests WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid", [ORG, candidateRow.export_candidate_id]);
          if (manifestRow) {
            const released = await adminApi("GET", clientReleasedReportMarkdownPath(ORG, PROJECT, manifestRow.export_manifest_id));
            delivery.client_released_markdown = [released.status, blockersOf(released)];
            if (released.status === 200 && typeof released.body === "string") {
              delivery.client_released_markdown_excerpt = released.body.slice(0, 4000);
              delivery.client_released_markdown_mentions = Object.fromEntries(DERIVED_CLAIM_LABELS.map((label) => [label, released.body.includes(derivedClaims[label])]));
            }
          }
        }
      }
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
      report.generation.derived_delivery = delivery;
      console.log(`Cedar Bridge derived delivery: ${J(delivery, null, 0).slice(0, 3000)}`);
      // The existing rule is not bypassed: the client's own Markdown stays closed for personal information.
      // The client's own internal read is open (draft first); its release still needs Get Kinder.
      assertOwnInternalMarkdownSafe(delivery.client_internal_markdown_response);
      delete delivery.client_internal_markdown_response;
      assert.deepEqual(delivery.client_admin_release, [422, ["personal_information_not_cleared", "factual_review_not_complete"]]);
      // Get Kinder's existing review and release chain, then the organization's existing released-report route.
      assert.deepEqual(delivery.gk_content_review, [200, 200, []]);
      assert.deepEqual([delivery.export_review_request[0], delivery.export_review_start[0], delivery.export_review_complete[0], delivery.limitation_snapshot[0],
        delivery.export_candidate[0], delivery.final_release_authority[0], delivery.export_manifest[0]], [201, 200, 200, 201, 201, 201, 201], J(delivery));
      assert.equal(delivery.client_released_markdown[0], 200, J(delivery.client_released_markdown));
      assert.ok(Object.values(delivery.client_released_markdown_mentions).every(Boolean), J(delivery.client_released_markdown_mentions));
      for (const label of DERIVED_CLAIM_LABELS) {
        const entry = delivery.limitation_snapshot_entries.find((candidate) => candidate.claim_id === derivedClaims[label]);
        assert.deepEqual(entry?.limitation_codes, report.derived_measurements[label].limitation_codes, `${label}: the released snapshot carries the generation codes`);
      }
    });

    await test("17: the updated comparison with the answer key, by method, population, period, persistence, claim and generated finding", () => {
      const expected = Object.fromEntries(parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Metrics.csv"), "utf8")).map((row) => [row.metric_id, row]));
      const d = report.derived_measurements;
      // Method validity: the definition KAI recorded must be the calculation the metric names, not just the same number.
      const isDistinct = (m) => m.calculation_method === "kai_tabular_conditional_distinct_key_count_v1" && m.definition.unit.kind === "distinct_key";
      const categories = (m) => m.definition.conditions.filter((c) => c.kind === "category").map((c) => c.value_label);
      const periodOf = (m) => m.definition.conditions.find((c) => c.kind === "period") ?? null;
      const newActuals = {
        E_ROWS: [d.events_rows, d.events_rows.measured_value, d.events_rows.calculation_method === "kai_tabular_conditional_record_count_v1" && categories(d.events_rows).length === 0, "every physical data record"],
        E_UNIQUE_EVENTS: [d.events_distinct, d.events_distinct.measured_value, isDistinct(d.events_distinct) && categories(d.events_distinct).length === 0, "each event identifier once, all records"],
        E_EXACT_DUPLICATE_ROWS: [d.events_distinct, d.events_distinct.component_counts.exact_duplicate_excess_copies, true, "excess copies in exact-duplicate row groups (members are reported separately)"],
        E_COMPLETED_ALL_DATES: [d.events_completed, d.events_completed.measured_value, isDistinct(d.events_completed) && J(categories(d.events_completed)) === J(["completed"]) && !periodOf(d.events_completed), "distinct events with status completed, all dates"],
        E_CANCELLED_ALL_DATES: [d.events_cancelled, d.events_cancelled.measured_value, isDistinct(d.events_cancelled) && J(categories(d.events_cancelled)) === J(["cancelled"]), "distinct events with status cancelled"],
        E_NO_SHOW_ALL_DATES: [d.events_no_show, d.events_no_show.measured_value, isDistinct(d.events_no_show) && J(categories(d.events_no_show)) === J(["no_show"]), "distinct events with status no_show"],
        E_COMPLETED_OUT_OF_PERIOD: [d.events_completed_outside_period, d.events_completed_outside_period.measured_value,
          isDistinct(d.events_completed_outside_period) && periodOf(d.events_completed_outside_period)?.scope === "outside" && periodOf(d.events_completed_outside_period)?.period_start === "2025-04-01",
          "distinct completed events dated outside the engagement reporting period"],
        F_ATTEMPTED_CONTACTS: [d.followups_attempts, d.followups_attempts.measured_value, J(categories(d.followups_attempts)) === J(["yes"]), "records with contact attempted = yes"],
        F_ANSWERED_CONTACTS: [d.followups_answered, d.followups_answered.measured_value, J(categories(d.followups_answered)) === J(["answered"]), "records with response status answered"],
        F_NO_RESPONSE_CONTACTS: [d.followups_nonresponse, d.followups_nonresponse.measured_value, J(categories(d.followups_nonresponse)) === J(["no_response"]), "records with response status no_response"],
        F_FOLLOWUP_RESPONSE_PERCENT: [d.followups_response_rate, Number(d.followups_response_rate.percentage), d.followups_response_rate.measurement_family === "tabular_rate"
          && J(d.followups_response_rate.definition.population.map((c) => c.value_label)) === J(["yes"]), "answered / attempted, 2 dp"],
        F_SELF_REPORTED_PAID_WORK: [d.followups_paid_work, d.followups_paid_work.measured_value, J(categories(d.followups_paid_work)) === J(["started_paid_work"])
          && d.followups_paid_work.interpretation?.evidence_basis === "self_reported", "records reporting started paid work, self-reported"],
        F_REPORTED_PAID_WORK_AMONG_ANSWERS_PERCENT: [d.followups_paid_work_among_answers, Number(d.followups_paid_work_among_answers.percentage),
          J(d.followups_paid_work_among_answers.definition.population.map((c) => c.value_label)) === J(["answered"]), "started paid work / answered, 2 dp, self-reported"],
        F_SELF_REPORTED_ENTERED_TRAINING: [d.followups_entered_training, d.followups_entered_training.measured_value, J(categories(d.followups_entered_training)) === J(["entered_training"]), "records reporting entered training"],
        F_SELF_REPORTED_STILL_SEEKING: [d.followups_still_seeking, d.followups_still_seeking.measured_value, J(categories(d.followups_still_seeking)) === J(["still_seeking"]), "records reporting still seeking"],
        F_REPORTED_UNKNOWN: [d.followups_unknown, d.followups_unknown.measured_value, J(categories(d.followups_unknown)) === J(["unknown"]), "records reporting unknown"],
      };
      for (const [tag, label] of [["DIG", "paired_field_6"], ["EMP", "paired_field_7"]]) {
        const m = d[label];
        const valid = m.calculation_method === "p1_xlsx_paired_baseline_followup_numeric_change_v1";
        Object.assign(newActuals, {
          [`A_${tag}_PAIRS`]: [m, m.denominator, valid, "persisted same-version comparable pairs"],
          [`A_${tag}_INCREASED`]: [m, m.numerator, valid, "persisted numerically higher follow-ups"],
          [`A_${tag}_UNCHANGED`]: [m, m.component_counts.unchanged_count, valid, "persisted equal follow-ups"],
          [`A_${tag}_DECREASED`]: [m, m.component_counts.decreased_count, valid, "persisted numerically lower follow-ups"],
          [`A_${tag}_INCREASE_PERCENT`]: [m, Number(m.percentage), valid, "persisted increased / comparable pairs, 2 dp"],
        });
      }
      const blocks = report.generation.derived_evidence_summary.blocks;
      report.comparison_derived = Object.entries(expected).map(([id, row]) => {
        const baseline = report.comparison.find((c) => c.metric_id === id);
        const actual = newActuals[id];
        if (!actual) return { ...baseline, capability: "baseline" };
        const [m, value, methodValid, how] = actual;
        const block = m.claim_id ? blocks.find((b) => b.claim_id === m.claim_id) : null;
        const expectedValue = Number(row.expected_value);
        return {
          metric_id: id, expected: expectedValue, actual: value, difference: value === expectedValue && methodValid ? "match" : value === expectedValue ? "number_matches_method_differs" : "incorrect",
          baseline_difference: baseline?.difference ?? null, capability: "derived_measurement", calculation: how, method_valid: methodValid,
          calculation_method: m.calculation_method, population_and_period: m.definition.conditions ?? null, population: m.definition.population ?? null,
          denominator: m.denominator, exclusions: m.exclusions, source_version_id: m.source_version_id, worksheet_key: m.worksheet_key, persisted: m.persisted === true,
          evidence_item_id: m.evidence?.evidence_item_id ?? m.evidence?.at?.(-1)?.evidence_item_id ?? null, claim_id: m.claim_id ?? null,
          cited_finding: block ? block.text.includes(String(m.measured_value)) : null, limitation_codes: m.limitation_codes ?? null,
        };
      });
      const tally = (rows) => rows.reduce((acc, c) => ({ ...acc, [c.difference]: (acc[c.difference] ?? 0) + 1 }), {});
      report.comparison_tally = { baseline: tally(report.comparison), derived: tally(report.comparison_derived) };
      console.log(`Cedar Bridge comparison tally: ${J(report.comparison_tally)}`);
      for (const id of Object.keys(newActuals)) {
        const row = report.comparison_derived.find((c) => c.metric_id === id);
        assert.equal(row.difference, "match", `${id}: ${J(row)}`);
        assert.equal(row.persisted, true, id);
      }
      // The baseline comparison is preserved exactly: the record count's 4 is still a different definition of duplicates.
      assert.equal(report.comparison.find((c) => c.metric_id === "E_EXACT_DUPLICATE_ROWS").difference, "different_definition");
      // Not claimed here: eligible encounters and distinct served people need the register join.
      for (const id of ["E_ELIGIBLE_FY_COMPLETED_ENCOUNTERS", "E_DISTINCT_SERVED_PEOPLE"]) assert.equal(report.comparison_derived.find((c) => c.metric_id === id).difference, "unavailable");
    });

    // -------------------------------------------------------------------------
    // Cross-source linked reach: the uploaded service events linked to the
    // uploaded participant register, through the authorized reconciliation
    // worker, persisted as governed derived measurements with both versions.
    const CROSS = {};
    const crossLabels = ["reach_encounters", "reach_people", "reach_DS_encounters", "reach_DS_people", "reach_EN_encounters", "reach_EN_people", "reach_both"];
    const labelOf = (m) => {
      const d = m.definition;
      if (d.metric === "eligible_linked_encounters") return "reach_encounters";
      if (d.metric === "distinct_people_served") return "reach_people";
      if (d.metric === "people_in_more_than_one_group") return "reach_both";
      return `reach_${d.group.value_label}_${d.metric === "group_linked_encounters" ? "encounters" : "people"}`;
    };
    let crossMapping = null;
    // Waits for the post-commit dispatch, then reads the job through its route.
    const settleReconciliation = async (queued, api = adminApi) => {
      await reconciliationDispatcher.whenIdle();
      const read = await api("GET", crossSourceReconciliationJobPath(ORG, queued.body.data.reconciliationJob.reconciliation_job_id));
      return { status: read.status, job: read.body?.data?.reconciliationJob ?? null, measurements: read.body?.data?.measurements ?? [] };
    };
    await test("18: cross-source reach - the administrator maps both uploaded sources' fields; KAI reconciles their bytes and persists both-source measurements", async () => {
      const eventsBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
      const registerBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.register.sourceVersionId));
      assert.deepEqual([eventsBasis.status, registerBasis.status], [200, 200]);
      const fieldAt = (basis, position, role) => {
        const field = basis.body.data.tabular.fields.find((candidate) => candidate.column_position === position);
        assert.equal(field?.role, role, `column ${position} is proposed as ${role}`);
        return field;
      };
      const status = fieldAt(eventsBasis, 6, "categorical");
      const programme = fieldAt(eventsBasis, 3, "categorical");
      assert.deepEqual(programme.values.map((v) => v.label), ["DS", "EN"]);
      // A person's confirmation of what each field means; no answer-key value is an input.
      crossMapping = {
        events: {
          event_identifier_field_key: fieldAt(eventsBasis, 1, "identifier").field_key,
          participant_identifier_field_key: fieldAt(eventsBasis, 2, "identifier").field_key,
          status_field_key: status.field_key,
          completed_value_key: status.values.find((v) => v.label === "completed").value_key,
          date_field_key: fieldAt(eventsBasis, 4, "date").field_key,
          group_field_key: programme.field_key,
        },
        register: { participant_identifier_field_key: fieldAt(registerBasis, 1, "identifier").field_key },
      };
      report.human_supplied_semantics.cross_source_mapping = {
        mapping: crossMapping,
        meaning: "Human-stated for this synthetic acceptance: event_id identifies one service event; participant_id is the register's participant identifier; "
          + "delivery_status completed means the service was delivered; service_date is the event date; program_code is the event's programme.",
      };
      // Gap A on the real sources: fields whose headers name a person or free text keep no labels.
      const withheld = eventsBasis.body.data.tabular.fields.filter((f) => f.vocabulary_withheld).map((f) => [f.column_position, f.vocabulary_withheld]);
      report.derived_measurements.cross_source_withheld_vocabularies = { events: withheld,
        register: registerBasis.body.data.tabular.fields.filter((f) => f.vocabulary_withheld).map((f) => [f.column_position, f.vocabulary_withheld]) };

      const post = (body, api = adminApi) => api("POST", crossSourceMeasurementsPath(ORG), body);
      const body = (patch = {}) => ({ primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.register.sourceVersionId, mapping: crossMapping, ...patch });
      const withEvents = (patch) => body({ mapping: { ...crossMapping, events: { ...crossMapping.events, ...patch } } });
      const refusals = {
        outsider: await post(body(), outsiderApi),
        same_version: await post(body({ reference_source_version_id: state.events.sourceVersionId })),
        workbook_as_register: await post(body({ reference_source_version_id: state.workbook.sourceVersionId })),
        category_as_event_identifier: await post(withEvents({ event_identifier_field_key: fieldAt(eventsBasis, 8, "categorical").field_key })),
        unlisted_completed_value: await post(withEvents({ completed_value_key: "value_99" })),
        typed_answer: await post(body({ mapping: { ...crossMapping, expected_people: 80 } })),
        ...(withheld.length > 0 ? { withheld_group: await post(withEvents({ group_field_key: eventsBasis.body.data.tabular.fields.find((f) => f.column_position === withheld[0][0]).field_key })) } : {}),
      };
      report.derived_measurements.cross_source_refusals = Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, [v.status, blockersOf(v)]]));
      assert.ok(refusals.outsider.status >= 400 && refusals.outsider.status < 500);
      assert.deepEqual(report.derived_measurements.cross_source_refusals.same_version, [422, ["cross_source_same_version"]]);
      assert.deepEqual(report.derived_measurements.cross_source_refusals.workbook_as_register, [422, ["cross_source_source_not_csv"]]);
      assert.deepEqual(report.derived_measurements.cross_source_refusals.category_as_event_identifier, [422, ["cross_source_field_role_not_proposed"]]);
      assert.deepEqual(report.derived_measurements.cross_source_refusals.unlisted_completed_value, [422, ["cross_source_value_not_listed"]]);
      assert.deepEqual(report.derived_measurements.cross_source_refusals.typed_answer, [422, ["cross_source_mapping_invalid"]]);
      if (refusals.withheld_group) assert.deepEqual(report.derived_measurements.cross_source_refusals.withheld_group, [422, ["cross_source_group_vocabulary_withheld"]]);

      // The request reads no byte: it is admitted and queued (202); the worker commits.
      const queued = await post(body());
      assert.equal(queued.status, 202, J(queued.body));
      assert.equal(queued.body.data.reconciliationJob.job_state, "queued");
      assert.deepEqual(await query("SELECT count(*)::int AS n FROM kai.source_derived_measurements WHERE measurement_family = 'cross_source_reach'"), [{ n: 0 }],
        "nothing is calculated inside the HTTP request");
      const recorded = await settleReconciliation(queued);
      assert.deepEqual([recorded.status, recorded.job.job_state, recorded.job.error_code], [200, "succeeded", null], J(recorded));
      assert.equal(recorded.measurements.length, 7);
      assert.doesNotMatch(J(recorded), /CB\d{3}|EV\d{4}/, "no participant or event identifier in the response");
      assert.doesNotMatch(J(queued.body), /claim_token|requested_by/, "the job's claim and requester stay in the worker");
      report.derived_measurements.cross_source_job = { queued: queued.body.data.reconciliationJob, settled: recorded.job };

      // Independent decisions from the original bytes, sharing no code with KAI.
      const events = parseCsv(byKey.events.bytes.toString("utf8"));
      const registerIds = new Set(parseCsv(byKey.register.bytes.toString("utf8")).map((r) => r.participant_id));
      const rowsById = new Map();
      events.forEach((r, index) => rowsById.set(r.event_id, [...(rowsById.get(r.event_id) || []), { ...r, row: index + 2 }]));
      const firsts = [...rowsById.values()].map((copies) => copies[0]);
      const completed = firsts.filter((r) => r.delivery_status === "completed");
      const inFy = completed.filter((r) => r.service_date >= "2025-04-01" && r.service_date <= "2026-03-31");
      const eligible = inFy.filter((r) => registerIds.has(r.participant_id));
      const independent = {
        excess_rows: [...rowsById.values()].flatMap((copies) => copies.slice(1).map((r) => r.row)),
        outside_rows: completed.filter((r) => !inFy.includes(r)).map((r) => r.row),
        unmatched_rows: inFy.filter((r) => !registerIds.has(r.participant_id)).map((r) => r.row),
        people: new Set(eligible.map((r) => r.participant_id)).size,
      };
      for (const entry of recorded.measurements) {
        const label = labelOf(entry);
        CROSS[label] = { measurementId: entry.source_derived_measurement_id, evidenceItemId: entry.evidence.find((e) => e.current).evidence_item_id };
        const [row] = (await derivedRows(state.events.sourceVersionId)).filter((r) => r.source_derived_measurement_id === CROSS[label].measurementId);
        const sources = await query(
          `SELECT source_role, source_version_id::text, profile_canonical_sha256, field_keys FROM kai.source_derived_measurement_sources
            WHERE source_derived_measurement_id = $1::uuid ORDER BY source_role`, [CROSS[label].measurementId]);
        const [evidence] = await evidenceOf(CROSS[label].measurementId);
        report.derived_measurements[label] = { kind: row.measurement_family, persisted: true, source: `${byKey.events.name} + ${byKey.register.name}`,
          source_version_id: state.events.sourceVersionId, contributing_sources: sources, ...row, evidence };
        // Both versions, each bound to the profile it was promoted from.
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", state.events.sourceVersionId], ["reference", state.register.sourceVersionId]]);
        assert.equal(sources[0].profile_canonical_sha256, await versionSha(state.events.sourceVersionId));
        assert.equal(sources[1].profile_canonical_sha256, await versionSha(state.register.sourceVersionId));
        assert.equal(row.definition.reference_source_version_id, state.register.sourceVersionId);
        assert.deepEqual([evidence.evidence_type, evidence.data_class, evidence.locator_type], ["source_derived_measurement", "source_derived_aggregate", "source_derived_measurement_fields"]);
        assert.ok(evidence.statement.includes(state.register.sourceVersionId), `${label}: the statement cites the register version`);
        // Inclusion and exclusion decisions, not just totals.
        assert.deepEqual(row.exclusions.excess_duplicate_copies.rows, independent.excess_rows, label);
        assert.deepEqual(row.exclusions.completed_outside_period.rows, independent.outside_rows, label);
        assert.deepEqual(row.exclusions.unmatched_participant_identifier.rows, independent.unmatched_rows, label);
        assert.deepEqual(row.definition.period, { period_source: "engagement_reporting_period", period_start: "2025-04-01", period_end: "2026-03-31", precision: "day" });
      }
      const value = (label) => report.derived_measurements[label].measured_value;
      const funnel = report.derived_measurements.reach_people.component_counts;
      report.derived_measurements.cross_source_funnel = funnel;
      // The required independent acceptance values, as test oracles only.
      assert.deepEqual([funnel.distinct_event_count, funnel.completed_event_count, funnel.completed_outside_period_count, funnel.in_period_completed_event_count, funnel.unmatched_event_count],
        [244, 228, 5, 223, 1]);
      assert.deepEqual(crossLabels.map(value), [222, 80, 118, 51, 104, 39, 10]);
      assert.equal(value("reach_people"), independent.people);
      assert.deepEqual([funnel.physical_record_count, funnel.duplicate_group_count, funnel.duplicate_member_record_count, funnel.excess_copy_record_count, funnel.conflicting_event_identity_count],
        [246, 2, 4, 2, 0]);

      // Replay writes nothing; the audit is metadata-only.
      const before = await writeCounts();
      const replay = await post(body());
      assert.deepEqual([replay.status, replay.body.data.fresh, replay.body.data.reconciliationJob.job_state, replay.body.data.reconciliationJob.reconciliation_job_id],
        [202, false, "succeeded", queued.body.data.reconciliationJob.reconciliation_job_id], "a repeated request reads the same settled job");
      await reconciliationDispatcher.whenIdle();
      assert.deepEqual(await writeCounts(), before);
      // No audit row of the organization holds an identifier or a cell value.
      const audits = await query("SELECT * FROM kai.audit_events WHERE organization_id = $1::uuid", [ORG]);
      assert.ok(audits.some((row) => J(row).includes("record_source_derived_measurement")), "the cross-source write is audited");
      assert.doesNotMatch(J(audits), /CB\d{3}|EV\d{4}|"completed"|participant_id/);

      // The meaning of each measurement is stated by a person through the existing interpretation route.
      const MEANINGS = {
        reach_encounters: ["Eligible service encounters", "completed, deduplicated service events in the reporting period linked to a registered participant; encounters, not people."],
        reach_people: ["People served", "distinct registered participants with at least one eligible service encounter."],
        reach_DS_encounters: ["Digital Skills encounters", "eligible service encounters recorded under programme DS."],
        reach_DS_people: ["Digital Skills people served", "distinct registered participants with an eligible DS encounter."],
        reach_EN_encounters: ["Employment Navigation encounters", "eligible service encounters recorded under programme EN."],
        reach_EN_people: ["Employment Navigation people", "distinct registered participants with an eligible EN encounter."],
        reach_both: ["People served in both programmes", "registered participants with eligible encounters in both DS and EN."],
      };
      for (const label of crossLabels) {
        const [indicatorLabel, meaning] = MEANINGS[label];
        const stated = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CROSS[label].measurementId),
          { indicator_label: indicatorLabel, meaning_text: `Human-stated for this synthetic acceptance: ${meaning}`, evidence_basis: "organization_record" });
        assert.equal(stated.status, 200, `${label}: ${J(stated.body)}`);
        CROSS[label].evidenceItemId = stated.body.data.evidenceItem.evidence_item_id;
        report.derived_measurements[label].interpretation = stated.body.data.interpretation;
        report.derived_measurements[label].evidence = (await evidenceOf(CROSS[label].measurementId)).at(-1);
        assert.equal(report.derived_measurements[label].measured_value, stated.body.data.measurement.measured_value, "a meaning never changes the count");
      }
      report.human_supplied_semantics.cross_source = MEANINGS;
      stage("events", "cross_source_reach", "7 measurements persisted with the register", { reference_source_version_id: state.register.sourceVersionId });
      stage("register", "cross_source_reach:reference", "linked by the service events", { primary_source_version_id: state.events.sourceVersionId });
    });

    const activityOriginal = {};
    await test("18b: original-source monthly activity and recorded duration are persisted with both-source lineage", async () => {
      const basis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
      assert.equal(basis.status, 200);
      assert.ok(basis.body.data.tabular.duration_field_candidates.some((field) => field.field_key === "field_7" && field.column_position === 7));
      const mapping = { ...crossMapping, duration: { field_key: "field_7", meaning: "recorded_service_duration", unit: "minutes" } };
      const body = { primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.register.sourceVersionId, mapping };
      const bad = await adminApi("POST", crossSourceMeasurementsPath(ORG), { ...body, mapping: { ...mapping, duration: { ...mapping.duration, unit: "hours" } } });
      assert.equal(bad.status, 422);
      const queued = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.equal(queued.status, 202, J(queued.body));
      const recorded = await settleReconciliation(queued);
      assert.deepEqual([recorded.status, recorded.job.job_state, recorded.job.error_code], [200, "succeeded", null], J(recorded));
      const monthly = recorded.measurements.find((m) => m.definition.metric === "monthly_eligible_encounters");
      const duration = recorded.measurements.find((m) => m.definition.metric === "known_recorded_service_minutes");
      assert.ok(monthly && duration, J(recorded));
      const monthlyOnlyJob = await adminApi("POST", crossSourceMeasurementsPath(ORG), { ...body, mapping: { ...crossMapping, monthly_activity: true } });
      assert.equal(monthlyOnlyJob.status, 202, J(monthlyOnlyJob.body));
      const monthlyOnly = await settleReconciliation(monthlyOnlyJob);
      assert.equal(monthlyOnly.job.job_state, "succeeded", J(monthlyOnly));
      assert.equal(monthlyOnly.measurements.length, 1);
      assert.deepEqual(monthlyOnly.measurements[0].component_counts.monthly_activity, monthly.component_counts.monthly_activity);
      // An independent reading of the original bytes, before comparison to the supplied expectations.
      const events = parseCsv(byKey.events.bytes.toString("utf8"));
      const register = new Set(parseCsv(byKey.register.bytes.toString("utf8")).map((r) => r.participant_id));
      const copies = new Map();
      for (const event of events) copies.set(event.event_id, [...(copies.get(event.event_id) || []), event]);
      const eligible = [...copies.values()].filter((list) => new Set(list.map((r) => JSON.stringify([r.participant_id, r.delivery_status, r.service_date, r.program_code]))).size === 1)
        .map((list) => list[0]).filter((r) => r.delivery_status === "completed" && r.service_date >= "2025-04-01" && r.service_date <= "2026-03-31" && register.has(r.participant_id));
      const byMonth = new Map();
      for (const event of eligible) byMonth.set(event.service_date.slice(0, 7), (byMonth.get(event.service_date.slice(0, 7)) || 0) + 1);
      const independentMonths = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, encounter_count]) => ({ month, encounter_count }));
      const known = eligible.filter((event) => event.duration_minutes.trim() !== "");
      const independentMinutes = known.reduce((sum, event) => sum + Number(event.duration_minutes), 0);
      assert.deepEqual(monthly.component_counts.monthly_activity, independentMonths);
      assert.deepEqual([monthly.measured_value, duration.measured_value, duration.component_counts.duration_missing_count, duration.component_counts.duration_invalid_count, duration.component_counts.known_recorded_minutes],
        [eligible.length, known.length, eligible.length - known.length, 0, String(independentMinutes)]);
      assert.equal(monthly.measured_value, report.derived_measurements.reach_encounters.measured_value);
      assert.deepEqual(independentMonths.map((m) => [m.month, m.encounter_count]), [["2025-04", 1], ["2025-05", 5], ["2025-06", 1], ["2025-07", 7], ["2025-08", 12], ["2025-09", 14], ["2025-10", 18], ["2025-11", 20], ["2025-12", 36], ["2026-01", 31], ["2026-02", 35], ["2026-03", 42]]);
      assert.deepEqual([eligible.length, known.length, independentMinutes], [222, 219, 16755]);
      for (const entry of [monthly, duration]) {
        const [row] = (await derivedRows(state.events.sourceVersionId)).filter((r) => r.source_derived_measurement_id === entry.source_derived_measurement_id);
        const sources = await query("SELECT source_role, source_version_id::text, field_keys FROM kai.source_derived_measurement_sources WHERE source_derived_measurement_id = $1::uuid ORDER BY source_role", [entry.source_derived_measurement_id]);
        const [evidence] = await evidenceOf(entry.source_derived_measurement_id);
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", state.events.sourceVersionId], ["reference", state.register.sourceVersionId]]);
        assert.ok(sources[0].field_keys.includes("field_7"));
        assert.equal(evidence.evidence_type, "source_derived_measurement");
        assert.ok(evidence.statement.includes(state.register.sourceVersionId));
        assert.deepEqual(row.definition.period, { period_source: "engagement_reporting_period", period_start: "2025-04-01", period_end: "2026-03-31", precision: "day" });
        const stated = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, entry.source_derived_measurement_id),
          { indicator_label: entry === monthly ? "Monthly eligible encounters" : "Known recorded minutes", meaning_text: "Human-stated recorded service activity in the reporting period.", evidence_basis: "organization_record" });
        assert.equal(stated.status, 200, J(stated.body));
        const proposed = await adminApi("POST", claimProposalPath(ORG, stated.body.data.evidenceItem.evidence_item_id), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        const traced = await gkApi("GET", claimTraceabilityPath(ORG, proposed.body.data.claim.claim_id, "internal"));
        assert.equal(traced.body?.data?.eligible, false, "ordinary review and both-source sensitivity still apply");
        const evidenceId = stated.body.data.evidenceItem.evidence_item_id;
        const claimId = proposed.body.data.claim.claim_id;
        activityOriginal[entry.definition.metric] = { measurement: entry, evidenceId, claimId };
        const queue = async (kind, id) => (await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid", [ORG, kind, id]))[0];
        const evidenceQueue = await queue("evidence_review", evidenceId);
        const evidenceReview = await gkApi("POST", evidenceReviewCompletePath(ORG, evidenceId, evidenceQueue.review_queue_item_id), evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        assert.equal(evidenceReview.status, 200, J(evidenceReview.body));
        const claimQueue = await queue("claim_review", claimId);
        const claimReview = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id), claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        assert.equal(claimReview.status, 200, J(claimReview.body));
        let after = await gkApi("GET", claimTraceabilityPath(ORG, claimId, "internal"));
        for (const [key, dimension] of Object.entries(after.body?.data?.dimensions || {})) if (dimension.assessment_status === "unresolved") await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, key), {});
        after = await gkApi("GET", claimTraceabilityPath(ORG, claimId, "internal"));
        assert.equal(after.body?.data?.eligible, true, J(after.body));
        const funder = await gkApi("GET", claimTraceabilityPath(ORG, claimId, "funder"));
        assert.equal(funder.body?.data?.eligible, false);
      }
      const before = await writeCounts();
      const replay = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.deepEqual([replay.status, replay.body.data.fresh, replay.body.data.reconciliationJob.reconciliation_job_id], [202, false, queued.body.data.reconciliationJob.reconciliation_job_id]);
      await reconciliationDispatcher.whenIdle();
      assert.deepEqual(await writeCounts(), before);
      report.derived_measurements.monthly_activity = { months: independentMonths, total: eligible.length, measurement_id: monthly.source_derived_measurement_id };
      report.derived_measurements.recorded_duration = { known: known.length, missing: eligible.length - known.length, invalid: 0, minutes: independentMinutes, measurement_id: duration.source_derived_measurement_id };
    });

    const crossClaims = {};
    await test("19: cross-source claims, P2-06 traceability and Get Kinder's existing review; both sources' sensitivity decisions govern", async () => {
      const trace = async (claimId, audience = "internal") => {
        const traced = await gkApi("GET", claimTraceabilityPath(ORG, claimId, audience));
        return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, reason: traced.body?.data?.traceability_conflict_reason ?? null,
          blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced),
          unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort() };
      };
      const queueOf = async (queueType, targetId) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
        [ORG, queueType, targetId]))[0];
      for (const label of crossLabels) {
        const proposed = await adminApi("POST", claimProposalPath(ORG, CROSS[label].evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
        const claimId = proposed.body.data.claim.claim_id;
        const initial = await trace(claimId);
        assert.equal(initial.eligible, false, `${label}: personal information present in both sources needs Get Kinder review first`);
        const evidenceQueue = await queueOf("evidence_review", CROSS[label].evidenceItemId);
        const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG, CROSS[label].evidenceItemId, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        const claimQueue = await queueOf("claim_review", claimId);
        const claim = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        for (const dimensionKey of (await trace(claimId)).unresolved) await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimensionKey), {});
        const after = await trace(claimId);
        assert.equal(after.eligible, true, `${label}: ${J(after)}`);
        const funder = await trace(claimId, "funder");
        const pub = await trace(claimId, "public");
        assert.deepEqual([funder.eligible, pub.eligible], [false, false]);
        const [row] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        assert.ok(row.statement.includes(String(report.derived_measurements[label].measured_value)) && row.statement.includes(state.register.sourceVersionId), row.statement);
        if (label.endsWith("encounters")) assert.match(row.statement, /\(encounters, not people\)/);
        crossClaims[label] = claimId;
        report.claims[`cross:${label}`] = { claim_id: claimId, evidence_item_id: CROSS[label].evidenceItemId, statement: row.statement,
          traceability_initial: initial, gk_review: [evidence.status, claim.status], traceability_after_review: after };
      }
      // The existing single-source and paired claims are unchanged and still eligible.
      for (const label of DERIVED_CLAIM_LABELS) assert.equal((await trace(derivedClaims[label])).eligible, true, label);
    });

    let crossDraftId = null;
    await test("20: an internal Evidence Summary cites the cross-source and existing derived findings; Get Kinder's review packet cites both source versions", async () => {
      // The existing findings re-cited for regression; the generator's total text limit bounds one draft.
      const REGRESSION_LABELS = ["paired_field_6", "events_completed"];
      const labels = [...crossLabels, ...REGRESSION_LABELS];
      const claimIds = labels.map((label) => crossClaims[label] ?? derivedClaims[label]);
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: claimIds, idempotency_key: `cedar-cross-${randomUUID()}`, engagement_id: PROJECT });
      assert.equal(created.status, 201, J(created.body));
      crossDraftId = created.body.data.generatedContentDraftId;
      const blocks = await query(
        `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [crossDraftId]);
      assert.equal(blocks.length, labels.length);
      const call = modelCalls.at(-1);
      for (const label of crossLabels) {
        const block = blocks.find((b) => b.claim_id === crossClaims[label]);
        assert.equal(block.evidence_item_id, CROSS[label].evidenceItemId);
        assert.ok(block.text.includes(String(report.derived_measurements[label].measured_value)), block.text);
        assert.match(block.text, /linked to the participant register by matching identifier values exactly/);
        if (label.endsWith("encounters")) assert.match(block.text, /This counts service encounters, not people/);
        else assert.match(block.text, /counted once/);
        const sent = call.claims.find((c) => c.claimId === crossClaims[label]);
        assert.ok(sent.limitationCodes.includes("derived.cross_source_linked") && sent.limitationCodes.includes("derived.unmatched_identifiers_excluded"), J(sent.limitationCodes));
        Object.assign(report.derived_measurements[label], { claim_id: crossClaims[label], limitation_codes: sent.limitationCodes, generated_finding: block.text });
      }
      // The existing findings keep their numbers and citations.
      for (const label of REGRESSION_LABELS) {
        const block = blocks.find((b) => b.claim_id === derivedClaims[label]);
        assert.ok(block.text.includes(String(report.derived_measurements[label].measured_value)), label);
        assert.equal(block.evidence_item_id, derivedEvidenceItemId(label), label);
      }
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/, "no participant, event or follow-up identifier reaches the model");
      const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${crossDraftId}/review-packet`);
      assert.equal(packet.status, 200, J(packet.body));
      // Structured lineage: every cross-source citation names both contributing versions; a single-source one names none.
      const packetCitations = packet.body.data.blocks.flatMap((block) => block.citations);
      for (const label of crossLabels) {
        const citation = packetCitations.find((c) => c.claimId === crossClaims[label]);
        assert.deepEqual(citation.contributingSources.map((c) => [c.sourceRole, c.sourceVersionId, c.isCurrent]),
          [["primary", state.events.sourceVersionId, true], ["reference", state.register.sourceVersionId, true]], label);
      }
      for (const label of REGRESSION_LABELS) assert.equal(packetCitations.find((c) => c.claimId === derivedClaims[label]).contributingSources, undefined, label);
      const clientMarkdown = await readOwnInternalMarkdown(crossDraftId);
      report.generation.cross_source_evidence_summary = { status: created.status, draft_id: crossDraftId, blocks, review_packet: packet.status, client_internal_markdown: [clientMarkdown.status, blockersOf(clientMarkdown)] };
      const crossMarkdown = assertOwnInternalMarkdownSafe(clientMarkdown);
      for (const sourceVersionId of [state.events.sourceVersionId, state.register.sourceVersionId]) assert.ok(crossMarkdown.includes(sourceVersionId), "both contributing versions are cited");
    });

    await test("21: delivery of the cross-source findings through Get Kinder's existing review and release path to the client route", async () => {
      const draftPath = `${orgPath}/generated-content-drafts/${crossDraftId}`;
      const delivery = { draft_id: crossDraftId };
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      try {
        const queueOf = async (queueType) => (await query(
          "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid ORDER BY created_at DESC",
          [ORG, queueType, crossDraftId]))[0];
        const contentQueue = await queueOf("generated_content_review");
        const started = await gkApi("POST", generatedContentReviewStartPath(ORG, crossDraftId, contentQueue.review_queue_item_id), { expected_updated_at: new Date(contentQueue.updated_at).toISOString() });
        const inProgress = await queueOf("generated_content_review");
        const completed = await gkApi("POST", generatedContentReviewCompletePath(ORG, crossDraftId, inProgress.review_queue_item_id), { expected_updated_at: new Date(inProgress.updated_at).toISOString() });
        delivery.gk_content_review = [started.status, completed.status];
        const requested = await gkAdminApi("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" });
        delivery.export_review_request = requested.status;
        for (const step of ["start", "complete"]) {
          const queue = await queueOf("export_review");
          delivery[`export_review_${step}`] = (await gkAdminApi("POST", `${draftPath}/export-review-queue/${queue.review_queue_item_id}/${step}`, { expected_updated_at: new Date(queue.updated_at).toISOString() })).status;
        }
        const exportReviewQueueItemId = (await queueOf("export_review")).review_queue_item_id;
        delivery.limitation_snapshot = (await gkApi("POST", `${draftPath}/limitation-snapshot`, {})).status;
        const entries = await query(
          `SELECT e.claim_id::text, e.limitation_codes FROM kai.limitation_snapshot_entries e
             JOIN kai.limitation_snapshots s ON s.limitation_snapshot_id = e.limitation_snapshot_id
            WHERE s.organization_id = $1::uuid AND s.generated_content_draft_id = $2::uuid`, [ORG, crossDraftId]);
        delivery.export_candidate = (await gkAdminApi("POST", `${draftPath}/export-candidates`, {})).status;
        const [candidateRow] = await query("SELECT export_candidate_id::text FROM kai.export_candidates WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid", [ORG, crossDraftId]);
        delivery.final_release_authority = (await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/final-release-authority`, { requested_audience: "internal", decision_action: "grant" })).status;
        delivery.export_manifest = (await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/export-manifests`, { export_review_queue_item_id: exportReviewQueueItemId })).status;
        const [manifestRow] = await query("SELECT export_manifest_id::text FROM kai.export_manifests WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid", [ORG, candidateRow.export_candidate_id]);
        const released = await adminApi("GET", clientReleasedReportMarkdownPath(ORG, PROJECT, manifestRow.export_manifest_id));
        delivery.client_released_markdown = released.status;
        assert.equal(released.status, 200, J(delivery));
        for (const label of crossLabels) {
          assert.ok(released.body.includes(crossClaims[label]), `${label} is in the released document`);
          const entry = entries.find((candidate) => candidate.claim_id === crossClaims[label]);
          assert.deepEqual(entry?.limitation_codes, report.derived_measurements[label].limitation_codes, `${label}: the released snapshot carries the generation codes`);
        }
        assert.ok(released.body.includes(state.register.sourceVersionId), "the released document cites the register version through each claim");
        assert.ok(released.body.includes(state.events.sourceVersionId), "and the service-event version");
        // Structured citations, not only claim text: each cross-source citation lists both contributing versions.
        const contributingLines = released.body.split("\n").filter((line) => line.includes("Contributing "));
        assert.equal(contributingLines.filter((line) => line.includes(`Contributing reference source`) && line.includes(state.register.sourceVersionId)).length, crossLabels.length, J(contributingLines));
        assert.equal(contributingLines.filter((line) => line.includes(`Contributing primary source`) && line.includes(state.events.sourceVersionId)).length, crossLabels.length);
        // A3: the CSV evidence appendix names both contributing versions too, in its existing columns.
        const csv = await gkAdminApi("GET", `${orgPath}/export-manifests/${manifestRow.export_manifest_id}/csv`);
        delivery.csv_rows = csvRowsByClaim(csv);
        for (const label of crossLabels) assert.equal(delivery.csv_rows[crossClaims[label]], `${state.events.sourceVersionId};${state.register.sourceVersionId}`, label);
        const singleSource = Object.entries(delivery.csv_rows).filter(([claimId]) => !Object.values(crossClaims).includes(claimId));
        assert.ok(singleSource.length > 0 && singleSource.every(([, versions]) => !versions.includes(";")), J(singleSource));
        state.stageAReleasedManifestId = manifestRow.export_manifest_id;
        state.stageAReleasedMarkdown = released.body;
        assert.doesNotMatch(released.body, /CB0\d\d|EV0\d\d/);
        delivery.released_excerpt = released.body.slice(0, 3000);
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
      report.generation.cross_source_delivery = delivery;
      assert.deepEqual([delivery.gk_content_review, delivery.export_review_request, delivery.export_review_start, delivery.export_review_complete,
        delivery.limitation_snapshot, delivery.export_candidate, delivery.final_release_authority, delivery.export_manifest], [[200, 200], 201, 200, 200, 201, 201, 201, 201], J(delivery));
    });

    await test("22: changing either source's effective allowed use or currentness blocks continued use; restoring it restores use", async () => {
      const claimId = crossClaims.reach_people;
      const singleSource = derivedClaims.events_distinct;
      const trace = async (id) => {
        const traced = await gkApi("GET", claimTraceabilityPath(ORG, id, "internal"));
        return [traced.status, traced.body?.data?.traceability_conflict_reason ?? null, traced.body?.data?.eligible ?? null];
      };
      const generate = async (ids) => {
        const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: ids, idempotency_key: `cedar-stale-${randomUUID()}`, engagement_id: PROJECT });
        return [created.status, blockersOf(created)];
      };
      const recordAgain = async () => (await adminApi("POST", crossSourceMeasurementsPath(ORG), {
        primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.register.sourceVersionId, mapping: crossMapping })).status;
      const interpret = async () => (await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CROSS.reach_people.measurementId),
        { indicator_label: "People served again", meaning_text: "Human-stated for this synthetic acceptance: a later restatement.", evidence_basis: "organization_record" })).status;
      const negative = {};
      // Allowed use: the administrator reviews the register's processing
      // permissions again through the existing Review Cockpit routes
      // (review-work, then a decision that supersedes the current one).
      const reviewAgain = async (allowed) => {
        const profileId = state.register.sensitivity.intake_sensitivity_profile_id;
        const work = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${ORG}`, {});
        const [queue] = await query(
          `SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
            WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid ORDER BY created_at DESC LIMIT 1`, [ORG, profileId]);
        const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${ORG}`, {
          expected_updated_at: new Date(queue.updated_at).toISOString(), review_queue_item_id: queue.review_queue_item_id, decision: "reviewed",
          reviewed_snapshot: { ...DECISIONS.register, reviewed_allowed_use_status: allowed ? "allowed" : "not_allowed", reviewed_llm_processing_allowed: allowed },
        });
        return [work.status, decided.status, blockersOf(decided)];
      };
      const successor = async (allowed) => {
        const result = await reviewAgain(allowed);
        negative[`review_${allowed ? "allowed" : "not_allowed"}`] = result;
        assert.ok([200, 201].includes(result[0]) && result[1] === 200, `review processing permissions again: ${J(result)}`);
      };
      await successor(false);
      negative.register_not_allowed = { traceability: await trace(claimId), generation: await generate([claimId]), record: await recordAgain(), interpret: await interpret(),
        single_source_events_claim: await trace(singleSource) };
      await successor(true);
      negative.register_allowed_again = { traceability: await trace(claimId) };
      // Currentness: no application path supersedes a promoted version yet,
      // so each version is marked not current in this disposable database
      // (as the existing acceptances do), then restored.
      for (const key of ["register", "events"]) {
        await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [state[key].sourceVersionId]);
        negative[`${key}_not_current`] = { traceability: await trace(claimId), generation: await generate([claimId]), record: await recordAgain(), interpret: await interpret() };
        if (key === "register") negative.register_not_current.single_source_events_claim = await trace(singleSource);
        await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [state[key].sourceVersionId]);
      }
      negative.restored = { traceability: await trace(claimId), generation: (await generate([claimId]))[0] };
      report.derived_measurements.cross_source_invalidation = negative;
      console.log(`Cedar Bridge cross-source invalidation: ${J(negative)}`);
      assert.deepEqual(negative.register_not_allowed.traceability.slice(0, 2), [409, "derived_measurement_contributing_source_not_permitted"]);
      assert.ok(negative.register_not_allowed.generation[0] >= 400, J(negative.register_not_allowed.generation));
      assert.ok(negative.register_not_allowed.record >= 400 && negative.register_not_allowed.interpret >= 400);
      assert.equal(negative.register_not_allowed.single_source_events_claim[2], true, "a single-source events claim does not depend on the register");
      assert.equal(negative.register_allowed_again.traceability[2], true);
      assert.deepEqual(negative.register_not_current.traceability.slice(0, 2), [409, "derived_measurement_contributing_source_not_current"]);
      assert.deepEqual(negative.events_not_current.traceability.slice(0, 2), [409, "source_version_not_current"]);
      for (const key of ["register_not_current", "events_not_current"]) {
        assert.ok(negative[key].generation[0] >= 400 && negative[key].record >= 400 && negative[key].interpret >= 400, `${key}: ${J(negative[key])}`);
      }
      assert.equal(negative.register_not_current.single_source_events_claim[2], true);
      assert.deepEqual([negative.restored.traceability[2], negative.restored.generation], [true, 201]);
    });

    await test("23: the comparison with the answer key including cross-source reach, by method, both-source lineage, persistence, claim and finding", () => {
      const expected = Object.fromEntries(parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Metrics.csv"), "utf8")).map((row) => [row.metric_id, row]));
      const d = report.derived_measurements;
      const linked = (m) => m.calculation_method === "kai_cross_source_linked_reach_v1" && J(m.contributing_sources.map((s) => s.source_version_id)) === J([state.events.sourceVersionId, state.register.sourceVersionId])
        && m.definition.period.precision === "day" && m.definition.period.period_start === "2025-04-01" && m.definition.period.period_end === "2026-03-31";
      const isMetric = (m, metric, group = null) => linked(m) && m.definition.metric === metric && (m.definition.group?.value_label ?? null) === group;
      const crossActuals = {
        E_COMPLETED_IN_PERIOD_UNMATCHED: [d.reach_encounters, d.reach_encounters.component_counts.unmatched_event_count, linked(d.reach_encounters), "in-period completed events excluded for an unmatched identifier (persisted funnel component)"],
        E_ELIGIBLE_FY_COMPLETED_ENCOUNTERS: [d.reach_encounters, d.reach_encounters.measured_value, isMetric(d.reach_encounters, "eligible_linked_encounters"), "eligible linked encounters"],
        E_DISTINCT_SERVED_PEOPLE: [d.reach_people, d.reach_people.measured_value, isMetric(d.reach_people, "distinct_people_served"), "distinct register-linked participants"],
        E_ELIGIBLE_DS_ENCOUNTERS: [d.reach_DS_encounters, d.reach_DS_encounters.measured_value, isMetric(d.reach_DS_encounters, "group_linked_encounters", "DS"), "eligible encounters, programme DS"],
        E_ELIGIBLE_EN_ENCOUNTERS: [d.reach_EN_encounters, d.reach_EN_encounters.measured_value, isMetric(d.reach_EN_encounters, "group_linked_encounters", "EN"), "eligible encounters, programme EN"],
        E_DISTINCT_DS_SERVED: [d.reach_DS_people, d.reach_DS_people.measured_value, isMetric(d.reach_DS_people, "group_distinct_people_served", "DS"), "distinct people, programme DS"],
        E_DISTINCT_EN_SERVED: [d.reach_EN_people, d.reach_EN_people.measured_value, isMetric(d.reach_EN_people, "group_distinct_people_served", "EN"), "distinct people, programme EN"],
        E_DISTINCT_SERVED_BOTH: [d.reach_both, d.reach_both.measured_value, isMetric(d.reach_both, "people_in_more_than_one_group"), "people in both programmes, counted once"],
        // P01 was a register row count in the baseline; the reconciliation now persists the register's distinct identifiers.
        P01: [d.reach_people, d.reach_people.component_counts.register_distinct_identifier_count, linked(d.reach_people), "distinct register participant identifiers (persisted funnel component)"],
      };
      const blocks = report.generation.cross_source_evidence_summary.blocks;
      report.comparison_cross_source = Object.entries(expected).map(([id, row]) => {
        const previous = report.comparison_derived.find((c) => c.metric_id === id);
        const actual = crossActuals[id];
        if (!actual) return { ...previous };
        const [m, value, methodValid, how] = actual;
        const block = m.claim_id ? blocks.find((b) => b.claim_id === m.claim_id) : null;
        const expectedValue = Number(row.expected_value);
        return {
          metric_id: id, expected: expectedValue, actual: value, difference: value === expectedValue && methodValid ? "match" : value === expectedValue ? "number_matches_method_differs" : "incorrect",
          previous_difference: previous?.difference ?? null, capability: "cross_source_reach", calculation: how, method_valid: methodValid, calculation_method: m.calculation_method,
          contributing_sources: m.contributing_sources, period: m.definition.period, persisted: m.persisted === true, evidence_item_id: m.evidence?.evidence_item_id ?? null,
          claim_id: m.claim_id ?? null, cited_finding: block ? block.text.includes(String(m.measured_value)) : null, limitation_codes: m.limitation_codes ?? null,
        };
      });
      const tally = (rows) => rows.reduce((acc, c) => ({ ...acc, [c.difference]: (acc[c.difference] ?? 0) + 1 }), {});
      report.comparison_tally.cross_source = tally(report.comparison_cross_source);
      console.log(`Cedar Bridge comparison tally with cross-source reach: ${J(report.comparison_tally)}`);
      for (const id of Object.keys(crossActuals)) {
        const row = report.comparison_cross_source.find((c) => c.metric_id === id);
        assert.equal(row.difference, "match", `${id}: ${J(row)}`);
        assert.equal(row.persisted, true, id);
      }
      // Still unavailable: enrolment categories, durations, months (no grouping operation), means.
      for (const id of ["P02", "P03", "P04", "E_KNOWN_MINUTES_ELIGIBLE_EVENTS", "E_MONTH_2025-04"]) {
        assert.equal(report.comparison_cross_source.find((c) => c.metric_id === id).difference, "unavailable", id);
      }
    });


    // =========================================================================
    // Corrected-version challenge (Stages B-D): the package's corrected
    // service-events file, supplied as the next version of the same logical
    // source through the real intake, review, promotion and worker paths.
    // =========================================================================
    const CORRECTED_PATH = join(PACKAGE, "02_CHALLENGE_UPLOAD_LATER", "03_Service_Events_CORRECTED_VERSION.csv");
    const correctedBytes = readFileSync(CORRECTED_PATH);
    const corrected = { name: "03_Service_Events_CORRECTED_VERSION.csv", bytes: correctedBytes, checksum: sha256(correctedBytes) };
    const objectKeyOf = async (intakeFileId) => (await query("SELECT storage_object_key FROM kai.intake_files WHERE intake_file_id = $1::uuid", [intakeFileId]))[0].storage_object_key;
    const jobs = createPostgresCrossSourceReconciliationJobRepository();
    const processJob = (reconciliationJobId, now = new Date().toISOString()) => reconciliationRuntime.processCrossSourceReconciliationJob(
      { organizationId: ORG, reconciliationJobId }, { env: process.env, now: () => now });
    const withWorkerDisabled = async (callback) => {
      const previous = process.env.KAI_WORKER_ENABLED;
      process.env.KAI_WORKER_ENABLED = "false";
      try { return await callback(); } finally { process.env.KAI_WORKER_ENABLED = previous; }
    };
    const traceOf = async (claimId, audience = "internal") => {
      const traced = await gkApi("GET", claimTraceabilityPath(ORG, claimId, audience));
      return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, reason: traced.body?.data?.traceability_conflict_reason ?? null,
        unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort() };
    };
    const reviewRegisterPermissions = async (allowed) => {
      const profileId = state.register.sensitivity.intake_sensitivity_profile_id;
      const work = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${profileId}/review-work?organization_id=${ORG}`, {});
      const [queue] = await query(
        `SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
          WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid ORDER BY created_at DESC LIMIT 1`, [ORG, profileId]);
      const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${ORG}`, {
        expected_updated_at: new Date(queue.updated_at).toISOString(), review_queue_item_id: queue.review_queue_item_id, decision: "reviewed",
        reviewed_snapshot: { ...DECISIONS.register, reviewed_allowed_use_status: allowed ? "allowed" : "not_allowed", reviewed_llm_processing_allowed: allowed },
      });
      assert.ok([200, 201].includes(work.status) && decided.status === 200, `review the register's permissions again: ${J([work.status, decided.status, blockersOf(decided)])}`);
    };
    const releaseThroughGetKinder = async (draftId) => {
      const draftPath = `${orgPath}/generated-content-drafts/${draftId}`;
      const delivery = { draft_id: draftId };
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      try {
        const queueOf = async (queueType) => (await query(
          "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid ORDER BY created_at DESC",
          [ORG, queueType, draftId]))[0];
        const contentQueue = await queueOf("generated_content_review");
        const started = await gkApi("POST", generatedContentReviewStartPath(ORG, draftId, contentQueue.review_queue_item_id), { expected_updated_at: new Date(contentQueue.updated_at).toISOString() });
        const inProgress = await queueOf("generated_content_review");
        const completed = await gkApi("POST", generatedContentReviewCompletePath(ORG, draftId, inProgress.review_queue_item_id), { expected_updated_at: new Date(inProgress.updated_at).toISOString() });
        delivery.gk_content_review = [started.status, completed.status];
        delivery.export_review_request = (await gkAdminApi("POST", `${draftPath}/export-review-request`, { requested_export_audience: "internal" })).status;
        for (const step of ["start", "complete"]) {
          const queue = await queueOf("export_review");
          delivery[`export_review_${step}`] = (await gkAdminApi("POST", `${draftPath}/export-review-queue/${queue.review_queue_item_id}/${step}`, { expected_updated_at: new Date(queue.updated_at).toISOString() })).status;
        }
        const exportReviewQueueItemId = (await queueOf("export_review")).review_queue_item_id;
        delivery.limitation_snapshot = (await gkApi("POST", `${draftPath}/limitation-snapshot`, {})).status;
        delivery.entries = await query(
          `SELECT e.claim_id::text, e.limitation_codes FROM kai.limitation_snapshot_entries e
             JOIN kai.limitation_snapshots s ON s.limitation_snapshot_id = e.limitation_snapshot_id
            WHERE s.organization_id = $1::uuid AND s.generated_content_draft_id = $2::uuid`, [ORG, draftId]);
        delivery.export_candidate = (await gkAdminApi("POST", `${draftPath}/export-candidates`, {})).status;
        const [candidateRow] = await query("SELECT export_candidate_id::text FROM kai.export_candidates WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid", [ORG, draftId]);
        delivery.final_release_authority = (await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/final-release-authority`, { requested_audience: "internal", decision_action: "grant" })).status;
        delivery.export_manifest = (await gkAdminApi("POST", `${orgPath}/export-candidates/${candidateRow.export_candidate_id}/export-manifests`, { export_review_queue_item_id: exportReviewQueueItemId })).status;
        const [manifestRow] = await query("SELECT export_manifest_id::text FROM kai.export_manifests WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid", [ORG, candidateRow.export_candidate_id]);
        delivery.export_manifest_id = manifestRow.export_manifest_id;
        const released = await adminApi("GET", clientReleasedReportMarkdownPath(ORG, PROJECT, manifestRow.export_manifest_id));
        delivery.client_released_markdown = released.status;
        delivery.released = released.body;
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
      return delivery;
    };
    const readReleased = async (exportManifestId) => {
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      try {
        return await adminApi("GET", clientReleasedReportMarkdownPath(ORG, PROJECT, exportManifestId));
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
    };
    const readManifestCsv = async (exportManifestId) => {
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      try {
        return await gkAdminApi("GET", `${orgPath}/export-manifests/${exportManifestId}/csv`);
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
    };
    const V1 = () => state.events.sourceVersionId;
    const CORRECTED_STATE = {};

    // B4: the monthly activity and recorded duration claims through the
    // existing generation, review and release path. `expected` is the
    // independent calculation from the uploaded bytes (tests 18b and 28b).
    const COMPLETE_TIME = /(?<!not )(?<!not a )(?<!not the )\b(?:all|complete|full|entire|total) (?:recorded )?service[- ]time\b/i;
    const deliverActivity = async ({ claims, evidence, primaryVersionId, expected, tag }) => {
      const monthlyText = expected.months.map((m) => `${m.month} ${m.encounter_count}`).join(", ");
      // A model reply asserting complete service time, or an invented minutes total, is refused.
      const refused = {};
      for (const [name, text] of [["complete_time", (claim) => `${claim.claimStatement} This is the complete service-time total.`],
        ["invented_minutes", (claim) => `${claim.claimStatement} In total 20000 minutes were delivered.`]]) {
        modelBlockText = (claim) => (claim.claimId === claims.duration ? text(claim) : claim.claimStatement);
        try {
          const attempt = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: [claims.monthly, claims.duration], idempotency_key: `cedar-activity-negative-${randomUUID()}`, engagement_id: PROJECT });
          const draftId = attempt.body?.data?.generatedContentDraftId ?? null;
          const [draft] = draftId ? await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]) : [];
          const saved = draftId ? (await query("SELECT text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid", [draftId])).map((row) => row.text).join("\n") : "";
          refused[name] = [attempt.status, draft?.validator_results.find((r) => r.validator_key === "KAI-GEN-WORDING-FALLBACK-001")?.evidence.refused_validator_keys ?? [],
            saved.includes("This is the complete service-time total.") || saved.includes("In total 20000 minutes were delivered.")];
        } finally { modelBlockText = null; }
      }
      // Owner direction 2026-11-10: detected and never saved; the duration block
      // is restated from its claim (before: 422 with nothing saved).
      assert.deepEqual(refused.complete_time, [201, ["VAL-GEN-008"], false], J(refused));
      assert.equal(refused.invented_minutes[0], 201, J(refused));
      assert.ok(refused.invented_minutes[1].includes("VAL-GEN-004") && refused.invented_minutes[2] === false, J(refused));
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: [claims.monthly, claims.duration], idempotency_key: `cedar-activity-${tag}-${randomUUID()}`, engagement_id: PROJECT });
      assert.equal(created.status, 201, J(created.body));
      const draftId = created.body.data.generatedContentDraftId;
      const blocks = await query(
        `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [draftId]);
      const monthlyBlock = blocks.find((b) => b.claim_id === claims.monthly);
      const durationBlock = blocks.find((b) => b.claim_id === claims.duration);
      assert.deepEqual([monthlyBlock?.evidence_item_id, durationBlock?.evidence_item_id], [evidence.monthly, evidence.duration]);
      assert.ok(monthlyBlock.text.includes(`${expected.total} eligible service encounters by actual service month`), monthlyBlock.text);
      assert.ok(monthlyBlock.text.includes(monthlyText), `every month's count: ${monthlyBlock.text}`);
      assert.match(monthlyBlock.text, /reporting period 2025-04-01 to 2026-03-31/);
      assert.match(monthlyBlock.text, /This counts service encounters, not people/);
      assert.ok(durationBlock.text.includes(`${expected.minutes} known recorded minutes subtotal, from ${expected.known} of ${expected.total} eligible encounters; ${expected.missing} missing and ${expected.invalid} invalid or conflicting durations`), durationBlock.text);
      assert.match(durationBlock.text, /This is a known recorded minutes subtotal, not a complete service-time total; missing, invalid or conflicting durations are not included\./);
      for (const block of [monthlyBlock, durationBlock]) {
        assert.match(block.text, /linked to the participant register by matching identifier values exactly/);
        assert.ok(block.text.includes(state.register.sourceVersionId), "the register version is cited");
        assert.doesNotMatch(block.text, COMPLETE_TIME);
      }
      const sent = modelCalls.at(-1).claims;
      assert.ok(sent.find((c) => c.claimId === claims.duration).limitationCodes.includes("derived.known_recorded_minutes_subtotal"));
      assert.ok(sent.find((c) => c.claimId === claims.monthly).limitationCodes.includes("derived.encounters_not_people"));
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/);
      const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${draftId}/review-packet`);
      assert.equal(packet.status, 200, J(packet.body));
      for (const claimId of [claims.monthly, claims.duration]) {
        const citation = packet.body.data.blocks.flatMap((block) => block.citations).find((c) => c.claimId === claimId);
        assert.deepEqual(citation.contributingSources.map((c) => [c.sourceRole, c.sourceVersionId, c.isCurrent]),
          [["primary", primaryVersionId, true], ["reference", state.register.sourceVersionId, true]]);
      }
      // Personal-information-derived output stays with Get Kinder's release
      // authority (the release below); the organization's own internal read is
      // open with the personal-information note (draft first, Package 3).
      const own = await readOwnInternalMarkdown(draftId);
      assert.ok(assertOwnInternalMarkdownSafe(own).includes(state.register.sourceVersionId), "the linked register version is cited");
      const delivery = await releaseThroughGetKinder(draftId);
      const { released, entries, ...statuses } = delivery;
      assert.deepEqual([delivery.gk_content_review, delivery.export_review_request, delivery.export_review_start, delivery.export_review_complete,
        delivery.limitation_snapshot, delivery.export_candidate, delivery.final_release_authority, delivery.export_manifest, delivery.client_released_markdown],
        [[200, 200], 201, 200, 200, 201, 201, 201, 201, 200], J(statuses));
      for (const claimId of [claims.monthly, claims.duration]) assert.ok(released.includes(claimId), `${claimId} is in the released document`);
      assert.ok(released.includes(monthlyText), "the released document states every month's count");
      assert.ok(released.includes(`${expected.minutes} known recorded minutes subtotal`) && released.includes(`${expected.missing} missing`), "minutes, unit and missing durations");
      assert.match(released, /not a complete service-time total/);
      assert.doesNotMatch(released, COMPLETE_TIME);
      assert.doesNotMatch(released, /CB0\d\d|EV0\d\d/);
      const contributingLines = released.split("\n").filter((line) => line.includes("Contributing "));
      assert.equal(contributingLines.filter((line) => line.includes("Contributing primary source") && line.includes(primaryVersionId)).length, 2, J(contributingLines));
      assert.equal(contributingLines.filter((line) => line.includes("Contributing reference source") && line.includes(state.register.sourceVersionId)).length, 2, J(contributingLines));
      const codes = Object.fromEntries(entries.map((entry) => [entry.claim_id, entry.limitation_codes]));
      assert.ok(codes[claims.duration].includes("derived.known_recorded_minutes_subtotal") && codes[claims.duration].includes("derived.cross_source_linked"), J(codes));
      assert.ok(codes[claims.monthly].includes("derived.encounters_not_people") && codes[claims.monthly].includes("derived.cross_source_linked"), J(codes));
      return { summary: { draft_id: draftId, refused, blocks: [monthlyBlock.text, durationBlock.text], ...statuses, released_excerpt: released.slice(0, 4000) }, released };
    };

    await test("23b: B4 - the original monthly activity and recorded duration claims are generated, reviewed and released with both contributing versions and the subtotal limitation", async () => {
      const claims = { monthly: activityOriginal.monthly_eligible_encounters.claimId, duration: activityOriginal.known_recorded_service_minutes.claimId };
      const evidence = { monthly: activityOriginal.monthly_eligible_encounters.evidenceId, duration: activityOriginal.known_recorded_service_minutes.evidenceId };
      for (const claimId of Object.values(claims)) assert.equal((await traceOf(claimId)).eligible, true, "reviewed in 18b");
      const m = report.derived_measurements;
      const expected = { months: m.monthly_activity.months, total: m.monthly_activity.total, known: m.recorded_duration.known, missing: m.recorded_duration.missing,
        invalid: m.recorded_duration.invalid, minutes: String(m.recorded_duration.minutes) };
      report.generation.activity_original = (await deliverActivity({ claims, evidence, primaryVersionId: V1(), expected, tag: "original" })).summary;
      state.activityOriginalManifestId = report.generation.activity_original.export_manifest_id;
      console.log(`Cedar Bridge original activity release: ${J({ ...report.generation.activity_original, released_excerpt: undefined })}`);
    });

    await test("24: Stage B - the corrected service-events file is uploaded through the intake API, scanned, profiled and reviewed like any upload", async () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "File_Integrity_Manifest.json"), "utf8"));
      const entry = manifest.find((candidate) => candidate.disposition === "CHALLENGE_UPLOAD_ONLY_AFTER_BASELINE");
      assert.deepEqual([entry.relative_path, entry.sha256, entry.bytes], [`02_CHALLENGE_UPLOAD_LATER/${corrected.name}`, corrected.checksum, corrected.bytes.byteLength]);
      // Not a seventh baseline source: the baseline was uploaded, reviewed and released first.
      assert.ok(state.stageAReleasedManifestId, "the baseline release exists before the correction is supplied");
      const batch = await adminApi("POST", createBatchPath(), { organization_id: ORG, engagement_id: PROJECT, batch_code: "cedar-bridge-correction", idempotency_key: `batch-${randomUUID()}` });
      assert.ok([200, 201].includes(batch.status), J(batch.body));
      const batchId = batch.body.data.intake_batch_id;
      const reserved = await adminApi("POST", fileReservationsPath(batchId), {
        organization_id: ORG, engagement_id: PROJECT, original_filename: corrected.name, file_extension: ".csv", mime_type: "text/csv",
        file_size_bytes: corrected.bytes.byteLength, checksum: corrected.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
      });
      assert.ok(reserved.status < 300, J(reserved.body));
      const intakeFileId = reserved.body.data.intake_file_id;
      const signed = await adminApi("POST", requestUploadUrlPath(batchId), { organization_id: ORG, engagement_id: PROJECT, intake_file_id: intakeFileId });
      const put = await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: corrected.bytes });
      const confirmed = await adminApi("POST", confirmUploadPath(ORG, intakeFileId), { organization_id: ORG });
      assert.deepEqual([put.status, confirmed.status], [200, 200], J(confirmed.body));
      await dispatcher.whenIdle();
      const [file] = await query("SELECT file_policy_status FROM kai.intake_files WHERE intake_file_id = $1::uuid", [intakeFileId]);
      const [profileRow] = await query("SELECT profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [intakeFileId]);
      const [sensitivity] = await query(
        `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
           JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
          WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
      assert.equal(file.file_policy_status, "passed");
      assert.equal(profileRow.profile.status, "profiled");
      assert.equal(profileRow.profile.counts.row_count, 246);
      assert.doesNotMatch(J(profileRow.profile), /CB0\d\d|EV0\d\d/, "no raw value in the corrected profile");
      // The same columns: the profile proposes the same field roles as the original version's.
      const roles = (profile) => profile.tabular_measurement_basis.fields.map((field) => [field.field_key, field.roles]);
      assert.deepEqual(roles(profileRow.profile), roles(state.events.profile));
      const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${ORG}`, {
        expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id,
        decision: "reviewed", reviewed_snapshot: DECISIONS.events,
      });
      assert.equal(decided.status, 200, J(decided.body));
      const [candidate] = await query("SELECT intake_source_candidate_id::text, candidate_status FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid",
        [sensitivity.intake_sensitivity_profile_id]);
      assert.equal(candidate.candidate_status, "needs_gk_review");
      Object.assign(CORRECTED_STATE, { intakeFileId, sensitivity, candidateId: candidate.intake_source_candidate_id, profile: profileRow.profile });
      // A reconciliation of the original version requested now and still queued when the correction is promoted.
      const pending = await withWorkerDisabled(() => adminApi("POST", crossSourceMeasurementsPath(ORG), {
        primary_source_version_id: V1(), reference_source_version_id: state.register.sourceVersionId,
        mapping: { events: { ...crossMapping.events, group_field_key: undefined }, register: crossMapping.register } }));
      assert.deepEqual([pending.status, pending.body.data.reconciliationJob.job_state], [202, "queued"], J(pending.body));
      CORRECTED_STATE.pendingOriginalJobId = pending.body.data.reconciliationJob.reconciliation_job_id;
      report.corrected_version = { file: corrected.name, sha256: corrected.checksum, intake_file_id: intakeFileId, policy: file.file_policy_status,
        profile_records: profileRow.profile.counts.row_count, sensitivity_decision: decided.status };
    });

    await test("25: Stage B - authorized promotion makes it the successor version of the same logical source; refused attempts change nothing", async () => {
      const promote = (body, api = adminApi) => api("POST", sourceCandidateDecisionPath(ORG, CORRECTED_STATE.candidateId), body);
      const successor = { outcome: "promoted", reviewed_source_type: "organization_primary_record", supersedes_source_version_id: V1() };
      const snapshot = async () => (await query(`SELECT
          (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
          (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS versions,
          (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid)::int AS decisions,
          (SELECT is_current FROM kai.source_versions WHERE source_version_id = $2::uuid) AS original_current`, [ORG, V1()]))[0];
      const before = await snapshot();
      const refusals = {
        outsider: await promote(successor, outsiderApi),
        unknown_predecessor: await promote({ ...successor, supersedes_source_version_id: randomUUID() }),
        workbook_predecessor: await promote({ ...successor, supersedes_source_version_id: state.workbook.sourceVersionId }),
        different_reviewed_type: await promote({ ...successor, reviewed_source_type: "organization_secondary_record" }),
        rejection_naming_predecessor: await promote({ outcome: "rejected", supersedes_source_version_id: V1() }),
        uppercase_identifier: await promote({ ...successor, supersedes_source_version_id: V1().toUpperCase() }),
      };
      const summary = Object.fromEntries(Object.entries(refusals).map(([key, value]) => [key, [value.status, value.body?.data?.exact_verification_phase ?? blockersOf(value)]]));
      report.corrected_version.promotion_refusals = summary;
      assert.ok(refusals.outsider.status >= 400 && refusals.outsider.status < 500, J(summary));
      assert.equal(refusals.unknown_predecessor.status, 404, J(summary));
      assert.deepEqual(summary.workbook_predecessor, [422, "source_promotion_successor_invalid"]);
      assert.deepEqual(summary.different_reviewed_type, [422, "source_promotion_successor_invalid"]);
      assert.deepEqual(summary.rejection_naming_predecessor, [422, ["supersedes_source_version_not_allowed_for_outcome"]]);
      assert.deepEqual(summary.uppercase_identifier, [422, ["invalid_uuid_field"]]);
      assert.deepEqual(await snapshot(), before, "a refused or failed promotion writes nothing; the original stays current");

      // The authorized decision, then an identical retry.
      const promoted = await promote(successor);
      assert.equal(promoted.status, 200, J(promoted.body));
      assert.equal(promoted.body.data.superseded_source_version_id, V1());
      const V2 = promoted.body.data.source_version.source_version_id;
      assert.equal(promoted.body.data.source.source_id, state.events.sourceId, "the same logical source");
      const retried = await promote(successor);
      assert.deepEqual([retried.status, retried.body.data.replayed, retried.body.data.superseded_source_version_id, retried.body.data.source_version.source_version_id],
        [200, true, V1(), V2]);
      // A retry naming another predecessor is a different request for an already-decided candidate.
      assert.equal((await promote({ ...successor, supersedes_source_version_id: state.register.sourceVersionId })).status, 409);
      const after = await snapshot();
      assert.deepEqual([after.sources, after.versions, after.decisions, after.original_current], [before.sources, before.versions + 1, before.decisions + 1, false]);
      const versions = await query("SELECT source_version_id::text, is_current FROM kai.source_versions WHERE source_id = $1::uuid ORDER BY created_at", [state.events.sourceId]);
      assert.deepEqual(versions, [{ source_version_id: V1(), is_current: false }, { source_version_id: V2, is_current: true }]);
      const audits = await query("SELECT metadata FROM kai.audit_events WHERE organization_id = $1::uuid AND reason_code = 'source_version_superseded'", [ORG]);
      assert.equal(audits.length, 1, "one supersession audit; the retry wrote none");
      assert.deepEqual([audits[0].metadata.source_version_id, audits[0].metadata.superseded_source_version_id, audits[0].metadata.source_id], [V2, V1(), state.events.sourceId]);
      assert.doesNotMatch(J(audits), /CB\d{3}|EV\d{4}/);
      // Data Sources shows one source with its current and earlier version.
      const listed = await adminApi("GET", `${orgPath}/sources`);
      const eventsSource = listed.body.data.sources.find((source) => source.source_id === state.events.sourceId);
      assert.deepEqual(eventsSource.source_versions.map((version) => [version.source_version_id, version.is_current]).sort(),
        [[V1(), false], [V2, true]].sort());
      CORRECTED_STATE.sourceVersionId = V2;
      Object.assign(report.corrected_version, { source_id: state.events.sourceId, superseded_source_version_id: V1(), source_version_id: V2,
        promotion: [promoted.status, retried.status], versions });
      stage("events", "superseded_by_corrected_version", "earlier version", { successor_source_version_id: V2 });
    });

    await test("26: Stage B - findings from the superseded version are no longer current; unrelated evidence stays eligible; the earlier release is historical", async () => {
      const outcome = { old_cross_source: {}, old_single_source_events: {}, unaffected: {} };
      for (const label of crossLabels) outcome.old_cross_source[label] = await traceOf(crossClaims[label]);
      for (const label of DERIVED_CLAIM_LABELS) {
        (label.startsWith("events_") ? outcome.old_single_source_events : outcome.unaffected)[label] = await traceOf(derivedClaims[label]);
      }
      outcome.old_activity = {};
      for (const [metric, item] of Object.entries(activityOriginal)) {
        outcome.old_activity[metric] = await traceOf(item.claimId);
        assert.deepEqual([outcome.old_activity[metric].status, outcome.old_activity[metric].reason], [409, "source_version_not_current"]);
        const proposed = await adminApi("POST", claimProposalPath(ORG, item.evidenceId), {});
        assert.ok(proposed.status >= 400, J(proposed.body));
      }
      for (const value of Object.values(outcome.old_cross_source)) assert.deepEqual([value.status, value.reason], [409, "source_version_not_current"], J(outcome));
      for (const value of Object.values(outcome.old_single_source_events)) assert.deepEqual([value.status, value.reason], [409, "source_version_not_current"], J(outcome));
      for (const [label, value] of Object.entries(outcome.unaffected)) assert.equal(value.eligible, true, `${label} does not depend on the service events: ${J(value)}`);
      const generated = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: [crossClaims.reach_encounters], idempotency_key: `cedar-old-${randomUUID()}`, engagement_id: PROJECT });
      outcome.generation_from_old_claim = [generated.status, blockersOf(generated)];
      assert.ok(generated.status >= 400, J(outcome.generation_from_old_claim));
      outcome.interpret_old = (await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CROSS.reach_people.measurementId),
        { indicator_label: "People served", meaning_text: "Human-stated for this synthetic acceptance: a restatement.", evidence_basis: "organization_record" })).status;
      outcome.basis_of_old = (await adminApi("GET", derivedMeasurementBasisPath(ORG, V1()))).status;
      outcome.reconcile_old = (await adminApi("POST", crossSourceMeasurementsPath(ORG), { primary_source_version_id: V1(), reference_source_version_id: state.register.sourceVersionId, mapping: crossMapping })).status;
      assert.ok(outcome.interpret_old >= 400 && outcome.basis_of_old >= 400 && outcome.reconcile_old >= 400, J(outcome));
      // The queued reconciliation of the original version: the worker revalidates currentness before committing anything.
      const before = await query("SELECT count(*)::int AS n FROM kai.source_derived_measurements WHERE source_version_id = $1::uuid", [V1()]);
      const settled = await processJob(CORRECTED_STATE.pendingOriginalJobId);
      outcome.pending_original_job = [settled.outcome, settled.code];
      assert.equal(settled.outcome, "failed", J(settled));
      assert.deepEqual(await query("SELECT count(*)::int AS n FROM kai.source_derived_measurements WHERE source_version_id = $1::uuid", [V1()]), before);
      const pendingRead = await adminApi("GET", crossSourceReconciliationJobPath(ORG, CORRECTED_STATE.pendingOriginalJobId));
      assert.deepEqual([pendingRead.status, pendingRead.body.data.reconciliationJob.job_state, pendingRead.body.data.measurements], [200, "failed", []]);
      // The original measurements and their evidence rows are kept exactly as recorded.
      const original = await derivedRows(V1());
      assert.ok(original.some((row) => row.source_derived_measurement_id === CROSS.reach_encounters.measurementId && row.measured_value === 222));
      // The earlier release is kept, cites the original version, and is identified as historical rather than served as current.
      const [manifest] = await query("SELECT count(*)::int AS n FROM kai.export_manifests WHERE export_manifest_id = $1::uuid", [state.stageAReleasedManifestId]);
      assert.equal(manifest.n, 1);
      const historical = await readReleased(state.stageAReleasedManifestId);
      outcome.stage_a_release = { status: historical.status, data: historical.body?.data ?? null };
      assert.equal(historical.status, 409, J(historical.body));
      assert.deepEqual([historical.body.data.released_report_state, historical.body.data.reason], ["historical", "released_report_cites_superseded_source_version"]);
      const cited = Object.fromEntries(historical.body.data.cited_source_versions.map((version) => [version.source_version_id, version]));
      assert.deepEqual([cited[V1()].is_current, cited[V1()].current_source_version_id], [false, CORRECTED_STATE.sourceVersionId]);
      assert.deepEqual([cited[state.register.sourceVersionId].is_current, cited[state.register.sourceVersionId].citation_role], [true, "reference"]);
      assert.ok(state.stageAReleasedMarkdown.includes(V1()), "the original release's own text cites the original version");
      report.corrected_version.invalidation = outcome;
    });

    let correctedJob = null;
    await test("27: Stage C - the worker path on the corrected version: permission withdrawal, checksum mismatch, an unreadable object retried, a lost lease timed out", async () => {
      const body = { primary_source_version_id: CORRECTED_STATE.sourceVersionId, reference_source_version_id: state.register.sourceVersionId, mapping: crossMapping };
      const lifecycle = [];
      const request = () => withWorkerDisabled(() => adminApi("POST", crossSourceMeasurementsPath(ORG), body));
      // Unauthorized: another person cannot request or read this organization's job.
      const outsiderPost = await outsiderApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.ok(outsiderPost.status >= 400 && outsiderPost.status < 500);
      const first = await request();
      assert.deepEqual([first.status, first.body.data.reconciliationJob.job_state, first.body.data.fresh], [202, "queued", true], J(first.body));
      const jobId = first.body.data.reconciliationJob.reconciliation_job_id;
      const outsiderRead = await outsiderApi("GET", crossSourceReconciliationJobPath(ORG, jobId));
      assert.ok(outsiderRead.status >= 400 && outsiderRead.status < 500);
      const measurementsOfV2 = async () => (await query("SELECT count(*)::int AS n FROM kai.source_derived_measurements WHERE source_version_id = $1::uuid", [CORRECTED_STATE.sourceVersionId]))[0].n;
      // 1. The register's allowed use is withdrawn after the request: the worker's revalidation refuses it.
      await reviewRegisterPermissions(false);
      let attempt = await processJob(jobId);
      lifecycle.push(["permission_withdrawn", attempt.outcome, attempt.code]);
      assert.equal(attempt.outcome, "failed", J(attempt));
      assert.equal(await measurementsOfV2(), 0);
      await reviewRegisterPermissions(true);
      // 2. The register's stored object no longer matches its verified checksum: failed, never retried.
      const registerKey = await objectKeyOf(state.register.intakeFileId);
      const registerObject = objects.get(registerKey);
      const tampered = Buffer.from(registerObject.bytes);
      tampered[tampered.length - 3] = tampered[tampered.length - 3] === 0x31 ? 0x32 : 0x31;
      objects.set(registerKey, { ...registerObject, bytes: tampered });
      const second = await request();
      assert.deepEqual([second.status, second.body.data.reconciliationJob.reconciliation_job_id, second.body.data.requeued], [202, jobId, true], "a repeated request re-queues the same job");
      attempt = await processJob(jobId);
      lifecycle.push(["checksum_mismatch", attempt.outcome, attempt.code]);
      assert.deepEqual([attempt.outcome, attempt.code], ["failed", "cross_source_checksum_mismatch"]);
      objects.set(registerKey, registerObject);
      assert.equal(await measurementsOfV2(), 0);
      // 3. The corrected version's object cannot be read: retried after its cooldown.
      const eventsKey = await objectKeyOf(CORRECTED_STATE.intakeFileId);
      const eventsObject = objects.get(eventsKey);
      objects.delete(eventsKey);
      await request();
      const t0 = Date.now();
      const at = (seconds) => new Date(t0 + seconds * 1000).toISOString();
      attempt = await processJob(jobId, at(0));
      lifecycle.push(["object_unreadable", attempt.outcome, attempt.code, attempt.job?.attempt_count]);
      assert.deepEqual([attempt.outcome, attempt.code, attempt.job.attempt_count], ["retry_scheduled", "cross_source_bytes_unavailable", 1]);
      assert.equal((await processJob(jobId, at(30))).outcome, "deferred", "not before its cooldown");
      objects.set(eventsKey, eventsObject);
      // 4. A worker claims the retry and is lost: its lease expires, and the next attempt takes over.
      const lost = await jobs.claim({ organizationId: ORG, reconciliationJobId: jobId, now: at(61) });
      assert.deepEqual([lost.decision, lost.job.attempt_count], ["claimed", 2]);
      assert.equal((await processJob(jobId, at(120))).outcome, "busy", "the lease is still held");
      const due = await jobs.listDue({ now: at(61 + 301) });
      assert.ok(due.some((row) => row.reconciliation_job_id === jobId), "the sweep finds the expired lease");
      attempt = await processJob(jobId, at(61 + 302));
      lifecycle.push(["lease_expired_then_succeeded", attempt.outcome, attempt.code, attempt.job?.attempt_count]);
      assert.deepEqual([attempt.outcome, attempt.job.attempt_count, attempt.job.measurement_ids.length], ["succeeded", 3, 7]);
      // The lost worker's claim token can no longer commit or fail the job.
      const stale = await jobs.completeFailed({ organizationId: ORG, reconciliationJobId: jobId, claimToken: lost.job.claim_token, errorCode: "system_error", retryable: true, now: at(400) });
      assert.equal(stale.acknowledged, false);
      // A duplicate request now reads the succeeded job and writes nothing.
      const countsBefore = await writeCounts();
      const duplicate = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      await reconciliationDispatcher.whenIdle();
      assert.deepEqual([duplicate.status, duplicate.body.data.reconciliationJob.job_state, duplicate.body.data.fresh], [202, "succeeded", false]);
      assert.deepEqual(await writeCounts(), countsBefore);
      correctedJob = await adminApi("GET", crossSourceReconciliationJobPath(ORG, jobId));
      assert.equal(correctedJob.status, 200);
      report.corrected_version.worker_lifecycle = lifecycle;
      report.corrected_version.job = correctedJob.body.data.reconciliationJob;
    });

    const CORRECTED_CROSS = {};
    await test("28: Stage C - independent recalculation: every metric recalculated from the corrected bytes, both contributing versions, nothing mixed", async () => {
      const measurements = correctedJob.body.data.measurements;
      assert.equal(measurements.length, 7);
      // Independent decisions from the corrected bytes, sharing no code with KAI.
      const events = parseCsv(corrected.bytes.toString("utf8"));
      const registerIds = new Set(parseCsv(byKey.register.bytes.toString("utf8")).map((r) => r.participant_id));
      const rowsById = new Map();
      events.forEach((r, index) => rowsById.set(r.event_id, [...(rowsById.get(r.event_id) || []), { ...r, row: index + 2 }]));
      const firsts = [...rowsById.values()].map((copies) => copies[0]);
      const completed = firsts.filter((r) => r.delivery_status === "completed");
      const inFy = completed.filter((r) => r.service_date >= "2025-04-01" && r.service_date <= "2026-03-31");
      const eligible = inFy.filter((r) => registerIds.has(r.participant_id));
      const people = (list) => new Set(list.map((r) => r.participant_id));
      const ds = eligible.filter((r) => r.program_code === "DS");
      const en = eligible.filter((r) => r.program_code === "EN");
      const independent = {
        reach_encounters: eligible.length, reach_people: people(eligible).size, reach_DS_encounters: ds.length, reach_DS_people: people(ds).size,
        reach_EN_encounters: en.length, reach_EN_people: people(en).size, reach_both: [...people(ds)].filter((id) => people(en).has(id)).length,
      };
      const values = {};
      for (const entry of measurements) {
        const label = labelOf(entry);
        CORRECTED_CROSS[label] = { measurementId: entry.source_derived_measurement_id, evidenceItemId: entry.evidence.find((e) => e.current).evidence_item_id };
        values[label] = entry.measured_value;
        assert.equal(entry.measured_value, independent[label], `${label} equals the independent reading of the corrected file`);
        assert.deepEqual(entry.contributing_sources.map((s) => [s.source_role, s.source_version_id, s.is_current]),
          [["primary", CORRECTED_STATE.sourceVersionId, true], ["reference", state.register.sourceVersionId, true]], label);
        assert.equal(entry.definition.reference_source_version_id, state.register.sourceVersionId);
        assert.deepEqual(entry.exclusions.unmatched_participant_identifier.rows, inFy.filter((r) => !registerIds.has(r.participant_id)).map((r) => r.row));
        assert.deepEqual(entry.exclusions.completed_outside_period.rows, completed.filter((r) => !inFy.includes(r)).map((r) => r.row));
        report.derived_measurements[`corrected_${label}`] = { ...entry, persisted: true, source: `${corrected.name} + ${byKey.register.name}`, calculation_method: entry.calculation_method };
      }
      // No measurement of the corrected version cites the original version, and the original rows are unchanged.
      const rowsOfV2 = await derivedRows(CORRECTED_STATE.sourceVersionId);
      assert.ok(rowsOfV2.every((row) => row.source_version_id === CORRECTED_STATE.sourceVersionId));
      assert.doesNotMatch(J(rowsOfV2.map((row) => [row.definition, row.contributing_sources])), new RegExp(V1()));
      const originalValues = Object.fromEntries(crossLabels.map((label) => [label, report.derived_measurements[label].measured_value]));
      const after = Object.fromEntries((await derivedRows(V1())).filter((row) => Object.values(CROSS).some((c) => c.measurementId === row.source_derived_measurement_id))
        .map((row) => [Object.keys(CROSS).find((label) => CROSS[label].measurementId === row.source_derived_measurement_id), row.measured_value]));
      assert.deepEqual(after, originalValues, "the original measurements are kept as recorded");
      const funnel = measurements.find((entry) => entry.definition.metric === "distinct_people_served").component_counts;
      const before = report.derived_measurements.cross_source_funnel;
      const changed = Object.fromEntries(Object.keys(funnel).filter((key) => key !== "groups" && J(funnel[key]) !== J(before[key])).map((key) => [key, [before[key], funnel[key]]]));
      report.corrected_version.recalculation = { original: originalValues, corrected: values, independent, funnel_changes: changed };
      console.log(`Cedar Bridge corrected recalculation: ${J(report.corrected_version.recalculation)}`);
      assert.deepEqual(crossLabels.map((label) => values[label]), [223, 80, 118, 51, 105, 39, 10]);
      // What changed is exactly what the corrected rows change; everything else is recalculated to the same value.
      assert.deepEqual(changed, { unmatched_event_count: [1, 0], unmatched_identity_count: [1, 0], eligible_encounter_count: [222, 223] });
      assert.doesNotMatch(J(correctedJob.body), /CB\d{3}|EV\d{4}/);
    });

    await test("28b: corrected monthly activity and duration retain exact source lineage and governed evidence", async () => {
      const mapping = { ...crossMapping, duration: { field_key: "field_7", meaning: "recorded_service_duration", unit: "minutes" } };
      const body = { primary_source_version_id: CORRECTED_STATE.sourceVersionId, reference_source_version_id: state.register.sourceVersionId, mapping };
      const queued = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.equal(queued.status, 202, J(queued.body));
      const result = await settleReconciliation(queued);
      assert.deepEqual([result.status, result.job.job_state, result.measurements.length], [200, "succeeded", 2], J(result));
      const monthly = result.measurements.find((m) => m.definition.metric === "monthly_eligible_encounters");
      const duration = result.measurements.find((m) => m.definition.metric === "known_recorded_service_minutes");
      assert.ok(monthly && duration, J(result));
      assert.equal(duration.definition.duration.unit, "minutes");
      // Independently read the actual corrected bytes; the answer key is not an input.
      const register = new Set(parseCsv(byKey.register.bytes.toString("utf8")).map((r) => r.participant_id));
      const copies = new Map();
      for (const event of parseCsv(corrected.bytes.toString("utf8"))) copies.set(event.event_id, [...(copies.get(event.event_id) || []), event]);
      const eligibleGroups = [...copies.values()].filter((list) => new Set(list.map((r) => JSON.stringify([r.participant_id, r.delivery_status, r.service_date, r.program_code]))).size === 1)
        .filter((list) => { const r = list[0]; return r.delivery_status === "completed" && r.service_date >= "2025-04-01" && r.service_date <= "2026-03-31" && register.has(r.participant_id); });
      const months = new Map();
      let known = 0, missing = 0, invalid = 0, minutes = 0n;
      for (const group of eligibleGroups) {
        const event = group[0], month = event.service_date.slice(0, 7);
        months.set(month, (months.get(month) || 0) + 1);
        const values = group.map((r) => r.duration_minutes.trim());
        if (new Set(values).size !== 1) invalid++;
        else if (!values[0]) missing++;
        else if (!/^\d+$/.test(values[0])) { throw new Error("Independent fixture calculation requires integer minutes"); }
        else { known++; minutes += BigInt(values[0]); }
      }
      const expectedMonths = [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, encounter_count]) => ({ month, encounter_count }));
      assert.equal(eligibleGroups.length, 223);
      assert.deepEqual(monthly.component_counts.monthly_activity, expectedMonths);
      assert.deepEqual([monthly.measured_value, duration.measured_value, duration.component_counts.duration_missing_count, duration.component_counts.duration_invalid_count, duration.component_counts.known_recorded_minutes],
        [eligibleGroups.length, known, missing, invalid, String(minutes)]);
      assert.equal(monthly.measured_value, report.corrected_version.recalculation.corrected.reach_encounters);
      const activity = {};
      for (const entry of [monthly, duration]) {
        const metric = entry.definition.metric;
        assert.deepEqual(entry.contributing_sources.map((s) => [s.source_role, s.source_version_id, s.is_current]), [["primary", CORRECTED_STATE.sourceVersionId, true], ["reference", state.register.sourceVersionId, true]]);
        assert.equal(entry.definition.reference_source_version_id, state.register.sourceVersionId);
        for (const source of entry.contributing_sources) assert.equal(source.profile_canonical_sha256, source.bound_profile_canonical_sha256);
        const [persisted] = (await derivedRows(CORRECTED_STATE.sourceVersionId)).filter((r) => r.source_derived_measurement_id === entry.source_derived_measurement_id);
        assert.ok(persisted);
        assert.doesNotMatch(J([persisted.definition, entry.contributing_sources]), new RegExp(V1()));
        const old = activityOriginal[metric];
        const [historical] = (await derivedRows(V1())).filter((r) => r.source_derived_measurement_id === old.measurement.source_derived_measurement_id);
        assert.deepEqual(historical.component_counts, old.measurement.component_counts);
        const stated = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, entry.source_derived_measurement_id), { indicator_label: metric === "monthly_eligible_encounters" ? "Monthly eligible encounters" : "Known recorded minutes", meaning_text: "Human-stated recorded service activity in the reporting period.", evidence_basis: "organization_record" });
        assert.equal(stated.status, 200, J(stated.body));
        const evidenceId = stated.body.data.evidenceItem.evidence_item_id;
        const proposed = await adminApi("POST", claimProposalPath(ORG, evidenceId), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        const claimId = proposed.body.data.claim.claim_id;
        assert.notEqual(claimId, old.claimId);
        assert.equal((await traceOf(claimId)).eligible, false);
        const queue = async (kind, id) => (await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid", [ORG, kind, id]))[0];
        const eq = await queue("evidence_review", evidenceId);
        const er = await gkApi("POST", evidenceReviewCompletePath(ORG, evidenceId, eq.review_queue_item_id), evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(eq.updated_at).toISOString(), decision: "supported" }));
        assert.equal(er.status, 200, J(er.body));
        const cq = await queue("claim_review", claimId);
        const cr = await gkApi("POST", claimReviewCompletePath(ORG, claimId, cq.review_queue_item_id), claimReviewDecisionBody({ expectedUpdatedAt: new Date(cq.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        assert.equal(cr.status, 200, J(cr.body));
        for (const dimension of (await traceOf(claimId)).unresolved) await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimension), {});
        const trace = await traceOf(claimId);
        assert.equal(trace.eligible, true, J(trace));
        activity[metric] = { measurement_id: entry.source_derived_measurement_id, evidence_id: evidenceId, claim_id: claimId, traceability: trace, contributing_sources: entry.contributing_sources, components: entry.component_counts };
      }
      const before = await writeCounts();
      const replay = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.deepEqual([replay.status, replay.body.data.fresh, replay.body.data.reconciliationJob.reconciliation_job_id], [202, false, queued.body.data.reconciliationJob.reconciliation_job_id]);
      await reconciliationDispatcher.whenIdle();
      assert.deepEqual(await writeCounts(), before);
      report.corrected_version.activity = { months: monthly.component_counts.monthly_activity, eligible: monthly.measured_value, known: duration.measured_value, missing: duration.component_counts.duration_missing_count, invalid: duration.component_counts.duration_invalid_count, minutes: duration.component_counts.known_recorded_minutes, measurements: activity };
      console.log(`Cedar Bridge corrected activity: ${J(report.corrected_version.activity)}`);
    });

    const correctedClaims = {};
    await test("29: Stage D - the corrected measurements' meanings, evidence and claims through the existing review; old and new claims stay distinct", async () => {
      for (const label of crossLabels) {
        const [indicatorLabel, meaning] = report.human_supplied_semantics.cross_source[label];
        const stated = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CORRECTED_CROSS[label].measurementId),
          { indicator_label: indicatorLabel, meaning_text: `Human-stated for this synthetic acceptance: ${meaning}`, evidence_basis: "organization_record" });
        assert.equal(stated.status, 200, `${label}: ${J(stated.body)}`);
        CORRECTED_CROSS[label].evidenceItemId = stated.body.data.evidenceItem.evidence_item_id;
        const proposed = await adminApi("POST", claimProposalPath(ORG, CORRECTED_CROSS[label].evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
        const claimId = proposed.body.data.claim.claim_id;
        assert.notEqual(claimId, crossClaims[label], "a new claim, not the old one reused");
        assert.equal((await traceOf(claimId)).eligible, false, "Get Kinder review is required again");
        const queueOf = async (queueType, targetId) => (await query(
          "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
          [ORG, queueType, targetId]))[0];
        const evidenceQueue = await queueOf("evidence_review", CORRECTED_CROSS[label].evidenceItemId);
        await gkApi("POST", evidenceReviewCompletePath(ORG, CORRECTED_CROSS[label].evidenceItemId, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        const claimQueue = await queueOf("claim_review", claimId);
        await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        for (const dimensionKey of (await traceOf(claimId)).unresolved) await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimensionKey), {});
        const after = await traceOf(claimId);
        assert.equal(after.eligible, true, `${label}: ${J(after)}`);
        assert.deepEqual([(await traceOf(claimId, "funder")).eligible, (await traceOf(claimId, "public")).eligible], [false, false]);
        const [row] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        assert.ok(row.statement.includes(String(report.corrected_version.recalculation.corrected[label])) && row.statement.includes(state.register.sourceVersionId), row.statement);
        correctedClaims[label] = claimId;
        report.claims[`corrected:${label}`] = { claim_id: claimId, statement: row.statement, traceability_after_review: after };
        // The old claim stays not current.
        assert.deepEqual([(await traceOf(crossClaims[label])).status, (await traceOf(crossClaims[label])).reason], [409, "source_version_not_current"]);
      }
    });

    await test("30: Stage D - a new cited Evidence Summary, Get Kinder's review and release; the client receives the updated report; the earlier one stays historical", async () => {
      const REGRESSION = ["paired_field_6"];
      const claimIds = [...crossLabels.map((label) => correctedClaims[label]), ...REGRESSION.map((label) => derivedClaims[label])];
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: claimIds, idempotency_key: `cedar-corrected-${randomUUID()}`, engagement_id: PROJECT });
      assert.equal(created.status, 201, J(created.body));
      const draftId = created.body.data.generatedContentDraftId;
      const blocks = await query(
        `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [draftId]);
      for (const label of crossLabels) {
        const block = blocks.find((b) => b.claim_id === correctedClaims[label]);
        assert.equal(block.evidence_item_id, CORRECTED_CROSS[label].evidenceItemId);
        assert.ok(block.text.includes(String(report.corrected_version.recalculation.corrected[label])), block.text);
        assert.match(block.text, /linked to the participant register by matching identifier values exactly/);
      }
      assert.ok(!blocks.some((b) => Object.values(crossClaims).includes(b.claim_id)), "no superseded claim is generated from");
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/);
      const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${draftId}/review-packet`);
      assert.equal(packet.status, 200, J(packet.body));
      const packetCitations = packet.body.data.blocks.flatMap((block) => block.citations);
      for (const label of crossLabels) {
        assert.deepEqual(packetCitations.find((c) => c.claimId === correctedClaims[label]).contributingSources.map((c) => [c.sourceRole, c.sourceVersionId, c.isCurrent]),
          [["primary", CORRECTED_STATE.sourceVersionId, true], ["reference", state.register.sourceVersionId, true]], label);
      }
      const delivery = await releaseThroughGetKinder(draftId);
      const { released, entries, ...statuses } = delivery;
      report.generation.corrected_delivery = { ...statuses, released_excerpt: typeof released === "string" ? released.slice(0, 3000) : released };
      assert.deepEqual([delivery.gk_content_review, delivery.export_review_request, delivery.export_review_start, delivery.export_review_complete,
        delivery.limitation_snapshot, delivery.export_candidate, delivery.final_release_authority, delivery.export_manifest, delivery.client_released_markdown],
        [[200, 200], 201, 200, 200, 201, 201, 201, 201, 200], J(statuses));
      for (const label of crossLabels) {
        assert.ok(released.includes(correctedClaims[label]), `${label} is in the released document`);
        assert.ok(!released.includes(crossClaims[label]), `${label}: the superseded claim is not`);
      }
      const contributingLines = released.split("\n").filter((line) => line.includes("Contributing "));
      assert.equal(contributingLines.filter((line) => line.includes("Contributing primary source") && line.includes(CORRECTED_STATE.sourceVersionId)).length, crossLabels.length);
      assert.equal(contributingLines.filter((line) => line.includes("Contributing reference source") && line.includes(state.register.sourceVersionId)).length, crossLabels.length);
      assert.ok(!released.includes(V1()), "the updated report cites only the corrected version of the service events");
      const csvRows = csvRowsByClaim(await readManifestCsv(delivery.export_manifest_id));
      for (const label of crossLabels) assert.equal(csvRows[correctedClaims[label]], `${CORRECTED_STATE.sourceVersionId};${state.register.sourceVersionId}`, label);
      for (const label of REGRESSION) assert.doesNotMatch(csvRows[derivedClaims[label]], /;/, label);
      assert.ok(!Object.values(csvRows).some((versions) => versions.includes(V1())), "the CSV appendix does not cite the replaced version");
      assert.doesNotMatch(released, /CB0\d\d|EV0\d\d/);
      for (const label of crossLabels) {
        assert.ok(released.includes(String(report.corrected_version.recalculation.corrected[label])), `${label}: its value is in the released document`);
        const entry = entries.find((candidate) => candidate.claim_id === correctedClaims[label]);
        assert.ok(entry?.limitation_codes.includes("derived.cross_source_linked"), J(entry));
      }
      // Both releases stay identifiable: the new one is current, the earlier one historical with its original lineage.
      const historical = await readReleased(state.stageAReleasedManifestId);
      assert.deepEqual([historical.status, historical.body.data.released_report_state], [409, "historical"]);
      assert.equal((await readReleased(delivery.export_manifest_id)).status, 200);
      report.corrected_version.releases = { historical: state.stageAReleasedManifestId, current: delivery.export_manifest_id };
    });

    await test("30b: B4 - the corrected monthly activity and duration claims are generated, reviewed and released; the original activity release is historical", async () => {
      const activity = report.corrected_version.activity;
      const claims = { monthly: activity.measurements.monthly_eligible_encounters.claim_id, duration: activity.measurements.known_recorded_service_minutes.claim_id };
      const evidence = { monthly: activity.measurements.monthly_eligible_encounters.evidence_id, duration: activity.measurements.known_recorded_service_minutes.evidence_id };
      const expected = { months: activity.months, total: activity.eligible, known: activity.known, missing: activity.missing, invalid: activity.invalid, minutes: activity.minutes };
      const { summary: delivery, released } = await deliverActivity({ claims, evidence, primaryVersionId: CORRECTED_STATE.sourceVersionId, expected, tag: "corrected" });
      assert.ok(!released.includes(V1()), "the corrected release cites only the corrected service-events version");
      for (const old of Object.values(activityOriginal)) assert.ok(!released.includes(old.claimId), "no superseded activity claim");
      const historical = await readReleased(state.activityOriginalManifestId);
      assert.deepEqual([historical.status, historical.body.data.released_report_state], [409, "historical"], J(historical.body));
      assert.equal((await readReleased(delivery.export_manifest_id)).status, 200);
      report.generation.activity_corrected = delivery;
      report.corrected_version.activity_releases = { historical: state.activityOriginalManifestId, current: delivery.export_manifest_id };
      console.log(`Cedar Bridge corrected activity release: ${J({ ...delivery, released_excerpt: undefined })}`);
    });

    await test("31: the answer-key comparison after the correction: the challenge metric by method, P01's population, and the final tally", () => {
      const expected = Object.fromEntries(parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Metrics.csv"), "utf8")).map((row) => [row.metric_id, row]));
      const challenge = report.derived_measurements.corrected_reach_encounters;
      const methodValid = challenge.calculation_method === "kai_cross_source_linked_reach_v1" && challenge.definition.metric === "eligible_linked_encounters"
        && J(challenge.contributing_sources.map((s) => s.source_version_id)) === J([CORRECTED_STATE.sourceVersionId, state.register.sourceVersionId])
        && challenge.definition.period.period_start === "2025-04-01" && challenge.definition.period.period_end === "2026-03-31" && challenge.definition.period.precision === "day";
      const expectedV2 = Number(expected.V2_ELIGIBLE_ENCOUNTERS.expected_value);
      // P01 is the roster's distinct participant identifiers (registered people), not people reached: it is matched only by the register component.
      const p01 = report.comparison_cross_source.find((c) => c.metric_id === "P01");
      const p01Population = { required: expected.P01.denominator_or_scope, rule: expected.P01.calculation_rule,
        kai_component: "register_distinct_identifier_count", kai_reached_people: report.derived_measurements.reach_people.measured_value,
        reached_is_a_different_population: true };
      const rows = report.comparison_cross_source.map((row) => (row.metric_id !== "V2_ELIGIBLE_ENCOUNTERS" ? row : {
        metric_id: row.metric_id, expected: expectedV2, actual: challenge.measured_value, previous_difference: row.difference,
        difference: challenge.measured_value === expectedV2 && methodValid ? "match" : challenge.measured_value === expectedV2 ? "number_matches_method_differs" : "incorrect",
        capability: "corrected_source_version", method_valid: methodValid, contributing_sources: challenge.contributing_sources, period: challenge.definition.period,
        persisted: true, claim_id: correctedClaims.reach_encounters, superseded_source_version_id: V1(),
      }));
      report.comparison_final = rows;
      report.p01_definition = { ...p01Population, verdict: p01.difference, calculation: p01.calculation };
      const tally = rows.reduce((acc, c) => ({ ...acc, [c.difference]: (acc[c.difference] ?? 0) + 1 }), {});
      report.comparison_tally.final = tally;
      console.log(`Cedar Bridge final comparison tally: ${J(tally)}; P01: ${J(report.p01_definition)}`);
      assert.equal(rows.find((c) => c.metric_id === "V2_ELIGIBLE_ENCOUNTERS").difference, "match");
      assert.equal(p01.difference, "match");
      assert.match(p01.calculation, /distinct register participant identifiers/);
      assert.equal(rows.length, 73);
    });

    // -------------------------------------------------------------------------
    // Stage E (2026-11-04): the narrative documents in the same connected
    // journey. The Operations Notes TXT and the Programme Review PDF were
    // promoted in test 3 (the promotion handoff already read their text); the
    // verified survey PDF is uploaded now through the same intake, and the
    // original FY2025-26 PDF stays blocked by the PDF security assessor. Their
    // statements go through Get Kinder's existing evidence and claim review
    // and are generated and released next to the current measured findings.
    const { canOfferEvidenceExtraction, claimGapFollowupsPath, evidenceLibraryCandidatesPath, organizationSourcesPath, projectOrganizationSources } = await import("../frontend/impactEvidenceLibraryLogic.js");
    const { clientEvidencePipelinePath, projectClientEvidencePipeline } = await import("../frontend/knowledgeStudio/clientEvidencePipelineLogic.js");
    const SURVEY_PDF = process.env.KAI_CEDAR_BRIDGE_SURVEY_PDF;
    const ORIGINAL_PDF = process.env.KAI_CEDAR_BRIDGE_ORIGINAL_PDF;
    const DOCUMENT_KEYS = ["notes", "review", "survey"];
    const documentState = { notes: state.notes, review: state.review, survey: {}, original: {} };
    // Statements located in the raw files by this test (not by KAI): the
    // TXT by its line, the PDFs by mupdf's plain page text.
    const DOCUMENT_ANCHORS = {
      employment_not_verified: { key: "notes", text: "No independently verified employment records were obtained for this test period." },
      no_participant_story: { key: "notes", text: "No direct participant story in the team's raw case conversations has been provided for this test" },
      cross_programme_referral: { key: "notes", text: "Facilitators sometimes referred people to Digital Skills sessions and later saw them again in an EN appointment." },
      missing_duration: { key: "notes", text: "When the duration field is missing, coordinators cannot reliably reconstruct the number of delivered minutes" },
      convenience_sample: { key: "survey", text: "It is a convenience sample of attempted check-ins, not a census or a representative survey of the full registered cohort." },
      manager_estimate: { key: "review", text: "at least 100 distinct participants" },
    };
    // The claims Get Kinder reviews for the assessment: the manager estimate
    // (EB13, UNSUPPORTED_CONFLICT) is deliberately not proposed as a claim.
    const CLAIMED_ANCHORS = ["employment_not_verified", "no_participant_story", "cross_programme_referral", "missing_duration", "convenience_sample"];
    const documentClaims = {};
    const documentRows = async (key) => query(
      `SELECT e.evidence_item_id::text, e.source_version_id::text, e.statement, e.evidence_review_status, l.coordinates
         FROM kai.evidence_items e JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
        WHERE e.organization_id = $1::uuid AND e.source_version_id = $2::uuid AND e.evidence_type = 'source_document_statement'
        ORDER BY e.created_at, e.evidence_item_id`, [ORG, documentState[key].sourceVersionId]);
    const documentCounts = async () => (await query(`SELECT
        (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_type = 'source_document_statement')::int AS evidence,
        (SELECT count(*) FROM kai.source_locators l JOIN kai.source_versions v ON v.source_version_id = l.source_version_id
          WHERE v.organization_id = $1::uuid AND l.locator_type = 'document_text_span')::int AS locators,
        (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'extract_document_statement_evidence')::int AS audits`, [ORG]))[0];
    report.documents = {};

    const uploadOne = async ({ path, name }) => {
      const bytes = readFileSync(path);
      const batch = await adminApi("POST", createBatchPath(), { organization_id: ORG, engagement_id: PROJECT, batch_code: `cedar-${randomUUID().slice(0, 8)}`, idempotency_key: `batch-${randomUUID()}` });
      const reserved = await adminApi("POST", fileReservationsPath(batch.body.data.intake_batch_id), {
        organization_id: ORG, engagement_id: PROJECT, original_filename: name, file_extension: ".pdf", mime_type: "application/pdf",
        file_size_bytes: bytes.byteLength, checksum: sha256(bytes), hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
      });
      assert.ok(reserved.status < 300, `${name}: ${J(reserved.body)}`);
      const intakeFileId = reserved.body.data.intake_file_id;
      const signed = await adminApi("POST", requestUploadUrlPath(batch.body.data.intake_batch_id), { organization_id: ORG, engagement_id: PROJECT, intake_file_id: intakeFileId });
      await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: bytes });
      const confirmed = await adminApi("POST", confirmUploadPath(ORG, intakeFileId), { organization_id: ORG });
      assert.equal(confirmed.status, 200, `${name}: ${J(confirmed.body)}`);
      // One PDF at a time: the PDF worker admits one PDF operation at once.
      await dispatcher.whenIdle();
      const [file] = await query("SELECT file_policy_status FROM kai.intake_files WHERE intake_file_id = $1::uuid", [intakeFileId]);
      const [profile] = await query("SELECT profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [intakeFileId]);
      const [sensitivity] = await query(
        `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
           JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
          WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
      return { bytes, intakeFileId, policy: file.file_policy_status, profile: profile?.profile ?? null, sensitivity };
    };

    await test("D1: the verified survey PDF goes through the same intake, security check, P1 worker and promotion; the original FY2025-26 PDF stays blocked", { skip: !SURVEY_PDF || !ORIGINAL_PDF ? "KAI_CEDAR_BRIDGE_SURVEY_PDF / KAI_CEDAR_BRIDGE_ORIGINAL_PDF not set" : false }, async () => {
      const original = await uploadOne({ path: ORIGINAL_PDF, name: "Cedar_Bridge_Survey_Results_FY2025-26.pdf" });
      Object.assign(documentState.original, original);
      assert.deepEqual([original.policy, original.profile, original.sensitivity], ["blocked", null, undefined], "embedded content keeps the original PDF out");
      const [diagnostic] = await query(
        "SELECT reason_code, metadata->>'blocker_code' AS blocker FROM kai.audit_events WHERE organization_id = $1::uuid AND metadata->>'object_id' = $2 ORDER BY created_at DESC LIMIT 1",
        [ORG, original.intakeFileId]);
      const survey = await uploadOne({ path: SURVEY_PDF, name: "Cedar_Bridge_Survey_Results_Verified.pdf" });
      Object.assign(documentState.survey, survey);
      assert.notEqual(survey.bytes.equals(original.bytes), true);
      assert.deepEqual([survey.policy, survey.profile?.status, survey.profile?.format], ["passed", "profiled", "pdf"]);
      assert.doesNotMatch(J(survey.profile), /convenience sample|attempted check-ins/, "the P1 profile stores no document text");
      const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${survey.sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${ORG}`, {
        expected_updated_at: new Date(survey.sensitivity.updated_at).toISOString(), review_queue_item_id: survey.sensitivity.review_queue_item_id,
        decision: "reviewed", reviewed_snapshot: ABSENT,
      });
      assert.equal(decided.status, 200, J(decided.body));
      const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [survey.sensitivity.intake_sensitivity_profile_id]);
      const promoted = await adminApi("POST", sourceCandidateDecisionPath(ORG, candidate.intake_source_candidate_id), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(promoted.status, 200, J(promoted.body));
      const [version] = await query("SELECT source_version_id::text, source_id::text FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [survey.sensitivity.intake_sensitivity_profile_id]);
      Object.assign(documentState.survey, { sourceVersionId: version.source_version_id, sourceId: version.source_id, handoff: promoted.body.data?.evidence_extraction_handoff ?? null });
      report.documents.original_fy2025_26_pdf = { sha256: sha256(original.bytes), policy: original.policy, last_audit: diagnostic ?? null };
      report.documents.survey_upload = { sha256: sha256(survey.bytes), policy: survey.policy, pages: survey.profile?.counts ?? null, handoff: documentState.survey.handoff };
    });

    await test("D2: the documents' own text becomes cited evidence on their existing versions (no re-upload); replay and reload change nothing", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      // The TXT and Programme Review PDF are the versions promoted in test 3:
      // the promotion handoff read them; nothing was uploaded again.
      for (const key of ["notes", "review"]) {
        assert.ok(SOURCES.some((source) => source.key === key) && documentState[key].sourceVersionId, key);
        assert.equal(state[key].profile.format, key === "notes" ? "txt" : "pdf");
        assert.equal((await query("SELECT count(*)::int AS n FROM kai.data_dictionary_fields f JOIN kai.data_dictionaries d ON d.data_dictionary_id = f.data_dictionary_id WHERE d.intake_file_id = $1::uuid", [state[key].intakeFileId]))[0].n, 0,
          `${key}: zero dictionary fields`);
      }
      const extracted = {};
      for (const key of DOCUMENT_KEYS) {
        const rows = await documentRows(key);
        extracted[key] = rows;
        assert.ok(rows.length > 0, `${key}: statements persisted`);
      }
      // Independent location of each anchor in the raw bytes.
      const mupdf = await import("mupdf");
      const pdfPageOf = (bytes, text) => {
        const doc = mupdf.Document.openDocument(new Uint8Array(bytes), "application/pdf");
        let page = 0;
        for (let i = 0; i < doc.countPages(); i += 1) if (doc.loadPage(i).toStructuredText().asText().replace(/\s+/g, " ").includes(text)) page = i + 1;
        doc.destroy();
        return page;
      };
      const rawBytes = { notes: byKey.notes.bytes, review: byKey.review.bytes, survey: documentState.survey.bytes };
      const anchors = {};
      for (const [label, anchor] of Object.entries(DOCUMENT_ANCHORS)) {
        const row = extracted[anchor.key].find((candidate) => candidate.statement.includes(anchor.text));
        assert.ok(row, `${label}: the independently chosen statement is evidence`);
        const independent = anchor.key === "notes"
          ? { unit: "text_lines", line: rawBytes.notes.toString("utf8").split("\n").findIndex((line) => line.includes(anchor.text)) + 1 }
          : { unit: "pdf_page_blocks", page: pdfPageOf(rawBytes[anchor.key], anchor.text) };
        if (independent.unit === "text_lines") {
          assert.ok(row.coordinates.line_start <= independent.line && independent.line <= row.coordinates.line_end, `${label}: ${J(row.coordinates)} vs line ${independent.line}`);
        } else {
          assert.equal(row.coordinates.page_number, independent.page, `${label}: page`);
        }
        assert.equal(row.evidence_review_status, "needs_gk_review");
        anchors[label] = { ...anchor, evidence_item_id: row.evidence_item_id, source_version_id: row.source_version_id, statement: row.statement, coordinates: row.coordinates, independent };
      }
      assert.match(anchors.manager_estimate.statement, /Preliminary reach estimate requiring reconciliation|Internal working estimate/, "EB13 keeps its qualifiers");
      assert.equal(extracted.survey.some((row) => row.statement.includes("An improvement rate among all 80 registered people")), false, "a verbless table cell is not a statement");
      documentState.anchors = anchors;

      // Repeated extraction on every document version writes nothing.
      const before = await documentCounts();
      for (const key of DOCUMENT_KEYS) {
        const replay = await adminApi("POST", evidenceExtractionPath(ORG, documentState[key].sourceVersionId), {});
        assert.equal(replay.status, 200, J(replay.body));
        assert.deepEqual([replay.body.data.documentEvidence.outcome, replay.body.data.replayed, replay.body.data.evidenceItems.length],
          ["statements_extracted", true, extracted[key].length], key);
      }
      assert.deepEqual(await documentCounts(), before, "no duplicate evidence, locator or audit");

      // A reload: the pipeline and Data Sources reads show the documents at
      // Get Kinder's evidence review and never offer extraction again.
      const pipelineRead = await adminApi("GET", clientEvidencePipelinePath(ORG, PROJECT));
      assert.equal(pipelineRead.status, 200, J(pipelineRead.body));
      const pipelineView = projectClientEvidencePipeline(pipelineRead.body.data, PROJECT);
      const sourcesRead = await adminApi("GET", organizationSourcesPath(ORG));
      assert.equal(sourcesRead.status, 200, J(sourcesRead.body));
      const versions = projectOrganizationSources(sourcesRead.body.data).flatMap((source) => source.sourceVersions);
      const reload = {};
      for (const key of DOCUMENT_KEYS) {
        const file = pipelineView.files.find((candidate) => candidate.intakeFileId === documentState[key].intakeFileId);
        const version = versions.find((candidate) => candidate.sourceVersionId === documentState[key].sourceVersionId);
        reload[key] = { stage: file.currentStage, reason: file.reason, next_action: file.nextAction, capability: version.evidenceExtractionCapability, offered: canOfferEvidenceExtraction(version) };
        assert.notEqual(file.nextAction, "extract_evidence", key);
        // Owner decision 2026-11-05 (draft first, commit 1dc33b50): evidence
        // with no claim yet is the administrator's propose-claims step, not a
        // Get Kinder wait. (This assertion expected evidence_awaiting_review
        // before that decision; reconciled in owner Package 4.)
        assert.equal(file.reason, "claim_proposal_ready", key);
        assert.equal(file.nextAction, "propose_claims", key);
      }
      // Nothing was reviewed to get here: every statement still waits for
      // Get Kinder's evidence review, and no review or claim decision exists.
      for (const key of DOCUMENT_KEYS) {
        for (const row of await documentRows(key)) assert.equal(row.evidence_review_status, "needs_gk_review", key);
      }
      assert.deepEqual((await query(`SELECT
          (SELECT count(*) FROM kai.evidence_review_decisions d JOIN kai.evidence_items e ON e.evidence_item_id = d.evidence_item_id WHERE e.organization_id = $1::uuid AND e.evidence_type = 'source_document_statement')::int AS evidence,
          (SELECT count(*) FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id WHERE c.organization_id = $1::uuid AND e.evidence_type = 'source_document_statement')::int AS claims`, [ORG]))[0],
        { evidence: 0, claims: 0 }, "no review or claim was manufactured");
      // The manager estimate keeps its meaning: a claim from it would be
      // source-reported, a source estimate, and never a KAI calculation.
      const estimateExcerpt = DOCUMENT_EVIDENCE.excerptFromDocumentEvidenceStatement(anchors.manager_estimate.statement);
      const estimateClaim = DOCUMENT_EVIDENCE.composeDocumentClaimStatement({ excerpt: estimateExcerpt, coordinates: anchors.manager_estimate.coordinates });
      assert.match(estimateClaim, /^Source-reported, not independently verified \(/);
      assert.ok(DOCUMENT_EVIDENCE.documentGenerationLimitationCodes(estimateClaim).includes("document.source_estimate"), estimateClaim);
      const originalFile = pipelineView.files.find((candidate) => candidate.intakeFileId === documentState.original.intakeFileId);
      reload.original = { stage: originalFile.currentStage, status: originalFile.currentStatus, reason: originalFile.reason, next_action: originalFile.nextAction };
      assert.equal(originalFile.currentStatus, "failed", J(originalFile));

      // The real Impact Evidence Library lists every statement for review.
      const seen = [];
      let after = null;
      do {
        const page = await gkApi("GET", evidenceLibraryCandidatesPath(ORG, after));
        assert.equal(page.status, 200, J(page.body));
        seen.push(...page.body.data.items);
        after = page.body.data.nextAfterEvidenceItemId;
      } while (after);
      const listed = seen.filter((item) => item.evidenceType === "source_document_statement");
      assert.equal(listed.length, before.evidence);
      for (const anchor of Object.values(anchors)) assert.ok(listed.some((item) => item.evidenceItemId === anchor.evidence_item_id));
      report.documents.extraction = {
        statements: Object.fromEntries(DOCUMENT_KEYS.map((key) => [key, extracted[key].length])), totals: before,
        anchors: Object.fromEntries(Object.entries(anchors).map(([label, a]) => [label, { source: a.key, coordinates: a.coordinates, independent: a.independent, statement: a.statement }])),
        reload, library_listed: listed.length,
      };
      console.log(`Cedar Bridge documents: ${J(report.documents.extraction.statements)}; reload ${J(reload)}`);
    });

    await test("D3: Get Kinder reviews the chosen statements; the administrator's claims restate them as source-reported and become internally eligible", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      const queueOf = async (queueType, targetId) => (await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
        [ORG, queueType, targetId]))[0];
      const claims = {};
      // One synthetic client reviewer of the organization (test setup, as the
      // Get Kinder reviewer above): only client_reviewer completes follow-ups.
      await query("INSERT INTO public.userdata (id) VALUES (989) ON CONFLICT DO NOTHING");
      const reviewerUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 989, email: "user989@cedar.test" });
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_reviewer', 'active')", [ORG, reviewerUser.user_id]);
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'client_reviewer' ON CONFLICT DO NOTHING", [reviewerUser.user_id]);
      const clientReviewerApi = client(989);
      for (const label of CLAIMED_ANCHORS) {
        const anchor = documentState.anchors[label];
        const evidenceQueue = await queueOf("evidence_review", anchor.evidence_item_id);
        const evidence = await gkApi("POST", evidenceReviewCompletePath(ORG, anchor.evidence_item_id, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        assert.ok([200, 201].includes(evidence.status), `${label}: ${J(evidence.body)}`);
        const proposed = await adminApi("POST", claimProposalPath(ORG, anchor.evidence_item_id), {});
        assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
        const claimId = proposed.body.data.claim.claim_id;
        const p204 = await adminApi("POST", claimGapFollowupsPath(ORG, claimId), {});
        const gaps = await query("SELECT dimension_key, assessment_status FROM kai.gap_log_items WHERE claim_id = $1::uuid ORDER BY dimension_key", [claimId]);
        const followups = await query("SELECT dimension_key FROM kai.client_followup_items WHERE claim_id = $1::uuid ORDER BY dimension_key", [claimId]);
        const initial = await traceOf(claimId);
        assert.equal(p204.status, 200, `${label}: ${J(p204.body)}`);
        assert.equal(initial.eligible, false, `${label}: Get Kinder's claim review is required`);
        const claimQueue = await queueOf("claim_review", claimId);
        const reviewed = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        assert.ok([200, 201].includes(reviewed.status), `${label}: ${J(reviewed.body)}`);
        // The existing P2-04 routed the client-answerable coverage questions
        // (as for every non-measured claim); the organization's client
        // reviewer completes each through the existing P2-11 route.
        const completedFollowups = [];
        for (const followup of followups) {
          const [item] = await query("SELECT client_followup_item_id::text FROM kai.client_followup_items WHERE claim_id = $1::uuid AND dimension_key = $2", [claimId, followup.dimension_key]);
          const [followupQueue] = await query("SELECT updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'client_followup' AND target_object_id = $2::uuid", [ORG, item.client_followup_item_id]);
          const completed = await clientReviewerApi("POST", `${orgPath}/claims/${claimId}/client-followups/${item.client_followup_item_id}/complete`, { expected_updated_at: new Date(followupQueue.updated_at).toISOString() });
          assert.ok([200, 201].includes(completed.status), `${label} ${followup.dimension_key}: ${J(completed.body)}`);
          completedFollowups.push(followup.dimension_key);
        }
        // A document statement's own form answers the field-level dimensions
        // (2026-11-04): no client question is routed about a field it does not
        // have, and only the source-level dimensions need Get Kinder's
        // internal acceptance, as for a derived measurement.
        assert.deepEqual(followups, [], `${label}: no client follow-up`);
        const accepted = [];
        for (const dimensionKey of (await traceOf(claimId)).unresolved) accepted.push([dimensionKey, (await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimensionKey), {})).status]);
        assert.deepEqual(accepted, [["conflicting_source_indicators", 201], ["requirement_alignment", 201]], `${label}: ${J(accepted)}`);
        const traced = await traceOf(claimId);
        if (!traced.eligible) assert.fail(`${label}: ${J((await gkApi("GET", claimTraceabilityPath(ORG, claimId, "internal"))).body?.data?.blockerCodes)}`);
        const [row] = await query("SELECT statement, internal_only, public_use_allowed, funder_use_allowed FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        assert.match(row.statement, /^Source-reported, not independently verified \((?:line|lines|page)[^)]*\): "/, row.statement);
        assert.ok(row.statement.includes(anchor.text), `${label}: the claim quotes the excerpt`);
        assert.equal(traced.eligible, true, `${label}: ${J(traced)}`);
        assert.deepEqual([(await traceOf(claimId, "funder")).eligible, (await traceOf(claimId, "public")).eligible, row.internal_only], [false, false, true]);
        claims[label] = { claim_id: claimId, evidence_item_id: anchor.evidence_item_id, statement: row.statement, p204_gaps: gaps, client_followups_completed: completedFollowups, coverage_accepted: accepted };
        documentClaims[label] = claimId;
      }
      // The manager estimate stays evidence awaiting review; no claim exists for it.
      const [estimate] = await query("SELECT evidence_review_status, (SELECT count(*)::int FROM kai.claims c WHERE c.evidence_item_id = e.evidence_item_id) AS claims FROM kai.evidence_items e WHERE evidence_item_id = $1::uuid",
        [documentState.anchors.manager_estimate.evidence_item_id]);
      assert.deepEqual([estimate.evidence_review_status, estimate.claims], ["needs_gk_review", 0]);
      report.documents.claims = claims;
    });

    await test("D4: one internal Evidence Summary cites the document statements with the current measured findings; Get Kinder releases it and the client receives it", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      const measured = ["reach_encounters", "reach_people", "reach_DS_people", "reach_EN_people", "reach_both"].map((label) => correctedClaims[label]);
      for (const claimId of measured) assert.equal((await traceOf(claimId)).eligible, true);
      const claimIds = [...measured, ...CLAIMED_ANCHORS.map((label) => documentClaims[label])];
      const callsBefore = modelCalls.length;
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/evidence-summary`, { claim_ids: claimIds, idempotency_key: `cedar-assessment-${randomUUID()}`, engagement_id: PROJECT });
      report.documents.generation = { status: created.status, blockers: blockersOf(created), claim_ids: claimIds };
      assert.equal(created.status, 201, J(created.body));
      assert.equal(modelCalls.length, callsBefore + 1);
      const sent = modelCalls.at(-1).claims;
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/, "no participant, event or follow-up identifier reaches the model");
      const draftId = created.body.data.generatedContentDraftId;
      const blocks = await query(
        `SELECT b.ordinal, b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid ORDER BY b.ordinal`, [draftId]);
      for (const label of CLAIMED_ANCHORS) {
        const block = blocks.find((candidate) => candidate.claim_id === documentClaims[label]);
        assert.ok(block, `${label}: cited`);
        assert.equal(block.evidence_item_id, documentState.anchors[label].evidence_item_id);
        assert.ok(block.text.includes(DOCUMENT_ANCHORS[label].text), `${label}: the excerpt is kept verbatim`);
      }
      const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${draftId}/review-packet`);
      assert.equal(packet.status, 200, J(packet.body));
      const delivery = await releaseThroughGetKinder(draftId);
      const { released, entries, ...statuses } = delivery;
      assert.deepEqual([delivery.gk_content_review, delivery.export_review_request, delivery.export_review_start, delivery.export_review_complete,
        delivery.limitation_snapshot, delivery.export_candidate, delivery.final_release_authority, delivery.export_manifest, delivery.client_released_markdown],
        [[200, 200], 201, 200, 200, 201, 201, 201, 201, 200], J(statuses));
      assert.equal(typeof released, "string");
      for (const label of CLAIMED_ANCHORS) {
        assert.ok(released.includes(documentClaims[label]), `${label}: claim in the released document`);
        assert.ok(released.includes(documentState.anchors[label].source_version_id), `${label}: its source version is cited`);
      }
      for (const claimId of measured) assert.ok(released.includes(claimId));
      assert.doesNotMatch(released, /CB0\d\d|EV0\d\d|FU0\d\d/);
      const csvRows = csvRowsByClaim(await readManifestCsv(delivery.export_manifest_id));
      for (const label of CLAIMED_ANCHORS) assert.equal(csvRows[documentClaims[label]], documentState.anchors[label].source_version_id, label);
      const markdownPath = REPORT_PATH ? REPORT_PATH.replace(/\.json$/, "") + ".released-assessment.md" : null;
      if (markdownPath) writeFileSync(markdownPath, released);
      report.documents.generation = {
        ...report.documents.generation, draft_id: draftId, model_request_limitation_codes: sent.map((claim) => [claim.claimId, claim.limitationCodes]),
        blocks: blocks.map((b) => ({ ordinal: b.ordinal, claim_id: b.claim_id, evidence_item_id: b.evidence_item_id, text: b.text })),
        delivery: statuses, limitation_entries: entries, released_markdown_path: markdownPath, released_characters: released.length,
      };
      console.log(`Cedar Bridge assessment release: ${J(statuses)}; markdown ${markdownPath}`);
    });

    // -------------------------------------------------------------------------
    // Stage F (2026-11-04): the six-section Free Impact Assessment from the
    // persistent Impact Evidence Library. Every claim the library lists as
    // currently eligible for internal use is composed; nothing is seeded and
    // no Cedar Bridge figure is written by the test. The narrative sections
    // come from the deterministic stub above (no language model); the gaps,
    // three proposed improvements and next steps are composed by the server.
    const ASSESSMENT_TITLES = ["Executive Impact Snapshot", "What Your Evidence Tells Us", "Impact Stories", "Gaps and Opportunities", "Three Recommended Improvements", "Your Next Steps"];
    const assessmentState = {};
    await test("F1: a Free Impact Assessment is composed from every currently eligible library claim, saved, and retrievable", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      report.free_impact_assessment = assessmentState;
      const { eligibleClaimsPath } = await import("../frontend/impactEvidenceLibraryLogic.js");
      // The eligible-claims read is a Get Kinder role read (unchanged); the
      // organization administrator then drafts, as for the Evidence Summary.
      const listed = await gkApi("GET", eligibleClaimsPath(ORG, "internal"));
      assert.equal(listed.status, 200, J(listed.body));
      assert.equal(listed.body.data.truncated, false, "the whole eligible library fits one page");
      const eligibleIds = [...new Set(listed.body.data.eligibleClaims.map((item) => item.claimId))].sort();
      const library = await query(`SELECT c.claim_id::text, e.evidence_type, c.statement FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id
        WHERE c.claim_id = ANY($1::uuid[]) ORDER BY c.claim_id`, [eligibleIds]);
      // The request takes at most 20 claims (the existing route limit). When the
      // library holds more, the person composing leaves out the raw P2-01M
      // record counts, whose rows the derived measurements already measure.
      const claimIds = (eligibleIds.length > 20 ? library.filter((row) => row.evidence_type !== "source_record_count_measurement") : library).map((row) => row.claim_id).sort();
      assessmentState.library = { eligible: library.map((row) => ({ claim_id: row.claim_id, evidence_type: row.evidence_type, selected: claimIds.includes(row.claim_id) })) };
      for (const label of CLAIMED_ANCHORS) assert.ok(claimIds.includes(documentClaims[label]), `${label}: eligible in the library`);
      for (const label of ["reach_encounters", "reach_people", "reach_DS_people", "reach_EN_people", "reach_both"]) assert.ok(claimIds.includes(correctedClaims[label]), label);
      assert.ok(claimIds.length <= 20, `${claimIds.length} eligible claims`);
      const callsBefore = modelCalls.length;
      const created = await adminApi("POST", `${orgPath}/generated-content-drafts/free-impact-assessment`, { claim_ids: claimIds, idempotency_key: `cedar-free-assessment-${randomUUID()}`, engagement_id: PROJECT });
      assessmentState.generation = { status: created.status, blockers: blockersOf(created), claim_ids: claimIds };
      assert.equal(created.status, 201, J(created.body));
      assert.equal(modelCalls.length, callsBefore + 1);
      const call = modelCalls.at(-1);
      assert.equal(call.assessment.composition, "free_impact_assessment");
      assert.equal(call.assessment.participantStoryEvidence, "none_cited");
      for (const c of modelCalls) assert.doesNotMatch(c.serialized, /CB0\d\d|EV0\d\d|FU0\d\d/, "no participant, event or follow-up identifier reaches the model");
      const draftId = created.body.data.generatedContentDraftId;
      const blocks = await query(
        `SELECT b.ordinal, b.text, array_agg(c.claim_id::text ORDER BY c.claim_id) AS claim_ids FROM kai.generated_content_blocks b
           JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
          WHERE b.generated_content_draft_id = $1::uuid GROUP BY b.ordinal, b.text ORDER BY b.ordinal`, [draftId]);
      const { parseFreeImpactAssessment } = await import("../Backend/kai/services/kaiFreeImpactAssessmentComposition.js");
      const sections = parseFreeImpactAssessment(blocks.map((b) => ({ ordinal: b.ordinal, text: b.text, claimIds: b.claim_ids })));
      assert.ok(sections, "the persisted draft is a six-section assessment");
      assert.deepEqual(sections.map((section) => section.title), ASSESSMENT_TITLES);
      for (const section of sections) assert.ok(section.blocks.map((b) => b.body).join(" ").length >= 200, `${section.title} is substantive`);
      const prose = (section) => section.blocks.map((b) => b.body.split("Measurement disclosure for")[0]).join("\n");
      for (const section of sections) assert.doesNotMatch(prose(section), /\bfield_\d+\b/, `${section.title}: no internal field key in the prose`);
      // Figures: each cited measurement's persisted value is stated in a block
      // citing it, and the reach figures equal the independent answer key.
      const expected = Object.fromEntries(parseCsv(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Expected_Metrics.csv"), "utf8")).map((row) => [row.metric_id, row]));
      const keyed = { reach_people: "E_DISTINCT_SERVED_PEOPLE", reach_DS_people: "E_DISTINCT_DS_SERVED", reach_EN_people: "E_DISTINCT_EN_SERVED", reach_both: "E_DISTINCT_SERVED_BOTH", reach_encounters: "V2_ELIGIBLE_ENCOUNTERS" };
      const figures = {};
      for (const [label, metricId] of Object.entries(keyed)) {
        const claimId = correctedClaims[label];
        const [row] = await query(`SELECT m.measured_value FROM kai.claims c JOIN kai.evidence_derived_measurements edm ON edm.evidence_item_id = c.evidence_item_id
          JOIN kai.source_derived_measurements m ON m.source_derived_measurement_id = edm.source_derived_measurement_id WHERE c.claim_id = $1::uuid`, [claimId]);
        const citing = blocks.filter((b) => b.claim_ids.includes(claimId));
        figures[label] = { metric_id: metricId, expected: Number(expected[metricId].expected_value), persisted: Number(row.measured_value), stated_in_citing_block: citing.some((b) => new RegExp(`(?<![\\d.])${row.measured_value}(?![\\d.])`).test(b.text)) };
        assert.deepEqual([figures[label].persisted, figures[label].stated_in_citing_block], [figures[label].expected, true], `${label}: ${J(figures[label])}`);
      }
      // Every other answer-key metric matched earlier (test 31) whose claim the
      // assessment cites is stated with the key's value in a citing block.
      const numbersIn = (value) => [...String(value).matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
      const keyMatches = report.comparison_final.filter((row) => row.difference === "match" && row.claim_id && claimIds.includes(row.claim_id))
        .map((row) => ({ metric_id: row.metric_id, expected: Number(row.expected), claim_id: row.claim_id,
          stated: blocks.some((b) => b.claim_ids.includes(row.claim_id) && numbersIn(b.text.split("Measurement disclosure for")[0]).includes(Number(row.expected))) }));
      for (const row of keyMatches) assert.ok(row.stated, J(row));
      assert.ok(keyMatches.length >= 12, `${keyMatches.length} answer-key figures checked`);
      figures.answer_key_rows = keyMatches;
      // PDF/TXT evidence: every document claim is cited, and its quoted words appear verbatim.
      for (const label of CLAIMED_ANCHORS) {
        assert.ok(blocks.some((b) => b.claim_ids.includes(documentClaims[label]) && b.text.includes(DOCUMENT_ANCHORS[label].text)), `${label}: quoted with its citation`);
      }
      const stories = sections[2].blocks.map((b) => b.body).join("\n");
      assert.match(stories, /Participant story evidence: none is available/);
      assert.ok(sections[2].blocks.some((b) => b.claimIds.includes(documentClaims.no_participant_story)), "the missing-story statement cites the source that records it");
      // Three proposed improvements, each grounded in a documented gap that its citations carry.
      const recommendations = sections[4].blocks;
      assert.equal(recommendations.length, 3);
      for (const rec of recommendations) {
        assert.match(rec.body, /^Proposed change: .+ Basis: .+ This is a proposal for the organization to consider; it is not a measured or confirmed result\.(?: Measurement disclosure for .+)?$/s);
        assert.ok(rec.claimIds.length >= 1);
      }
      assert.match(recommendations[0].body, /duration/i);
      assert.ok(recommendations[0].claimIds.includes(documentClaims.missing_duration), "duration: grounded in the operations note on missing durations");
      assert.match(recommendations[1].body, /follow-up/i);
      assert.ok(recommendations[1].claimIds.includes(documentClaims.convenience_sample) && recommendations[1].claimIds.includes(documentClaims.employment_not_verified), "follow-up: grounded in the convenience-sample and check-in statements");
      assert.match(recommendations[2].body, /duplicate/i);
      const [dupClaim] = recommendations[2].claimIds;
      const [dupCodes] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [dupClaim]);
      assert.ok(dupCodes, "duplicates: grounded in a measured claim");
      // Saved and retrievable: the Library's drafts index and the review packet.
      const index = await gkApi("GET", `${orgPath}/generated-content-drafts?limit=25`);
      assert.equal(index.status, 200, J(index.body));
      assert.ok(J(index.body).includes(draftId), "listed in the persistent drafts index");
      const packet = await gkApi("GET", `${orgPath}/generated-content-drafts/${draftId}/review-packet`);
      assert.equal(packet.status, 200, J(packet.body));
      Object.assign(assessmentState, { draftId, figures, block_count: blocks.length, characters: blocks.reduce((n, b) => n + b.text.length, 0),
        sections: sections.map((section) => ({ title: section.title, blocks: section.blocks.length, claim_ids: [...new Set(section.blocks.flatMap((b) => b.claimIds))] })),
        recommendations: recommendations.map((rec) => ({ text: rec.body.split(" Measurement disclosure for")[0], claim_ids: rec.claimIds })) });
    });

    await test("F2: Get Kinder's existing review and release; the client receives the six-section assessment; the PDF is 4 to 6 pages", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      assert.ok(assessmentState.draftId, "F1 produced the draft");
      const delivery = await releaseThroughGetKinder(assessmentState.draftId);
      const { released, entries, ...statuses } = delivery;
      assert.deepEqual([delivery.gk_content_review, delivery.export_review_request, delivery.export_review_start, delivery.export_review_complete,
        delivery.limitation_snapshot, delivery.export_candidate, delivery.final_release_authority, delivery.export_manifest, delivery.client_released_markdown],
        [[200, 200], 201, 200, 200, 201, 201, 201, 201, 200], J(statuses));
      assert.equal(typeof released, "string");
      assert.match(released, /^# Free Impact Assessment\n/);
      ASSESSMENT_TITLES.forEach((title, index) => assert.ok(released.includes(`## ${index + 1}. ${title}`), title));
      assert.match(released, /\*\*Reporting period:\*\* 2025-04-01 to 2026-03-31/);
      assert.match(released, /internal use only/);
      assert.doesNotMatch(released, /\[\[assessment:/);
      assert.doesNotMatch(released, /CB0\d\d|EV0\d\d|FU0\d\d/);
      // Limitations stay visible: document claims carry source-reported and accepted coverage limitations.
      for (const label of CLAIMED_ANCHORS) {
        const entry = entries.find((candidate) => candidate.claim_id === documentClaims[label]);
        assert.ok(entry.limitation_codes.includes("document.source_reported_not_verified"), `${label}: ${J(entry.limitation_codes)}`);
        assert.ok(entry.limitation_codes.some((code) => code.endsWith(".accepted_internal_limitation")), `${label}: accepted coverage limitation carried`);
      }
      assert.match(released, /quoted verbatim from the organization's own document|what the source document states/i);
      assert.match(released, /accepted as a limitation for internal use only/);
      assert.match(released, /## Evidence and sources[\s\S]*Source-reported statement \((?:line|page)/);
      assert.match(released, /## Evidence and sources[\s\S]*People served/);
      // The existing PDF export of the same manifest.
      const exportFlag = process.env.KAI_PUBLIC_EXPORT_ENABLED;
      process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
      let pdf;
      try {
        const response = await fetch(`${baseUrl}${orgPath}/export-manifests/${delivery.export_manifest_id}/pdf`, { headers: { Accept: "application/pdf", Cookie: `kai_harness_user=${USERS.gkAdmin}` } });
        assert.equal(response.status, 200, await response.clone().text());
        pdf = Buffer.from(await response.arrayBuffer());
      } finally {
        if (exportFlag === undefined) delete process.env.KAI_PUBLIC_EXPORT_ENABLED; else process.env.KAI_PUBLIC_EXPORT_ENABLED = exportFlag;
      }
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
      // Inspect the actual PDF, not only its header/page objects. Every reviewed
      // block's prose must survive the PDF serializer; disclosures and citation
      // identities are checked separately because the renderer groups them.
      const { default: mupdf } = await import("mupdf");
      const pdfDocument = mupdf.Document.openDocument(pdf, "application/pdf");
      assert.equal(pdfDocument.countPages(), pages);
      const pdfPages = Array.from({ length: pages }, (_, index) => pdfDocument.loadPage(index).toStructuredText().asText());
      const normalizeText = (text) => text.normalize("NFKC").replace(/(\p{L})-\s*\n\s*(?=\p{L})/gu, "$1-").replace(/\s+/g, " ").trim();
      const pdfText = normalizeText(pdfPages.join("\n"));
      const savedBlocks = await query("SELECT text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid ORDER BY ordinal", [assessmentState.draftId]);
      for (const block of savedBlocks) {
        const prose = block.text.replace(/^\[\[assessment:[a-z_]+\]\]\n/, "").split(/\s*Measurement disclosure for /)[0];
        assert.ok(pdfText.includes(normalizeText(prose)), `reviewed prose missing from PDF: ${prose.slice(0, 100)}`);
      }
      for (const title of ASSESSMENT_TITLES) assert.ok(pdfText.includes(title), title);
      for (const figure of ["25 of 38 comparable participant pairs (65.79%)", "23 of 40 comparable participant pairs (57.50%)"]) assert.ok(pdfText.includes(figure), figure);
      assert.ok(pdfText.includes("not every participant") && pdfText.includes("not independently verified"), "population and evidence limitations survive PDF rendering");
      assert.doesNotMatch(pdfText, /CB0\d\d|EV0\d\d|FU0\d\d|\[\[assessment:/);
      const again = await readReleased(delivery.export_manifest_id);
      assert.deepEqual([again.status, again.body], [200, released], "a new application request retrieves the same released report");
      const markdownPath = REPORT_PATH ? REPORT_PATH.replace(/\.json$/, "") + ".free-impact-assessment.md" : null;
      const pdfPath = REPORT_PATH ? REPORT_PATH.replace(/\.json$/, "") + ".free-impact-assessment.pdf" : null;
      if (markdownPath) writeFileSync(markdownPath, released);
      if (pdfPath) writeFileSync(pdfPath, pdf);
      if (pdfPath) writeFileSync(`${pdfPath}.txt`, pdfPages.join("\n"));
      Object.assign(assessmentState, { delivery: statuses, limitation_entries: entries, released_markdown_path: markdownPath, pdf_path: pdfPath, pdf_pages: pages,
        pdf_reviewed_prose_verified: savedBlocks.length, released_reload_verified: true, released_characters: released.length });
      assert.ok(pages >= 4 && pages <= 6, `${pages} PDF pages`);
      console.log(`Cedar Bridge Free Impact Assessment: ${pages} PDF pages; ${J(statuses)}; ${markdownPath}`);
    });

    await test("F3: a fabricated figure and an invented quotation are never saved; the assessment is restated from the cited claims instead of failing", { skip: !SURVEY_PDF ? "survey PDF not set" : false }, async () => {
      // Owner direction 2026-11-10 (before: 422 with nothing persisted).
      const claimIds = assessmentState.generation.claim_ids;
      const outcomes = {};
      for (const [label, mutate, injected] of [
        ["fabricated_figure", (blocks) => blocks.map((block, index) => (index === 0 ? { ...block, text: `${block.text} Participation rose by 47 per cent.` } : block)), "Participation rose by 47 per cent."],
        ["invented_quotation", (blocks) => blocks.map((block) => (block.section === "impact_stories" ? { ...block, text: `${block.text} One participant said "this programme changed my life completely".` } : block)), "this programme changed my life completely"],
      ]) {
        assessmentStub = mutate;
        try {
          const created = await adminApi("POST", `${orgPath}/generated-content-drafts/free-impact-assessment`, { claim_ids: claimIds, idempotency_key: `cedar-free-assessment-${label}-${randomUUID()}`, engagement_id: PROJECT });
          assert.equal(created.status, 201, J(created.body));
          const draftId = created.body.data.generatedContentDraftId;
          const [draft] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [draftId]);
          const saved = (await query("SELECT text FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid", [draftId])).map((row) => row.text).join("\n");
          const restated = draft.validator_results.find((r) => r.validator_key === "VAL-GEN-ASSESSMENT-001").evidence.restated_model_block_ordinals;
          outcomes[label] = { status: created.status, restated, injected_saved: saved.includes(injected) };
          assert.equal(outcomes[label].injected_saved, false, `${label}: never saved`);
          assert.ok(restated === "all" || restated.length > 0, J(outcomes[label]));
        } finally {
          assessmentStub = null;
        }
      }
      assessmentState.refusals = outcomes;
    });
  } finally {
    if (REPORT_PATH) writeFileSync(REPORT_PATH, `${J(report, null, 2)}\n`);
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
