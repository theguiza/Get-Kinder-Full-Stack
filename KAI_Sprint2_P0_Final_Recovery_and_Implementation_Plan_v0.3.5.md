# KAI Sprint 2 P0 — Final Recovery and Implementation Plan

```text
plan_version: 0.3.5
plan_date: 2026-07-14
approval_status: OWNER_ACCEPTED
approved_by_or_owner_reference: USER_CONFIRMED in the KAI Project conversation on 2026-07-14
supersedes: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.4.md
review_basis: Evidence-Locked Accuracy Review, KAI Governance Resolution v1.0, authority-precedence reconciliation, the completed Codex read-only repository preflight, the owner-approved security-limit and upload-lifecycle decisions, the owner-directed runtime-timeout, synthetic-end-state, schema-compatibility, and distributed-concurrency clarifications, and the owner-directed evidence-labeling and first-write milestone-checkpoint amendment
```

This document is the owner-accepted repository execution plan. It records the exact decision set accepted by the owner on 2026-07-14. It becomes the repository's living ExecPlan when installed locally under Phase 0-D. Plan acceptance does not authorize Gates A through D or any prohibited action listed below.

## Authorized end-state boundary

Completion of the currently authorized scope through P0-07 establishes repository code completion and local synthetic acceptance only. It does not establish PostgreSQL persistence, deployed `kai.*` schema compatibility, database atomicity, nonproduction storage integration, live-upload readiness, production readiness, or real-client-data readiness. Do not report the result merely as `P0 complete`. Use the exact completion labels defined in P0-06A and P0-07 and retain all database, schema, storage, and real-data limitations as `NOT_CONFIRMED` until their separately authorized gates pass.

`KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.4.md` is superseded and must not be installed or executed.

## Approval and execution conditions

1. The owner confirmed that the corrected 7,997-character `KAI_Active_Execution_Project_Instructions_v1.0.2.md` replaced the earlier active version and is the sole active Project Instructions document: `USER_CONFIRMED`.
2. The owner previously confirmed the five named authority sources are active in Project settings: Product Workflow, Roadmap, Backend Contract, Threat Model, and Data Operating Model: `USER_CONFIRMED`.
3. The owner directed the v0.3.5 evidence-labeling and first-write milestone-checkpoint amendment and authorized creation of this plan: `USER_CONFIRMED`.
4. The read-only repository preflight completed at `HEAD` `1b41a3d644e1afd811ad87162f25c15a08d51b39`; its results are recorded in Phase 1 as `USER_CONFIRMED` until the repository is freshly rechecked.
5. P0-02 executes before P0-01 and records the owner-approved constants and lifecycle contract in the repository. Explicit owner-approved contract values are valid where repository inspection established that no value exists; they are not represented as `TOOL_VERIFIED` repository facts until installed and tested.
6. Any new column, constraint, enum, migration, or database-dependent lifecycle behavior remains blocked by Gate A.
7. Gates A through D remain unauthorized.

## Authorized execution order

```text
Phase 0-D — local repository authority installation
Phase 1 — preflight state recheck; full preflight rerun only if repository state changed
P0-02 — repository contract lock
P0-01 — foundation truth and response safety
FIRST-WRITE MILESTONE CHECKPOINT — stop, report, and obtain owner continuation under this same accepted plan
P0-03 — repository-safe portion
P0-04
P0-05
P0-06A — repository-safe transport, interfaces, local adapter, validators, and synthetic behavior
P0-07 — local synthetic HTTP acceptance
```

`P0-06B` persistent lifecycle integration is part of Gate A and is not authorized.

## Prohibited actions under plan acceptance alone

Plan acceptance does not authorize:

- Project-settings or Project-source changes;
- push, deployment, remote mutation, or feature enablement;
- schema application, migration, reseed, database smoke, or database mutation;
- cloud or credential access;
- destructive action, retention execution, deletion, or irreversible overwrite;
- production or tenant/environment configuration changes;
- real-client-data use;
- automatic Current State updates.

## Integrity and evidence rule

Integrity facts are accepted only from the appropriate tool, command, or CI result in the relevant session. Reported prior results remain `USER_CONFIRMED`; the plan does not self-certify checksums, `HEAD`, tests, diffs, database, deployment, or cloud state. File inspection may establish the exact text, diff, or measured size of a drafted artifact as `TOOL_VERIFIED`; the owner's direction, acceptance, and authorization remain `USER_CONFIRMED`, and drafting a rule does not make the underlying implementation or environment fact `TOOL_VERIFIED`.

## 0. Authority and evidence

### 0.1 Evidence classes

Use only:

```text
TOOL_VERIFIED
USER_CONFIRMED
NOT_CONFIRMED
```

Repository observations produced by Codex are `USER_CONFIRMED` in ChatGPT until freshly inspected in the repository.

Project contracts establish intended behavior. They do not establish current code, current database state, deployment, configuration, or runtime behavior.

Use independent requirement states:

```text
implementation_status:
  complete
  partial
  missing
  blocked
  not_required
  deferred_with_blocking_gate

verification_status:
  not_run
  user_confirmed_pass
  tool_verified_pass
  failed
```

### 0.2 Source precedence

```text
Product Workflow
→ product destination

Roadmap
→ P0/P1/P2/P3 sequence

P0 Backend Contract
→ controlling P0 behavior where scopes overlap

Threat Model
→ threat assumptions and required mitigations

Data Operating Model
→ data ownership, processing, retention, access, and real-data controls

Inspected repository
→ current implementation facts

Current State
→ durable enabled phase, accepted baselines, restrictions

Implementation Baseline
→ qualified historical or reported implementation reference used to prevent duplicate work when repository access is unavailable; never proof of current HEAD or runtime

Repository ExecPlan
→ owner-approved implementation sequence derived from the above
```

This precedence must match `KAI_Active_Execution_Project_Instructions_v1.0.2.md` Authority-by-subject. On any conflict, the Project Instructions ordering governs.

The ExecPlan cannot override the Product Workflow, Roadmap, P0 Backend Contract, Threat Model, Data Operating Model, inspected repository, Current State, or explicit owner authorization.

---

# Phase 0 — Repair the execution system once

## 0-A — Activate the single Project Instructions document

This is a manual owner action outside repository execution.

The owner must:

1. review and explicitly accept `KAI_Active_Execution_Project_Instructions_v1.0.2.md`;
2. activate it as the only Project Instructions document;
3. preserve the prior Active Execution file and the Enforceable PDF outside the active governance set as historical, noncontrolling evidence;
4. confirm that no archived governance source still claims active authority.

This action is not performed by Codex and cannot be marked `TOOL_VERIFIED` from repository evidence. Owner confirmation is `USER_CONFIRMED`.

## 0-B — Optional owner housekeeping

This is a manual, optional, non-blocking owner action. It is not a prerequisite for repository execution.

Inspect the project’s chats and Project Sources.

Prefer moving superseded material out of the active project when preservation is possible. Deletion requires a separate explicit owner choice. Move out of the active project, or delete only after that separate authorization:

* superseded setup-loop chats;
* obsolete “assess and choose the next task” chats;
* duplicate execution plans;
* pasted prompt-chain transcripts that are no longer canonical.

Retain:

* Product Workflow;
* Roadmap;
* Backend Contract;
* Threat Model;
* Data Operating Model;
* `00_KAI_CURRENT_STATE.md`;
* one current `KAI_CURRENT_IMPLEMENTATION_BASELINE.md`;
* product or contract decision chats that remain authoritative.

Do not create another project.

Do not delete source material merely because it is old. Remove it from the active project only when it is superseded and its durable decision has been captured in a canonical source. Deletion remains a separate explicitly authorized action.

## 0-C — Reconcile the Implementation Baseline without changing Current State

This is a Project-source owner decision, not a repository package.

The current frozen repository anchor and the later reported local commit have different semantics. Do not change `00_KAI_CURRENT_STATE.md` merely to make the values match.

A one-time Implementation Baseline refresh may be accepted when it records, at the appropriate evidence class:

```text
evidence_class: USER_CONFIRMED
latest_accepted_reported_local_commit:
  1b41a3d644e1afd811ad87162f25c15a08d51b39
```

It may record the owner-accepted reported facts:

- caller-declared SHA-256 reservation implemented;
- canonicalization implemented;
- checksum remains unverified until upload confirmation;
- organization-scoped preliminary duplicate detection implemented;
- 89 focused, 205 Sprint 2, and 310 full tests reported passed by the completed read-only preflight;
- no push, deployment, schema application, feature enablement, or production change reported;
- checksum-authority conflict reported resolved;
- other repository issues remain qualified pending fresh inspection.

The replacement must say that it does not prove current `HEAD`, deployment, database, feature flags, storage, cloud, or runtime. Do not update `00_KAI_CURRENT_STATE.md` automatically.

## 0-D — Install the repository execution authority

After a minimal fresh state recheck confirms the preflight repository is still at the expected `HEAD` with a clean working tree:

1. inspect all applicable `AGENTS.md` files and repository conventions;
2. create or select a dedicated local KAI P0 branch or worktree when repository conventions support it;
3. determine the narrowest instruction placement that covers backend code, tests, scripts, and KAI documentation;
4. add or minimally amend repository guidance;
5. install this accepted v0.3.5 plan as the single living repository ExecPlan;
6. record in the repository copy:

   * plan version `0.3.5`;
   * approval date `2026-07-14`;
   * owner acceptance evidence class `USER_CONFIRMED`;
   * approved execution order: Phase 0-D, state recheck, P0-02, P0-01, the single first-write milestone checkpoint, P0-03 repository-safe portion, P0-04, P0-05, P0-06A, and P0-07;
   * unauthorized gates: A through D.

The local installation commit SHA is reported in the Phase 0-D package evidence after the commit is created. Do not attempt to place a commit's own SHA inside that same commit.

Repository guidance must require Codex to:

* inspect before every change;
* follow the accepted plan and package order;
* update plan evidence/status once at the end of each coherent package;
* keep changes within the approved P0 boundary;
* run required tests with a loopback sentinel `DATABASE_URL` set before the first Node/npm command unless an explicitly authorized database target is being used;
* inspect each diff;
* continue to the next approved package except at the single first-write milestone checkpoint after P0-01;
* stop at that checkpoint, or for a defined blocker or gate.

Make one coherent local installation commit. Do not fetch, push, deploy, access databases or cloud services, inspect credentials or secrets, change feature flags or tenant/production configuration, handle real client data, or perform destructive work.

Milestones within this ExecPlan are one approved task. Continuing to the next approved package is not autonomous selection of a new product task.

---

# Phase 1 — Repository preflight

## 1.1 Completed read-only preflight evidence

The following results were supplied from the completed Codex read-only repository inspection and are `USER_CONFIRMED` in this Project conversation:

```text
branch: main
HEAD: 1b41a3d644e1afd811ad87162f25c15a08d51b39
relationship_to_expected_anchor: exact match
working_tree: clean before and after inspection
locally_known_origin_main: 7b581c283e0bfacea075f4d8f7a95794d8c47b52
local_tracking_status: main ahead 2; no fetch performed
applicable_AGENTS_md: none found
focused_pass2_tests: 89 passed, 0 failed
complete_sprint2_tests: 205 passed, 0 failed
full_repository_tests: 310 passed, 0 failed
git_diff_check: passed
```

The earlier reported focused count of 97 is superseded by the current 89-test result. No failure was reported in the requested commands.

The first focused invocation loaded ambient database configuration and printed non-secret connection metadata without opening a connection or issuing a query. Codex reran the focused and broader suites with a non-listening loopback `DATABASE_URL` sentinel. Every future Node/npm command under this plan must set the sentinel before the first import unless a database target has been separately authorized.

## 1.2 Confirmed current repository defects

The preflight reported these current implementation facts:

* auth preflight is mounted before `KAI_SPRINT2_ENABLED` and reports `feature_flag_required: false`;
* `/status` reports `metadata_write_enabled: false` while mounted POST routes call metadata insert services;
* `Backend/kai/index.js` exports the older non-mutating `intakeService.js` instead of the mounted `kaiIntakeService.js`;
* `KAI_FILE_UPLOAD_ENABLED` is absent;
* `getIntakeBatchTenantState()` reads by batch ID without an organization predicate and relies on later service validation;
* file DTOs expose `storage_bucket` and `storage_object_key`;
* runtime uses `checksum` while the prewrite verifier requires `checksum_sha256`;
* no authoritative `kai.*` schema DDL or migration was found in the inspected tree or local history;
* deployed schema compatibility remains `NOT_CONFIRMED`.

These findings justify the existing P0-01 through P0-04 repair packages. Correct only defects that remain present at package execution time.

## 1.3 Missing contract values resolved by owner decision

Repository inspection found no exact Sprint 2 values for request depth, total keys, array size, complete string limits, actor or organization abuse thresholds, abuse window, upload idle or total timeout, or the complete upload lifecycle persistence mapping.

Those absences are not implementation facts to infer around. The owner-approved values and lifecycle design are locked in P0-02 below.

## 1.4 Deployed schema compatibility boundary

The completed preflight found no authoritative `kai.*` DDL or migration in the inspected repository or local Git history. Until Gate A is separately authorized and the actual target schema is inspected, no package may claim deployed-schema compatibility or depend on an unverified `kai.*` column, type, enum, constraint, index, trigger, or transaction behavior. Repository-contract, static-verifier, mock-interface, and in-memory work may proceed within the authorized scope.

Any repository code or verifier change that selects one side of a repository/schema disagreement is intended-contract alignment only. It is not database verification. The `checksum` versus `checksum_sha256` drift must therefore be corrected consistently in repository artifacts without claiming that either name matches the deployed database.

Every P0-07 completion report must retain:

```text
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
```

## 1.5 State recheck before installation

Before Phase 0-D, recheck only:

* repository root and branch;
* current `HEAD` and relationship to `1b41a3d...`;
* clean working tree including untracked files;
* applicable repository instructions.

If `HEAD`, branch, instructions, dependencies, mounted routes, or working tree materially changed after the completed preflight, rerun the affected preflight inspection and tests before installation. Otherwise, do not repeat the full read-only preflight merely for ceremony.

## 1.6 Dependency decisions

Do not install a dependency during inspection. When a package requires a new dependency, return:

```text
DEPENDENCY_DECISION_REQUIRED
capability:
existing_options_inspected:
proposed_package:
exact_version:
license:
security_findings:
transitive_impact:
lockfile_impact:
alternative_without_new_dependency:
smallest_decision_needed:
```

Dependency approval authorizes only the named package/version and lockfile change. It does not authorize external services, database/cloud access, deployment, or a later gate.

After approval:

* pin the exact accepted dependency;
* commit the lockfile;
* add dependency-specific tests;
* avoid unbounded install scripts or hidden external services.

---

# P0-02 — Repository schema and behavior contract

## Outcome and execution order

This is the first substantive package after Phase 0-D. It executes before P0-01 so implementation consumes an explicit repository contract rather than values scheduled for a later package.

Create or update one non-executable repository contract describing intended P0 state without claiming deployed compatibility. Search current files and Git history first; do not create a competing contract when an authoritative repository artifact already exists.

## Evidence basis

The completed preflight established that the exact Sprint 2 limits and complete lifecycle mapping were absent. The values below are therefore `USER_CONFIRMED` owner-approved contract decisions. After installation and tests they may be reported as repository facts for the exact inspected commit, but their origin remains an owner decision rather than a discovered repository convention.

## Locked request and resource limits

### Metadata JSON routes

```text
maximum_raw_JSON_body: 100 KiB
maximum_JSON_depth: 4
maximum_total_keys: 64
maximum_array_length: 25 only for explicitly allowlisted array fields
unknown_keys: reject
unknown_nested_objects: reject
```

A route may impose a lower limit. An array is not accepted merely because the global maximum is 25; it must be named by the route schema. The existing global 5 MB parser is not the Sprint 2 metadata contract. P0-01 must ensure the 100 KiB limit is enforceable before an earlier parser has already consumed the request.

### String and identifier limits

```text
SHA-256 declared input: 64 hexadecimal characters; canonical stored/comparison form is exactly 64 lowercase hexadecimal characters
hash_algorithm: exact literal sha256
idempotency_key: 8-128 characters
safe_filename: 1-181 characters
original_filename metadata: 1-255 characters
MIME type: 1-128 characters
UUID identifiers: canonical UUID syntax; do not accept arbitrary 64-character identifiers
machine status/error/reason code: 1-64 characters
human display label/title: 1-200 characters
safe operator note or required action: 1-1000 characters
unlisted string field: reject
```

Preserve the existing checksum canonicalizer when it safely normalizes valid hexadecimal case before storage or comparison. Every accepted field remains route-allowlisted and may have a lower field-specific maximum.

### Abuse and concurrency controls

```text
actor_mutation_attempts: 120 per 15-minute window
organization_mutation_attempts: 600 per 15-minute window
abuse_window: 15 minutes
concurrent_uploads_per_actor: 2
concurrent_uploads_per_organization: 5
```

Count all attempts, including failed authentication, authorization, tenant, schema, and validation attempts after a safe key can be derived. Use separate actor and organization controls. A limit response uses HTTP 429, the canonical safe KAI error body, `Retry-After`, and standard rate-limit headers. Do not expose membership, identifier, storage, or infrastructure details in the key or response.

In-memory rate counters and concurrent-upload counters are permitted only for deterministic local, single-process tests. Production or multi-process enforcement of both the 120/600 mutation limits and the 2/5 concurrent-upload caps requires a shared atomic coordination store. Concurrent-upload permits must use bounded leases with expiry, release on completion or abort, crash recovery, and separate actor and organization keys. If shared enforcement is unavailable, upload remains fail-closed. Selection or authorization of a production coordination provider is outside this plan.

### Upload timing and reservation expiry

```text
upload_idle_timeout: 30 seconds
upload_total_timeout: 270 seconds
reservation_expiry: 24 hours after reservation creation
```

The idle timeout measures inactivity while a request remains incomplete. The total timeout measures elapsed route execution from accepted upload start. The 270-second value is an owner-approved application contract, not a claim that every Node, proxy, load balancer, hosting platform, or deployment target uses a universal 300-second timeout. Before implementing or enabling the upload route, inspect the effective Node HTTP timeout and every applicable upstream timeout. The application timeout must remain below every enclosing timeout with sufficient cleanup margin. If any effective enclosing timeout is 270 seconds or less, stop for the smallest owner-approved contract adjustment; do not infer upstream values. On timeout, abort the stream, close handles, remove only incomplete test-local state, emit a safe response, and write metadata-only audit when the authorized repository interface supports it. No timeout authorizes deletion of a confirmed object or retention execution.

## Locked upload lifecycle contract

Do not overload `processing_status`, `parse_status`, or `review_status` with transport lifecycle semantics.

Current repository facts support only these partial meanings:

```text
reserved:
  intake-file reservation row exists
  processing_status = quarantined
  parse_status = quarantined
  file_policy_status = pending
  caller-declared checksum remains unverified

policy_blocked:
  file_policy_status = blocked
```

The intended persistent lifecycle is a dedicated constrained `upload_state` with:

```text
reserved
upload_started
uploaded_unconfirmed
confirmed
policy_blocked
abandoned
expired
```

Associated persistence must include, by these fields or an exact existing equivalent verified during Gate A:

```text
upload_state_changed_at
upload_expires_at
provider-neutral immutable object-version identity
verified checksum state
verified checksum timestamp
```

Semantics:

* `reserved`: metadata row created; quarantine and pending policy states retained; expiry set to 24 hours.
* `upload_started`: first accepted byte or provider upload-session start recorded.
* `uploaded_unconfirmed`: exact object version completed but independent size/checksum confirmation not complete.
* `confirmed`: exact object version, byte size, and independently computed SHA-256 verified.
* `policy_blocked`: `upload_state = policy_blocked` and `file_policy_status = blocked`.
* `abandoned`: explicit authorized abandonment before confirmation.
* `expired`: current time exceeds `upload_expires_at` before confirmation.

No lifecycle transition deletes an object. Destructive cleanup and retention execution remain separately unauthorized.

Because the inspected repository does not support the complete durable mapping, P0-06A uses dependency-injected interfaces and an in-memory synthetic repository. P0-06B durable persistence is Gate-A-blocked.

## Additional contract contents

Define or preserve:

* `checksum` and `hash_algorithm = sha256`;
* checksum declaration and verification semantics;
* stable idempotency fingerprint algorithm and version, including exact fields, normalization, version identifier, and replay behavior across versions;
* replay and uniqueness scopes;
* 25-file batch limit;
* intended batch, file, policy, malware, parse, processing, and review states;
* queue and target types;
* operation-to-role matrix;
* the explicit security-executor identity and operation group required by P0-05, or stop for the smallest owner decision if no safe contract mapping exists;
* pagination constants;
* duplicate/version semantics;
* audit safe fields;
* transaction expectations;
* intended indexes and constraints;
* provider-neutral object-version identity;
* declared versus detected media type;
* object integrity metadata;
* retention metadata;
* engagement-as-project fields.

Do not invent a new DDL enum such as `security_assessment_pending`. Represent pre-assessment state using contract-supported values:

```text
processing_status = quarantined
parse_status = quarantined
file_policy_status = pending
```

