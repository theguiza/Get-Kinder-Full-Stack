# Application rollout, feature flags and deployed acceptance

**For:** the owner, deciding and authorizing the production steps that follow the database packet. Evidence labels: `TOOL_VERIFIED` means checked in the repository during this preparation; `USER_CONFIRMED` means reported by the owner or recorded from earlier owner-supplied evidence and not re-proved here; `NOT_CONFIRMED` means unknown.

## 1. Revisions

| Item | Value | Evidence |
| --- | --- | --- |
| Intended application code | `637a9ca` (the packet commit after it adds only this packet, two local scripts and the ExecPlan record; no runtime code) | TOOL_VERIFIED |
| Last reported deployed revision | `3b99a90` ("reported deployed to getkinder.ai", recorded 2026-10-16) | USER_CONFIRMED (historical) |
| Currently deployed revision | unknown | NOT_CONFIRMED |
| Local `origin/main` tracking ref | `99a6693` (2026-10-19). Not fetched, so the remote may differ. | TOOL_VERIFIED for the local ref; remote NOT_CONFIRMED |
| Code delta `3b99a90..637a9ca` | 42 commits. Its only schema files are `03` and `04`. | TOOL_VERIFIED |
| Code delta `99a6693..637a9ca` | 16 commits, the same two migrations | TOOL_VERIFIED |
| Does publishing to `main` start a deployment? | The repository has no CI, Render or other deploy configuration, and the ExecPlan records auto-deploy as unknown. **Treat a push to `main` as a deployment.** | NOT_CONFIRMED |

`3b99a90` already contains the code that needs `01` (`dfe7e31`) and `02` (`4191684`) (TOOL_VERIFIED, ancestry). So if the Step 0 preflight reports M01 or M02 as `REQUIRED`, those production paths are failing today:
- the P1 downstream sweep and recovery;
- an organization administrator's sensitivity decision.

Applying `01` and `02` repairs them for the code already deployed.

## 2. Safe order

1. **Database first.** Run `RUN_IN_PGADMIN.md` through Step 6 (`99` = `PASS`). Send me the Step 0 and Step 6 CSVs.
2. **Then publish the application** (`main` at or after `637a9ca`) through your normal deployment path. This is a separately authorized push/deploy.
3. **Then the flag decision** below, if `KAI_PUBLIC_EXPORT_ENABLED` is not already on. This is separately authorized.
4. **Then the synthetic canary** (section 4). This is separately authorized.

Why this order:
- **New code needs the new schema.** Without `03`, recording a measurement fails: the new tables do not exist and the evidence CHECK rejects the measurement type. Without `04`, the organization's release fails at the limitation-snapshot role CHECK (SQLSTATE 23514). Never expose this code before Step 6 passes.
- **The old code is safe on the new schema** (TOOL_VERIFIED by reading the migrations; not executed against old code):
  - all four migrations only add tables or widen CHECKs, so every value the old constraints admitted is still admitted;
  - the two new triggers act only on rows whose role is `client_admin`, which no code before `4c39b5f` writes to those tables.

  So the database can be migrated while `3b99a90` or `99a6693` is still serving, and the application can later be rolled back without touching the database.

## 3. Feature flags (no change made; values not inspected)

| Flag | Needed for | Known production state |
| --- | --- | --- |
| `KAI_SPRINT2_ENABLED` | everything in KAI Sprint 2 | Was on on 2026-09-14 (production generation reached validation). Current state NOT_CONFIRMED. |
| `KAI_GENERATION_ENABLED` | draft generation, factual review, and release (the release route checks it) | Was on on 2026-09-14 (same evidence). Current state NOT_CONFIRMED. |
| `KAI_PUBLIC_EXPORT_ENABLED` | **every** release, manifest and report-delivery step, internal included, for both the organization and Get Kinder. Off means the organization's release returns `feature_disabled` and no release action is shown. | NOT_CONFIRMED |
| `KAI_FILE_UPLOAD_ENABLED` | customer upload | NOT_CONFIRMED |
| `KAI_WORKER_ENABLED` | the P1 parse/profile worker | NOT_CONFIRMED |

