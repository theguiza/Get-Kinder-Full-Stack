import test from "node:test";
import assert from "node:assert/strict";

import { listOrganizationEvidenceGapsForImpactLibrary } from "../Backend/kai/services/kaiOrganizationEvidenceGapReadService.js";
import { __organizationEvidenceGapCurrentStateRepositoryTestables } from "../Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js";
import {
  CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION,
  CLIENT_FOLLOWUP_QUEUE_STATUS,
  CLIENT_FOLLOWUP_REVIEW_STATUS,
  CLIENT_FOLLOWUP_PRIORITY,
  CLIENT_FOLLOWUP_SUMMARY,
} from "../Backend/kai/validators/kaiClaimGapFollowupValidators.js";

/**
 * KAI Package 4 repair regressions:
 *
 *  - candidate-pagination semantics (semantic filtering happens strictly
 *    AFTER persisted-candidate pagination; the keyset cursor advances by the
 *    persisted candidate sequence actually scanned, never by the subset that
 *    survives current-state filtering) - the stale-only and partially-stale
 *    cases required by the Package 4 repair spec;
 *  - multi-claim batching: repository query COUNT stays constant regardless
 *    of how many distinct claims a candidate page references, and no
 *    query is ever issued inside a per-claim loop;
 *  - tenant isolation: organization A can never see organization B's claims
 *    through this batched path.
 *
 * All three exercise the REAL filterCurrentOrganizationEvidenceGaps
 * (Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js)
 * against an in-memory fake transaction that filters actual fixture tables by
 * the actual organization_id/id-array parameters each batched query sends -
 * unlike a fixed-response stub, this fake can distinguish claims from one
 * another, which is required to prove per-claim outcomes and cross-tenant
 * isolation.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

function uid(section, n) {
  return `00000000-0000-4000-8000-${section}${n.toString(16).padStart(12 - section.length, "0")}`;
}

// Mirrors the accepted 4658703 regression fixture exactly: given a single
// fully-defined dictionary field, fully covered by evidence, no small-cell
// risk, and no open data_quality_findings, these are the only six dimensions
// buildExpectedGapPlans does not resolve as resolved_clear.
const DIMENSION_KEYS_WITH_GAPS = [
  "missingness",
  "duplicates",
  "denominator_clarity",
  "time_period_clarity",
  "conflicting_source_indicators",
  "requirement_alignment",
];
const CLIENT_ANSWERABLE_GAP_DIMENSIONS = ["denominator_clarity", "time_period_clarity"];

/**
 * Builds one fully lineage-complete claim (all P2-06 current-state gates
 * satisfied) whose six non-resolved_clear dimensions each have a matching
 * persisted kai.gap_log_items row - i.e. a claim get_claim_traceability_summary
 * currently accepts as CURRENT - unless `stale: true`, in which case an extra
 * open kai.data_quality_findings row for 'missingness' is added (mirroring
 * the accepted 4658703 regression exactly), which makes the persisted
 * missingness gap row disagree with the freshly recomputed expected gap
 * plan (gapRowsMatchExpectation fails) - the same claim-level gate the real
 * repository enforces, so get_claim_traceability_summary would reject this
 * claim's gaps as STALE.
 */
