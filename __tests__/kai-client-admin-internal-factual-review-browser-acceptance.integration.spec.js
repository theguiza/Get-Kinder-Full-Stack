import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Owner amendment 2026-10-23 browser acceptance: an organization
 * administrator records the source's five-record measurement, generates the
 * internal Evidence Summary, reviews its actual text, citation and
 * limitations and records the factual approval in Internal Drafts, then makes
 * the separate final-release decision there (migration
 * kai_sprint2_plan_a_organization_internal_release_authority), recorded under
 * the administrator's own identity and client_admin role, and opens and
 * downloads the Markdown. Get Kinder keeps its own release routes and can
 * withdraw the release. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-client-admin-internal-factual-review-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, and production
 * metadata-only audit on the runner cluster; resolveKaiActorContext with the
 * real GK organization binding; the built frontend bundle; the P1 profiler on
 * real synthetic CSV bytes; the administrator's measurement, claim, generation,
 * factual review, final release and report receipt through the UI; GK's
 * evidence, claim and coverage review, and its revocation and re-grant,
 * through the real routes.
 * Simulated / substituted (reported as such), as in the Prompt 8 acceptance:
 * - the Get Kinder session login (req.user from a harness cookie);
 * - the P1-03..P1-05 rows of the file (from the real profiler; upload, malware
 *   scan, and parsing are NOT executed);
 * - the P1-06 queue item and the sensitivity decision (here: every section
 *   7.2 high-risk category 'absent', so the draft is ordinary), through the
 *   real services with a stubbed metadata-only audit (GK setup);
 * - the model provider: the Anthropic SDK Messages prototype is patched in
 *   this process to a deterministic response;
 * - KAI_PUBLIC_EXPORT_ENABLED=true in this test process only;
 * - the stale-source refusal flips source_versions.is_current (no application
 *   operation supersedes a source version).
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`browser acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("internal factual review browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("client_admin internal factual review browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-client-admin-internal-factual-review");
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank",
  ], { stdio: "ignore" });
  const portFile = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await new Promise((r) => setTimeout(r, 100));
  const [port] = readFileSync(portFile, "utf8").split("\n");
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}`));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    send,
    listeners,
    async close() {
      try { await send("Browser.close"); } catch { /* already closing */ }
      socket.close();
      child.kill("SIGKILL");
    },
  };
}

