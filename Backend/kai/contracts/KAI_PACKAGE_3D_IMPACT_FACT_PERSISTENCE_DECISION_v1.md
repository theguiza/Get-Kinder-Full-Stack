# KAI Package 3D — Impact Fact Persistence Readiness Decision v1

```text
decision_version: 1.0.0
package: Package 3D
decision_scope: persistence readiness decision only
document_type: non-executable decision record
implements_code: false
creates_migrations: false
creates_database_tables: false
creates_kai_tools: false
changes_existing_kai_behavior: false
supersedes: none
status: accepted
```

## 1. Scope

This record answers one bounded question: does the repository currently provide sufficient governed architecture to support persisted Impact Facts if a future owner-authorized product requirement requires them? It does not reopen persistence for implementation, does not decide that persisted Impact Facts are needed, and does not modify Package 3A, Package 3B, Package 3C, Current State, or the Implementation Baseline.

## 2. Evidence classes

- `TOOL_VERIFIED` — established by fresh repository inspection performed while producing this record.
- `USER_CONFIRMED` — accepted as controlling context from the task's starting-state description (prior package completion, branch/commit lineage as reported).
- `NOT_CONFIRMED` — not established by this record; stated explicitly rather than assumed.

## 3. Current Package 3A/3B/3C context

`TOOL_VERIFIED`: the currently inspected Package 3A file defines the Impact Fact abstraction as a product/technical concept only, implements no code, schema, or tool, and lists structural requirements (identity, statement, provenance, strength, review status, sensitivity/eligibility, time bounds, versioning) that a future implementation would have to satisfy. The currently inspected Package 3B file is a non-executable decision record that states KAI builds derived Impact Intelligence (`ImpactEvidenceView`) before introducing persisted Impact Facts, and that persisted Impact Facts are deferred. The inspected Package 3C repository implementation contains `Backend/kai/services/kaiImpactIntelligenceService.js`, a derived, read-only, non-persisted reference implementation of `ImpactEvidenceView` over `kaiClaimLibraryService` / `kaiClaimTraceabilityService`, exercised by `__tests__/kai-package-3c-impact-intelligence.spec.js`.

`USER_CONFIRMED`: owner-accepted historical/contextual Package 3A and Package 3B decisions remain controlling context for this record, including the deferred persistence decision and the requirement that persistence be reconsidered only when both product necessity and repository readiness are established.

`NOT_CONFIRMED`: rereading Package 3A or Package 3B does not independently establish embedded repository/runtime claims as current runtime facts; runtime facts remain limited to what this Package 3D inspection actually verified.

## 4. PRODUCT_NECESSITY status

```text
PRODUCT_NECESSITY: NOT_CONFIRMED
```

No explicit owner-authorized product requirement for persisted Impact Facts was supplied to this task. Per this task's own decision rule, an unconfirmed product necessity is dispositive on its own: the presence or absence of repository readiness does not change the outcome. Repository readiness is still assessed below because it is required to construct an accurate future tripwire.

## 5. Repository-readiness findings (TOOL_VERIFIED unless marked otherwise)

### 5.1 Evidence relationship

`CURRENT_RELATIONSHIP: ONE_EVIDENCE_TO_ONE_CLAIM`. `kai.claim_evidence_links` (`migrations/kai_sprint2_p2_03_claim_proposal.sql`) carries a `UNIQUE (organization_id, claim_id)` constraint (`claim_evidence_links_p2_03_one_link_per_claim_unique`), and `kai.claims.evidence_item_id` is a single non-null column. `MANY_EVIDENCE_TO_ONE_FACT_SUPPORTED: false`. The migration's own comment states today's cardinality is exactly one link per claim and that a later package may extend it — no such extension is present. The inspected current evidence/claim model establishes one evidence link per claim; no governed many-evidence-to-one Impact Fact relationship is established in the inspected model. This record did not exhaustively prove a schema-wide absence of every possible many-to-one relationship.

### 5.2 Provenance readiness

`CURRENT_PROVENANCE_MODEL`: a linear chain — `kai.source_locators` → `kai.evidence_items` (one source/source_version/locator each) → `kai.claims` (one evidence item each, via `claim_evidence_links`). `REUSABLE_FOR_PERSISTED_FACT: partial`. The inspected evidence/claim lineage supports the existing single-evidence claim relationship, but that inspected model does not establish generalized many-evidence synthesized-Impact-Fact provenance semantics. `MISSING_SEMANTICS`: a many-evidence-to-one-fact provenance link; existing claim traceability provenance is 1:1 and does not generalize to synthesis without additional governed architecture if persistence is reopened later.

