import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  listImpactEvidence,
  explainImpactEvidence,
} from "../Backend/kai/services/kaiImpactIntelligenceService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const actorContext = {
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
  ],
};

function candidateRow(overrides = {}) {
  return {
    claimId: CLAIM,
    evidenceItemId: EVIDENCE,
    claimType: "impact_metric",
    claimStatus: "draft",
    claimReviewStatus: "needs_review",
    claimStrength: "unassessed",
    reviewQueueItems: [
      {
        review_queue_item_id: "80000000-0000-4000-8000-000000000001",
        queue_type: "claim_review",
        target_object_type: "claim",
        target_object_id: CLAIM,
        queue_status: "open",
        review_status: null,
      },
    ],
    ...overrides,
  };
}

function traceabilitySummary(overrides = {}) {
  return {
    claim: {
      claim_id: CLAIM,
      claim_type: "impact_metric",
      claim_status: "draft",
      claim_review_status: "needs_review",
      claim_strength: "unassessed",
      audience_gates: {
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        export_ready: false,
      },
    },
    evidence: {
      evidence_item_id: EVIDENCE,
      evidence_review_status: "not_reviewed",
      support_strength: "unassessed",
      review_queue_item_id: "80000000-0000-4000-8000-000000000001",
      review_queue_status: "open",
      review_status: null,
      updated_at: "2026-08-01T00:00:00.000Z",
      sensitivity_level: "restricted",
    },
    locator: { source_locator_id: "70000000-0000-4000-8000-000000000001" },
    source: { source_id: "60000000-0000-4000-8000-000000000001", source_code: "intake_csv" },
    source_version: { source_version_id: "50000000-0000-4000-8000-000000000001", is_current: true },
    claim_review: null,
    candidate: null,
    promotion_decision: null,
    dimensions: {},
    gap_items: [],
    client_followup_workflows: [],
    potential_conflict_groups: [],
    requestedAudience: "internal",
    eligible: false,
    blockerCodes: ["support_strength_unassessed", "claim_review_unresolved"],
    affectedDimensionKeys: [],
    affectedObjectIds: [],
    truncated: false,
    ...overrides,
  };
}

test("listImpactEvidence derives ImpactEvidenceView items from the governed claim-library result, not independent persistence", async () => {
  const seen = [];
  const stub = {
    async listClaimLibraryCandidates(input) {
      seen.push(input);
      return {
        ok: true,
        data: { items: [candidateRow()], limit: 25, afterClaimId: null, truncated: false, nextAfterClaimId: null },
        error: null,
      };
    },
  };

  const result = await listImpactEvidence(
    { organizationId: ORG, limit: 25, afterClaimId: null, actorContext },
    { listClaimLibraryCandidates: stub.listClaimLibraryCandidates },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, [{ organizationId: ORG, limit: 25, afterClaimId: null, actorContext }]);
  assert.equal(result.data.items.length, 1);
  const item = result.data.items[0];
  assert.equal(item.kind, "impact_evidence_view");
  assert.equal(item.claimId, CLAIM);
  assert.equal(item.evidenceItemId, EVIDENCE);
  assert.equal(item.claimStrength, "unassessed", "governance state must pass through, not be strengthened");
});

test("listImpactEvidence passes through governed failures (authorization/tenant) unchanged and never widens access", async () => {
  const authDenied = {
    async listClaimLibraryCandidates() {
      return { ok: false, data: null, error: { code: "authorization_denied" } };
    },
  };
  const tenantDenied = {
    async listClaimLibraryCandidates() {
      return { ok: false, data: null, error: { code: "tenant_boundary_violation" } };
    },
  };

  const authResult = await listImpactEvidence(
    { organizationId: OTHER_ORG, limit: 25, afterClaimId: null, actorContext },
    { listClaimLibraryCandidates: authDenied.listClaimLibraryCandidates },
  );
  assert.equal(authResult.ok, false);
  assert.equal(authResult.error.code, "authorization_denied");
  assert.equal(authResult.data, null);

  const tenantResult = await listImpactEvidence(
    { organizationId: OTHER_ORG, limit: 25, afterClaimId: null, actorContext },
    { listClaimLibraryCandidates: tenantDenied.listClaimLibraryCandidates },
  );
  assert.equal(tenantResult.ok, false);
  assert.equal(tenantResult.error.code, "tenant_boundary_violation");
});

