# Migration 05: application rollout, rollback and deployed acceptance

**For:** the owner, deciding and authorizing the production steps around migration 05. Evidence labels:
- `TOOL_VERIFIED`: checked in the repository or on disposable local PostgreSQL during this preparation;
- `USER_CONFIRMED`: reported by the owner, or recorded from earlier owner-supplied evidence, and not re-proved here;
- `NOT_CONFIRMED`: unknown.

## 1. Revisions

| Item | Value | Evidence |
| --- | --- | --- |
| Migration 05 source | `migrations/kai_sprint2_plan_a_organization_internal_factual_review_authority.sql` and `.rollback.sql`, both introduced in `1c10b87` and unchanged since | TOOL_VERIFIED |
| Application that needs 05 | `e0022aa` (service authorization, UI, P2-06 audience protection). The packet commit after it adds only this packet, two local scripts and the ExecPlan record; it has no runtime code. | TOOL_VERIFIED |
| Production application revision | `96653f8` | USER_CONFIRMED (reported); not re-inspected here |
| Migrations 01–04 in production | complete and closed | USER_CONFIRMED (reported); Step 1 B01.1–B01.4 re-checks them read-only |
| Schema delta `96653f8..e0022aa` | exactly migration 05 and its rollback; no other migration or synthetic bootstrap file changes | TOOL_VERIFIED (`git diff --name-status`) |
| Does pushing `main` deploy? | Observed earlier: a push of `96653f8` was followed by a new production bundle about 27 s later. That was inferred from the bundle, not from Render's dashboard. **Treat a push to `main` as a deployment.** | USER_CONFIRMED / inferred (earlier session) |

## 2. Safe order

1. **Database first.** You run `RUN_IN_PGADMIN.md` Steps 1–5 under your separate authorization, ending with `99` = `PASS`, and send me the saved results.
2. **Then publish the application** (`main` at or after `e0022aa`, plus this packet commit) through your normal path. This is a separately authorized push and deployment. Do not push earlier: the push is itself the deployment.
3. **Then the deployed acceptance** (§5). This is separately authorized.

Why this order:
- **New code needs the new schema.** Without 05, every organization-administrator evidence, claim or coverage decision written by `e0022aa` violates the GK-only role CHECKs (SQLSTATE 23514), so the organization's review fails.
- **The old code runs on the new schema.** This was executed, not inferred from the DDL (§3). The database can therefore be migrated while `96653f8` is still serving.

No feature flag is needed or changed by migration 05. The workflow flags (`KAI_SPRINT2_ENABLED`, `KAI_GENERATION_ENABLED`, `KAI_PUBLIC_EXPORT_ENABLED`, upload and worker) were not inspected. Their production values are NOT_CONFIRMED.

## 3. Application compatibility with the migrated schema (TOOL_VERIFIED, local only)

Every run used the repository's normal chain through migration 04, then **this packet's `05_MIGRATION_…` file**. Every database was a disposable loopback PostgreSQL 16.14 cluster, with `DATABASE_URL` set to a non-listening sentinel.

**Previous application (`96653f8`) on the migrated schema.** Its code ran from a temporary `git clone --shared` checkout, and the owner's working tree was not touched.

| Run | Result |
| --- | --- |
| `96653f8` P2-01M proof: Get Kinder evidence review, claim review and coverage acceptance through the real repositories, then eligibility, generation, the organization's internal release and the Markdown report | 30 passed, 0 failed. It wrote no `client_admin` review decision. |
| `96653f8` assembled customer file-to-report browser acceptance (the GK reviewer makes the evidence, claim and coverage decisions in E1; the administrator is refused) | 23 passed, 0 failed. Schema fingerprint `1d8a04891cf61477f17fe276a519c80e`, identical to the current application's run, so 05 was present. The clone held `96653f8` plus one temporary commit, made only in that clone, that adds the packet file to the shared chain list. |

**Current application (`e0022aa`) on the migrated schema.**

| Run | Result |
| --- | --- |
| P2-01M proof (GK path to eligibility, generation, release, Markdown) | 30 passed, 0 failed |
| Organization factual review integration (real services): unsupported evidence and existing Get Kinder decisions are refused with nothing written | 4 passed, 0 failed (on a fresh database, and on the database the old application had just used) |
| Assembled customer file-to-report browser acceptance: an organization administrator's evidence review, internal claim review and internal limitation acceptance, then generation, factual review and release, with no Get Kinder reviewer | 25 passed, 0 failed. This includes E1 governance: no `gk_reviewer` action from upload to release, and Get Kinder's evidence decision superseding the organization's, whose override is then refused. |
| `99_MIGRATION_05_…` after the current application's workflow | PASS |

**Database rules, exercised by direct inserts through the live constraints and triggers.**

