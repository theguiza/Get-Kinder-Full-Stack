import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_14_generated_content_type_evolution_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-14-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(65000 + Math.floor(Math.random() * 500));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture || options.allowFail ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (!options.allowFail && result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true, ...options });
}

function psqlScalar(sql, options = {}) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c", sql], { capture: true, ...options });
}

function assertNoFail(output, label) {
  if (/(^|\s)FAIL(\s|$)/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P14-14 runner refused non-loopback target before connection");
  }
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT version() AS version,
             current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    console.log(`P14-14 PostgreSQL version: ${row.version}`);
    if (row.database_name !== dbName) throw new Error("P14-14 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-14 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-14 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-14 runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function constraintStates() {
  return psqlScalar(`
    SELECT string_agg(relname || ':' || conname || ':' || pg_get_constraintdef(c.oid), E'\n' ORDER BY relname, conname)
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND relname IN ('generation_runs', 'generated_content_drafts')
       AND conname IN ('generation_runs_p3_01_content_type_check', 'generated_content_drafts_p3_01_content_type_check')
  `).stdout.trim();
}

const ORG = "00000000-0000-4000-8000-000000000001";

function insertGenerationRun(idempotencyKey, contentType, fingerprintSeed) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", dbName, "-c", `
    INSERT INTO kai.generation_runs (
      organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type
    ) VALUES (
      '${ORG}', '${idempotencyKey}', repeat('${fingerprintSeed}', 64), '${contentType}', 'internal', 'system'
    );
  `], { capture: true, allowFail: true });
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Same organization/engagement foundation the existing P13-01 runner
  // establishes, required transitively by P14-01's generation_runs FK.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlScalar(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_14_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  // Additional prerequisite chain (mirrors the existing C3-A4 local-Postgres
  // runner's proven ordering) required only for the real, unstubbed
  // Readiness Assessment / Data Gap Memo persistence proof below: real
  // kai.requirements (B1.1), real kai.requirement_assessments (C2.1), and the
  // full claim/evidence review-decision and conflict-resolution schema
  // (P2-09/P2-10/P2-11/P2-12/C3-A3/C3-A4) that
  // listOrganizationRequirementsReadiness and the gap current-state filter
  // both read, in addition to the same claim-gap-followup schema (P2-04/
  // P2-05) the existing P14-14 constraint proof already applied.
  psqlFile("migrations/kai_sprint2_a1_1_impact_outcome_context.sql");
  psqlFile("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql");
  psqlFile("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql");
  psqlFile("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql");
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
  psqlFile("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql");
  psqlFile("migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  console.log("P14-14 predecessor chain (through P13-01, plus the Readiness/Data-Gap-Memo real-persistence prerequisite chain) applied.");

  // --- Pre-migration proof: readiness_assessment/data_gap_memo are real,
  // reproducible drift against the schema as it stands through P13-01. ---
  const preConstraints = constraintStates();
  console.log(`P14-14 pre-migration content_type constraints:\n${preConstraints}`);

  const preDataGapMemo = insertGenerationRun("p14-14-pre-data-gap-memo", "data_gap_memo", "1");
  if (preDataGapMemo.status === 0) {
    throw new Error("P14-14 pre-migration insert of content_type='data_gap_memo' unexpectedly succeeded before the fix migration");
  }
  const preDataGapMemoDetail = [preDataGapMemo.stdout, preDataGapMemo.stderr].filter(Boolean).join("\n");
  if (!preDataGapMemoDetail.includes("23514") || !preDataGapMemoDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 pre-migration data_gap_memo insert did not fail with the expected SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${preDataGapMemoDetail}`);
  }
  console.log(`P14-14 reproduced pre-migration failure (expected):\n${preDataGapMemoDetail}`);

  const preReadiness = insertGenerationRun("p14-14-pre-readiness-assessment", "readiness_assessment", "2");
  if (preReadiness.status === 0) {
    throw new Error("P14-14 pre-migration insert of content_type='readiness_assessment' unexpectedly succeeded before the fix migration");
  }
  const preReadinessDetail = [preReadiness.stdout, preReadiness.stderr].filter(Boolean).join("\n");
  if (!preReadinessDetail.includes("23514") || !preReadinessDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 pre-migration readiness_assessment insert did not fail with the expected SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${preReadinessDetail}`);
  }
  console.log(`P14-14 reproduced pre-migration failure (expected):\n${preReadinessDetail}`);

  // --- Apply the fix migration. ---
  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql");
  console.log("P14-14 forward migration applied.");

  const postConstraints = constraintStates();
  console.log(`P14-14 post-migration content_type constraints:\n${postConstraints}`);

  const verifierOutput = psqlFile("scripts/kai-sprint2-p14-14-generated-content-type-evolution-verifier.sql").stdout;
  assertNoFail(verifierOutput, "P14-14 verifier");
  console.log(verifierOutput);

  // Real organization/engagement fixture rows the smoke-seed's
  // generation_runs/generated_content_drafts rows are scoped under, and that
  // the deeper real-service persistence proof below also requires.
  psqlScalar(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P14-14 Smoke Org', 'p14-14-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlScalar(
    "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000001', 'p14-14-smoke-engagement') ON CONFLICT (engagement_id) DO NOTHING;",
  );

  psqlFile("scripts/kai-sprint2-p14-14-generated-content-type-evolution-smoke-seed.sql");
  const smokeOutput = psqlFile("scripts/kai-sprint2-p14-14-generated-content-type-evolution-smoke-verifier.sql").stdout;
  assertNoFail(smokeOutput, "P14-14 smoke verifier");
  console.log(smokeOutput);

  const failureOutput = psqlFile("scripts/kai-sprint2-p14-14-generated-content-type-evolution-failure-checks.sql").stdout;
  assertNoFail(failureOutput, "P14-14 failure checks");
  console.log(failureOutput);

  // --- Post-migration proof: all four application content types succeed at
  // kai.generation_runs, and an unknown type is still rejected. ---
  const contentTypes = ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"];
  contentTypes.forEach((contentType, index) => {
    const seed = String(3 + index);
    const result = insertGenerationRun(`p14-14-post-${contentType}`, contentType, seed);
    if (result.status !== 0) {
      throw new Error(`P14-14 post-migration insert of content_type='${contentType}' unexpectedly failed:\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
    }
  });
  console.log("P14-14 post-migration: all four application content types accepted at kai.generation_runs.");

  const unknownRunResult = insertGenerationRun("p14-14-post-unknown-type", "not_a_real_type", "9");
  if (unknownRunResult.status === 0) {
    throw new Error("P14-14 post-migration insert of an unknown content_type unexpectedly succeeded at kai.generation_runs");
  }
  const unknownRunDetail = [unknownRunResult.stdout, unknownRunResult.stderr].filter(Boolean).join("\n");
  if (!unknownRunDetail.includes("23514") || !unknownRunDetail.includes("generation_runs_p3_01_content_type_check")) {
    throw new Error(`P14-14 unknown-type insert did not fail with SQLSTATE 23514 on generation_runs_p3_01_content_type_check:\n${unknownRunDetail}`);
  }
  console.log("P14-14 post-migration: unknown content_type rejected at kai.generation_runs.");

  // Now prove the same four types (plus rejection) at
  // kai.generated_content_drafts, each bound to its own generation_run.
  const draftIds = {};
  for (const contentType of contentTypes) {
    const runIdResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c",
      `SELECT generation_run_id FROM kai.generation_runs WHERE idempotency_key = 'p14-14-post-${contentType}';`], { capture: true });
    const runId = runIdResult.stdout.trim();
    const draftResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", `
      INSERT INTO kai.generated_content_drafts (
        generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type
      ) VALUES (
        '${runId}', '${ORG}', '${contentType}', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system'
      ) RETURNING generated_content_draft_id;
    `], { capture: true, allowFail: true });
    if (draftResult.status !== 0) {
      throw new Error(`P14-14 post-migration insert of content_type='${contentType}' unexpectedly failed at kai.generated_content_drafts:\n${[draftResult.stdout, draftResult.stderr].filter(Boolean).join("\n")}`);
    }
    draftIds[contentType] = draftResult.stdout;
  }
  console.log("P14-14 post-migration: all four application content types accepted at kai.generated_content_drafts.");

  const evidenceSummaryRunIdResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c",
    `SELECT generation_run_id FROM kai.generation_runs WHERE idempotency_key = 'p14-14-post-evidence_summary';`], { capture: true });
  const evidenceSummaryRunId = evidenceSummaryRunIdResult.stdout.trim();
  const unknownDraftResult = run(psql, ["-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", dbName, "-c", `
    INSERT INTO kai.generated_content_drafts (
      generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type
    ) VALUES (
      '${evidenceSummaryRunId}', '${ORG}', 'not_a_real_type', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system'
    );
  `], { capture: true, allowFail: true });
  if (unknownDraftResult.status === 0) {
    throw new Error("P14-14 post-migration insert of an unknown content_type unexpectedly succeeded at kai.generated_content_drafts");
  }
  const unknownDraftDetail = [unknownDraftResult.stdout, unknownDraftResult.stderr].filter(Boolean).join("\n");
  if (!unknownDraftDetail.includes("23514") || !unknownDraftDetail.includes("generated_content_drafts_p3_01_content_type_check")) {
    throw new Error(`P14-14 unknown-type insert did not fail with SQLSTATE 23514 on generated_content_drafts_p3_01_content_type_check:\n${unknownDraftDetail}`);
  }
  console.log("P14-14 post-migration: unknown content_type rejected at kai.generated_content_drafts.");

  // --- Real Data Gap Memo / Readiness Assessment persistence-transaction
  // proof: the actual production service + repository path, through this
  // same real ephemeral PostgreSQL, with only the external generation
  // provider (draftGenerator) stubbed - matching the existing P3-01/P13-01
  // real-service integration convention
  // (__tests__/kai-sprint2-p3-01-generated-content-drafts.integration.spec.js).
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  await runGeneratedContentTypeEvolutionPersistenceProof();

  async function runGeneratedContentTypeEvolutionPersistenceProof() {
    const { Pool } = await import("pg");
    const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
    const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
    const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
    const { createDataGapMemoDraft, createReadinessAssessmentDraft } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
    const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
    const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
    const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
    const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
    const { createPostgresRequirementAssessmentRepository } = await import("../Backend/kai/dictionary/postgresRequirementAssessmentRepository.js");

    const ENGAGEMENT = "00000000-0000-4000-8000-000000000901";
    const NOW = "2026-09-13T12:00:00.000Z";
    const pool = new Pool({ connectionString: targetUrl, ssl: false, max: 10 });

    async function withRunnerOwnedTransaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const actorContext = {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      organizationMemberships: [
        { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
      ],
    };

    function auditRecorder(published) {
      return {
        prepareMetadataOnlyAudit() {
          return {
            ok: true,
            async publish() {
              published.push(true);
            },
          };
        },
      };
    }

    async function engagementLookup({ organizationId, engagementId }) {
      if (organizationId === ORG && engagementId === ENGAGEMENT) {
        return { engagement_id: ENGAGEMENT, organization_id: ORG };
      }
      return null;
    }

    function makeDraftGenerator(text) {
      return async (generatorInput) => ({
        blocks: [{
          ordinal: 1,
          text,
          citations: [{ claimId: generatorInput.claims[0].claimId, evidenceItemId: generatorInput.claims[0].evidenceItemId }],
        }],
      });
    }

    async function query(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    }

    const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
    const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
    const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });

    // Real synthetic-but-governed fixture: a real source_version -> real
    // evidence_item -> real claim -> real gap_log_item, built through the
    // same real P2-01/P2-03/P2-04 services the P3-01 integration suite uses,
    // never handwritten INSERTs that bypass application code.
    const sourceVersions = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    if (!sourceVersions[0]) throw new Error("P14-14 persistence proof requires a current source_version fixture");

    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder([]) },
    );
    if (!evidenceResult.ok) throw new Error(`P14-14 persistence proof fixture: extractEvidenceFromSourceVersion failed: ${evidenceResult.error?.code}`);

    const evidenceRows = await query(
      `SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRows[0].evidence_item_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder([]) },
    );
    if (!claimResult.ok) throw new Error(`P14-14 persistence proof fixture: proposeClaim failed: ${claimResult.error?.code}`);

    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder([]) },
    );
    if (!gapResult.ok) throw new Error(`P14-14 persistence proof fixture: generateClaimGapFollowups failed: ${gapResult.error?.code}`);

    const claimRows = await query(
      `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
      [ORG, claimResult.data.claim.claim_id],
    );
    const claim = claimRows[0];

    async function countsForRun(idempotencyKey) {
      const rows = await query(
        `WITH run AS (
           SELECT generation_run_id FROM kai.generation_runs WHERE organization_id = $1::uuid AND idempotency_key = $2
         ),
         draft AS (
           SELECT generated_content_draft_id FROM kai.generated_content_drafts WHERE generation_run_id IN (SELECT generation_run_id FROM run)
         ),
         block AS (
           SELECT generated_content_block_id FROM kai.generated_content_blocks WHERE generated_content_draft_id IN (SELECT generated_content_draft_id FROM draft)
         )
         SELECT
           (SELECT count(*)::int FROM run) AS runs,
           (SELECT count(*)::int FROM draft) AS drafts,
           (SELECT count(*)::int FROM block) AS blocks,
           (SELECT count(*)::int FROM kai.generated_content_citations WHERE generated_content_block_id IN (SELECT generated_content_block_id FROM block)) AS citations,
           (SELECT count(*)::int FROM kai.review_queue_items WHERE queue_type = 'generated_content_review' AND target_object_id IN (SELECT generated_content_draft_id FROM draft)) AS queues,
           (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created' AND metadata->>'generation_run_id' IN (SELECT generation_run_id::text FROM run)) AS audits`,
        [ORG, idempotencyKey],
      );
      return rows[0];
    }

    function assertDurableCounts(label, counts) {
      const expected = { runs: 1, drafts: 1, blocks: 1, citations: 1, queues: 1, audits: 1 };
      for (const key of Object.keys(expected)) {
        if (counts[key] !== expected[key]) {
          throw new Error(`P14-14 ${label} durable-row proof failed: expected ${key}=${expected[key]}, got ${counts[key]} (${JSON.stringify(counts)})`);
        }
      }
    }

    // --- Data Gap Memo: real service path (real gap read-service, real
    // repository), only the LLM generation provider stubbed. ---
    const dataGapMemoPublished = [];
    const dataGapMemoResult = await createDataGapMemoDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "internal",
        idempotencyKey: "p14-14-real-data-gap-memo",
        actorContext,
        now: NOW,
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        getEngagementForOrganization: engagementLookup,
        gapReadDependencies: { runInTransaction: withRunnerOwnedTransaction },
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction }),
        draftGenerator: makeDraftGenerator("A current data gap remains for the cited claim."),
        metadataOnlyAudit: auditRecorder(dataGapMemoPublished),
      },
    );
    if (!dataGapMemoResult.ok) {
      throw new Error(`P14-14 real Data Gap Memo persistence failed: ${dataGapMemoResult.error?.code} ${JSON.stringify(dataGapMemoResult.blockers || [])}`);
    }
    const dataGapMemoCounts = await countsForRun("p14-14-real-data-gap-memo");
    assertDurableCounts("Data Gap Memo", dataGapMemoCounts);
    if (dataGapMemoPublished.length !== 1) throw new Error("P14-14 real Data Gap Memo audit was not published exactly once");
    console.log(`P14-14 real Data Gap Memo durable rows (generation_run/draft/blocks/citations/review/audit): ${JSON.stringify(dataGapMemoCounts)}`);

    const dataGapMemoReread = await createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction })
      .getGeneratedDraftReviewPacket({ organizationId: ORG, generatedContentDraftId: dataGapMemoResult.data.generatedContentDraftId });
    if (!dataGapMemoReread.ok || dataGapMemoReread.data.contentType !== "data_gap_memo") {
      throw new Error(`P14-14 real Data Gap Memo reread failed: ${dataGapMemoReread.error?.code}`);
    }
    console.log("P14-14 real Data Gap Memo reread through the real review-packet repository surface succeeded.");

    // Real B1.1 requirements-catalogue fixture: listOrganizationRequirementsReadiness
    // reads a live catalogue of supported requirement_key rows
    // (kai.requirement_sources -> kai.requirement_framework_versions ->
    // kai.requirement_sets -> kai.requirements); an organization with no
    // catalogue rows correctly reads back requirements: [] (never assessed
    // is a real state, not an error), but createReadinessAssessmentDraft's
    // own generator-input contract requires a non-empty authoritative
    // readiness projection, so this proof seeds one real supported
    // requirement row (IR_DATA_003, claim/evidence traceability - the same
    // dimension our real claim fixture exercises) the same way the existing
    // requirements-readiness-rollup integration suite does.
    const { REQUIREMENT_KEY: irData003 } = await import("../Backend/kai/validators/kaiClaimEvidenceTraceabilityAssessmentValidators.js");
    const requirementSourceId = (await query(
      "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', 'src_p14_14_readiness', 'P14-14 Readiness Fixture Source') RETURNING requirement_source_id",
    ))[0].requirement_source_id;
    const frameworkVersionId = (await query(
      "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw_p14_14_readiness', 'P14-14 Readiness Framework', 'v1') RETURNING requirement_framework_version_id",
      [requirementSourceId],
    ))[0].requirement_framework_version_id;
    const requirementSetId = (await query(
      "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set_p14_14_readiness', 'P14-14 Readiness Set') RETURNING requirement_set_id",
      [frameworkVersionId],
    ))[0].requirement_set_id;
    await query(
      "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order) VALUES ($1, $2, $3, $4, 0)",
      [requirementSetId, irData003, "P14-14 readiness fixture requirement", "Claims are traceable to evidence"],
    );

    // --- Readiness Assessment: real service path (real readiness read-
    // service, real repository), only the LLM generation provider stubbed. ---
    const readinessPublished = [];
    const readinessInputDebug = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "internal",
      claimIds: [claim.claim_id],
      idempotencyKey: "p14-14-real-readiness-assessment",
      actorContext,
      now: NOW,
    };
    const readinessResult = await createReadinessAssessmentDraft(
      readinessInputDebug,
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        getEngagementForOrganization: engagementLookup,
        requirementsReadinessDependencies: {
          requirementAssessmentRepository: createPostgresRequirementAssessmentRepository({ runInTransaction: withRunnerOwnedTransaction }),
        },
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction }),
        draftGenerator: makeDraftGenerator("A readiness gap remains for the cited claim."),
        metadataOnlyAudit: auditRecorder(readinessPublished),
      },
    );
    if (!readinessResult.ok) {
      throw new Error(`P14-14 real Readiness Assessment persistence failed: ${readinessResult.error?.code} ${JSON.stringify(readinessResult.blockers || [])}`);
    }
    const readinessCounts = await countsForRun("p14-14-real-readiness-assessment");
    assertDurableCounts("Readiness Assessment", readinessCounts);
    if (readinessPublished.length !== 1) throw new Error("P14-14 real Readiness Assessment audit was not published exactly once");
    console.log(`P14-14 real Readiness Assessment durable rows (generation_run/draft/blocks/citations/review/audit): ${JSON.stringify(readinessCounts)}`);

    const readinessReread = await createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction })
      .getGeneratedDraftReviewPacket({ organizationId: ORG, generatedContentDraftId: readinessResult.data.generatedContentDraftId });
    if (!readinessReread.ok || readinessReread.data.contentType !== "readiness_assessment") {
      throw new Error(`P14-14 real Readiness Assessment reread failed: ${readinessReread.error?.code}`);
    }
    console.log("P14-14 real Readiness Assessment reread through the real review-packet repository surface succeeded.");

    await pool.end();
    console.log("P14-14 real Data Gap Memo / Readiness Assessment persistence-transaction proof passed.");
  }

  // --- Rollback proof: refused with readiness_assessment/data_gap_memo
  // rows present, then succeeds after they are removed. ---
  const beforeRollbackConstraints = constraintStates();
  const incompatibleRollback = psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.rollback.sql", { allowFail: true });
  if (incompatibleRollback.status === 0) {
    throw new Error("P14-14 rollback unexpectedly succeeded with synthetic readiness_assessment/data_gap_memo rows present");
  }
  const afterFailedRollbackConstraints = constraintStates();
  if (afterFailedRollbackConstraints !== beforeRollbackConstraints) {
    throw new Error("P14-14 rollback left a partial target constraint transition after incompatible-data failure");
  }
  console.log(`P14-14 incompatible-data rollback failed cleanly; constraints unchanged:\n${afterFailedRollbackConstraints}`);

  // Cleans up both the manually-inserted post-migration proof drafts (no
  // children) and the real service-generated Data Gap Memo / Readiness
  // Assessment drafts above (real blocks/citations/review-queue/audit rows),
  // in FK-safe child-to-parent order, as runner-only synthetic-fixture
  // cleanup - never a modification of the rollback migration itself.
  run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", `
    DELETE FROM kai.review_queue_items
     WHERE queue_type = 'generated_content_review'
       AND target_object_id IN (
         SELECT generated_content_draft_id FROM kai.generated_content_drafts
          WHERE content_type IN ('readiness_assessment', 'data_gap_memo')
       );
    DELETE FROM kai.generated_content_citations
     WHERE generated_content_block_id IN (
       SELECT generated_content_block_id FROM kai.generated_content_blocks
        WHERE generated_content_draft_id IN (
          SELECT generated_content_draft_id FROM kai.generated_content_drafts
           WHERE content_type IN ('readiness_assessment', 'data_gap_memo')
        )
     );
    DELETE FROM kai.generated_content_blocks
     WHERE generated_content_draft_id IN (
       SELECT generated_content_draft_id FROM kai.generated_content_drafts
        WHERE content_type IN ('readiness_assessment', 'data_gap_memo')
     );
    DELETE FROM kai.upload_lifecycle_audit
     WHERE operation = 'generated_content_draft_created'
       AND metadata->>'generation_run_id' IN (
         SELECT generation_run_id::text FROM kai.generation_runs
          WHERE content_type IN ('readiness_assessment', 'data_gap_memo')
       );
    DELETE FROM kai.generated_content_drafts WHERE content_type IN ('readiness_assessment', 'data_gap_memo');
    DELETE FROM kai.generation_runs WHERE content_type IN ('readiness_assessment', 'data_gap_memo');
  `], { capture: true });

  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.rollback.sql");
  const restoredConstraints = constraintStates();
  if (!restoredConstraints.includes("evidence_summary") || !restoredConstraints.includes("impact_narrative") || restoredConstraints.includes("readiness_assessment") || restoredConstraints.includes("data_gap_memo")) {
    throw new Error(`P14-14 rollback did not restore the P13-01 content_type contract:\n${restoredConstraints}`);
  }
  console.log(`P14-14 compatible clean rollback restored P13-01 constraints:\n${restoredConstraints}`);
  console.log("P14-14 generated-content type-evolution package verification passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-14 generated-content type-evolution ephemeral PostgreSQL workdir removed: ${workDir}`);
}
