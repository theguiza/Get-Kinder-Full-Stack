# KAI P14-01 Patch Notes - Generation-Run Engagement Binding

## Added

- `migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql` adds
  exactly one new, additive, nullable column -
  `kai.generation_runs.engagement_id` - plus a tenant-safe composite foreign
  key `(engagement_id, organization_id) -> kai.engagements (engagement_id,
  organization_id)`. `kai.generated_content_drafts` is not altered: its
  engagement lineage remains transitive through the existing
  `generation_run_id` foreign key. `kai.engagements` itself is never altered.
- `migrations/kai_sprint2_p14_01_generation_run_engagement_binding.rollback.sql`
  drops the column and its foreign key, but refuses (fails closed) if any
  non-null `engagement_id` row exists, so a real engagement binding is never
  silently discarded.
- `scripts/kai-sprint2-p14-01-generation-run-engagement-binding-verifier.sql`
  verifies the column exists and is nullable, the composite FK is exactly the
  expected shape, `generated_content_drafts` was not directly altered, and
  `kai.engagements` carries no P14-01-owned constraint.
- `scripts/kai-sprint2-p14-01-generation-run-engagement-binding-smoke-seed.sql`
  seeds one engagement-bound generation run/draft pair and one legacy
  (`engagement_id = NULL`) generation run/draft pair.
- `scripts/kai-sprint2-p14-01-generation-run-engagement-binding-smoke-verifier.sql`
  proves the engagement-bound run resolves its exact engagement, the legacy
  run's `NULL` engagement is valid, and both drafts remain transitively
  resolvable to their generation run's engagement through the existing
  `generation_run_id` join.
- `scripts/kai-sprint2-p14-01-generation-run-engagement-binding-failure-checks.sql`
  proves a fabricated engagement is rejected, a real engagement belonging to a
  different organization is rejected (cross-tenant), and a `NULL` engagement
  is accepted (read-only: the whole probe transaction is rolled back).

## Changed

- `Backend/kai/dictionary/postgresGeneratedContentRepository.js`: the
  generation-run write contract (`validateInput`, `insertRunReservation`,
  `readExistingState`, `validateExistingState`) now requires and persists
  `engagementId`, and the request fingerprint (`fingerprintEvidenceSummaryRequest`
  / `fingerprintImpactNarrativeRequest`) now includes it, so a request that
  reuses an idempotency key with a different engagement never replays the
  original engagement's generation - it fails closed as `duplicate_conflict`,
  using the existing organization+idempotency-key identity and
  fingerprint-conflict mechanism, with no change to the underlying database
  uniqueness constraint. `readReviewPacketState`'s internal run row now also
  selects `engagement_id` (not projected into the public review-packet DTO),
  proving `organizationId + generatedContentDraftId -> generationRunId ->
  engagementId` is internally resolvable for a later packet-membership
  package.
- `Backend/kai/services/kaiGeneratedContentService.js`: `createEvidenceSummaryDraft`
  and `createImpactNarrativeDraft` now require `engagementId` in the input
  contract, resolve it through the existing authoritative
  `getEngagementForOrganization` tenant-scoped lookup, and reuse the existing
  `validateTenantBoundaryConsistency` validator (already used elsewhere for
  exactly this engagement/tenant shape) to fail closed on a missing,
  fabricated, or cross-tenant engagement before any repository write.
- `Backend/kai/routes/sprint2IntakeApi.js`: the evidence-summary and
  impact-narrative creation routes now require `engagement_id` (wire) /
  `engagementId` (internal) in the request body, validated as a canonical
  lowercase UUID identically to `claim_ids`.
- `scripts/kai-sprint2-p3-01-generated-content-drafts-local-postgres.js` and
  `scripts/kai-sprint2-p13-01-impact-narrative-content-type-local-postgres.js`
  now bootstrap the organization/engagement foundation (shared
  `kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql`, plus
  the runner-local composite-unique accommodation the B1.1/C2.1 runners
  already apply), seed one real organization/engagement pair, and run the
  full P14-01 migration/verifier/smoke-seed/smoke-verifier/failure-checks
  package before their own focused tests.
- Directly coupled test fixtures (`kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js`,
  `kai-sprint2-p3-01-generated-content-drafts.integration.spec.js`,
  `kai-sprint2-p13-01-impact-narrative-boundary.spec.js`,
  `kai-sprint2-impact-evidence-library.spec.js`,
  `kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js`) now supply
  `engagementId`/`engagement_id` and, where they exercise the real service
  layer, a same-tenant `getEngagementForOrganization` resolution.

## Rollback Characterization

The rollback is non-destructive by construction: it refuses to run at all
while any non-null `engagement_id` row exists, rather than silently dropping
real engagement bindings. This was exercised against the P3-01 local-Postgres
runner's own synthetic engagement-bound rows and correctly refused. A clean
rollback (no non-null rows) was not separately exercised in this package.

This is local synthetic verification only. Production migration was not
performed. Production rollback safety beyond the above is NOT_CONFIRMED.

## Not Changed

No `grant_application`, `funder_request`, `packet`, or `workspace` entity was
created. `kai.generated_content_drafts` was not altered. `kai.engagements`
was not altered. No new approval/finalization authority was added. No
artifact persistence was added. Grant Response Packet cross-draft membership
and composition remain unstarted - this package only establishes the
authoritative binding a later package will read.

## Known Pre-Existing Gap (Not Caused By This Package)

Both the P3-01 and P13-01 local-Postgres runners fail one already-present
integration test - "Package 14-05: P3-01 real service path allows an
internally governed but currently ineligible claim..." - with
`relation "kai.evidence_review_decisions" does not exist`. This is because
neither runner's migration chain includes
`migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql`, which
`evaluateClaimTraceabilityInTransaction` now depends on. This gap is present
identically at the pre-P14-01 HEAD of both runner scripts (confirmed via
`git show HEAD:<runner path>`) and is unrelated to engagement binding; it was
not introduced or fixed by this package. Every other test in both runners,
including every test that exercises the new engagement requirement end to
end, passes.