function buildClaimFixture(organizationId, claimId, { stale = false } = {}) {
  const n = claimId.n;
  const evidenceId = uid("c2", n);
  const locatorId = uid("c3", n);
  const sourceId = uid("c4", n);
  const sourceVersionId = uid("c5", n);
  const candidateId = uid("c6", n);
  const decisionId = uid("c7", n);
  const evidenceReviewQueueId = uid("c8", n);
  const claimReviewQueueId = uid("c9", n);
  const profileId = uid("ca", n);
  const dictionaryId = uid("cb", n);
  const claimEvidenceLinkId = uid("cc", n);
  const now = new Date("2026-08-01T00:00:00.000Z");

  const claim = {
    claim_id: claimId.id,
    organization_id: organizationId,
    evidence_item_id: evidenceId,
    claim_type: "outcome",
    claim_status: "draft",
    claim_review_status: "unassessed",
    claim_strength: "unassessed",
    internal_only: true,
    public_use_allowed: false,
    funder_use_allowed: false,
    export_ready: false,
  };
  const claimEvidenceLink = {
    claim_evidence_link_id: claimEvidenceLinkId,
    organization_id: organizationId,
    claim_id: claimId.id,
    evidence_item_id: evidenceId,
  };
  const evidenceItem = {
    evidence_item_id: evidenceId,
    organization_id: organizationId,
    source_id: sourceId,
    source_version_id: sourceVersionId,
    source_locator_id: locatorId,
    evidence_review_status: "unassessed",
    support_strength: "unassessed",
    sensitivity_level: "internal",
  };
  const locator = {
    source_locator_id: locatorId,
    organization_id: organizationId,
    source_version_id: sourceVersionId,
  };
  const source = { source_id: sourceId, organization_id: organizationId, source_code: `SRC-${n}` };
  const sha = "a".repeat(63) + (n % 10);
  const sourceVersion = {
    source_version_id: sourceVersionId,
    organization_id: organizationId,
    source_id: sourceId,
    intake_source_candidate_id: candidateId,
    intake_sensitivity_profile_id: profileId,
    profile_canonical_sha256: sha,
    is_current: true,
  };
  const candidate = {
    intake_source_candidate_id: candidateId,
    organization_id: organizationId,
    intake_file_id: uid("d1", n),
    file_profile_id: uid("d2", n),
    data_dictionary_id: dictionaryId,
    intake_sensitivity_profile_id: profileId,
    profile_canonical_sha256: sha,
    proposed_source_type: "survey",
    candidate_status: "promoted",
  };
  const decision = {
    intake_promotion_decision_id: decisionId,
    organization_id: organizationId,
    intake_source_candidate_id: candidateId,
    source_id: sourceId,
    source_version_id: sourceVersionId,
    decision_status: "promoted",
  };
  const evidenceReviewQueue = {
    review_queue_item_id: evidenceReviewQueueId,
    organization_id: organizationId,
    queue_type: "evidence_review",
    target_object_type: "evidence_item",
    target_object_id: evidenceId,
    queue_status: "resolved",
    review_status: "resolved",
    updated_at: now,
  };
  const claimReviewQueue = {
    review_queue_item_id: claimReviewQueueId,
    organization_id: organizationId,
    queue_type: "claim_review",
    target_object_type: "claim",
    target_object_id: claimId.id,
    queue_status: "resolved",
    review_status: "resolved",
    updated_at: now,
  };
  const profile = {
    organization_id: organizationId,
    intake_sensitivity_profile_id: profileId,
    intake_file_id: candidate.intake_file_id,
    file_profile_id: candidate.file_profile_id,
    data_dictionary_id: dictionaryId,
    profile_canonical_sha256: sha,
    human_review_required: true,
    public_use_allowed: false,
    funder_use_allowed: false,
    llm_processing_allowed: false,
    product_learning_allowed: false,
    retention_posture: "restricted_pending_review",
    small_cell_risk_status: "absent",
    allowed_use_status: "allowed",
  };
  const dictionary = {
    data_dictionary_id: dictionaryId,
    organization_id: organizationId,
    intake_file_id: candidate.intake_file_id,
    file_profile_id: candidate.file_profile_id,
    profile_canonical_sha256: sha,
    dictionary_status: "final",
  };
  const dictionaryFields = [
    {
      organization_id: organizationId,
      data_dictionary_id: dictionaryId,
      data_dictionary_field_id: uid("e1", n),
      profile_field_key: "field_a",
      data_type: "string",
      business_meaning: "Defined meaning for field_a.",
      entity_level: "household",
      sensitivity: "low",
    },
  ];
  const qualityFindings = stale
    ? [
        {
          organization_id: organizationId,
          data_dictionary_id: dictionaryId,
          data_quality_finding_id: uid("f1", n),
          profile_field_key: "field_a",
          finding_type: "missingness",
          finding_status: "open",
        },
      ]
    : [];
  const evidenceFieldKeys = [{ organization_id: organizationId, source_version_id: sourceVersionId, profile_field_key: "field_a" }];

  const gapIds = Object.fromEntries(DIMENSION_KEYS_WITH_GAPS.map((dim, i) => [dim, uid("11", n * 100 + i)]));
  const gapRows = DIMENSION_KEYS_WITH_GAPS.map((dimensionKey) => ({
    gap_log_item_id: gapIds[dimensionKey],
    organization_id: organizationId,
    claim_id: claimId.id,
    evidence_item_id: evidenceId,
    source_version_id: sourceVersionId,
    dimension_key: dimensionKey,
    assessment_status: "unresolved",
    validator_key: `VAL-KAI-P2-02-${dimensionKey}`,
    safe_summary: `Claim gap requires review for dimension: ${dimensionKey}.`,
    open_finding_count: null,
    field_count: null,
    undefined_field_count: null,
    uncovered_field_count: null,
  }));

  // The two client-answerable dimensions among DIMENSION_KEYS_WITH_GAPS
  // (denominator_clarity, time_period_clarity) each route to exactly one
  // client_followup_item plus its fixed-contract client_followup queue row -
  // followupRowsMatchExpectation/queueRowsMatchExpectation require these to
  // be complete and exact regardless of whether `stale` only changes
  // missingness. Kept identical between the current and stale fixtures so
  // only the missingness gap/finding disagreement drives the current/stale
  // outcome, exactly mirroring the accepted 4658703 regression.
  const followupRows = CLIENT_ANSWERABLE_GAP_DIMENSIONS.map((dimensionKey, i) => ({
    client_followup_item_id: uid("12", n * 100 + i),
    organization_id: organizationId,
    claim_id: claimId.id,
    gap_log_item_id: gapIds[dimensionKey],
    dimension_key: dimensionKey,
    question_text: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey],
  }));
  const followupQueue = followupRows.map((followupRow, i) => ({
    review_queue_item_id: uid("13", n * 100 + i),
    organization_id: organizationId,
    queue_type: "client_followup",
    target_object_type: "client_followup_item",
    target_object_id: followupRow.client_followup_item_id,
    priority: CLIENT_FOLLOWUP_PRIORITY,
    queue_status: CLIENT_FOLLOWUP_QUEUE_STATUS,
    review_status: CLIENT_FOLLOWUP_REVIEW_STATUS,
    assigned_to: null,
    due_at: null,
    summary: CLIENT_FOLLOWUP_SUMMARY,
    required_action: CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[followupRow.dimension_key],
  }));

  return {
    claim,
    claimEvidenceLink,
    evidenceItem,
    locator,
    source,
    sourceVersion,
    candidate,
    decision,
    evidenceReviewQueue,
    claimReviewQueue,
    profile,
    dictionary,
    dictionaryFields,
    qualityFindings,
    evidenceFieldKeys,
    gapRows,
    gapIds,
    followupRows,
    followupQueue,
  };
}

