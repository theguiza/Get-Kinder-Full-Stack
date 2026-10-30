import { errorText, isRouteUuid } from "../impactEvidenceLibraryLogic.js";
import { nextActionText } from "./clientEvidencePipelineLogic.js";

/**
 * Client organization-administrator evidence-to-draft workflow (owner
 * decision 2026-10-18): sensitivity review -> source candidate promotion ->
 * governed source -> evidence extraction -> evidence ->
 * claim proposal -> claim gap follow-ups (P2-04) -> claim selection ->
 * internal evidence summary / impact narrative. Every flag is the server's
 * access-capabilities answer; nothing here grants or infers authority.
 * Authorization and input readiness are kept separate: an authorized actor
 * can still be missing a Project or a claim, and is told which.
 */

// reviewSensitivity / promoteSource: the governed source preparation an
// organization administrator may complete itself (owner decisions 2026-10-12
// and 2026-10-18), shown in the same tab for the selected Project.
const WORKFLOW_OPERATION_KEYS = Object.freeze([
  "reviewSensitivity",
  "promoteSource",
  "extractEvidence",
  "proposeClaim",
  "generateClaimGapFollowups",
  "generateDrafts",
  "readInternalDrafts",
  // Plan A Prompt 8: record the P2-01M source record-count measurement, and
  // receive an internal report Get Kinder has already reviewed and released.
  "recordSourceMeasurement",
  "readReleasedInternalReports",
  // Owner amendment 2026-10-23: the organization administrator's factual
  // review and final release of an ordinary internal evidence summary.
  "reviewInternalDraftFactualContent",
  "releaseInternalReports",
  // Owner authorization 2026-10-24: the client-safe internal traceability
  // diagnostic that explains a refused internal draft.
  "readClaimTraceabilityDiagnostics",
  // Owner authorization 2026-10-24: the organization administrator's own
  // factual review of an ordinary measured claim.
  "reviewMeasuredClaimFactualContent",
]);

// Terminal claim review outcome the generation repository always rejects
// (claim_reviewed_not_supported). Server-authoritative claimStrength.
const TERMINAL_NOT_SUPPORTED = "reviewed_not_supported";

export function clientEvidenceWorkflowAccess(capabilities) {
  const operations = capabilities?.workflowOperations || {};
  const access = Object.fromEntries(WORKFLOW_OPERATION_KEYS.map((key) => [key, operations[key] === true]));
  // The workflow is offered only to an actor outside the GK workspace (the
  // GK Knowledge Studio already carries these actions).
  const visible = capabilities?.internalKnowledgeWorkspace !== true && WORKFLOW_OPERATION_KEYS.some((key) => access[key]);
  return { visible, ...access };
}

// What a claim restates, from the server's evidence type (owner prompt
// 2026-10-26): a source-derived measurement is a substantive finding; a
// dictionary field-presence fact only says a source has a column. Structural
// facts stay valid for what they say, but are not impact findings.
export const MEASUREMENT_EVIDENCE_TYPE = "source_record_count_measurement";
export const STRUCTURAL_EVIDENCE_TYPE = "dictionary_field_presence_fact";

export function claimKind(claim) {
  if (claim?.evidenceType === MEASUREMENT_EVIDENCE_TYPE) return "measurement";
  if (claim?.evidenceType === STRUCTURAL_EVIDENCE_TYPE) return "structural";
  return "other";
}

export function claimInternalDraftSelectability(claim) {
  if (!isRouteUuid(claim?.claimId) || !isRouteUuid(claim?.evidenceItemId)) {
    return { selectable: false, reason: "invalid_claim" };
  }
  if (claim.claimStrength === TERMINAL_NOT_SUPPORTED) return { selectable: false, reason: "reviewed_not_supported" };
  if (claimKind(claim) === "structural") return { selectable: false, reason: "structural_fact" };
  return { selectable: true, reason: null };
}

// `claims` (the organization's loaded claims) adds the substantive-finding
// rule: a report needs at least one claim that is not a structural fact, and
// when none exists the customer is sent to Count records instead of drafting
// from metadata. "None exists" is concluded only from a complete read
// (`claimsComplete`); claims not loaded yet are unknown, never absent.
export function internalDraftReadiness({ canGenerate, engagementId, selectedClaimIds, claims, claimsComplete = true, unadmittedClaimIds = [] }) {
  if (canGenerate !== true) return { ready: false, reason: "not_authorized" };
  if (!isRouteUuid(engagementId)) return { ready: false, reason: "no_project" };
  const substantive = Array.isArray(claims)
    ? new Set(claims.filter((claim) => claimKind(claim) !== "structural").map((claim) => claim.claimId))
    : null;
  if (substantive && substantive.size === 0) {
    return { ready: false, reason: claimsComplete === true ? "no_measured_claim" : "claims_not_all_loaded" };
  }
  if (!Array.isArray(selectedClaimIds) || selectedClaimIds.length === 0) return { ready: false, reason: "no_claims_selected" };
  if (substantive && !selectedClaimIds.some((claimId) => substantive.has(claimId))) return { ready: false, reason: "no_measured_claim_selected" };
  if (selectedClaimIds.length > 20) return { ready: false, reason: "too_many_claims" };
  if (selectedClaimIds.some((claimId) => unadmittedClaimIds.includes(claimId))) return { ready: false, reason: "measured_claim_not_usable" };
  return { ready: true, reason: null };
}

