# KAI Package G Patch Notes — Improvement Plan / Improvement Practices Foundation

## Owner decision on scope

Package G is authorized, repository-only, as the smallest schema/service
foundation for the Improvement Plan concept already approved in the Impact
Library redesign: one row per organization means one recommended/active/
paused/completed improvement practice, optionally scoped to a Project
(engagement) and optionally originating from an existing evidence/data gap.
No production migration execution, no deployment, no push, and no real
client data are authorized or performed by this package.

Package C's and Package G's own prior inspection (recorded in the living
ExecPlan) already confirmed no "improvement practice"/"recurring practice"/
"Impact Operating System" persistence exists anywhere in this schema today -
this is genuinely new persistence, not a reuse of an existing table.

## Bounded Package F repair folded in first (not part of this schema)

Before this package, a narrow, separate repair made `engagement_type` -
already a real `kai.engagements` column, already read and displayed, but
never settable at creation - accepted by `createEngagement`. No schema
change was required for that repair (see the Package F commit). It is
recorded here only for sequencing; the Package G schema below does not
depend on it.

## Added

- `migrations/kai_sprint2_package_g_improvement_practices_foundation.sql` /
  `.rollback.sql` — forward/rollback migration creating exactly one new,
  additive, **mutable** relation, `kai.improvement_practices` (unlike this
  schema's append-only decision/snapshot ledgers, a practice's status,
  cadence, next-due date, and responsible actor are ordinary in-place
  UPDATE targets on the same row, mirroring `kai.impact_outcome_contexts`).
  `organization_id` is required; `engagement_id` is optional and bound
  through the composite `(engagement_id, organization_id) ->
  kai.engagements` foreign key; `gap_log_item_id` is optional and bound
  through the composite `(gap_log_item_id, organization_id) ->
  kai.gap_log_items` foreign key - the one gap-like object this schema
  already has a real, addressable, tenant-safe identity for.
  `status` is pinned to `recommended`/`active`/`paused`/`completed`;
  `cadence` is pinned to `one_time`/`every_session`/`weekly`/`monthly`/
  `quarterly`/`annually`/`ongoing`. `title`/`rationale` are non-blank,
  bounded text. `updated_at` is maintained by a `BEFORE UPDATE` trigger,
  the same pattern `kai.impact_outcome_contexts` already uses.
- `Backend/kai/db/kaiImprovementPracticeQueries.js` — raw SQL: insert, get
  by id, list for organization (optionally filtered by engagement), and an
  optimistic-concurrency compare-and-swap UPDATE for mutable fields/status,
  mirroring the Board Reporting candidate review's
  `date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $N)`
  compare-and-swap convention.
- `Backend/kai/services/kaiImprovementPracticeService.js` — service layer:
  `KAI_SPRINT2_ENABLED` gate, mapped-human-actor requirement, role/tenant
  authorization via `validateActorCanPerformOperation`, tenant-boundary
  consistency check, `withTransaction` + a required
  `insertRequiredSuccessfulAuditEvent` audit write for every mutation
  (create, field update, status change) - the same "required, not
  best-effort" convention Package F's `createEngagement` already
  established in this file family. Every required-audit call uses
  `object_type: "other"` / `target_object_type: "improvement_practice"` -
  the same safe pattern Package F used for `create_engagement`, since
  `kai.object_type_enum`'s real production label set is NOT_CONFIRMED and
  this package does not touch it.
- `Backend/kai/validators/kaiSprint2RequestSchemas.js` — new
  `create_improvement_practice`, `update_improvement_practice`, and
  `change_improvement_practice_status` mutation schema entries.
- `Backend/kai/routes/sprint2IntakeApi.js` — new
  `POST/GET .../admin/organizations/:organizationId/improvement-practices`,
  `GET .../improvement-practices/:improvementPracticeId`,
  `PATCH .../improvement-practices/:improvementPracticeId`, and
  `POST .../improvement-practices/:improvementPracticeId/status` routes,
  all validating via the shared mutation-request validator and delegating
  entirely to the service (no SQL/DB access in the route).

## Not built (explicitly deferred, not fabricated)

- No FK/read path to `kai.client_followup_items` or
  `kai.coverage_review_decisions` - both are distinct, incompatible shapes
  from `kai.gap_log_items` (different PK types and natural keys); a single
  polymorphic origin FK across all three gap-like object types is deferred
  rather than built unsafely.
- No Gap Detail "Add to Plan" wiring yet (Package G2).
- No Improvement Plan UI (Package G2).
- No Home integration (post-G2).
- No generic task/subtask/board/dependency/chat/time-tracking/billing
  feature of any kind.