### 5.3 Governance-field liveness

| FIELD | STORED | LIVE_WRITER | HUMAN_GATED | PLACEHOLDER_OR_PINNED | CURRENT_OBJECT_SEMANTICS | REUSABLE_FOR_PERSISTED_IMPACT_FACT |
|---|---|---|---|---|---|---|
| strength (`support_strength` / `claim_strength`) | Yes, on `evidence_items` / `claims` | NOT_CONFIRMED — `migrations/kai_sprint2_p2_09_human_review_internal_approval.sql` widens the CHECK constraint from a single pinned value to permit `('unassessed', 'reviewed_supported')`; that is a schema permission, not a traced runtime writer | NOT_CONFIRMED — the migration's own comment ties the transition to a human evidence/claim-review completion path, but this assessment did not trace the enforcing runtime path | No longer single-value pinned as of P2-09; the CHECK now permits `unassessed` and `reviewed_supported` | Belongs to evidence items / claims specifically, one column per object | No — a persisted Impact Fact per Package 3A needs its own independent strength state, not a borrowed evidence/claim column |
| review status (`evidence_review_status` / `claim_review_status`, `kai.review_queue_items.review_status`) | Yes | NOT_CONFIRMED — `kai.review_queue_items` has a `review_status` CHECK permitting `proposed`, `needs_gk_review`, `resolved`, and a `queue_type`/`target_object_type` polymorphic pattern (`migrations/kai_sprint2_p1_06_review_queue.sql`); P2-09 establishes evidence-review and claim-review audit-metadata contracts; this assessment did not trace the actual writer function/service/repository path | NOT_CONFIRMED — the inspected migration and audit-metadata contract describe human-review semantics but do not themselves prove the runtime enforcement path | `evidence_items.evidence_review_status` / `claims.claim_review_status` remain pinned to `'needs_gk_review'` at the object-column level (P2-09 deliberately left these untouched); the inspected review-queue schema permits separate `review_status` states on linked `review_queue_items`, but this assessment did not trace their runtime writer path | `review_queue_items.queue_type` is a closed CHECK-constrained vocabulary currently permitting 10 explicit workflow categories beyond only evidence and claim review | Partial — the generic queue structure provides a reusable architectural pattern, but adding an Impact-Fact-specific queue type would require an explicit controlled schema extension; no `impact_fact_review` value or Impact Fact-specific review lifecycle exists today |
| review status (`review_queue_items.target_object_type`) | Yes, `text`, no FK/CHECK enum tying it to a fixed object-type list | N/A | N/A | Free-text column, not currently pinned to a closed vocabulary | Generic pointer, reused across object types by convention only | `NOT_CONFIRMED` — this assessment did not establish that `target_object_type` values are validated against real object identity |
| sensitivity (`sensitivity_level`) | Yes, on `evidence_items` | NOT_CONFIRMED — no live writer was found in the inspected Package 3D scope for `evidence_items.sensitivity_level` beyond the P2-01 pinned `CHECK (sensitivity_level = 'unknown')`, which P2-09 did not touch | NOT_CONFIRMED | Pinned | Belongs to evidence items | No — still pinned at evidence-item level, so it cannot be shown as a live model for a new object type |
| eligibility / allowed use (`internal_only`, `public_use_allowed`, `funder_use_allowed`, `llm_processing_allowed`, `product_learning_allowed`) | Yes, on `evidence_items` and `claims` | NOT_CONFIRMED — no live writer was found in the inspected Package 3D scope; both P2-01 and P2-03 pin all five booleans with fail-closed `CHECK` constraints | NOT_CONFIRMED | Pinned | Belongs to evidence items / claims, five columns each | No — no live eligibility transition was established in the inspected scope |
| approval | Not a distinct field — folded into `claim_status` / `evidence_review_status` + review queue resolution | NOT_CONFIRMED — Package 3D did not establish a distinct Impact Fact approval writer/lifecycle; this row does not inherit writer/human-gate status from the review-status row | NOT_CONFIRMED | `claim_status` pinned to `'proposed'`; review-queue resolution exists as a separate existing mechanism | Belongs to claims | No — no standalone approval concept beyond the pinned status plus queue resolution |
| limitations | Not stored as a discrete field; Package 3C's `explainImpactEvidence` renders limitations at read time as narrative text (`buildExplanationNarrative`, `Backend/kai/services/kaiImpactIntelligenceService.js`) | N/A — derived/read-only | N/A | N/A | Presentation-time text, not a governed stored field | No — this is a derived-view narrative, not object governance state |

