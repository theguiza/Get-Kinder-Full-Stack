# B1.3 — Persist Owner-Accepted Baseline Catalogue — Patch Notes

## What this package does

Persists the owner-accepted
`docs/kai/catalogues/KAI_B1_2_BASELINE_IMPACT_REQUIREMENTS_CATALOGUE_V1_ACCEPTED.md`
catalogue into the existing B1.1 generic requirements model
(`kai.requirement_sources` → `kai.requirement_framework_versions` →
`kai.requirement_sets` → `kai.requirements`). It is a **data-only**
migration: no table, column, index, or constraint is added or changed.

Persisted:

- 1 requirement source (`kai_standard` / `kai_baseline_impact_requirements`)
- 1 framework version (`kai_baseline_impact_v1` / `v1`, `framework_status = draft`)
- 10 requirement sets (the accepted domain set keys, in canonical order)
- 21 requirements (the accepted requirement keys, in canonical order, with
  `requirement_label`/`requirement_description` copied verbatim from the
  canonical artefact)
- 0 `kai.engagement_requirement_sets` rows

## What this package does not do

- Does not activate `kai_baseline_impact_v1` (`framework_status` stays `draft`).
- Does not create Requirement Coverage, requirement assessments, evidence/claim
  mappings, gaps, recommendations, engagement applicability, or funder
  overlays.
- Does not modify B1.1, B1.2, A1, A2, `/impact-library`, generation, or Current
  State.
- Does not persist the B1.2 review-only annotations (`why_it_matters`,
  `expected_knowledge_or_evidence`, `framework_basis`,
  `current_KAI_input_mapping`, `input_support_status`) — the current B1.1
  schema has no approved field for them. They remain
  `REVIEW_ONLY / NOT PERSISTED`, sourced only from the canonical artefact.

## Rerun safety

Every `INSERT` is guarded by a `WHERE NOT EXISTS` check against the same
natural-key columns the existing B1.1 `UNIQUE` constraints already enforce.
A rerun of the forward migration against an already-persisted catalogue is a
no-op (proven in the integration suite); a failure partway through rolls back
atomically with the rest of the transaction.

## Display order

`kai.requirement_sets` has no `display_order` column (existing B1.1 schema,
unchanged here). Canonical domain order is instead recoverable as the minimum
`display_order` among each set's own requirements: `display_order` is a
single contiguous sequence (0-20) spanning the whole framework version,
assigned in canonical domain order and then canonical requirement order
within each domain.

## Files

- `migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql` — forward, data-only
- `migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.rollback.sql` — deletes exactly this catalogue's rows, in dependency-safe order
- `__tests__/kai-sprint2-b1-3-accepted-catalogue-persistence-schema-contract.spec.js` — static proof the migration text matches the canonical artefact exactly (parses the canonical markdown directly)
- `__tests__/kai-sprint2-b1-3-accepted-catalogue-persistence.integration.spec.js` — PostgreSQL proof of persisted counts, membership, ordering, and rerun safety
- `scripts/kai-sprint2-b1-3-accepted-catalogue-persistence-local-postgres.js` — isolated synthetic PostgreSQL runner (forward → integration tests → rollback proof)