// Generation drafts from a measured claim only while it is currently eligible
// for the audience (VAL-GEN-MEASURED-P2-01M-001); a claim's own determinate
// P2-06 evaluation says in advance that it is not. A missing P2-04 state is
// not determinate: generation records it itself before evaluating.
export function claimDraftAdmitted(claim, diagnosis) {
  if (claimKind(claim) !== "measurement" || diagnosis?.status !== "not_usable") return true;
  return diagnosis.blockerCodes.length === 0 && diagnosis.conflictReason === "gap_dimension_requires_missing_p204_state";
}

export const INTERNAL_DRAFT_READINESS_MESSAGES = Object.freeze({
  not_authorized: "Your role does not include internal draft generation for this organization.",
  no_project: "Select a Project above: each draft belongs to one Project.",
  no_measured_claim: "No measured finding yet. In Data Sources, use Count records on your source to record what one record represents and its "
    + "reporting period, then propose the claim from the measurement. Count records works on a single-table CSV file, or on one "
    + "worksheet you select in an Excel workbook (one worksheet per record-count definition; worksheets are never added together). "
    + "A count of rows is not a count of unique participants or a programme outcome. Structural facts about a file's columns are not "
    + "impact findings.",
  claims_not_all_loaded: "Not every claim of your organization is loaded yet, and none of the loaded ones is a measured finding. "
    + "Use \"Load more claims\" below to find your measured findings.",
  no_claims_selected: "Select at least one claim below to draft from.",
  no_measured_claim_selected: "Select at least one measured finding below: a report needs a measured result, not only structural facts.",
  too_many_claims: "Select at most 20 claims for one draft.",
  measured_claim_not_usable: "A selected measured finding is not usable in internal reports now, and a draft is generated from a measured finding "
    + "only while it is usable. Its condition is shown on the claim below; deselect it to draft from the others.",
});

export function claimSelectabilityMessage(reason) {
  if (reason === "reviewed_not_supported") return "Get Kinder review found this claim not supported, so it cannot be used in a draft.";
  if (reason === "structural_fact") {
    return "Structural fact: it says a source has this column, not a measured result, so it is not offered as an impact finding.";
  }
  if (reason === "invalid_claim") return "This claim cannot be selected.";
  return "";
}

// Measured findings first, then other claims, then structural facts; the
// server's order within each group is kept.
export function orderClaimsForReports(claims) {
  const rank = { measurement: 0, other: 1, structural: 2 };
  return (Array.isArray(claims) ? claims : [])
    .map((claim, index) => ({ claim, index }))
    .sort((a, b) => rank[claimKind(a.claim)] - rank[claimKind(b.claim)] || a.index - b.index)
    .map(({ claim }) => claim);
}

// The authoritative internal-use answer for one claim: "usable",
// "not_usable", or "unknown". `diagnostics` (claimId -> claimUseDiagnosis)
// is that claim's own P2-06 internal evaluation and is preferred when it is
// determinate; otherwise the client-safe impact-facts read (P2-08 / P2-06,
// internal audience) answers, and a claim missing from a failed or truncated
// impact-facts read is unknown, never "not usable".
export function claimInternalUse(claimId, impactFacts, diagnostics = null) {
  const diagnosed = diagnostics instanceof Map ? diagnostics.get(claimId) : undefined;
  if (diagnosed && diagnosed.status !== "unknown") return diagnosed.status;
  if (!impactFacts || !(impactFacts.claimIds instanceof Set)) return "unknown";
  if (impactFacts.claimIds.has(claimId)) return "usable";
  return impactFacts.truncated ? "unknown" : "not_usable";
}

// One claim's client-safe internal traceability diagnostic (owner
// authorization 2026-10-24), as an internal-use answer and the server's own
// blocker codes. Any other outcome establishes nothing ("unknown").
export function claimUseDiagnosis(result) {
  const data = result?.body?.data;
  if (result?.statusCode === 200 && result.body?.ok === true && data?.traceability_passed === true) {
    const blockerCodes = Array.isArray(data.blocker_codes) ? data.blocker_codes.filter((code) => Object.hasOwn(CLAIM_USE_BLOCKER_MESSAGES, code)) : [];
    return { status: data.eligible === true ? "usable" : "not_usable", blockerCodes, conflictReason: null };
  }
  const reason = data?.traceability_conflict_reason;
  if (result?.statusCode === 409 && result.body?.error?.code === "conflict_current_state_changed"
    && Object.hasOwn(TRACEABILITY_CONFLICT_EXPLANATIONS, reason)) {
    return { status: "not_usable", blockerCodes: [], conflictReason: reason };
  }
  return { status: "unknown", blockerCodes: [], conflictReason: null };
}

// The claims whose internal use is diagnosed one by one: every substantive
// (non-structural) loaded claim the impact-facts read does not establish as
// usable, plus any selected claim, up to `limit`.
export function claimsToDiagnose({ claims, impactFacts, diagnostics, selectedClaimIds = [], limit = 25 }) {
  const known = diagnostics instanceof Map ? diagnostics : new Map();
  const wanted = (Array.isArray(claims) ? claims : [])
    .filter((claim) => isRouteUuid(claim?.claimId) && !known.has(claim.claimId))
    .filter((claim) => (claimKind(claim) !== "structural" || selectedClaimIds.includes(claim.claimId))
      && claimInternalUse(claim.claimId, impactFacts) !== "usable")
    .map((claim) => claim.claimId);
  return wanted.slice(0, Math.max(0, limit));
}

