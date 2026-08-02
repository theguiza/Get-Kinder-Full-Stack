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
pdf_incomplete_owner_authority_recorded_later: OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY
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

Known runtime-alignment gap recorded during P0-05F.1:

```text
Runtime declared file-MIME behavior accepted application/json at the time of P0-05F.1.
OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 rejects application/json because JSON is not an allowed P0 document type.
P0-05F.1 records policy only.
The separately authorized P0-05F runtime-alignment leaf resolves this drift by removing application/json from the declared file-MIME runtime allowlist while preserving HTTP request-envelope JSON handling and the existing unsupported_mime_type blocker vocabulary.
```

Block conditions include unsupported extension, unsupported MIME, extension/MIME disagreement, detected signature identifying another type, minimum structure contradicting declared type, ambiguous bytes where deterministic type cannot be established, bytes truncated below the required minimum, and no permitted type being deterministically established. Do not trust declared MIME over bytes, trust extension over bytes, rewrite declarations from detected bytes, guess likely type, apply fallback MIME detection, accept because one signal matches, or repair inconsistent metadata automatically.

Later owner authority `OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1` expands `declared_type_mismatch` category semantics for detected permitted-type contradictions. When terminal extension and declared file MIME jointly identify one permitted P0 type, but byte signature and the required minimum structure deterministically establish a different permitted P0 type, the file blocks as `block / declared_type_mismatch`.

A pass establishes only `type_agreement_pass_only`. It does not establish document validity, document usability, machine-readable PDF status, encryption or password status, macro safety, active-content safety, archive-expansion safety, malware cleanliness, profile eligibility, source eligibility, upload acceptance, or complete file-policy pass.

Text-family rule: CSV, MD, and TXT have no unique reliable magic signature for this P0 gate. Extension and declared MIME select the permitted text subtype; bytes must pass strict UTF-8 and deterministic binary-content validation; no semantic parsing distinguishes CSV, MD, or TXT; content meaning is not inspected; and instruction-like content remains inert data. CSV uses the committed strict UTF-8, BOM, NUL, prohibited-control, and lone-CR boundary already established for P0 text bytes. This does not decide CSV row limits, delimiter validity, header validity, formula handling, or parser behavior. Valid permitted text containing HTML, JavaScript, shell syntax, prompt injection, or other instruction-like strings is not reclassified as HTML or script content merely because those strings occur in the text. Empty CSV, MD, or TXT bytes may pass only when extension and MIME agree and the strict text-byte gate passes; the result remains `type_agreement_pass_only`.

PDF shallow identity rule: a candidate PDF must use extension `.pdf`, declare `application/pdf`, begin at byte offset zero with ASCII `%PDF-`, and contain ASCII `%%EOF` within the final 1024 bytes. Complete PDF shallow identity remains the positive allow path and returns `allow / type_agreement_pass / type_agreement_pass_only`. Leading bytes before `%PDF-` are not accepted. This does not establish machine-readable text layer, unencrypted status, password-free status, valid cross-reference structure, absence of JavaScript, absence of active actions, absence of embedded files, or complete PDF validity.

Later owner authority `OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY` records that narrowly defined incomplete PDF signalling blocks as `block / truncated_or_malformed_type / pdf_shallow_identity_block_only`. Complete PDF shallow identity is evaluated before incomplete PDF classification. Incomplete PDF classification is evaluated before `unknown_binary`. The narrow incomplete PDF signal exists only when extension is `.pdf`, declared MIME is `application/pdf`, and one of these byte conditions is established: ASCII `%PDF-` exists but begins after byte offset zero; the byte stream begins at byte offset zero with exact bytes `25 50 44 46` for `%PDF` but lacks following hyphen byte `2D` at that position; ASCII `%PDF-` begins at byte offset zero but ASCII `%%EOF` is absent; or ASCII `%PDF-` begins at byte offset zero and ASCII `%%EOF` exists, but no `%%EOF` occurrence is within the final 1024 bytes. The exact four-byte `%PDF` prefix condition must not be generalized to `%P`, `%PD`, arbitrary percent-prefixed bytes, arbitrary PDF-like bytes, or bytes merely named `.pdf` or declaring `application/pdf`.

XLSX shallow identity rule: a candidate XLSX must use extension `.xlsx`, declare `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, begin with a ZIP local-file-header signature, expose a structurally readable end-of-central-directory record, expose a structurally readable central directory, and contain exact case-sensitive central-directory entry names `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. A generic ZIP prefix is insufficient, and finding a required name somewhere in raw bytes is not proof that it is a valid central-directory entry.

The XLSX shallow identity rule establishes ZIP entry identity only by parsing ZIP structure. It must locate and validate the end-of-central-directory record; read the recorded central-directory offset and byte length; verify those values remain within fixture byte bounds; iterate valid central-directory records; obtain entry names from those records; validate each record length before advancing; validate each recorded local-header offset; verify the expected number of directory entries; and establish required-entry presence from the parsed directory-name set. It must not establish required-entry presence through raw-byte substring search, regular-expression search over the byte buffer, decoded whole-buffer text search, or grep-like matching.

The future shallow XLSX identity detector may inspect ZIP signatures, local headers, central-directory metadata, end-of-central-directory metadata, entry names, entry offsets, and stored and compressed lengths needed for bounded structural verification. It must not decompress entry contents, parse worksheet XML, parse workbook XML content, read cell values, expand archive data, execute macros, follow relationships, use the filesystem, or invoke external ZIP utilities in this P0-05F identity gate. A test-only ZIP builder may create deterministic stored empty entries without adding a dependency, but it must calculate and encode local-file-header offsets, central-directory record offsets, central-directory byte length, central-directory start offset, entry count, and end-of-central-directory metadata.

The positive minimum XLSX fixture must be a readable ZIP whose central-directory offsets, record lengths, entry counts, bounds, and local-header references are internally consistent; it expects `allow / type_agreement_pass / type_agreement_pass_only`. Missing-entry negative fixtures must be separate readable ZIPs for missing `[Content_Types].xml`, missing `_rels/.rels`, and missing `xl/workbook.xml`, each with the other two required entries present and exactly the claimed entry absent; each expects `block / standalone_archive_or_non_xlsx`. A wrong-case fixture must be a readable ZIP with exactly one required entry present only under incorrect case, such as `xl/Workbook.xml`; it expects `block / standalone_archive_or_non_xlsx`. A renamed non-OOXML ZIP must remain readable, omit at least one exact required OOXML entry, and not qualify merely because raw bytes contain similar strings; it expects `block / standalone_archive_or_non_xlsx`. Malformed and truncated ZIP fixtures must remain separate from missing-entry and standalone-archive fixtures, including truncated local-file-header signature, local header without readable central directory, invalid or out-of-bounds central-directory offset, and truncated central-directory record; each expects `block / truncated_or_malformed_type`.

Readable non-XLSX ZIP coverage has two distinct classes: readable ZIP with `.xlsx` metadata but missing complete XLSX identity, and readable ZIP with otherwise permitted non-XLSX metadata and missing complete XLSX identity. The previously separated Case A, readable arbitrary ZIP with permitted non-XLSX metadata, and Case C, recognized standalone-ZIP signature with permitted non-XLSX metadata, are not distinct deterministic cases under the committed P0 signal model. A structurally readable ZIP necessarily carries the recognized ZIP signature. When complete XLSX identity is absent and otherwise permitted non-XLSX metadata is used, both expose the same relevant signals and block as `standalone_archive_or_non_xlsx`. Do not manufacture a distinction using fixture names, descriptions, byte length, arbitrary archive entry names, or the term "signature" in a fixture ID. Only one canonical permitted-non-XLSX readable-ZIP semantic fixture is required. This rule does not establish macro absence, external-relationship absence, encryption/password status, OOXML path safety, sheet limits, cell limits, entry-count limits, expanded-size limits, compression-ratio safety, or complete workbook validity.

Recognized disallowed binary signatures for the future corpus are exactly DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, and gzip. A recognized disallowed signature blocks as `disallowed_binary_signature` regardless of allowed extension or declared MIME. Structurally readable ZIP without complete XLSX identity blocks as `standalone_archive_or_non_xlsx`, not `disallowed_binary_signature`. Malformed or truncated ZIP/XLSX-signalling bytes block as `truncated_or_malformed_type`. Narrowly defined incomplete PDF-signalling bytes block as `truncated_or_malformed_type` after complete PDF identity has failed. Unknown non-text binary input that does not establish a complete permitted identity, recognized disallowed signature, readable ZIP classification, malformed or truncated ZIP/XLSX signalling, or the narrowly defined complete or incomplete PDF signalling remains fail-closed as `unknown_binary`.

Deterministic block outcomes:

```text
unsupported extension or MIME -> block / unsupported_file_type
extension and MIME disagreement -> block / declared_type_mismatch
extension and MIME agree on one permitted type but complete byte identity establishes another permitted type -> block / declared_type_mismatch
recognized MZ, ELF, RAR 4, RAR 5, 7z, or gzip signature -> block / disallowed_binary_signature
structurally readable ZIP without complete XLSX identity -> block / standalone_archive_or_non_xlsx
malformed or truncated ZIP/XLSX-signalling bytes -> block / truncated_or_malformed_type
narrowly defined incomplete PDF-signalling bytes after complete PDF identity has failed -> block / truncated_or_malformed_type
multiple permitted types genuinely remain plausible after applying all committed signals -> block / ambiguous_file_type
non-text bytes matching no complete permitted identity, no recognized disallowed signature, no readable ZIP/non-XLSX archive classification, no malformed or truncated ZIP/XLSX signalling, and no narrowly defined complete or incomplete PDF signalling -> block / unknown_binary
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

The fixture corpus must precede detector implementation. The future fixture corpus must include every allowed extension/MIME pairing, every grounded cross-type mismatch, uppercase extension normalization, unsupported extensions, unsupported MIME values, `application/json` rejection, `application/octet-stream` declared-MIME rejection, MIME-parameter rejection, empty text-family cases, PDF positive and truncated cases, XLSX positive minimum structure, structurally readable ZIP without complete XLSX identity, recognized non-ZIP disallowed signatures for DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, and gzip, unknown binary, instruction-like permitted text remaining inert, and `ambiguous_file_type` only under the defensive-category rule. The runtime-alignment change must not be silently merged into fixture or detector packages.

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

## P0-05F.2c.1 PDF incomplete shallow-identity category authority

```text
leaf_status: complete after this documentation-only authority-correction package commit
p0_05_package_status: pdf_incomplete_shallow_identity_category_authority_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
audit_result: PDF_AUTHORITY_GAP_OR_CONFLICT_CONFIRMED
audit_result_evidence_class: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2c.1 documentation-only authority-correction boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 9488e533b814bb0597d2d8cdb6ef34b177282784
starting_tree: clean tracked and untracked
owner_authorized_policy: block
owner_authorized_category: truncated_or_malformed_type
owner_authorized_scope: pdf_shallow_identity_block_only
owner_authorized_result_evidence_class: USER_CONFIRMED
complete_pdf_shallow_identity_rule: extension .pdf; declared MIME application/pdf; ASCII %PDF- begins at byte offset zero; ASCII %%EOF occurs within the final 1024 bytes
complete_pdf_identity_result: allow / type_agreement_pass / type_agreement_pass_only
classification_precedence: complete PDF shallow identity is evaluated first; a complete PDF shallow identity returns allow / type_agreement_pass; only PDF-signalling bytes that fail the complete shallow-identity rule are classified as truncated_or_malformed_type; only bytes that establish neither complete PDF identity nor narrowly defined incomplete PDF signalling may proceed to other applicable deterministic rows or the residual unknown_binary fallback
incomplete_pdf_row_position: after complete PDF shallow identity and before residual unknown_binary
incomplete_pdf_signalling_definition: extension .pdf plus declared MIME application/pdf plus one of the four owner-authorized byte-condition families
authorized_byte_condition_a: ASCII %PDF- exists but begins after byte offset zero
authorized_byte_condition_b: byte stream begins at byte offset zero with exact four ASCII bytes %PDF represented by 25 50 44 46, but does not contain required following ASCII hyphen byte 2D at that position
authorized_byte_condition_c: ASCII %PDF- begins at byte offset zero, but ASCII %%EOF is absent
authorized_byte_condition_d: ASCII %PDF- begins at byte offset zero and ASCII %%EOF exists, but no %%EOF occurrence is within the final 1024 bytes
condition_b_non_generalization: not %P, not %PD, not arbitrary percent-prefixed bytes, not arbitrary PDF-like bytes, not arbitrary bytes merely named .pdf, and not arbitrary bytes merely declaring application/pdf
existing_five_fixture_pdf_corpus_unchanged: true
existing_four_negative_fixture_expectations_grounded_by_current_contract_authority: true
complete_pdf_shallow_identity_positive_allow_path_preserved: true
no_production_detector_behavior_implemented: true
tests_changed: false
fixtures_changed: false
production_code_changed: false
runtime_behavior_changed: false
repository_contract_changed: true
execplan_changed: true
dependencies_manifests_lockfiles_changed: false
database_cloud_credentials_production_real_data: not accessed or modified
current_state_update: not performed
implementation_baseline_update: not performed
p0_05f_2d1_started: false
push_or_deployment: not performed
tests_run: not run; documentation-only authority-correction package
git_diff_check: passed after edit
git_diff_cached_check: passed after staging
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan only
package_commit: report after commit; a commit cannot contain its own SHA
deployed_kai_schema_compatibility: NOT_CONFIRMED
live_upload_readiness: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.2c.1 documentation-only authority-correction commit; do not implement detectors, modify fixtures, modify tests, run tests, begin P0-05F.2d1, change runtime behavior, touch Current State or Implementation Baseline, use database/cloud/production behavior, push, deploy, or begin another leaf
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
the detected type is a permitted P0 type, not MZ, ELF, RAR 4, RAR 5, 7z,
gzip, or another separately recognized non-permitted binary signature.

standalone_archive_or_non_xlsx:
structurally readable ZIP without complete XLSX identity.

ambiguous_file_type:
one different permitted byte-established type is deterministically identified;
multiple permitted types do not remain plausible.

unknown_binary:
the bytes are deterministically identified as a permitted PDF or XLSX type.
```

Boundary with disallowed signatures: a recognized disallowed signature continues to block as `disallowed_binary_signature` regardless of permitted extension or declared MIME. `declared_type_mismatch` is not broadened to absorb MZ, ELF, RAR 4, RAR 5, 7z, gzip, another separately recognized non-permitted binary signature, readable non-XLSX ZIP, malformed or truncated ZIP/XLSX-signalling bytes, or unknown binary cases. This decision applies only where the byte-established type is itself a permitted P0 type and its complete committed shallow identity is satisfied.

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

## P0-05F.1C unified readable non-XLSX ZIP classification

```text
leaf_status: complete after this documentation-only owner-decision package commit
p0_05_package_status: unified_readable_non_xlsx_zip_classification_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
owner_directed_leaf_scope: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.1C documentation-only owner-decision boundary
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 48b7e4286d20e18be20c294325804f3a84004c50
starting_tree: clean
preflight_owner_authorities_present: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1, OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1, and OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
preflight_completed_read_only_zip_category_audit_present: true
preflight_equivalent_zip_classification_owner_decision_already_committed: false
preflight_stopped_p0_05f_2d1_attempt_made_no_changes: true
pre_edit_contract_blocks_inspected: detected permitted-type contradiction exclusions; XLSX candidate rule; XLSX central-directory rule; positive/missing/malformed ZIP fixture boundaries; generic and standalone ZIP coverage paragraph; recognized disallowed-signature paragraph; deterministic block-outcome table
pre_edit_corpus_constructor_inspected: fixture helper in __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js unconditionally assigned extension ".xlsx" and declared_mime "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
pre_edit_corpus_fixtures_inspected: XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA; XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML; XLSXZIP-P0-05F-009-BLOCK-STANDALONE-ZIP-SIGNATURE
fixture_007_current_metadata: .xlsx plus application/vnd.openxmlformats-officedocument.spreadsheetml.sheet from shared construction
fixture_008_current_metadata: .xlsx plus application/vnd.openxmlformats-officedocument.spreadsheetml.sheet from shared construction
fixture_009_current_metadata: .xlsx plus application/vnd.openxmlformats-officedocument.spreadsheetml.sheet from shared construction
fixture_corpus_modified_by_this_package: false
complete_xlsx_identity_mapping: complete committed XLSX shallow identity establishes permitted XLSX; .xlsx plus XLSX MIME allows as type_agreement_pass; another internally agreeing permitted P0 metadata type blocks as declared_type_mismatch
readable_zip_without_complete_xlsx_identity_mapping: block / standalone_archive_or_non_xlsx for otherwise permitted XLSX metadata and otherwise permitted non-XLSX P0 metadata
malformed_or_truncated_zip_xlsx_signalling_mapping: block / truncated_or_malformed_type
recognized_disallowed_signature_set: DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, gzip
standalone_zip_removed_from_disallowed_binary_signature_authority: true
unsupported_metadata_boundary: unsupported extension or declared MIME remains block / unsupported_file_type; mixed unsupported metadata plus ZIP bytes not determined by this owner decision
unknown_binary_boundary: non-text bytes matching no permitted binary type, no readable ZIP/non-XLSX archive classification, and no recognized disallowed signature block as unknown_binary
cases_a_c_collapse: Case A readable arbitrary ZIP with permitted non-XLSX metadata and Case C recognized standalone-ZIP signature with permitted non-XLSX metadata are one semantic case under the committed P0 signal model when complete XLSX identity is absent
overlapping_contract_mappings_removed: standalone ZIP removed from recognized disallowed-signature authority; deterministic outcome table now has one readable ZIP without complete XLSX identity row and a separate malformed/truncated ZIP/XLSX row
category_reachability_after_amendment: complete XLSX identity reaches permitted XLSX; structurally readable ZIP without complete XLSX identity reaches standalone_archive_or_non_xlsx; malformed or truncated ZIP/XLSX-signalling bytes reach truncated_or_malformed_type; MZ, ELF, RAR 4, RAR 5, 7z, and gzip reach disallowed_binary_signature; unsupported metadata reaches unsupported_file_type; residual unmatched non-text binary reaches unknown_binary
fixture_008_recorded_status: current metadata, description, and standalone_archive_or_non_xlsx category are consistent with the unified ZIP classification
fixture_007_recorded_status: ID and description claim non-XLSX metadata, but the constructor supplies XLSX metadata; it therefore does not currently prove the intended permitted non-XLSX readable-ZIP case
fixture_009_recorded_status: ID emphasizes standalone ZIP signature, but committed metadata and category describe the same XLSX-metadata readable-non-XLSX case; the name is misleading and does not represent a separate category
constructor_limitation_recorded: current constructor cannot express the intended metadata variation because it supplies XLSX metadata unconditionally
fixture_name_reconciliation_status: recorded only; no fixture, fixture ID, answer key, test, corpus, detector, production code, runtime MIME behavior, route, service, manifest, lockfile, Current State, or Implementation Baseline changed
tests_or_static_verifiers_run: not run; no fresh inspection identified an existing directly affected static verifier that validates this exact amended authority
git_diff_check: passed after edit
git_diff_cached_check: passed after staging
git_diff_cached_stat: inspected after staging
git_diff_cached: inspected before commit
complete_diff_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md and this living ExecPlan only
package_commit: report after commit; a commit cannot contain its own SHA
database_cloud_credentials_production_real_data: not accessed or modified
dependencies_or_lockfiles_changed: false
runtime_mime_allowlist_changed: false
production_code_changed: false
detector_code_changed: false
fixtures_tests_answer_keys_changed: false
current_state_update: not performed
implementation_baseline_update: not performed
push_or_deployment: not performed
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single P0-05F.1C documentation-only package commit; do not begin or resume P0-05F.2d1
```

## P0-05F.1C.1 living ExecPlan ZIP-authority reconciliation

```text
leaf_status: complete after this documentation-only reconciliation package commit
p0_05_package_status: living_execplan_zip_authority_reconciled
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 39292249d791e509e7b07c616114d43dfed07a20
authorized_file: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
contract_source_of_truth_decision_identifier: OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1
stale_active_p0_05f_1_statements_found: old three-case ZIP coverage summary; standalone ZIP in recognized disallowed-signature set; overlapping deterministic outcome rows; future fixture-corpus standalone-ZIP/disallowed wording
stale_active_p0_05f_1b_statements_found: standalone ZIP in disallowed_binary_signature category exclusion; standalone ZIP in disallowed-signature boundary exclusion
final_recognized_disallowed_signature_set: DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, gzip
final_readable_zip_mapping: structurally readable ZIP without complete XLSX identity -> block / standalone_archive_or_non_xlsx
final_malformed_truncated_zip_mapping: malformed or truncated ZIP/XLSX-signalling bytes -> block / truncated_or_malformed_type
cases_a_c_collapse_retained: true
contract_changed: false
fixtures_changed: false
tests_changed: false
runtime_behavior_changed: false
verification_commands: git status --short --branch; git rev-parse HEAD; rg -n "OWNER_DECISION\\.P0_05F\\.ZIP_CLASSIFICATION_BOUNDARY_V1|Generic and standalone ZIP coverage|standalone ZIP|recognized disallowed|ZIP without minimum XLSX structure|disallowed_binary_signature|standalone_archive_or_non_xlsx|P0-05F\\.1C|P0-05F\\.1B" Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; sed -n '180,312p' Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; sed -n '960,1045p' KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; sed -n '1448,1560p' KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; sed -n '1560,1628p' KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; rg -n "standalone ZIP|recognized disallowed|Generic and standalone ZIP coverage|ZIP without minimum XLSX structure|disallowed_binary_signature|standalone_archive_or_non_xlsx" KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; git diff --check; git diff --cached --check; git diff --cached --stat; git diff --cached
package_boundary: P0-05F.1C.1 documentation-only living ExecPlan reconciliation; no contract, owner decision, fixture, test, answer key, production code, runtime configuration, Current State, Implementation Baseline, dependency, push, deployment, database, cloud, credential, production, or real client data change
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

The internal exact-version verifier is a service-private prerequisite for later `confirmUpload` orchestration. It receives only trusted service-controlled facts: storage adapter, provider-neutral exact object-version ID, declared lowercase SHA-256 checksum, expected byte size, hash algorithm, and optional abort signal. It does not authorize an actor, read metadata or lifecycle records, accept public request payloads, perform lifecycle transitions, shape the final confirmation response, or call production/database/cloud services.

The verifier calls only `openObjectVersionReadStream({ objectVersionId, signal? })`, validates exact storage identity and storage size before consuming the stream, releases a valid `byte_source` with mandatory `try/finally`, streams chunks through Node SHA-256 without whole-object buffering, verifies streamed size against both storage size and trusted expected size, and compares the computed lowercase checksum to the trusted declared checksum. It returns only `{ objectVersionId, verifiedChecksum, verifiedSizeBytes }` on success and sanitized structured failures otherwise. `confirmUpload` orchestration remains next; P0-06B and Gate A remain unchanged and unauthorized.

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

### Owner-approved synthetic upload-lifecycle repository authority

```text
decision_identifier:
  OWNER_DECISION.P0_06A.SYNTHETIC_UPLOAD_LIFECYCLE_REPOSITORY_V1

decision_evidence:
  USER_CONFIRMED

authority_status:
  active_documentation_authority

implementation_status:
  complete
implementation_commit:
  dd8d8fa3ab2682ce327e1e54c4bedbef894bc3c6

authority_commit_scope:
  Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

planned_implementation_location:
  Backend/kai/upload/

repository_operations:
  createReservedUploadLifecycle
  getUploadLifecycle
  transitionUploadLifecycle

state_authority:
  KAI_SPRINT2_P0_UPLOAD_STATES

synthetic_record_field_count:
  12

file_policy_status_authority:
  existing committed intake_files.file_policy_status contract

file_policy_status_writes:
  pending at creation
  blocked when entering policy_blocked

transition_edge_count:
  13

sole_post_confirmation_edge:
  confirmed -> policy_blocked

terminal_upload_states:
  policy_blocked
  abandoned
  expired

creation_replay:
  identical scoped identity returns replayed true without mutation

transition_replay:
  exact target-state replay with identical transition facts returns replayed true without mutation

transition_evaluation_order:
  validate input
  scoped lookup
  exact replay
  non-replay pre-confirmation expiry enforcement
  expected-state check
  authorized-edge check
  atomic transition

expiry_replay_rule:
  exact replay is evaluated before expiry; new pre-confirmation progression at or after expiry is denied except transition to expired

conflict_mapping:
  creation conflict, stale expected state, and conflicting replay facts use conflict_current_state_changed / 409

error_vocabulary:
  validation_blocker
  state_transition_denied
  conflict_current_state_changed
  not_found

new_error_codes_created:
  false

clock_source:
  caller-supplied only

system_clock_read_authorized:
  false

reservation_expiry:
  exactly 24 hours after caller-supplied creation time

organization_scope:
  organization_id plus intake_file_id

cross_organization_disclosure:
  forbidden; missing and nondisclosable records return identical not_found / 404

durable_schema_claim:
  false

database_or_cloud_binding_changed:
  false

runtime_config_changed:
  false

tests_changed:
  false

route_or_service_changed:
  false

storage_adapter_changed:
  false

timeout_or_concurrency_behavior_changed:
  false

audit_metric_or_executor_binding_changed:
  false

delete_or_retention_added:
  false

p0_06b_status:
  Gate-A-blocked

next_package_or_stop_condition:
  OWNER-DIRECTED STOP after this two-file documentation-only authority commit; do not begin implementation or another leaf without separate owner authorization
```

## P0-06A completion

### P0-06A local upload orchestration service package evidence

