# KAI Baseline Impact Requirements Catalogue — B1.2 Final Canonical

---

## Domain: Purpose & Intended Change (PUR)

### ir_pur_001

- **requirement_label:** Intended outcome is explicitly defined
- **requirement_description:** For each impact claim scope, the organization has articulated, in an explicit statement, the specific change it intends to create — distinct from the activities or outputs it delivers.
- **why_it_matters:** This is the anchor every other requirement depends on; nothing downstream can be assessed without it.
- **expected_knowledge_or_evidence:** A recorded outcome statement naming the intended change.
- **framework_basis:** Common Foundations — Describe intended change; Impact Frontiers — What
- **current_KAI_input_mapping:** `kai.impact_outcome_contexts.outcome_statement`
- **input_support_status:** SUPPORTED_INPUT_EXISTS

### ir_pur_002

- **requirement_label:** Rationale connecting activities to the intended outcome is known
- **requirement_description:** The organization can state, at least narratively, why it believes its program activities lead to the stated outcome.
- **why_it_matters:** An outcome statement alone doesn't establish plausibility; coverage later needs to know whether any causal rationale exists.
- **expected_knowledge_or_evidence:** A theory-of-change narrative, logic model, or equivalent.
- **framework_basis:** Common Foundations — Describe intended change; CIDS — Impact Model
- **current_KAI_input_mapping:** No dedicated field; only the free-text `outcome_statement`, which may or may not contain this content.
- **input_support_status:** PARTIAL_INPUT_EXISTS

---

## Domain: Program & Delivery (PROG)

### ir_prog_001

- **requirement_label:** The program/activity intended to produce the outcome is identified
- **requirement_description:** The specific program, service, or activity delivered toward the stated outcome is named and distinguishable from other things the organization does.
- **why_it_matters:** Evidence and outcomes must be scoped to a specific program, not the organization as an undifferentiated whole.
- **expected_knowledge_or_evidence:** A named program/activity linked to the outcome statement.
- **framework_basis:** CIDS — How (Program, Service, Activity) — draws on
- **current_KAI_input_mapping:** `kai.engagements` (externally owned, synthetic mirror only) carries `engagement_type`/`engagement_code` but no structured program-to-outcome link exists.
- **input_support_status:** NO_CURRENT_INPUT

### ir_prog_002

- **requirement_label:** The population targeted for delivery is known
- **requirement_description:** The organization can identify the population it intends to reach through the named program, as distinct from the population that experiences the outcome.
- **why_it_matters:** Needed to later separate "who we tried to reach" from "who changed" — reach and outcome populations aren't always identical.
- **expected_knowledge_or_evidence:** A defined target/delivery population.
- **framework_basis:** KAI product requirement
- **current_KAI_input_mapping:** No population field found on `kai.engagements` or elsewhere.
- **input_support_status:** NO_CURRENT_INPUT

---

## Domain: Stakeholders (STK)

### ir_stk_001

- **requirement_label:** The stakeholder experiencing the intended outcome is identified
- **requirement_description:** For each intended outcome, the specific stakeholder group expected to experience it (as opposed to merely receiving a service) is named.
- **why_it_matters:** This is the crux of the output-vs-outcome distinction the canonical sanity test relies on.
- **expected_knowledge_or_evidence:** A stakeholder identifier/label associated with the outcome statement.
- **framework_basis:** CIDS — Who / Stakeholder — draws on; Impact Frontiers — Who — informed by
- **current_KAI_input_mapping:** `kai.impact_outcome_contexts.stakeholder_key` / `stakeholder_label`
- **input_support_status:** SUPPORTED_INPUT_EXISTS

---

## Domain: Outcomes (OUT)

### ir_out_001

- **requirement_label:** The stated outcome is distinguished from the output(s) that precede it
- **requirement_description:** The outcome statement identifies a change in condition, behavior, knowledge, or status — not merely a count of people served or activities completed.
- **why_it_matters:** Directly operationalizes the canonical test: "100 people served" is an output fact, not evidence an outcome occurred.
- **expected_knowledge_or_evidence:** An outcome statement describing a change in condition, distinct from a delivery count.
- **framework_basis:** CIDS — What (Outcome) vs How (Output) — draws on; Impact Frontiers — What — informed by
- **current_KAI_input_mapping:** `outcome_statement` exists as free text; no structured validation currently distinguishes an outcome-shaped statement from an output-shaped one.
- **input_support_status:** PARTIAL_INPUT_EXISTS

### ir_out_002

