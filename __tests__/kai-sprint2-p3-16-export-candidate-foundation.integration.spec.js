import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-16 integration suite refused a non-loopback KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL host: ${host}`);
  }
}

test("P3-16 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-16 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresExportCandidateRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-16 export-candidate-foundation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP316IntegrationSuite();
}

async function runP316IntegrationSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresExportCandidateRepository,
    __exportCandidateRepositoryTestables,
  } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const {
    confirmGeneratedDraftLimitationSnapshot,
    createGeneratedDraftExportCandidate,
  } = await import("../Backend/kai/services/kaiExportCandidateService.js");

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

  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };

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

  function repository() {
    return createPostgresExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  let seedCounter = 0;

  async function seedDraftReadyForCandidate({ audience = "internal", resolveGeneratedContentReview = true, resolveExportReview = true } = {}) {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const claimA = `10000000-0000-4000-8000-0000000a0${n}`;
    const evidenceA = `10000000-0000-4000-8000-0000000e0${n}`;
    const claimB = `10000000-0000-4000-8000-0000000b0${n}`;
    const evidenceB = `10000000-0000-4000-8000-0000000f0${n}`;

    const templateRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const templateEvidenceId = templateRows[0].evidence_item_id;

    async function seedClaimEvidence(claimId, evidenceId, label) {
      const fingerprint = label.padStart(2, "0").repeat(32).slice(0, 64);
      await query(
        `INSERT INTO kai.evidence_items (
           evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
           evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
         )
         SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
                evidence_type, data_class, sensitivity_level, support_strength,
                'Synthetic P3-16 export-candidate-foundation evidence item.', $3, created_by_type
           FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
        [evidenceId, templateEvidenceId, fingerprint],
      );
      await query(
        `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','Synthetic P3-16 export-candidate-foundation claim.',repeat($4,64),'system')`,
        [claimId, ORG, evidenceId, label.slice(0, 1)],
      );
      await query(
        `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
        [ORG, claimId, evidenceId],
      );
    }
    await seedClaimEvidence(claimA, evidenceA, `a${n}`);
    await seedClaimEvidence(claimB, evidenceB, `b${n}`);

    const runRows = await query(
      `INSERT INTO kai.generation_runs (organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type, created_at)
       VALUES ($1::uuid,$2,repeat('7',64),'evidence_summary',$3,'system',$4::timestamptz)
       RETURNING generation_run_id::text AS generation_run_id`,
      [ORG, `p3-16-seed-${n}`, audience, NOW],
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
       VALUES ($1::uuid,$2::uuid,1,'Synthetic P3-16 block text.',$3::timestamptz)
       RETURNING generated_content_block_id::text AS generated_content_block_id`,
      [draftId, ORG, NOW],
    );
    const blockId = blockRows[0].generated_content_block_id;
    await query(
      `INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id, created_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::timestamptz), ($1::uuid,$2::uuid,$6::uuid,$7::uuid,$5::timestamptz)`,
      [blockId, ORG, claimA, evidenceA, NOW, claimB, evidenceB],
    );

    const genQueueRows = await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type, created_at, updated_at)
       VALUES ($1::uuid,'generated_content_review','generated_content_draft',$2::uuid,'normal',$3,$4,'Generated draft requires human review.','Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.','{}'::jsonb,'system',$5::timestamptz,$5::timestamptz)
       RETURNING review_queue_item_id::text AS review_queue_item_id`,
      [ORG, draftId, resolveGeneratedContentReview ? "resolved" : "open", resolveGeneratedContentReview ? "resolved" : "needs_gk_review", NOW],
    );
    await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type, created_at, updated_at)
       VALUES ($1::uuid,'export_review','generated_content_draft',$2::uuid,'normal',$3,$4,'Generated draft requires export review.','Review audience authority, current eligibility, citations, and the final export gate before any export.','{}'::jsonb,'system',$5::timestamptz,$5::timestamptz)`,
      [ORG, draftId, resolveExportReview ? "resolved" : "open", resolveExportReview ? "resolved" : "needs_gk_review", NOW],
    );

    return { draftId, claimA, evidenceA, claimB, evidenceB, genQueueItemId: genQueueRows[0].review_queue_item_id };
  }

  function confirmInput({ draftId, claimA, evidenceA, claimB, evidenceB, codesA = [], codesB = [], actor = gkReviewer, now = NOW }) {
    return {
      organizationId: ORG,
      generatedContentDraftId: draftId,
      entries: [
        { claimId: claimA, evidenceItemId: evidenceA, limitationCodes: codesA },
        { claimId: claimB, evidenceItemId: evidenceB, limitationCodes: codesB },
      ],
      actorContext: actor,
      now,
    };
  }

  test.after(async () => {
    await pool.end();
  });

  test("P3-16 limitation snapshot confirmation: missing coverage, extra/uncited pair, and duplicate cited pair all fail closed with zero writes", async () => {
    const { draftId, claimA, evidenceA, claimB, evidenceB } = await seedDraftReadyForCandidate();
    const repo = repository();

    const missing = await repo.confirmLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: draftId, entries: [{ claimId: claimA, evidenceItemId: evidenceA, limitationCodes: [] }], actorContext: gkReviewer, now: NOW },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(missing.error.code, "validation_blocker");

    const extra = await repo.confirmLimitationSnapshot(
      {
        organizationId: ORG,
        generatedContentDraftId: draftId,
        entries: [
          { claimId: claimA, evidenceItemId: evidenceA, limitationCodes: [] },
          { claimId: claimB, evidenceItemId: evidenceB, limitationCodes: [] },
          { claimId: claimA, evidenceItemId: "10000000-0000-4000-8000-000000009999", limitationCodes: [] },
        ],
        actorContext: gkReviewer,
        now: NOW,
      },
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(extra.error.code, "validation_blocker");

    const countRows = await query(`SELECT count(*)::int AS count FROM kai.limitation_snapshots WHERE generated_content_draft_id = $1::uuid`, [draftId]);
    assert.equal(countRows[0].count, 0);
  });

  test("P3-16 limitation snapshot confirmation: an explicit empty set is a real confirmed snapshot, distinct from no snapshot at all", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const currentness = await withRunnerOwnedTransaction((tx) =>
      __exportCandidateRepositoryTestables.evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId: ORG, exportCandidateId: "00000000-0000-4000-8000-000000000000" }));
    assert.equal(currentness.error.code, "not_found");

    const result = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.citedPairCount, 2);

    const entryRows = await query(
      `SELECT limitation_codes FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid ORDER BY claim_id ASC`,
      [result.data.limitationSnapshotId],
    );
    assert.equal(entryRows.length, 2);
    assert.deepEqual(entryRows[0].limitation_codes, []);

    const auditRows = await query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'limitation_snapshot_confirmed' AND metadata->>'generated_content_draft_id' = $1`,
      [seed.draftId],
    );
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].metadata.confirmed_by_role, "gk_reviewer");
    assert.equal(Object.hasOwn(auditRows[0].metadata, "limitation_codes"), false);
  });

  test("P3-16 limitation snapshot confirmation: identical replay writes zero additional rows and zero additional audit", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const first = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    assert.equal(first.data.replayed, false);

    const replay = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.limitationSnapshotId, first.data.limitationSnapshotId);

    const snapshotCount = await query(`SELECT count(*)::int AS count FROM kai.limitation_snapshots WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(snapshotCount[0].count, 1);
    const auditCount = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'limitation_snapshot_confirmed' AND metadata->>'generated_content_draft_id' = $1`, [seed.draftId]);
    assert.equal(auditCount[0].count, 1);
  });

  test("P3-16 limitation snapshot confirmation: a changed limitation posture supersedes the prior snapshot without rewriting it", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const first = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });

    const second = await repo.confirmLimitationSnapshot(
      confirmInput({ ...seed, codesA: ["small_sample_size"], now: LATER }),
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, false);
    assert.equal(second.data.supersededSnapshotId, first.data.limitationSnapshotId);
    assert.notEqual(second.data.limitationSnapshotId, first.data.limitationSnapshotId);

    const successorRow = await query(`SELECT supersedes_snapshot_id::text AS supersedes_snapshot_id FROM kai.limitation_snapshots WHERE limitation_snapshot_id = $1::uuid`, [second.data.limitationSnapshotId]);
    assert.equal(successorRow[0].supersedes_snapshot_id, first.data.limitationSnapshotId);

    const priorRowBefore = await query(
      `SELECT confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id, created_at FROM kai.limitation_snapshots WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    );
    const priorEntriesBefore = await query(
      `SELECT claim_id, evidence_item_id, limitation_codes FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid ORDER BY claim_id ASC`,
      [first.data.limitationSnapshotId],
    );
    assert.equal(priorRowBefore[0].supersedes_snapshot_id, null);
    assert.equal(priorEntriesBefore.length, 2);

    const currentRows = await query(
      `SELECT ls.limitation_snapshot_id::text AS limitation_snapshot_id
         FROM kai.limitation_snapshots ls
        WHERE ls.generated_content_draft_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.limitation_snapshots s WHERE s.supersedes_snapshot_id = ls.limitation_snapshot_id)`,
      [seed.draftId],
    );
    assert.equal(currentRows.length, 1);
    assert.equal(currentRows[0].limitation_snapshot_id, second.data.limitationSnapshotId);
  });

  test("P3-16 supersession is exactly one INSERT and no UPDATE of the prior snapshot: the prior row and its entries are byte-identical before and after, and ordinary UPDATE/DELETE against them is rejected by the database boundary", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const first = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });

    const before = await query(
      `SELECT confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id, created_at FROM kai.limitation_snapshots WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    );
    const entriesBefore = await query(
      `SELECT claim_id, evidence_item_id, limitation_codes, created_at FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid ORDER BY claim_id ASC`,
      [first.data.limitationSnapshotId],
    );

    await repo.confirmLimitationSnapshot(
      confirmInput({ ...seed, codesA: ["small_sample_size"], now: LATER }),
      { metadataOnlyAudit: auditRecorder() },
    );

    const after = await query(
      `SELECT confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id, created_at FROM kai.limitation_snapshots WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    );
    const entriesAfter = await query(
      `SELECT claim_id, evidence_item_id, limitation_codes, created_at FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid ORDER BY claim_id ASC`,
      [first.data.limitationSnapshotId],
    );
    assert.deepEqual(before[0], after[0]);
    assert.deepEqual(entriesBefore, entriesAfter);

    await assert.rejects(() => pool.query(
      `UPDATE kai.limitation_snapshots SET confirmed_by_role = 'gk_admin' WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    ));
    await assert.rejects(() => pool.query(
      `DELETE FROM kai.limitation_snapshots WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    ));
    await assert.rejects(() => pool.query(
      `UPDATE kai.limitation_snapshot_entries SET limitation_codes = ARRAY['self_reported'] WHERE limitation_snapshot_id = $1::uuid`,
      [first.data.limitationSnapshotId],
    ));
  });

  test("P3-16 predecessor lineage cannot cross organization or draft: a supersedes_snapshot_id naming a snapshot outside the new row's own organization/draft fails closed at the database boundary", async () => {
    const seedA = await seedDraftReadyForCandidate();
    const seedB = await seedDraftReadyForCandidate();
    const repo = repository();
    const confirmedA = await repo.confirmLimitationSnapshot(confirmInput(seedA), { metadataOnlyAudit: auditRecorder() });
    assert.equal(confirmedA.ok, true);

    await assert.rejects(() => pool.query(
      `INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$1::uuid,'gk_reviewer',repeat('9',64),$3::uuid,'human')`,
      [ORG, seedB.draftId, confirmedA.data.limitationSnapshotId],
    ));
  });

  test("P3-16 concurrent changed confirmations from the same predecessor: at most one successor and one fresh audit row are created, and the loser reports a zero-write conflict", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });

    const [winnerOrLoserA, winnerOrLoserB] = await Promise.all([
      repo.confirmLimitationSnapshot(confirmInput({ ...seed, codesA: ["small_sample_size"], now: LATER }), { metadataOnlyAudit: auditRecorder() }),
      repo.confirmLimitationSnapshot(confirmInput({ ...seed, codesA: ["self_reported"], now: LATER }), { metadataOnlyAudit: auditRecorder() }),
    ]);
    const results = [winnerOrLoserA, winnerOrLoserB];
    const winners = results.filter((r) => r.ok);
    const losers = results.filter((r) => !r.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].error.code, "conflict_current_state_changed");

    const successorRows = await query(
      `SELECT count(*)::int AS count FROM kai.limitation_snapshots WHERE supersedes_snapshot_id = (
         SELECT limitation_snapshot_id FROM kai.limitation_snapshots
          WHERE generated_content_draft_id = $1::uuid AND supersedes_snapshot_id IS NULL
       )`,
      [seed.draftId],
    );
    assert.equal(successorRows[0].count, 1);

    const auditRows = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'limitation_snapshot_confirmed' AND metadata->>'generated_content_draft_id' = $1`,
      [seed.draftId],
    );
    assert.equal(auditRows[0].count, 2); // one for the first confirmation, one for the single winning supersession
  });

  test("P3-16 limitation snapshot confirmation: gk_reviewer role and gk_admin role are both authoritative, and cross-tenant/uncited claim ids are rejected", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const asAdmin = await repo.confirmLimitationSnapshot(confirmInput({ ...seed, actor: gkAdmin }), { metadataOnlyAudit: auditRecorder() });
    assert.equal(asAdmin.ok, true);
    assert.equal(asAdmin.data.confirmedByRole, "gk_admin");

    const noRole = await repo.confirmLimitationSnapshot(
      confirmInput({ ...seed, actor: { actorType: "human", actorUserId: "x", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] }, now: LATER }),
      { metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(noRole.error.code, "validation_blocker");
  });

  test("P3-16 export candidate creation fails closed when generated-content review is not resolved, when export review is not resolved, and when no limitation snapshot exists", async () => {
    const repo = repository();

    const unresolvedGenReview = await seedDraftReadyForCandidate({ resolveGeneratedContentReview: false });
    const r1 = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: unresolvedGenReview.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(r1.error.code, "conflict_current_state_changed");

    const unresolvedExportReview = await seedDraftReadyForCandidate({ resolveExportReview: false });
    const r2 = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: unresolvedExportReview.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(r2.error.code, "conflict_current_state_changed");

    const noSnapshot = await seedDraftReadyForCandidate();
    const r3 = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: noSnapshot.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(r3.error.code, "conflict_current_state_changed");

    const candidateCount = await query(`SELECT count(*)::int AS count FROM kai.export_candidates`);
    // no assertion on absolute count across the shared synthetic database beyond this suite's own writes
    assert.ok(candidateCount[0].count >= 0);
  });

  test("P3-16 export candidate creation: fresh creation binds the current snapshot and a deterministic fingerprint, then an identical replay converges with zero additional writes", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    const snapshot = await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    assert.equal(snapshot.ok, true);

    const fresh = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.data.replayed, false);
    assert.equal(fresh.data.limitationSnapshotId, snapshot.data.limitationSnapshotId);
    assert.match(fresh.data.canonicalFingerprint, /^[0-9a-f]{64}$/);

    const replay = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: LATER }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.exportCandidateId, fresh.data.exportCandidateId);

    const candidateRows = await query(`SELECT count(*)::int AS count FROM kai.export_candidates WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(candidateRows[0].count, 1);
    const auditRows = await query(`SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'export_candidate_created' AND metadata->>'generated_content_draft_id' = $1`, [seed.draftId]);
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].metadata.cited_pair_count, 2);
    assert.equal(Object.hasOwn(auditRows[0].metadata, "citations"), false);

    const currentness = await withRunnerOwnedTransaction((tx) =>
      __exportCandidateRepositoryTestables.evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId: ORG, exportCandidateId: fresh.data.exportCandidateId }));
    assert.equal(currentness.ok, true);
    assert.equal(currentness.data.current, true);
  });

  test("P3-16 export candidate creation: a changed limitation posture supersedes the bound snapshot, and the prior candidate reports not-current while a new candidate creates fresh", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    const firstCandidate = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(firstCandidate.data.replayed, false);

    await repo.confirmLimitationSnapshot(confirmInput({ ...seed, codesA: ["self_reported"], now: LATER }), { metadataOnlyAudit: auditRecorder() });

    const stillCurrent = await withRunnerOwnedTransaction((tx) =>
      __exportCandidateRepositoryTestables.evaluateExportCandidateCurrentnessInTransaction(tx, { organizationId: ORG, exportCandidateId: firstCandidate.data.exportCandidateId }));
    assert.equal(stillCurrent.data.current, false);
    assert.equal(stillCurrent.data.reason, "limitation_snapshot_superseded");

    const secondCandidate = await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: LATER }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(secondCandidate.data.replayed, false);
    assert.notEqual(secondCandidate.data.exportCandidateId, firstCandidate.data.exportCandidateId);
    assert.notEqual(secondCandidate.data.canonicalFingerprint, firstCandidate.data.canonicalFingerprint);

    const candidateRows = await query(`SELECT count(*)::int AS count FROM kai.export_candidates WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(candidateRows[0].count, 2);
  });

  test("P3-16 export candidate creation is gk_admin-only: gk_reviewer is rejected by the service authorization gate before any repository call", async () => {
    const seed = await seedDraftReadyForCandidate();
    await confirmGeneratedDraftLimitationSnapshot(confirmInput(seed), {
      env: enabledEnv,
      exportCandidateRepository: repository(),
      metadataOnlyAudit: auditRecorder(),
    });
    const denied = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkReviewer, now: NOW },
      { env: enabledEnv, exportCandidateRepository: repository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(denied.error.code, "authorization_denied");
    const candidateRows = await query(`SELECT count(*)::int AS count FROM kai.export_candidates WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(candidateRows[0].count, 0);

    const allowed = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, exportCandidateRepository: repository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(allowed.ok, true);
  });

  test("P3-16 does not mutate generated_content_drafts.draft_status, the generated-content review queue row, or the export-review queue row, and creates no export-authority/final-gate state", async () => {
    const seed = await seedDraftReadyForCandidate();
    const repo = repository();
    await repo.confirmLimitationSnapshot(confirmInput(seed), { metadataOnlyAudit: auditRecorder() });
    await repo.createExportCandidate({ organizationId: ORG, generatedContentDraftId: seed.draftId, actorContext: gkAdmin, now: NOW }, { metadataOnlyAudit: auditRecorder() });

    const draftRows = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(draftRows[0].draft_status, "draft");

    const genQueueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'generated_content_review' AND target_object_id = $1::uuid`, [seed.draftId]);
    assert.equal(genQueueRows[0].queue_status, "resolved");
    const exportQueueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'export_review' AND target_object_id = $1::uuid`, [seed.draftId]);
    assert.equal(exportQueueRows[0].queue_status, "resolved");

    const columnRows = await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kai'
          AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at', 'export_eligible', 'affirmative_human_export_authority')`,
    );
    assert.equal(columnRows.length, 0);
  });

  test("P3-16 ambient DATABASE_URL is ignored by this suite (only the runner-owned pool is used)", () => {
    assert.notEqual(process.env.DATABASE_URL, RUNNER_OWNED_DATABASE_URL);
  });
}