```text
package: P0-06A local upload orchestration service
authorization: owner-authorized bounded service-layer orchestration package
implementation_status: CORRECTED_NOT_STAGED
service_operation: uploadReservedIntakeFile
service_path: Backend/kai/services/kaiIntakeService.js
focused_test_path: __tests__/kai-sprint2-intake-service.spec.js
contract_path: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md
production_composition: unchanged

fresh_mode: implemented
resume_mode: not_authorized_removed
caller_supplied_recovery_removed: true
one_attempt_per_reservation: true
same_reservation_retry_after_upload_started: prohibited
synthetic_recovery_or_resume: not_authorized
recovery_identity_returned_to_callers: false
durable_bound_recovery: deferred_to_P0_06B_Gate_A
request_upload_url_semantics_changed: false
confirm_upload_semantics_changed: false
storage_adapter_injection: supplied exclusively through dependencies.storageAdapter
service_constructs_local_adapter_from_root_directory: false
service_level_object_version_id_factory: removed
provider_neutral_result_boundary:
  object_version_id_type: primitive_string_only
  object_version_id_pattern: ^ov_[a-f0-9]{32}$
  size_bytes: non_negative_safe_integer
  service_independently_validates_storage_success: true
  boxed_string_object_version_id_rejected: focused test passed
  object_with_matching_toString_object_version_id_rejected: focused test passed
  object_identity_exposed_on_invalid_result: false
post_start_failure_contract:
  thrown_initial_transition_requires_new_reservation_without_storage: true
  malformed_initial_success_requires_new_reservation_without_storage: true
  malformed_initial_success_exposes_repository_diagnostic: false
  initial_success_envelope_validated_before_storage: true
  initial_identity_state_and_object_version_validated_before_storage: true
  returned_storage_failure_requires_new_reservation: true
  thrown_storage_failure_requires_new_reservation: true
  malformed_storage_success_requires_new_reservation: true
  returned_final_transition_failure_requires_new_reservation: true
  thrown_final_transition_failure_requires_new_reservation: true
  malformed_final_success_requires_new_reservation: true
  final_success_envelope_validated_before_success_return: true
  final_identity_state_and_object_version_validated_before_success_return: true
  object_identity_exposed_on_failure: false

ordering_evidence:
  feature_gates_before_repository_or_storage: focused test passed
  authorization_before_repository_or_storage: focused test passed
  no_adapter_injection_fails_closed_before_lifecycle: focused test passed
  local_root_dependency_does_not_construct_adapter: focused test passed
  reserved_to_upload_started_before_storage: focused test passed
  thrown_initial_transition_sanitized_before_storage: focused test passed
  malformed_initial_success_rejected_before_storage: focused test passed
  initial_wrong_organization_rejected_before_storage: focused test passed
  initial_wrong_intake_file_rejected_before_storage: focused test passed
  initial_wrong_state_rejected_before_storage: focused test passed
  initial_assigned_object_version_rejected_before_storage: focused test passed
  storage_before_uploaded_unconfirmed: focused test passed
  replayed_upload_started_blocks_new_storage_and_requires_new_reservation: focused test passed
  storage_failure_requires_new_reservation_without_final_transition: focused test passed
  malformed_object_version_id_rejected_after_upload_started: focused test passed
  boxed_string_object_version_id_rejected_after_upload_started: focused test passed
  object_with_matching_toString_object_version_id_rejected_after_upload_started: focused test passed
  path_like_object_version_id_never_returned: focused test passed
  malformed_size_bytes_rejected_after_upload_started: focused test passed
  malformed_storage_success_requires_new_reservation: focused test passed
  thrown_storage_error_sanitized_and_requires_new_reservation: focused test passed
  final_transition_failure_exposes_no_object_identity_and_requires_new_reservation: focused test passed
  final_missing_record_rejected_without_object_identity: focused test passed
  final_non_boolean_replayed_rejected_without_object_identity: focused test passed
  final_wrong_organization_rejected_without_object_identity: focused test passed
  final_wrong_intake_file_rejected_without_object_identity: focused test passed
  final_wrong_state_rejected_without_object_identity: focused test passed
  final_wrong_object_version_id_rejected_without_object_identity: focused test passed
  thrown_final_transition_error_sanitized_and_requires_new_reservation: focused test passed
  caller_supplied_recovery_rejected_without_lifecycle_or_storage: focused test passed
  completed_object_compensation_deletion_prohibited: focused test passed

test_evidence:
  DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js: 41 passed, 0 failed
  DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-storage-boundary.spec.js: 88 passed, 0 failed
  DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test: sandbox run failed with 7 listener EPERM failures on 127.0.0.1 after 686 passed; listener-capable rerun passed with 741 passed, 0 failed

unauthorized_changes:
  storage_adapter_changed: false
  lifecycle_repository_changed: false
  routes_or_listeners_changed: false
  production_composition_changed: false
  schema_or_sql_changed: false
  confirmation_or_hashing_added: false
  p0_06b_or_gate_a_state_changed: false
```

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


## P0-05F.2a1 XLSX/ZIP metadata-boundary fixture reconciliation

```text
leaf_status: complete after this bounded fixture-only reconciliation package commit
p0_05_package_status: xlsx_zip_metadata_boundary_fixture_reconciled
implementation_status: fixture_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 5b58e34f46a3f9d8eebdf3e981b08682f72025e3
contract_authority: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1
changed_files: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js; __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
constructor_correction: shared XLSX/ZIP fixture constructor no longer supplies implicit .xlsx extension or XLSX declared MIME; every retained fixture row must explicitly provide extension and declared_mime
original_historical_fixture_count: 13
current_reconciled_fixture_count: 12
fixture_007_corrected_metadata: extension .txt; declared_mime text/plain; metadata pair independently permitted by committed extension/MIME matrix; readable ZIP remains block / standalone_archive_or_non_xlsx
fixture_008_preserved_role: retained as .xlsx plus application/vnd.openxmlformats-officedocument.spreadsheetml.sheet readable ZIP missing complete XLSX identity; expected block / standalone_archive_or_non_xlsx
fixture_009_removed: XLSXZIP-P0-05F-009-BLOCK-STANDALONE-ZIP-SIGNATURE removed without renaming, repurposing, replacement, or standalone-ZIP-signature category creation
retained_fixture_ids_unchanged: XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX; XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES; XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS; XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK; XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK; XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP; XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA; XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML; XLSXZIP-P0-05F-010-BLOCK-TRUNCATED-LOCAL-SIGNATURE; XLSXZIP-P0-05F-011-BLOCK-NO-CENTRAL-DIRECTORY; XLSXZIP-P0-05F-012-BLOCK-OUT-OF-BOUNDS-CD-OFFSET; XLSXZIP-P0-05F-013-BLOCK-TRUNCATED-CD-RECORD
retained_byte_constructions_preserved: direct diff inspection shows retained fixture entries, ZIP byte builders, malformed ZIP builders, structural defects, expected policies, and expected categories unchanged; fixture 007 metadata is the only retained fixture-semantic correction
focused_and_broader_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 9 passed, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js - 15 passed, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit known localhost listen EPERM, unchanged localhost-capable rerun passed 513 tests, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit known localhost listen EPERM, unchanged localhost-capable rerun passed 618 tests, 0 failed
git_checks: git diff --check passed; git diff --cached --check, staged stat, and staged diff inspected before commit
package_boundary: P0-05F.2a1 bounded fixture-only reconciliation; contract, owner decisions, production detector/runtime code, other fixture corpora, other tests, manifests, lockfiles, Current State, Implementation Baseline, database/cloud/production behavior, push, and deployment unchanged
```


## P0-05F.1D recognized disallowed-signature byte authority

```text
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 2d3202976ed88a5de8d725132a5279a134fedfae
authorized_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
decision_identifier: OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES
committed_family_byte_offset_pairs: DOS/PE MZ -> 4D 5A at byte offset zero; ELF -> 7F 45 4C 46 at byte offset zero; gzip -> 1F 8B at byte offset zero; 7z -> 37 7A BC AF 27 1C at byte offset zero; RAR 4 -> 52 61 72 21 1A 07 00 at byte offset zero; RAR 5 -> 52 61 72 21 1A 07 01 00 at byte offset zero
rar_4_rar_5_distinctness_rule: RAR 4 and RAR 5 share only the first six bytes; the shared six-byte prefix alone is not a match, RAR 4 requires the complete seven-byte sequence ending 00, RAR 5 requires the complete eight-byte sequence ending 01 00, RAR 4 must not be matched by the RAR 5 prefix, and RAR 5 must not be classified as RAR 4 from the shared prefix
mz_two_byte_prefix_scope_limit: DOS/PE MZ recognition is limited to the two-byte offset-zero prefix 4D 5A and does not establish DOS/PE header traversal, PE structure validation, or inspection beyond that committed prefix
fixtures_changed: false
tests_changed: false
runtime_behavior_changed: false
verification_commands: git diff --check; git diff --cached --name-only; git diff --cached --check; git diff --cached; git show --stat --oneline HEAD; git status --short --branch --untracked-files=all
package_boundary: P0-05F.1D documentation-only recognized disallowed-signature byte authority; no fixture, test, production code, runtime configuration, lockfile, Current State, Implementation Baseline, dependency, database, cloud, push, deployment, or P0-05F.2d1 change
```

## P0-05F.2d1 recognized disallowed-signature fixture corpus

```text
leaf_status: complete after this bounded synthetic fixture-and-test package commit
p0_05_package_status: recognized_disallowed_signature_fixture_corpus_added
implementation_status: fixture_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 69119d528c161166696722636ec23bc518a9b4aa
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F fixture-corpus/test/documentation boundary; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.2d1 bounded recognized disallowed-signature fixture corpus only; no P0-05F.2a1, P0-05F.2c, P0-05F.2c.1, byte-authority, detector, unknown-binary, production runtime, dependency, route, service, or existing-corpus work
contract_authority_inspected: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md P0-05F.1 extension, declared MIME, signature, and structural-type agreement; deterministic block outcomes; OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES; declared file-MIME matrix
owner_decision_authority_found_in_contract: OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES; OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 for metadata isolation
created_corpus_path: __tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js
created_focused_test_path: __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js
exact_covered_signature_families: DOS/PE MZ; ELF; gzip; 7z; RAR 4; RAR 5
exact_committed_bytes_and_offsets: DOS/PE MZ -> 4D 5A at byte offset zero; ELF -> 7F 45 4C 46 at byte offset zero; gzip -> 1F 8B at byte offset zero; 7z -> 37 7A BC AF 27 1C at byte offset zero; RAR 4 -> 52 61 72 21 1A 07 00 at byte offset zero; RAR 5 -> 52 61 72 21 1A 07 01 00 at byte offset zero
fixture_count: 6
metadata_isolation_pairing: .txt plus text/plain
metadata_isolation_pairing_authority: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md declared file-MIME matrix under OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
expected_deterministic_result: block / disallowed_binary_signature / type_agreement_block_only
rar_4_rar_5_distinction: actual buffers share first six bytes 52 61 72 21 1A 07; RAR 4 byte seven is 00; RAR 5 bytes seven and eight are 01 00; RAR 5 does not match the complete RAR 4 sequence at offset zero
synthetic_corpus_only_limitation: corpus rows contain only the minimum committed signature bytes, are synthetic inert corpus-only data, do not execute, decompress, parse, validate executable/archive formats, scan malware, prove parser safety, prove upload acceptance, or claim runtime detector behavior
focused_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js - 6 passed, 0 failed
dependent_focused_test_results: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js - 62 passed, 0 failed
broader_test_results_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit known localhost listen EPERM; unchanged localhost-capable rerun passed 519 tests, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit known localhost listen EPERM; unchanged localhost-capable rerun passed 624 tests, 0 failed
broader_test_results_after_final_file_state: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - localhost-capable final-state rerun passed 519 tests, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - localhost-capable final-state rerun passed 624 tests, 0 failed
git_diff_verification: git diff --check and git diff --cached --check report after final file state
changed_file_scope: __tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js; __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
package_exclusions: no unknown-binary fixture; no ZIP/XLSX/PDF fixture; no ambiguous/truncated/malformed/standalone archive fixture; no existing corpus or existing test modification; no contract change; no production code, detector, route, service, dependency, manifest, lockfile, Current State, Implementation Baseline, database, cloud, credential, deployment, or feature-flag change
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F.2d2 residual unknown-binary fixture authority

```text
leaf_status: complete after this bounded documentation-only authority package commit
p0_05_package_status: residual_unknown_binary_fixture_authority_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 45fce2e36b46fa30affcf97df1999cb594ffc350
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2d2 documentation-only authority boundary; no Node or npm command run; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.2d2 bounded residual unknown-binary fixture authority only; no fixture, test, detector, production runtime, dependency, route, service, existing-corpus, or later-package work
contract_authority_inspected: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md P0-05F.1 extension, declared MIME, signature, and structural-type agreement; deterministic block outcomes; residual unknown_binary rule; OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES; PDF incomplete shallow-identity authority; ZIP classification boundary
owner_decision_authority: USER_CONFIRMED OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1
authorized_future_fixture_package: P0-05F.2d3 only
authorized_bytes: 00 01 at byte offset zero
authorized_metadata_pairing: .pdf plus application/pdf
expected_deterministic_result: block / unknown_binary / unknown_binary_block_only
created_scope_label: unknown_binary_block_only
higher_priority_exclusions: complete PDF identity is not established because bytes are not %PDF- at offset zero with %%EOF in the final 1024 bytes; narrowly defined incomplete PDF signalling is not established because bytes are not the %PDF prefix 25 50 44 46; complete XLSX identity, readable ZIP, and non-XLSX ZIP are not established because bytes are not 50 4B 03 04; malformed or truncated ZIP/XLSX signalling is not established; recognized disallowed signature is not established because bytes are not 4D 5A, 7F 45 4C 46, 1F 8B, 37 7A BC AF 27 1C, 52 61 72 21 1A 07 00, or 52 61 72 21 1A 07 01 00; another complete permitted identity, detected permitted-type contradiction, declared_type_mismatch, ambiguous_file_type, and unsupported_file_type are not established
relationship_to_existing_residual_rule: proves reachability of the existing residual unknown_binary category only after all committed higher-priority identities, signatures, structural classifications, malformed/truncated signalling, mismatch, ambiguity, and unsupported metadata outcomes are excluded
text_gate_non_regression: does not alter P0-05C, P0-05D, or P0-05E; 00 01 under .txt, .md, or .csv metadata remains governed by the existing text-byte gate, not this decision
non_generalization_boundary: no partial-signature policy is authorized; no additional unknown-binary fixture family is authorized; establishes nothing about malware, parser safety, archive validity, or upload eligibility
package_sequence: P0-05F.2d2 residual authority -> P0-05F.2d3 one-fixture corpus plus focused test -> P0-05F.2e completeness proof -> P0-05F.3 read-only detector measurement -> P0-05F.4 pure unwired detector only if later authorized
p0_05f_2d3_status: blocked until this P0-05F.2d2 documentation-only authority commit exists
changed_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
verification: git diff --check; git diff --cached --check; git diff --cached --stat; staged grep confirms unknown_binary_block_only, 00 01, and RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1 in the contract
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F.2d3 residual unknown-binary fixture corpus

```text
leaf_status: complete after this bounded one-fixture corpus-and-test package commit
p0_05_package_status: residual_unknown_binary_fixture_corpus_added
implementation_status: fixture_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: d3e154bb958c4fa3ed403f79c531d3faea6d49f7
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2d3 fixture-corpus/test/documentation boundary; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.2d3 bounded residual unknown-binary fixture corpus only; no contract, owner-decision, detector, production runtime, dependency, route, service, existing-corpus, existing-test, P0-05F.2e, or later-package work
contract_authority_inspected: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1; OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 for independent .pdf plus application/pdf metadata pairing
owner_decision_authority_consumed: TOOL_VERIFIED OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1
created_corpus_path: __tests__/support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js
created_focused_test_path: __tests__/kai-sprint2-residual-unknown-binary-fixture-corpus.spec.js
fixture_count: 1
fixture_id: UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001
fixture_bytes: 00 01 at byte offset zero
fixture_metadata: .pdf plus application/pdf
fixture_metadata_pairing_authority: TOOL_VERIFIED committed extension/MIME matrix OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1 independently permits .pdf plus application/pdf
expected_deterministic_result: block / unknown_binary / unknown_binary_block_only
expected_category: unknown_binary
scope_note: unknown_binary_block_only
synthetic_corpus_only_limitation: fixture is synthetic inert corpus-only data and does not prove malware status, parser safety, archive validity, upload acceptance, source eligibility, usable document status, complete PDF validity, readable ZIP/XLSX validity, or production detector behavior
exclusion_proofs: actual buffer bytes 00 01 are not %PDF- at offset zero and have no %%EOF basis for complete PDF identity; are not the incomplete PDF prefix 25 50 44 46; are not readable ZIP/XLSX local-file-header bytes 50 4B 03 04; are not any committed recognized disallowed signature 4D 5A, 7F 45 4C 46, 1F 8B, 37 7A BC AF 27 1C, 52 61 72 21 1A 07 00, or 52 61 72 21 1A 07 01 00; contain prohibited text controls 00 and 01 and therefore do not establish a permitted CSV/MD/TXT text identity; do not establish another complete permitted PDF or XLSX identity
focused_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-residual-unknown-binary-fixture-corpus.spec.js - initial new-test assertion corrected, final rerun 6 passed, 0 failed
dependent_focused_test_results: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js - 68 passed, 0 failed
sprint2_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit known localhost listen EPERM; unchanged localhost-capable rerun passed 525 tests, 0 failed; final-state localhost-capable rerun after ExecPlan evidence update passed 525 tests, 0 failed
full_repo_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit known localhost listen EPERM; unchanged localhost-capable rerun passed 630 tests, 0 failed; final-state localhost-capable rerun after ExecPlan evidence update passed 630 tests, 0 failed
git_diff_check: git diff --check reports clean after broader suites and before ExecPlan evidence update; rerun after final file state before staging
changed_file_scope: __tests__/support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js; __tests__/kai-sprint2-residual-unknown-binary-fixture-corpus.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
package_exclusions: contract unchanged; owner decisions unchanged; existing corpora unchanged; existing tests unchanged; no detector code, production code, runtime behavior, dependency, manifest, lockfile, Current State, Implementation Baseline, database, cloud, credential, deployment, push, P0-05F.2e, or later-package change
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F.2e final combined completeness proof

```text
leaf_status: complete after this bounded combined-completeness proof package commit
p0_05_package_status: final_combined_fixture_completeness_proof_added
implementation_status: focused_test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: cf912d4dad17aac6cd1c04f095c73d40d6e7c77d
applicable_repository_instructions: root AGENTS.md only; changes remain inside the approved P0-05F.2e mechanical-artifact/documentation boundary; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.2e bounded final combined completeness proof only; no contract, existing fixture corpus, fixture helper, focused corpus test, production code, detector code, dependency, Current State, Implementation Baseline, P0-05F.3, or P0-05F.4 change
committed_17_item_checklist: allowed extension/MIME pairings; grounded cross-type mismatches; uppercase extension normalization; unsupported extensions; unsupported MIME values; application/json rejection; application/octet-stream declared-MIME rejection; MIME-parameter rejection; empty text-family cases; PDF positive and truncated cases; XLSX positive minimum structure; readable ZIP without complete XLSX identity; renamed ZIP; recognized MZ, ELF, RAR 4, RAR 5, 7z, and gzip signatures; unknown binary; instruction-like permitted text remaining inert; ambiguous_file_type under the defensive-category rule
created_focused_test_path: __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js
imported_corpora: __tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js; __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js; __tests__/support/kaiSprint2PdfShallowIdentityFixtureCorpus.js; __tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js; __tests__/support/kaiSprint2ResidualUnknownBinaryFixtureCorpus.js; __tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js; __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js; __tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js; __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
excluded_filename_corpus: __tests__/support/kaiSprint2FilenameFixtureCorpus.js not imported; filename-safety classifications are outside this proof
verified_coverage_result: all 17 committed checklist items are covered by actual committed fixture fields and IDs, except ambiguous_file_type, which is covered as defensive currently unexercised authority rather than by a fixture
defensive_ambiguous_file_type_treatment: contract authority says ambiguous_file_type is fail-closed defensive; no fixture is required when ambiguity is unreachable by construction; absence does not make the corpus incomplete; no contrived ambiguous fixture was introduced
fixture_id_uniqueness: all 101 imported fixture IDs are unique across the imported proof corpora
authority_validation: authority tokens used by mapped fixtures, including secondary text-byte and metadata-pairing authorities, resolve to current committed contract-grounded authority
proof_limitations: no detector, runtime, upload-acceptance, malware, parser-safety, semantic-validity, database, cloud, deployment, or source-eligibility claim
changed_file_scope: __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_test_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - initial new-test wording/count assertions corrected, final rerun 11 passed, 0 failed
dependent_focused_test_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js __tests__/kai-sprint2-residual-unknown-binary-fixture-corpus.spec.js - 74 passed, 0 failed
sprint2_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit known localhost listen EPERM only; unchanged localhost-capable rerun passed 536 tests, 0 failed
full_repo_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit known localhost listen EPERM only; unchanged localhost-capable rerun passed 641 tests, 0 failed
final_state_rerun_requirement: because this ExecPlan evidence section changed after broader suite runs, rerun the affected focused proof, complete Sprint 2 suite, and full repository suite against final file state before staging
final_state_test_results: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - 11 passed, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - sandbox final-state rerun hit known localhost listen EPERM only, unchanged localhost-capable final-state rerun passed 536 tests, 0 failed; DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox final-state rerun hit known localhost listen EPERM only, unchanged localhost-capable final-state rerun passed 641 tests, 0 failed
git_diff_check: git diff --check passed after final file state before staging
git_cached_diff_check: git diff --cached --check passed after staging exactly the two authorized files
package_exclusions: contract unchanged; existing corpora unchanged; fixture helpers unchanged; existing focused corpus tests unchanged; production code unchanged; detector code unchanged; dependencies unchanged; Current State unchanged; Implementation Baseline unchanged; P0-05F.3 remains unstarted; P0-05F.4 remains unstarted; no push or deployment
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F.3 detector measurement authority

```text
leaf_status: complete after this bounded documentation-only authority package commit
p0_05_package_status: detector_measurement_authority_defined
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: cb5bc5b6ee181a01aeaaa24a638df0c38148a75d
applicable_repository_instructions: root AGENTS.md only; no Node or npm command run; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.3 detector measurement authority definition only; no measurement performed; no P0-05F.4 detector implementation started
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
detector_landscape_inventory: production implementation candidates must include repository modules and composed production paths; Backend/kai/validators/txtMdByteDetector.js is a potential partial text-byte helper if current inspection confirms its reported behavior; Backend/kai/services/kaiIntakeService.js is a production-wired metadata-validation candidate for the metadata capability it actually implements; fixture corpora, test parsers, byte builders, and focused tests are test evidence, not production implementations
capability_complete_definition: complete P0-05F classification capability must cover all committed P0-05F.2e surfaces and return policy, category, scope, and evidence; required coverage includes extension and MIME normalization, allowed extension/MIME pairs, unsupported metadata, cross-type mismatches, text-byte validation, PDF identity, XLSX identity, ZIP classification, recognized disallowed signatures, unknown binary, and defensive ambiguous-file handling
implementation_form_definition: implementation form is measured separately and determines whether a capability-complete candidate is pure and deterministic, unwired to routes and services, free of database, network, filesystem, storage, audit, and other I/O, and suitable as the P0-05F.4 pure unwired detector
criterion_separation: wiring, purity, and I/O do not determine capability completeness; a wired service is not disqualified from capability measurement merely because it is wired or performs I/O; capability completeness and implementation form must not be merged into one criterion
result_taxonomy: COMPLETE_CAPABILITY_PRESENT_TARGET_FORM; COMPLETE_CAPABILITY_PRESENT_NON_TARGET_FORM; COMPLETE_CAPABILITY_ABSENT_WITH_PARTIAL_HELPERS; COMPLETE_CAPABILITY_ABSENT; MEASUREMENT_INCONCLUSIVE
txt_md_detector_treatment: Backend/kai/validators/txtMdByteDetector.js must be measured as a potential partial implementation if current repository inspection confirms its reported behavior; inspection for this authority package found it exports detectTxtMdBytePolicy, accepts Uint8Array byte input, applies UTF BOM and fatal UTF-8/control/lone-CR validation, and returns policy/category/scope/evidence-shaped results for the TXT/MD byte gate only
intake_service_treatment: Backend/kai/services/kaiIntakeService.js must be measured for the metadata capability it actually implements and must not be excluded merely because it is production-wired; metadata-only MIME validation is not capability-complete unless it independently satisfies every committed P0-05F surface
runtime_alignment_drift: separately verified only as documentation evidence that Backend/kai/services/kaiIntakeService.js currently defines ALLOWED_METADATA_ONLY_MIME_TYPES with application/json while the committed P0-05F contract rejects application/json as declared file MIME; this remains runtime-alignment drift only, not a P0-05F.3 or P0-05F.4 measurement result, and the runtime allowlist was not modified
p0_05f_4_handoff: COMPLETE_CAPABILITY_PRESENT_TARGET_FORM blocks P0-05F.4 as duplicate suitable-detector work; COMPLETE_CAPABILITY_PRESENT_NON_TARGET_FORM requires separate owner review to extract, refactor, wrap, or replace; COMPLETE_CAPABILITY_ABSENT_WITH_PARTIAL_HELPERS authorizes a separate P0-05F.4 package to implement the missing complete pure unwired detector while preserving or reusing compatible helpers only where supported by inspection; COMPLETE_CAPABILITY_ABSENT authorizes a separate P0-05F.4 package to implement the complete pure unwired detector; MEASUREMENT_INCONCLUSIVE leaves P0-05F.4 blocked
p0_05f_3_status: remains unperformed; this package defines the future measurement and handoff only and does not certify the current measurement result
p0_05f_4_status: remains unstarted
tests_run: none; documentation-only package per owner instruction
package_exclusions: no tests, fixtures, validators, services, routes, production code, detector code, runtime allowlist, dependency, manifest, lockfile, Current State, Implementation Baseline, database, cloud, credential, deployment, push, P0-05F.3 measurement, or P0-05F.4 implementation change
git_diff_check: git diff --check passed after final documentation-only file state before staging
git_cached_diff_check: git diff --cached --check passed after staging exactly the two authorized files
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F.2a2 XLSX/ZIP authority citation reconciliation

```text
leaf_status: complete after this bounded citation-only reconciliation commit
p0_05_package_status: xlsx_zip_authority_citations_reconciled
implementation_status: fixture_authority_metadata_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 89fe118dc82befc0f1be4e87f34810dce2e7a78c
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: P0-05F.2a2 stale XLSX/ZIP fixture authority citation reconciliation only; no contract, owner-decision, detector, production runtime, dependency, fixture expected policy, fixture expected category, fixture scope, fixture bytes, fixture ZIP structure, fixture ID, fixture count, P0-05F.2e, or later-package work
defect: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js cited dead OWNER_DECISION.P0_05F authority tokens while asserting authority_status contract_grounded
contract_authority_verified: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 181-190 list the live P0-05F owner decisions; lines 310-318 govern XLSX central-directory identity, exact case-sensitive required entries, missing-entry, renamed non-OOXML ZIP, and malformed/truncated ZIP fixture outcomes; lines 320-328 govern readable ZIP without complete XLSX identity, the forbidden standalone-signature distinction, malformed/truncated ZIP/XLSX signalling, and residual ZIP classification boundaries
remap_applied: XLSX_MINIMUM_IDENTITY -> OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1; MISSING_XLSX_ENTRY -> OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1; CASE_SENSITIVE_XLSX_ENTRY -> OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1; RENAMED_NON_OOXML_ZIP -> OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1; STANDALONE_ZIP_SIGNATURE -> OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1; MALFORMED_XLSX_ZIP -> OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1
changed_file_scope: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
post_edit_grep_dead_tokens: rg -n "XLSX_MINIMUM_IDENTITY|MISSING_XLSX_ENTRY|CASE_SENSITIVE_XLSX_ENTRY|RENAMED_NON_OOXML_ZIP|MALFORMED_XLSX_ZIP|STANDALONE_ZIP_SIGNATURE" returned no matches
post_edit_grep_authority_values: corpus authority-map keys and fixture authority values are only OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1 and OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1, both members of the live committed P0-05F decision set
post_edit_grep_contract_grounded_dead_tokens: corpus authority_status contract_grounded remains only on the live authority-map entries and no dead token remains attached
focused_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js - 9 passed, 0 failed
dependent_focused_test_results: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-extension-mime-matrix-fixture-corpus.spec.js __tests__/kai-sprint2-detected-permitted-type-contradiction-fixture-corpus.spec.js __tests__/kai-sprint2-xlsx-zip-fixture-corpus.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-text-type-agreement-fixture-corpus.spec.js __tests__/kai-sprint2-unsupported-extension-mime-fixture-corpus.spec.js __tests__/kai-sprint2-txt-md-byte-fixture-corpus.spec.js __tests__/kai-sprint2-recognized-disallowed-signature-fixture-corpus.spec.js __tests__/kai-sprint2-residual-unknown-binary-fixture-corpus.spec.js - 74 passed, 0 failed
sprint2_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit localhost listen EPERM; unchanged localhost-capable rerun passed 525 tests, 0 failed
full_repo_result_before_execplan_evidence_update: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit localhost listen EPERM; unchanged localhost-capable rerun passed 630 tests, 0 failed
sprint2_result_after_final_file_state: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - localhost-capable final-state rerun passed 525 tests, 0 failed
full_repo_result_after_final_file_state: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - localhost-capable final-state rerun passed 630 tests, 0 failed
git_diff_check_before_execplan_evidence_update: git diff --check reported clean
package_exclusions: contract unchanged; owner decisions unchanged; fixture expected_policy, expected_category, scope, bytes, ZIP structure, IDs, and count unchanged; no detector code; no focused-test change; no P0-05F.2e; no push
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05F classification precedence authority