Rejected, each with SQLSTATE 23514:
- a `client_admin` evidence or claim decision on field-presence evidence;
- a `client_admin` evidence or claim decision that supersedes a Get Kinder decision;
- a `client_admin` claim approval for `internal+funder` or `public`, with the scope trigger enabled or disabled;
- a `client_admin` funder or public coverage acceptance;
- a `client_admin` acceptance of `missingness`;
- a `client_admin` acceptance on a field-presence claim;
- a `client_reviewer` evidence or claim decision;
- a `gk_operator` or `gk_admin` coverage acceptance (unchanged from before).

Accepted, then rolled back:
- `gk_reviewer` and `gk_admin` evidence decisions superseding a GK decision;
- a `gk_admin` `internal+funder` claim approval and a `gk_reviewer` `public` claim approval;
- `gk_reviewer` funder and internal coverage acceptances;
- `client_admin` internal acceptances of `small_cell_risk` and `requirement_alignment` on a measured claim.

## 4. Rollback

**The database and the application roll back separately.**

| Situation | Application rollback (`e0022aa` → `96653f8`) | Database rollback (R05) |
| --- | --- | --- |
| No organization decision yet (`RP05` = `SAFE_TO_ROLL_BACK`) | Safe; see below | Safe, **after** the application rollback |
| Organization decisions exist (`RP05` = `UNSAFE_ROLLBACK_REFUSES`) | Possible, with the P2-06 weakening below | **Not possible.** R05 refuses and changes nothing; this was tested. Never delete or reclassify decisions to force it. |

**Is migration 05 reversible?** Only until the first organization decision is recorded. After that it is **not reversible** and must not be described as reversible. The way back is forward:
- the schema still lets a Get Kinder reviewer supersede an organization's evidence or claim decision, and the current application's GK evidence-review route doing so is part of its assembled acceptance;
- coverage acceptances have no supersession.

**Application rollback to `96653f8` while organization decisions exist** was evaluated by running both revisions' P2-06 (`evaluateClaimTraceabilityInTransaction`) on one database, inside a rolled-back transaction. In that transaction the measured evidence's current decision was a `client_admin` decision, and GK had approved the claim for internal and funder use.

| | Internal | Funder |
| --- | --- | --- |
| `e0022aa` blockers | `support_strength_unassessed`, `coverage_dimension_unresolved` | as on the left, plus `claim_not_approved_for_requested_audience`, `audience_gate_closed`, **`evidence_review_unresolved`**, `requirement_authority_absent` |
| `96653f8` blockers | the same as `e0022aa` | the same as `e0022aa` **without `evidence_review_unresolved`** |

**Finding:** `96653f8` does not have `e0022aa`'s rule that an organization's evidence decision never counts as Get Kinder's evidence review for funder or public use. In this test the claim stayed funder-ineligible under both revisions for other, independent reasons. So an application rollback removes one safeguard; it was not shown to make anything funder-eligible by itself.

A further point comes from reading the code, not from running it. `96653f8`'s evidence-review continuation validator (VAL-KAI-P2-12-003) admits only `gk_reviewer` and `gk_admin` heads. Under the old application, a claim proposal that follows a `client_admin` evidence decision is therefore refused, which fails closed.

**Recommendation:** if the application must be rolled back after organizations have recorded decisions, keep it short, and do not record funder or public decisions on organization-reviewed lineages until `e0022aa` or later is back.

## 5. Deployed acceptance (later, separately authorized)

Reuse the local assembled run's steps, by hand in the real application, as one active administrator of a synthetic organization, with a synthetic CSV of six data rows: one blank, and two duplicates of one record. Expected count: **5**. This is the same journey as the 01–04 packet's §4, except that its step 8, the Get Kinder upstream review, is now the administrator's own:

| # | Step | Pass condition |
| --- | --- | --- |
| 8a | Knowledge Studio: the administrator reviews the measurement and records the evidence review as itself | 200; decision `decided_by_role = client_admin` |
| 8b | The internal claim review (internal audience only) | 200; an attempt at a funder or public audience is refused |
| 8c | Acceptance of the three source-level limitations (small-cell risk, conflicting sources, requirement alignment) | 200 each; claim `eligible = true` for internal |
| 8d | Get Kinder reviewer audit | no `gk_reviewer` action between upload and release |
| 9–13 | Generation, factual review, release, Markdown, revocation, exactly as in the 01–04 packet | as there |

## 6. Smallest authorizations still needed

1. You run `00` (read-only) and send the CSV. Production's current state is unknown until then.
2. Only if it says `REQUIRED`: you run `05_MIGRATION_…`, then `05V`, `00` and `99`. This is a production schema change, performed by you.
3. A push and deployment of `main` at or after `e0022aa`, only after `99` = `PASS`.
4. The §5 deployed acceptance.
