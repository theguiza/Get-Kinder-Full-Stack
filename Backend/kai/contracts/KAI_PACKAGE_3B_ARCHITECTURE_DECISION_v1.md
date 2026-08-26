# KAI Package 3B — Derived Impact Intelligence Architecture Decision v1

```text
decision_version: 1.0.0
package: Package 3B
decision_scope: architecture decision only
document_type: non-executable decision record
implements_code: false
creates_migrations: false
creates_database_tables: false
creates_kai_tools: false
changes_existing_kai_behavior: false
supersedes: none
status: accepted
```

This document is a decision record, not a feasibility study. Package 3B feasibility work has already been completed and accepted; this record exists only to make that accepted decision durable so that Package 3C — Derived Impact Intelligence — can be implemented without reopening the architectural question. It assumes the Package 3A Impact Fact contract (`KAI_PACKAGE_3A_IMPACT_FACT_CONTRACT_v1.md`) as fixed context and does not redefine the Impact Fact abstraction described there.

---

## 1. Decision

**KAI will build derived Impact Intelligence before introducing persisted Impact Facts. Persisted Impact Facts are deferred.**

The immediate architectural direction:

```text
existing governed evidence
+
existing provenance / lineage
+
existing claims / traceability
+
existing governance / eligibility state
        ↓
derived ImpactEvidenceView
        ↓
read-only Impact Intelligence
```

Package 3A defined what an Impact Fact would have to be *if and when* it is built. Package 3B decides that KAI does not build it yet — it builds a derived, read-only view over the existing governed foundation first, and learns from that before committing to a new persisted source of truth.

---

## 2. ImpactEvidenceView boundary

`ImpactEvidenceView` is:

- derived — computed from existing governed records, not stored as an independent record;
- read-only — it does not accept writes and has no lifecycle of its own;
- non-persisted — it is not backed by a new table, materialized view treated as a source of truth, or durable identifier;
- organization/engagement scoped through existing governed request context, not a new scoping mechanism;
- traceable to existing governed records — every element must be attributable back to the `kai.evidence_items` / `kai.claims` / `kai.sources` lineage that already exists;
- governance-preserving — it surfaces existing governance state, it does not compute new governance state;
- not a new source of truth;
- not an Impact Fact, and not a substitute for the Impact Fact abstraction defined in Package 3A.

`ImpactEvidenceView` may make existing governed information easier to understand. It may not create new factual authority.

---

## 3. Package 3C allowed scope

Package 3C — Derived Impact Intelligence — may implement the smallest coherent capability required for:

- **Derived representation** — `ImpactEvidenceView`.
- **Read-only Impact Intelligence service** — a service that composes existing governed evidence and traceability into structured derived intelligence without introducing another persistence layer.
- **Evidence discovery** — support answering "What impact evidence do we have?"
- **Evidence explanation** — support answering "What does this evidence support or mean?"
- **Existing foundation reuse** — Package 3C may reuse the existing governed evidence, sources, source versions, provenance/lineage, claims, traceability, review state, governance state, eligibility/allowed-use state, actor/organization/engagement context, authorization, and tenant controls, where those paths actually exist in the repository at implementation time.
- **Truthful derived limitations** — Package 3C may deterministically expose limitations already established by underlying governed state (e.g. `support_strength = unassessed` may render as "Support strength has not yet been assessed"; it must not render as "Medium confidence").

---

## 4. Governance Truth Rule

**Derived Impact Intelligence may make existing governed evidence easier to understand, but it must never make that evidence stronger, safer, more reviewed, more eligible, more certain, or more comprehensive than the underlying governed records establish.**

```text
unassessed  → remains unassessed
unknown     → remains unknown
blocked     → remains blocked
needs review → remains needs review
not eligible → remains not eligible
```

The derived layer must not manufacture confidence, approval, completed review, sensitivity classification, eligibility, factual authority, causal certainty, or organizational truth status. Distinctions between `unknown`, `false`, `not present`, `not reviewed`, `restricted`, and `not applicable` must be preserved and must not be collapsed into a generalized interpretation.

---

## 5. Provenance and Authority Rule

Every derived intelligence result remains subordinate to and traceable to the existing governed evidence system.

Permitted:

```text
existing governed evidence
+ existing lineage / provenance
+ existing claim / traceability state
+ existing governance state
        ↓
derived ImpactEvidenceView
```

Prohibited:

```text
AI interpretation
        ↓
new organizational fact
```

`ImpactEvidenceView` must not become a new evidence object, a new factual authority, a substitute for source lineage, a substitute for traceability, or a mechanism for bypassing governance.