function claimId(n) {
  return { id: uid("c1", n), n };
}

/**
 * A fake transaction that answers every batched query
 * filterCurrentOrganizationEvidenceGaps issues by filtering real in-memory
 * fixture arrays by the actual organization_id/id-array parameters sent -
 * unlike a fixed-response stub, this proves per-claim/per-tenant outcomes and
 * lets query-count be counted meaningfully.
 */
function buildBatchFakeTx(fixtures) {
  const all = (key) => fixtures.flatMap((f) => f[key] ?? []);
  const singles = (key) => fixtures.map((f) => f[key]).filter(Boolean);
  const calls = [];

  function scoped(rows, organizationId, idColumn, ids) {
    const idSet = new Set(ids);
    return rows.filter((row) => row.organization_id === organizationId && idSet.has(row[idColumn]));
  }

  return {
    calls,
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      calls.push(sql);
      if (sql.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
      const [organizationId, ids] = params;

      if (sql.includes("candidate_claims")) {
        // Batched conflict-groups window read - no conflict groups in these
        // fixtures.
        return { rows: [] };
      }
      if (sql.includes("FROM kai.claims")) return { rows: scoped(singles("claim"), organizationId, "claim_id", ids) };
      if (sql.includes("FROM kai.claim_evidence_links")) {
        return { rows: scoped(singles("claimEvidenceLink"), organizationId, "claim_id", ids) };
      }
      if (sql.includes("FROM kai.evidence_items e")) {
        return { rows: scoped(all("evidenceFieldKeys"), organizationId, "source_version_id", ids) };
      }
      if (sql.includes("FROM kai.evidence_items")) {
        return { rows: scoped(singles("evidenceItem"), organizationId, "evidence_item_id", ids) };
      }
      if (sql.includes("FROM kai.source_locators")) {
        return { rows: scoped(singles("locator"), organizationId, "source_locator_id", ids) };
      }
      if (sql.includes("FROM kai.sources")) return { rows: scoped(singles("source"), organizationId, "source_id", ids) };
      if (sql.includes("FROM kai.source_versions")) {
        return { rows: scoped(singles("sourceVersion"), organizationId, "source_version_id", ids) };
      }
      if (sql.includes("FROM kai.intake_source_candidates")) {
        return { rows: scoped(singles("candidate"), organizationId, "intake_source_candidate_id", ids) };
      }
      if (sql.includes("FROM kai.intake_promotion_decisions")) {
        return { rows: scoped(singles("decision"), organizationId, "source_version_id", ids) };
      }
      if (sql.includes("queue_type = 'evidence_review'")) {
        return { rows: scoped(singles("evidenceReviewQueue"), organizationId, "target_object_id", ids) };
      }
      if (sql.includes("queue_type = 'claim_review'")) {
        return { rows: scoped(singles("claimReviewQueue"), organizationId, "target_object_id", ids) };
      }
      if (sql.includes("queue_type = 'client_followup'")) {
        return { rows: scoped(all("followupQueue"), organizationId, "target_object_id", ids) };
      }
      if (sql.includes("queue_type = 'conflict_resolution'")) return { rows: [] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) {
        return { rows: scoped(singles("profile"), organizationId, "intake_sensitivity_profile_id", ids) };
      }
      if (sql.includes("FROM kai.data_dictionary_fields")) {
        return { rows: scoped(all("dictionaryFields"), organizationId, "data_dictionary_id", ids) };
      }
      if (sql.includes("FROM kai.data_quality_findings")) {
        return { rows: scoped(all("qualityFindings"), organizationId, "data_dictionary_id", ids) };
      }
      if (sql.includes("FROM kai.data_dictionaries")) {
        return { rows: scoped(singles("dictionary"), organizationId, "data_dictionary_id", ids) };
      }
      if (sql.includes("FROM kai.gap_log_items")) {
        return { rows: scoped(all("gapRows"), organizationId, "claim_id", ids) };
      }
      if (sql.includes("FROM kai.client_followup_items")) {
        return { rows: scoped(all("followupRows"), organizationId, "claim_id", ids) };
      }

      throw new Error(`Unhandled fake-tx query in Package 4 repair test: ${sql}`);
    },
  };
}

