import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as workflowLogic from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";

import { listClaimLibraryCandidates } from "../Backend/kai/services/kaiClaimLibraryService.js";
import {
  claimLibraryCandidatesPath,
  evidenceLibraryCandidatesPath,
  projectCandidateClaims,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  CLIENT_INTERNAL_REPORT_REASONS,
  projectClientInternalDraft,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS,
  INTERNAL_DRAFT_READINESS_MESSAGES,
  INTERNAL_REPORT_REASON_MESSAGES,
  STRUCTURAL_ONLY_DRAFT_MESSAGE,
  claimDraftAdmission,
  claimDraftAdmitted,
  claimInternalDraftSelectability,
  claimUsePresentation,
  provisionalDraftRefusalMessage,
  claimInternalUse,
  claimKind,
  claimNotUsableMessage,
  claimProposalResultMessage,
  claimSelectabilityMessage,
  claimUseDiagnosis,
  claimsToDiagnose,
  internalDraftFailureMessage,
  internalDraftReadiness,
  isStructuralOnlyDraft,
  mergeInternalDraftPages,
  orderClaimsForReports,
  readLibraryPages,
  retainSelectableClaimIds,
  selectionReportUsability,
  selectionReportUsabilityMessage,
} from "../frontend/knowledgeStudio/clientEvidenceWorkflowLogic.js";
import {
  STRUCTURAL_FACTS_ONLY_REASON,
  evaluateInternalReportAvailabilityInTransaction,
} from "../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js";

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

test("a historical record count opens only the same logical source's single current version, without transferring claim authority", () => {
  const { currentRecordCountRecoveryVersion } = workflowLogic;
  assert.equal(typeof currentRecordCountRecoveryVersion, "function", "historical counts need a route to their current source's counting workflow");
  const historical = { ...MEASURED, evidenceSourceId: id(700), evidenceSourceVersionId: id(701), evidenceSourceVersionIsCurrent: false };
  const current = { sourceVersionId: id(702), sourceId: id(700), isCurrent: true };
  const sources = [{ sourceId: id(700), sourceVersions: [{ sourceVersionId: id(701), isCurrent: false }, current] },
    { sourceId: id(800), sourceVersions: [{ sourceVersionId: id(801), isCurrent: true }] }];
  assert.deepEqual(currentRecordCountRecoveryVersion(historical, sources), current);
  assert.equal(claimInternalDraftSelectability(historical).selectable, false);
  assert.equal(currentRecordCountRecoveryVersion({ ...historical, evidenceSourceVersionIsCurrent: true }, sources), null);
  assert.deepEqual(currentRecordCountRecoveryVersion({ ...historical, evidenceSourceVersionIsCurrent: true }, sources,
    { conflictReason: "source_version_not_current" }), current, "a fresh diagnostic can establish the historical state");
  for (const candidate of [{ ...historical, evidenceSourceId: null }, { ...historical, evidenceType: "source_derived_measurement" }, FIELD_2]) {
    assert.equal(currentRecordCountRecoveryVersion(candidate, sources), null, "record counting cannot replace another kind of finding");
  }
  assert.equal(currentRecordCountRecoveryVersion(historical, [sources[1]]), null, "an independent source is never a replacement");
  assert.equal(currentRecordCountRecoveryVersion(historical, [{ ...sources[0], sourceVersions: [current, { ...current, sourceVersionId: id(703) }] }]), null,
    "ambiguous currentness offers no inferred target");
  assert.equal(currentRecordCountRecoveryVersion(historical, [{ ...sources[0], sourceVersions: [{ ...current, sourceVersionId: id(701) }] }]), null);
});

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