Any new column, check, enum, index, or executable schema change remains blocked until Gate A.

## Acceptance

* The repository contract records every locked value above.
* Runtime constants, route schemas, test vocabulary, and static verifiers agree with it.
* No executable verifier requires `checksum_sha256`, except an isolated historical compatibility check justified by repository evidence.
* No runtime code requires an unverified new database column.
* The P0-06A/P0-06B boundary is explicit.
* Deployed schema compatibility remains `NOT_CONFIRMED`.

---
# P0-01 — Foundation truth and response safety

## Outcome and prerequisite

Execute only after P0-02 is installed. After this package, the metadata-only API truthfully reports its behavior and exposes one authoritative, safe, tenant-aware service surface using the locked repository-contract values.

## Required work

* Freshly inspect `/status`, mounted routes, service imports, public exports, tests, and verifiers; correct only defects that remain present.
* Put auth preflight behind `KAI_SPRINT2_ENABLED` or remove it when the preflight finding remains present.
* Make the mounted `kaiIntakeService.js` behavior canonical; preserve an older alias only when an inspected caller requires compatibility.
* Correct `/status` so metadata-write capability matches mounted behavior and disabled capabilities remain accurately false.
* Define fail-closed `KAI_FILE_UPLOAD_ENABLED`; upload and confirmation require both it and `KAI_SPRINT2_ENABLED`.
* Verify one authoritative validator group for every mutation.
* Preserve internal actor fields required by the contract while never serializing `req.user`, sessions, unrestricted memberships, or unrestricted actor records.
* Use this P0 HTTP convention:
  * `feature_disabled`: 403 for the internal/admin Sprint 2 API;
  * unauthenticated: 401;
  * authorization denial, mapped-user failure, and tenant-boundary violation: 403;
  * malformed request: 400;
  * duplicate, replay conflict, or stale state: 409;
  * request or file too large: 413;
  * unsupported media type: 415;
  * validator or state-transition blocker: 422;
  * abuse limit: 429;
  * storage adapter unavailable: 503;
  * unexpected system failure only: 500.
* Apply route-specific schemas, metadata allowlists, the 100 KiB body limit, depth 4, total-key limit 64, explicit-array limit 25, and locked string limits from P0-02.
* Ensure the Sprint 2 body limit is applied before any earlier global parser can consume a larger body.
* Reject unknown fields and nested objects, raw rows, prompts, credentials, signed URLs, private paths, and unapproved PII metadata.
* Resolve storage configuration server-side.
* Remove bucket, object key, URI, and provider-private identifiers from ordinary DTOs, responses, and errors.
* Add sensitive-response no-store behavior only when it does not duplicate existing global middleware.
* Reuse existing abuse infrastructure where safe and add separate actor and organization limiters using P0-02 values. Count all attempts and return the canonical 429 response.
* Deny AI and generic system mutations.
* Define a separate internal-service allowlist for the later security executor; do not enable it in this package.
* Parameterize or retire fixed operational identifiers in verifier artifacts.

## Acceptance

* Feature-off requests invoke no KAI service, DB, audit, queue, or storage dependency.
* Status reports metadata capabilities accurately.
* The canonical barrel and mounted service do not disagree.
* Upload/storage/parser/profile/source/evidence/claim/generation/export remain disabled.
* Every expected blocker uses the canonical KAI shape.
* Route-specific size, structure, unknown-field, and abuse-limit tests pass.
* No private location or raw content appears in responses or errors.
* Assistant and generic system mutation attempts invoke no write dependency.
* Focused, Sprint 2, legacy, and full tests pass.

## First-write milestone checkpoint

After Phase 0-D, P0-02, and P0-01 are complete, Codex must stop and return one combined milestone report covering the installation, repository-contract lock, foundation changes, exact commands, tests, diffs, commits, limitations, and prohibited actions not performed. Do not begin P0-03 in the same run.

The owner reviews this single milestone because it is the first repository-writing sequence and establishes the contract and foundation used by every downstream package. This is not per-commit dispatch, does not reopen the accepted backlog, does not require a new ExecPlan, and does not authorize Gates A through D. Owner continuation resumes the already accepted sequence at P0-03.

---
# P0-03 — Tenant-safe metadata behavior

## Repository-safe changes

* Add explicit organization predicates to every tenant-sensitive read, including the currently reported `getIntakeBatchTenantState()` batch lookup.
* Fail closed for missing or malformed stored fingerprints.
* Version fingerprint normalization.
* Separate required audit from best-effort metrics.
* Define transaction interfaces.
* Prepare SQL and repository interfaces for approved uniqueness and conflict behavior.
* Add mocked orchestration and conflict tests.
* Add privacy-safe metrics without raw labels.

## Schema-dependent changes

Do not activate SQL that requires a unique constraint, column, enum, or index not verified in the current target database.

Schema-dependent behavior remains:

```text
implementation_status: blocked
verification_status: not_run
blocking_gate: Gate A
```

This includes final proof of:

* atomic idempotency;
* 25-file concurrent limit;
* audit rollback;
* two-session replay conflict;
* version-link constraints.

## Acceptance before Gate A

May establish:

```text
TENANT_QUERY_SCOPE_TOOL_VERIFIED
FINGERPRINT_FAIL_CLOSED_TOOL_VERIFIED
TRANSACTION_ORCHESTRATION_TOOL_VERIFIED
MOCKED_CONFLICT_HANDLING_TOOL_VERIFIED
```

May not establish:

```text
DATABASE_ATOMICITY_VERIFIED
```

---

# P0-04 — Operator and review controls

## Mounted P0 surface

Inspect and preserve or implement only:

```text
GET  /status
GET  /batches
POST /batches
GET  /batches/:id
POST /batches/:id/files
GET  /batches/:id/files
GET  /files/:id
POST /files/:id/block
GET  /review-queue
POST /review-queue/:id/status
```

The final merged P0 route inventory also includes the P0-06 routes:

```text
POST /files/:id/upload
POST /files/:id/confirm-upload
```

Upload and confirmation behavior is defined in P0-06.

## Read controls

* Require authentication and allowed human role.
* Require active organization membership.
* Scope every query by organization before returning a row.
* Use bounded pagination and stable ordering.
* Apply explicit DTO allowlists.
* Return no raw file content, object location, unrestricted notes, or private storage metadata.

## Review controls

* Use only canonical queue vocabulary.
* Permit queue creation or transitions only when the target object currently exists.
* Do not create P1 targets merely to make a queue type usable.
* Require route-specific expected-current-status; do not introduce or require record versions.
* Scope every target read and compare-and-set write by organization, target object ID, and expected current status.
* Return canonical `409 conflict_current_state_changed` when compare-and-set affects zero rows after a valid scoped read.
* Return identical canonical `404 not_found` for no row and defensive tenant mismatch; never use ID-only lookup/write, tenant probes, fallbacks, unscoped queries, silent filtering, partial success, or mismatched target identifiers.
* Validate the scoped stored row, perform scoped compare-and-set, validate the returned post-write row, persist required metadata-only audit only after post-write validation, and commit only after required audit confirms success.
* Fail missing, malformed, cross-tenant, wrong-target, wrong-state, or internally inconsistent post-write rows with canonical safe `500 system_error`, suppress required audit and metrics, roll back all mutation side effects, and return no partial result or offending identifiers.
* Audit every successful transition with a field-by-field metadata-only scalar allowlist in the same transaction as all required mutation side effects.
* Treat required-audit persistence as confirmed only when it returns a non-array object with an own boolean data property named `ok` whose value is exactly `true`; thrown, rejected, skipped, missing, malformed, getter-backed, array-backed, non-boolean, or non-true results fail the transaction.
* Run best-effort metrics only after successful commit; metrics cannot alter or roll back a successful mutation.
* Keep generic dependency injection and deterministic transaction providers outside the canonical production barrel; test injection remains only through an explicitly test-only harness.
* Resolution never means approval, promotion, evidence eligibility, consent approval, or external use.
* Client-facing review remains disabled.

## Disabled downstream boundaries

* Data-dictionary generation remains disabled until deterministic profiling exists.
* Parser/job execution remains disabled.
* No source candidate, source, evidence, claim, generation, export, or graph record is created.

---

# P0-05 — File-security contract and bounded assessor

## Pre-upload validation

Enforce:

* 25 MB maximum;
* CSV, XLSX, MD, TXT, and machine-readable PDF only;
* no executables, scripts, HTML, unknown binaries, encrypted files, password-protected files, or image-only PDF;
* no OCR;
* application-generated safe filename;
* Unicode normalization;
* bidi and control-character rejection;
* path and separator rejection;
* reserved-name rejection;
* extension/MIME/signature agreement;
* Content-Disposition safety.

## Security-assessment input

The assessor receives only:

* organization ID;
* file ID;
* exact immutable object-version token;
* verified SHA-256;
* verified byte size;
* declared MIME and extension;
* storage-adapter handle.

It never receives arbitrary storage keys from a caller.

## Security checks

* signature and structural type;
* deterministic text encoding and binary rejection;
* encryption/password protection;
* PDF text-layer presence;
* PDF JavaScript, active actions, and embedded files;
* CSV row limit;
* XLSX sheet and cell limits;
* OOXML path traversal;
* macro and external-relationship detection;
* archive entry count;
* expanded-size limit;
* compression-ratio limit;
* execution timeout;
* malware-adapter result.

ZIP, RAR, 7z, and other standalone archive uploads remain rejected. Bounded archive inspection applies only to permitted container formats such as OOXML and to embedded-file detection in supported document formats.

Exact archive-entry, expanded-byte, compression-ratio, and timeout constants must exist in the repository contract before completion.

## P0-05C TXT/MD encoding and deterministic binary-content owner decisions

```text
decision_evidence: USER_CONFIRMED
decision_scope: strict UTF-8 and deterministic binary-content gate for TXT and MD
OWNER_DECISION.P0_05C.STRICT_UTF8_ONLY: future fixtures must cite this authority for strict UTF-8-only expected results
OWNER_DECISION.P0_05C.UTF8_BOM_ALLOWED: future fixtures must cite this authority for UTF-8 BOM allowed expected results
OWNER_DECISION.P0_05C.UNSUPPORTED_BOM_REJECTION: future fixtures must cite this authority for unsupported BOM rejection expected results
OWNER_DECISION.P0_05C.INVALID_UTF8_REJECTION: future fixtures must cite this authority for invalid UTF-8 rejection expected results
OWNER_DECISION.P0_05C.NUL_REJECTION: future fixtures must cite this authority for NUL rejection expected results
OWNER_DECISION.P0_05C.PROHIBITED_CONTROL_REJECTION: future fixtures must cite this authority for prohibited-control rejection expected results
OWNER_DECISION.P0_05C.LONE_CR_REJECTION: a TXT or MD file using CR-only line endings is rejected by the P0 encoding and deterministic binary-content gate
OWNER_DECISION.P0_05C.EMPTY_CONTENT_ENCODING_GATE_PASS: an empty TXT or MD byte sequence passes only the strict UTF-8 and deterministic binary-content gate
OWNER_DECISION.P0_05C.INSTRUCTION_TEXT_IS_INERT_DATA: future fixtures must cite this authority for instruction-like text treated as inert data
OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT: non-leading U+FEFF passes the narrow P0 TXT/MD encoding and deterministic binary-content gate
lone_cr_detail: legacy Mac-style line boundaries represented only by U+000D CR are rejected unless each CR is immediately followed by U+000A LF
line_ending_policy: P0 accepts LF and CRLF, rejects lone CR, does not normalize line endings, does not rewrite the quarantined object, and does not transcode legacy line-ending formats
cr_only_utf8_note: do not describe CR-only text as malformed UTF-8; it may be valid UTF-8 but is blocked under the deterministic binary-content policy
empty_content_result: encoding_gate_pass_only
empty_content_non_claims: not_document_validity; not_content_usability; not_profile_eligibility; not_source_eligibility; not_security_assessment_completion
forbidden_empty_content_language: empty files are valid; empty uploads are accepted; empty documents are supported
later_empty_content_validators: usefulness or workflow validators may block empty content under separate owner decisions
future_empty_fixture_metadata: expected_policy allow; expected_category encoding_gate_pass; scope_note encoding_gate_pass_only; usable_document_claim false; source_eligibility_claim false; corpus_status corpus_only
fixture_boundary: no fixture may convert an encoding-gate result into a broader document-validity claim
nonleading_ufeff_byte_position_treatment: one EF BB BF sequence is treated specially as the optional UTF-8 BOM only when it begins at byte offset zero; that one leading sequence may be ignored for strict UTF-8 encoding-gate validation; an EF BB BF sequence occurring anywhere after byte offset zero decodes as Unicode U+FEFF
nonleading_ufeff_pass_basis: valid strict UTF-8; not NUL; not a prohibited C0 control; not DEL; not a C1 control; not lone CR
nonleading_ufeff_gate_must_not: strip non-leading U+FEFF; normalize non-leading U+FEFF; reinterpret it as another BOM; reject it merely because its UTF-8 encoding is EF BB BF; attach semantic meaning to it; treat it as an instruction, policy, approval, or review decision
consecutive_leading_efbbbf_treatment: when two consecutive EF BB BF sequences occur at the beginning of the byte stream, the first may be treated as the single optional leading UTF-8 BOM and the second decodes and remains as an ordinary permitted U+FEFF character
nonleading_ufeff_result: encoding_gate_pass_only
nonleading_ufeff_non_claims: not_document_validity; not_content_usability; not_profile_eligibility; not_source_eligibility; not_evidence_eligibility; not_semantic_safety; not_security_assessment_completion; not_upload_acceptance
nonleading_ufeff_scope_limit: applies only to U+FEFF under the P0 TXT/MD encoding and deterministic binary-content gate; do not generalize to all zero-width characters, Unicode formatting characters, or Unicode format controls
future_nonleading_ufeff_fixture: P0-05D TXT/MD byte-fixture corpus must include a positive fixture containing non-leading U+FEFF, citing OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT, with expected_policy allow, expected_category encoding_gate_pass, and scope_note encoding_gate_pass_only
future_nonleading_ufeff_blocking_fixture_limit: future corpus must not contain a grounded blocking fixture whose only rationale is that EF BB BF occurs after byte offset zero or is described as a non-leading UTF-8 BOM
future_second_efbbbf_fixture_note: a second EF BB BF immediately following the optional leading BOM is also a permitted U+FEFF case at this narrow gate
future_p0_05d_fatal_decoder_integrity: fixture-integrity tests must actively establish UTF-8 validity using new TextDecoder("utf-8", { fatal: true }); every fixture labeled valid UTF-8 must decode successfully in fatal mode; every fixture labeled invalid UTF-8 must throw in fatal mode; byte-array or hexadecimal comparison alone is insufficient; replacement-character decoding is not authoritative evidence of validity; the check must operate on fixture bytes themselves and must not rely on JavaScript string coercion to construct or classify invalid UTF-8 fixtures
p0_security_policy_style: deterministic and enumerated; reject rather than guess or silently transcode; no percentage, density, entropy, or language heuristics; no charset autodetection; no mutation of quarantined bytes; no execution or semantic interpretation of content; raw bytes and decoded content excluded from blockers, responses, audit, metrics, and logs
non_scope: this statement guides later P0-05 decisions but does not define CSV, XLSX, PDF, MIME/signature, or malware policy; those controls require separate owner decisions
implementation_status: not_implemented_by_this_decision_record
tests_run: not run; documentation-only owner-decision record
database_or_cloud_access: not performed
```

## P0-05D TXT/MD deterministic encoding and binary-content byte-fixture corpus

```text
leaf_status: complete
p0_05_package_status: txt_md_byte_fixture_corpus_complete
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: fe862d837a562cbfd3a296d4e9dfc4375dff82c5
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED — fe862d837a562cbfd3a296d4e9dfc4375dff82c5 changed only Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan to record P0-05C.1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05D fixture-and-test-only boundary
implemented_corpus_file: __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js
fixture_count: 27
corpus_status: corpus_only; synthetic TXT/MD byte fixtures only; not security-verified and not a production detector conformance claim
production_code_changed: false
runtime_behavior_changed: false
production_detector_upload_path_parser_implemented: false
dependencies_or_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
contract_update: not performed
authority_grounding: every expected_policy and expected_category is grounded in committed P0-05C or P0-05C.1 OWNER_DECISION authority from Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md
corpus_schema: fixture_id; description; applies_to; bytes_hex; byte_length; declared_utf8_valid; expected_policy; expected_category; authority; scope_note; utf8_validity_basis; byte_case_family; synthetic_provenance; corpus_status; usable_document_claim; source_eligibility_claim; production_detector_claim
positive_fixture_coverage: ordinary ASCII; valid multibyte UTF-8; LF; CRLF; TAB; empty byte content; instruction-like inert text; leading UTF-8 BOM with text; leading UTF-8 BOM only; non-leading U+FEFF; two initial EF BB BF sequences
blocking_fixture_coverage: isolated continuation byte; truncated multibyte sequence; invalid leading byte; overlong encoding; surrogate-encoded UTF-8; UTF-16 LE BOM; UTF-16 BE BOM; UTF-32 LE BOM; UTF-32 BE BOM; NUL; prohibited C0 U+001F; DEL; C1 U+0085; lone CR at beginning, middle, and end
control_boundary_proof: TAB/LF/CRLF positive cases and prohibited-control negative cases prove both permitted and blocked sides of the control boundary without density, heuristic, normalization, document-usability, Markdown-semantic, extension/MIME/signature, upload-acceptance, or parser claims
nonleading_ufeff_fixture: TXTMD-P0-05D-010-ALLOW-NONLEADING-UFEFF cites OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT with expected_policy allow, expected_category encoding_gate_pass, and scope_note encoding_gate_pass_only; fatal decoding succeeds and retains U+FEFF
two_initial_efbbbf_fixture: TXTMD-P0-05D-011-ALLOW-TWO-INITIAL-EFBBBF cites OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT with expected_policy allow, expected_category encoding_gate_pass, and scope_note encoding_gate_pass_only; fatal decoding succeeds and retains the second U+FEFF after the committed single-leading-BOM treatment
fatal_decoder_integrity: integrity test actively uses new TextDecoder("utf-8", { fatal: true }) to prove every declared-valid UTF-8 fixture decodes and every declared-invalid UTF-8 fixture throws; replacement-character decoding is not authoritative and byte comparison alone is not treated as UTF-8 validity proof
invalid_utf8_individual_throw_proof: isolated continuation, truncated multibyte, invalid leading byte, overlong, and surrogate-encoded fixtures each throw independently in fatal mode; overlong and surrogate-encoded cases are asserted specifically
unsupported_cases_policy: unsupported cases were omitted rather than assigned allow or block policy
focused_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js — 9 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — new test discovered and passed, existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — 453 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
pre_existing_test_outcome_change: none observed; initial failures were the established sandbox EPERM listener condition and passed on identical localhost-capable rerun
broader_repository_suite: not run; fixture/test-only package did not change shared infrastructure and the directly affected and Sprint 2 suites passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node command
git_diff_check: passed
complete_diff_scope: __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js, __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05D fixture-and-test-only package commit; do not implement detector behavior, route/service work, upload lifecycle work, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05E pure TXT/MD deterministic byte detector

```text
leaf_status: complete
p0_05_package_status: pure_txt_md_byte_detector_complete
implementation_status: pure_detector_and_corpus_driven_unit_test_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: c4fd14c45ce97fa21b274b1d327fe946c8ca3071
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED — c4fd14c45ce97fa21b274b1d327fe946c8ca3071 changed only __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js, __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js, and this living ExecPlan to record P0-05D
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05E pure-detector/test/evidence boundary
implemented_detector_module: Backend/kai/validators/txtMdByteDetector.js
exported_detector_function: detectTxtMdBytePolicy
focused_detector_test_file: __tests__/kai-sprint2-txt-md-byte-detector.spec.js
reused_committed_corpus_file: __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js
fixture_count: 27
corpus_agreement: 27/27 exact agreement for expected_policy, expected_category, and scope_note
detector_result_totals: matches 27; mismatches 0; false_allows 0; false_blocks 0; unclassified_results 0; detector_level_throws 0
accepted_byte_input: Uint8Array-compatible in-memory bytes, including Buffer through Uint8Array compatibility
result_shape: metadata-only object with validator_key, expected_policy, expected_category, scope_note, and safe evidence flags/counts; no raw bytes, decoded content, filenames, paths, excerpts, or semantic content
raw_byte_bom_handling: detector inspects original bytes before decoding; checks UTF-32 LE and UTF-32 BE four-byte prefixes before UTF-16 LE and UTF-16 BE two-byte prefixes; rejects unsupported BOM encodings without fallback decoding or transcoding
utf8_bom_handling: detector checks offset-zero EF BB BF before decoding, records the single optional leading UTF-8 BOM, and removes exactly those first three bytes from the view supplied to the decoder
decoder_construction: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
decoder_failure_behavior: fatal decoder exceptions are caught internally and converted to structured invalid_utf8 block results; no decoder exception escapes to caller or test
nonleading_ufeff_behavior: non-leading EF BB BF decodes as U+FEFF, is allowed at this narrow gate, and is retained as safe metadata count evidence without returning decoded content
two_initial_efbbbf_behavior: first offset-zero EF BB BF receives BOM treatment; second sequence remains decoded U+FEFF; fixture allows with decoded_ufeff_count 1 and no double stripping
control_boundary: TAB, LF, and CRLF allow; NUL blocks as nul_rejection; prohibited C0 other than TAB/LF/CR blocks as prohibited_control; DEL blocks; C1 blocks; CR blocks unless immediately followed by LF
instruction_like_text: remains inert data and is not interpreted or blocked because it resembles instructions
empty_content: returns only expected_policy allow, expected_category encoding_gate_pass, and scope_note encoding_gate_pass_only
dependencies_or_lockfiles_changed: false
production_barrel_changed: false
production_caller_added: false
current_authorized_production_caller: none
route_service_storage_worker_parser_integration: not implemented
raw_byte_transport_upload_storage_retrieval_worker_parser_behavior: not implemented
enabled_behavior_phase_change: none
raw_content_logging_or_result_exposure: none
current_state_update: not performed
implementation_baseline_update: not performed
contract_update: not performed
database_cloud_credentials_production_real_data: not accessed or modified
focused_detector_and_corpus_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js — 16 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — new detector tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — 460 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test — new detector tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test — 565 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
pre_existing_test_outcome_change: none observed; initial failures were the established sandbox EPERM listener condition and passed on identical localhost-capable rerun
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
git_diff_check: passed
complete_diff_scope: Backend/kai/validators/txtMdByteDetector.js, __tests__/kai-sprint2-txt-md-byte-detector.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05E pure-detector package commit; do not implement mounted integration, route/service work, raw-byte transport, upload lifecycle work, storage retrieval, worker/parser behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.1 extension, declared MIME, signature, and structural-type agreement