```text
leaf_status: edited_not_staged
p0_05_package_status: classification_precedence_authority_recorded
implementation_status: documentation_only
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 1f0f16432243f85b96a123b81752c6b38a9804f8
owner_decision_authority: OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
runtime_behavior_changed: false
p0_05f_4_status: unimplemented_and_unstarted
runtime_alignment_leaf_status: complete after this bounded runtime-alignment commit
runtime_alignment_starting_head: ca2909ae9ccd0c95fe1f83e2a95b311635de6851
runtime_alignment_authorized_file_scope: Backend/kai/services/kaiIntakeService.js; __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js; __tests__/kai-sprint2-pass2-route-runtime.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
application_json_declared_mime_removed: true
request_envelope_json_behavior_changed: false
runtime_blocker_vocabulary_changed: false
runtime_blocking_reason: unsupported_mime_type
runtime_status: 422
detector_wiring_changed: false
runtime_declared_mime_allowlist_after_edit: text/csv; application/csv; text/plain
request_envelope_json_preserved: mounted route accepts Content-Type application/json; charset=utf-8 and returns service validation_blocker for declared file MIME application/json, not unsupported_media_type
runtime_blocker_preserved: unsupportedMimeBlocker still uses validator_key VAL-STO-005, object_code mime_type, blocking_reason unsupported_mime_type, error code validation_blocker, and status 422
focused_service_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js - 51 passed, 0 failed
focused_route_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-route-runtime.spec.js - 27 passed, 0 failed
sprint2_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox run hit localhost listen EPERM with 507 passed and 7 failed; exact localhost-capable rerun passed 562 tests, 0 failed
full_repository_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run hit localhost listen EPERM with 612 passed and 7 failed; exact localhost-capable rerun passed 667 tests, 0 failed
next_boundary: continue only under the living ExecPlan package order and owner authorization; do not push or deploy
```


## P0-05F.4 detector-interface authority

```text
decision_evidence: USER_CONFIRMED
edit_verification: TOOL_VERIFIED after documented checks pass
leaf_status: corrected_not_staged
p0_05_package_status: detector_interface_authority_recorded
implementation_status: documentation_only
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 52d4769d52b907a58061beb7057f323887bbdd7f
owner_decision_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
active_package_scope: bounded documentation-only P0-05F.4 detector-interface authority package; no implementation preflight repeated; no detector implementation started
production_module_recorded: Backend/kai/validators/p0FileTypeAgreementDetector.js
production_export_recorded: detectP0FileTypeAgreement
input_recorded: extension, declaredMime, bytes
input_contract_completed: extension_type string; declared_mime_type string; extension_required true; declared_mime_required true; extension_whitespace_trim false; missing_or_non_string_extension throws TypeError; missing_or_non_string_declared_mime throws TypeError; empty_extension and empty_declared_mime are valid input and block as unsupported_file_type; test adapters convert missing extension or declared MIME to empty string before invocation
filename_input: prohibited
extension_signal: already-selected terminal extension signal; filename parsing and filename-hazard policy remain outside this detector
bytes_type: Uint8Array
bytes_mutation: prohibited
non_Uint8Array: throw TypeError
result_contract: every detector result is a frozen object containing exactly policy, category, scope, evidence
evidence_allowlist_exclusions: raw bytes; decoded text; file content; filesystem paths; storage identifiers; signed URLs; credentials; arbitrary objects; unbounded arrays
evaluation_order_preserved: OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1 unchanged; order remains recognized MZ/ELF/gzip/7z/RAR 4/RAR 5 signature; unsupported extension or declared MIME; supported extension/MIME disagreement; complete permitted PDF or XLSX identity; readable non-XLSX ZIP or malformed/truncated ZIP/XLSX classification; incomplete PDF signalling; TXT/MD/CSV strict text-byte gate; defensive ambiguous_file_type; residual unknown_binary
newly_ratified_scopes: unsupported_metadata_block_only; type_agreement_block_only; detected_permitted_type_contradiction_only; standalone_archive_or_non_xlsx_block_only; truncated_or_malformed_type_block_only; encoding_binary_gate_block_only; ambiguous_file_type_block_only
pre_existing_scope_authorities: type_agreement_pass_only; pdf_shallow_identity_block_only; unknown_binary_block_only; encoding_gate_pass_only
mime_parameter_authority: pre_existing_contract_authority from Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 211-236; declared MIME normalization trims surrounding ASCII whitespace; declared MIME type/subtype canonicalize to lowercase; MIME parameters are not stripped; MIME parameters are not reinterpreted; parameterized text/plain; charset=utf-8 blocks as unsupported_file_type
empty_mime_authority: pre_existing_contract_authority; empty MIME blocks as unsupported_file_type under literal unsupported declared MIME language in Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 236-240
empty_extension_owner_decision: new_owner_decision; empty terminal extension blocks as unsupported_file_type; rationale is that this decision extends the committed every-other-extension-blocks rule to the empty-string extension input and does not claim the existing extension rule literally names the empty-string case
helper_mapping: Backend/kai/validators/txtMdByteDetector.js detectTxtMdBytePolicy is wrapped at precedence step 7 for .txt, .md, and .csv; helper allow maps to allow / type_agreement_pass / type_agreement_pass_only; helper block preserves encoding_binary_gate_block_only unchanged and expands to explicit unsupported_bom_encoding, invalid_utf8, nul_rejection, prohibited_control, and lone_cr rows; text-gate blocks must never become unknown_binary or unknown_binary_block_only; CSV uses the same strict text-byte boundary committed for TXT/MD/CSV
type_agreement_block_only_shared_scope_authorized: true
type_agreement_block_only_authorized_conditions: supported extension/MIME disagreement -> declared_type_mismatch; recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature at byte offset zero, regardless of extension or declared MIME -> disallowed_binary_signature
fixture_scope_rawgrep: TOOL_VERIFIED for unsupported_metadata_block_only, type_agreement_block_only, detected_permitted_type_contradiction_only, and encoding_binary_gate_block_only; USER_CONFIRMED for standalone_archive_or_non_xlsx_block_only and truncated_or_malformed_type_block_only because required raw scope grep did not output those scope tokens; not_applicable for ambiguous_file_type_block_only
fixture_source_evidence_classes: TOOL_VERIFIED; USER_CONFIRMED; not_applicable
result_rows_recorded: recognized disallowed signature; unsupported extension or declared MIME; supported extension/MIME disagreement; detected permitted-type contradiction; complete permitted PDF identity; complete permitted XLSX identity; readable non-XLSX ZIP; malformed or truncated ZIP/XLSX; incomplete PDF signalling; TXT/MD/CSV strict text-byte helper allow; TXT/MD/CSV strict text-byte helper block unsupported_bom_encoding; TXT/MD/CSV strict text-byte helper block invalid_utf8; TXT/MD/CSV strict text-byte helper block nul_rejection; TXT/MD/CSV strict text-byte helper block prohibited_control; TXT/MD/CSV strict text-byte helper block lone_cr; defensive ambiguous_file_type; residual unknown_binary
test_module: __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js
frozen_corpus_count: 9
frozen_fixture_count: 101
existing_combined_completeness_spec_changed: false
future_test_requirements: import all nine frozen corpora; invoke production detector exactly once for every one of the 101 fixtures; use explicit per-corpus input adapters; assert policy, category, scope, and closed evidence shape; prove 101 executions; prove fixture IDs remain unique
production_detector_import_boundary: production detector must not import tests, corpora, fixture builders, or the combined-completeness specification
corpus_authority_boundary: corpus verifies the detector; it does not create categories, precedence, scopes, or production rules
p0_05f_4_implementation_status: unimplemented
p0_05f_4_interface_authority_status: recorded_by_this_package
p0_05f_4_ready_to_start: false
readiness_condition: interface authority must be committed and separately verified
runtime_integration_status: unstarted
runtime_alignment_status: separate_and_unstarted
application_json_allowlist_change: prohibited_in_p0_05f_4
tests_run: none; documentation-only package per owner instruction
package_exclusions: no production code, tests, fixtures, routes, services, dependencies, lockfiles, Current State, Implementation Baseline, runtime configuration, database, cloud, deployment, staging, or commit
```


## P0-05F.4 detector steps 1-9 working-tree checkpoint

```text
leaf_status: complete_ready_to_stage_and_commit
p0_05_package_status: P0_05F_4_FINAL_AUDIT_PASSED_READY_TO_COMMIT
implementation_status: complete_unwired_pure_detector
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 902e0b6
authorized_file_scope: Backend/kai/validators/p0FileTypeAgreementDetector.js; __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
files_created: Backend/kai/validators/p0FileTypeAgreementDetector.js; __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js
files_modified: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
owner_decision_authority_consumed: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1; OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1; OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES; OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1; OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1; OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
active_package_scope: bounded detector implementation and acceptance-test package only; committed classification steps 1 through 9 implemented; full 101-fixture acceptance boundary built and passed
runtime_behavior_changed: false
runtime_mime_allowlist_changed: false
runtime_integration_status: unstarted
route_service_storage_database_wiring_changed: false
fixtures_changed: false
existing_tests_changed: false
detector_export: detectP0FileTypeAgreement from Backend/kai/validators/p0FileTypeAgreementDetector.js
detector_import_boundary: no imports from __tests__, fixture corpora, fixture builders, or combined-completeness spec; grep -rn "__tests__" Backend/kai/validators/p0FileTypeAgreementDetector.js produced no matches
implemented_committed_steps: 1, 2, 3, 4, 5, 6, 7, 8, 9
remaining_committed_steps: none
evaluation_step_convention: committed classification ordinal
temporary_sentinel_present: false
detector_result_table_complete: true
step_7_helper_export: detectTxtMdBytePolicy
step_7_helper_decision: wrapped_not_redefined
step_8_status: defensive_branch_implemented_currently_unexercised_by_construction
step_9_result: block / unknown_binary / unknown_binary_block_only
full_nine_corpus_boundary_complete: true
full_101_fixture_boundary_complete: true
detector_invocation_count: 101
unique_fixture_id_count: 101
duplicate_fixture_ids: none
ambiguous_fixture_count: 0
ambiguous_branch_status: implemented_defensive_unexercised_by_construction
ready_to_stage: true
ready_to_commit: true
production_wiring: not_started
runtime_mime_alignment: separate_and_unstarted
step_1_result: block / disallowed_binary_signature / type_agreement_block_only
step_2_result: block / unsupported_file_type / unsupported_metadata_block_only
step_3_result: block / declared_type_mismatch / type_agreement_block_only
step_4_pdf_pass_result: allow / type_agreement_pass / type_agreement_pass_only
step_4_xlsx_pass_result: allow / type_agreement_pass / type_agreement_pass_only
step_4_contradiction_result: block / declared_type_mismatch / detected_permitted_type_contradiction_only
step_5_readable_zip_result: block / standalone_archive_or_non_xlsx / standalone_archive_or_non_xlsx_block_only
step_5_malformed_zip_result: block / truncated_or_malformed_type / truncated_or_malformed_type_block_only
step_6_incomplete_pdf_result: block / truncated_or_malformed_type / pdf_shallow_identity_block_only
step_7_helper_fixture_count: 27
step_7_helper_allow_result: allow / type_agreement_pass / type_agreement_pass_only / encoding_gate_pass / encoding_gate_pass_only / evaluation_step 7
step_7_helper_block_scope: encoding_binary_gate_block_only
step_7_permitted_text_pairings_result: allow / type_agreement_pass / type_agreement_pass_only / evaluation_step 7
step_7_csv_invalid_utf8_result: block / invalid_utf8 / encoding_binary_gate_block_only / evaluation_step 7
step_7_text_0001_precedence_result: block / nul_rejection / encoding_binary_gate_block_only / evaluation_step 7
xlsx_required_entry_comparison_method: bounded exact length-and-byte comparison against the three required ASCII central-directory filename byte sequences only; unrelated central-directory filename bytes are ignored for required-entry presence
zip_internal_classifications: no_zip_signal; complete_xlsx_shallow_identity; readable_non_xlsx_zip; malformed_or_truncated_zip_xlsx
zip_structure_boundary: bounded EOCD discovery, EOCD comment length, single-disk records, central-directory offset and length bounds, central-directory record signatures and length bounds, entry-count consistency, central-directory byte consumption, local-header offset bounds, local-header signatures, and exact required-entry byte matching only
zip_no_signal_boundary: exact ZIP local-file-header signature at byte offset zero or non-empty strict truncated prefix only; arbitrary PK-like bytes do not establish ZIP signalling
pdf_incomplete_boundary: .pdf plus application/pdf only; committed conditions A through D only; no arbitrary short or percent-prefixed bytes
step_5_precedes_step_6: true
xlsx_zip_fixture_execution_count: 12
pdf_fixture_execution_count: 5
regression_a_name: complete XLSX plus unrelated non-ASCII central-directory filename
regression_a_result: allow / type_agreement_pass / type_agreement_pass_only / complete_xlsx_shallow_identity / evaluation_step 4
regression_b_name: missing xl/workbook.xml plus unrelated non-ASCII central-directory filename
regression_b_result: block / standalone_archive_or_non_xlsx / standalone_archive_or_non_xlsx_block_only / readable_non_xlsx_zip / evaluation_step 5
unrelated_non_ascii_entry_rejected: false
step_8_result: defensive ambiguous_file_type branch implemented for multiple complete permitted byte identities; currently unexercised by construction; block / ambiguous_file_type / ambiguous_file_type_block_only / evaluation_step 8
step_9_result: block / unknown_binary / unknown_binary_block_only / evaluation_step 9
residual_fixture_result: UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001 returns block / unknown_binary / unknown_binary_block_only / evaluation_step 9
focused_detector_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test '__tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js' - 24 passed, 0 failed
helper_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test '__tests__/kai-sprint2-txt-md-byte-detector.spec.js' - 7 passed, 0 failed
combined_completeness_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test '__tests__/kai-sprint2-p0-05f-combined-completeness.spec.js' - 11 passed, 0 failed
sprint2_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - sandbox run hit localhost listen EPERM; unchanged localhost-capable rerun passed 560 tests, 0 failed
full_repository_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit localhost listen EPERM; unchanged localhost-capable rerun passed 665 tests, 0 failed
type_error_assertions_confirmed: missing extension, non-string extension, missing declaredMime, non-string declaredMime, and non-Uint8Array bytes throw TypeError
bytes_no_mutation_assertion_confirmed: true
git_no_index_detector_check: status 1, no whitespace-error output
git_no_index_acceptance_test_check: status 1, no whitespace-error output
git_diff_check: passed
package_exclusions: no route, service, storage, database, runtime, allowlist, fixture corpus, existing-test other than the focused detector spec, combined-completeness, dependency, lockfile, Current State, Implementation Baseline, push, deploy, cloud, credential, or real-client-data change
```

## P0-05 bounded assessor authority

```text
leaf_status: complete after this documentation-only package commit
p0_05_package_status: bounded_assessor_authority_recorded
implementation_status: documentation_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
owner_decision_authority: OWNER_DECISION.P0_05_BOUNDED_ASSESSOR_V1
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: e5eba333fece7c2f7a64df2906afbeec9a507729
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
active_package_scope: documentation-only bounded assessor authority; no runtime code, tests, fixtures, routes, manifests, lockfiles, Current State, Implementation Baseline, dependency, database, cloud, production, implementation, P0-07, P0-06B, or Gate A work
authority_summary: records archive limits, assessor timeout, archive/PDF/OOXML/encryption outcomes, prompt-injection inert-data boundary, formula-trigger metadata-only warning boundary, P0-07 case mapping, decision basis, and dependency authority
limit_summary: archive_entry_maximum 1000; expanded_byte_maximum 262144000; expanded_byte_maximum_display 250 MiB; compression_ratio_maximum 100:1; minimum_inflate_ratio 0.01; assessor_timeout_seconds 60
executor_authority_preserved: actor_type internal_service; service_identity kai_file_security_executor; operation_group file_security_assessment; allowed_operations record_file_security_result, transition_file_policy_status, write_file_security_audit
executor_enabled: false
trigger_queue_route_listener_worker_production_composition: not defined and not enabled
write_boundary: organization ID must match scoped file and exact immutable object version; target IDs never establish tenant scope; permitted writes remain bounded security results, file-policy transition to passed/blocked/failed, and metadata-only required audit
prohibited_operations: review approval, parsing, profiling, source, evidence, claim, generation, export, tenant change, raw-content exposure, arbitrary operation, LLM call, or tool/service action caused by uploaded file text
prompt_injection_authority: instruction_text_inert; uploaded instruction-like text remains data; no heuristic keyword blocker; no policy change caused by file text; proof boundary is assessor dependency-call assertions and downstream-write zero-call assertions
formula_authority: formula_trigger_detected metadata-only warning; warning alone does not block when every blocking security check passes; detects =, +, -, @, tab, carriage return, line feed, and full-width equals, plus, minus, and at-sign; raw file mutation prohibited
formula_proof_boundaries: detector/assessor boundary records warning without rewriting quarantined bytes; P0 output boundary proves route, DTO, assistant-boundary, and export-denial paths do not render or export raw cell content
future_output_specific_neutralization: mandatory before any preview, spreadsheet rendering, assistant exposure, or export is enabled
new_file_policy_enum: not introduced
p0_07_case_mapping_recorded: XLSX path traversal -> ooxml_path_traversal_detected; XLSX expansion bomb -> archive_entry_limit_exceeded, archive_expanded_size_limit_exceeded, archive_compression_ratio_limit_exceeded; macros/external relationships -> ooxml_macro_detected, ooxml_external_relationship_detected; encrypted PDF/XLSX -> encrypted_or_password_protected; PDF active content/embedded files -> pdf_active_content_detected, pdf_embedded_file_detected; uploaded prompt-injection text -> instruction_text_inert; formula cells -> formula_trigger_detected plus the P0 no-output boundary
decision_basis: archive_entry_maximum and minimum_inflate_ratio align with Apache POI ZipSecureFile defaults; expanded_byte_maximum and assessor_timeout_seconds are KAI policy ceilings, not external standards; formula trigger set aligns with OWASP CSV Injection guidance; prompt-injection boundary aligns with treating external document instructions as untrusted data and preventing LLM/tool execution
dependency_authority: new_dependency_authorized false; dependency_selection pending bounded repository inspection
dependency_decision_required_boundary: if existing dependencies cannot safely implement the committed checks, the next package must return the repository-defined DEPENDENCY_DECISION_REQUIRED record
node_or_npm_commands: not run
database_or_cloud_access: not performed
runtime_behavior_changed: false
dependency_authorized: false
current_state_update: not performed
package_commit: report after commit; a commit cannot contain its own SHA
next_package: bounded P0-05 assessor dependency inspection
```

## P0-05 MuPDF dependency approval and local synthetic installation

```text
p0_05_package_status: mupdf_dependency_installed_ready_to_commit
implementation_status: dependency_and_test_only
verification_status: TOOL_VERIFIED after focused dependency, Sprint 2, full-suite, audit, and diff checks complete
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: d078e1161356aef36cfa86423f42db79c839cb56
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, P0-07, or Gate A work authorized or performed
owner_dependency_decision: USER_CONFIRMED package mupdf; exact_version 1.28.0; approval_scope local synthetic P0 only; production_or_deployment_approval false; real_client_data_approval false
installed_dependency: TOOL_VERIFIED package.json and package-lock.json pin mupdf exactly to 1.28.0; node_modules/mupdf/package.json reports version 1.28.0
package_license: TOOL_VERIFIED AGPL-3.0-or-later
commercial_license_available: USER_CONFIRMED true
production_proprietary_or_SaaS_path: NOT_CONFIRMED
legal_or_commercial_approval_required_before_distribution_or_deployment: USER_CONFIRMED true
security_record: USER_CONFIRMED CVE-2026-7233 Artifex_status fixed in MuPDF 1.28.0; Artifex_fix_commit 611f75f0c8657b92460554009196c5ac4b68d909; NVD_status affected through 1.28.0; exact_npm_WASM_fix_inclusion NOT_CONFIRMED; owner_disposition residual accepted for local synthetic P0 only
architecture_record: USER_CONFIRMED file-backed dedicated worker; 25 MiB pre-parse input gate; 60-second parent timeout; failed / security_assessment_timeout latch; late-result rejection; worker termination; maximum_concurrent_pdf_assessor_workers 1; main-thread MuPDF prohibited; data-URL worker prohibited
technical_evidence_record: USER_CONFIRMED file-backed worker termination was measured during synchronous MuPDF/WASM execution; parent timeout and late-result rejection were demonstrated; raw outline actions, chained actions, and unknown action types are reachable through public object APIs; residual decompression and parser-allocation risk remains
test_support_boundary: one file-backed worker support module under __tests__/support imports MuPDF only inside worker execution; no production code or detector code imports MuPDF
focused_dependency_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-mupdf-dependency.spec.js - tests 7; pass 7; fail 0
focused_dependency_test_coverage: exact installed version 1.28.0; ESM import succeeds in local synthetic runtime; MuPDF execution only in file-backed worker; over-25-MiB input rejected before worker creation; default parent timeout constant 60000 ms with short-timeout latch proof; failed/security_assessment_timeout result; late-message rejection; worker termination; maximum concurrency 1; main-thread and data-URL worker absence; synthetic-buffer-only gate
applicable_sprint2_tests: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 744; pass 744; fail 0
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 849; pass 849; fail 0
npm_audit_result: npm audit returned 17 vulnerabilities; 1 low, 5 moderate, 11 high
runtime_detector_behavior_changed: false
security_executor_enabled: false
production_or_deployment_authorized: false
real_client_data_used: false
additional_parser_candidates_added: false
routes_or_cloud_or_database_or_feature_flags_changed: false
current_state_update: false
changed_files: package.json; package-lock.json; __tests__/kai-sprint2-mupdf-dependency.spec.js; __tests__/support/kaiSprint2MupdfDependencyWorker.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package: bounded PDF assessor worker and detector implementation
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05 PDF assessor worker boundary

```text
p0_05_package_status: pdf_assessor_worker_boundary_complete_ready_to_commit
implementation_status: bounded_worker_lifecycle_only
verification_status: TOOL_VERIFIED after focused worker-boundary, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: e330a775cfd5321d95b1af7d6a2774e4d25f12e4
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, malware, CSV/XLSX, detection-category, executor-integration, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_BOUNDED_ASSESSOR_V1
committed_dependency_record: TOOL_VERIFIED package.json and package-lock.json pin mupdf exactly to 1.28.0; prior dependency test remains green; dependency attribution and production licensing path remain NOT_CONFIRMED
active_package_scope: production internal file-backed PDF worker lifecycle boundary only; no route, listener, queue, executor orchestration, storage read, tenant repository, lifecycle repository, state transition, audit write, policy pass/block logic, PDF security detection, OCR, rendering, content extraction, JavaScript execution, raw-byte logging, production composition, deployment, or real-client-data work
worker_boundary: Backend/kai/validators/pdfAssessorWorkerBoundary.js creates only a file-backed module worker at Backend/kai/validators/pdfAssessorWorkerThread.js; main-thread MuPDF import prohibited; data-URL and eval workers prohibited
liveness_operation: worker dynamically imports mupdf, opens one bounded synthetic PDF buffer as application/pdf, calls Document.countPages, and destroys the MuPDF document handle before success message
input_gate: accepts only Buffer or Uint8Array; rejects input over 25 MiB before worker creation with failed/input_size_exceeds_pre_parse_gate
timeout_and_late_result_latch: committed parent timeout default is 60000 ms; timeout latches exactly failed/security_assessment_timeout before termination; late worker messages after timeout are rejected and cannot replace the latched result
concurrency_behavior: reuses the existing internal maximum_concurrent_pdf_assessor_workers_exceeded fail-closed busy convention; maximum active PDF assessor workers is 1; success and timeout release the permit
cleanup_behavior: success, worker failure, worker exit, worker construction failure, and timeout clear parent timers, remove listeners, release owned/transferred byte references, call worker.terminate, release worker state, and leave active permit count at 0
success_result_shape: Promise resolves undefined; no policy, category, scope, eligibility, or security result is returned for successful liveness completion
focused_worker_boundary_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js - tests 11; pass 11; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 53; pass 53; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 707; pass 680; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 755; pass 755; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 812; pass 785; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 860; pass 860; fail 0
git_diff_check: git diff --check - pass
npm_audit_not_run: prior_repository_audit_result USER_CONFIRMED - 17 findings reported at e330a77
mupdf_audit_attribution: NOT_CONFIRMED
production_licensing_path: NOT_CONFIRMED
licensing_block_effect: blocks deployment or a later Gate; does not block local synthetic implementation
detection_categories_implemented: none
production_composition_changed: false
executor_enabled: false
policy_state_writes_added: false
production_or_deployment_authorized: false
changed_files: Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package: PDF encryption and password detection
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 PDF worker byte-ownership hardening