test("readiness needs a substantive finding: none yet sends the customer to Count records only when every claim is loaded; a selection of structural facts alone is refused", () => {
  const base = { canGenerate: true, engagementId: ENGAGEMENT };
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [FIELD_2] }), { ready: false, reason: "no_measured_claim" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [FIELD_2.claimId], claims: [FIELD_2] }), { ready: false, reason: "no_measured_claim" });
  assert.match(INTERNAL_DRAFT_READINESS_MESSAGES.no_measured_claim, /Count records/);
  // An incomplete read never concludes "no measured finding".
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [FIELD_2], claimsComplete: false }), { ready: false, reason: "claims_not_all_loaded" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [], claimsComplete: false }), { ready: false, reason: "claims_not_all_loaded" });
  assert.match(INTERNAL_DRAFT_READINESS_MESSAGES.claims_not_all_loaded, /Load more claims/);
  assert.doesNotMatch(INTERNAL_DRAFT_READINESS_MESSAGES.claims_not_all_loaded, /No measured finding|Get Kinder/);
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [], claims: [MEASURED, FIELD_2] }), { ready: false, reason: "no_claims_selected" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [FIELD_2.claimId], claims: [MEASURED, FIELD_2] }), { ready: false, reason: "no_measured_claim_selected" });
  assert.ok(INTERNAL_DRAFT_READINESS_MESSAGES.no_measured_claim_selected);
  // A non-structural claim of another (or unknown) type is not refused for not being a record count.
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [UNKNOWN.claimId], claims: [MEASURED, UNKNOWN] }), { ready: true, reason: null });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [MEASURED.claimId, UNKNOWN.claimId], claims: [MEASURED, UNKNOWN] }), { ready: true, reason: null });
  // A measured claim found on a later page makes an incomplete read ready.
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [MEASURED.claimId], claims: [FIELD_2, MEASURED], claimsComplete: false }), { ready: true, reason: null });
  // Authorization and Project still come first.
  assert.deepEqual(internalDraftReadiness({ ...base, canGenerate: false, selectedClaimIds: [], claims: [] }), { ready: false, reason: "not_authorized" });
  assert.deepEqual(internalDraftReadiness({ ...base, engagementId: "", selectedClaimIds: [], claims: [] }), { ready: false, reason: "no_project" });
  // Without the loaded claims (the earlier call shape) nothing new is required.
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [FIELD_2.claimId] }), { ready: true, reason: null });
});

test("the measurement panel reports persistence without implying every measurement awaits Get Kinder review", () => {
  const panel = readFileSync(new URL("../frontend/knowledgeStudio/ClientSourceMeasurementPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /Definition and measurement recorded\./);
  assert.doesNotMatch(panel, /awaits evidence review/);
  assert.match(panel, /Check current internal-use eligibility under Claims for internal drafts/);
  assert.doesNotMatch(panel, /before it can be used beyond internal drafts/);
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

test("a claim omitted from a truncated impact-facts read is resolved by its own P2-06 diagnostic, which is preferred when determinate", () => {
  const truncated = { claimIds: new Set(), truncated: true };
  const usable = claimUseDiagnosis({ statusCode: 200, body: { ok: true, data: { traceability_passed: true, eligible: true, blocker_codes: [] } } });
  const UNKNOWN_DRAFT = { status: "unknown", blockerCodes: [], sourceRole: null };
  assert.deepEqual(usable, { status: "usable", blockerCodes: [], conflictReason: null, provisional: UNKNOWN_DRAFT });
  assert.equal(claimInternalUse(MEASURED.claimId, truncated, new Map([[MEASURED.claimId, usable]])), "usable");
  const blocked = claimUseDiagnosis({ statusCode: 200, body: { ok: true, data: {
    traceability_passed: true, eligible: false, blocker_codes: ["evidence_review_unresolved", "claim_review_unresolved", "Not A Code"],
  } } });
  assert.deepEqual(blocked, { status: "not_usable", blockerCodes: ["evidence_review_unresolved", "claim_review_unresolved"], conflictReason: null, provisional: UNKNOWN_DRAFT });
  assert.equal(claimInternalUse(MEASURED.claimId, { claimIds: new Set([MEASURED.claimId]), truncated: false }, new Map([[MEASURED.claimId, blocked]])), "not_usable",
    "the claim's own fresher evaluation wins");
  const stale = claimUseDiagnosis({ statusCode: 409, body: { ok: false, error: { code: "conflict_current_state_changed" }, data: { traceability_conflict_reason: "source_version_not_current" } } });
  assert.deepEqual(stale, { status: "not_usable", blockerCodes: [], conflictReason: "source_version_not_current", provisional: { status: "refused", blockerCodes: [], sourceRole: null } });
  for (const result of [{ statusCode: 500, body: null }, { statusCode: 403, body: { ok: false } }, { statusCode: 409, body: { ok: false, error: { code: "conflict_current_state_changed" }, data: { traceability_conflict_reason: "made_up" } } }]) {
    const unknown = claimUseDiagnosis(result);
    assert.equal(unknown.status, "unknown");
    assert.equal(claimInternalUse(MEASURED.claimId, truncated, new Map([[MEASURED.claimId, unknown]])), "unknown", "an inconclusive diagnosis is not adverse");
  }
  // The actual condition is named; review wording appears only for a review blocker, with the ordinary rule beside it.
  assert.match(claimNotUsableMessage(blocked), /^Not usable in internal reports now: the ordinary record-count rule does not cover it/);
  assert.match(claimNotUsableMessage(blocked), /Processing permissions/);
  // Package 3: the record-count rule note (Count records, Processing permissions) is only for a record-count finding.
  for (const kind of ["other", "structural"]) assert.doesNotMatch(claimNotUsableMessage(blocked, { kind }), /Processing permissions|Count records/, kind);
  assert.match(claimNotUsableMessage(stale), /recorded as non-current/);
  const followup = { status: "not_usable", blockerCodes: ["client_followup_unresolved"], conflictReason: null };
  assert.match(claimNotUsableMessage(followup), /follow-up question about it is unanswered\.$/);
  assert.doesNotMatch(claimNotUsableMessage(followup), /Get Kinder/, "no review request where a review would not resolve the condition");
});

test("the claims diagnosed one by one: substantive claims impact-facts does not show as usable, selected claims, bounded, never twice", () => {
  const OTHER_MEASURED = claim(6, "source_record_count_measurement");
  const facts = { claimIds: new Set([MEASURED.claimId]), truncated: true };
  const claims = [MEASURED, FIELD_2, UNKNOWN, OTHER_MEASURED];
  // Package 3: a claim impact-facts shows as usable is diagnosed too (last), because strict
  // eligibility does not establish that it may be sent to the model for a new draft.
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: facts }), [UNKNOWN.claimId, OTHER_MEASURED.claimId, MEASURED.claimId]);
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: facts, selectedClaimIds: [FIELD_2.claimId] }), [FIELD_2.claimId, UNKNOWN.claimId, OTHER_MEASURED.claimId, MEASURED.claimId]);
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: facts, diagnostics: new Map([[UNKNOWN.claimId, { status: "usable" }]]) }), [OTHER_MEASURED.claimId, MEASURED.claimId]);
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: facts, limit: 1 }), [UNKNOWN.claimId]);
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: facts, limit: -3 }), [], "a spent budget diagnoses nothing");
  assert.deepEqual(claimsToDiagnose({ claims, impactFacts: null }), [MEASURED.claimId, UNKNOWN.claimId, OTHER_MEASURED.claimId], "a failed impact-facts read is resolved per claim");
});