```text
leaf_status: complete after this documentation-only package commit
p0_05_package_status: owner_type_agreement_matrix_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
additional_owner_authority_recorded_later: OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
decision_scope: deterministic P0 gate for terminal extension, declared file MIME, shallow byte signature, minimum structural-type identity, and agreement between those signals
broader_file_security_assessment_completed: false
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 276d863918ef1d592eebd07e7fe888ef4b9e4af7
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED - 276d863918ef1d592eebd07e7fe888ef4b9e4af7 changed only Backend/kai/validators/txtMdByteDetector.js, __tests__/kai-sprint2-txt-md-byte-detector.spec.js, and this living ExecPlan to record P0-05E
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.1 documentation-only owner-decision boundary
preflight_detectTxtMdBytePolicy_production_caller: absent; current references are detector module, focused test, and this living ExecPlan only
preflight_raw_byte_integration: mounted raw-byte integration remains absent
preflight_extension_mime_signature_corpus: absent; no extension/MIME/signature fixture corpus exists
preflight_general_type_detector: absent; no general CSV/XLSX/PDF/signature detector exists
preflight_runtime_declared_file_mime_allowlist: Backend/kai/services/kaiIntakeService.js ALLOWED_METADATA_ONLY_MIME_TYPES currently contains text/csv, application/csv, text/plain, and application/json
runtime_application_json_gap_status: unresolved_visible_code_alignment_gap
runtime_behavior_changed: false
production_code_changed: false
tests_fixtures_detectors_changed: false
dependencies_manifests_lockfiles_changed: false
current_state_update: not performed
implementation_baseline_update: not performed
database_cloud_credentials_production_real_data: not accessed or modified
```

`OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1` records that all required type signals must agree. A legitimate file with inconsistent extension, declared MIME, detected signature, or minimum structure blocks rather than being guessed, repaired, or reclassified. There is no winner or fallback precedence among extension, declared MIME, detected signature, and minimum structure.

Canonical P0 extensions are:

```text
.csv
.xlsx
.md
.txt
.pdf
```

Extension comparison is ASCII case-insensitive; accepted extension input canonicalizes to lowercase; exactly one terminal extension is evaluated; every other extension blocks; no filename extension overrides MIME, signature, or minimum structure; and multiple-extension and filename-hazard rules remain governed by the committed filename policy.

Declared file MIME is separate from the HTTP request-envelope `Content-Type`. Declared file MIME normalization trims surrounding ASCII whitespace and lowercases the type and subtype. MIME parameters are not accepted in P0 file metadata, so `text/plain; charset=utf-8` blocks rather than being stripped or reinterpreted.

Declared file-MIME matrix:

```text
.csv
  text/csv
  application/csv

.xlsx
  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

.md
  text/markdown
  text/plain

.txt
  text/plain

.pdf
  application/pdf
```

Markdown/plain-text compatibility is asymmetric by owner decision: `.md + text/plain` is permitted, but `.txt + text/markdown` blocks as `declared_type_mismatch`. Markdown may be declared as plain text in P0; plain-text files are not thereby accepted as Markdown.

Unsupported declared file MIME values include `application/json`, `application/octet-stream`, `text/html`, `text/javascript`, `application/javascript`, `application/zip`, `application/x-zip-compressed`, unknown MIME, empty MIME, and every value not explicitly listed in the matrix. `application/octet-stream` may later serve as an HTTP upload transport envelope; it is not an accepted declared file MIME.

Known runtime-alignment gap:

```text
Current runtime declared file-MIME behavior accepts application/json.
OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 rejects application/json because JSON is not an allowed P0 document type.
P0-05F.1 records policy only.
A later separately authorized code package must align the runtime allowlist with the committed matrix.
Until that package is completed:
- policy authority says application/json must block;
- current runtime behavior remains divergent;
- the divergence must remain visible;
- the project must not claim runtime type-policy alignment.
```

Block conditions include unsupported extension, unsupported MIME, extension/MIME disagreement, detected signature identifying another type, minimum structure contradicting declared type, ambiguous bytes where deterministic type cannot be established, bytes truncated below the required minimum, and no permitted type being deterministically established. Do not trust declared MIME over bytes, trust extension over bytes, rewrite declarations from detected bytes, guess likely type, apply fallback MIME detection, accept because one signal matches, or repair inconsistent metadata automatically.

Later owner authority `OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1` expands `declared_type_mismatch` category semantics for detected permitted-type contradictions. When terminal extension and declared file MIME jointly identify one permitted P0 type, but byte signature and the required minimum structure deterministically establish a different permitted P0 type, the file blocks as `block / declared_type_mismatch`.

A pass establishes only `type_agreement_pass_only`. It does not establish document validity, document usability, machine-readable PDF status, encryption or password status, macro safety, active-content safety, archive-expansion safety, malware cleanliness, profile eligibility, source eligibility, upload acceptance, or complete file-policy pass.

Text-family rule: CSV, MD, and TXT have no unique reliable magic signature for this P0 gate. Extension and declared MIME select the permitted text subtype; bytes must pass strict UTF-8 and deterministic binary-content validation; no semantic parsing distinguishes CSV, MD, or TXT; content meaning is not inspected; and instruction-like content remains inert data. CSV uses the committed strict UTF-8, BOM, NUL, prohibited-control, and lone-CR boundary already established for P0 text bytes. This does not decide CSV row limits, delimiter validity, header validity, formula handling, or parser behavior. Valid permitted text containing HTML, JavaScript, shell syntax, prompt injection, or other instruction-like strings is not reclassified as HTML or script content merely because those strings occur in the text. Empty CSV, MD, or TXT bytes may pass only when extension and MIME agree and the strict text-byte gate passes; the result remains `type_agreement_pass_only`.

PDF shallow identity rule: a candidate PDF must use extension `.pdf`, declare `application/pdf`, begin at byte offset zero with ASCII `%PDF-`, and contain ASCII `%%EOF` within the final 1024 bytes. Leading bytes before `%PDF-` are not accepted. This does not establish machine-readable text layer, unencrypted status, password-free status, valid cross-reference structure, absence of JavaScript, absence of active actions, absence of embedded files, or complete PDF validity.

XLSX shallow identity rule: a candidate XLSX must use extension `.xlsx`, declare `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, begin with a ZIP local-file-header signature, expose a structurally readable end-of-central-directory record, expose a structurally readable central directory, and contain exact case-sensitive central-directory entry names `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. A generic ZIP prefix is insufficient, and finding a required name somewhere in raw bytes is not proof that it is a valid central-directory entry.

The XLSX shallow identity rule establishes ZIP entry identity only by parsing ZIP structure. It must locate and validate the end-of-central-directory record; read the recorded central-directory offset and byte length; verify those values remain within fixture byte bounds; iterate valid central-directory records; obtain entry names from those records; validate each record length before advancing; validate each recorded local-header offset; verify the expected number of directory entries; and establish required-entry presence from the parsed directory-name set. It must not establish required-entry presence through raw-byte substring search, regular-expression search over the byte buffer, decoded whole-buffer text search, or grep-like matching.

The future shallow XLSX identity detector may inspect ZIP signatures, local headers, central-directory metadata, end-of-central-directory metadata, entry names, entry offsets, and stored and compressed lengths needed for bounded structural verification. It must not decompress entry contents, parse worksheet XML, parse workbook XML content, read cell values, expand archive data, execute macros, follow relationships, use the filesystem, or invoke external ZIP utilities in this P0-05F identity gate. A test-only ZIP builder may create deterministic stored empty entries without adding a dependency, but it must calculate and encode local-file-header offsets, central-directory record offsets, central-directory byte length, central-directory start offset, entry count, and end-of-central-directory metadata.

The positive minimum XLSX fixture must be a readable ZIP whose central-directory offsets, record lengths, entry counts, bounds, and local-header references are internally consistent; it expects `allow / type_agreement_pass / type_agreement_pass_only`. Missing-entry negative fixtures must be separate readable ZIPs for missing `[Content_Types].xml`, missing `_rels/.rels`, and missing `xl/workbook.xml`, each with the other two required entries present and exactly the claimed entry absent; each expects `block / standalone_archive_or_non_xlsx`. A wrong-case fixture must be a readable ZIP with exactly one required entry present only under incorrect case, such as `xl/Workbook.xml`; it expects `block / standalone_archive_or_non_xlsx`. A renamed non-OOXML ZIP must remain readable, omit at least one exact required OOXML entry, and not qualify merely because raw bytes contain similar strings; it expects `block / standalone_archive_or_non_xlsx`. Malformed and truncated ZIP fixtures must remain separate from missing-entry and standalone-archive fixtures, including truncated local-file-header signature, local header without readable central directory, invalid or out-of-bounds central-directory offset, and truncated central-directory record; each expects `block / truncated_or_malformed_type`.

Generic and standalone ZIP coverage must remain separate for readable arbitrary ZIP with allowed non-XLSX metadata, readable ZIP with `.xlsx` metadata but missing minimum OOXML structure, and recognized standalone ZIP signature with otherwise permitted non-XLSX metadata. This rule does not establish macro absence, external-relationship absence, encryption/password status, OOXML path safety, sheet limits, cell limits, entry-count limits, expanded-size limits, compression-ratio safety, or complete workbook validity.

Recognized disallowed binary signatures for the future corpus include DOS/PE MZ, ELF, standalone ZIP, RAR 4, RAR 5, 7z, and gzip. A recognized disallowed signature blocks regardless of allowed extension or declared MIME. Unknown non-text binary input that does not satisfy permitted PDF or XLSX shallow identity remains fail-closed as `unknown_binary`.

Deterministic block outcomes:

```text
unsupported extension or MIME -> block / unsupported_file_type
extension and MIME disagreement -> block / declared_type_mismatch
extension and MIME agree on one permitted type but complete byte identity establishes another permitted type -> block / declared_type_mismatch
recognized disallowed signature -> block / disallowed_binary_signature
ZIP without minimum XLSX structure -> block / standalone_archive_or_non_xlsx
PDF or XLSX signature present but minimum identity incomplete -> block / truncated_or_malformed_type
multiple permitted types genuinely remain plausible after applying all committed signals -> block / ambiguous_file_type
non-text bytes matching no permitted binary type -> block / unknown_binary
```

`ambiguous_file_type` is a defensive fail-closed category. The future fixture corpus must not invent a contrived or semantically impossible byte case solely to exercise it. Include an `ambiguous_file_type` fixture only if a naturally reachable case exists under the committed matrix; otherwise record the category as defensive and currently unexercised. Do not weaken or alter another fixture merely to manufacture ambiguity, and do not treat absence of an ambiguity fixture as incomplete coverage when the category is unreachable by construction.

Future sequence:

```text
P0-05F.2
  complete synthetic extension/MIME/signature fixture corpus

P0-05F.3
  read-only detector measurement against the corpus

P0-05F.4
  pure unwired detector if measurement confirms absence

separate runtime-alignment leaf
  remove application/json and align the current declared file-MIME runtime allowlist
  only after explicit authorization
```

The fixture corpus must precede detector implementation. The future fixture corpus must include every allowed extension/MIME pairing, every grounded cross-type mismatch, uppercase extension normalization, unsupported extensions, unsupported MIME values, `application/json` rejection, `application/octet-stream` declared-MIME rejection, MIME-parameter rejection, empty text-family cases, PDF positive and truncated cases, XLSX positive minimum structure, standalone ZIP, renamed ZIP, recognized executable/archive signatures, unknown binary, instruction-like permitted text remaining inert, and `ambiguous_file_type` only under the defensive-category rule. The runtime-alignment change must not be silently merged into fixture or detector packages.

Explicit exclusions: this decision does not settle or implement CSV row count, CSV delimiter/header validity, CSV formula-injection handling, XLSX macro detection, XLSX external relationships, OOXML path traversal, archive expansion limits, PDF text-layer proof, PDF encryption, PDF JavaScript/actions, PDF embedded files, malware scanning, upload transport, storage integration, parser/profile behavior, production wiring, or P0-05A through P0-05E.

```text
tests_run: not run; documentation-only owner-decision package
git_diff_check: passed after edit
git_diff_cached_check: passed after staging
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.1 documentation-only package commit; do not implement fixtures, tests, detectors, MIME allowlist changes, parsers, runtime behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.1A ratified XLSX central-directory boundary

```text
leaf_status: complete after this documentation-only corrective commit
p0_05_package_status: xlsx_central_directory_boundary_ratified
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
owner_decision_recorded_after_reviewing_commit: 854e3ccf06f477e014999aa4983814cbd8b8a310
owner_decision_scope: explicit ratification of the stricter XLSX identity boundary identified by read-only audit of the exact contract diff; not merely acceptance of an implementation side effect
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.1A documentation-only corrective boundary
preflight_branch: codex/kai-sprint2-p0-v0.3.5
preflight_head: 854e3ccf06f477e014999aa4983814cbd8b8a310
preflight_working_tree: clean
prior_commit_boundary_verified: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md, KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md, __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js, and __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js
prior_commit_classification: P0-05F.2a - XLSX/ZIP fixture subcorpus
prior_commit_completes_p0_05f_2: false
verified_xlsx_zip_fixture_count: 13
focused_xlsx_zip_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 8 passed, 0 failed
production_code_changed: false
tests_fixtures_detectors_changed: false
runtime_behavior_changed: false
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
```

`OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1` ratifies that XLSX shallow identity requires a readable EOCD and central directory; valid in-bounds directory offsets, lengths, records, entry counts, and local-header offsets; exact case-sensitive central-directory entries `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`; and required-entry presence established only through parsed central-directory records.

The ratified XLSX identity boundary forbids raw-buffer string search, regex search, decoded-buffer search, grep-like entry search, decompression, archive expansion, XML parsing, filesystem access, and external ZIP utilities. Readable ZIPs missing required entries or using wrong-case names block as `standalone_archive_or_non_xlsx`. Malformed or truncated ZIPs block as `truncated_or_malformed_type`.

Commit `854e3ccf06f477e014999aa4983814cbd8b8a310` is accepted as `P0-05F.2a - XLSX/ZIP fixture subcorpus`. It contains 13 technically verified XLSX/ZIP fixtures and does not complete P0-05F.2.

Remaining P0-05F.2 coverage:

```text
P0-05F.2b - text family and extension/MIME matrix
P0-05F.2c - PDF identity fixtures
P0-05F.2d - disallowed signatures and unknown binary
P0-05F.2e - final combined completeness proof
```

Fixture packages are graded against frozen owner authority. Fixture packages must never modify the contract. A discovered contract gap requires stopping for an owner decision. Contract and fixture changes must not be combined in one implementation commit.

```text
git_diff_check: passed after P0-05F.1A edit
git_diff_cached_check: passed after staging
git_diff_cached_stat: inspected after staging
git_diff_cached: inspected before commit
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.1A documentation-only corrective commit; do not implement P0-05F.2b, fixtures, tests, detectors, MIME allowlist changes, parsers, runtime behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.2a XLSX and ZIP fixture subcorpus

```text
leaf_status: accepted as P0-05F.2a after P0-05F.1A owner ratification
p0_05_package_status: xlsx_zip_fixture_subcorpus_recorded
implementation_status: corpus_only_tests_and_contract_language
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 plus OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F fixture-corpus/documentation boundary
implemented_fixture_module: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js
accepted_commit: 854e3ccf06f477e014999aa4983814cbd8b8a310
p0_05f_2_subpackage: P0-05F.2a - XLSX/ZIP fixture subcorpus
p0_05f_2_complete: false
remaining_p0_05f_2_sequence: P0-05F.2b text family and extension/MIME matrix; P0-05F.2c PDF identity fixtures; P0-05F.2d disallowed signatures and unknown binary; P0-05F.2e final combined completeness proof
production_code_changed: false
production_detector_added_or_changed: false
runtime_behavior_changed: false
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
positive_fixture_id: XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX
positive_xlsx_expected_result: allow / type_agreement_pass / type_agreement_pass_only
positive_xlsx_central_directory_parser_used: true
positive_xlsx_entry_names_obtained_from_parsed_directory_records: [Content_Types].xml, _rels/.rels, xl/workbook.xml
confirmation_no_raw_byte_string_search_established_entry_presence: true
positive_xlsx_directory_bounds_and_local_header_offsets_valid: true
positive_xlsx_readable_eocd: true
positive_xlsx_readable_central_directory: true
positive_xlsx_internally_consistent_directory_bounds: true
positive_xlsx_valid_record_boundaries: true
positive_xlsx_contains_exactly_intended_fixture_entries: true
positive_xlsx_contains_all_three_required_names_through_parsed_central_directory_records: true
positive_xlsx_exact_case_confirmed: true
missing_entry_fixtures:
  XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES: readable ZIP confirmed; _rels/.rels and xl/workbook.xml present; exactly [Content_Types].xml absent; expected category standalone_archive_or_non_xlsx
  XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS: readable ZIP confirmed; [Content_Types].xml and xl/workbook.xml present; exactly _rels/.rels absent; expected category standalone_archive_or_non_xlsx
  XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK: readable ZIP confirmed; [Content_Types].xml and _rels/.rels present; exactly xl/workbook.xml absent; expected category standalone_archive_or_non_xlsx
wrong_case_fixture_id: XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK
wrong_case_zip_readable: true
wrong_case_exact_required_spelling_absent: xl/workbook.xml
wrong_case_case_variant_spelling_present: xl/Workbook.xml
wrong_case_expected_category: standalone_archive_or_non_xlsx
renamed_non_ooxml_fixture_id: XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP
generic_and_standalone_zip_fixture_ids: XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA, XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML, XLSXZIP-P0-05F-009-BLOCK-STANDALONE-ZIP-SIGNATURE
malformed_truncated_zip_fixtures:
  XLSXZIP-P0-05F-010-BLOCK-TRUNCATED-LOCAL-SIGNATURE: exact structural defect truncated local-file-header signature; expected category truncated_or_malformed_type
  XLSXZIP-P0-05F-011-BLOCK-NO-CENTRAL-DIRECTORY: exact structural defect local header without readable central directory; expected category truncated_or_malformed_type
  XLSXZIP-P0-05F-012-BLOCK-OUT-OF-BOUNDS-CD-OFFSET: exact structural defect invalid or out-of-bounds central-directory offset; expected category truncated_or_malformed_type
  XLSXZIP-P0-05F-013-BLOCK-TRUNCATED-CD-RECORD: exact structural defect truncated central-directory record; expected category truncated_or_malformed_type
confirmation_required_xlsx_entries_proven_through_central_directory_parsing_not_raw_byte_search: true
confirmation_every_missing_entry_fixture_is_readable_zip_minus_exactly_one_required_entry: true
confirmation_wrong_case_fixture_is_readable_zip_and_fails_only_exact_case_sensitive_name_matching: true
confirmation_malformed_zip_fixtures_are_distinct_from_missing_entry_fixtures: true
confirmation_no_entry_content_was_decompressed: true
focused_xlsx_zip_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 8 passed, 0 failed
repository_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract - 9 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - new XLSX/ZIP tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 468 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - new XLSX/ZIP tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - 573 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
git_diff_check: passed in original fixture package; rerun in P0-05F.1A corrective package
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md, __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js, __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js, and this living ExecPlan evidence/language update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: P0-05F.2 remains open after this P0-05F.2a XLSX/ZIP fixture subcorpus; do not implement detectors, mounted integration, runtime MIME allowlist changes, upload lifecycle work, storage retrieval, worker/parser behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf without owner authorization
```

## P0-05F.2b1 text-family type-agreement fixtures