// What a P2-06 blocker means to the organization administrator.
export const CLAIM_USE_BLOCKER_MESSAGES = Object.freeze({
  claim_not_approved_for_requested_audience: "it is not approved for internal use",
  audience_gate_closed: "its evidence is not cleared for internal use",
  claim_review_unresolved: "the ordinary record-count rule does not cover it and its claim has no completed review",
  evidence_review_unresolved: "the ordinary record-count rule does not cover it and its evidence has no completed review",
  support_strength_unassessed: "how well its evidence supports it has not been assessed",
  coverage_dimension_unresolved: "a coverage question about its evidence is unresolved",
  client_followup_unresolved: "a follow-up question about it is unanswered",
  potential_conflict_review_unresolved: "a possible conflict with other evidence is unresolved",
  requirement_authority_absent: "a requirement it depends on has no recorded authority",
  traceability_incomplete: "its evidence lineage is incomplete",
});

const REVIEW_BLOCKERS = new Set(["claim_review_unresolved", "evidence_review_unresolved"]);
export const ORDINARY_RULE_NOTE = "The ordinary rule covers a record count you defined with Count records and the claim proposed from it, "
  + "from a current source whose recorded permissions allow internal use and AI processing with no sensitive category recorded. "
  + "Check the source under Processing permissions if one of those is wrong; claims outside the rule are reviewed by Get Kinder.";

// The one line shown on a claim that is not usable now, from its diagnosis.
export function claimNotUsableMessage(diagnosis) {
  if (diagnosis?.conflictReason) return `Not usable in internal reports now: ${TRACEABILITY_CONFLICT_EXPLANATIONS[diagnosis.conflictReason]}.`;
  const codes = Array.isArray(diagnosis?.blockerCodes) ? diagnosis.blockerCodes : [];
  if (codes.length === 0) return "Not usable in internal reports now.";
  const reasons = codes.map((code) => CLAIM_USE_BLOCKER_MESSAGES[code]).join("; ");
  return `Not usable in internal reports now: ${reasons}.${codes.some((code) => REVIEW_BLOCKERS.has(code)) ? ` ${ORDINARY_RULE_NOTE}` : ""}`;
}

export const CLAIM_USE_UNKNOWN_MESSAGE = "Its current internal use is not confirmed here. A draft is still checked when it is generated and opened.";

// Whether a draft from the selection would be immediately usable as an
// internal report. Preparing the draft is still allowed: generation keeps
// its own rules, and the saved draft says whether it is usable.
export function selectionReportUsability(selectedClaimIds, useOf, kindOf = () => "other") {
  const selected = Array.isArray(selectedClaimIds) ? selectedClaimIds : [];
  const notUsable = selected.filter((claimId) => useOf(claimId) === "not_usable");
  const unknown = selected.filter((claimId) => useOf(claimId) === "unknown");
  return {
    immediatelyUsable: notUsable.length === 0 && unknown.length === 0,
    notUsable,
    unknown,
    notUsableMeasured: notUsable.filter((claimId) => kindOf(claimId) === "measurement"),
  };
}

export function selectionReportUsabilityMessage({ notUsable, unknown, notUsableMeasured = [] }) {
  const parts = [];
  const notUsableOther = notUsable.filter((claimId) => !notUsableMeasured.includes(claimId));
  if (notUsableMeasured.length > 0) {
    parts.push(`${notUsableMeasured.length} selected measured finding(s) are not usable in internal reports now. A draft is generated from a `
      + "measured finding only while it is usable, so this request will be refused unless that has changed. The condition is shown on the claim.");
  }
  if (notUsableOther.length > 0) {
    parts.push(`${notUsableOther.length} selected claim(s) are not usable in internal reports now, so a draft from this selection will be prepared but `
      + "will not be immediately usable as an internal report. The reason is shown on each claim.");
  }
  if (unknown.length > 0) parts.push(`${unknown.length} selected claim(s) have an internal use that is not confirmed here; the saved draft will say whether it is usable.`);
  if (notUsable.length > 0) parts.push("For a report you can open and download now, select only claims marked \"Usable in internal reports now\".");
  return parts.join(" ");
}

// A saved draft whose every cited claim is a structural fact, from the
// server's own internal-report evaluation of its actual citations (never from
// the claims this page happened to load): kept as it was generated, but it
// holds no measured result.
export function isStructuralOnlyDraft(draft) {
  return Array.isArray(draft?.internalReport?.blockedReasons) && draft.internalReport.blockedReasons.includes("structural_facts_only");
}

/**
 * Reads a paged organization library (Claim or Evidence Library) from
 * `cursor`, up to `maxPages` pages. `fetchPage(cursor)` returns the route
 * result; `cursorKey` names the server's continuation field. Returns
 * { status: "superseded" } once `isCurrent()` is false after any read (a newer
 * organization, Project, or refresh owns the state), { status: "error" } on
 * a refused read or a truncated page without a valid continuation, and
 * otherwise { status: "success", items, complete, nextCursor }: `complete` only
 * when the server reported the last page, else the cursor to continue from.
 */
export async function readLibraryPages({ fetchPage, project, cursorKey, cursor = null, maxPages, isCurrent = () => true }) {
  let items = [];
  let next = cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(next);
    if (!isCurrent()) return { status: "superseded" };
    if (result?.statusCode !== 200 || !result.body?.ok) return { status: "error", result };
    items = items.concat(project(result.body.data));
    if (result.body.data?.truncated !== true) return { status: "success", items, complete: true, nextCursor: null };
    next = result.body.data[cursorKey];
    if (!isRouteUuid(next)) return { status: "error", result: { statusCode: 502, body: null } };
  }
  return { status: "success", items, complete: false, nextCursor: next };
}