```text
p0_05_package_status: pdf_worker_byte_ownership_hardened_ready_to_commit
implementation_status: bounded_worker_boundary_test_only
verification_status: TOOL_VERIFIED after focused worker-boundary, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: e160d603cbdbf2d2e286fb77ad5dece335dae88a
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, malware, CSV/XLSX, detection-category, executor-integration, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_BOUNDED_ASSESSOR_V1
committed_dependency_record: TOOL_VERIFIED package.json and package-lock.json pin mupdf exactly to 1.28.0
committed_pdf_worker_boundary: TOOL_VERIFIED file-backed module worker; main-thread MuPDF import prohibited; data-URL and eval workers prohibited; 25 MiB pre-parse input gate; 60000 ms parent timeout; maximum active PDF assessor workers 1; failed/security_assessment_timeout latch; internal busy result failed/maximum_concurrent_pdf_assessor_workers_exceeded
contention_authority_at_package_time: NOT_CONFIRMED; later resolved by OWNER_DECISION.P0_05_PDF_WORKER_CONTENTION_V1 in the P0-05 PDF worker contention authority package; current worker boundary emits internal busy result failed/maximum_concurrent_pdf_assessor_workers_exceeded; repository contract and canonical KAI safe-error vocabulary do not define a public HTTP/KAI error for this internal worker result
caller_ownership_before: production boundary already created a fresh Uint8Array with input.byteLength, copied input visible bytes through bytes.set(input), and transferred only the fresh backing ArrayBuffer; caller Buffer/Uint8Array backing stores were not transferred
caller_ownership_correction_applied: false
caller_ownership_after: unchanged production implementation; new regression tests prove the existing owned exact-length visible-range transfer mechanism
ownership_inputs_covered: Buffer.alloc; Buffer.from; standalone Uint8Array; Buffer subview with non-zero byteOffset; Uint8Array subview with non-zero byteOffset
ownership_success_proof: for every covered input form, tests assert original byteLength unchanged, original visible bytes unchanged, object remains readable via indexed access and slice, transferred bytes are a fresh Uint8Array with byteOffset 0, byteLength equal to visible input length, backing ArrayBuffer length equal to visible input length, backing ArrayBuffer not equal to caller backing store, and adjacent backing-buffer sentinels absent for subviews
ownership_timeout_proof: for every covered input form, tests use existing __testables runPdfAssessorWorkerBoundaryWithTestControls with timeoutMs 1 and SyntheticWorker termination controls to assert failed/security_assessment_timeout while preserving caller byteLength, bytes, readability, and visible-range-only transfer
public_api_changed: false
test_only_controls_exposed_to_public_api: false
focused_worker_boundary_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js - tests 13; pass 13; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 65; pass 65; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 709; pass 682; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 757; pass 757; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 814; pass 787; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 862; pass 862; fail 0
git_diff_check_before_execplan_update: git diff --check - pass
npm_audit_not_run: true
detection_categories_implemented: none
executor_enabled: false
policy_state_writes_added: false
production_or_deployment_authorized: false
changed_files: __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package: PDF encryption and password detection
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 PDF worker contention authority

```text
p0_05_package_status: pdf_worker_contention_authority_recorded_ready_to_commit
implementation_status: contract_and_test_only
verification_status: TOOL_VERIFIED after focused worker-boundary, repository-contract, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 9b18a04b20f4907bec0f10cd1e4bfa577f0de98f
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, public API mapping, persistence, multi-process coordination, queue, retry, audit-write, executor-operation, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_PDF_WORKER_CONTENTION_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
active_package_scope: local synthetic P0 PDF worker contention authority plus focused tests; no production or multi-process coordination, public HTTP/API mapping, database persistence, route/service/storage/lifecycle integration, queue, retry loop, implicit wait, executor operation, audit write, DDL enum, client serialization, deployment, or real-client-data work
contract_record: OWNER_DECISION.P0_05_PDF_WORKER_CONTENTION_V1 recorded maximum_concurrent_pdf_assessor_workers 1; classification_scope internal_non_persisted_pdf_worker_boundary_result; authorization_scope local_synthetic_P0_only; runtime_public_api_mapping_authorized false; database_persistence_authorized false; production_or_multi_process_coordination_authorized false
result_shape_authority: internal contention result is exactly status failed and category maximum_concurrent_pdf_assessor_workers_exceeded; exact enumerable keys status and category; policy and scope keys not emitted
contention_semantics_recorded: contention evaluated before second PDF worker creation; no second worker, queue, retry loop, or implicit wait; already-active worker unaffected; active permit remains owned until active invocation cleanup; contention produces neither file-policy pass nor file-policy block
state_and_side_effect_boundary_recorded: contention does not change file_policy_status, processing_status, parse_status, or upload_state; performs no executor operation, audit write, or database write; exposes no raw bytes, document content, identifiers, worker internals, or infrastructure details
worker_boundary_test_assertions_added: existing one-active-worker test now asserts active permit is held before contention, contention returns a frozen two-key object, policy/scope/lifecycle/telemetry keys are absent, no second worker is created, and active worker state remains active until first invocation cleanup
repository_contract_test_assertions_added: contract test now asserts the owner-decision identifier, maximum worker value, classification scope, exact result keys, no policy/scope keys, no queue/retry/wait, no state mutation, no executor/audit/database write, and no canonical public HTTP error mapping
production_runtime_code_changed: false
dependency_or_lockfile_changed: false
executor_enabled: false
policy_state_writes_added: false
public_api_mapping_added: false
database_or_cloud_access: not performed
production_or_deployment_authorized: false
current_state_update: false
focused_worker_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 23; pass 23; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 75; pass 75; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 710; pass 683; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 758; pass 758; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 815; pass 788; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 863; pass 863; fail 0
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this contract-and-test-only package commit; do not begin another leaf, implement PDF security detection, add public API mapping, persistence, production/multi-process coordination, executor/audit/database writes, queue/retry behavior, P0-06B, Gate A, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 PDF worker contention authority correction

```text
p0_05_package_status: pdf_worker_contention_decision_and_scope_corrected_ready_to_commit
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_head: 451d9b14d40a304b2dea3eac8987c032718f7dd6
parent_commit: 9b18a04b20f4907bec0f10cd1e4bfa577f0de98f
superseded_claims_commit: 451d9b1
correction_scope: contract decision record, two parent-blob test restores, and this ExecPlan correction only
superseded_451d9b1_claims: 451d9b1 recorded a drifted representation of OWNER_DECISION.P0_05_PDF_WORKER_CONTENTION_V1 and changed __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js plus __tests__/kai-sprint2-p0-repository-contract.spec.js outside its documentation-only scope
corrected_decision_record: this commit records the exact approved OWNER_DECISION.P0_05_PDF_WORKER_CONTENTION_V1 decision
restored_tests: this commit restores __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js and __tests__/kai-sprint2-p0-repository-contract.spec.js to their 9b18a04 blobs
runtime_behavior_changed: false
dependency_changed: false
public_api_changed: false
persistence_authority_changed: false
deployment_authority_changed: false
historical_test_evidence_boundary: 451d9b1 reported test results remain historical USER_CONFIRMED evidence only and do not authorize retaining its test edits
next_package: PDF encryption and password detection
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 PDF encryption and password detection

```text
p0_05_package_status: pdf_encryption_password_detection_complete_ready_to_commit
implementation_status: bounded_internal_pdf_worker_result_only
verification_status: TOOL_VERIFIED after focused worker-boundary, repository-contract, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 3f4600be3b977198aaeb79a0cb75e7b2052c8d48
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, executor mapping, persistence, route/service/listener wiring, later PDF detector work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_PDF_ENCRYPTION_PASSWORD_DETECTOR_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
observed_pdf_check_chain: committed P0-05F pure file-type detector evaluates recognized signatures, extension/MIME, complete shallow PDF identity, XLSX/ZIP, incomplete PDF, text gate, ambiguity, and residual unknown_binary; actual PDF worker boundary has no production importer beyond tests and, when invoked, performs worker-owned exact bytes, successful MuPDF open/countPages, then this encryption/password detector; no later PDF content/security checks are currently implemented in the inspected worker chain
precedence_matches_owner_decision: true
protected_result: exactly policy block and category encrypted_or_password_protected; exact enumerable keys policy and category; no scope, evidence, metadata, identifiers, dependency details, or other keys
no_block_result: undefined; means only this detector did not establish an encryption/password block; not a file-policy pass, PDF-validity result, text-layer result, clean/safe/machine-readable claim, or downstream-processing authorization
primary_signal: document.needsPassword() === true
secondary_signal: document.getMetaData(Document.META_ENCRYPTION) returns a non-empty string other than exact None
failure_behavior: document open failure, needsPassword throw, non-boolean needsPassword, metadata access throw, empty-string metadata, and non-string non-undefined metadata use existing sanitized worker-failure path; no raw content, unrestricted dependency errors, stack traces, paths, identifiers, worker internals, infrastructure details, passwords, or dependency metadata are returned
password_boundary: authenticatePassword is not called; passwords are not requested, accepted, stored, logged, transmitted, persisted, or returned
repaired_truncated_behavior: synthetic invalid-but-MuPDF-repaired PDF with needsPassword false and encryption metadata None returns undefined; repaired/invalid-but-openable PDF detection is outside this leaf; PDF integrity/validity assessment is deferred to a later separately authorized leaf; undefined must not be described as valid, clean, safe, machine-readable, passed, or eligible
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal worker result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
production_or_deployment_authorized: false
later_pdf_checks_implemented: false
dependencies_or_lockfiles_changed: false
focused_worker_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 37; pass 37; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 89; pass 89; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 724; pass 697; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 772; pass 772; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 829; pass 802; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 877; pass 877; fail 0
complete_diff_inspected: true
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start another PDF leaf, add executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 PDF extractable-text detection

```text
p0_05_package_status: pdf_extractable_text_detection_complete_ready_to_commit
implementation_status: bounded_internal_pdf_worker_result_only
verification_status: TOOL_VERIFIED after focused worker-boundary, repository-contract, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 6ddf92cc29532f204dcdec00066af763fbe134e9
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, executor mapping, persistence, route/service/listener wiring, OCR, later PDF detector work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_PDF_EXTRACTABLE_TEXT_DETECTOR_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
capability_probe: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel node --input-type=module confirmed installed mupdf 1.28.0 has Document.loadPage, Page.toStructuredText, StructuredText.walk, and page-level blank extraction produced zero characters
mupdf_text_api: Document.loadPage(index) -> Page.toStructuredText() -> StructuredText.walk({ onChar })
observed_pdf_check_chain: committed P0-05F pure file-type detector evaluates complete shallow PDF identity before PDF worker eligibility; actual PDF worker boundary has no production importer beyond tests and, when invoked, performs worker-owned exact bytes, successful MuPDF open/countPages, encryption/password detector, then this extractable-text detector only when encryption/password returns undefined; no PDF JavaScript, action, or embedded-file checks are currently implemented in the inspected worker chain
precedence_matches_owner_decision: true
no_extractable_text_result: exactly policy block and category pdf_no_extractable_text; exact enumerable keys policy and category; no scope, evidence, metadata, identifiers, dependency details, extracted text, or other keys
text_present_result: undefined; means only at least one extracted non-whitespace character was found; not a file-policy pass, PDF-validity result, integrity result, active-content safety result, parser eligibility result, upload acceptance result, or later-check completion result
detector_behavior: inspects every PDF page with bounded page-level MuPDF structured-text walking; returns undefined on the first non-whitespace character; returns pdf_no_extractable_text when every page yields zero non-whitespace characters, including blank, graphics-only, and image-only synthetic PDFs
failure_behavior: MuPDF open failure, page count failure, page load failure, structured-text extraction failure, thrown operations, malformed page/text handles, non-string character callbacks, malformed worker result shapes, and unusable dependency output use existing sanitized worker-failure path; no extracted text, raw bytes, unrestricted dependency errors, stack traces, paths, identifiers, worker internals, infrastructure details, or dependency metadata are returned
short_circuit_behavior: encrypted_or_password_protected result still short-circuits extractable-text inspection; pdf_no_extractable_text short-circuits later PDF JavaScript, action, and embedded-file checks when those later checks are implemented
repaired_openable_behavior: synthetic invalid-but-MuPDF-repaired PDF with extractable text returns undefined while retaining the recorded integrity deferral; repaired/openable status is not converted into validity, clean/safe status, machine-readable acceptance, parser eligibility, upload acceptance, or file-policy pass
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal worker result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
ocr_added: false
production_or_deployment_authorized: false
later_pdf_checks_implemented: false
dependencies_or_lockfiles_changed: false
focused_worker_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 47; pass 47; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 99; pass 99; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 734; pass 707; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm run test:kai-sprint2 - tests 782; pass 782; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 839; pass 812; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm test - tests 887; pass 887; fail 0
complete_diff_inspected: true before commit
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start another PDF detector leaf, add executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05 PDF active-action and embedded-file detection

```text
p0_05_package_status: pdf_active_action_embedded_file_detection_complete_ready_to_commit
implementation_status: bounded_internal_pdf_worker_result_only
verification_status: TOOL_VERIFIED after focused worker-boundary, repository-contract, affected file-policy, Sprint 2, full-suite, and diff checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 0cc7d950aed4a1f4d057c2870d752ede470701cd
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, executor mapping, persistence, route/service/listener wiring, CSV/XLSX/executor work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_PDF_ACTIVE_ACTION_EMBEDDED_FILE_DETECTOR_V1
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
capability_probe_boundary: temporary synthetic PDFs generated under /private/tmp via node --input-type=module; all samples under 25 MB; no repository fixtures, dependency installs, database access, cloud access, real client data, scripts, URLs, filenames, destinations, embedded bytes, document text, or object contents exposed in repository outputs
mupdf_traversal_apis: Document.openDocument; Document.asPDF; PDFDocument.getTrailer; PDFDocument.loadPage(index); PDFPage.getObject; PDFObject.get(...); PDFObject.resolve(); PDFObject.isNull(); PDFObject.isDictionary(); PDFObject.isArray(); PDFObject.isName(); PDFObject.asName(); PDFObject.length; PDFObject.forEach(...); PDFPage.getAnnotations and PDFAnnotation.getType/getObject/hasFilespec for FileAttachment confirmation; page-object /Annots traversal for Link annotations
capability_results: TOOL_VERIFIED synthetic observations repeated twice per material case; catalog /OpenAction dictionary subtype /Launch, /GoTo, and unknown /MadeUpAction were visible; catalog /OpenAction internal destination array was visible; catalog /AA and page /AA action subtypes were visible; page-object /Annots traversal exposed /Link annotations with no /A, /URI action, /GoTo action, and annotation /AA; /Names/JavaScript and /Names/EmbeddedFiles entries were visible; /EF references under Filespec/catalog and /AF associated-file arrays were visible; /FileAttachment annotations were visible through annotation type/object traversal; every repeated material observation matched deterministically
capability_gap: false
observed_pdf_check_chain: committed P0-05F pure file-type detector evaluates complete shallow PDF identity before PDF worker eligibility; actual PDF worker boundary has no production importer beyond tests and, when invoked, performs worker-owned exact bytes, successful MuPDF open/countPages, encryption/password detector, extractable-text detector, then this active-action/embedded-file detector only when both prior detectors return undefined
precedence_matches_owner_decision: true
protected_result: exactly policy block and category pdf_active_or_embedded_content; exact enumerable keys policy and category; no scope, evidence, metadata, identifiers, URLs, destinations, filenames, attachment names, scripts, object contents, dependency details, or other keys
no_block_result: undefined; means only this detector found no active-action or embedded-file block; not a file-policy pass, PDF-validity result, integrity result, clean/safe status, parser eligibility, upload acceptance, or downstream-processing authorization
blocking_behavior: blocks /Names/JavaScript, JavaScript action or /JS content, /Names/EmbeddedFiles, /EF references, /AF associated files, /FileAttachment annotations, every action subtype other than exact /GoTo, and action dictionaries with missing, malformed, unresolved, or unknown /S
allow_behavior: allows clean text PDFs, catalog /OpenAction internal destinations, exact internal /GoTo actions, /Link annotations with no action, and /Link annotations with exact internal /GoTo
failure_behavior: malformed object structure, traversal failure, thrown dependency operations, unexpected dependency return types, malformed worker result shapes, MuPDF open failure, and unusable dependency output use existing sanitized worker-failure path; no scripts, action contents, URLs, destinations, filenames, attachment names, embedded bytes, document text, object contents, paths, identifiers, stacks, dependency internals, or infrastructure details are returned
short_circuit_behavior: encrypted_or_password_protected still short-circuits extractable-text and active/embedded detection; pdf_no_extractable_text still short-circuits active/embedded detection; repaired/openable PDF integrity deferral is preserved
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal worker result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
production_or_deployment_authorized: false
csv_xlsx_executor_work_started: false
dependencies_or_lockfiles_changed: false
focused_worker_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 65; pass 65; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-pdf-shallow-identity-fixture-corpus.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 117; pass 117; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 752; pass 725; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm run test:kai-sprint2 - tests 800; pass 800; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 857; pass 830; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sprint2_p0_sentinel npm test - tests 905; pass 905; fail 0
complete_diff_inspected: true before ExecPlan update and rechecked before commit
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/validators/pdfAssessorWorkerThread.js; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start CSV/XLSX/executor work, another PDF detector leaf, executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 CSV row-limit detection

```text
p0_05_package_status: csv_row_limit_detection_complete_ready_to_commit
implementation_status: bounded_internal_csv_result_only
verification_status: TOOL_VERIFIED after focused CSV, repository-contract, affected file-policy, Sprint 2, full-suite, diff, and post-commit clean-state checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 66f00473c4ec70d988efab10f7812438c1d8c14f
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, executor mapping, persistence, route/service/listener wiring, XLSX work, PDF-worker change, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_CSV_ROW_LIMIT_DETECTOR_V1 newly authorized by this package prompt; the category csv_row_limit_exceeded and exact two-key result shape were not described as pre-existing committed repository authority
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/csvRowLimitDetector.js; __tests__/kai-sprint2-csv-row-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
maximum_logical_records: 100000
precedence_matches_owner_decision: existing CSV extension/MIME/type-agreement gate -> existing strict text/UTF-8 and deterministic binary-content gate -> bounded CSV logical-record counter
protected_result: exactly policy block and category csv_row_limit_exceeded; exact enumerable keys policy and category; no scope, evidence, metadata, counts, records, rows, values, identifiers, content, or other keys
at_or_below_limit_result: undefined; means only this detector did not establish a CSV row-limit block; not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result, content-validity result, formula-safety result, instruction-safety result, or downstream-processing authorization
counter_behavior: counts every logical record including the first; no header inference; comma delimiter; double-quote framing; doubled-quote escaping; LF and CRLF endings; quoted LF/CRLF ignored as record endings; terminal line ending does not add an extra record; final unterminated-by-newline record counts; blank records count; stops immediately when logical record 100001 is established
sanitized_failure_behavior: lone CR and malformed quoting use the sanitized CSV row-limit inspection failure path; no raw content, decoded content, parser detail, stack, path, identifier, row, cell, or internal detail is returned by the detector result
instruction_formula_boundary: values beginning with =, +, -, or @ remain inert data; detector does not execute, rewrite, neutralize, return, persist, expose, or log CSV content
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal pure result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
pdf_worker_changed: false
xlsx_work_started: false
dependencies_or_lockfiles_changed: false
focused_csv_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-csv-row-limit-detector.spec.js - tests 8; pass 8; fail 0
focused_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 13; pass 13; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 63; pass 63; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 761; pass 734; fail 27
sprint2_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 809; pass 809; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 866; pass 839; fail 27
full_repository_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 914; pass 914; fail 0
complete_diff_inspected: true before ExecPlan update and rechecked before commit
git_diff_check: git diff --check and git diff --cached --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/csvRowLimitDetector.js; __tests__/kai-sprint2-csv-row-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start XLSX work, executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 XLSX sheet and cell limit detection

```text
p0_05_package_status: xlsx_sheet_cell_limit_detection_complete_ready_to_commit
implementation_status: bounded_internal_xlsx_result_only
verification_status: TOOL_VERIFIED after focused XLSX, repository-contract, affected file-policy, Sprint 2, full-suite, diff, and post-commit clean-state checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 7fc797ea6c5aade13ff1ab440f9cd53adcd0cfc7
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, Implementation Baseline, P0-06B, executor mapping, persistence, route/service/listener wiring, PDF-worker change, macro detection, external-relationship classification, archive-limit work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_XLSX_SHEET_CELL_LIMIT_DETECTOR_V1 newly authorized by this package prompt; the categories xlsx_sheet_limit_exceeded and xlsx_cell_limit_exceeded and their exact two-key result shapes were not described as pre-existing committed repository authority
pre_edit_capability_proof: existing p0FileTypeAgreementDetector parses ZIP EOCD and central-directory records to establish complete XLSX shallow identity without decompression; Node built-in node:zlib provides stream-capable raw DEFLATE for selected ZIP entries; TextDecoder fatal mode plus the purpose-built XmlElementScanner incrementally tokenizes workbook, relationship, and worksheet XML by chunks; implementation inspects only xl/workbook.xml, xl/_rels/workbook.xml.rels, and workbook-referenced worksheet parts after complete XLSX shallow identity; no new dependency is required
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/xlsxSheetCellLimitDetector.js; __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
maximum_sheets: 20
maximum_cells: 1000000
precedence_matches_owner_decision: complete XLSX shallow identity -> bounded XLSX sheet-count detector -> bounded XLSX cell-count detector
protected_results: exactly policy block and category xlsx_sheet_limit_exceeded or xlsx_cell_limit_exceeded; exact enumerable keys policy and category; no scope, evidence, metadata, sheet counts, cell counts, rows, cells, formulas, values, identifiers, content, paths, or other keys
at_or_below_limit_result: undefined; means only this detector did not establish an XLSX sheet-limit or cell-limit block; not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result, macro-safety result, external-relationship result, path-safety result, formula-safety result, instruction-safety result, content-validity result, or downstream-processing authorization
counter_behavior: counts direct sheet elements in workbook sheets collection including visible, hidden, and veryHidden sheets; stops immediately at sheet 21; resolves sheet r:id only through xl/_rels/workbook.xml.rels; counts actual worksheet c elements by namespace/local name only in internally referenced worksheet parts; stops immediately at cell 1000001; dimensions, row numbers, ranges, shared strings, comments, formulas, string text containing <c>, and orphan worksheets do not create counted cells
sanitized_failure_behavior: missing, duplicate, unresolved, malformed, absolute, external, or traversal relationship mappings; DTD/entity declarations; unsupported XML; malformed ZIP/XML; unsupported compression; decompression failure; and unexpected parser output use the sanitized XLSX sheet/cell limit inspection failure path; no raw content, decoded content, parser detail, stack, path, identifier, relationship target, row, cell, value, formula, or internal detail is returned by the detector result
instruction_formula_boundary: formula and instruction-like contents remain inert data; detector does not execute, evaluate, rewrite, neutralize, return, persist, expose, retain, or log workbook content, formulas, filenames, relationship targets, XML, paths, rows, cells, or values
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
pdf_worker_changed: false
macro_detection_added: false
external_relationship_classification_added: false
archive_limit_work_added: false
dependencies_or_lockfiles_changed: false
focused_xlsx_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 24; pass 24; fail 0
focused_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 24; pass 24; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 74; pass 74; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 772; pass 745; fail 27
sprint2_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 820; pass 820; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 877; pass 850; fail 27
full_repository_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 925; pass 925; fail 0
complete_diff_inspected: true before ExecPlan update and rechecked before commit
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/xlsxSheetCellLimitDetector.js; __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, macro detection, external-relationship classification, archive-limit work, Current State update, Implementation Baseline update, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 OOXML path-traversal detection