```text
leaf_status: complete after this fixture-only package commit
p0_05_package_status: text_family_type_agreement_fixture_subcorpus_recorded
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 plus committed P0-05C strict text-byte authorities where fixture bytes require them
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2b1 fixture-only boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 2051bbece9adf06ae7e7245523ac025b202e3fd8
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 and OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
preflight_prior_commit_classification: 854e3ccf06f477e014999aa4983814cbd8b8a310 classified as P0-05F.2a - XLSX/ZIP fixture subcorpus
preflight_fixture_process_rules_present: fixture packages graded against frozen owner authority; fixture packages must never modify the contract; discovered contract gap requires stopping for owner decision; contract and fixture changes must not be combined in one implementation commit
preflight_text_family_type_agreement_corpus: absent before this package
implemented_fixture_module: __tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js
fixture_count: 6
positive_fixture_count: 5
blocking_fixture_count: 1
permitted_pairings_exactly_once: .csv + text/csv; .csv + application/csv; .md + text/markdown; .md + text/plain; .txt + text/plain
positive_expected_result: allow / type_agreement_pass / type_agreement_pass_only
blocking_fixture: TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH expects block / declared_type_mismatch
normalization_coverage: uppercase extension; mixed-case MIME; surrounding ASCII MIME whitespace trimming
empty_text_fixture_ids: TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY, TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY, TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY
instruction_like_fixture_id: TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION
html_script_looking_fixture_id: TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING
fixture_ids: TEXTTYPE-P0-05F-001-ALLOW-CSV-TEXT-CSV-UPPERCASE-EMPTY; TEXTTYPE-P0-05F-002-ALLOW-CSV-APPLICATION-CSV-INSTRUCTION; TEXTTYPE-P0-05F-003-ALLOW-MD-TEXT-MARKDOWN-EMPTY; TEXTTYPE-P0-05F-004-ALLOW-MD-TEXT-PLAIN-HTML-SCRIPT-LOOKING; TEXTTYPE-P0-05F-005-ALLOW-TXT-TEXT-PLAIN-EMPTY; TEXTTYPE-P0-05F-006-BLOCK-TXT-TEXT-MARKDOWN-MISMATCH
fixture_integrity: fixture IDs unique; fixtures synthetic; every expected result authority-grounded; positive bytes pass fatal UTF-8 and committed text control boundary; normalization assertions match contract; no production detector used as answer-key authority
corpus_status: corpus_only; synthetic text-family type-agreement fixtures only; not security-verified and not a production detector conformance claim
production_code_changed: false
production_detector_added_or_changed: false
runtime_behavior_changed: false
repository_contract_changed: false
owner_decision_changed: false
dependencies_manifests_lockfiles_changed: false
pdf_xlsx_signature_unknown_binary_work: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
focused_text_type_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js - 9 passed, 0 failed
existing_txt_md_corpus_and_detector_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js - 16 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - new text-family type-agreement tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 477 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node command
git_diff_check: passed
git_diff_cached_check: passed
git_diff_cached_stat: inspected
git_diff_cached: inspected before commit
complete_diff_scope: __tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js, __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.2b1 fixture-only package commit; do not implement detectors, runtime MIME allowlist changes, repository contract changes, owner-decision changes, PDF/XLSX/signature/unknown-binary fixtures, upload lifecycle work, storage retrieval, worker/parser behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.2b2a complete extension/MIME matrix fixtures

```text
leaf_status: complete after this fixture-only package commit
p0_05_package_status: extension_mime_matrix_fixture_subcorpus_recorded
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 plus OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1 for imported XLSX positive bytes
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2b2a fixture-only boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 81b6b4c06ceb905a5259bf406ac357714c8d3966
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 and OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
preflight_prior_p0_05f_2a_verified_xlsx_zip_corpus: present with positive fixture XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX
preflight_prior_p0_05f_2b1_matrix_contribution: five permitted text pairings and one .txt + text/markdown declared_type_mismatch
preflight_complete_matrix_corpus: absent before this package
preflight_fixture_process_rules_present: fixture packages graded against frozen owner authority; fixture packages must never modify the contract; discovered contract gap requires stopping for owner decision; contract and fixture changes must not be combined in one implementation commit
implemented_fixture_module: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js
fixture_count: 24
positive_fixture_count: 2
blocking_fixture_count: 22
new_fixture_ids: EXTMIME-P0-05F-001-BLOCK-CSV-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-002-BLOCK-CSV-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-003-BLOCK-CSV-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-004-BLOCK-CSV-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-005-BLOCK-XLSX-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-006-BLOCK-XLSX-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-007-BLOCK-XLSX-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-008-BLOCK-XLSX-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT; EXTMIME-P0-05F-010-BLOCK-XLSX-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-011-BLOCK-MD-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-012-BLOCK-MD-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-013-BLOCK-MD-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-014-BLOCK-MD-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-015-BLOCK-TXT-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-016-BLOCK-TXT-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-017-BLOCK-TXT-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-018-BLOCK-TXT-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF
new_permitted_fixture_ids: EXTMIME-P0-05F-009-ALLOW-XLSX-OFFICEDOCUMENT; EXTMIME-P0-05F-024-ALLOW-PDF-APPLICATION-PDF
new_mismatch_fixture_ids: EXTMIME-P0-05F-001-BLOCK-CSV-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-002-BLOCK-CSV-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-003-BLOCK-CSV-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-004-BLOCK-CSV-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-005-BLOCK-XLSX-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-006-BLOCK-XLSX-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-007-BLOCK-XLSX-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-008-BLOCK-XLSX-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-010-BLOCK-XLSX-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-011-BLOCK-MD-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-012-BLOCK-MD-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-013-BLOCK-MD-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-014-BLOCK-MD-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-015-BLOCK-TXT-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-016-BLOCK-TXT-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-017-BLOCK-TXT-XLSX-MIME-MISMATCH; EXTMIME-P0-05F-018-BLOCK-TXT-APPLICATION-PDF-MISMATCH; EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH; EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH; EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH; EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH; EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH
xlsx_source_module: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
xlsx_source_fixture_id: XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX
xlsx_exact_export_used: XLSX_ZIP_FIXTURES
xlsx_import_confirmation: P0-05F.2a positive XLSX bytes were imported directly from XLSX_ZIP_FIXTURES and reused unchanged; bytes were not copied, reconstructed, regenerated, or inlined
byte_sources_by_extension: .csv -> EXTMIME-P0-05F-BYTES-CSV-VALID; .xlsx -> XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX imported bytes; .md -> EXTMIME-P0-05F-BYTES-MD-VALID; .txt -> EXTMIME-P0-05F-BYTES-TXT-VALID; .pdf -> EXTMIME-P0-05F-BYTES-PDF-POSITIVE
pdf_positive_identity: deterministic PDF bytes begin with %PDF- at byte offset zero and contain %%EOF within the final 1024 bytes
mismatch_isolation: every new mismatch uses allowed extension metadata, valid bytes for that extension, and varies only declared MIME; no mismatch is malformed, truncated, binary-invalid, or structurally inconsistent
combined_matrix_contribution: P0-05F.2b1 contribution 6; P0-05F.2b2a contribution 24; combined total 30
combined_matrix_expected_results: permitted 7; declared_type_mismatch 23
combined_matrix_key_integrity: duplicate normalized keys 0; missing normalized keys 0; unexpected normalized keys 0
normalization_collapse_result: .CSV -> .csv; Application/CSV -> application/csv; surrounding ASCII whitespace around Text/Plain trims to text/plain; no duplicate or gap created
fixture_integrity: fixture IDs unique across both corpora; all new fixtures synthetic and authority-grounded; XLSX bytes imported unchanged; PDF bytes satisfy committed positive shallow identity; every mismatch uses valid extension bytes and only declared MIME conflicts; no production detector imported; no ZIP entry content decompressed
excluded_scope_confirmation: no unsupported-extension, unsupported-MIME, application/json, application/octet-stream, MIME-parameter, PDF-negative, disallowed-signature, unknown-binary, ambiguous_file_type, production-detector, runtime-MIME, or dependency work added
focused_matrix_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js - 10 passed, 0 failed
existing_text_type_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js - 9 passed, 0 failed
existing_xlsx_zip_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 8 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - new matrix tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 487 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - new matrix tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - 592 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
production_code_changed: false
production_detector_added_or_changed: false
runtime_behavior_changed: false
repository_contract_changed: false
owner_decision_changed: false
dependencies_manifests_lockfiles_changed: false
unsupported_extension_or_mime_work: false
pdf_negative_family_added: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
git_diff_check: passed
git_diff_cached_check: passed
git_diff_cached_stat: inspected
git_diff_cached: inspected before commit
complete_diff_scope: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js, __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js, and this living ExecPlan P0-05F.2b2a evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.2b2a fixture-only package commit; do not implement detectors, runtime MIME allowlist changes, repository contract changes, owner-decision changes, unsupported-extension fixtures, unsupported-MIME fixtures, PDF negative identity fixtures, disallowed-signature fixtures, unknown-binary fixtures, upload lifecycle work, storage retrieval, worker/parser behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.2b2b unsupported extension and declared-MIME rejection fixtures

```text
leaf_status: complete after this fixture-only package commit
p0_05_package_status: unsupported_extension_and_declared_mime_fixture_subcorpus_recorded
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 plus OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1 as preflight authority and prior matrix context
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2b2b fixture-only boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 1b2eba3fd72a58792a1a9eaf1c66e72e61e2fb90
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 and OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
preflight_fixture_process_rules_present: fixture packages graded against frozen owner authority; fixture packages must never modify the contract; discovered contract gap requires stopping for owner decision; contract and fixture changes must not be combined in one implementation commit
preflight_prior_p0_05f_2b1_and_2b2a_matrix_proof: P0-05F.2b1 contributes 6 rows and P0-05F.2b2a contributes 24 rows; combined 30 normalized extension/MIME pairs with duplicate keys 0, missing keys 0, unexpected keys 0
preflight_unsupported_extension_mime_corpus: absent before this package
implemented_fixture_module: __tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js
fixture_count: 18
unsupported_extension_fixture_count: 8
unsupported_declared_mime_fixture_count: 10
unsupported_extension_fixture_ids: UNSUPMETA-P0-05F-001-BLOCK-JSON-EXTENSION; UNSUPMETA-P0-05F-002-BLOCK-HTML-EXTENSION; UNSUPMETA-P0-05F-003-BLOCK-JS-EXTENSION; UNSUPMETA-P0-05F-004-BLOCK-ZIP-EXTENSION-TEXT-BYTES; UNSUPMETA-P0-05F-005-BLOCK-EXE-EXTENSION-TEXT-BYTES; UNSUPMETA-P0-05F-006-BLOCK-BIN-EXTENSION-TEXT-BYTES; UNSUPMETA-P0-05F-007-BLOCK-EMPTY-EXTENSION; UNSUPMETA-P0-05F-008-BLOCK-MISSING-EXTENSION
unsupported_declared_mime_fixture_ids: UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME; UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME; UNSUPMETA-P0-05F-011-BLOCK-TEXT-HTML-MIME; UNSUPMETA-P0-05F-012-BLOCK-TEXT-JAVASCRIPT-MIME; UNSUPMETA-P0-05F-013-BLOCK-APPLICATION-JAVASCRIPT-MIME; UNSUPMETA-P0-05F-014-BLOCK-APPLICATION-ZIP-MIME; UNSUPMETA-P0-05F-015-BLOCK-X-ZIP-COMPRESSED-MIME; UNSUPMETA-P0-05F-016-BLOCK-EMPTY-MIME; UNSUPMETA-P0-05F-017-BLOCK-UNKNOWN-UNLISTED-MIME; UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME
expected_result_all_fixtures: block / unsupported_file_type / unsupported_metadata_block_only
authority_grounding: every outcome cites OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
application_json_fixture: UNSUPMETA-P0-05F-009-BLOCK-APPLICATION-JSON-MIME expects block / unsupported_file_type; policy rejects application/json; current runtime alignment remains unresolved; this fixture does not prove the runtime allowlist was corrected
application_octet_stream_fixture: UNSUPMETA-P0-05F-010-BLOCK-OCTET-STREAM-MIME expects block / unsupported_file_type; application/octet-stream may later be an HTTP transport envelope but is not an accepted declared file MIME
parameterized_mime_fixture: UNSUPMETA-P0-05F-018-BLOCK-TEXT-PLAIN-PARAMETER-MIME expects block / unsupported_file_type; normalized_declared_mime remains text/plain; charset=utf-8 and does not become text/plain
byte_source_used_by_each_fixture_family: unsupported_extension -> EXTMIME-P0-05F-BYTES-TXT-VALID imported from __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js; unsupported_declared_mime -> EXTMIME-P0-05F-BYTES-TXT-VALID imported from __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js
byte_source_identity: all 18 fixtures reuse the exact P0-05F.2b2a TXT Uint8Array object; bytes decode in fatal UTF-8 mode and remain valid for .txt + text/plain
unsupported_extension_isolation: extension unsupported; declared MIME permitted text/plain; bytes valid for selected permitted type .txt + text/plain; no recognized disallowed binary signature; no malformed, truncated, invalid UTF-8, unknown-binary, PDF-negative, or XLSX-negative claim
unsupported_declared_mime_isolation: extension permitted .txt; declared MIME unsupported; bytes valid for extension and selected permitted type .txt + text/plain; no other conflicting signal
zip_exe_bin_extension_bytes: .zip, .exe, and .bin extension fixtures contain valid permitted TXT bytes and do not match ZIP, executable, archive, or unknown-binary bytes/signatures
fixture_integrity: fixture IDs unique; all fixtures synthetic; all outcomes authority-grounded; eight required unsupported-extension cases present; ten required unsupported-MIME cases present; MIME parameters rejected and not stripped; application/json runtime divergence remains open; application/octet-stream blocked as declared MIME
excluded_scope_confirmation: no contract or owner-decision change; no existing corpora or tests modified; no runtime MIME change; no PDF-negative work; no signature or unknown-binary work; no ambiguous_file_type work; no production detector; no dependency
focused_unsupported_metadata_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js - 10 passed, 0 failed
existing_p0_05f_2b1_focused_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js - 9 passed, 0 failed
existing_p0_05f_2b2a_matrix_completeness_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js - 10 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - new unsupported metadata tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 497 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node command
production_code_changed: false
production_detector_added_or_changed: false
runtime_behavior_changed: false
repository_contract_changed: false
owner_decision_changed: false
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
git_diff_check: passed
git_diff_cached_check: passed
git_diff_cached_stat: inspected
git_diff_cached: inspected before commit
complete_diff_scope: __tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js, __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js, and this living ExecPlan P0-05F.2b2b evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.2b2b fixture-only package commit; do not implement detectors, runtime MIME allowlist changes, repository contract changes, owner-decision changes, PDF negative identity fixtures, disallowed-signature fixtures, unknown-binary fixtures, upload lifecycle work, storage retrieval, worker/parser behavior, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.2c PDF shallow-identity fixtures

```text
leaf_status: complete after this fixture-only package commit
p0_05_package_status: pdf_shallow_identity_fixture_subcorpus_recorded
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2c fixture-only boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 93b22258ef87b16763e1092c50c6bc40004848c7
starting_tree: clean
preflight_owner_authority_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
preflight_fixture_process_rules_present: fixture packages graded against frozen owner authority; fixture packages must never modify the contract; discovered contract gap requires stopping for owner decision; contract and fixture changes must not be combined in one implementation commit
preflight_prior_p0_05f_2b2a_pdf_positive_source: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js source identifier EXTMIME-P0-05F-BYTES-PDF-POSITIVE
preflight_prior_p0_05f_2b2b_completion: complete unsupported extension and declared-MIME rejection fixtures
preflight_pdf_shallow_identity_corpus: absent before this package
implemented_fixture_module: __tests__/support/kaiSprint2PdfShallowIdentityFixtureCorpus.js
implemented_integrity_test_file: __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js
fixture_count: 5
positive_fixture_count: 1
malformed_truncated_fixture_count: 4
new_fixture_ids: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF; PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024
positive_fixture_id: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF
malformed_truncated_fixture_ids: PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024
positive_pdf_source_module: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js
positive_pdf_source_identifier: EXTMIME-P0-05F-BYTES-PDF-POSITIVE
positive_pdf_exact_export_property_used: EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes
positive_pdf_object_identity_reuse_result: imported object reused unchanged by PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF
positive_pdf_bytes_import_confirmation: positive PDF bytes were imported directly from P0-05F.2b2a and were not copied, reconstructed, or regenerated
pdf_header_offsets: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF -> 0; PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER -> 1; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX -> -1; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF -> 0; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024 -> 0
pdf_eof_offsets: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF -> [42]; PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER -> [43]; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX -> [41]; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF -> []; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024 -> [42]
pdf_eof_to_end_distances: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF -> [6]; PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER -> [6]; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX -> [6]; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF -> []; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024 -> [1030]
byte_lengths: PDFIDENT-P0-05F-001-ALLOW-MINIMUM-PDF -> 48; PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER -> 49; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX -> 47; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF -> 48; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024 -> 1072
negative_single_identity_condition_violations: PDFIDENT-P0-05F-002-BLOCK-LEADING-BYTE-BEFORE-HEADER violates only offset_zero_header; PDFIDENT-P0-05F-003-BLOCK-TRUNCATED-PDF-PREFIX violates only offset_zero_header; PDFIDENT-P0-05F-004-BLOCK-MISSING-EOF violates only eof_presence; PDFIDENT-P0-05F-005-BLOCK-EOF-OUTSIDE-FINAL-1024 violates only eof_final_1024_window
expected_positive_result: allow / type_agreement_pass / type_agreement_pass_only
expected_negative_result_all_four: block / truncated_or_malformed_type / pdf_shallow_identity_block_only
existing_p0_05f_2b2a_pdf_wrong_mime_fixture_ids: .pdf + text/csv -> EXTMIME-P0-05F-019-BLOCK-PDF-TEXT-CSV-MISMATCH; .pdf + application/csv -> EXTMIME-P0-05F-020-BLOCK-PDF-APPLICATION-CSV-MISMATCH; .pdf + text/markdown -> EXTMIME-P0-05F-021-BLOCK-PDF-TEXT-MARKDOWN-MISMATCH; .pdf + text/plain -> EXTMIME-P0-05F-022-BLOCK-PDF-TEXT-PLAIN-MISMATCH; .pdf + application/vnd.openxmlformats-officedocument.spreadsheetml.sheet -> EXTMIME-P0-05F-023-BLOCK-PDF-XLSX-MIME-MISMATCH
wrong_mime_coverage_status: existing P0-05F.2b2a coverage remains block / declared_type_mismatch; no duplicate P0-05F.2c wrong-MIME fixtures added
cross_type_detected_permitted_type_contradiction_fixture_added: false
cross_type_detected_permitted_type_contradiction_deferral: positive PDF bytes plus an otherwise permitted non-PDF extension/MIME pairing remains deferred to a separate general cross-type owner decision before P0-05F.2d; no category inferred
fixture_integrity: fixture IDs unique; closed fixture schema; all fixtures synthetic and authority-grounded; exact .pdf extension and application/pdf declared MIME; structural proof uses direct raw-byte marker comparisons and byte-offset calculations; positive bytes reuse imported object unchanged; every negative is deterministically derived from the imported source and violates exactly one named PDF shallow-identity condition; no production detector supplies the answer key
excluded_scope_confirmation: no existing corpus or test changed; no contract or owner-decision change; no semantic PDF, encryption, active-content, embedded-file, or text-layer work; no signature-family or unknown-binary work; no production detector; no runtime MIME change; no dependency
focused_pdf_shallow_identity_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js - 10 passed, 0 failed
existing_p0_05f_2b2a_matrix_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js - 10 passed, 0 failed
existing_p0_05f_2b2b_unsupported_metadata_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js - 10 passed, 0 failed
existing_p0_05f_2a_xlsx_zip_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 8 passed, 0 failed
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - new PDF shallow-identity tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 507 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - new PDF shallow-identity tests passed; existing assembled-HTTP localhost listener tests failed with sandbox EPERM
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - 612 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
production_code_changed: false
production_detector_added_or_changed: false
runtime_behavior_changed: false
repository_contract_changed: false
owner_decision_changed: false
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
git_diff_check: passed
git_diff_cached_check: passed
git_diff_cached_stat: inspected
git_diff_cached: inspected before commit
complete_diff_scope: __tests__/support/kaiSprint2PdfShallowIdentityFixtureCorpus.js, __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js, and this living ExecPlan P0-05F.2c evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
```

## P0-05F.1B detected permitted type contradicts declared metadata

```text
leaf_status: complete after this documentation-only owner-decision package commit
p0_05_package_status: detected_permitted_type_contradiction_category_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.1B documentation-only owner-decision boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 259fe75548e990c28e573a65cd05ea470de51e9b
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 and OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
preflight_deterministic_outcome_table_present: true
preflight_completed_p0_05f_2a_xlsx_zip_corpus_present: true
preflight_completed_p0_05f_2c_pdf_shallow_identity_corpus_present: true
preflight_cross_type_contradiction_deferral_present: positive PDF bytes plus otherwise permitted non-PDF extension/MIME remained deferred before this package
preflight_equivalent_general_category_mapping_already_committed: false
production_code_changed: false
tests_fixtures_detectors_changed: false
runtime_behavior_changed: false
runtime_mime_allowlist_changed: false
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
```

`OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1` records that when terminal extension and declared file MIME jointly identify one permitted P0 type, but byte signature and the required minimum structure deterministically establish a different permitted P0 type, the file blocks as `block / declared_type_mismatch`.

This rule applies symmetrically to every naturally reachable permitted-type contradiction. It is not a PDF-specific exception.

`declared_type_mismatch` covers both:

```text
1. terminal extension and declared MIME disagree with each other; and

