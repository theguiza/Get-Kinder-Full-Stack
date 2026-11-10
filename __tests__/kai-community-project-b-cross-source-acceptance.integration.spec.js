import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Synthetic Community Impact Project B: cross-source impact measurement
 * (owner Package 2, 2026-11-10), on the Cedar Bridge runner's disposable
 * loopback PostgreSQL (the Plan A normal migration chain). Run only by
 *   KAI_COMMUNITY_PROJECT_B_PACKAGE=<package root> node scripts/kai-cedar-bridge-six-source-acceptance-local-postgres.js
 * Skipped otherwise.
 *
 * Two of the package's original upload files go through KAI's real local
 * processing: 02_Community_Participant_Roster.csv and
 * 03_Community_Service_Log.csv. Real: the intake API, the bounded security
 * assessment, the P1 worker and profiler, the human sensitivity / allowed-use
 * decision and promotion routes (including successor promotion), the record
 * count (P2-01M), the derived-measurement basis read, the cross-source
 * request route, the reconciliation job, worker and its byte read, the
 * persisted derived measurements and contributing sources, the interpretation
 * and claim-proposal routes, P2-06 traceability with the Package 1 integrity
 * rule, and Get Kinder's existing review routes. Simulated at external
 * boundaries only: the session (harness cookie), object storage (in-process
 * signed PUT) and the malware scanner (clean adapter behind the real
 * assessor). No model provider is called.
 *
 * Oracles: every expected stage value is recomputed here from the original
 * bytes by a calculation that shares no code with KAI, and is also compared
 * with the owner-supplied Project B expectations (constants below). The
 * package's answer-key folder is read only for the file checksums; no
 * expected metric is read, and nothing from the package reaches KAI except
 * the two uploaded files.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_CEDAR_ACCEPTANCE_DATABASE_NAME;
const PACKAGE = process.env.KAI_COMMUNITY_PROJECT_B_PACKAGE;
const REPORT_PATH = process.env.KAI_CEDAR_BRIDGE_REPORT;

// Owner-supplied independent acceptance expectations (Package 2 prompt, section 2).
const OWNER_EXPECTED = Object.freeze({
  raw: 217, deduplicated: 215, cancelled: 11, no_show: 7, completed_all_dates: 197, completed_outside_period: 5, completed_in_period: 192,
  unmatched_in_period: 2, eligible: 190, people: 67, cc_contacts: 105, ra_contacts: 85, cc_people: 42, ra_people: 36, both: 11,
});
const PERIOD = Object.freeze({ start: "2024-04-01", end: "2025-03-31" });
// Identifier shapes of the synthetic files; none may appear in a profile, response or audit row.
const RAW_IDENTIFIER = /\bCE\d{4}\b|\bCBR\d{3}\b/;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`Project B acceptance refused a non-loopback database URL host: ${host}`);
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Minimal RFC 4180 reader (test-side only; shares no code with KAI's profiler).
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
  return body.map((r, index) => ({ ...Object.fromEntries(header.map((key, i) => [key, r[i] ?? ""])), __row: index + 2, __line: r.join("\u0001") }));
}

/**
 * The independent Project B calculation, stage by stage, from the original
 * bytes. Event identity: one event per event_id; a repeated event_id whose
 * whole record is identical is an exact duplicate copy.
 */
function independentProjectB(eventsText, rosterText) {
  const events = parseCsv(eventsText);
  const roster = new Set(parseCsv(rosterText).map((r) => r.participant_id.trim()));
  const byId = new Map();
  for (const r of events) byId.set(r.event_id, [...(byId.get(r.event_id) || []), r]);
  const exactCopies = [...byId.values()].filter((copies) => copies.length > 1);
  const allExact = exactCopies.every((copies) => new Set(copies.map((r) => r.__line)).size === 1);
  const firsts = [...byId.values()].map((copies) => copies[0]);
  const status = (label) => firsts.filter((r) => r.delivery_status === label);
  const completed = status("completed");
  const inPeriod = completed.filter((r) => r.service_date >= PERIOD.start && r.service_date <= PERIOD.end);
  const unmatched = inPeriod.filter((r) => !roster.has(r.participant_id.trim()));
  const eligible = inPeriod.filter((r) => roster.has(r.participant_id.trim()));
  const people = (list) => new Set(list.map((r) => r.participant_id.trim()));
  const cc = eligible.filter((r) => r.program_code === "CC");
  const ra = eligible.filter((r) => r.program_code === "RA");
  const ccPeople = people(cc);
  const raPeople = people(ra);
  return {
    raw: events.length,
    deduplicated: byId.size,
    exact_duplicate_excess: exactCopies.reduce((total, copies) => total + copies.length - 1, 0),
    all_duplicates_exact: allExact,
    cancelled: status("cancelled").length,
    no_show: status("no_show").length,
    completed_all_dates: completed.length,
    completed_outside_period: completed.length - inPeriod.length,
    completed_in_period: inPeriod.length,
    unmatched_in_period: unmatched.length,
    eligible: eligible.length,
    people: people(eligible).size,
    cc_contacts: cc.length,
    ra_contacts: ra.length,
    cc_people: ccPeople.size,
    ra_people: raPeople.size,
    both: [...ccPeople].filter((id) => raPeople.has(id)).length,
    rows: {
      excess: exactCopies.flatMap((copies) => copies.slice(1).map((r) => r.__row)),
      outside: completed.filter((r) => !inPeriod.includes(r)).map((r) => r.__row),
      unmatched: unmatched.map((r) => r.__row),
    },
    eligibleByPerson: eligible.reduce((map, r) => map.set(r.participant_id.trim(), [...(map.get(r.participant_id.trim()) || []), r.program_code]), new Map()),
  };
}