test("explainImpactEvidence derives ImpactEvidenceView from the governed traceability summary and forwards exact input", async () => {
  const seen = [];
  const stub = async (input) => {
    seen.push(input);
    return { ok: true, data: traceabilitySummary(), error: null };
  };

  const result = await explainImpactEvidence(
    { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext },
    { getClaimTraceabilitySummary: stub },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, [{ organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext }]);
  assert.equal(result.data.kind, "impact_evidence_view");
  assert.equal(result.data.claim.claim_id, CLAIM);
  assert.equal(result.data.evidence.evidence_item_id, EVIDENCE);
  assert.deepEqual(result.data.source, { source_id: "60000000-0000-4000-8000-000000000001", source_code: "intake_csv" });
});

test("explanation narrative preserves distinct governance states truthfully without promoting them", async () => {
  const stub = async () => ({ ok: true, data: traceabilitySummary(), error: null });
  const result = await explainImpactEvidence(
    { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext },
    { getClaimTraceabilitySummary: stub },
  );

  const narrative = result.data.narrative.join(" | ");
  assert.match(narrative, /Support strength is recorded as "unassessed"/);
  assert.match(narrative, /Sensitivity level is recorded as "restricted"/);
  assert.match(narrative, /Evidence review status is recorded as "not_reviewed"/);
  assert.match(narrative, /Eligibility for the internal audience is false/);
  assert.match(narrative, /Blocking reasons is recorded as: support_strength_unassessed, claim_review_unresolved/);

  assert.doesNotMatch(narrative, /medium confidence/i);
  assert.doesNotMatch(narrative, /approved/i);
  assert.doesNotMatch(narrative, /\btrue\b/, "eligible=false must never render as eligible/true");
  assert.equal(result.data.eligible, false);
  assert.deepEqual(result.data.blockerCodes, ["support_strength_unassessed", "claim_review_unresolved"]);
});

test("explanation truthfully represents absent governed information instead of inventing a value", async () => {
  const stub = async () =>
    ({
      ok: true,
      data: traceabilitySummary({
        evidence: {
          evidence_item_id: EVIDENCE,
          evidence_review_status: "unknown",
          support_strength: "unassessed",
          review_queue_item_id: null,
          review_queue_status: null,
          review_status: null,
          updated_at: null,
          sensitivity_level: null,
        },
      }),
      error: null,
    });

  const result = await explainImpactEvidence(
    { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext },
    { getClaimTraceabilitySummary: stub },
  );

  assert.match(result.data.narrative.join(" | "), /Sensitivity level is not recorded\./);
  assert.equal(result.data.evidence.sensitivity_level, null);
});

test("explainImpactEvidence passes through governed failures unchanged", async () => {
  const stub = async () => ({ ok: false, data: null, error: { code: "not_found" } });
  const result = await explainImpactEvidence(
    { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal", actorContext },
    { getClaimTraceabilitySummary: stub },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("Package 3C service introduces no persistence, SQL, or write path", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiImpactIntelligenceService.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bCREATE TABLE\b/i);
  assert.doesNotMatch(source, /pg-pool|require\("pg"\)|from "pg"/);
  assert.doesNotMatch(source, /impact_facts/i);
  assert.match(source, /import \{ listClaimLibraryCandidates \} from "\.\/kaiClaimLibraryService\.js"/);
  assert.match(source, /import \{ getClaimTraceabilitySummary \} from "\.\/kaiClaimTraceabilityService\.js"/);
});