// Saved drafts from every page loaded so far, newest first. The server pages
// in id order, so the order is complete only once every page is loaded.
export function mergeInternalDraftPages(current, items) {
  const byId = new Map((Array.isArray(current) ? current : []).map((item) => [item.generatedContentDraftId, item]));
  for (const item of Array.isArray(items) ? items : []) byId.set(item.generatedContentDraftId, item);
  return [...byId.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    || a.generatedContentDraftId.localeCompare(b.generatedContentDraftId));
}

// Claims already proposed for an evidence item, from the loaded Claim Library page.
export function claimIdsByEvidenceItem(claims) {
  const byEvidence = new Map();
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!isRouteUuid(claim?.evidenceItemId) || !isRouteUuid(claim?.claimId)) continue;
    byEvidence.set(claim.evidenceItemId, [...(byEvidence.get(claim.evidenceItemId) || []), claim.claimId]);
  }
  return byEvidence;
}

// Drops selections the current claim list no longer admits.
export function retainSelectableClaimIds(selectedClaimIds, claims) {
  const admitted = new Set((Array.isArray(claims) ? claims : [])
    .filter((claim) => claimInternalDraftSelectability(claim).selectable)
    .map((claim) => claim.claimId));
  return (Array.isArray(selectedClaimIds) ? selectedClaimIds : []).filter((claimId) => admitted.has(claimId));
}

export function internalDraftRequestBody({ claimIds, idempotencyKey, engagementId }) {
  return { claim_ids: [...claimIds].sort(), idempotency_key: idempotencyKey, engagement_id: engagementId };
}

export function extractionResultMessage(data) {
  const created = Array.isArray(data?.evidenceItems) ? data.evidenceItems.length : 0;
  return data?.replayed === true
    ? `Evidence was already extracted from this source version (${created} evidence item(s)). Nothing new was written.`
    : `Evidence extracted: ${created} evidence item(s) created, awaiting Get Kinder evidence review.`;
}

export function claimProposalResultMessage(data) {
  return data?.replayed === true
    ? "A claim was already proposed for this evidence. Nothing new was written."
    : "Claim proposed. It is internal-only; whether it is usable in internal reports now is shown on the claim below.";
}

// P2-04 outcome: counts only. Generation records open gaps and open client
// follow-up questions; it answers, resolves, and approves nothing.
export function gapFollowupResultMessage(data) {
  const gaps = Array.isArray(data?.gapItems) ? data.gapItems.length : 0;
  const followups = Array.isArray(data?.clientFollowupItems) ? data.clientFollowupItems.length : 0;
  const counts = `${gaps} open gap(s) and ${followups} client follow-up question(s)`;
  return data?.replayed === true
    ? `Gap follow-ups were already generated for this claim (${counts}). Nothing new was written.`
    : `Gap follow-ups generated: ${counts} recorded. They stay open until answered and reviewed; the claim is not approved.`;
}

// Why a P2-04 request wrote nothing, from the server's own refusal.
export function gapFollowupFailureMessage(result) {
  const code = result?.body?.error?.code;
  if (code === "not_found") {
    return "This claim or part of its evidence lineage was not found in this organization. Nothing was written.";
  }
  if (code === "conflict_current_state_changed") {
    return "This claim's gap follow-up state changed or no longer matches its evidence. Refresh and try again. Nothing new was written.";
  }
  if (code === "validation_blocker") {
    const reason = result?.body?.blockers?.[0]?.blocking_reason;
    const detail = typeof reason === "string" && /^[a-z0-9_]+$/.test(reason) ? ` (${reason.replace(/_/g, " ")})` : "";
    return `Gap follow-ups cannot be generated for this claim: it did not pass validation${detail}. Nothing was written.`;
  }
  return errorText(result);
}

// Generation's VAL-GEN-TRACE-P0-001 refusal: a selected claim's traceability
// revalidation did not pass. The refusal itself never says which claim or why.
export function isInternalDraftTraceabilityRefusal(result) {
  return result?.body?.blockers?.[0]?.blocking_reason === "traceability_result_contract_invalid";
}

// The server's allowlisted traceability_conflict_reason codes, explained.
// Only a missing P2-04 state is fixed by generating gap follow-ups.
const TRACEABILITY_CONFLICT_EXPLANATIONS = Object.freeze({
  gap_dimension_requires_missing_p204_state: "its coverage gap follow-ups have not been generated yet",
  source_version_not_current: "the source version its evidence comes from has been replaced by a newer version",
  gap_followup_queue_mismatch: "its recorded gap follow-ups no longer match its current evidence",
  claim_evidence_link_mismatch: "its link to its evidence is not consistent",
  conflict_queue_count_mismatch: "its potential-conflict review records are not consistent",
  conflict_group_validation_failed: "its potential-conflict review records are not consistent",
});

/**
 * Which selected claim the client-safe internal traceability reads
 * (`reads`: [{ claimId, result }] in selection order) establish as failing,
 * and why. Only a 409 with an allowlisted traceability_conflict_reason names
 * a reason; a 404 establishes the failure without one. Any other read
 * failure, or every claim passing now, establishes nothing ("unknown").
 */