async function openPage(browser, { baseUrl, legacyUserId }) {
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false };
      requests.push(entry);
      byId.set(params.requestId, entry);
    } else if (method === "Network.responseReceived" && byId.has(params.requestId)) {
      byId.get(params.requestId).status = params.response.status;
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && byId.has(params.requestId)) {
      byId.get(params.requestId).done = true;
    } else if (method === "Runtime.exceptionThrown") {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    }
  };
  browser.listeners.add(listener);
  for (const domain of ["Page", "Network", "Runtime"]) await browser.send(`${domain}.enable`, {}, sessionId);
  await browser.send("Network.setCookie", { name: "kai_harness_user", value: String(legacyUserId), url: baseUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 120)}`);
    return result.result.value;
  };
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 400; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 500) return;
    }
    throw new Error("network never went idle");
  };
  const waitFor = async (predicate, description, { timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 4000)}`);
  };
  const waitForText = (needle, options) => waitFor(async () => (await text()).includes(needle), `text: ${needle}`, options);
  const clickWhere = async (description, finder) => {
    const clicked = await evaluate(`(() => { const el = (${finder})(); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible control: ${description}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const clickNav = (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickTab = (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickButton = (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
    .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
  const clickIn = (selector, description) => clickWhere(description, `() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el && el.offsetParent !== null && !el.disabled ? el : null;
  }`);
  const tabLabels = () => evaluate(`[...document.querySelectorAll(".nav-tabs button")].map((el) => el.innerText.trim())`);
  const selectProject = async (engagementId) => {
    const ok = await evaluate(`(() => {
      const el = document.getElementById("gk-shell-project-select");
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(engagementId)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    assert.ok(ok, "project selector present");
  };
  // Same-origin JSON request from the signed-in page, as the bundle makes it.
  const api = (method, path, body) => evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)}, credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
    });
    return { status: response.status, body: await response.json() };
  })()`);
  return {
    requests: () => requests.slice(),
    mark: () => requests.length,
    requestsSince: (mark) => requests.slice(mark),
    exceptions,
    evaluate,
    text,
    idle,
    waitFor,
    waitForText,
    clickNav,
    clickTab,
    clickButton,
    clickIn,
    tabLabels,
    selectProject,
    api,
    async goto(path) {
      await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await idle();
    },
    async close() {
      browser.listeners.delete(listener);
      await browser.send("Target.closeTarget", { targetId });
    },
  };
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

async function runBrowserAcceptance() {
  process.env.KAI_PUBLIC_EXPORT_ENABLED = "true";
  // Model provider substitution: a dummy key for the SDK constructor (never a
  // real credential) and a deterministic Messages.create on the shared
  // prototype. The response also claims an approval, which must change nothing.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  const COMPLIANT_TEXT = "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30. "
    + "This is a count of source records, each counted as one programme session under the human-confirmed definition; "
    + "the period is attested in that definition and not verified against record dates. "
    + "1 blank record was excluded and 2 exact-duplicate records were included. "
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment were accepted for internal use only.";
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ system: payload.system, claims: requestBody.claims });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          approved: true,
          draftStatus: "released",
          blocks: requestBody.claims.map((claim) => ({
            text: claim.claimStatement.startsWith("The promoted source records 5 programme sessions")
              ? COMPLIANT_TEXT
              : `Provisional internal draft: claim review remains unresolved; evidence review remains unresolved; support has not yet been assessed; coverage gaps remain unresolved; client follow-ups remain unanswered. ${claim.claimStatement}`,
            citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }],
          })),
        }),
      }],
    };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { profileLocalTrustedFile } = await import("../Backend/kai/profiling/localProfilingKernel.js");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const {
    BASE_PATH,
    claimReviewCompletePath,
    claimReviewDecisionBody,
    claimTraceabilityPath,
    clientReleasedReportMarkdownPath,
    coverageInternalAcceptancePath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    clientInternalDraftPath,
    clientInternalDraftFactualReviewPath,
    clientInternalDraftReleasePath,
    evidenceExtractionPath,
    claimProposalPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const { sourceRecordCountMeasurementPath } = await import("../frontend/knowledgeStudio/clientSourceMeasurementLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const ORG_X = "0d000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0d000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7d000000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7d000000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7d000000-0000-4000-8000-0000000000e2";
  const BATCH_X = "11000000-0000-4000-8000-0000000000e1";
  const FILE_X = "21000000-0000-4000-8000-0000000000e1";
  const USERS = Object.freeze({ gkReviewer: 991, gkAdmin: 992, clientAdmin: 993, contributor: 994, clientReviewer: 995, inactiveAdmin: 996 });
  // Synthetic activity log: one data record per programme session, one empty
  // line (not a record), and two identical records (both counted).
  const CSV = [
    "session_date,programme,attendees",
    "2026-09-02,literacy,12",
    "2026-09-09,literacy,",
    "",
    "2026-09-16,mentoring,8",
    "2026-09-16,mentoring,8",
    "2026-09-23,mentoring,11",
    "",
  ].join("\n");
  // Independent verifier over the same bytes: non-empty lines after the header.
  const independentRecordCount = (text) => text.split(/\r?\n/).slice(1).filter((line) => line.split(",").some((cell) => cell.trim() !== "")).length;
  const MEASURED_LIMITATION_CODES = [
    "coverage.conflicting_source_indicators.accepted_internal_limitation",
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.requirement_alignment.accepted_internal_limitation",
    "coverage.small_cell_risk.accepted_internal_limitation",
    "coverage.time_period_clarity.resolved_risk_flagged",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified",
    "measurement.record_meaning_human_defined",
  ];

  // --- organizations, projects, GK binding, users ---------------------------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Session Society", "harbourline-sessions"], [ORG_Y, "Larchmont Other Society", "larchmont-other-sessions"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code] of [[PROJECT_X, ORG_X, "Session Programme 2026"], [PROJECT_X2, ORG_X, "Second Project"], [PROJECT_Y, ORG_Y, "Larchmont Project"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
  }
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'sessions-intake', 'received', 'not_reviewed')`, [BATCH_X, ORG_X, PROJECT_X]);
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  // The organization administrator: an active Get Kinder organization-admin
  // membership in a GK organization bound to KAI organization X. A second,
  // inactive administrator of the same organization.
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ('Harbourline Session Society', 'approved') RETURNING id");
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_X]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.clientAdmin]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', false)", [gkOrganization.id, USERS.inactiveAdmin]);
  const membership = async (legacyId, roleName, organizations = [ORG_X], globalRole = null) => {
    const user = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    for (const organizationId of organizations) {
      await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')", [organizationId, user.user_id, roleName]);
    }
    if (globalRole) await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [user.user_id, globalRole]);
    return user;
  };
  const gkReviewer = await membership(USERS.gkReviewer, "gk_reviewer", [ORG_X, ORG_Y], "gk_reviewer");
  await membership(USERS.gkAdmin, "gk_admin", [ORG_X], "gk_admin");
  await membership(USERS.contributor, "client_contributor");
  await membership(USERS.clientReviewer, "client_reviewer");
  const adminUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.clientAdmin, email: `user${USERS.clientAdmin}@harbourline.test` });
  const gkReviewerService = {
    actorType: "human",
    actorUserId: gkReviewer.user_id,
    kaiRoles: ["gk_reviewer"],
    platformSuperuser: false,
    organizationMemberships: [ORG_X, ORG_Y].map((organization_id) => ({ organization_id, membership_status: "active", role_name: "gk_reviewer" })),
  };

  /** P1-03..P1-05 rows of the file from the real profiler's output on the CSV bytes (the P1 worker's persistence - simulated). */
  async function seedProfiledFile() {
    const bytes = new TextEncoder().encode(CSV);
    const profile = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
    assert.equal(profile.status, "profiled");
    const checksum = "c".repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'sessions.csv', 'sessions.csv', $5, 'sha256', 'confirmed', 'synthetic-v1', $5, $6, now(),
         'text/csv', $6, 'clean', 'not_reviewed', 'passed', now())`,
      [FILE_X, BATCH_X, ORG_X, PROJECT_X, checksum, bytes.byteLength],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`, [ORG_X, FILE_X, checksum]);
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`, [ORG_X, FILE_X, run.parser_run_id, checksum, JSON.stringify(profile)]);
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`, [ORG_X, FILE_X, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256]);
    for (const field of profile.fields) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'string')`, [dictionary.data_dictionary_id, ORG_X, fileProfile.file_profile_id, field.field_key]);
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [ORG_X, FILE_X, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256]);
    return { sensitivityProfileId: sensitivity.intake_sensitivity_profile_id, profile };
  }

  /** Real P1-06 work and the real GK sensitivity 'reviewed' decision (AI permitted; every section 7.2 high-risk category absent) with its P1-07 handoff (audit stubbed). */
  async function reachReviewableSourceCandidate(intakeSensitivityProfileId) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG_X, intakeSensitivityProfileId, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid", [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId: ORG_X,
      intakeSensitivityProfileId,
      actorContext: gkReviewerService,
      payload: {
        expected_updated_at: new Date(item.updated_at).toISOString(),
        review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
          reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
          reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown", reviewed_allowed_use_status: "allowed",
          reviewed_llm_processing_allowed: true, reviewed_product_learning_allowed: false, reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
        },
      },
    }, { env: ENV });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    return decided.data.source_candidate_handoff.intake_source_candidate_id;
  }

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@harbourline.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();
  const decisionPath = (candidateId) => `${BASE_PATH}/admin/review-cockpit/source-candidates/${candidateId}/decision?organization_id=${ORG_X}`;
  const orgPath = (organizationId = ORG_X) => `${BASE_PATH}/admin/organizations/${organizationId}`;

  const gkReviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const gkAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkAdmin });
  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const contributorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.contributor });
  const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const inactiveAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.inactiveAdmin });
  // Same-origin GET of a non-JSON body from the signed-in page.
  const fetchText = (page, path) => page.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, { credentials: "same-origin" });
    return { status: response.status, disposition: response.headers.get("content-disposition"), body: await response.text() };
  })()`);
  const setInput = (page, selector, value) => page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const textOf = (page, selector) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null; })()`);
  const queueOf = async (queueType, targetId) => (await query(
    "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid",
    [ORG_X, queueType, targetId]))[0];
  // Knowledge Studio > Data Sources for the Project, as the existing client acceptance opens it.
  const openDataSources = async () => {
    await adminPage.goto("/impact-library");
    await adminPage.waitForText("Knowledge Studio");
    await adminPage.clickNav("Knowledge Studio");
    await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await adminPage.idle();
    await adminPage.clickTab("Data Sources");
    await adminPage.idle();
    await adminPage.selectProject(PROJECT_X);
    await adminPage.idle();
  };
  const created = (response, label) => assert.ok([200, 201].includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);
  const results = {};
  const ids = {};
  try {
    // Every page starts on the app's origin, so its same-origin requests resolve.
    for (const page of [gkReviewerPage, gkAdminPage, contributorPage, reviewerPage, inactiveAdminPage]) await page.goto("/impact-library");
    await test("setup: a real CSV profile; GK reviews processing permissions and promotes the source", async () => {
      const { sensitivityProfileId, profile } = await seedProfiledFile();
      assert.deepEqual([profile.counts.row_count, profile.counts.blank_record_count, profile.counts.duplicate_row_count], [6, 1, 2]);
      assert.equal(independentRecordCount(CSV), 5);
      const candidate = await reachReviewableSourceCandidate(sensitivityProfileId);
      const promoted = await gkReviewerPage.api("POST", decisionPath(candidate), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
      const [version] = await query("SELECT source_version_id::text, is_current FROM kai.source_versions WHERE organization_id = $1::uuid", [ORG_X]);
      assert.equal(version.is_current, true);
      ids.sourceVersionId = version.source_version_id;
    });

    await test("A1: in Data Sources the organization administrator sees the server's counts and calculation and records the definition; the measurement is the independent count", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-source-measurement="${ids.sourceVersionId}"]`)), "Count records");
      await adminPage.clickIn(`[data-client-open-source-measurement="${ids.sourceVersionId}"]`, "Count records");
      await adminPage.waitForText("Counted records = data records minus blank records = 5");
      const counts = await textOf(adminPage, "[data-client-source-measurement-counts]");
      assert.match(counts, /Data records after the header row: 6/);
      assert.match(counts, /Blank records \(not counted\): 1/);
      assert.match(counts, /Exact-duplicate records \(still counted\): 2/);
      assert.match(counts, /Exact duplicates stay included/);
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-counted]"), "5");
      for (const [field, value] of [
        ["countedUnit", "programme session"], ["unitLabel", "programme sessions"],
        ["definitionText", "Each row of the session log records one delivered programme session."],
        ["inclusionRule", "Every data row after the header row that has at least one value."],
        ["exclusionRule", "The header row and empty rows."], ["periodStart", "2026-09-01"], ["periodEnd", "2026-09-30"],
      ]) assert.ok(await setInput(adminPage, `[data-client-source-measurement-field="${field}"]`, value), field);
      await adminPage.waitForText("Confirm that the reporting period is your organization's statement.");
      await adminPage.clickIn('[data-client-source-measurement-field="periodAttested"]', "attest period");
      const mark = adminPage.mark();
      await adminPage.clickIn("[data-client-source-measurement-submit]", "Record definition and count");
      await adminPage.waitForText("Measurement: 5 programme sessions");
      await adminPage.idle();
      const requests = adminPage.requestsSince(mark).filter((entry) => entry.url.includes("/record-count-measurement"));
      assert.deepEqual(requests[0] && [requests[0].method, requests[0].status], ["POST", 200], "the measurement write succeeded");
      assert.ok(requests.slice(1).every((entry) => entry.method === "GET" && entry.status === 200), JSON.stringify(requests));
      assert.match(await adminPage.text(), /Reporting period 2026-09-01 to 2026-09-30, as stated by your organization \(not verified against dates in the records\)\./);
      const limitations = await adminPage.evaluate(`[...document.querySelectorAll("[data-client-source-measurement-limitation]")].map((el) => el.getAttribute("data-client-source-measurement-limitation"))`);
      assert.deepEqual(limitations, ["measurement.blank_records_excluded", "measurement.duplicate_records_included",
        "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined"]);
      const [measurement] = await query("SELECT measured_value, evidence_item_id::text FROM kai.evidence_measurements WHERE organization_id = $1::uuid", [ORG_X]);
      assert.equal(Number(measurement.measured_value), independentRecordCount(CSV));
      const [definition] = await query("SELECT created_by_type, period_start::text FROM kai.source_measurement_definitions WHERE organization_id = $1::uuid", [ORG_X]);
      assert.deepEqual([definition.created_by_type, definition.period_start], ["human", "2026-09-01"]);
      ids.evidenceItemId = measurement.evidence_item_id;
    });

    await test("A2: the administrator proposes the measured claim from the panel; it states the count, records its gaps, and creates no client follow-up", async () => {
      await adminPage.clickIn(`[data-client-source-measurement-propose-claim="${ids.evidenceItemId}"]`, "Propose a claim");
      await adminPage.waitForText("Claim: The promoted source records 5 programme sessions");
      assert.match(await adminPage.text(), /status: proposed; review: needs_gk_review/);
      const [claim] = await query("SELECT claim_id::text, statement FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_X, ids.evidenceItemId]);
      assert.match(claim.statement, /^The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
      const [gaps] = await query(`SELECT (SELECT count(*) FROM kai.gap_log_items WHERE claim_id = $1::uuid)::int AS gaps,
        (SELECT count(*) FROM kai.client_followup_items WHERE claim_id = $1::uuid)::int AS followups`, [claim.claim_id]);
      assert.ok(gaps.gaps > 0, "gap state recorded at proposal");
      assert.equal(gaps.followups, 0, "no unnecessary client follow-up");
      ids.claimId = claim.claim_id;
    });

    await test("A2b: create a legacy field-presence claim through P2-01/P2-03 and leave its P2-04 state absent", async () => {
      const extracted = await adminPage.api("POST", evidenceExtractionPath(ORG_X, ids.sourceVersionId), {});
      created(extracted, "field-presence evidence extraction");
      const evidenceItem = extracted.body.data.evidenceItems.find((item) => item.evidence_type === "dictionary_field_presence_fact");
      assert.ok(evidenceItem, JSON.stringify(extracted.body.data));
      const proposed = await adminPage.api("POST", claimProposalPath(ORG_X, evidenceItem.evidence_item_id), {});
      created(proposed, "legacy field-presence claim proposal");
      ids.legacyClaimId = proposed.body.data.claim.claim_id;
      const traceability = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.legacyClaimId, "internal"));
      assert.equal(traceability.status, 409);
      assert.equal(traceability.body.data.traceability_conflict_reason, "gap_dimension_requires_missing_p204_state");
      const [state] = await query(
        `SELECT (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid)::int AS gaps,
                (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid)::int AS followups`,
        [ORG_X, ids.legacyClaimId],
      );
      assert.deepEqual(state, { gaps: 0, followups: 0 });
    });

    await test("A3: a conflicting second definition is refused with the recovery step, and the recorded one is still what the panel shows", async () => {
      const conflict = await adminPage.api("POST", sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId), {
        counted_unit: "attendance record", unit_label: "attendance records", definition_text: "Each row is one attendance record.",
        inclusion_rule: "Rows with a value.", exclusion_rule: "Empty rows.",
      });
      assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
      assert.equal(conflict.body.blockers[0].blocking_reason, "measurement_definition_already_recorded");
      assert.match(conflict.body.blockers[0].required_fix, /upload a new intake version/);
      await adminPage.clickButton("Close");
      await adminPage.clickIn(`[data-client-open-source-measurement="${ids.sourceVersionId}"]`, "Count records again");
      await adminPage.waitForText("One record is one programme session");
      assert.equal(await textOf(adminPage, "[data-client-source-measurement-form]"), null, "no form for a recorded version");
      const [rows] = await query("SELECT count(*)::int AS definitions FROM kai.source_measurement_definitions WHERE organization_id = $1::uuid", [ORG_X]);
      assert.equal(rows.definitions, 1);
    });

    await test("A4: other roles, an inactive administrator, another organization, and unknown or malformed versions fail safely", async () => {
      const basisPath = sourceRecordCountMeasurementPath(ORG_X, ids.sourceVersionId);
      const outcomes = {};
      for (const [label, page, path, status] of [
        ["client_contributor", contributorPage, basisPath, 403],
        ["client_reviewer", reviewerPage, basisPath, 403],
        ["inactive organization administrator", inactiveAdminPage, basisPath, 403],
        ["another organization", adminPage, sourceRecordCountMeasurementPath(ORG_Y, ids.sourceVersionId), 403],
        ["unknown version", adminPage, sourceRecordCountMeasurementPath(ORG_X, "21000000-0000-4000-8000-0000000fffff"), 404],
        ["malformed version", adminPage, sourceRecordCountMeasurementPath(ORG_X, "not-a-uuid"), 422],
      ]) {
        const response = await page.api("GET", path);
        assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
        outcomes[label] = response.status;
      }
      const write = await contributorPage.api("POST", basisPath, { counted_unit: "x", unit_label: "x", definition_text: "x", inclusion_rule: "x", exclusion_rule: "x" });
      assert.equal(write.status, 403);
      results.a4 = outcomes;
    });

    await test("B: GK reviews the measurement evidence and the claim and accepts the source-level limitations (GK routes)", async () => {
      const evidenceQueue = await queueOf("evidence_review", ids.evidenceItemId);
      const evidenceDecision = await gkReviewerPage.api("POST", evidenceReviewCompletePath(ORG_X, ids.evidenceItemId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      created(evidenceDecision, "evidence review");
      const claimQueue = await queueOf("claim_review", ids.claimId);
      const claimDecision = await gkReviewerPage.api("POST", claimReviewCompletePath(ORG_X, ids.claimId, claimQueue.review_queue_item_id),
        claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] }));
      created(claimDecision, "claim review");
      const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.equal(traced.status, 200, JSON.stringify(traced.body));
      const unresolved = Object.entries(traced.body.data.dimensions).filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
      for (const dimensionKey of unresolved) {
        const accepted = await gkReviewerPage.api("POST", coverageInternalAcceptancePath(ORG_X, ids.claimId, dimensionKey), {});
        created(accepted, dimensionKey);
      }
      const eligible = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.equal(eligible.body.data.eligible, true, JSON.stringify(eligible.body.data.blockerCodes));
    });

    await test("C: the administrator generates the internal Evidence Summary and an internal impact narrative in the UI; the summary awaits the administrator's own review, the narrative Get Kinder's", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.claimId}"]`)), "the measured claim");
      await adminPage.clickIn(`[data-client-claim="${ids.claimId}"] input[type=checkbox]`, "Use in an internal draft");
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      assert.equal(modelCalls.length, 1);
      assert.deepEqual(modelCalls[0].claims[0].limitationCodes, MEASURED_LIMITATION_CODES);
      const [draft] = await query("SELECT generated_content_draft_id::text, draft_status, review_status FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = 'evidence_summary'", [ORG_X]);
      assert.deepEqual([draft.draft_status, draft.review_status], ["draft", "needs_gk_review"], "the model's approval/release fields are not authoritative");
      ids.draftId = draft.generated_content_draft_id;
      await adminPage.waitFor(async () => (await textOf(adminPage, `[data-client-internal-draft-detail="${ids.draftId}"]`)) !== null, "the new draft opens");
      await adminPage.idle();
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-draft-detail-review-state]").getAttribute("data-client-internal-draft-detail-review-state")`), "awaiting_organization_review");
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-draft-release-state]").getAttribute("data-client-internal-draft-release-state")`), "awaiting_organization_review");
      // The reviewer sees the actual text, the cited claim with its review status, and the limitations.
      const detailText = await textOf(adminPage, `[data-client-internal-draft-detail="${ids.draftId}"]`);
      assert.ok(detailText.includes(COMPLIANT_TEXT), "the draft's actual text");
      assert.match(await textOf(adminPage, `[data-client-internal-draft-citation="${ids.claimId}"]`), /The promoted source records 5 programme sessions[\s\S]*claim review:/);
      assert.match(await textOf(adminPage, "[data-client-internal-draft-limitations]"), /Internal use only\.[\s\S]*Not approved for funder or public use[\s\S]*Nobody has completed the factual review/);
      assert.ok(await textOf(adminPage, "[data-client-factual-review-action]"), "the approval action is offered");
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-factual-review-approve]").disabled`), true, "disabled until the reviewer confirms reading");

      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.claimId}"]`)), "the measured claim again");
      await adminPage.clickIn(`[data-client-claim="${ids.claimId}"] input[type=checkbox]`, "Use in an internal draft");
      await adminPage.clickButton("Generate internal impact narrative");
      await adminPage.waitForText("Internal impact narrative created");
      await adminPage.idle();
      const [narrative] = await query("SELECT generated_content_draft_id::text FROM kai.generated_content_drafts WHERE organization_id = $1::uuid AND content_type = 'impact_narrative'", [ORG_X]);
      ids.narrativeId = narrative.generated_content_draft_id;
      await adminPage.clickIn(`[data-client-internal-draft="${ids.narrativeId}"] button`, "Read the narrative");
      await adminPage.waitFor(async () => (await textOf(adminPage, `[data-client-internal-draft-detail="${ids.narrativeId}"]`)) !== null, "the narrative");
      await adminPage.idle();
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-draft-detail-review-state]").getAttribute("data-client-internal-draft-detail-review-state")`), "awaiting_get_kinder_review");
      assert.match(await textOf(adminPage, "[data-client-factual-review-get-kinder-required]"), /Only internal evidence summaries can be reviewed by your organization/);
      assert.equal(await textOf(adminPage, "[data-client-factual-review-action]"), null, "no approval action for a Get Kinder-only draft");
      results.c = { summary: "awaiting_organization_review", narrative: "awaiting_get_kinder_review" };
    });

    await test("C2: a legacy field-presence draft shows its eligibility blocker, next action, and no factual-approval control", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.legacyClaimId}"]`)), "the legacy field-presence claim");
      await adminPage.clickIn(`[data-client-claim="${ids.legacyClaimId}"] input[type=checkbox]`, "Use the legacy claim in an internal draft");
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created");
      await adminPage.idle();
      const [blockedDraft] = await query(
        `SELECT d.generated_content_draft_id::text
           FROM kai.generated_content_drafts d
           JOIN kai.generated_content_citations c ON c.generated_content_block_id IN (
             SELECT generated_content_block_id FROM kai.generated_content_blocks WHERE generated_content_draft_id = d.generated_content_draft_id)
          WHERE d.organization_id = $1::uuid AND d.content_type = 'evidence_summary'
            AND d.generated_content_draft_id <> $2::uuid AND c.claim_id = $3::uuid
          ORDER BY d.created_at DESC LIMIT 1`,
        [ORG_X, ids.draftId, ids.legacyClaimId],
      );
      assert.ok(blockedDraft, "the legacy claim's generated draft is persisted");
      ids.blockedDraftId = blockedDraft.generated_content_draft_id;
      await adminPage.waitFor(async () => (await textOf(adminPage, `[data-client-internal-draft-detail="${ids.blockedDraftId}"]`)) !== null, "the ineligible draft opens");
      await adminPage.idle();
      const blockedDetail = await textOf(adminPage, `[data-client-internal-draft-detail="${ids.blockedDraftId}"]`);
      assert.match(blockedDetail, /Provisional internal draft: claim review remains unresolved/);
      assert.match(blockedDetail, /coverage gaps remain unresolved; client follow-ups remain unanswered/);
      assert.match(blockedDetail, /Factual approval blocked/);
      assert.match(blockedDetail, /At least one cited claim is not currently eligible for internal use/);
      assert.match(blockedDetail, /Ask Get Kinder to review the cited claims/);
      assert.equal(await textOf(adminPage, "[data-client-factual-review-action]"), null, "no approval control while the service blocks it");
      const factualReview = await adminPage.api("GET", clientInternalDraftPath(ORG_X, PROJECT_X, ids.blockedDraftId));
      assert.equal(factualReview.body.data.factualReview.actorMayApprove, false);
      assert.deepEqual(factualReview.body.data.factualReview.blockedReasons, ["cited_claims_not_currently_eligible"]);
      results.c2 = { heading: "Factual approval blocked", blocker: "cited_claims_not_currently_eligible", approvalControl: false };
    });

    await test("D1: the factual-review route refuses other roles, inactive or other-organization administrators, GK staff, other Projects, other decisions, and a Get Kinder-only draft, writing nothing", async () => {
      const path = clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X, ids.draftId);
      const before = await queueOf("generated_content_review", ids.draftId);
      const outcomes = {};
      for (const [label, page, target, body, status] of [
        ["client_contributor", contributorPage, path, { decision: "approved" }, 403],
        ["client_reviewer", reviewerPage, path, { decision: "approved" }, 403],
        ["inactive organization administrator", inactiveAdminPage, path, { decision: "approved" }, 403],
        ["GK reviewer (GK uses its own review route)", gkReviewerPage, path, { decision: "approved" }, 403],
        ["GK administrator", gkAdminPage, path, { decision: "approved" }, 403],
        ["another organization", adminPage, clientInternalDraftFactualReviewPath(ORG_Y, PROJECT_Y, ids.draftId), { decision: "approved" }, 403],
        ["another Project of the organization", adminPage, clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X2, ids.draftId), { decision: "approved" }, 404],
        ["a rejection (no such outcome exists)", adminPage, path, { decision: "rejected" }, 422],
        ["needs changes (no such outcome exists)", adminPage, path, { decision: "needs_changes" }, 422],
        ["the Get Kinder-only narrative", adminPage, clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X, ids.narrativeId), { decision: "approved" }, 422],
      ]) {
        const response = await page.api("POST", target, body);
        assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
        outcomes[label] = response.status;
      }
      const narrative = await adminPage.api("POST", clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X, ids.narrativeId), { decision: "approved" });
      assert.deepEqual(narrative.body.blockers.map((blocker) => blocker.blocking_reason), ["content_type_requires_get_kinder_review"]);
      assert.deepEqual(await queueOf("generated_content_review", ids.draftId), before, "nothing written");
      const [audits] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation LIKE 'generated_content_review_%'", [ORG_X]);
      assert.equal(audits.n, 0);
      results.d1 = outcomes;
    });

    await test("D2: the administrator confirms reading the draft and approves its factual content in the UI; the existing review lifecycle records it, attributed to the administrator; nothing is released", async () => {
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-factual-review-action]")), "the approval action");
      await adminPage.clickIn("[data-client-factual-review-confirm]", "confirm reading");
      await adminPage.waitFor(async () => adminPage.evaluate(`!document.querySelector("[data-client-factual-review-approve]").disabled`), "approve enabled");
      const mark = adminPage.mark();
      await adminPage.clickIn("[data-client-factual-review-approve]", "Approve factual content");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-factual-review-recorded]")), "approval recorded");
      await adminPage.idle();
      const posts = adminPage.requestsSince(mark).filter((entry) => entry.method === "POST");
      assert.deepEqual(posts.map((entry) => [new URL(entry.url).pathname, entry.status]), [[clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X, ids.draftId), 200]]);
      await adminPage.waitForText("Factual review completed by your organization");
      await adminPage.waitForText("Reviewed; awaiting your release decision");
      assert.equal(await textOf(adminPage, "[data-client-factual-review-action]"), null, "no further approval action");
      assert.equal(await textOf(adminPage, "[data-client-open-released-report]"), null, "nothing to open before the release decision");
      assert.ok(await textOf(adminPage, "[data-client-internal-release-action]"), "the separate release decision is offered");
      const queue = await queueOf("generated_content_review", ids.draftId);
      const [queueState] = await query("SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid", [queue.review_queue_item_id]);
      assert.deepEqual(queueState, { queue_status: "resolved", review_status: "resolved" });
      const lifecycle = await query(
        `SELECT operation, metadata->>'actor_id' AS actor_id, metadata->>'contract' AS contract FROM kai.upload_lifecycle_audit
          WHERE organization_id = $1::uuid AND operation LIKE 'generated_content_review_%' ORDER BY created_at, operation`, [ORG_X]);
      assert.deepEqual(lifecycle.map((row) => [row.operation, row.actor_id, row.contract]), [
        ["generated_content_review_started", adminUser.user_id, "p3_stage_b_generated_content_review_start_v1"],
        ["generated_content_review_completed", adminUser.user_id, "kai_organization_internal_factual_review_completion_v1"],
      ]);
      const events = await query("SELECT action, actor_user_id::text AS actor FROM kai.audit_events WHERE organization_id = $1::uuid AND action LIKE 'generated_content_review_%' ORDER BY audit_event_id", [ORG_X]);
      assert.deepEqual(events.map((row) => [row.action, row.actor]), [["generated_content_review_started", adminUser.user_id], ["generated_content_review_completed", adminUser.user_id]]);
      const [counts] = await query(`SELECT (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS candidates,
        (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS decisions,
        (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG_X]);
      assert.deepEqual(counts, { candidates: 0, decisions: 0, manifests: 0 }, "approval releases nothing");
      // A repeat is a replay and records nothing.
      const replay = await adminPage.api("POST", clientInternalDraftFactualReviewPath(ORG_X, PROJECT_X, ids.draftId), { decision: "approved" });
      assert.deepEqual([replay.status, replay.body.data.replayed], [200, true]);
      results.d2 = { reviewState: "reviewed_by_your_organization", releasedBy: null };
    });

    await test("E1: the GK release routes still refuse the administrator for every audience, and the release route refuses other roles, GK staff, other organizations and Projects, other decisions, an unconfirmed decision and the Get Kinder-only narrative, writing nothing", async () => {
      const draftPath = `${orgPath()}/generated-content-drafts/${ids.draftId}`;
      for (const audience of ["internal", "funder", "public"]) {
        assert.equal((await adminPage.api("POST", `${draftPath}/export-review-request`, { requested_export_audience: audience })).status, 403, `GK route, customer ${audience} export review`);
      }
      assert.equal((await adminPage.api("POST", `${draftPath}/limitation-snapshot`, {})).status, 403);
      assert.equal((await adminPage.api("POST", `${draftPath}/export-candidates`, {})).status, 403);
      const path = clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.draftId);
      const body = { decision: "release_for_internal_use", limitations_confirmed: true };
      const outcomes = {};
      for (const [label, page, target, payload, status] of [
        ["client_contributor", contributorPage, path, body, 403],
        ["client_reviewer", reviewerPage, path, body, 403],
        ["inactive organization administrator", inactiveAdminPage, path, body, 403],
        ["GK reviewer (GK releases through its own routes)", gkReviewerPage, path, body, 403],
        ["GK administrator", gkAdminPage, path, body, 403],
        ["another organization", adminPage, clientInternalDraftReleasePath(ORG_Y, PROJECT_Y, ids.draftId), body, 403],
        ["another Project of the organization", adminPage, clientInternalDraftReleasePath(ORG_X, PROJECT_X2, ids.draftId), body, 404],
        ["unconfirmed limitations", adminPage, path, { decision: "release_for_internal_use", limitations_confirmed: false }, 422],
        ["a funder release (no such decision)", adminPage, path, { decision: "release_for_funder_use", limitations_confirmed: true }, 422],
        ["the Get Kinder-only narrative", adminPage, clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.narrativeId), body, 422],
      ]) {
        const response = await page.api("POST", target, payload);
        assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
        outcomes[label] = response.status;
      }
      const narrative = await adminPage.api("POST", clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.narrativeId), body);
      assert.deepEqual(narrative.body.blockers.map((blocker) => blocker.blocking_reason), ["content_type_requires_get_kinder_review", "factual_review_not_complete"]);
      const [counts] = await query(`SELECT (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'export_review')::int AS export_reviews,
        (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS snapshots,
        (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS decisions,
        (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG_X]);
      assert.deepEqual(counts, { export_reviews: 0, snapshots: 0, decisions: 0, manifests: 0 }, "nothing written");
      results.e1 = outcomes;
    });

    await test("E2: the administrator confirms the limitations and releases the report in the UI; the existing chain records it under the administrator's own identity and client_admin role, with no Get Kinder release step", async () => {
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-internal-release-action]")), "the release action");
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-release-submit]").disabled`), true, "disabled until confirmed");
      await adminPage.clickIn("[data-client-internal-release-confirm]", "confirm the limitations");
      await adminPage.waitFor(async () => adminPage.evaluate(`!document.querySelector("[data-client-internal-release-submit]").disabled`), "release enabled");
      const mark = adminPage.mark();
      await adminPage.clickIn("[data-client-internal-release-submit]", "Release internal report");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-internal-release-recorded]")), "release recorded");
      await adminPage.idle();
      const posts = adminPage.requestsSince(mark).filter((entry) => entry.method === "POST");
      assert.deepEqual(posts.map((entry) => [new URL(entry.url).pathname, entry.status]), [[clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.draftId), 200]], "one release decision");
      await adminPage.waitForText("Released for internal use");
      await adminPage.waitForText("Released by your organization");
      assert.equal(await textOf(adminPage, "[data-client-internal-release-action]"), null, "no further release action");
      const [row] = await query(
        `SELECT m.export_manifest_id::text, m.created_by::text AS manifest_by, m.export_review_queue_item_id::text,
                d.decided_by::text, d.decided_by_role, d.decision_type, d.decision_action,
                c.export_candidate_id::text, c.created_by::text AS candidate_by, c.requested_audience,
                s.confirmed_by::text, s.confirmed_by_role
           FROM kai.export_manifests m
           JOIN kai.human_authority_decisions d ON d.decision_id = m.effective_authority_decision_id
           JOIN kai.export_candidates c ON c.export_candidate_id = m.export_candidate_id
           JOIN kai.limitation_snapshots s ON s.limitation_snapshot_id = c.limitation_snapshot_id
          WHERE m.organization_id = $1::uuid`, [ORG_X]);
      assert.deepEqual([row.decided_by, row.decided_by_role, row.decision_type, row.decision_action], [adminUser.user_id, "client_admin", "export_authority_granted", "grant"]);
      assert.deepEqual([row.confirmed_by, row.confirmed_by_role, row.candidate_by, row.manifest_by, row.requested_audience],
        [adminUser.user_id, "client_admin", adminUser.user_id, adminUser.user_id, "internal"]);
      ids.exportManifestId = row.export_manifest_id;
      ids.exportCandidateId = row.export_candidate_id;
      ids.exportReviewQueueItemId = row.export_review_queue_item_id;
      const [entry] = await query("SELECT limitation_codes FROM kai.limitation_snapshot_entries WHERE organization_id = $1::uuid", [ORG_X]);
      assert.deepEqual(entry.limitation_codes, MEASURED_LIMITATION_CODES, "every material limitation, confirmed by the administrator");
      const actors = await query(
        `SELECT operation, coalesce(metadata->>'actor_id', metadata->>'decided_by') AS actor FROM kai.upload_lifecycle_audit
          WHERE organization_id = $1::uuid AND operation IN ('export_review_requested', 'export_review_started', 'export_review_completed',
                'limitation_snapshot_confirmed', 'export_candidate_created', 'human_authority_decision_recorded') ORDER BY created_at, operation`, [ORG_X]);
      assert.deepEqual(actors.map((r) => r.operation), ["export_review_requested", "export_review_started", "export_review_completed", "limitation_snapshot_confirmed", "export_candidate_created", "human_authority_decision_recorded"]);
      assert.ok(actors.every((r) => r.actor === adminUser.user_id), JSON.stringify(actors));
      const events = await query(
        `SELECT DISTINCT actor_user_id::text AS actor FROM kai.audit_events WHERE organization_id = $1::uuid
            AND action IN ('export_review_requested', 'export_review_started', 'export_review_completed', 'limitation_snapshot_confirmed', 'export_candidate_created', 'human_authority_decision_recorded', 'export_manifest_created')`, [ORG_X]);
      assert.deepEqual(events.map((r) => r.actor), [adminUser.user_id], "no Get Kinder actor in any release step");
      // Get Kinder can still read the same released document through its own route.
      const gkMarkdown = await fetchText(gkAdminPage, `${orgPath()}/export-manifests/${ids.exportManifestId}/markdown`);
      assert.equal(gkMarkdown.status, 200, gkMarkdown.body);
      ids.gkMarkdown = gkMarkdown.body;
      // A repeat writes nothing.
      const replay = await adminPage.api("POST", clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.draftId), { decision: "release_for_internal_use", limitations_confirmed: true });
      assert.deepEqual([replay.status, replay.body.data.replayed, replay.body.data.releasedReportId], [200, true, ids.exportManifestId]);
      results.e2 = { decidedByRole: row.decided_by_role, confirmedByRole: row.confirmed_by_role, sameActor: row.decided_by === adminUser.user_id };
    });

    await test("F: the same administrator opens and downloads the released Markdown: the independent count, the period qualification, the citation and every limitation", async () => {
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitForText("Released by your organization");
      assert.equal(await adminPage.evaluate(`document.querySelector("[data-client-internal-draft-detail-review-state]").getAttribute("data-client-internal-draft-detail-review-state")`), "reviewed_by_your_organization");
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-released-report="${ids.exportManifestId}"]`, "Open released report");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-released-report-markdown]")), "the released Markdown");
      await adminPage.idle();
      const receipt = adminPage.requestsSince(mark).filter((entry) => entry.url.includes("/client-released-reports/"));
      assert.deepEqual(receipt.map((entry) => [entry.method, entry.status]), [["GET", 200]]);
      const shown = await textOf(adminPage, "[data-client-released-report-markdown]");
      assert.equal(shown, ids.gkMarkdown, "exactly the manifest's document, as the GK route renders it");
      const download = await adminPage.evaluate(`document.querySelector("[data-client-download-released-report]").getAttribute("href")`);
      const fetched = await fetchText(adminPage, download);
      assert.deepEqual([fetched.status, fetched.body], [200, ids.gkMarkdown]);
      assert.match(fetched.disposition, /attachment/);
      assert.equal(Number((/records (\d+) programme sessions/.exec(shown) || [])[1]), independentRecordCount(CSV));
      assert.match(shown, /count of source records, each counted as one programme session under the human-confirmed definition/);
      assert.match(shown, /1 blank record was excluded and 2 exact-duplicate records were included/);
      assert.match(shown, /period is attested in that definition and not verified against record dates/);
      assert.ok(shown.includes(`Claim \`${ids.claimId}\`; evidence \`${ids.evidenceItemId}\`;`), "claim and evidence citation");
      assert.ok(shown.includes(`source version \`${ids.sourceVersionId}\``), "source version citation");
      for (const code of MEASURED_LIMITATION_CODES) assert.ok(shown.includes(`\`${code}\``), code);
      assert.match(shown, /Missing values: a known limitation of this source, recorded and not removed\./);
      assert.doesNotMatch(shown.split("## Citation Appendix")[0], /\b(participants?|attendees|rate|outcomes?|because|caused?|improv\w*|impact\w*)\b|%/i);
      assert.doesNotMatch(shown, /literacy|mentoring|2026-09-16|sessions\.csv/, "no row values or file names");
      results.f = { status: 200, bytes: shown.length, count: independentRecordCount(CSV) };
    });

    await test("G: Get Kinder can withdraw the organization's release, which the organization cannot re-grant; a changed (stale) source is refused", async () => {
      const clientPath = clientReleasedReportMarkdownPath(ORG_X, PROJECT_X, ids.exportManifestId);
      const authorityPath = `${orgPath()}/export-candidates/${ids.exportCandidateId}/final-release-authority`;
      created(await gkAdminPage.api("POST", authorityPath, { requested_audience: "internal", decision_action: "revoke" }), "revoke");
      assert.equal((await fetchText(adminPage, clientPath)).status, 409);
      await adminPage.clickIn(`[data-client-internal-draft="${ids.draftId}"] button`, "Read draft");
      await adminPage.waitForText("Released earlier; no longer available");
      assert.equal(await textOf(adminPage, "[data-client-open-released-report]"), null);
      assert.equal(await textOf(adminPage, "[data-client-internal-release-action]"), null, "no release action for a withdrawn release");
      const again = await adminPage.api("POST", clientInternalDraftReleasePath(ORG_X, PROJECT_X, ids.draftId), { decision: "release_for_internal_use", limitations_confirmed: true });
      assert.deepEqual([again.status, again.body.blockers?.map((b) => b.blocking_reason)], [422, ["release_withdrawn_by_get_kinder"]], JSON.stringify(again.body));
      created(await gkAdminPage.api("POST", authorityPath, { requested_audience: "internal", decision_action: "grant" }), "re-grant");
      assert.equal((await fetchText(adminPage, clientPath)).status, 200);
      // Injected state (labeled): no application operation supersedes a source version.
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      const stale = await fetchText(adminPage, clientPath);
      assert.equal(stale.status, 409, stale.body);
      assert.doesNotMatch(stale.body, /programme sessions/);
      results.g = { revoked: 409, organizationReGrant: 422, regranted: 200, stale: 409 };
    });

    await test("summary", () => {
      console.log(`[client-admin-internal-factual-review] ${JSON.stringify(results)}`);
      for (const page of [gkReviewerPage, gkAdminPage, adminPage, contributorPage, reviewerPage, inactiveAdminPage]) assert.deepEqual(page.exceptions, []);
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