test("Package 3: a claim's use in a new internal draft is the server's provisional admission, never inferred from currentness or strict P2-06", () => {
  const RESTRICTED = claim(8, "source_record_count_measurement");
  const ok = (data) => claimUseDiagnosis({ statusCode: 200, body: { ok: true, data: { traceability_passed: true, ...data } } });
  // Strict P2-06 says not usable (open review), the server admits it provisionally.
  const provisional = ok({ eligible: false, blocker_codes: ["claim_review_unresolved"], provisional_internal_draft: { admitted: true, blocker_codes: [], source_role: null } });
  assert.equal(claimDraftAdmission(RESTRICTED, provisional), "admitted");
  assert.equal(claimDraftAdmitted(RESTRICTED, provisional), true, "unresolved review is a provisional limitation");
  // The same strict answer with no admission read is unknown, never admitted (the defect repaired).
  const strictOnly = ok({ eligible: false, blocker_codes: ["claim_review_unresolved"] });
  assert.equal(claimDraftAdmission(RESTRICTED, strictOnly), "unknown");
  assert.equal(claimDraftAdmitted(RESTRICTED, strictOnly), false);
  for (const absent of [undefined, null, { status: "unknown", blockerCodes: [], conflictReason: null }]) {
    assert.equal(claimDraftAdmission(RESTRICTED, absent), "unknown");
    assert.equal(claimDraftAdmitted(RESTRICTED, absent), false, "a missing answer establishes nothing");
  }
  // Refusals: the server's own codes; a 409 the server explains; a non-current version.
  const roster = ok({ eligible: false, blocker_codes: [], provisional_internal_draft: { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "reference" } });
  assert.equal(claimDraftAdmission(RESTRICTED, roster), "refused");
  assert.match(provisionalDraftRefusalMessage(roster), /^Not usable in a new internal draft: the linked participant register's recorded processing permissions do not allow AI processing \(a permitted service log does not override the register's decision\); only a new decision that permits AI processing for that source, under Processing permissions in Sources, can change this/);
  const primary = ok({ eligible: false, blocker_codes: [], provisional_internal_draft: { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "primary" } });
  assert.match(provisionalDraftRefusalMessage(primary), /its source's recorded processing permissions/);
  assert.doesNotMatch(provisionalDraftRefusalMessage(primary), /participant register/);
  const rejected = ok({ eligible: false, blocker_codes: ["claim_review_unresolved"], provisional_internal_draft: { admitted: false, blocker_codes: ["claim_reviewed_not_supported"], source_role: null } });
  assert.match(provisionalDraftRefusalMessage(rejected), /recorded review found it or its evidence not supported; that decision stands/);
  const staleRoster = claimUseDiagnosis({ statusCode: 409, body: { ok: false, error: { code: "conflict_current_state_changed" }, data: { traceability_conflict_reason: "derived_measurement_contributing_source_not_current" } } });
  assert.equal(claimDraftAdmission(RESTRICTED, staleRoster), "refused");
  assert.match(provisionalDraftRefusalMessage(staleRoster), /has since been replaced, so this is a historical result/);
  assert.equal(claimDraftAdmission(RESTRICTED, { status: "not_usable", blockerCodes: [], conflictReason: "source_version_not_current" }), "refused");
  // A malformed or unexplained admission is unknown.
  for (const view of [{ admitted: true, blocker_codes: ["ai_processing_not_permitted"] }, { admitted: false, blocker_codes: [] }, { admitted: false, blocker_codes: ["made_up"] }]) {
    assert.equal(claimDraftAdmission(RESTRICTED, ok({ eligible: false, blocker_codes: [], provisional_internal_draft: view })), "unknown", JSON.stringify(view));
  }
  // Selection: a refused claim cannot be selected; an admitted or unknown one can (the server still checks).
  assert.deepEqual(claimInternalDraftSelectability(RESTRICTED, roster), { selectable: false, reason: "provisional_draft_refused" });
  assert.equal(claimInternalDraftSelectability(RESTRICTED, provisional).selectable, true);
  assert.equal(claimInternalDraftSelectability(RESTRICTED, strictOnly).selectable, true);
  assert.deepEqual(retainSelectableClaimIds([RESTRICTED.claimId], [RESTRICTED], new Map([[RESTRICTED.claimId, roster]])), []);
  const base = { canGenerate: true, engagementId: ENGAGEMENT, claims: [MEASURED, RESTRICTED] };
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [MEASURED.claimId, RESTRICTED.claimId], unadmittedClaimIds: [RESTRICTED.claimId] }),
    { ready: false, reason: "measured_claim_not_usable" });
  assert.deepEqual(internalDraftReadiness({ ...base, selectedClaimIds: [MEASURED.claimId], unadmittedClaimIds: [RESTRICTED.claimId] }), { ready: true, reason: null });
  assert.match(INTERNAL_DRAFT_READINESS_MESSAGES.measured_claim_not_usable, /deselect it to draft from the others/);
  assert.doesNotMatch(INTERNAL_DRAFT_READINESS_MESSAGES.measured_claim_not_usable, /not usable in internal reports/);
  const refusal = internalDraftFailureMessage({ statusCode: 422, body: { ok: false, error: { code: "validation_blocker" },
    blockers: [{ validator_key: "VAL-GEN-MEASURED-P2-01M-001", blocking_reason: "measured_claim_not_currently_eligible" }] } });
  assert.match(refusal, /^A selected measured finding cannot be drafted from now: a recorded review found it unsupported, or its measurement no longer matches its source\./);
  assert.doesNotMatch(refusal, /Request failed KAI validation|Get Kinder/);
  const permissionRefusal = internalDraftFailureMessage({ statusCode: 422, body: { ok: false, error: { code: "validation_blocker" },
    blockers: [{ validator_key: "VAL-KAI-B1A-02-004", blocking_reason: "ai_processing_not_permitted", evidence: { source_role: "reference" } }] } });
  assert.match(permissionRefusal, /^No draft was created and nothing was sent to the AI model: the linked participant register's recorded processing permissions/);
});