function candidateRowFromGap(gapRow) {
  return {
    gap_log_item_id: gapRow.gap_log_item_id,
    claim_id: gapRow.claim_id,
    dimension_key: gapRow.dimension_key,
    assessment_status: gapRow.assessment_status,
    validator_key: gapRow.validator_key,
  };
}

function actorContext() {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
}

async function runOrgGaps({ organizationId, limit, afterGapLogItemId, candidatePage, fakeTx }) {
  return listOrganizationEvidenceGapsForImpactLibrary(
    {
      organizationId,
      limit,
      afterGapLogItemId: afterGapLogItemId ?? null,
      actorContext: { ...actorContext(), organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "gk_admin" }] },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      runInTransaction: (callback) => callback(fakeTx),
      listOrganizationEvidenceGaps: async () => candidatePage,
    },
  );
}

test("Pagination: stale-only candidate page - items=[], cursor advances past the last SCANNED (stale) candidate, truncated=true, the current lookahead gap stays reachable next page", async () => {
  const claimStaleA = buildClaimFixture(ORG, claimId(1), { stale: true });
  const claimStaleB = buildClaimFixture(ORG, claimId(2), { stale: true });
  const claimCurrentC = buildClaimFixture(ORG, claimId(3), { stale: false });
  const fakeTx = buildBatchFakeTx([claimStaleA, claimStaleB, claimCurrentC]);

  // One gap per claim, in candidate (gap_log_item_id) order: gap1 (stale
  // claim A), gap2 (stale claim B), gap3 (current claim C, the lookahead).
  const gap1 = candidateRowFromGap(claimStaleA.gapRows[0]);
  const gap2 = candidateRowFromGap(claimStaleB.gapRows[0]);
  const gap3 = candidateRowFromGap(claimCurrentC.gapRows[0]);

  const page1 = await runOrgGaps({ organizationId: ORG, limit: 2, candidatePage: [gap1, gap2, gap3], fakeTx });
  assert.equal(page1.ok, true, JSON.stringify(page1));
  assert.deepEqual(page1.data.items, [], "both scanned candidates are stale, so items is empty");
  assert.equal(page1.data.truncated, true, "a lookahead candidate exists beyond the scanned page");
  assert.equal(
    page1.data.nextAfterGapLogItemId,
    gap2.gap_log_item_id,
    "cursor advances past gap2 - the last PERSISTED candidate actually scanned - not stuck before it",
  );

  // Next request (as the assistant/client would issue): the current gap3 is
  // still reachable.
  const page2 = await runOrgGaps({
    organizationId: ORG,
    limit: 2,
    afterGapLogItemId: page1.data.nextAfterGapLogItemId,
    candidatePage: [gap3],
    fakeTx,
  });
  assert.equal(page2.ok, true, JSON.stringify(page2));
  assert.deepEqual(page2.data.items.map((item) => item.gap_log_item_id), [gap3.gap_log_item_id], "gap3 remains reachable on the next page");
  assert.equal(page2.data.truncated, false);
  assert.equal(page2.data.nextAfterGapLogItemId, null);
});

