# KAI P13-EXT-5 Patch Notes - grant_response_paragraph Content-Type Evolution Verification Package

## Added

- `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.sql`
  widens `generation_runs_p3_01_content_type_check`
  (`kai.generation_runs`) and `generated_content_drafts_p3_01_content_type_check`
  (`kai.generated_content_drafts`) from the P13-EXT-4 vocabulary
  (`evidence_summary`, `impact_narrative`, `readiness_assessment`,
  `data_gap_memo`, `case_for_support`, `board_update`,
  `annual_report_section`, `funder_outcome_table`) to add the ninth
  generated-content type, `grant_response_paragraph`.
- `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.rollback.sql`
  restores the P13-EXT-4 vocabulary on both constraints, refusing (fails
  closed) if any `grant_response_paragraph` row already exists in either
  table.
- `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.sql`
  widens the companion `export_candidates_p3_16_content_type_check`
  (`kai.export_candidates`) the same way.
- `migrations/kai_sprint2_p13_ext5_grant_response_paragraph_export_candidate_content_type_evolution.rollback.sql`
  restores the P13-EXT-4 vocabulary on that constraint, refusing if any
  `grant_response_paragraph` export-candidate row already exists.
- `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-verifier.sql`
  verifies, read-only, that all three named constraints
  (`generation_runs_p3_01_content_type_check`,
  `generated_content_drafts_p3_01_content_type_check`,
  `export_candidates_p3_16_content_type_check`) are at the exact target
  `grant_response_paragraph`-inclusive definition, that none are missing,
  that none are in a mixed predecessor/target state, that
  `grant_response_paragraph` is present wherever a constraint claims to be
  at target, and that no unrecognized/future content-type token appears in
  any of the three definitions.
- `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-seed.sql`
  (synthetic data only, **not executed in this pass**) seeds one synthetic
  `grant_response_paragraph` `generation_runs`/`generated_content_drafts`/
  `limitation_snapshots`/`export_candidates` row set, using
  `requested_audience` `'internal'` to exercise `grant_response_paragraph`'s
  reuse of the shared, unrestricted `{internal, funder, public}` audience
  shape (enforced at the service-level input validator,
  `isCreateGrantResponseParagraphDraftInput`, which applies no per-type
  restriction at all - unlike `funder_outcome_table`'s own funder-only
  gate).
- `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-smoke-verifier.sql`
  proves the seeded `grant_response_paragraph` fixtures are admitted and
  coherent, and that predecessor types remain admitted alongside
  `grant_response_paragraph` (a widening, not a replacement).
- `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-failure-checks.sql`
  proves read-only from catalog definitions that an unrelated content type
  (including `grant_response_packet`, the distinct object_type used by the
  separate Grant Response Packet composite-export domain), a near-miss
  `grant_response_paragraph`-like token, a non-`system` `created_by_type`,
  and an unrelated `export_candidates.content_type` all remain outside the
  accepted contracts after the widening.
- `scripts/kai-sprint2-p13-ext5-grant-response-paragraph-content-type-evolution-runbook.md`
  documents how this package's verification would be run against a live
  ephemeral PostgreSQL target.

## Problem Closed

The `grant_response_paragraph` application/runtime work (service,
repository, route, generator, frontend label, Generated Drafts library)
landed in this same working tree without accompanying schema migrations or
a verification package - no forward/rollback migration SQL, no catalog
verifier, smoke fixtures, read-only failure checks, or runbook - leaving the
two `content_type` CHECK constraints this type depends on unwidened,
matching the gap the P13-EXT-4 repair pass closed for `funder_outcome_table`.

## Not Executed

No SQL in this package (forward migration, rollback, verifier, smoke seed,
smoke verifier, or failure checks) was executed against any PostgreSQL
instance, real or ephemeral, in this pass. No database connection was
opened. Live execution of this package's SQL against an ephemeral
verification database is future work, matching how prior packages separate
"authored" from "run" (see
`scripts/kai-sprint2-p13-ext4-funder-outcome-table-content-type-evolution-*`
for the direct structural precedent this package's SQL shape follows).

## Rollback Characterization

Both `grant_response_paragraph` rollback files in this package are newly
authored and contain the same data-loss guard used by every prior
extension's rollback (refusing when `grant_response_paragraph` rows exist).
Rollback safety here is **NOT_CONFIRMED** against a live database - it was
reviewed statically only.

## Audience Contract

`grant_response_paragraph` reuses the existing shared four-field request
contract's `requested_audience` shape (`internal`, `funder`, `public`)
completely unrestricted, exactly like `annual_report_section`
(`isCreateAnnualReportSectionDraftInput`) - no new audience value was
introduced, and no per-type owner gate (of the kind `funder_outcome_table`,
`case_for_support`, or `board_update` each apply) was introduced for this
type. No authoritative repository or product evidence (the living ExecPlan
or existing code) was found requiring a narrower shape.

## Not Changed

No fingerprint, requested_audience, draft_status, review_status,
created_by_type, foreign-key, uniqueness, tenant/organization,
review-queue, or audit-contract constraint is touched by this package.
`grant_response_paragraph` is **not** added to any Grant Response Packet or
Board Reporting membership set (`PACKET_MEMBER_CONTENT_TYPES`,
`BOARD_REPORTING_PACKET_MEMBER_CONTENT_TYPES`), despite its name resembling
"Grant Response Packet" - no authoritative repository/product evidence was
found requiring otherwise, so existing packet composition is preserved
exactly as before.