```text
p0_05_package_status: ooxml_path_traversal_detection_complete_ready_to_commit
implementation_status: bounded_internal_xlsx_result_only
verification_status: TOOL_VERIFIED after pre-edit capability probe, focused OOXML, repository-contract, affected file-policy, Sprint 2, full-suite, diff, and post-commit clean-state checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 0945fde51bffd7fe654247005c92d45cd4cc48ca
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, Implementation Baseline, P0-06B, executor mapping, persistence, route/service/listener wiring, PDF-worker change, macro detection, external-relationship classification, archive-limit work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_OOXML_PATH_TRAVERSAL_DETECTOR_V1 newly authorized by this package prompt; the category ooxml_path_traversal and exact two-key result shape were not described as pre-existing committed repository authority
owner_duplicate_authority: duplicate normalized ZIP entry names newly owner-authorized to block under ooxml_path_traversal; exact duplicate ZIP entry names also block under this category
authorized_result_shape: exactly policy block and category ooxml_path_traversal; exact enumerable keys policy and category; no scope, evidence, metadata, entry names, targets, relationship identifiers, XML, workbook content, paths, stacks, parser internals, counts, or other keys
pre_edit_capability_probe: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node /private/tmp/kai-p0-05-ooxml-capability-probe.mjs from /private/tmp returned capabilityPass true and repeated true with sanitized facts only; proved central-directory enumeration including directories and duplicates, every Relationship in every .rels part, and Target/TargetMode readability without outputting entry names or relationship targets
capability_gap: false
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/ooxmlPathTraversalDetector.js; __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
precedence_matches_owner_decision: complete XLSX shallow identity -> bounded XLSX sheet-count detector -> bounded XLSX cell-count detector -> OOXML path-traversal detector; duplicate ZIP entry-name detection is the explicit exception needed to classify newly owner-authorized duplicate normalized package names under this category
zip_entry_behavior: blocks central-directory entry names containing a .. segment, backslash, NUL, drive-letter form, UNC form, or leading filesystem-absolute form; duplicate detection normalizes by removing . and empty slash-separated segments, preserving case and directory/file distinction, and not percent-decoding
relationship_behavior: inspects every Relationship in every .rels part; TargetMode absent defaults internal; TargetMode Internal is inspected; TargetMode External is ignored here and not followed or classified
internal_target_behavior: package-absolute leading slash resolves from package root and is allowed when inside package; literal relative .. is allowed only when normalized resolution remains inside package; blocks escape above package root, backslash, NUL, drive-letter form, UNC form, filesystem-path form, invalid percent encoding, and traversal revealed by one URI percent-decoding pass
sanitized_failure_behavior: malformed or ambiguous ZIP/XML/relationship structures, missing targets, unsupported constructs, malformed deflate or unsupported compression, and thrown operations use the sanitized OOXML path-traversal inspection failure path; duplicate normalized entries are the explicit exception and block
non_exposure_boundary: detector and tests do not expose entry names, targets, XML, workbook content, paths, stacks, parser internals, relationship identifiers, counts, formulas, values, or dependency details in returned results or sanitized errors
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
pdf_worker_changed: false
macro_detection_added: false
external_relationship_classification_added: false
archive_limit_work_added: false
dependencies_or_lockfiles_changed: false
focused_ooxml_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 23; pass 23; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 83; pass 83; fail 0
sprint2_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 829; pass 829; fail 0
full_repository_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 934; pass 934; fail 0
complete_diff_inspected: true before ExecPlan update and rechecked before commit
git_diff_check: git diff --check and git diff --cached --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/ooxmlPathTraversalDetector.js; __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, macro detection, external-relationship classification, archive-limit work, Current State update, Implementation Baseline update, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 XLSX macro and external-relationship detection

```text
p0_05_package_status: xlsx_macro_external_relationship_detection_complete_ready_to_commit
implementation_status: bounded_internal_xlsx_result_only
verification_status: TOOL_VERIFIED after pre-edit capability probe, focused XLSX macro/external, repository-contract, affected file-policy, Sprint 2, full-suite, diff, and post-commit clean-state checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: fdc3afa57a1a429d17f141218a5a64368ccddd30
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, Implementation Baseline, P0-06B, executor mapping, persistence, route/service/listener wiring, PDF-worker change, archive-limit work, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_XLSX_MACRO_EXTERNAL_RELATIONSHIP_DETECTOR_V1 newly authorized by this package prompt; the category xlsx_macro_or_external_relationship and exact two-key result shape were not described as pre-existing committed repository authority
owner_fusion_authority: macro presence and external-relationship presence deliberately fuse into one P0 block category; P0 does not distinguish macro and external-relationship findings in this result
owner_all_external_authority: any relationship whose TargetMode is exactly External blocks regardless of relationship type, including hyperlinks, linked images, oleObject links, and unknown external relationship types
pre_edit_capability_probe: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --input-type=module inline synthetic probe - P0_05_XLSX_ACTIVE_CONTENT_CAPABILITY_PROBE_PASS iterations=5 contentTypeKinds=2 relationshipPartClasses=4 relationshipTriplesPerIteration=4 output=safe_counts_only
capability_gap: false
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/xlsxMacroExternalRelationshipDetector.js; __tests__/kai-sprint2-xlsx-macro-external-relationship-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
precedence_matches_owner_decision: complete XLSX shallow identity -> bounded XLSX sheet-count detector -> bounded XLSX cell-count detector -> OOXML path-traversal detector -> XLSX macro/external-relationship detector; the new detector runs only after OOXML traversal returns undefined and preserves earlier traversal blocks
protected_result_shape: exactly policy block and category xlsx_macro_or_external_relationship; exact enumerable keys policy and category; no scope, evidence, metadata, entry names, targets, relationship identifiers, XML, workbook content, paths, stacks, parser internals, macro names, content-type strings, counts, formulas, values, or other keys
at_or_below_active_content_result: undefined; means only this detector did not establish an XLSX macro or external-relationship block; not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result, macro-safety result, external-relationship-safety result, archive-safety result, formula-safety result, instruction-safety result, content-validity result, or downstream-processing authorization
content_type_behavior: parses [Content_Types].xml and distinguishes Default and Override entries; blocks macro-enabled workbook, macrosheet, international-macrosheet, VBA-project, and VBA-signature content types; malformed or ambiguous content-type metadata uses sanitized failure
relationship_behavior: inspects every Relationship in every .rels part after traversal passes; reads Type, Target, and TargetMode only for deterministic decisioning; blocks VBA, VBA-signature, macrosheet, international-macrosheet relationship types; blocks TargetMode exactly External for hyperlink, linked image, oleObject, and unknown external relationship types; TargetMode absent or exactly Internal does not block here; any other TargetMode value sanitizes
part_behavior: blocks VBA project and VBA signature part presence without reading VBA bytes
sanitized_failure_behavior: malformed or ambiguous ZIP/XML/content-type structures, unexpected parser output, unsupported compression, decompression failure, and thrown operations use the sanitized XLSX macro/external relationship inspection failure path; no block or pass is returned for malformed ambiguity
non_execution_boundary: does not follow targets, read VBA bytes, execute macros, evaluate formulas, use filesystem, invoke external ZIP utilities, install dependencies, or add archive-entry, expanded-size, compression-ratio, timeout, state-transition, executor, route, service, persistence, database, audit, deployment, Current State, Implementation Baseline, or PDF-worker work
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
pdf_worker_changed: false
archive_limit_work_added: false
dependencies_or_lockfiles_changed: false
focused_xlsx_macro_external_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-macro-external-relationship-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 25; pass 25; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-xlsx-macro-external-relationship-detector.spec.js __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 93; pass 93; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM with tests 791; pass 764; fail 27
sprint2_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 839; pass 839; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM with tests 896; pass 869; fail 27
full_repository_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 944; pass 944; fail 0
complete_diff_inspected: true before ExecPlan update and rechecked before commit
git_diff_check: git diff --check - pass before ExecPlan update and pass after final ExecPlan entry
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/validators/xlsxMacroExternalRelationshipDetector.js; __tests__/kai-sprint2-xlsx-macro-external-relationship-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, archive-limit work, Current State update, Implementation Baseline update, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 OOXML archive resource-limit detection

```text
p0_05_package_status: ooxml_archive_resource_limit_detection_complete_ready_to_commit
implementation_status: bounded_internal_ooxml_result_only
verification_status: TOOL_VERIFIED after capability probe, focused archive/contract, affected file-policy, Sprint 2, full-suite, diff, and post-commit clean-state checks complete
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 4aa99a65fee3f8ea873347269255926e8c7d306e
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, Implementation Baseline, P0-06B, executor mapping, persistence, route/service/listener wiring, malware handling, standalone archive support, timeout implementation, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_OOXML_ARCHIVE_RESOURCE_LIMIT_DETECTOR_V1 newly authorized by this package prompt; constants maximum_zip_entries 2000, maximum_total_expanded_bytes 262144000, maximum_compression_ratio 100:1, whole_assessor_timeout_ms_recorded_not_implemented 10000, and categories archive_entry_limit_exceeded, archive_expanded_size_limit_exceeded, and archive_compression_ratio_limit_exceeded are newly owner-authorized
timeout_boundary: whole-assessor timeout constant 10000 ms recorded in contract/runtime constants only; timeout enforcement not implemented in this package
pre_edit_capability_probe: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --input-type=module repeated synthetic probe - P0_05_ARCHIVE_LIMIT_CAPABILITY_PROBE_PASS iterations 5; proved central-directory enumeration including directories, exact stored and deflated emitted-byte counting, mid-entry inflation abort after 5120 emitted bytes while consuming only 65541 of 524456 compressed bytes, and compressed/expanded tracking without retaining or exposing entry content
capability_gap: false
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/ooxmlArchiveResourceLimitDetector.js; __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
precedence_matches_owner_decision: complete XLSX shallow identity -> bounded XLSX sheet-count detector -> bounded XLSX cell-count detector -> OOXML path-traversal detector -> XLSX macro/external-relationship detector -> OOXML archive resource-limit detector; archive-local precedence is entry count -> expanded size -> compression ratio
protected_result_shapes: exactly policy block and category archive_entry_limit_exceeded, archive_expanded_size_limit_exceeded, or archive_compression_ratio_limit_exceeded; exact enumerable keys policy and category; no scope, evidence, metadata, entry names, bytes, XML, workbook content, paths, stacks, parser internals, compressed/expanded counts, dependency internals, or other keys
no_block_result: undefined only when archive entry-count, expanded-size, and compression-ratio checks all pass; not a file-policy pass, type-agreement pass, upload acceptance result, macro-safety result, external-relationship-safety result, path-safety result, content-validity result, or downstream-processing authorization
entry_count_behavior: counts every central-directory entry including directories; 2000 entries pass; entry 2001 blocks immediately as archive_entry_limit_exceeded
expanded_size_behavior: enforces actual emitted expanded bytes, not declared size; 262144000 total expanded bytes pass; stops at emitted byte 262144001 and returns archive_expanded_size_limit_exceeded; simultaneous expanded-size and ratio breach returns expanded-size
compression_ratio_behavior: computes expanded_bytes / compressed_bytes per entry and running aggregate using actual emitted expanded bytes and compressed payload bytes consumed; stored entries are 1:1; exactly 100:1 passes; strictly greater than 100:1 blocks; non-empty zero-compressed entry blocks as ratio exceeded
sanitized_failure_behavior: forged or inconsistent ZIP metadata, unsupported compression, malformed structure, decompression failure, and mismatched emitted sizes use sanitized OOXML archive resource-limit inspection failure; no block or pass is returned for malformed ambiguity
non_exposure_boundary: detector and tests do not retain or expose entry bytes, names, XML, workbook content, paths, stacks, parser internals, compressed or expanded payloads, dependency internals, raw bytes, formulas, values, or counts in detector results
state_and_integration_boundary: detector directly changes none of file_policy_status, processing_status, parse_status, or upload_state; internal result only
executor_or_route_wiring_changed: false
database_or_audit_writes_added: false
public_api_mapping_added: false
client_serialization_added: false
pdf_worker_changed: false
malware_handling_added: false
standalone_archive_support_added: false
timeout_implementation_added: false
dependencies_or_lockfiles_changed: false
focused_archive_and_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 29; pass 29; fail 0
affected_file_policy_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js __tests__/kai-sprint2-xlsx-macro-external-relationship-detector.spec.js __tests__/kai-sprint2-ooxml-path-traversal-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-p0-05f-combined-completeness.spec.js - tests 106; pass 106; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listener EPERM with tests 804; pass 777; fail 27
sprint2_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 852; pass 852; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listener EPERM with tests 909; pass 882; fail 27
full_repository_suite: localhost-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 957; pass 957; fail 0
database_sentinel: non-listening loopback DATABASE_URL at 127.0.0.1:9 used for every Node and npm command
complete_diff_inspected: true before commit after final ExecPlan update
git_diff_check: git diff --check - pass
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/config/kaiSprint2P0Contract.js; Backend/kai/validators/ooxmlArchiveResourceLimitDetector.js; __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single bounded implementation package commit; do not start executor mapping, persistence, route/service/listener wiring, public API/client mapping, database/cloud/production/deployment behavior, P0-06B, Gate A, timeout implementation, malware handling, standalone archive support, Current State update, Implementation Baseline update, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-06A unauthorized transition negative coverage

```text
leaf_status: complete after this bounded test-only package commit
p0_06a_package_status: unauthorized_transition_negative_coverage_added
implementation_status: test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: c78b368d6bebd0c831eee2e4a2ee91b42bba1615
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded P0-06A test-only negative coverage for unauthorized upload-lifecycle transitions; no implementation, contract-authority, replay, confirmation-conflict, expiry-boundary, accepted-key, tenant, defensive-copy, envelope, prohibited-field, factory-hardening, broad-suite, full-suite, P0-06B, database, cloud, or production change
authorized_file_scope: __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
negative_matrix_source: committed KAI_SPRINT2_P0_UPLOAD_STATES seven-state set and committed thirteen authorized-edge set
negative_matrix_count: 7 states x 6 non-self targets = 42 directed pairs; 42 - 13 authorized edges = 29 unauthorized edges
unauthorized_edges_tested: 29
terminal_state_negative_coverage: every outgoing non-self transition from policy_blocked, abandoned, and expired is included
expiry_isolation: pre-confirmation unauthorized-edge assertions use pre-expiry caller-supplied now; expired source state is reached only by reserved -> expired at the valid expiry timing precondition; no wall-clock time or sleeps
asserted_denial_shape: ok false; data null; error code state_transition_denied; status 422
stored_record_immutability_asserted: true
lifecycle_repository_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test **tests**/kai-sprint2-p0-upload-lifecycle-repository.spec.js - 13 passed, 0 failed
repository_contract_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test **tests**/kai-sprint2-p0-repository-contract.spec.js - 9 passed, 0 failed
focused_test_counts: lifecycle repository 13; repository contract 9
p0_06a_acceptance_status: pending
p0_06b_status: Gate-A-blocked
gate_a_status: blocked
remaining_pending_verification: replay, expiry, tenant, envelope, prohibited-field, defensive-copy, broad Sprint 2 suite, and full repository suite
package_exclusions: no production code, route, service, storage, database, runtime configuration, dependency, lockfile, Current State, Implementation Baseline, contract authority, P0-06B, Gate A, push, deployment, cloud, credential, real-client-data, broad-suite, or full-suite change
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-06A replay and confirmation-conflict coverage

```text
leaf_status: complete after this bounded test-only package commit
p0_06a_package_status: replay_and_confirmation_conflict_coverage_added
implementation_status: test_only
verification_status: TOOL_VERIFIED after documented checks pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: fea74224ca4c7d315e3da9282c58579c9dbbc48f
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded P0-06A test-only replay and confirmation-conflict coverage for the synthetic upload-lifecycle repository; no implementation, contract-authority, transition-graph, expiry-boundary, accepted-key, tenant, defensive-copy, envelope, prohibited-field, factory-hardening, terminal-replay, broad-suite, full-suite, P0-06B, database, cloud, or production change
authorized_file_scope: __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
replay_confirmation_coverage_added: uploaded_unconfirmed exact object-version replay; uploaded_unconfirmed conflicting object-version replay 409; confirmed exact object-version/checksum/size replay; confirmed independent object-version, checksum, and size conflict 409s; retry now immutability; confirmation size 0 acceptance; negative and non-integer size validation blockers; uppercase checksum validation blocker
stored_record_immutability_asserted: every replay and failed attempt in this leaf asserts stored state unchanged
lifecycle_repository_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test **tests**/kai-sprint2-p0-upload-lifecycle-repository.spec.js - 17 passed, 0 failed
repository_contract_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test **tests**/kai-sprint2-p0-repository-contract.spec.js - 9 passed, 0 failed
focused_test_counts: lifecycle repository 17; repository contract 9
p0_06a_acceptance_status: pending
p0_06b_status: Gate-A-blocked
gate_a_status: blocked
remaining_pending_verification: expiry, tenant, envelope, prohibited-field, defensive-copy, terminal-replay, broad Sprint 2 suite, and full repository suite
package_exclusions: no production code, route, service, storage, database, runtime configuration, dependency, lockfile, Current State, Implementation Baseline, contract authority, P0-06B, Gate A, push, deployment, cloud, credential, real-client-data, broad-suite, or full-suite change
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-06A envelope and boundary coverage

```text
leaf_status: complete after this bounded test-only package commit
p0_06a_package_status: envelope_and_boundary_coverage_added
implementation_status: test_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 5836a011e6a0e21dfd481559d6c779dbd17648ab
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded P0-06A test-only envelope and boundary coverage for the synthetic upload-lifecycle repository; no implementation, contract-authority, transition-graph, replay, confirmation-conflict, expiry-boundary, accepted-key, factory-hardening, broad-suite, full-suite, P0-06B, database, cloud, or production change
authorized_file_scope: __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
authority_reference: OWNER_DECISION.P0_06A.SYNTHETIC_UPLOAD_LIFECYCLE_REPOSITORY_V1
authority_evidence: USER_CONFIRMED
envelope_boundary_coverage_added: exact create success envelope; exact transition success envelope; exact read success envelope without replayed; exact failure envelope for validation_blocker/422, state_transition_denied/422, conflict_current_state_changed/409, and not_found/404; success-record authorized-field subset and prohibited private-storage-field exclusion across create/read/transition; cross-tenant read and transition not_found identity with absent records; defensive-copy immutability across returned write records and successive reads
authorized_record_field_count_asserted: 12
failure_error_extra_fields_asserted_absent: TOOL_VERIFIED
success_read_replayed_field_asserted_absent: TOOL_VERIFIED
cross_organization_disclosure: TOOL_VERIFIED by response identity assertion; missing and nondisclosable records both return identical not_found / 404 envelopes
stored_record_defensive_copy_asserted: TOOL_VERIFIED
lifecycle_repository_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 22; pass 22; fail 0
focused_test_counts: total 22; passed 22; failed 0
p0_06a_acceptance_status: pending
p0_06b_status: NOT_CONFIRMED
gate_a_status: NOT_CONFIRMED
p0_06b_gate_a_blocked_by_plan_authority: USER_CONFIRMED
package_exclusions: no production code, route, service, storage, database, runtime configuration, dependency, lockfile, Current State, Implementation Baseline, contract authority, P0-06B, Gate A, push, deployment, cloud, credential, real-client-data, broad-suite, or full-suite change
next_package_or_stop_condition: OWNER-DIRECTED STOP after this two-file commit; do not begin another leaf without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-06A expiry boundary coverage

