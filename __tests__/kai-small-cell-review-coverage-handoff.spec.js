import test from "node:test";
import assert from "node:assert/strict";

import { recordSensitivityAllowedUseDecision } from "../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js";
import { createPostgresSensitivityAllowedUseReviewRepository } from "../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js";
import { findCurrentSensitivityAllowedUseDecision } from "../Backend/kai/dictionary/postgresSensitivityAllowedUseDecisionRepository.js";
import { createPostgresEvidenceCoverageAssessmentRepository } from "../Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js";
import { assessEvidenceCoverageForSourceVersion } from "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js";

/**
 * Package 2B connected synthetic handoff: the real review service, the real
 * sensitivity-review repository, the real decision INSERT, the real
 * current-head reader and the real direct coverage repository/service all run
 * against ONE stateful synthetic transaction adapter. Decision state changes
 * only when the real INSERT executes; every head SELECT is derived from that
 * mutated state using the real query's no-successor rule. Any SQL statement
 * the adapter does not recognize throws. This is not PostgreSQL persistence
 * proof.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const PROFILE_A = "80000000-0000-4000-8000-0000000000a1";
const PROFILE_B = "80000000-0000-4000-8000-0000000000b1";
const QUEUE_A = "70000000-0000-4000-8000-0000000000a1";
const REVIEWER = "90000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const T0 = "2026-11-03T10:00:00.000Z";
const T1 = "2026-11-03T10:05:00.000Z";
const T2 = "2026-11-03T10:10:00.000Z";
const T3 = "2026-11-03T10:15:00.000Z";
const ENV = { KAI_SPRINT2_ENABLED: "true" };

const reviewerActor = {
  actorType: "human",
  actorUserId: REVIEWER,
  kaiRoles: ["gk_reviewer"],
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
};

function reviewedSnapshot(overrides = {}) {
  return {
    reviewed_personal_data_status: "present",
    reviewed_minor_data_status: "absent",
    reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "unknown",
    reviewed_staff_notes_status: "absent",
    reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "absent",
    reviewed_financial_records_status: "absent",
    reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: false,
    ...overrides,
  };
}

function lineageFor(suffix, profileId) {
  const id = (prefix) => `${prefix}000000-0000-4000-8000-0000000000${suffix}`;
  const intakeFileId = id("20");
  const fileProfileId = id("50");
  const dictionaryId = id("60");
  const candidateId = id("91");
  const sourceId = id("71");
  const sourceVersionId = id("72");
  return {
    sourceVersionId,
    profile: {
      organization_id: ORG, intake_sensitivity_profile_id: profileId, intake_file_id: intakeFileId,
      file_profile_id: fileProfileId, data_dictionary_id: dictionaryId, profile_canonical_sha256: SHA,
      human_review_required: true, public_use_allowed: false, funder_use_allowed: false,
      llm_processing_allowed: false, product_learning_allowed: false,
      retention_posture: "restricted_pending_review", small_cell_risk_status: "unknown", allowed_use_status: "unknown",
    },
    intakeFile: { organization_id: ORG, intake_file_id: intakeFileId, upload_state: "profiled" },
    sourceVersion: {
      source_version_id: sourceVersionId, organization_id: ORG, source_id: sourceId,
      intake_source_candidate_id: candidateId, intake_sensitivity_profile_id: profileId,
      profile_canonical_sha256: SHA, is_current: true, created_at: new Date(T0),
    },
    source: { source_id: sourceId, organization_id: ORG, source_code: `SRC-${suffix}`, reviewed_source_type: "program_records", created_at: new Date(T0) },
    candidate: {
      intake_source_candidate_id: candidateId, organization_id: ORG, intake_file_id: intakeFileId,
      file_profile_id: fileProfileId, data_dictionary_id: dictionaryId, intake_sensitivity_profile_id: profileId,
      profile_canonical_sha256: SHA, proposed_source_type: "program_records", candidate_status: "promoted", created_at: new Date(T0),
    },
    promotion: {
      intake_promotion_decision_id: id("73"), organization_id: ORG, intake_source_candidate_id: candidateId,
      review_queue_item_id: id("74"), reviewed_source_type: "program_records", decision_status: "promoted",
      source_id: sourceId, source_version_id: sourceVersionId, created_at: new Date(T0), decided_at: new Date(T0), promoted_at: new Date(T0),
    },
    dictionary: {
      data_dictionary_id: dictionaryId, organization_id: ORG, intake_file_id: intakeFileId, file_profile_id: fileProfileId,
      profile_canonical_sha256: SHA, dictionary_status: "accepted", created_at: new Date(T0),
    },
    fields: [{ data_dictionary_field_id: id("61"), profile_field_key: "participant_count", data_type: "integer",
      business_meaning: "Participants served", entity_level: "program", sensitivity: "internal" }],
    evidenceFieldKeys: ["participant_count"],
  };
}

const norm = (sql) => sql.replace(/\s+/g, " ").trim();
const ms = (value) => new Date(value).getTime();

/** Smallest stateful adapter for exactly the statements these real modules issue. */
function createSyntheticState() {
  const lineages = [lineageFor("a1", PROFILE_A), lineageFor("b1", PROFILE_B)];
  const state = {
    profiles: lineages.map((l) => ({ ...l.profile })),
    intakeFiles: lineages.map((l) => ({ ...l.intakeFile })),
    queueItems: [{
      review_queue_item_id: QUEUE_A, organization_id: ORG, queue_type: "sensitivity_review",
      target_object_type: "intake_sensitivity_profile", target_object_id: PROFILE_A,
      queue_status: "open", review_status: "needs_gk_review", updated_at: new Date(T0),
    }],
    decisions: [],
    uploadAudits: [],
    statements: [],
    lineages,
  };
  let decisionCounter = 0;
  const one = (rows) => ({ rows: rows.slice(0, 1) });
  const heads = (organizationId, profileIds) => state.decisions.filter((d) => d.organization_id === organizationId
    && profileIds.includes(d.intake_sensitivity_profile_id)
    && !state.decisions.some((s) => s.supersedes_decision_id === d.decision_id));
  const byLineage = (pick, key, organizationId, value) => one(lineages.map(pick)
    .filter((row) => row.organization_id === organizationId && row[key] === value).map((row) => ({ ...row })));

  const tx = {
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      state.statements.push(sql);
      if (sql === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") return { rows: [] };

      if (sql.startsWith("SELECT") && sql.includes("FROM kai.intake_sensitivity_profiles")) {
        if (sql.includes("ANY($2::uuid[])")) {
          return { rows: state.profiles.filter((p) => p.organization_id === params[0] && params[1].includes(p.intake_sensitivity_profile_id))
            .map((p) => ({ intake_sensitivity_profile_id: p.intake_sensitivity_profile_id, allowed_use_status: p.allowed_use_status })) };
        }
        const match = state.profiles.filter((p) => p.organization_id === params[0] && p.intake_sensitivity_profile_id === params[1]);
        if (sql.endsWith("FOR UPDATE")) {
          return one(match.map(({ small_cell_risk_status: _s, allowed_use_status: _a, file_profile_id: _f,
            data_dictionary_id: _d, profile_canonical_sha256: _h, ...locked }) => ({ ...locked })));
        }
        if (sql.includes("small_cell_risk_status") && sql.includes("allowed_use_status")) return one(match.map((p) => ({ ...p })));
      }

      if (sql.startsWith("SELECT") && sql.includes("FROM kai.intake_sensitivity_review_decisions d")) {
        assert.match(sql, /NOT EXISTS \( SELECT 1 FROM kai\.intake_sensitivity_review_decisions s WHERE s\.supersedes_decision_id = d\.decision_id \)/);
        if (sql.includes("d.intake_sensitivity_profile_id = $2::uuid")) {
          return { rows: heads(params[0], [params[1]]).map((d) => ({ ...d })) };
        }
        if (sql.includes("ANY($2::uuid[])") && sql.startsWith("SELECT d.intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id, d.decision_outcome, d.reviewed_allowed_use_status, d.reviewed_llm_processing_allowed")) {
          return { rows: heads(params[0], params[1]).map((d) => ({
            intake_sensitivity_profile_id: d.intake_sensitivity_profile_id, decision_outcome: d.decision_outcome,
            reviewed_allowed_use_status: d.reviewed_allowed_use_status, reviewed_llm_processing_allowed: d.reviewed_llm_processing_allowed,
          })) };
        }
      }

      if (sql.startsWith("SELECT") && sql.includes("FROM kai.review_queue_items")) {
        return one(state.queueItems.filter((q) => q.organization_id === params[0] && q.review_queue_item_id === params[1]
          && q.queue_type === params[2] && q.target_object_type === params[3] && q.target_object_id === params[4]).map((q) => ({ ...q })));
      }

      if (sql.startsWith("UPDATE kai.review_queue_items")) {
        const [nextQueue, nextReview, now, organizationId, id, queueType, targetType, targetId,
          open, needsGk, inProgress, resolved, resolvedReview, expected] = params;
        const row = state.queueItems.find((q) => q.organization_id === organizationId && q.review_queue_item_id === id
          && q.queue_type === queueType && q.target_object_type === targetType && q.target_object_id === targetId
          && ((q.queue_status === open && q.review_status === needsGk)
            || (q.queue_status === inProgress && q.review_status === needsGk)
            || (q.queue_status === resolved && q.review_status === resolvedReview))
          && ms(q.updated_at) === ms(expected));
        if (!row) return { rows: [] };
        Object.assign(row, { queue_status: nextQueue, review_status: nextReview, updated_at: new Date(now) });
        return { rows: [{ ...row }] };
      }

      if (sql.startsWith("INSERT INTO kai.intake_sensitivity_review_decisions (")) {
        const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim());
        assert.equal(columns.length, params.length, "every INSERT column is bound");
        const submitted = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
        const lineageRows = state.decisions.filter((d) => d.organization_id === submitted.organization_id
          && d.intake_sensitivity_profile_id === submitted.intake_sensitivity_profile_id);
        if (submitted.supersedes_decision_id === null) {
          if (lineageRows.some((d) => d.supersedes_decision_id === null)) throw Object.assign(new Error("root"), { code: "23505" });
        } else {
          if (!lineageRows.some((d) => d.decision_id === submitted.supersedes_decision_id)) throw Object.assign(new Error("fk"), { code: "23503" });
          if (state.decisions.some((d) => d.supersedes_decision_id === submitted.supersedes_decision_id)) {
            throw Object.assign(new Error("successor"), { code: "23505" });
          }
        }
        decisionCounter += 1;
        const row = {
          decision_id: `d0000000-0000-4000-8000-${String(decisionCounter).padStart(12, "0")}`,
          ...submitted,
          target_updated_at: new Date(submitted.target_updated_at),
          created_by_type: "human",
          created_at: new Date(Date.parse(T0) + decisionCounter * 1000),
        };
        state.decisions.push(row);
        return { rows: [{ ...row }] };
      }

      if (sql.startsWith("SELECT upload_state FROM kai.intake_files")) {
        return one(state.intakeFiles.filter((f) => f.organization_id === params[0] && f.intake_file_id === params[1])
          .map((f) => ({ upload_state: f.upload_state })));
      }
      if (sql.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        state.uploadAudits.push({ organization_id: params[0], intake_file_id: params[1], operation: params[2], metadata: JSON.parse(params[4]) });
        return { rows: [] };
      }

      if (sql.includes("FROM kai.source_versions")) return byLineage((l) => l.sourceVersion, "source_version_id", params[0], params[1]);
      if (sql.includes("FROM kai.sources")) return byLineage((l) => l.source, "source_id", params[0], params[1]);
      if (sql.includes("FROM kai.intake_source_candidates")) return byLineage((l) => l.candidate, "intake_source_candidate_id", params[0], params[1]);
      if (sql.includes("FROM kai.intake_promotion_decisions")) return byLineage((l) => l.promotion, "source_version_id", params[0], params[1]);
      if (sql.includes("FROM kai.data_dictionaries")) return byLineage((l) => l.dictionary, "data_dictionary_id", params[0], params[1]);
      if (sql.includes("FROM kai.data_dictionary_fields")) {
        return { rows: lineages.filter((l) => l.profile.organization_id === params[0] && l.dictionary.data_dictionary_id === params[1])
          .flatMap((l) => l.fields.map((f) => ({ ...f }))) };
      }
      if (sql.includes("FROM kai.data_quality_findings")) return { rows: [] };
      if (sql.includes("FROM kai.evidence_items e JOIN kai.source_locators sl")) {
        return { rows: lineages.filter((l) => l.profile.organization_id === params[0] && l.sourceVersionId === params[1])
          .flatMap((l) => l.evidenceFieldKeys.map((key) => ({ profile_field_key: key }))) };
      }

      throw new Error(`synthetic adapter: unexpected statement ${sql.slice(0, 120)}`);
    },
  };
  // A rolled-back transaction must not leave state behind.
  async function runInTransaction(work) {
    const snapshot = structuredClone({ queueItems: state.queueItems, decisions: state.decisions, uploadAudits: state.uploadAudits });
    try {
      return await work(tx);
    } catch (error) {
      Object.assign(state, snapshot);
      throw error;
    }
  }
  return { state, tx, runInTransaction };
}

