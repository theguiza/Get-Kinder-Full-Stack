import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getClientEvidencePipeline,
  __clientEvidencePipelineServiceContract as contract,
} from "../Backend/kai/services/kaiClientEvidencePipelineService.js";
import { __claimProposalServiceContract } from "../Backend/kai/services/kaiClaimProposalService.js";
import {
  PIPELINE_NEXT_ACTIONS,
  PIPELINE_REASONS,
  PIPELINE_REQUEST_STATUS,
  nextActionText,
  pipelineReasonMessage,
  projectClientEvidencePipeline,
  reviewsTabView,
} from "../frontend/knowledgeStudio/clientEvidencePipelineLogic.js";
import {
  STRUCTURAL_EVIDENCE_TYPE,
  USE_FOR_IMPACT_MAX_STEPS,
  claimNeedsGapPreparation,
  claimProposalRunMessage,
  claimProposalTargets,
  isUseForImpactCandidate,
  sourcePreparationFiles,
  useForImpactStep,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Owner decision 2026-11-05 ("Honest status + bulk propose"): a file whose
 * extracted evidence has no claim yet is the organization administrator's
 * propose_claims step, not a Get Kinder evidence-review wait, because P2-03
 * proposes a claim from unreviewed evidence (VAL-KAI-P2-03-001 only warns)
 * and Get Kinder reviews each claim with its evidence. "Use for impact"
 * proposes the file's claimable evidence through the existing per-item
 * P2-03 and P2-04 routes. Reproduces the production report: Cedar Bridge
 * 06_programme_review.pdf at evidence_review / waiting_for_get_kinder with
 * 29 unreviewed document statements and no claim.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG = "11111111-2222-4333-8444-555555555555";
const ENGAGEMENT = "22222222-3333-4444-8555-666666666666";
const fileId = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claimId = (n) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const evidenceId = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VERSION = "60000000-0000-4000-8000-000000000001";
const OTHER_VERSION = "60000000-0000-4000-8000-000000000002";

function memberActor(roleName, { kaiRoles = [] } = {}) {
  return {
    actorType: "human",
    actorUserId: `user-${roleName}`,
    kaiRoles,
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, role_name: roleName, membership_status: "active" }],
  };
}

function row(n, overrides = {}) {
  return {
    intake_file_id: fileId(n),
    safe_filename: `file-${n}.pdf`,
    upload_state: "confirmed",
    file_policy_status: "passed",
    created_at: new Date("2026-11-04T19:50:32Z"),
    parser_status: "completed",
    parser_error_code: null,
    file_profile_complete: true,
    data_dictionary_complete: true,
    sensitivity_profile_complete: true,
    sensitivity_decision_outcome: "reviewed",
    source_candidate_count: 1,
    source_candidate_needs_review_count: 0,
    source_candidate_promoted_count: 1,
    source_candidate_rejected_count: 0,
    source_version_count: 1,
    evidence_item_count: 29,
    evidence_needs_review_count: 29,
    evidence_reviewed_count: 0,
    evidence_unclaimed_proposable_count: 29,
    claim_count: 0,
    claim_needs_review_count: 0,
    claim_ids: [],
    open_client_followup_count: 0,
    sensitivity_permission_predicate: true,
    source_candidate_actionable_count: 0,
    organization_administrator_available: true,
    ...overrides,
  };
}

async function read(rows, actor, facts = []) {
  return getClientEvidencePipeline(
    { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: actor },
    {
      env: ENV,
      getClientEvidencePipelineEngagement: async () => ({ engagement_id: ENGAGEMENT, organization_id: ORG }),
      listClientEvidencePipelineFiles: async () => rows,
      listClientImpactFacts: async () => ({ ok: true, data: { items: facts, truncated: false } }),
    },
  );
}