test("Pagination: partially-stale candidate page - only the current member of the scanned page is returned, cursor still advances past the stale row, lookahead stays reachable", async () => {
  const claimCurrentA = buildClaimFixture(ORG, claimId(11), { stale: false });
  const claimStaleB = buildClaimFixture(ORG, claimId(12), { stale: true });
  const claimCurrentC = buildClaimFixture(ORG, claimId(13), { stale: false });
  const fakeTx = buildBatchFakeTx([claimCurrentA, claimStaleB, claimCurrentC]);

  const gap1 = candidateRowFromGap(claimCurrentA.gapRows[0]); // current
  const gap2 = candidateRowFromGap(claimStaleB.gapRows[0]); // stale
  const gap3 = candidateRowFromGap(claimCurrentC.gapRows[0]); // current, lookahead

  const page1 = await runOrgGaps({ organizationId: ORG, limit: 2, candidatePage: [gap1, gap2, gap3], fakeTx });
  assert.equal(page1.ok, true, JSON.stringify(page1));
  assert.deepEqual(
    page1.data.items.map((item) => item.gap_log_item_id),
    [gap1.gap_log_item_id],
    "gap1 is returned; gap2 is filtered but does not block gap1",
  );
  assert.equal(page1.data.truncated, true);
  assert.equal(
    page1.data.nextAfterGapLogItemId,
    gap2.gap_log_item_id,
    "cursor is the last SCANNED persisted candidate (gap2, stale), never the last CURRENT one (gap1)",
  );

  const page2 = await runOrgGaps({
    organizationId: ORG,
    limit: 2,
    afterGapLogItemId: page1.data.nextAfterGapLogItemId,
    candidatePage: [gap3],
    fakeTx,
  });
  assert.equal(page2.ok, true, JSON.stringify(page2));
  assert.deepEqual(page2.data.items.map((item) => item.gap_log_item_id), [gap3.gap_log_item_id], "gap3 (current) remains reachable on the next page");
});