The model provider, GCS storage and ClamAV scanner configuration is also needed for the live canary. It was not inspected, so it is NOT_CONFIRMED.

**Decision needed only if `KAI_PUBLIC_EXPORT_ENABLED` is not already on.** Setting it to `true` in production also opens all Get Kinder export routes:
- funder and public candidates, authority decisions, and manifests;
- Markdown, CSV, PDF and DOCX delivery;
- Grant Response Packet and Board Reporting.

Each of those remains restricted to `gk_admin` and to the authority ledger. The flag's meaning was not changed. Keeping internal release behind it is your standing decision. Narrowing it to internal-only would be a separate code change.

## 4. Deployed synthetic acceptance (for later, separately authorized execution)

Reuse the steps of the local 15-test assembled run (`__tests__/kai-customer-file-to-report-assembled-browser-acceptance.integration.spec.js`). Run them by hand in the real application, as one active organization administrator of a synthetic organization, with a synthetic CSV of six data rows: one blank, and two duplicates of one record. Expected count: **5**.

| # | Step (UI wording from the local run) | Pass condition |
| --- | --- | --- |
| 1 | Sign in as the organization's active administrator | Impact Home loads; no 403 |
| 2 | Knowledge Studio → upload the CSV ("Upload the selected file", "Refresh status") | File accepted; storage object written |
| 3 | Security scan; if the scanner is unavailable, "Check security again" | File moves past `pending`, with no `malware_scan_unavailable` left |
| 4 | P1 worker | Parser run and profile recorded. Profile counts are 6 total and 1 blank (M01 table in use). |
| 5 | Sensitivity review as the administrator ("Submit review"): all six section 7.2 categories `absent`, allowed use, AI permitted | 200 (needs M02) |
| 6 | "Review & promote source" → "Promote" | Source version created |
| 7 | Measurement: attest period, then "Record definition and count" | Measured value **5** (needs M03) |
| 8 | **Get Kinder upstream** (`gk_reviewer`): evidence review, claim review, coverage acceptance of the three source-level dimensions | Claim `eligible = true` |
| 9 | "Generate internal evidence summary" | Draft created **through the configured live provider**. The local run used a mock model, so this is the first live-provider proof. |
| 10 | "Read draft" → confirm reading → "Approve factual content" | Factual review recorded as the administrator |
| 11 | Confirm the limitations → "Release internal report" | 200. The decision, snapshot, candidate and manifest are all attributed to the administrator (needs M04 and `KAI_PUBLIC_EXPORT_ENABLED`). |
| 12 | Open and download the Markdown | Count 5; the attested period; `[CIT-001]` tracing to claim, evidence and source version; ten limitation codes with wording; no row values, file names, rates, participant or causal wording |
| 13 | Currentness and revocation | A `gk_admin` revoke makes the report unavailable (409), the organization's re-release returns 422 `release_withdrawn_by_get_kinder`, and a `gk_admin` re-grant restores it. A superseded source version makes it stale (409). The local run had to force staleness by flipping `is_current`, because no application operation supersedes a version. |

**Who owns what:**
- **Get Kinder (upstream, still required):** evidence review, claim review, coverage acceptance; revoke and re-grant; review and release of anything non-ordinary, funder or public.
- **The customer:** sensitivity decision, promotion, measurement, generation, factual review, and release of the ordinary internal Evidence Summary.

## 5. Smallest authorizations still needed

1. You run `00` in pgAdmin (read-only) and send the CSV. Production state is unknown until then.
2. You run the migrations it lists, with their verifiers, then `99`. This is a production schema change, performed by you.
3. Push and deploy the application at or after `637a9ca`, only after `99` = `PASS`.
4. Set `KAI_PUBLIC_EXPORT_ENABLED=true`, only if it is not already on, and with the broader scope described in section 3.
5. Run the section 4 synthetic canary in production.