- **requirement_label:** The applicable measurement period is known
- **requirement_description:** The organization knows the period over which the outcome is expected to emerge and be measured (e.g., during the program, at exit, at a defined follow-up interval).
- **why_it_matters:** Without a known period, results can't be interpreted consistently or compared over time.
- **expected_knowledge_or_evidence:** A defined measurement period or timing convention.
- **framework_basis:** KAI product requirement — primary basis; Common Foundations — Use indicators — conceptual relationship only
- **current_KAI_input_mapping:** No time-period field found anywhere in the reviewed schema.
- **input_support_status:** NO_CURRENT_INPUT

---

## Domain: Indicators (IND)

### ir_ind_001

- **requirement_label:** At least one indicator is associated with the intended outcome
- **requirement_description:** The organization has identified at least one specific, observable measure used to track progress toward the stated outcome.
- **why_it_matters:** An outcome with no associated indicator can't be assessed at all.
- **expected_knowledge_or_evidence:** One or more named indicators linked to the outcome.
- **framework_basis:** Common Foundations — Use indicators — informed by; CIDS — How Much / Indicator — draws on; Impact Frontiers — How Much — informed by
- **current_KAI_input_mapping:** No indicator entity found in the schema; evidence items are pinned to a single generic `evidence_type`, not an outcome-specific indicator.
- **input_support_status:** NO_CURRENT_INPUT

### ir_ind_002

- **requirement_label:** The indicator's unit and direction of desired change are known
- **requirement_description:** For each indicator, what is being measured (unit) and which direction represents progress are known.
- **why_it_matters:** A named indicator without a known unit/direction can't be read as progress or regression.
- **expected_knowledge_or_evidence:** Stated unit and direction of desired change.
- **framework_basis:** Common Foundations — Use indicators; CIDS — How Much / Indicator
- **current_KAI_input_mapping:** None
- **input_support_status:** NO_CURRENT_INPUT

---

## Domain: Data & Evidence (DATA)

### ir_data_001

- **requirement_label:** The source and provenance of data used as evidence is known and governed
- **requirement_description:** Each piece of data supporting a claim can be traced to a specific, classified source with a known review/promotion status.
- **why_it_matters:** Impact claims are only as credible as the traceability of the data behind them.
- **expected_knowledge_or_evidence:** A source record with classified type and review status backing each evidence item.
- **framework_basis:** Common Foundations — Collect useful information — informed by; KAI product requirement
- **current_KAI_input_mapping:** `kai.sources` / `kai.source_versions` / `kai.source_locators`, `reviewed_source_type`, `kai.intake_source_candidates`, `kai.intake_promotion_decisions`
- **input_support_status:** SUPPORTED_INPUT_EXISTS

### ir_data_002

- **requirement_label:** Known limitations or quality issues in the underlying data are documented
- **requirement_description:** Data-quality concerns relevant to interpreting a claim (missingness, unclear definitions/time period/entity level, small-sample risk) are captured rather than left implicit.
- **why_it_matters:** Undocumented data-quality issues can silently overstate a claim's strength.
- **expected_knowledge_or_evidence:** Recorded quality notes/flags associated with the underlying data.
- **framework_basis:** Common Foundations — Collect useful information
- **current_KAI_input_mapping:** `kai.gap_log_items` + existing governed gap read surfaces. `missingness`, `definition_clarity`, `denominator_clarity`, `time_period_clarity`, `entity_level_clarity`, `small_cell_risk`, `conflicting_source_indicators` are values of `kai.gap_log_items.dimension_key`, not columns. `kai.data_dictionary_fields.quality_notes_safe`: supplementary / inert, not load-bearing.
- **input_support_status:** SUPPORTED_INPUT_EXISTS

### ir_data_003

- **requirement_label:** A reported outcome-performance statement has traceable supporting evidence
- **requirement_description:** Any statement about outcome performance is backed by an identifiable, linked piece of evidence rather than an unsupported assertion.
- **why_it_matters:** Baseline substantiation requirement distinguishing a credible impact knowledge base from an anecdotal one.
- **expected_knowledge_or_evidence:** An explicit link from the performance statement to its supporting evidence/source(s).
- **framework_basis:** KAI product requirement; CIDS — What / Outcome — conceptually maps to
- **current_KAI_input_mapping:** `kai.claim_evidence_links`; `kai.impact_evaluation_result_evidence_links` / `kai.impact_evaluation_result_claim_links` (A1.4 provenance)
- **input_support_status:** SUPPORTED_INPUT_EXISTS

---

## Domain: Performance & Impact (PERF)

### ir_perf_001