### 5.4 Durable identity

`CURRENT_CANDIDATE`: `evidence_items.evidence_item_id`, `claims.claim_id` (both `uuid`, org-scoped via composite unique constraints). `SUITABLE: false`. `WHY`: `evidence_item_id` provides durable identity for an evidence item, `claim_id` provides durable identity for a claim, and other existing schema objects also retain their own existing object identities. No inspected current object establishes independent synthesized-Impact-Fact identity semantics, so existing evidence or claim IDs cannot simply be relabeled as Impact Fact identity.

### 5.5 Versioning / history / supersession

`VERSIONING_SUPPORTED`: only at the source level — `kai.source_versions.is_current` with a partial unique index (`ux_source_versions_p1_08_current_per_source`, `migrations/kai_sprint2_p1_08_source_promotion.sql`) enforcing at most one current version per source. `SUPERSESSION_SUPPORTED`: same, source-level only. `CURRENT_MECHANISM`: `is_current` boolean + partial unique index; no such column or index exists on `evidence_items`, `claims`, or `claim_evidence_links` — those tables are append-only rows with no revision concept. `REUSABLE_FOR_PERSISTED_IMPACT_FACT: false` — the source-level pattern is architecturally reusable as a model, but no evidence-, claim-, or fact-level table implements it today, so it would need new schema, not reuse of an existing live path.

### 5.6 Review / approval

`CURRENT_REVIEW_MODEL`: `kai.review_queue_items`, polymorphic via `queue_type` + `target_object_type` + `target_object_id`, with review_status schema states permitting proposed, needs_gk_review, and resolved. P1-06's `review_queue_items_p1_06_queue_type_check` establishes a closed `queue_type` vocabulary currently permitting 10 explicit workflow categories: `intake_file_review`, `source_candidate_review`, `sensitivity_review`, `data_dictionary_review`, `evidence_review`, `claim_review`, `client_followup`, `conflict_resolution`, `generated_content_review`, and `export_review`; those categories extend beyond evidence and claim review. The inspected P1-06 evidence explicitly establishes P1-06's own `sensitivity_review` use. The inspected P2-09 evidence establishes the evidence-review and claim-review human-review transition/audit contracts (`upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check` / `..._claim_review_metadata_object_check`). This assessment did not trace live runtime writers for every other allowed queue type, so writer status for the remaining allowed queue types is `NOT_CONFIRMED`. `REUSABLE_FOR_PERSISTED_IMPACT_FACT: partial`. `WHY`: the generic queue structure provides a reusable architectural pattern, but no `impact_fact_review` or equivalent Impact Fact queue type exists in the inspected vocabulary, and no Impact Fact-specific transition semantics or audit contract was established. The generic queue must not be described as an already-implemented Impact Fact governance lifecycle.

### 5.7 Eligibility / allowed use

`CURRENT_ELIGIBILITY_MODEL`: five boolean flags (`internal_only`, `public_use_allowed`, `funder_use_allowed`, `llm_processing_allowed`, `product_learning_allowed`) duplicated on both `evidence_items` and `claims`, each currently fail-closed pinned by `CHECK` constraints in the inspected migrations. `CURRENT_OBJECT_TYPE`: evidence items and claims. `REUSABLE_FOR_PERSISTED_IMPACT_FACT: false`. `WHY`: Package 3A §4.3 and §4.6 require an Impact Fact's eligibility to be inherited as the floor across potentially multiple contributing evidence items — the inspected Package 3D evidence did not establish aggregation logic computing a floor across more than one evidence item; the current model computes/pins eligibility per single object only.

### 5.8 Authorization / tenant boundary

`CURRENT_BOUNDARY`: every inspected table scopes rows by `organization_id`, and every cross-table foreign key is a composite key that includes `organization_id` (e.g. `evidence_items_p2_01_source_version_fk`, `claims_p2_03_evidence_item_fk`), rather than an unscoped id-only foreign key. `REUSABLE_PATTERN_EXISTS: true` — this composite-FK, org-scoped convention is consistent across `sources`, `source_versions`, `source_locators`, `evidence_items`, `claims`, `claim_evidence_links`, and `review_queue_items`. `NEW_AUTHORIZATION_MODEL_REQUIRED: false` for the tenant-boundary shape specifically — a future fact table could follow the same composite-FK convention without inventing a new authorization primitive. This finding is narrower than full governance readiness: it covers only the tenant-scoping pattern, not the governance-field liveness gaps found in 5.3–5.7.