export function internalDraftTraceabilityDiagnosis(reads) {
  for (const read of Array.isArray(reads) ? reads : []) {
    const result = read?.result;
    if (result?.statusCode === 200 && result.body?.ok === true && result.body.data?.traceability_passed === true) continue;
    const reason = result?.body?.data?.traceability_conflict_reason;
    if (result?.statusCode === 409 && result.body?.error?.code === "conflict_current_state_changed"
      && Object.hasOwn(TRACEABILITY_CONFLICT_EXPLANATIONS, reason)) {
      return { status: "blocked", claimId: read.claimId, reason };
    }
    if (result?.statusCode === 404 && result.body?.error?.code === "not_found") {
      return { status: "blocked", claimId: read.claimId, reason: null };
    }
  }
  return { status: "unknown", claimId: null, reason: null };
}

// Why an authorized internal-draft request created nothing, from the
// server's own refusal. A traceability refusal is explained from the
// diagnosis above when one is available, and neutrally otherwise; only a
// missing P2-04 state is answered with "Generate gap follow-ups".
export function internalDraftFailureMessage(result, { canGenerateGapFollowups = false, diagnosis = null, claimLabel = "" } = {}) {
  if (isInternalDraftTraceabilityRefusal(result)) {
    if (diagnosis?.status !== "blocked") {
      return "A selected claim did not pass its traceability checks, so no draft was created. "
        + "The reason is not available here.";
    }
    const label = typeof claimLabel === "string" && claimLabel.trim()
      ? `The selected claim "${claimLabel.trim().slice(0, 120)}"`
      : "A selected claim";
    if (diagnosis.reason === "gap_dimension_requires_missing_p204_state") {
      return `${label} cannot be drafted from yet: ${TRACEABILITY_CONFLICT_EXPLANATIONS[diagnosis.reason]}. `
        + (canGenerateGapFollowups
          ? "Use \"Generate gap follow-ups\" on that claim, then try again. "
          : "Get Kinder must generate them first. ")
        + "Nothing was created.";
    }
    if (diagnosis.reason) {
      return `${label} cannot be drafted from: ${TRACEABILITY_CONFLICT_EXPLANATIONS[diagnosis.reason]} `
        + `(${diagnosis.reason}). Ask Get Kinder to reconcile it. Nothing was created.`;
    }
    return `${label} cannot be drafted from: part of its evidence lineage could not be found in this organization. `
      + "Nothing was created.";
  }
  if (result?.body?.blockers?.[0]?.blocking_reason === "measured_claim_not_currently_eligible") {
    return "A selected measured finding is not usable in internal reports now, so no draft was created. Its current condition is shown "
      + "on the claim under Claims for internal drafts. Nothing was created.";
  }
  if (result?.body?.error?.code === "claim_reviewed_not_supported") {
    return "A selected claim was found not supported by Get Kinder review and cannot be used in a draft. Nothing was created.";
  }
  return errorText(result);
}

// What the actor is told about a created draft: identity and status. The
// persisted draft itself is then read back and shown under "Your internal
// drafts" (owner decision 2026-10-19), never from this response.
export function internalDraftResultSummary(data, contentType) {
  if (!data || !isRouteUuid(data.generatedContentDraftId)) return null;
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const citedClaimIds = new Set(blocks.flatMap((block) => (Array.isArray(block?.citations) ? block.citations : []))
    .map((citation) => citation?.claimId)
    .filter(isRouteUuid));
  return {
    generatedContentDraftId: data.generatedContentDraftId,
    contentType,
    audience: data.requestedAudience === "internal" ? "internal" : null,
    draftStatus: typeof data.draftStatus === "string" ? data.draftStatus : null,
    reviewStatus: typeof data.reviewStatus === "string" ? data.reviewStatus : null,
    blockCount: blocks.length,
    citedClaimCount: citedClaimIds.size,
    replayed: data.replayed === true,
  };
}

/**
 * The selected Project's files whose next step is governed source
 * preparation, from the client evidence pipeline (server-derived stage and
 * next action). Sensitivity review is listed only for an actor the
 * capabilities admit; a source_review file is always listed so the actor sees
 * its actual state (promotable by this actor, or the server's blocker).
 */
export function sourcePreparationFiles(pipelineData, access) {
  const files = Array.isArray(pipelineData?.files) ? pipelineData.files : [];
  return files.filter((file) => (
    (file.currentStage === "sensitivity_review" && access?.reviewSensitivity === true && file.currentStatus !== "failed")
    || file.currentStage === "source_review"
    || (file.currentStage === "evidence_extraction" && file.nextAction === "extract_evidence")
  ));
}

/**
 * The selected Project's files whose sensitivity & allowed-use review is
 * complete, offered for a corrective re-review ("Review processing
 * permissions") to an actor the capabilities admit to that review. The
 * pipeline marks the stage complete only while the file's current decision is
 * a human 'reviewed' one, so a file at any later stage - promoted, with
 * evidence, or closed as not_allowed - stays listed, and a needs-more-
 * information file returns to Source preparation. Each row is the pipeline's
 * own intake file, so the panel opens on that file's identity, never on one
 * derived from a source. Exception recovery only: no file needs it to
 * continue.
 */
export function processingPermissionReviewFiles(pipelineData, access) {
  if (access?.reviewSensitivity !== true) return [];
  const files = Array.isArray(pipelineData?.files) ? pipelineData.files : [];
  return files.filter((file) => Array.isArray(file?.stages)
    && file.stages.some((stage) => stage?.key === "sensitivity_review" && stage.status === "complete"));
}

