# KAI Package 3A — Impact Fact Contract v1

```text
contract_version: 1.0.0
package: Package 3A
decision_scope: product and technical concept definition only
document_type: non-executable contract
implements_code: false
creates_migrations: false
creates_database_tables: false
creates_kai_tools: false
changes_existing_kai_behavior: false
```

This document defines the Impact Fact abstraction: its meaning, boundaries, governance, lifecycle, and relationship to concepts that already exist in KAI. It is not DDL, not a migration, not a schema, not a tool definition, and not authorization to write code, alter the `kai.*` schema, or change any running behavior. It is a product and technical contract that later, separately authorized packages must conform to.

This package assumes the existing KAI vocabulary as fixed context and does not rename, redefine, or duplicate it: the **Impact Evidence Library**, `kai.evidence_items`, `kai.claims`, `kai.review_queue_items`, `kai.sources` / `kai.source_versions` / `kai.source_locators`, the governed request context, the review packet, and the traceability DTO. Where this contract introduces a new term, it says so explicitly.

---

## 1. What an Impact Fact is

> An Impact Fact is the smallest reusable, organization-scoped unit of trusted impact intelligence that KAI can cite by reference, in more than one claim or communication, without re-deriving it from source material each time.

Concretely, an Impact Fact is:

- **A governed statement**, not raw data. It says something about the organization's impact ("340 families completed the housing stability program in FY24"), not a copy of a spreadsheet cell.
- **Derived from one or more evidence items.** Every Impact Fact traces back to at least one `kai.evidence_items` row, and may synthesize several evidence items that support the same underlying assertion (e.g., the same headcount figure confirmed by an intake dataset and a funder report).
- **Deduplicated and reusable.** Where an evidence item is scoped to one source locator, an Impact Fact is scoped to one *assertion* — it exists so the same underlying truth is not re-proposed, re-reviewed, or restated inconsistently every time it is needed.
- **Independently governed.** An Impact Fact carries its own review status, strength, and sensitivity — it does not silently inherit "reviewed" status from the evidence items behind it (see §4).
- **Addressable and citable.** Anything downstream (a claim, a report, a future chatbot answer) references an Impact Fact by a stable identifier and fingerprint, not by re-stating its content.

### 1.1 Relationship to the existing pipeline

```text
organizational knowledge
        ↓
governed evidence          (kai.evidence_items — tied to one source/locator)
        ↓
Impact Facts                (NEW — reusable, deduplicated, independently governed assertions)
        ↓
impact intelligence         (aggregation, trend, comparison — future systems, out of scope here)
        ↓
claims and communications   (kai.claims — audience- and use-scoped assertions built from Impact Facts)
```

An Impact Fact sits **between** evidence and claims. It is the memory layer that lets KAI stop re-deriving the same assertion from source material every time a new claim or communication needs it, and lets it stop treating every claim as an isolated, one-off derivation from raw evidence.

---

## 2. What an Impact Fact is not

- **It is not a replacement for `kai.evidence_items`.** Evidence items remain the atomic, source-locator-bound record of what was found in a specific document, dataset, or field. Impact Facts are built *from* evidence items; they do not replace the evidence layer or its lineage guarantees.
- **It is not a replacement for `kai.claims`.** A claim is scoped to a specific use — an audience, a communication, an eligibility context (`internal_only`, `public_use_allowed`, `funder_use_allowed`). An Impact Fact is not scoped to a use; it is the reusable substrate that many claims can draw from.
- **It is not a report, a draft, or generated text.** Impact Facts are structured, governed statements — not the narrative prose that a future report generator or grant writer would produce from them.
- **It is not a raw data row, dataset snapshot, or file.** That is what `kai.sources` / `kai.source_versions` / `kai.source_locators` already govern.
- **It is not automatically trusted because AI proposed it.** Like existing evidence and claim strength fields, an Impact Fact's governance state must never be advanced by an `ai`/`system`/`import` actor — only by a mapped human actor, consistent with the existing human-review enforcement already in place for `support_strength` and `claim_strength`.
- **It is not a new database table, tool, or API surface as of this package.** This contract defines what an Impact Fact must be if and when a future, separately authorized package implements it.

---

## 3. Structural contract

This section defines the conceptual shape an Impact Fact must have. It is not a schema and does not authorize field names, types, or a migration — a future implementation package must translate this into an actual `kai.*` design, consistent with the naming and governance conventions already established for `evidence_items` and `claims`.

An Impact Fact must be able to carry:

