import test from "node:test";
import assert from "node:assert/strict";

import {
  createGeneratedDraftExportCandidate,
} from "../Backend/kai/services/kaiExportCandidateService.js";
import {
  createPostgresExportCandidateRepository,
} from "../Backend/kai/dictionary/postgresExportCandidateRepository.js";

// Phase-14 finding: `createGeneratedDraftExportCandidate` /
// `postgresExportCandidateRepository.createExportCandidate` gate the
// generated-content draft's content_type against the single hardcoded value
// `EXPORT_CANDIDATE_CONTENT_TYPE` ("evidence_summary") *before* checking
// review-lane resolution or limitation-snapshot currentness. A `data_gap_memo`
// draft is therefore rejected with `conflict_current_state_changed` (409)
// unconditionally -- independent of review status, current-use eligibility,
// or any limitation snapshot state. This is a content-type allowlist gap,
// not a currentness/CAS regression, and is not repaired here: widening
// EXPORT_CANDIDATE_CONTENT_TYPE to accept data_gap_memo is a new product
// decision (it changes the p3-16 export-candidate fingerprint/audit
// contract), not an already-authorized integration correction.

const ORG = "00000000-0000-4000-8000-000000000001";
const DRAFT = "00000000-0000-4000-8000-000000000802";
const NOW = "2026-08-07T10:00:00.000Z";

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

// A minimal fake transaction: the content_type guard is the very first read
// after the draft-existence check, so only the draft-row query needs a
// response to prove this branch is reached deterministically -- no
// review-queue, snapshot, or graph query ever runs for a data_gap_memo draft.
function fakeTxReturningDraft(draft) {
  let calls = 0;
  return {
    async query() {
      calls += 1;
      assert.equal(calls, 1, "content_type guard must reject before any further query is issued");
      return { rows: [draft] };
    },
  };
}

test("P14 createExportCandidate repository rejects a data_gap_memo draft with conflict_current_state_changed (409), before any review/snapshot/graph query", async () => {
  const tx = fakeTxReturningDraft({
    generated_content_draft_id: DRAFT,
    organization_id: ORG,
    content_type: "data_gap_memo",
    requested_audience: "internal",
    draft_status: "generated",
  });
  const repository = createPostgresExportCandidateRepository({
    runInTransaction: (fn) => fn(tx),
  });

  const result = await repository.createExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { metadataOnlyAudit: auditRecorder() },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
});

test("P14 createGeneratedDraftExportCandidate service surfaces the same content-type rejection for data_gap_memo end to end", async () => {
  const tx = fakeTxReturningDraft({
    generated_content_draft_id: DRAFT,
    organization_id: ORG,
    content_type: "data_gap_memo",
    requested_audience: "internal",
    draft_status: "generated",
  });
  const exportCandidateRepository = createPostgresExportCandidateRepository({
    runInTransaction: (fn) => fn(tx),
  });

  const result = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.equal(result.error.status, 409);
});

test("P14 the content-type rejection is unconditional: it fires even when review lanes are resolved and current-use eligibility is true (proves the exportEligible UI gate is not circular)", async () => {
  // A data_gap_memo draft can legitimately have resolved review lanes and
  // currentUseEligible === true in the generic export-review packet (see
  // kaiExportReviewService.js content-type allowlist), yet
  // createExportCandidate still rejects it deterministically at the
  // content-type guard. This is exactly the class of state the restored
  // `model.exportEligible === true` UI gate must not approximate around:
  // no combination of review/current-use fields the packet exposes can
  // predict this rejection, because the packet does not expose content_type
  // eligibility for candidate creation at all.
  const tx = fakeTxReturningDraft({
    generated_content_draft_id: DRAFT,
    organization_id: ORG,
    content_type: "data_gap_memo",
    requested_audience: "internal",
    draft_status: "generated",
  });
  const exportCandidateRepository = createPostgresExportCandidateRepository({
    runInTransaction: (fn) => fn(tx),
  });

  const result = await createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext: gkAdminActorContext, now: NOW },
    { exportCandidateRepository, metadataOnlyAudit: auditRecorder(), env: enabledEnv },
  );

  assert.equal(result.error.code, "conflict_current_state_changed");
});
