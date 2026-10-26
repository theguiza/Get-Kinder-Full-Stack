import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import {
  claimLibraryCandidatesPath,
  evidenceLibraryCandidatesPath,
  projectCandidateClaims,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_READINESS_MESSAGES,
  STRUCTURAL_ONLY_DRAFT_MESSAGE,
  claimInternalDraftSelectability,
  claimInternalUse,
  claimKind,
  claimSelectabilityMessage,
  internalDraftReadiness,
  isStructuralOnlyDraft,
  orderClaimsForReports,
  retainSelectableClaimIds,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

/**
 * Customer source-to-report correction (owner prompt 2026-10-26): the
 * customer's Claim Library read is paged and organization-wide, so the
 * measured claim could be hidden behind legacy structural claims, and every
 * claim looked the same. The browser proof is
 * kai-customer-measured-report-selection-browser-acceptance.integration.spec.js.
 */

const ORG = "0d000000-0000-4000-8000-0000000000a1";
const ENGAGEMENT = "7d000000-0000-4000-8000-0000000000e1";
const id = (n) => `3d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const claim = (n, evidenceType, extra = {}) => ({
  claimId: id(n), evidenceItemId: id(100 + n), evidenceType, claimStrength: "unassessed", claimReviewStatus: "needs_gk_review", ...extra,
});
const MEASURED = claim(1, "source_record_count_measurement");
const FIELD_2 = claim(2, "dictionary_field_presence_fact");
const UNKNOWN = claim(3, null);

test("the Claim Library candidate read projects each claim's evidence type; an absent type stays null", async () => {
  const actorContext = {
    actorType: "human", actorUserId: id(900), kaiRoles: [], platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, role_name: "client_admin", membership_status: "active" }],
  };
  const row = (n, evidenceType) => ({
    claim_id: id(n), organization_id: ORG, evidence_item_id: id(100 + n), claim_type: "finding", claim_status: "proposed",
    claim_review_status: "needs_gk_review", claim_strength: "unassessed", review_queue_items: [], claim_statement: "A statement.",
    ...(evidenceType === undefined ? {} : { evidence_type: evidenceType }),
  });
  const result = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext }, {
    env: { KAI_SPRINT2_ENABLED: "true" },
    listClaimLibraryReviewCandidates: async () => [row(1, "source_record_count_measurement"), row(2, "dictionary_field_presence_fact"), row(3, undefined)],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.data.items.map((item) => item.evidenceType), ["source_record_count_measurement", "dictionary_field_presence_fact", null]);
  const malformed = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext }, {
    env: { KAI_SPRINT2_ENABLED: "true" },
    listClaimLibraryReviewCandidates: async () => [row(1, "Not A Token")],
  });
  assert.equal(malformed.error.code, "system_error", "a malformed type is refused, never passed through");
  assert.deepEqual(projectCandidateClaims({ items: result.data.items }).map((item) => item.evidenceType),
    ["source_record_count_measurement", "dictionary_field_presence_fact", null]);
});

test("the library paths keep their first-page form and add the server's cursor for later pages", () => {
  assert.equal(claimLibraryCandidatesPath(ORG), `/api/kai/sprint2/intake/admin/organizations/${ORG}/claim-library/candidates?limit=25`);
  assert.equal(claimLibraryCandidatesPath(ORG, id(7)), `/api/kai/sprint2/intake/admin/organizations/${ORG}/claim-library/candidates?limit=25&after_claim_id=${id(7)}`);
  assert.equal(evidenceLibraryCandidatesPath(ORG), `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-library/candidates?limit=25`);
  assert.equal(evidenceLibraryCandidatesPath(ORG, id(8)),
    `/api/kai/sprint2/intake/admin/organizations/${ORG}/evidence-library/candidates?limit=25&after_evidence_item_id=${id(8)}`);
});

test("a structural fact is labelled and is not offered as an impact finding; a measured claim and an unknown type stay selectable", () => {
  assert.deepEqual([claimKind(MEASURED), claimKind(FIELD_2), claimKind(UNKNOWN), claimKind(undefined)], ["measurement", "structural", "other", "other"]);
  assert.deepEqual(claimInternalDraftSelectability(MEASURED), { selectable: true, reason: null });
  assert.deepEqual(claimInternalDraftSelectability(FIELD_2), { selectable: false, reason: "structural_fact" });
  assert.deepEqual(claimInternalDraftSelectability(UNKNOWN), { selectable: true, reason: null });
  assert.deepEqual(claimInternalDraftSelectability({ ...MEASURED, claimStrength: "reviewed_not_supported" }), { selectable: false, reason: "reviewed_not_supported" });
  assert.match(claimSelectabilityMessage("structural_fact"), /^Structural fact: .*not a measured result/);
  assert.deepEqual(retainSelectableClaimIds([MEASURED.claimId, FIELD_2.claimId], [MEASURED, FIELD_2]), [MEASURED.claimId]);
});

test("readiness needs a measured finding: none yet sends the customer to Count records; a selection without one is refused; the old shape is unchanged", () => {
  const base = { canGenerate: true, engagementId: ENGAGEMENT };
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [FIELD_2] }), { ready: false, reason: "no_measured_claim" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [FIELD_2.claimId], claims: [FIELD_2] }), { ready: false, reason: "no_measured_claim" });
  assert.match(INTERNAL_DRAFT_READINESS_MESSAGES.no_measured_claim, /Count records/);
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [MEASURED, FIELD_2] }), { ready: false, reason: "no_claims_selected" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [UNKNOWN.claimId], claims: [MEASURED, UNKNOWN] }), { ready: false, reason: "no_measured_claim_selected" });
  assert.ok(INTERNAL_DRAFT_READINESS_MESSAGES.no_measured_claim_selected);
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [MEASURED.claimId, UNKNOWN.claimId], claims: [MEASURED, UNKNOWN] }), { ready: true, reason: null });
  // Authorization and Project still come first.
  assert.deepEqual(internalDraftReadiness({ ...base, canGenerate: false, selectedClaimIds: [], claims: [] }), { ready: false, reason: "not_authorized" });
  assert.deepEqual(internalDraftReadiness({ ...base, engagementId: "", selectedClaimIds: [], claims: [] }), { ready: false, reason: "no_project" });
  // Without the loaded claims (the earlier call shape) nothing new is required.
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [FIELD_2.claimId] }), { ready: true, reason: null });
});

test("measured findings are listed first, then other claims, then structural facts, each group in the server's order", () => {
  const ordered = orderClaimsForReports([FIELD_2, UNKNOWN, claim(4, "dictionary_field_presence_fact"), MEASURED, claim(5, "source_record_count_measurement")]);
  assert.deepEqual(ordered.map((item) => item.claimId), [MEASURED.claimId, id(5), UNKNOWN.claimId, FIELD_2.claimId, id(4)]);
  assert.deepEqual(orderClaimsForReports(null), []);
});

test("internal usability comes from the authoritative impact-facts read; a failed or truncated read is unknown, never 'not usable'", () => {
  const facts = { claimIds: new Set([MEASURED.claimId]), truncated: false };
  assert.equal(claimInternalUse(MEASURED.claimId, facts), "usable");
  assert.equal(claimInternalUse(FIELD_2.claimId, facts), "not_usable");
  assert.equal(claimInternalUse(FIELD_2.claimId, { ...facts, truncated: true }), "unknown");
  assert.equal(claimInternalUse(MEASURED.claimId, null), "unknown");
  assert.equal(claimInternalUse(MEASURED.claimId, []), "unknown");
});

test("a saved draft citing only structural facts is a metadata-only draft; any measured or unknown citation is not", () => {
  const byId = new Map([MEASURED, FIELD_2, UNKNOWN].map((item) => [item.claimId, item]));
  const draft = (...claimIds) => ({ blocks: [{ supportingClaimIds: claimIds }] });
  assert.equal(isStructuralOnlyDraft(draft(FIELD_2.claimId), byId), true);
  assert.equal(isStructuralOnlyDraft(draft(FIELD_2.claimId, MEASURED.claimId), byId), false);
  assert.equal(isStructuralOnlyDraft(draft(FIELD_2.claimId, id(99)), byId), false, "an unloaded claim is never assumed structural");
  assert.equal(isStructuralOnlyDraft(draft(), byId), false);
  assert.match(STRUCTURAL_ONLY_DRAFT_MESSAGE, /^Structural facts only: .*kept as it was generated.*generate a new draft/);
});

test("UI wiring: every library page is read, eligibility comes from impact-facts, the idempotency key is retired after a draft, and drafts are newest first", () => {
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  assert.match(workflow, /useOrganizationRead\(organizationId, claimLibraryCandidatesPath, projectCandidateClaims, refreshToken, nextClaimPage\)/);
  assert.match(workflow, /useOrganizationRead\(organizationId, evidenceLibraryCandidatesPath, projectEvidenceLibraryItems, refreshToken, nextEvidencePage\)/);
  assert.match(workflow, /useOrganizationRead\(organizationId, clientImpactFactsPath, projectInternalUse, refreshToken\)/);
  assert.match(workflow, /const result = await getJson\(path\(organizationId, cursor\)\);/);
  assert.match(workflow, /claims: claims\.status === "success" \? claims\.items : undefined/);
  assert.match(workflow, /\{orderedClaims\.map\(\(claim\) => \{/);
  assert.match(workflow, /data-client-claim-kind=\{kind\} data-client-claim-internal-use=\{use\}/);
  assert.match(workflow, /const \{ \[contentType\]: _retired, \.\.\.rest \} = current;/);
  assert.doesNotMatch(workflow, /Every item awaits evidence review|Internal drafts may use claims still awaiting review/);
  const drafts = readFileSync(new URL("../frontend/knowledgeStudio/ClientInternalDrafts.jsx", import.meta.url), "utf8");
  assert.match(drafts, /\[\.\.\.projected\.items\]\.sort\(\(a, b\) => String\(b\.createdAt \|\| ""\)\.localeCompare\(String\(a\.createdAt \|\| ""\)\)\)/);
  assert.match(drafts, /const nextActions = structuralOnly \? \[\] : internalDraftFactualReviewNextActions\(view\.blockedReasons\);/);
});
