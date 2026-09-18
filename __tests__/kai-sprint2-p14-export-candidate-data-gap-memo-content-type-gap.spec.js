import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmGeneratedDraftLimitationSnapshot,
  confirmGeneratedDraftLimitationSnapshotFromCitedPairs,
  createGeneratedDraftExportCandidate,
} from "../Backend/kai/services/kaiExportCandidateService.js";
import {
  createPostgresExportCandidateRepository,
  evaluateExportCandidateCurrentnessInTransaction,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";
import { EXPORT_CANDIDATE_CONTENT_TYPES } from "../Backend/kai/dictionary/exportCandidateContract.js";

// Phase-14 repair: `createExportCandidate` previously gated the generated-
// content draft's content_type against the single hardcoded value
// "evidence_summary" (see the prior version of this spec, closed by
// 65806c3). That gate is now the generic EXPORT_CANDIDATE_CONTENT_TYPES
// allowlist shared with generation/generated-content-review/export-review,
// and this spec proves the full repaired forward path for `data_gap_memo`
// using the SAME unmodified fingerprint/currentness/audit/authority logic
// evidence_summary already relied on - no second workflow, no new
// limitation-snapshot semantics.

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000802";
const BLOCK = "00000000-0000-4000-8000-000000000810";
const CLAIM = "00000000-0000-4000-8000-000000000901";
const EVIDENCE = "00000000-0000-4000-8000-000000000902";
const SOURCE = "00000000-0000-4000-8000-000000000903";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000904";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000905";
const INTAKE_SOURCE_CANDIDATE = "00000000-0000-4000-8000-000000000906";
const INTAKE_FILE = "00000000-0000-4000-8000-000000000907";
const NOW = "2026-08-07T10:00:00.000Z";
const LATER = "2026-08-07T11:00:00.000Z";

const enabledEnv = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_GENERATION_ENABLED: "true",
  KAI_PUBLIC_EXPORT_ENABLED: "true",
});

const gkAdminActorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
  ],
});

function auditRecorder() {
  return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
}

// Minimal in-memory postgres fake covering exactly the query/insert shapes
// postgresExportCandidateRepository.js issues, driven by an in-memory state
// object. Mutations are appended to the matching in-memory table; every
// currentness/fingerprint/coverage decision is still made by the real,
// unmodified repository code running against this fake data.
function makeState({ contentType = "data_gap_memo", reviewResolved = true, citations = null } = {}) {
  return {
    draft: {
      generated_content_draft_id: DRAFT,
      organization_id: ORG,
      content_type: contentType,
      requested_audience: "internal",
      draft_status: "generated",
    },
    genContentReviewQueue: reviewResolved
      ? { queue_status: "resolved", review_status: "resolved" }
      : { queue_status: "in_progress", review_status: "needs_gk_review" },
    exportReviewQueue: reviewResolved
      ? { queue_status: "resolved", review_status: "resolved" }
      : { queue_status: "in_progress", review_status: "needs_gk_review" },
    blocks: [{ generated_content_block_id: BLOCK, ordinal: 1, text: "KAI's data gap memo finding." }],
    citations: citations ?? [{ generated_content_block_id: BLOCK, claim_id: CLAIM, evidence_item_id: EVIDENCE, source_id: SOURCE, source_version_id: SOURCE_VERSION }],
    snapshots: [],
    snapshotEntries: [],
    candidates: [],
    auditRows: [],
  };
}

function makeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();

      if (s.startsWith("INSERT INTO kai.limitation_snapshots")) {
        const [id, organizationId, generatedContentDraftId, confirmedBy, confirmedByRole, entriesFingerprint, supersedesSnapshotId, now] = params;
        state.snapshots.push({
          limitation_snapshot_id: id,
          organization_id: organizationId,
          generated_content_draft_id: generatedContentDraftId,
          confirmed_by: confirmedBy,
          confirmed_by_role: confirmedByRole,
          entries_fingerprint: entriesFingerprint,
          supersedes_snapshot_id: supersedesSnapshotId,
          created_at: now,
        });
        return { rows: [] };
      }
      if (s.startsWith("INSERT INTO kai.limitation_snapshot_entries")) {
        const [limitationSnapshotId, organizationId, claimId, evidenceItemId, limitationCodes] = params;
        state.snapshotEntries.push({
          limitation_snapshot_id: limitationSnapshotId,
          organization_id: organizationId,
          claim_id: claimId,
          evidence_item_id: evidenceItemId,
          limitation_codes: limitationCodes,
        });
        return { rows: [] };
      }
      if (s.startsWith("INSERT INTO kai.export_candidates")) {
        const [candidateId, organizationId, generatedContentDraftId, contentType, requestedAudience, limitationSnapshotId, fingerprintContractVersion, fingerprint, createdBy, now] = params;
        const conflict = state.candidates.some((c) => c.organization_id === organizationId
          && c.generated_content_draft_id === generatedContentDraftId
          && c.requested_audience === requestedAudience
          && c.canonical_fingerprint === fingerprint);
        if (conflict) return { rows: [] };
        state.candidates.push({
          export_candidate_id: candidateId,
          organization_id: organizationId,
          generated_content_draft_id: generatedContentDraftId,
          content_type: contentType,
          requested_audience: requestedAudience,
          limitation_snapshot_id: limitationSnapshotId,
          fingerprint_contract_version: fingerprintContractVersion,
          canonical_fingerprint: fingerprint,
          created_by: createdBy,
          created_at: now,
        });
        return { rows: [{ export_candidate_id: candidateId }] };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        state.auditRows.push({ sql: s, params });
        return { rows: [] };
      }

      if (s.includes("SELECT DISTINCT c.claim_id")) {
        const [, draftId] = params;
        return {
          rows: state.citations
            .filter((c) => draftId === state.draft.generated_content_draft_id)
            .map((c) => ({ claim_id: c.claim_id, evidence_item_id: c.evidence_item_id })),
        };
      }
      if (s.includes("FOR UPDATE OF ls")) {
        const current = state.snapshots.find((snap) => !state.snapshots.some((successor) => successor.supersedes_snapshot_id === snap.limitation_snapshot_id));
        return { rows: current ? [current] : [] };
      }
      if (s.includes("FROM kai.limitation_snapshots ls")) {
        const current = state.snapshots.find((snap) => !state.snapshots.some((successor) => successor.supersedes_snapshot_id === snap.limitation_snapshot_id));
        return { rows: current ? [{ limitation_snapshot_id: current.limitation_snapshot_id }] : [] };
      }
      if (s.includes("FROM kai.limitation_snapshot_entries")) {
        const [limitationSnapshotId] = params;
        return { rows: state.snapshotEntries.filter((e) => e.limitation_snapshot_id === limitationSnapshotId) };
      }
      if (s.includes("intake_file_id::text AS intake_file_id") && s.includes("JOIN kai.intake_files")) {
        return { rows: [{ intake_file_id: INTAKE_FILE, upload_state: "confirmed" }] };
      }
      if (s.includes("JOIN kai.generated_content_citations c") && s.includes("JOIN kai.evidence_items e")) {
        return {
          rows: state.citations.map((c) => ({
            generated_content_block_id: c.generated_content_block_id,
            claim_id: c.claim_id,
            evidence_item_id: c.evidence_item_id,
            source_id: c.source_id,
            source_version_id: c.source_version_id,
          })),
        };
      }
      if (s.includes("FROM kai.generated_content_blocks") && s.includes("ORDER BY ordinal ASC")) {
        return { rows: state.blocks };
      }
      if (s.includes("FROM kai.review_queue_items")) {
        const [, queueType] = params;
        const row = queueType === "generated_content_review" ? state.genContentReviewQueue : state.exportReviewQueue;
        return { rows: [row] };
      }
      if (s.includes("FROM kai.export_candidates") && s.includes("canonical_fingerprint = $4")) {
        const [organizationId, generatedContentDraftId, requestedAudience, fingerprint] = params;
        const match = state.candidates.find((c) => c.organization_id === organizationId
          && c.generated_content_draft_id === generatedContentDraftId
          && c.requested_audience === requestedAudience
          && c.canonical_fingerprint === fingerprint);
        return { rows: match ? [{ export_candidate_id: match.export_candidate_id, limitation_snapshot_id: match.limitation_snapshot_id }] : [] };
      }
      if (s.includes("FROM kai.export_candidates") && s.includes("export_candidate_id = $2::uuid")) {
        const [organizationId, exportCandidateId] = params;
        const match = state.candidates.find((c) => c.organization_id === organizationId && c.export_candidate_id === exportCandidateId);
        return { rows: match ? [match] : [] };
      }
      if (s.startsWith("SELECT 1 FROM kai.limitation_snapshots WHERE supersedes_snapshot_id")) {
        const [snapshotId] = params;
        return { rows: state.snapshots.filter((snap) => snap.supersedes_snapshot_id === snapshotId).map(() => ({})) };
      }
      if (s.includes("FROM kai.limitation_snapshots") && s.includes("limitation_snapshot_id = $2::uuid")) {
        const [organizationId, limitationSnapshotId] = params;
        const match = state.snapshots.find((snap) => snap.organization_id === organizationId && snap.limitation_snapshot_id === limitationSnapshotId);
        return { rows: match ? [{ limitation_snapshot_id: match.limitation_snapshot_id }] : [] };
      }
      if (s.includes("FROM kai.generated_content_drafts")) {
        const [organizationId, draftId] = params;
        const match = state.draft.organization_id === organizationId && state.draft.generated_content_draft_id === draftId;
        return { rows: match ? [state.draft] : [] };
      }

      throw new Error(`unhandled fake query: ${s}`);
    },
  };
}