2. terminal extension and declared MIME agree on one permitted type, but
   deterministic byte signature and required minimum structure establish a
   different permitted type.
```

The jointly declared metadata type does not become authoritative merely because its extension and MIME agree with each other. No signal wins, rewrites, repairs, or reclassifies another signal. The file blocks rather than rewriting the extension, rewriting the declared MIME, reclassifying the file, selecting a fallback type, or accepting because one signal pair agrees.

Non-executable examples:

```text
PDF contradiction
extension: .txt
declared MIME: text/plain
bytes: complete positive PDF shallow identity
  - %PDF- at offset zero
  - %%EOF within the final 1024 bytes
result: block / declared_type_mismatch

XLSX contradiction
extension: .txt
declared MIME: text/plain
bytes: complete positive XLSX shallow identity
  - ZIP local-file-header signature
  - readable EOCD and central directory
  - exact required OOXML entries
result: block / declared_type_mismatch
```

Category exclusions:

```text
unsupported_file_type:
the extension and declared MIME are individually permitted.

truncated_or_malformed_type:
the detected permitted type satisfies its complete committed shallow identity.

disallowed_binary_signature:
the detected type is a permitted P0 type, not MZ, ELF, standalone ZIP, RAR,
7z, gzip, or another recognized disallowed signature.

standalone_archive_or_non_xlsx:
complete XLSX shallow identity is established when the detected type is XLSX.

ambiguous_file_type:
one different permitted byte-established type is deterministically identified;
multiple permitted types do not remain plausible.

unknown_binary:
the bytes are deterministically identified as a permitted PDF or XLSX type.
```

Boundary with disallowed signatures: a recognized disallowed signature continues to block as `disallowed_binary_signature` regardless of permitted extension or declared MIME. `declared_type_mismatch` is not broadened to absorb MZ, ELF, standalone ZIP, RAR 4, RAR 5, 7z, gzip, or unknown binary cases. This decision applies only where the byte-established type is itself a permitted P0 type and its complete committed shallow identity is satisfied.

Text-family boundary: CSV, MD, and TXT have no unique reliable byte signature under the committed P0-05F gate. This package does not invent byte-level cross-type distinction among CSV, MD, and TXT. Their permitted subtype remains selected through the committed extension/MIME matrix plus strict text-byte validation.

```text
tests_run: not run; no existing directly affected static verifier was identified that validates this new authority text
git_diff_check: passed after edit
git_diff_cached_check: passed after staging
git_diff_cached_stat: inspected after staging
git_diff_cached: inspected before commit
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.1B documentation-only package commit; do not implement fixtures, tests, detectors, runtime MIME allowlist changes, routes, storage or upload behavior, manifests, lockfiles, Current State, Implementation Baseline, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05F.2d0 detected permitted-type contradiction fixtures

```text
p0_05_package_status: completed
implementation_status: fixture_only
verification_status: TOOL_VERIFIED after documented checks passed
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2d0 fixture-only boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: c58869d9bc18e41e1c54009f65c1c98ea183e6df
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1, OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1, and OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
preflight_completed_p0_05f_2a_xlsx_zip_corpus_present: true
preflight_completed_p0_05f_2c_pdf_shallow_identity_corpus_present: true
preflight_detected_permitted_type_contradiction_corpus_present: false
fixture_corpus: __tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js
focused_structural_integrity_test: __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js
fixture_count: 2
fixture_ids: DETPERMTYPE-P0-05F-2D0-001-BLOCK-TXT-TEXT-PLAIN-PDF-BYTES; DETPERMTYPE-P0-05F-2D0-002-BLOCK-TXT-TEXT-PLAIN-XLSX-BYTES
metadata_pairing_for_both_fixtures: .txt plus text/plain
metadata_pairing_independently_permitted: true
extension_and_mime_agree_for_both_fixtures: true
jointly_declared_metadata_type_for_both_fixtures: text
detected_byte_established_types: PDF and XLSX
detected_types_permitted: true
declared_type_differs_from_detected_type_for_both_fixtures: true
expected_policy_for_both_fixtures: block
expected_category_for_both_fixtures: declared_type_mismatch
scope_note_for_both_fixtures: detected_permitted_type_contradiction_only
pdf_source_module: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js
pdf_source_export_property: EXTENSION_MIME_MATRIX_BYTE_SOURCES[".pdf"].bytes
pdf_object_identity_reuse: true
pdf_header_offset: 0
pdf_eof_offset: 42
pdf_eof_distance_from_end: 6
pdf_complete_shallow_identity: true
xlsx_source_module: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
xlsx_source_fixture_id: XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX
xlsx_source_export_property: XLSX_ZIP_FIXTURES fixture bytes
xlsx_object_identity_reuse: true
xlsx_zip_local_file_header_prefix_present: true
xlsx_eocd_readable: true
xlsx_eocd_offset: 318
xlsx_central_directory_bounds_valid: true
xlsx_central_directory_offset: 135
xlsx_central_directory_length: 183
xlsx_central_directory_end: 318
xlsx_central_directory_record_boundaries_valid: true
xlsx_entry_count_valid: true
xlsx_expected_entry_count: 3
xlsx_parsed_entry_count: 3
xlsx_local_header_offsets_valid: true
xlsx_local_header_offsets: 0, 49, 90
xlsx_required_central_directory_entries: [Content_Types].xml; _rels/.rels; xl/workbook.xml
xlsx_identity_proof_method: parsed EOCD and central-directory records; no raw-buffer string search, decompression, XML parsing, filesystem access, external ZIP utilities, or production detector output
xlsx_complete_identity_prevents_standalone_zip_or_disallowed_signature_classification: true
classification_exclusions_for_both_fixtures: unsupported_file_type=false; truncated_or_malformed_type=false; disallowed_binary_signature=false; standalone_archive_or_non_xlsx=false; ambiguous_file_type=false; unknown_binary=false
byte_source_copy_reconstruction_regeneration: none
existing_corpora_or_tests_changed: false
contract_or_owner_decision_changed: false
production_detector_changed: false
runtime_mime_allowlist_changed: false
dependencies_or_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
focused_p0_05f_2d0_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js - 5 passed, 0 failed
existing_p0_05f_2c_pdf_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js - 10 passed, 0 failed
existing_p0_05f_2a_xlsx_zip_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 8 passed, 0 failed
existing_p0_05f_2b2a_matrix_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js - 10 passed, 0 failed
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - 512 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - 617 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
git_diff_check: passed after edit
complete_diff_inspection: TOOL_VERIFIED
complete_diff_scope: __tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js, __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js, and this living ExecPlan P0-05F.2d0 evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
```

## Prompt-injection boundary

Add synthetic fixtures containing instruction-like text.

The assessor:

* treats file bytes as data;
* does not execute instructions;
* does not change policy because uploaded content requests it;
* does not call an LLM;
* does not create approval, evidence, claims, or generated output.

## Asynchronous execution

Use:

```text
confirmed exact object version
→ processing_status remains quarantined
→ parse_status remains quarantined
→ file_policy_status remains pending
→ bounded security executor
→ file_policy_status becomes passed, blocked, or failed
```

Do not introduce a new enum without Gate A.

## Internal executor authority

Before implementation, add one explicit security-executor identity and operation group to the controlling P0 operation-to-role matrix. Define its tenant rules and exact allowed writes. It must be explicitly distinct from denied generic `system` and `ai` actors.

The security executor may perform only:

* recording security results;
* marking file policy passed, blocked, or failed;
* writing metadata-only audit.

It cannot:

* change tenant;
* approve review;
* profile files;
* create sources;
* create evidence or claims;
* expose raw content;
* invoke arbitrary service operations.

AI actors and generic system actors remain denied.

## Malware adapter

* Production adapter is unavailable/fail-closed by default.
* Test adapter recognizes only known synthetic fixtures.
* Production cannot select the test adapter.
* A clean result records safe provenance metadata.
* No scanner means no policy pass.

## Formula injection

Implement pure detection and output-context-specific neutralization helpers.

Detection tests must cover values beginning with `=`, `+`, `-`, `@`, tab, carriage return, line feed, and relevant full-width variants that a consuming spreadsheet application can interpret as formula triggers.

Do not mutate the raw file.

No P0 preview, assistant, or export path renders raw cells.

## Completion

A security pass changes only `file_policy_status`.

The file remains quarantined and unparsed.

---

# P0-06A — Repository-safe local fallback transport and confirmation contract

## Scope boundary

P0-06A may implement transport interfaces, route/service orchestration, local test storage, validators, abuse and timeout controls, immutable object-version behavior, confirmation logic, and synthetic tests without a schema change.

The production/database-backed lifecycle repository binding remains disabled and fail-closed. It must not be mounted as live upload behavior until P0-06B is authorized under Gate A and the required persistence is verified.

## Route decision

Inspect existing repository upload and body-parser conventions. Use an existing secure convention when present. Otherwise use:

```text
POST /files/:id/upload
Content-Type: application/octet-stream
```

The body contains file bytes only. No filename, organization, batch, provider, path, bucket, object key, or arbitrary metadata is accepted in the body.

## Upload controls

* Require both feature gates.
* Reauthorize actor, role, membership, organization, engagement, batch, and file.
* Apply CSRF/origin protection appropriate to the inspected authentication model.
* Ensure no earlier body parser consumes the stream.
* Stream with backpressure and enforce the 25 MB limit from actual received bytes.
* Apply a 30-second idle timeout and 270-second total timeout with deterministic abort semantics.
* Apply 120 mutation attempts per actor and 600 per organization per 15 minutes.
* Enforce at most 2 concurrent uploads per actor and 5 per organization.
* Count failed attempts when a safe limiter key can be derived.
* Reject multiple or repeated writes.
* Use exclusive, write-once local object creation.
* Generate an immutable provider-neutral local object-version token.
* Abort and remove only incomplete test-local state on failure.
* Never log raw bytes.
* Keep the local adapter test/dev-only and dependency-injected.
* Make production selection of the local adapter and database-backed upload repository fail closed.

## Concurrent-upload permit contract

The local single-process test implementation must model separate actor and organization permits with bounded leases. It must prove:

* both actor and organization permits are acquired before accepting bytes;
* partial acquisition is rolled back;
* permits are released after success, validation failure, timeout, and aborted streams;
* an expired lease can be recovered after a simulated worker failure;
* counters never become negative;
* exhaustion at either scope returns the canonical safe 429 response;
* production or multi-process selection remains fail-closed without a shared atomic coordination store.

Do not select Redis or any other production coordination provider under this package.

## Local filesystem controls when disk-backed

* private test root outside webroot;
* server-generated paths only;
* no symlink following;
* exclusive file creation;
* normalized object keys;
* test-scoped teardown only.

## Confirmation contract

Using the in-memory synthetic lifecycle repository, confirmation must:

1. reauthorize;
2. load the expected exact object version;
3. verify existence and stored size;
4. read declared Content-Type without treating it as authoritative;
5. stream the exact object version;
6. independently compute SHA-256;
7. compare with the declared canonical checksum;
8. reject replaced or changed versions;
9. persist the synthetic `confirmed` state, verified version, checksum state, and timestamp through the repository interface;
10. leave processing and parsing quarantined;
11. enqueue the bounded security assessment through the authorized internal executor interface;
12. write metadata-only audit;
13. return a sanitized pending-policy response.

Identical confirmation replay is allowed only for the same exact version, size, checksum, and state. A changed version returns 409.

## Synthetic lifecycle behavior

The in-memory repository implements the exact P0-02 lifecycle and 24-hour expiry for tests:

```text
reserved
upload_started
uploaded_unconfirmed
confirmed
policy_blocked
abandoned
expired
```

No lifecycle transition performs deletion or retention. No database schema compatibility is claimed.

## P0-06A completion

May establish:

```text
P0_LOCAL_UPLOAD_CONTRACT_COMPLETE
P0_LOCAL_LIFECYCLE_SYNTHETICALLY_VERIFIED
```

May not establish:

```text
P0_DATABASE_UPLOAD_LIFECYCLE_VERIFIED
P0_LIVE_UPLOAD_READY
```

---

# P0-06B — Persistent upload lifecycle integration — Gate A

P0-06B is not authorized by this plan. It requires Gate A because the inspected repository does not provide the complete durable lifecycle mapping.

After separate Gate A authorization, inspect the actual target schema and map existing exact equivalents where available. Add only missing persistence required by the P0-02 contract, including:

```text
upload_state
upload_state_changed_at
upload_expires_at
provider-neutral immutable object-version identity
verified checksum state
verified checksum timestamp
```

The persistent repository must enforce allowed transitions, immutable version confirmation, 24-hour expiry before confirmation, replay behavior, tenant predicates, transaction/audit rules, and no destructive cleanup. Any migration follows the full Gate A package and verification requirements.

---

# P0-07 — Local synthetic HTTP acceptance

## Composition

Use:

* an ephemeral real HTTP listener;
* real feature-gate middleware;
* production-equivalent local authentication adapter behavior using deterministic fixtures and no external identity provider, session service, database, or network dependency;
* real router;
* real services and validators;
* in-memory repositories implementing the P0-02 contract and synthetic upload lifecycle;
* local storage adapter;
* test-only malware adapter;
* captured safe logger, audit, and metrics interfaces;
* deterministic clock, UUIDs, and request IDs.

Do not import a production process that contacts external systems.

## Positive path

```text
feature enabled
→ authenticated mapped human
→ allowed role and active membership
→ batch create
→ idempotent replay
→ file reserve
→ local streamed upload
→ immutable version
→ confirm exact version
→ compute SHA-256
→ policy pending
→ bounded security assessment
→ file policy passed
→ file remains quarantined
→ sanitized operator read
→ review transition
```

## Negative proof

Include:

* feature disabled;
* invalid mapping;
* wrong role;
* inactive membership;
* cross-tenant IDs;
* unbounded list attempts;
* 26th file;
* mocked concurrent reservations;
* actor and organization mutation-limit exhaustion;
* actor and organization concurrent-upload exhaustion;
* expired and explicitly abandoned reservations;
* malformed fingerprint;
* unknown metadata fields;
* request-body over-limit;
* unsafe Unicode filename;
* path traversal;
* oversize streamed body;
* slow/aborted stream;
* duplicate write;
* MIME/signature mismatch;
* binary TXT/MD;
* arbitrary archive;
* XLSX path traversal or expansion bomb;
* macros/external relationships;
* encrypted PDF/XLSX;
* PDF active content or embedded file;
* uploaded prompt-injection text;
* formula cells reaching no output;
* missing object;
* replaced object version;
* checksum mismatch;
* stale review transition;
* required-audit failure rollback at repository-interface level;
* telemetry failure not rolling back an authorized mutation;
* AI mutation;
* generic system mutation;
* unauthorized internal-executor operation;
* parser/profile/source/evidence/claim/generation/export attempt;
* storage identifier leakage;
* raw content in logs, errors, audit, metrics, or responses.

## Verification commands

Add repository-defined commands for:

```text
verify:kai-sprint2-schema-contract
verify:kai-sprint2-api-contract
test:kai-sprint2
test:kai-sprint2-p0-acceptance
```

Then run:

```text
npm run verify:kai-sprint2-schema-contract
npm run verify:kai-sprint2-api-contract
npm run test:kai-sprint2
npm run test:kai-sprint2-p0-acceptance
npm test
git diff --check
```

## Completion states

The final authorized result must be described as:

```text
P0 repository contract complete
P0 local synthetic acceptance passed
Persistent lifecycle integration pending Gate A
```

Do not describe the result merely as `P0 complete`. Completion through this package is synthetic and repository-local.

May establish:

```text
P0_CODE_CONTRACT_COMPLETE
P0_LOCAL_SYNTHETIC_HTTP_ACCEPTANCE_PASS
P0_LOCAL_UPLOAD_CONTRACT_COMPLETE
```

May not establish:

```text
P0_DATABASE_INTEGRATION_VERIFIED
P0_DATABASE_UPLOAD_LIFECYCLE_VERIFIED
P0_NONPRODUCTION_STORAGE_VERIFIED
P0_LIVE_UPLOAD_READY
REAL_CLIENT_DATA_READY
```

The P0-07 report must also include:

```text
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
```

---

# Gate A — Isolated PostgreSQL integration

Requires explicit authorization.

## Required migration package

Before execution, prepare:

1. forward migration;
2. deterministic verification SQL;
3. rollback draft;
4. synthetic smoke seed;
5. smoke verification;
6. read-only failure checks;
7. patch notes;
8. runbook.

## Authorized target

Use only:

* an ephemeral local PostgreSQL instance; or
* an explicitly named non-production database;
* synthetic fixtures;
* the approved migration;
* no production/client data.

Record PostgreSQL version.

## Verification

* actual SQL syntax;
* DDL vocabulary;
* unique indexes;
* foreign keys and checks;
* canonical checksum column;
* durable upload-state column or verified exact equivalent;
* upload-state change and expiry timestamps;
* immutable provider-neutral object-version identity;
* verified checksum state and timestamp;
* fingerprint compatibility;
* existing-row handling;
* two-session identical replay;
* two-session conflicting replay;
* 25-file concurrent limit;
* locking behavior;
* `ON CONFLICT`;
* transaction rollback;
* audit atomicity;
* organization predicates;
* persistent upload lifecycle transitions, replay, 24-hour expiry, and no destructive cleanup;
* single-result-set verifiers.

Only this gate may establish:

```text
P0_DATABASE_INTEGRATION_VERIFIED
```

---

# Gate B — Non-production Canadian GCS

Requires explicit authorization.

## Storage posture

* non-production Canada-resident bucket;
* public access prevention;
* uniform bucket-level access;
* least-privilege IAM;
* no object ACLs;
* no public or CDN raw delivery;
* no sensitive object names or metadata;
* approved keyless signing mechanism where available;
* no committed or printed credentials.

## Signed upload choice

Test the contract-preferred direct-upload architecture.

Use one of:

1. V4 signed PUT with:

   * exact object;
   * exact method;
   * short expiry;
   * signed Content-Type;
   * signed or otherwise enforced size;
   * create-only generation precondition;

2. a signed upload policy with an enforced content-length range, only after explicit contract acceptance.

Do not select an option until the enforcement behavior has been demonstrated in non-production.

## Integrity and immutability

* create-only generation precondition;
* persist object generation;
* bind HEAD/read/hash to that generation;
* validate CRC32C for transfer integrity;
* independently compute KAI SHA-256 for identity;
* reject overwritten or different generations;
* no signed URL or session URI in logs.

## Additional controls

* strict browser CORS;
* malware service;
* safe metadata;
* audit logs;
* monitoring and alerts;
* lifecycle posture;
* no destructive lifecycle rule without separate authorization;
* rollback and disablement.

Only this gate may establish:

```text
P0_NONPRODUCTION_STORAGE_VERIFIED
```

---

# Gate C — Staging and live-upload readiness

Requires explicit authorization.

Verify:

* deployed schema compatibility;
* staging application commit;
* feature flags disabled by default;
* synthetic tenant allowlist;
* signed upload;
* expiry and replay behavior;
* object generation;
* confirmation;
* security assessment;
* malware result;
* operator review;
* safe logs and metrics;
* alerting;
* rollback;
* no P1/P2/P3 activation.

Only an explicit enablement decision may establish:

```text
P0_LIVE_UPLOAD_READY
```

---

# Gate D — Real-client-data readiness

Real data remains blocked until all operating-model requirements are accepted and verified:

* DPA and terms;
* client ownership and processor role;
* subprocessor list;
* Canada-only raw-file storage in the contract-selected GCS location; for database, backups, logs, runtime, workers, support paths, and other processors, document the actual data location and apply any stricter contractual, client, provincial, sectoral, or qualified legal requirement. PIPEDA accountability continues for permitted cross-border processing and does not by itself establish a blanket domestic-only rule;
* private storage;
* retention schedule;
* legal hold;
* deletion and offboarding;
* documented incident-response procedure meeting applicable contractual and legal obligations; a completed exercise is an additional owner-selected gate only when explicitly accepted and recorded;
* malware and security operations;
* allowed-use and consent controls;
* human review ownership;
* no unauthorized model training;
* no cross-client reuse;
* no assistant raw-file access;
* schema and synthetic smoke verification;
* operational monitoring and support access rules.

Only explicit owner acceptance may establish:

```text
REAL_CLIENT_DATA_READY
```

---

# Evidence produced after each package

After each coherent package, repository tooling returns one compact package result containing:

```text
package:
starting_head:
ending_head:
working_tree_status:
files_inspected:
files_changed:
behavior_changed:
behavior_intentionally_unchanged:
targeted_tests:
broader_tests:
diff_check:
commit:
limitations:
prohibited_actions_not_performed:
next_package_or_stop_condition:
```

