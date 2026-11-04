import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Document-statement evidence, connected: synthetic Cedar Bridge documents
 * through KAI's real local processing on the runner's disposable loopback
 * PostgreSQL (the Plan A normal migration chain). Run only by
 *   KAI_CEDAR_BRIDGE_PACKAGE=<package root> node scripts/kai-document-statement-evidence-local-postgres.js
 * Skipped otherwise.
 *
 * Phase A runs with the document-statement migration rolled back (the
 * runner leaves it so): the November 4 pipeline read model and the Data
 * Sources read run their real SQL and say the capability is not installed;
 * extraction reads and writes nothing. Phase B applies the migration in
 * this database and runs the real extraction route on the promoted TXT and
 * PDFs: persistence under the real CHECKs, replay, the real Impact Evidence
 * Library read, Get Kinder's evidence review, claim proposal, a superseded
 * version, and the rollback's refusal once evidence exists.
 *
 * Real: the intake API, bounded security assessment, P1 worker and
 * profiler, Review Cockpit decision and promotion routes, the P1 exact-version
 * byte read, the mupdf text worker, every SQL statement and constraint.
 * Simulated at external boundaries only, as in the six-source runner: the
 * session (harness cookie), object storage (in-process signed PUT) and the
 * malware scanner (clean adapter behind the real assessor).
 */