```text
leaf_status: complete after this bounded test-only package commit
p0_06a_package_status: expiry_boundary_coverage_added
implementation_status: test_only
verification_status: TOOL_VERIFIED
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 6177e882c153fd1c01189d8210ccf34e5b455558
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for the focused Node test command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded P0-06A test-only expiry-boundary coverage for the synthetic upload-lifecycle repository; no implementation, contract-authority, transition-graph, replay/confirmation-conflict beyond expiry-order assertions, accepted-key, tenant, defensive-copy, envelope, prohibited-field, factory-hardening, broad-suite, full-suite, P0-06B, database, cloud, or production change
authorized_file_scope: __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
authority_reference: OWNER_DECISION.P0_06A.SYNTHETIC_UPLOAD_LIFECYCLE_REPOSITORY_V1
authority_evidence: USER_CONFIRMED
expiry_boundary_coverage_added: replay-before-expiry ordering at and after upload_expires_at; expiry precedence over expected-state mismatch and unauthorized-edge denial for non-replay pre-confirmation transitions; before/at/after expiry boundary timing; expired transition allowed at and after expiry from reserved, upload_started, and uploaded_unconfirmed only; confirmed exact replay after expiry unaffected by expiry; readable stored records and unchanged upload_expires_at after expiry denial and expired transition
caller_supplied_clock_only: TOOL_VERIFIED
denial_envelope_asserted: ok false; data null; error code state_transition_denied; status 422
no_deletion_or_retention_on_expiry_asserted: TOOL_VERIFIED
lifecycle_repository_test_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 28; pass 28; fail 0
focused_test_counts: total 28; passed 28; failed 0
p0_06a_acceptance_status: pending
p0_06b_status: NOT_CONFIRMED
gate_a_status: NOT_CONFIRMED
p0_06b_gate_a_blocked_by_plan_authority: USER_CONFIRMED
package_exclusions: no production code, route, service, storage, database, runtime configuration, dependency, lockfile, Current State, Implementation Baseline, contract authority, P0-06B, Gate A, push, deployment, cloud, credential, real-client-data, broad-suite, or full-suite change
next_package_or_stop_condition: OWNER-DIRECTED STOP after this two-file commit; do not begin another leaf without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-06A zero-byte confirmation rejection hardening

```text
p0_06a_package_status: zero_byte_confirmation_rejection_added
implementation_status: implementation_and_contract_change
verification_status: TOOL_VERIFIED after focused + full-suite pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: d490142127426ad793dcc876090e514e322a8e5e
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
zero_byte_confirmed_discovery: no other zero-byte-confirmed occurrences
authorized_file_scope: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/upload/inMemoryUploadLifecycleRepository.js; __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
contract_amendment: confirmed entry requires verified_size_bytes >= 1; zero rejected validation_blocker/422
implementation_change: confirmation validation now requires verifiedSizeBytes >= 1
existing_test_amended: "confirmation accepts zero size..." zero sub-case flipped to rejection
positive_confirmation_coverage_added: verified_size_bytes 1 succeeds; normal positive verified_size_bytes succeeds
focused_test_counts: tests 28; pass 28; fail 0
full_suite_counts: tests 695; pass 695; fail 0
p0_06a_acceptance_status: pending
p0_06b_status: NOT_CONFIRMED
gate_a_status: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this commit; do not begin another leaf or acceptance without separate owner authorization
```


## P0-06A owner acceptance

```text
p0_06a_acceptance_status: accepted
accepted_by: owner (USER_CONFIRMED)
accepted_at_head: 0f7893c78249a97e5ac32dfa6f223929f339e1f3
acceptance_basis: complete P0-06A synthetic-lifecycle coverage (13 positive edges, 29 negative edges, terminal-state rejection, replay and confirmation-conflict, cross-org isolation, defensive copy, exact success/failure envelopes, prohibited-field boundary, expiry-boundary and ordering); zero-byte confirmed uploads rejected in contract + implementation + tests (verified_size_bytes >= 1, validation_blocker/422); full suite node --test **tests**/*.spec.js green at 695 pass / 0 fail in a listener-capable environment, owner-run; prior loopback EPERM failures confirmed environmental
acceptance_scope: full — no deferred items; zero-byte rejection is included, not outstanding
reviewed_work_backed_up: origin/codex/kai-sprint2-p0-v0.3.5 == 0f7893c (USER_CONFIRMED)
production_state: main at e39efb2, untouched; reviewed branch not merged, not deployed
p0_06b_status: NOT_CONFIRMED
gate_a_status: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this acceptance commit; P0-06B and Gate A remain blocked; do not begin any P0-06B, Gate A, merge, or deploy work without separate owner authorization
```


## P0-06A local test storage adapter

```text
p0_06a_package_status: local_test_storage_adapter_exact_safety_fix_complete_not_staged
implementation_status: IMPLEMENTED_NOT_STAGED
verification_status: TOOL_VERIFIED after focused + relevant P0 + full-suite pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: ae1aca879baa7b34eb3054acdc22e01975fd749a
exact_safety_fix_starting_state: expected unstaged local-storage package only; branch and HEAD matched owner request; staged paths none
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded owner-directed P0-06A local test storage adapter only, separate from and not modifying OWNER_DECISION.P0_06A.SYNTHETIC_UPLOAD_LIFECYCLE_REPOSITORY_V1
repository_seam: existing Backend/kai/storage/storageAdapter.js seam with existing Backend/kai/storage/localDevStorageAdapter.js implementation location reused; focused storage boundary spec reused at __tests__/kai-sprint2-storage-boundary.spec.js
adapter_behavior_added: dependency-injected private-root local dev/test byte adapter; exclusive create-once object-version storage; repeated generated-version collision rejection; adapter-generated provider-neutral immutable object_version_id; exact-version stat and read; complete per-chunk write loop with size_bytes counted from bytes actually written; incomplete write cleanup after source failure or abort; filesystem root rejection; root and objects directory canonicalization before object operations; configured root and objects directory reject symlink components instead of following them; exact object file final-component O_NOFOLLOW used only when available, with adapter unavailable otherwise; test-scoped teardown compares canonical paths, requires strict descendant of the canonical OS temporary directory, and rejects symlink components before removal; defensive binary byte copying; safe ordinary result/error boundary without raw bytes, filesystem paths, bucket, signed URL, or provider-private identifiers
production_selection: default storage provider remains disabled/fail-closed; GCS provider remains disabled SDK-free stub; local adapter not added to production barrel
changed_files: Backend/kai/storage/localDevStorageAdapter.js; __tests__/kai-sprint2-storage-boundary.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_adapter_spec: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js - tests 19; pass 19; fail 0
relevant_p0_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js __tests__/kai-sprint2-storage-path-policy.spec.js - tests 20; pass 20; fail 0
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listener EPERM with 654 pass / 7 fail; localhost-capable rerun passed tests 709; pass 709; fail 0
p0_06a_synthetic_upload_lifecycle_repository_changed: false
routes_or_listeners_changed: false
confirmation_or_hashing_added: false
schema_or_sql_changed: false
database_or_cloud_binding_added: false
new_dependency_added: false
contract_changed: false
p0_06b_status: NOT_CONFIRMED
gate_a_status: NOT_CONFIRMED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this unstaged package; do not stage, commit, push, deploy, or begin another package without separate owner authorization
```

## P0-06A exact-version stream prerequisite

```text
p0_06a_package_status: exact_version_stream_ownership_fix_complete_not_staged
implementation_status: IMPLEMENTED_NOT_STAGED
verification_status: TOOL_VERIFIED after focused + combined + full-suite pass
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: a67fee1b2f6db3e9a4cc67af8bdc36fb5baf9994
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded prerequisite before local exact-version confirmation; no confirmUpload implementation
storage_result_guard: uploadReservedIntakeFile now treats only explicit ok:false as ordinary storage failure and only explicit ok:true as eligible to proceed; malformed storage results sanitize to internal new-reservation-required failure without final lifecycle transition or deletion
stream_boundary_added: provider-neutral openObjectVersionReadStream({ objectVersionId, signal? }) on the local dev adapter and storage adapter seam
same_open_handle_binding: object-version ID validation precedes filesystem access; the adapter opens the exact object version once; size_bytes comes from that handle; byte_source owns and reads from that same handle
streaming_boundary: byte_source is async-iterable streamed chunks, not a full-file Buffer; sufficiently large fixtures yield multiple chunks
cleanup_boundary: byte_source provides an explicit provider-neutral close operation; consumers must fully consume byte_source or invoke close/release; one idempotent close path closes the owned handle on normal completion, stream/read failure, abort during reading, abort before iteration begins, early consumer cancellation, consumer throw, and explicit close before or during iteration
abort_boundary: abort handling is attached when ownership of the opened exact-version handle transfers to byte_source; abort closes the handle even before iteration begins; the abort listener is removed when the handle closes
private_boundary: no filesystem path, object key, URI, bucket, native filesystem diagnostic, provider-private identifier, or raw byte payload is returned outside the byte source
confirmation_status: confirmation remains unimplemented in this package; a future confirmUpload implementation must use try/finally and invoke byte_source.close() whether hashing succeeds or fails; checksum hashing and lifecycle confirmation remain the next package
p0_06b_and_gate_a: unchanged and unauthorized
changed_files: Backend/kai/services/kaiIntakeService.js; Backend/kai/storage/storageAdapter.js; Backend/kai/storage/localDevStorageAdapter.js; __tests__/kai-sprint2-intake-service.spec.js; __tests__/kai-sprint2-storage-boundary.spec.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_intake_service_spec: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js - tests 47; pass 47; fail 0
focused_storage_boundary_spec: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js - tests 35; pass 35; fail 0
combined_p0_specs: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-storage-boundary.spec.js - tests 110; pass 110; fail 0
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listener EPERM with tests 715; pass 708; fail 7; listener-capable rerun passed tests 763; pass 763; fail 0
```

## P0-06A internal exact-version verifier

```text
p0_06a_package_status: internal_exact_version_verifier_implemented_not_staged
implementation_status: IMPLEMENTED_NOT_STAGED
verification_status: TOOL_VERIFIED after required focused + combined + full-suite commands completed
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: e8578eaaaa0a3d0241b283ac66cc31b4d630e462
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no database/cloud/production/push/deployment/current-state access authorized
active_package_scope: bounded internal streamed exact-version SHA-256 verifier required by later confirmUpload orchestration; no confirmUpload orchestration implementation
trusted_input_boundary: helper receives only storageAdapter, objectVersionId, declaredChecksum, expectedSizeBytes, hashAlgorithm, and signal; no actor authorization, public payload parsing, metadata read, lifecycle read, lifecycle transition, or response shaping
storage_call_boundary: helper calls only storageAdapter.openObjectVersionReadStream({ objectVersionId, signal? }); explicit ok:false is the only ordinary returned storage failure; explicit ok:true is the only success-eligible result; malformed results are sanitized
verification_boundary: validates provider-neutral exact object-version identity, storage size, async byte source, close method, chunk byte types, streamed byte count, trusted expected size, and computed lowercase SHA-256
streaming_boundary: Node SHA-256 is updated chunk-by-chunk; no whole-object concatenation or buffering in the helper
cleanup_boundary: after a callable byte_source.close() is exposed by an explicit storage ok:true, helper invokes byte_source.close() for malformed returned object-version ID, malformed storage size, malformed byte_source, success, checksum mismatch, storage-size mismatch, malformed chunk, excess bytes, insufficient bytes, read exception, abort, and unexpected verification failure
private_boundary: raw bytes, paths, object keys, buckets, URIs, native handles, signed URLs, provider-private identifiers, and native storage diagnostics do not escape
lifecycle_boundary: no lifecycle transition in this package; confirmUpload orchestration remains next
p0_06b_and_gate_a: unchanged and unauthorized
changed_files: Backend/kai/services/kaiIntakeService.js; __tests__/kai-sprint2-intake-service.spec.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_intake_service_spec: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js - tests 75; pass 75; fail 0
focused_storage_boundary_spec: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js - tests 35; pass 35; fail 0
combined_p0_specs: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-storage-boundary.spec.js - tests 138; pass 138; fail 0
full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listener EPERM with tests 743; pass 736; fail 7; listener-capable rerun passed tests 791; pass 791; fail 0
```

## P0-06A confirmUpload orchestration

```text
p0_06a_package_status: confirm_upload_finalized_not_staged
implementation_status: IMPLEMENTED_NOT_STAGED
verification_status: USER_CONFIRMED after owner-run listener-capable full-suite pass
evidence_class: USER_CONFIRMED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 2e7492b44993dc155d259394cbc95070e6e69320
active_package_scope: bounded confirmUpload(input, dependencies) service orchestration; no route, listener, production composition, P0-06B, Gate A, database, cloud, deployment, parsing, profiling, evidence generation, or live-upload readiness
metadata_boundary: one organization-scoped metadata read supplies declared checksum, sha256, and expected size
lifecycle_boundary: lifecycle supplies exact object version and current upload state
verification_boundary: exact-version verification streams and hashes stored bytes using trusted facts only
checksum_mismatch_boundary: checksum mismatch returns checksum_mismatch and performs no transition
success_transition: uploaded_unconfirmed -> confirmed
repository_authority: lifecycle repository owns first confirmation, identical replay, and changed-fact conflict
response_boundary: successful response uses the restricted allowlist
unchanged_boundaries: routes, listeners, production composition, P0-06B, and Gate A remain unchanged
changed_files: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; Backend/kai/services/kaiIntakeService.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md; __tests__/kai-sprint2-foundation-safety.spec.js; __tests__/kai-sprint2-intake-service.spec.js
focused_intake_service_spec: TOOL_VERIFIED agent-run DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js - tests 82; pass 82; fail 0
combined_p0_specs: TOOL_VERIFIED agent-run DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-storage-boundary.spec.js - tests 145; pass 145; fail 0
full_repository_suite: USER_CONFIRMED owner-run listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 799; pass 799; fail 0
```

## P0-07 local synthetic HTTP acceptance

```text
p0_07_package_status: local_synthetic_http_acceptance_corrected_complete
implementation_status: complete
verification_status: TOOL_VERIFIED after required final P0-07 verification commands completed against corrected real-router acceptance
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 2297ddc6d9155a77a2aa1d0864345d6d05ecd9da
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, or Gate A work authorized or performed
active_package_scope: corrected P0-07 local synthetic HTTP acceptance using contract-defined real router upload and confirm-upload routes plus dependency-injected nonproduction components; no production listener, database, cloud, deployment, tenant configuration, parser/profile/source/evidence/claim/generation/export, P0-06B, Gate A, Current State, or Implementation Baseline change
assembled_acceptance_composition: ephemeral real HTTP listener; real feature-gate middleware; production-equivalent local authentication-adapter behavior using deterministic fixtures; real Sprint 2 router including POST /admin/files/:intakeFileId/upload and POST /admin/files/:intakeFileId/confirm-upload; real services and validators; in-memory metadata and upload lifecycle repositories; local storage adapter rooted in canonical OS temp; deterministic clock, identity, UUID/object-version, request-ID, audit, metrics, and safe logging seams
real_router_correction: added contract-defined router upload and confirm-upload routes using uploadReservedIntakeFile and confirmUpload service boundaries; route validation, tenant extraction, authentication through the existing mount, KAI feature gates, no-store middleware, safe request context, and canonical error shaping preserved
upload_streaming_boundary: added bounded upload media-type and timed byte-source middleware that passes a single async byte source to storage without route buffering; uses the committed idle and total timeout constants, request abort signal, and existing storage adapter streaming/cleanup behavior
security_assessment_boundary: no human-facing security-assessment route was added; prior test-mounted security-assessment and internal-operation routes were removed; broader assessor orchestration beyond the existing pure detector and internal executor identity remains not route-defined in the repository and is not claimed as production/live behavior
p0_07_assessor_acceptance_dependency: local synthetic HTTP acceptance for XLSX path traversal, expansion bomb, macros, external relationships, encrypted PDF/XLSX, PDF active content, PDF embedded files, uploaded prompt-injection text, and formula cells depends on implementation of OWNER_DECISION.P0_05_BOUNDED_ASSESSOR_V1 authority before those assessor outcomes may be claimed
positive_acceptance_path: feature enabled -> authenticated mapped human -> allowed role and active membership -> batch create through real router -> idempotent replay through real router -> file reserve through real router -> local streamed upload through real router -> immutable version -> confirm exact version through real router -> compute SHA-256 -> policy pending -> pure detector pass at lower boundary -> synthetic internal file-policy pass -> file remains quarantined -> sanitized operator read through real router -> review transition through real router
negative_acceptance_matrix: feature disabled; invalid mapping; wrong role; inactive membership; cross-tenant IDs; unbounded list attempts; 26th file; mocked concurrent reservations; actor and organization mutation-limit exhaustion; actor and organization concurrent-upload exhaustion; expired and explicitly abandoned reservations; malformed fingerprint; unknown metadata fields; request-body over-limit; unsafe Unicode filename; path traversal; oversize streamed body; checksum-mismatch streamed body; duplicate write; MIME/signature mismatch; binary TXT/MD; arbitrary archive; broader security-assessment route substitution absent; missing object after valid uploaded state through exact-version storage failure; replaced object version; checksum mismatch through real confirm-upload route; stale review transition; required-audit failure rollback at repository-interface level; telemetry failure not rolling back an authorized mutation; AI mutation; generic system mutation; unauthorized internal-executor mutation; parser/profile/source/evidence/claim/generation/export attempt at assistant-boundary validator; storage identifier leakage; raw content in logs, errors, audit, metrics, or responses
checksum_mismatch_http_boundary: shared KAI HTTP error allowlist now preserves checksum_mismatch as a 409 response instead of collapsing it to system_error
package_scripts_added: test:kai-sprint2; test:kai-sprint2-p0-acceptance
changed_files: Backend/kai/middleware/kaiSprint2RequestSafety.js; Backend/kai/routes/sprint2IntakeApi.js; __tests__/kai-sprint2-api-contract.spec.js; __tests__/kai-sprint2-foundation-safety.spec.js; __tests__/kai-sprint2-p0-acceptance.spec.js; __tests__/kai-sprint2-pass2-route-runtime.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
verify_schema_contract: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract - tests 9; pass 9; fail 0
verify_api_contract: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - tests 55; pass 55; fail 0
test_kai_sprint2: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 737; pass 737; fail 0
test_kai_sprint2_p0_acceptance: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 41; pass 41; fail 0
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 842; pass 842; fail 0
git_diff_check: git diff --check - pass
completion_language:
  P0 repository contract complete
  P0 local synthetic acceptance passed
  Persistent lifecycle integration pending Gate A
completion_states_established:
  P0_CODE_CONTRACT_COMPLETE
  P0_LOCAL_SYNTHETIC_HTTP_ACCEPTANCE_PASS
  P0_LOCAL_UPLOAD_CONTRACT_COMPLETE
not_established:
  P0_DATABASE_INTEGRATION_VERIFIED
  P0_DATABASE_UPLOAD_LIFECYCLE_VERIFIED
  P0_NONPRODUCTION_STORAGE_VERIFIED
  P0_LIVE_UPLOAD_READY
  REAL_CLIENT_DATA_READY
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
p0_06b_and_gate_a: unchanged and unauthorized
current_state_update: NOT_AUTHORIZED
```

## P0-07 corrected synthetic binding owner decision package

```text
p0_07_package_status: corrected_synthetic_binding_owner_decision_complete
implementation_status: complete
verification_status: TOOL_VERIFIED after focused acceptance, schema/API contract, Sprint 2, full repository, and diff checks
evidence_class: TOOL_VERIFIED
decision_evidence: USER_CONFIRMED OWNER_DECISION.P0_07_SYNTHETIC_BINDING_V1_CORRECTED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 06d5901766fcf964f3686312d8df4e845ea4c082
working_tree_clean_at_start: true
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, P0-06B, Gate A, queue drain, second audit path, production wiring, or real-client-data work authorized or performed
active_package_scope: bounded P0-07 local synthetic acceptance harness correction only; no production query, service, route, database, read-model, metadata policy write, persistent lifecycle convergence, durable metadata lifecycle mapping, P0-06B, Gate A, Current State, or Implementation Baseline change
changed_files: __tests__/kai-sprint2-p0-acceptance.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

corrected_binding_behavior:
  - C1 synthetic upload lifecycle compare-and-set remains the sole policy-state writer for assessment outcomes
  - in-memory metadata repository no longer marks file_policy_status or malware_scan_status passed during the positive assessment harness
  - established 14-field FileSummary DTO is constructed only as a test-only operator projection from C1 lifecycle state and metadata row fields
  - production HTTP file-detail route remains unchanged and continues to read committed metadata state only
  - processing_status and parse_status stay quarantined across every synthetic assessment outcome and are not changed by C2

malware_projection_behavior:
  - positive policy pass uses the explicitly injected test-only malware adapter with deterministic clean SHA-256 recognition
  - only the verified clean pass projects malware_scan_status passed in the test-only operator read
  - malware_scan_not_configured invokes no C1 policy decision, leaves lifecycle file_policy_status pending, projects malware_scan_status not_configured, and creates no review item
  - genuine malware_scan_failed follows the approved policy-failure path, writes lifecycle file_policy_status failed through C1, and does not project malware pass

review_creation_behavior:
  - review creation is a separate idempotent test-harness operation
  - idempotency key is organization_id + intake_file_review + intake_file + intake_file_id
  - exact replay creates no duplicate review item
  - review creation writes no policy, malware, lifecycle, or assessment-audit state
  - non-policy and unclassified outcomes create no review item and perform no additional state write

sanitized_http_mapping_behavior:
  - assessment_read_integrity_failure maps to HTTP 409 conflict_current_state_changed
  - maximum_concurrent_pdf_assessor_workers_exceeded maps to HTTP 500 system_error
  - malware_scan_not_configured maps to HTTP 500 system_error
  - C2_UNCLASSIFIED_OUTCOME maps to HTTP 500 system_error
  - internal assessment categories are not serialized in mapped HTTP responses

verification_results:
  focused_acceptance_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - sandbox listener EPERM only
  focused_acceptance_result: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 47; pass 47; fail 0
  verify_schema_contract: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract - tests 21; pass 21; fail 0
  verify_api_contract: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - tests 55; pass 55; fail 0
  test_kai_sprint2: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 954; pass 954; fail 0
  full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1059; pass 1059; fail 0
  git_diff_check_before_execplan_evidence_update: git diff --check - pass
  final_state_focused_acceptance_rerun: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 47; pass 47; fail 0
  final_state_git_diff_check: git diff --check - pass

completion_language:
  P0 repository contract complete
  P0 local synthetic acceptance passed
  Persistent lifecycle integration pending Gate A

not_established:
  P0_DATABASE_INTEGRATION_VERIFIED
  P0_DATABASE_UPLOAD_LIFECYCLE_VERIFIED
  P0_NONPRODUCTION_STORAGE_VERIFIED
  P0_LIVE_UPLOAD_READY
  REAL_CLIENT_DATA_READY

deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
nonproduction_storage_integration: NOT_CONFIRMED
production_readiness: NOT_CONFIRMED
real_client_data_readiness: NOT_CONFIRMED
p0_06b_and_gate_a: unchanged and unauthorized
current_state_update: NOT_AUTHORIZED
```

## P0-05 worker-backed assessor timeout implementation

```text
p0_05_package_status: worker_backed_assessor_timeout_implemented_ready_to_commit
implementation_status: complete
verification_status: TOOL_VERIFIED after synthetic pre-edit proof, focused, affected, Sprint 2, full-suite, and diff checks
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: bb8a744941d109f747bbb1722eac18fd16cc0002
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/production/deployment/current-state, executor, route/service/listener wiring, persistence, state transition, audit, malware, P0-06B, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_WORKER_BACKED_ASSESSOR_TIMEOUT_V1 newly records owner-authorized widening from prior PDF-worker timeout behavior to the existing worker-backed security-assessment boundary only
final_timeout_scope: existing worker-backed file-security assessment paths only; current production worker-backed path is Backend/kai/validators/pdfAssessorWorkerBoundary.js dispatching Backend/kai/validators/pdfAssessorWorkerThread.js
synchronous_detector_scope: unchanged; TXT/MD, type-agreement, CSV, XLSX sheet/cell, OOXML path-traversal, XLSX macro/external-relationship, and OOXML archive resource-limit detectors remain caller-thread deterministic detectors; no dispatcher and no forced worker migration added
timeout_configuration: PDF_ASSESSOR_PARENT_TIMEOUT_MS is fixed at 10000 ms; the parent timer starts immediately before file-backed worker dispatch and includes worker startup and worker processing
timeout_result: exact two-key status failed / category security_assessment_timeout; timeout remains an assessment failure and is not converted to policy block or pass
worker_lifecycle_behavior: one parent timer; one file-backed module worker; no nested workers; no data-URL or eval worker; no caller timeout override; no outer timeout wrapping an inner PDF timeout
timeout_cleanup_behavior: timeout latches the result, terminates the worker, rejects late messages and results, clears timers and listeners, releases the worker permit, and releases parent byte references
pre_edit_synthetic_file_backed_worker_proof: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --input-type=module synthetic /private/tmp harness - deadlineMs 10000; file worker URL protocol file:; normal PDF completed before deadline in 43 ms; synchronous blocked worker terminated with failed/security_assessment_timeout at 10004 ms; asynchronous streaming worker terminated with failed/security_assessment_timeout at 10008 ms; late success could not replace timeout and worker terminated at 10004 ms; malformed message, silent exit, and worker throw failed safely; timer, listeners, permit, and parent byte references released
focused_timeout_and_contract_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 81; pass 81; fail 0
affected_file_security_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test PDF worker, MuPDF dependency, repository contract, CSV, XLSX, OOXML, type-agreement, and TXT/MD detector specs - tests 159; pass 159; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM; tests 808; pass 781; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 856; pass 856; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM; tests 913; pass 886; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 961; pass 961; fail 0
git_diff_check_before_execplan_update: git diff --check - pass
changed_files: Backend/kai/validators/pdfAssessorWorkerBoundary.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js; __tests__/kai-sprint2-mupdf-dependency.spec.js; __tests__/support/kaiSprint2MupdfDependencyWorker.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
current_state_update: NOT_AUTHORIZED
implementation_baseline_update: NOT_AUTHORIZED
next_package_or_stop_condition: OWNER-DIRECTED STOP after this single worker-backed timeout package commit; do not begin executor mapping, persistence, route/service/listener wiring, database/cloud/production/deployment behavior, malware handling, P0-06B, Gate A, Current State update, Implementation Baseline update, push, or deploy without separate owner authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```


## P0-05 malware adapter boundary

```text
p0_05_package_status: malware_adapter_boundary_implemented_ready_to_commit
implementation_status: complete
verification_status: TOOL_VERIFIED after focused, affected, Sprint 2, full-suite, and diff checks
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 2420e6478587f1092303c4760546390ac3d7f9dd
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/scanner/network/dependency-install/production/deployment/current-state, executor, route/service/listener wiring, persistence, state transition, audit, P0-06B, or Gate A work authorized or performed
existing_vocabulary_preserved: MALWARE_SCAN_PRODUCTION_DEFAULT not_configured; DB vocabulary not_configured, queued, running, passed, failed, skipped
contract_authority: OWNER_DECISION.P0_MALWARE_ADAPTER_BOUNDARY_V1 records neutral not_configured, exact synthetic clean and malware_detected provenance, exact malware_scan_failed failure, and production/test separation
production_default_adapter: Backend/kai/security/malwareScanAdapter.js default adapter always returns exactly status not_configured; no scanner contact, environment selection, runtime factory, caller selection, production composition, route, executor, persistence, audit, or policy transition added
neutral_status_semantics: not_configured is neither pass nor block; no scanner means no file-policy pass
synthetic_adapter_boundary: __tests__/support/kaiSyntheticMalwareScanAdapter.js reachable only through explicit test-only dependency injection; no production file or canonical barrel imports or selects it
synthetic_fixture_boundary: clean and malware-marker byte fixtures are constructed in tests as non-executable synthetic bytes; SHA-256 values computed during tests; no real malware, EICAR string, or real antivirus test signature
result_shapes: not_configured exact status only; clean and malware_detected exact status plus provenance only; failed exact status failed plus category malware_scan_failed
provenance_boundary: clean and malware_detected provenance contains exactly adapter_id kai_synthetic_fixture_adapter and signature_set v1
fail_closed_boundary: unknown fixture, hash mismatch, malformed input, thrown operation, malformed adapter result, and inconsistent adapter result return exactly malware_scan_failed; no scanner, unknown fixture, or failure returns clean
non_exposure_boundary: results expose no fixture name, hash, path, config, version, bytes, scanner detail, native diagnostics, or infrastructure detail beyond the exact allowed provenance
changed_files: Backend/kai/security/malwareScanAdapter.js; __tests__/support/kaiSyntheticMalwareScanAdapter.js; __tests__/kai-sprint2-malware-adapter-boundary.spec.js; __tests__/kai-sprint2-p0-repository-contract.spec.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_malware_contract_state_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-malware-adapter-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js __tests__/kai-sprint2-state-transitions.spec.js - tests 32; pass 32; fail 0
affected_file_security_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test malware adapter, repository contract, file-type agreement, TXT/MD, CSV, XLSX, OOXML, PDF worker, and MuPDF dependency specs - tests 168; pass 168; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM; tests 817; pass 790; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 865; pass 865; fail 0
full_repository_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox run hit known localhost listen EPERM; tests 922; pass 895; fail 27
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 970; pass 970; fail 0
git_diff_check_before_execplan_update: git diff --check - pass
current_state_update: NOT_AUTHORIZED
implementation_baseline_update: NOT_AUTHORIZED
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P0-05 untrusted-content and formula-injection boundary

```text
p0_05_package_status: untrusted_content_formula_boundary_implemented_ready_to_commit
implementation_status: complete
verification_status: TOOL_VERIFIED after focused, affected, Sprint 2, full-suite, diff, and pre-commit checks
evidence_class: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 3081e5ec2e06040cf763993b6f3fbe96acadd629
working_tree_clean_at_start: true
staged_paths_at_start: none
applicable_repository_instructions: root AGENTS.md only; DATABASE_URL sentinel used for every Node and npm command; no fetch, push, database/cloud/scanner/network/dependency-install/production/deployment/current-state, executor, route/service/listener wiring, persistence, state transition, audit, preview/export/assistant/parser/rendering integration, P0-06B, or Gate A work authorized or performed
owner_decision_authority: OWNER_DECISION.P0_05_UNTRUSTED_CONTENT_FORMULA_OUTPUT_BOUNDARY_V1 newly authorized by this package prompt; exact dangerous first-byte set equals 0x3D, plus 0x2B, minus 0x2D, at-sign 0x40, TAB 0x09, CR 0x0D
pre_edit_existing_prompt_injection_boundary: TOOL_VERIFIED contract recorded instruction_text_inert, no LLM call, no tool or service action caused by file text, and no approval/source/evidence/claim/generation/export write
pre_edit_existing_formula_boundary: TOOL_VERIFIED contract recorded formula_trigger_detected as metadata-only warning, warning alone does not block when all blocking checks pass, raw file mutation prohibited, P0 output boundary required no raw cell rendering/export, and future output-specific neutralization mandatory
pre_edit_formula_escape_helper: TOOL_VERIFIED absent; no existing code helper escaped formula-like cell output before this package
trace_result: TOOL_VERIFIED no current detector path passes uploaded content to an LLM/assistant or uses it as system, developer, validator, policy, approval, review, audit, metrics, error, log, or returned-result content; detector results are fixed metadata-only objects or undefined and sanitized failures are content-free
implemented_helper: Backend/kai/validators/formulaInjectionBoundary.js exports FORMULA_INJECTION_DANGEROUS_FIRST_BYTES, hasFormulaInjectionDangerousPrefix, and escapeFormulaInjectionDangerousPrefix
helper_behavior: detection returns boolean false for non-strings and already escaped strings; escaping prefixes exactly one ASCII apostrophe for the exact six-byte first-byte set; already escaped strings stay unchanged; repeated escaping is idempotent; non-string values pass through unchanged; input values and raw bytes are not mutated; numeric-looking strings including "-5" are escaped with no numeric exemption
csv_lone_cr_boundary: unchanged; CR-prefixed CSV remains rejected by the existing input gate as lone_cr; CR detection remains available for future non-CSV or XLSX-derived string-output paths
inertness_tests: instruction-like and benign CSV, TXT, and MD content of the same type and byte length produce identical deterministic type-gate assessment; CSV row-limit assessment remains identical for instruction-like and benign CSV content
no_sink_tests: detector modules statically do not import or call LLM, assistant, approval, review, export, audit, metrics, or logging sinks; runtime deterministic assessment logs no file-content sentinels
output_boundary_tests: P0 route, service, assistant-boundary, state-transition, and data-dictionary paths do not reference or consume raw or escaped cell-output sentinels or formula-helper output
changed_files: Backend/kai/validators/formulaInjectionBoundary.js; __tests__/kai-sprint2-formula-injection-boundary.spec.js; Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md; __tests__/kai-sprint2-p0-repository-contract.spec.js; KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
focused_formula_boundary_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-formula-injection-boundary.spec.js - tests 9; pass 9; fail 0
focused_repository_contract_test: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 20; pass 20; fail 0
affected_file_security_tests_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test formula boundary, repository contract, CSV, TXT/MD, file-type agreement, XLSX, OOXML, assistant-boundary, and P0 acceptance specs - sandbox run hit known localhost listen EPERM; tests 153; pass 133; fail 20
affected_file_security_tests: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test formula boundary, repository contract, CSV, TXT/MD, file-type agreement, XLSX, OOXML, assistant-boundary, and P0 acceptance specs - tests 153; pass 153; fail 0
sprint2_suite_initial_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox run hit known localhost listen EPERM; tests 827; pass 800; fail 27
sprint2_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 875; pass 875; fail 0
full_repository_suite: listener-capable DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 980; pass 980; fail 0
git_diff_check_before_execplan_update: git diff --check - pass
complete_diff_inspected_before_execplan_update: true
current_state_update: NOT_AUTHORIZED
implementation_baseline_update: NOT_AUTHORIZED
commit_hash: report after commit; a commit cannot contain its own SHA
```


---

Plan authority record

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

---

## P0-07 security assessment acceptance correction

```text
P0_07_SECURITY_ASSESSMENT_ACCEPTANCE_CORRECTION

correction_date: 2026-07-29 America/Vancouver
evidence_class: TOOL_VERIFIED
correction_type: forward_only
prior_records_deleted_or_rewritten: false
current_interpretation_supersedes_prior_completion_claim: true

superseded_prior_label:
  exact_text: p0_07_package_status: local_synthetic_http_acceptance_corrected_complete
  exact_line_location: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md:4869 at blob 1bfde3f68aa7230e83654da86e2fd2485035a6b1
  prior_block_left_byte_intact: true

confirmed_valid_scope:
  HTTP upload route acceptance: verified
  HTTP exact-version confirmation acceptance: verified
  synthetic upload lifecycle acceptance: verified
  HTTP authentication, authorization, tenant and request-safety coverage:
    verified only for the exact cases freshly identified in the current harness
  committed detector implementations and focused detector tests:
    remain valid and are not reopened

P0_05_status:
  detector_and_control_leaves: implemented and tested
  bounded_security_executor_runtime: missing
  canonical_assessor_execution_entry_point: missing
  overall_end_to_end_security_assessment_implementation: partial

P0_06A_status:
  local upload and exact-version confirmation: implemented and tested
  confirmation_to_security_assessment_enqueue: missing
  sanitized_pending_policy_response_backed_by_real_enqueue: not established
  overall_P0_06A_completion: partial against the controlling ExecPlan

P0_07_status:
  local_HTTP_upload_and_confirmation_acceptance: verified
  local_HTTP_security_assessment_leg: not end_to_end verified
  automated_policy_pass_from_real_HTTP_path: not established
  overall_P0_07_completion: partial against the controlling ExecPlan

reason:
  the current positive acceptance path invokes a detector manually from test code after
  HTTP confirmation; confirmation does not reach an enabled internal executor or a
  canonical bounded assessor

coverage_inventory:
  HTTP_path_cases_verified:
    - feature enabled
    - authenticated mapped human
    - allowed role and active membership
    - batch create through POST /admin/batches
    - idempotent replay through POST /admin/batches
    - file reserve through POST /admin/batches/:intakeBatchId/file-reservations
    - local streamed upload through POST /admin/files/:intakeFileId/upload
    - upload reaches uploaded_unconfirmed
    - confirm exact version through POST /admin/files/:intakeFileId/confirm-upload
    - SHA-256 checksum verification through HTTP confirm-upload
    - policy remains pending immediately after HTTP confirmation
    - sanitized operator file read through GET /admin/files/:intakeFileId
    - review transition through POST /admin/review-queue/:reviewQueueItemId/status after test-side policy pass
    - feature disabled
    - invalid mapping
    - wrong role
    - inactive membership
    - cross-tenant IDs
    - unbounded list attempts
    - 26th file
    - malformed fingerprint
    - unknown metadata fields
    - request-body over-limit
    - unsafe Unicode filename
    - path traversal
    - oversize streamed body confirmation failure
    - checksum-mismatch streamed body confirmation failure
    - duplicate write
    - missing object
    - replaced object version
    - checksum mismatch
    - storage identifier leakage on the positive HTTP response set
    - raw content absence from the positive HTTP response, audit, metrics and log set
  test_side_detector_cases:
    - allowed CSV type agreement policy allow after HTTP confirmation
    - MIME/signature mismatch policy block
    - binary TXT/MD policy block
    - arbitrary archive policy block
  test_side_non_detector_cases:
    - mocked concurrent reservations
    - actor and organization mutation-limit exhaustion
    - actor and organization concurrent-upload exhaustion
    - expired and explicitly abandoned reservations
    - stale review transition
    - required-audit failure rollback at repository-interface level
    - telemetry failure not rolling back an authorized mutation
    - AI mutation
    - generic system mutation
    - unauthorized internal-executor operation
    - parser/profile/source/evidence/claim/generation/export attempt
    - storage identifier leakage as a direct no-leak assertion
    - raw content in logs, errors, audit, metrics, or responses as a direct no-leak assertion
  cases_not_exercised:
    - confirmation to security-assessment enqueue
    - callable internal security-executor runtime
    - canonical bounded assessor execution entry point from HTTP confirmation
    - automated file-policy pass from the real HTTP confirmation path
    - automated file-policy block or failure from the real HTTP confirmation path
    - XLSX path traversal or expansion bomb in the P0-07 harness
    - macros/external relationships in the P0-07 harness
    - encrypted PDF/XLSX in the P0-07 harness
    - PDF active content or embedded file in the P0-07 harness
    - uploaded prompt-injection text in the P0-07 harness
    - formula cells reaching no output in the P0-07 harness

effective_completion_language:
  P0 repository contract and detector controls implemented
  P0 local synthetic upload and exact-version confirmation acceptance passed
  P0 bounded security executor, confirmation enqueue and HTTP assessment integration pending

suspended_unqualified_labels:
  P0_LOCAL_SYNTHETIC_HTTP_ACCEPTANCE_PASS
  P0 local synthetic acceptance passed

qualification:
  these labels must not be used as current unqualified completion claims until the
  confirm-to-executor-to-assessor path is implemented and verified

not_established:
  callable_internal_security_executor
  canonical_bounded_assessor_entry_point
  confirmation_to_assessment_enqueue
  transactional_enqueue_acceptance
  canonical_assessor_execution_from_HTTP
  automated_file_policy_pass_from_real_HTTP_path
  automated_file_policy_block_or_failure_from_real_HTTP_path
  persistent_lifecycle
  database_atomicity
  production_readiness
  real_client_data_readiness

future_implementation_authority:
  not granted by this correction
  any executor, queue, state-write or HTTP integration package requires separate explicit
  owner authorization

P0_06B_started: false
Gate_A_started: false
Current_State_updated: false
Implementation_Baseline_updated: false
```

---

## Direction B first bounded security-assessment capability package

```text
P0_SECURITY_ASSESSMENT_DIRECTION_B_FIRST_BOUNDED_CAPABILITY

package_date: 2026-07-30 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED Direction B first bounded security-assessment capability only
package_status: complete

implemented_scope:
  callable_internal_security_executor: Backend/kai/security/internalSecurityAssessmentExecutor.js
  canonical_bounded_assessor: Backend/kai/security/boundedFileSecurityAssessor.js
  unit_and_focused_integration_tests:
    - __tests__/kai-sprint2-internal-security-assessment-executor.spec.js
    - __tests__/kai-sprint2-bounded-file-security-assessor.spec.js

callable_boundary:
  executor_invocation: executeInjectedInternalSecurityAssessment(input, { internalSecurityAssessmentExecutor })
  executor_factory: createInternalSecurityAssessmentExecutor({ assessor })
  required_seam_kind: kai_sprint2_internal_security_assessment_executor
  required_identity: internal_service / kai_file_security_executor / file_security_assessment
  result_contract:
    - { policy: "pass" }
    - { policy: "block", category: existing committed detector category }
    - { status: "failed", category: "security_assessment_timeout" }

canonical_composition:
  type_agreement_gate: detectP0FileTypeAgreement
  csv_terminal_entry_point: detectCsvRowLimitPolicy
  xlsx_terminal_entry_point: detectOoxmlArchiveResourceLimitPolicy
  pdf_worker_entry_point: runPdfAssessorWorkerBoundary
  xlsx_precedence_owner: existing detector chain inside detectOoxmlArchiveResourceLimitPolicy
  pdf_precedence_owner: existing PDF worker assessor boundary
  second_xlsx_precedence_layer_added: false

unwired_evidence:
  confirmUpload_changed: false
  route_changed: false
  listener_changed: false
  production_barrel_export_changed: false
  queue_or_enqueue_added: false
  drain_loop_or_background_execution_added: false
  persistence_or_lifecycle_write_added: false
  file_policy_status_write_added: false
  database_or_schema_or_sql_changed: false

tests:
  focused_package_tests_initial: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js - first run failed 1 assertion because expected category invalid_utf8 did not match committed detector category nul_rejection
  focused_package_tests_final: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js - tests 8; pass 8; fail 0
  affected_detector_security_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test bounded executor/assessor plus file-type, CSV, XLSX, OOXML, PDF worker, and repository contract specs - tests 155; pass 155; fail 0
  sprint2_suite_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - failed with sandbox localhost listener EPERM; package tests in that run passed
  sprint2_suite_escalated_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - tests 883; pass 883; fail 0
  full_repository_suite_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - failed with sandbox localhost listener EPERM; non-listener package tests in that run passed
  full_repository_suite_escalated_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 988; pass 988; fail 0

not_confirmed:
  deployed_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  confirmation_to_executor_enqueue: NOT_CONFIRMED
  automated_file_policy_state_mutation_from_http: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no queue, enqueue interface, drain loop, or background execution
  - no confirmUpload, route, listener, public DTO, or production composition change
  - no runtime persistence, lifecycle mutation, database write, file_policy_status write, transaction, schema, SQL, migration, cloud, credential, feature-flag, tenant, deployment, or real-client-data work
  - no P1 parser/profile behavior, intake_parser_runs lifecycle, file profiles, data dictionaries, sensitivity records, sources, evidence, claims, Gate A, P0-06B, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this first bounded Direction B capability package; do not select or design queue, enqueue, state-write, HTTP integration, P0-06B, Gate A, production, database, cloud, deployment, parser/profile/source/evidence/claim/export, or real-client-data work without separate authorization
```

---

## Bounded assessor malware not_configured correction

```text
P0_SECURITY_ASSESSMENT_MALWARE_NOT_CONFIGURED_CORRECTION

package_date: 2026-07-30 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED bounded correction only
package_status: complete
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 8fee261bf1cb7399a27d2b867826c2e86aaa2576
starting_parent: 28b7efa0b62e11b61e94db36a575f3529da9ab60
starting_tree: clean tracked and untracked
staged_paths_at_start: none
local_remote_tracking_status: branch ahead of origin/codex/kai-sprint2-p0-v0.3.5 by 22 commits; no fetch performed

authority_rule:
  production_default_adapter_result: { status: "not_configured" }
  not_configured_semantics: neither pass nor block
  controlling_policy_rule: No scanner means no file-policy pass
  clean_boundary: synthetic clean means only recognized approved synthetic fixture; not independently a file-policy pass
  detected_boundary: malware_detected is mapped only at this bounded assessor aggregate layer by this package
  adapter_failure_boundary: malware_scan_failed remains exact adapter failure category

pre_correction_finding: TOOL_VERIFIED: CONTRACT_CONFLICT
conflict_summary: 8fee261 bounded assessor did not invoke the malware adapter, so production/default not_configured could be absent from aggregation and an otherwise clean detector path could return { policy: "pass" }

correction:
  bounded_assessor_runs_malware_after_other_detectors_reach_pass_candidate: true
  not_configured_aggregate_result: { status: "failed", category: "malware_scan_failed" }
  clean_aggregate_result_when_all_other_detectors_pass: { policy: "pass" }
  malware_detected_aggregate_result: { policy: "block", category: "malware_failed" }
  adapter_failure_or_malformed_result: { status: "failed", category: "malware_scan_failed" }
  new_policy_or_status_or_enum_or_lifecycle_state: false
  production_test_adapter_separation_changed: false
  executor_injection_boundary_changed: false
  detector_ordering_or_terminal_entry_points_changed: false

result_contract:
  assessor_authorized_shapes:
    - { policy: "pass" }
    - { policy: "block", category }
    - { status: "failed", category }
  new_callable_shape_added: false

tests:
  required_focused_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-malware-adapter-boundary.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 38; pass 38; fail 0
  affected_detector_security_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test bounded assessor/executor, malware adapter, repository contract, file-type, TXT/MD, CSV, XLSX, OOXML, PDF worker, and MuPDF dependency specs - tests 155; pass 155; fail 0

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  confirmation_to_executor_enqueue: NOT_CONFIRMED
  automated_file_policy_state_mutation_from_http: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no queue, enqueue interface, drain loop, job, worker, or background execution
  - no confirmUpload, route, listener, public DTO, production barrel, or production composition change
  - no runtime persistence, lifecycle mutation, database write, file_policy_status write, transaction, schema, SQL, migration, cloud, credential, feature-flag, tenant, deployment, or real-client-data work
  - no P1 parser/profile behavior, sources, evidence, claims, Gate A, P0-06B, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded correction package; package two remains unauthorized
```

---

## Synthetic security-assessment enqueue capability

```text
P0_SYNTHETIC_SECURITY_ASSESSMENT_ENQUEUE_CAPABILITY

package_date: 2026-07-30 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED synthetic internal security-assessment enqueue capability plus exact-assessment replay deduplication and unit/focused integration tests only
package_status: complete after commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 38caa36186544c09a911d42d12387376569a909e
starting_parent: 8fee261bf1cb7399a27d2b867826c2e86aaa2576
starting_tree: clean tracked and untracked
staged_paths_at_start: none
local_remote_tracking_status: branch ahead of origin/codex/kai-sprint2-p0-v0.3.5 by 23 commits; no fetch performed

implemented_scope:
  synthetic_internal_enqueue_interface: Backend/kai/security/syntheticSecurityAssessmentEnqueue.js
  exact_assessment_replay_deduplication: true
  unit_and_focused_integration_tests:
    - __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js

dedup_identity_key:
  - organization ID
  - intake file ID
  - confirmed immutable object-version token
  - verified SHA-256

trusted_facts_retained:
  - organization ID
  - intake file ID
  - confirmed immutable object-version token
  - verified SHA-256
  - verified file size
  - trusted declared MIME
  - trusted extension

excluded_private_facts:
  - caller-supplied storage path
  - bucket
  - object key
  - storage URI
  - signed URL
  - provider-private identifier
  - credentials
  - raw storage location
  - unrestricted file content
  - raw PII
  - route or request payload copies

conflict_interface_reused:
  source: Backend/kai/upload/inMemoryUploadLifecycleRepository.js
  result: { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }
  helper_exports_added_without_shape_change:
    - uploadLifecycleFailure
    - uploadLifecycleSuccess
    - UPLOAD_LIFECYCLE_RESULT_STATUS

replay_behavior:
  identical_replay: returns existing record, existing enqueue identifier, and replayed true; record count unchanged
  changed_object_version_same_organization_and_file: conflict_current_state_changed; original record unchanged
  changed_sha256_same_organization_and_file: conflict_current_state_changed; original record unchanged
  same_object_version_changed_sha256: conflict_current_state_changed; original record unchanged
  cross_organization_or_different_file: independent synthetic records

synthetic_only_boundary:
  directly_callable_from_tests_or_explicit_internal_injection: true
  in_memory_only: true
  automatic_execution: false
  executor_invocation: false
  drain_loop_or_background_execution_added: false
  persistence_or_lifecycle_write_added: false
  file_policy_status_write_added: false
  confirmation_wiring: false
  route_or_listener_wiring: false
  production_barrel_export_changed: false

This package implements only a synthetic in-memory security-assessment
enqueue capability. It does not establish a persistent queue,
database-backed enqueueing, confirmation wiring, automatic execution,
policy-state mutation, or HTTP security-assessment integration.

tests:
  focused_package_tests: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-malware-adapter-boundary.spec.js - tests 56; pass 56; fail 0
  sprint2_suite_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - failed with sandbox localhost listener EPERM; package tests in that run passed
  sprint2_suite_escalated_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - tests 895; pass 895; fail 0
  full_repository_suite_sandbox_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - failed with sandbox localhost listener EPERM; non-listener package tests in that run passed
  full_repository_suite_escalated_result: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1000; pass 1000; fail 0

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  confirmation_to_executor_enqueue: NOT_CONFIRMED
  automated_file_policy_state_mutation_from_http: NOT_CONFIRMED
  HTTP_security_assessment_integration: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no confirmUpload enqueue wiring, route, listener, middleware, public DTO, production barrel, or production composition change
  - no drain loop, polling, retry worker, background process, executor invocation, or automatic execution
  - no runtime persistence, lifecycle mutation, policy-state mutation, processing mutation, parse-status mutation, review-queue mutation, transaction, schema, SQL, migration, cloud, credential, feature-flag, tenant, deployment, or real-client-data work
  - no P1 parser/profile behavior, intake_parser_runs lifecycle, file profiles, data dictionaries, sensitivity records, sources, evidence, claims, generation, exports, Gate A, P0-06B, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this synthetic enqueue package; later packages remain unauthorized
```

---

## Local synthetic confirmation to enqueue composition

```text
P0_LOCAL_SYNTHETIC_CONFIRMATION_TO_ENQUEUE_COMPOSITION

package_date: 2026-07-30 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED successful exact-version confirmation to synthetic in-memory security-assessment enqueue only
package_status: complete after commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 361b23a8469ef98f2097b0a3d07434156b4e3db2
starting_parent: 38caa36186544c09a911d42d12387376569a909e
starting_tree: clean tracked and untracked
staged_paths_at_start: none
local_remote_tracking_status: branch ahead of origin/codex/kai-sprint2-p0-v0.3.5 by 24 commits; no fetch performed

implemented_scope:
  local_synthetic_orchestration: Backend/kai/security/syntheticConfirmUploadAndEnqueue.js
  local_synthetic_http_composition: __tests__/kai-sprint2-p0-acceptance.spec.js serviceFacade only
  production_confirmUpload_changed: false
  production_composition_changed: false
  production_barrel_export_changed: false
  route_specific_enqueue_logic_added: false
  public_http_response_shape_changed: false

This package connects successful exact-version confirmation to the
synthetic in-memory security-assessment enqueue only in the authorized
local synthetic composition.

The confirmation lifecycle transition and enqueue participate in the
same inspected atomic orchestration boundary.

This package does not establish production composition, persistent or
database-backed queueing, queue draining, automatic execution, executor
or assessor invocation, raw-byte assessment, policy-state mutation, or
completed HTTP security assessment.

atomicity_mechanism:
  transaction_interface_reused: existing Backend/kai/db/kaiDb.js withTransaction(callback)
  local_synthetic_transaction_participants:
    - in-memory upload lifecycle repository snapshot participant
    - synthetic security-assessment enqueue snapshot participant
  commit_path: withTransaction BEGIN -> transaction-scoped confirmUpload lifecycle transition -> transaction-scoped enqueueSecurityAssessment -> COMMIT applies both snapshots
  rollback_path: thrown enqueue rollback result -> withTransaction ROLLBACK discards both participant snapshots
  sequential_best_effort_operations: false

fresh_confirmation_behavior:
  successful_http_confirmation_enqueue_count: exactly one
  enqueue_facts:
    - organization ID from confirmed response and authoritative metadata scope
    - intake file ID from confirmed response and authoritative metadata scope
    - immutable object-version token from exact-version confirmation transition
    - verified SHA-256 from exact-version confirmation transition
    - verified size from exact-version confirmation transition
    - declared MIME from stored file metadata
    - extension from stored file metadata
  public_response_shape: existing sanitized confirmation DTO only

identical_replay_alignment:
  confirmation_replay_identity: organization ID + intake file ID + object-version token + verified SHA-256 + verified size
  enqueue_replay_identity: organization ID + intake file ID + object-version token + verified SHA-256
  replay_result: existing enqueue item returned internally, enqueue identifier preserved, record count unchanged, no conflict_current_state_changed

changed_fact_behavior:
  changed_object_version: existing conflict_current_state_changed semantics preserved by lifecycle and enqueue tests; no new enqueue
  changed_sha256: existing conflict_current_state_changed semantics preserved by lifecycle and enqueue tests; no new enqueue

trusted_fact_boundary:
  excluded_private_facts:
    - caller-supplied storage path
    - bucket
    - object key
    - storage URI
    - signed URL
    - provider-private identifier
    - credentials
    - raw bytes
    - unrestricted file content
    - raw PII
    - request-payload copies

tests:
  focused_enqueue_and_lifecycle: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 39; pass 39; fail 0
  focused_http_acceptance: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-acceptance.spec.js - tests 42; pass 42; fail 0 after localhost-capable rerun
  focused_service_security_transaction: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-pass2-route-runtime.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-malware-adapter-boundary.spec.js __tests__/kai-sprint2-transaction-interface.spec.js - tests 133; pass 133; fail 0
  orchestration_boundary: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-orchestration-boundary.spec.js - tests 4; pass 4; fail 0
  sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 897; pass 897; fail 0 after localhost-capable rerun

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  confirmation_to_executor_enqueue: NOT_CONFIRMED
  automated_security_assessment: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no production composition, canonical production barrel export, route-specific enqueue logic, route addition, public DTO field, queue drain, poller, retry worker, scheduler, background process, executor invocation, assessor invocation, raw-byte assessment read, persistent queue, database-backed queue, SQL, schema, migration, cloud, credential, tenant, deployment, feature-flag, Current State, Implementation Baseline, Gate A, or P0-06B work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded local synthetic confirmation-to-enqueue package; later packages remain unauthorized
```

---

## Local synthetic confirmation-to-enqueue atomicity correction

```text
P0_LOCAL_SYNTHETIC_CONFIRMATION_TO_ENQUEUE_ATOMICITY_CORRECTION

package_date: 2026-07-31 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED ATOMICITY_CORRECTION_REQUIRED
package_status: complete after commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 9d9e23c13ced98d7ae6135f11323c77be4aa0227
starting_parent: 361b23a8469ef98f2097b0a3d07434156b4e3db2
starting_tree: clean tracked and untracked
staged_paths_at_start: none

The prior local synthetic confirm-to-enqueue package had a commit-phase
partial-state risk because lifecycle and enqueue canonical states were
published sequentially while fallible preparation remained in the
publication path.

This correction fully prepares both replacement states before canonical
publication and limits publication to direct replacement of already-
prepared local state references, or uses an equally bounded proven
non-failing restoration mechanism.

It does not establish production composition, persistent queueing,
automatic execution, executor or assessor invocation, raw-byte
assessment, policy-state mutation, or completed HTTP security assessment.

implemented_scope:
  local_synthetic_orchestration: Backend/kai/security/syntheticConfirmUploadAndEnqueue.js
  local_synthetic_lifecycle_participant: Backend/kai/upload/inMemoryUploadLifecycleRepository.js
  local_synthetic_enqueue_participant: Backend/kai/security/syntheticSecurityAssessmentEnqueue.js
  focused_atomicity_tests: __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

atomicity_mechanism:
  transaction_interface_reused: existing Backend/kai/db/kaiDb.js withTransaction(callback)
  kaiDb_withTransaction_modified: false
  correction_mechanism: prepare both participant replacement state objects, then publish with direct state-reference replacement
  lifecycle_prepared_state: { records: prepared Map }
  enqueue_prepared_state: { recordsByIdentity: prepared Map, identityByScopedFile: prepared Map, nextId: prepared number }
  publication_window:
    - lifecyclePublication.target.state = lifecyclePublication.preparedState;
    - enqueuePublication.target.state = enqueuePublication.preparedState;
  publication_window_contains_method_calls: false
  publication_window_contains_allocation: false
  publication_window_contains_validation_or_deduplication: false
  restoration_used: false

behavior_preserved:
  fresh_confirmation: confirmed lifecycle and one synthetic enqueue record publish together
  identical_replay: same enqueue identifier, enqueue count unchanged, no spurious conflict
  changed_object_version: conflict_current_state_changed before canonical publication
  changed_sha256: conflict_current_state_changed before canonical publication
  callback_phase_enqueue_failure: no canonical lifecycle or enqueue publication
  preparation_failure: no canonical lifecycle or enqueue publication
  production_isolation: unchanged
  executor_or_assessor_invocation: none
  policy_state_mutation: none

tests:
  focused_atomicity_lifecycle_transaction: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-transaction-interface.spec.js - tests 51; pass 51; fail 0
  affected_acceptance_service_security_transaction: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-p0-acceptance.spec.js __tests__/kai-sprint2-intake-service.spec.js __tests__/kai-sprint2-pass2-route-runtime.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-malware-adapter-boundary.spec.js __tests__/kai-sprint2-transaction-interface.spec.js - initial sandbox run failed on localhost listen EPERM; localhost-capable rerun tests 220; pass 220; fail 0
  sprint2_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - initial sandbox run failed on localhost listen EPERM; localhost-capable rerun tests 903; pass 903; fail 0
  full_repository_suite: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - initial sandbox run failed on localhost listen EPERM; localhost-capable rerun tests 1008; pass 1008; fail 0
  git_diff_check: git diff --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  persistent_queueing: NOT_CONFIRMED
  automated_security_assessment: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no production confirmUpload change, production route change, canonical production barrel change, public HTTP DTO change, queue draining, worker, polling, automatic execution, executor invocation, assessor invocation, exact-version assessment read, file_policy_status or other policy-state mutation, persistent queueing, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, Gate A, P0-06B, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded atomicity correction package; later packages remain unauthorized
commit_hash: report after commit; a commit cannot contain its own SHA
```

---

## Assessment-time read-integrity bridge

```text
P0_ASSESSMENT_TIME_READ_INTEGRITY_BRIDGE

package_date: 2026-07-31 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete after commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 1ca47580644bd67a8a8d29a1ba63dabe14a0eee3
starting_parent: 9d9e23c13ced98d7ae6135f11323c77be4aa0227
starting_tree: clean tracked and untracked
staged_paths_at_start: none

This package adds one callable, local-only, unwired assessment-time
read-integrity bridge.

The bridge accepts trusted immutable object-version identity, reads that
exact version through the existing local storage adapter, enforces the
existing bounded byte limit, recomputes SHA-256 and byte count during the
assessment-time read, and returns either bounded verified bytes or one
typed internal integrity failure.

The bridge has no consumer in this package. It does not select enqueue
items, invoke the executor or assessor, return a policy verdict, persist
bytes or results, mutate canonical state, alter confirm-to-enqueue
behavior, expose HTTP execution, or create production or background
composition.

implemented_scope:
  bridge_module: Backend/kai/security/assessmentReadIntegrityBridge.js
  bridge_entry_point: readVerifiedAssessmentBytes
  focused_bridge_tests: __tests__/kai-sprint2-assessment-read-integrity-bridge.spec.js
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

input_contract:
  accepted_keys: objectVersionId; expectedChecksum; expectedSize; storageAdapter; optional signal
  rejected_caller_storage_facts: path; bucket; object key; provider-private identifier; URI; signed URL; filename; MIME; extension; unrestricted metadata
  object_version_pattern: provider-neutral ov_ plus 32 lowercase hex characters
  checksum_pattern: lowercase SHA-256 hex, 64 characters
  expected_size: nonnegative safe integer

exact_version_binding:
  adapter_operation: openObjectVersionReadStream({ objectVersionId, signal? })
  storage_authority: existing local adapter validates provider-neutral objectVersionId, opens by immutable exact version, stats the same open handle, and streams bytes from that same handle
  path_replacement_behavior: existing storage-boundary tests prove streamed reads stay on the opened object after filesystem path replacement
  storage_adapter_public_contract_changed: false

read_integrity_behavior:
  byte_limit: 25 * 1024 * 1024 bytes
  chunked_read: yes
  checksum_recompute: Node SHA-256 hash updated during this assessment-time read
  size_count: independent counted byte total during this assessment-time read
  final_byte_type: Buffer, satisfying the existing assessor Uint8Array input contract
  success_shape: { ok: true, data: { bytes }, warnings: [] }
  integrity_failure_shape: { ok: false, integrity_failure: { type: assessment_read_integrity_failure, kind } }
  integrity_failure_kinds: invalid_input; exact_version_unavailable; read_failed; size_mismatch; checksum_mismatch; size_limit_exceeded; aborted
  assessor_category_mapping: none
  policy_verdict_shape_returned: false

cleanup_and_isolation:
  byte_source_close: finally closes valid byte_source after success, mismatch, limit breach, read failure, abort, cancellation, and thrown iteration
  partial_bytes_returned_on_failure: false
  module_level_runtime_state: none
  concurrent_call_isolation: independent stream, buffer, hash, counter, and failure instances per call

production_and_state_boundary:
  enqueue_store_consumed: no
  executor_invoked: no
  assessor_invoked: no
  detectors_invoked: no
  malware_adapter_invoked: no
  consumer_wired: none
  production_barrel_export: none
  route_wiring: none
  production_composition: none
  background_worker_or_queue_drain: none
  state_mutation: none
  persistent_result: no
  bytes_cached_or_persisted: no
  protected_files_changed: none

tests:
  focused_bridge: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-assessment-read-integrity-bridge.spec.js - tests 8; pass 8; fail 0
  storage_boundary: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js - tests 35; pass 35; fail 0
  confirmation_regression: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js - tests 82; pass 82; fail 0
  enqueue_regression: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js - tests 17; pass 17; fail 0
  transaction_interface: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-transaction-interface.spec.js - tests 6; pass 6; fail 0
  executor_isolation: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-internal-security-assessment-executor.spec.js - tests 4; pass 4; fail 0
  sprint2_suite_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - initial sandbox listener failure, listen EPERM on 127.0.0.1; bridge tests passed inside this run
  sprint2_suite_localhost_capable_rerun: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - tests 911; pass 911; fail 0
  git_diff_check: git diff --check and git diff --cached --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  bridge_to_selection_execution_assessment_wiring: NOT_CONFIRMED
  automated_security_assessment: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no enqueue selection, enqueue store import, executor invocation, assessor invocation, detector invocation, malware adapter invocation, policy verdict mapping, HTTP route, production composition, production barrel export, background worker, queue drain, persistence, audit write, metrics write, canonical state mutation, processing_status mutation, parse_status mutation, file_policy_status mutation, retained metadata mutation, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, Current State, Implementation Baseline, Gate A, or P0-06B work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this bounded unwired assessment-time read-integrity bridge package; later packages remain unauthorized
commit_hash: report after commit; a commit cannot contain its own SHA
```

---

## Global intake-file size limit authority

```text
P0_GLOBAL_INTAKE_FILE_SIZE_LIMIT

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 22f9273f1d45c27c0cba9aab37c11ba739183e59
starting_parent: 1ca47580644bd67a8a8d29a1ba63dabe14a0eee3
starting_tree: clean tracked and untracked
staged_paths_at_start: none

The owner defined the global KAI Sprint 2 P0 intake-file maximum as
26,214,400 bytes.

This correction added one canonical global intake limit, enforced it
against actual received upload bytes, and made the callable unwired
assessment-time read-integrity bridge use the same authority.

The existing PDF pre-parse boundary remains a separate PDF-specific
control with unchanged behavior.

Upload and bridge streaming reject a crossing chunk before passing it
to storage or retaining it in memory.

The prior Package A blank-line formatting deletion was restored. No
prior accepted evidence content was rewritten.

No queue drain, executor or assessor invocation, result persistence,
policy mutation, production assessment composition or Package B work
was added.

implemented_scope:
  canonical_limit_file: Backend/kai/config/kaiSprint2P0Contract.js
  canonical_limit_export: KAI_SPRINT2_MAX_FILE_SIZE_BYTES
  canonical_limit_value: 26,214,400
  upload_enforcement_file: Backend/kai/services/kaiIntakeService.js
  storage_mapping_file: Backend/kai/storage/localDevStorageAdapter.js
  bridge_file: Backend/kai/security/assessmentReadIntegrityBridge.js
  focused_upload_tests: __tests__/kai-sprint2-intake-service.spec.js
  focused_bridge_tests: __tests__/kai-sprint2-assessment-read-integrity-bridge.spec.js
  affected_storage_tests: __tests__/kai-sprint2-storage-boundary.spec.js

precondition_verification:
  upload_actual_received_byte_limit_before_change: absent
  bridge_local_limit_before_change: ASSESSMENT_READ_INTEGRITY_MAX_BYTES = 25 * 1024 * 1024
  bridge_canonical_import_before_change: absent
  pdf_pre_parse_boundary_before_change: PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES = 25 * 1024 * 1024
  package_a_execplan_blank_line_deletion: present in commit 22f9273
  package_a_full_repository_npm_test: not present in Package A evidence

upload_behavior:
  actual_received_bytes_authoritative: yes
  exact_limit_allowed: 26,214,400 bytes
  one_byte_over_rejected: 26,214,401 bytes
  crossing_chunk_yielded_to_storage: no
  later_chunk_requested_after_breach: no
  smaller_declared_size_bypass: no
  trusted_reserved_size_above_limit_storage_opened: no
  oversized_mapping: request_too_large / HTTP 413
  incomplete_object_cleanup: preserved by local adapter unlink-on-failure
  uploaded_unconfirmed_transition_on_breach: no
  confirmation_or_enqueue_on_breach: no

bridge_behavior:
  limit_source: imported canonical KAI_SPRINT2_MAX_FILE_SIZE_BYTES
  expected_size_above_limit_opens_storage: no
  chunk_crossing_expected_size_retained: no
  chunk_checks_before_retention: expectedSize then KAI_SPRINT2_MAX_FILE_SIZE_BYTES
  partial_bytes_returned_on_failure: no
  cleanup_on_failure_paths: preserved
  bridge_wiring: none

unchanged_boundaries:
  pdf_worker_changed: false
  confirm_to_enqueue_changed: false
  enqueue_identity_replay_atomicity_changed: false
  executor_assessor_contracts_changed: false
  detector_malware_policy_state_changed: false
  production_composition_changed: false
  current_state_changed: false
  implementation_baseline_changed: false
  package_b_work: false

tests:
  focused_bridge: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-assessment-read-integrity-bridge.spec.js - tests 11; pass 11; fail 0
  focused_upload_and_confirmation: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-intake-service.spec.js - tests 88; pass 88; fail 0
  affected_storage: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-storage-boundary.spec.js - tests 36; pass 36; fail 0
  enqueue_and_atomicity_regression: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-transaction-interface.spec.js - tests 23; pass 23; fail 0
  route_and_production_isolation_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-route-runtime.spec.js __tests__/kai-sprint2-p0-acceptance.spec.js - sandbox listener failure, listen EPERM on 127.0.0.1; non-listener route-runtime tests passed in the same run
  route_and_production_isolation_localhost_capable_rerun: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-route-runtime.spec.js __tests__/kai-sprint2-p0-acceptance.spec.js - tests 69; pass 69; fail 0
  executor_assessor_isolation: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js - tests 10; pass 10; fail 0
  sprint2_suite_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - sandbox listener failures, listen EPERM on 127.0.0.1; continued run reported tests 873; pass 845; fail 28
  sprint2_suite_localhost_capable_rerun: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-*.spec.js - tests 921; pass 921; fail 0
  full_repository_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox listener failures, listen EPERM on 127.0.0.1; continued run reported tests 978; pass 950; fail 28
  full_repository_localhost_capable_rerun: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1026; pass 1026; fail 0
  git_diff_check: git diff --check - pass
  git_diff_cached_check: git diff --cached --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  automated_security_assessment: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no queue drain, executor invocation, assessor invocation, result persistence, policy mutation, production assessment composition, Package B work, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, Current State, Implementation Baseline, Gate A, Gate B, Gate C, Gate D, or P0-06B work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this global intake-file size limit package; Package B and later packages remain unauthorized
commit_hash: report after commit; a commit cannot contain its own SHA
```

---

## Package B local non-persistent assessment composition

```text
PACKAGE_B_LOCAL_NON_PERSISTENT_ASSESSMENT_COMPOSITION

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 631f1f2d5c9af248ab2c11bfb5001c278fac6446
starting_parent: 22f9273f1d45c27c0cba9aab37c11ba739183e59
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_tracking_relation_at_start: origin/codex/kai-sprint2-p0-v0.3.5 ahead 28, behind 0; no fetch performed

implemented_scope:
  composition_file: Backend/kai/security/syntheticAssessmentComposition.js
  focused_tests: __tests__/kai-sprint2-synthetic-assessment-composition.spec.js
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

selection_identity:
  selected_identity: complete stored identity tuple
  tuple_fields: organizationId, intakeFileId, objectVersionId, verifiedChecksum
  security_assessment_enqueue_id_used_as_selector: false
  reason: generated counter identifier exists on records, but the current uniqueness/collision behavior is enforced by recordsByIdentity keyed on organization, intake file, object version, and checksum
  snapshot_accessor: listSecurityAssessmentEnqueueRecords()
  snapshot_mutation: none
  snapshot_order_dependency: none
  implicit_first_or_next_selection: false

selection_failure_contract:
  malformed_selection: validation_blocker / 422
  malformed_snapshot_source: validation_blocker / 422
  empty_snapshot: not_found / 404
  no_matching_record: not_found / 404
  ambiguous_matching_records: conflict_current_state_changed / 409

trusted_fact_mapping:
  source: selected stored enqueue record only
  mapped_fields: organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes, declared_mime, extension
  caller_fact_spread: false
  full_record_spread: false

bridge_invocation:
  function: readVerifiedAssessmentBytes
  objectVersionId_source: selected record object_version_id
  expectedChecksum_source: selected record verified_checksum
  expectedSize_source: selected record verified_size_bytes
  storageAdapter_source: injected dependency
  signal_source: optional injected dependency

integrity_failure_branch:
  returns_before_executor: true
  executor_invoked: false
  assessor_invoked: false
  assessor_verdict_constructed: false
  persistence_or_audit_or_state_mutation: false
  returned_contract: existing typed assessment_read_integrity_failure

executor_assessor_invocation:
  executor_entry: executeInjectedInternalSecurityAssessment
  executor_factory: createInternalSecurityAssessmentExecutor
  default_assessor: existing canonical assessBoundedFileSecurity through the executor factory default
  executor_input_fields: extension, declaredMime, bytes, sha256
  bytes_source: bridge data.bytes
  checksum_source: selected record verified_checksum as sha256
  mime_extension_source: selected record declared_mime and extension
  invocation_count_on_success: one executor call
  direct_post_executor_assessor_call: false

returned_result:
  forms: { policy: "pass" }, { policy: "block", category }, { status: "failed", category }
  sanitized_result_validation: existing internal executor callable-result validation
  raw_bytes_exposed: false
  enqueue_internals_exposed: false
  storage_internals_exposed: false

production_reachability:
  public_routes: no import or exposure
  production_barrel: no export
  production_composition: no import or exposure
  confirmation_composition: no import or exposure
  explicit_call_only: true

tests:
  focused_package_b: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-assessment-composition.spec.js - tests 7; pass 7; fail 0
  enqueue_and_confirmation_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-acceptance.spec.js - sandbox listener failures in acceptance, listen EPERM on 127.0.0.1; non-listener enqueue and in-process acceptance subtests passed in same run
  p0_acceptance_localhost_capable_rerun: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-acceptance.spec.js - tests 42; pass 42; fail 0
  bridge_executor_assessor: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-assessment-read-integrity-bridge.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js - tests 21; pass 21; fail 0
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 928; pass 928; fail 0
  full_repository_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1033; pass 1033; fail 0
  git_diff_check_before_staging: git diff --check - pass
  git_diff_cached_check: git diff --cached --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  automated_queue_processing: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no Package A reopening, enqueue-store contract change, confirmation-to-enqueue change, bridge contract change, executor contract change, assessor contract change, detector change, route change, production barrel export, production composition, queue polling, queue draining, claim, lease, acknowledgement, retry, completion state, result persistence, audit write, policy mutation, lifecycle mutation, enqueue mutation, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, Current State, Implementation Baseline, Gate A, Gate B, Gate C, Gate D, or P0-06B work

next_package_or_stop_condition: OWNER-DIRECTED STOP after Package B local non-persistent assessment composition
commit_hash: report after commit; a commit cannot contain its own SHA
```

---

## Package C1 lifecycle policy-decision transition capability

```text
PACKAGE_C1_LIFECYCLE_POLICY_DECISION_TRANSITION_CAPABILITY

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 87201f56211182b33af6339f41ee828bcefb0341
starting_parent: 631f1f2d5c9af248ab2c11bfb5001c278fac6446
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_tracking_relation_at_start: origin/codex/kai-sprint2-p0-v0.3.5 ahead 29, behind 0; no fetch performed

implemented_scope:
  lifecycle_file: Backend/kai/upload/inMemoryUploadLifecycleRepository.js
  focused_tests: __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

quote_gate_summary:
  lifecycle_owner: existing synthetic lifecycle repository owns upload_state and file_policy_status
  lifecycle_publication: existing synthetic transaction participant prepares replacement state and publishes by assignment only after participant preparation
  audit_interface: existing metadata-only audit allowlist and sanitizer inspected
  audit_atomicity: new capability requires injected metadataOnlyAudit.prepareMetadataOnlyAudit success before lifecycle publication and publishes no audit on replay or failure
  replay_storage: bounded policy_decision_replay retains organization, intake file, object version, checksum, size, declared MIME, extension, file policy outcome, and exact sanitized result
  interface_boundary: Backend/kai/upload/uploadLifecycleRepository.js unchanged; callable added only to concrete in-memory leaf repository object

state_effects:
  pass_transition: pending -> passed; upload_state remains confirmed
  block_transition: pending -> blocked; upload_state confirmed -> policy_blocked
  failed_transition: pending -> failed; upload_state remains confirmed
  confirmed_object_version_facts: unchanged
  processing_status: not owned by lifecycle repository and no dependency is invoked that can mutate it
  parse_status: not owned by lifecycle repository and no dependency is invoked that can mutate it
  enqueue_state: untouched

replay_and_conflict:
  exact_replay: same trusted facts and same exact sanitized result returns existing policy outcome with no second mutation and no duplicate audit
  changed_result_or_category: conflict_current_state_changed with no overwrite and no audit
  changed_object_version_checksum_size_mime_extension: conflict_current_state_changed where comparable from current lifecycle or stored replay evidence
  stale_expected_pending_state: conflict_current_state_changed except exact identical replay
  scoped_missing: cross-tenant and missing records preserve existing not_found convention

reachability:
  Package_B_invocation: none
  bridge_executor_assessor_invocation: none
  route_or_http_wiring: none
  production_barrel_export: none
  production_composition: none
  queue_polling_or_completion: none
  database_sql_schema_work: none

tests:
  focused_lifecycle_policy_transition: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 36; pass 36; fail 0
  affected_lifecycle_audit_transaction_enqueue_confirmation_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-audit-contract.spec.js __tests__/kai-sprint2-pass2-audit-contract.spec.js __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-synthetic-security-assessment-enqueue.spec.js __tests__/kai-sprint2-p0-acceptance.spec.js __tests__/kai-sprint2-intake-service.spec.js - sandbox listener failures in acceptance, listen EPERM on 127.0.0.1; non-listener affected subtests passed in same run
  p0_acceptance_localhost_capable_rerun: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-acceptance.spec.js - tests 42; pass 42; fail 0
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 936; pass 936; fail 0
  full_repository_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1041; pass 1041; fail 0
  git_diff_check_before_execplan: git diff --check - pass
  git_diff_check_before_staging: git diff --check - pass
  git_diff_cached_check: git diff --cached --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  automated_queue_processing: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no Package B invocation or mapping, bridge invocation, executor invocation, assessor invocation, route change, HTTP wiring, production barrel export, production composition, queue polling, queue draining, claim, lease, acknowledgement, retry, completion state, second result repository, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, Current State, Implementation Baseline, Gate A, Gate B, Gate C, Gate D, or P0-06B work

next_package_or_stop_condition: OWNER-DIRECTED STOP after C1 lifecycle policy-decision transition capability
commit_hash: report after commit; a commit cannot contain its own SHA
```

---

## Malware neutral-outcome split before C2

```text
KAI_SPRINT2_P0_MALWARE_NEUTRAL_OUTCOME_SPLIT_BEFORE_C2

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 03b61d7ff1e770df015a833fca5c0e06a800b81c
starting_parent: 87201f56211182b33af6339f41ee828bcefb0341
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_tracking_relation_at_start: origin/codex/kai-sprint2-p0-v0.3.5 ahead 30, behind 0; no fetch performed

quote_gate:
  production_default_adapter_result: Backend/kai/security/malwareScanAdapter.js default adapter returns exact { status: "not_configured" }
  prior_bounded_assessor_collapse: not_configured fell through to { status: "failed", category: "malware_scan_failed" }
  genuine_adapter_failure_branch: adapter failure and thrown scan operations remain { status: "failed", category: "malware_scan_failed" }
  executor_envelope: existing executor accepts exact sanitized { status: "failed", category }
  failed_category_vocabulary_before_split: security_assessment_timeout, input_size_exceeds_pre_parse_gate, malware_scan_failed, maximum_concurrent_pdf_assessor_workers_exceeded
  reopening_authority: USER_CONFIRMED C2 precondition activates banked distinction between scanner not_configured and genuine scan failure
  test_scope_gate: only focused bounded-assessor assertion encoded not_configured -> malware_scan_failed; no protected-file test assertion required modification

implemented_scope:
  assessor_file: Backend/kai/security/boundedFileSecurityAssessor.js
  contract_file: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md
  focused_tests:
    - __tests__/kai-sprint2-bounded-file-security-assessor.spec.js
    - __tests__/kai-sprint2-malware-adapter-boundary.spec.js
    - __tests__/kai-sprint2-internal-security-assessment-executor.spec.js
    - __tests__/kai-sprint2-synthetic-assessment-composition.spec.js
    - __tests__/kai-sprint2-p0-repository-contract.spec.js
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

outcome_split:
  not_configured_result: { status: "failed", category: "malware_scan_not_configured" }
  genuine_adapter_failure_result: { status: "failed", category: "malware_scan_failed" }
  outcomes_cannot_collapse: focused assessor test asserts the categories are distinct
  adapter_internals_exposed: false
  executor_contract_changed: false
  Package_B_changed: false
  C1_changed: false
  protected_files_changed: false
  lifecycle_audit_enqueue_route_production_barrel_or_production_composition_changed: false
  C2_implemented: false

recorded_classification:
  security_assessment_timeout: policy-failure eligible
  input_size_exceeds_pre_parse_gate: policy-failure eligible
  malware_scan_failed: genuine malware adapter failure; policy-failure eligible
  malware_scan_not_configured: scanner unavailable or not configured; non-policy and non-mutating
  maximum_concurrent_pdf_assessor_workers_exceeded: non-policy and non-mutating
  assessment_read_integrity_failure: bridge failure outside assessor outcome vocabulary; non-policy and non-mutating

tests:
  focused_assessor_malware_executor_package_b_contract: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-bounded-file-security-assessor.spec.js __tests__/kai-sprint2-malware-adapter-boundary.spec.js __tests__/kai-sprint2-internal-security-assessment-executor.spec.js __tests__/kai-sprint2-synthetic-assessment-composition.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js - tests 48; pass 48; fail 0
  affected_detector_security_lifecycle_regression: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test file-type, TXT/MD, CSV, XLSX, OOXML, PDF worker, MuPDF, bridge, and lifecycle specs - tests 188; pass 188; fail 0
  sprint2_suite_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener failures, listen EPERM on 127.0.0.1; non-listener subtests proceeded
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 939; pass 939; fail 0
  full_repository_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - sandbox listener failures, listen EPERM on 127.0.0.1; non-listener subtests proceeded
  full_repository_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1044; pass 1044; fail 0
  git_diff_check_before_execplan: git diff --check - pass
  git_diff_check_after_execplan: git diff --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  automated_queue_processing: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no Package B implementation change, C1 change, executor contract change, lifecycle mutation wiring, policy mutation wiring, audit write, enqueue mutation, route change, production barrel export, production composition, new result repository, database, SQL, schema, cloud, credential, tenant, feature-flag, deployment, push, Current State update, Implementation Baseline update, Gate A, Gate B, Gate C, Gate D, P0-06B, or C2 implementation

next_package_or_stop_condition: OWNER-DIRECTED STOP after malware neutral-outcome split before C2; do not implement or draft C2 in this run
commit_hash: report after commit; a commit cannot contain its own SHA
```

## C2 thin assessment-to-policy wiring

```text
KAI_SPRINT2_P0_C2_THIN_ASSESSMENT_TO_POLICY_WIRING

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: ae46aec6b98c038208369edd4c499752af189d88
starting_parent: 03b61d7ff1e770df015a833fca5c0e06a800b81c
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_tracking_relation_at_start: origin/codex/kai-sprint2-p0-v0.3.5 ahead 31, behind 0; no fetch performed

quote_gate:
  package_b_callable: executeSyntheticAssessmentFromEnqueueRecord(selectionIdentity, dependencies) with explicit organizationId/intakeFileId/objectVersionId/verifiedChecksum selection
  package_b_returns: lifecycle failure envelopes, assessment_read_integrity_failure bridge envelopes, or executor result { policy: "pass" } / { policy: "block", category } / { status: "failed", category }
  c1_callable: compareAndSetPolicyDecision({ confirmedFileFacts, expectedFilePolicyStatus, policyDecisionOutcome, sanitizedResult, metadataOnlyAudit, now })
  c1_outcomes: passed, blocked, failed
  enqueue_record_shape: security_assessment_enqueue_id, organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes, declared_mime, extension
  same_record_binding: Package B and C2 both select by the immutable enqueue identity; C2 derives C1 confirmedFileFacts from the selected stored enqueue record
  policy_failure_categories: security_assessment_timeout, input_size_exceeds_pre_parse_gate, malware_scan_failed
  non_policy_categories: maximum_concurrent_pdf_assessor_workers_exceeded, malware_scan_not_configured
  bridge_failure: assessment_read_integrity_failure remains non-policy and non-mutating
  contract_gap: none

implemented_scope:
  new_internal_composition: Backend/kai/security/syntheticAssessmentPolicyComposition.js
  focused_tests: __tests__/kai-sprint2-synthetic-assessment-policy-composition.spec.js
  protected_files_changed: false
  route_or_production_exposure: false
  queue_lifecycle_or_database_work: false
  gate_a_or_p0_06b_work: false

behavior:
  invokes_package_b_once_per_call: true
  derives_c1_facts_from_stored_enqueue_record: true
  pass_maps_to_c1_passed: true
  block_maps_to_c1_blocked: true
  policy_eligible_failed_maps_to_c1_failed: true
  bridge_contention_and_malware_not_configured_call_c1_zero_times: true
  unclassified_result: C2_UNCLASSIFIED_OUTCOME with C1 zero calls
  c1_replay_conflict_lifecycle_and_atomic_audit_preserved: true
  enqueue_record_left_unchanged_and_unconsumed: true
  independent_c2_audit_write: false

tests:
  focused_c2: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-synthetic-assessment-policy-composition.spec.js - tests 10; pass 10; fail 0
  focused_c2_package_b_c1_enqueue_audit_acceptance_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test C2, Package B, enqueue, lifecycle, bridge, executor, audit, and P0 acceptance specs - existing local HTTP listener tests failed with sandbox listen EPERM on 127.0.0.1; non-listener subtests proceeded
  focused_c2_package_b_c1_enqueue_audit_acceptance_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel node --test C2, Package B, enqueue, lifecycle, bridge, executor, audit, and P0 acceptance specs - tests 139; pass 139; fail 0
  sprint2_suite_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - existing local HTTP listener tests failed with sandbox listen EPERM on 127.0.0.1; non-listener subtests proceeded
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 949; pass 949; fail 0
  full_repository_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - existing local HTTP listener tests failed with sandbox listen EPERM on 127.0.0.1; non-listener subtests proceeded
  full_repository_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1054; pass 1054; fail 0
  git_diff_check_before_execplan: git diff --check - pass

not_confirmed:
  database_atomicity: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  automated_queue_processing: NOT_CONFIRMED
  HTTP_completed_security_assessment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no protected-file change, HTTP route, production barrel, production composition, database, queue lifecycle, schema, cloud, credential, tenant, feature-flag, deployment, push, Current State update, Implementation Baseline update, Gate A, Gate B, Gate C, Gate D, P0-06B, P1, or next-package work

next_package_or_stop_condition: OWNER-DIRECTED STOP after C2; do not begin HTTP integration or another package
commit_hash: report after commit; a commit cannot contain its own SHA
```

## Gate A ephemeral local PostgreSQL migration and verification package

```text
KAI_SPRINT2_GATE_A_EPHEMERAL_LOCAL_POSTGRES

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED APPROVE_GATE_A_EPHEMERAL_LOCAL_POSTGRES
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: b3d049137e9ce0419a8bf7cbe95a25988136c366
worktree_at_start: clean tracked and untracked
preflight_execplan_eof_inline: verified with tail; latest evidence block was literal EOF before this package append

implemented_scope:
  forward_migration: migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.sql
  rollback_draft: migrations/kai_sprint2_gate_a_persistent_upload_lifecycle.rollback.sql
  deterministic_catalog_verifier: scripts/kai-sprint2-gate-a-verifier.sql
  synthetic_bootstrap_schema: scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql
  synthetic_smoke_seed: scripts/kai-sprint2-gate-a-smoke-seed.sql
  smoke_verifier: scripts/kai-sprint2-gate-a-smoke-verifier.sql
  ephemeral_runner: scripts/kai-sprint2-gate-a-local-postgres.js
  runbook_patch_notes: scripts/kai-sprint2-gate-a-runbook.md
  package_script: verify:kai-sprint2-gate-a-local
  production_lifecycle_repository_mount: not implemented
  route_or_feature_flag_or_tenant_change: false
  cloud_or_gcs_or_real_data: false
  current_state_update: false

postgresql:
  server: ephemeral local PostgreSQL only
  version: 16.14 (Homebrew)
  initial_dependency_gap: local libpq had client tools but no postgres server binary
  local_server_install: postgresql@16 installed by owner-approved escalated Homebrew command
  sandbox_limitation: initial local initdb failed inside sandbox on shared memory creation; rerun outside sandbox under Gate A authorization
  persistent_homebrew_service_started: false
  temp_cluster_cleanup: runner stops cluster and removes temp directory

migration_behavior:
  durable_upload_lifecycle_columns: upload_state, upload_state_changed_at, upload_expires_at
  immutable_object_version_identity: object_version_id with provider-neutral ov_ plus 32 lowercase hex constraint and immutability trigger
  verified_checksum_state: verified_checksum, verified_size_bytes, verified_at with lowercase SHA-256 and immutable verified facts
  policy_replay_state: policy_decision_replay constrained to required replay keys
  enqueue_identity: kai.security_assessment_enqueue with unique organization_id/intake_file_id/object_version_id/verified_checksum identity
  tenant_indexes: tenant-file, tenant-upload-state, object-version, and checksum replay indexes
  lifecycle_trigger: allowed edge enforcement, expiry rejection, immutable tenant/file/object/checksum/size facts, and 25-active-file limit
  existing_row_handling: backfills null lifecycle fields to reserved with 24-hour expiry from created_at/now
  destructive_cleanup_or_retention_rule: none

verification:
  gate_a_ephemeral_postgres: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-local - PostgreSQL 16.14; passed
  catalog_verifier: single result set; DDL syntax, vocabulary, columns, constraints, indexes, FK, trigger, and PostgreSQL version passed
  smoke_verifier: single result set; lifecycle transitions, expiry, identical replay, conflict rejection, enqueue ON CONFLICT, transaction rollback, audit atomicity, tenant predicate, and 25-file active limit passed
  two_session_checks: pg two-client runner verified identical replay, conflicting object-version replay rejection, and row-lock contention failure with lock_timeout
  sprint2_suite_initial_sandbox: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - existing localhost listener tests failed with sandbox listen EPERM on 127.0.0.1; non-listener subtests proceeded
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 954; pass 954; fail 0
  full_repository_localhost_capable: DATABASE_URL=postgres://kai_sentinel:kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1059; pass 1059; fail 0
  git_diff_check_before_execplan: git diff --check - pass

established_label:
  P0_DATABASE_INTEGRATION_VERIFIED: local ephemeral PostgreSQL plus synthetic fixtures only

not_confirmed:
  deployed_schema_compatibility: NOT_CONFIRMED
  nonproduction_storage: NOT_CONFIRMED
  live_upload_readiness: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED
  cloud_or_gcs_behavior: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no production or shared nonproduction database, real client data, cloud or GCS work, credential disclosure, deployment, feature-flag or tenant change, Gate B, Gate C, Gate D, P1, Current State update, push, or production lifecycle mount

next_package_or_stop_condition: OWNER-DIRECTED STOP after Gate A ephemeral local PostgreSQL migration and verification package; do not begin Gate B, Gate C, Gate D, P1, cloud, deployment, tenant/feature-flag change, Current State update, or production lifecycle mounting without separate authorization
commit_hash: report after commit; a commit cannot contain its own SHA
```