Unknown values remain `NOT_CONFIRMED`. A package result does not update Current State automatically. Project-chat review is not required between ordinary packages except for the single first-write milestone checkpoint after P0-01.

# Current State update boundary

Do not update `00_KAI_CURRENT_STATE.md` for plan acceptance, repository installation, ordinary packages, tests, diffs, commits, pushes, endpoints, validators, or other reversible work. A state update requires an explicit owner request and acceptance of an enabled-behavior phase change, production/database baseline change, durable blocker/restriction change, or frozen repository anchor.

# Execution behavior

The approved executable order is:

```text
Phase 0-D
Phase 1 state recheck; full rerun only if material repository state changed
P0-02
P0-01
FIRST-WRITE MILESTONE CHECKPOINT — stop and report before P0-03
P0-03 repository-safe portion
P0-04
P0-05
P0-06A
P0-07
```

Phase 0-A through 0-C remain manual owner actions and are not repository execution packages. P0-06B and Gates A through D are not authorized.

Define coherent, reviewable package boundaries before implementation. For each package:

```text
inspect the relevant implementation
→ implement one or more bounded leaf changes within that package
→ run focused tests
→ run required broader tests
→ inspect the complete diff
→ create one or more coherent commits
→ update the ExecPlan once at package completion
→ continue within approved scope, except stop after P0-01 for the single first-write milestone checkpoint
```

Do not return to the ChatGPT Project after ordinary commits.

Stop only for:

* a required exact repository contract value not defined by P0-02 or a later explicit owner decision;
* a genuine contract decision;
* new dependency approval;
* executable schema or database authorization, including P0-06B;
* cloud, credential, deployment, or feature authorization;
* destructive action;
* production or tenant configuration;
* real-data authorization;
* an invalidated plan;
* a blocking test result that cannot be resolved within scope;
* completion of P0-01, for the single first-write milestone checkpoint;
* completion of P0-07.

Do not update `00_KAI_CURRENT_STATE.md` automatically.


---

# Living execution record

## Phase 0-D — local repository authority installation

```text
package_status: complete
implementation_status: complete
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: 1b41a3d644e1afd811ad87162f25c15a08d51b39
branch: codex/kai-sprint2-p0-v0.3.5
state_recheck: expected root, main branch, exact expected HEAD, clean tracked and untracked state, and no repository-scoped AGENTS.md confirmed before branch creation
repository_guidance: root AGENTS.md installed
living_execplan: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md installed
focused_tests: npm run test:kai-sprint2-pass2 — 89 passed, 0 failed
broader_tests: node --test __tests__/kai-sprint2-*.spec.js — 205 passed, 0 failed; npm test — 310 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL used for every Node and npm command
runtime_behavior_changed: false
repository_install_commit: TOOL_VERIFIED cea4583daa9b034acc206d97c92e07bcff6516a2
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_access: not performed
cloud_access: not performed
next_package: P0-02
```

## P0-02 — repository schema and behavior contract

```text
package_status: complete
implementation_status: complete
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: cea4583daa9b034acc206d97c92e07bcff6516a2
repository_contract: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md
runtime_constants: Backend/kai/config/kaiSprint2P0Contract.js
contract_version: 0.3.5
checksum_contract: exact 64 hexadecimal input, lowercase canonical checksum, hash_algorithm sha256
static_verifier_alignment: executable prewrite verifier requires checksum and contains no checksum_sha256 requirement
security_executor_identity: kai_file_security_executor defined as disabled internal_service contract
focused_verification: npm run verify:kai-sprint2-schema-contract — 8 passed, 0 failed
affected_tests: 110 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 89 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 213 passed, 0 failed
full_tests: npm test — 318 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL used for every Node and npm command
executable_schema_change: none
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
database_access: not performed
cloud_access: not performed
package_commit: TOOL_VERIFIED 87637525904650e482fdf12562305738905ee6f0
next_package: P0-01
```

## P0-01 — foundation truth and response safety

```text
package_status: complete
implementation_status: complete
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: 87637525904650e482fdf12562305738905ee6f0
canonical_service: mounted and barrel-exported Backend/kai/services/kaiIntakeService.js
feature_gate_order: auth preflight and metadata routes require KAI_SPRINT2_ENABLED before authentication or service execution
status_truth: metadata_write_enabled true; upload, confirmation, storage, signed URL, parser, profiling, dictionary, source, evidence, claim, generation, export, and client review capabilities false
request_safety: 100 KiB route parser before the global parser; JSON depth 4; total keys 64; route allowlists; unknown fields, unlisted arrays, invalid UUIDs, unsupported media, malformed JSON, and oversized bodies rejected
response_safety: canonical KAI authentication and error envelopes; internal audit context and private storage identifiers omitted; unexpected failures reduced to generic system_error
abuse_controls: separate actor 120 and organization 600 mutation-attempt limits per 15 minutes with canonical 429, Retry-After, and rate-limit headers
mutation_authority: assistant, ai, generic system, and disabled internal-service identities cannot invoke metadata write dependencies
upload_flags: fail-closed KAI_FILE_UPLOAD_ENABLED; upload URL and confirmation require both upload and Sprint 2 flags and remain storage-disabled
verifier_identifiers: operational organization, engagement, batch, and idempotency identifiers parameterized; no verifier execution performed
focused_tests: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_tests: npm run verify:kai-sprint2-schema-contract — 8 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 89 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 227 passed, 0 failed
legacy_kai_tests: 45 passed, 0 failed
full_tests: npm test — 332 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL used for every Node and npm command
local_http_test: ephemeral 127.0.0.1 listener used only for parser response verification
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
distributed_abuse_coordination: NOT_CONFIRMED; current limiter is single-process memory only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: FIRST-WRITE MILESTONE CHECKPOINT — stop before P0-03
```

## P0-03 — tenant-scoped batch lookup hardening (first bounded leaf)

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: fb7970cd21f1ef6e7140dc12297a3c704f9890ad
tenant_query_scope: getIntakeBatchTenantState requires intake_batch_id and organization_id and predicates the batch read on both values
service_boundary: reserveIntakeFileMetadata supplies organization_id to the batch lookup and retains post-read tenant validation as defense in depth
cross_tenant_behavior: matching organization lookup returns the row; a different organization receives no row and the service retains its safe not_found path
focused_tests: node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js — 43 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 229 passed, 0 failed
full_tests: npm test — 334 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL used for every Node and npm command
local_http_test: existing parser test used an ephemeral 127.0.0.1 listener; sandbox-denied attempts were rerun in the localhost-capable execution context
fingerprints_transactions_audit_metrics_routes_schema: intentionally unchanged
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after the first bounded P0-03 leaf
```

## P0-03 — stored-fingerprint fail-closed hardening (second bounded leaf)

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: a58634bf0496996b283b358dc0ca9c485f0b743b
persisted_representation: normalized_payload_hash and reservation_payload_hash remain bare 64-character lowercase SHA-256 hexadecimal digests
persisted_version_discriminator: absent
installed_fingerprint_version: kai-sprint2-p0-fingerprint-v1 is the only supported P0 version
canonical_hash_input: installed version identifier does not participate; algorithm and canonical fields intentionally unchanged
replay_fail_closed: missing, null, empty, non-string, wrong-length, non-hexadecimal, uppercase, or different stored fingerprints return the existing duplicate_conflict 409 without regeneration, normalization, repair, acceptance, or overwrite
behavior_preserved: valid identical batch and file-reservation replays succeed; different valid payload fingerprints retain duplicate_conflict 409 behavior
unsupported_version_detection: not currently possible without a persisted discriminator; deferred to Gate A
second_version_constraint: prohibited until persisted-version compatibility is resolved
focused_tests: node --test __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js — 58 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 245 passed, 0 failed
full_tests: npm test — 350 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
local_http_test: complete Sprint 2 and npm suites used the existing parser test's ephemeral 127.0.0.1 listener in the localhost-capable execution context after the default sandbox denied listen with EPERM
database_access: not performed
cloud_or_external_network_access: not performed
fingerprint_storage_version_encoding_sql_schema_transactions_audit_metrics_routes_tenant_queries: intentionally unchanged
feature_or_tenant_configuration_change: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after the stored-fingerprint bounded leaf
```

## P0-03 — transaction-interface definition (third bounded leaf)

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: 78887d2e874bc23f91acf0c34654c91abf455759
authoritative_transaction_interface: existing Backend/kai/db/kaiDb.js withTransaction(callback) reused; no competing abstraction created
callback_scope: callback receives exactly one opaque transaction context and successful completion commits and returns its result
failure_scope: synchronous throw and rejected promise both roll back and preserve the callback failure
context_consistency: deterministic fake mutation persistence and required-audit persistence receive the same context object unchanged
transaction_provider_seam: optional provider injection exists only for deterministic adapter contract tests; runtime callers retain the callback-only form
metrics_boundary: best-effort metrics are absent from the transaction interface, run after commit, and deterministic failure does not cause rollback
runtime_wiring: batch creation, file reservation, audit, and metrics are intentionally not wired to the interface
focused_tests: node --test __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-api-contract.spec.js — 27 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 250 passed, 0 failed
full_tests: npm test — 355 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
local_http_test: complete Sprint 2 and npm suites used the existing parser test's ephemeral 127.0.0.1 listener in the localhost-capable execution context after the default sandbox denied listen with EPERM
sql_routes_schema_fingerprints_tenant_queries_runtime_mutation_orchestration: intentionally unchanged
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after the transaction-interface bounded leaf
```

## P0-03 — required-audit versus best-effort-metrics orchestration (fourth bounded leaf)

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: ed60a6847eb238637edadf4020bcd4321b734cec
authoritative_transaction_interface: existing Backend/kai/db/kaiDb.js withTransaction(callback) reused unchanged; no competing transaction abstraction created
repository_neutral_orchestration: Backend/kai/services/kaiMutationOrchestration.js coordinates injected mutation persistence, required-audit persistence, and optional best-effort metric emission
transaction_context: mutation persistence and required-audit persistence receive the same opaque transaction context object unchanged
required_audit_boundary: audit persistence must confirm ok true; a thrown, rejected, skipped, or non-confirming required audit fails the transaction and rolls back the mutation
metrics_boundary: metrics run only after successful transaction completion; mutation or required-audit failure suppresses metrics; metric failure cannot roll back or replace the successful mutation result
production_transaction_call: orchestration calls withTransaction(callback) without a transaction provider
deterministic_test_seam: existing optional provider seam is reachable only through the explicitly named testOnlyTransactionProvider option in fake/in-memory tests
metadata_safety: required audit and best-effort metrics use separate frozen scalar allowlists and field normalizers; metrics exclude organization, engagement, object, request, and route identifiers
forbidden_payload_proof: raw content, parsed rows, prompt text, storage bucket/object/URI identifiers, unrestricted actor/session/membership data, and unapproved PII are excluded from audit and metric payloads
runtime_wiring: real batch creation, file reservation, audit repositories, and metric emitters are intentionally not wired
focused_tests: node --test __tests__/kai-sprint2-mutation-orchestration.spec.js __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-api-contract.spec.js — 32 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 255 passed, 0 failed
full_tests: npm test — 360 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
local_http_test: complete Sprint 2 and npm suites used the existing parser test's ephemeral 127.0.0.1 listener in the localhost-capable execution context after the default sandbox denied listen with EPERM
kaiDb_sql_routes_schema_fingerprints_tenant_queries_existing_runtime_mutations: intentionally unchanged
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after the required-audit versus best-effort-metrics orchestration bounded leaf
```

## P0-03 — required-audit versus best-effort-metrics orchestration boundary correction

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
starting_head: 52904658a3ba190b3b21057f6c880fd10e61e4ec
correction_scope: existing required-audit versus best-effort-metrics orchestration leaf only
production_composition_root: absent and not introduced
production_barrel_boundary: complete orchestration export block removed from Backend/kai/index.js; no orchestration or test-support symbol is exported from a production barrel
root_index_classification: repository-root index.js is the live Express application entry point and is not a barrel; it does not import, call, wire, export, or re-export the orchestration core or test harness
internal_core_location: Backend/kai/internal/kaiMutationOrchestration.js
test_harness_location: __tests__/support/kaiMutationOrchestrationTestHarness.js
repository_boundary_enforcement: repository structure plus deterministic static test; JavaScript direct-file imports are not technically impossible
core_importers: __tests__/support/kaiMutationOrchestrationTestHarness.js only
test_harness_importers: __tests__/kai-sprint2-mutation-orchestration.spec.js and __tests__/kai-sprint2-transaction-interface.spec.js only
unexpected_production_importers_callers_exports_reexports: none
transaction_provider_usage: concrete optional provider seam remains unchanged in Backend/kai/db/kaiDb.js; deterministic provider construction and use occur only in explicit test support
required_audit_success_predicate: non-array object with an own ok data descriptor whose value is exactly boolean true
required_audit_fail_closed: null, undefined, primitives, functions, arrays including own ok true, missing/false/non-boolean/inherited/accessor ok, and malformed or synthetic results roll back; descriptor inspection errors fail the transaction
transaction_context: mutation and required-audit persistence receive the identical opaque transaction context
metrics_boundary: metrics run only after successful transaction completion; mutation or required-audit failure suppresses metrics; metric failure cannot replace the successful mutation result
runtime_wiring: no mounted route, batch-creation path, file-reservation path, production service, production entry point, or other live mutation caller imports or calls the core or test harness
focused_tests: node --test __tests__/kai-sprint2-mutation-orchestration.spec.js __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-orchestration-boundary.spec.js — 36 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 281 passed, 0 failed
full_tests: npm test — 386 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
local_http_test: complete Sprint 2 and npm suites used the existing parser test's ephemeral 127.0.0.1 listener in the localhost-capable execution context after the default sandbox denied listen with EPERM
kaiDb_sql_schema_tenant_queries_fingerprints_audit_persistence_metrics_persistence_routes_existing_runtime_mutations: intentionally unchanged
repository_contract_change: not required; inspected contract text does not contradict the corrected boundary
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
remaining_p0_03_items: unchanged and not implemented in this correction package
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this orchestration-boundary correction package
```

## P0-03 — batch-creation write-time idempotency-conflict recovery

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_head: 25d87517c030fae5760dd01803cad508a8d3658c
conflict_signal: Backend/kai/internal/kaiIdempotentWriteConflict.js exact-identity frozen singleton Error
conflict_signal_semantics: internal repository-neutral idempotent-write-conflict signal; no database code, constraint, index, message, truthiness, or shape classification
signal_importers: Backend/kai/services/kaiIntakeService.js and __tests__/kai-sprint2-batch-idempotency-conflict.spec.js only
batch_lookup_dependency: existing findIntakeBatchByIdempotencyKey dependency used before insert and once after the exact conflict signal
batch_lookup_scope: organizationId plus explicit create_intake_batch operation plus idempotencyKey; the same frozen lookup input is used for both calls
insert_attempts_after_initial_miss: exactly one
conflict_rereads: at most one
conflict_replay: valid current-format matching fingerprint returns the existing responseBatch replay DTO and audit context
conflict_fail_closed: no row or missing, malformed, or different stored fingerprint returns the existing duplicate_conflict response
failure_preservation: unrelated insert errors, initial lookup failures, and conflict re-read failures propagate as their identical original failures
file_reservation_behavior: unchanged; it does not classify or recover the batch conflict signal
production_barrel_or_route_exposure: none
repository_contract_change: narrow internal-signal semantics and Gate A limitations recorded
live_sql_adapter_mapping: none; no adapter is claimed to emit the signal
postgresql_constraints_two_session_proof_atomicity: Gate A dependent and not implemented or verified
deployed_kai_schema_compatibility: NOT_CONFIRMED
targeted_tests: node --test __tests__/kai-sprint2-batch-idempotency-conflict.spec.js __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js — 69 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 292 passed, 0 failed after the existing parser listener's sandbox-denied EPERM was rerun with localhost-listener permission
full_tests: npm test — 397 passed, 0 failed
git_diff_check: passed before the single ExecPlan completion update and rerun afterward against the final package diff
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
sql_routes_http_contracts_transactions_audit_metrics_fingerprints_file_reservation: intentionally unchanged
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this batch-only bounded leaf
```

## P0-03 — file-reservation write-time idempotency-conflict recovery

```text
leaf_status: complete
p0_03_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_head: 39958a5a338657ccca94528cc1e41694f429451a
working_tree_precheck: branch codex/kai-sprint2-p0-v0.3.5 and starting HEAD verified; four intended tracked modifications and one intended focused test only; no unrelated file changed
conflict_signal: Backend/kai/internal/kaiIdempotentWriteConflict.js exact-identity frozen singleton Error shared with batch creation
conflict_signal_semantics: internal repository-neutral idempotent-write-conflict signal; no database code, constraint, index, message, truthiness, or shape classification
signal_importers: Backend/kai/services/kaiIntakeService.js, __tests__/kai-sprint2-batch-idempotency-conflict.spec.js, and __tests__/kai-sprint2-file-idempotency-conflict.spec.js only
file_lookup_dependency: existing findIntakeFileReservationByIdempotencyKey dependency used before checksum lookup and insert and once after the exact conflict signal
file_lookup_scope: one frozen object containing organizationId, explicit reserve_intake_file_metadata operation, engagementId, intakeBatchId, and idempotencyKey; the same object identity is used for both calls
lookup_checksum_insert_order: initial idempotency lookup, declared-checksum lookup, one insert attempt, then one conflict re-read
insert_attempts_after_initial_miss: exactly one
conflict_rereads: at most one
conflict_replay: valid current-format matching file_metadata.reservation_payload_hash returns the existing responseFile replay DTO and audit context
conflict_fail_closed: no row or missing, null, empty, non-string, wrong-length, non-hexadecimal, uppercase, or different valid stored reservation_payload_hash returns the existing duplicate_conflict 409 response
failure_preservation: unrelated signal-shaped insert errors, initial idempotency lookup failures, checksum lookup failures, and conflict re-read failures propagate as their identical original failures
batch_creation_behavior: preserved and covered by the focused and broader suites
production_barrel_or_route_exposure: none
repository_contract_change: narrow shared internal-signal semantics and Gate A limitations recorded
live_sql_adapter_mapping: none; neither insert adapter is claimed to emit the signal
postgresql_constraints_two_session_proof_atomicity: Gate A dependent and not implemented or verified
deployed_kai_schema_compatibility: NOT_CONFIRMED
focused_tests: node --test __tests__/kai-sprint2-file-idempotency-conflict.spec.js __tests__/kai-sprint2-batch-idempotency-conflict.spec.js __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js — 85 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test **tests**/kai-sprint2-*.spec.js — 308 passed, 0 failed in the owner-authorized localhost-capable context required by the existing ephemeral 127.0.0.1 parser listener
full_tests: npm test — 413 passed, 0 failed in the same owner-authorized localhost-capable context
git_diff_check: passed with the new focused test included before this single ExecPlan completion update; rerun afterward against the final package diff
complete_diff_scope: Backend/kai/services/kaiIntakeService.js, Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md, __tests__/kai-sprint2-file-idempotency-conflict.spec.js, __tests__/kai-sprint2-batch-idempotency-conflict.spec.js, __tests__/kai-sprint2-p0-repository-contract.spec.js, and this living ExecPlan evidence update only
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
sql_schema_routes_http_contracts_transactions_audit_metrics_fingerprint_representation: intentionally unchanged
remaining_p0_03_items: unchanged and not implemented in this bounded leaf
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this file-reservation conflict bounded leaf
```

## P0-03 — repository-safe package closure

```text
p0_03_repository_safe_package_status: complete
implementation_status: complete_for_authorized_repository_safe_scope
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
ending_head: ff329d9243a5f3d1d2e868b39e44201e2a4ead84
completed_units:
1. tenant-scoped batch lookup hardening;
2. stored-fingerprint fail-closed hardening;
3. transaction-interface definition;
4. required-audit versus best-effort-metrics orchestration;
5. orchestration production-boundary correction;
6. batch write-time idempotency-conflict recovery;
7. file-reservation write-time idempotency-conflict recovery.
established_acceptance_labels:
TENANT_QUERY_SCOPE_TOOL_VERIFIED
FINGERPRINT_FAIL_CLOSED_TOOL_VERIFIED
TRANSACTION_ORCHESTRATION_TOOL_VERIFIED
MOCKED_CONFLICT_HANDLING_TOOL_VERIFIED
DATABASE_ATOMICITY_VERIFIED: not_established
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed abuse/concurrency coordination: NOT_CONFIRMED
repository_safe_completion: synthetic repository milestone only
repository_safe_completion_limit: This does not prove that the batch or file-reservation paths work against deployed PostgreSQL tables, constraints, indexes, or concurrent sessions.
persisted_fingerprint_version_discrimination: Gate-A-deferred because no version discriminator is currently persisted
gate_a_parked_items:
1. rollback-failure error preservation;
2. distinct corrupt-stored-fingerprint versus payload-conflict reason coding;
3. orchestration boundary-guard review when a real production composition root is introduced;
4. live PostgreSQL conflict mapping, deployed constraints, two-session proof, database atomicity, and concurrency enforcement.
next_package: P0-04
next_action: separate fresh read-only repository inspection to select one smallest bounded read-route leaf
```

## P0-04 — tenant-scoped batch-detail read (first bounded leaf)