- **requirement_label:** The organization can distinguish output/reach performance from outcome/change performance
- **requirement_description:** When a performance result is reported, it is knowable whether it demonstrates reach/delivery or an actual change experienced by the stakeholder — the two are not treated as equivalent.
- **why_it_matters:** This is the central distinction in the canonical sanity test; without it, reach data can be silently substituted for outcome evidence.
- **expected_knowledge_or_evidence:** A classification or label marking a performance statement as reach/output vs. outcome/change.
- **framework_basis:** Impact Frontiers — What — informed by; KAI product requirement
- **current_KAI_input_mapping:** A2 derives `OUTCOME`/`OUTPUT_REACH` deterministically at request time from the persisted `assessment_state` of the "what" criterion. The classification itself is not persisted organizational knowledge and depends on a "what"-keyed criterion being present in the framework version.
- **input_support_status:** PARTIAL_INPUT_EXISTS

### ir_perf_002

- **requirement_label:** Performance is reported against the stated intended outcome, not a substitute measure
- **requirement_description:** A reported performance result can be traced back to the specific outcome/indicator it's meant to represent, rather than a looser, more available substitute.
- **why_it_matters:** Prevents measure substitution — reporting on whatever data is easiest rather than what was actually intended.
- **expected_knowledge_or_evidence:** An explicit link from a reported value to the specific outcome/indicator pair.
- **framework_basis:** Common Foundations — Gauge performance and impact — informed by; CIDS — How Much / Indicator — draws on
- **current_KAI_input_mapping:** No indicator entity exists yet (see `ir_ind_001`), so no structured link is possible.
- **input_support_status:** NO_CURRENT_INPUT

---

## Domain: Contribution, Limitations & Risk (CONTRIB)

### ir_contrib_001

- **requirement_label:** The organization's contribution to the observed outcome, versus other factors, is addressed
- **requirement_description:** Where an outcome is reported, the organization has stated what role its own program played relative to other plausible causes — even if only qualitatively.
- **why_it_matters:** An outcome can occur without the program causing it; addressing contribution guards against over-attribution.
- **expected_knowledge_or_evidence:** A stated judgment/rationale about relative contribution.
- **framework_basis:** Impact Frontiers — Contribution
- **current_KAI_input_mapping:** None
- **input_support_status:** NO_CURRENT_INPUT

### ir_contrib_002

- **requirement_label:** Known limitations affecting confidence in a reported result are documented
- **requirement_description:** Where a result carries a limitation affecting confidence (small sample, conflicting sources, unassessed evidence strength), that limitation is recorded rather than omitted.
- **why_it_matters:** A credible knowledge base discloses the limits of its own evidence.
- **expected_knowledge_or_evidence:** A recorded limitation, confidence/strength flag, or unresolved-gap indicator.
- **framework_basis:** Impact Frontiers — Risk; Common Foundations — Gauge performance and impact
- **current_KAI_input_mapping:** `kai.claims.claim_strength` / `kai.evidence_items.support_strength`, governed current states `unassessed` / `reviewed_supported` / `reviewed_not_supported`, set via the append-only P2-12 human-review decision ledgers (`kai.claim_review_decisions`, `kai.evidence_review_decisions`); plus governed limitation/gap inputs (`kai.gap_log_items`: `small_cell_risk`, `conflicting_source_indicators`, etc.)
- **input_support_status:** SUPPORTED_INPUT_EXISTS

### ir_contrib_003

- **requirement_label:** Unresolved conflicts or gaps affecting a claim are tracked to a decision before use
- **requirement_description:** Where claims conflict or a data-quality gap remains, that conflict/gap is tracked to a resolution status (resolved, risk-flagged, or knowingly left open) rather than disappearing silently.
- **why_it_matters:** Silent disappearance of a known issue is functionally equivalent to overstating certainty.
- **expected_knowledge_or_evidence:** A tracked conflict/gap record with a resolution status.
- **framework_basis:** Impact Frontiers — Risk; KAI product requirement
- **current_KAI_input_mapping:** `kai.gap_log_items.assessment_status`; `kai.conflict_groups`; `kai.review_queue_items` (`queue_type=conflict_resolution`)
- **input_support_status:** SUPPORTED_INPUT_EXISTS

---

## Domain: Learning & Improvement (LEARN)

### ir_learn_001