test("report use: an admitted finding has no mandatory final-review warning, including legacy diagnostics", () => {
  const CROSS = claim(9, "source_derived_measurement");
  const ok = (data) => claimUseDiagnosis({ statusCode: 200, body: { ok: true, data: { traceability_passed: true, ...data } } });
  const provisional = ok({ eligible: false, blocker_codes: ["evidence_review_unresolved", "claim_review_unresolved"],
    provisional_internal_draft: { admitted: true, blocker_codes: [], source_role: null } });
  const shown = claimUsePresentation({ claim: CROSS, strictUse: "not_usable", diagnosis: provisional });
  assert.equal(shown.draft, "admitted");
  assert.deepEqual(shown.lines.map((line) => line.key), ["provisional"]);
  assert.match(shown.lines[0].text, /^Ready to use in your report\./);
  assert.equal(shown.lines[0].detail, undefined);
  assert.doesNotMatch(JSON.stringify(shown), /Not usable|Processing permissions|Count records|record-count rule/, "no contradiction and no irrelevant permission or record-count advice on a cross-source finding");
  assert.doesNotMatch(JSON.stringify(shown), /no completed review|Before final use|never for funder/);
  const DOC = claim(10, "source_document_statement");
  assert.doesNotMatch(JSON.stringify(claimUsePresentation({ claim: DOC, strictUse: "not_usable", diagnosis: provisional })), /Processing permissions/);
  assert.equal(claimUsePresentation({ claim: MEASURED, strictUse: "not_usable", diagnosis: provisional }).lines[0].detail, undefined);
  const refused = ok({ eligible: false, blocker_codes: [], provisional_internal_draft: { admitted: false, blocker_codes: ["ai_processing_not_permitted"], source_role: "reference" } });
  assert.deepEqual(claimUsePresentation({ claim: CROSS, strictUse: "usable", diagnosis: refused }).lines.map((line) => line.key), ["refused"],
    "strict eligibility never hides a processing refusal for new generation");
  assert.deepEqual(claimUsePresentation({ claim: CROSS, strictUse: "not_usable", diagnosis: ok({ eligible: false, blocker_codes: ["claim_review_unresolved"] }) }).lines.map((line) => line.key),
    ["unknown"], "an unread admission is unknown, not success");
  assert.deepEqual(claimUsePresentation({ claim: FIELD_2, strictUse: "not_usable", diagnosis: refused }).lines, []);
});