```text
leaf_status: complete
p0_04_package_status: in_progress
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_head: 50e5f05e16fc2b62058a24e68c0ff25367e55489
mounted_route: GET /api/kai/sprint2/intake/admin/batches/:intakeBatchId
route_registration: existing Backend/kai/routes/sprint2IntakeApi.js admin-batch family only; no second mount, duplicated feature gate, or parallel authentication path
identifier_validation: organization_id query scope and intakeBatchId path parameter must both be canonical UUID-shaped identifiers before service invocation
canonical_service: Backend/kai/services/kaiIntakeService.js getIntakeBatchDetail
service_controls: feature flag, mapped human actor, allowed read role, active organization membership, tenant-scoped dependency arguments, returned-row identifier check, and defense-in-depth tenant validation
repository_dependency: existing Backend/kai/db/kaiReadModels.js getIntakeBatchDetail used unchanged with organization_id and intake_batch_id predicates; no unscoped fallback or query-projection refactor
dto_construction_style: explicit positive eight-field property allowlist
row_spread_used: no
forbidden_sentinel_test: direct service and assembled HTTP results exclude the required idempotency, source, notes, batch metadata, storage, signed URL, raw content, client data, and unapproved PII keys and sentinel values
assembled_route_test: real ephemeral-loopback HTTP requests through a test Express application mounting the actual production Sprint 2 middleware and sprint2IntakeApiRouter in production order
production_routers_used: Backend/kai/routes/sprint2IntakeApi.js
production_middleware_used: setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser, handleKaiSprint2JsonParserError, kaiSprint2OrganizationMutationLimiter, kaiSprint2ActorMutationLimiter, requireKaiSprint2Authenticated
feature_gate_before_auth_result: disabled request returned canonical 403 with an empty event trace and zero batch-repository calls; enabled unauthenticated request reached canonical authentication and returned canonical 401 with zero batch-repository calls
repository_call_event_trace: outer_feature_gate_passed → canonical_http_authentication → sprint2_batch_detail_route_handler → actor_mapping → role_context_lookup → membership_context_lookup → tenant_membership_scope_check → active_membership_check → allowed_role_check → tenant_scoped_repository_read
route_inherits_existing_admin_mount: yes
api_contract_verifier_files_changed: __tests__/kai-sprint2-api-contract.spec.js and __tests__/kai-sprint2-pass2-route-runtime.spec.js
schema_contract_verifier_files_changed: none
verifier_change_classification: expected_inventory_only
verifier_semantics: no existing route removed, no exact assertion weakened, no allowlist broadened, no verifier disabled, and no failure changed to warning-only
focused_tests: node --test __tests__/kai-sprint2-batch-detail-route.spec.js — 11 passed, 0 failed
api_contract_tests: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_tests: npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 319 passed, 0 failed
legacy_kai_tests: 45 passed, 0 failed
full_tests: npm test — 424 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
local_http_test: focused, API-contract, Sprint 2, and full suites used only ephemeral 127.0.0.1 listeners in the owner-authorized localhost-capable execution context after the default sandbox rejected listen with EPERM
database_access: not performed
cloud_or_external_network_access: not performed
feature_or_tenant_configuration_change: not performed
schema_sql_migrations_query_projection_review_controls_other_routes: intentionally unchanged
deployed_kai_schema_compatibility: NOT_CONFIRMED
remaining_p0_04_items: unchanged and not implemented in this bounded leaf
complete_diff_scope: Backend/kai/index.js, Backend/kai/routes/sprint2IntakeApi.js, Backend/kai/services/kaiIntakeService.js, __tests__/kai-sprint2-batch-detail-route.spec.js, __tests__/kai-sprint2-api-contract.spec.js, __tests__/kai-sprint2-pass2-route-runtime.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: RETURN the authorized batch-detail leaf evidence before selecting another P0-04 leaf
```

## P0-04 — batch-detail post-read tenant-mismatch correction

```text
leaf_status: complete
correction_status: complete
implementation_status: partial
verification_status: tool_verified_pass
evidence_class: TOOL_VERIFIED
owner_directed_correction_scope: USER_CONFIRMED
starting_head: 7485928842330054e66d47ee4b479387f343d316
defect: the accepted batch-detail leaf's post-read defense-in-depth tenant check returned tenant_boundary_violation (403) for a repository row whose organization_id differed from the requested organization, revealing that a differently scoped batch exists for that intake_batch_id
controlling_text_reviewed: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md (no post-read-mismatch language found); this ExecPlan's P0-01 general HTTP convention list (authorization denial, mapped-user failure, and tenant-boundary violation: 403) which is a pre-read actor/payload convention already applied elsewhere in kaiIntakeService.js via validationBlocked (422), not via tenant_boundary_violation (403), for the same defense-in-depth validator on returned rows
authority_conflict_found: none — no controlling contract or accepted plan text specifically prescribes 403 for a post-read returned-row tenant mismatch on this route; the prior 403 was an implementation defect, not an application of an accepted rule
contract_changed: no
correction: Backend/kai/services/kaiIntakeService.js getIntakeBatchDetail post-read tenant-mismatch branch now returns buildKaiError("not_found") instead of buildKaiError("tenant_boundary_violation", ...), identical to the no-row branch; no second lookup, no fallback, query scope and DTO unchanged
tests_added_or_changed: __tests__/kai-sprint2-batch-detail-route.spec.js — direct service tests proving no-row and cross-tenant-row results are deeply equal to the canonical not_found result and exclude tenant_boundary_violation and the mismatched organization id; assembled-route tests proving the no-row and cross-tenant-row HTTP responses share the same 404 status and deeply equal JSON bodies; role and membership denial coverage added at the service level and unchanged at the route level
focused_tests: node --test __tests__/kai-sprint2-batch-detail-route.spec.js — 16 passed, 0 failed
api_contract_tests: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_tests: npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 324 passed, 0 failed
full_tests: npm test — 429 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_access: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
complete_diff_scope: Backend/kai/services/kaiIntakeService.js, __tests__/kai-sprint2-batch-detail-route.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded correction package; do not begin another P0-04 leaf
```

## P0-04 — intake-batch file collection owner decision

```text
decision_evidence: USER_CONFIRMED
repository_state_inspected_at: TOOL_VERIFIED 3914e13634ab457dbd286aee864889931882a03f
prior_read_only_scoping_review: USER_CONFIRMED — correctly stopped without implementing the route or selecting another leaf
route: GET /api/kai/sprint2/intake/admin/batches/:intakeBatchId/files
operation: read_intake
surface: internal operator collection read
implementation_status: unimplemented
owner_confirmed_parent_validation: one explicit tenant-scoped parent lookup using organizationId and intakeBatchId before any child-file query
owner_confirmed_parent_failure: canonical identical not_found 404 for no parent and returned-parent organization mismatch, with cross-tenant existence undisclosed and no child query on failure
owner_confirmed_pagination: opaque keyset cursor with route-specific default limit 25 and maximum limit 25
pagination_is_load_bearing: deployed 25-file enforcement is NOT_CONFIRMED, so the repository boundary must remain bounded even when deployed or legacy data exceeds the intended cap
owner_confirmed_ordering: created_at DESC, intake_file_id DESC, with intake_file_id as the unique tie-breaker and exclusive continuation comparison
owner_confirmed_success_data: exact items plus pagination object containing validated effective limit and nullable next_cursor inside the established outer KAI success envelope
owner_confirmed_file_summary_dto: intake_file_id, intake_batch_id, organization_id, engagement_id, safe_filename, mime_type, file_size_bytes, file_policy_status, malware_scan_status, processing_status, parse_status, review_status, created_at, updated_at
owner_confirmed_operator_metadata: mime_type and file_size_bytes included for triage and file-policy review without representing independent security verification or authorizing raw-file access
owner_confirmed_exclusions: storage identifiers, storage URI, signed URL, file extension, checksum, hash algorithm, notes, unrestricted metadata, raw content, credentials, actor or membership context, client data, and unapproved PII
later_implementation_authorization: one bounded vertical slice for this route only
other_p0_04_route_or_mutation_authorization: none
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_file_count_enforcement: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed abuse/concurrency coordination: NOT_CONFIRMED
next_package_or_stop_condition: STOP after this owner-decision record; do not implement the route or begin another P0-04 leaf in this package
```

## P0-04 — intake-batch file collection read implementation

```text
leaf_status: complete
p0_04_package_status: in_progress
implementation_status: partial
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_head: 46926f39d7c91fe715903d109f9bfe9c9be61b5b
starting_head_direct_parent: 3914e13634ab457dbd286aee864889931882a03f
inline_execplan_artifact_check: TOOL_VERIFIED — exactly one intake-batch file collection decision section, one normally fenced text block, no flattened text +decision_evidence artifact, and no literal Git addition markers in the decision block
route: GET /api/kai/sprint2/intake/admin/batches/:intakeBatchId/files
operation: read_intake
surface: internal operator collection read
mount_and_middleware: existing feature gate, mutation limiters, and canonical HTTP authentication remain outside the production router; route handler delegates actor mapping, read_intake role, and active-membership controls to the established service
request_validation: canonical organization and intake-batch UUIDs; allowlisted limit and cursor query parameters only; limit minimum 1, default 25, maximum 25; strict opaque base64url cursor with exact canonical created_at and intake_file_id fields
parent_validation: exactly one getIntakeBatchDetail organization-and-batch-scoped lookup; missing and mismatched-organization rows return deeply equal canonical not_found results and bodies with no child lookup or tenant disclosure
child_read: at most one organization-and-batch-scoped listIntakeFilesForBatch lookup ordered created_at DESC, intake_file_id DESC, bounded to limit plus one, with the exclusive timestamp-and-ID continuation predicate and no offset or fallback
service_pagination: at most limit DTOs; probe row used only for later-page detection; next_cursor derived from the final returned item; final pages use null
dto_boundary: exact field-by-field FileSummary allowlist with file_policy_status and malware_scan_status; forbidden repository sentinel fields absent from the complete HTTP JSON
focused_tests: node --test __tests__/kai-sprint2-batch-files-route.spec.js — 18 passed, 0 failed
api_contract_verifier: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_verifier: npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 342 passed, 0 failed
full_tests: npm test — 447 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_or_cloud_access: not performed
localhost_test_behavior: temporary loopback HTTP listeners used only by assembled synthetic tests after narrow sandbox authorization; no external network access
api_contract_change: exact mounted-route inventory expectation only; verifier logic unchanged
schema_verifier_change: none
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_file_count_enforcement: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed abuse/concurrency coordination: NOT_CONFIRMED
complete_diff_scope: Backend/kai/db/kaiReadModels.js, Backend/kai/index.js, Backend/kai/routes/sprint2IntakeApi.js, Backend/kai/services/kaiIntakeService.js, Backend/kai/validators/kaiSprint2RequestSchemas.js, __tests__/kai-sprint2-batch-files-route.spec.js, __tests__/kai-sprint2-api-contract.spec.js, __tests__/kai-sprint2-pass2-route-runtime.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded implementation commit; do not begin acceptance review, another route, or a mutation
```

## P0-04 — intake-file detail read implementation

```text
leaf_status: complete
p0_04_package_status: in_progress
implementation_status: partial
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: d77bb338fddb5d0cc4169e06d512d31591a1f707
starting_tree: clean
starting_commit_scope: TOOL_VERIFIED — git show --stat lists only the nine declared intake-batch file collection files
controlling_contract_review: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this ExecPlan's P0-04 mounted surface; GET /files/:id is consistent with the requested full mounted path and no exact contradiction was found
route: GET /api/kai/sprint2/intake/admin/files/:intakeFileId
operation: read_intake
surface: internal operator detail read
mount_and_middleware: existing feature gate remains before canonical HTTP authentication; route delegates mapped-human actor, read_intake role, and active-organization-membership controls to the established service before any repository read
request_validation: established organization query convention plus strict canonical lowercase intakeFileId UUID validation before service invocation, with matching direct-service validation
repository_read: exactly one getIntakeFileMetadata organization-and-file-scoped lookup using organizationId and intakeFileId; no ID-only, organization-only, unscoped, or fallback lookup
not_found_behavior: no row, returned-file-ID mismatch, and returned-row organization mismatch use deeply equal canonical not_found 404 results and HTTP bodies without tenant or identifier disclosure
dto_boundary: exact field-by-field reuse of the 14-field FileSummary allowlist; production SELECT is restricted to the same fields; storage identifiers, checksum, hash algorithm, file extension, raw content, unrestricted metadata, credentials, actor or membership context, client data, and unapproved PII are excluded
focused_http_verification: genuine assembled production middleware and router over a temporary loopback listener, including feature/auth ordering, canonical UUID rejection, authorization-before-read, one scoped lookup, indistinguishable 404s, and forbidden-field sentinels
focused_tests: node --test __tests__/kai-sprint2-file-detail-route.spec.js — 12 passed, 0 failed
api_contract_verifier: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_verifier: npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 354 passed, 0 failed
full_tests: npm test — 459 passed, 0 failed
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_or_cloud_access: not performed
localhost_test_behavior: initial sandbox EPERM was followed only by the owner-authorized identical rerun using temporary loopback HTTP listeners; no external network access
api_contract_change: exact mounted-route inventory expectation only; verifier logic unchanged
schema_verifier_change: none
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_file_count_enforcement: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed_abuse/concurrency_coordination: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
complete_diff_scope: Backend/kai/db/kaiReadModels.js, Backend/kai/index.js, Backend/kai/routes/sprint2IntakeApi.js, Backend/kai/services/kaiIntakeService.js, __tests__/kai-sprint2-file-detail-route.spec.js, __tests__/kai-sprint2-api-contract.spec.js, __tests__/kai-sprint2-pass2-route-runtime.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded implementation commit; do not begin another route, mutation, acceptance package, or P0 leaf
```

## P0-04 — internal-GK intake-file review-queue collection read implementation

```text
leaf_status: complete
p0_04_package_status: in_progress
implementation_status: partial
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 698b6a70c76897344ed9774491f4d315042ef8d4
starting_tree: clean tracked and untracked
starting_commit_scope: TOOL_VERIFIED — 698b6a70 changed exactly the eight files declared by the intake-file detail complete_diff_scope, and complete diff inspection found only that leaf's route/service/read-model, focused test, inventory expectations, and ExecPlan evidence
applicable_repository_instructions: root AGENTS.md only; P0-04 leaf remains inside the approved package order and no gate or additional leaf was selected
controlling_contract_decision: owner-approved authorization, collection scope, pagination, DTO, text, and fail-closed row-validation decisions recorded only in Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan
route: GET /api/kai/sprint2/intake/admin/review-queue
operation: read_intake
surface: internal GK intake-file review-queue collection read
mount_and_middleware: existing feature gate remains before canonical HTTP authentication; the route delegates mapped-human actor resolution and authorization to the established service before the collection read
authorization: generic read_intake and active requested-organization membership are required first; a second route-specific active-membership role check permits only gk_admin, gk_operator, or gk_reviewer; client_admin, client_reviewer, and client_contributor each pass the generic check but receive the canonical route-level authorization denial with zero collection reads
repository_read: exactly one bounded organization-scoped review_queue_items query with fixed intake_file_review queue type, fixed intake_file target type, and exactly open/in_progress/blocked/waiting_on_client/waiting_on_gk statuses; no unscoped, fallback, per-row target, or ID-only lookup
pagination: established batch-file canonical-integer and base64url cursor behavior reused with default/max 25, created_at plus review_queue_item_id cursor, created_at DESC/review_queue_item_id DESC ordering, exclusive continuation, limit-plus-one probe, and next_cursor derived from the final returned item
dto_boundary: exact field-by-field 12-field allowlist; review_queue_item_id, organization_id, and opaque target_object_id are canonical UUIDs; assigned_to, blocked_reason, queue metadata, internal notes, actor/session/membership context, storage data, credentials, raw content, client data, and PII are excluded from both SELECT and serialized output
text_boundary: summary and required_action normalize NFC, CRLF/CR to LF, and outer whitespace before Unicode-code-point limits; empty, NUL, disallowed C0/C1, bidi formatting controls, and overlength values fail closed without truncation, repair, replacement, or silent removal; markup remains inert JSON text
row_validation: every query-returned row including the probe row is validated before serialization; any organization, queue type, target type, status, UUID, timestamp, priority-code, or approved-text inconsistency returns one canonical safe 500 system_error with no partial collection or offending values
focused_http_verification: genuine assembled production middleware and router over a temporary loopback listener, including feature/auth order, mapped role and membership controls, client-role denial, one scoped bounded read, fixed scope/statuses, fail-closed row validation, exact DTO/forbidden-field boundary, hostile text, pagination, and cursor behavior
focused_tests: node --test __tests__/kai-sprint2-review-queue-route.spec.js — 16 passed, 0 failed
cursor_regression_tests: node --test __tests__/kai-sprint2-batch-files-route.spec.js — 18 passed, 0 failed
api_contract_verifier: npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_verifier: npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
pass2_tests: npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_tests: node --test __tests__/kai-sprint2-*.spec.js — 370 passed, 0 failed
full_tests: npm test — 475 passed, 0 failed
client_role_denial_test: passed for client_admin, client_reviewer, and client_contributor after each independently passed generic read_intake authorization with active membership
hostile_text_tests: passed for bidi override, C1 control, NUL, 201-code-point summary, and 1001-code-point required_action; every case returned one safe 500 with no partial response
duplicate_timestamp_test: passed; two pages under created_at DESC, review_queue_item_id DESC returned all four expected IDs exactly once with no skip or duplication, and the continuation cursor matched the final first-page item rather than its probe row
git_diff_check: passed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:1 used for every Node and npm command
database_or_cloud_access: not performed
localhost_test_behavior: sandbox runs that exercised temporary HTTP listeners returned only the known EPERM; each was followed only by the owner-authorized identical localhost-capable rerun, with no external network access
api_contract_change: exact mounted-route inventory expectation only; verifier logic unchanged
schema_verifier_change: none
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_file_count_enforcement: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed_abuse/concurrency_coordination: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md, Backend/kai/db/kaiReadModels.js, Backend/kai/index.js, Backend/kai/routes/sprint2IntakeApi.js, Backend/kai/services/kaiIntakeService.js, Backend/kai/validators/kaiSprint2RequestSchemas.js, __tests__/kai-sprint2-review-queue-route.spec.js, __tests__/kai-sprint2-api-contract.spec.js, __tests__/kai-sprint2-pass2-route-runtime.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded implementation commit; do not begin P0-05, another route, mutation, acceptance package, or additional leaf
```

## P0-04 — shared human state-transition mutation contract decision

```text
leaf_status: complete
p0_04_package_status: in_progress
implementation_status: not_implemented
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 98d81e640ee799b38e5a8eaad39f2a4e1a8869a8
starting_tree: clean tracked and untracked
starting_commit_scope: TOOL_VERIFIED — 98d81e640ee799b38e5a8eaad39f2a4e1a8869a8 changed exactly the ten files declared by the internal-GK intake-file review-queue collection read complete_diff_scope, and complete diff inspection found only that leaf's contract, read-model, index, route, service, validator, focused test, API/pass2 expectations, and ExecPlan evidence
applicable_repository_instructions: root AGENTS.md only; P0-04 leaf remains inside the approved package order and no gate, implementation leaf, route, service, write helper, production export, Current State update, P0-05 work, review-queue-status work, or additional leaf was selected
controlling_contract_decision: owner-approved shared P0-04 human state-transition mutation rules recorded only in Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan
expected_current_status_concurrency: each route must require route-specific expected-current-status; record_version is not introduced or required; target reads and compare-and-set writes include organization_id, target object ID, and expected current status; zero-row compare-and-set after valid scoped read returns canonical 409 conflict_current_state_changed; already-transitioned state is not successful replay without later route-specific owner approval
tenant_target_non_disclosure: mutations use organization-and-target-scoped reads and writes; no row and defensive tenant mismatch both return canonical 404 not_found; ID-only lookup/write, tenant probes, fallbacks, unscoped queries, silent filtering, partial success, and mismatched target identifiers are prohibited
post_write_validation_ordering: validate scoped stored row, perform scoped compare-and-set, validate returned post-write row, persist required audit only after post-write validation, and commit only after required audit confirms success
post_write_failure_behavior: missing, malformed, cross-tenant, wrong-target, wrong-state, or internally inconsistent post-write rows fail with canonical safe 500 system_error, suppress required audit and metrics, roll back mutation side effects, and return no partial result or offending identifiers
required_audit_boundary: every successful P0-04 human state transition requires field-allowlisted metadata-only audit persistence in the same transaction as all required mutation side effects; payloads are constructed field-by-field from approved scalar values and only from the route-applicable subset of the shared semantic allowlist
required_audit_success_predicate: audit persistence confirms only with an object having an own boolean data property named ok whose value is exactly true; thrown, rejected, skipped, missing, malformed, getter-backed ok, array with ok, non-boolean ok, and ok not exactly true fail the transaction
metrics_boundary: mutation failure suppresses audit and metrics; required-audit failure rolls back all mutation side effects and suppresses metrics; best-effort metrics run only after successful commit and cannot alter or roll back the successful mutation result
composition_boundary: generic dependency injection and deterministic transaction providers remain outside the canonical production barrel; a later mounted route may add only a narrow internal production composition binding for the existing transaction interface, route-specific mutation persistence, route-specific required-audit persistence, and optional post-commit metrics; test injection remains only through an explicitly test-only harness
route_specific_matters_left_undecided: roles, request bodies beyond expected-status requirement, allowed transition vocabulary, replay behavior, reason codes or text, upload-state effects, review-queue effects, exact error matrix beyond shared rules, and success DTOs
directly_affected_contract_static_test: not run — existing static contract tests read the controlling contract but do not validate the newly recorded shared P0-04 human-mutation decision text, and this owner-directed package allowed only such a test if one existed
git_diff_check: passed
broad_suites: not run per owner instruction for this documentation-only package
database_or_cloud_access: not performed
node_or_npm_commands: not run
current_state_update: not performed
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_postgresql_compare_and_set_behavior: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
two_session_conflict_behavior: NOT_CONFIRMED
durable_successful_audit_persistence: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this documentation-only shared contract decision; do not implement a route, service, write helper, production export, P0-05 work, review-queue-status work, or additional leaf
```