function repositoryFor(state) {
  const tx = makeTx(state);
  return createPostgresExportCandidateRepository({ runInTransaction: (fn) => fn(tx) });
}

test("P14 data_gap_memo is included in the generic EXPORT_CANDIDATE_CONTENT_TYPES allowlist alongside evidence_summary", () => {
  assert.ok(EXPORT_CANDIDATE_CONTENT_TYPES.includes("data_gap_memo"));
  assert.ok(EXPORT_CANDIDATE_CONTENT_TYPES.includes("evidence_summary"));
});

test("P14 review resolved, snapshot absent: candidate creation is unavailable (conflict_current_state_changed)", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  const result = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
});

test("P14 confirming the limitation snapshot via the generic route service derives entries exclusively from the draft's own persisted citations (empty limitationCodes), then candidate creation succeeds and replays", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  const confirmResult = await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(confirmResult.ok, true, JSON.stringify(confirmResult));
  assert.equal(state.snapshotEntries.length, 1);
  assert.deepEqual(state.snapshotEntries[0].limitation_codes, []);
  assert.equal(state.snapshotEntries[0].claim_id, CLAIM);
  assert.equal(state.snapshotEntries[0].evidence_item_id, EVIDENCE);

  const createResult = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(createResult.ok, true, JSON.stringify(createResult));
  assert.equal(createResult.data.replayed, false);
  const exportCandidateId = createResult.data.exportCandidateId;

  // Replay: an identical second request against unchanged state must return
  // the exact same candidate identity with replayed:true, never a duplicate
  // row or a different fingerprint.
  const replayResult = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: LATER },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(replayResult.ok, true, JSON.stringify(replayResult));
  assert.equal(replayResult.data.replayed, true);
  assert.equal(replayResult.data.exportCandidateId, exportCandidateId);
  assert.equal(state.candidates.length, 1, "no duplicate export_candidates row was inserted on replay");
});

test("P14 confirming the limitation snapshot via the generic route service on a draft with no cited pairs fails closed with a populated structured blocker (not an empty blockers array)", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true, citations: [] });
  const exportCandidateRepository = repositoryFor(state);

  const confirmResult = await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(confirmResult.ok, false);
  assert.equal(confirmResult.error.code, "validation_blocker");
  assert.equal(confirmResult.error.status, 422);
  assert.ok(Array.isArray(confirmResult.blockers) && confirmResult.blockers.length > 0, JSON.stringify(confirmResult));
  assert.equal(confirmResult.blockers[0].blocking_reason, "no_cited_pairs");
  assert.equal(confirmResult.blockers[0].object_code, DRAFT);
  assert.equal(state.snapshots.length, 0, "no snapshot was written for the rejected request");
});

test("P14 [KAI Package 2B] confirming the limitation snapshot via the generic route service for a recognized site-admin platform-superuser actor with no org membership succeeds and attributes gk_admin (not confirmed_by_role_not_derivable) [SQL_BIND]", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  // This actor is authorized by validateActorCanPerformOperation's
  // platform-superuser bypass (kaiAuthorizationService.js), which does not
  // require any kai.organization_memberships row at all -
  // platformSuperuserAuthority defaults to the recognized
  // "get_kinder_site_admin" source when the actor doesn't set it explicitly.
  // Before the KAI Package 2B repair, the repository's own deriveConfirmedByRole
  // had no such bypass - it strictly required an active gk_reviewer/gk_admin
  // membership for this organization, so this exact actor/operation
  // combination spuriously failed with confirmed_by_role_not_derivable even
  // though authorization had already succeeded. Post-repair, attribution is
  // resolved from the same successful authorization result
  // (resolveAuthorizedHumanRole, Backend/kai/auth/kaiAuthorizedRoleAttribution.js)
  // and correctly attributes gk_admin with no synthetic membership.
  const platformSuperuserActorContext = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000099",
    platformSuperuser: true,
    organizationMemberships: [],
  });

  const confirmResult = await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: platformSuperuserActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(confirmResult.ok, true, JSON.stringify(confirmResult));
  assert.equal(confirmResult.data.confirmedByRole, "gk_admin");
  assert.equal(state.snapshots.length, 1, "the snapshot was persisted for the accepted request");
  assert.equal(state.snapshots[0].confirmed_by_role, "gk_admin", "the bound INSERT ... kai.limitation_snapshots parameter carries gk_admin");
  assert.equal(state.snapshots[0].confirmed_by, "90000000-0000-4000-8000-000000000099");
});