- **requirement_label:** Findings inform a subsequent decision about the program or its measurement approach
- **requirement_description:** When a finding is produced, there is a record of what decision it informed (a program adjustment, a change to what's measured, or a deliberate decision to continue unchanged).
- **why_it_matters:** Separates "we measured it" from "we used it."
- **expected_knowledge_or_evidence:** A recorded link between a finding and a subsequent decision.
- **framework_basis:** Common Foundations — Communicate and use results
- **current_KAI_input_mapping:** None
- **input_support_status:** NO_CURRENT_INPUT

### ir_learn_002

- **requirement_label:** Review of a claim, evidence item, or evaluation result by a qualified reviewer is known
- **requirement_description:** Review of a claim, evidence item, or evaluation result by a qualified reviewer is known.
- **why_it_matters:** Distinguishes AI-proposed or unreviewed content from organization-confirmed knowledge.
- **expected_knowledge_or_evidence:** A review status and reviewer decision.
- **framework_basis:** KAI product requirement
- **current_KAI_input_mapping:** Claims have accountable human-review decision lineage (`kai.claim_review_decisions`: `decided_by`, `decided_by_role`, `decision_outcome`, append-only). Evidence items have accountable human-review decision lineage (`kai.evidence_review_decisions`, same shape). Impact Evaluation results do not currently have an equivalent reviewer-identity / reviewer-role / decision-outcome decision surface. Because evaluation results are explicitly included in the requirement, a material part of the required organizational knowledge is absent.
- **input_support_status:** PARTIAL_INPUT_EXISTS

**CURRENT CAPABILITY GAP:** Impact Evaluation results lack an accountable human-review decision surface equivalent to the P2-12 claim/evidence decision ledgers. (Not implemented in this pass.)

---

## Domain: Communication & Accountability (COMM)

### ir_comm_001

- **requirement_label:** Who a result is permitted to be shared with is known before it is communicated
- **requirement_description:** For any claim/evidence/result, the organization knows the audience(s) it is currently approved for, distinct from audiences not yet approved.
- **why_it_matters:** Prevents premature or unauthorized external communication of unreviewed or partially-supported findings.
- **expected_knowledge_or_evidence:** An explicit permitted-audience designation.
- **framework_basis:** Common Foundations — Communicate and use results
- **current_KAI_input_mapping:** `kai.claim_review_decisions.approved_audiences` + current governed audience authorization/read path. Current effective state: internal = permitted, funder = not permitted, public = not permitted. Funder/public authorization capability: NOT IMPLEMENTED (not treated as absence of governed audience information).
- **input_support_status:** SUPPORTED_INPUT_EXISTS

### ir_comm_002

- **requirement_label:** A reported result can be traced back to who is accountable for its accuracy
- **requirement_description:** A reported result can be traced back to who is accountable for its accuracy.
- **why_it_matters:** Accountability requires a known responsible party — without it, an inaccurate public claim can't be corrected at its source.
- **expected_knowledge_or_evidence:** A recorded creator/reviewer/approver identity or role.
- **framework_basis:** KAI product requirement
- **current_KAI_input_mapping:** Per the settled product boundary (evidence → governed claims → human review → audience eligibility → generation from eligible evidence/claims → generated draft → review/export), the accountable communicable assertion flows through governed claims. `kai.claim_review_decisions`: `decided_by`, `decided_by_role`, `decision_outcome`, `created_at`, `supersedes_decision_id`, append-only decision lineage. (Impact Evaluation results themselves do not have accountable human-review lineage — not claimed here.)
- **input_support_status:** SUPPORTED_INPUT_EXISTS

---

```text
B1.2 FINAL CANONICAL STATE

CATALOGUE
- domains: 10
- requirements: 21
- requirement keys B1.1-compatible: 21/21
- set keys B1.1-compatible: 10/10
- requirements added: 0
- requirements removed: 0
- requirements merged: 0
- requirements split: 0

INPUT SUPPORT MEMBERSHIP

SUPPORTED_INPUT_EXISTS:
- ir_pur_001
- ir_stk_001
- ir_data_001
- ir_data_002
- ir_data_003
- ir_contrib_002
- ir_contrib_003
- ir_comm_001
- ir_comm_002

PARTIAL_INPUT_EXISTS:
- ir_pur_002
- ir_out_001
- ir_perf_001
- ir_learn_002

NO_CURRENT_INPUT:
- ir_prog_001
- ir_prog_002
- ir_out_002
- ir_ind_001
- ir_ind_002
- ir_perf_002
- ir_contrib_001
- ir_learn_001

CURRENT CAPABILITY GAP
- impact-evaluation-result accountable human review: MISSING
- catalogue consequence: ir_learn_002 = PARTIAL_INPUT_EXISTS

ir_contrib_002
- classification: SUPPORTED_INPUT_EXISTS

ir_learn_002
- classification: PARTIAL_INPUT_EXISTS

ir_comm_002
- classification: SUPPORTED_INPUT_EXISTS

PERSISTENCE IDENTITY
- source_type: kai_standard
- source_code: kai_baseline_impact_requirements
- framework_code: kai_baseline_impact_v1
- version_label: v1
- framework_status: draft

B1.2 STATUS:
OWNER-REVIEW READY

UNRESOLVED OWNER DECISIONS:
NONE

NEXT ACTION:
OWNER ACCEPTANCE OF THIS EXACT CANONICAL CATALOGUE
```