| Concern | Requirement |
|---|---|
| Identity | A stable, organization-scoped identifier, independent of any single evidence item's identifier. |
| Statement | A canonical, human-readable assertion, plus a deterministic fingerprint of that statement (consistent with the existing `statement_fingerprint` pattern), so duplicate assertions can be detected rather than silently re-created. |
| Provenance | A traceable set of contributing evidence items (one or more `kai.evidence_items` references), never a statement with no evidence lineage. An Impact Fact with zero linked evidence items is not valid. |
| Strength | An independent strength/confidence state, defaulting to unassessed, following the same "AI proposes, human confirms" rule as existing `support_strength` / `claim_strength` fields. |
| Review status | An independent review status, following the same open → needs-review → reviewed lifecycle already used by `kai.review_queue_items`, not a status inherited automatically from its source evidence items. |
| Sensitivity & use eligibility | Its own sensitivity level and use-eligibility flags (internal-only / public-use / funder-use), inherited as a *floor* from its most restrictive contributing evidence item, never loosened by aggregation. |
| Time bounds | An explicit validity or "as-of" scope (e.g., the reporting period or date range the assertion is true for), since impact assertions are frequently time-bound and reuse without a validity scope risks stating stale facts as current. |
| Versioning | A way to represent that a fact's statement or underlying support changed over time without silently overwriting history — consistent with how `kai.source_versions` already treats sources as versioned rather than mutable in place. |

This package does not decide exact field names, exact enum values, storage representation, or whether Impact Facts live in a new `kai.impact_facts` table, a view over `kai.evidence_items`, or another structure. Those are implementation decisions for a future, separately authorized package.

---

## 4. Governance

An Impact Fact's governance must be **at least as strict as, and independent from**, the governance already enforced on evidence items and claims:

1. **AI may propose, only a human may confirm.** Consistent with the existing rule that only a mapped human actor (never `ai`, `system`, or `import`) may move `support_strength` or `claim_strength` out of `unassessed`, no Impact Fact may leave its unassessed/unreviewed state except through a human reviewer action.
2. **Review is queue-governed.** Impact Facts pending review must flow through the same kind of review-queue mechanism already used for evidence and claims (`kai.review_queue_items`-style `queue_type` / `target_object_type` pattern), not a separate, parallel review path invented for this concept alone.
3. **Aggregation does not launder governance state.** An Impact Fact synthesized from multiple evidence items is only as trustworthy as its weakest contributing evidence item. Sensitivity and use-eligibility flags are inherited as the most restrictive value among contributing evidence, not relaxed by combining sources.
4. **Provenance is mandatory, not optional.** An Impact Fact that cannot show its contributing evidence items is not a valid Impact Fact — it is an unsupported assertion, and KAI must never present the two as equivalent.
5. **Revision, not silent mutation.** When new evidence changes what an Impact Fact should say, the change must be recorded as a governed revision (new version, review re-triggered), not an in-place overwrite of a previously reviewed statement.
6. **Use eligibility is inherited, not re-decided.** Consistent with "Decouple internal draft generation from use eligibility," an Impact Fact's own internal/public/funder-use flags are the input claims and drafts consult — draft generation must not bypass an Impact Fact's use-eligibility gate the way it does not bypass a claim's.

---

## 5. How KAI uses an Impact Fact

- **Retrieval instead of re-derivation.** When KAI needs to support a new claim or answer a question about organizational impact, it should first check whether a governed Impact Fact already exists for that assertion before re-deriving it from raw evidence.
- **Deduplication.** The statement fingerprint lets KAI detect when a newly proposed assertion already exists as an Impact Fact, so the same headcount or outcome figure is not independently proposed, reviewed, and possibly answered inconsistently multiple times.
- **Claim assembly.** A claim's evidentiary basis can be expressed as a reference to one or more Impact Facts, in addition to (or instead of) a direct evidence-item reference — this is additive to the existing claim-to-evidence relationship, not a replacement for it.
- **Traceability.** Anywhere the existing traceability DTO or review packet discloses an evidence chain for a claim, an Impact Fact-aware traceability chain must be able to show: claim → Impact Fact(s) → contributing evidence item(s) → source/version/locator. The chain must never skip the Impact Fact layer and imply a claim goes directly from statement to raw source once Impact Facts exist.

---

## 6. Future consumers

Impact Facts are the reusable substrate for systems KAI does not implement today. This contract does not authorize building any of them; it defines the shape they will consume:

- A future report generator, drawing on governed Impact Facts rather than re-deriving language from raw evidence for every report.
- A future grant-writing assistant, citing Impact Facts as its evidentiary basis, gated by the same use-eligibility flags already governing claims.
- A future conversational/chat interface, answering impact questions by retrieving and citing Impact Facts rather than generating unsupported text.
- A future organization-level impact-intelligence layer (trends, comparisons, aggregates across Impact Facts), which is explicitly out of scope for this package and is not designed here.

---

## 7. Explicitly deferred (not decided by this package)

- Exact storage design: new table(s) vs. derived/materialized view over `kai.evidence_items`.
- Exact field names, enum values, and constraints.
- The synthesis mechanism by which multiple evidence items are proposed as contributing to one Impact Fact (automated matching vs. human-initiated grouping).
- API/route surface for creating, reviewing, or querying Impact Facts.
- Any KAI tool that would read or write Impact Facts.
- UI for reviewing or browsing Impact Facts.
- Versioning mechanics in storage terms (append-only log vs. version table vs. other).
- How "as-of"/time-bound validity interacts with the existing `internal_only` / `public_use_allowed` / `funder_use_allowed` flags over time (e.g., does an Impact Fact expire).

Each of the above requires a separate, explicitly authorized implementation package before any code, schema, or tool is written.