test("Project B acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !PACKAGE || !existsSync(join(PACKAGE, "01_UPLOAD_TO_KAI"))) {
  test("Project B cross-source acceptance requires its runner and KAI_COMMUNITY_PROJECT_B_PACKAGE", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runProjectBAcceptance();
}

async function runProjectBAcceptance() {
  const J = JSON.stringify;
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const {
    BASE_PATH, claimProposalPath, claimReviewCompletePath, claimReviewDecisionBody, claimTraceabilityPath,
    coverageInternalAcceptancePath, evidenceReviewCompletePath, evidenceReviewDecisionBody, sourceCandidateDecisionPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const {
    crossSourceMeasurementsPath, crossSourceReconciliationJobPath, derivedMeasurementBasisPath, derivedMeasurementInterpretationPath,
  } = await import("../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js");
  const router = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const config = await import("../Backend/kai/config/kaiSprint2Config.js");
  const auth = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const runtimeService = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const upload = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const executor = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const assessor = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const dispatch = await import("../Backend/kai/parsing/p1FileDispatch.js");
  const reconciliationRuntime = await import("../Backend/kai/parsing/crossSourceReconciliationJobRuntime.js");

  const ambientTarget = (await ambientPool.query("SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr")).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // --- the two original upload files ----------------------------------------
  const UPLOAD_DIR = join(PACKAGE, "01_UPLOAD_TO_KAI");
  const fileOf = (key, name, bytes = readFileSync(join(UPLOAD_DIR, name))) => ({ key, name, extension: ".csv", mime: "text/csv", bytes, checksum: sha256(bytes) });
  const roster = fileOf("roster", "02_Community_Participant_Roster.csv");
  const events = fileOf("events", "03_Community_Service_Log.csv");
  const oracle = independentProjectB(events.bytes.toString("utf8"), roster.bytes.toString("utf8"));

  // Pseudonymous participant-level files: personal information present;
  // AI processing for internal use only (the administrator's truthful decision).
  const PARTICIPANT_LEVEL = Object.freeze({
    reviewed_personal_data_status: "present", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });

  // --- two organizations (tenant isolation) and their people ----------------
  const ORG = "0b000000-0000-4000-8000-0000000000b1";
  const PROJECT = "7b000000-0000-4000-8000-0000000000b1";
  const OTHER_ORG = "0b000000-0000-4000-8000-0000000000b2";
  const OTHER_PROJECT = "7b000000-0000-4000-8000-0000000000b2";
  const USERS = Object.freeze({ gkReviewer: 961, clientAdmin: 963, otherAdmin: 965, outsider: 967 });
  const makeOrganization = async (organizationId, projectId, name, code, adminId) => {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [projectId, organizationId, `${name} FY2024-25`]);
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, adminId]);
  };
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  await makeOrganization(ORG, PROJECT, "Community Connection Project B (synthetic)", "community-project-b-synthetic", USERS.clientAdmin);
  await makeOrganization(OTHER_ORG, OTHER_PROJECT, "Other Tenant (synthetic)", "other-tenant-synthetic", USERS.otherAdmin);
  const gkUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@projectb.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [ORG, gkUser.user_id]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkUser.user_id]);

  // --- external boundaries ---------------------------------------------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1790000000000001n;
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
  const reconciliationDispatcher = reconciliationRuntime.getCrossSourceReconciliationDispatcher();

  const harnessSession = (req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@projectb.test` };
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
  const otherAdminApi = client(USERS.otherAdmin);
  const gkApi = client(USERS.gkReviewer);
  const outsiderApi = client(USERS.outsider);
  const orgPath = (organizationId) => `${BASE_PATH}/admin/organizations/${organizationId}`;
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const blockersOf = (response) => (response.body?.blockers || response.body?.error?.blockers || []).map((b) => b.blocking_reason || b.code || b.reason);

  const report = { generated_at: new Date().toISOString(), owner_expected: OWNER_EXPECTED, independent: { ...oracle, eligibleByPerson: undefined }, kai: {}, refusals: {}, claims: {}, counterfactual: {} };
  const state = {};

  const writeCounts = async (organizationId = ORG) => (await query(`SELECT
      (SELECT count(*) FROM kai.source_derived_measurements WHERE organization_id = $1::uuid)::int AS measurements,
      (SELECT count(*) FROM kai.source_derived_measurement_sources WHERE organization_id = $1::uuid)::int AS contributing_sources,
      (SELECT count(*) FROM kai.source_derived_measurement_interpretations WHERE organization_id = $1::uuid)::int AS interpretations,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
      (SELECT count(*) FROM kai.cross_source_reconciliation_jobs WHERE organization_id = $1::uuid)::int AS jobs,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid)::int AS queue_items,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audits`, [organizationId]))[0];
  const derivedRow = async (measurementId) => (await query(
    `SELECT source_derived_measurement_id::text, source_version_id::text, measurement_family, calculation_method, basis_version, measurement_key, definition,
            field_keys, measured_value::int, numerator::int, denominator::int, component_counts, exclusions, profile_canonical_sha256
       FROM kai.source_derived_measurements WHERE organization_id = $1::uuid AND source_derived_measurement_id = $2::uuid`, [ORG, measurementId]))[0];
  const contributingOf = async (measurementId) => query(
    `SELECT source_role, source_version_id::text, profile_canonical_sha256, field_keys FROM kai.source_derived_measurement_sources
      WHERE source_derived_measurement_id = $1::uuid ORDER BY source_role`, [measurementId]);
  const evidenceOf = async (measurementId) => query(
    `SELECT l.evidence_item_id::text, l.interpretation_id::text, e.statement, e.evidence_type, e.data_class, e.source_version_id::text, sl.locator_type, sl.coordinates
       FROM kai.evidence_derived_measurements l JOIN kai.evidence_items e ON e.evidence_item_id = l.evidence_item_id
       JOIN kai.source_locators sl ON sl.source_locator_id = e.source_locator_id
      WHERE l.organization_id = $1::uuid AND l.source_derived_measurement_id = $2::uuid ORDER BY l.created_at`, [ORG, measurementId]);
  const versionSha = async (sourceVersionId) => (await query("SELECT profile_canonical_sha256 FROM kai.source_versions WHERE source_version_id = $1::uuid", [sourceVersionId]))[0].profile_canonical_sha256;
  const trace = async (claimId, audience = "internal") => {
    const traced = await gkApi("GET", claimTraceabilityPath(ORG, claimId, audience));
    return { status: traced.status, eligible: traced.body?.data?.eligible ?? null, reason: traced.body?.data?.traceability_conflict_reason ?? null,
      blockerCodes: traced.body?.data?.blockerCodes ?? blockersOf(traced),
      unresolved: Object.entries(traced.body?.data?.dimensions || {}).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k).sort() };
  };
  const queueOf = async (queueType, targetId) => (await query(
    "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
    [ORG, queueType, targetId]))[0];
  const settle = async (queued, api = adminApi) => {
    await reconciliationDispatcher.whenIdle();
    const read = await api("GET", crossSourceReconciliationJobPath(ORG, queued.body.data.reconciliationJob.reconciliation_job_id));
    return { status: read.status, job: read.body?.data?.reconciliationJob ?? null, measurements: read.body?.data?.measurements ?? [] };
  };
  const labelOf = (m) => {
    const d = m.definition;
    if (d.metric === "eligible_linked_encounters") return "encounters";
    if (d.metric === "distinct_people_served") return "people";
    if (d.metric === "people_in_more_than_one_group") return "both";
    return `${d.group.value_label}_${d.metric === "group_linked_encounters" ? "encounters" : "people"}`;
  };
  const LABELS = ["encounters", "people", "CC_encounters", "CC_people", "RA_encounters", "RA_people", "both"];

  // Upload one file through the intake API, run P1, decide and promote it.
  const uploadAndPromote = async ({ organizationId, projectId, api, file, supersedes = null }) => {
    const batch = await api("POST", createBatchPath(), { organization_id: organizationId, engagement_id: projectId, batch_code: `project-b-${file.key}`, idempotency_key: `batch-${randomUUID()}` });
    assert.ok([200, 201].includes(batch.status), J(batch.body));
    const batchId = batch.body.data.intake_batch_id;
    const reserved = await api("POST", fileReservationsPath(batchId), {
      organization_id: organizationId, engagement_id: projectId, original_filename: file.name, file_extension: file.extension, mime_type: file.mime,
      file_size_bytes: file.bytes.byteLength, checksum: file.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
    });
    assert.ok(reserved.status < 300, J(reserved.body));
    const intakeFileId = reserved.body.data.intake_file_id;
    const signed = await api("POST", requestUploadUrlPath(batchId), { organization_id: organizationId, engagement_id: projectId, intake_file_id: intakeFileId });
    const put = await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: file.bytes });
    const confirmed = await api("POST", confirmUploadPath(organizationId, intakeFileId), { organization_id: organizationId });
    assert.deepEqual([put.status, confirmed.status], [200, 200], J(confirmed.body));
    await dispatcher.whenIdle();
    const [policy] = await query("SELECT file_policy_status FROM kai.intake_files WHERE intake_file_id = $1::uuid", [intakeFileId]);
    const [profileRow] = await query("SELECT profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [intakeFileId]);
    assert.equal(policy.file_policy_status, "passed");
    assert.equal(profileRow?.profile?.status, "profiled", file.name);
    assert.doesNotMatch(J(profileRow.profile), RAW_IDENTIFIER, `${file.name}: no identifier in the profile`);
    const [sensitivity] = await query(
      `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
         JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
        WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
    const decided = await api("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${organizationId}`, {
      expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id,
      decision: "reviewed", reviewed_snapshot: PARTICIPANT_LEVEL,
    });
    assert.equal(decided.status, 200, J(decided.body));
    const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    const promoted = await api("POST", sourceCandidateDecisionPath(organizationId, candidate.intake_source_candidate_id), {
      outcome: "promoted", reviewed_source_type: "organization_primary_record", ...(supersedes ? { supersedes_source_version_id: supersedes } : {}) });
    assert.equal(promoted.status, 200, J(promoted.body));
    const [version] = await query("SELECT source_version_id::text, source_id::text, is_current FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
    assert.equal(version.is_current, true);
    return { intakeFileId, profile: profileRow.profile, sourceVersionId: version.source_version_id, sourceId: version.source_id };
  };

  try {
    await test("0: the two upload files match the package's checksum manifest; the answer key is not a source", () => {
      const manifest = JSON.parse(readFileSync(join(PACKAGE, "03_ANSWER_KEY_DO_NOT_UPLOAD", "Community_File_Checksums.json"), "utf8"));
      for (const file of [roster, events]) {
        const entry = manifest.find((candidate) => candidate.relative_path === `01_UPLOAD_TO_KAI/${file.name}`);
        assert.ok(entry, file.name);
        assert.deepEqual([file.checksum, file.bytes.byteLength], [entry.sha256, entry.bytes], file.name);
      }
    });

    await test("1: the independent stage-by-stage calculation from the original bytes agrees with the owner's expectations", () => {
      const { rows, exact_duplicate_excess: excess, all_duplicates_exact: allExact, eligibleByPerson, ...stages } = oracle;
      assert.deepEqual(stages, OWNER_EXPECTED);
      // Duplicates in Project B: every repeated event_id repeats the whole record exactly.
      assert.deepEqual([excess, allExact], [2, true]);
      assert.equal(stages.raw - stages.deduplicated, excess);
      assert.equal(stages.deduplicated - stages.cancelled - stages.no_show, stages.completed_all_dates);
      assert.equal(stages.cc_contacts + stages.ra_contacts, stages.eligible);
      assert.equal(stages.cc_people + stages.ra_people - stages.both, stages.people);
      assert.equal(eligibleByPerson.size, stages.people);
    });

    await test("2: both files are uploaded, profiled, decided and promoted in the organization; the roster also in another tenant", async () => {
      const set = await adminApi("PUT", `${orgPath(ORG)}/engagements/${PROJECT}/requirement-target`,
        { target: { reporting_period_start: PERIOD.start, reporting_period_end: PERIOD.end, report_identity: "Community Connection Project B" } });
      assert.ok([200, 201].includes(set.status), J(set.body));
      state.roster = await uploadAndPromote({ organizationId: ORG, projectId: PROJECT, api: adminApi, file: roster });
      state.events = await uploadAndPromote({ organizationId: ORG, projectId: PROJECT, api: adminApi, file: events });
      state.otherRoster = await uploadAndPromote({ organizationId: OTHER_ORG, projectId: OTHER_PROJECT, api: otherAdminApi, file: roster });
      assert.equal(state.events.profile.counts.row_count, OWNER_EXPECTED.raw);
    });

    await test("3: Count records on the service log asserts only 217 source records; it is not eligible contacts or people", async () => {
      const recorded = await adminApi("POST", sourceRecordCountMeasurementPath(ORG, state.events.sourceVersionId), {
        counted_unit: "service log record", unit_label: "service log records",
        definition_text: "Each data row of the service log records one service event as exported.",
        inclusion_rule: "Completed events in the reporting period linked to the roster.", exclusion_rule: "Cancelled and no-show events.",
      });
      assert.equal(recorded.status, 200, J(recorded.body));
      const evidenceItemId = recorded.body.data.evidenceItem.evidence_item_id;
      let claimId = recorded.body.data.claim?.claim_id ?? null;
      if (!claimId) {
        const proposed = await adminApi("POST", claimProposalPath(ORG, evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), J(proposed.body));
        claimId = proposed.body.data.claim.claim_id;
      }
      const [claim] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
      assert.match(claim.statement, /\b217 source records\b/);
      assert.match(claim.statement, /Not applied by KAI:/, "the person's rules are attributed, not applied");
      assert.doesNotMatch(claim.statement, /\b(190|192|67)\b/);
      state.recordCount = { evidenceItemId, claimId, statement: claim.statement };
      report.kai.record_count = state.recordCount;
    });

    let mapping = null;
    let eventsBasis = null;
    await test("4: the administrator maps fields KAI lists; invalid, ambiguous, unauthorized and cross-tenant requests are refused and write nothing", async () => {
      eventsBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
      const rosterBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.roster.sourceVersionId));
      assert.deepEqual([eventsBasis.status, rosterBasis.status], [200, 200]);
      const { start, end, engagementId } = eventsBasis.body.data.reporting_period;
      assert.deepEqual({ start, end, engagementId }, { start: PERIOD.start, end: PERIOD.end, engagementId: PROJECT }, "the engagement's recorded period");
      const fieldAt = (basis, position, role) => {
        const field = basis.body.data.tabular.fields.find((candidate) => candidate.column_position === position);
        assert.equal(field?.role, role, `column ${position} is proposed as ${role}`);
        return field;
      };
      const status = fieldAt(eventsBasis, 6, "categorical");
      const programme = fieldAt(eventsBasis, 3, "categorical");
      assert.deepEqual(programme.values.map((v) => v.label), ["CC", "RA"]);
      assert.deepEqual(status.values.map((v) => v.label).sort(), ["cancelled", "completed", "no_show"]);
      // A person's confirmation of what each field means; no expected value is an input.
      mapping = {
        events: {
          event_identifier_field_key: fieldAt(eventsBasis, 1, "identifier").field_key,
          participant_identifier_field_key: fieldAt(eventsBasis, 2, "identifier").field_key,
          status_field_key: status.field_key,
          completed_value_key: status.values.find((v) => v.label === "completed").value_key,
          date_field_key: fieldAt(eventsBasis, 4, "date").field_key,
          group_field_key: programme.field_key,
        },
        register: { participant_identifier_field_key: fieldAt(rosterBasis, 1, "identifier").field_key },
      };
      report.kai.mapping = mapping;
      const withheld = eventsBasis.body.data.tabular.fields.find((f) => f.vocabulary_withheld);
      const post = (body, api = adminApi) => api("POST", crossSourceMeasurementsPath(ORG), body);
      const body = (patch = {}) => ({ primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.roster.sourceVersionId, mapping, ...patch });
      const withEvents = (patch) => body({ mapping: { ...mapping, events: { ...mapping.events, ...patch } } });
      const before = await writeCounts();
      const otherBefore = await writeCounts(OTHER_ORG);
      const refusals = {
        outsider: await post(body(), outsiderApi),
        other_tenant_admin: await post(body(), otherAdminApi),
        other_tenant_roster: await post(body({ reference_source_version_id: state.otherRoster.sourceVersionId })),
        unknown_roster: await post(body({ reference_source_version_id: randomUUID() })),
        same_version: await post(body({ reference_source_version_id: state.events.sourceVersionId })),
        event_and_participant_same_field: await post(withEvents({ participant_identifier_field_key: mapping.events.event_identifier_field_key })),
        status_as_event_identifier: await post(withEvents({ event_identifier_field_key: status.field_key, status_field_key: programme.field_key, group_field_key: null })),
        programme_as_date: await post(withEvents({ date_field_key: programme.field_key, group_field_key: null })),
        roster_date_as_identifier: await post(body({ mapping: { ...mapping, register: { participant_identifier_field_key: fieldAt(rosterBasis, 2, "date").field_key } } })),
        unlisted_completed_value: await post(withEvents({ completed_value_key: "value_99" })),
        completed_value_missing: await post(body({ mapping: { ...mapping, events: Object.fromEntries(Object.entries(mapping.events).filter(([k]) => k !== "completed_value_key")) } })),
        typed_expected_answer: await post(body({ mapping: { ...mapping, expected_people: OWNER_EXPECTED.people } })),
        free_text_rule: await post(body({ mapping: { ...mapping, events: { ...mapping.events, completed_rule: "status is completed or attended" } } })),
        withheld_group: await post(withEvents({ group_field_key: withheld.field_key })),
      };
      report.refusals.mapping = Object.fromEntries(Object.entries(refusals).map(([k, v]) => [k, [v.status, blockersOf(v)]]));
      const r = report.refusals.mapping;
      for (const key of ["outsider", "other_tenant_admin"]) assert.ok(r[key][0] === 401 || r[key][0] === 403 || r[key][0] === 404, `${key}: ${J(r[key])}`);
      for (const key of ["other_tenant_roster", "unknown_roster"]) assert.ok(r[key][0] >= 400 && r[key][0] < 500, `${key}: ${J(r[key])}`);
      assert.deepEqual(r.other_tenant_roster[0], r.unknown_roster[0], "another tenant's version is indistinguishable from an unknown one");
      assert.deepEqual(r.same_version, [422, ["cross_source_same_version"]]);
      assert.deepEqual(r.event_and_participant_same_field, [422, ["cross_source_mapping_fields_not_distinct"]]);
      assert.deepEqual(r.status_as_event_identifier, [422, ["cross_source_field_role_not_proposed"]]);
      assert.deepEqual(r.programme_as_date, [422, ["cross_source_field_role_not_proposed"]]);
      assert.deepEqual(r.roster_date_as_identifier, [422, ["cross_source_field_role_not_proposed"]]);
      assert.deepEqual(r.unlisted_completed_value, [422, ["cross_source_value_not_listed"]]);
      for (const key of ["completed_value_missing", "typed_expected_answer", "free_text_rule"]) assert.deepEqual(r[key], [422, ["cross_source_mapping_invalid"]], key);
      assert.deepEqual(r.withheld_group, [422, ["cross_source_group_vocabulary_withheld"]]);
      assert.doesNotMatch(J(refusals), RAW_IDENTIFIER);
      assert.deepEqual(await writeCounts(), before, "no refused request writes anything in the organization");
      assert.deepEqual(await writeCounts(OTHER_ORG), otherBefore, "or in the other tenant");
    });

    const CROSS = {};
    await test("5: KAI reconciles both versions' bytes and persists 190 roster-linked contacts and 67 distinct people, stage by stage", async () => {
      const body = { primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.roster.sourceVersionId, mapping };
      const queued = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.equal(queued.status, 202, J(queued.body));
      const recorded = await settle(queued);
      assert.deepEqual([recorded.status, recorded.job.job_state, recorded.job.error_code], [200, "succeeded", null], J(recorded));
      assert.equal(recorded.measurements.length, 7);
      assert.doesNotMatch(J(recorded), RAW_IDENTIFIER, "no identifier in the job read");
      // The tenant's measurement read is not reachable from another tenant or an outsider.
      for (const api of [otherAdminApi, outsiderApi]) {
        const read = await api("GET", crossSourceReconciliationJobPath(ORG, queued.body.data.reconciliationJob.reconciliation_job_id));
        assert.ok([401, 403, 404].includes(read.status), J(read));
      }
      for (const entry of recorded.measurements) {
        const label = labelOf(entry);
        const row = await derivedRow(entry.source_derived_measurement_id);
        const sources = await contributingOf(entry.source_derived_measurement_id);
        const [evidence] = await evidenceOf(entry.source_derived_measurement_id);
        CROSS[label] = { measurementId: row.source_derived_measurement_id, row, sources, evidence };
        // Method, both contributing versions, each bound to its promoted profile.
        assert.deepEqual([row.measurement_family, row.calculation_method, row.basis_version], ["cross_source_reach", "kai_cross_source_linked_reach_v1", "kai_cross_source_reconciliation_v1"]);
        assert.equal(row.source_version_id, state.events.sourceVersionId);
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", state.events.sourceVersionId], ["reference", state.roster.sourceVersionId]]);
        assert.equal(sources[0].profile_canonical_sha256, await versionSha(state.events.sourceVersionId));
        assert.equal(sources[1].profile_canonical_sha256, await versionSha(state.roster.sourceVersionId));
        assert.deepEqual(sources[1].field_keys, [mapping.register.participant_identifier_field_key]);
        assert.equal(row.definition.reference_source_version_id, state.roster.sourceVersionId);
        assert.deepEqual(row.definition.mapping.events.completed_value_label, "completed");
        // The period was applied by day to the event date, not merely recorded.
        assert.deepEqual(row.definition.period, { period_source: "engagement_reporting_period", period_start: PERIOD.start, period_end: PERIOD.end, precision: "day" });
        // Inclusion and exclusion decisions, row by row, against the independent reading.
        assert.deepEqual(row.exclusions.excess_duplicate_copies.rows, oracle.rows.excess, label);
        assert.deepEqual(row.exclusions.completed_outside_period.rows, oracle.rows.outside, label);
        assert.deepEqual(row.exclusions.unmatched_participant_identifier.rows, oracle.rows.unmatched, label);
        assert.deepEqual([evidence.evidence_type, evidence.data_class, evidence.locator_type, evidence.source_version_id],
          ["source_derived_measurement", "source_derived_aggregate", "source_derived_measurement_fields", state.events.sourceVersionId]);
        assert.ok(evidence.statement.includes(state.roster.sourceVersionId), `${label}: the evidence names the roster version`);
      }
      const c = CROSS.people.row.component_counts;
      const kaiStages = {
        raw: c.physical_record_count,
        deduplicated: c.distinct_event_count,
        not_completed: c.consistent_event_count - c.completed_event_count,
        completed_all_dates: c.completed_event_count,
        completed_outside_period: c.completed_outside_period_count,
        completed_in_period: c.in_period_completed_event_count,
        unmatched_in_period: c.unmatched_event_count,
        eligible: CROSS.encounters.row.measured_value,
        people: CROSS.people.row.measured_value,
        cc_contacts: CROSS.CC_encounters.row.measured_value,
        ra_contacts: CROSS.RA_encounters.row.measured_value,
        cc_people: CROSS.CC_people.row.measured_value,
        ra_people: CROSS.RA_people.row.measured_value,
        both: CROSS.both.row.measured_value,
      };
      report.kai.stages = kaiStages;
      report.kai.funnel = c;
      const independentStages = { ...Object.fromEntries(Object.keys(kaiStages).filter((k) => k in oracle).map((k) => [k, oracle[k]])), not_completed: oracle.cancelled + oracle.no_show };
      assert.deepEqual(kaiStages, independentStages, "KAI's persisted stages equal the independent calculation");
      assert.deepEqual(kaiStages, { ...Object.fromEntries(Object.keys(kaiStages).filter((k) => k in OWNER_EXPECTED).map((k) => [k, OWNER_EXPECTED[k]])), not_completed: 18 },
        "and the owner's expectations: 217 -> 215 -> 197 -> 192 -> 190 -> 67");
      // Event identity: two duplicate groups of two exact copies; no conflicting identity; no blank identifiers.
      assert.deepEqual([c.duplicate_group_count, c.duplicate_member_record_count, c.excess_copy_record_count, c.conflicting_event_identity_count, c.blank_event_identifier_record_count],
        [2, 4, 2, 0, 0]);
      // 190 is the roster-linked count: 192 in-period completed events minus the 2 with no roster match.
      assert.equal(c.in_period_completed_event_count - c.unmatched_event_count - c.blank_participant_identifier_event_count, c.eligible_encounter_count);
      assert.notEqual(c.eligible_encounter_count, c.in_period_completed_event_count, "the roster join changes the event count");
      assert.deepEqual([c.unmatched_identity_count, c.register_record_count, c.register_distinct_identifier_count], [2, 72, 72]);
      // Every measurement of this reconciliation carries the same funnel.
      for (const label of LABELS) assert.deepEqual(CROSS[label].row.component_counts.physical_record_count, c.physical_record_count);
      // People are counted once overall, not summed across programmes.
      assert.equal(kaiStages.cc_people + kaiStages.ra_people - kaiStages.both, kaiStages.people);
      assert.notEqual(kaiStages.cc_people + kaiStages.ra_people, kaiStages.people);

      // Replay writes nothing; audit is metadata-only.
      const before = await writeCounts();
      const replay = await adminApi("POST", crossSourceMeasurementsPath(ORG), body);
      assert.deepEqual([replay.status, replay.body.data.fresh, replay.body.data.reconciliationJob.reconciliation_job_id],
        [202, false, queued.body.data.reconciliationJob.reconciliation_job_id]);
      await reconciliationDispatcher.whenIdle();
      assert.deepEqual(await writeCounts(), before);
      const audits = await query("SELECT * FROM kai.audit_events WHERE organization_id = $1::uuid", [ORG]);
      assert.ok(audits.some((row) => J(row).includes("record_source_derived_measurement")), "the cross-source write is audited");
      assert.doesNotMatch(J(audits), RAW_IDENTIFIER);
      state.firstJobId = queued.body.data.reconciliationJob.reconciliation_job_id;
    });

    await test("6: the authorized measurement read returns the recorded findings with both contributing versions; other tenants cannot read it", async () => {
      const read = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
      assert.equal(read.status, 200);
      const recorded = read.body.data.recorded.filter((m) => m.measurement_family === "cross_source_reach");
      assert.deepEqual(recorded.map((m) => m.source_derived_measurement_id).sort(), LABELS.map((l) => CROSS[l].measurementId).sort());
      for (const m of recorded) {
        assert.deepEqual((m.contributing_sources || []).map((s) => [s.source_role, s.source_version_id]),
          [["primary", state.events.sourceVersionId], ["reference", state.roster.sourceVersionId]]);
      }
      assert.doesNotMatch(J(read.body), RAW_IDENTIFIER);
      for (const api of [otherAdminApi, outsiderApi]) {
        const denied = await api("GET", derivedMeasurementBasisPath(ORG, state.events.sourceVersionId));
        assert.ok([401, 403, 404].includes(denied.status), J(denied));
      }
    });

    await test("7: stated meanings, claims and P2-06 traceability; each claim asserts no more than its calculation; review still governs", async () => {
      const MEANINGS = {
        encounters: ["Eligible completed contacts", "completed, deduplicated service events in the reporting period linked to a roster participant; contacts, not people."],
        people: ["People served", "distinct roster participants with at least one eligible completed contact."],
        CC_encounters: ["Community Connections contacts", "eligible completed contacts recorded under programme CC."],
        CC_people: ["Community Connections people served", "distinct roster participants with an eligible CC contact."],
        RA_encounters: ["Resource Access contacts", "eligible completed contacts recorded under programme RA."],
        RA_people: ["Resource Access people served", "distinct roster participants with an eligible RA contact."],
        both: ["People served in both programmes", "roster participants with eligible contacts in both CC and RA."],
      };
      for (const label of LABELS) {
        const [indicatorLabel, meaning] = MEANINGS[label];
        const stated = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CROSS[label].measurementId),
          { indicator_label: indicatorLabel, meaning_text: `Human-stated for this synthetic acceptance: ${meaning}`, evidence_basis: "organization_record" });
        assert.equal(stated.status, 200, `${label}: ${J(stated.body)}`);
        assert.equal(stated.body.data.measurement.measured_value, CROSS[label].row.measured_value, "a meaning never changes the count");
        const evidenceItemId = stated.body.data.evidenceItem.evidence_item_id;
        const proposed = await adminApi("POST", claimProposalPath(ORG, evidenceItemId), {});
        assert.ok([200, 201].includes(proposed.status), `${label}: ${J(proposed.body)}`);
        const claimId = proposed.body.data.claim.claim_id;
        const initial = await trace(claimId);
        assert.equal(initial.eligible, false, `${label}: personal information present needs Get Kinder review first`);
        assert.ok(!initial.blockerCodes.includes("measured_claim_integrity_not_established"), `${label}: ${J(initial)}`);
        const evidenceQueue = await queueOf("evidence_review", evidenceItemId);
        const evidenceReview = await gkApi("POST", evidenceReviewCompletePath(ORG, evidenceItemId, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
        const claimQueue = await queueOf("claim_review", claimId);
        const claimReview = await gkApi("POST", claimReviewCompletePath(ORG, claimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
        assert.deepEqual([evidenceReview.status, claimReview.status], [200, 200]);
        for (const dimensionKey of (await trace(claimId)).unresolved) await gkApi("POST", coverageInternalAcceptancePath(ORG, claimId, dimensionKey), {});
        const after = await trace(claimId);
        assert.equal(after.eligible, true, `${label}: ${J(after)}`);
        assert.deepEqual([(await trace(claimId, "funder")).eligible, (await trace(claimId, "public")).eligible], [false, false], "allowed use: internal only");
        const [row] = await query("SELECT statement, claim_type, evidence_item_id::text FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        assert.equal(row.claim_type, "finding");
        assert.ok(row.statement.includes(String(CROSS[label].row.measured_value)) && row.statement.includes(state.roster.sourceVersionId), row.statement);
        assert.doesNotMatch(row.statement, RAW_IDENTIFIER);
        if (label.endsWith("encounters")) assert.match(row.statement, /\(encounters, not people\)/);
        if (label.endsWith("people") || label === "both") assert.match(row.statement, /each counted once/);
        assert.match(row.statement, new RegExp(`reporting period ${PERIOD.start} to ${PERIOD.end} by day`));
        assert.doesNotMatch(row.statement, /\b(caus|improv|outcome)/i);
        // A separate identity from the 217-record count.
        assert.notEqual(evidenceItemId, state.recordCount.evidenceItemId);
        assert.notEqual(claimId, state.recordCount.claimId);
        CROSS[label].evidenceItemId = evidenceItemId;
        CROSS[label].claimId = claimId;
        report.claims[label] = { claim_id: claimId, evidence_item_id: evidenceItemId, statement: row.statement, traceability_initial: initial, traceability_after_review: after };
      }
      const headline = report.claims.encounters.statement;
      assert.match(headline, /^Eligible completed contacts \(meaning stated by the organization; values are organization records\): 190 eligible service encounters \(encounters, not people\)/);
      assert.match(headline, /2 duplicate copies counted once; excluded 5 outside period, 2 unmatched, 0 conflicting/);
      assert.match(report.claims.people.statement, /67 distinct register participants served, each counted once, among 190 eligible encounters/);
      assert.match(report.claims.people.statement, /11 in several field_3 counted once/);
    });

    await test("8: a 217-record claim cannot become a 190-contact claim by wording; a reworded cross-source claim is refused (Package 1 rule)", async () => {
      const tamper = async (claimId, statement) => {
        const [{ statement: original }] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [claimId]);
        await query("UPDATE kai.claims SET statement = $2 WHERE claim_id = $1::uuid", [claimId, statement]);
        try {
          return await trace(claimId);
        } finally {
          await query("UPDATE kai.claims SET statement = $2 WHERE claim_id = $1::uuid", [claimId, original]);
        }
      };
      const outcomes = {
        record_count_as_190_contacts: await tamper(state.recordCount.claimId, report.claims.encounters.statement),
        record_count_as_67_people: await tamper(state.recordCount.claimId, "The project served 67 distinct people in FY2024-25."),
        people_claim_reworded: await tamper(CROSS.people.claimId, "67 people were helped by the programmes in FY2024-25."),
        contacts_claim_as_people: await tamper(CROSS.encounters.claimId, report.claims.encounters.statement.replace("(encounters, not people)", "(people)")),
      };
      report.claims.integrity_tamper = outcomes;
      for (const [key, value] of Object.entries(outcomes)) {
        assert.equal(value.eligible, false, `${key}: ${J(value)}`);
        assert.ok(value.blockerCodes.includes("measured_claim_integrity_not_established"), `${key}: ${J(value)}`);
      }
      assert.equal((await trace(CROSS.people.claimId)).eligible, true, "restored claim is eligible again");
    });

    await test("9: counterfactual through the connected path - a corrected roster without one served participant changes reach, not raw records; the old findings stop being current", async () => {
      // Independently chosen: the first (sorted) eligible participant served in both programmes.
      const [removedId] = [...oracle.eligibleByPerson].filter(([, programmes]) => new Set(programmes).size === 2).map(([id]) => id).sort();
      const removedContacts = oracle.eligibleByPerson.get(removedId).length;
      const lines = roster.bytes.toString("utf8").split(/(?<=\n)/);
      const kept = lines.filter((line, index) => index === 0 || !line.replace(/^﻿/, "").startsWith(`${removedId},`));
      assert.equal(kept.length, lines.length - 1);
      const corrected = fileOf("roster-corrected", "02_Community_Participant_Roster_corrected.csv", Buffer.from(kept.join(""), "utf8"));
      state.correctedRoster = await uploadAndPromote({ organizationId: ORG, projectId: PROJECT, api: adminApi, file: corrected, supersedes: state.roster.sourceVersionId });
      const versions = await query("SELECT source_version_id::text, is_current FROM kai.source_versions WHERE source_id = $1::uuid ORDER BY created_at", [state.roster.sourceId]);
      assert.deepEqual(versions, [{ source_version_id: state.roster.sourceVersionId, is_current: false }, { source_version_id: state.correctedRoster.sourceVersionId, is_current: true }]);

      // The recorded findings keep their history but are no longer current.
      const stale = {};
      for (const label of LABELS) stale[label] = await trace(CROSS[label].claimId);
      for (const [label, value] of Object.entries(stale)) {
        assert.deepEqual([value.status, value.reason], [409, "derived_measurement_contributing_source_not_current"], `${label}: ${J(value)}`);
      }
      assert.equal((await derivedRow(CROSS.encounters.measurementId)).measured_value, OWNER_EXPECTED.eligible, "history is not rewritten");
      const before = await writeCounts();
      const old = await adminApi("POST", crossSourceMeasurementsPath(ORG), { primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.roster.sourceVersionId, mapping });
      await reconciliationDispatcher.whenIdle();
      assert.ok(old.status >= 400 || old.body?.data?.reconciliationJob?.job_state !== "queued", J(old.body));
      const reinterpret = await adminApi("POST", derivedMeasurementInterpretationPath(ORG, CROSS.people.measurementId),
        { indicator_label: "People served", meaning_text: "Human-stated for this synthetic acceptance: a restatement.", evidence_basis: "organization_record" });
      assert.ok(reinterpret.status >= 400, J(reinterpret.body));
      const repropose = await adminApi("POST", claimProposalPath(ORG, CROSS.people.evidenceItemId), {});
      report.counterfactual.stale_requests = { reconcile_old_roster: [old.status, blockersOf(old), old.body?.data?.reconciliationJob?.job_state ?? null],
        reinterpret: [reinterpret.status, blockersOf(reinterpret)], repropose: [repropose.status, blockersOf(repropose)] };
      if (old.status >= 400) assert.deepEqual(await writeCounts(), before, "a refused stale request writes nothing");

      // The same mapping against the current roster: a separate, new measurement identity.
      const rosterBasis = await adminApi("GET", derivedMeasurementBasisPath(ORG, state.correctedRoster.sourceVersionId));
      assert.equal(rosterBasis.body.data.tabular.fields.find((f) => f.column_position === 1)?.field_key, mapping.register.participant_identifier_field_key);
      const queued = await adminApi("POST", crossSourceMeasurementsPath(ORG), { primary_source_version_id: state.events.sourceVersionId, reference_source_version_id: state.correctedRoster.sourceVersionId, mapping });
      assert.equal(queued.status, 202, J(queued.body));
      const recorded = await settle(queued);
      assert.equal(recorded.job.job_state, "succeeded", J(recorded));
      const byLabel = Object.fromEntries(recorded.measurements.map((m) => [labelOf(m), m]));
      const c = byLabel.people.component_counts;
      const expected = {
        raw: OWNER_EXPECTED.raw, deduplicated: OWNER_EXPECTED.deduplicated, completed_in_period: OWNER_EXPECTED.completed_in_period,
        unmatched: OWNER_EXPECTED.unmatched_in_period + removedContacts, unmatched_identities: 3,
        eligible: OWNER_EXPECTED.eligible - removedContacts, people: OWNER_EXPECTED.people - 1, both: OWNER_EXPECTED.both - 1,
        cc_people: OWNER_EXPECTED.cc_people - 1, ra_people: OWNER_EXPECTED.ra_people - 1, register: 71,
      };
      const actual = {
        raw: c.physical_record_count, deduplicated: c.distinct_event_count, completed_in_period: c.in_period_completed_event_count,
        unmatched: c.unmatched_event_count, unmatched_identities: c.unmatched_identity_count,
        eligible: byLabel.encounters.measured_value, people: byLabel.people.measured_value, both: byLabel.both.measured_value,
        cc_people: byLabel.CC_people.measured_value, ra_people: byLabel.RA_people.measured_value, register: c.register_distinct_identifier_count,
      };
      report.counterfactual.corrected_roster = { removed_contacts: removedContacts, expected, actual };
      assert.deepEqual(actual, expected);
      for (const label of LABELS) {
        assert.notEqual(byLabel[label].source_derived_measurement_id, CROSS[label].measurementId, `${label}: a new measurement identity`);
        const sources = await contributingOf(byLabel[label].source_derived_measurement_id);
        assert.deepEqual(sources.map((s) => [s.source_role, s.source_version_id]), [["primary", state.events.sourceVersionId], ["reference", state.correctedRoster.sourceVersionId]]);
      }
      assert.doesNotMatch(J(recorded), RAW_IDENTIFIER);
    });
  } finally {
    if (REPORT_PATH) writeFileSync(REPORT_PATH, `${J(report, null, 2)}\n`);
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