test("Multi-claim boundedness: repository query count is constant regardless of the number of distinct candidate claims, with no query inside a per-claim loop", async () => {
  const claims = Array.from({ length: 8 }, (_, i) => buildClaimFixture(ORG, claimId(20 + i), { stale: i % 3 === 0 }));
  const fakeTx = buildBatchFakeTx(claims);
  const candidatePage = claims.map((claim) => candidateRowFromGap(claim.gapRows[0]));

  const result = await runOrgGaps({ organizationId: ORG, limit: 25, candidatePage, fakeTx });
  assert.equal(result.ok, true, JSON.stringify(result));

  const expectedCurrent = claims.filter((_, i) => i % 3 !== 0).map((claim) => claim.gapRows[0].gap_log_item_id);
  assert.deepEqual(
    result.data.items.map((item) => item.gap_log_item_id).sort(),
    expectedCurrent.sort(),
    "exactly the claims whose current-state gates pass are returned, across 8 distinct claims",
  );

  // No-per-claim-fan-out proof: query count must not grow with the number of
  // distinct candidate claims. Compare the query count for this 8-claim page
  // against a single-claim page built from the exact same kind of fixture -
  // filterCurrentOrganizationEvidenceGaps issues the same fixed set of
  // batched reads (claims, claim_evidence_links, evidence_items,
  // source_locators, sources, source_versions, intake_source_candidates,
  // intake_promotion_decisions, evidence_review queue, claim_review queue,
  // sensitivity profiles, dictionaries, dictionary fields, quality findings,
  // evidence-coverage field keys, gap_log_items, client_followup_items,
  // client_followup queue, conflict_groups, conflict_resolution queue - see
  // postgresOrganizationEvidenceGapCurrentStateRepository.js) whether the
  // candidate page references 1 claim or 8.
  const nonIsolationCalls = fakeTx.calls.filter((sql) => !sql.startsWith("SET TRANSACTION ISOLATION LEVEL"));

  const oneClaim = [buildClaimFixture(ORG, claimId(99), { stale: false })];
  const oneClaimFakeTx = buildBatchFakeTx(oneClaim);
  const oneClaimResult = await runOrgGaps({
    organizationId: ORG,
    limit: 25,
    candidatePage: [candidateRowFromGap(oneClaim[0].gapRows[0])],
    fakeTx: oneClaimFakeTx,
  });
  assert.equal(oneClaimResult.ok, true, JSON.stringify(oneClaimResult));
  const oneClaimCalls = oneClaimFakeTx.calls.filter((sql) => !sql.startsWith("SET TRANSACTION ISOLATION LEVEL"));

  assert.equal(
    nonIsolationCalls.length,
    oneClaimCalls.length,
    `query count must be identical for 8 distinct claims (${nonIsolationCalls.length}) and 1 claim (${oneClaimCalls.length}) - no per-claim fan-out`,
  );
  // Sanity bound: never more than the 20 documented batched-read call sites.
  assert.ok(nonIsolationCalls.length <= 20, `expected at most 20 batched reads, got ${nonIsolationCalls.length}`);
});