// The decision response, as one line: what was recorded and what the
// server-side evidence extraction handoff did. Counts only.
export function sourcePromotionResultMessage(data) {
  const status = data?.promotion_decision?.decision_status;
  const handoff = data?.evidence_extraction_handoff;
  const replayed = data?.replayed === true ? " (already recorded; nothing new was written)" : "";
  if (status === "promoted") {
    if (handoff?.status === "created" || handoff?.status === "replayed") {
      return `Source promoted${replayed}. Evidence extraction ${handoff.status === "created" ? "created" : "already had"} ${handoff.evidence_item_count ?? 0} evidence item(s), awaiting Get Kinder evidence review.`;
    }
    if (handoff?.status === "not_created") {
      return `Source promoted${replayed}. Evidence was not created automatically (${handoff.error_code || "unknown"}); use "Extract evidence" on the source below.`;
    }
    return `Source promoted${replayed}.`;
  }
  if (status === "rejected") return `Source candidate rejected${replayed}. No source or evidence will be created from this file.`;
  if (status === "needs_more_information") return `Marked as needing more information${replayed}. The candidate stays open; nothing was promoted.`;
  return "Decision recorded.";
}

// Why a P1-08 decision wrote nothing, from the server's own structured
// refusal (error code, blockers, and the repository's diagnostic phase).
const SOURCE_PROMOTION_PHASE_MESSAGES = Object.freeze({
  source_promotion_permission_predicate_failed:
    "this file's recorded sensitivity and allowed-use restrictions do not permit promotion",
  source_promotion_allowed_use_not_allowed: "this file's effective allowed use is not_allowed",
  source_promotion_reviewed_source_type_invalid: "the reviewed source type is not one of the allowed types",
  source_promotion_candidate_review_incomplete: "the candidate or its review item is not in a state that can take this decision",
});

export function sourcePromotionFailureMessage(result) {
  const code = result?.body?.error?.code;
  const phase = result?.body?.data?.exact_verification_phase;
  if (code === "validation_blocker" && SOURCE_PROMOTION_PHASE_MESSAGES[phase]) {
    return `Source not promoted: ${SOURCE_PROMOTION_PHASE_MESSAGES[phase]} (${phase}). Nothing was written.`;
  }
  if (code === "conflict_current_state_changed") {
    return "Source not promoted: this candidate changed since it was loaded. The refreshed state is shown. Nothing new was written.";
  }
  const reason = result?.body?.blockers?.[0]?.blocking_reason;
  if (code === "authorization_denied" && typeof reason === "string" && /^[a-z0-9_]+$/.test(reason)) {
    return `Source not promoted: your account may not record this decision (${reason}). Nothing was written.`;
  }
  return errorText(result);
}

// The source-preparation continuation response, as one line (owner decision
// 2026-10-19): the P1-07 handoff status the server reports. Ids are not shown.
export function sourcePreparationContinuationMessage(data) {
  const status = data?.source_candidate_handoff?.status;
  if (status === "created") {
    return "Source preparation continued: the source candidate was created from the file's recorded sensitivity review. Review & promote it below. The review and its reviewer were not changed.";
  }
  if (status === "replayed" || status === "existing") {
    return "This file already has its source candidate. Nothing new was written.";
  }
  return "Source preparation continued.";
}

// Why the continuation wrote nothing, from the server's structured blocker or
// the P1-07 handoff's own refusal code.
const SOURCE_PREPARATION_BLOCKER_MESSAGES = Object.freeze({
  file_policy_not_passed: "the file has not passed the upload file policy",
  sensitivity_profile_not_ready: "the file has no complete sensitivity profile yet",
  sensitivity_decision_lineage_ambiguous: "the file's sensitivity decision history has no single current decision",
  sensitivity_review_not_complete: "the file's current sensitivity review is not a completed 'reviewed' decision",
  sensitivity_decision_invalid: "the file's current sensitivity decision does not meet the review rules",
  allowed_use_not_allowed: "the file's recorded allowed use is not_allowed",
});

export function sourcePreparationContinuationFailureMessage(result) {
  const reason = result?.body?.blockers?.[0]?.blocking_reason;
  if (typeof reason === "string" && SOURCE_PREPARATION_BLOCKER_MESSAGES[reason]) {
    return `Source preparation not continued: ${SOURCE_PREPARATION_BLOCKER_MESSAGES[reason]} (${reason}). Nothing was written.`;
  }
  const handoffCode = result?.body?.data?.source_candidate_handoff?.error_code;
  if (typeof handoffCode === "string" && /^[a-z0-9_]+$/.test(handoffCode)) {
    return `Source preparation not continued: the source candidate step refused (${handoffCode}). Nothing was written.`;
  }
  return errorText(result);
}

// The guidance line for one source-preparation file. The pipeline's file
// sensitivity stage names Get Kinder's review; an actor the capabilities
// admit to that review is told it is theirs to do here.
export function sourcePreparationGuidance(file, access) {
  if (file?.currentStage === "sensitivity_review" && access?.reviewSensitivity === true) {
    return "Your action is needed: review this file's sensitivity & allowed use. Recording a \"reviewed\" decision creates its source candidate.";
  }
  return nextActionText(file);
}

// ---------------------------------------------------------------------------
// "Use for impact" (owner decision 2026-10-19): one contextual action that
// takes a file through the existing governed steps, from persisted state
// only. Automated steps are the existing authorized operations (P1-07
// continuation, P2-01 extraction); a human decision (the sensitivity review,
// the source authorization) is opened for the person, never made for them.
// ---------------------------------------------------------------------------

