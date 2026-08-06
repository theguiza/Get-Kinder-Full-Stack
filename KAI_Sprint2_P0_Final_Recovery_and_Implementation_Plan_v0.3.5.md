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

## P0-07 per-format local HTTP acceptance

```text
APPROVE_P0_07_PER_FORMAT_HTTP_ACCEPTANCE

package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 96c04931262527489da5af7f15e9517150928a99
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_fetch_push_or_deploy: not performed

implemented_scope:
  test_file: __tests__/kai-sprint2-p0-acceptance.spec.js
  production_code_changed: false
  detector_semantics_changed: false
  database_schema_cloud_queue_or_gate_work: false
  execplan_evidence: KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md

http_acceptance_composition:
  real_ephemeral_listener: true
  real_feature_gate_middleware: true
  deterministic_local_auth_adapter: true
  real_router_services_validators: true
  in_memory_upload_lifecycle_repository: true
  synthetic_security_assessment_enqueue: true
  local_dev_storage_adapter: true
  synthetic_malware_adapter_for_clean_pass_cases: true
  c2_to_c1_policy_composition: true
  sanitized_operator_read_assertions: true

covered_format_cases:
  encrypted_pdf: existing encrypted_or_password_protected block category exercised through local HTTP confirmation and C2/C1 policy composition; no detector semantic change
  encrypted_xlsx: encrypted ZIP general-purpose flag exercised through existing bounded assessor fail-closed sanitized failure path; no detector semantic change
  xlsx_macro: xlsx_macro_or_external_relationship block
  xlsx_external_relationship: xlsx_macro_or_external_relationship block
  xlsx_path_traversal: ooxml_path_traversal block
  xlsx_entry_expansion_bomb: archive_entry_limit_exceeded block
  xlsx_compression_ratio_bomb: archive_compression_ratio_limit_exceeded block
  pdf_active_content: pdf_active_or_embedded_content block
  pdf_embedded_file: pdf_active_or_embedded_content block
  prompt_injection_txt: pass with instruction-like text remaining inert data and absent from outputs
  prompt_injection_md: pass with instruction-like text remaining inert data and absent from outputs
  spreadsheet_formula_cells: pass with formula cell bytes remaining quarantined and absent from outputs

test_only_boundary:
  reservation_mime_gate_preserved: true
  assessment_fact_override_scope: synthetic enqueue snapshot only, inside acceptance harness, after real HTTP reservation/upload/confirm
  reason: existing metadata-only reservation gate still allows only committed DDL-safe MIME values while P0-07 must exercise bounded assessor format facts locally
  production_route_or_service_mime_allowlist_changed: false
  raw_content_exposed_in_response_audit_metric_or_log: false
  storage_identifier_exposed: false

verification:
  focused_p0_07_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - sandbox listener failure, listen EPERM on 127.0.0.1
  focused_p0_07_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 60; pass 60; fail 0
  verify_schema_contract: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract - tests 21; pass 21; fail 0
  verify_api_contract_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - sandbox listener failure, listen EPERM on 127.0.0.1
  verify_api_contract_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - tests 55; pass 55; fail 0
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 967; pass 967; fail 0
  full_repository_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1072; pass 1072; fail 0
  git_diff_check_before_execplan: git diff --check - pass
  git_diff_check_after_execplan: git diff --check - pass
  git_diff_cached_check: git diff --cached --check - pass

completion_labels:
  - P0 repository contract complete
  - P0 local synthetic acceptance passed
  - Persistent lifecycle integration pending Gate A
  - P0_CODE_CONTRACT_COMPLETE
  - P0_LOCAL_SYNTHETIC_HTTP_ACCEPTANCE_PASS
  - P0_LOCAL_UPLOAD_CONTRACT_COMPLETE

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  persistent_upload_lifecycle: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no detector semantic change, database, schema, cloud, production, queue drain, Gate A, Gate B, Gate C, Gate D, P0-06B, deployment, push, credential, tenant, feature-flag, real-client-data, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this P0-07 per-format local HTTP acceptance package
commit_hash: report after commit; a commit cannot contain its own SHA
```

## Runtime MIME alignment and honest P0-07 coverage correction

```text
package_date: 2026-08-02 America/Vancouver
evidence_class: TOOL_VERIFIED
owner_authorization: USER_CONFIRMED
package_status: complete before commit
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 638451531e56bff8947b3d1b036814b6896be3ba
direct_parent: 96c04931262527489da5af7f15e9517150928a99
starting_tree: clean tracked and untracked
staged_paths_at_start: none
remote_fetch_push_or_deploy: not performed

execplan_integrity:
  pre_edit_tail_printed: TOOL_VERIFIED
  prior_6384515_block_at_true_eof_before_append: TOOL_VERIFIED
  relocation_performed: false
  prior_bytes_changed: false
  new_evidence_block_location: literal EOF

runtime_allowlist_before:
  Backend/kai/services/kaiIntakeService.js allowed text/csv, application/csv, and text/plain by MIME only
  extension_mime_pairing_enforced: false

runtime_allowlist_after:
  .csv: text/csv, application/csv
  .xlsx: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
  .md: text/markdown, text/plain
  .txt: text/plain
  .pdf: application/pdf
  extension_mime_pairing_enforced: true
  application_json_rejected: TOOL_VERIFIED
  application_octet_stream_declared_file_mime_rejected: TOOL_VERIFIED
  unlisted_mime_rejected: TOOL_VERIFIED
  mismatched_extension_mime_pairs_rejected: TOOL_VERIFIED
  caller_metadata_repair_or_reclassification: false

p0_07_correction:
  metadata_substitution_removed: TOOL_VERIFIED
  synthetic_enqueue_snapshot_retargeting_removed: TOOL_VERIFIED
  reserve_upload_confirm_enqueue_assessment_use_original_reservation_facts: TOOL_VERIFIED
  detector_semantics_changed: false
  assessor_semantics_changed: false

format_cases_proven:
  encrypted_pdf: .pdf application/pdf reaches encrypted_or_password_protected block outcome through original reservation facts
  encrypted_xlsx: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches security_assessment_timeout sanitized failure through original reservation facts
  xlsx_macro: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches xlsx_macro_or_external_relationship block
  xlsx_external_relationship: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches xlsx_macro_or_external_relationship block
  xlsx_path_traversal: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches ooxml_path_traversal block
  xlsx_entry_expansion_bomb: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches archive_entry_limit_exceeded block
  xlsx_compression_ratio_bomb: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches archive_compression_ratio_limit_exceeded block
  pdf_active_content: .pdf application/pdf reaches pdf_active_or_embedded_content block
  pdf_embedded_file: .pdf application/pdf reaches pdf_active_or_embedded_content block
  prompt_injection_txt: .txt text/plain reaches pass with text remaining inert and absent from outputs
  prompt_injection_md: .md text/markdown reaches pass with text remaining inert and absent from outputs
  spreadsheet_formula_cells: .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet reaches pass with formula bytes absent from outputs
  format_coverage_gaps_found: none

sanitized_output:
  responses_expose_no_raw_bytes: TOOL_VERIFIED
  responses_expose_no_storage_details: TOOL_VERIFIED
  responses_expose_no_checksums_or_object_version_facts: TOOL_VERIFIED
  responses_expose_no_enqueue_identifiers: TOOL_VERIFIED
  responses_expose_no_audit_data: TOOL_VERIFIED
  responses_expose_no_internal_assessor_details: TOOL_VERIFIED

tests_updated_for_old_behavior:
  __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js:
    before: assert.deepEqual(jsonMimeResult.blockers[0].evidence, { mime_type: "application/json" })
    after: rejects .txt application/json and application/octet-stream with file_extension plus mime_type evidence; accepts .xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, .pdf application/pdf, and .md text/markdown
  __tests__/kai-sprint2-pass2-route-runtime.spec.js:
    before: file-reservation route idempotency and checksum payloads declared text/csv without file_extension
    after: same assertions declare file_extension .csv so intended idempotency/checksum blockers are reached after MIME-pair validation
  __tests__/kai-sprint2-p0-acceptance.spec.js:
    before: P0-07 helper reserved xlsx/pdf/md cases as .txt text/plain and retargeted synthetic enqueue metadata before assessment
    after: helper reserves each case with the real extension and declared MIME and asserts enqueue records preserve those facts

verification:
  focused_reservation_validator: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-metadata-intake-service.spec.js - tests 64; pass 64; fail 0
  focused_route_runtime: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pass2-route-runtime.spec.js - tests 27; pass 27; fail 0
  focused_p0_07_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - sandbox listener failure, listen EPERM on 127.0.0.1
  focused_p0_07_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 62; pass 62; fail 0
  verify_schema_contract: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-schema-contract - tests 21; pass 21; fail 0
  verify_api_contract_initial_sandbox: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - sandbox listener failure, listen EPERM on 127.0.0.1 plus pre-alignment route payload failures fixed by adding .csv
  verify_api_contract_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-api-contract - tests 55; pass 55; fail 0
  sprint2_suite_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 982; pass 982; fail 0
  full_repository_localhost_capable: DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1087; pass 1087; fail 0

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  persistent_upload_lifecycle: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no detector semantic change, assessor semantic change, database, schema, cloud, production, queue drain, Gate A, Gate B, Gate C, Gate D, P0-06B, deployment, push, credential, tenant, feature-flag, real-client-data, Current State, or Implementation Baseline work

next_package_or_stop_condition: OWNER-DIRECTED STOP after this runtime MIME alignment and honest P0-07 coverage correction
commit_hash: report after commit; a commit cannot contain its own SHA
```

```text
P1-01 local profiling kernel evidence

starting_HEAD: dea7b50125ca7368669f495aad1cca6c6b86d024
parent_HEAD: 638451531e56bff8947b3d1b036814b6896be3ba
branch: codex/kai-sprint2-p0-v0.3.5
worktree_preflight: TOOL_VERIFIED
staged_paths_preflight: TOOL_VERIFIED
execplan_true_tail_before_edit: TOOL_VERIFIED
dea7b50_evidence_block_at_true_eof_before_edit: TOOL_VERIFIED
prior_evidence_blocks_intact_before_edit: TOOL_VERIFIED

implemented:
  Backend/kai/profiling/localProfilingKernel.js:
    status: TOOL_VERIFIED
    callable: profileLocalTrustedFile
    boundary: pure local profiling callable; no database, storage, lifecycle, queue, review item, source, evidence, claim, AI, LLM, route, worker, or persistent record dependency
    supported_formats: CSV, XLSX, Markdown, TXT, machine-readable PDF
    detector_semantics: P0 detector semantics unchanged
    pdf_boundary: PDF profiling is conservative and local; no OCR; encrypted or no machine-readable text layer returns typed not_profilable with stable safe reason and no partial profile
  __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js:
    status: TOOL_VERIFIED
    coverage: deterministic sanitized profiles for all five formats; redacted samples; formula and prompt text undisclosed; conservative governance defaults; safe malformed failures; encrypted and image-only PDF not_profilable; no prohibited production dependencies reachable

verification:
  focused_p1_profiling: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js - tests 6; fail 0
  affected_p0_detector_file_security_regressions: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js __tests__/kai-sprint2-formula-injection-boundary.spec.js __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js - tests 133; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener failure, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 988; fail 0
  full_repository_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox listener failure, listen EPERM on 127.0.0.1
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1093; fail 0
  git_diff_check_pre_execplan: TOOL_VERIFIED
  git_diff_cached_check_pre_execplan: TOOL_VERIFIED

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  persistent_upload_lifecycle: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no new dependency, database, schema, storage, parser-run record, persistent profile, dictionary persistence, worker, queue, route, feature flag, review item, source candidate, promotion decision, source, source version, evidence, claim, AI, LLM, OCR, Gate A, P0-06B, deployment, push, credential, tenant, feature-flag, real-client-data, Current State, or production configuration work

next_package_or_stop_condition: OWNER-DIRECTED STOP after P1-01 local profiling kernel
commit_hash: report after commit; a commit cannot contain its own SHA
```

```text
P1-01A pure profiling kernel correction evidence

starting_HEAD: e088e6d6bf92ac7433c9ca322bcd8c7c59afe442
parent_HEAD: dea7b50125ca7368669f495aad1cca6c6b86d024
branch: codex/kai-sprint2-p0-v0.3.5
worktree_preflight: TOOL_VERIFIED
staged_paths_preflight: TOOL_VERIFIED
untracked_files_preflight: TOOL_VERIFIED
execplan_true_tail_before_edit: TOOL_VERIFIED
e088e6d_evidence_block_at_true_eof_before_edit: TOOL_VERIFIED
prior_evidence_blocks_intact_before_edit: TOOL_VERIFIED
contract_gap: NOT_CONFIRMED
pdf_narrowing_anomaly: NOT_CONFIRMED

implemented:
  Backend/kai/profiling/localProfilingKernel.js:
    status: TOOL_VERIFIED
    boundary: pure local byte-input profiling kernel; no new dependency, filesystem read/write, network, storage, database, route, queue, lifecycle, review, source, evidence, claim, worker invocation, OCR, AI, persistence, or parser-run record
    csv_outputs: TOOL_VERIFIED - headers, row and column counts, primitive type hints, missingness, duplicate-row hints, bounded redacted sample records, sample value character cap, and draft dictionary fields
    xlsx_outputs: TOOL_VERIFIED - redacted sheet names and sheet count, row/column/cell/formula counts per sheet, headers per sheet, primitive type hints, missingness, duplicate-row hints, bounded redacted sample records, sample value character cap, and draft dictionary fields per sheet
    text_outputs: TOOL_VERIFIED - Markdown heading positions and counts, TXT/Markdown paragraph and line counts, deterministic date-candidate positions, bounded redacted structure, and inert undisclosed instruction-like content
    sample_limits: TOOL_VERIFIED - maximum redacted sample records 20; maximum sample characters per value 120
    failure_behavior: TOOL_VERIFIED - malformed CSV/XLSX and policy-gated failures return safe typed results with no partial profile
    redaction: TOOL_VERIFIED - no raw scalar, formula, prompt, document text, PII, path, URL, storage fact, or parser internal appears in tested results or errors
    pdf_narrowing: TOOL_VERIFIED - every PDF with confirmed identity returns typed not_profilable envelope stating structural PDF profiling requires the separately governed worker boundary; page_count, machine-readable text-layer confirmation, section claims, and block claims removed from pure kernel output
  __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js:
    status: TOOL_VERIFIED
    focused_assertions: TOOL_VERIFIED - exact focused assertions cover CSV, XLSX, Markdown/TXT, cross-format sample limits, safe failure behavior, dependency boundary, redaction, and PDF narrowing
    dependency_boundary: TOOL_VERIFIED - static assertions prove no filesystem, network, storage, database, route, queue, lifecycle, review, source, evidence, claim, worker, OCR, or AI dependency is imported or called
    pdf_tests_updated: TOOL_VERIFIED
    pdf_before_assertion: assert.equal(profiled.status, "profiled"); assert.equal(profiled.counts.page_count, 1)
    pdf_after_assertion: assert.equal(profiled.status, "not_profilable"); assert.equal(profiled.reason, "structural_pdf_profiling_requires_separately_governed_worker_boundary"); assert.equal(profiled.counts, undefined); assert.equal(profiled.structural_metadata, undefined)

verification:
  focused_p1_kernel_tests_initial: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js - syntax correction required before behavioral results
  focused_p1_kernel_tests_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js - tests 10; fail 0
  affected_p0_detector_file_security_regressions: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js __tests__/kai-sprint2-formula-injection-boundary.spec.js __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js - tests 133; fail 0
  p0_07_acceptance_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - sandbox listener failure, listen EPERM on 127.0.0.1
  p0_07_acceptance_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 62; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener failure, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 992; fail 0
  full_repository_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox listener failure, listen EPERM on 127.0.0.1
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1097; fail 0
  git_diff_check_pre_execplan: TOOL_VERIFIED
  git_diff_cached_check_pre_execplan: TOOL_VERIFIED

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  persistent_upload_lifecycle: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no PDF worker behavior change, PDF worker invocation, OCR, database, schema, persistent parser run, persistent profile, worker, queue, route, feature flag, review item, source candidate, promotion decision, source, source version, evidence, claim, Gate A, P0-06B, deployment, push, credential, tenant, feature-flag, real-client-data, Current State, or production configuration work
  - no P0 detector or assessor semantic change

next_package_or_stop_condition: OWNER-DIRECTED STOP after P1-01A pure profiling kernel correction
commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-01B worker-backed PDF profiling evidence

status: TOOL_VERIFIED
date: 2026-08-02
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 90b86ace77d766682a8de580658f59c9517f3478
parent_head: e088e6d6bf92ac7433c9ca322bcd8c7c59afe442

preflight:
  repository_instructions: TOOL_VERIFIED - AGENTS.md read; ExecPlan remains the single living repository ExecPlan; P1-01B authorized as bounded non-pure worker-backed PDF profiling only
  clean_worktree_before_changes: TOOL_VERIFIED - no unstaged tracked changes, no staged paths, no untracked files
  expected_head: TOOL_VERIFIED
  pdf_worker_interface_and_callers: TOOL_VERIFIED - existing file-backed worker boundary in Backend/kai/validators/pdfAssessorWorkerBoundary.js and worker thread in Backend/kai/validators/pdfAssessorWorkerThread.js inspected
  p1_profile_conventions: TOOL_VERIFIED - local profiling kernel result conventions inspected; pure PDF kernel continues typed not_profilable worker-boundary envelope
  literal_execplan_tail_before_editing: TOOL_VERIFIED - final 30 lines printed before implementation; latest evidence block was at true EOF with prior blocks intact

implemented:
  Backend/kai/validators/pdfAssessorWorkerBoundary.js:
    status: TOOL_VERIFIED
    worker_interface: explicit runPdfProfilingWorkerBoundary(input) added on the existing file-backed PDF worker boundary; default P0 assessor path and result semantics unchanged
    authorized_io: TOOL_VERIFIED - only existing file-backed worker execution; no temp file writes, storage, database, route, queue, lifecycle, source, evidence, claim, AI, OCR, or persistence integration
    profile_parent_sanitization: TOOL_VERIFIED - parent accepts only exact sanitized profile, exact typed not_profilable, or safe parser failure; malformed worker messages collapse to safe pdf_profile_worker_failed
  Backend/kai/validators/pdfAssessorWorkerThread.js:
    status: TOOL_VERIFIED
    worker_operation: explicit operation profile uses MuPDF Document.openDocument, countPages, existing encryption/text/active-content assessment, and StructuredText.walk
    pdf_profile_output: TOOL_VERIFIED - real worker page_count, extractable_text_confirmed true only after non-whitespace structured-text characters, bounded redacted page section shapes, bounded redacted block shapes, no raw PDF text
    not_profilable_behavior: TOOL_VERIFIED - encrypted/password-protected, no extractable text, image-only/scanned-equivalent, and active/embedded-content PDFs return typed not_profilable with stable safe reason and no partial profile
    parser_failure_behavior: TOOL_VERIFIED - malformed, repaired, invalid dependency output, thrown operations, and malformed worker messages return safe parser failure with no raw content or parser internals
  __tests__/kai-sprint2-p1-pdf-profiling-worker-boundary.spec.js:
    status: TOOL_VERIFIED
    coverage: page count from worker not marker scanning; extractable text from worker; no raw document text in profile or failures; encrypted and image-only not profilable; malformed safe failure; no OCR; no profiler temp artifacts; pure kernel unchanged; P0 PDF security unchanged; prohibited dependency exclusions

verification:
  focused_p1_pdf_profiling_tests_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-pdf-profiling-worker-boundary.spec.js - tests 5; fail 0
  focused_p1_kernel_tests_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-local-profiling-kernel.spec.js - tests 10; fail 0
  affected_pdf_worker_and_mupdf_regressions_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-pdf-assessor-worker-boundary.spec.js __tests__/kai-sprint2-mupdf-dependency.spec.js - tests 63; fail 0
  affected_p0_detector_file_security_regressions_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js __tests__/kai-sprint2-csv-row-limit-detector.spec.js __tests__/kai-sprint2-txt-md-byte-detector.spec.js __tests__/kai-sprint2-xlsx-sheet-cell-limit-detector.spec.js __tests__/kai-sprint2-ooxml-archive-resource-limit-detector.spec.js __tests__/kai-sprint2-formula-injection-boundary.spec.js __tests__/kai-sprint2-bounded-file-security-assessor.spec.js - tests 77; fail 0
  p0_07_acceptance_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - sandbox listener restriction, listen EPERM on 127.0.0.1
  p0_07_acceptance_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p0-acceptance - tests 62; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener restriction, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 997; fail 0
  full_repository_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox listener restriction, listen EPERM on 127.0.0.1
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1102; fail 0
  git_diff_check_pre_execplan: TOOL_VERIFIED
  git_diff_cached_check_pre_execplan: TOOL_VERIFIED

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  database_atomicity: NOT_CONFIRMED
  persistent_upload_lifecycle: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no database, schema, storage-provider integration, route, feature flag, queue, persistent parser run, lifecycle mutation, review item, source, source version, evidence, claim, AI, LLM processing, OCR, Gate A, P0-06B, deployment, push, credential, tenant, production configuration, real-client-data, or Current State work
  - no P0 detector or assessor semantic change

next_package_or_stop_condition: OWNER-DIRECTED STOP after P1-01B worker-backed PDF profiling
commit_hash: report after commit; a commit cannot contain its own SHA
```

## Gate A P0 persistent upload-lifecycle substrate evidence

status: TOOL_VERIFIED
date: 2026-08-03
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: f44a592c9aeefc2a228d7d0ec695c3b09f06b48b
parent_head: a90d517e70946412ba63a1fe3d58186135b73dbf

preflight:
  repository_root: TOOL_VERIFIED - /Users/mikewoz/Get-Kinder-Full-Stack-Deploy
  applicable_AGENTS_md: TOOL_VERIFIED - repository root AGENTS.md inspected
  worktree_before_changes: TOOL_VERIFIED - clean; no staged paths; no untracked files
  historical_material_inspected_only: TOOL_VERIFIED - c54aa43 and a90d517 inspected as reference only; no cherry-pick, restore, reset, merge, rebase, fetch, pull, or wholesale application performed
  current_schema_and_migrations: TOOL_VERIFIED
  transaction_and_audit_helpers: TOOL_VERIFIED
  synthetic_lifecycle_repository_callers_tests: TOOL_VERIFIED
  execplan_true_tail_before_edit: TOOL_VERIFIED - final 30 lines printed before append
  execplan_prior_byte_count: TOOL_VERIFIED - 542922
  execplan_prior_sha256: TOOL_VERIFIED - a7988a7e8ee25b0d08c02afe003dea649b5a21fade92fa7be0a1dba728c9fb22

implemented:
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql:
    status: TOOL_VERIFIED
    scope: dedicated PostgreSQL P0 upload-lifecycle columns, constraints, tenant indexes, lifecycle audit table, and transition trigger for kai.intake_files only
    covered_behaviors: tenant-scoped reservation, immutable object-version identity, declared checksum constraints, independently verified checksum fields, upload expiry, same-fact replay surface, changed-fact conflict, checksum-mismatch zero transition surface, allowed and denied lifecycle transitions, transaction atomicity, audit atomicity, and active-upload concurrency limit
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.rollback.sql:
    status: TOOL_VERIFIED
    scope: rollback draft for the Gate A P0 lifecycle substrate artifacts only
  scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql:
    status: TOOL_VERIFIED
    scope: synthetic kai.intake_files bootstrap only; no real client data
  scripts/kai-sprint2-gate-a-verifier.sql:
    status: TOOL_VERIFIED
    scope: read-only catalog verification for PostgreSQL 16, columns, constraints, indexes, trigger, and audit table
  scripts/kai-sprint2-gate-a-failure-checks.sql:
    status: TOOL_VERIFIED
    scope: read-only failure checks proving no listed P1 durable tables or source/source_version columns
  scripts/kai-sprint2-gate-a-smoke-seed.sql:
    status: TOOL_VERIFIED
    scope: synthetic smoke fixtures only
  scripts/kai-sprint2-gate-a-smoke-verifier.sql:
    status: TOOL_VERIFIED
    scope: mutating smoke checks wrapped in rollback for tenant predicates, allowed and denied transitions, immutable facts, checksum match/mismatch, expiry, transaction/audit rollback, and active-upload concurrency limit
  scripts/kai-sprint2-gate-a-local-postgres.js:
    status: TOOL_VERIFIED
    scope: runner-created isolated ephemeral PostgreSQL 16 target bound only to loopback; synthetic database name kai_gate_a_p0_upload_lifecycle_synthetic; teardown in finally block
  scripts/kai-sprint2-gate-a-runbook.md:
    status: TOOL_VERIFIED
    scope: package command and local-only boundary
  package.json:
    status: TOOL_VERIFIED
    package_command: verify:kai-sprint2-gate-a-p0

verification:
  gate_a_package_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-p0 - sandbox shared-memory failure during PostgreSQL initdb; no database target retained
  gate_a_package_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-p0 - ephemeral database created kai_gate_a_p0_upload_lifecycle_synthetic; loopback 127.0.0.1:55008; PostgreSQL verification passed; workdir removed /var/folders/hf/4f3q66q1311bpjpt4wm58l8w0000gn/T/kai-gate-a-p0-pg-NKcNHh
  focused_upload_lifecycle_repository: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 36; fail 0
  focused_transaction_audit_regressions: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-mutation-orchestration.spec.js __tests__/kai-sprint2-audit-contract.spec.js - tests 41; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener restriction, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 997; fail 0
  full_repository_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - sandbox listener restriction, listen EPERM on 127.0.0.1
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1102; fail 0
  git_diff_check_pre_execplan: TOOL_VERIFIED

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  production_database_atomicity: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no P1 durable table for parser runs, profiles, dictionaries, quality records, sensitivity records, review workflow, source candidates, promotion decisions, source, or source_version
  - no P0-06B route integration, Gate B, Gate C, Gate D, storage-provider integration, cloud work, route expansion, feature enablement, deployment, production or shared database work, real-client-data handling, retention/deletion, Current State update, Implementation Baseline update, fetch, pull, push, merge, rebase, reset, or cherry-pick

next_package_or_stop_condition: OWNER-DIRECTED STOP after one bounded Gate A P0 persistent upload-lifecycle substrate package
commit_hash: report after commit; a commit cannot contain its own SHA
```

## Gate A durable policy-decision replay and audit amendment evidence

status: TOOL_VERIFIED
date: 2026-08-03
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 548194a

preflight:
  repository_root: TOOL_VERIFIED - /Users/mikewoz/Get-Kinder-Full-Stack-Deploy
  applicable_AGENTS_md: TOOL_VERIFIED - repository root AGENTS.md inspected
  worktree_before_changes: TOOL_VERIFIED - clean; no staged paths; no untracked files
  living_execplan_inspected: TOOL_VERIFIED
  protected_files_not_diffed: TOOL_VERIFIED - Backend/kai/upload/inMemoryUploadLifecycleRepository.js, Backend/kai/upload/syntheticConfirmUploadAndEnqueue.js, Backend/kai/upload/syntheticSecurityAssessmentEnqueue.js, Backend/kai/db/kaiDb.js
  frozen_gate_a_migration_not_modified: TOOL_VERIFIED - migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql unchanged
  execplan_true_tail_before_edit: TOOL_VERIFIED - final 30 lines printed before append
  execplan_prior_byte_count: TOOL_VERIFIED - 548996
  execplan_prior_sha256: TOOL_VERIFIED - 911b24058bc5bfcd4371091dec7a95d34a9ab1df0bb90a22e43cd4dd60c291c3
  execplan_pre_append_copy: TOOL_VERIFIED - /tmp/kai_execplan_pre_gate_a_policy_replay.md

implemented:
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql:
    status: TOOL_VERIFIED
    scope: forward-only follow-up migration after 548194a adding kai.upload_policy_decision_replay, deterministic sanitized-result hash, metadata-only JSON guard, and existing audit vocabulary amendment for policy_decision_compare_and_set
    replay_facts_persisted: organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes, declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256, replay_contract_version
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql:
    status: TOOL_VERIFIED
    scope: rollback draft for only the policy-decision replay amendment, including removal of follow-up policy audit rows before restoring prior audit operation vocabulary
  scripts/kai-sprint2-gate-a-local-postgres.js:
    status: TOOL_VERIFIED
    scope: established runner now applies 548194a migration then follow-up migration, verifies policy-decision replay concurrency, rolls back the follow-up, then rolls back the substrate
  scripts/kai-sprint2-gate-a-verifier.sql:
    status: TOOL_VERIFIED
    scope: catalog checks for replay table, deterministic hash column, policy status vocabulary, and audit operation amendment
  scripts/kai-sprint2-gate-a-smoke-verifier.sql:
    status: TOOL_VERIFIED
    scope: synthetic SQL checks for fresh passed/blocked/failed decisions, exact replay, changed-fact conflicts, cross-tenant block, audit vocabulary rejection, transaction rollback, and metadata-only persistence
  __tests__/kai-sprint2-gate-a-policy-decision-replay-schema-contract.spec.js:
    status: TOOL_VERIFIED
    scope: new contract-alignment assertions mapping durable replay schema to accepted synthetic compareAndSetPolicyDecision facts without diffing protected files

verification:
  gate_a_package_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-p0 - sandbox shared-memory failure during PostgreSQL initdb; no database target retained
  gate_a_package_intermediate_localhost: TOOL_VERIFIED - fresh ephemeral loopback PostgreSQL target created and torn down; migration helper issue found before completion
  gate_a_package_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-p0 - ephemeral database created kai_gate_a_p0_upload_lifecycle_synthetic; loopback 127.0.0.1:55101; PostgreSQL verification passed; workdir removed /var/folders/hf/4f3q66q1311bpjpt4wm58l8w0000gn/T/kai-gate-a-p0-pg-RDNu9o
  focused_schema_contract: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-gate-a-policy-decision-replay-schema-contract.spec.js - tests 3; fail 0
  focused_lifecycle_and_contract: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-gate-a-policy-decision-replay-schema-contract.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 39; fail 0
  focused_transaction_audit_regressions: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-mutation-orchestration.spec.js __tests__/kai-sprint2-audit-contract.spec.js - tests 41; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener restriction, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 1000; fail 0
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1105; fail 0
  git_diff_check_pre_execplan: TOOL_VERIFIED

not_confirmed:
  deployed_kai_schema_compatibility: NOT_CONFIRMED
  production_database_atomicity: NOT_CONFIRMED
  nonproduction_storage_integration: NOT_CONFIRMED
  production_readiness: NOT_CONFIRMED
  real_client_data_readiness: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no PostgreSQL lifecycle repository adapter, application repository selection, services, routes, listeners, production composition, feature flags, cloud storage, signed URLs, P1 parser workflow, file profiles, dictionaries, quality or sensitivity records, review workflow, source/source_version, Gate B/C/D, deployment, production or shared database work, real-client-data handling, retention/deletion, Current State update, Implementation Baseline update, fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, or modification of the 548194a migration SQL

next_package_or_stop_condition: OWNER-DIRECTED STOP after one bounded Gate A durable policy-decision replay and audit amendment package
commit_hash: report after commit; a commit cannot contain its own SHA

---

## P0-06B PostgreSQL Upload-Lifecycle Repository Adapter Evidence

status: TOOL_VERIFIED
starting_branch: codex/kai-sprint2-p0-v0.3.5
starting_head: f8d771a1689a321cb33e153bfcdc5b8919d01ce5
scope:
  - additive internal PostgreSQL upload-lifecycle repository adapter only
  - additive runner-owned loopback PostgreSQL 16 integration runner and adapter contract tests only
  - no route wiring, listener wiring, production service composition, feature flags, cloud storage, signed URLs, P1 persistence, Gate B/C/D, deployment, production/shared database, real client data, Current State, or Implementation Baseline work

files_added:
  Backend/kai/upload/postgresUploadLifecycleRepository.js:
    status: TOOL_VERIFIED
    callable_interface: createReservedUploadLifecycle, getUploadLifecycle, transitionUploadLifecycle, compareAndSetPolicyDecision
    transaction_boundary: existing Backend/kai/db/kaiDb.js withTransaction callback-scoped transaction; no second pool
    db_tables_used: kai.intake_files; kai.upload_policy_decision_replay; kai.upload_lifecycle_audit
    policy_replay_path: policyReplayFromInput/samePolicyReplay-equivalent fact set, plus committed replay_contract_version and sanitized_result_canonical_sha256 persistence
    audit_path: kai.upload_lifecycle_audit metadata-only rows in the same transaction; policy exact replay creates no duplicate audit
    error_boundary: single shapeLifecycleError boundary returns existing lifecycle error vocabulary only
  __tests__/kai-sprint2-p0-postgres-upload-lifecycle-repository.integration.spec.js:
    status: TOOL_VERIFIED
    scope: runner-gated adapter integration and cross-implementation contract assertions; skipped outside runner-owned database context
  scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js:
    status: TOOL_VERIFIED
    scope: creates fresh isolated loopback PostgreSQL 16 target, applies 548194a and f8d771a migrations as setup, runs adapter tests, tears down runner-owned workdir

protected_files:
  Backend/kai/upload/inMemoryUploadLifecycleRepository.js: TOOL_VERIFIED unchanged
  Backend/kai/upload/syntheticConfirmUploadAndEnqueue.js: TOOL_VERIFIED unchanged
  Backend/kai/upload/syntheticSecurityAssessmentEnqueue.js: TOOL_VERIFIED unchanged
  Backend/kai/db/kaiDb.js: TOOL_VERIFIED unchanged; no added lines

frozen_migrations:
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.rollback.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql: TOOL_VERIFIED unchanged

verification:
  adapter_runner_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel node scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js - sandbox shared-memory failure during PostgreSQL initdb; no database target retained
  adapter_runner_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel node scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js - ephemeral database kai_p0_06b_upload_lifecycle_adapter_synthetic; loopback 127.0.0.1:56888; tests 9; fail 0; workdir removed
  existing_in_memory_lifecycle: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 36; fail 0
  affected_transaction_audit_schema: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-audit-contract.spec.js __tests__/kai-sprint2-gate-a-policy-decision-replay-schema-contract.spec.js - tests 16; fail 0
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener restriction, listen EPERM on 127.0.0.1
  sprint2_suite_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 1001; pass 1000; fail 0; skipped 1 runner-gated adapter integration
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgresql://kai_sentinel@127.0.0.1:9/kai_sentinel npm test - tests 1106; pass 1105; fail 0; skipped 1 runner-gated adapter integration
  git_diff_check: TOOL_VERIFIED

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, protected-file edit, migration edit, rollback edit, route/listener wiring, production service composition, feature-flag enablement, cloud storage, signed URL, P1 persistence, Gate B/C/D, deployment, production/shared database access, real client data access, retention/deletion, Current State update, or Implementation Baseline update

commit_hash: report after commit; a commit cannot contain its own SHA

## P0-06B adapter contract correction evidence - shared system_error

```text
timestamp_local: 2026-08-03 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: beb80357bdbad3b8b2e50dad6504980d47fb8072
package: KAI P0-06B adapter contract correction - shared system_error
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 560260
  sha256: 5554f343e3e72bf24e56763ab9ede5b46bb1cc4dc41bef022bf67adfbbb68ea1
  preserved_copy: /private/tmp/KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.pre-p0-06b-system-error.md

contract_decision:
  shared_upload_lifecycle_error_code_added: system_error
  meaning: unexpected internal, database, driver or transaction failure
  existing_lifecycle_codes_unchanged: validation_blocker; state_transition_denied; conflict_current_state_changed; not_found
  lifecycle_failure_envelope_changed: false
  callable_signatures_changed: false
  schema_changed: false

implementation:
  in_memory_upload_lifecycle_repository: TOOL_VERIFIED - only UPLOAD_LIFECYCLE_RESULT_STATUS gained system_error: 500
  postgres_upload_lifecycle_repository: TOOL_VERIFIED - createReservedUploadLifecycle now requires an existing matching kai.intake_files metadata row; removed adapter-generated synthetic filename/checksum insertion; unrecognized dependency/database/driver/transaction failures map to safe system_error; checksum mismatch is preclassified before SQL rowcount-derived result
  postgres_adapter_integration_spec: TOOL_VERIFIED - fixtures seed accepted metadata rows before adapter lifecycle reservation
  adapter_runner: TOOL_VERIFIED - runner-owned PostgreSQL specs execute sequentially against the isolated loopback target
  cross_implementation_parity_spec: TOOL_VERIFIED - added database-free in-memory coverage and runner-owned PostgreSQL parity coverage

verification:
  existing_in_memory_lifecycle: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js - tests 36; pass 36; fail 0
  parity_database_free: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-upload-lifecycle-cross-implementation-parity.spec.js - tests 5; pass 4; fail 0; skipped 1 runner-owned PostgreSQL case
  adapter_runner_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js - sandbox shared-memory failure during PostgreSQL initdb; workdir removed
  adapter_runner_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js - ephemeral database kai_p0_06b_upload_lifecycle_adapter_synthetic; loopback 127.0.0.1:56578; integration tests 9 pass 9 fail 0; parity tests 5 pass 5 fail 0; workdir removed
  affected_transaction_and_audit: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-audit-contract.spec.js __tests__/kai-sprint2-pass2-audit-contract.spec.js - tests 15; pass 15; fail 0
  standalone_adapter_spec_runner_gated: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p0-postgres-upload-lifecycle-repository.integration.spec.js - tests 1; skipped 1
  sprint2_suite_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - sandbox listener restriction; listen EPERM on 127.0.0.1; tests 958; pass 909; fail 47; skipped 2
  sprint2_suite_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 1006; pass 1004; fail 0; skipped 2
  full_repository_initial_sandbox: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel npm test - sandbox listener restriction; tests 1063; pass 1014; fail 47; skipped 2
  full_repository_localhost_capable_final: TOOL_VERIFIED - DATABASE_URL=postgresql://127.0.0.1:9/kai_sentinel npm test - tests 1111; pass 1109; fail 0; skipped 2
  git_diff_check: pending final post-append run

protected_files:
  Backend/kai/upload/inMemoryUploadLifecycleRepository.js: TOOL_VERIFIED limited to adding system_error to shared accepted error vocabulary
  Backend/kai/upload/syntheticConfirmUploadAndEnqueue.js: TOOL_VERIFIED unchanged
  Backend/kai/upload/syntheticSecurityAssessmentEnqueue.js: TOOL_VERIFIED unchanged
  Backend/kai/db/kaiDb.js: TOOL_VERIFIED unchanged

frozen_migrations:
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_upload_lifecycle.rollback.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql: TOOL_VERIFIED unchanged
  migrations/kai_sprint2_gate_a_p0_policy_decision_replay.rollback.sql: TOOL_VERIFIED unchanged

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring, service wiring, barrel wiring, production repository selection, production composition, feature-flag changes, cloud/storage work, P1 work, schema changes, Current State changes, Implementation Baseline changes, Gate A migration edits, Gate A rollback edits, deployment, production/shared database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-02 parser-run and file-profile persistence evidence

status: TOOL_VERIFIED
date: 2026-08-04
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 751aa814e111b3293fb7e4ab55b97b39c717d753

preflight:
  repository_root: TOOL_VERIFIED - /Users/mikewoz/Get-Kinder-Full-Stack-Deploy
  applicable_AGENTS_md: TOOL_VERIFIED - repository root AGENTS.md inspected
  worktree_before_changes: TOOL_VERIFIED - clean per `git status` before edits
  frozen_gate_a_files_not_modified: TOOL_VERIFIED - `git diff --stat` against migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql, its rollback, migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql, its rollback, scripts/kai-sprint2-gate-a-local-postgres.js, scripts/kai-sprint2-gate-a-verifier.sql, scripts/kai-sprint2-gate-a-smoke-seed.sql, scripts/kai-sprint2-gate-a-smoke-verifier.sql, scripts/kai-sprint2-gate-a-failure-checks.sql, Backend/kai/db/kaiDb.js, Backend/kai/upload/inMemoryUploadLifecycleRepository.js, Backend/kai/upload/postgresUploadLifecycleRepository.js reported no output (unchanged)
  execplan_true_tail_before_edit: TOOL_VERIFIED - final 17 lines printed before append
  execplan_prior_byte_count: TOOL_VERIFIED - 565871
  execplan_prior_sha256: TOOL_VERIFIED - 0686c7dfa685c16972e05e9d59936e362113debad753fdf327b1a143e82ab780

implemented:
  migrations/kai_sprint2_p1_parser_run_and_file_profile.sql:
    status: TOOL_VERIFIED
    scope: new forward-only migration adding kai.intake_parser_runs and kai.intake_file_profiles only, plus an additive amendment to the existing kai.upload_lifecycle_audit operation/metadata CHECK constraints for two new operations
    accepted_identity: organization_id, intake_file_id, parser_name, parser_version, checksum (declared checksum column) - enforced via a UNIQUE constraint on each new table
    parser_run_lifecycle: run_state IN (started, succeeded, failed) with a state/fact consistency CHECK on completed_at and failure_reason
    file_profile_redaction: profile jsonb CHECK (jsonb_typeof = object AND kai.gate_a_p0_jsonb_metadata_only(profile)) - reuses the existing frozen redaction guard function unmodified; profile_canonical_sha256 for deterministic comparison
    audit_vocabulary_added: parser_run_recorded, file_profile_persisted - additive DROP/ADD CONSTRAINT amendment, existing policy_decision_compare_and_set branch untouched
  migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql:
    status: TOOL_VERIFIED
    scope: rollback draft for only the two new tables and the two new audit operations; deletes affected audit rows before restoring the prior operation/metadata CHECK definitions; does not touch kai.upload_lifecycle_audit's table shape, kai.upload_policy_decision_replay, upload_state, or the lifecycle trigger
  scripts/kai-sprint2-p1-parser-run-file-profile-verifier.sql:
    status: TOOL_VERIFIED
    scope: read-only catalog verification for the new tables, columns, constraints, indexes, FKs, and audit vocabulary amendment
  scripts/kai-sprint2-p1-parser-run-file-profile-failure-checks.sql:
    status: TOOL_VERIFIED
    scope: read-only failure checks proving no other listed P1 tables, no raw-content columns on the new tables, and no source/source_version columns
  scripts/kai-sprint2-p1-parser-run-file-profile-smoke-seed.sql:
    status: TOOL_VERIFIED
    scope: one committed transaction persisting exactly one succeeded parser-run record and one metadata/redacted-only file-profile record (plus their required metadata-only audit rows) for the already-reserved org1/file1 fixture committed by the existing, unmodified scripts/kai-sprint2-gate-a-smoke-seed.sql
  scripts/kai-sprint2-p1-parser-run-file-profile-smoke-verifier.sql:
    status: TOOL_VERIFIED
    scope: mutating checks wrapped in ROLLBACK for smoke-seed persistence, cross-tenant isolation, duplicate-identity rejection, invalid state/fact rejection, missing-parent FK rejection, non-redacted profile rejection, unapproved audit-operation rejection, and combined parser-run/profile/audit transaction atomicity
  scripts/kai-sprint2-p1-parser-run-and-file-profile-local-postgres.js:
    status: TOOL_VERIFIED
    scope: new bounded runner (does not modify scripts/kai-sprint2-gate-a-local-postgres.js); runner-created isolated ephemeral PostgreSQL 16 target bound only to loopback; synthetic database name kai_p1_parser_run_file_profile_synthetic; applies the existing frozen Gate A migrations as unmodified prerequisites, then the new P1-02 migration, seeds, and verifiers; teardown in finally block
  scripts/kai-sprint2-p1-parser-run-file-profile-runbook.md:
    status: TOOL_VERIFIED
    scope: package command, scope boundary, and explicit note that no application code was added so KAI_SPRINT2_ENABLED gating is unaffected
  __tests__/kai-sprint2-p1-parser-run-file-profile-schema-contract.spec.js:
    status: TOOL_VERIFIED
    scope: static DB-free assertions on the new migration/rollback SQL source matching the accepted identity, redaction guard reuse, audit-vocabulary amendment, and rollback boundary
  package.json:
    status: TOOL_VERIFIED
    package_command: verify:kai-sprint2-p1-parser-run-file-profile

verification:
  p1_02_package_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p1-parser-run-file-profile - ephemeral database created kai_p1_parser_run_file_profile_synthetic; loopback 127.0.0.1:55558; verification passed; workdir removed
  focused_schema_contract: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-parser-run-file-profile-schema-contract.spec.js - tests 5; pass 5; fail 0
  affected_regressions: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-gate-a-policy-decision-replay-schema-contract.spec.js __tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-audit-contract.spec.js - tests 52; pass 52; fail 0
  sprint2_suite_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 - tests 1011; pass 1009; fail 0; skipped 2 runner-gated adapter integration
  full_repository_localhost_capable: TOOL_VERIFIED - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test - tests 1116; pass 1114; fail 0; skipped 2 runner-gated adapter integration
  git_diff_check: TOOL_VERIFIED - exit 0, no output

not_confirmed:
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED
  application_repository_or_service_use_of_this_substrate: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, edit of any frozen Gate A migration/rollback/runner/verifier/smoke file, edit of Backend/kai/upload/* or Backend/kai/db/kaiDb.js, repository/service/route/listener code, production repository selection, production composition, feature-flag changes, cloud/storage work, Gate B/C/D work, data dictionaries, quality records, sensitivity records, review workflow, source candidates, promotion decisions, source, source_version, deployment, production/shared database access, real-client-data access, or Current State/Implementation Baseline changes

next_package_or_stop_condition: OWNER-DIRECTED STOP after one bounded P1-02 parser-run and file-profile persistence package
commit_hash: report after commit; a commit cannot contain its own SHA
```

## KAI P1-02 correction: parser-run schema contract and profile lineage

```text
8fe2968 established the initial two-table P1-02 substrate.

Its parser lifecycle vocabulary and profile-to-run lineage constraints required correction.

The controlling parser-worker lifecycle contract was quoted before implementation.

The correction aligns the schema with the quoted contract and enforces exact composite lineage
between parser runs and file profiles.

quoted_contract_source: "KAI MVP Sprint 2 Archive/KAI_MVP_Sprint2_Backend_Storage_and_Validator_Implementation_Contract.md"
  (repository search for the exact expected path/filename named in the correction prompt returned
  no match anywhere under this repository's working tree or git history; the controlling document
  was located outside the repository, under the local filesystem path above, and read for quoting
  only — no repository file at that path was created, and this reference is not itself a repository
  edit)

quoted_parser_status_vocabulary: TOOL_VERIFIED
  source lines 239-247 ("## 9. Worker status model" / "Required statuses:"):
    queued
    running
    completed
    failed
    cancelled

quoted_required_parser_run_fields: TOOL_VERIFIED
  source lines 249-260 ("Required fields:"):
    parser_name
    parser_version
    parser_status
    started_at
    completed_at
    retry_count
    error_code
    error_message_safe
    output_profile_id

quoted_retry_cap: TOOL_VERIFIED
  source line 232 ("## 8. Async job and worker model" / "Retry policy:"): "max retries: 3"
  corroborated by source line 284 ("## 10. MVP file limits"): "Max parser retries: 3"

quoted_idempotency_identity: TOOL_VERIFIED
  source lines 1826-1831 ("### Parser/profile job idempotency" / "Key:"):
    "intake_file_id + parser_name + parser_version + checksum"

quoted_safe_failure_behavior: TOOL_VERIFIED
  source lines 218-227 ("Failure behavior:"):
    mark failed
    increment retry_count
    store safe error_code
    store safe error_message_safe
    do not store raw file content
    do not create source/evidence/claim records

contract_discrepancies:
  - The quoted idempotency-identity line (source lines 1826-1831) lists
    "intake_file_id + parser_name + parser_version + checksum" and does not itself name
    organization_id. The already-accepted P1-02 tenant-scoped identity (established by 8fe2968
    and explicitly preserved, not reopened, by this correction) is
    "organization_id + intake_file_id + parser_name + parser_version + checksum". organization_id
    is retained because every other identity/key definition in the same source document is
    explicitly tenant-scoped by organization_id, and intake_file_id itself only resolves within an
    organization via the accepted kai.intake_files (organization_id, intake_file_id) composite key;
    this is treated as an additive tenant-scoping convention already fixed by 8fe2968, not a
    contradiction of the quoted key.
  - Source section "22.3 intake_parser_runs" (lines 1941-1951), under "## 22. State-transition
    matrix", describes an earlier, P0-scoped "parser-run stub" using different column names
    (`job_status`, `parse_status`) and states most of its transitions are "not part of P0" /
    "P1 worker only". This section governs a P0-era stub table shape, not the P1 worker/table this
    correction builds. Section "## 9. Worker status model" (lines 237-270), titled for the async
    job/worker model this package implements, is the section that governs this correction's
    schema-governing values, and its vocabulary/field list is what was quoted above. No prompt
    value was superseded by this discrepancy; the two sections describe different table
    generations within the same source document, and the P1 worker section was used.
  - No other discrepancy was found between the quoted contract and the prompt's expected values;
    the quoted vocabulary, required-field list, retry cap, and failure behavior match the prompt's
    expected values verbatim.
```

```text
changed_files:
  migrations/kai_sprint2_p1_parser_run_and_file_profile.sql
  migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql
  scripts/kai-sprint2-p1-parser-run-file-profile-verifier.sql
  scripts/kai-sprint2-p1-parser-run-file-profile-smoke-seed.sql
  scripts/kai-sprint2-p1-parser-run-file-profile-smoke-verifier.sql
  scripts/kai-sprint2-p1-parser-run-file-profile-runbook.md
  __tests__/kai-sprint2-p1-parser-run-file-profile-schema-contract.spec.js
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this correction block)

files_considered_and_not_modified:
  scripts/kai-sprint2-p1-parser-run-file-profile-failure-checks.sql:
    reason: existing checks (no other P1 tables, no raw-content columns, no source/source_version
    columns) are orthogonal to the lifecycle-vocabulary correction; no new check was required to
    prove the corrected contract that the verifier.sql could not already prove.
  package.json:
    reason: existing verify:kai-sprint2-p1-parser-run-file-profile script and
    scripts/kai-sprint2-p1-parser-run-and-file-profile-local-postgres.js runner execute the
    corrected migration/scripts unmodified; the runner has no coupling to specific lifecycle
    column/status names, so it ran the corrected package without change.

migration_discipline: TOOL_VERIFIED
  the existing unpushed local P1-02 migration and rollback files (migrations/kai_sprint2_p1_parser_run_and_file_profile.sql,
  migrations/kai_sprint2_p1_parser_run_and_file_profile.rollback.sql) were corrected in place, per
  the prompt's required-migration-discipline instruction that unpushed/undeployed local packages be
  corrected forward rather than appended as a second migration; no repository instruction requiring
  append-only migration history for local, unpushed packages was found.

schema_correction_summary: TOOL_VERIFIED
  kai.intake_parser_runs: run_state/started/succeeded/failed/failure_reason replaced with
  parser_status (queued/running/completed/failed/cancelled, default queued), retry_count
  (integer, 0-3), error_code (safe lowercase snake_case identifier or null), error_message_safe
  (bounded length, regex-excludes URLs/paths/credentials/secrets/stack traces or null), and
  output_profile_id (uuid, nullable). A rewritten intake_parser_runs_p1_state_fact_consistency_check
  enforces, per status, the fail-closed fact combinations from the correction prompt (queued/
  running/completed/failed/cancelled). A new intake_parser_runs_p1_run_identity_unique constraint
  (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum) and a
  new intake_file_profiles_p1_run_identity_unique constraint (file_profile_id, organization_id,
  intake_file_id, parser_name, parser_version, checksum) were added as declarative composite
  unique-constraint targets. kai.intake_file_profiles' single-column parser_run_id foreign key was
  replaced with a 6-column composite foreign key to kai.intake_parser_runs covering
  (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum), so a
  profile whose organization_id/intake_file_id/parser_name/parser_version/checksum differ from its
  named parent run is rejected at the database boundary. After both tables exist, a new 6-column
  composite foreign key from kai.intake_parser_runs.output_profile_id to
  kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, parser_name,
  parser_version, checksum) was added by ALTER TABLE, so a completed run's output_profile_id must
  belong to a profile sharing that same run's exact identity; MATCH SIMPLE (Postgres default)
  leaves the constraint unenforced only while output_profile_id itself is null (queued/running/
  failed/cancelled), matching the state/fact consistency rule that only completed runs carry
  output_profile_id. No trigger was added; both lineage invariants are enforced by declarative
  foreign keys. The rollback draft now drops the output-profile foreign key before dropping
  kai.intake_file_profiles, to satisfy the FK dependency order in reverse. The
  upload_lifecycle_audit metadata-object CHECK's parser_run_recorded branch was updated to require
  parser_status/retry_count/error_code/error_message_safe keys in place of the removed
  run_state/failure_reason keys.
```

## KAI P1-03: persistent parser/profile worker orchestration

```text
Scope: a dormant internal parser/profile worker subsystem over the existing, unmodified
P1-02 substrate (kai.intake_parser_runs, kai.intake_file_profiles) and the existing Gate A
metadata-only audit table (kai.upload_lifecycle_audit). No migration, no schema change, no
route, listener, scheduler, timer, polling loop, startup hook, public barrel export,
production composition, application repository selection, feature-flag default, or cloud
configuration was added or modified. Sensitivity, data-dictionary, quality, review-workflow,
source, source_version, evidence, claim, and generation records remain out of scope and are
not created.

seams_reused_not_invented: TOOL_VERIFIED
  transaction interface: withTransaction(callback[, transactionProvider]) in
    Backend/kai/db/kaiDb.js (the single authoritative callback-scoped repository transaction
    interface; the provider parameter is used only as the existing test-injection seam)
  identity + constraints: the frozen P1-02 identity organization_id + intake_file_id +
    parser_name + parser_version + checksum, resolved concurrently through the existing
    intake_parser_runs_p1_identity_unique constraint
  canonical profile hash: the already-installed encode(digest(<jsonb>::text, 'sha256'), 'hex')
    convention used by scripts/kai-sprint2-p1-parser-run-file-profile-smoke-seed.sql for
    profile_canonical_sha256 and by Backend/kai/upload/postgresUploadLifecycleRepository.js for
    sanitized_result_canonical_sha256; no competing JavaScript canonicalization was introduced
  required metadata-only audit: the already-installed kai.upload_lifecycle_audit operations
    parser_run_recorded and file_profile_persisted with the exact metadata key sets already
    enforced by upload_lifecycle_audit_gate_a_metadata_object_check, the existing contract
    value p1_parser_run_and_file_profile_v1, and the existing validator key VAL-KAI-P1-02-001;
    no new audit operation, metadata key, contract string, or validator key was added
  metadata-only audit guard: the existing injected
    metadataOnlyAudit.prepareMetadataOnlyAudit({ payload }) -> { ok, publish } seam already used
    by the Gate A / P0-06B policy-decision path
  deterministic profilers: profileLocalTrustedFile (Backend/kai/profiling/localProfilingKernel.js)
    for CSV, XLSX, Markdown, and TXT; runPdfProfilingWorkerBoundary
    (Backend/kai/validators/pdfAssessorWorkerBoundary.js) for machine-readable PDF
  exact object-version byte source: the existing readObjectVersion({ objectVersionId }) ->
    { ok, data: { object_version_id, size_bytes, bytes } } storage-read seam already implemented
    by Backend/kai/storage/localDevStorageAdapter.js; tests inject synthetic bytes through that
    same shape and no new storage abstraction was created
  feature gate: isKaiSprint2Enabled(env) with the canonical buildKaiError("feature_disabled")
    disabled result, mirroring Backend/kai/services/kaiStorageService.js
  result envelopes: { ok: true, data, error: null } / { ok: false, data: null, error: { code,
    status } }, mirroring the P0-06B upload lifecycle adapter

boundary_discipline: TOOL_VERIFIED
  Backend/kai/parsing/postgresParserRunRepository.js is the only P1-03 module containing SQL or
  row locking. Backend/kai/parsing/parserProfileWorkerOrchestration.js contains no SQL, imports
  no pg pool and no kaiDb, references no kai.<table>, and requires both the parser-run
  repository and the object-version byte source to be injected, so it selects no repository and
  binds no production composition. Asserted by
  __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js.

required_behavior_evidence: TOOL_VERIFIED
  verified by `DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run
  verify:kai-sprint2-p1-03-parser-profile-worker` (runner-created ephemeral loopback
  PostgreSQL 16 target kai_p1_03_parser_profile_worker_synthetic) -> 12 pass, 0 fail, and by
  `node --test __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js` -> 8 pass,
  0 fail:
    organization-scoped idempotent queue/ensure: new identity creates exactly one queued run;
      identical queued and identical running work replay the same parser_run_id with no second
      row; identical completed work replays the stored metadata-only profile and canonical hash
      with zero byte reads and zero profiler calls
    concurrent queue: a deterministically raced second ensure against an uncommitted duplicate
      insert, and five parallel ensures for one identity, both resolve to exactly one
      authoritative run (one row, one non-replayed result) through ON CONFLICT ON CONSTRAINT
      intake_parser_runs_p1_identity_unique DO NOTHING plus re-read inside the same transaction
    claim locking: FOR UPDATE OF r SKIP LOCKED on parser_status = 'queued' refuses a second
      claim while another session holds the run row (409 conflict_current_state_changed), leaves
      an independent run claimable in the same window, transitions queued -> running, and
      refuses a repeat claim of a running run
    profilers: CSV, XLSX, Markdown, TXT, and machine-readable PDF all complete with
      status = "profiled", a linked output_profile_id, and a persisted canonical hash equal to
      encode(digest(profile::text, 'sha256'), 'hex') recomputed in the database
    non-profilable PDF: an image-only synthetic PDF records a safe failure with error_code
      pdf_no_extractable_text, retry_count 1, no profile row, and null output_profile_id
    atomic completion: profile + canonical hash + completed transition + output_profile_id link
      + file_profile_persisted and parser_run_recorded audit commit together; a rejected audit
      guard (422 validation_blocker) and a throwing audit publish (500 system_error) each roll
      back every domain write, leaving the run running, zero profile rows, and no new audit rows
    atomic safe failure: failed transition + exactly one retry_count increment + safe
      error_code/error_message_safe + parser_run_recorded audit commit together; a rejected or
      throwing failure audit rolls the transition back with retry_count unchanged
    explicit retry: retry_count increments exactly once per safe failure (1, 2, 3); retry runs
      while retry_count < 3; at retry_count = 3 no claim, no byte read, no profiler call, and no
      audit write occur and the derived requires_manual_review: true is returned; retry_count is
      never reset or decremented; information_schema confirms no requires_manual_review or
      manual_review_required column exists
    cancelled runs: never claimed (409) and never retried (422 state_transition_denied), with
      zero byte reads and no audit or state change
    tenant isolation: cross-tenant ensure, claim, get, complete, fail, and retry all return the
      same nondisclosing 404 not_found while the owning tenant's run is unchanged, and a second
      tenant's own file with the same checksum gets an independent run
    feature gate: with KAI_SPRINT2_ENABLED unset, "false", or "0" all three operations return
      the canonical feature_disabled result (403) with zero repository calls, zero byte reads,
      zero profiler calls, and zero audit prepares, and against the live database zero runs,
      zero profiles, and zero audit rows
    prohibited content and integration: audit metadata key sets are asserted equal to the
      key sets required by the existing migration CHECK, contain no checksum and no profile,
      every persisted profile and audit metadata row is asserted free of raw sentinels, URLs,
      /Users/ or /private/ paths, signed URLs, and raw byte/text markers, only the four
      authorized kai tables are referenced by the adapter, the kai schema table list is
      unchanged, kai.upload_policy_decision_replay stays empty, intake_files upload/policy/parse
      state is unchanged, no new migration file exists, and Backend/kai/index.js exports nothing
      from Backend/kai/parsing/

test_and_suite_results: TOOL_VERIFIED
  npm run verify:kai-sprint2-p1-03-parser-profile-worker -> 12 pass / 0 fail
  node --test __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js -> 8 pass / 0 fail
  affected profiler, byte-source, audit, repository, transaction, and P1-02 schema-contract
    regression specs (kai-sprint2-p1-local-profiling-kernel, kai-sprint2-p1-pdf-profiling-worker-boundary,
    kai-sprint2-storage-boundary, kai-sprint2-audit-contract, kai-sprint2-audit-queries,
    kai-sprint2-mutation-orchestration, kai-sprint2-p0-upload-lifecycle-repository,
    kai-sprint2-p0-repository-contract, kai-sprint2-p1-parser-run-file-profile-schema-contract,
    kai-sprint2-p1-03-parser-profile-worker-boundary) -> 163 pass / 0 fail
  npm run test:kai-sprint2 -> 1020 pass / 0 fail / 3 skipped (the three database-gated
    integration specs, which skip without their runner-owned target)
  npm test (complete repository suite) -> 1125 pass / 0 fail / 3 skipped (same three)
  npm run verify:kai-sprint2-api-contract -> 55 pass / 0 fail
  npm run verify:kai-sprint2-schema-contract -> 21 pass / 0 fail
  npm run verify:kai-sprint2-p1-parser-run-file-profile -> P1-02 ephemeral verification passed
  node scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js -> 5 pass / 0 fail
  npm run verify:kai-sprint2-gate-a-p0 -> Gate A ephemeral verification passed
  git diff --check -> clean (exit 0)
  DATABASE_URL was set to the non-listening loopback sentinel
    postgres://127.0.0.1:9/kai_sentinel before the first Node/npm command of this session and
    kept set for every later Node/npm command; every real PostgreSQL target was created,
    proved loopback/version/name, and destroyed by a runner
  no staged-diff verification script exists in package.json (searched every "verify:" script);
    NOT_CONFIRMED that any such script was run because none is defined
```

```text
changed_files:
  Backend/kai/parsing/postgresParserRunRepository.js (new)
  Backend/kai/parsing/parserProfileWorkerOrchestration.js (new)
  __tests__/kai-sprint2-p1-03-parser-profile-worker.integration.spec.js (new)
  __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js (new)
  scripts/kai-sprint2-p1-03-parser-profile-worker-runner.js (new)
  scripts/kai-sprint2-p1-03-parser-profile-worker-runbook.md (new)
  package.json (one added verify:kai-sprint2-p1-03-parser-profile-worker script only)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this evidence block)

migrations: none
  no schema change is authorized for this package; the existing P1-02 migration and rollback
  draft were read and reused unmodified.

files_considered_and_not_modified:
  migrations/kai_sprint2_p1_parser_run_and_file_profile.sql and .rollback.sql:
    reason: P1-03 builds only on the existing tables, constraints, audit operations, and audit
    metadata CHECK branches these files already install; no column, constraint, index, trigger,
    or audit vocabulary was needed.
  scripts/kai-sprint2-p1-parser-run-file-profile-verifier.sql, -failure-checks.sql,
  -smoke-seed.sql, -smoke-verifier.sql, -runbook.md:
    reason: they verify the P1-02 substrate itself, which is unchanged; P1-03 behavior is
    proved by adapter-level integration tests against that substrate rather than by additional
    SQL verifiers.
  scripts/kai-sprint2-p1-parser-run-and-file-profile-local-postgres.js and
  scripts/kai-sprint2-p0-postgres-upload-lifecycle-adapter-runner.js:
    reason: both are single-purpose, frozen package runners with hardcoded database names,
    migration lists, and spec lists; parameterizing either would have changed an existing
    verified package's contract, so the P1-03 runner reuses their proven loopback/version/name
    fail-closed pattern in a separate script and both existing runners were re-run unmodified
    and still pass.
  Backend/kai/db/kaiDb.js:
    reason: withTransaction(callback[, transactionProvider]) already provides exactly the
    callback-scoped transaction plus test-injection seam this package needs.
  Backend/kai/profiling/localProfilingKernel.js and
  Backend/kai/validators/pdfAssessorWorkerBoundary.js:
    reason: the existing deterministic profilers already return frozen, redacted,
    metadata-only envelopes with safe failure and not-profilable shapes; P1-03 only dispatches
    to them and maps their safe outcomes.
  Backend/kai/storage/localDevStorageAdapter.js, storageAdapter.js, objectStorageAdapter.js:
    reason: readObjectVersion already exposes the exact object-version byte-source shape; the
    orchestration consumes that shape through injection and no storage code needed changing.
  Backend/kai/upload/postgresUploadLifecycleRepository.js and
  inMemoryUploadLifecycleRepository.js:
    reason: read as the closest sibling for transaction, locking, audit-guard, error-shaping,
    and result-envelope conventions; P1-03 mirrors those conventions without editing the
    upload lifecycle package.
  Backend/kai/index.js:
    reason: this package must add no public barrel export or production composition, so the
    canonical barrel was deliberately left untouched.
  Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md:
    reason: read in full for audit, transaction, hashing, concurrency, and composition
    conventions; it is the single non-executable repository contract and this package
    introduced no new repository behavior requiring a contract amendment.
  00_KAI_CURRENT_STATE.md and every other Current State / Implementation Baseline document:
    reason: explicitly out of scope for this package.

open_items:
  parser_name values: the P1-02 smoke seed already fixes kai_local_profiling_kernel; this
  package additionally uses kai_pdf_profiling_worker_boundary for the machine-readable PDF
  profiler. parser_name has no controlled vocabulary in the installed schema (only the
  ^[a-z0-9_]+$ CHECK), so this is a new value inside an existing free-form column, not new
  audit or status vocabulary. If an owner later fixes a parser-name registry, that value is the
  one to review.
  This package remains dormant: nothing composes, mounts, schedules, or enables it, and no
  runtime behavior changed.
```

## P1-03 required-audit correction evidence - predicate hardening and awaited publish

```text
timestamp_local: 2026-08-04 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 886f368821baae4d8d9b64426497d31bdf975c72
package: KAI P1-03 required-audit correction - confirmation predicate and asynchronous publish
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 595998
  sha256: 481944b66e871e2c4fe421e4443c6b623025a2e2c6f17067c4baa26ada61c2d3
  preserved_copy: /private/tmp/KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.pre-p1-03-required-audit-correction.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's first 595998 bytes are byte-identical to this
    file's first 595998 bytes; this block is appended after that byte offset only, so the
    correction is additions-only

correction_scope:
  problem_1: the prior prepareRequiredAudit predicate used `prepared.ok !== true` as a truthy
    property read; a null/undefined-safe descriptor fallback of `null` would have made
    `Object.hasOwn(null, "value")` throw instead of raising the intended
    RequiredAuditRejectedError, and non-plain-object/array/inherited/getter-backed shapes were
    not excluded
  problem_2: `preparedAudit.publish()` was called without `await` at all four audited mutation
    call sites, so a rejected publish() promise became an unhandled rejection instead of
    rolling back the transaction like a synchronous publish throw

fix_1_predicate:
  file: Backend/kai/parsing/postgresParserRunRepository.js
  function: prepareRequiredAudit
  change: replaced the truthy `prepared.ok !== true` check with an own-property-descriptor
    read guarded by `prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)`,
    confirming only `okDescriptor !== undefined && Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true && typeof prepared.publish === "function"`; a getter-backed
    `ok` has no own `value` property so its getter is never invoked; functions and arrays are
    excluded before any property read is attempted, so `Object.hasOwn(null, ...)` can never be
    reached

fix_2_awaited_publish:
  file: Backend/kai/parsing/postgresParserRunRepository.js
  call_sites: claimQueuedParserRun; completeParserRunWithProfile; failParserRunSafely;
    requeueFailedParserRunForRetry
  change: each `preparedAudit.publish();` became `await preparedAudit.publish();` inside the
    same `runInTransaction` callback already wrapped by the existing try/catch, so a rejected
    publish() promise now throws inside the transaction and rolls back exactly like a
    synchronous publish throw, and `shapeParserRunError` maps the resulting rejection to
    `system_error` the same way it already mapped a synchronous throw

tests_added:
  __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js:
    status: TOOL_VERIFIED
    scope: one new focused test proving the predicate rejects null, undefined, true, a
      function with own ok/publish, an array with own ok/publish, an object inheriting
      ok/publish through its prototype, a getter-backed ok (proving the getter is never
      invoked), ok as a non-boolean truthy string, ok as 1, ok:false, and ok:true without a
      publish function; and proving acceptance of a plain object, an Object.create(null)
      object with own ok/publish, and a class instance with an own ok:true data property and
      a callable publish method
  __tests__/kai-sprint2-p1-03-parser-profile-worker.integration.spec.js:
    status: TOOL_VERIFIED
    scope: extended createAuditProbe with a publishRejects option that returns a rejecting
      promise from publish() instead of throwing synchronously; added publish_promise_rejection
      cases alongside the existing publish_sync_throw cases in the completion and
      safe-failure rollback tests; added two new transactional rollback tests, one for
      claimQueuedParserRun and one for requeueFailedParserRunForRetry, each proving that a
      rejected prepareMetadataOnlyAudit guard, a synchronous publish() throw, and a rejected
      publish() promise all roll back the domain state transition and leave the audit row
      count unchanged, followed by a successful claim/requeue proving the transaction commits
      normally once the audit dependency is well-formed

test_and_suite_results: TOOL_VERIFIED
  node --test __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js -> 9 pass / 0 fail
  npm run verify:kai-sprint2-p1-03-parser-profile-worker -> 14 pass / 0 fail (ephemeral
    PostgreSQL 16 loopback target; database and workdir created and destroyed by the runner)
  node --test __tests__/kai-sprint2-transaction-interface.spec.js
    __tests__/kai-sprint2-audit-contract.spec.js __tests__/kai-sprint2-pass2-audit-contract.spec.js
    -> 15 pass / 0 fail
  npm run verify:kai-sprint2-gate-a-p0 -> Gate A ephemeral verification passed
  npm run verify:kai-sprint2-p1-parser-run-file-profile -> P1-02 ephemeral verification passed
  npm run test:kai-sprint2 -> tests 828 (1024 assertions); pass 1021; fail 0; skipped 3
    (database-gated integration specs that skip without their runner-owned target)
  npm test (complete repository suite) -> tests 933 (1129 assertions); pass 1126; fail 0;
    skipped 3 (same three)
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0; nothing staged at time of check)

changed_files:
  Backend/kai/parsing/postgresParserRunRepository.js (modified - predicate and await only)
  __tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js (modified - added
    __parserRunRepositoryTestables import and one new predicate test)
  __tests__/kai-sprint2-p1-03-parser-profile-worker.integration.spec.js (modified - added
    publishRejects probe option and rollback coverage for four operations)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this additions-only
    correction evidence block)

new_export:
  Backend/kai/parsing/postgresParserRunRepository.js: added `__parserRunRepositoryTestables`
    (exposes `prepareRequiredAudit` and `RequiredAuditRejectedError`), following the existing
    `__parserProfileWorkerTestables` test-seam convention already used by
    Backend/kai/parsing/parserProfileWorkerOrchestration.js; adds no production export, route,
    listener, barrel export, or production composition

not_reopened:
  - no schema change, migration edit, route, listener, feature-flag, project-state document,
    or production composition was touched
  - no P1-03 behavior other than the required-audit confirmation predicate and the awaited
    publish() call sites was modified

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production composition,
    feature-flag changes, cloud/storage work, schema changes, Current State changes,
    Implementation Baseline changes, Gate A migration edits, deployment, production/shared
    database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## KAI P1-04: draft data-dictionary and data-quality foundation

```text
timestamp_local: 2026-08-04 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: c5c26a83c4479b083c2d21217fca527e9795662b
package: P1-04 - Draft data dictionary and data-quality foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 603331
  sha256: dfac23c7eda470147a997377826cd211825e268d6735afe9662398f0c817573b
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/322b5dca-99a4-4048-a8a1-2066db05a2d8/scratchpad/execplan-pre-p1-04.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's first 603331 bytes are byte-identical to
    this file's first 603331 bytes (the preserved copy is itself the unmodified pre-edit file,
    byte count and sha256 confirmed above); this block is appended strictly after that byte
    offset, so the correction is additions-only

scope:
  new tables: kai.data_dictionaries, kai.data_dictionary_fields, kai.data_dictionary_mappings,
    kai.data_quality_findings, created by migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql
  shared seam extension: one additive, backward-compatible UNIQUE constraint added to the existing
    kai.intake_file_profiles (intake_file_profiles_p1_04_lineage_unique on
    (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)), used only by the
    new P1-04 dictionary lineage FK; no existing P1-02 constraint, column, or table was dropped or
    altered
  audit extension: new operation data_dictionary_draft_persisted and its exact required metadata
    keys added to the existing kai.upload_lifecycle_audit operation/metadata CHECK constraints in
    this new migration file only; every earlier operation branch (reserve_upload, start_upload,
    complete_object_version, confirm_upload, block_upload, abandon_upload, expire_upload,
    policy_decision_compare_and_set, parser_run_recorded, file_profile_persisted) is reproduced
    verbatim, unchanged
  new repository: Backend/kai/dictionary/postgresDataDictionaryRepository.js - the only authorized
    location for this package's SQL and row locking; consumes only the tenant-scoped, already-
    committed kai.intake_file_profiles row (organization_id + file_profile_id lookup only);
    intake_file_id, profile, and profile_canonical_sha256 are always re-read from that row and
    cannot be supplied or overridden by the caller
  extended in place (not duplicated): Backend/kai/services/kaiDataDictionaryService.js -
    createDraftDataDictionary is no longer a stub; validates its allowlist, checks
    KAI_SPRINT2_ENABLED, and delegates persistence to the injected repository; contains no SQL and
    imports no database pool

identity_and_replay (owner decision verified by test):
  one dictionary bundle per organization_id + file_profile_id, enforced by
    data_dictionaries_p1_04_bundle_identity_unique
  same profile identity + same stored hash -> replay (integration test 2)
  same profile identity + different bound hash -> conflict_current_state_changed (DB-level FK
    proof via smoke-verifier lineage_hash_mismatch_rejected; repository-level mapping verified by
    boundary/integration coverage of shapeDictionaryError)
  different profile identity -> separate bundle, never a revision (integration test 3); no
    revision_number, predecessor_id, supersedes_id, or superseded_by_id column exists anywhere in
    the migration (schema-contract test)

exact_defaults_verified_by_check_constraint_not_default_alone:
  dictionary_status = 'draft'; review_status = 'needs_gk_review'; finding_status = 'open';
  sensitivity = 'unknown'; allowed_use = 'internal'; consent_status = 'unknown';
  consent_scope = 'none'; llm_use_allowed = false; public_use_allowed = false;
  funder_use_allowed = false; human_review_required = true; business_meaning and entity_level
  default 'unknown' and accept only an explicit safe committed profile value otherwise

deterministic_findings:
  deriveDictionaryFields/deriveQualityFindings (Backend/kai/dictionary/postgresDataDictionaryRepository.js)
  are pure functions over the committed profile only; findings limited to missingness,
  duplicate_rows, type_inconsistency, invalid_date, formula_like_content, safe_profiler_warning;
  absence of a fact produces no finding (boundary test + finding_type CHECK enum)

transaction_and_audit:
  draft/replay, all field/mapping/finding writes, and the required data_dictionary_draft_persisted
  audit row are one transaction; RequiredAuditRejectedError on prepare rejection and a rejected
  publish() promise each roll back every domain write (integration tests 6 and 7); publish() is
  awaited inside the transaction

audit_shape_verified:
  metadata keys exactly metadata_only, contract, file_profile_id, profile_canonical_sha256,
  dictionary_status, field_count, mapping_count, finding_count, validator_key - no extra keys, no
  profile content, label, sample, finding text, PII, path, URL, prompt, or credential (integration
  test 1 asserts the exact key set; smoke-verifier audit_metadata_exact_keys/audit_metadata_no_raw_profile)

audit_vocabulary_conflict_check: no conflict found
  operation data_dictionary_draft_persisted, contract p1_draft_data_dictionary_and_quality_v1, and
  validator_key VAL-KAI-P1-04-001 were checked against every existing accepted operation
  (reserve_upload, start_upload, complete_object_version, confirm_upload, block_upload,
  abandon_upload, expire_upload, policy_decision_compare_and_set, parser_run_recorded,
  file_profile_persisted), every existing contract string (p1_parser_run_and_file_profile_v1,
  in_memory_policy_replay_v1, unwired_synthetic_parser_profile_worker), and every existing
  validator key (VAL-KAI-P1-02-001, VAL-AUD-001) - no collision

feature_flag: every repository/service operation checks KAI_SPRINT2_ENABLED first; disabled returns
  the canonical feature_disabled result with zero profile reads, writes, locks, audit preparation,
  or publication (boundary test)

p1_02_p1_03_protection:
  no P1-02 or P1-03 migration, rollback, runner, verifier, failure-checks, smoke-seed,
  smoke-verifier, or runbook file was edited (all untouched per git status); the one shared-seam
  extension (intake_file_profiles_p1_04_lineage_unique) is additive and backward-compatible

runner: scripts/kai-sprint2-p1-04-data-dictionary-quality-runner.js - runner-owned synthetic
  database kai_p1_04_data_dictionary_quality_synthetic, loopback 127.0.0.1, runner-chosen port in
  59000-59999, listen_addresses '127.0.0.1' only, PostgreSQL 16 (proveRunnerOwnedTarget fails
  closed on any mismatch, matching the P1-02/P1-03 runner pattern); no shared, staging, cloud,
  deployed, production, or real-client-data database was created or used

tests_added_and_results: TOOL_VERIFIED
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js: 12 passed
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js: 10 passed
  __tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js (ephemeral PG 16): 8 passed
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality -> catalog verifier all PASS, read-only
    failure checks all PASS, smoke verifier 19/19 PASS, integration suite 8/8 passed
  npm run verify:kai-sprint2-p1-parser-run-file-profile (P1-02 runner, unmodified) -> passed
  npm run verify:kai-sprint2-p1-03-parser-profile-worker (P1-03 runner, unmodified) -> 14/14 passed
  npm run test:kai-sprint2 -> 1043 passed, 4 skipped, 0 failed
  npm test (complete repository suite) -> 1148 passed, 4 skipped, 0 failed
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

changed_files:
  migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql (added)
  migrations/kai_sprint2_p1_04_data_dictionary_and_quality.rollback.sql (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-verifier.sql (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-failure-checks.sql (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-verifier.sql (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-runner.js (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-runbook.md (added)
  scripts/kai-sprint2-p1-04-data-dictionary-quality-patch-notes.md (added)
  Backend/kai/dictionary/postgresDataDictionaryRepository.js (added)
  Backend/kai/services/kaiDataDictionaryService.js (modified - stub replaced with delegation to the
    injected P1-04 repository)
  package.json (modified - added verify:kai-sprint2-p1-04-data-dictionary-quality script)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js (added)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js (added)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js (added)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this evidence block)

new_export:
  Backend/kai/dictionary/postgresDataDictionaryRepository.js: __dataDictionaryRepositoryContract,
    __dataDictionaryRepositoryTestables (deriveDictionaryFields, deriveQualityFindings,
    deriveDataType, prepareRequiredAudit, RequiredAuditRejectedError) - test-seam exports only,
    following the existing __parserRunRepositoryTestables convention; adds no production export,
    route, listener, barrel export, or production composition

not_reopened:
  - no P1-02 or P1-03 migration, rollback, runner, verifier, smoke, or runbook artifact was edited
  - no route, listener, scheduler, timer, startup hook, public barrel export, production
    composition, application repository selection, feature-flag default, or cloud configuration
    was added
  - no sensitivity profile, review item, source candidate, promotion decision, source, source
    version, evidence, claim, or assistant tool was created
  - no denominator assessment, coverage-gap analysis, funder-requirement alignment, or
    client/operator follow-up generation was implemented
  - no revision number, predecessor link, or supersession link was created

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production composition,
    feature-flag changes, cloud/storage work, Current State changes, Implementation Baseline
    changes, Gate A migration edits, P1-02/P1-03 migration edits, deployment, production/shared
    database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-04 correction evidence - concurrent creation, fact derivation, mapping confidence, audit rollback

```text
timestamp_local: 2026-08-04 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 4dda523a7e145b7689a468cac48a7bec95aef0dd
package: KAI P1-04 correction - concurrent identical creation, no invented zero-valued facts,
  nullable range-checked mapping confidence, and required-audit rollback proof
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 614147
  sha256: c318c05e4e201561d4a3839a8e1b38962130c08a9c8732f51382cce48d0b9c57
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/6f5c056a-b7de-4479-ab34-d28c041d3dd9/scratchpad/execplan.pre-p1-04-correction.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's full 614147 bytes are byte-identical to this
    file's first 614147 bytes (cmp over the prefix, exit 0); this block is appended after that
    byte offset only, so the correction is additions-only and no earlier byte was altered

post_append_execplan:
  byte_count: 629799
  sha256: reported in the correction report; a file cannot contain its own post-append digest

repo_authoritative_facts_quoted:
  present_count_key: `present_count` - Backend/kai/profiling/localProfilingKernel.js:305 and :324
    (`present_count: column.present_count`), the committed profiler output contract for
    `kai.intake_file_profiles.profile.fields[]`
  missing_count_key: `missing_count` - Backend/kai/profiling/localProfilingKernel.js:304 and :323
    (`missing_count: column.missing_count`)
  mapping_confidence_key: DISCREPANCY_RESOLVED - no committed profiler output, contract module,
    verifier, or read model anywhere in the repository emits any confidence key; the only
    pre-existing occurrence of confidence in the P1-04 package was
    migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql:75
    (`mapping_confidence numeric(3,2) NOT NULL DEFAULT 1.00`). The repository-authoritative
    range is therefore the one the P1-04 migration itself already declared and which the
    numeric(3,2) column type can represent: the finite inclusive range [0, 1]. The repository
    now copies `entry.mapping_confidence` only when the committed profile states it as an
    explicit finite number inside that range; because no current profiler emits it, every
    field persisted today stores NULL, which is the honest fact rather than a fabricated 1.00

defect_1_concurrent_identical_creation:
  was_wrong: Backend/kai/dictionary/postgresDataDictionaryRepository.js (pre-correction line 448)
    `if (dictionaryInsert.rowCount !== 1) return dictionaryFailure("conflict_current_state_changed");`
    guarded a plain `INSERT ... RETURNING` with no ON CONFLICT clause; the preceding
    `lockExistingBundle` `FOR UPDATE` read cannot lock a row that does not exist yet, so two
    overlapping transactions for the same (organization_id, file_profile_id) both reached the
    INSERT and the loser raised a raw unique violation on
    data_dictionaries_p1_04_bundle_identity_unique, which `shapeDictionaryError` mapped to
    `conflict_current_state_changed` (SQLSTATE 23505) even though the bound profile hash was
    identical and the correct outcome was a successful replay
  fix: same file, the dictionary INSERT now carries
    `ON CONFLICT (organization_id, file_profile_id) DO NOTHING RETURNING ...`; when no row is
    returned the same transaction re-reads the committed authoritative row with the existing
    `lockExistingBundle` helper and either replays it (`replayed: true`) when
    `profile_canonical_sha256` matches the bound hash, returns
    `conflict_current_state_changed` when the stored hash differs, or returns `system_error`
    when the row is unexpectedly absent. All conflict handling is PostgreSQL-side and inside
    the existing repository transaction: no in-memory lock, mutex, in-flight map, or advisory
    lock was introduced
  proof: __tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js - new test
    "two genuinely overlapping transactions creating the same bundle resolve to exactly one
    authoritative bundle" injects a two-party gate into `runInTransaction` so both repository
    transactions have issued BEGIN before either does its conflicting work (not two sequential
    awaits), then asserts both calls ok, one shared data_dictionary_id, exactly one
    `replayed:false` and one `replayed:true`, exactly one published required audit across both
    probes, and post-race row counts of exactly [1 dictionary, 2 fields, 2 mappings,
    4 findings, 1 data_dictionary_draft_persisted audit row], plus an authoritative
    getDataDictionary read agreeing with those counts
  mutation_check: TOOL_VERIFIED - with the ON CONFLICT clause and conflict re-read temporarily
    reverted to the pre-correction code, the P1-04 runner reported 12 tests / 11 pass / 1 fail
    with exactly the new concurrency test failing; the fix was then restored and the runner
    returned to 12 pass / 0 fail

defect_2_no_invented_zero_valued_facts:
  was_wrong_1: same file, pre-correction line 145
    `return \`present_count=${presentCount ?? 0}, missing_count=${missingCount ?? 0}\`;`
    substituted 0 for whichever count the committed profile did not state, so a field with only
    a present count was recorded as having `missing_count=0` and vice versa
  was_wrong_2: same file, pre-correction line 186
    `const total = (Number.isFinite(entry.present_count) ? entry.present_count : 0) + entry.missing_count;`
    fabricated a denominator equal to the missing count alone when present_count was absent,
    and the finding text then asserted `N missing values out of N`
  fix: `deriveQualityNotesSafe` now builds the note from only the counts the profile states via
    a new `isCommittedCount` predicate and returns null when neither is stated;
    `deriveQualityFindings` emits `has N missing values out of <present+missing>` only when both
    counts are stated and `has N missing values` with no denominator when present_count is absent
  proof: __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js - two new focused
    tests cover all four required cases: both counts absent (no quality note, no missingness
    finding), present count only (note records only `present_count=7`, no missingness finding,
    no fabricated missing count), missing count only (note records only `missing_count=3`;
    finding is `field_1 has 3 missing values` and is asserted not to contain "out of"), and both
    counts present (note `present_count=7, missing_count=3`; finding computes the exact total 10)

defect_3_mapping_confidence:
  was_wrong: migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql pre-correction line 75
    `mapping_confidence numeric(3,2) NOT NULL DEFAULT 1.00,` asserted full certainty for every
    persisted field even though no committed profiler fact supports any confidence value, and
    the repository never wrote the column at all
  fix_migration: the column is now `mapping_confidence numeric(3,2),` - nullable, no DEFAULT -
    and `data_dictionary_fields_p1_04_mapping_confidence_check` is now
    `CHECK (mapping_confidence IS NULL OR (mapping_confidence >= 0 AND mapping_confidence <= 1))`,
    which also refuses numeric 'NaN' (NaN sorts above every number, so `<= 1` is false)
  fix_rollback: migrations/kai_sprint2_p1_04_data_dictionary_and_quality.rollback.sql documents
    that the nullable, defaultless, range-checked column is removed together with its own P1-04
    table; the rollback still alters no earlier-package column
  fix_repository: new `deriveMappingConfidence` copies `entry.mapping_confidence` only when it is
    an explicit finite JavaScript number inside the authoritative inclusive range
    [MAPPING_CONFIDENCE_MIN = 0, MAPPING_CONFIDENCE_MAX = 1]; absent, null, non-numeric,
    out-of-range, NaN, and +/-Infinity all persist as NULL, and the field INSERT now binds that
    value as `$10::numeric`. Nothing defaults to 1.00
  fix_service: none required - Backend/kai/services/kaiDataDictionaryService.js was not modified;
    all derivation and SQL remain in the repository module, so the service still contains no SQL
    and imports no pool
  proof: boundary spec - explicit valid values 0, 0.42, and 1 preserved exactly; absent/null/
    non-numeric stored as NULL; out-of-range -0.01, -1, 1.01, 2, 100 rejected to NULL (not
    clamped); NaN, +Infinity, -Infinity rejected to NULL; plus a migration-text test asserting
    the column is nullable, carries no DEFAULT, and has the range CHECK. Schema-contract spec
    adds the same three assertions independently. Integration spec proves mapping_confidence
    persists as NULL for a profile that states no confidence, that an explicit in-range 0.25 is
    stored as 0.25 while an out-of-range 1.5 in the same profile is stored as NULL, and that
    direct writes of 1.5, -0.01, and 'NaN' are refused by the CHECK constraint (SQLSTATE 23514)
    while 'Infinity' is refused earlier by the numeric(3,2) cast (SQLSTATE 22003)
  live_catalog_check: TOOL_VERIFIED on an ephemeral PostgreSQL 16 loopback database -
    information_schema reports mapping_confidence is_nullable=YES, column_default=<none>,
    numeric precision 3 scale 2, and pg_get_constraintdef returns
    `CHECK (((mapping_confidence IS NULL) OR ((mapping_confidence >= (0)::numeric) AND (mapping_confidence <= (1)::numeric))))`;
    the P1-04 rollback then dropped all four P1-04 tables (0 remaining) and the migration
    re-applied cleanly

defect_4_required_audit_rollback_proof:
  was_wrong: the pre-correction integration test
    "a rejected publish() promise rolls back every domain write in the same transaction"
    wrapped the call in `assert.rejects(... .then((result) => { if (!result.ok) throw new Error(...) }))`,
    so the assertion was satisfied by a test-thrown error rather than by the repository's own
    returned result; it never asserted `ok:false`, never asserted the error code, checked only
    kai.data_dictionaries for zero rows, and there was no synchronous-publish-throw case at all
  fix: that wrapper test was replaced by two table-driven integration cases - one synchronous
    `publish()` throw and one rejected `publish()` promise - each asserting directly on the
    returned result object that `ok === false`, `data === null`, `error.code === "system_error"`,
    and that the probe published nothing, then asserting zero rows in kai.data_dictionaries,
    kai.data_dictionary_fields, kai.data_dictionary_mappings, kai.data_quality_findings, and
    zero kai.upload_lifecycle_audit rows with operation = 'data_dictionary_draft_persisted'
  preserved: the own-boolean-data-property `prepareRequiredAudit` predicate (own-property
    descriptor read plus `Object.hasOwn(okDescriptor, "value") && okDescriptor.value === true`
    and a callable publish) is unchanged, `await preparedAudit.publish()` remains awaited inside
    the same transaction, and the pre-existing rejected-prepare test still proves
    `validation_blocker` with the same four-table zero-row rollback

tests_added_or_changed:
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js: five new focused tests
    (PostgreSQL conflict handling with no in-process lock; quality-note count fidelity;
    missingness denominator fidelity; mapping-confidence derivation; migration mapping_confidence
    nullability/default/range)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js: one new test
    asserting mapping_confidence is nullable, carries no fabricated default, and is range-checked
  __tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js: replaced the wrapped
    publish-rejection test with two direct-result rollback cases; added the overlapping-transaction
    concurrency test and two mapping-confidence persistence tests

test_and_suite_results: TOOL_VERIFIED
  node --test __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js
    __tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js
    -> tests 28; pass 28; fail 0
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality -> tests 12; pass 12; fail 0
    (ephemeral PostgreSQL 16 loopback target created and destroyed by the runner; catalog
    verifier and read-only failure checks all PASS)
  npm run verify:kai-sprint2-p1-03-parser-profile-worker -> tests 14; pass 14; fail 0
  npm run verify:kai-sprint2-p1-parser-run-file-profile -> P1-02 ephemeral verification passed
  npm run verify:kai-sprint2-gate-a-p0 -> Gate A ephemeral verification passed
  npm run test:kai-sprint2 -> tests 1053; pass 1049; fail 0; skipped 4
  npm test (complete repository suite) -> tests 1158; pass 1154; fail 0; skipped 4
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

changed_files:
  migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql (modified - mapping_confidence
    nullability/default/CHECK only)
  migrations/kai_sprint2_p1_04_data_dictionary_and_quality.rollback.sql (modified - explanatory
    comment only)
  Backend/kai/dictionary/postgresDataDictionaryRepository.js (modified - ON CONFLICT conflict
    handling and authoritative re-read, count-fidelity derivation, mapping-confidence derivation
    and INSERT binding, two new test-seam exports)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-boundary.spec.js (modified - five tests)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality-schema-contract.spec.js (modified - one test)
  __tests__/kai-sprint2-p1-04-data-dictionary-quality.integration.spec.js (modified - concurrency,
    confidence, and required-audit rollback coverage)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this additions-only correction
    evidence block)

not_reopened:
  - no P1-02, P1-03, or Gate A migration, rollback, repository, runner, verifier, smoke, or
    runbook artifact was modified (verified by git show --stat on the correction commit and by
    an empty git diff over those paths)
  - Backend/kai/services/kaiDataDictionaryService.js was not modified; the service still holds no
    SQL and imports no pool, and all SQL and conflict handling stay in the repository module
  - no sensitivity profile, review item, source candidate, promotion decision, source, source
    version, evidence, claim, assistant tool, route, listener, poller, scheduler, startup
    wiring, public export, production composition, feature-flag default, or cloud config was
    added
  - no denominator assessment, coverage-gap analysis, or inference beyond explicit committed
    profile facts was introduced; absence remains absence
  - tenant scoping, profile-hash binding, dictionary identity/replay semantics, the
    draft/needs_gk_review/open statuses, fail-closed unknown defaults, the audit vocabulary and
    metadata shape, and feature-disabled zero-side-effect behavior are unchanged

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production composition,
    feature-flag changes, cloud/storage work, Current State changes, Implementation Baseline
    changes, Gate A migration edits, P1-02/P1-03 migration edits, deployment, production/shared
    database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-05 evidence - intake sensitivity and allowed-use profile foundation

```text
timestamp_local: 2026-08-04 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: f4b74fff6a4b51b75a0c1dba1cc7f94a7ae92f47
package: KAI P1-05 - intake sensitivity and allowed-use profile foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 629799
  sha256: af5f79e24fe84909dfbaf05e263d7bdd7e9a2568cb487f60a1f47a32a31a322c
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/70ab29f8-42df-4f06-800d-cceeb3fb5730/scratchpad/execplan.pre-p1-05.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's full 629799 bytes are byte-identical to
    this file's first 629799 bytes (cmp over the prefix, exit 0); this block is appended
    after that byte offset only, so this package's evidence is additions-only and no
    earlier byte was altered

scope_decision:
  new_table: kai.intake_sensitivity_profiles - one authoritative row per organization_id +
    file_profile_id + data_dictionary_id, bound by composite foreign key to the exact
    stored kai.intake_file_profiles lineage (file_profile_id, organization_id,
    intake_file_id, profile_canonical_sha256 via intake_file_profiles_p1_04_lineage_unique)
    and the exact stored kai.data_dictionaries lineage (data_dictionary_id,
    organization_id, intake_file_id, file_profile_id via data_dictionaries_p1_04_lineage_unique).
    Neither existing composite unique constraint was altered - both are only referenced.
  dimensions: PII, minor data, health/housing/justice/immigration data, Indigenous/OCAP-like
    governance-sensitive data, staff notes, story/testimonial content, small-cell risk,
    consent basis, allowed use, and financial records are each their own CHECK-enforced
    text column with an unknown/present/absent (or unknown/allowed/not_allowed for
    allowed_use) enum. Indigenous governance and financial records are never merged into
    the generic pii_status column (proven by CHECK_EXISTS/DISTINCT_* verifier rows and by
    a dedicated boundary test). review_status/review_requirements are never persisted - the
    only committed fact about review is the fail-closed human_review_required boolean,
    pinned true by the same CHECK (x = fixed_value) idiom P1-04 already used for its own
    per-field booleans.
  pinned_restrictions: llm_processing_allowed, product_learning_allowed, public_use_allowed,
    and funder_use_allowed are each their own boolean column, CHECK-pinned to false;
    human_review_required is CHECK-pinned to true; retention_posture is a single
    CHECK-pinned labeled restriction ('restricted_pending_review') - never a retention
    execution, deletion, storage-lifecycle change, or job activation.
  fact_source: deriveSensitivityFacts (Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js)
    is a pure function reading only an optional profile.sensitivity_committed_facts object
    already present on the repository-loaded, committed kai.intake_file_profiles.profile
    jsonb; any dimension absent, malformed, or outside its accepted enum defaults to
    'unknown'. There is no inference from file content, filenames, or field names. The
    internal fact-source key for the PII dimension is named `personal_data`, not `pii`:
    the committed profile jsonb column is itself governed by the existing, frozen
    kai.gate_a_p0_jsonb_metadata_only() content filter, which refuses any jsonb value
    containing the literal substring "pii" anywhere in its text (discovered via a live
    23514 failure on kai.intake_file_profiles during integration testing and resolved by
    renaming only the internal fact-source key; the persisted SQL column is still named
    pii_status, since that plain-text column is never checked by that jsonb-only filter).
    Because no current committed profile producer states any sensitivity_committed_facts,
    every dimension loads as 'unknown' today - the correct, expected behavior for this
    foundation/schema/repository/service scaffold package.
  identity_and_replay: one row per organization_id + file_profile_id + data_dictionary_id
    (intake_sensitivity_profiles_p1_05_identity_unique). Same identity + same bound
    profile hash: replay, no duplicate audit. Concurrent identical creation is resolved by
    `ON CONFLICT (organization_id, file_profile_id, data_dictionary_id) DO NOTHING
    RETURNING ...` plus an authoritative re-read in the same transaction - no in-memory
    lock, mutex, in-flight map, or advisory lock. The "different bound hash" conflict
    branch is retained defensively (shapeSensitivityError conflict_current_state_changed)
    but is structurally unreachable through the real schema, exactly like P1-04's own
    analogous branch: kai.intake_file_profiles.file_profile_id is its primary key and
    profile_canonical_sha256 is bound only at insert time, so it is exercised directly
    against the repository's transaction control flow with a fake transaction context in
    the boundary spec rather than via real mutated Postgres state.
  audit: operation intake_sensitivity_profile_persisted, contract
    p1_intake_sensitivity_and_allowed_use_v1, validator_key VAL-KAI-P1-05-001, added
    additively to upload_lifecycle_audit_gate_a_operation_check /
    upload_lifecycle_audit_gate_a_metadata_object_check inside the new P1-05 migration
    file only (the Gate A/P1-02/P1-03/P1-04 migration files were never edited - the
    constraints are recreated in full by DROP CONSTRAINT IF EXISTS/ADD CONSTRAINT inside
    this migration, exactly like P1-04 did for Gate A's constraints). Metadata carries
    exactly metadata_only, contract, file_profile_id, data_dictionary_id,
    profile_canonical_sha256, human_review_required, validator_key - no profile content,
    label, sample, PII, path, URL, prompt, or credential. Rejection of the required audit
    prepare, a synchronous publish() throw, or a rejected publish() promise rolls back the
    sensitivity-profile write and the audit write together in the same transaction; the
    own-boolean-data-property prepareRequiredAudit predicate (own-property descriptor
    read, Object.hasOwn(okDescriptor, "value") && okDescriptor.value === true, callable
    publish) is copied unchanged from postgresDataDictionaryRepository.js.
  feature_flag: every repository/service operation checks KAI_SPRINT2_ENABLED first;
    disabled returns the canonical feature_disabled result with zero profile reads,
    dictionary reads, writes, locks, audit preparation, or publication (boundary test).
  p1_02_p1_03_p1_04_protection: no P1-02, P1-03, P1-04, or Gate A migration, rollback,
    runner, verifier, failure-checks, smoke-seed, smoke-verifier, repository, service, or
    test file was edited - confirmed empty by `git diff --stat` over those exact paths
    and by `git diff --cached --stat` limited to the P1-04/P1-02 migration and spec
    files; the two referenced composite unique constraints
    (intake_file_profiles_p1_04_lineage_unique, data_dictionaries_p1_04_lineage_unique)
    are referenced only, never altered.
  runner: scripts/kai-sprint2-p1-05-intake-sensitivity-profile-local-postgres.js -
    runner-owned synthetic database kai_p1_05_intake_sensitivity_profile_synthetic,
    loopback 127.0.0.1, runner-chosen port in 59000-59999, listen_addresses '127.0.0.1'
    only, PostgreSQL 16 (proveRunnerOwnedTarget fails closed on any mismatch, matching
    the P1-02/P1-03/P1-04 runner pattern); no shared, staging, cloud, deployed,
    production, or real-client-data database was created or used.

tests_added_and_results: TOOL_VERIFIED
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js: 11 passed
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-boundary.spec.js: 15 passed
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile.integration.spec.js (ephemeral PG 16): 13 passed
  npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile -> catalog verifier all PASS,
    read-only failure checks all PASS (9/9), smoke verifier 19/19 PASS, integration suite
    13/13 passed
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality (P1-04 runner, unmodified) ->
    tests 12; pass 12; fail 0
  npm run verify:kai-sprint2-p1-03-parser-profile-worker (P1-03 runner, unmodified) ->
    tests 14; pass 14; fail 0
  npm run verify:kai-sprint2-p1-parser-run-file-profile (P1-02 runner, unmodified) -> passed
  node --test __tests__/kai-sprint2-transaction-interface.spec.js
    __tests__/kai-sprint2-audit-contract.spec.js __tests__/kai-sprint2-audit-queries.spec.js
    -> tests 17; pass 17; fail 0
  npm run test:kai-sprint2 -> tests 1080; pass 1075; fail 0; skipped 5
  npm test (complete repository suite) -> tests 1185; pass 1180; fail 0; skipped 5
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

changed_files:
  migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql (added)
  migrations/kai_sprint2_p1_05_intake_sensitivity_profile.rollback.sql (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-verifier.sql (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-failure-checks.sql (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-verifier.sql (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-local-postgres.js (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runbook.md (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-patch-notes.md (added)
  Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js (added)
  Backend/kai/services/kaiIntakeSensitivityProfileService.js (added)
  package.json (modified - added verify:kai-sprint2-p1-05-intake-sensitivity-profile script,
    one new line only)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js (added)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-boundary.spec.js (added)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile.integration.spec.js (added)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this evidence block)

new_export:
  Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js:
    __intakeSensitivityProfileRepositoryContract, __intakeSensitivityProfileRepositoryTestables
    (prepareRequiredAudit, RequiredAuditRejectedError, deriveSensitivityFacts) - test-seam
    exports only, following the existing __dataDictionaryRepositoryTestables convention;
    adds no production export, route, listener, barrel export, or production composition

not_reopened:
  - no P1-02, P1-03, P1-04, or Gate A migration, rollback, runner, verifier, smoke, or
    runbook artifact was edited
  - no route, listener, scheduler, timer, startup hook, public barrel export, production
    composition, application repository selection, feature-flag default, or cloud
    configuration was added
  - no review queue item, source candidate, promotion decision, source, source version,
    evidence, claim, or assistant tool was created
  - no retention execution, deletion, storage-lifecycle change, job activation, approval,
    or external-release authority was implemented anywhere
  - no new approval state, audience/permission concept, review-completion semantics, or
    retention-execution semantics was invented beyond exactly what this package's brief
    required

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production
    composition, feature-flag changes, cloud/storage work, Current State changes,
    Implementation Baseline changes, Gate A/P1-02/P1-03/P1-04 migration edits, deployment,
    production/shared database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## KAI P1-05 Correction — Classification-Source and Verification-Integrity (appended, additions-only)

This block is appended at the literal EOF of the prior P1-05 evidence block above, which is
preserved unchanged, including its internal `tests_added_and_results: 1080/1075/5` and
`npm test: 1185/1180/5` counts. Those counts were produced against a P1-05 package that (a)
recognized an invented `profile.sensitivity_committed_facts` / `personal_data` classification
producer contract that no authorized profiler, validator, review service, or producer actually
emits, (b) had a runner that never checked verifier/failure-check/smoke-verifier output for a
real `FAIL` status, (c) had two catalog `CHECK_EXISTS` blocks that used `WHERE EXISTS` to filter
their `unnest(...)` check-name arrays, so a missing constraint silently dropped its check row
instead of reporting `FAIL`, and (d) had a `transaction_and_audit_atomicity` smoke probe that
forced a duplicate-key error on the already-seeded org1/profile1/dictionary1 identity, so the
required audit insert inside that probe was never actually reached. The results below supersede
the prior block's inconsistent count for P1-05 closure purposes.

corrections_applied:
  classification_producer_contract_removed:
    - removed the `profile.sensitivity_committed_facts` / `personal_data` classification-producer
      contract and the `deriveSensitivityFacts` function entirely from
      Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js
    - the repository no longer selects `profile` from kai.intake_file_profiles at all; it loads
      only organization_id, intake_file_id, file_profile_id, profile_canonical_sha256
    - every P1-05 classification status column (pii_status, minor_data_status,
      health_housing_justice_immigration_status, indigenous_governance_status,
      staff_notes_status, story_testimonial_status, small_cell_risk_status,
      financial_records_status, consent_basis_status, allowed_use_status) now persists as
      'unknown' purely via the table's own DEFAULT 'unknown', with no computed value threaded
      through the INSERT
    - all six pinned restrictions (llm_processing_allowed, product_learning_allowed,
      public_use_allowed, funder_use_allowed, human_review_required, retention_posture) remain
      unchanged and fail-closed via their existing DEFAULT + CHECK constraints
    - migration comments, the repository module/PRESENT_ABSENT_DIMENSIONS doc comments, the
      runbook, and the patch notes were corrected to state that no currently authorized producer
      emits a classification/consent/sensitivity/permission fact and that profile JSON is never
      read for classification
    - added/updated tests (boundary, integration) proving: profile JSON is not read for
      classification; sensitivity_committed_facts is ignored; personal_data is ignored;
      arbitrary classification-like JSON anywhere in the profile is ignored; every status remains
      unknown; every pinned restriction remains fail-closed
  runner_fail_status_enforcement:
    - added scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runner-assertions.js exporting
      assertNoFail, copying the established P1-02 assertNoFail repository pattern
      (kai-sprint2-p1-parser-run-and-file-profile-local-postgres.js)
    - scripts/kai-sprint2-p1-05-intake-sensitivity-profile-local-postgres.js now calls
      assertNoFail on the captured catalog-verifier, failure-checks, and smoke-verifier output
      and throws/exits nonzero on a real FAIL status cell
    - added __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-runner-self-test.spec.js: a
      deterministic self-test proving a real pipe-delimited FAIL status throws, PASS-only output
      succeeds, and a check name containing FAIL_CLOSED does not trip it
  catalog_check_totality:
    - both CHECK_EXISTS unnest blocks in the verifier now embed CASE WHEN EXISTS ... THEN 'PASS'
      ELSE 'FAIL' END directly in the SELECT list, with no outer WHERE EXISTS filtering the
      unnest(...) results, so every named check always emits exactly one row
    - added an AUDIT_METADATA_BRANCH check (previously absent) proving the metadata
      object-check constraint enforces the P1-05 intake_sensitivity_profile_persisted branch
    - making the runner honest surfaced a genuine pre-existing defect: three CHECK constraint
      names exceeded PostgreSQL's 63-byte identifier limit and were silently truncated at
      creation, so the verifier's exact-name lookups never matched them:
        intake_sensitivity_profiles_p1_05_financial_records_status_check (64 bytes) ->
          intake_sensitivity_profiles_p1_05_fin_records_status_check (58 bytes)
        intake_sensitivity_profiles_p1_05_indigenous_governance_status_check (68 bytes) ->
          intake_sensitivity_profiles_p1_05_indig_gov_status_check (56 bytes)
        intake_sensitivity_profiles_p1_05_story_testimonial_status_check (64 bytes) ->
          intake_sensitivity_profiles_p1_05_story_testimonial_check (57 bytes)
      renamed consistently in the migration, the verifier's check-name arrays, and the
      schema-contract spec; the underlying columns and their 'unknown'/'present'/'absent'
      semantics are unchanged
    - added focused schema tests proving: every expected check name appears exactly once
      (integration, against the runner-owned database); a missing constraint produces FAIL for
      that exact check rather than a missing row (integration, via a transaction that drops a
      CHECK constraint, runs the verifier, and rolls back); the verifier source contains no
      remaining WHERE-EXISTS-filtered unnest block (schema-contract, static)
  smoke_atomicity_proof_corrected:
    - replaced the transaction_and_audit_atomicity probe in
      scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-verifier.sql: it previously
      forced a duplicate-key error on the already-seeded org1/profile1/dictionary1 identity, so
      the required audit insert was never reached before the exception
    - the corrected probe captures exact pre-block counts of kai.intake_sensitivity_profiles and
      of kai.upload_lifecycle_audit rows with operation = intake_sensitivity_profile_persisted,
      then inside one exception-controlled block inserts a new, valid sensitivity profile for the
      still-unseeded org1/profile2/dictionary2 lineage, confirms that insert was reached, inserts
      its intake_sensitivity_profile_persisted audit row, confirms that insert was reached, and
      raises a synthetic forced exception
    - the check is only named PASS when both inserts were reached AND both post-exception counts
      exactly equal their pre-block values
    - the repository integration tests for rejected audit preparation, synchronous publish
      throw, and rejected publish promise were left unchanged (no direct correction was needed)

exact_final_focused_and_integration_tap_summaries: TOOL_VERIFIED
  node --test __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js \
    __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-boundary.spec.js \
    __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-runner-self-test.spec.js
    -> # tests 32 / # pass 32 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0
  npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile (ephemeral PG 16 runner)
    -> catalog verifier: 25 rows, all PASS
    -> read-only failure checks: 9 rows, all PASS
    -> smoke verifier: 19 rows, all PASS (including transaction_and_audit_atomicity: PASS)
    -> integration suite (__tests__/kai-sprint2-p1-05-intake-sensitivity-profile.integration.spec.js):
       # tests 15 / # pass 15 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0

exact_final_sprint2_tap_summary: TOOL_VERIFIED
  npm run test:kai-sprint2 -> # tests 1086 / # pass 1081 / # fail 0 / # cancelled 0 / # skipped 5 / # todo 0

exact_final_repository_tap_summary: TOOL_VERIFIED
  npm test -> # tests 1191 / # pass 1186 / # fail 0 / # cancelled 0 / # skipped 5 / # todo 0

regression_confirmations: TOOL_VERIFIED
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality (unmodified) -> tests 12; pass 12; fail 0
  npm run verify:kai-sprint2-p1-03-parser-profile-worker (unmodified) -> tests 14; pass 14; fail 0
  npm run verify:kai-sprint2-p1-parser-run-file-profile (unmodified) -> passed
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

pre_post_byte_and_hash_proof: TOOL_VERIFIED
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
    pre-append byte count:  641938
    pre-append SHA-256:     80ec5bc8cb350a8a7ed4c01ea2d41df629be37342708181f1c5796870031b4a7
    pre-append line count:  8011
    byte-exact prefix proof: `head -c 641938` of the file after this block was appended hashes
      to the identical pre-append SHA-256 above (verified before this correction's commit).
    the exact post-append byte count and SHA-256, computed against this file's final committed
    state, are reported in this same correction's commit-verification output below, since a file
    cannot embed the hash of its own final write while still being written.

changed_files_this_correction:
  Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js (modified)
  migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql (modified - comments and three
    constraint-name shortenings only; no column, default, or semantic change)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-verifier.sql (modified)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-verifier.sql (modified)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-local-postgres.js (modified)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runner-assertions.js (added)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runbook.md (modified)
  scripts/kai-sprint2-p1-05-intake-sensitivity-profile-patch-notes.md (modified)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-boundary.spec.js (modified)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-schema-contract.spec.js (modified)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile.integration.spec.js (modified)
  __tests__/kai-sprint2-p1-05-intake-sensitivity-profile-runner-self-test.spec.js (added)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this correction block)

scope_protection_confirmed:
  - no P1-02, P1-03, P1-04, or Gate A migration, rollback, runner, verifier, smoke, repository,
    service, or test file was edited
  - no route, listener, scheduler, timer, startup hook, public barrel export, production
    composition, feature-flag default, or cloud configuration was added or changed
  - no review queue item, source candidate, promotion decision, source, source version,
    evidence, claim, or classification/review producer was created
  - no 00_KAI_CURRENT_STATE.md or KAI_CURRENT_IMPLEMENTATION_BASELINE.md file was touched
  - no real-client-data access

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

correction_commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-06 evidence - review-queue durable table and sensitivity-review item foundation

```text
timestamp_local: 2026-08-04 18:31 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: e25e1ede69123459a92c9c176f193807bb8b7700
package: KAI P1-06 - review-queue durable table and sensitivity-review item foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 653206
  sha256: 4fbd926c84698a66e8c4d0e57cc97c5235cd92634390067a76a80c182fee12b0
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/28aad465-b1f9-4c43-9392-0ae0c35d0f69/scratchpad/execplan.pre-p1-06.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's full 653206 bytes are byte-identical to
    this file's first 653206 bytes (cmp over the prefix, exit 0); this block is appended
    after that byte offset only, so this package's evidence is additions-only and no
    earlier byte was altered

owner_scope_correction:
  Repository preflight for this package surfaced that `kai.review_queue_items` was already
  a live, production-wired table with an existing route-wired `createReviewQueueItem`
  service (Backend/kai/db/kaiIntakeQueries.js, Backend/kai/services/kaiReviewQueueService.js,
  scripts/kai-sprint2-ddl-vocabulary-status-check.sql already code against and assert this
  table's canonical column list and `sensitivity_review`/`open` vocabulary), even though no
  tracked migration had ever created it. The owner was presented with this discrepancy and
  three implementation options before any file was written; the owner's explicit ruling was
  to create the canonical table (full existing column set) in a tracked P1-06 migration and
  wire the narrow sensitivity_review creation path through the existing
  kaiReviewQueueService/insertReviewQueueItem seams - not a bootstrap-only substitute and not
  a second, differently-named table. This package implements that ruling.

scope_decision:
  new_table: kai.review_queue_items - the first tracked migration to create this canonical,
    already-production-referenced table, using the exact column list, defaults, and
    vocabularies already assumed by Backend/kai/db/kaiIntakeQueries.js,
    Backend/kai/services/kaiReviewQueueService.js, and
    scripts/kai-sprint2-ddl-vocabulary-status-check.sql (review_queue_item_id,
    organization_id, engagement_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, review_status, blocked_reason, assigned_to, due_at, summary,
    required_action, queue_metadata, created_by, created_by_type, created_at, updated_at).
    P1-06 itself only ever writes queue_type='sensitivity_review',
    queue_status='open', priority='normal' rows; the wider vocabulary exists because the
    table is shared with the pre-existing generic queue abstraction, not because P1-06 uses
    it.
  idempotency_identity: a partial unique index (organization_id, queue_type,
    target_object_type, target_object_id) scoped to `WHERE queue_type = 'sensitivity_review'`
    - not a table-wide constraint - so other queue_types' legitimate multi-row-per-target
    behavior (e.g. a re-opened intake_file_review item after an earlier one resolved) is
    left unmodified (proven by a dedicated failure-check and integration test).
  target_lineage: no polymorphic or table-wide foreign key was added on the shared
    target_object_id column, since it is already used by ~10 other queue_types pointing at
    different target tables. Instead, Backend/kai/dictionary/postgresReviewQueueRepository.js
    authoritatively verifies, inside the same transaction as the insert, that the referenced
    kai.intake_sensitivity_profiles row exists and is tenant-matched before writing a
    sensitivity_review item against it (proven deliberate, not a gap, by the
    fabricated_target_no_db_level_fk_by_design failure-check).
  creation_trigger_predicate (VAL-FUP-001-P0): a sensitivity_review item may only be created
    for a committed, tenant-scoped kai.intake_sensitivity_profiles row where
    human_review_required = true, public_use_allowed = false, funder_use_allowed = false,
    llm_processing_allowed = false, product_learning_allowed = false, and
    retention_posture = 'restricted_pending_review'. This predicate establishes only a
    review obligation - never consent, approval, classification completion, external
    eligibility, or promotion eligibility.
  service_seam: Backend/kai/services/kaiReviewQueueService.js gains one new, narrow,
    additive export - createSensitivityReviewQueueItem(input, dependencies) - accepting only
    { organizationId, intakeSensitivityProfileId, actorContext, now } (unknown keys
    rejected). It runs the feature gate, AUTH-KAI-003 human-actor authorization
    (gk_admin/gk_operator/gk_reviewer only; ai/system/import/code/any generic-service actor
    is rejected outright, no bypass), VAL-TEN-001 active-membership validation (no
    tenant-membership bypass), then delegates persistence to the injected P1-06 repository.
    The existing createReviewQueueItem and updateReviewQueueStatus exports, their route
    wiring, and every other queue_type's behavior are unmodified.
  repository_seam: Backend/kai/dictionary/postgresReviewQueueRepository.js is the only
    authorized location for P1-06 SQL/locking. It reuses the existing insertReviewQueueItem
    query (Backend/kai/db/kaiIntakeQueries.js, unmodified) and one new, additive,
    narrowly-scoped query - getScopedSensitivityReviewQueueItemByIdentity - added to that
    same file for the authoritative FOR UPDATE identity lookup. The caller cannot supply or
    override lineage, queue type, target type, target ID, queue status, priority, summary,
    required action, assignment, due date, classification, consent, allowed use, audience
    eligibility, review result, or approval: every one of these is a server-pinned constant
    or re-read from the authoritative committed sensitivity-profile row.
  identity_and_replay: one authoritative row per organization_id + sensitivity_review +
    intake_sensitivity_profile + intake_sensitivity_profile_id. Identical creation replays
    the existing row with no duplicate write or duplicate audit. Concurrent identical
    creation is resolved by the partial unique index's 23505 plus an authoritative re-read
    in the same transaction - no in-memory lock, mutex, in-flight map, or advisory lock. A
    changed-immutable-identity conflict is surfaced as conflict_current_state_changed.
  audit: operation sensitivity_review_queue_item_created, contract
    p1_sensitivity_review_queue_item_v1, validator_key VAL-KAI-P1-06-001, added additively to
    upload_lifecycle_audit_gate_a_operation_check / upload_lifecycle_audit_gate_a_metadata_object_check
    inside the new P1-06 migration file only (the Gate A/P1-02/P1-03/P1-04/P1-05 migration
    files were never edited - the constraints are recreated in full by
    DROP CONSTRAINT IF EXISTS/ADD CONSTRAINT inside this migration, exactly like P1-04 and
    P1-05 did). Metadata carries exactly the six allowlisted keys - contract, queue_type,
    target_object_type, target_object_id, queue_status, validator_key - deliberately
    omitting the metadata_only bookkeeping key P1-05 used, per this package's explicit,
    repeated allowlist. No profile JSON, classification, label, sample, PII, path, URL,
    prompt, or credential is ever included. Rejection of the required audit prepare, a
    synchronous publish() throw, or a rejected publish() promise rolls back the
    review-queue-item insert and the audit insert together in the same transaction; the
    own-boolean-data-property prepareRequiredAudit predicate (own-property descriptor read,
    Object.hasOwn(okDescriptor, "value") && okDescriptor.value === true, callable publish)
    is copied unchanged from the P1-04/P1-05 pattern.
  status_boundary: only null -> open is implemented. No status transition, resolution,
    approval, rejection, escalation, cancellation, reopening, or promotion logic was added;
    updateReviewQueueStatus is untouched.
  feature_flag: createSensitivityReviewQueueItem checks KAI_SPRINT2_ENABLED first; disabled
    returns the canonical feature_disabled result with zero reads, writes, locks, audit
    preparation, or publication (boundary test).
  p1_02_p1_03_p1_04_p1_05_gate_a_protection: no P1-02, P1-03, P1-04, P1-05, or Gate A
    migration, rollback, runner, verifier, failure-checks, smoke-seed, smoke-verifier,
    repository, service, or test file was edited - confirmed empty by `git diff --stat`
    filtered to every one of those exact path patterns.
  runner: scripts/kai-sprint2-p1-06-review-queue-local-postgres.js - runner-owned synthetic
    database kai_p1_06_review_queue_synthetic, loopback 127.0.0.1, runner-chosen ephemeral
    port, listen_addresses '127.0.0.1' only, PostgreSQL 16 required and verified via
    server_version_num (fails closed outside the 160000-169999 range); no shared, staging,
    cloud, deployed, production, or real-client-data database was created or used.

tests_added_and_results: TOOL_VERIFIED
  node --test __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-runner-self-test.spec.js
    __tests__/kai-sprint2-p1-06-review-queue.integration.spec.js
    -> tests 30; pass 29; fail 0; cancelled 0; skipped 1 (integration spec skips without a
       runner-owned database, by design); todo 0
  npm run verify:kai-sprint2-p1-06-review-queue (ephemeral PostgreSQL 16) -> catalog verifier
    37/37 PASS, read-only failure checks 10/10 PASS, smoke verifier 11/11 PASS, integration
    suite (node --test against the ephemeral database) 11/11 passed
  npm run verify:kai-sprint2-gate-a-p0 (unmodified) -> passed
  npm run verify:kai-sprint2-p1-parser-run-file-profile (P1-02 runner, unmodified) -> passed
  npm run verify:kai-sprint2-p1-03-parser-profile-worker (P1-03 runner, unmodified) ->
    tests 14; pass 14; fail 0; skipped 0
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality (P1-04 runner, unmodified) ->
    tests 12; pass 12; fail 0; skipped 0
  npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile (P1-05 runner, unmodified) ->
    tests 15; pass 15; fail 0; skipped 0
  npm run test:kai-sprint2 -> tests 1116; pass 1110; fail 0; cancelled 0; skipped 6; todo 0
  npm test (complete repository suite) -> tests 1221; pass 1215; fail 0; cancelled 0;
    skipped 6; todo 0
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

changed_files:
  migrations/kai_sprint2_p1_06_review_queue.sql (added)
  migrations/kai_sprint2_p1_06_review_queue.rollback.sql (added)
  scripts/kai-sprint2-p1-06-review-queue-verifier.sql (added)
  scripts/kai-sprint2-p1-06-review-queue-failure-checks.sql (added)
  scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql (added)
  scripts/kai-sprint2-p1-06-review-queue-smoke-verifier.sql (added)
  scripts/kai-sprint2-p1-06-review-queue-local-postgres.js (added)
  scripts/kai-sprint2-p1-06-review-queue-runner-assertions.js (added)
  scripts/kai-sprint2-p1-06-review-queue-runbook.md (added)
  scripts/kai-sprint2-p1-06-review-queue-patch-notes.md (added)
  Backend/kai/dictionary/postgresReviewQueueRepository.js (added)
  Backend/kai/db/kaiIntakeQueries.js (modified - one new additive query,
    getScopedSensitivityReviewQueueItemByIdentity; insertReviewQueueItem and every other
    existing export unchanged)
  Backend/kai/services/kaiReviewQueueService.js (modified - one new additive export,
    createSensitivityReviewQueueItem; createReviewQueueItem and updateReviewQueueStatus
    unchanged)
  package.json (modified - added verify:kai-sprint2-p1-06-review-queue script, one new
    line only)
  __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js (added)
  __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js (added)
  __tests__/kai-sprint2-p1-06-review-queue.integration.spec.js (added)
  __tests__/kai-sprint2-p1-06-review-queue-runner-self-test.spec.js (added)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this evidence block)

new_export:
  Backend/kai/services/kaiReviewQueueService.js: createSensitivityReviewQueueItem - the
    single new production export this package adds; not composed into any route, listener,
    scheduler, or startup wiring.
  Backend/kai/db/kaiIntakeQueries.js: getScopedSensitivityReviewQueueItemByIdentity - a
    narrow, tenant-scoped, FOR UPDATE lookup used only by the P1-06 repository.
  Backend/kai/dictionary/postgresReviewQueueRepository.js:
    createPostgresReviewQueueRepository, __reviewQueueRepositoryContract,
    __reviewQueueRepositoryTestables (prepareRequiredAudit, RequiredAuditRejectedError,
    satisfiesCreationTriggerPredicate) - the repository factory plus test-seam exports only,
    following the existing __dataDictionaryRepositoryTestables /
    __intakeSensitivityProfileRepositoryTestables convention.

not_reopened:
  - no P1-02, P1-03, P1-04, P1-05, or Gate A migration, rollback, runner, verifier, smoke,
    or runbook artifact was edited
  - no route, listener, scheduler, timer, startup hook, public barrel export, production
    composition, application repository selection, feature-flag default, or cloud
    configuration was added
  - no review-queue-item resolution, approval, rejection, escalation, or promotion was
    implemented
  - no source candidate, promotion decision, source, source version, evidence, claim, or
    downstream-eligibility change was created
  - no retention execution, deletion, storage-lifecycle change, job activation, approval, or
    external-release authority was implemented anywhere
  - no new approval state, audience/permission concept, review-completion semantics, or
    retention-execution semantics was invented beyond exactly what this package's brief and
    the owner's scope ruling required

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production composition,
    feature-flag changes, cloud/storage work, Current State changes, Implementation
    Baseline changes, Gate A/P1-02/P1-03/P1-04/P1-05 migration edits, deployment,
    production/shared database access, or real client data access

commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-06 correction evidence - concurrency, audit-contract, validator, and durable-row correction

```text
timestamp_local: 2026-08-05 08:34 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 050c32fa5b1b029fc3778e8dd2862f7973a1a7ca
package: KAI P1-06 correction - concurrency, audit-contract, validator, and durable-row correction
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 667834
  sha256: 28cd9cbfac415f38b89cf94f5052b4919378bb68279bff85e52e4d7e507231c1
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/ada01c1a-ca28-4d69-92a0-1fec68fc6d62/scratchpad/execplan.pre-p1-06-correction.md
  prefix_proof: TOOL_VERIFIED - the preserved copy's full 667834 bytes are byte-identical to
    this file's first 667834 bytes (cmp -l over the prefix, zero differing bytes, exit 0);
    this block is appended after that byte offset only, so this correction's evidence is
    additions-only and no earlier byte was altered.

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 050c32fa5b1b029fc3778e8dd2862f7973a1a7ca
  worktree: clean including untracked files (git status --porcelain=v2 --untracked-files=all
    empty; git diff --cached --stat empty) - matched the expected start exactly.

corrections_made:
  broken_23505_recovery_replaced:
    Removed the try/insert/catch("23505")/re-read-in-the-same-transaction path in
    Backend/kai/dictionary/postgresReviewQueueRepository.js (that pattern re-reads inside a
    transaction PostgreSQL has already aborted once a statement raises a unique-violation,
    so the re-read itself would fail). Added a new local
    insertSensitivityReviewQueueItemIfAbsent(tx, item) query directly in
    postgresReviewQueueRepository.js (not the shared Backend/kai/db/kaiIntakeQueries.js
    module - see shared_db_helper_placement_decision below) that issues
    `INSERT ... ON CONFLICT (organization_id, queue_type, target_object_type,
    target_object_id) WHERE queue_type = 'sensitivity_review' DO NOTHING RETURNING ...`
    against the existing partial unique index
    (ux_review_queue_items_p1_06_sensitivity_review_identity, unchanged). Behavior: a
    returned row is validated in full against every server-pinned field, then exactly one
    required audit is written and replayed:false is returned; zero returned rows triggers an
    authoritative re-read (getScopedSensitivityReviewQueueItemByIdentity, unchanged,
    FOR UPDATE), which is validated for tenant scope and immutable identity only, writes no
    audit, and returns replayed:true. No savepoint, advisory lock, mutex, semaphore, or
    in-process in-flight map is used anywhere in this path.
  shared_db_helper_placement_decision:
    The correction brief called for "the minimum P1-06 DB-helper/query seam" for the new
    INSERT. Placing it in the shared Backend/kai/db/kaiIntakeQueries.js module (as first
    attempted) was reverted after `npm test` surfaced that
    __tests__/kai-sprint2-file-idempotency-conflict.spec.js asserts, as an unrelated
    Gate-A/P1-02 batch-creation/file-reservation idempotency-contract invariant, that the
    ENTIRE text of kaiIntakeQueries.js never contains an ON CONFLICT/23505/unique_violation
    pattern (that file's own idempotency-conflict handling uses a different,
    sentinel-object-based signal by owner design). That test is outside this correction's
    authorized scope (not a P1-06 file) and was not modified. The new query was instead kept
    local to Backend/kai/dictionary/postgresReviewQueueRepository.js, which already contains
    several other raw P1-06 SQL statements directly (readScopedSensitivityProfile,
    readScopedUploadState, insertAudit) and is the explicitly-authorized "P1-06 repository"
    location. Backend/kai/db/kaiIntakeQueries.js is therefore untouched by this correction
    (confirmed by an empty `git diff` for that file) - only its pre-existing, unmodified
    getScopedSensitivityReviewQueueItemByIdentity export continues to be reused for the
    authoritative FOR UPDATE re-read.
  concurrency_barrier_added:
    Added a test-only `beforeInsert` dependency to
    createPostgresReviewQueueRepository({ runInTransaction, beforeInsert }) (default: a
    no-op async function; never overridden by production wiring - grepped confirmed no
    non-test call site passes it). It is awaited immediately before the
    ON-CONFLICT-DO-NOTHING insert call, after each transaction has already completed its own
    initial no-row observation. __tests__/kai-sprint2-p1-06-review-queue.integration.spec.js's
    existing two-genuinely-overlapping-transactions test was rewired from a
    before-the-whole-transaction gate to this `beforeInsert` seam (real PostgreSQL 16, two
    concurrent Node-side transactions via withTransaction against a shared pool), and
    verified TOOL_VERIFIED (see tests_added_and_results): both transactions independently
    complete their initial no-row observation, both reach the insert boundary and rendezvous
    there, one INSERT returns a row, the other's ON-CONFLICT path returns no row, both
    resolve to the same review_queue_item_id, exactly one kai.review_queue_items row and
    exactly one kai.upload_lifecycle_audit row exist afterward, and neither call fails.
  required_action_constraint_added:
    Added CONSTRAINT review_queue_items_p1_06_sensrev_required_action_check (this exact,
    shorter name, not the 65-byte name literally suggested by the correction brief, because
    PostgreSQL silently truncates identifiers over its 63-byte limit, which would have
    desynchronized the migration's actual constraint name from every script/test that
    references it by name) CHECK (queue_type <> 'sensitivity_review' OR (required_action IS
    NOT NULL AND length(btrim(required_action)) BETWEEN 1 AND 2000)) to
    migrations/kai_sprint2_p1_06_review_queue.sql. The shared required_action column itself
    remains nullable/optional for every other queue_type (review_queue_items_p1_06_
    required_action_check, unchanged). Three raw-SQL sensitivity_review inserts in
    scripts/kai-sprint2-p1-06-review-queue-failure-checks.sql that previously omitted
    required_action (all testing unrelated constraints: unique-identity enforcement x2, the
    documented no-DB-level-FK proof) were updated to supply a required_action value so they
    continue to exercise only their intended constraint; three new failure checks were added
    (required required_action rejected when null, rejected when whitespace-only, and proof
    that an unrelated queue_type's required_action remains optional).
  owner_authorized_audit_contract_restored:
    operation sensitivity_review_queue_item_created, contract
    p1_sensitivity_review_queue_item_v1 (unchanged), validator_key changed from the
    previous, P1-06-locally-invented VAL-KAI-P1-06-001 to the owner-authorized
    VAL-FUP-001-P0. metadata_only: true added as a new required key. The metadata object now
    contains exactly seven keys - metadata_only, contract, queue_type, target_object_type,
    target_object_id, queue_status, validator_key - no others. Updated: the metadata builder
    (buildSensitivityReviewAuditMetadata, postgresReviewQueueRepository.js), the audit CHECK
    constraint's sensitivity_review_queue_item_created branch (migrations/kai_sprint2_p1_06_
    review_queue.sql - now requires metadata ? 'metadata_only' and includes it in the
    seven-key ARRAY subtraction), the catalog verifier's AUDIT_METADATA_BRANCH LIKE check
    (now also asserts '%metadata_only%'), the smoke seed/verifier's two literal
    jsonb_build_object metadata fixtures and its audit_metadata_exact_keys check (now
    seven-key), the schema-contract spec (rewritten from asserting "no metadata_only key,
    six keys" to asserting "seven keys, including metadata_only"), the integration spec's
    metadata-key assertion, the boundary spec's key-count assertion, the patch notes, and the
    runbook. rollback_restoration: migrations/kai_sprint2_p1_06_review_queue.rollback.sql
    needed no change - it already deletes every sensitivity_review_queue_item_created audit
    row and drops the operation from the CHECK vocabulary entirely (never adding a branch for
    it), which already correctly restores the exact prior (pre-P1-06) audit constraints;
    confirmed unchanged by an empty `git diff` for that file.
  required_validation_boundary_preserved:
    Added validateReplayedReviewQueueRow(row, profileRow) (validates only organization_id,
    queue_type, target_object_type, target_object_id, and a safe non-empty-string record
    shape; returns conflict_current_state_changed for a tenant or immutable-identity
    mismatch, system_error for a missing/malformed row) and applied it uniformly to both the
    pre-insert existing-row replay path and the post-ON-CONFLICT re-read replay path. Added
    isValidInsertedReviewQueueRecord(record, profileRow) (validates organization_id,
    queue_type, target_object_type, target_object_id, priority, queue_status, assigned_to,
    due_at, summary, required_action against every server-pinned expectation) applied to a
    newly inserted row before its audit is prepared; a failed check throws
    MalformedInsertedRowError, which is mapped to system_error, never reaches audit
    preparation/publication, and rolls back the transaction (the throw itself is what forces
    the ROLLBACK in Backend/kai/db/kaiDb.js's withTransaction). Neither validation path
    treats an authorized later workflow's change to queue_status, priority, assigned_to,
    due_at, summary, or required_action as a conflict.
  validator_group_duplication_removed:
    Backend/kai/services/kaiReviewQueueService.js's createSensitivityReviewQueueItem no
    longer reimplements organization-membership/role checking via a local
    hasActiveAuthorizedMembership helper (removed). It now calls the existing shared
    validateActorCanPerformOperation (Backend/kai/auth/kaiAuthorizationService.js, already
    used by this same file's pre-existing createReviewQueueItem/updateReviewQueueStatus, and
    by every other KAI Sprint 2 mutation) with a new, additive-only operation key
    "create_sensitivity_review_queue_item" and an explicit allowedRoles override
    (gk_admin/gk_operator/gk_reviewer, preserving the exact previously-established role set)
    scoped to this call only, and validateTenantBoundaryConsistency
    (Backend/kai/validators/tenantValidators.js, VAL-TEN-001, already used throughout
    kaiIntakeService.js) with the requested organizationId as both the expected and payload
    organization id. Both calls' structured blockers are preserved on the returned error via
    buildKaiError(code, { blockers }). No shared validator-registry file
    (Backend/kai/config/kaiSprint2P0Contract.js, Backend/kai/validators/
    assistantBoundaryValidators.js, Backend/kai/validators/operationValidatorGroups.js) was
    modified - confirmed by an empty `git diff` for each. The strict AUTH-KAI-003 mapped-
    human-actor gate (actorContext.actorType === "human" with a non-empty actorUserId) is
    kept as a local, explicit pre-condition, because it is strictly narrower than the shared
    assistant-boundary validator's recognized non-human actor-type allowlist (which does not
    itself reject "import"/"code"/other generic-service actor-type labels) and is not a
    reimplementation of any existing shared primitive - there is no pre-existing shared
    function that performs this exact check. External result codes for every existing
    boundary-test scenario (authorization_denied for a non-human actor, tenant_boundary_
    violation for every membership/role failure scenario, ok:true for
    gk_admin/gk_operator/gk_reviewer with active membership) are unchanged.

tests_added_and_results: TOOL_VERIFIED
  node --test __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-runner-self-test.spec.js
    __tests__/kai-sprint2-p1-06-review-queue.integration.spec.js
    -> tests 32; pass 31; fail 0; cancelled 0; skipped 1 (integration spec skips without a
       runner-owned database, by design); todo 0
  npm run verify:kai-sprint2-p1-06-review-queue (ephemeral PostgreSQL 16) -> catalog verifier
    38/38 PASS (one new CHECK_EXISTS row for review_queue_items_p1_06_sensrev_required_
    action_check), read-only failure checks all PASS (14 checks, 3 new), smoke verifier
    11/11 PASS, integration suite (node --test against the ephemeral database, real
    PostgreSQL 16, two genuinely concurrent transactions) 11/11 passed
  npm run verify:kai-sprint2-gate-a-p0 (unmodified) -> Gate A ephemeral PostgreSQL
    verification passed
  npm run verify:kai-sprint2-p1-parser-run-file-profile (P1-02 runner, unmodified) -> P1-02
    ephemeral PostgreSQL verification passed
  npm run verify:kai-sprint2-p1-03-parser-profile-worker (P1-03 runner, unmodified) ->
    tests 14; pass 14; fail 0; skipped 0
  npm run verify:kai-sprint2-p1-04-data-dictionary-quality (P1-04 runner, unmodified) ->
    tests 12; pass 12; fail 0; skipped 0
  npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile (P1-05 runner, unmodified) ->
    tests 15; pass 15; fail 0; skipped 0
  npm run test:kai-sprint2 -> tests 1118; pass 1112; fail 0; cancelled 0; skipped 6; todo 0
  npm test (complete repository suite) -> tests 1223; pass 1217; fail 0; cancelled 0;
    skipped 6; todo 0
  git diff --check -> clean (exit 0)
  git diff --cached --check -> clean (exit 0)

changed_files:
  Backend/kai/dictionary/postgresReviewQueueRepository.js (modified - conflict handling,
    audit contract, validation boundary; see corrections_made)
  Backend/kai/services/kaiReviewQueueService.js (modified - validator-group delegation; see
    corrections_made)
  migrations/kai_sprint2_p1_06_review_queue.sql (modified - new required_action CHECK, new
    metadata_only audit-metadata key; local P1-06 migration corrected in place, not applied
    to any shared or durable environment)
  scripts/kai-sprint2-p1-06-review-queue-verifier.sql (modified - new CHECK_EXISTS row,
    AUDIT_METADATA_BRANCH LIKE addition)
  scripts/kai-sprint2-p1-06-review-queue-failure-checks.sql (modified - 3 fixed inserts, 3
    new checks)
  scripts/kai-sprint2-p1-06-review-queue-smoke-verifier.sql (modified - validator_key and
    metadata_only key corrections)
  scripts/kai-sprint2-p1-06-review-queue-patch-notes.md (modified)
  scripts/kai-sprint2-p1-06-review-queue-runbook.md (modified)
  __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js (modified)
  __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js (modified)
  __tests__/kai-sprint2-p1-06-review-queue.integration.spec.js (modified)
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md (this correction-evidence
    block, additions-only)

not_changed:
  Backend/kai/db/kaiIntakeQueries.js (empty git diff - reverted to its pre-correction state
    after the shared_db_helper_placement_decision above; only its pre-existing
    getScopedSensitivityReviewQueueItemByIdentity export continues to be reused)
  Backend/kai/config/kaiSprint2P0Contract.js, Backend/kai/validators/
    assistantBoundaryValidators.js, Backend/kai/validators/operationValidatorGroups.js,
    Backend/kai/validators/tenantValidators.js, Backend/kai/auth/kaiAuthorizationService.js
    (all empty git diff - reused as pre-existing shared mechanisms, not modified)
  scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql,
  scripts/kai-sprint2-p1-06-review-queue-local-postgres.js,
  scripts/kai-sprint2-p1-06-review-queue-runner-assertions.js,
  __tests__/kai-sprint2-p1-06-review-queue-runner-self-test.spec.js (empty git diff)
  migrations/kai_sprint2_p1_06_review_queue.rollback.sql (empty git diff - already correct;
    see rollback_restoration above)
  no P1-02, P1-03, P1-04, P1-05, or Gate A migration, rollback, runner, verifier, smoke,
    repository, service, or runbook artifact was touched
  no route, listener, scheduler, timer, startup hook, public barrel export, production
    composition, application repository selection, feature-flag default, or cloud
    configuration was added or changed
  no new review transition, resolution, approval, rejection, source-candidate creation, or
    promotion behavior was added
  no UNIQUE (organization_id, review_queue_item_id) constraint was added
  no mutable-field replay comparison was added (replay validates identity/tenant only, per
    required_validation_boundary_preserved above)
  no 00_KAI_CURRENT_STATE.md or KAI_CURRENT_IMPLEMENTATION_BASELINE.md file was touched
  no real-client-data access

not_confirmed:
  production_repository_selection: NOT_CONFIRMED
  production_database_execution: NOT_CONFIRMED
  deployment: NOT_CONFIRMED

prohibited_actions_not_performed:
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite, route wiring,
    service wiring, barrel wiring, production repository selection, production composition,
    feature-flag changes, cloud/storage work, Current State changes, Implementation
    Baseline changes, Gate A/P1-02/P1-03/P1-04/P1-05 migration edits, deployment,
    production/shared database access, or real client data access
  - did not begin P1-07, propose another package, or continue past this bounded correction

correction_commit_hash: report after commit; a commit cannot contain its own SHA
```

## P1-07 evidence - intake source-candidate durable object and review foundation

```text
timestamp_local: 2026-08-05 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 8f21bae5bd821a374eee7139f04630d07fd6eb9a
package: KAI P1-07 - intake source-candidate durable object and review foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 685324
  sha256: a2e75d70c38af3ec8ff275f84a3a9fb654e434ecdbe5e69aacb94ea908e652ec
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/9640ec97-7f75-44f2-b735-9d159551b25d/scratchpad/KAI_Sprint2_P0_ExecPlan_pre_p1_07.md
  prefix_proof: cmp -l against the preserved copy over the first 685324 bytes of the
    live file reports no differing bytes; this block is appended strictly after that
    offset

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 8f21bae5bd821a374eee7139f04630d07fd6eb9a
  worktree: clean including untracked files (verified via `git status --porcelain`
    before any change)

p1_07_made:
  - migrations/kai_sprint2_p1_07_intake_source_candidate.sql (new forward migration):
    creates kai.intake_source_candidates (intake_source_candidate_id, organization_id,
    intake_file_id, file_profile_id, data_dictionary_id, intake_sensitivity_profile_id,
    profile_canonical_sha256, proposed_source_type [pinned 'unknown'], candidate_status
    [pinned 'needs_gk_review'], created_by, created_by_type, created_at), tenant-safe
    composite lineage foreign keys chaining file -> profile -> dictionary ->
    sensitivity profile, a new intake_sensitivity_profiles_p1_07_candidate_lineage_unique
    constraint added to the existing kai.intake_sensitivity_profiles table (needed to
    express the composite sensitivity-lineage FK; P1-05's own migration file is not
    edited), the P1-07 identity-unique constraint
    (organization_id, intake_sensitivity_profile_id), a partial unique index scoping
    the source_candidate_review idempotency identity on the existing
    kai.review_queue_items table (P1-06's migration file is not edited), and the new
    intake_source_candidate_persisted audit operation/metadata branch on
    kai.upload_lifecycle_audit (additive only; every earlier branch preserved verbatim).
  - migrations/kai_sprint2_p1_07_intake_source_candidate.rollback.sql (new rollback
    draft): restores the exact prior audit constraints, drops the P1-07 table/indexes,
    the P1-07-only review-queue partial unique index, and the P1-07-only
    sensitivity-profile lineage-unique constraint. Alters no earlier package's table
    beyond that restoration.
  - Backend/kai/dictionary/postgresSourceCandidateRepository.js (new file): the only
    authorized location for P1-07 SQL/row-locking. createSourceCandidateStub reads the
    tenant-scoped P1-05 sensitivity-profile lineage, applies the VAL-KAI-P1-07-001
    fail-closed creation-trigger predicate (identical in substance to P1-06's
    VAL-FUP-001-P0, re-checked against the same row), does authoritative existing-row
    lookups (candidate, then review item) before ever inserting either, uses
    INSERT ... ON CONFLICT ... DO NOTHING RETURNING for both the candidate and the
    review-item inserts, and writes the required metadata-only
    intake_source_candidate_persisted audit row inside the same transaction as both
    inserts on first creation only (own-boolean-data-property audit predicate, copied
    from P1-05/P1-06's prepareRequiredAudit). No catch-23505, in-memory lock, mutex,
    in-flight map, or advisory lock is used anywhere.
  - Backend/kai/services/kaiSourceCandidateService.js (new file): createSourceCandidateStub
    validates its input allowlist (organizationId, intakeSensitivityProfileId,
    actorContext, now only), checks KAI_SPRINT2_ENABLED first, enforces AUTH-KAI-003
    (mapped human actor only) and delegates tenant-membership/role authorization to the
    existing shared validateActorCanPerformOperation/validateTenantBoundaryConsistency
    mechanisms. Contains no SQL, imports no database pool, and is not composed into any
    route, listener, scheduler, or production path.
  - Backend/kai/db/kaiIntakeQueries.js (additive only): added
    getScopedSourceCandidateReviewQueueItemByIdentity, a narrow, tenant-scoped,
    FOR UPDATE lookup scoped to queue_type = 'source_candidate_review' /
    target_object_type = 'intake_source_candidate' only. Every existing exported
    function's signature and behavior is unchanged (confirmed by `git diff` showing a
    pure addition).
  - package.json (additive only): added the
    verify:kai-sprint2-p1-07-source-candidate script.
  - scripts/kai-sprint2-p1-07-source-candidate-verifier.sql, -failure-checks.sql,
    -smoke-seed.sql, -smoke-verifier.sql, -runner-assertions.js, -local-postgres.js,
    -runbook.md, -patch-notes.md (all new files).
  - __tests__/kai-sprint2-p1-07-source-candidate-schema-contract.spec.js,
    -boundary.spec.js, .integration.spec.js, -runner-self-test.spec.js (all new files).

selected_idempotency_identity_and_basis:
  - Candidate identity: organization_id + intake_sensitivity_profile_id. Basis: P1-05's
    own (organization_id, file_profile_id, data_dictionary_id) uniqueness already
    establishes a 1:1 relationship to one intake_sensitivity_profile_id; no currently
    authorized producer contract emits a finer-grained candidate-source classification
    that would justify a narrower identity. This is a P1-07 implementation decision,
    documented in the migration comments, the schema-contract test, the patch notes,
    and this evidence block - not claimed to be mandated by any governing source.
  - Review-item identity: organization_id + queue_type ('source_candidate_review') +
    target_object_type ('intake_source_candidate') + target_object_id (the candidate
    id), enforced by a partial unique index, mirroring the accepted P1-06 precedent
    exactly.

selected_audit_vocabulary_and_p1_07_decision_disclosure:
  - Audit operation: intake_source_candidate_persisted. Audit contract:
    p1_intake_source_candidate_v1. Validator key: VAL-KAI-P1-07-001. All three are
    explicit P1-07 implementation decisions using the smallest convention-consistent
    naming already established by this repository (the same VAL-KAI-P1-0X-001 idiom
    P1-05 itself used for VAL-KAI-P1-05-001) - not quoted from, and not claimed to be
    mandated by, any owner-authorized governing source. This is disclosed in the
    repository file's own code comment, the patch notes, the runbook, and here.

commands: TOOL_VERIFIED
  - node --test __tests__/kai-sprint2-p1-07-source-candidate-schema-contract.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate-runner-self-test.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate-boundary.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate.integration.spec.js
    (DATABASE_URL set to a non-listening loopback sentinel; integration spec
    self-skips without a runner-owned database)
  - npm run verify:kai-sprint2-p1-07-source-candidate
  - npm run verify:kai-sprint2-gate-a-p0
  - npm run verify:kai-sprint2-p1-parser-run-file-profile
  - npm run verify:kai-sprint2-p1-03-parser-profile-worker
  - npm run verify:kai-sprint2-p1-04-data-dictionary-quality
  - npm run verify:kai-sprint2-p1-05-intake-sensitivity-profile
  - npm run verify:kai-sprint2-p1-06-review-queue
  - npm test (full repository suite: __tests__/*.spec.js)
  - git diff --check
  - git diff --cached --check

test_results: TOOL_VERIFIED
  - P1-07 focused specs: 35 pass, 0 fail, 1 skipped (integration spec self-skip
    without KAI_P1_07_SOURCE_CANDIDATE_DATABASE_URL)
  - P1-07 ephemeral PostgreSQL 16 verifier: catalog verifier 35/35 PASS, read-only
    failure checks 10/10 PASS, smoke verifier 14/14 PASS, integration suite 11/11 pass
  - Gate A P0 verifier: pass
  - P1-02 (parser-run/file-profile) verifier: pass
  - P1-03 (parser/profile worker) verifier: 14/14 pass
  - P1-04 (data-dictionary/quality) verifier: 12/12 pass
  - P1-05 (intake-sensitivity-profile) verifier: 15/15 pass
  - P1-06 (review-queue) verifier: 11/11 pass (no regression from the P1-07 additions
    to the shared kai.review_queue_items table or kai.upload_lifecycle_audit)
  - Full repository suite (`npm test`): 1259 tests, 1252 pass, 0 fail, 7 skipped
    (unchanged skip set: DB-gated integration specs without a runner-owned database)

postgresql_verification_results: TOOL_VERIFIED
  - Ephemeral PostgreSQL 16, loopback-only (127.0.0.1, runner-chosen port),
    runner-owned-target proof passed (database name, address, port,
    listen_addresses, PostgreSQL 16.x version).
  - Catalog verifier proved: table/column/CHECK/FK/unique-index existence; the new
    sensitivity-profile candidate-lineage unique constraint; no raw-content column;
    proposed_source_type and candidate_status pinning; the reused
    source_candidate_review queue_type vocabulary; the new audit
    operation/metadata branch alongside every earlier operation preserved; no
    table-wide FK on the shared target_object_id column; and the absence of
    kai.sources/kai.source_versions/kai.intake_promotion_decisions.
  - Read-only failure checks (self-seeding their own fixture chain, since this
    script runs before any smoke seed) proved: proposed_source_type/candidate_status/
    created_by_type vocabulary rejection, checksum-shape rejection, composite-FK
    rejection of a fabricated sensitivity-profile id and of a mismatched checksum
    lineage, identity-unique enforcement, source_candidate_review identity-unique
    enforcement on the shared queue table, and that an unrelated queue_type is not
    deduplicated by the new partial index.
  - Smoke verifier proved: first-creation persistence of the candidate, review item,
    and audit row with pinned fields; replay returning the same candidate id;
    duplicate-identity rejection; concurrent-insert convergence to exactly one row;
    cross-tenant invisibility; composite-FK rejection of a fabricated sensitivity id;
    transaction+audit atomicity (forced-exception rollback of the review-item and
    audit inserts together); and the exact eleven-key audit-metadata allowlist with
    no raw content.
  - Integration suite (11 tests) proved, against the real schema: first creation with
    exact pinned fields and the exact eleven-key audit metadata; full replay with zero
    duplicate audit; not_found for an unknown profile id; cross-tenant not_found;
    required-audit-prepare rejection rollback; synchronous-publish-throw rollback;
    rejected-publish-promise rollback; two genuinely overlapping transactions (a
    test-only beforeInsert barrier, never present in production wiring) converging to
    exactly one candidate/review-item pair with exactly one audit row and one
    replayed:true/one replayed:false; an unrelated queue_type unaffected; the catalog
    verifier reporting zero FAIL rows with no duplicate check names; and an
    end-to-end pass through the service seam exercising KAI_SPRINT2_ENABLED,
    AUTH-KAI-003, and VAL-TEN-001 together.

diff_checks: TOOL_VERIFIED
  - git diff --check: clean (no whitespace errors)
  - git diff --cached --check: clean (nothing staged before the commit below)
  - git diff --stat (tracked-file changes only): Backend/kai/db/kaiIntakeQueries.js
    (+29 additive lines), package.json (+1 additive line) - both purely additive, no
    existing line altered or removed
  - full diff inspected: confirms no route, listener, scheduler, UI, startup
    composition, feature-flag default, Current State, or Implementation Baseline file
    was touched, and no P1-08, promotion, source, source_version, evidence, or claim
    identifier appears anywhere in the new or changed files

final_commit: report after commit; a commit cannot contain its own SHA

final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no route, listener, UI, scheduler, or startup-composition file was added or edited
  - no source, source_version, evidence, claim, promotion, approval, or eligibility
    logic was added
  - kai.intake_promotion_decisions, kai.sources, and kai.source_versions were not
    created (proved by the catalog verifier's NO_PROMOTION_OR_SOURCE_OBJECTS check)
  - no accepted P1-02, P1-03, P1-04, P1-05, or P1-06 migration file was edited (each
    remains byte-identical; only this package's own new migration adds the two
    additive constraints on kai.intake_sensitivity_profiles and kai.review_queue_items)
  - no feature-flag default was changed and KAI_SPRINT2_ENABLED continues to gate all
    new behavior with zero side effects when disabled
  - no fetch, push, merge, deploy, cloud/shared-infrastructure access, or real-client-
    data handling was performed
  - did not begin P1-08 or propose another package

user_confirmed_starting_assumptions:
  - the owner-supplied package boundary, schema/column/status naming direction, and
    audit-contract naming convention described in the originating prompt, none of
    which was independently re-derived from a quoted governing source during this
    turn beyond what fresh repository inspection above established

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
```

## P1-07 correction - removed the silent partial-replay repair path

```text
timestamp_local: 2026-08-05 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
package: KAI P1-07 correction - createSourceCandidateStub partial-replay repair-path
  removal
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 698727
  sha256: 32511369e6470f8290a1249560b19764e201bf37bd3f7b160649a23826cc0fa5
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/f283a90f-4bb5-4fe2-a9fc-62550eb3fe66/scratchpad/KAI_Sprint2_P0_ExecPlan_pre_p1_07_correction.md
  prefix_proof: this block is appended strictly after the preserved byte offset; no
    earlier byte of the live file is altered

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 3b3d74cec7239b9c29209cb2d4bf39be6deeeba9
  worktree: clean including untracked files (verified via `git status --porcelain`
    before any change), no staged paths

defect_corrected:
  Backend/kai/dictionary/postgresSourceCandidateRepository.js's
  createSourceCandidateStub allowed a silent partial-replay repair path: when a
  candidate row already existed but its corresponding source_candidate_review item
  did not, the repository inserted the missing review item, returned
  replayed: true, and wrote no audit for that write. A mutation occurred with no
  audit trail under the "replay" label.

correction_made:
  - Backend/kai/dictionary/postgresSourceCandidateRepository.js (only file with
    production-code changes): the review-item branch is now keyed on
    candidateIsFreshlyCreated instead of on whether a review item row already
    exists. A review-item insert is attempted only alongside a candidate this same
    call just created. When the candidate already existed, its review item is
    required to already exist and match; its absence now returns
    conflict_current_state_changed with zero mutation and zero audit activity, the
    same outcome already returned for any other lineage or immutable-identity
    mismatch. Full replay (both rows already exist and match) is unaffected: zero
    writes, zero audit activity, replayed: true. Initial creation of both rows
    together, concurrent identical creation via
    INSERT ... ON CONFLICT ... DO NOTHING RETURNING, and required-audit rollback are
    all structurally unchanged. Replay/conflict comparison remains scoped to
    immutable identity only (candidate: organization_id,
    intake_sensitivity_profile_id, intake_file_id, file_profile_id,
    data_dictionary_id, profile_canonical_sha256; review item: organization_id,
    queue_type, target_object_type, target_object_id) - no mutable review field
    (queue_status, priority, assignment, due_at, summary, required_action,
    review_status, blocked_reason) is compared, unchanged from before this
    correction.
  - __tests__/kai-sprint2-p1-07-source-candidate-boundary.spec.js: replaced the test
    that asserted the old silent-repair behavior with three tests proving (a)
    candidate-exists/review-missing returns conflict_current_state_changed with zero
    mutation and zero audit calls, (b) a mismatched review-item immutable identity
    also returns conflict_current_state_changed with zero mutation, and (c) full
    replay tolerates authorized mutable review-field changes (queue_status,
    priority, assignment, due_at, summary, required_action, review_status,
    blocked_reason) without breaking replay.
  - scripts/kai-sprint2-p1-07-source-candidate-runbook.md: updated the identity/
    replay paragraph to describe the corrected behavior; removed the description of
    the removed repair path.
  - scripts/kai-sprint2-p1-07-source-candidate-patch-notes.md: appended an
    additive "Correction" section describing the defect and the fix; no existing
    patch-notes text was removed.
  - VAL-KAI-P1-07-001 and every other accepted P1-07 contract element (identity
    keys, server-pinned fields, audit contract/operation/validator-key names, the
    eleven-key audit-metadata allowlist, AUTH-KAI-003, VAL-TEN-001) is unchanged.

commands: TOOL_VERIFIED
  - node --test __tests__/kai-sprint2-p1-07-source-candidate-schema-contract.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate-runner-self-test.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate-boundary.spec.js
    __tests__/kai-sprint2-p1-07-source-candidate.integration.spec.js
  - npm run verify:kai-sprint2-p1-07-source-candidate
  - node --test __tests__/kai-sprint2-intake-queries.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js
    __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js
  - node --test __tests__/kai-sprint2-*.spec.js
  - npm test
  - git diff --check
  - git diff --cached --check

test_results: TOOL_VERIFIED
  - P1-07 focused specs: 38 tests, 37 pass, 0 fail, 1 skipped (integration spec
    self-skip without KAI_P1_07_SOURCE_CANDIDATE_DATABASE_URL)
  - P1-07 ephemeral PostgreSQL 16 verifier
    (verify:kai-sprint2-p1-07-source-candidate): catalog verifier 35/35 PASS,
    read-only failure checks 10/10 PASS, smoke verifier 14/14 PASS, integration
    suite 11/11 pass (all pre-existing checks; none needed changes for this
    correction since the corrected path is a repository-internal branch not
    exercised by a distinct catalog/smoke check)
  - Affected shared tests (kai.review_queue_items /
    getScopedSourceCandidateReviewQueueItemByIdentity consumers): 29 tests, 29
    pass, 0 fail
  - Complete Sprint 2 suite (__tests__/kai-sprint2-*.spec.js): 1156 tests, 1149
    pass, 0 fail, 7 skipped (unchanged DB-gated skip set)
  - Complete repository suite (npm test): 1261 tests, 1254 pass, 0 fail, 7 skipped
    (unchanged DB-gated skip set)

proof_of_required_behavior: TOOL_VERIFIED
  - candidate-present/review-missing returns conflict_current_state_changed: proved
    by the boundary spec's "candidate exists but its review item is missing"
    test (fake transaction throws if any INSERT is attempted; result.error.code
    asserted as conflict_current_state_changed, result.data asserted null)
  - that path performs zero writes and zero audit calls: proved by the same test -
    the fake transaction's INSERT INTO kai.review_queue_items and INSERT INTO
    kai.upload_lifecycle_audit branches both throw if reached, and the test asserts
    publishCalls === 0
  - complete replay performs zero writes and zero audit calls: proved by the
    pre-existing "identical full replay" boundary test (fake transaction has no
    INSERT branches at all) and by the integration-spec "same identity replays"
    test's rowCounts/secondAudit.published assertions against the real schema
  - authorized mutable review-field changes do not break replay: proved by the new
    boundary-spec test asserting a full replay (replayed: true, publishCalls === 0)
    against a review row carrying non-default queue_status, priority, assignment,
    due_at, summary, required_action, review_status, and blocked_reason values
  - initial creation still creates exactly one candidate, one queue item, and one
    audit: proved by the unchanged integration-spec first-creation test and by the
    PostgreSQL smoke verifier's creation_candidate_persisted /
    creation_review_item_persisted / creation_audit_persisted checks (all PASS)
  - concurrent identical creation still converges correctly: proved by the
    unchanged integration-spec overlapping-transaction test (one replayed: false,
    one replayed: true, exactly one candidate/review-item/audit row) and by the
    PostgreSQL smoke verifier's concurrent_insert_convergence checks (both PASS)
  - required-audit failure still rolls back all initial writes: proved by the
    unchanged integration-spec required-audit-prepare-rejection and
    publish-throw/publish-rejection tests (zero rows in all three tables after
    rollback) and by the boundary-spec audit-rejection test (candidateInsertReached
    and queueInsertReached both true, result.ok false)

diff_checks: TOOL_VERIFIED
  - git diff --check: clean (no whitespace errors)
  - git diff --cached --check: clean (nothing staged before the commit below)
  - complete diff inspected: exactly four files changed -
    Backend/kai/dictionary/postgresSourceCandidateRepository.js (the queue-item
    branch restructure and one docstring update),
    __tests__/kai-sprint2-p1-07-source-candidate-boundary.spec.js (one test
    replaced with three),
    scripts/kai-sprint2-p1-07-source-candidate-runbook.md (identity/replay
    paragraph correction), and
    scripts/kai-sprint2-p1-07-source-candidate-patch-notes.md (additive
    Correction section) - plus this ExecPlan correction block. No migration,
    rollback, verifier SQL, smoke SQL, service file, route, listener, UI, startup
    composition, feature-flag default, Current State, or Implementation Baseline
    file was touched. No P1-08, promotion, source, source_version, evidence, or
    claim identifier appears anywhere in the diff.

correction_commit_hash: report after commit; a commit cannot contain its own SHA

final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no queue-only orphan discovery, repair service, new audit vocabulary, new
    validator key, transition, promotion, source, source_version, evidence, claim,
    route, UI, cloud work, or deployment/real-data handling was implemented
  - no accepted P1-07 contract element (VAL-KAI-P1-07-001, identity keys,
    server-pinned fields, audit contract/operation/validator-key names) was
    changed
  - no route, listener, UI, scheduler, or startup-composition file was added or
    edited
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite,
    deployment, production/shared database access, or real client data access was
    performed
  - did not begin P1-08, propose another package, or perform another review cycle

user_confirmed_starting_assumptions:
  - the owner-supplied bounded-correction scope and required-behavior specification
    described in the originating prompt, none of which was independently
    re-derived from a quoted governing source during this turn beyond what fresh
    repository/test inspection above established

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
```

## P1-08 evidence - source-promotion decision, source, and source_version creation

```text
timestamp_local: 2026-08-05 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: 9f6645350f559520f77c1dee33eeee1654495adc
package: KAI P1-08 - complete P1 backend source-promotion subsystem
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 709161
  sha256: 2c99205319a2473dd0a64e6838fe6f763b014aa34588f5cb74e02a978a993526
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/ce408740-0a63-453f-ba4c-d1713e025eec/scratchpad/KAI_Sprint2_P0_ExecPlan_pre_p1_08.md
  prefix_proof: the live file's first 709161 bytes are byte-identical to the preserved
    copy (the preserved copy is exactly that file, taken immediately before this
    block was appended); this block is appended strictly after that offset

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 9f6645350f559520f77c1dee33eeee1654495adc
  worktree: clean including untracked files (verified via `git status --porcelain`
    before any change)

p1_07_reopened: no - P1-07's accepted files
  (Backend/kai/dictionary/postgresSourceCandidateRepository.js,
  Backend/kai/services/kaiSourceCandidateService.js, its migration/rollback, its
  scripts/*, its __tests__/*) were read for context only and are byte-identical
  after this package (confirmed by `git status`/`git diff` showing zero changes to
  any P1-07 file path)

p1_08_made:
  - migrations/kai_sprint2_p1_08_source_promotion.sql (new forward migration):
    creates kai.intake_promotion_decisions (intake_promotion_decision_id,
    organization_id, intake_source_candidate_id, review_queue_item_id,
    reviewed_source_type, decision_status ['decided'|'promoted'], source_id,
    source_version_id, created_by, created_by_type, created_at, decided_at,
    promoted_at), kai.sources (source_id, organization_id, source_code,
    reviewed_source_type, created_by, created_by_type, created_at), and
    kai.source_versions (source_version_id, organization_id, source_id,
    intake_source_candidate_id, intake_sensitivity_profile_id,
    profile_canonical_sha256, is_current, created_by, created_by_type,
    created_at), each with tenant-safe composite lineage foreign keys. Widens
    kai.intake_source_candidates.candidate_status from P1-07's single-value pin
    ('needs_gk_review' only) to IN ('needs_gk_review', 'promoted') - no other
    value - following the accepted P1-07 precedent of widening an earlier
    package's CHECK-pinned vocabulary through a later forward migration rather
    than editing the accepted P1-07 migration file. Adds two trivially-unique
    constraints to kai.intake_source_candidates
    (intake_source_candidates_p1_08_identity_unique,
    intake_source_candidates_p1_08_promotion_lineage_unique) and one to
    kai.review_queue_items (review_queue_items_p1_08_identity_unique), each the
    exact matching target of a new composite FK - P1-06's and P1-07's own
    migration files are not edited. Adds the ux_source_versions_p1_08_current_per_source
    partial unique index (at most one is_current = true source_version per
    source_id) and the new source_promotion_decision_persisted audit
    operation/metadata branch on kai.upload_lifecycle_audit (additive only; every
    earlier branch preserved verbatim).
  - migrations/kai_sprint2_p1_08_source_promotion.rollback.sql (new rollback
    draft): restores the exact prior audit constraints, drops the three P1-08
    tables and their indexes, the P1-08-only foreign keys added onto
    kai.intake_promotion_decisions, the P1-08-only unique constraint on
    kai.review_queue_items, the P1-08-only unique constraints on
    kai.intake_source_candidates, and restores candidate_status to its exact
    pre-P1-08 single-value CHECK. Alters no earlier package's table beyond that
    restoration.
  - Backend/kai/dictionary/postgresSourcePromotionRepository.js (new file): the
    only authorized location for P1-08 SQL/row-locking. createSourcePromotionDecision
    requires both feature flags before any read (enforced one level up, in the
    service); reads the tenant-scoped, FOR UPDATE-locked P1-07 candidate row
    first (the real serialization point for concurrent promotion attempts on an
    already-existing row, unlike P1-07's own create-from-nothing case), applies
    VAL-KAI-P1-08-001 (candidate/review completeness and open-review-item
    status), VAL-KAI-P1-08-002 (the exact P1-05/P1-06/P1-07 fail-closed
    allowed-use/consent/governance predicate, reapplied rather than a new
    representation invented), and VAL-KAI-P1-08-003 (explicit, non-'unknown',
    disclosed reviewed-source-type vocabulary), computes the deterministic
    sha256 source_code from only organizationId + intakeSensitivityProfileId +
    profileCanonicalSha256 + reviewedSourceType, does authoritative
    existing-row lookups (decision, then source, then source_version) before
    ever inserting any of them, uses INSERT ... ON CONFLICT ... DO NOTHING
    RETURNING for all three inserts, transitions the candidate
    (needs_gk_review -> promoted) and review item (open -> resolved) via
    compare-and-set UPDATEs, transitions the decision itself
    (decided -> promoted) via a compare-and-set UPDATE bound to the
    source/source_version ids, and writes the required metadata-only
    source_promotion_decision_persisted audit row inside the same transaction as
    every insert/transition on first creation only (own-boolean-data-property
    audit predicate, copied from P1-05 through P1-07's prepareRequiredAudit). A
    losing concurrent transaction that unblocks from the candidate FOR UPDATE
    lock onto an already-'promoted' row re-reads and replays the winner's
    committed decision rather than misreporting validation_blocker. No
    catch-23505, in-memory lock, mutex, in-flight map, or advisory lock is used
    anywhere.
  - Backend/kai/services/kaiSourcePromotionService.js (new file):
    createSourcePromotionDecision validates its input allowlist (organizationId,
    intakeSourceCandidateId, reviewedSourceType, actorContext, now only), checks
    both KAI_SPRINT2_ENABLED and KAI_SOURCE_PROMOTION_ENABLED before any
    repository read/lock/validator/audit activity, enforces AUTH-KAI-003 (mapped
    human actor only - a resolved review item is never itself promotion
    authority) and delegates tenant-membership/role authorization to the
    existing shared validateActorCanPerformOperation/
    validateTenantBoundaryConsistency mechanisms. Contains no SQL, imports no
    database pool, and is not composed into any route, listener, scheduler, or
    production path.
  - Backend/kai/db/kaiIntakeQueries.js (additive only): added
    getScopedSourceCandidateByIdentity, getScopedSourcePromotionDecisionByIdentity,
    getScopedSourceByCode, getScopedSourceById,
    getScopedSourceVersionByCandidateIdentity, getScopedSourceVersionById - six
    narrow, tenant-scoped lookups (the first two, plus the by-code source lookup
    and the candidate-identity source_version lookup, FOR UPDATE; the two by-id
    lookups unlocked, used only to read back an already-committed binding during
    replay). Every existing exported function's signature and behavior is
    unchanged (confirmed by `git diff` showing a pure addition).
  - Backend/kai/config/kaiSprint2Config.js (additive only): added
    isKaiSourcePromotionEnabled (reading KAI_SOURCE_PROMOTION_ENABLED, default
    false via the existing isEnabledValue helper) and
    areKaiSprint2SourcePromotionFeaturesEnabled, matching the exact
    isKaiFileUploadEnabled/areKaiSprint2UploadFeaturesEnabled composition idiom
    already established in this file. Every existing exported function's
    signature and behavior is unchanged. Neither KAI_SPRINT2_ENABLED nor
    KAI_SOURCE_PROMOTION_ENABLED is enabled by this package.
  - package.json (additive only): added the
    verify:kai-sprint2-p1-08-source-promotion script.
  - scripts/kai-sprint2-p1-08-source-promotion-verifier.sql, -failure-checks.sql,
    -smoke-seed.sql, -smoke-verifier.sql, -runner-assertions.js,
    -local-postgres.js, -runbook.md, -patch-notes.md (all new files).
  - __tests__/kai-sprint2-p1-08-source-promotion-schema-contract.spec.js,
    -boundary.spec.js, .integration.spec.js, -runner-self-test.spec.js (all new
    files).

selected_identity_and_basis:
  - Promotion-decision/source_version identity: organization_id +
    intake_source_candidate_id. Basis: P1-07's own
    (organization_id, intake_sensitivity_profile_id) uniqueness already
    establishes a 1:1 relationship to one candidate; no currently authorized
    workflow permits re-deciding or re-promoting the same candidate. This is a
    P1-08 implementation decision, documented in the migration comments, the
    schema-contract test, the patch notes, the runbook, and this evidence block -
    not claimed to be mandated by any governing source.
  - Source identity: organization_id + source_code, where source_code is a
    deterministic sha256 hex digest of only organizationId,
    intakeSensitivityProfileId, profileCanonicalSha256, and reviewedSourceType -
    never a filename, MIME type, sample value, AI output, or external lookup.
    Because intakeSensitivityProfileId is already unique to one P1-07 candidate,
    kai.sources/kai.source_versions rows are effectively 1:1 with the candidate
    they were promoted from; this package does not implement merging multiple
    candidates into one source's version history.
  - Decision recording and promotion are compounded in one atomic transaction,
    not split into two separately-atomic operations: no established P1-06/P1-07
    package records a decision without also completing its associated write in
    the same transaction, so this follows the same compound-boundary idiom P1-07
    uses for its own candidate insert + review-item insert.

selected_reviewed_source_type_vocabulary_and_p1_08_decision_disclosure:
  - reviewed_source_type vocabulary: organization_primary_record,
    organization_secondary_record, third_party_provided_record, public_record -
    never 'unknown'. Fresh inspection found no currently authorized producer
    contract that emits an explicit source-type classification (the same absence
    P1-07 found and disclosed for its own proposed_source_type), so this
    vocabulary is a P1-08 implementation decision, disclosed in the migration
    comments, the repository file's own code comment, the patch notes, the
    runbook, and here - not quoted from, and not claimed to be mandated by, any
    owner-authorized governing source.
  - Audit operation: source_promotion_decision_persisted. Audit contract:
    p1_source_promotion_decision_v1. Validator keys: VAL-KAI-P1-08-001
    (candidate/review completeness), VAL-KAI-P1-08-002 (reapplied permission
    predicate), VAL-KAI-P1-08-003 (reviewed-type vocabulary) - the smallest
    convention-consistent naming already established by this repository (the
    same VAL-KAI-P1-0X-00N idiom P1-05/P1-06/P1-07 themselves used). The required
    audit records VAL-KAI-P1-08-001 as its single disclosed key, matching the
    one-key-per-audit-row idiom already established by P1-05 through P1-07.

commands: TOOL_VERIFIED
  - node --test __tests__/kai-sprint2-p1-08-source-promotion-schema-contract.spec.js
    __tests__/kai-sprint2-p1-08-source-promotion-runner-self-test.spec.js
    __tests__/kai-sprint2-p1-08-source-promotion-boundary.spec.js
    __tests__/kai-sprint2-p1-08-source-promotion.integration.spec.js
    (no KAI_P1_08_SOURCE_PROMOTION_DATABASE_URL set; integration spec self-skips
    without a runner-owned database) -> 43 tests, 42 pass, 1 skip, 0 fail
  - npm run verify:kai-sprint2-p1-08-source-promotion (ephemeral loopback
    PostgreSQL 16 runner) -> catalog verifier 64/64 PASS, read-only failure
    checks 13/13 PASS, smoke verifier 13/13 PASS, integration suite 11/11 pass,
    0 fail
  - node --test __tests__/kai-sprint2-p1-05-*.spec.js
    __tests__/kai-sprint2-p1-06-*.spec.js __tests__/kai-sprint2-p1-07-*.spec.js
    __tests__/kai-sprint2-p1-08-*.spec.js -> 146 tests, 142 pass, 0 fail, 4 skip
  - npm run test:kai-sprint2 (complete Sprint 2 suite) -> 1199 tests, 1191 pass,
    0 fail, 8 skip
  - npm test (complete repository suite) -> 1304 tests, 1296 pass, 0 fail, 8 skip
  - git diff --check -> clean (no whitespace errors)
  - git diff --cached --check -> clean (nothing staged before the commit below)

postgresql_verification_results: TOOL_VERIFIED
  - P1-08 ephemeral PostgreSQL 16 catalog verifier
    (verify:kai-sprint2-p1-08-source-promotion): 64/64 PASS across
    TABLE_EXISTS/COLUMN_EXISTS/CHECK_EXISTS/UNIQUE_CONSTRAINT_EXISTS/FK_EXISTS/
    UNIQUE_INDEX_EXISTS/NO_RAW_CONTENT_COLUMN/AUDIT_OPERATION_VOCABULARY/
    AUDIT_METADATA_BRANCH/CANDIDATE_STATUS_WIDENED/
    REVIEWED_SOURCE_TYPE_NEVER_UNKNOWN checks, no outer WHERE EXISTS filter
  - Read-only failure checks (kai-sprint2-p1-08-source-promotion-failure-checks.sql):
    13/13 PASS, covering reviewed_source_type vocabulary rejection (including
    exactly 'unknown'), decision_status vocabulary/promoted-binding-invariant
    enforcement, fabricated/mismatched composite-FK rejection, source_code shape
    enforcement, identity-unique enforcement at every level (source,
    source_version-by-candidate, decision), current-source-version-uniqueness
    enforcement, and proof that candidate_status now accepts 'promoted'
  - Smoke verifier (kai-sprint2-p1-08-source-promotion-smoke-verifier.sql):
    13/13 PASS, covering creation (decision + source + source_version +
    candidate/review transitions + audit, all atomically), replay, duplicate-
    identity rejection, concurrent-insert convergence, cross-tenant invisibility,
    transaction+audit atomicity (forced-rollback proof), and audit
    metadata exact-twelve-key/no-raw-content checks
  - Integration suite
    (__tests__/kai-sprint2-p1-08-source-promotion.integration.spec.js against the
    runner-owned ephemeral database): 11/11 pass, including the two-genuinely-
    overlapping-transactions concurrency proof (one replayed: false, one
    replayed: true, exactly one decision/source/source_version row) and the
    end-to-end service-seam test (both feature flags, AUTH-KAI-003, VAL-TEN-001)

proof_of_required_behavior: TOOL_VERIFIED
  - both disabled feature gates produce zero side effects: proved by the
    boundary-spec "either feature flag disabled returns feature_disabled with
    zero repository calls" test across five flag-state combinations (probe.calls
    asserted 0 in every case) and by the integration-spec service-seam test's
    disabledResult assertion
  - only an authorized mapped human with active tenant membership can decide/
    promote: proved by the boundary-spec AUTH-KAI-003 test (five non-human actor
    types all rejected with zero repository calls) and VAL-TEN-001 test (no
    membership, wrong org, revoked membership, wrong role all rejected with zero
    repository calls); integration-spec deniedResult confirms this against the
    real postgres repository
  - unknown type, incomplete pair, stale state, cross-tenant lineage, and
    restricted permissions cannot promote: proved by boundary-spec tests for
    not_found (missing candidate, missing review item, missing sensitivity
    profile, cross-tenant), validation_blocker (candidate not needs_gk_review,
    review item not open, reviewed_source_type unrecognized/'unknown'/empty,
    reapplied VAL-KAI-P1-08-002 permission predicate failing on any of its six
    columns), and conflict_current_state_changed (candidate lineage no longer
    matching the freshly re-read sensitivity profile, an existing decision bound
    to a different reviewedSourceType); integration-spec tests confirm not_found
    and validation_blocker against the real schema with zero rows created
  - deterministic source-code generation and current-version uniqueness: proved
    by the boundary-spec computeSourceCode test (same inputs -> same sha256
    output; a changed reviewedSourceType -> a different output) and by the
    PostgreSQL failure-checks' current_source_version_uniqueness_enforced check
    (a second is_current = true source_version for the same source_id is
    rejected by ux_source_versions_p1_08_current_per_source)
  - replay and genuine concurrent convergence: proved by the integration-spec
    "same identity replays" test (zero duplicate rows, zero duplicate audit) and
    the "two genuinely overlapping transactions" test (real Postgres
    connections, a beforeInsert barrier placed before the candidate's FOR UPDATE
    lock so both transactions genuinely rendezvous before either can win or
    lose the row lock; exactly one decision/source/source_version row, exactly
    one replayed: false and one replayed: true, exactly one audit row)
  - transactional rollback and required-audit behavior: proved by the
    integration-spec required-audit-prepare-rejection test and the synchronous-
    publish-throw/publish-rejection tests (zero decision/source/source_version
    rows and candidate_status still needs_gk_review after rollback in all three
    cases) and by the smoke verifier's transaction_and_audit_atomicity check
    (decision, source, source_version, and audit inserts all reached, then all
    rolled back together by a forced exception)
  - no unauthorized data enters persistence or audit: proved by the audit
    metadata exact-twelve-key check (schema-contract, boundary, and smoke-verifier
    tests), the NOT metadata ? 'storage_uri' / NOT metadata ? 'signed_url'
    CHECK-enforced exclusions (catalog verifier AUDIT_METADATA_BRANCH check), and
    the NO_RAW_CONTENT_COLUMN catalog check across all three P1-08 tables

diff_checks: TOOL_VERIFIED
  - git diff --check: clean (no whitespace errors)
  - git diff --cached --check: clean (nothing staged before the commit below)
  - complete diff inspected: three modified files, all additive only -
    Backend/kai/config/kaiSprint2Config.js (+15 lines: two new exported
    functions), Backend/kai/db/kaiIntakeQueries.js (+132 lines: six new exported
    functions), package.json (+1 line: one new script entry) - plus sixteen new
    untracked files (two migrations, one repository, one service, eight
    scripts/docs, four test specs). No P1-02 through P1-07 or Gate A migration,
    rollback, runner, verifier, smoke, repository, service, or runbook file was
    edited. No route, listener, UI, scheduler, startup-composition, Current
    State, or Implementation Baseline file was touched. No evidence, claim,
    source-locator, or graph-relationship identifier appears anywhere in the
    diff.

final_commit_hash: report after commit; a commit cannot contain its own SHA

final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no UI, route, production wiring, source locator, graph relationship,
    evidence, claim, assistant tool, generation, cloud configuration,
    deployment, feature enablement, real-client-data handling, P1-09, or P2 work
    was implemented
  - neither KAI_SPRINT2_ENABLED nor KAI_SOURCE_PROMOTION_ENABLED was enabled
  - no accepted P1-07 contract element (VAL-KAI-P1-07-001, identity keys,
    server-pinned fields, audit contract/operation/validator-key names, the
    intake_source_candidates/review_queue_items migration files themselves) was
    changed beyond the disclosed additive ALTER TABLE statements in P1-08's own
    forward migration
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite,
    deployment, production/shared database access, or real client data access
    was performed
  - did not begin another package, propose another prompt, or continue past this
    bounded implementation

user_confirmed_starting_assumptions:
  - the owner-supplied bounded-implementation scope and required-behavior
    specification described in the originating prompt, none of which was
    independently re-derived from a quoted governing source during this turn
    beyond what fresh repository/test inspection above established

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
```

## P1-08 Correction (2026-08-05): three-outcome decision model

This is an additions-only correction block. It does not edit or delete anything in
the P1-08 section above; it documents a bounded correction made to that same
still-dormant package, on the same feature branch, before either
`KAI_SPRINT2_ENABLED` or `KAI_SOURCE_PROMOTION_ENABLED` was ever set true anywhere.

### Problem corrected

The P1-08 implementation above only supported two `decision_status` values:
`decided` (a transient intermediate) and `promoted` (terminal). There was no way to
record a "needs more information" or "rejected" outcome. This correction replaces
that two-value model with three owner-authorized, directly-reachable outcomes.

### Corrected outcome vocabulary and transition matrix

`decision_status` (and the new service/repository input field `outcome`, which
replaces `reviewedSourceType` as the sole discriminator): `needs_more_information`,
`rejected`, `promoted`. The transient `decided` value no longer exists.

Legal transitions (every other requested transition returns
`conflict_current_state_changed` with zero mutation, via an authoritative
reread-and-compare-and-set - never a raced blind UPDATE):

- `null -> needs_more_information`
- `null -> rejected`
- `null -> promoted`
- `needs_more_information -> rejected`
- `needs_more_information -> promoted`

`rejected` and `promoted` are terminal except for an identical replay of the same
outcome (same identity, same recorded facts - zero writes, zero audit).
`needs_more_information` is also safely re-requestable as a zero-write, zero-audit
replay while still at `needs_more_information`.

Per-outcome side effects:

- **needs_more_information**: `reviewed_source_type`/`source_id`/`source_version_id`/
  `promoted_at` stay `NULL` on the decision row; no `kai.sources`/
  `kai.source_versions` row is created; `candidate_status` stays
  `needs_gk_review`; `review_queue_items.queue_status` transitions
  `open -> waiting_on_client` (an already-accepted P1-06 vocabulary value) with
  `required_action` set to the fixed literal `"Obtain the missing client
  information before reconsidering source promotion."`; exactly one required
  metadata-only audit row is written atomically.
- **rejected**: the same four decision-row fields stay `NULL`; no source/
  source_version row is created; `candidate_status` transitions to the new
  terminal value `rejected` (from `needs_gk_review`, either directly or via a
  `needs_more_information` detour); `queue_status`/`review_status` transition to
  `resolved` (from `open` or from `waiting_on_client`); exactly one required audit
  row is written atomically.
- **promoted**: unchanged mechanics from the original P1-08 implementation
  (explicit non-`'unknown'` `reviewedSourceType` required, same deterministic
  `source_code`, same creation-or-authoritative-replay path for
  `kai.sources`/`kai.source_versions`), reachable either directly or as a
  `needs_more_information -> promoted` follow-up.

### Schema changes made by this correction

All within this package's own `migrations/kai_sprint2_p1_08_source_promotion.sql`
and its `.rollback.sql` counterpart; no P1-06/P1-07 migration file was edited:

- `kai.intake_promotion_decisions.reviewed_source_type` changed from `NOT NULL` to
  nullable; `intake_promotion_decisions_p1_08_reviewed_source_type_check` now reads
  `reviewed_source_type IS NULL OR reviewed_source_type IN (...)`.
- `kai.intake_promotion_decisions.decision_status` dropped its
  `DEFAULT 'decided'`; `intake_promotion_decisions_p1_08_decision_status_check` now
  reads `decision_status IN ('needs_more_information', 'rejected', 'promoted')`.
- `intake_promotion_decisions_p1_08_promoted_binding_check` now requires
  `reviewed_source_type`/`source_id`/`source_version_id`/`promoted_at` all `NULL`
  for `needs_more_information`/`rejected`, and all `NOT NULL` for `promoted`.
- `kai.intake_source_candidates.candidate_status`'s CHECK
  (`intake_source_candidates_p1_07_candidate_status_check`, already forward-migrated
  by the original P1-08 package) is widened again to
  `IN ('needs_gk_review', 'promoted', 'rejected')`.
- No column or CHECK constraint was added to `kai.review_queue_items`:
  `'waiting_on_client'` was already an accepted `queue_status` value in the P1-06
  migration, and `required_action` already existed there as a nullable P1-06
  column, so no P1-06 file was touched by this correction either.
- The rollback migration continues to drop the three P1-08 tables outright and
  restore `candidate_status` to its exact pre-P1-08 single-value pin
  (`needs_gk_review` only), so it reverses this correction along with the rest of
  the package with no further changes.

### Files changed by this correction

- `Backend/kai/dictionary/postgresSourcePromotionRepository.js` - rewritten to
  support the full transition matrix; generalizes the prior single-path
  candidate/review-item transition helpers into compare-and-set functions
  parameterized by expected-from/target status, adds the
  `needs_more_information`-only fixed `required_action` literal, and generalizes
  decision-row replay validation (`validateReplayedDecisionRow`) to cover all
  three outcomes instead of only `promoted`.
- `Backend/kai/services/kaiSourcePromotionService.js` - the exported
  `createSourcePromotionDecision(input, dependencies)` signature is unchanged, but
  `input` now requires a new `outcome` field (`needs_more_information` | `rejected`
  | `promoted`); `reviewedSourceType` is required only when `outcome === 'promoted'`
  and is rejected as `validation_blocker` if present for any other outcome (never
  silently accepted-and-ignored).
- `migrations/kai_sprint2_p1_08_source_promotion.sql` and `.rollback.sql` - schema
  changes above.
- `scripts/kai-sprint2-p1-08-source-promotion-verifier.sql`,
  `-smoke-verifier.sql`, `-failure-checks.sql` - extended with checks for the new
  outcomes/constraints (e.g. `needs_more_information_binding_forbids_reviewed_source_type`,
  `candidate_status_rejected_now_accepted`), while every prior check name and
  assertion is preserved; `decision_status_vocabulary_enforced`'s fabricated value
  changed from `'rejected'` (now legitimate) to `'decided'` (now itself invalid).
- `scripts/kai-sprint2-p1-08-source-promotion-runbook.md` and
  `-patch-notes.md` - each received an additions-only "P1-08 CORRECTION" section
  documenting the above; no prior content in either file was edited or removed.
- `__tests__/kai-sprint2-p1-08-source-promotion-boundary.spec.js`,
  `-schema-contract.spec.js`, `.integration.spec.js` - extended with coverage for
  all three direct outcomes, both follow-up transitions, non-`promoted`
  `reviewed_source_type IS NULL` persistence, zero source/source_version creation
  for non-`promoted` outcomes (including after a `needs_more_information` detour),
  the exact `waiting_on_client`/`required_action` behavior, prohibited-transition
  `conflict_current_state_changed` handling (verified via direct DB assertions in
  the integration spec), disabled-feature-gate/unauthorized-actor short-circuiting
  for all three outcomes, and required-audit-rejection rollback for all three
  outcomes. `-runner-self-test.spec.js` required no change.

### Verification performed for this correction

`npm run verify:kai-sprint2-p1-08-source-promotion` was run against an ephemeral
loopback PostgreSQL 16 instance created by this package's own runner: the catalog
verifier (64 checks), the read-only failure checks (15 checks, including three new
ones), the smoke verifier (13 checks), and the full
`kai-sprint2-p1-08-source-promotion.integration.spec.js` suite (19 tests, including
10 new/rewritten tests covering the three-outcome model) all passed with zero FAIL
rows and zero test failures. The non-database
`kai-sprint2-p1-08-source-promotion-boundary.spec.js` (31 tests) and
`-schema-contract.spec.js` (17 tests) specs were also run directly via
`node --test` and passed in full.

### Not changed by this correction

No P1-06 file was touched. No P1-07 file was edited (only this package's own
forward migration gained new statements, as before). No route, listener,
scheduler, production composition, or feature-flag default enablement was added;
`KAI_SPRINT2_ENABLED` and `KAI_SOURCE_PROMOTION_ENABLED` both remain default
false. AUTH-KAI-003, VAL-TEN-001, and VAL-KAI-P1-08-001/002/003 (predicates and
validator-key names) are unchanged, except that VAL-KAI-P1-08-001's completeness
predicate now has two forms (initial-decision and needs_more_information-follow-up)
to account for the review item resting at `waiting_on_client` rather than `open`
during a follow-up transition.

## P1-09 evidence - internal review cockpit and integrated P1 acceptance

```text
timestamp_local: 2026-08-05 America/Vancouver
branch: codex/kai-sprint2-p0-v0.3.5
starting_head: ad2f0f25e2aa7391f891579da5ca4f19498dbb5c
package: KAI P1-09 - internal review cockpit and integrated P1 acceptance
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 738208
  sha256: b889da853c88a3151380937ae7a3b6033a1535cf1ec6c80683a1f300dd36cb39
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/e023d9b2-b093-43d7-bd25-e70deec27047/scratchpad/KAI_Sprint2_P0_ExecPlan_pre_p1_09.md
  prefix_proof: the live file's first 738208 bytes are byte-identical to the preserved
    copy (the preserved copy is exactly that file, taken immediately before this
    block was appended); this block is appended strictly after that offset, after
    the P1-08 Correction section's final line. Nothing before that offset - and in
    particular no "Current State" or "Implementation Baseline" content - was read
    for anything other than context or modified in any way.

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: ad2f0f2 ("Correct KAI P1-08 promotion decision to a three-outcome model")
  worktree: clean including untracked files (verified via `git status --porcelain`
    before any change)

p1_01_through_p1_08_reopened: no - every accepted P1-01 through P1-08 file
  (migrations/*, Backend/kai/dictionary/postgresSourcePromotionRepository.js,
  Backend/kai/services/kaiSourcePromotionService.js,
  Backend/kai/services/kaiSourceCandidateService.js,
  Backend/kai/services/kaiReviewQueueService.js,
  Backend/kai/db/kaiIntakeQueries.js, Backend/kai/db/kaiReadModels.js,
  Backend/kai/config/kaiSprint2Config.js,
  Backend/kai/validators/kaiSprint2RequestSchemas.js, their scripts/* and their
  __tests__/*) is byte-identical after this package. Confirmed by
  `git status --porcelain` and `git diff --stat` showing exactly three modified
  files, none of which is a P1-01 through P1-08 file. No existing exported
  function's signature or behavior was changed anywhere; every P1-08 behavior this
  package surfaces is invoked, never reimplemented.

p1_09_made:
  - Backend/kai/db/kaiReviewCockpitReadModels.js (new file): three read-only,
    tenant-scoped read models. listReviewCockpitQueueItems generalizes the exact
    cursor pattern established by kaiReadModels.listIntakeFileReviewQueueItems -
    ORDER BY created_at DESC, review_queue_item_id DESC, a strict
    (created_at, review_queue_item_id) < (cursor.created_at,
    cursor.review_queue_item_id) predicate applied only when a cursor is present,
    and LIMIT n+1 - with parameter-bound canonical queue_type / queue_status
    filters instead of a hardcoded single queue_type.
    getReviewCockpitFileProfileRecord reads only safe P1-01/P1-04/P1-05 columns
    (never kai.intake_file_profiles.profile, never any storage/object-key column)
    with the quality-findings read bounded by a fixed
    REVIEW_COCKPIT_MAX_QUALITY_FINDINGS = 50 cap.
    getReviewCockpitSourceCandidateRecord adds no SQL at all: it composes the
    already-accepted P1-07/P1-08 getScoped* lookups in
    Backend/kai/db/kaiIntakeQueries.js. This module contains no INSERT/UPDATE/
    DELETE/TRUNCATE/ALTER of any kind.
  - Backend/kai/validators/kaiReviewCockpitRequestSchemas.js (new file): a closed
    query-key allowlist and base64url cursor codec for the cockpit queue list, and
    a closed request-body allowlist for the source-candidate decision. Both follow
    the exact kaiSprint2RequestSchemas.js idiom. The queue vocabularies are strict
    reuses of already-accepted vocabularies (the three queue_type values P1-06 and
    P1-07 write; KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES verbatim); the reviewed-
    source-type vocabulary is deliberately NOT restated here, so P1-08's
    VAL-KAI-P1-08-003 remains its sole authority.
  - Backend/kai/services/kaiReviewCockpitService.js (new file): listReviewCockpitQueue,
    getReviewCockpitFileProfileDetail, getReviewCockpitSourceCandidateDetail (all
    read-only) and submitSourceCandidateDecision (the sole write seam). Contains no
    SQL and imports no database pool. Every endpoint runs the identical
    authorization sequence already used by P1-05 through P1-08: KAI_SPRINT2_ENABLED
    gate -> explicit organization_id shape -> mapped actor resolution -> mapped-
    human-only gate -> validateActorCanPerformOperation('read_intake') ->
    validateActorCanPerformOperation('read_intake', { allowedRoles: gk_admin |
    gk_operator | gk_reviewer }) -> validateTenantBoundaryConsistency. Every
    response object is hand-built field by field with independent re-validation
    (UUID canonicality, enum membership, canonical ISO timestamps, bounded/
    control-character-free text) and returns a typed system_error rather than
    passing through any raw row. No new role name, operation name, queue status,
    candidate status, decision status, or reviewed-source-type value is introduced.
  - Backend/kai/routes/sprint2IntakeApi.js (additive only, +106 lines): four new
    handlers under the existing /api/kai/sprint2/intake mount and its existing
    rate-limiter/authentication stack - GET /admin/review-cockpit/queue, GET
    /admin/review-cockpit/file-profiles/:fileProfileId, GET
    /admin/review-cockpit/source-candidates/:intakeSourceCandidateId, and POST
    /admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision -
    plus one reviewCockpitIdentifiers helper, one lazily-imported service getter,
    and one __testables entry. No /internal/kai prefix and no new top-level
    app.use composition was introduced; index.js was not modified. Every prior
    export, handler, and helper in this file is unchanged.
  - frontend/kaiReviewCockpit.jsx (new file) and frontend/entry.jsx (additive only,
    +15 lines): the internal GK-only cockpit component and its
    window.renderKaiReviewCockpit entry point. The component returns null unless
    the KAI_SPRINT2_ENABLED-gated internal status route answers ok, and its
    source-decision controls are not rendered at all unless the detail response
    reports decision_controls_enabled: true. No client-facing route, page, or
    surface was added anywhere.
  - __tests__/kai-sprint2-p1-09-review-cockpit-boundary.spec.js and
    __tests__/kai-sprint2-p1-09-review-cockpit.integration.spec.js (new files).
  - __tests__/kai-sprint2-pass2-route-runtime.spec.js (additive only, +6 lines):
    the P0 router route-inventory assertion gained the four new cockpit paths.
    Every prior entry is preserved verbatim; no assertion was weakened, skipped,
    or disabled anywhere in this package.

not_made_by_this_package:
  - no migrations/*.sql file was created or edited; this package makes no schema
    change of any kind, so no P1-09 catalog verifier or *-local-postgres.js runner
    was added (the existing P1-05 through P1-08 runners are schema-focused and have
    no schema to verify here). The P1-08 runner was executed unmodified instead.
  - public/js/bundles/entry.js (the tracked Vite build artifact) was regenerated by
    `npm run build` during verification and then restored to its committed content
    via `git checkout --`; it is deliberately NOT part of this commit, so the diff
    the reviewer reads contains only source.
  - no new authentication, authorization, review-queue, source-promotion, or
    transaction abstraction was introduced. P1-08's repository requires an injected
    metadata-only audit dependency and no production provider for it exists in this
    repository; P1-09 introduces none (that would be new abstraction outside this
    package's scope) and forwards dependencies.metadataOnlyAudit unchanged, so an
    absent provider yields P1-08's own clean validation_blocker rather than any
    partial write. Both flags remain default false, so the decision route is
    unreachable in production regardless.

commands: TOOL_VERIFIED
  - node --test __tests__/kai-sprint2-p1-09-*.spec.js -> 37 tests, 37 pass, 0 fail,
    0 skip
  - npm run build (vite build) -> succeeded, public/js/bundles/entry.js 697.95 kB
    (artifact then restored, see not_made_by_this_package). package.json was
    inspected directly: it defines no lint or typecheck script, so none was run.
  - npm run verify:kai-sprint2-p1-08-source-promotion (P1-08's own unmodified
    ephemeral loopback PostgreSQL 16 runner) -> 92 PASS rows, 0 FAIL rows across
    the catalog verifier, read-only failure checks, and smoke verifier; P1-08
    integration suite 19 tests, 19 pass, 0 fail
  - node --test on the affected review-queue / authorization / tenant-scoping /
    request-safety / source-promotion / route-runtime suites
    (kai-sprint2-api-contract, -authorization, -foundation-safety, -p1-06-*,
    -p1-08-*, -pass2-api-contract, -pass2-route-runtime, -review-queue-route,
    -review-queue-status-route, -tenant-authorization, -tenant-validator,
    -batch-detail-route, -batch-files-route, -file-detail-route,
    -file-policy-block-route) -> 276 tests, 274 pass, 0 fail, 2 skip
  - npm run test:kai-sprint2 (complete Sprint 2 suite) -> 1242 tests, 1234 pass,
    0 fail, 8 skip
  - npm test (complete repository suite) -> 1347 tests, 1339 pass, 0 fail, 8 skip
  - git diff --check -> clean (no whitespace errors)
  - git diff --cached --check -> clean (see diff_checks below)

postgresql_verification_results: TOOL_VERIFIED
  - This package adds no schema object, so it introduces no PostgreSQL verifier of
    its own. The already-accepted P1-08 verifier was run unmodified against an
    ephemeral loopback PostgreSQL 16 instance created by its own runner and
    reported 92 PASS / 0 FAIL rows with its 19-test integration suite fully
    passing, proving P1-09 broke nothing in the P1-08 durable layer.

proof_of_required_behavior: TOOL_VERIFIED
  - tenant isolation: "P1-09 service (tenant isolation): an actor with membership
    only in another organization is denied, and every read is scoped to the
    requested organization_id" (boundary spec) proves the cross-tenant request is
    refused with zero read-model calls, that every read model receives exactly the
    requested organization_id, and that a row whose organization_id does not match
    the request scope is refused by the DTO layer rather than emitted. The
    integrated spec's "tenant isolation: another organization's scope yields no
    candidate and no decision" proves the same over real HTTP.
  - role enforcement: "P1-09 service (role enforcement): only gk_admin/gk_operator/
    gk_reviewer with active membership in the requested organization are allowed"
    (boundary spec) accepts exactly those three already-existing GK roles and
    rejects no-membership, wrong-role, revoked, and invited memberships with zero
    read-model calls. No new role name is introduced anywhere in the diff.
  - feature gating, both flags, both directions: "P1-09 service: KAI_SPRINT2_ENABLED
    disabled returns feature_disabled with zero read-model calls on every endpoint"
    and "P1-09 service: with KAI_SPRINT2_ENABLED on and KAI_SOURCE_PROMOTION_ENABLED
    off, reads stay available and only the decision seam is disabled" (boundary
    spec), plus the integrated spec's "with KAI_SOURCE_PROMOTION_ENABLED off, reads
    stay available and the decision route returns a clean feature_disabled" (403
    feature_disabled, zero repository calls, reads still 200) and "with
    KAI_SPRINT2_ENABLED off, every cockpit route is feature-gated before
    authentication" (all four routes 403 feature_disabled). Neither flag's default
    was changed anywhere in non-test code; flags are set only inside injected env
    objects, or via a process.env value set and restored within a single test's
    own scope.
  - pagination determinism: "P1-09 read model: cockpit queue list is
    organization-scoped, canonically filtered, bounded, and keyset ordered on a
    unique tie-breaker" and "P1-09 pagination determinism: a full page emits a
    next_cursor bound to the unique review_queue_item_id tie-breaker" (boundary
    spec). The tie-breaker column is review_queue_item_id, the
    kai.review_queue_items primary key, so the ORDER BY created_at DESC,
    review_queue_item_id DESC ordering is total and page boundaries can neither
    repeat nor skip a row.
  - DTO allowlists: "P1-09 DTO allowlists: no raw content, storage location, object
    key, signed URL, credential, prompt, internal note, or unrestricted audit
    metadata reaches any response" (boundary spec) is the forbidden-field assertion
    test. It injects eighteen sentinel fields (storage_provider, storage_bucket,
    storage_object_key, storage_uri, signed_url, credentials, prompt,
    internal_notes, raw_content, raw_sample, sample_values, pii, profile,
    queue_metadata, assigned_to, blocked_reason, audit_metadata, created_by) onto
    every synthetic row and asserts both the field name and its value are absent
    from every response, then asserts each response object's exact key set.
    "P1-09 DTO allowlists: an unsafe quality-finding detail is refused rather than
    emitted" additionally proves the response layer re-applies P1-04's own
    detail-safety exclusions instead of trusting the stored CHECK.
  - read-only file-profile behavior: no file-profile mutation path exists in this
    package - there is no file-profile mutation service function, no file-profile
    mutation route, and no invented approval/rejection/resolution/eligibility state
    anywhere. Proved by "P1-09 file-profile review is read-only: the package
    exposes no file-profile mutation service, route, or state vocabulary"
    (boundary spec), which asserts the only cockpit file-profile route is a single
    router.get and that the only mutating cockpit route in the whole router is the
    source-candidate decision route, and by the integrated spec's file-profile
    subtest, which sends POST/PUT/PATCH/DELETE at the file-profile detail path and
    receives 404 for every one.
  - all three decision outcomes exercised: the integrated spec's "decision: promoted
    creates the source and current source_version result", "decision: rejected
    records the outcome and creates no source or source_version", and the
    needs_more_information first step inside "decision: needs_more_information ->
    rejected follow-up transition" cover needs_more_information, rejected, and
    promoted end to end over real HTTP.
  - needs_more_information follow-up transitions: "decision: needs_more_information
    -> rejected follow-up transition" and "decision: needs_more_information ->
    promoted follow-up transition" (integrated spec) exercise both permitted
    follow-ups, including the waiting_on_client queue state the first step leaves
    behind and the source/source_version result the promoted follow-up produces.
  - stale/terminal conflict safety: "decision: a stale/terminal conflict is
    surfaced as a clean typed 409 and triggers no second mutation attempt"
    (integrated spec) is the test proving zero second mutation - it records the
    repository call-log length before and after and asserts exactly one call, a
    clean typed 409 conflict_current_state_changed body (not a 500, not a raw
    error), and that the candidate's committed decision and null source are
    unchanged afterwards. "P1-09 decision seam: passes the request through to P1-08
    unchanged and never retries or coerces a conflict" (boundary spec) proves the
    same at the service seam, and "P1-09 queue reads never invoke, import, or imply
    a promotion call" proves the decision service is resolved and invoked exactly
    once in the whole module.
  - incomplete-pair non-promotability: P1-09 introduces no completeness predicate of
    its own and relies entirely on P1-08's VAL-KAI-P1-08-001 (candidate/review
    completeness and status predicate, in both its initial-decision and
    needs_more_information-follow-up forms) in
    Backend/kai/dictionary/postgresSourcePromotionRepository.js, together with
    VAL-KAI-P1-08-002 (reapplied fail-closed permission predicate) and
    VAL-KAI-P1-08-003 (explicit non-'unknown' reviewed-source-type vocabulary).
    P1-09's marshaling layer forwards every such result unchanged, proved by
    "P1-09 decision seam: non-promoted outcomes forward no reviewedSourceType at
    all" and by the integrated spec's "decision: a malformed decision body is
    rejected before any repository call".
  - queue-resolution-never-implies-promotion: reading, filtering, paginating, or
    opening anything in the review queue never triggers and is never coupled to a
    promotion call anywhere in this package's code. listReviewCockpitQueue,
    getReviewCockpitFileProfileDetail, and getReviewCockpitSourceCandidateDetail
    contain no reference to createSourcePromotionDecision at all, and the sole
    resolution point of that service is inside submitSourceCandidateDecision -
    asserted directly by "P1-09 queue reads never invoke, import, or imply a
    promotion call" (boundary spec), which parses each read function's body and
    asserts exactly one `const decide = deps.createSourcePromotionDecision || ...`
    and exactly one `await decide(` in the whole module.
  - integrated synthetic P1 acceptance path: "P1-09 integrated synthetic P1
    acceptance: intake candidate -> review -> all three decisions ->
    source/source_version result" (13 subtests) runs the whole path against a real
    Express application mounted exactly as index.js mounts it, over entirely
    synthetic in-memory data. Every response body on that path is passed through
    assertNoRawDataExposure at the moment it is received, and the closing subtest
    "no raw-data field appeared in any response across the whole acceptance path"
    re-asserts all captured responses: no raw content, raw sample, raw PII,
    internal note, storage location, object key, bucket name, signed URL,
    credential, prompt, or unrestricted audit metadata appeared in any response
    anywhere across the entire acceptance path.

diff_checks: TOOL_VERIFIED
  - git diff --check: clean (no whitespace errors)
  - git diff --cached --check: clean
  - complete diff inspected line by line: three modified files, all additive only -
    Backend/kai/routes/sprint2IntakeApi.js (+106), frontend/entry.jsx (+15),
    __tests__/kai-sprint2-pass2-route-runtime.spec.js (+6) - plus six new files
    (one read model, one validator module, one service, one frontend component,
    two test specs) and this evidence block. Zero lines were deleted anywhere in
    the diff. No migrations/*.sql file was added or changed. No P1-01 through P1-08
    source, migration, script, runbook, or test file was edited. No ExecPlan
    content before byte offset 738208 was touched. No deploy, CI, or cloud
    configuration file was touched. No evidence, locator, claim, graph-relationship,
    assistant-tool, generation, client-review, or export identifier appears
    anywhere in the diff.

final_commit_hash: report after commit; a commit cannot contain its own SHA

final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no evidence, locator, claim, graph relationship, assistant tool, generation,
    client review, client-facing UI, public/funder export, cloud configuration,
    deployment, feature enablement, production or real-client-data behavior, schema
    or migration change, P2, or P3 work was implemented
  - neither KAI_SPRINT2_ENABLED nor KAI_SOURCE_PROMOTION_ENABLED had its default
    changed anywhere in non-test code; both remain default false
  - no accepted P1-01 through P1-08 contract element, exported signature, validator
    key, identity key, vocabulary, or file was changed
  - no test was weakened, skipped, disabled, or deleted; the single edit to an
    existing test file adds four route paths to an inventory assertion and
    preserves every prior entry verbatim
  - no fetch, pull, push, merge, rebase, reset, cherry-pick, history rewrite,
    deployment, production/shared database access, or real client data access was
    performed
  - did not begin another package, propose another prompt, start another review
    cycle, or continue past this bounded implementation

user_confirmed_starting_assumptions:
  - the owner-supplied bounded-implementation scope and required-behavior
    specification described in the originating prompt, none of which was
    independently re-derived from a quoted governing source during this turn beyond
    what fresh repository/test inspection above established

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  production_metadata_only_audit_provider_for_the_decision_route: NOT_CONFIRMED -
    no such provider exists in this repository and P1-09 introduces none; the
    decision route is additionally unreachable while KAI_SOURCE_PROMOTION_ENABLED
    remains default false
```


## KAI P2-01 — Deterministic evidence-lineage foundation

```text
timestamp_local: 2026-08-05 (local)
branch: codex/kai-sprint2-p0-v0.3.5
package: P2-01 (deterministic evidence-lineage foundation)
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 759348
  sha256: 18f732898b2f2e76da53172c9fac8abe73914b0f2f389e0657fa54634ca4895d
  preserved_copy: /private/tmp/claude-501/-Users-mikewoz-Get-Kinder-Full-Stack-Deploy/66001305-eacf-4719-ac7e-ca23e78c1f27/scratchpad/execplan_preserved_pre_p2_01.md
  prefix_proof: this block is appended strictly after the preserved byte offset;
    no earlier byte of the live file is altered

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: d5053dde78af4ed6ecd4557f1c9942554553e7e2 "Add KAI P1-09 internal review
    cockpit and integrated P1 acceptance test"
  worktree: clean including untracked files, staged paths: none

p2_01_made:
  - migrations/kai_sprint2_p2_01_evidence_lineage.sql (+455) - forward migration:
    canonical kai.source_locators and kai.evidence_items tables (tenant-safe
    composite lineage foreign keys, locator_type pinned to 'column' only,
    evidence_type pinned to two fact vocabularies, every governance/allowed-use
    boolean and evidence_review_status pinned fail-closed, sha256-hex fingerprint
    CHECKs), the ux_review_queue_items_p2_01_evidence_review_identity partial
    unique index on kai.review_queue_items (queue_type='evidence_review' only, a
    value already legal since P1-06), and the new evidence_lineage_extracted
    audit operation/metadata branch on kai.upload_lifecycle_audit.
  - migrations/kai_sprint2_p2_01_evidence_lineage.rollback.sql (+249) - removes
    only what the forward migration added, restoring the exact prior audit
    constraints.
  - Backend/kai/validators/kaiEvidenceLineageValidators.js (new) -
    validateEvidenceHasSourceLineage: pure, no-SQL, nine-check fixed-order
    predicate (row completeness, current-version binding, promoted candidate,
    promoted decision bound to this source/version, six-column cross-row lineage
    equality, checksum-shape completeness, reapplied VAL-KAI-P1-08-002 permission
    predicate verbatim).
  - Backend/kai/dictionary/postgresEvidenceLineageRepository.js (new) - the only
    authorized location for P2-01 SQL/row locking. Reads the six authoritative
    lineage rows, calls the validator, composes a deterministic evidence plan (one
    aggregate field-count fact with no locator, one per-field presence fact per
    committed kai.data_dictionary_fields row with a 'column' locator), writes via
    INSERT ... ON CONFLICT ... DO NOTHING RETURNING plus authoritative reread at
    every step (locator, evidence item, review-queue item), gates the queue-item
    write strictly on this call's own fresh evidence-item insert (the P1-07
    partial-replay-repair lesson reapplied), and writes exactly one required
    metadata-only audit row per non-replay call inside the same transaction.
  - Backend/kai/services/kaiEvidenceLineageService.js (new) -
    extractEvidenceFromSourceVersion(input, dependencies): exact-key input
    {organizationId, sourceVersionId, actorContext, now}, feature gate first
    (KAI_SPRINT2_ENABLED AND KAI_EVIDENCE_LINEAGE_ENABLED, zero side effects if
    either is false), AUTH-KAI-003 human-actor gate, validateActorCanPerformOperation
    (gk_admin/gk_operator/gk_reviewer), validateTenantBoundaryConsistency, then
    delegates to the injected repository. No SQL, no DB pool import. Not wired
    into any route.
  - Backend/kai/config/kaiSprint2Config.js (+15, additive) -
    isKaiEvidenceLineageEnabled (KAI_EVIDENCE_LINEAGE_ENABLED, default false) and
    areKaiSprint2EvidenceLineageFeaturesEnabled, matching the exact existing
    composition idiom. No existing export changed; neither flag enabled here.
  - Backend/kai/db/kaiIntakeQueries.js (+176, additive) - seven new exported
    getScoped* lookups (promotion decision by source_version_id, sensitivity
    profile by id, data dictionary by id, data dictionary fields by dictionary id
    ordered profile_field_key ASC, evidence item by statement fingerprint, source
    locator by fingerprint, evidence-review queue item by evidence_item_id). No
    existing exported function's signature or behavior changed.
  - scripts/kai-sprint2-p2-01-evidence-lineage-{verifier,failure-checks,smoke-seed,
    smoke-verifier}.sql, -local-postgres.js, -runner-assertions.js - catalog/
    negative-scope/smoke verification and the ephemeral loopback-only PostgreSQL 16
    runner (npm run verify:kai-sprint2-p2-01-evidence-lineage), mirroring the P1-08
    runner's exact mechanism.
  - scripts/kai-sprint2-p2-01-evidence-lineage-{runbook,patch-notes}.md - package
    docs, including a P2-01 CORRECTION section disclosing four fixes made during
    this package's own verification pass (see proof_of_required_behavior below).
  - __tests__/kai-sprint2-p2-01-evidence-lineage-{schema-contract,boundary,
    runner-self-test}.spec.js, .integration.spec.js - 40 no-DB focused tests plus
    14 real-PostgreSQL integration tests (54 total in the combined focused run).
  - package.json (+1, additive) - verify:kai-sprint2-p2-01-evidence-lineage script.

not_made_by_this_package:
  - no route, UI, assistant tool, graph relationship, generation, external-
    audience use, cloud/deploy work, or real-client-data handling
  - no P1-01 through P1-09 migration, rollback, repository, service, script,
    runbook, or test file was edited; Backend/kai/dictionary/
    postgresSourcePromotionRepository.js and Backend/kai/services/
    kaiSourcePromotionService.js and their exports are unchanged
  - neither KAI_SPRINT2_ENABLED nor KAI_EVIDENCE_LINEAGE_ENABLED had its default
    changed; both remain default false
  - no record-ID or redacted-extract locator kind was implemented
  - no later P2 package was begun

commands: TOOL_VERIFIED
  - node --test __tests__/kai-sprint2-p2-01-evidence-lineage-schema-contract.spec.js
    __tests__/kai-sprint2-p2-01-evidence-lineage-boundary.spec.js
    __tests__/kai-sprint2-p2-01-evidence-lineage-runner-self-test.spec.js
    __tests__/kai-sprint2-p2-01-evidence-lineage.integration.spec.js
    -> 54 pass, 0 fail (against a manually-provisioned ephemeral PostgreSQL 16,
    all prior frozen migrations plus this package's forward migration applied)
  - npm run verify:kai-sprint2-p2-01-evidence-lineage (own ephemeral-Postgres
    runner: catalog verifier, failure-checks, smoke-seed/verifier, then the
    .integration.spec.js against that same throwaway DB, then teardown) -> catalog
    verifier 57/57 PASS rows, failure-checks 20/20 PASS rows, smoke 13/13 PASS
    rows, integration suite 14 pass / 0 fail, "P2-01 evidence-lineage integration
    tests passed.", ephemeral workdir removed - run twice, both green
  - npm run verify:kai-sprint2-p1-08-source-promotion -> 19 pass, 0 fail,
    "P1-08 source-promotion integration tests passed." (unaffected by this
    package)
  - npm run test:kai-sprint2 -> 1283 tests, 1274 pass, 0 fail, 9 skipped
  - npm test (complete repository suite) -> 1388 tests, 1379 pass, 0 fail, 9
    skipped
  - git diff --check -> clean (no whitespace errors)
  - git diff --cached --check -> clean (no whitespace errors)

postgresql_verification_results: TOOL_VERIFIED
  - catalog verifier proves: both new tables exist with their full canonical
    column lists; every CHECK constraint (locator_type single-value pin,
    coordinates shape, evidence_type two-value pin, data_class pin, every
    governance-boolean pin, evidence_review_status pin, both fingerprint sha256-
    hex shapes, locator-binding invariant); both tenant-safe composite lineage
    foreign keys; all four identity/id-org unique constraints; the partial unique
    index; the widened audit operation vocabulary (earlier operations preserved);
    the new audit metadata branch (exact ten-key allowlist, statement/fingerprint
    keys forbidden); no raw-content/sample-value/storage-pointer column on either
    table
  - failure-checks (inside a rolled-back transaction) prove: coordinates
    extra-key/missing-column_name/non-string-value all rejected; locator_type and
    evidence_type vocabulary CHECKs enforced; the field-count-fact-forbids-locator
    and field-presence-fact-requires-locator halves of the locator-binding
    invariant both enforced; every governance-boolean pin enforced; both
    fingerprint-shape CHECKs enforced; statement length and unsafe-content
    exclusion enforced; both composite FKs reject a fabricated
    source_version_id/source_locator_id; both identity-unique constraints
    enforced; the evidence_review partial-unique-index enforced
  - smoke verification (against real committed P1-04 through P1-08 lineage) and
    the .integration.spec.js prove, against a real PostgreSQL 16 instance: (a)
    first extraction creates exactly one aggregate item, one per-field item per
    committed data_dictionary_fields row, one 'column' locator per field item, one
    open evidence_review queue item per evidence item, and exactly one audit row;
    (b) identical replay performs zero new rows and zero new audit rows,
    replayed:true; (c) two genuinely overlapping extraction calls for the same
    source_version_id (forced via the beforeInsert rendezvous gate, called before
    any row is read or locked) converge to the identical row set with replayed
    flags [false, true] and exactly one audit row published between them; (d)
    tenant isolation - a mismatched organizationId returns not_found and creates
    nothing; (e) an unknown source_version_id, a superseded (non-current) source
    version, a promotion decision bound to a different source, and a candidate
    that is not (or no longer) promoted each return the correct typed error
    (not_found / conflict_current_state_changed / validation_blocker) with zero
    rows created; (f) a rejected required-audit prepare, a synchronous publish()
    throw, and a rejected publish() promise each roll back every write (verified
    by re-querying the database afterward); (g) the disabled-feature-flag path
    returns feature_disabled with zero rows created

proof_of_required_behavior: TOOL_VERIFIED
  - lineage enforcement: validateEvidenceHasSourceLineage's nine ordered checks
    are each proven independently in the boundary spec against synthetic rows,
    and checks 1-6 (missing row, non-current version, source mismatch, non-
    promoted candidate, unbound/mismatched decision, cross-row lineage mismatch)
    are additionally proven against real committed-then-mutated rows in the
    integration spec ("P2-01 (e): ..." x4 plus "P2-01 (d)"). Check 9 (the
    reapplied permission predicate) has no reachable real-row failure mode at the
    integration layer - every one of its six columns is itself pinned by a P1-05
    CHECK constraint, so no committed kai.intake_sensitivity_profiles row can ever
    violate it, exactly like P1-08's own integration spec, which likewise never
    attempts this against a real row - and is proven exhaustively instead by
    "validateEvidenceHasSourceLineage check 9" in the boundary spec against
    synthetic row objects.
  - tenant isolation: "P2-01 (d): tenant isolation" (integration) proves a
    mismatched organizationId returns not_found with zero rows created; every
    getScoped* lookup this package added is parameterized by organizationId.
  - committed-coordinate-only locators: the migration's locator_type CHECK pins
    the vocabulary to the single value 'column' (proven by the schema-contract
    spec's "P2-01 pins locator_type to the single 'column' value only" and the
    catalog verifier's LOCATOR_TYPE_PINNED row); the repository only ever builds a
    locator from an already-committed data_dictionary_fields.profile_field_key
    (buildEvidenceCompositionPlan, proven deterministic by the boundary spec's
    fingerprint-determinism tests); the aggregate field-count fact never gets a
    locator (CHECK-enforced by evidence_items_p2_01_locator_binding_check, proven
    by failure-checks' field_count_fact_forbids_locator and
    field_presence_fact_requires_locator rows).
  - deterministic statements: computeStatementFingerprint/computeLocatorFingerprint
    are proven deterministic (same inputs -> same hash) and input-sensitive
    (different inputs -> different hash) in the boundary spec; every statement is
    built only from already-read organizationId/sourceVersionId/fieldRows, never
    from caller input beyond the identity itself.
  - exact review/audience defaults: evidence_items' evidence_review_status,
    internal_only, public_use_allowed, funder_use_allowed, llm_processing_allowed,
    and product_learning_allowed are each pinned by their own CHECK constraint
    (needs_gk_review / true / false / false / false / false), proven by the
    schema-contract spec's "P2-01 pins data_class and every governance/allowed-use
    boolean to their fail-closed values" and the catalog verifier's CHECK_EXISTS
    rows.
  - queue idempotency: ux_review_queue_items_p2_01_evidence_review_identity (a
    partial unique index scoped to queue_type='evidence_review', added from this
    package's own forward migration, never editing the accepted P1-06 file) proven
    by the schema-contract spec and the failure-checks'
    evidence_review_identity_unique_enforced row; "P2-01 (a)" (integration) proves
    exactly one open queue item per evidence item on first creation.
  - replay: "P2-01 (b)" (integration) proves a full identical replay performs zero
    new rows and zero new audit rows.
  - concurrency: "P2-01 (c)" (integration) proves two genuinely overlapping calls
    converge to one row set with exactly one audit row published between them,
    using the same beforeInsert-rendezvous-before-any-lock idiom P1-08 established.
  - rollback: "P2-01 (f)" x3 (integration) prove a rejected audit prepare, a
    synchronous publish throw, and a rejected publish promise each roll back every
    write.
  - disabled zero-side-effects: "P2-01 (g)" (integration) proves feature_disabled
    with zero rows created when KAI_EVIDENCE_LINEAGE_ENABLED is unset.
  - prohibited-data exclusion: catalog verifier's NO_RAW_CONTENT_COLUMN rows prove
    neither new table carries a raw-content/sample-value/storage-pointer/
    unrestricted free-text column; the audit metadata branch CHECK forbids
    'statement'/'statement_fingerprint' keys (proven by the smoke verifier's
    audit_metadata_forbids_statement_keys row and the integration spec's exact-
    ten-key assertion); the repository never reads a raw object, raw row, sample,
    excerpt, storage URI, signed URL, credential, prompt, or private path anywhere
    in its code.

diff_checks: TOOL_VERIFIED
  - git diff --check: clean (no whitespace errors)
  - git diff --cached --check: clean (no whitespace errors)
  - complete staged diff inspected line by line: 20 files changed, 4339
    insertions(+), 0 deletions(-) - entirely additive. Three pre-existing files
    touched, all additive-only: package.json (+1 script line),
    Backend/kai/config/kaiSprint2Config.js (+15, two new exported functions, zero
    lines removed from any existing export), Backend/kai/db/kaiIntakeQueries.js
    (+176, seven new exported functions plus two doc-comment wording fixes on the
    two new functions' own comments to avoid a literal "ON CONFLICT" phrase that
    tripped an unrelated repository-wide invariant test; zero lines removed from
    any existing export). No P1-01 through P1-09 migration, rollback, repository,
    service, script, runbook, or test file appears anywhere in the diff. No
    evidence/locator/claim/graph-relationship/assistant-tool/generation/client-
    review/export identifier appears anywhere in the diff beyond this package's
    own declared scope.

final_commit_hash: report after commit; a commit cannot contain its own SHA

final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no route, UI, claim, assistant tool, graph relationship, generation logic,
    external-audience use, cloud configuration, deployment, feature enablement,
    production or real-client-data behavior, record-ID or redacted-extract
    locator, or P2 package beyond P2-01 was implemented
  - neither KAI_SPRINT2_ENABLED nor KAI_EVIDENCE_LINEAGE_ENABLED had its default
    changed anywhere in non-test code; both remain default false
  - no accepted P1-01 through P1-09 contract element, exported signature,
    validator key, identity key, vocabulary, or file was changed
  - no test was weakened, skipped, disabled, or deleted; one pre-existing
    integration subtest that had no reachable real-row failure mode (given P1-05's
    own CHECK constraints) was replaced with a comment documenting why, pointing
    to the equivalent synthetic-row coverage that already exists in the boundary
    spec - it was not simply removed to make the suite pass
  - did not fetch, pull, push, merge, rebase, reset, cherry-pick, or rewrite
    history; did not begin another package, propose another prompt, or start
    another review cycle

user_confirmed_starting_assumptions:
  - the owner-supplied bounded-implementation scope and required-behavior
    specification described in the originating prompt, none of which was
    independently re-derived from a quoted governing source during this turn
    beyond fresh repository/test inspection

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  production_metadata_only_audit_provider_for_the_extraction_service:
    NOT_CONFIRMED - no such provider exists in this repository and P2-01
    introduces none; the extraction service is additionally unreachable while
    KAI_EVIDENCE_LINEAGE_ENABLED remains default false
```

## KAI P2-01C — Evidence contract and PostgreSQL isolation correction (appended, additions-only)

Bounded correction applied on top of the accepted P2-01 package above. Nothing in
the P2-01 section preceding this one was edited; this block only records what
P2-01C changed and why.

```yaml
p2_01c_made:
  evidence_contract:
    - removed the unlocated `dictionary_field_count_fact` aggregate evidence
      type; `evidence_type` is now pinned to the single value
      `dictionary_field_presence_fact`; `evidence_items_p2_01_locator_binding_check`
      is removed as unnecessary now that `source_locator_id` is unconditionally
      `NOT NULL`
    - added `source_id` (NOT NULL), `sensitivity_level` (copied verbatim from the
      authoritative `kai.data_dictionary_fields.sensitivity` value, pinned to
      that column's own existing single vocabulary value `'unknown'`), and
      `support_strength` (pinned to `'unassessed'`) to `kai.evidence_items`
    - enforced organization_id + source_id + source_version_id as one
      tenant-safe lineage tuple: added `source_versions_p2_01_id_source_org_unique`
      to the existing P1-08 `kai.source_versions` table, and widened
      `evidence_items_p2_01_source_version_fk` from a two-column
      `(source_version_id, organization_id)` foreign key to the three-column
      `(source_version_id, source_id, organization_id)` composite - independent
      single- or two-column foreign keys could not by themselves prove the
      stored source_version belongs to the stored source and organization
    - added a fixed, disclosed `required_action` ("Review the evidence item's
      lineage, sensitivity, support strength, and audience eligibility before
      use.") to every fresh `evidence_review` review-queue item, and a new
      `review_queue_items_p2_01_evidence_review_required_action_check`
      constraint requiring `required_action` to be present, non-blank, and
      within the existing 1-2000 character bound for `queue_type =
      'evidence_review'` rows only, mirroring the exact P1-06
      `sensitivity_review` precedent; no other queue_type is affected
  feature_gate:
    - removed `KAI_EVIDENCE_LINEAGE_ENABLED`,
      `isKaiEvidenceLineageEnabled`, and
      `areKaiSprint2EvidenceLineageFeaturesEnabled` from
      `Backend/kai/config/kaiSprint2Config.js`, and every test/doc reference to
      them; P2-01 is now gated by `KAI_SPRINT2_ENABLED` alone and remains
      dormant because it has no route, worker, listener, or production
      composition
  replay_and_post_write_validation:
    - `Backend/kai/dictionary/postgresEvidenceLineageRepository.js` and its
      integration suite now authoritatively verify the corrected contract on
      every write and replay: the exact organization/source/source-version/
      locator tuple, evidence_type, data_class, copied sensitivity_level,
      support_strength = unassessed, review_status = needs_gk_review,
      internal-only posture, all four audience gates false, and the exact
      evidence_review required_action
    - a malformed or pre-correction partial row (an evidence item with no
      matching evidence_review queue item) returns
      `conflict_current_state_changed` and is never accepted as replay,
      exercised directly against a real committed row in the integration suite
  postgresql_isolation:
    - `postgresEvidenceLineageRepository.js` no longer statically imports
      `Backend/kai/db/kaiDb.js` at module load; its default transaction runner
      is now a deferred `await import(...)`, reached only when a caller does
      not inject its own `runInTransaction`
    - `__tests__/kai-sprint2-p2-01-evidence-lineage.integration.spec.js`
      validates `KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL` as loopback-only
      synchronously before any dynamic import, never imports `kaiDb.js`, and
      runs every repository call through a test-local `withTestTransaction`
      wrapper over its own runner-owned `Pool` - proving ambient
      `DATABASE_URL` is ignored, a non-loopback URL is rejected before any
      connection attempt, and direct execution without the runner-owned URL
      performs zero database activity
  not_touched:
    - no P1 package's accepted migration, rollback, repository, service,
      validator, or test file was edited
    - no route, worker, listener, or production composition was added; P2-01
      remains dormant

commands:
  - focused P2-01 suite (schema-contract, boundary, integration skip-path,
    runner-self-test): TOOL_VERIFIED
  - P2-01 ephemeral PostgreSQL verifier/integration runner
    (`npm run verify:kai-sprint2-p2-01-evidence-lineage`): TOOL_VERIFIED
  - P1-08 PostgreSQL verifier (`npm run verify:kai-sprint2-p1-08-source-promotion`):
    TOOL_VERIFIED
  - complete Sprint 2 suite: TOOL_VERIFIED
  - complete repository suite: TOOL_VERIFIED
  - git diff --check / git diff --cached --check: TOOL_VERIFIED, no whitespace
    errors

user_confirmed:
  - the prior unintended database selection reported ahead of this correction
    is recorded as USER_CONFIRMED; its effects on that database are
    NOT_CONFIRMED - this correction did not connect to, inspect, or repair any
    remote database

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  prior_unintended_database_selection_effects: NOT_CONFIRMED
```

## KAI P2-02 — Deterministic evidence-coverage-assessment foundation

```text
timestamp_local: 2026-08-06 (local session clock, not independently verified)
branch: codex/kai-sprint2-p0-v0.3.5
package: KAI P2-02 - deterministic evidence-coverage assessment foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 782797
  sha256: 74a45c49b26b7b4b0c696be00d2201420fbfb956d95d90aeb291c289459e4f20
  preserved_copy: not made - this append is a single Edit tool call matching the
    exact trailing bytes above, verified pre-image, no earlier byte rewritten
  prefix_proof: the byte_count/sha256 above were computed against the file
    immediately before this block was appended; everything preceding this
    section is byte-for-byte the accepted P2-01/P2-01C content

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: aaec422276830f3889e6155e54e0c014cb103f8d
  worktree: clean, including untracked files; staged paths: none

p2_02_made:
  - Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js (new):
    pure, no-SQL predicates and dimension-assessment functions.
    validateEvidenceCoverageAssessmentIsPermitted(rows) reuses P2-01's
    validateEvidenceHasSourceLineage wholesale (lineage completeness,
    promotion-status completeness, cross-row lineage equality, checksum
    completeness, and the reapplied P1-08 permission predicate), then adds
    exactly one P2-02-owned check: profileRow.allowed_use_status ===
    'not_allowed' fails closed with validation_blocker ('unknown'/'allowed' do
    not themselves block assessment). Ten pure dimension functions
    (assessMissingness, assessDuplicates, assessDefinitionClarity,
    assessDenominatorClarity, assessTimePeriodClarity,
    assessEntityLevelClarity, assessSmallCellRisk,
    assessConflictingSourceIndicators, assessRequirementAlignment,
    assessCoverageGaps) each return one createValidatorResult-shaped object
    (Backend/kai/validators/types.js, unchanged) with a three-state
    assessment_status ('resolved_clear' | 'resolved_risk_flagged' |
    'unresolved') embedded in evidence. missingness/duplicates only resolve
    from a committed kai.data_quality_findings row of the matching
    finding_type - absence never proves "no issue", so it stays unresolved.
    definition_clarity/entity_level_clarity read committed
    business_meaning/entity_level per field ('unknown' is the fail-closed
    schema default). small_cell_risk reads the committed
    small_cell_risk_status three-state fact directly. denominator_clarity and
    time_period_clarity are always unresolved - fresh repository inspection
    (this session) found no committed schema fact (P1-04/P1-05) for either
    concept anywhere in the current migrations. conflicting_source_indicators
    and requirement_alignment are always unresolved for the same reason:
    fresh inspection found no engagement/requirement table and no
    engagement/requirement foreign key anywhere in the schema (the sole
    engagement_id column, on kai.review_queue_items, is nullable with no FK to
    any requirement/engagement entity) - per instruction, this package never
    scans another source and never invents a requirement identity, mapping,
    or funder alignment to fill that gap. coverage_gaps compares committed
    data_dictionary_fields.profile_field_key values against the field keys
    already covered by committed P2-01 evidence_items (joined through their
    source_locators.coordinates.column_name) - never a sample, filename, or
    inferred mapping.
  - Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js
    (new): read-only, tenant-scoped repository. Reuses the existing P1-08/
    P2-01 getScoped* lookups (getScopedSourceVersionById,
    getScopedSourceById, getScopedSourceCandidateByIdentity,
    getScopedPromotionDecisionBySourceVersionId, getScopedDataDictionaryById)
    unchanged from Backend/kai/db/kaiIntakeQueries.js. Adds three new,
    package-owned, additive SQL reads local to this file only (no existing
    exported query in kaiIntakeQueries.js is touched):
    readSensitivityProfileForAssessment (the existing
    getScopedSensitivityProfileById projection plus the two P2-02-owned
    dimension columns it does not select: small_cell_risk_status,
    allowed_use_status), readDataDictionaryFieldsForAssessment (adds
    business_meaning/entity_level to the existing field projection, ordered
    profile_field_key ASC), readDataQualityFindingsForAssessment (ordered
    finding_type ASC, profile_field_key ASC), and
    readEvidenceCoverageFieldKeys (an evidence_items/source_locators join
    projecting only coordinates->>'column_name'). Runs every read inside one
    withTransaction callback via the same lazy-dynamic-import-of-kaiDb.js
    idiom P2-01C established, so no test importing this repository module
    ever import-time-initializes the ambient application pool. Performs no
    lock beyond what the reused getScoped* lookups already take, no write, no
    row mutation. A missing row anywhere in the lineage chain is returned as
    null, never fabricated and never silently skipped; readEvidenceCoverageAssessmentFacts
    applies no fail-closed judgment itself - that judgment belongs entirely to
    the validators module, called by the service, over the rows this
    function returns.
  - Backend/kai/services/kaiEvidenceCoverageAssessmentService.js (new):
    orchestration service. Input is exactly {organizationId, sourceVersionId,
    actorContext} (allowlist rejection of any other key, following the exact
    isExtractEvidenceFromSourceVersionInput idiom P2-01 already uses).
    KAI_SPRINT2_ENABLED is checked first, before any other validation or
    repository call - disabled returns feature_disabled with zero repository
    calls. No package-specific feature flag is added: like P2-01, this
    package has no route, worker, listener, or production composition, so it
    stays dormant under KAI_SPRINT2_ENABLED alone. Reapplies AUTH-KAI-003
    (mapped-human-actor-only, no bypass for any ai/system/import/code actor),
    then validateActorCanPerformOperation with a novel operation string
    ("assess_evidence_coverage") and explicit allowedRoles
    {gk_admin, gk_operator, gk_reviewer} (mirrors P2-01's
    EVIDENCE_LINEAGE_ALLOWED_ROLES exactly), then
    validateTenantBoundaryConsistency, exactly mirroring P2-01's own
    authorization sequence and its exact tenant_boundary_violation error-code
    mapping on any auth failure. Calls the repository, then
    validateEvidenceCoverageAssessmentIsPermitted over the returned rows, then
    computes and returns all ten dimension results fresh, on every call, from
    already-committed rows. No claim, coverage-gap write, conflict write,
    follow-up, queue, or audit persistence of any kind is implemented; nothing
    this service returns is ever written back to the database.
  - __tests__/kai-sprint2-p2-02-evidence-coverage-assessment-boundary.spec.js
    (new): 29 focused, no-DB tests covering
    validateEvidenceCoverageAssessmentIsPermitted (reused P2-01 lineage gate
    plus the new allowed_use_status check), all ten pure dimension functions,
    and the service's full authorization/gating sequence (feature-disabled,
    unknown/missing input keys, non-human actor, cross-org membership, role
    exclusion, not_found propagation, stale-lineage fail-closed,
    allowed_use_status fail-closed, and a full ten-dimension composed
    result), using an injected fake repository dependency - no database
    activity.
  - __tests__/kai-sprint2-p2-02-evidence-coverage-assessment.integration.spec.js
    (new): PostgreSQL-backed integration suite, following the exact P2-01C
    isolation pattern (KAI_P2_02_EVIDENCE_COVERAGE_ASSESSMENT_DATABASE_URL
    gate, synchronous loopback-only URL check before any dynamic import,
    self-test asserting no top-level database import and no import of
    Backend/kai/db/kaiDb.js, a test-local withRunnerOwnedTransaction wrapper
    over its own runner-owned Pool). Seeds its own fully promoted P1-08
    source_version fixtures (parameterized dictionary field
    business_meaning/entity_level, quality findings, sensitivity-profile
    small_cell_risk_status/allowed_use_status, and P2-01
    evidence_items/source_locators for partial field coverage) and proves:
    (a) the repository reads exactly the committed facts seeded; (b) the
    service composes those facts into all ten dimension results end to end;
    (c) a source_version in a different organization is never read across
    the tenant boundary (an all-null/empty read, not an error); (d)
    allowed_use_status 'not_allowed' fails the service closed even though the
    repository read itself succeeds; (e) a non-existent source_version_id
    returns not_found with an all-null read, never a fabricated fact.
  - scripts/kai-sprint2-p2-02-evidence-coverage-assessment-local-postgres.js
    (new): ephemeral-PostgreSQL-16 runner, following the exact P2-01 runner
    idiom (initdb/pg_ctl/psql/createdb resolved from PG_BIN_DIR or the
    Homebrew postgresql@16 default, proveRunnerOwnedTarget loopback/version
    check). Applies the same migration chain the P2-01 runner already applies
    (through kai_sprint2_p2_01_evidence_lineage.sql) - no new migration,
    verifier.sql, failure-checks.sql, or smoke-seed.sql is added, because
    P2-02 introduces no schema change and this package's own integration spec
    seeds every fixture its assertions depend on. Runs only this package's own
    integration spec against the ephemeral database, then tears the database
    down unconditionally in a finally block.
  - package.json: added exactly one new script entry,
    "verify:kai-sprint2-p2-02-evidence-coverage-assessment", pointing at the
    new runner script above. No existing script entry changed.

not_made_by_this_package:
  - no migration or schema change of any kind
  - no route, controller, or UI of any kind
  - no assistant tool or generation path of any kind
  - no validateClaimHasLoadBearingEvidence, validateUnsupportedClaimPromotion,
    or validateClaimRequirementCoverage
  - no claim, claim status, or claim persistence of any kind
  - no coverage, gap, conflict, follow-up, queue, or audit write of any kind
  - no feature flag beyond the existing, reused KAI_SPRINT2_ENABLED
  - no change to any existing exported function in
    Backend/kai/db/kaiIntakeQueries.js, Backend/kai/errors/kaiErrors.js,
    Backend/kai/validators/types.js, Backend/kai/validators/tenantValidators.js,
    Backend/kai/auth/kaiAuthorizationService.js,
    Backend/kai/validators/kaiEvidenceLineageValidators.js,
    Backend/kai/dictionary/postgresEvidenceLineageRepository.js, or
    Backend/kai/services/kaiEvidenceLineageService.js
  - no read of kai.intake_file_profiles.profile, any raw sample value, any
    storage location, signed URL, credential, prompt, or unrestricted audit
    metadata
  - no deployment, feature enablement, or real-data handling of any kind

commands: TOOL_VERIFIED
  - `node --test __tests__/kai-sprint2-p2-02-evidence-coverage-assessment-boundary.spec.js`
    -> 29/29 pass, 0 fail
  - `npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment` (ephemeral
    PostgreSQL 16, KAI_P2_02_EVIDENCE_COVERAGE_ASSESSMENT_DATABASE_URL-gated
    integration suite) -> 7/7 pass, 0 fail (2 isolation self-tests + 5
    PostgreSQL-backed repository/service tests)
  - `npm run verify:kai-sprint2-p2-01-evidence-lineage` (P2-01 PostgreSQL
    verifier, unaffected by this package) -> 17/17 pass, 0 fail
  - focused affected-area suite (authorization, tenant, P1-04, P1-05, P2-01
    boundary/schema-contract/runner-self-test files) -> 127/127 pass, 0 fail
  - `npm run test:kai-sprint2` (complete Sprint 2 suite) -> 1323 tests, 1313
    pass, 0 fail, 10 skipped (pre-existing DB-gated skips, unrelated to this
    package)
  - `npm test` (complete repository suite) -> 1428 tests, 1418 pass, 0 fail,
    10 skipped (same pre-existing DB-gated skips)
  - `git diff --check` -> clean, no whitespace errors
  - `git diff --cached --check` -> clean, no staged paths at time of check

proof_of_required_behavior: TOOL_VERIFIED
  - exact three-key input, unknown-key rejection: boundary spec "rejects an
    unknown input key" / "rejects a missing required key"
  - KAI_SPRINT2_ENABLED required before any repository activity, no package-
    specific flag added: boundary spec "KAI_SPRINT2_ENABLED gates every
    repository call - disabled returns feature_disabled with zero repository
    calls"
  - ten fixed dimensions assessed, each from committed facts only: boundary
    spec's ten per-function tests plus the full-composition test; integration
    (b)
  - unknown/absent facts remain unresolved, never inferred: assessMissingness/
    assessDuplicates "no committed finding stays unresolved, never inferred
    from absence"; assessDenominatorClarity/assessTimePeriodClarity/
    assessConflictingSourceIndicators/assessRequirementAlignment "always
    unresolved" tests
  - cross-source conflict / requirement alignment never scan another source
    or invent an identity: both functions take no repository-sourced
    parameter at all and are proven constant-unresolved by boundary tests;
    the ExecPlan text above records the fresh-inspection finding of no
    committed engagement/requirement relationship
  - fail-closed on missing/stale/cross-tenant/incompatible/not-current
    lineage: boundary + integration tests reusing/extending the exact P2-01
    validateEvidenceHasSourceLineage checks
  - fail-closed when sensitivity/allowed-use facts prohibit internal
    assessment: boundary + integration "allowed_use_status 'not_allowed'
    fails closed" tests
  - reuse of existing vocabularies, no new claim/requirement semantics: no
    new error code, severity, or validator-result shape is introduced;
    createValidatorResult (Backend/kai/validators/types.js) and buildKaiError
    (Backend/kai/errors/kaiErrors.js) are used unchanged
  - no raw object/PII/sample/storage/signed-URL/credential/prompt/audit
    exposure: the repository projects only the columns each read function
    explicitly SELECTs (never kai.intake_file_profiles.profile), and the
    service response only ever includes ids, the canonical sha256, and the
    ten createValidatorResult-shaped dimension objects

diff_checks: TOOL_VERIFIED
  - `git diff --check` -> clean
  - `git diff --cached --check` -> clean
  - `git status --porcelain=v1 --untracked-files=all` before commit: 1
    modified file (package.json, +1 line) and 6 new untracked files (the
    three Backend/kai/* modules, two __tests__/*.spec.js files, and the one
    scripts/*-local-postgres.js runner) - no other path touched

final_commit_hash: report after commit
final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no push, merge, or deploy of any kind
  - no claim proposal or P2-03 work begun
  - no other package proposed
  - no reopening of P2-01 (P2-01/P2-01C content above this block is
    unmodified; this package only reuses P2-01's already-accepted
    validateEvidenceHasSourceLineage and getScoped* exports)
  - no schema or migration change
  - no route or UI
  - no assistant tool or generation path
  - no validateClaimHasLoadBearingEvidence, validateUnsupportedClaimPromotion,
    or validateClaimRequirementCoverage
  - no claim, claim status, or claim persistence
  - no coverage/gap/conflict/follow-up/queue/audit write
  - no feature flag added
  - no deployment, feature enablement, or real-data handling

user_confirmed_starting_assumptions:
  - branch/HEAD/worktree preflight state (see preflight above) matched the
    expected state given at task start; proceeded directly per instruction

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  prior_unintended_database_selection_effects: NOT_CONFIRMED
  remote_execution_environment_parity: NOT_CONFIRMED
```

## KAI P2-03 — Deterministic claim-proposal foundation

```text
timestamp_local: 2026-08-06 (local session clock, not independently verified)
branch: codex/kai-sprint2-p0-v0.3.5
package: KAI P2-03 - deterministic claim-proposal foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 798930
  sha256: 3ac7c0fd5a843e3567fb11a33cb9ba6f0840f0f02a0733b1f8d2e9565b2dadb8
  preserved_copy: not made - this append is a single Edit tool call matching the
    exact trailing bytes above, verified pre-image, no earlier byte rewritten
  prefix_proof: the byte_count/sha256 above were computed against the file
    immediately before this block was appended; everything preceding this
    section is byte-for-byte the accepted P2-01/P2-01C/P2-02 content

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 650523dbb5404a7804685a7dbb7e0646296054d3
  worktree: clean at task start, including untracked files; staged paths: none

p2_03_made:
  - migrations/kai_sprint2_p2_03_claim_proposal.sql (new, 486 lines) and
    .rollback.sql (new, 282 lines): creates kai.claims (claim_id,
    organization_id, evidence_item_id, claim_type, claim_status,
    claim_review_status, claim_strength, statement, statement_fingerprint,
    internal_only, public_use_allowed, funder_use_allowed,
    llm_processing_allowed, product_learning_allowed, export_ready,
    created_by, created_by_type, created_at) and kai.claim_evidence_links
    (claim_evidence_link_id, organization_id, claim_id, evidence_item_id,
    created_by_type, created_at) as two canonical, previously-untracked
    tables, precisely copying the P2-01 evidence_items/source_locators
    structural idiom (owner-decision comment blocks, tenant-safe composite
    FKs, single-value-pinned CHECK constraints, sha256-shaped fingerprint
    CHECK, statement safe-content/length CHECK reusing P2-01's exact
    denylist regex). claim_type/claim_status/claim_review_status/
    claim_strength are each pinned to a single literal
    ('finding'/'proposed'/'needs_gk_review'/'unassessed'); internal_only is
    pinned true; public_use_allowed/funder_use_allowed/
    llm_processing_allowed/product_learning_allowed/export_ready are each
    pinned false. claims_p2_03_evidence_item_fk is a tenant-safe composite
    FK to kai.evidence_items(evidence_item_id, organization_id);
    claims_p2_03_identity_unique is the idempotency identity (organization_id,
    evidence_item_id, claim_type). kai.claim_evidence_links carries its own
    composite FKs to both kai.claims and kai.evidence_items, an identity-
    unique constraint (organization_id, claim_id, evidence_item_id), and
    claim_evidence_links_p2_03_one_link_per_claim_unique (organization_id,
    claim_id) pinning today's cardinality to exactly one link per claim -
    kept as its own standalone junction table (not merely a column on
    kai.claims) because "canonical claim-to-evidence links" is listed as its
    own distinct deliverable from "canonical claims persistence"; no column
    or feature enabling multiple links is added. Adds
    ux_review_queue_items_p2_03_claim_review_identity (a partial unique index
    on kai.review_queue_items scoped to queue_type = 'claim_review') and
    review_queue_items_p2_03_claim_review_required_action_check, mirroring
    the exact P1-06/P2-01 precedent - 'claim_review' was already an accepted
    queue_type literal in the P1-06 migration
    (review_queue_items_p1_06_queue_type_check), unused until this package;
    that constraint is never touched. Extends
    upload_lifecycle_audit_gate_a_operation_check with the new
    'claim_proposed' literal and upload_lifecycle_audit_gate_a_metadata_object_check
    with a new metadata branch (twelve allowlisted keys: metadata_only,
    contract, evidence_item_id, claim_id, claim_type, claim_status,
    claim_review_status, requirement_coverage_status, warning_count,
    review_queue_item_count, fresh_write_count, validator_key; explicitly
    forbids a 'claim_statement' key), preserving every earlier operation
    branch verbatim including P2-01's own 'evidence_lineage_extracted'. The
    migration's own preflight DO block guards on
    kai.evidence_items/kai.source_locators/kai.intake_source_candidates/
    kai.intake_promotion_decisions/kai.review_queue_items/
    kai.upload_lifecycle_audit/kai.gate_a_p0_jsonb_metadata_only/
    evidence_items_p2_01_id_org_unique all existing first. The rollback
    removes only kai.claim_evidence_links/kai.claims (child-first), the
    partial unique index, the required_action CHECK, and the P2-03 audit
    rows/branch, restoring the exact prior audit constraints - it alters no
    Gate A through P2-01 table, column, or constraint beyond that
    restoration.
  - Backend/kai/db/kaiIntakeQueries.js (additive, +118 lines): added
    getScopedEvidenceItemById, getScopedSourceLocatorById,
    getScopedClaimByEvidenceIdentity, getScopedClaimEvidenceLinkByClaimId,
    getScopedClaimReviewQueueItemByClaimId. No existing exported function's
    signature or behavior in this file was changed.
  - Backend/kai/validators/kaiClaimProposalValidators.js (new, 221 lines):
    pure, no-SQL predicates. validateClaimHasLoadBearingEvidence(rows)
    requires complete tenant-safe evidence/source/version/locator lineage
    (all seven rows present, cross-row organization_id equality, evidence
    item's own source_locator_id/source_id/source_version_id matching the
    rows read for it, locator/source_version/source cross-binding
    consistency, candidate/decision promoted-status completeness, decision
    bound to the exact source/source_version, source_version bound to the
    exact candidate, and the evidence_review pair's immutable identity
    match) - missing rows -> not_found; any lineage mismatch -> conflict;
    non-promoted candidate/decision -> validation_blocker; passing returns
    {ok:true, warnings:[...]} with exactly one warning while the evidence
    item's own support_strength stays 'unassessed' or the evidence_review's
    review_status stays unresolved (intentional and always-true in this
    package's current world, since P2-01 only ever creates evidence in that
    exact state). validateUnsupportedClaimPromotion(writePlan) is a
    fixed-shape assertion over the literal write-plan constants this
    package is about to write (never over caller input) - a real, testable
    guard against a future accidental change to those constants;
    passes only for the exact allowed proposed/needs_gk_review/unassessed/
    internal-only/no-audience-gate/no-export-ready shape, otherwise
    validation_blocker. validateClaimRequirementCoverage() takes no
    parameters and always returns {ok:true, warnings:[one unresolved
    requirement-coverage warning]} - it never creates or infers a
    requirement identity, existing solely so a later package can replace it
    without changing the service's call shape. Uses the boolean-gate return
    shape from Backend/kai/validators/kaiEvidenceLineageValidators.js,
    adapted with an added warnings array of createValidatorResult-shaped
    objects (Backend/kai/validators/types.js, unchanged) - the P2-02
    dimension-assessment shape (assessment_status embedded in evidence) was
    considered and rejected as not fitting a validate-before-write boolean
    gate.
  - Backend/kai/dictionary/postgresClaimProposalRepository.js (new, 725
    lines): the only authorized location for P2-03's own SQL and row
    locking. proposeClaim(input): validates its own allowlist
    (organizationId, evidenceItemId, actorUserId, now, metadataOnlyAudit);
    inside one transaction, calls beforeInsert() first (before any read or
    lock, matching the exact P1-08/P2-01 precedent), then reads
    (unlocked, read-only) the evidence item, its locator, source,
    source_version, then locks the candidate FOR UPDATE via the reused
    getScopedSourceCandidateByIdentity (the real serialization point,
    exactly like P1-08/P2-01's own precedent - no new lock is taken), reads
    the promotion decision and the evidence_review queue item pair; a
    missing row at any of those seven reads returns not_found. Runs the
    three validators in order, aborting on the first ok:false with that
    code, zero mutation, zero audit for every failure path. Composes the
    claim statement deterministically from
    locatorRow.coordinates.column_name and locatorRow.locator_fingerprint
    only (never from evidenceItemRow.statement) and its sha256 statement
    fingerprint from organizationId|evidenceItemId|claimType|statement.
    Inserts the claim via INSERT ... ON CONFLICT (organization_id,
    evidence_item_id, claim_type) DO NOTHING RETURNING; on a lost race,
    rereads via getScopedClaimByEvidenceIdentity and throws
    ConcurrentStateChangedError if the reread row's statement_fingerprint
    does not match what this call would have written (genuine identity
    drift, never a silent replay). Reapplies the exact P1-07/P2-01
    partial-replay-repair correction: the claim_evidence_links insert and
    the claim_review queue-item insert are both gated strictly on THIS
    call's own isFreshlyCreated result for the claim, never on "a link or
    queue item happens to be missing" - each uses its own
    ON CONFLICT ... DO NOTHING RETURNING (the queue-item insert's ON
    CONFLICT clause carries the identical WHERE queue_type = 'claim_review'
    predicate the partial index requires, reapplying the exact P2-01
    ExecPlan-documented arbiter-inference lesson), and a lost race on either
    is a ConcurrentStateChangedError, never a silent repair-insert. Runs
    verifyPostWriteContract on the claim/link/queue rows now in hand
    (whether freshly inserted or reread on replay) - organization_id,
    evidence_item_id, claim_type, statement, statement_fingerprint,
    claim_status, claim_review_status, claim_strength, every audience-gate
    boolean, the link identity, and the claim_review identity + non-blank
    required_action; any mismatch throws MalformedInsertedRowError
    (system_error, rolled back). On full replay (isFreshlyCreated === false)
    returns immediately with zero audit. On a fresh write, resolves the
    upload_state via candidateRow.intake_file_id (the identical resolution
    path P2-01 already uses via the reused candidateRow), calls
    prepareRequiredAudit (the identical own-boolean-data-property predicate
    copied from P1-05 through P2-01), inserts the audit row, and publishes -
    any rejection, synchronous throw, or rejected promise rolls back
    everything (raised as an error inside the transaction, never returned).
    The default runInTransaction is a deferred `await
    import("../db/kaiDb.js")`, never a static top-level import, reapplying
    the exact P2-01C PostgreSQL-isolation correction.
  - Backend/kai/services/kaiClaimProposalService.js (new, 116 lines):
    proposeClaim(input, dependencies). Input allowlist is exactly
    {organizationId, evidenceItemId, actorContext, now} - an unknown or
    missing key is rejected as validation_blocker before any repository
    call. Checks isKaiSprint2Enabled first (no package-specific flag is
    added - like P2-01/P2-02, this package has no route, worker, listener,
    or production composition, so it stays dormant under
    KAI_SPRINT2_ENABLED alone). Reapplies AUTH-KAI-003 (mapped-human-actor-
    only, isMappedHumanActor - no bypass for any ai/system/import/code
    actor), then validateActorCanPerformOperation with the operation string
    "propose_claim" and explicit allowedRoles {gk_admin, gk_operator,
    gk_reviewer} (mirrors P2-01's EVIDENCE_LINEAGE_ALLOWED_ROLES exactly),
    then validateTenantBoundaryConsistency, exactly mirroring P2-01's own
    authorization sequence and its exact tenant_boundary_violation
    error-code mapping on any auth failure. A role without active tenant
    membership is rejected by validateActorCanPerformOperation's own
    membership check - not reimplemented or weakened here. Forwards only
    organizationId/evidenceItemId/actorUserId/now/metadataOnlyAudit to the
    injected repository; contains no SQL and imports no database pool
    directly.
  - __tests__/kai-sprint2-p2-03-claim-proposal-schema-contract.spec.js (new,
    165 lines, 17 tests): asserts the migration's preflight guards, full
    column lists, every single-value-pinned CHECK (claim_type through
    export_ready), the statement length/safe-content/fingerprint CHECKs,
    the tenant-safe composite FK, the identity-unique constraints, the
    one-link-per-claim constraint, the claim_review partial unique index and
    required_action CHECK, the audit operation/metadata branch (twelve
    allowlisted keys, forbidding claim_statement), and that the rollback
    removes only P2-03 objects while preserving evidence_lineage_extracted
    and every Gate A through P2-01 table.
  - __tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js (new, 427
    lines, 27 tests): pure no-DB coverage of all three validators (pass with
    warning, pass with zero warnings, every missing-row/lineage-mismatch/
    non-promoted/evidence-review-incompatibility failure mode for
    validateClaimHasLoadBearingEvidence; every allowed-shape pass and every
    single-field deviation for validateUnsupportedClaimPromotion; the
    always-one-warning/zero-parameter contract for
    validateClaimRequirementCoverage), the service's full gating sequence
    (feature-disabled with zero repository calls, unknown/missing input key
    rejection, AUTH-KAI-003 non-human-actor rejection, no-active-membership
    rejection, exact five-key forwarding to the repository, no-SQL/no-pool
    self-check), and repository-level structural assertions (ON CONFLICT ...
    DO NOTHING RETURNING for all three inserts including the partial-index
    WHERE clause, no 23505 catch or in-process lock, isFreshlyCreated-gated
    link/queue writes, no raw-content/statement-in-audit leakage,
    deterministic composeClaimStatement/computeClaimStatementFingerprint,
    deferred-only kaiDb.js import, and allowlist rejection without opening a
    transaction).
  - __tests__/kai-sprint2-p2-03-claim-proposal-runner-self-test.spec.js (new,
    28 lines, 3 tests): assertNoFail FAIL-detection/PASS-passthrough/
    FAIL_CLOSED-substring-safety, copied from the established P2-01 pattern.
  - __tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js (new, 586
    lines, 14 tests + 2 isolation self-tests): PostgreSQL-backed integration
    suite following the exact P2-01C isolation pattern
    (KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL gate, synchronous loopback-only
    URL check before any dynamic import, self-test asserting no top-level
    database import and no import of Backend/kai/db/kaiDb.js, a test-local
    withRunnerOwnedTransaction wrapper over its own runner-owned Pool). Seeds
    its own fully promoted evidence-item fixtures (in a distinct 'c...' id
    namespace, avoiding any collision with chained smoke-seed fixtures) and
    proves: (a) first proposal creates the claim/link/queue-item/audit with
    the exact required_action, two intentional warnings, and the exact
    twelve-key audit metadata shape excluding claim_statement; (b) identical
    replay is a full no-op; (c) two genuinely overlapping proposal calls
    converge to one claim with exactly one audit row published between
    them; (d) tenant isolation; (e) an unknown evidence_item_id and a
    missing evidence_review queue item both return not_found with zero
    writes (with a documented NOTE explaining why the "incompatible pair"
    conflict branch has no reachable real-row failure mode at this
    integration layer - the repository's own lookup query already filters
    on the exact fields the compatibility check re-verifies, so that
    check's coverage lives entirely in the boundary spec, mirroring P2-01's
    own documented precedent for its check 9); (f) a rejected audit
    prepare, a synchronous publish throw, and a rejected publish promise
    all roll back every write; (g) disabled KAI_SPRINT2_ENABLED returns
    feature_disabled with zero DB activity; an end-to-end service-seam test
    proving AUTH-KAI-003 rejection through the real postgres repository; and
    a final catalog-verifier no-FAIL/no-duplicate-check-row proof.
  - scripts/kai-sprint2-p2-03-claim-proposal-verifier.sql (new, 194 lines):
    catalog verifier - table/column/not-null/no-raw-content/CHECK/FK/
    unique-constraint/partial-unique-index/audit-operation-and-metadata-
    branch existence proofs, following the exact P2-01 verifier structure.
  - scripts/kai-sprint2-p2-03-claim-proposal-failure-checks.sql (new, 326
    lines): a self-contained fixture chain (file -> profile -> dictionary ->
    sensitivity profile -> candidate -> promoted decision -> source ->
    source_version -> locator -> evidence item -> evidence_review queue
    item) inside one rolled-back transaction, proving rejection of: every
    claim_type/claim_status/claim_review_status/claim_strength deviation,
    every audience-gate-boolean-opening attempt (including export_ready),
    unsafe/over-length/malformed-fingerprint statement text, a cross-tenant
    evidence_item_id reference, a fabricated evidence_item_id, duplicate
    claim identity, duplicate/fabricated claim_evidence_links rows, and
    missing/blank claim_review required_action - twenty-one checks, all
    PASS via the expected exception class.
  - scripts/kai-sprint2-p2-03-claim-proposal-smoke-seed.sql (new, 52 lines):
    creates one real, committed 'column' locator + one real, committed
    'dictionary_field_presence_fact' evidence item (bound to field_1) + its
    matching open evidence_review queue item, against the already-promoted
    source_version the chained Gate A/P1-04 through P2-01 smoke seeds commit
    for candidate1 - needed because P2-01's own smoke verifier always rolls
    its own evidence-item/locator creation back, so no persisted P2-01 row
    exists for this package's own smoke verifier to propose a claim against
    otherwise.
  - scripts/kai-sprint2-p2-03-claim-proposal-smoke-verifier.sql (new, 271
    lines, 15 checks): inside one rolled-back transaction, proves claim/
    link/queue-item/audit creation, the exact claim_review required_action
    text, every audience-gate boolean closed, audit persistence, replay-by-
    identity, duplicate-identity rejection, sequential-within-session
    concurrent-insert convergence (true overlapping-transaction concurrency
    is proved by the integration spec/runner, not by this smoke verifier -
    the exact P2-01 division of labor), cross-tenant invisibility,
    transaction+audit atomicity via a forced-exception rollback, and three
    audit-metadata-safety checks (no raw content, exact twelve-key
    allowlist, no claim_statement key).
  - scripts/kai-sprint2-p2-03-claim-proposal-local-postgres.js (new, 147
    lines): ephemeral-PostgreSQL-16 runner
    (npm run verify:kai-sprint2-p2-03-claim-proposal), reusing the exact
    P2-01 runner idiom (initdb/pg_ctl/psql/createdb resolved from
    PG_BIN_DIR or the Homebrew postgresql@16 default,
    proveRunnerOwnedTarget loopback/version check). Applies the bootstrap
    schema, every Gate A through P2-01 migration (P2-02 added none), then
    this package's own migration; runs the catalog verifier and failure
    checks; runs every Gate A through P2-01 smoke seed (chained) then this
    package's own smoke seed and smoke verifier; runs this package's own
    integration spec with a scrubbed ambient-DB env; tears the ephemeral
    database down unconditionally in a finally block.
  - scripts/kai-sprint2-p2-03-claim-proposal-runner-assertions.js (new, 10
    lines): assertNoFail, copied verbatim from the established P2-01 file
    into this package's own file - not imported cross-package, matching the
    established per-package-copy convention (no shared module for this
    helper exists in the codebase).
  - scripts/kai-sprint2-p2-03-claim-proposal-runbook.md (new, 302 lines) and
    scripts/kai-sprint2-p2-03-claim-proposal-patch-notes.md (new, 173
    lines): package runbook and patch notes, following the exact P2-01
    structure/section headings.
  - package.json: added exactly one new script entry,
    "verify:kai-sprint2-p2-03-claim-proposal", pointing at the new runner
    script above. No existing script entry changed.

not_made_by_this_package:
  - no claim approval, promotion, or audience-widening of any kind
  - no evidence-review mutation of any kind (P2-03 only reads the
    evidence_review queue item; it never resolves, updates, or writes to it)
  - no engagement/requirement persistence, coverage/conflict/gap/follow-up
    persistence of any kind
  - no route, controller, or UI of any kind
  - no assistant tool or generation path of any kind
  - no external audience use/export of any kind
  - no widening of review_queue_items_p1_06_queue_type_check - 'claim_review'
    was already an accepted literal, unused until this package
  - no feature flag beyond the existing, reused KAI_SPRINT2_ENABLED
  - no change to any existing exported function in
    Backend/kai/db/kaiIntakeQueries.js, Backend/kai/errors/kaiErrors.js,
    Backend/kai/validators/types.js, Backend/kai/validators/tenantValidators.js,
    Backend/kai/auth/kaiAuthorizationService.js,
    Backend/kai/validators/kaiEvidenceLineageValidators.js,
    Backend/kai/dictionary/postgresEvidenceLineageRepository.js,
    Backend/kai/services/kaiEvidenceLineageService.js,
    Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js,
    Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js, or
    Backend/kai/services/kaiEvidenceCoverageAssessmentService.js
  - no read of kai.intake_file_profiles.profile, any raw sample value, any
    storage location, signed URL, credential, prompt, or unrestricted audit
    metadata
  - no deployment, feature enablement, or real-data handling of any kind

commands: TOOL_VERIFIED
  - `node --test __tests__/kai-sprint2-p2-03-claim-proposal-schema-contract.spec.js
    __tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js
    __tests__/kai-sprint2-p2-03-claim-proposal-runner-self-test.spec.js`
    -> 48/48 pass, 0 fail
  - `npm run verify:kai-sprint2-p2-03-claim-proposal` (ephemeral PostgreSQL
    16, catalog verifier, failure checks, smoke seed/verifier, and the
    KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL-gated integration suite) -> 14/14
    integration tests pass, 0 fail (2 isolation self-tests + 12
    PostgreSQL-backed repository/service/catalog tests); catalog verifier
    58/58 checks PASS; failure-checks 21/21 PASS; smoke verifier 15/15 PASS
  - `npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment` (P2-02
    PostgreSQL integration suite, unaffected by this package) -> 7/7 pass,
    0 fail
  - `npm run verify:kai-sprint2-p2-01-evidence-lineage` (P2-01 PostgreSQL
    verifier, unaffected by this package) -> 17/17 pass, 0 fail
  - `npm run test:kai-sprint2` (complete Sprint 2 no-DB suite) -> 1374 tests,
    1363 pass, 0 fail, 11 skipped (pre-existing DB-gated skips, unrelated to
    this package)
  - `npm test` (complete repository suite) -> 1479 tests, 1468 pass, 0 fail,
    11 skipped (same pre-existing DB-gated skips)
  - `git diff --check` -> clean, no whitespace errors
  - `git diff --cached --check` -> clean, no staged paths at time of check

proof_of_required_behavior: TOOL_VERIFIED
  - exact four-key service input, unknown/missing-key rejection: boundary
    spec "rejects an unknown input key" / "rejects a missing required key"
  - KAI_SPRINT2_ENABLED required before any repository activity, no
    package-specific flag added: boundary spec "KAI_SPRINT2_ENABLED
    disabled (or absent) returns feature_disabled with zero repository
    calls; no package-specific flag exists"
  - every claim column server-derived and fail-closed-pinned: schema-
    contract spec's pin assertions; integration (a)'s full field-by-field
    assertion on the returned claim record
  - claim statement derived only from locator coordinates, never from the
    evidence item's own statement text: boundary spec
    "composeClaimStatement is deterministic, derives only from column name
    and locator fingerprint, and never copies evidence statement text";
    integration (a)'s statement-shape assertion
  - evidence and evidence_review pair loaded and validated before any
    write, missing/incompatible pair fail-closed with zero mutation:
    integration (e) not_found tests; boundary spec's
    validateClaimHasLoadBearingEvidence coverage of every missing-row and
    lineage/pairing-mismatch scenario
  - three validators run in fixed order, first ok:false aborts before any
    write, warnings collected from every passing validator: repository
    source order; integration (a)'s warnings.length === 2 assertion
  - claim_review queue item created with the exact disclosed
    required_action, partial-unique-index-enforced: integration (a);
    smoke verifier "creation_claim_review_required_action_set"
  - idempotent replay is a full no-op, zero writes, zero audit: integration
    (b); smoke verifier "replay_reads_same_claim"
  - genuinely concurrent identical proposal converges via
    ON CONFLICT ... DO NOTHING RETURNING alone, never an app-level lock:
    integration (c); boundary spec's "resolves concurrency via ON CONFLICT"
    structural assertion
  - the P1-07/P2-01 partial-replay-repair correction reapplied for both the
    claim_evidence_links and claim_review writes: boundary spec "gates the
    link/queue-item writes strictly on THIS call's own isFreshlyCreated
    result"
  - required metadata-only audit, exactly twelve keys, claim statement text
    never included: integration (a)'s audit-metadata key-set assertion;
    smoke verifier's three audit-metadata-safety checks; schema-contract
    spec's audit metadata-branch assertion
  - a rejected audit prepare, a synchronous publish throw, or a rejected
    publish promise rolls back every write together: integration (f)
  - fail-closed on missing/stale/cross-tenant/incompatible lineage: boundary
    + integration tests reusing/extending the validator's fixed-order
    checks
  - AUTH-KAI-003 (human-actor-only) and VAL-TEN-001 (active tenant
    membership) reapplied unweakened: boundary spec's non-human-actor and
    no-active-membership rejection tests; integration's end-to-end
    AUTH-KAI-003 assertion via the real postgres repository
  - no raw content/PII/sample/storage/signed-URL/credential/prompt exposure:
    the repository only ever selects the columns each reused getScoped*
    function explicitly SELECTs; failure-checks/smoke-verifier's explicit
    denylist-regex assertions against the audit table

diff_checks: TOOL_VERIFIED
  - `git diff --check` -> clean
  - `git diff --cached --check` -> clean
  - `git status --porcelain=v1 --untracked-files=all` before commit: 2
    modified files (Backend/kai/db/kaiIntakeQueries.js and package.json,
    both additive-only) and 17 new untracked files (three Backend/kai/*
    modules, four __tests__/*.spec.js files, and ten
    scripts/kai-sprint2-p2-03-claim-proposal-* files) - no other path
    touched

final_commit_hash: report after commit
final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no push, merge, or deploy of any kind
  - no reopening of P2-01 or P2-02 (their own files above this block are
    unmodified; this package only reuses their already-accepted getScoped*
    exports and validator/lineage idioms)
  - no other package proposed or begun
  - no schema or migration change beyond the additive ALTER TABLE
    statements this package's own new migration file issues
  - no route or UI
  - no assistant tool or generation path
  - no claim approval, promotion, or audience-widening
  - no evidence-review mutation
  - no engagement/requirement persistence, coverage/conflict/gap/follow-up
    persistence
  - no feature flag added
  - no widening of review_queue_items_p1_06_queue_type_check
  - no deployment, feature enablement, or real-data handling

user_confirmed_starting_assumptions:
  - branch/HEAD/worktree preflight state (see preflight above) matched the
    expected state given at task start; proceeded directly per instruction

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  prior_unintended_database_selection_effects: NOT_CONFIRMED
  remote_execution_environment_parity: NOT_CONFIRMED
```

## KAI P2-03C — Current-source-version claim gate correction (appended, additions-only)

Bounded correction applied on top of the accepted P2-03 package above. Nothing in
the P2-03 section preceding this one was edited; this block only records what
P2-03C changed and why.

```yaml
timestamp_local: 2026-08-06 (local session clock, not independently verified)
branch: codex/kai-sprint2-p0-v0.3.5
package: KAI P2-03C - current-source-version claim gate correction
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 827621
  sha256: cce87e65601477de05255bac56399bb31512dba2b29d07b071c519847e90db46
  preserved_copy: not made - this append is a single Edit tool call matching the
    exact trailing bytes above, verified pre-image, no earlier byte rewritten
  prefix_proof: the byte_count/sha256 above were computed against the file
    immediately before this block was appended; everything preceding this
    section is byte-for-byte the accepted P2-01/P2-01C/P2-02/P2-03 content

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 540cfa4d6d24905c756fd8b36830e8682eae61d2
  worktree: clean, including untracked files; staged paths: none

defect:
  - the accepted P2-03 validateClaimHasLoadBearingEvidence
    (Backend/kai/validators/kaiClaimProposalValidators.js) required complete
    tenant-safe evidence/source/version/locator lineage, a promoted
    candidate/decision, and a compatible evidence_review pair, but never
    required the loaded sourceVersionRow itself to remain the current version
    of its source - a claim could be proposed from evidence whose
    authoritative source_version had since been superseded, as long as every
    other row (evidence item, locator, source row, candidate, decision,
    evidence_review item) still existed, still referenced it, and the
    candidate/decision remained promoted

p2_03c_made:
  validator:
    - added a new check (renumbered check 8, moving the prior evidence_review-
      pair-compatibility check to 9) requiring
      `sourceVersionRow.is_current === true`; `false`, missing, or `null`
      returns `conflict_current_state_changed`, before any claim,
      claim-to-evidence link, claim_review queue item, audit row, or audit
      publication - mirrors P2-01's own equivalent current-source-version gate
      (Backend/kai/validators/kaiEvidenceLineageValidators.js)
  tests:
    - __tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js: added
      `is_current: true` to the default `validRows()` sourceVersionRow
      fixture (required for every pre-existing test in this file to keep
      passing under the new check), and two new focused tests -
      `is_current = false`/missing/`null` fails closed with
      `conflict_current_state_changed` regardless of every other row
      remaining promoted/referencing it, and `is_current = true` preserves
      both the existing warning and no-warning pass paths
    - __tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js: added
      one PostgreSQL integration test seeding an otherwise-valid promoted
      evidence item/evidence_review pair, setting its source_version's
      `is_current` to `false` before calling `repository.proposeClaim`, and
      proving `conflict_current_state_changed` with zero new `kai.claims`,
      `kai.claim_evidence_links`, or `claim_review` `kai.review_queue_items`
      rows, zero new `claim_proposed` `kai.upload_lifecycle_audit` rows, and
      zero audit publication
  docs:
    - scripts/kai-sprint2-p2-03-claim-proposal-runbook.md: documented the new
      current-source-version requirement in both the lineage-authority
      section and the VAL-KAI-P2-03-001 description
    - scripts/kai-sprint2-p2-03-claim-proposal-patch-notes.md: appended a
      "P2-03C correction" section recording the defect and the fix
  not_touched:
    - no migration, rollback, repository, or service file was edited - the
      repository already reads sourceVersionRow.is_current via the shared
      getScopedSourceVersionById helper (the same helper P2-01/P2-02 use);
      only the validator was under-checking the value already being read
    - no other P2-03 validator, write path, replay/idempotency behavior,
      audit contract, or queue-item contract was changed
    - P2-02 (accepted and closed) was not reopened or modified
    - no evidence-review identity redesign, queue foreign key, claim schema
      change, or missing-pair error-behavior change was made

commands:
  - focused P2-03 schema-contract, boundary, and runner-self-test suite
    (50 tests): TOOL_VERIFIED
  - P2-03 PostgreSQL verifier and integration suite
    (`npm run verify:kai-sprint2-p2-03-claim-proposal`, 15 integration tests
    plus the 15-row SQL smoke verifier): TOOL_VERIFIED
  - P2-02 PostgreSQL integration suite
    (`npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment`):
    TOOL_VERIFIED
  - P2-01 PostgreSQL verifier and integration suite
    (`npm run verify:kai-sprint2-p2-01-evidence-lineage`): TOOL_VERIFIED
  - complete Sprint 2 suite (`npm run test:kai-sprint2`): TOOL_VERIFIED - 1365
    pass, 0 fail, 11 skipped (Postgres-gated suites skip without a runner-owned
    DATABASE_URL env var; each ran green independently above)
  - complete repository suite (`npm test`): TOOL_VERIFIED - 1470 pass, 0 fail,
    11 skipped
  - git diff --check: TOOL_VERIFIED, clean
  - git diff --cached --check: TOOL_VERIFIED, clean

complete_diff_scope: Backend/kai/validators/kaiClaimProposalValidators.js,
  __tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js,
  __tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js,
  scripts/kai-sprint2-p2-03-claim-proposal-runbook.md,
  scripts/kai-sprint2-p2-03-claim-proposal-patch-notes.md, and this living
  ExecPlan correction block only

final_commit_hash: report after commit
final_worktree_and_staged_state: report after commit

prohibited_actions_not_performed:
  - no push, merge, or deploy of any kind
  - no reopening of P2-02 (its own section above is unmodified)
  - no other package proposed or begun; no P2-04 work
  - no schema, migration, or rollback change
  - no route, worker, listener, or production composition
  - no feature flag added or enabled
  - no evidence-review identity redesign, queue foreign key, or claim schema
    change

user_confirmed_starting_assumptions:
  - branch/HEAD/worktree preflight state (see preflight above) matched the
    expected state given at task start; proceeded directly per instruction

not_confirmed:
  deployment: NOT_CONFIRMED
  production_or_shared_database_state: NOT_CONFIRMED
  feature_enablement: NOT_CONFIRMED
  production_runtime_composition: NOT_CONFIRMED
  real_client_data_behavior: NOT_CONFIRMED
  prior_unintended_database_selection_effects: NOT_CONFIRMED
  remote_execution_environment_parity: NOT_CONFIRMED
```

## KAI P2-04 — Deterministic claim-gap and client-followup foundation

```yaml
timestamp_local: 2026-08-06 (local session clock, not independently verified)
branch: codex/kai-sprint2-p0-v0.3.5
package: KAI P2-04 - Deterministic claim gaps and client follow-up foundation
status: TOOL_VERIFIED

pre_append_execplan:
  byte_count: 834447
  sha256: e1f6f21e483e1408f7f3145e98afd924904861f32d43e0d01aa55d8728b915ff
  preserved_copy: not made - this append is a single Edit tool call matching the
    exact trailing bytes above, verified pre-image, no earlier byte rewritten
  prefix_proof: the byte_count/sha256 above were computed against the file
    immediately before this block was appended; everything preceding this
    section is byte-for-byte the accepted P2-01/P2-02/P2-03/P2-03C content

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: e28e019179f15cd1c4b49bd2d588eaabea79f77e
  worktree: clean at task start, including untracked files; staged paths: none

p2_04_made:
  - migrations/kai_sprint2_p2_04_claim_gap_followup.sql and .rollback.sql - creates
    kai.gap_log_items (organization_id, claim_id, evidence_item_id,
    source_version_id, dimension_key, assessment_status, validator_key,
    safe_summary, four metadata-safe count columns, created_by_type/created_at),
    kai.client_followup_items (organization_id, claim_id, gap_log_item_id,
    dimension_key, question_text, created_by_type/created_at), each with
    tenant-safe composite lineage foreign keys to kai.claims/kai.evidence_items/
    kai.source_versions/kai.gap_log_items, identity-unique constraints on
    organization_id+claim_id+dimension_key, dimension_key CHECK vocabularies
    (ten P2-02 keys for gap_log_items; the four client-answerable keys for
    client_followup_items), an assessment_status CHECK excluding
    resolved_clear, a safe_summary CHECK pinning the exact deterministic
    template, a question_text CHECK plus a dimension/question pairing CHECK
    pinning each of the four fixed questions to its own dimension, and a
    non-negative-counts CHECK. Adds
    ux_review_queue_items_p2_04_client_followup_identity (partial unique index,
    queue_type = 'client_followup' only, mirroring the P1-06/P2-01/P2-03
    precedent - 'client_followup' was already an accepted queue_type literal)
    and review_queue_items_p2_04_client_followup_contract_check (the complete
    fixed client_followup queue contract - target_object_type, queue_status,
    review_status, priority, summary, required_action, assigned_to, due_at -
    scoped to that queue_type only). Extends
    upload_lifecycle_audit_gate_a_operation_check and
    _metadata_object_check with the new claim_gap_and_followup_generated
    branch (twelve allowlisted keys; forbids question_text/summary/
    safe_summary), preserving every earlier branch verbatim. Guards on
    kai.claims/kai.evidence_items/kai.source_versions/kai.review_queue_items/
    kai.upload_lifecycle_audit and their P2-01/P1-08/P2-03 identity-unique
    constraints via a DO block; edits no earlier migration file.
  - Backend/kai/validators/kaiClaimGapFollowupValidators.js - new pure, no-SQL
    validator module. validateClaimGapLineage reuses (never forks)
    P2-03's validateClaimHasLoadBearingEvidence and P2-02's
    validateEvidenceCoverageAssessmentIsPermitted after its own claim/link
    identity check. validateClientFollowupRouting (VAL-KAI-P2-04-002) is the
    sole gate authorizing a follow-up plus its queue item: verifies the
    dimension is one of the four authorized keys, the gap is tenant/dimension-
    matched to the claim, the follow-up and queue write plans carry the exact
    fixed contract and no field beyond that allowlist. dimensionResultRequiresGap
    is the pure predicate (assessment_status !== 'resolved_clear') deciding
    gap creation, reused by the repository rather than reimplemented inline.
  - Backend/kai/dictionary/postgresClaimGapFollowupRepository.js - new
    repository, the only authorized location for P2-04 SQL other than reused
    getScoped* lookups. Reads claim/link/evidence/locator/source/
    source_version/candidate/decision/evidence_review lineage plus the exact
    P2-02-authoritative profile/dictionary/quality/evidence facts (three P2-02
    read helpers reused directly via postgresEvidenceCoverageAssessmentRepository.js's
    own exported testables, never P2-02's own transaction-opening seam),
    invokes the ten P2-02 dimension functions imported unmodified from
    kaiEvidenceCoverageAssessmentValidators.js, computes the complete
    deterministic expected gap/follow-up/queue-item set, precheck-reads
    existing state before any write, and returns empty/replayed/conflict or
    writes the complete set atomically via one multi-row INSERT ... ON
    CONFLICT ... DO NOTHING RETURNING statement per table (full-set overlap
    guarantees a clean all-or-nothing split under genuine concurrency, never a
    partial one - disclosed as this package's own concurrency-mechanism
    decision, generalizing P2-03's per-row pattern to a whole set) plus the
    required metadata-only claim_gap_and_followup_generated audit row, all in
    one transaction. Accepts an optional computeDimensions test-only override
    (parallel to the existing beforeInsert seam) used by the integration
    suite to exercise the all-resolved_clear/empty-expected-set path, since
    two of the ten P2-02 dimensions can never be resolved_clear from a real
    committed row and four more are unconditionally unresolved by P2-02's own
    design - a schema fact, not a P2-04 defect.
  - Backend/kai/services/kaiClaimGapFollowupService.js - new file exporting
    generateClaimGapFollowups(organizationId, claimId, actorContext, now).
    Feature-gates on KAI_SPRINT2_ENABLED alone (no package-specific flag),
    enforces AUTH-KAI-003 (mapped human actor only) and VAL-TEN-001 (active
    tenant membership, gk_admin/gk_operator/gk_reviewer), then delegates to
    the injected repository. No SQL, no database pool import, not composed
    into any route.
  - Backend/kai/db/kaiIntakeQueries.js (additive) - added getScopedClaimById
    (organization_id + claim_id primary-key lookup, distinct from P2-03's
    evidence-identity lookup). No existing exported function modified.
  - __tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js (31 tests),
    -schema-contract.spec.js (15 tests), -runner-self-test.spec.js (3 tests),
    .integration.spec.js (16 tests, PostgreSQL-backed) - focused coverage of
    validators, service input/auth gating, repository SQL-shape assertions,
    migration/rollback contract, and full end-to-end generation/replay/
    concurrency/conflict/audit-rollback/all-clear behavior.
  - scripts/kai-sprint2-p2-04-claim-gap-followup-{verifier,failure-checks,
    smoke-seed,smoke-verifier}.sql, -local-postgres.js,
    -runner-assertions.js, -runbook.md, -patch-notes.md - full verification
    pack mirroring the P2-01/P2-03 ephemeral-PostgreSQL-runner convention.
  - package.json (additive) - added verify:kai-sprint2-p2-04-claim-gap-followup.

commands:
  - node scripts/kai-sprint2-p2-04-claim-gap-followup-local-postgres.js ->
    TOOL_VERIFIED: catalog verifier 59/59 PASS, read-only failure checks 17/17
    PASS, smoke verifier 15/15 PASS, integration spec 16/16 pass (0 fail, 0
    skip)
  - npm run verify:kai-sprint2-p2-01-evidence-lineage -> TOOL_VERIFIED: 17/17
    pass
  - npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - npm run verify:kai-sprint2-p2-03-claim-proposal -> TOOL_VERIFIED: 15/15
    pass
  - node --test __tests__/kai-sprint2-p2-04-*.spec.js -> TOOL_VERIFIED: 51
    pass, 1 skip (integration spec self-skips outside the local-postgres
    runner), 0 fail
  - npm run test:kai-sprint2 -> TOOL_VERIFIED: 1416 pass, 12 skip, 0 fail
    (1428 total)
  - npm test (complete repository suite) -> TOOL_VERIFIED: 1521 pass, 12 skip,
    0 fail (1533 total)
  - git diff --check -> TOOL_VERIFIED: no whitespace errors
  - git diff --cached --check -> TOOL_VERIFIED: no whitespace errors

### P3-01 dormant cited evidence-summary draft foundation - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 5a76277693b268cc09c24b253d0edad120dbf069
  worktree: clean at task start, including untracked files; staged paths: none

p3_01_made:
  - Added dormant generated-content persistence substrate:
    kai.generation_runs, kai.generated_content_drafts,
    kai.generated_content_blocks, kai.generated_content_citations, and the
    generated_content_review queue contract.
  - Added createEvidenceSummaryDraft with KAI_SPRINT2_ENABLED ->
    KAI_GENERATION_ENABLED -> exact input validation -> mapped-human validation
    -> active tenant-membership/GK-role authorization -> lazy database-capable
    repository loading. KAI_GENERATION_ENABLED remains default false and no
    route, UI, assistant operation, provider, export, approval, or runtime
    generation wiring was added.
  - Added injected-only draftGenerator contract enforcement, deterministic
    request fingerprinting, PostgreSQL idempotency arbitration, complete
    replay/duplicate/malformed-state handling, rollback on generator,
    validator, post-write, audit-prepare, and audit-publication failures, and
    transaction-scoped revalidation through the accepted P2-06 evaluator.
  - Added VAL-GEN-001 through VAL-GEN-005 structured validator results covering
    exact audience eligibility, citation resolution, unauthorized references,
    numeric/causal assertion support, and audience authority.
  - Added the P3-01 forward migration, rollback, verifier, focused injected
    tests, and runner-owned loopback PostgreSQL suite.

disclosed_local_identifiers:
  generation_flag: KAI_GENERATION_ENABLED
  service: createEvidenceSummaryDraft
  content_type: evidence_summary
  draft_status: draft
  review_status: needs_gk_review
  queue_type: generated_content_review
  queue_target_object_type: generated_content_draft
  audit_operation: generated_content_draft_created
  audit_contract: p3_01_generated_content_draft_v1
  validators: VAL-GEN-001, VAL-GEN-002, VAL-GEN-003, VAL-GEN-004, VAL-GEN-005

commands:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2-p3-01-generated-content-drafts ->
    TOOL_VERIFIED: 5/5 boundary tests pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p3-01-generated-content-drafts ->
    TOOL_VERIFIED: P3-01 verifier PASS and 18/18 focused PostgreSQL/boundary
    tests pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-08-eligible-claims-for-audience ->
    TOOL_VERIFIED: 14/14 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-07-assistant-claim-traceability-tool ->
    TOOL_VERIFIED: 12/12 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-06-claim-traceability ->
    TOOL_VERIFIED: 11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    TOOL_VERIFIED: catalog verifier 29/29 PASS, failure checks 5/5 PASS,
    focused PostgreSQL integration/boundary spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    TOOL_VERIFIED: 18/18 integration pass plus catalog/failure/smoke PASS
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    TOOL_VERIFIED: 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    TOOL_VERIFIED: 17/17 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js __tests__/kai-sprint2-authorization.spec.js __tests__/kai-sprint2-tenant-authorization.spec.js __tests__/kai-sprint2-tenant-validator.spec.js __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js __tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js __tests__/kai-sprint2-review-queue-route.spec.js __tests__/kai-sprint2-review-queue-status-route.spec.js __tests__/kai-sprint2-assistant-boundary.spec.js __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js __tests__/kai-sprint2-p2-08-eligible-claims-for-audience-boundary.spec.js __tests__/kai-sprint2-foundation-safety.spec.js __tests__/kai-sprint2-state-transitions.spec.js ->
    TOOL_VERIFIED: 131 pass, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    TOOL_VERIFIED: 1475 pass, 17 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    TOOL_VERIFIED: 1580 pass, 17 skip, 0 fail
  - git diff --check -> TOOL_VERIFIED: no whitespace errors
  - git diff --cached --check -> TOOL_VERIFIED: no whitespace errors

NOT_CONFIRMED:
  production deployment, feature enablement, external provider behavior,
  cloud/database mutation outside runner-owned synthetic loopback PostgreSQL
  databases, and real-client-data behavior

complete_diff_scope: Backend/kai/config/kaiSprint2Config.js (additive),
  Backend/kai/dictionary/postgresGeneratedContentRepository.js (new),
  Backend/kai/services/kaiGeneratedContentService.js (new),
  Backend/kai/validators/kaiGeneratedContentValidators.js (new),
  __tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js (new),
  __tests__/kai-sprint2-p3-01-generated-content-drafts.integration.spec.js (new),
  migrations/kai_sprint2_p3_01_generated_content_drafts.rollback.sql (new),
  migrations/kai_sprint2_p3_01_generated_content_drafts.sql (new),
  package.json (additive),
  scripts/kai-sprint2-p3-01-generated-content-drafts-local-postgres.js (new),
  scripts/kai-sprint2-p3-01-generated-content-drafts-verifier.sql (new)

### P2-08 controlled eligible-claims-for-audience tool - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 9d86361c575ebf192040ff96be465270c1b3f425
  worktree: clean at task start, including untracked files; staged paths: none

p2_08_made:
  - Backend/kai/dictionary/postgresClaimTraceabilityRepository.js - exposed the
    existing P2-06 eligibility evaluator as
    evaluateClaimTraceabilityInTransaction(tx, input). The public
    getClaimTraceabilitySummary repository method still opens one
    REPEATABLE READ READ ONLY transaction and delegates to the same evaluator,
    preserving accepted P2-06 output and behavior.
  - Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js -
    new read-only repository for tenant-scoped claim_id ascending candidate
    enumeration in batches of 100, capped at 500 inspected candidates, with
    all P2-06 eligibility evaluation performed inside the same transaction
    snapshot and no nested public P2-06 service calls.
  - Backend/kai/services/kaiEligibleClaimsForAudienceService.js - new
    read-only service listEligibleClaimsForAudience with KAI_SPRINT2_ENABLED,
    exact input validation, mapped-human actor, active tenant membership,
    gk_admin/gk_operator/gk_reviewer role authorization, tenant boundary
    validation, lazy repository loading, and preserved failure semantics.
  - Backend/kai/services/kaiAssistantClaimTraceabilityTool.js - extended the
    accepted P2-07 assistant wrapper with exactly one additional operation,
    list_eligible_claims_for_audience. The existing
    get_claim_traceability_summary operation remains routed through the
    accepted P2-06 service path. The new operation has exact argument keys,
    canonical cursor validation, assistant validators, tenant/role gates,
    lazy service loading, and strict output validation for the six-key list DTO
    and nine-key eligibleClaims entries.
  - Backend/kai/validators/assistantBoundaryValidators.js - added
    list_eligible_claims_for_audience to the same metadata-read assistant
    allowlist; restricted assistant operations remain blocked.
  - __tests__/kai-sprint2-p2-08-eligible-claims-for-audience-boundary.spec.js -
    focused injected-evaluator coverage for feature/actor/role/tenant gates,
    zero list-service calls on malformed or forbidden wrapper input, exactly
    two assistant operations, unchanged traceability wrapper behavior, one
    transaction-scoped snapshot, reuse of the P2-06 evaluator seam, scanning
    through ineligible pages, pagination and ordering, 500-candidate cap,
    non-null truncated cursors, eligible:false omission, malformed
    authoritative state conflicting the whole request, output tamper
    fail-closed behavior, and no write/audit source contracts.
  - __tests__/kai-sprint2-p2-08-eligible-claims-for-audience.integration.spec.js
    and scripts/kai-sprint2-p2-08-eligible-claims-for-audience-local-postgres.js -
    runner-owned loopback PostgreSQL suite proving ambient DATABASE_URL is
    ignored, non-loopback runner URLs are rejected before connection, one
    read-only snapshot is used, no writes or audit effects occur, and the
    currently accepted P2-03 proposed internal-only review-gated claim returns
    a successful empty eligibleClaims list without fabricated audience
    approval state.
  - package.json - added
    verify:kai-sprint2-p2-08-eligible-claims-for-audience.

commands:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p2-08-eligible-claims-for-audience-boundary.spec.js ->
    TOOL_VERIFIED: 11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-08-eligible-claims-for-audience ->
    TOOL_VERIFIED: initial sandbox initdb shared-memory failure; rerun with
    localhost-capable execution passed 14/14, including runner-owned loopback
    PostgreSQL; workdir removed
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-07-assistant-claim-traceability-tool ->
    TOOL_VERIFIED: 12/12 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-06-claim-traceability ->
    TOOL_VERIFIED: 11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    TOOL_VERIFIED: catalog verifier 29/29 PASS, failure checks 5/5 PASS,
    focused tests 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    TOOL_VERIFIED: catalog verifier 59/59 PASS, failure checks 17/17 PASS,
    smoke verifier 15/15 PASS, integration spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    TOOL_VERIFIED: catalog verifier 58/58 PASS, failure checks 21/21 PASS,
    smoke verifier 15/15 PASS, integration spec 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    TOOL_VERIFIED: catalog verifier 69/69 PASS, failure checks 25/25 PASS,
    smoke verifier 15/15 PASS, integration spec 17/17 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p2-08-eligible-claims-for-audience-boundary.spec.js __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js __tests__/kai-sprint2-assistant-boundary.spec.js __tests__/kai-sprint2-authorization.spec.js __tests__/kai-sprint2-tenant-validator.spec.js __tests__/kai-sprint2-tenant-authorization.spec.js __tests__/kai-sprint2-foundation-safety.spec.js __tests__/kai-sprint2-p0-repository-contract.spec.js ->
    TOOL_VERIFIED: initial sandbox listener restriction on 127.0.0.1; rerun
    with localhost-capable execution passed 81/81
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    TOOL_VERIFIED: 1468 pass, 16 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    TOOL_VERIFIED: 1573 pass, 16 skip, 0 fail

USER_CONFIRMED:
  - P2-01 through P2-07 are accepted and closed.
  - P2-08 is authorized as one bounded read-only service plus one additional
    operation in the accepted P2-07 assistant wrapper.

NOT_CONFIRMED:
  - Production deployment, push, merge, feature-flag enablement, routes, UI,
    generation, approval transition, export, cloud access, production
    configuration, real client data, or non-runner-owned database behavior was
    not performed or confirmed.

### P2-07 controlled assistant claim-traceability tool - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 165aacbeeea22f221dbb225148f78e16b3b584c2
  worktree: clean at task start, including untracked files; staged paths: none

p2_07_made:
  - Backend/kai/services/kaiAssistantClaimTraceabilityTool.js - new dormant
    read-only assistant wrapper for exactly get_claim_traceability_summary.
    Requires KAI_SPRINT2_ENABLED, then KAI_ASSISTANT_TOOLS_ENABLED, then exact
    top-level request keys, exact tool-name allowlist, exact arguments schema,
    mapped human actor, active organization membership and allowed role,
    assistant-boundary validators, tenant validator, lazy P2-06 service import,
    exactly one P2-06 invocation, output-contract validation, and return.
  - The wrapper delegates only organizationId, claimId, requestedAudience, and
    actorContext to P2-06, preserves valid P2-06 success and failure envelopes
    unchanged, maps malformed/unknown requests and expected assistant blockers
    to validation_blocker, preserves authorization_denied for invalid actors
    and role failures, preserves tenant_boundary_violation for missing active
    membership/tenant failures, and returns system_error with no data for
    malformed internal dependencies or prohibited output fields.
  - Backend/kai/validators/assistantBoundaryValidators.js - minimally extends
    the existing assistant-boundary validator vocabulary with canonical
    structured VAL-AST-001 validateAssistantToolAuthorization, VAL-AST-002
    validateAssistantCannotApprove, VAL-AST-003
    validateAssistantCannotAccessRawFiles, and VAL-AST-004
    validatePromptInjectionQuarantine helpers. No parallel authorization or
    blocker vocabulary was added.
  - __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js
    - focused tests for feature-flag order, exact input allowlists, wrapper
    order, validator execution, blocker/failure semantics, exact P2-06 input
    shape, exactly-one invocation, envelope preservation, metadata-safe output
    validation, prohibited output rejection, prompt-injection quarantine, and
    no route/listener/public-barrel/production-composition imports.
  - __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool.integration.spec.js
    and scripts/kai-sprint2-p2-07-assistant-claim-traceability-tool-local-postgres.js
    - runner-owned loopback PostgreSQL suite proving non-loopback runner
    targets are rejected before connection, ambient DATABASE_URL stays a
    sentinel, P2-01 through P2-06 preparation remains runner-owned, the wrapper
    calls P2-06 once, and the P2-07 call performs no SQL writes, audit
    preparation, or audit publication.
  - package.json - adds
    verify:kai-sprint2-p2-07-assistant-claim-traceability-tool only. No route,
    UI, startup hook, listener, public barrel export, production assistant
    composition, feature-flag default change, migration, schema change, or
    database write path was added.

disclosed_local_identifiers:
  assistant_tool: get_claim_traceability_summary
  feature_flag_existing: KAI_SPRINT2_ENABLED default false
  feature_flag_new: KAI_ASSISTANT_TOOLS_ENABLED default false
  validator_keys: VAL-AST-001, VAL-AST-002, VAL-AST-003, VAL-AST-004,
    VAL-TEN-001
  npm_script: verify:kai-sprint2-p2-07-assistant-claim-traceability-tool

commands:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js ->
    TOOL_VERIFIED: 9/9 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-07-assistant-claim-traceability-tool ->
    TOOL_VERIFIED: 12/12 pass; runner-owned loopback PostgreSQL, ambient
    DATABASE_URL sentinel, non-loopback target rejection covered
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-06-claim-traceability ->
    TOOL_VERIFIED: 11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    TOOL_VERIFIED: catalog verifier 29/29 PASS, failure checks 5/5 PASS,
    focused PostgreSQL integration/boundary spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    TOOL_VERIFIED: catalog verifier 59/59 PASS, read-only failure checks 17/17
    PASS, smoke verifier 15/15 PASS, integration spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    TOOL_VERIFIED: catalog verifier 58/58 PASS, read-only failure checks 21/21
    PASS, smoke verifier 15/15 PASS, integration spec 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    TOOL_VERIFIED: catalog verifier 69/69 PASS, read-only failure checks 25/25
    PASS, smoke verifier 15/15 PASS, integration spec 17/17 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-foundation-safety.spec.js __tests__/kai-sprint2-assistant-boundary.spec.js __tests__/kai-sprint2-authorization.spec.js __tests__/kai-sprint2-tenant-validator.spec.js __tests__/kai-sprint2-tenant-authorization.spec.js __tests__/kai-sprint2-actor-context.spec.js __tests__/kai-sprint2-p2-06-claim-traceability-boundary.spec.js __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js ->
    TOOL_VERIFIED: 64/64 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    TOOL_VERIFIED: 1455 pass, 15 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    TOOL_VERIFIED: 1560 pass, 15 skip, 0 fail
  - git diff --check -> TOOL_VERIFIED: no whitespace errors
  - git diff --cached --check -> TOOL_VERIFIED: no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-06 are accepted and closed.
  - P2-07 is authorized as one bounded dormant read-only assistant operation.

NOT_CONFIRMED:
  - No route, UI, eligible-claims listing tool, generation, export, approval,
    mutation, retention execution, startup hook, listener, production assistant
    composition, deployment, push, merge, cloud access, production
    configuration, feature enablement, real client data, database migration, or
    database mutation outside runner-owned synthetic loopback PostgreSQL suites
    was performed.

complete_diff_scope: Backend/kai/services/kaiAssistantClaimTraceabilityTool.js
  (new), Backend/kai/validators/assistantBoundaryValidators.js (additive),
  __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js
  (new),
  __tests__/kai-sprint2-p2-07-assistant-claim-traceability-tool.integration.spec.js
  (new),
  scripts/kai-sprint2-p2-07-assistant-claim-traceability-tool-local-postgres.js
  (new), package.json (additive),
  KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.5.md
  (additions-only evidence)

### P2-06 read-only claim traceability and blocked-eligibility explanation - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: bc2c04eac4a73bdf9654eeb0c74d2e3de4c2ae2a
  worktree: clean at task start, including untracked files; staged paths: none

p2_06_made:
  - Backend/kai/services/kaiClaimTraceabilityService.js - added the dormant
    getClaimTraceabilitySummary seam with exact input key allowlist,
    requestedAudience restricted to internal/funder/public, KAI_SPRINT2_ENABLED
    gating before any database-capable module load, mapped-human authorization,
    active organization membership, and gk_admin/gk_operator/gk_reviewer role
    enforcement.
  - Backend/kai/dictionary/postgresClaimTraceabilityRepository.js - added the
    read-only transaction-scoped REPEATABLE READ READ ONLY summary repository.
    It loads the tenant-scoped claim, canonical claim-evidence link, evidence,
    locator, source, current source_version, candidate, promotion decision,
    evidence_review and claim_review queue items, P2-02 committed inputs,
    persisted P2-04 gap/follow-up/client_followup state, and bounded P2-05
    potential conflict groups with conflict_resolution queue rows. It
    recomputes P2-02 with the accepted deterministic functions, validates the
    complete expected P2-04 set using accepted P2-04 helpers, validates P2-05
    groups with the accepted P2-05 validator, returns at most 100 potential
    groups, and fails closed with traceability_incomplete when row 101 exists.
  - The P2-06 output is metadata-safe: identifiers/statuses/gates only, no
    claim/evidence text, questions, summaries, raw values, samples, filenames,
    storage locations, object keys, signed URLs, PII, notes, prompts,
    credentials, or private infrastructure details.
  - Eligibility remains false without affirmative persisted approval authority.
    The inspected P2-03 schema contains only fail-closed proposed/internal-only
    claim state, so accepted P2-03 proposed claims remain ineligible. Blockers
    are ordered and deduplicated using the required ten-code contract.
  - __tests__/kai-sprint2-p2-06-claim-traceability-boundary.spec.js and
    .integration.spec.js - added focused lazy-loading, input rejection,
    authorization, exact repository forwarding, no confirmed-conflict
    vocabulary, consistent snapshot, P2-02 recomputation, P2-04 expected-set
    validation, P2-05 group/queue-pair validation, blocker ordering,
    internal-only ineligibility, truncation fail-closed, no-write, ambient
    DATABASE_URL, and non-loopback runner URL coverage.
  - scripts/kai-sprint2-p2-06-claim-traceability-local-postgres.js and
    package.json - added the runner-owned loopback PostgreSQL verification
    suite and npm script.

TOOL_VERIFIED:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p2-06-claim-traceability-boundary.spec.js ->
    4/4 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-06-claim-traceability ->
    11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    catalog verifier 29/29 PASS, failure checks 5/5 PASS, focused tests 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    catalog verifier 59/59 PASS, failure checks 17/17 PASS, smoke verifier
    15/15 PASS, integration spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    catalog verifier 58/58 PASS, failure checks 21/21 PASS, smoke verifier
    15/15 PASS, integration spec 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    catalog verifier 69/69 PASS, failure checks 25/25 PASS, smoke verifier
    15/15 PASS, integration spec 17/17 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js __tests__/kai-sprint2-p1-09-review-cockpit.integration.spec.js __tests__/kai-sprint2-batch-detail-route.spec.js __tests__/kai-sprint2-p2-06-claim-traceability-boundary.spec.js ->
    53/53 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    1444 pass, 14 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    1549 pass, 14 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-05 are accepted and closed.
  - P2-06 is authorized as one bounded read-only implementation package.

NOT_CONFIRMED:
  - No route, UI, assistant exposure, generation, export, approval transition,
    deployment, push, merge, cloud access, production configuration, feature
    enablement, real client data, or database migration was performed.

### P2-05 potential conflict-review candidate foundation - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: dff7a4139dfedf491d8d2325670cce931e3fe85d
  worktree: clean at task start, including untracked files; staged paths: none

p2_05_made:
  - migrations/kai_sprint2_p2_05_conflict_review_candidate.sql - adds
    kai.conflict_groups with only conflict_group_id, organization_id,
    lower_claim_id, higher_claim_id, lower_claim_conflict_gap_id,
    higher_claim_conflict_gap_id, basis_code, safe_summary, created_by_type,
    and created_at. Enforces lower_claim_id < higher_claim_id, basis_code =
    human_selected_unresolved_comparison, safe_summary = Potential claim
    conflict requires GK review., created_by_type = system, tenant-safe
    composite FKs to kai.claims and kai.gap_log_items, and logical uniqueness
    on organization_id + lower_claim_id + higher_claim_id.
  - migration also adds
    ux_review_queue_items_p2_05_conflict_resolution_identity and
    review_queue_items_p2_05_conflict_resolution_contract_check, scoped only
    to queue_type = conflict_resolution. It adds audit operation
    conflict_review_candidate_created and scoped metadata constraint
    upload_lifecycle_audit_p2_05_metadata_object_check for contract
    p2_conflict_review_candidate_v1.
  - Backend/kai/validators/kaiConflictGroupValidators.js - new pure validator
    validateConflictGroupCompleteness using canonical result helpers with
    validator_key VAL-KAI-P2-05-001, object_type conflict_group, object_code
    human_selected_unresolved_comparison. Blocks self-pairing, non-normalized
    persisted pairs, null/mismatched queue identities, malformed group/queue
    plans, asserted-conflict semantics, and prohibited raw/sensitive content.
  - Backend/kai/services/kaiConflictReviewCandidateService.js - new dormant
    service createConflictReviewCandidate with exact input allowlist
    organizationId, firstClaimId, secondClaimId, actorContext, now. Requires
    KAI_SPRINT2_ENABLED before loading the PostgreSQL repository, rejects
    unknown keys and noncanonical UUIDs, accepts either caller order, requires
    mapped human actor plus active tenant membership with gk_admin,
    gk_operator, or gk_reviewer.
  - Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js - new
    tenant-scoped transactional repository. Reads both proposed, internal-only,
    review-gated claims, canonical claim_evidence_links, full current
    evidence/locator/source/source_version/candidate/promotion-decision/
    evidence-review lineage, each unresolved P2-04
    conflicting_source_indicators gap, and each immutable claim_review queue
    item. Builds server-owned complete group/queue plans, validates fresh,
    post-write, replay, and concurrent-loser reread rows, writes with
    INSERT ... ON CONFLICT ... DO NOTHING RETURNING plus authoritative reread,
    never repairs partial state, and writes one metadata-only audit row only
    on fresh successful creation.
  - __tests__/kai-sprint2-p2-05-conflict-review-candidate-boundary.spec.js,
    .integration.spec.js, and -runner-self-test.spec.js - focused coverage of
    validator structure, caller-order normalization, disabled service loading,
    authorization, fresh atomic creation, replay zero-write/zero-audit,
    partial-state rejection, concurrent convergence, and audit rollback.
  - scripts/kai-sprint2-p2-05-conflict-review-candidate-{verifier,
    failure-checks,local-postgres,runner-assertions}.js/sql - package verifier
    and runner pack. package.json adds
    verify:kai-sprint2-p2-05-conflict-review-candidate.

disclosed_local_identifiers:
  audit_operation: conflict_review_candidate_created
  audit_contract: p2_conflict_review_candidate_v1
  validator_key: VAL-KAI-P2-05-001
  queue_partial_unique_index: ux_review_queue_items_p2_05_conflict_resolution_identity
  queue_contract_constraint: review_queue_items_p2_05_conflict_resolution_contract_check
  audit_metadata_constraint: upload_lifecycle_audit_p2_05_metadata_object_check

commands:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    TOOL_VERIFIED: catalog verifier 29/29 PASS, failure checks 5/5 PASS,
    focused PostgreSQL integration/boundary spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    TOOL_VERIFIED: 18/18 integration pass plus catalog/failure/smoke PASS
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    TOOL_VERIFIED: 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    TOOL_VERIFIED: 17/17 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p2-01-evidence-lineage-boundary.spec.js __tests__/kai-sprint2-p2-02-evidence-coverage-assessment-boundary.spec.js __tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js __tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js __tests__/kai-sprint2-p2-05-conflict-review-candidate-boundary.spec.js __tests__/kai-sprint2-p1-06-review-queue*.spec.js __tests__/kai-sprint2-actor-context.spec.js __tests__/kai-sprint2-tenant-authorization.spec.js __tests__/kai-sprint2-transaction-interface.spec.js __tests__/kai-sprint2-audit*.spec.js ->
    TOOL_VERIFIED: 208 pass, 1 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    TOOL_VERIFIED: 1438 pass, 13 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    TOOL_VERIFIED: 1543 pass, 13 skip, 0 fail
  - git diff --check -> TOOL_VERIFIED: no whitespace errors
  - git diff --cached --check -> TOOL_VERIFIED: no whitespace errors

NOT_CONFIRMED:
  production deployment, feature enablement, cloud/database mutation outside the
  runner-owned synthetic loopback PostgreSQL databases, and real-client-data
  behavior

complete_diff_scope: Backend/kai/db/kaiIntakeQueries.js (additive),
  Backend/kai/dictionary/postgresClaimGapFollowupRepository.js (new),
  Backend/kai/services/kaiClaimGapFollowupService.js (new),
  Backend/kai/validators/kaiClaimGapFollowupValidators.js (new),
  __tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js (new),
  __tests__/kai-sprint2-p2-04-claim-gap-followup-runner-self-test.spec.js (new),
  __tests__/kai-sprint2-p2-04-claim-gap-followup-schema-contract.spec.js (new),
  __tests__/kai-sprint2-p2-04-claim-gap-followup.integration.spec.js (new),
  migrations/kai_sprint2_p2_04_claim_gap_followup.rollback.sql (new),
  migrations/kai_sprint2_p2_04_claim_gap_followup.sql (new),
  package.json (additive),
  scripts/kai-sprint2-p2-04-claim-gap-followup-failure-checks.sql (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-local-postgres.js (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-runner-assertions.js (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-runbook.md (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-patch-notes.md (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-smoke-seed.sql (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-smoke-verifier.sql (new),
  scripts/kai-sprint2-p2-04-claim-gap-followup-verifier.sql (new)
```

### P2-04C follow-up routing and fail-closed service loading correction - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 9aafb798c7b875fe364d70c14e8900eb05ad34d1
  worktree: clean at task start, including untracked files; staged paths: none

p2_04c_made:
  - Backend/kai/services/kaiClaimGapFollowupService.js - removed the static
    PostgreSQL repository import. The default repository is now dynamically
    imported only after KAI_SPRINT2_ENABLED, input validation, mapped-human
    authorization, and active tenant-membership/role validation pass, and only
    when no injected repository is supplied.
  - Backend/kai/validators/kaiClaimGapFollowupValidators.js - converted
    validateClientFollowupRouting to canonical structured validator results
    from Backend/kai/validators/types.js using validator_key
    VAL-KAI-P2-04-002, object_type client_followup_item, dimension-key
    object_code, follow-up object_id, metadata-safe evidence, and blocker
    blocking_reason/required_fix.
  - Backend/kai/dictionary/postgresClaimGapFollowupRepository.js - allocates
    server-owned non-null client_followup_item_id values before routing
    validation, includes queue target_object_id in complete queue plans, maps
    fresh routing blockers to validation_blocker, validates complete plans
    before follow-up/queue writes, and reruns routing validation against
    post-write rows, replay rows, and concurrent-loser rereads. Malformed
    existing routing state remains conflict_current_state_changed without
    repair.
  - __tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js and
    .integration.spec.js - added focused structured-result, identity,
    target-binding, queue-containment, disabled service import subprocess,
    routing-blocker rollback, and malformed-existing-routing-state coverage.
  - scripts/kai-sprint2-p2-04-claim-gap-followup-runbook.md and
    -patch-notes.md - updated P2-04 documentation for the P2-04C correction.

USER_CONFIRMED:
  the prior transcript showed ambient database configuration being selected
  during service-module import

NOT_CONFIRMED:
  whether that import opened a connection or changed database state

commands:
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel node --test __tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js __tests__/kai-sprint2-p2-04-claim-gap-followup-schema-contract.spec.js __tests__/kai-sprint2-p2-04-claim-gap-followup-runner-self-test.spec.js ->
    TOOL_VERIFIED: 55/55 pass
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    TOOL_VERIFIED: catalog verifier 59/59 PASS, read-only failure checks 17/17
    PASS, smoke verifier 15/15 PASS, integration spec 18/18 pass
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    TOOL_VERIFIED: 15/15 pass
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    TOOL_VERIFIED: 7/7 pass
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    TOOL_VERIFIED: 17/17 pass
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm run test:kai-sprint2 ->
    TOOL_VERIFIED: 1422 pass, 12 skip, 0 fail
  - DATABASE_URL=postgres://sentinel@127.0.0.1:9/kai_sprint2_p2_04c_sentinel npm test ->
    TOOL_VERIFIED: 1527 pass, 12 skip, 0 fail
  - git diff --check -> TOOL_VERIFIED: no whitespace errors
  - git diff --cached --check -> TOOL_VERIFIED: no whitespace errors
### P3-02 read-only generated-draft review packet - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 210c9dcfe84f486263ed39d7c155ac003bd841d7
  worktree: clean at task start, including untracked files; staged paths: none

p3_02_made:
  - Backend/kai/services/kaiGeneratedContentService.js - added dormant
    getGeneratedDraftReviewPacket. The service requires KAI_SPRINT2_ENABLED,
    then KAI_GENERATION_ENABLED, then exact three-key input validation
    (organizationId, generatedContentDraftId, actorContext), mapped-human
    validation, active tenant membership and gk_admin/gk_reviewer
    authorization, then lazy database-capable repository loading. It does not
    enable either flag.
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js - added the
    read-only getGeneratedDraftReviewPacket repository method. It opens one
    REPEATABLE READ READ ONLY transaction-scoped snapshot, validates the
    complete immutable run/draft/block/citation graph, validates exactly one
    generated_content_review queue item against the P3-02 packet contract,
    evaluates each unique cited claim once through the injected/default
    transaction-scoped P2-06 evaluator, reuses the evaluated result for repeated
    citations, returns currentUseEligible only when every unique claim is
    currently eligible, and fails closed on malformed graph, queue, or
    authority state without repair.
  - The response is built from explicit allowlists only. Successful DTO keys
    are exactly generationRunId, generatedContentDraftId, contentType,
    draftStatus, requestedAudience, reviewQueueItemId, queueStatus,
    reviewStatus, currentUseEligible, and blocks. Block and citation DTOs are
    exact-key validated, with no claim/evidence text, filenames, storage
    details, prompts, credentials, internal notes, raw rows, or signed URLs.
  - __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js
    and .integration.spec.js - added focused coverage for gate ordering before
    repository loading, graph and queue fail-closed validation, exact DTO
    allowlists, prohibited-field system_error handling with data:null,
    deterministic block/citation ordering, repeated-claim evaluator reuse,
    current ineligibility with per-claim blockers, citation/evaluator evidence
    mismatch conflict, no confirmed-conflict vocabulary, no public P2-06
    service nesting, no writes, no queue transition, no audit effect, ambient
    DATABASE_URL isolation, and non-loopback runner rejection.
  - scripts/kai-sprint2-p3-02-generated-draft-review-packet-local-postgres.js
    and package.json - added the runner-owned loopback PostgreSQL verification
    suite. The suite uses the accepted P1/P2/P3-01 seed chain and a
    runner-local constraint adjustment because the accepted P3-01 generated
    review queue constraint still pins the older write-side required_action,
    while this P3-02 read packet contract requires the newer exact
    required_action. No production migration file was changed.

TOOL_VERIFIED:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js ->
    8/8 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p3-02-generated-draft-review-packet ->
    initial sandbox initdb shared-memory failure; localhost-capable rerun 14/14
    pass; runner-owned loopback PostgreSQL target; ambient DATABASE_URL stayed
    on the non-listening sentinel
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p3-01-generated-content-drafts ->
    initial sandbox initdb shared-memory failure; localhost-capable rerun 18/18
    pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-08-eligible-claims-for-audience ->
    14/14 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-07-assistant-claim-traceability-tool ->
    12/12 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-06-claim-traceability ->
    11/11 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-05-conflict-review-candidate ->
    catalog verifier 29/29 PASS, failure checks 5/5 PASS, focused tests 18/18
    pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-04-claim-gap-followup ->
    catalog verifier 59/59 PASS, read-only failure checks 17/17 PASS, smoke
    verifier 15/15 PASS, integration spec 18/18 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-03-claim-proposal ->
    catalog verifier 58/58 PASS, read-only failure checks 21/21 PASS, smoke
    verifier 15/15 PASS, integration spec 15/15 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-02-evidence-coverage-assessment ->
    7/7 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p2-01-evidence-lineage ->
    catalog verifier 69/69 PASS, read-only failure checks 25/25 PASS, smoke
    verifier 15/15 PASS, integration spec 17/17 pass
  - affected generation/auth/tenant/queue/safety tests:
    initial sandbox listener failure on three existing ephemeral localhost HTTP
    tests; localhost-capable rerun 124/124 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    complete Sprint 2 suite 1485 pass, 18 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    complete repository suite 1590 pass, 18 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 are accepted and closed.
  - P3-02 is authorized as one bounded read-only generated-draft review packet
    service.

NOT_CONFIRMED:
  - No push, merge, deploy, feature enablement, production configuration
    change, cloud access, real-client-data access, route, UI, assistant
    operation, public export, approval/finalization behavior, production
    composition, audit publication, queue transition, or production migration
    change was performed.
### P3-02C generated-content review queue contract correction - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 2ef5b365750bfdb0f4d29e001bdfd88c057bfc81
  worktree: clean at task start, including untracked files; staged paths: none

p3_02c_made:
  - Backend/kai/dictionary/generatedContentReviewQueueContract.js - added one
    private shared generated_content_review queue contract for the accepted
    P3-01/P3-02 row shape, including the authoritative required_action:
    "Review citations, audience eligibility, limitations, unsupported claims,
    and numeric or causal assertions before any use."
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js - replaced
    the split writer/reader required_action constants with the shared contract.
    P3-01 creation, replay, and post-write validation and P3-02 review-packet
    validation now validate the same generated_content_review queue row without
    adding any public route, UI, listener, startup registration, migration,
    production wiring, approval, export, or queue transition.
  - __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js
    and .integration.spec.js - aligned the P3-02 queue fixture with the
    accepted P3-01 row, replaced the handcrafted PostgreSQL-compatible
    generated-content fixture with a complete draft created through the
    accepted P3-01 persistence path using the existing injected eligibility and
    generator seams, and proved getGeneratedDraftReviewPacket reads that exact
    draft as the accepted P3-02 DTO.
  - The P3-02 runner-owned PostgreSQL suite now proves the P3-01 database CHECK
    rejects malformed generated_content_review required_action, then within one
    rolled-back runner-owned transaction temporarily drops only that scoped
    CHECK, persists the malformed value, calls getGeneratedDraftReviewPacket,
    and verifies conflict_current_state_changed with zero repair, writes, queue
    transitions, audit effects, or lingering constraint/data changes.
  - scripts/kai-sprint2-p3-02-generated-draft-review-packet-local-postgres.js -
    removed the runner-local rewrite that previously relaxed the P3-01
    generated_content_review CHECK to the old P3-02-compatible value. No
    production migration was changed.

TOOL_VERIFIED:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js ->
    8/8 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p3-02-generated-draft-review-packet ->
    initial sandbox initdb shared-memory failure; localhost-capable rerun 16/16
    pass; runner-owned loopback PostgreSQL target; exact P3-01-created draft
    read through P3-02; malformed CHECK rejection and rolled-back relaxed-CHECK
    conflict proof passed
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p3-01-generated-content-drafts ->
    initial sandbox initdb shared-memory failure; localhost-capable rerun 18/18
    pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test __tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js __tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js __tests__/kai-sprint2-review-queue-route.spec.js __tests__/kai-sprint2-review-queue-status-route.spec.js ->
    initial sandbox localhost listener failure on two existing HTTP-route tests;
    localhost-capable rerun 63/63 pass
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run test:kai-sprint2 ->
    initial sandbox localhost listener failures on existing HTTP-route tests;
    localhost-capable rerun complete Sprint 2 suite 1485 pass, 18 skip, 0 fail
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test ->
    initial sandbox localhost listener failures on existing HTTP-route tests;
    localhost-capable rerun complete repository suite 1590 pass, 18 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 remain accepted and closed.
  - P3-02C is authorized as one bounded correction to align the P3-01 writer
    and P3-02 reader queue contract.

NOT_CONFIRMED:
  - No push, merge, deploy, generation enablement, production configuration
    change, cloud access, real-client-data access, route, UI, listener, startup
    registration, migration, approval, export, production wiring, queue
    transition, audit mutation, production database access, P3-03 work, new
    P3-02 package proposal, or new P3-02 review cycle was performed.
### P3-03 export-manifest eligibility preflight - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 84aa63edad43e1ef3a5ff5d8be8cc2d613dc8d70
  worktree: clean at task start, including untracked files; staged paths: none

p3_03_made:
  - Backend/kai/config/kaiSprint2Config.js - added isKaiPublicExportEnabled and
    areKaiSprint2PublicExportFeaturesEnabled following the exact
    isKaiGenerationEnabled/areKaiSprint2GenerationFeaturesEnabled composition
    idiom already established in this file. KAI_PUBLIC_EXPORT_ENABLED is not
    enabled by this package.
  - Backend/kai/validators/kaiExportManifestEligibilityValidators.js - added
    the canonical VAL-EXP-001 validateExportManifestEligibility validator using
    the shared createValidatorResult helper from validators/types.js. Exact
    input contract; failed_gates populated once each in the specified stable
    order; blocker evidence contains only failed_gates; pass evidence is empty.
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js - the smallest
    behavior-preserving internal refactor: extracted the existing
    getGeneratedDraftReviewPacket transaction body (read state, validate rows,
    build the packet) into one exported
    evaluateGeneratedDraftReviewPacketInTransaction(tx, input, evaluator)
    function; getGeneratedDraftReviewPacket now calls it inside its own
    unchanged transaction/isolation-level/error-mapping wrapper. Also exported
    the existing RollbackResultError class so callers reusing the extracted
    evaluator can unwrap its rollback-carried result. No SQL, validation, or
    public behavior changed; P3-01 and P3-02 tests re-verified unchanged below.
  - Backend/kai/services/kaiExportEligibilityService.js - added one dormant
    read-only evaluateGeneratedDraftExportEligibility service. Gate order:
    KAI_SPRINT2_ENABLED -> KAI_GENERATION_ENABLED -> KAI_PUBLIC_EXPORT_ENABLED
    -> exact input validation -> mapped-human validation -> active tenant
    membership + gk_admin authorization (validateActorCanPerformOperation) ->
    lazy dynamic import of kaiDb.js/postgresGeneratedContentRepository.js/
    postgresClaimTraceabilityRepository.js. Opens one transaction-scoped
    REPEATABLE READ READ ONLY snapshot and reuses
    evaluateGeneratedDraftReviewPacketInTransaction inside it (no nested
    transaction, no public P3-02 service call, no duplicated graph/citation/
    P2-06/DTO/leakage logic). Maps the reused evaluator's not_found to
    not_found and every other reused failure (validation_blocker,
    conflict_current_state_changed, system_error, and RollbackResultError
    rollback results) to conflict_current_state_changed, so corrupted
    authoritative state is never classified through VAL-EXP-001. On a valid
    packet, always derives affirmativeHumanExportAuthority=false and
    finalGate=false (no accepted persisted representation of either exists),
    calls VAL-EXP-001, and returns the exact specified output field set with
    exportEligible = (validatorResult.severity === "pass"). Performs no
    INSERT/UPDATE/DELETE, audit, queue transition, export-manifest creation,
    or finalization.
  - __tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js -
    pure VAL-EXP-001 contract tests (pass, blocker, stable failed_gates
    ordering, final_gate_true_while_draft/final_export_gate_absent mutual
    exclusion, exact-input rejection) and pure service gate-order tests with
    injected dependencies proving each disabled flag returns feature_disabled
    before the transaction-scoped read runs, proving not_found and
    conflict_current_state_changed boundaries, proving the exact output field
    set, and proving no persisted authority/final-gate is ever inferred from
    queue resolution, currentUseEligible, actor role, or absence of blockers.
  - __tests__/kai-sprint2-p3-03-export-manifest-eligibility.integration.spec.js
    and scripts/kai-sprint2-p3-03-export-manifest-eligibility-local-postgres.js -
    a runner-owned loopback-only PostgreSQL suite (non-loopback target refused
    before connection, ambient ignored via runner-owned env var only) that
    creates one authentic draft through the accepted P3-01 path, then reuses
    the real evaluateGeneratedDraftReviewPacketInTransaction to prove: the
    real-repository path always fails closed (exportEligible:false, blocker
    severity) for an authentic P3-01/P3-02 draft; audience mismatch and current
    ineligibility each add their own gate; a missing draft returns not_found;
    a malformed evidence-identity mismatch returns conflict_current_state_changed;
    and zero writes, queue transitions, audits, or file/manifest effects occur.
  - package.json - added verify:kai-sprint2-p3-03-export-manifest-eligibility
    and test:kai-sprint2-p3-03-export-manifest-eligibility scripts following
    the existing P3-01/P3-02 naming convention.

TOOL_VERIFIED:
  - node --test __tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js __tests__/kai-sprint2-p3-03-export-manifest-eligibility.integration.spec.js ->
    19/19 pass, 1 skip (runner-owned integration suite skipped without the
    loopback database)
  - npm run verify:kai-sprint2-p3-03-export-manifest-eligibility ->
    runner-owned loopback PostgreSQL target; 26/26 pass
  - npm run verify:kai-sprint2-p3-01-generated-content-drafts -> 18/18 pass
  - npm run verify:kai-sprint2-p3-02-generated-draft-review-packet -> 16/16 pass
  - npm run test:kai-sprint2 -> complete Sprint 2 suite 1504 pass, 19 skip, 0 fail
  - npm test -> complete repository suite 1609 pass, 19 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 through P3-02 remain accepted and closed.
  - P3-03 is authorized as one bounded dormant read-only export-manifest
    eligibility preflight service.

NOT_CONFIRMED:
  - No push, merge, deploy, public export enablement, production configuration
    change, cloud access, real-client-data access, route, UI, assistant
    operation, listener, startup registration, migration, approval or
    finalization transition, export-manifest creation, export-review queue
    creation, file rendering, audit mutation, production database access,
    P3-04 work, new P3-03 package proposal, or new P3-03 review cycle was
    performed.
### P3-04 GK generated-content review completion - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 024410b411280d011a03ca1516ab23677a870c12
  worktree: clean at task start, including untracked files; staged paths: none

p3_04_made:
  - Backend/kai/dictionary/generatedContentReviewQueueContract.js - the
    smallest behavior-preserving split of the accepted private queue contract:
    GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT's static fields (queue_type,
    target_object_type, priority, summary, required_action, assigned_to,
    due_at, created_by_type) moved into
    GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT; a new
    GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES constant enumerates exactly
    the three valid queue_status/review_status pairs
    (open/needs_gk_review, in_progress/needs_gk_review, resolved/resolved);
    isGeneratedContentReviewQueueRow is now the composition of
    isGeneratedContentReviewStaticContractRow and the new
    isGeneratedContentReviewLifecycleState, both newly exported. Every
    existing caller's default (allowedLifecycleProfiles defaulting to
    open/needs_gk_review only) is unchanged, so P3-01/P3-02 behavior and DTOs
    are byte-identical to before this package.
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js -
    validateReviewPacketRows split into validateImmutableGraphRows (P3-01
    run/draft/block/citation shape and content, unchanged) and the new
    validateGeneratedContentReviewQueueRows (queue identity/static-contract/
    lifecycle, now parameterized by allowedLifecycleProfiles, defaulting to
    the single open/needs_gk_review profile so P3-02's public behavior and DTO
    are unchanged). evaluateGeneratedDraftReviewPacketInTransaction gained an
    optional fourth {allowedLifecycleProfiles} argument threaded to the new
    split validator; its own default preserves prior behavior for every
    existing caller that omits it. Added one new dormant mutation method,
    completeGeneratedContentReview(input, {metadataOnlyAudit}), on the object
    returned by createPostgresGeneratedContentRepository. Inside one
    transaction: locks the immutable P3-01 draft root row (SELECT ... FOR
    UPDATE) to lock-and-load the complete immutable graph; loads the exact
    review_queue_items row by reviewQueueItemId (not scoped by
    organization_id, so a cross-tenant or wrong-target row is provably
    detected as conflict_current_state_changed rather than silently
    not_found); re-runs the shared evaluateGeneratedDraftReviewPacketInTransaction
    with all three lifecycle profiles to revalidate the immutable graph and
    P2-06 citation authority and to confirm the queue row's static contract
    and current lifecycle state, and to confirm identity between the loaded
    queue row and the packet's own queue row; executes one compare-and-set
    UPDATE constrained by organization_id, review_queue_item_id,
    target_object_type='generated_content_draft', target_object_id,
    queue_status='in_progress', review_status='needs_gk_review', and
    updated_at = expectedUpdatedAt (compared via date_trunc('milliseconds', ...)
    on both sides, because kai.review_queue_items' existing P1-06
    touch-updated-at trigger stamps now() at microsecond precision while the
    canonical UTC timestamp contract used throughout this codebase is
    millisecond-precision, so truncating both sides to milliseconds is the
    correct equality check for a client-supplied canonical timestamp, not a
    weakening of the CAS predicate); the UPDATE changes only queue_status,
    review_status, and updated_at. On a zero-row UPDATE,
    evaluateCompleteReviewReplayOrConflict re-reads the authoritative graph,
    queue, and audit trail inside the same transaction and returns
    replayed:true only when the complete immutable graph is still valid, the
    exact queue identity/static contract/lifecycle are resolved/resolved, and
    exactly one successful generated_content_review_completed audit row
    matches organization id, generation-run id, draft id, queue-item id,
    actor id, actor type, expectedUpdatedAt, requested completion timestamp,
    and both previous/resulting queue and review statuses; otherwise
    conflict_current_state_changed with zero mutation and zero audit. On a
    successful fresh UPDATE, re-reads and validates the completed
    resolved/resolved state, loads a required intake-file audit context by
    joining the draft's own citations through claims/evidence_items/
    source_versions/intake_source_candidates/intake_files (kai.
    upload_lifecycle_audit.intake_file_id and to_state remain NOT NULL and
    upload-lifecycle-enum-constrained from Gate A, so this package reuses one
    real, tenant-scoped intake_file_id/upload_state pair as the required
    non-semantic placeholder exactly as P3-01's own insertAudit already does,
    putting the actual meaningful transition only in metadata), prepares and
    publishes exactly one required metadata-only audit, and returns
    replayed:false. All failure/rollback paths (post-write validation
    failure, audit-prepare failure, audit-publish failure) throw
    RollbackResultError so the queue mutation and any audit insert are rolled
    back together with zero partial effect. New exports:
    completeGeneratedContentReview method; validateCompleteReviewInput,
    COMPLETE_REVIEW_FRESH_PROFILE, COMPLETE_REVIEW_RESOLVED_PROFILE,
    COMPLETE_REVIEW_AUDIT_OPERATION, COMPLETE_REVIEW_AUDIT_CONTRACT added to
    the existing testables/contract objects.
  - Backend/kai/services/kaiGeneratedContentService.js - added one dormant
    mutation service, completeGeneratedContentReview(input, dependencies).
    Input is exactly {organizationId, generatedContentDraftId,
    reviewQueueItemId, expectedUpdatedAt, actorContext, now}; unknown or
    missing keys are rejected. Gate order: KAI_SPRINT2_ENABLED ->
    KAI_GENERATION_ENABLED -> exact input validation (including canonical-UTC
    round-trip validation of both expectedUpdatedAt and now) -> mapped-human
    actor validation -> validateActorCanPerformOperation (active tenant
    membership, then gk_reviewer/gk_admin authorization) ->
    validateTenantBoundaryConsistency -> lazy dynamic import of
    postgresGeneratedContentRepository.js. This package implements GK-side
    review completion only; it defines no client-reviewer completion path,
    and completion by a GK actor creates no export authority of any kind.
  - migrations/kai_sprint2_p3_04_generated_content_review_completion.sql and
    .rollback.sql - the smallest forward migration and paired rollback: (1)
    replaces review_queue_items_p3_01_generated_content_review_contract_check
    with review_queue_items_p3_04_generated_content_review_contract_check,
    which admits exactly the three lifecycle profiles
    (open/needs_gk_review, in_progress/needs_gk_review, resolved/resolved)
    for queue_type='generated_content_review' while every other static field
    (target_object_type, priority, summary, required_action, assigned_to,
    due_at, created_by_type) remains pinned exactly as P3-01 established it;
    (2) extends upload_lifecycle_audit_gate_a_operation_check with one new
    operation value, generated_content_review_completed; (3) adds
    upload_lifecycle_audit_p3_04_metadata_object_check, a metadata-only CHECK
    (reusing kai.gate_a_p0_jsonb_metadata_only) that requires exactly
    contract, organization_id, generation_run_id, generated_content_draft_id,
    review_queue_item_id, actor_id, actor_type, expected_updated_at,
    requested_completion_timestamp, previous_queue_status,
    resulting_queue_status, previous_review_status, resulting_review_status,
    validator_keys and forbids draft_text, claim_text, claim_statement,
    evidence_text, block_text, citations, filename, storage_path, prompt,
    raw_content, source_text, generated_text, credential, and notes keys, with
    a closed-key-set check identical in shape to P3-01's. No table, column, or
    index is added or removed; no export-authority, final-gate, approval, or
    finalization state is introduced anywhere in the kai schema.
  - scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql -
    asserts the new lifecycle-matrix constraint exists and the single-state
    P3-01 constraint was replaced (not duplicated), the new audit operation
    and its metadata-only CHECK exist, and that no export-authority/
    final-gate/finalize/export column exists anywhere in kai.
  - scripts/kai-sprint2-p3-04-generated-content-review-completion-local-postgres.js -
    a runner-owned loopback-only ephemeral PostgreSQL harness following the
    exact P3-01/P3-02/P3-03 pattern (loopback-only target proof before
    connection, synthetic database name, random high port), applying every
    prior migration plus this package's forward migration and verifier, then
    running the P3-04 boundary and integration specs together with the
    existing P3-01/P3-02/P3-03 boundary specs against the same database.
  - __tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js -
    service gate-order tests (flags before any database-capable module loads,
    exact input/mapped-human/tenant-membership/gk_reviewer-or-gk_admin
    authorization all precede the repository call) with an injected fake
    repository; repository-level tests against a hand-built fake transaction
    proving: validateCompleteReviewInput's exact-key and canonical-timestamp
    rejection; the three valid lifecycle profiles and rejection of every other
    queue_status/review_status combination with zero mutation; fresh
    completion writes exactly one queue transition and one audit; identical
    replay returns replayed:true with zero additional writes/audits; a
    resolved row without a matching completion audit (or with an audit whose
    actor/timestamps differ) conflicts rather than replaying; a stale
    expectedUpdatedAt conflicts without mutation or audit; a missing draft,
    missing queue item, cross-tenant queue item, and a queue item pointed at a
    different draft each fail closed with the specified codes; a missing
    metadataOnlyAudit dependency is rejected before any transaction; the
    draft, its blocks, and its citations are byte-identical before and after
    completion; and the published audit metadata contains exactly the
    specified fourteen keys and no draft/claim/evidence text.
  - __tests__/kai-sprint2-p3-04-generated-content-review-completion.integration.spec.js -
    a runner-owned loopback-only PostgreSQL suite (non-loopback target
    refused before connection) that creates one authentic draft through the
    accepted P3-01 path, proves completion is rejected while the queue item is
    still open (never picked up), proves a missing tenant-scoped draft returns
    not_found, proves one fresh real completion writes exactly one queue
    transition and one audit row and then replays idempotently with zero
    additional writes/audits, proves two genuinely concurrent identical calls
    (via Promise.all against two separate pool connections, serialized by the
    FOR UPDATE draft-root lock) converge to exactly one transition and one
    audit with the loser provably replaying only after its own authoritative
    reread, proves the draft row remains draft_status='draft' and its blocks/
    citations are untouched, proves the published audit metadata carries no
    draft/claim/evidence text, and then invokes the real, unmodified P3-03
    evaluateGeneratedDraftExportEligibility for the same now-resolved draft to
    prove it returns a successful DTO (not conflict_current_state_changed)
    with exportEligible:false, queueStatus/reviewStatus both resolved,
    generated_content_review_unresolved absent from failed_gates, and
    generated_content_still_draft, affirmative_human_export_authority_absent,
    and final_export_gate_absent all present - proving GK-side review
    completion creates no export authority and no final gate.
  - package.json - added verify:kai-sprint2-p3-04-generated-content-review-completion
    and test:kai-sprint2-p3-04-generated-content-review-completion scripts
    following the existing P3-01/P3-03 naming convention.

TOOL_VERIFIED:
  - node --test __tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js ->
    19/19 pass
  - npm run verify:kai-sprint2-p3-04-generated-content-review-completion ->
    runner-owned loopback PostgreSQL target; 58/58 pass, 0 fail (boundary +
    integration + concurrency + real-P3-03-preflight proof)
  - npm run verify:kai-sprint2-p3-01-generated-content-drafts -> 18/18 pass
    (re-verified unchanged after the shared queue-contract/repository refactor)
  - npm run verify:kai-sprint2-p3-02-generated-draft-review-packet -> 16/16 pass
    (re-verified unchanged after the shared queue-contract/repository refactor)
  - npm run verify:kai-sprint2-p3-03-export-manifest-eligibility -> 26/26 pass
    (re-verified unchanged after reviewIsResolved's derivation was narrowed to
    resolved/resolved)
  - npm run test:kai-sprint2 -> complete Sprint 2 suite 1525 pass, 20 skip, 0 fail
  - npm test -> complete repository suite 1630 pass, 20 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 through P3-03 remain accepted and closed.
  - P3-04 is authorized as one bounded GK-side generated-content review
    completion mutation service.

NOT_CONFIRMED:
  - No push, merge, deploy, generation or export enablement, export
    authority, final export gate, export record or file creation, client-
    reviewer completion path, production configuration change, cloud access,
    real-client-data access, route, UI, assistant operation, listener,
    startup registration, P3-05 work, new P3-04 package proposal, or new
    P3-04 review cycle was performed.

### P3-05 GK export-review request foundation - completed 2026-08-06

preflight:
  branch: codex/kai-sprint2-p0-v0.3.5
  head: 15a00cd99f5e5cfe7ef045b3d4580b5afa497af6
  worktree: clean at task start, including untracked files; staged paths: none

p3_05_made:
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js -
    readReviewPacketState's queue lookup (used by the shared
    evaluateGeneratedDraftReviewPacketInTransaction) gained one required
    `AND queue_type = $4` predicate, matching the queue_type filter its
    sibling readExistingState already applied. Before this package,
    kai.review_queue_items never held two rows sharing the same
    (organization_id, target_object_type='generated_content_draft',
    target_object_id) for one draft, so the missing filter was latent; P3-05
    is the first package to add a second queue_type ('export_review') against
    that same target, and without this filter the shared P3-02 evaluator
    would see two rows and fail every future P3-02/P3-03/P3-04 call for a
    draft that ever requested export review. This is a minimal, purely
    corrective, behavior-preserving fix for every previously-possible state
    (re-verified: P3-01/P3-02/P3-03/P3-04 boundary and loopback suites are
    unchanged, 49/49 and 58/58 respectively). Added one new dormant mutation
    method, requestGeneratedDraftExportReview(input, {metadataOnlyAudit}), on
    the object returned by createPostgresGeneratedContentRepository, plus
    private helpers (validateRequestExportReviewInput,
    loadExportReviewQueueRows, isExportReviewQueueContractRow,
    buildCanonicalExportReviewValidatorResult,
    evaluateExportReviewReadiness, toBlockedExportReviewResult,
    toAcceptedExportReviewResult, buildExportReviewAuditMetadata,
    insertExportReviewAudit, auditMetadataMatchesExportReview,
    findMatchingExportReviewAudit, replayExportReviewFromExistingRow) and
    exported constants (EXPORT_REVIEW_QUEUE_TYPE/TARGET_TYPE/PRIORITY/
    SUMMARY/REQUIRED_ACTION/QUEUE_STATUS/REVIEW_STATUS/AUDIT_OPERATION/
    AUDIT_CONTRACT/READINESS_FAILED_GATES) added to the existing
    testables/contract objects. Inside one transaction: first checks for an
    existing export_review queue row for (organization_id,
    generated_content_draft_id) - if one exists, this is a replay attempt
    and readiness is not recomputed, since replay is defined by matching
    persisted state, not live re-evaluation (a later eligibility change must
    not un-create an already-queued review request); if none exists,
    evaluates authoritative readiness by calling the shared, unmodified
    evaluateGeneratedDraftReviewPacketInTransaction with the exact P3-04
    completed lifecycle profile ([{queueStatus:'resolved',
    reviewStatus:'resolved'}], not the default open/needs_gk_review profile
    and not the full three-profile matrix), then invokes the real,
    unmodified VAL-EXP-001 (validateExportManifestEligibility) with
    finalGate:false and affirmativeHumanExportAuthority:false hardcoded
    exactly as P3-03 already does, plus the packet's own draftAudience/
    draftIsStillDraft/reviewIsResolved/currentUseEligible; creation readiness
    requires failed_gates to be exactly the three canonical codes
    (generated_content_still_draft, affirmative_human_export_authority_absent,
    final_export_gate_absent) and requestedExportAudience === draftAudience;
    any other valid VAL-EXP-001 blocker set returns a successful blocked DTO
    (exportReviewRequestAccepted:false, replayed:false, zero mutation, zero
    audit) built only from the real validator's own output. On readiness,
    INSERT ... ON CONFLICT (organization_id, queue_type, target_object_type,
    target_object_id) WHERE queue_type='export_review' DO NOTHING RETURNING
    creates the queue row (queue_status='open',
    review_status='needs_gk_review', priority='normal', fixed summary/
    required_action, blocked_reason/assigned_to/due_at/created_by all NULL,
    queue_metadata='{}', created_by_type='system'); the row is re-read and
    revalidated against the exact static contract; on a fresh insert, loads
    the P3-04 audit-file-context mechanism unchanged
    (loadAuditFileContext, reused verbatim) to satisfy
    kai.upload_lifecycle_audit's NOT NULL intake_file_id/to_state, prepares
    and publishes exactly one required metadata-only export_review_requested
    audit (contract, organization_id, generated_content_draft_id,
    review_queue_item_id, requested_export_audience, actor_id, actor_type,
    requested_timestamp, validator_key, failed_gates - ten keys, no draft/
    claim/evidence text), and re-reads to confirm exactly one matching
    audit exists before returning exportReviewRequestAccepted:true,
    replayed:false; on a lost race (INSERT returns zero rows because a
    concurrent transaction already committed), falls back to the same
    replay path used for a pre-existing row, requiring exactly one matching
    export_review queue row and exactly one matching audit (matching
    organization, draft, queue item, requested audience, contract label,
    validator key, and the canonical three failed-gate codes; actor_id and
    requested_timestamp are not compared, since a later authorized replay
    may use a different actor and now) before returning
    exportReviewRequestAccepted:true, replayed:true with the queue's
    unchanged reviewQueueItemId; zero or duplicate matching audits, an
    audit without a queue row, or a queue row failing the static contract
    check all return conflict_current_state_changed with zero further
    mutation. All post-insert-contract-check, audit-file-context, and
    audit-prepare failures throw RollbackResultError so the queue insert and
    any audit insert are rolled back together with zero partial effect; the
    generic catch maps unknown/thrown errors (including a rejected
    audit-prepare contract) to system_error rather than propagating.
  - Backend/kai/services/kaiExportReviewService.js (new) -
    requestGeneratedDraftExportReview(input, dependencies), following the
    exact P3-03 gate order and lazy-loading idiom: KAI_SPRINT2_ENABLED ->
    KAI_GENERATION_ENABLED -> KAI_PUBLIC_EXPORT_ENABLED -> exact five-key
    input validation (organizationId, generatedContentDraftId,
    requestedExportAudience, actorContext, now; canonical UUIDs, audience in
    internal/funder/public, canonical UTC now) -> mapped-human actor check ->
    validateActorCanPerformOperation with allowedRoles restricted to
    gk_admin only (active tenant membership and role both enforced there) ->
    only then a dynamic `await import` of postgresGeneratedContentRepository.js
    (no database-capable module is imported at the top of this file). Builds
    the repository call's response through one explicit eight-key allowlist
    (isRequestExportReviewResultDto) that additionally enforces the accepted/
    blocked field-nullability shape, returning system_error on any drift
    rather than spreading the repository's row. New exports: the service
    function; __exportReviewServiceContract
    (EXPORT_REVIEW_ALLOWED_ROLES, REQUEST_EXPORT_REVIEW_OPERATION);
    __exportReviewServiceTestables (isRequestExportReviewInput,
    isMappedHumanActor, isRequestExportReviewResultDto).
  - migrations/kai_sprint2_p3_05_export_review_request.sql (new) - guards on
    kai.review_queue_items/generated_content_drafts/upload_lifecycle_audit
    and kai.gate_a_p0_jsonb_metadata_only all existing; 'export_review' was
    already an admitted review_queue_items.queue_type value from P1-06, so no
    ALTER was needed for that vocabulary. Adds
    ux_review_queue_items_p3_05_export_review_identity, a partial unique
    index on (organization_id, queue_type, target_object_type,
    target_object_id) WHERE queue_type='export_review' (the same pattern
    P3-01 used for generated_content_review); adds
    review_queue_items_p3_05_export_review_contract_check pinning
    export_review rows to the single static open/needs_gk_review profile
    (no lifecycle matrix, since this package never completes an export
    review, only creates the request); extends
    upload_lifecycle_audit_gate_a_operation_check (DROP+ADD, same
    constraint name, following the exact P3-01/P3-04 convention) to admit
    'export_review_requested'; adds
    upload_lifecycle_audit_p3_05_metadata_object_check requiring the ten
    metadata-only keys and forbidding draft_text, claim_text,
    claim_statement, evidence_text, block_text, citations, filename,
    storage_path, prompt, raw_content, source_text, generated_text,
    credential, and notes, with a closed-key-set check identical in shape to
    P3-01/P3-04's. No table, column, export-authority, final-gate, approval,
    or finalization state is introduced anywhere in the kai schema.
  - migrations/kai_sprint2_p3_05_export_review_request.rollback.sql (new) -
    deletes export_review_requested audit rows and export_review queue rows,
    drops the P3-05 metadata CHECK, restores the pre-P3-05 audit operation
    vocabulary, drops the P3-05 queue contract CHECK and partial unique
    index.
  - scripts/kai-sprint2-p3-05-export-review-request-verifier.sql (new) -
    asserts the export_review static-contract CHECK and partial unique
    index exist, the new audit operation and its metadata-only CHECK exist,
    and that no export-authority/final-gate/finalize/export column exists
    anywhere in kai.
  - scripts/kai-sprint2-p3-05-export-review-request-local-postgres.js (new) -
    a runner-owned loopback-only ephemeral PostgreSQL harness following the
    exact P3-04 pattern (loopback-only target proof before connection,
    synthetic database name, random high port, ambient DATABASE_URL and
    every ambient *_DATABASE_URL/PGURL_LOCAL variable overridden with a
    disconnectable sentinel for every child process), applying every prior
    migration plus this package's forward migration and both verifiers, then
    running the P3-05 boundary and integration specs together with the
    existing P3-01/P3-02/P3-03/P3-04 boundary specs against the same
    database.
  - __tests__/kai-sprint2-p3-05-export-review-request-boundary.spec.js (new) -
    service gate-order tests (KAI_SPRINT2_ENABLED then KAI_GENERATION_ENABLED
    then KAI_PUBLIC_EXPORT_ENABLED all precede any database-capable module
    load; exact input/mapped-human/tenant-membership/gk_admin-only
    authorization all precede the repository call, proven both by an
    injected fake repository and by static source inspection for the lazy
    `await import`) with an injected fake repository; repository-level tests
    against a hand-built fake transaction proving:
    validateRequestExportReviewInput's exact-key and canonical-timestamp
    rejection; fresh creation writes exactly one export_review row and one
    audit only when failed_gates is exactly the canonical three; a later
    replay (different actor, different now) converges with zero additional
    mutation or audit; currentUseEligible:false and an audience mismatch
    each block creation with a successful DTO and zero mutation/audit; an
    unresolved generated-content review conflicts without mutation; a
    missing draft returns not_found; a cross-tenant generated-content-review
    queue row conflicts; an existing export_review row without a matching
    audit conflicts rather than replaying; duplicate matching audits fail
    closed; a missing metadataOnlyAudit dependency is rejected before any
    transaction; an audit-prepare rejection and an audit-publish failure
    both fail closed with system_error rather than throwing past the
    repository boundary; the draft, its blocks, its citations, and the
    generated-content review queue row are byte-identical before and after
    every call; and the published audit metadata contains exactly the
    specified ten keys and no draft/claim/evidence text. Also proves the
    service-level DTO allowlist accepts only the exact accepted and blocked
    shapes.
  - __tests__/kai-sprint2-p3-05-export-review-request.integration.spec.js
    (new) - a runner-owned loopback-only PostgreSQL suite (non-loopback
    target refused before connection) that creates one authentic draft
    through the accepted P3-01 path, proves the export-review request is
    rejected with conflict_current_state_changed while the generated-content
    review is still open (not resolved/resolved), proves a missing
    tenant-scoped draft returns not_found, drives the draft through the
    real, unmodified P3-04 completeGeneratedContentReview to reach
    resolved/resolved, then proves one fresh real export-review request
    writes exactly one export_review queue row (queue_type='export_review',
    queue_status='open', review_status='needs_gk_review') and one audit row
    with the canonical three failed_gates and then replays idempotently with
    a different actor and a later timestamp with zero additional writes/
    audits; proves two genuinely concurrent identical requests (via
    Promise.all against two separate pool connections, serialized by the
    partial unique index) converge to exactly one queue row and one audit
    row; proves draft_status, blocks, citations, and the generated-content
    review queue row are untouched by the export-review request; proves the
    published audit metadata carries no draft/claim/evidence text; and
    confirms the ambient DATABASE_URL the harness sets is never the
    runner-owned target.
  - package.json - added verify:kai-sprint2-p3-05-export-review-request and
    test:kai-sprint2-p3-05-export-review-request scripts following the
    existing P3-01/P3-03/P3-04 naming convention.

TOOL_VERIFIED:
  - node --test __tests__/kai-sprint2-p3-05-export-review-request-boundary.spec.js ->
    21/21 pass
  - npm run verify:kai-sprint2-p3-05-export-review-request ->
    runner-owned loopback PostgreSQL target; 79/79 pass, 0 fail (boundary +
    integration + concurrency, together with the existing P3-01/P3-02/
    P3-03/P3-04 boundary specs against the same database)
  - npm run verify:kai-sprint2-p3-04-generated-content-review-completion ->
    58/58 pass, 0 fail (re-verified unchanged after the readReviewPacketState
    queue_type filter fix)
  - node --test __tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js
    __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js
    __tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js
    __tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js ->
    49/49 pass (re-verified unchanged after the readReviewPacketState
    queue_type filter fix)
  - npm run test:kai-sprint2 -> complete Sprint 2 suite 1548 pass, 21 skip, 0 fail
  - npm test -> complete repository suite 1653 pass, 21 skip, 0 fail
  - git diff --check -> no whitespace errors
  - git diff --cached --check -> no whitespace errors

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 through P3-04 remain accepted and closed.
  - P3-05 is authorized as one bounded GK export-review request foundation
    mutation service.

NOT_CONFIRMED:
  - No push, merge, deploy, generation or export enablement, export
    authority, final export gate, export record or file creation, export
    review completion/approval path, production configuration change, cloud
    access, real-client-data access, route, UI, assistant operation,
    listener, startup registration, P3-06 work, new P3-05 package proposal,
    or new P3-05 review cycle was performed.

## P3-06 - Read-only GK export-review packet (completed 2026-08-06)

Status: accepted for this local package as a dormant read-only service only.

Implementation evidence:
  - Backend/kai/services/kaiExportReviewService.js - added
    getGeneratedDraftExportReviewPacket(input, dependencies). Gate order is
    KAI_SPRINT2_ENABLED -> KAI_GENERATION_ENABLED ->
    KAI_PUBLIC_EXPORT_ENABLED -> exact four-key input validation
    (organizationId, generatedContentDraftId, exportReviewQueueItemId,
    actorContext; canonical UUIDs and no unknown/missing keys) ->
    mapped-human validation -> validateActorCanPerformOperation with
    allowedRoles restricted to gk_admin, which enforces active tenant
    membership and role -> only then lazy database-capable imports for the
    transaction and evaluators. The service opens exactly one REPEATABLE READ
    READ ONLY transaction through the injected/default runInTransaction and
    returns only an exact allowlisted DTO; malformed internal results or any
    top-level/block/citation/validator DTO key drift return system_error with
    data:null.
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js - added
    evaluateGeneratedDraftExportReviewPacketInTransaction(tx, input,
    evaluator) and evaluateExportReviewRequestStateInTransaction(tx, input).
    The packet evaluator first runs the accepted P3-02 immutable graph and
    citation evaluator inside the caller's transaction with the completed
    generated-content-review lifecycle profile (queue_status='resolved',
    review_status='resolved'), then reuses the new transaction-scoped P3-05
    request-state evaluator without calling the P3-05 mutation service,
    opening a nested transaction, or copying queue/audit matching logic into
    the service. The P3-05 evaluator loads exportReviewQueueItemId scoped by
    organizationId only, requires queue_type='export_review', validates the
    complete accepted P3-05 queue contract, requires exactly one successful
    export_review_requested audit, validates the accepted closed audit
    metadata contract, requires VAL-EXP-001 and the canonical failed_gates in
    exact order, validates actor/request timestamp well-formedness without
    returning them, and returns only requestedExportAudience plus the queue
    identity/status fields needed by P3-06. Absent tenant-scoped draft or
    queue returns not_found; scoped malformed, duplicated, stale, partial,
    wrong-target, wrong-audience, identity-mismatched, or incompatible graph/
    review state returns conflict_current_state_changed.
  - Backend/kai/dictionary/postgresGeneratedContentRepository.js - tightened
    the existing P3-05 export-review audit matcher to require canonical
    requested_timestamp and exact failed_gates ordering. This preserves the
    accepted replay behavior while giving P3-06 the order-sensitive closed
    audit metadata contract required here.
  - The P3-06 packet invokes the existing canonical VAL-EXP-001 validator
    once with generatedContentDraftId, requestedExportAudience, draftAudience,
    draftIsStillDraft:true, reviewIsResolved:true, currentUseEligible,
    finalGate:false, and affirmativeHumanExportAuthority:false. It derives
    exportEligible only from validatorResult.severity === "pass"; persisted
    P3-06 packets therefore remain exportEligible:false while the draft is
    still draft and no human export authority/final gate exists, while a
    legitimate current eligibility deterioration remains visible as
    currentUseEligible:false plus current_use_ineligible in canonical
    failed_gates.
  - __tests__/kai-sprint2-p3-06-export-review-packet-boundary.spec.js (new)
    - proves flag/input/auth gate order precedes database-capable loading;
    both shared evaluators run inside the same snapshot; only resolved/
    resolved generated-content review is accepted; the complete P3-05
    queue-plus-audit authority is required; queue-only, audit-only,
    duplicate-audit, wrong-target, wrong-audience, malformed, absent scoped
    draft, absent scoped queue, and cross-tenant queue state fail closed as
    specified; authentic P3-05 state returns draft blocks, citations, and the
    canonical validator; current eligibility deterioration remains visible
    but ineligible; exact top-level, block, citation, and validator allowlists
    reject raw-row, audit-metadata, actor, intake-file-context, storage,
    filename, prompt, credential, and internal-note injections; the read path
    contains no write/audit/transition/authority/final-gate/manifest/file/
    route/UI/listener wiring.
  - __tests__/kai-sprint2-p3-06-export-review-packet.integration.spec.js
    (new) - loopback-only PostgreSQL integration that refuses non-loopback
    targets before connection, imports no DB module at top level, creates an
    authentic draft through P3-01, completes generated-content review through
    P3-04, requests export review through P3-05, then reads the P3-06 packet
    with currentUseEligible:false to prove deterioration remains visible and
    ineligible; also proves scoped missing queue returns not_found and
    ambient DATABASE_URL is ignored in favor of the runner-owned loopback URL.
  - scripts/kai-sprint2-p3-06-export-review-packet-local-postgres.js (new)
    - runner-owned loopback-only ephemeral PostgreSQL harness applying the
    accepted migrations/seeds/verifiers through P3-05 and running P3-06
    boundary/integration plus P3-01 through P3-05 boundary coverage against
    the same synthetic database. No migration or rollback was added for
    P3-06.
  - package.json - added test:kai-sprint2-p3-06-export-review-packet and
    verify:kai-sprint2-p3-06-export-review-packet scripts.

TOOL_VERIFIED:
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test
    __tests__/kai-sprint2-p3-06-export-review-packet-boundary.spec.js ->
    11/11 pass.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run
    verify:kai-sprint2-p3-06-export-review-packet -> first sandbox attempt
    hit local PostgreSQL initdb shared-memory EPERM; escalated rerun used a
    runner-owned loopback PostgreSQL target and passed 85/85.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run
    verify:kai-sprint2-p3-05-export-review-request -> first sandbox attempt
    hit local PostgreSQL initdb shared-memory EPERM; escalated rerun passed
    79/79.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run
    verify:kai-sprint2-p3-04-generated-content-review-completion -> first
    sandbox attempt hit local PostgreSQL initdb shared-memory EPERM;
    escalated rerun passed 58/58.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node --test
    __tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js
    __tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js
    __tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js
    -> 30/30 pass.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run
    test:kai-sprint2 -> sandbox attempt hit local 127.0.0.1 listen EPERM in
    route tests; escalated rerun passed complete Sprint 2 suite: 1561 pass,
    22 skip, 0 fail.
  - DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm test -> escalated
    for local route listeners; complete repository suite passed: 1666 pass,
    22 skip, 0 fail.

USER_CONFIRMED:
  - P2-01 through P2-08 and P3-01 through P3-05 are accepted and closed.
  - P3-06 is authorized as one bounded dormant read-only GK export-review
    packet service package.

NOT_CONFIRMED:
  - No push, merge, deploy, flag enablement, approval/export authority, final
    gate, manifest/file creation, schema migration/rollback, route, UI,
    assistant operation, listener, production wiring, cloud access, real
    client data access, or P3-07 work was performed.