## P0-04 — route-specific file-policy block mutation

```text
leaf_status: complete
p0_04_package_status: route_specific_file_policy_block_complete
route: POST /api/kai/sprint2/intake/admin/files/:intakeFileId/block
operation: mark_file_policy_blocked
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 8a219a68ec4ebef6ac3e3ed01c8bb926984f1a8e
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED — 8a219a68ec4ebef6ac3e3ed01c8bb926984f1a8e changed only Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan to record the shared P0-04 human mutation contract
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-04 route-specific mutation package
route_decision_recorded: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan
authorization_boundary: mapped human actor, gk_admin or gk_operator, and active membership required before tenant-sensitive file access; gk_reviewer, client roles, AI, system, internal-service, import, and code actors denied
request_contract: exact two-field JSON body with expected_file_policy_status pending and approved blocking_reason_code only; unknown keys, nested objects, arrays, nulls, free text, queue fields, metadata, idempotency keys, record_version, and upload-state instructions rejected
transition_contract: pending -> blocked only; blocked returns 409 conflict_current_state_changed; passed, failed, and skipped return 422 state_transition_denied; malformed stored state returns safe 500 system_error
persistence_boundary: one organization-and-file-scoped read, one organization-and-file-scoped compare-and-set write requiring file_policy_status pending, post-write validation before required successful audit, and commit only after audit confirms ok true
upload_lifecycle_decision: route changes only file_policy_status; durable upload_state = policy_blocked, persistent lifecycle compatibility, and full two-field lifecycle mapping remain NOT_CONFIRMED and deferred to authorized lifecycle/Gate A work
review_queue_decision: no intake_file_review read, write, creation, update, deduplication, resolution, blocking, summary, required_action, blocked_reason, priority, assignment, due date, or queue metadata mutation
success_response_boundary: established success envelope with exact 14-field file DTO matching mounted file-detail route and no storage, checksum, upload-state, raw content, metadata, credentials, audit, transaction, actor/session/membership, queue, client data, or PII sentinels
implemented_files: Backend/kai/routes/sprint2IntakeApi.js; Backend/kai/services/kaiIntakeService.js; Backend/kai/db/kaiIntakeQueries.js; Backend/kai/db/kaiAuditQueries.js; Backend/kai/internal/kaiMutationOrchestration.js; Backend/kai/errors/kaiErrors.js; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/auth/kaiAuthorizationService.js; Backend/kai/validators/assistantBoundaryValidators.js; Backend/kai/validators/kaiSprint2RequestSchemas.js; Backend/kai/index.js
test_files: __tests__/kai-sprint2-file-policy-block-route.spec.js; __tests__/kai-sprint2-api-contract.spec.js; __tests__/kai-sprint2-orchestration-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; __tests__/kai-sprint2-pass2-route-runtime.spec.js
documentation_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_file_block_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-file-policy-block-route.spec.js — 17 passed, 0 failed
focused_audit_query_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-audit-queries.spec.js — 4 passed, 0 failed
mutation_orchestration_and_transaction_regressions: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-mutation-orchestration.spec.js __tests__/kai-sprint2-transaction-interface.spec.js — 34 passed, 0 failed
api_contract_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract — 51 passed, 0 failed
schema_contract_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract — 9 passed, 0 failed
pass2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-pass2 — 105 passed, 0 failed
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — 387 passed, 0 failed
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test — 492 passed, 0 failed
localhost_eperm_note: sandbox-local 127.0.0.1 listen attempts returned EPERM for assembled HTTP tests; identical localhost-capable reruns used the same non-listening DATABASE_URL sentinel and passed
git_diff_check: passed
complete_diff_inspection: TOOL_VERIFIED — complete implementation, documentation, and test diff inspected after final verification
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_postgresql_compare_and_set_behavior: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
two_session_conflict_behavior: NOT_CONFIRMED
durable_successful_audit_persistence: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this route-specific implementation commit; do not begin P0-05, another route, acceptance package, review-queue mutation, upload lifecycle work, or additional leaf
```

## P0-04 — route-specific review-queue status mutation owner decision

```text
leaf_status: complete
p0_04_package_status: route_specific_review_queue_status_decision_recorded
implementation_status: not_implemented
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
route: POST /api/kai/sprint2/intake/admin/review-queue/:reviewQueueItemId/status
service: updateReviewQueueStatus
operation: update_review_queue_status
surface: internal GK status-only mutation
decision_evidence: USER_CONFIRMED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 80bc4c0d275587dad5a14c275de1d84b20af759f
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED — 80bc4c0d275587dad5a14c275de1d84b20af759f changed only __tests__/kai-sprint2-orchestration-boundary.spec.js
applicable_repository_instructions: root AGENTS.md only; package remains documentation-only inside the approved P0-04 boundary; no runtime code, tests, Current State update, database, schema, cloud, credentials, feature flags, tenants, production, P0-05 work, push, deployment, orchestration-guard preauthorization, or additional leaf was selected
route_decision_recorded: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan
controlling_shared_contract: committed shared P0-04 human state-transition mutation contract remains controlling for compare-and-set, tenant-nondisclosure, post-write-validation, transactional-audit, metrics, composition, and evidence-boundary rules
composition_boundary: preserve feature gate before authentication and the established organization-input convention
authorization_boundary: authenticated mapped human actor, gk_admin or gk_operator, and active membership in the requested organization required; gk_reviewer, all client roles, AI actors, system actors, internal-service actors, import actors, and code actors denied
request_contract: exact two-field JSON body only with expected_queue_status open and new_queue_status in_progress; both fields required; unknown keys, nulls, arrays, nested objects, record_version, idempotency or replay fields, reason codes, operator notes, blocked_reason, summary, required_action, assigned_to, due_at, and queue metadata rejected
transition_contract: open -> in_progress only; same-status replay, all transitions from in_progress/blocked/waiting_on_client/waiting_on_gk/resolved/cancelled, all transitions to blocked/waiting_on_client/waiting_on_gk/resolved/cancelled, and reopening to open are unauthorized
deferred_transition_decision: open -> blocked and open -> waiting_on_client are deliberately deferred despite appearing in the broader product destination; blocking lacks approved reason, required-action, and remediation semantics for this status-only route; waiting_on_client lacks a defined P0 client-response return path
resolve_route_separation: in_progress -> resolved remains assigned to the separate resolveReviewQueueItem service and is not authorized or mounted through updateReviewQueueStatus
terminal_semantics_boundary: blocked, waiting_on_client, resolved, and cancelled must not be described as globally terminal unless a later explicit graph decision establishes that
future_graph_amendment_questions: (1) exit and recovery transitions out of blocked and waiting_on_client; (2) blocked-reason contract vocabulary, limits, normalization, rejection, storage, audit, and response exposure; (3) required-action behavior, safe-text contract, storage/update behavior, and DTO visibility; (4) terminal versus revisitable semantics for blocked; (5) client-response continuation path, actor, target state, metadata, and possible client-facing route
text_and_reason_policy: route is status-only; accepts no machine reason code and no free text; does not create, update, append, clear, or reinterpret blocked_reason, summary, required_action, assigned_to, due_at, priority, or queue metadata; existing values remain unchanged
tenant_and_linked_target_boundary: route is limited to queue_type intake_file_review and target_object_type intake_file; review-queue item and linked intake-file target must both belong to the requested organization; intake file is validated only for existence and tenant integrity and is not mutated; no ID-only queue-item lookup, ID-only target lookup, tenant-probe query, unscoped fallback, or cross-tenant disclosure; missing or nondisclosable queue item or target returns identical canonical 404 not_found; no raw file content, storage identifiers, checksums, or unrestricted target metadata read or returned
mutation_and_audit_inheritance: implementation must perform scoped stored-row read, stored-row validation, expected-status compare-and-set, post-write row validation, required metadata-only audit in the same transaction, commit, then post-commit best-effort metrics
persisted_field_boundary: only queue_status and repository-managed updated_at, if already established, may change
audit_subset: actor user ID, actor type, organization ID, operation type update_review_queue_status, canonical route, request ID, target object type review_queue_item, target object ID, prior queue status, new queue status, validator keys actually executed, and created timestamp; no request bodies, queue text, linked-file metadata, storage details, raw content, client data, or PII
error_contract: syntactically valid source-target pair outside open -> in_progress returns 422 state_transition_denied; stored queue status different from expected_queue_status or zero-row compare-and-set after valid scoped read returns 409 conflict_current_state_changed; already-transitioned request is not a successful replay
success_response_boundary: established review-queue DTO field-by-field in order review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, due_at, summary, required_action, created_at, updated_at; reuse existing review-queue row and text validation rules; no assigned_to, blocked_reason, queue metadata, internal notes, audit payload, transaction context, actor/session/membership context, linked-file metadata, storage information, credentials, raw content, client data, or PII
repository_safe_future_evidence: later implementation may establish mocked compare-and-set behavior, queue-item and linked-target tenant scoping, post-write validation ordering, transactional audit behavior, post-commit metric ordering, DTO and response boundaries, and mounted route composition
retained_not_confirmed_limitations: deployed-schema compatibility, live PostgreSQL compare-and-set behavior, two-session conflict behavior, database atomicity, and durable successful-audit persistence remain NOT_CONFIRMED pending separately authorized Gate A work
runtime_code_or_tests: not modified
current_state_update: not performed
node_or_npm_commands: not run
database_or_cloud_access: not performed
git_diff_check: passed
broad_suites: not run per owner instruction for this documentation-only package
complete_diff_inspection: TOOL_VERIFIED — complete two-file documentation diff inspected after git diff --check
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
next_package_or_stop_condition: OWNER-DIRECTED STOP after this documentation-only route-specific owner decision; do not implement a route, service, write helper, tests, production export, P0-05 work, review-queue mutation, upload lifecycle work, or additional leaf
```

## P0-05A — synthetic filename, Unicode, path and reserved-name fixture contract

```text
leaf_status: complete
p0_05_package_status: filename_fixture_contract_foundation_complete
implementation_status: fixture_and_test_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: f686ab9b06c46c5ce7d759c636c6af8505ef26de
starting_tree: clean tracked and untracked
prior_boundary: TOOL_VERIFIED — f686ab9 implemented the review-queue status mutation after the P0-04 route-specific owner decision and is the required starting boundary for this P0-05A leaf
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05 fixture-and-test-only boundary
implemented_files: __tests__/support/kaiSprint2FilenameFixtureCorpus.js; __tests__/kai-sprint2-filename-fixture-corpus.spec.js
production_code_changed: false
runtime_behavior_changed: false
dependencies_or_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
authority_map: closed map with BACKEND_CONTRACT.VAL_STO_004.PATH_TRAVERSAL, BACKEND_CONTRACT.VAL_STO_004.SLASH_BACKSLASH, BACKEND_CONTRACT.VAL_STO_004.CONTROL_CHARACTERS, BACKEND_CONTRACT.VAL_STO_004.RESERVED_DEVICE_NAMES, BACKEND_CONTRACT.VAL_STO_004.DANGEROUS_EXTENSION_MISMATCH, BACKEND_CONTRACT.VAL_STO_004.EMPTY_SANITIZED_FILENAME, EXECPLAN.P0_05.APPLICATION_GENERATED_SAFE_FILENAME, EXECPLAN.P0_05.UNICODE_NORMALIZATION, EXECPLAN.P0_05.BIDI_REJECTION, EXECPLAN.P0_05.PATH_SEPARATOR_REJECTION, EXECPLAN.P0_05.RESERVED_NAME_REJECTION, EXECPLAN.P0_05.CONTENT_DISPOSITION_SAFETY, THREAT_MODEL.T2.MALICIOUS_FILENAME_PATH_TRAVERSAL, EXECPLAN.P0_05.UNSPECIFIED_PUNCTUATION_SPACING, and EXECPLAN.P0_05.UNSPECIFIED_EXTENSION_PATTERN
authority_statuses: contract_grounded and outcome_not_fully_specified only
corpus_status: corpus_only; not security-verified and not a production detector conformance claim
contract_grounded_fixture_counts: application_generated_safe_filename 1; path_traversal 2; path_separator 2; control_character 3; bidi_control 1; empty_sanitized_filename 1; reserved_device_name 6; dangerous_extension_mismatch 1
unresolved_fixture_counts: unicode_normalization_question 1; punctuation_spacing_question 2; content_disposition_header_safety_question 1; drive_path_question 1; reserved_name_variant_question 1; extension_pattern_question 1
contract_traceability: integrity test verifies every contract_grounded expected_policy and expected_category exactly match the closed authority map and rejects unknown authority identifiers, vague section references, and current-detector/runtime-behavior authority text
unresolved_policy_boundary: integrity test verifies every owner_decision_required fixture has expected_policy null, maps only to outcome_not_fully_specified authority, has a question category, and is excluded from getContractGroundedFilenameFixtureExpectations()
intrinsic_sequence_proof: integrity test verifies declared Unicode code points are present in actual_input and verifies traversal, separator, reserved-name, control-character, bidi, empty, and .csv.exe dangerous-extension sequences intrinsically without invoking the production detector
synthetic_and_privacy_proof: integrity test verifies synthetic provenance, contains_client_data false, contains_pii false, contains_secret false, no email/UUID/URL/storage URI/secret-token patterns in actual_input, and no network/database/cloud/production configuration or detector imports in the corpus module
ordinary_output_safety: integrity test source contains no console or diagnostic output and does not print raw fixture inputs during successful runs
owner_decisions_required_before_detector_expectation: decide normalize-and-accept versus reject for decomposed Unicode; decide spaces and punctuation; decide exact CR/LF filename input and Content-Disposition serialization behavior; decide drive-style path form handling; decide reserved-name casing/extension/trailing-character semantics; decide unclassified multiple-extension patterns
retained_deferrals: applying the answer key to the production detector; Unicode normalization implementation behavior; complete bidi, C0/C1 and reserved-name detector coverage; Content-Disposition construction and header safety; extension/MIME/signature agreement; received-byte size enforcement; TXT/MD, CSV, XLSX, PDF and malware corpora and detectors; archive-entry, expanded-byte, compression-ratio and timeout constants
retained_unimplemented_constants: controlling backend contract supplies structured row maximum 100000, XLSX sheet maximum 20, and workbook cell maximum 1000000; these remain unrepresented or unenforced in inspected repository runtime
focused_fixture_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-filename-fixture-corpus.spec.js — 7 passed, 0 failed
directly_affected_existing_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-path-policy.spec.js __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js — 60 passed, 0 failed
sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — 413 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test — 518 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
git_diff_check: passed
complete_diff_inspection: TOOL_VERIFIED — complete staged diff inspected after final verification
complete_diff_scope: __tests__/support/kaiSprint2FilenameFixtureCorpus.js, __tests__/kai-sprint2-filename-fixture-corpus.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this fixture-and-test-only package commit; do not implement detector behavior, route/service work, upload lifecycle work, P0-06 work, database/cloud/production behavior, push, deployment, or another leaf
```

## P0-05B — grounded filename rejection gate

```text
leaf_status: complete
p0_05_package_status: grounded_filename_rejection_gate_complete
implementation_status: bounded_filename_rejection_gate_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED binding P0-05B acceptance addendum
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 8708ed01c38c112fc831ee54de4e1f773b4a8670
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05 filename rejection boundary
implemented_files: Backend/kai/storage/storagePathPolicy.js; Backend/kai/services/kaiIntakeService.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; __tests__/kai-sprint2-filename-rejection-gate.spec.js
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
production_code_changed: true
runtime_behavior_changed: true, limited to the exact grounded filename rejection categories listed below
dependencies_or_lockfiles_changed: false
schema_or_migration_changed: false
upload_storage_provider_enabled: false
raw_file_upload_enabled: false
```

P0-05B rejects:

- the exact reserved basenames CON, PRN, AUX, NUL, COM1 and LPT1,
  case-insensitively;
- a terminal .exe suffix, case-insensitively;
- the specifically approved controls, bidi characters, traversal,
  separators and empty filename cases.

Direct-service safeFilename and payload.safe_filename bypasses for
those exact grounded categories are closed.

NOT completed by P0-05B:

- reserved names with extensions, including con.txt;
- trailing-dot or trailing-space reserved-name semantics;
- COM2-COM9 and LPT2-LPT9;
- other platform-specific reserved names;
- .bat, .cmd, .com, .scr, .js, .vbs, .sh or other executable/script suffixes;
- arbitrary multiple-extension or double-extension policy;
- .backup and other unspecified extension patterns;
- extension/MIME/signature agreement;
- general Unicode-normalization policy;
- Content-Disposition serialization.

```text
three_path_bypass_matrix: original_filename via mounted file-reservation route rejected; safeFilename via direct exported service rejected; payload.safe_filename via direct exported service rejected
representative_bidi_control_result: report\u202Ecod.exe rejected on original_filename, safeFilename, and payload.safe_filename before object-key construction or insert
representative_reserved_basename_result: CON rejected on original_filename, safeFilename, and payload.safe_filename before object-key construction or insert
representative_terminal_exe_result: report.csv.exe rejected on original_filename, safeFilename, and payload.safe_filename before object-key construction or insert
representative_control_character_result: report\n.csv rejected on original_filename, safeFilename, and payload.safe_filename before object-key construction or insert
blocked_categories_covered: path traversal; slash separator; backslash separator; C0 including CR and LF; DEL; C1; U+061C, U+200E, U+200F, U+202A-U+202E, and U+2066-U+2069 bidi formatting controls; exact reserved basenames CON, PRN, AUX, NUL, COM1, LPT1; terminal .exe case-insensitively; empty filename or empty safe result
insert_and_object_key_nonreachability: focused tests assert idempotency lookup, checksum lookup, object-key construction, and insert are not reached for rejected values on all three paths
direct_service_bypass_closure: hostile values supplied independently through safeFilename and payload.safe_filename are rejected before insert and object-key construction
unresolved_noninterference: decomposed Unicode, ordinary spaces, ordinary punctuation, drive-style path candidate, con.txt, .backup, other reserved-name variants, non-.exe executable/script/markup suffixes, and arbitrary multiple-extension examples remain unclassified by the new grounded helper
unresolved_corpus_policy_status: listed unresolved corpus fixtures retain decision_status owner_decision_required and expected_policy null
observed_current_behavior_only: no downstream unresolved-case behavior is asserted as policy by the P0-05B tests
not_policy: unresolved-case helper nonmatches are noninterference checks only
not_security_verified: unresolved-case downstream behavior is not security verified
focused_filename_gate_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-filename-rejection-gate.spec.js __tests__/kai-sprint2-storage-path-policy.spec.js __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-filename-fixture-corpus.spec.js — 48 passed, 0 failed
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
broader_sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js — 444 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test — 549 passed, 0 failed after the existing assembled-HTTP localhost listener sandbox EPERM was rerun identically in localhost-capable mode
overclaim_scan: rg found no prohibited completion claims; hits were limited to explicit retained-deferral/noninterference language for reserved-name variants and non-.exe suffixes
git_diff_check: passed
complete_diff_inspection: TOOL_VERIFIED — complete production, test, contract, and living ExecPlan diff inspected after final verification
complete_diff_scope: Backend/kai/storage/storagePathPolicy.js, Backend/kai/services/kaiIntakeService.js, Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md, __tests__/kai-sprint2-filename-rejection-gate.spec.js, and this living ExecPlan evidence update only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
retained_deferrals: exactly the NOT completed by P0-05B list above
next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded filename rejection gate package commit; do not begin P0-06A, database/cloud/production behavior, push, deployment, or another leaf
```


---

## Plan authority record

```text
plan_version: 0.3.5
approval_status: OWNER_ACCEPTED
owner_acceptance_reference: USER_CONFIRMED in the KAI Project conversation on 2026-07-14
repository_install_commit: TOOL_VERIFIED cea4583daa9b034acc206d97c92e07bcff6516a2
approved_execution_order: Phase 0-D, state recheck, P0-02, P0-01, first-write milestone checkpoint, P0-03 repository-safe portion, P0-04, P0-05, P0-06A, P0-07
p0_06b: GATE_A_BLOCKED
gates_a_through_d: UNAUTHORIZED
current_state_update: NOT_AUTHORIZED
```