function auditRecorder() {
  const calls = { prepared: [], published: 0 };
  return {
    calls,
    prepareMetadataOnlyAudit({ payload }) {
      calls.prepared.push(payload);
      return { ok: true, async publish() { calls.published += 1; } };
    },
  };
}

test("Package 2B: a human-reviewed small-cell decision written by the real writer drives the real direct coverage assessment", async () => {
  const { state, tx, runInTransaction } = createSyntheticState();
  const reviewRepository = createPostgresSensitivityAllowedUseReviewRepository({ runInTransaction });
  const coverageRepository = createPostgresEvidenceCoverageAssessmentRepository({ runInTransaction });
  const [lineageA, lineageB] = state.lineages;
  const audit = auditRecorder();
  const inserts = () => state.statements.filter((sql) => sql.startsWith("INSERT INTO kai.intake_sensitivity_review_decisions"));
  const assess = async (sourceVersionId) => {
    const result = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId, actorContext: reviewerActor },
      { env: ENV, evidenceCoverageAssessmentRepository: coverageRepository },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data.dimensions.small_cell_risk.evidence.assessment_status;
  };
  const facts = async (sourceVersionId) => (await coverageRepository.readEvidenceCoverageAssessmentFacts({ organizationId: ORG, sourceVersionId })).data.rows.profileRow;
  const review = (expectedUpdatedAt, now, small) => recordSensitivityAllowedUseDecision({
    organizationId: ORG, intakeSensitivityProfileId: PROFILE_A, reviewQueueItemId: QUEUE_A,
    expectedUpdatedAt, decision: "reviewed", reviewedSnapshot: reviewedSnapshot({ reviewed_small_cell_risk_status: small }),
    actorContext: reviewerActor, now,
  }, { env: ENV, sensitivityAllowedUseReviewRepository: reviewRepository, metadataOnlyAudit: audit });
  const machineProfile = (id) => state.profiles.find((p) => p.intake_sensitivity_profile_id === id).small_cell_risk_status;

  // A. Negative control: no reviewed decision exists yet.
  assert.equal(state.decisions.length, 0);
  assert.equal(await findCurrentSensitivityAllowedUseDecision(tx, { organizationId: ORG, intakeSensitivityProfileId: PROFILE_A }), null);
  assert.equal(await assess(lineageA.sourceVersionId), "unresolved");
  assert.equal((await facts(lineageA.sourceVersionId)).small_cell_review_decision_id, null);

  // B. Authorized human review: absent.
  const first = await review(T0, T1, "absent");
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.replayed, false);
  assert.equal(first.data.reviewQueueItem.queue_status, "resolved");
  assert.equal(first.data.reviewQueueItem.updated_at, T1);
  assert.equal(state.queueItems[0].updated_at.toISOString(), T1, "the conditional queue update was applied");
  assert.equal(inserts().length, 1);
  assert.equal(state.decisions.length, 1);
  const absentRow = state.decisions[0];
  assert.equal(absentRow.reviewed_small_cell_risk_status, "absent", "the INSERT's submitted value is stored");
  assert.deepEqual([absentRow.organization_id, absentRow.intake_sensitivity_profile_id, absentRow.review_queue_item_id,
    absentRow.decided_by, absentRow.decided_by_role, absentRow.supersedes_decision_id, absentRow.target_updated_at.toISOString()],
  [ORG, PROFILE_A, QUEUE_A, REVIEWER, "gk_reviewer", null, T0]);
  assert.equal(first.data.decision.decision_id, absentRow.decision_id);
  assert.equal(audit.calls.prepared.length, 1);
  assert.equal(audit.calls.published, 1);
  assert.equal(state.uploadAudits.length, 1);
  assert.equal(state.uploadAudits[0].metadata.decision_id, absentRow.decision_id);
  assert.equal(state.uploadAudits[0].metadata.metadata_only, true);

  const headAfterAbsent = await findCurrentSensitivityAllowedUseDecision(tx, { organizationId: ORG, intakeSensitivityProfileId: PROFILE_A });
  assert.equal(headAfterAbsent.decision_id, absentRow.decision_id);
  assert.equal(headAfterAbsent.reviewed_small_cell_risk_status, "absent");
  const profileFactsAbsent = await facts(lineageA.sourceVersionId);
  assert.equal(profileFactsAbsent.organization_id, ORG);
  assert.equal(profileFactsAbsent.intake_sensitivity_profile_id, PROFILE_A);
  assert.equal(profileFactsAbsent.small_cell_review_head_id, absentRow.decision_id);
  assert.equal(profileFactsAbsent.small_cell_review_decision_id, absentRow.decision_id);
  assert.equal(profileFactsAbsent.small_cell_risk_status, "absent");
  assert.equal(await assess(lineageA.sourceVersionId), "resolved_clear");
  assert.equal(machineProfile(PROFILE_A), "unknown", "the machine-written profile is never mutated");

  // C. Fresh review supersedes it with present.
  const second = await review(first.data.reviewQueueItem.updated_at, T2, "present");
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.data.replayed, false);
  assert.equal(inserts().length, 2);
  const presentRow = state.decisions[1];
  assert.equal(presentRow.supersedes_decision_id, absentRow.decision_id);
  assert.equal(presentRow.reviewed_small_cell_risk_status, "present");
  const headAfterPresent = await findCurrentSensitivityAllowedUseDecision(tx, { organizationId: ORG, intakeSensitivityProfileId: PROFILE_A });
  assert.equal(headAfterPresent.decision_id, presentRow.decision_id);
  assert.equal((await facts(lineageA.sourceVersionId)).small_cell_review_decision_id, presentRow.decision_id);
  assert.equal(await assess(lineageA.sourceVersionId), "resolved_risk_flagged");
  assert.equal(machineProfile(PROFILE_A), "unknown");

  // D. Stale changed submission on the obsolete precondition (T1) is a conflict.
  const statementsBeforeStale = state.statements.length;
  const stale = await review(T1, T3, "absent");
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "conflict_current_state_changed");
  assert.equal(inserts().length, 2, "no new decision INSERT");
  assert.equal(state.decisions.length, 2, "no new authority");
  assert.equal(state.uploadAudits.length, 2);
  assert.equal(state.statements.slice(statementsBeforeStale).some((sql) => /^(INSERT|DELETE)/.test(sql)), false);
  assert.equal((await findCurrentSensitivityAllowedUseDecision(tx, { organizationId: ORG, intakeSensitivityProfileId: PROFILE_A })).decision_id, presentRow.decision_id);
  assert.equal(await assess(lineageA.sourceVersionId), "resolved_risk_flagged");
  // Package 2A replay rule preserved: the identical re-sent request replays without a write.
  const replay = await review(T1, T3, "present");
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.decision.decision_id, presentRow.decision_id);
  assert.equal(inserts().length, 2);

  // E. Profile isolation: another profile in the same organization stays unresolved.
  assert.equal(await findCurrentSensitivityAllowedUseDecision(tx, { organizationId: ORG, intakeSensitivityProfileId: PROFILE_B }), null);
  const profileFactsB = await facts(lineageB.sourceVersionId);
  assert.equal(profileFactsB.intake_sensitivity_profile_id, PROFILE_B);
  assert.equal(profileFactsB.small_cell_review_decision_id, null);
  assert.equal(await assess(lineageB.sourceVersionId), "unresolved");
  assert.equal(machineProfile(PROFILE_B), "unknown");
});

test("Package 2B fixture guard: the synthetic adapter rejects statements it does not model", async () => {
  const { tx } = createSyntheticState();
  await assert.rejects(tx.query("DELETE FROM kai.intake_sensitivity_review_decisions"), /unexpected statement/);
  await assert.rejects(tx.query("SELECT 1 FROM kai.claims"), /unexpected statement/);
});
