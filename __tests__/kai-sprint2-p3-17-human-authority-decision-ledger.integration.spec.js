import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-17 integration suite refused a non-loopback KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

test("P3-17 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-17 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresHumanAuthorityDecisionRepository\.js|postgresExportCandidateRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-17 human-authority-decision-ledger integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP317IntegrationSuite();
}

async function runP317IntegrationSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresExportCandidateRepository,
  } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const {
    createPostgresHumanAuthorityDecisionRepository,
    __humanAuthorityDecisionRepositoryTestables,
  } = await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-07T10:00:00.000Z";
  const LATER = "2026-08-07T10:05:00.000Z";
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
  const gkAdmin = actorContext("gk_admin", "90000000-0000-4000-8000-000000000005");
  const gkReviewer = actorContext("gk_reviewer", "90000000-0000-4000-8000-000000000004");

  const exportCandidateRepository = createPostgresExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const humanAuthorityDecisionRepository = createPostgresHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });

  let seedCounter = 0;

  async function seedExportCandidate({ audience = "internal" } = {}) {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const claimA = `20000000-0000-4000-8000-0000000a0${n}`;
    const evidenceA = `20000000-0000-4000-8000-0000000e0${n}`;

    const templateRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const templateEvidenceId = templateRows[0].evidence_item_id;
    const fingerprint = n.padStart(2, "0").repeat(32).slice(0, 64);

    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic P3-17 human-authority-decision-ledger evidence item.', $3, created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceA, templateEvidenceId, fingerprint],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','Synthetic P3-17 human-authority-decision-ledger claim.',repeat($4,64),'system')`,
      [claimA, ORG, evidenceA, n.slice(0, 1)],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimA, evidenceA],
    );

    const runRows = await query(
      `INSERT INTO kai.generation_runs (organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type, created_at)
       VALUES ($1::uuid,$2,repeat('7',64),'evidence_summary',$3,'system',$4::timestamptz)
       RETURNING generation_run_id::text AS generation_run_id`,
      [ORG, `p3-17-seed-${n}`, audience, NOW],
    );
    const runId = runRows[0].generation_run_id;
    const draftRows = await query(
      `INSERT INTO kai.generated_content_drafts (generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type, created_at)
       VALUES ($1::uuid,$2::uuid,'evidence_summary',$3,'draft','needs_gk_review','[]'::jsonb,'system',$4::timestamptz)
       RETURNING generated_content_draft_id::text AS generated_content_draft_id`,
      [runId, ORG, audience, NOW],
    );
    const draftId = draftRows[0].generated_content_draft_id;
    const blockRows = await query(
      `INSERT INTO kai.generated_content_blocks (generated_content_draft_id, organization_id, ordinal, text, created_at)
       VALUES ($1::uuid,$2::uuid,1,'Synthetic P3-17 block text.',$3::timestamptz)
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
      { organizationId: ORG, generatedContentDraftId: draftId, entries: [{ claimId: claimA, evidenceItemId: evidenceA, limitationCodes: [] }], actorContext: gkReviewer, now: NOW },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(snapshot.ok, true);

    const candidate = await exportCandidateRepository.createExportCandidate(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext: gkAdmin, now: NOW },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(candidate.ok, true);

    return { draftId, claimA, evidenceA, exportCandidateId: candidate.data.exportCandidateId, audience };
  }

  async function insertDecision({ organizationId = ORG, exportCandidateId, decisionType, decisionAction, decidedBy, decidedByRole, supersedesDecisionId = null, createdAt = NOW }) {
    return query(
      `INSERT INTO kai.human_authority_decisions (
         organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id, created_by_type, created_at
       )
       VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7::uuid,'human',$8::timestamptz)
       RETURNING decision_id::text AS decision_id`,
      [organizationId, exportCandidateId, decisionType, decisionAction, decidedBy, decidedByRole, supersedesDecisionId, createdAt],
    );
  }

  test.after(async () => {
    await pool.end();
  });

  test("P3-17 exact decision-type/action vocabulary is enforced at the database boundary", async () => {
    const seed = await seedExportCandidate();
    await assert.rejects(() => query(
      `INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
       VALUES ($1::uuid,$2::uuid,'final_gate','grant',$1::uuid,'gk_admin','human')`,
      [ORG, seed.exportCandidateId],
    ));
    await assert.rejects(() => query(
      `INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
       VALUES ($1::uuid,$2::uuid,'export_authority_granted','approve',$1::uuid,'gk_admin','human')`,
      [ORG, seed.exportCandidateId],
    ));
  });

  test("P3-17 decision-type/role compatibility: client_reviewed requires client_reviewer, all other types require gk_admin", async () => {
    const seed = await seedExportCandidate();
    await assert.rejects(() => query(
      `INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
       VALUES ($1::uuid,$2::uuid,'client_reviewed','grant',$1::uuid,'gk_admin','human')`,
      [ORG, seed.exportCandidateId],
    ));
    await assert.rejects(() => query(
      `INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
       VALUES ($1::uuid,$2::uuid,'export_authority_granted','grant',$1::uuid,'client_reviewer','human')`,
      [ORG, seed.exportCandidateId],
    ));
    const ok = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "client_reviewed", decisionAction: "grant", decidedBy: ORG, decidedByRole: "client_reviewer" });
    assert.equal(ok.length, 1);
  });

  test("P3-17 audience compatibility: funder_ready binds only a funder-audience candidate, public_ready binds only a public-audience candidate", async () => {
    const internalSeed = await seedExportCandidate({ audience: "internal" });
    await assert.rejects(() => insertDecision({ exportCandidateId: internalSeed.exportCandidateId, decisionType: "funder_ready", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" }));
    await assert.rejects(() => insertDecision({ exportCandidateId: internalSeed.exportCandidateId, decisionType: "public_ready", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" }));

    const funderSeed = await seedExportCandidate({ audience: "funder" });
    const funderOk = await insertDecision({ exportCandidateId: funderSeed.exportCandidateId, decisionType: "funder_ready", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" });
    assert.equal(funderOk.length, 1);
    await assert.rejects(() => insertDecision({ exportCandidateId: funderSeed.exportCandidateId, decisionType: "public_ready", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" }));

    const publicSeed = await seedExportCandidate({ audience: "public" });
    const publicOk = await insertDecision({ exportCandidateId: publicSeed.exportCandidateId, decisionType: "public_ready", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" });
    assert.equal(publicOk.length, 1);

    // client_reviewed / export_authority_granted remain bound to the candidate's actual audience without restriction.
    const clientReviewedOnInternal = await insertDecision({ exportCandidateId: internalSeed.exportCandidateId, decisionType: "client_reviewed", decisionAction: "grant", decidedBy: ORG, decidedByRole: "client_reviewer" });
    assert.equal(clientReviewedOnInternal.length, 1);
    const authorityOnFunder = await insertDecision({ exportCandidateId: funderSeed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" });
    assert.equal(authorityOnFunder.length, 1);
  });

  test("P3-17 exact candidate binding: a decision cannot reference a nonexistent export candidate", async () => {
    await assert.rejects(() => insertDecision({ exportCandidateId: "00000000-0000-4000-8000-000000009999", decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" }));
  });

  test("P3-17 the first event in a lineage must be a grant: a root revoke is rejected", async () => {
    const seed = await seedExportCandidate();
    await assert.rejects(() => insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin" }));
  });

  test("P3-17 append-only grant/revoke lineage: a revoke is recorded as a successor row, never rewriting the grant", async () => {
    const seed = await seedExportCandidate();
    const [grant] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: NOW });
    const before = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);

    const [revoke] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: grant.decision_id, createdAt: LATER });

    const after = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);
    assert.deepEqual(before[0], after[0]);

    const revokeRow = await query(`SELECT decision_action, supersedes_decision_id::text AS supersedes_decision_id FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [revoke.decision_id]);
    assert.equal(revokeRow[0].decision_action, "revoke");
    assert.equal(revokeRow[0].supersedes_decision_id, grant.decision_id);

    await assert.rejects(() => query(`UPDATE kai.human_authority_decisions SET decision_action = 'grant' WHERE decision_id = $1::uuid`, [grant.decision_id]));
    await assert.rejects(() => query(`DELETE FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]));
  });

  test("P3-17 a re-grant after revoke is another successor event, and the current head derivation follows the chain", async () => {
    const seed = await seedExportCandidate();
    const [grant1] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: NOW });
    const [revoke] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: grant1.decision_id, createdAt: LATER });

    const beforeRegrant = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(beforeRegrant.data.effective, false);
    assert.equal(beforeRegrant.data.reason, "head_is_revoke");
    assert.equal(beforeRegrant.data.headDecisionId, revoke.decision_id);

    const [regrant] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: revoke.decision_id, createdAt: "2026-08-07T10:10:00.000Z" });

    const afterRegrant = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(afterRegrant.data.effective, true);
    assert.equal(afterRegrant.data.headDecisionId, regrant.decision_id);
  });

  test("P3-17 no lineage forks or multiple roots: a second root and a second successor of the same predecessor are both rejected", async () => {
    const seed = await seedExportCandidate();
    const [root] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: NOW });

    await assert.rejects(() => insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: LATER }));

    await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: root.decision_id, createdAt: LATER });
    await assert.rejects(() => insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: root.decision_id, createdAt: LATER }));

    const headCount = await query(
      `SELECT count(*)::int AS count FROM kai.human_authority_decisions d
        WHERE d.export_candidate_id = $1::uuid AND d.decision_type = 'export_authority_granted'
          AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [seed.exportCandidateId],
    );
    assert.equal(headCount[0].count, 1);
  });

  test("P3-17 predecessor lineage cannot cross export candidate or decision type", async () => {
    const seedA = await seedExportCandidate();
    const seedB = await seedExportCandidate();
    const [grantA] = await insertDecision({ exportCandidateId: seedA.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" });

    await assert.rejects(() => insertDecision({ exportCandidateId: seedB.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "gk_admin", supersedesDecisionId: grantA.decision_id }));

    const otherType = await insertDecision({ exportCandidateId: seedA.exportCandidateId, decisionType: "client_reviewed", decisionAction: "grant", decidedBy: ORG, decidedByRole: "client_reviewer" });
    await assert.rejects(() => insertDecision({ exportCandidateId: seedA.exportCandidateId, decisionType: "client_reviewed", decisionAction: "revoke", decidedBy: ORG, decidedByRole: "client_reviewer", supersedesDecisionId: grantA.decision_id }));
    assert.equal(otherType.length, 1);
  });

  test("P3-17 current-head derivation: no_decision when nothing has been recorded, effective when the head is a fresh grant", async () => {
    const seed = await seedExportCandidate();
    const before = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(before.data.effective, false);
    assert.equal(before.data.reason, "no_decision");

    await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin" });
    const after = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(after.ok, true);
    assert.equal(after.data.effective, true);
  });

  test("P3-17 a stale P3-16 export candidate makes an old grant ineffective without mutating the ledger row", async () => {
    const seed = await seedExportCandidate();
    const [grant] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: NOW });

    const stillEffective = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(stillEffective.data.effective, true);

    // Supersede the bound limitation snapshot without touching the ledger at all.
    await exportCandidateRepository.confirmLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: seed.draftId, entries: [{ claimId: seed.claimA, evidenceItemId: seed.evidenceA, limitationCodes: ["small_sample_size"] }], actorContext: gkReviewer, now: LATER },
      { metadataOnlyAudit: auditRecorder() },
    );

    const beforeRow = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);
    const nowStale = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(nowStale.ok, true);
    assert.equal(nowStale.data.effective, false);
    assert.equal(nowStale.data.reason, "limitation_snapshot_superseded");
    assert.equal(nowStale.data.headDecisionId, grant.decision_id);

    const afterRow = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);
    assert.deepEqual(beforeRow[0], afterRow[0]);
  });

  test("P3-17 a P3-16 fingerprint-bound graph drift (generated-content block text changed) makes an old grant ineffective while the limitation snapshot and the ledger row are both untouched", async () => {
    const seed = await seedExportCandidate();
    const [grant] = await insertDecision({ exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted", decisionAction: "grant", decidedBy: ORG, decidedByRole: "gk_admin", createdAt: NOW });

    const stillEffective = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(stillEffective.ok, true);
    assert.equal(stillEffective.data.effective, true);

    const candidateBefore = await query(
      `SELECT limitation_snapshot_id::text AS limitation_snapshot_id, canonical_fingerprint FROM kai.export_candidates WHERE export_candidate_id = $1::uuid`,
      [seed.exportCandidateId],
    );

    // Drift one P3-16 fingerprint-bound graph fact - the generated-content
    // block text - without touching the limitation snapshot at all.
    await query(
      `UPDATE kai.generated_content_blocks SET text = 'Drifted P3-17 fingerprint-proof block text.'
        WHERE generated_content_draft_id = $1::uuid`,
      [seed.draftId],
    );

    const candidateAfter = await query(
      `SELECT limitation_snapshot_id::text AS limitation_snapshot_id, canonical_fingerprint FROM kai.export_candidates WHERE export_candidate_id = $1::uuid`,
      [seed.exportCandidateId],
    );
    // The limitation snapshot binding is unchanged and unsuperseded, and the
    // stored export-candidate fingerprint is unchanged - only the current
    // authoritative graph moved out from under it.
    assert.deepEqual(candidateBefore, candidateAfter);

    const beforeRow = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);
    const nowStale = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(nowStale.ok, true);
    assert.equal(nowStale.data.effective, false);
    assert.equal(nowStale.data.reason, "fingerprint_mismatch");
    assert.equal(nowStale.data.headDecisionId, grant.decision_id);

    const afterRow = await query(`SELECT decision_action, decided_by_role, supersedes_decision_id, created_at FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`, [grant.decision_id]);
    assert.deepEqual(beforeRow[0], afterRow[0]);
  });

  test("P3-17 queue resolution, role possession, and audit history create no authority: effectiveness is false until an explicit decision row is inserted", async () => {
    const seed = await seedExportCandidate();
    const auditRows = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE metadata->>'generated_content_draft_id' = $1`, [seed.draftId]);
    assert.ok(auditRows[0].count >= 2);

    const genQueue = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'generated_content_review' AND target_object_id = $1::uuid`, [seed.draftId]);
    assert.equal(genQueue[0].queue_status, "resolved");

    const effectiveness = await humanAuthorityDecisionRepository.evaluateEffectiveness({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted" });
    assert.equal(effectiveness.data.effective, false);
    assert.equal(effectiveness.data.reason, "no_decision");
  });

  test("P3-17 creates no finalGate/VAL-EXP/manifest/export-artifact state anywhere in kai schema", async () => {
    const columnRows = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kai'
          AND column_name IN ('final_export_gate', 'final_gate', 'export_eligible', 'affirmative_human_export_authority', 'manifest', 'exported_at')`,
    );
    assert.equal(columnRows.length, 0);
    const tableRows = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'kai' AND table_name IN ('export_manifests', 'export_events', 'export_artifacts')`,
    );
    assert.equal(tableRows.length, 0);
  });

  test("P3-17 ambient DATABASE_URL is ignored by this suite (only the runner-owned pool is used)", () => {
    assert.notEqual(process.env.DATABASE_URL, RUNNER_OWNED_DATABASE_URL);
  });
}