const RUNNER_DATABASE_URL = process.env.KAI_DOCUMENT_EVIDENCE_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_DOCUMENT_EVIDENCE_DATABASE_NAME;
const PACKAGE = process.env.KAI_CEDAR_BRIDGE_PACKAGE;
const SURVEY_PDF = process.env.KAI_CEDAR_BRIDGE_SURVEY_PDF;
const ORIGINAL_PDF = process.env.KAI_CEDAR_BRIDGE_ORIGINAL_PDF;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`document evidence acceptance refused a non-loopback database URL host: ${host}`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("document evidence acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

const ready = RUNNER_DATABASE_URL && PACKAGE && existsSync(join(PACKAGE, "01_UPLOAD_TO_KAI")) && SURVEY_PDF && existsSync(SURVEY_PDF) && ORIGINAL_PDF && existsSync(ORIGINAL_PDF);
if (!ready) {
  test("document evidence acceptance requires its runner and the synthetic fixtures", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runDocumentEvidenceAcceptance();
}

async function runDocumentEvidenceAcceptance() {
  const J = JSON.stringify;
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const {
    BASE_PATH, claimProposalPath, evidenceExtractionPath, evidenceLibraryCandidatesPath, evidenceReviewCompletePath, evidenceReviewDecisionBody,
    organizationSourcesPath, sourceCandidateDecisionPath, evidenceExtractionResultMessage, projectOrganizationSources, canOfferEvidenceExtraction,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { clientEvidencePipelinePath, projectClientEvidencePipeline } = await import("../frontend/knowledgeStudio/clientEvidencePipelineLogic.js");
  const { confirmUploadPath, createBatchPath, fileReservationsPath, requestUploadUrlPath } = await import("../frontend/kaiWebIntakeLogic.js");
  const { validateDocumentClaimBasis, documentExcerptSha256 } = await import("../Backend/kai/validators/kaiDocumentEvidenceValidators.js");
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

  const UPLOAD_DIR = join(PACKAGE, "01_UPLOAD_TO_KAI");
  const SOURCES = [
    { key: "notes", path: join(UPLOAD_DIR, "05_Operations_Notes.txt"), name: "05_Operations_Notes.txt", extension: ".txt", mime: "text/plain" },
    { key: "review", path: join(UPLOAD_DIR, "06_Programme_Review.pdf"), name: "06_Programme_Review.pdf", extension: ".pdf", mime: "application/pdf" },
    { key: "survey", path: SURVEY_PDF, name: "Cedar_Bridge_Survey_Results_Verified.pdf", extension: ".pdf", mime: "application/pdf" },
    { key: "original", path: ORIGINAL_PDF, name: "Cedar_Bridge_Survey_Results_FY2025-26.pdf", extension: ".pdf", mime: "application/pdf" },
    { key: "register", path: join(UPLOAD_DIR, "02_Participant_Register.csv"), name: "02_Participant_Register.csv", extension: ".csv", mime: "text/csv" },
  ].map((source) => {
    const bytes = readFileSync(source.path);
    return { ...source, bytes, checksum: sha256(bytes) };
  });
  const DOCUMENTS = ["notes", "review", "survey"];

  const ABSENT = Object.freeze({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });
  const DECISIONS = {
    notes: Object.freeze({ ...ABSENT, reviewed_staff_notes_status: "present" }),
    review: ABSENT, survey: ABSENT, original: ABSENT,
    register: Object.freeze({ ...ABSENT, reviewed_personal_data_status: "present" }),
  };

  const ORG = "0d000000-0000-4000-8000-0000000000d1";
  const PROJECT = "7d000000-0000-4000-8000-0000000000d1";
  const USERS = Object.freeze({ gkReviewer: 991, clientAdmin: 993, outsider: 997 });
  const ORG_NAME = "Cedar Bridge Community Pathways Society (document evidence)";
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'cedar-bridge-documents')", [ORG, ORG_NAME]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Document evidence', '{}'::jsonb)", [PROJECT, ORG]);
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.clientAdmin]);
  const gkUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@cedar.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [ORG, gkUser.user_id]);
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkUser.user_id]);

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
  const outsiderApi = client(USERS.outsider);
  const COCKPIT = `${BASE_PATH}/admin/review-cockpit`;
  const state = Object.fromEntries(SOURCES.map((source) => [source.key, {}]));
  const byKey = Object.fromEntries(SOURCES.map((source) => [source.key, source]));
  const counts = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_type = 'source_document_statement')::int AS document_evidence,
      (SELECT count(*) FROM kai.source_locators l JOIN kai.source_versions v ON v.source_version_id = l.source_version_id WHERE v.organization_id = $1::uuid)::int AS locators,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review')::int AS queue,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'extract_document_statement_evidence')::int AS document_audits`, [ORG]))[0];
  const pipeline = async () => {
    const read = await adminApi("GET", clientEvidencePipelinePath(ORG, PROJECT));
    assert.equal(read.status, 200, J(read.body));
    return projectClientEvidencePipeline(read.body.data, PROJECT);
  };
  const versions = async () => {
    const read = await adminApi("GET", organizationSourcesPath(ORG));
    assert.equal(read.status, 200, J(read.body));
    return projectOrganizationSources(read.body.data).flatMap((source) => source.sourceVersions);
  };
  const fileOf = (data, key) => data.files.find((file) => file.intakeFileId === state[key].intakeFileId);
  const versionOf = (list, key) => list.find((version) => version.sourceVersionId === state[key].sourceVersionId);

  try {
    await test("A1: the files are uploaded and processed by the real P1 worker; the original FY2025-26 PDF is blocked by the PDF security assessor", async () => {
      const batch = await adminApi("POST", createBatchPath(), { organization_id: ORG, engagement_id: PROJECT, batch_code: "cedar-documents", idempotency_key: `batch-${randomUUID()}` });
      assert.ok([200, 201].includes(batch.status), J(batch.body));
      const batchId = batch.body.data.intake_batch_id;
      for (const source of SOURCES) {
        const reserved = await adminApi("POST", fileReservationsPath(batchId), {
          organization_id: ORG, engagement_id: PROJECT, original_filename: source.name, file_extension: source.extension, mime_type: source.mime,
          file_size_bytes: source.bytes.byteLength, checksum: source.checksum, hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
        });
        assert.ok(reserved.status < 300, `${source.name}: ${J(reserved.body)}`);
        state[source.key].intakeFileId = reserved.body.data.intake_file_id;
        const signed = await adminApi("POST", requestUploadUrlPath(batchId), { organization_id: ORG, engagement_id: PROJECT, intake_file_id: state[source.key].intakeFileId });
        await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: source.bytes });
        const confirmed = await adminApi("POST", confirmUploadPath(ORG, state[source.key].intakeFileId), { organization_id: ORG });
        assert.equal(confirmed.status, 200, `${source.name}: ${J(confirmed.body)}`);
        // One file at a time: the PDF worker admits one PDF operation at once,
        // and a PDF confirmed while another is being profiled is left pending
        // with a "retry security check" action (existing behaviour).
        await dispatcher.whenIdle();
      }
      for (const source of SOURCES) {
        const [file] = await query("SELECT file_policy_status FROM kai.intake_files WHERE intake_file_id = $1::uuid", [state[source.key].intakeFileId]);
        const [profile] = await query("SELECT profile FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid", [state[source.key].intakeFileId]);
        const [sensitivity] = await query(
          `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
             JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
            WHERE s.intake_file_id = $1::uuid`, [state[source.key].intakeFileId]);
        Object.assign(state[source.key], { policy: file.file_policy_status, profile: profile?.profile ?? null, sensitivity });
      }
      assert.equal(state.original.policy, "blocked");
      assert.equal(state.original.profile, null);
      for (const key of DOCUMENTS) {
        assert.equal(state[key].policy, "passed", key);
        assert.deepEqual([state[key].profile?.status, state[key].profile?.format], ["profiled", byKey[key].extension.slice(1)], key);
        // The P1 profile still stores no document text.
        assert.doesNotMatch(J(state[key].profile), /convenience sample|independently verified|Digital Skills/, key);
      }
    });

    await test("A2: truthful sensitivity decisions and promotion; with the migration rolled back the handoff writes no document evidence", async () => {
      for (const source of SOURCES) {
        const { sensitivity } = state[source.key];
        if (!sensitivity) continue;
        const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${ORG}`, {
          expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id,
          decision: "reviewed", reviewed_snapshot: DECISIONS[source.key],
        });
        assert.equal(decided.status, 200, `${source.key}: ${J(decided.body)}`);
        const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
        const promoted = await adminApi("POST", sourceCandidateDecisionPath(ORG, candidate.intake_source_candidate_id), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
        assert.equal(promoted.status, 200, `${source.key}: ${J(promoted.body)}`);
        const [version] = await query("SELECT source_version_id::text, source_id::text FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
        Object.assign(state[source.key], { sourceVersionId: version.source_version_id, sourceId: version.source_id, handoff: promoted.body.data?.evidence_extraction_handoff ?? null });
      }
      assert.equal(state.original.sourceVersionId, undefined, "the blocked PDF never becomes a source");
      for (const key of DOCUMENTS) assert.equal(state[key].handoff?.evidence_item_count, 0, `${key}: ${J(state[key].handoff)}`);
      assert.ok(state.register.handoff?.evidence_item_count > 0, "the CSV keeps its field-presence evidence");
      state.register.fieldPresenceCount = state.register.handoff.evidence_item_count;
      assert.equal((await counts()).document_evidence, 0);
    });

    await test("A3: the November 4 pipeline SQL, the Data Sources SQL and the extraction route agree that document evidence is not installed", async () => {
      const data = await pipeline();
      const list = await versions();
      for (const key of DOCUMENTS) {
        const file = fileOf(data, key);
        assert.deepEqual([file.currentStage, file.currentStatus, file.nextAction, file.reason], ["evidence_extraction", "closed", "none", "document_evidence_not_enabled"], key);
        assert.equal(versionOf(list, key).evidenceExtractionCapability, "document_statements_not_enabled", key);
        assert.equal(canOfferEvidenceExtraction(versionOf(list, key)), false, key);
      }
      assert.equal(versionOf(list, "register").evidenceExtractionCapability, "field_presence");
      assert.equal(fileOf(data, "register").currentStage === "evidence_extraction", false, "the CSV has evidence");
      const before = await counts();
      const direct = await adminApi("POST", evidenceExtractionPath(ORG, state.notes.sourceVersionId), {});
      assert.equal(direct.status, 200, J(direct.body));
      assert.deepEqual([direct.body.data.documentEvidence.outcome, direct.body.data.evidenceItems.length], ["document_evidence_not_enabled", 0]);
      assert.match(evidenceExtractionResultMessage(direct.body.data), /not yet available/);
      assert.deepEqual(await counts(), before);
    });

    await test("B1: with the migration applied the same reads offer extraction exactly for the documents", async () => {
      await seedPool.query(readFileSync(new URL("../migrations/kai_sprint2_document_statement_evidence.sql", import.meta.url), "utf8"));
      const data = await pipeline();
      const list = await versions();
      for (const key of DOCUMENTS) {
        const file = fileOf(data, key);
        assert.deepEqual([file.currentStatus, file.nextAction, file.reason], ["waiting_for_client", "extract_evidence", "evidence_extraction_ready"], key);
        assert.equal(versionOf(list, key).evidenceExtractionCapability, "document_statements", key);
        assert.equal(canOfferEvidenceExtraction(versionOf(list, key)), true, key);
      }
    });

    await test("B2: the extraction route persists cited statements under the real CHECKs, with independently checked line and page locators", async () => {
      const before = await counts();
      for (const key of DOCUMENTS) {
        const extracted = await adminApi("POST", evidenceExtractionPath(ORG, state[key].sourceVersionId), {});
        assert.equal(extracted.status, 200, `${key}: ${J(extracted.body)}`);
        assert.equal(extracted.body.data.documentEvidence.outcome, "statements_extracted", key);
        state[key].evidenceIds = extracted.body.data.evidenceItems.map((item) => item.evidence_item_id);
        state[key].firstResponse = extracted.body.data;
      }
      const after = await counts();
      const created = DOCUMENTS.reduce((sum, key) => sum + state[key].evidenceIds.length, 0);
      assert.deepEqual([after.document_evidence - before.document_evidence, after.queue - before.queue, after.document_audits - before.document_audits], [created, created, DOCUMENTS.length]);
      console.log(`Document evidence: ${DOCUMENTS.map((key) => `${byKey[key].name} ${state[key].evidenceIds.length}`).join(", ")}`);

      const rowsFor = (key) => query(
        `SELECT e.evidence_item_id::text, e.source_id::text, e.source_version_id::text, e.source_locator_id::text, e.evidence_type, e.data_class, e.statement,
                e.evidence_review_status, e.internal_only, e.public_use_allowed, e.funder_use_allowed, e.llm_processing_allowed,
                l.source_locator_id::text AS locator_id, l.source_version_id::text AS locator_version_id, l.locator_type, l.coordinates
           FROM kai.evidence_items e JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
          WHERE e.source_version_id = $1::uuid AND e.evidence_type = 'source_document_statement'`, [state[key].sourceVersionId]);

      // TXT: the expected line comes from the raw file, not from KAI.
      const expectedSentence = "No independently verified employment records were obtained for this test period.";
      const rawLines = byKey.notes.bytes.toString("utf8").split("\n");
      const expectedLine = rawLines.findIndex((line) => line.includes(expectedSentence)) + 1;
      const notes = await rowsFor("notes");
      const noteRow = notes.find((row) => row.statement.includes(expectedSentence));
      assert.ok(noteRow, "the independently located statement is persisted");
      const noteBasis = validateDocumentClaimBasis({ evidenceItemRow: noteRow, locatorRow: { ...noteRow, source_locator_id: noteRow.locator_id, source_version_id: noteRow.locator_version_id } });
      assert.equal(noteBasis.ok, true, J(noteBasis));
      assert.deepEqual([noteRow.coordinates.unit, noteRow.coordinates.line_start, noteRow.coordinates.line_end], ["text_lines", expectedLine, expectedLine]);
      assert.ok(rawLines[expectedLine - 1].includes(noteBasis.excerpt));
      assert.equal(documentExcerptSha256(noteBasis.excerpt), noteRow.coordinates.excerpt_sha256);
      assert.deepEqual([noteRow.source_id, noteRow.source_version_id, noteRow.data_class], [state.notes.sourceId, state.notes.sourceVersionId, "source_document_excerpt"]);
      assert.deepEqual([noteRow.evidence_review_status, noteRow.internal_only, noteRow.public_use_allowed, noteRow.funder_use_allowed, noteRow.llm_processing_allowed], ["needs_gk_review", true, false, false, false]);
      state.notes.citedEvidenceId = noteRow.evidence_item_id;
      // The "not a grant of permission or approval" statement is source content, never an approval.
      assert.ok(notes.every((row) => row.evidence_review_status === "needs_gk_review"));

      // PDF: the expected page comes from mupdf's plain page text.
      const mupdf = await import("mupdf");
      const expected = "It is a convenience sample of attempted check-ins, not a census or a representative survey of the full registered cohort.";
      const doc = mupdf.Document.openDocument(new Uint8Array(byKey.survey.bytes), "application/pdf");
      let expectedPage = 0;
      for (let i = 0; i < doc.countPages(); i += 1) if (doc.loadPage(i).toStructuredText().asText().replace(/\s+/g, " ").includes(expected)) expectedPage = i + 1;
      doc.destroy();
      const survey = await rowsFor("survey");
      const surveyRow = survey.find((row) => row.statement.includes(expected));
      assert.ok(surveyRow);
      assert.deepEqual([surveyRow.coordinates.unit, surveyRow.coordinates.page_number], ["pdf_page_blocks", expectedPage]);
      assert.equal(survey.some((row) => row.statement.includes("An improvement rate among all 80 registered people")), false);
      // The EB13 manager estimate keeps its qualifiers.
      const review = await rowsFor("review");
      assert.ok(review.some((row) => /at least 100 distinct participants/.test(row.statement) && /Preliminary reach estimate requiring reconciliation/.test(row.statement)));
    });

    await test("B3: replay writes nothing and returns the same evidence; the CSV's field-presence extraction is unchanged", async () => {
      const before = await counts();
      for (const key of DOCUMENTS) {
        const replay = await adminApi("POST", evidenceExtractionPath(ORG, state[key].sourceVersionId), {});
        assert.equal(replay.status, 200, J(replay.body));
        assert.equal(replay.body.data.replayed, true, key);
        assert.deepEqual(replay.body.data.evidenceItems.map((item) => item.evidence_item_id), state[key].evidenceIds, key);
      }
      assert.deepEqual(await counts(), before);
      const csv = await adminApi("POST", evidenceExtractionPath(ORG, state.register.sourceVersionId), {});
      assert.equal(csv.status, 200, J(csv.body));
      assert.deepEqual([csv.body.data.replayed, csv.body.data.evidenceItems.length, "documentEvidence" in csv.body.data], [true, state.register.fieldPresenceCount, false]);
      assert.ok(csv.body.data.evidenceItems.every((item) => item.evidence_type === "dictionary_field_presence_fact"));
      assert.deepEqual(await counts(), before);
    });

    await test("B3b: a document with no complete statement: the promotion handoff reads it once; after a reload nothing offers extraction again", async () => {
      // Synthetic, headings and labels only (no complete sentence anywhere).
      const bytes = Buffer.from("CEDAR BRIDGE\n\nSECTION A - DELIVERY\n\n62\nAssessed people\n\nTable 3: outcomes by month\n\nAPPENDIX\n", "utf8");
      const name = "Cedar_Bridge_Headings_Only.txt";
      const batch = await adminApi("POST", createBatchPath(), { organization_id: ORG, engagement_id: PROJECT, batch_code: "cedar-headings", idempotency_key: `batch-${randomUUID()}` });
      const reserved = await adminApi("POST", fileReservationsPath(batch.body.data.intake_batch_id), {
        organization_id: ORG, engagement_id: PROJECT, original_filename: name, file_extension: ".txt", mime_type: "text/plain",
        file_size_bytes: bytes.byteLength, checksum: sha256(bytes), hash_algorithm: "sha256", idempotency_key: `file-${randomUUID()}`,
      });
      assert.ok(reserved.status < 300, J(reserved.body));
      const intakeFileId = reserved.body.data.intake_file_id;
      const signed = await adminApi("POST", requestUploadUrlPath(batch.body.data.intake_batch_id), { organization_id: ORG, engagement_id: PROJECT, intake_file_id: intakeFileId });
      await fetch(signed.body.data.upload_url, { method: signed.body.data.upload_method, headers: signed.body.data.upload_headers, body: bytes });
      assert.equal((await adminApi("POST", confirmUploadPath(ORG, intakeFileId), { organization_id: ORG })).status, 200);
      await dispatcher.whenIdle();
      const [sensitivity] = await query(
        `SELECT s.intake_sensitivity_profile_id::text, q.review_queue_item_id::text, q.updated_at FROM kai.intake_sensitivity_profiles s
           JOIN kai.review_queue_items q ON q.target_object_id = s.intake_sensitivity_profile_id AND q.queue_type = 'sensitivity_review'
          WHERE s.intake_file_id = $1::uuid`, [intakeFileId]);
      const decided = await adminApi("POST", `${COCKPIT}/sensitivity-profiles/${sensitivity.intake_sensitivity_profile_id}/decision?organization_id=${ORG}`, {
        expected_updated_at: new Date(sensitivity.updated_at).toISOString(), review_queue_item_id: sensitivity.review_queue_item_id, decision: "reviewed", reviewed_snapshot: ABSENT,
      });
      assert.equal(decided.status, 200, J(decided.body));
      const [candidate] = await query("SELECT intake_source_candidate_id::text FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
      const before = await counts();
      const promoted = await adminApi("POST", sourceCandidateDecisionPath(ORG, candidate.intake_source_candidate_id), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(promoted.status, 200, J(promoted.body));
      const [version] = await query("SELECT source_version_id::text FROM kai.source_versions WHERE intake_sensitivity_profile_id = $1::uuid", [sensitivity.intake_sensitivity_profile_id]);
      state.headings = { intakeFileId, sourceVersionId: version.source_version_id };
      assert.equal(promoted.body.data?.evidence_extraction_handoff?.evidence_item_count, 0, J(promoted.body.data?.evidence_extraction_handoff));
      // The handoff's completed read is recorded once (metadata only); no evidence, locator or queue item.
      const afterHandoff = await counts();
      assert.deepEqual([afterHandoff.document_evidence, afterHandoff.locators, afterHandoff.queue, afterHandoff.document_audits],
        [before.document_evidence, before.locators, before.queue, before.document_audits + 1]);
      const [audit] = await query(
        `SELECT reason_code, object_type::text, metadata->>'source_version_id' AS source_version_id, metadata->>'object_type' AS target, actor_type::text
           FROM kai.audit_events WHERE organization_id = $1::uuid AND action = 'extract_document_statement_evidence' ORDER BY created_at DESC LIMIT 1`, [ORG]);
      assert.deepEqual([audit.reason_code, audit.source_version_id, audit.target, audit.actor_type],
        ["document_statements_none_found:kai_document_statement_excerpt_v1", version.source_version_id, "source_version", "human"]);
      // A reload: the pipeline SQL and the Data Sources SQL read that state.
      const data = await pipeline();
      const file = data.files.find((candidate) => candidate.intakeFileId === intakeFileId);
      assert.deepEqual([file.currentStage, file.currentStatus, file.nextAction, file.reason], ["evidence_extraction", "closed", "none", "no_supportable_statements"]);
      const version0 = versionOf(await versions(), "headings");
      assert.equal(version0.evidenceExtractionCapability, "document_statements_none_found");
      assert.equal(canOfferEvidenceExtraction(version0), false);
      // The documents that do hold statements are unaffected.
      for (const key of DOCUMENTS) assert.equal(versionOf(await versions(), key).evidenceExtractionCapability, "document_statements", key);
      // A stale page's direct POST reads again, writes nothing and records nothing more.
      const again = await adminApi("POST", evidenceExtractionPath(ORG, version.source_version_id), {});
      assert.equal(again.status, 200, J(again.body));
      assert.deepEqual([again.body.data.documentEvidence.outcome, again.body.data.evidenceItems.length], ["no_supportable_statements", 0]);
      assert.deepEqual(await counts(), afterHandoff);
    });

    await test("B4: the real Impact Evidence Library read lists the document evidence for review; the pipeline moves the documents to Get Kinder's evidence review", async () => {
      const seen = [];
      let after = null;
      do {
        const page = await gkApi("GET", evidenceLibraryCandidatesPath(ORG, after));
        assert.equal(page.status, 200, J(page.body));
        seen.push(...page.body.data.items);
        after = page.body.data.nextAfterEvidenceItemId;
      } while (after);
      const cited = seen.find((item) => item.evidenceItemId === state.notes.citedEvidenceId);
      assert.ok(cited);
      assert.deepEqual([cited.evidenceType, cited.dataClass, cited.sourceVersionId, cited.evidenceReviewStatus, cited.internalOnly, cited.funderUseAllowed],
        ["source_document_statement", "source_document_excerpt", state.notes.sourceVersionId, "needs_gk_review", true, false]);
      assert.match(cited.statement, /^Source document statement \(line \d+, sentences? [\d-]+\): ".*No independently verified employment records were obtained for this test period\."$/);
      assert.equal(seen.filter((item) => item.evidenceType === "source_document_statement").length, DOCUMENTS.reduce((sum, key) => sum + state[key].evidenceIds.length, 0));
      const data = await pipeline();
      for (const key of DOCUMENTS) assert.deepEqual([fileOf(data, key).currentStage, fileOf(data, key).reason], ["evidence_review", "evidence_awaiting_review"], key);
    });

    await test("B5: Get Kinder reviews one statement and the administrator proposes a claim that restates it as source-reported", async () => {
      const [queue] = await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE queue_type = 'evidence_review' AND target_object_id = $1::uuid", [state.notes.citedEvidenceId]);
      const reviewed = await gkApi("POST", evidenceReviewCompletePath(ORG, state.notes.citedEvidenceId, queue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision: "supported" }));
      assert.ok([200, 201].includes(reviewed.status), J(reviewed.body));
      const proposed = await adminApi("POST", claimProposalPath(ORG, state.notes.citedEvidenceId), {});
      assert.ok([200, 201].includes(proposed.status), J(proposed.body));
      const [claim] = await query("SELECT statement, claim_review_status, internal_only, public_use_allowed, funder_use_allowed FROM kai.claims WHERE claim_id = $1::uuid", [proposed.body.data.claim.claim_id]);
      assert.match(claim.statement, /^Source-reported, not independently verified \(line \d+\): ".*No independently verified employment records were obtained for this test period\."$/);
      assert.deepEqual([claim.claim_review_status, claim.internal_only, claim.public_use_allowed, claim.funder_use_allowed], ["needs_gk_review", true, false, false]);
      const replay = await adminApi("POST", claimProposalPath(ORG, state.notes.citedEvidenceId), {});
      assert.equal(replay.body.data.replayed, true, J(replay.body));
    });

    await test("B6: refusals: an outsider, and a version that is no longer current (no write, no byte read)", async () => {
      const before = await counts();
      const outsider = await outsiderApi("POST", evidenceExtractionPath(ORG, state.review.sourceVersionId), {});
      assert.equal(outsider.status, 403, J(outsider.body));
      // Reversible negative, as in the six-source runner: the version is made
      // non-current directly, extraction is refused, and currentness is restored.
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [state.review.sourceVersionId]);
      try {
        const stale = await adminApi("POST", evidenceExtractionPath(ORG, state.review.sourceVersionId), {});
        assert.equal(stale.status, 409, J(stale.body));
      } finally {
        await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [state.review.sourceVersionId]);
      }
      assert.deepEqual(await counts(), before);
    });

    await test("B7: the rollback refuses once document evidence exists and changes nothing", async () => {
      const before = await counts();
      // A dedicated connection: the refused script leaves its explicit
      // transaction aborted until it is rolled back.
      const connection = await seedPool.connect();
      try {
        await assert.rejects(
          connection.query(readFileSync(new URL("../migrations/kai_sprint2_document_statement_evidence.rollback.sql", import.meta.url), "utf8")),
          /document-statement evidence rollback refused/,
        );
        await connection.query("ROLLBACK");
      } finally {
        connection.release();
      }
      const [still] = await query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'evidence_items_p2_01_evidence_type_check'");
      assert.match(still.def, /source_document_statement/);
      assert.deepEqual(await counts(), before);
    });
  } finally {
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }
}