test("Package 3 mixed selection: refused, provisional and unconfirmed claims are told apart", () => {
  const OTHER = claim(7, "source_record_count_measurement");
  const use = (claimId) => ({ [MEASURED.claimId]: "usable", [OTHER.claimId]: "not_usable", [UNKNOWN.claimId]: "unknown" })[claimId];
  const draft = (claimId) => ({ [MEASURED.claimId]: "admitted", [OTHER.claimId]: "admitted", [UNKNOWN.claimId]: "unknown" })[claimId];
  assert.deepEqual(selectionReportUsability([MEASURED.claimId], use, undefined, draft), { immediatelyUsable: true, refused: [], provisional: [], unknown: [], refusedMeasured: [] });
  const mixed = selectionReportUsability([MEASURED.claimId, OTHER.claimId], use, (claimId) => (claimId === OTHER.claimId ? "measurement" : "other"), draft);
  assert.deepEqual(mixed, { immediatelyUsable: false, refused: [], provisional: [OTHER.claimId], unknown: [], refusedMeasured: [] });
  assert.match(selectionReportUsabilityMessage(mixed), /1 selected finding\(s\) can be used in your report/);
  assert.doesNotMatch(selectionReportUsabilityMessage(mixed), /will be refused/, "an admitted measured finding is never told the request will be refused (the defect repaired)");
  const refusedDraft = (claimId) => (claimId === OTHER.claimId ? "refused" : "admitted");
  const withRefused = selectionReportUsability([MEASURED.claimId, OTHER.claimId], use, (claimId) => (claimId === OTHER.claimId ? "measurement" : "other"), refusedDraft);
  assert.deepEqual([withRefused.refused, withRefused.refusedMeasured, withRefused.provisional], [[OTHER.claimId], [OTHER.claimId], []]);
  assert.match(selectionReportUsabilityMessage(withRefused), /cannot be used in a new internal draft now, so this request will be refused/);
  const unsure = selectionReportUsability([MEASURED.claimId, UNKNOWN.claimId], use, undefined, draft);
  assert.match(selectionReportUsabilityMessage(unsure), /not confirmed for an internal draft here; KAI checks them when the draft is generated/);
  // Without admission answers every selected claim is unconfirmed, never admitted.
  assert.deepEqual(selectionReportUsability([MEASURED.claimId], use).unknown, [MEASURED.claimId]);
});

test("library reads: the first page alone is complete; continuation cursors are followed and kept at the bound; a truncated page without a valid cursor is an error, never a complete answer", async () => {
  const page = (items, next) => ({ statusCode: 200, body: { ok: true, data: { items, truncated: next !== null, nextAfterClaimId: next } } });
  const run = (pages, options = {}) => {
    const requested = [];
    return readLibraryPages({
      fetchPage: async (cursor) => { requested.push(cursor); return pages[requested.length - 1]; },
      project: (data) => data.items,
      cursorKey: "nextAfterClaimId",
      maxPages: 3,
      ...options,
    }).then((result) => ({ result, requested }));
  };
  const first = await run([page([1, 2], null)]);
  assert.deepEqual(first, { result: { status: "success", items: [1, 2], complete: true, nextCursor: null }, requested: [null] });
  const two = await run([page([1], id(1)), page([2], null)]);
  assert.deepEqual(two, { result: { status: "success", items: [1, 2], complete: true, nextCursor: null }, requested: [null, id(1)] });
  // The bound: three pages read, the fourth exists; the read is incomplete and keeps the cursor.
  const bounded = await run([page([1], id(1)), page([2], id(2)), page([3], id(3)), page([4], null)]);
  assert.deepEqual(bounded, { result: { status: "success", items: [1, 2, 3], complete: false, nextCursor: id(3) }, requested: [null, id(1), id(2)] });
  // Continuing from the kept cursor reaches the rest.
  const continued = await run([page([4], null)], { cursor: id(3) });
  assert.deepEqual(continued, { result: { status: "success", items: [4], complete: true, nextCursor: null }, requested: [id(3)] });
  for (const cursor of [null, "", "not-a-uuid"]) {
    const broken = await run([{ statusCode: 200, body: { ok: true, data: { items: [1], truncated: true, nextAfterClaimId: cursor } } }]);
    assert.equal(broken.result.status, "error", String(cursor));
  }
  const refused = await run([page([1], id(1)), { statusCode: 403, body: { ok: false } }]);
  assert.equal(refused.result.status, "error");
  assert.equal(refused.result.result.statusCode, 403);
  // A newer organization or refresh owns the state: a superseded read reports nothing.
  let current = true;
  const superseded = await readLibraryPages({
    fetchPage: async () => { current = false; return page([1], null); }, project: (data) => data.items, cursorKey: "nextAfterClaimId", maxPages: 3, isCurrent: () => current,
  });
  assert.deepEqual(superseded, { status: "superseded" });
});