test("P14 [KAI Package 2B] the same recognized site-admin platform-superuser actor is blocked with confirmed_by_role_not_derivable (not authorization_denied) when gk_admin is not itself an allowed role for the operation", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  // confirmGeneratedDraftLimitationSnapshotFromCitedPairs always authorizes
  // against LIMITATION_SNAPSHOT_ROLES (gk_reviewer, gk_admin), which already
  // includes gk_admin, so this exercises the resolver directly instead: an
  // authority string other than the one recognized source still fails closed.
  const wrongAuthoritySource = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000098",
    platformSuperuser: true,
    platformSuperuserAuthority: "not_get_kinder_site_admin",
    organizationMemberships: [],
  });

  const confirmResult = await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: wrongAuthoritySource, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(confirmResult.ok, false);
  assert.equal(confirmResult.error.code, "validation_blocker");
  assert.equal(confirmResult.error.status, 422);
  assert.ok(Array.isArray(confirmResult.blockers) && confirmResult.blockers.length > 0, JSON.stringify(confirmResult));
  assert.equal(confirmResult.blockers[0].blocking_reason, "confirmed_by_role_not_derivable");
  assert.equal(confirmResult.blockers[0].object_code, DRAFT);
  assert.equal(state.snapshots.length, 0, "no snapshot was written for the rejected request");
});

test("P14 a superseded limitation snapshot fails closed: the bound candidate's currentness evaluates to superseded, not current", async () => {
  const state = makeState({ contentType: "data_gap_memo", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  // First confirmation + candidate creation, exactly as above.
  await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  const createResult = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(createResult.ok, true, JSON.stringify(createResult));
  const exportCandidateId = createResult.data.exportCandidateId;

  // A reviewer re-confirms the snapshot with a changed assessment (still the
  // same, only, governed citation pair - just a different limitation-code
  // set), using the existing, unmodified confirmGeneratedDraftLimitationSnapshot
  // capability directly, exactly as a human-curated UI would. This produces
  // an append-only superseding snapshot per the existing P3-16 contract.
  const reconfirmResult = await confirmGeneratedDraftLimitationSnapshot(
    {
      organizationId: ORG,
      generatedContentDraftId: DRAFT,
      entries: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, limitationCodes: ["small_sample_size"] }],
      actorContext: gkAdminActorContext,
      now: LATER,
    },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(reconfirmResult.ok, true, JSON.stringify(reconfirmResult));
  assert.equal(state.snapshots.length, 2);
  assert.equal(state.snapshots[1].supersedes_snapshot_id, state.snapshots[0].limitation_snapshot_id);

  const tx = makeTx(state);
  const currentness = await evaluateExportCandidateCurrentnessInTransaction(tx, {
    organizationId: ORG,
    exportCandidateId,
  });
  assert.equal(currentness.ok, true, JSON.stringify(currentness));
  assert.equal(currentness.data.current, false);
  assert.equal(currentness.data.reason, "limitation_snapshot_superseded");
});

test("P14 evidence_summary content-type behavior is unchanged: still passes the (now generic) content-type gate and reaches the same downstream checks", async () => {
  const state = makeState({ contentType: "evidence_summary", reviewResolved: true });
  const exportCandidateRepository = repositoryFor(state);

  // No limitation snapshot yet -> still rejected at the snapshot
  // prerequisite (conflict_current_state_changed), exactly as before this
  // repair - the content-type gate itself no longer fires first for
  // evidence_summary either, since it was never the differentiator: it was
  // already inside the allowlist.
  const beforeSnapshot = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(beforeSnapshot.ok, false);
  assert.equal(beforeSnapshot.error.code, "conflict_current_state_changed");

  await confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  const afterSnapshot = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );
  assert.equal(afterSnapshot.ok, true, JSON.stringify(afterSnapshot));
});
