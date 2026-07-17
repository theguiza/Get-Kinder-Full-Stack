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