test("saved drafts from several pages are merged once each, newest first", () => {
  const draftItem = (n, createdAt) => ({ generatedContentDraftId: id(500 + n), createdAt });
  const merged = mergeInternalDraftPages([draftItem(1, "2026-10-01T00:00:00Z"), draftItem(2, "2026-10-03T00:00:00Z")],
    [draftItem(3, "2026-10-02T00:00:00Z"), draftItem(1, "2026-10-01T00:00:00Z")]);
  assert.deepEqual(merged.map((item) => item.generatedContentDraftId), [id(502), id(503), id(501)]);
  assert.deepEqual(mergeInternalDraftPages(null, []), []);
});

test("structural-only classification is the server's evaluation of the draft's actual citations, never the claims the page loaded", () => {
  const view = (blockedReasons) => ({ internalReport: { available: false, getKinderReviewReasons: [], blockedReasons } });
  assert.equal(isStructuralOnlyDraft(view(["cited_claims_not_currently_eligible", "structural_facts_only"])), true);
  assert.equal(isStructuralOnlyDraft(view(["cited_claims_not_currently_eligible"])), false);
  assert.equal(isStructuralOnlyDraft({ blocks: [{ supportingClaimIds: [FIELD_2.claimId] }] }), false, "the loaded claims decide nothing");
  assert.equal(isStructuralOnlyDraft(null), false);
  assert.ok(CLIENT_INTERNAL_REPORT_REASONS.includes("structural_facts_only"));
  const dto = {
    generatedContentDraftId: id(600), contentType: "evidence_summary", audience: "internal", reviewState: "awaiting_get_kinder_review",
    citedClaimsCurrentlyEligible: false, limitations: ["internal_use_only"], blocks: [{ ordinal: 1, text: "field_2", supportingClaimIds: [FIELD_2.claimId] }],
    internalReport: { available: false, getKinderReviewReasons: [], blockedReasons: ["cited_claims_not_currently_eligible", "structural_facts_only"] },
  };
  assert.equal(isStructuralOnlyDraft(projectClientInternalDraft(dto)), true, "the projection carries the reason");
  assert.match(INTERNAL_REPORT_REASON_MESSAGES.structural_facts_only, /source structure, not a programme result/);
  assert.match(STRUCTURAL_ONLY_DRAFT_MESSAGE, /^Structural facts only: .*a review would not make it one.*kept exactly as it was generated.*generate a new draft/);
  assert.doesNotMatch(INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS.cited_claims_not_currently_eligible, /Ask Get Kinder/,
    "an ineligible claim's remedy is named on the claim, not a blanket review request");
  assert.doesNotMatch(claimProposalResultMessage({}), /awaits Get Kinder/);
});

