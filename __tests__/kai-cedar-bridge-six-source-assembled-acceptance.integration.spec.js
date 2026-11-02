import test from "node:test";
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
 * Skipped otherwise.
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
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claims: requestBody.claims, serialized: J(payload) });
    return { content: [{ type: "text", text: J({ approved: true, draftStatus: "released",
      blocks: requestBody.claims.map((claim) => ({ text: claim.claimStatement, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] })) }) }] };
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
  const router = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const config = await import("../Backend/kai/config/kaiSprint2Config.js");
  const auth = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const runtimeService = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const upload = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const executor = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const assessor = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const dispatch = await import("../Backend/kai/parsing/p1FileDispatch.js");

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
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 983 });
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
  const orgPath = `${BASE_PATH}/admin/organizations/${ORG}`;
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const blockersOf = (response) => (response.body?.blockers || response.body?.error?.blockers || []).map((b) => b.blocking_reason || b.code || b.reason);

  // The boundary report: what each file and each finding actually reached.
  const report = {
    generated_at: new Date().toISOString(),
    repository_head: null,
    reporting_context: null,
    sources: Object.fromEntries(SOURCES.map((source) => [source.key, { file: source.name, sha256: source.checksum, bytes: source.bytes.byteLength, stages: [] }])),
    measurements: {},
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
        const markdown = await adminApi("GET", clientInternalReportMarkdownPath(ORG, PROJECT, draftId));
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
        assert.match(claim.statement, /with no reporting period defined/, `${label}: the engagement's reporting period is not applied to the count`);
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
      // the client's own Markdown stays closed for personal-information sources.
      const summary = report.generation.evidence_summary;
      assert.deepEqual([summary.status, summary.blocks.length, summary.markdown_status, summary.markdown_blockers, summary.gk_review_packet.status],
        [201, 4, 422, ["personal_information_not_cleared"], 200]);
      for (const block of summary.blocks) assert.match(block.text, /Measurement disclosure for the cited count/);
    });

  } finally {
    if (REPORT_PATH) writeFileSync(REPORT_PATH, `${J(report, null, 2)}\n`);
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