---

## 6. Explicitly deferred architecture

Package 3B does **not** authorize:

- persisted Impact Fact storage;
- `kai.impact_facts` or an equivalent table;
- Impact Fact schema;
- Impact Fact migrations;
- Impact Fact persistence lifecycle;
- governed multi-evidence synthesis into a new Impact Fact;
- evidence aggregation architecture;
- automatic evidence clustering into facts;
- Impact Fact deduplication;
- Impact Fact versioning/history;
- a new Impact Fact governance lifecycle;
- automatic governance upgrades;
- AI-generated confidence scoring;
- AI approval;
- AI promotion of interpretation into organizational fact;
- new source promotion behavior;
- new evidence extraction;
- recommendation engines;
- evidence-gap recommendation workflows;
- Impact Studio/report/grant generation;
- public/funder release behavior.

These remain deferred unless separately justified and authorized in a future package.

---

## 7. Controlling reasons

### 7.1 Governance readiness

The existing foundation does not yet establish all operational governance behavior required to safely introduce a new persisted Impact Fact lifecycle. Derived intelligence must preserve existing governance states truthfully and must not convert states such as `unassessed`, `unknown`, `needs review`, `blocked`, or `restricted` into stronger conclusions.

### 7.2 Evidence relationship readiness

The existing foundation does not yet establish the governed many-evidence-to-one-Impact-Fact relationship required for durable synthesized Impact Facts. This decision does not assume the solution is to alter existing claim/evidence cardinality and does not invent an evidence aggregation architecture. That architectural decision remains deferred.

### 7.3 Reuse the existing governed foundation first

Existing governed evidence, lineage/provenance, claims, traceability, review, eligibility, authorization, and tenant boundaries should be composed before introducing another persistent source of truth. Package 3C must build intelligence over the existing governed foundation rather than duplicate it.

### 7.4 Learn before persisting

Derived Impact Intelligence should first establish what users actually need to understand, which provenance information matters, which governance dimensions matter, which recurring impact-knowledge patterns emerge, whether stable persisted organizational knowledge is actually required, and which future capabilities derived views cannot satisfy. Persistence should be reconsidered using product and repository evidence rather than assumed in advance.

---

## 8. Revisit conditions

Persisted Impact Facts may be reconsidered later only when product and repository evidence establishes both a genuine product requirement and sufficient supporting governed architecture. Relevant future evidence may include a demonstrated need for stable reusable fact identity, governed multi-evidence aggregation, durable organizational memory, cross-workflow reuse, versioning/history, fact lifecycle governance, change-over-time tracking, or capabilities that derived views cannot adequately support.

These are conditions for reconsideration only. They do not authorize persistence. This package does not decide the future persisted model — it decides: **do not persist Impact Facts yet.**

---

## 9. Existing KAI boundaries preserved

This decision does not weaken applicable existing KAI controls:

- Sprint 2 behavior remains behind `KAI_SPRINT2_ENABLED` unless newer controlling authority explicitly changes that rule.
- Tenant and actor boundaries remain mandatory.
- Routes do not contain SQL or directly access `kai.*` or KAI DB helpers.
- Reads and writes use authorized services and approved helpers.
- Assistant tools do not receive unrestricted raw files.
- Assistant tools do not receive raw storage locations or signed raw-file URLs.
- AI does not approve, finalize, override validators, bypass tenant boundaries, or silently promote governance state.
- Uploaded and retrieved content remains untrusted data.
- Blocked or restricted evidence cannot become an eligible assertion merely through AI interpretation.

---

## 10. Repository basis for this decision (as of this record)

The following repository facts were `TOOL_VERIFIED` while creating this decision record. They are intentionally narrow and do not constitute a general implementation audit:

- A repository search of `.sql`, `.js`, and `.md` files found no literal `impact_fact` reference outside the non-executable Package 3A contract.
- A repository search found no literal `ImpactEvidenceView` or `impact_evidence_view` reference.
- Repository files with evidence-, claim-, claim-traceability-, and claim-library-related names are present under `Backend/kai/services/` and `Backend/kai/db/`.

These findings do not establish that functionally equivalent persistence, derived-view, or governed-service behavior cannot exist under different names or implementations.

The broader repository implementation details are not required to preserve this owner-accepted Package 3B architecture decision and remain `NOT_CONFIRMED` unless directly inspected in a relevant implementation task.

No repository evidence inspected while producing this record materially contradicted the owner-accepted Package 3B architecture decision.
