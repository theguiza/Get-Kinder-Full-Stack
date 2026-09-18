import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-17 real-authority-write suite refused a non-loopback KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-17 real-authority-write integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runRealAuthorityWriteSuite();
}

async function runRealAuthorityWriteSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresExportCandidateRepository,
  } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const {
    createPostgresHumanAuthorityDecisionRepository,
  } = await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-09-06T10:00:00.000Z";
  const LATER = "2026-09-06T10:05:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

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

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  function actorContext(role, id) {
    return {
      actorType: "human",
      actorUserId: id,
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
    };
  }
  const gkAdmin = actorContext("gk_admin", "90000000-0000-4000-8000-000000000015");
  const gkReviewer = actorContext("gk_reviewer", "90000000-0000-4000-8000-000000000014");

  function encodeFingerprint(seed) {
    return createHash("sha256").update(seed).digest("hex");
  }

  const exportCandidateRepository = createPostgresExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const humanAuthorityDecisionRepository = createPostgresHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });

  let seedCounter = 0;

  async function seedExportCandidate() {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const evidenceA = `20000000-0000-4000-8000-0000000e9${n}`;
    const claimA = `20000000-0000-4000-8000-0000000a9${n}`;

    const templateRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const templateEvidenceId = templateRows[0].evidence_item_id;

    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'P3-17 real-authority-write evidence item.', $3, created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceA, templateEvidenceId, encodeFingerprint(`evidence-${n}`)],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','P3-17 real-authority-write claim.',$4,'system')`,
      [claimA, ORG, evidenceA, encodeFingerprint(`claim-${n}`)],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimA, evidenceA],
    );
    const runRows = await query(
      `INSERT INTO kai.generation_runs (organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type, created_at)
       VALUES ($1::uuid,$2,$3,'evidence_summary','internal','system',$4::timestamptz)
       RETURNING generation_run_id::text AS generation_run_id`,
      [ORG, `p3-17-real-authority-write-seed-${n}`, encodeFingerprint(`run-${n}`), NOW],
    );
    const runId = runRows[0].generation_run_id;
    const draftRows = await query(
      `INSERT INTO kai.generated_content_drafts (generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type, created_at)
       VALUES ($1::uuid,$2::uuid,'evidence_summary','internal','draft','needs_gk_review','[]'::jsonb,'system',$3::timestamptz)
       RETURNING generated_content_draft_id::text AS generated_content_draft_id`,
      [runId, ORG, NOW],
    );
    const draftId = draftRows[0].generated_content_draft_id;
    const blockRows = await query(
      `INSERT INTO kai.generated_content_blocks (generated_content_draft_id, organization_id, ordinal, text, created_at)
       VALUES ($1::uuid,$2::uuid,1,'P3-17 real-authority-write block text.',$3::timestamptz)
       RETURNING generated_content_block_id::text AS generated_content_block_id`,
      [draftId, ORG, NOW],
    );
    const blockId = blockRows[0].generated_content_block_id;
    await query(
      `INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id, created_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz)`,
      [blockId, ORG, claimA, evidenceA, NOW],
    );
    await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type, created_at, updated_at)
       VALUES ($1::uuid,'generated_content_review','generated_content_draft',$2::uuid,'medium','resolved','resolved','Generated draft requires human review.','Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.','{}'::jsonb,'system',$3::timestamptz,$3::timestamptz)`,
      [ORG, draftId, NOW],
    );
    await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type, created_at, updated_at)
       VALUES ($1::uuid,'export_review','generated_content_draft',$2::uuid,'medium','resolved','resolved','Generated draft requires export review.','Review audience authority, current eligibility, citations, and the final export gate before any export.','{}'::jsonb,'system',$3::timestamptz,$3::timestamptz)`,
      [ORG, draftId, NOW],
    );

    const snapshot = await exportCandidateRepository.confirmLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: draftId, entries: [{ claimId: claimA, evidenceItemId: evidenceA, limitationCodes: [] }], actorContext: gkReviewer, confirmedByRole: "gk_reviewer", now: NOW },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(snapshot.ok, true);

    const candidate = await exportCandidateRepository.createExportCandidate(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext: gkAdmin, now: NOW },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(candidate.ok, true);

    return { draftId, exportCandidateId: candidate.data.exportCandidateId };
  }

  test.after(async () => {
    await pool.end();
  });

  test("P3-17 real Postgres: recordDecision no longer fails at the upload_lifecycle_audit_gate_a_operation_check boundary", async () => {
    const seed = await seedExportCandidate();

    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      decisionType: "export_authority_granted",
      decisionAction: "grant",
      requestedAudience: "internal",
      actorContext: gkAdmin,
      now: NOW,
    }, { metadataOnlyAudit: auditRecorder() });

    assert.equal(grant.ok, true, JSON.stringify(grant));
    assert.equal(grant.data.effective, true);
    assert.equal(grant.data.replayed, false);

    const decisionRows = await query(
      `SELECT decision_action, decided_by_role, supersedes_decision_id FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`,
      [grant.data.decisionId],
    );
    assert.equal(decisionRows.length, 1);
    assert.equal(decisionRows[0].decision_action, "grant");
    assert.equal(decisionRows[0].decided_by_role, "gk_admin");
    assert.equal(decisionRows[0].supersedes_decision_id, null);

    const auditRows = await query(
      `SELECT operation, metadata FROM kai.upload_lifecycle_audit WHERE metadata->>'decision_id' = $1`,
      [grant.data.decisionId],
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].operation, "human_authority_decision_recorded");
    assert.equal(auditRows[0].metadata.decision_action, "grant");
    assert.equal(auditRows[0].metadata.effective, true);

    const effectiveness = await humanAuthorityDecisionRepository.evaluateEffectiveness({
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      decisionType: "export_authority_granted",
    });
    assert.equal(effectiveness.ok, true);
    assert.equal(effectiveness.data.effective, true);
    assert.equal(effectiveness.data.headDecisionId, grant.data.decisionId);

    const revoke = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      decisionType: "export_authority_granted",
      decisionAction: "revoke",
      requestedAudience: "internal",
      actorContext: gkAdmin,
      now: LATER,
    }, { metadataOnlyAudit: auditRecorder() });

    assert.equal(revoke.ok, true, JSON.stringify(revoke));
    assert.equal(revoke.data.supersedesDecisionId, grant.data.decisionId);
    assert.equal(revoke.data.effective, false);
    assert.equal(revoke.data.effectivenessReason, "head_is_revoke");

    const revokeAuditRows = await query(
      `SELECT operation FROM kai.upload_lifecycle_audit WHERE metadata->>'decision_id' = $1`,
      [revoke.data.decisionId],
    );
    assert.equal(revokeAuditRows.length, 1);
    assert.equal(revokeAuditRows[0].operation, "human_authority_decision_recorded");

    const afterRevokeEffectiveness = await humanAuthorityDecisionRepository.evaluateEffectiveness({
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      decisionType: "export_authority_granted",
    });
    assert.equal(afterRevokeEffectiveness.data.effective, false);
    assert.equal(afterRevokeEffectiveness.data.headDecisionId, revoke.data.decisionId);
  });

  test("P3-17 real Postgres: an unauthorized-role write is blocked before any row is inserted", async () => {
    const seed = await seedExportCandidate();

    const result = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      decisionType: "export_authority_granted",
      decisionAction: "grant",
      requestedAudience: "internal",
      actorContext: gkReviewer,
      now: NOW,
    }, { metadataOnlyAudit: auditRecorder() });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const decisionRows = await query(
      `SELECT decision_id FROM kai.human_authority_decisions WHERE export_candidate_id = $1::uuid`,
      [seed.exportCandidateId],
    );
    assert.equal(decisionRows.length, 0);

    const auditRows = await query(
      `SELECT organization_id FROM kai.upload_lifecycle_audit WHERE operation = 'human_authority_decision_recorded' AND metadata->>'export_candidate_id' = $1`,
      [seed.exportCandidateId],
    );
    assert.equal(auditRows.length, 0);
  });
}