export const USE_FOR_IMPACT_MAX_STEPS = 4;

export function useForImpactStep(file, access) {
  if (!file || typeof file !== "object") return { kind: "blocked", text: "This file's status is not available." };
  const action = file.nextAction;
  if (action === "review_sensitivity" && access?.reviewSensitivity === true) return { kind: "review_sensitivity" };
  if (file.currentStage === "sensitivity_review" && file.currentStatus !== "failed" && access?.reviewSensitivity === true) {
    return { kind: "review_sensitivity" };
  }
  if (action === "continue_source_preparation" && access?.promoteSource === true) return { kind: "continue" };
  if (action === "promote_source" && access?.promoteSource === true) return { kind: "confirm_promotion" };
  if (action === "extract_evidence" && access?.extractEvidence === true) return { kind: "extract" };
  if (file.currentStatus === "complete" || ["evidence_review", "impact_fact_review"].includes(file.currentStage)) {
    return { kind: "done" };
  }
  return { kind: "blocked", text: nextActionText(file) };
}

// Offered on a file when its next governed step is one this actor may take.
export function isUseForImpactCandidate(file, access) {
  return ["review_sensitivity", "continue", "confirm_promotion", "extract"].includes(useForImpactStep(file, access).kind);
}

export const USE_FOR_IMPACT_MESSAGES = Object.freeze({
  review_sensitivity: "Use for impact: this file first needs your sensitivity & allowed-use review. Record your decision below; nothing is decided for you.",
  confirm_promotion: "Use for impact: confirm the source authorization below, then choose the reviewed source type and promote. Nothing is promoted without your confirmation.",
  done: "Use for impact: this file's evidence exists. Propose claims from it below, generate their gap follow-ups, then internal drafts.",
  interrupted: "Use for impact stopped. Every completed step is kept; use the action again to continue from the current state.",
});

// The restrictions a promotion keeps, from the file's current sensitivity
// decision (the existing review read). Lines only; nothing is inferred.
const PRESENCE_LABELS = Object.freeze({
  reviewed_personal_data_status: "personal information",
  reviewed_minor_data_status: "information about minors",
  reviewed_health_housing_justice_immigration_status: "health, housing, justice, or immigration information",
  reviewed_indigenous_governance_status: "Indigenous or governance-sensitive information",
  reviewed_staff_notes_status: "staff notes",
  reviewed_story_testimonial_status: "stories or testimonials",
  reviewed_small_cell_risk_status: "small-cell re-identification risk",
  reviewed_financial_records_status: "financial records",
});

export function sourceRestrictionLines(decision) {
  if (!decision || decision.decision_outcome !== "reviewed") {
    return ["No completed sensitivity & allowed-use review is recorded for this file."];
  }
  const permission = (value) => (value === true ? "permitted" : "not permitted");
  const present = Object.entries(PRESENCE_LABELS).filter(([key]) => decision[key] === "present").map(([, label]) => label);
  return [
    `Allowed use: ${decision.reviewed_allowed_use_status || "unknown"}; consent basis: ${decision.reviewed_consent_basis_status || "unknown"}.`,
    `Funder use: ${permission(decision.reviewed_funder_use_allowed)}; public use: ${permission(decision.reviewed_public_use_allowed)}; `
      + `product learning: ${permission(decision.reviewed_product_learning_allowed)}; recorded AI processing permission: ${permission(decision.reviewed_llm_processing_allowed)}.`,
    present.length > 0 ? `Recorded as present: ${present.join(", ")}.` : "No sensitive category is recorded as present.",
  ];
}

export const SOURCE_AUTHORIZATION_INTENDED_USE =
  "Internal impact evidence for this organization: evidence items, proposed claims, gap follow-ups, and internal drafts. "
  + "Promotion keeps the restrictions above and approves no evidence, claim, funder or public use, export, or release.";

export const INTERNAL_DRAFT_REVIEW_STATE_LABELS = Object.freeze({
  awaiting_get_kinder_review: "Awaiting Get Kinder review",
  in_get_kinder_review: "In Get Kinder review",
  awaiting_organization_review: "Not yet usable for internal reports",
  reviewed_by_get_kinder: "Reviewed by Get Kinder",
  reviewed_by_your_organization: "Factual review completed by your organization",
});

// Owner amendment 2026-10-23: why a draft is held for Get Kinder review, or
// blocked for everyone, from the server's factualReview reason codes.
export const INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES = Object.freeze({
  content_type_requires_get_kinder_review: "Only internal evidence summaries can be reviewed by your organization; Get Kinder reviews this type.",
  audience_requires_get_kinder_review: "Only internal drafts can be reviewed by your organization.",
  sensitivity_review_not_complete: "A cited source has no completed sensitivity and allowed-use review.",
  personal_information_not_cleared: "A cited source is not recorded as free of personal information.",
  minor_information_not_cleared: "A cited source is not recorded as free of information about minors.",
  sensitive_information_not_cleared: "A cited source is not recorded as free of health, housing, justice, or immigration information.",
  indigenous_governance_not_cleared: "A cited source is not recorded as free of Indigenous or governance-sensitive information.",
  story_testimonial_not_cleared: "A cited source is not recorded as free of stories or testimonials.",
  small_cell_risk_not_cleared: "A cited source is not recorded as free of small-cell re-identification risk.",
  cited_claims_not_currently_eligible: "At least one cited claim is not currently eligible for internal use.",
  source_version_not_current: "A cited source has been replaced by a newer version.",
  processing_permission_not_established: "A cited source no longer permits this use or AI processing.",
});