test("server: a draft citing only structural facts is not an available internal report, whatever its claims' review; one measured citation keeps it available", async () => {
  const ORG_ID = "0d000000-0000-4000-8000-0000000000a1";
  const VERSION = "5d000000-0000-4000-8000-000000000001";
  const STRUCTURAL = "6d000000-0000-4000-8000-000000000001";
  const MEASURED_EVIDENCE = "6d000000-0000-4000-8000-000000000002";
  const CLEARED = {
    decision_outcome: "reviewed", reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true,
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
  };
  const evidenceTypes = { [STRUCTURAL]: "dictionary_field_presence_fact", [MEASURED_EVIDENCE]: "source_record_count_measurement" };
  const queries = [];
  const tx = {
    async query(sql, params) {
      queries.push(sql);
      if (/FROM kai\.evidence_items/.test(sql)) {
        assert.equal(params[0], ORG_ID, "organization-scoped");
        return { rows: params[1].filter((evidenceItemId) => evidenceTypes[evidenceItemId]).map((evidenceItemId) => ({ evidence_item_id: evidenceItemId, evidence_type: evidenceTypes[evidenceItemId] })) };
      }
      if (/FROM kai\.source_versions/.test(sql)) return { rows: [{ source_version_id: VERSION, organization_id: ORG_ID, is_current: true, intake_sensitivity_profile_id: "50000000-0000-4000-8000-000000000001" }] };
      if (/intake_sensitivity_review_decisions/.test(sql)) return { rows: [{ ...CLEARED, organization_id: ORG_ID, decision_id: "60000000-0000-4000-8000-000000000001", supersedes_decision_id: null }] };
      return { rows: [] };
    },
  };
  // Every cited claim currently eligible (as a legitimate review would make a structural claim).
  const packet = (...evidenceItemIds) => ({
    contentType: "evidence_summary", requestedAudience: "internal", currentUseEligible: true,
    blocks: [{ citations: evidenceItemIds.map((evidenceItemId) => ({ sourceVersionId: VERSION, evidenceItemId })) }],
  });
  const structuralOnly = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG_ID, packet: packet(STRUCTURAL) });
  assert.deepEqual(structuralOnly, { available: false, getKinderReviewReasons: [], blockedReasons: [STRUCTURAL_FACTS_ONLY_REASON], informationReasons: [] });
  const mixed = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG_ID, packet: packet(STRUCTURAL, MEASURED_EVIDENCE) });
  assert.deepEqual(mixed, { available: true, getKinderReviewReasons: [], blockedReasons: [], informationReasons: [] });
  const measuredOnly = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG_ID, packet: packet(MEASURED_EVIDENCE) });
  assert.deepEqual(measuredOnly.available, true);
  // An evidence item this organization does not hold is not assumed structural (the packet's own checks govern it).
  const missing = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId: ORG_ID, packet: packet(STRUCTURAL, "6d000000-0000-4000-8000-000000000003") });
  assert.deepEqual(missing.blockedReasons, []);
  assert.ok(queries.every((sql) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(sql)), "read-only");
});