const current = (result, n) => {
  const file = result.data.files.find((entry) => entry.intakeFileId === fileId(n));
  return [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
};

test("pipeline: the reported PDF (29 unreviewed statements, no claim) is the administrator's propose_claims step, not a Get Kinder wait", async () => {
  const result = await read([row(1)], memberActor("client_admin"));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(current(result, 1), ["evidence_review", "waiting_for_client", "client", "propose_claims", "claim_proposal_ready"]);
  const evidenceStage = result.data.files[0].stages.find((entry) => entry.key === "evidence_review");
  assert.equal(evidenceStage.count, 29, "the count is the evidence still without a claim");
  assert.equal(result.data.files[0].stages.find((entry) => entry.key === "impact_fact_review").status, "not_started");
  assert.deepEqual(result.data.summary.reasons, [{ reason: "claim_proposal_ready", fileCount: 1 }]);
  assert.equal(JSON.stringify(result).includes("unclaimed"), false, "the internal count field is never returned");
});

test("pipeline: who sees what for the same unclaimed evidence", async () => {
  const cases = [
    ["client_admin", memberActor("client_admin"), ["waiting_for_client", "client", "propose_claims", "claim_proposal_ready"]],
    ["client_reviewer with an administrator", memberActor("client_reviewer"),
      ["waiting_for_client", "client", "ask_organization_administrator", "organization_administrator_action_ready"]],
    ["client_contributor with an administrator", memberActor("client_contributor"),
      ["waiting_for_client", "client", "ask_organization_administrator", "organization_administrator_action_ready"]],
    ["gk_operator member", memberActor("gk_operator"), ["waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"]],
    // Holds the organization's client_admin membership, which P2-03 admits,
    // exactly as the extraction authority treats it.
    ["global gk_reviewer over a client_admin membership", memberActor("client_admin", { kaiRoles: ["gk_reviewer"] }),
      ["waiting_for_client", "client", "propose_claims", "claim_proposal_ready"]],
  ];
  for (const [label, actor, expected] of cases) {
    const result = await read([row(1)], actor);
    assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(current(result, 1).slice(1), expected, label);
  }
  const noAdministrator = await read([row(1, { organization_administrator_available: false })], memberActor("client_reviewer"));
  assert.deepEqual(current(noAdministrator, 1).slice(1), ["waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"]);
});

test("pipeline: proposed claims, open follow-ups, structural-only evidence, and a usable fact", async () => {
  const actor = memberActor("client_admin");
  const result = await read([
    // Every claimable item proposed, claims awaiting Get Kinder: a genuine Get Kinder wait.
    row(1, { evidence_unclaimed_proposable_count: 0, claim_count: 29, claim_needs_review_count: 29, claim_ids: [claimId(1)] }),
    // An open client follow-up on a proposed claim is the client's work, not hidden behind Get Kinder's review.
    row(2, { evidence_unclaimed_proposable_count: 0, claim_count: 2, claim_needs_review_count: 2, claim_ids: [claimId(2)], open_client_followup_count: 3 }),
    // An interrupted bulk proposal: some claims exist, the rest can still be proposed.
    row(3, { evidence_unclaimed_proposable_count: 12, claim_count: 17, claim_needs_review_count: 17, claim_ids: [claimId(3)] }),
    // Only structural column facts left without a claim: not offered as a proposal step.
    row(4, { evidence_item_count: 11, evidence_needs_review_count: 11, evidence_unclaimed_proposable_count: 0 }),
    // A usable fact already releases the file from evidence review (owner prompt 2026-10-26, unchanged).
    row(5, { evidence_unclaimed_proposable_count: 4, claim_count: 1, claim_ids: [claimId(5)] }),
  ], actor, [{ claimId: claimId(5), statement: "Usable", claimType: "finding", limitationDimensionKeys: [] }]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(current(result, 1), ["evidence_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"]);
  assert.deepEqual(current(result, 2), ["evidence_review", "waiting_for_client", "client", "answer_client_followups", "waiting_for_client"]);
  assert.deepEqual(current(result, 3), ["evidence_review", "waiting_for_client", "client", "propose_claims", "claim_proposal_ready"]);
  assert.deepEqual(current(result, 4), ["evidence_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"]);
  assert.deepEqual(current(result, 5), [null, "complete", "none", "none", "complete"]);
});

test("authority: proposeClaims is the P2-03 client role set only, never a Get Kinder actor", () => {
  assert.deepEqual([...__claimProposalServiceContract.CLAIM_PROPOSAL_ALLOWED_ROLES].sort(), ["client_admin", "gk_admin", "gk_operator", "gk_reviewer"]);
  assert.equal(contract.resolveClientAuthority(memberActor("client_admin"), ORG).proposeClaims, true);
  for (const actor of [memberActor("client_reviewer"), memberActor("client_contributor"), memberActor("gk_admin"), memberActor("gk_operator")]) {
    assert.equal(contract.resolveClientAuthority(actor, ORG).proposeClaims, false);
  }
  assert.equal(contract.NEXT_ACTION.proposeClaims, "propose_claims");
  assert.ok(PIPELINE_NEXT_ACTIONS.includes("propose_claims"));
  assert.deepEqual([...contract.PIPELINE_REASONS], [...PIPELINE_REASONS]);
});

test("read model: the unclaimed count excludes structural column facts and evidence that already has a claim", () => {
  const sql = readFileSync(new URL("../Backend/kai/db/kaiClientEvidencePipelineReadModel.js", import.meta.url), "utf8");
  assert.match(sql, /COALESCE\(e\.evidence_unclaimed_proposable_count, 0\)::int AS evidence_unclaimed_proposable_count/);
  assert.match(sql, /WHERE ei\.evidence_type <> 'dictionary_field_presence_fact'\s+AND NOT EXISTS \(\s+SELECT 1\s+FROM kai\.claims pc\s+WHERE pc\.organization_id = ei\.organization_id\s+AND pc\.evidence_item_id = ei\.evidence_item_id/);
});

test("frontend: the propose_claims file is offered Use for impact, listed as source work, and explained", async () => {
  const result = await read([row(1)], memberActor("client_admin"));
  const data = projectClientEvidencePipeline(result.data, ENGAGEMENT);
  assert.ok(data, "the new vocabulary projects");
  const [file] = data.files;
  const access = { proposeClaim: true, reviewSensitivity: true, promoteSource: true };
  assert.deepEqual(useForImpactStep(file, access), { kind: "propose" });
  assert.equal(isUseForImpactCandidate(file, access), true);
  assert.deepEqual(sourcePreparationFiles(data, access).map((entry) => entry.intakeFileId), [fileId(1)]);
  assert.equal(useForImpactStep(file, { ...access, proposeClaim: false }).kind, "done");
  assert.equal(isUseForImpactCandidate(file, { ...access, proposeClaim: false }), false);
  const view = reviewsTabView({ status: PIPELINE_REQUEST_STATUS.SUCCESS_WITH_DATA, data });
  assert.deepEqual(view.sourceWork.map((entry) => entry.intakeFileId), [fileId(1)]);
  assert.deepEqual(view.waitingForGetKinder, []);
  assert.match(nextActionText(file), /^Your action is needed: evidence from this file has no proposed claims yet/);
  assert.match(pipelineReasonMessage("claim_proposal_ready", 1), /Propose claims from it in Data Sources/);
  assert.ok(USE_FOR_IMPACT_MAX_STEPS >= 5, "continue, extract, and propose fit in one run");
});

test("frontend: proposal targets are the file's own current version, never structural facts or already-proposed evidence", () => {
  const items = [
    { evidenceItemId: evidenceId(1), sourceVersionId: VERSION, evidenceType: "source_document_statement" },
    { evidenceItemId: evidenceId(2), sourceVersionId: VERSION, evidenceType: STRUCTURAL_EVIDENCE_TYPE },
    { evidenceItemId: evidenceId(3), sourceVersionId: OTHER_VERSION, evidenceType: "source_document_statement" },
    { evidenceItemId: evidenceId(4), sourceVersionId: VERSION, evidenceType: "source_derived_measurement" },
    { evidenceItemId: evidenceId(5), sourceVersionId: VERSION, evidenceType: "source_record_count_measurement" },
    { evidenceItemId: "not-a-uuid", sourceVersionId: VERSION, evidenceType: "source_document_statement" },
  ];
  const proposed = new Map([[evidenceId(5), [claimId(5)]]]);
  assert.deepEqual(claimProposalTargets(items, VERSION, proposed).map((item) => item.evidenceItemId), [evidenceId(1), evidenceId(4)]);
  assert.deepEqual(claimProposalTargets(items, "not-a-uuid"), []);
  assert.deepEqual(claimProposalTargets(null, VERSION), []);
});

test("frontend: P2-04 runs after a proposal unless the measured proposal already prepared it", () => {
  assert.equal(claimNeedsGapPreparation({ claim: {} }), true, "document statement claims need the explicit P2-04");
  assert.equal(claimNeedsGapPreparation({ measurementClaim: true, claim_gap_state: { status: "generated" } }), false);
  assert.equal(claimNeedsGapPreparation({ measurementClaim: true, claim_gap_state: { status: "replayed" } }), false);
  assert.equal(claimNeedsGapPreparation({ measurementClaim: true, claim_gap_state: { status: "not_generated" } }), true);
  assert.equal(claimNeedsGapPreparation({ measurementClaim: true }), true);
});

test("frontend: the run message reports counts, a refusal, and approves nothing", () => {
  assert.match(claimProposalRunMessage({ targetCount: 0 }), /already has a claim/);
  const done = claimProposalRunMessage({ targetCount: 29, proposed: 27, replayed: 2, prepared: 29, followups: 0 });
  assert.match(done, /27 claim\(s\) proposed and 2 already proposed, of 29; gap follow-ups prepared for 29 \(0 client follow-up question\(s\)\)\./);
  assert.match(done, /waits for Get Kinder to review it with its evidence\. Nothing was approved\.$/);
  assert.match(claimProposalRunMessage({ targetCount: 3, proposed: 3, prepared: 3, followups: 4 }), /answers to the follow-up questions/);
  const stopped = claimProposalRunMessage({ targetCount: 29, proposed: 5, prepared: 5, failureText: "Refused." });
  assert.match(stopped, /until a request was refused: 5 claim\(s\) proposed.*Refused\. Nothing is retried automatically/);
});

test("component: Use for impact proposes through the existing per-item routes, one at a time, never retrying", () => {
  const source = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const proposeClaimsForFile"), source.indexOf("const continueForFile"));
  assert.ok(body.length > 0);
  assert.match(body, /postJson\(claimProposalPath\(organizationId, item\.evidenceItemId\), \{\}\)/);
  assert.match(body, /postJson\(claimGapFollowupsPath\(organizationId, claimId\), \{\}\)/);
  assert.match(body, /if \(!read\.complete\)/, "never proposes from a partial Evidence Library read");
  assert.match(body, /access\.generateClaimGapFollowups/);
  assert.equal((body.match(/break;/g) || []).length, 2, "each refusal stops the run");
  assert.doesNotMatch(body, /evidence-review|claim-review|\/complete|approve/i, "no review decision is recorded");
  assert.match(source, /next\.kind === "propose" \? await proposeClaimsForFile\(file\.intakeFileId, \(\) => contextRef\.current === requestContext\)/);
});