test("Tenant isolation: organization A's candidate page can never be validated as current using organization B's rows", async () => {
  // A claim with the SAME claim id exists satisfying every current-state gate
  // for OTHER_ORG, but organization A's candidate gap references a claim id
  // that does not exist for ORG at all (cross-tenant confusion attempt).
  const orgBClaim = buildClaimFixture(OTHER_ORG, claimId(30), { stale: false });
  const fakeTx = buildBatchFakeTx([orgBClaim]);

  const crossTenantGap = {
    gap_log_item_id: orgBClaim.gapRows[0].gap_log_item_id,
    claim_id: orgBClaim.claim.claim_id,
    dimension_key: orgBClaim.gapRows[0].dimension_key,
    assessment_status: "unresolved",
    validator_key: orgBClaim.gapRows[0].validator_key,
  };

  const result = await runOrgGaps({ organizationId: ORG, limit: 25, candidatePage: [crossTenantGap], fakeTx });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.data.items,
    [],
    "every batched read is organization_id = ORG scoped, so organization B's fully-current claim can never satisfy organization A's lookup - the gap is omitted, fail-closed",
  );
});

test("claimIsCurrentForGapExposure classifies a fully-current claim as current and an otherwise-identical stale claim as stale", () => {
  const { claimIsCurrentForGapExposure } = __organizationEvidenceGapCurrentStateRepositoryTestables;
  const current = buildClaimFixture(ORG, claimId(40), { stale: false });
  const stale = buildClaimFixture(ORG, claimId(41), { stale: true });

  function toBatches(fixture) {
    return {
      claimsById: new Map([[fixture.claim.claim_id, fixture.claim]]),
      claimEvidenceLinksByClaimId: new Map([[fixture.claim.claim_id, fixture.claimEvidenceLink]]),
      evidenceItemsById: new Map([[fixture.evidenceItem.evidence_item_id, fixture.evidenceItem]]),
      sourceLocatorsById: new Map([[fixture.locator.source_locator_id, fixture.locator]]),
      sourcesById: new Map([[fixture.source.source_id, fixture.source]]),
      sourceVersionsById: new Map([[fixture.sourceVersion.source_version_id, fixture.sourceVersion]]),
      candidatesById: new Map([[fixture.candidate.intake_source_candidate_id, fixture.candidate]]),
      decisionsBySourceVersionId: new Map([[fixture.decision.source_version_id, fixture.decision]]),
      evidenceReviewQueueByEvidenceItemId: new Map([[fixture.evidenceReviewQueue.target_object_id, fixture.evidenceReviewQueue]]),
      claimReviewQueueByClaimId: new Map([[fixture.claimReviewQueue.target_object_id, fixture.claimReviewQueue]]),
      profilesById: new Map([[fixture.profile.intake_sensitivity_profile_id, fixture.profile]]),
      dictionariesById: new Map([[fixture.dictionary.data_dictionary_id, fixture.dictionary]]),
      dictionaryFieldsByDictionaryId: new Map([[fixture.dictionary.data_dictionary_id, fixture.dictionaryFields]]),
      qualityFindingsByDictionaryId: new Map([[fixture.dictionary.data_dictionary_id, fixture.qualityFindings]]),
      evidenceFieldKeysBySourceVersionId: new Map([[fixture.sourceVersion.source_version_id, fixture.evidenceFieldKeys.map((r) => r.profile_field_key)]]),
      gapRowsByClaimId: new Map([[fixture.claim.claim_id, fixture.gapRows]]),
      followupRowsByClaimId: new Map([[fixture.claim.claim_id, fixture.followupRows]]),
      followupQueueByFollowupId: new Map(fixture.followupQueue.map((row) => [row.target_object_id, row])),
      conflictGroupsByClaimId: new Map(),
      conflictQueueByConflictGroupId: new Map(),
    };
  }

  assert.equal(claimIsCurrentForGapExposure(current.claim.claim_id, toBatches(current)), true);
  assert.equal(claimIsCurrentForGapExposure(stale.claim.claim_id, toBatches(stale)), false);
});