test("UI wiring: library reads keep completeness and continue from the cursor; per-claim diagnosis; the generated draft opens by id; drafts page with nextCursor", () => {
  const workflow = readFileSync(new URL("../frontend/knowledgeStudio/ClientEvidenceWorkflow.jsx", import.meta.url), "utf8");
  // Owner direction 2026-11-06: the Data Sources reads are the selected Project's working view.
  assert.match(workflow, /useOrganizationRead\(organizationId, scopedClaimsPath, projectCandidateClaims, refreshToken, CLAIM_CURSOR, scope\)/);
  assert.match(workflow, /useOrganizationRead\(organizationId, scopedEvidencePath, projectEvidenceLibraryItems, refreshToken, EVIDENCE_CURSOR, scope\)/);
  assert.match(workflow, /useOrganizationRead\(organizationId, scopedSourcesPath, projectOrganizationSources, refreshToken, null, scope\)/);
  assert.match(workflow, /claimLibraryCandidatesPath\(org, after, scope \|\| null\)/);
  assert.match(workflow, /useOrganizationRead\(organizationId, clientImpactFactsPath, projectInternalUse, refreshToken\)/);
  assert.match(workflow, /claims: claims\.status === "success" \? claims\.items : undefined, claimsComplete: claims\.complete/);
  assert.match(workflow, /getJson\(claimTraceabilityPath\(organizationId, claimId, "internal"\)\)/);
  assert.match(workflow, /<LibraryCompleteness read=\{claims\} noun="claims" \/>/);
  // Four-view refactor: every loaded claim renders under its finding (claims
  // whose evidence is not loaded get their own entry from buildFindings).
  assert.match(workflow, /const findings = buildFindings\(\{ evidenceItems: evidence\.items, claims: claims\.items, sources: sources\.items \}\);/);
  assert.match(workflow, /\{finding\.claims\.map\(\(claim\) => renderClaim\(claim, finding\.statement\)\)\}/);
  assert.match(workflow, /data-client-claim-kind=\{kind\} data-client-claim-internal-use=\{use\}/);
  assert.match(workflow, /const \{ \[contentType\]: _retired, \.\.\.rest \} = current;/);
  assert.doesNotMatch(workflow, /Review: \{claim\.claimReviewStatus\}|everything else wait for Get Kinder/);
  const drafts = readFileSync(new URL("../frontend/knowledgeStudio/ClientInternalDrafts.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(drafts, /list\.items\.some\(\(item\) => item\.generatedContentDraftId === focusDraftId\)/, "focus never waits for the list page");
  assert.match(drafts, /focusedRef\.current = focusDraftId;\n\s+openDraft\(focusDraftId\);/);
  assert.match(drafts, /clientInternalDraftsPath\(organizationId, engagementId, cursor\)/);
  assert.match(drafts, /isStructuralOnlyDraft\(draft\)/);
  assert.doesNotMatch(drafts, /claim review: \$\{/);
  assert.match(drafts, /const nextActions = structuralOnly \? \[\] : internalDraftFactualReviewNextActions\(view\.blockedReasons\);/);
});

test("a recorded non-current source remains visible but cannot be selected, queued for redundant diagnostics, or submitted for an assessment", () => {
  for (const type of ["source_record_count_measurement", "source_derived_measurement", "source_document_statement"]) {
    const old = claim(21, type, { evidenceSourceVersionIsCurrent: false });
    const current = claim(22, type, { evidenceSourceVersionIsCurrent: true });
    assert.deepEqual(claimInternalDraftSelectability(old), { selectable: false, reason: "source_version_not_current" });
    assert.equal(claimInternalDraftSelectability(current).selectable, true);
    assert.deepEqual(claimsToDiagnose({ claims: [old, current], impactFacts: null }), [current.claimId]);
    assert.deepEqual(retainSelectableClaimIds([old.claimId, current.claimId], [old, current]), [current.claimId]);
    assert.equal(claimDraftAdmitted(old, null), false);
    assert.deepEqual(internalDraftReadiness({ canGenerate: true, engagementId: ENGAGEMENT,
      selectedClaimIds: [old.claimId, current.claimId], claims: [old, current] }), { ready: false, reason: "source_version_not_current" });
    assert.doesNotMatch(claimSelectabilityMessage("source_version_not_current"), /has been replaced/);
  }
});

test("a fresh stale-source diagnostic overrides an earlier current list read without granting eligibility to current or unknown versions", () => {
  const diagnostic = { status: "not_usable", blockerCodes: [], conflictReason: "source_version_not_current" };
  const current = { ...MEASURED, evidenceSourceVersionIsCurrent: true };
  assert.equal(claimInternalDraftSelectability(current, diagnostic).selectable, false);
  assert.equal(claimDraftAdmitted(current, diagnostic), false);
  assert.deepEqual(retainSelectableClaimIds([current.claimId], [current], new Map([[current.claimId, diagnostic]])), []);
  assert.deepEqual(internalDraftReadiness({ canGenerate: true, engagementId: ENGAGEMENT,
    selectedClaimIds: [current.claimId], claims: [current], unavailableSourceClaimIds: [current.claimId] }), { ready: false, reason: "source_version_not_current" });
  const unknown = { ...current, evidenceSourceVersionIsCurrent: null };
  assert.deepEqual(claimsToDiagnose({ claims: [unknown], impactFacts: null }), [unknown.claimId]);
  assert.equal(claimInternalUse(current.claimId, null), "unknown", "being current does not establish factual eligibility");
});

test("the Claim Library preserves Boolean source currentness through the client projection and refuses a malformed flag", async () => {
  const actorContext = { actorType: "human", actorUserId: id(900),
    organizationMemberships: [{ organization_id: ORG, role_name: "client_admin", membership_status: "active" }] };
  const row = (n, flag) => ({ claim_id: id(n), organization_id: ORG, evidence_item_id: id(100+n), claim_type: "finding", claim_status: "proposed",
    claim_review_status: "needs_gk_review", claim_strength: "unassessed", review_queue_items: [], evidence_source_version_is_current: flag });
  const result = await listClaimLibraryCandidates({ organizationId: ORG, actorContext }, {
    env: { KAI_SPRINT2_ENABLED: "true" }, listClaimLibraryReviewCandidates: async () => [row(1, false), row(2, true), row(3, null)],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(projectCandidateClaims(result.data).map((item) => item.evidenceSourceVersionIsCurrent), [false, true, null]);
  const malformed = await listClaimLibraryCandidates({ organizationId: ORG, actorContext }, {
    env: { KAI_SPRINT2_ENABLED: "true" }, listClaimLibraryReviewCandidates: async () => [row(1, "false")],
  });
  assert.equal(malformed.error.code, "system_error");
});


test("a generation conflict is explained only from its fresh authoritative diagnostic", () => {
  const result = { statusCode: 409, body: { error: { code: "conflict_current_state_changed", message: "Current resource state changed." } } };
  assert.match(internalDraftFailureMessage(result, { diagnosis: { status: "blocked", claimId: MEASURED.claimId, reason: "source_version_not_current" } }), /recorded as non-current.*source-version history needs investigation/);
  assert.equal(internalDraftFailureMessage(result, { diagnosis: { status: "unknown" } }), "Current resource state changed.");
});