## 6. Derived-view sufficiency finding

```text
DERIVED_VIEW_INSUFFICIENCY: NO_PROVEN_DERIVED_VIEW_INSUFFICIENCY
```

Fresh inspection confirms the Package 3C material findings still hold: `listImpactEvidence` and `explainImpactEvidence` (`Backend/kai/services/kaiImpactIntelligenceService.js`) compose the existing `kaiClaimLibraryService` / `kaiClaimTraceabilityService` reads into derived evidence discovery and explanation, with no independent persistence. A repository-wide search found no caller of `kaiImpactIntelligenceService`, `listImpactEvidence`, or `explainImpactEvidence` outside `__tests__/kai-package-3c-impact-intelligence.spec.js` — no route, tool, or other service imports it. This is an **intentionally unwired reference implementation**, consistent with its own file header comment, not a live runtime capability. No explicit owner-authorized product requirement demonstrating derived-view insufficiency was supplied to the Package 3D task, and repository inspection established no technical/runtime condition in the inspected Package 3C path that itself requires persisted Impact Facts.

## 7. Decision

```text
PERSISTED_IMPACT_FACTS_REMAIN_DEFERRED
```

## 8. Decision basis

- `PRODUCT_NECESSITY: NOT_CONFIRMED` (§4) is independently dispositive under this task's decision rule.
- Repository readiness also does not establish a safe persisted-fact lifecycle today: the inspected model establishes no many-evidence-to-one Impact Fact relationship (§5.1–5.2), no independent synthesized-Impact-Fact identity semantics (§5.4), no versioning/supersession mechanism above the source level (§5.5), and no eligibility/sensitivity governance model for multi-evidence aggregation (§5.3, §5.7).
- The derived `ImpactEvidenceView` layer shows no proven current insufficiency (§6), so there is no repository-observed pressure to introduce persistence now.
- This finding is consistent with, and does not reopen, Package 3B §7–§8.

## 9. Consequences

- The Package 3B decision (derived Impact Intelligence before persisted Impact Facts) remains controlling.
- No schema, migration, service, tool, or UI work for persisted Impact Facts is authorized by this record.
- Package 3C's `kaiImpactIntelligenceService.js` remains an unwired reference implementation; this record does not direct any future package to wire it in.

## 10. Future tripwire

Both categories below must be satisfied before persisted Impact Facts may be reconsidered. Neither category is authorized by this record.

### Product requirement

An explicit owner-authorized product capability that the existing evidence/claim/derived-view architecture cannot adequately satisfy — for example (not authorized now, listed only as the shape of qualifying evidence): durable cross-workflow fact identity, governed multi-evidence organizational synthesis, historical/as-of organizational knowledge, or persistent organizational memory independent of current claim/evidence records.

### Repository readiness

The specific gaps found in this record must be closed with governed architecture, not placeholders, before a persisted fact lifecycle would be safe:

- A governed many-evidence-to-one Impact Fact relationship (§5.1) — not established in the inspected model; `claim_evidence_links` is constrained to exactly one link per claim.
- A provenance model that generalizes beyond single-evidence lineage (§5.2).
- A durable identity concept independent of evidence-item and claim identity (§5.4).
- A versioning/supersession mechanism at the fact level, analogous to but distinct from the existing source-level `is_current` pattern (§5.5).
- A review/approval queue extension (`queue_type`) specific to a fact object, with its own human-gated transition and audit-metadata contract, following the P2-09 pattern rather than reusing evidence/claim-specific semantics (§5.6).
- An eligibility-floor computation across more than one contributing evidence item (§5.7) — not established by the inspected Package 3D evidence.
- Confirmation that `review_queue_items.target_object_type` values are validated against real object identity if reused for a fact object, since such validation remains `NOT_CONFIRMED` in this assessment (§5.3).

## 11. Explicitly deferred implementation

This record does not create, and does not authorize a future package to create without separate authorization:

- `kai.impact_facts` or any equivalent persistence table;
- migrations or schema changes of any kind;
- persistence repositories, services, routes, or KAI tools for Impact Facts;
- UI for reviewing or browsing Impact Facts;
- multi-evidence synthesis, aggregation, clustering, or deduplication logic;
- fact-level versioning or supersession implementation;
- fact-level review/approval workflow implementation;
- any change to existing evidence/claim cardinality, governance, or eligibility behavior;
- any modification to Package 3A, Package 3B, Package 3C, Current State, or the Implementation Baseline.