// Owner decision 2026-10-25: why a draft is not (yet) the organization's
// internal report, from the server's internalReport reason codes.
export const INTERNAL_REPORT_REASON_MESSAGES = Object.freeze({
  ...INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES,
  content_type_requires_get_kinder_review: "Get Kinder reviews this type of draft.",
  audience_requires_get_kinder_review: "Only internal drafts are available as internal reports.",
  validator_results_not_passed: "This draft did not pass every automated check when it was generated.",
  structural_facts_only: "Every claim it cites is a structural fact (which columns a source has), so it documents source structure, not a programme result.",
});

export const STRUCTURAL_ONLY_DRAFT_MESSAGE = "Structural facts only: this saved draft documents which columns a source has, "
  + "not a measured programme result, so it is not an impact report, and a review would not make it one. It is kept exactly as it was "
  + "generated, with its citations and history. To produce a usable internal report, select a measured finding under Claims for internal "
  + "drafts and generate a new draft (use Count records in Data Sources first if there is none; it works on a single-table CSV file "
  + "or on one worksheet you select in an Excel workbook, never adding worksheets together).";

export const INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS = Object.freeze({
  cited_claims_not_currently_eligible: "Each cited claim's current condition is shown on it under Claims for internal drafts. A new draft from claims "
    + "marked \"Usable in internal reports now\" is usable immediately; this draft becomes available only once every claim it cites is usable.",
  source_version_not_current: "Ask Get Kinder to reconcile the cited source version, then reload this draft.",
  processing_permission_not_established: "Ask Get Kinder to review the cited source's current processing permission, then reload this draft.",
});

export function internalDraftFactualReviewHeading(reviewState, factualReview) {
  return factualReview?.actorMayApprove === false
    && Array.isArray(factualReview.blockedReasons)
    && factualReview.blockedReasons.length > 0
    ? "Factual approval blocked"
    : INTERNAL_DRAFT_REVIEW_STATE_LABELS[reviewState] || "Review state unavailable";
}

export function internalDraftFactualReviewNextActions(blockedReasons) {
  if (!Array.isArray(blockedReasons)) return [];
  return [...new Set(blockedReasons.map((code) => INTERNAL_DRAFT_FACTUAL_REVIEW_NEXT_ACTIONS[code]).filter(Boolean))];
}

// Owner amendment 2026-10-23: why a reviewed draft is released by Get Kinder,
// or cannot be released now, from the server's organizationRelease codes.
export const INTERNAL_DRAFT_RELEASE_REASON_MESSAGES = Object.freeze({
  ...INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES,
  content_type_requires_get_kinder_review: "Only internal evidence summaries can be released by your organization; Get Kinder releases this type.",
  audience_requires_get_kinder_review: "Only internal drafts can be released by your organization.",
  factual_review_not_complete: "The factual review of this draft is not complete.",
  release_state_not_current: "A cited claim, source or citation changed since this draft was generated.",
  release_withdrawn_by_get_kinder: "Get Kinder withdrew this release; only Get Kinder can release it again.",
});

export const INTERNAL_DRAFT_LIMITATION_MESSAGES = Object.freeze({
  internal_use_only: "Internal use only.",
  not_approved_for_external_use: "Not approved for funder or public use, export, or release.",
  awaiting_get_kinder_review: "Get Kinder has not reviewed this draft.",
  awaiting_organization_review: "At least one cited claim or source is not yet usable for internal reports.",
  cited_claims_not_currently_eligible: "At least one cited claim is not usable for internal use now.",
});

// Plan A Prompt 8: the server's release state for a reviewed internal draft.
export const INTERNAL_DRAFT_RELEASE_STATE_LABELS = Object.freeze({
  awaiting_get_kinder_review: "Awaiting Get Kinder review",
  awaiting_organization_review: "Awaiting your factual review",
  awaiting_get_kinder_release: "Reviewed; awaiting Get Kinder release",
  awaiting_organization_release: "Reviewed; awaiting your release decision",
  released_for_internal_use: "Released for internal use",
  release_no_longer_valid: "Released earlier; no longer available",
  release_status_unavailable: "Release status not available",
});

export const INTERNAL_DRAFT_RELEASE_STATE_MESSAGES = Object.freeze({
  awaiting_get_kinder_review: "Get Kinder reviews a draft before it can be released.",
  awaiting_organization_review: "A draft's factual review is completed before it can be released.",
  awaiting_get_kinder_release: "The factual review of this draft is complete. Get Kinder has not released it yet; there is nothing to download.",
  awaiting_organization_release: "The factual review of this draft is complete. Nothing is released until your organization's administrator decides to release it.",
  released_for_internal_use: "This report is released for your organization's internal use. It is not approved for funders or the public.",
  release_no_longer_valid: "This release can no longer be opened: Get Kinder withdrew it, or a source or claim it relies on changed. Ask Get Kinder to review it again.",
  release_status_unavailable: "Released reports cannot be opened from here right now.",
});

// Owner amendment 2026-10-23: who made the release, from the role recorded on
// its final-release decision.
export const INTERNAL_DRAFT_RELEASED_BY_LABELS = Object.freeze({
  your_organization: "Released by your organization",
  get_kinder: "Released by Get Kinder",
});
