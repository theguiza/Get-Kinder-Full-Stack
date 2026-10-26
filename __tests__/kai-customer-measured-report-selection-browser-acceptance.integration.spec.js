import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Customer source-to-report correction (owner prompt 2026-10-26): the
 * customer's organization already holds legacy structural claims
 * (dictionary_field_presence_fact, "field_2") and a saved Evidence Summary
 * citing one, across more claims than one Claim Library page. The
 * organization administrator must be able to tell structural facts from the
 * measured finding, select the measured claim, and generate, open and
 * download substantive internal reports from it - a first Evidence Summary,
 * an intentionally new second one and an impact narrative - with no repeated
 * approval, while the historical field_2 draft stays exactly as it was and is
 * shown as a metadata-only draft. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-customer-measured-report-selection-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, and production
 * metadata-only audit on the runner cluster; resolveKaiActorContext with the
 * real GK organization binding; the built frontend bundle; the P1 profiler on
 * real synthetic CSV bytes; P2-01 extraction and P2-03 proposal of the legacy
 * structural claims; the administrator's measurement, claim, selection,
 * generation and internal report receipt through the UI.
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

test("measured report selection browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("customer measured report selection browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-customer-measured-report-selection");
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
    const recent = requests.slice(-12).map((request) => `${request.method} ${new URL(request.url).pathname}${new URL(request.url).search} ${request.status} ${request.done ? "done" : "pending"}`);
    throw new Error(`network never went idle (${requests.length} requests):\n${recent.join("\n")}`);
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
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment are unresolved and carried with the count for internal use only.";
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
              : claim.claimStatement,
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
    claimTraceabilityPath,
    clientInternalDraftPath,
    clientInternalReportMarkdownPath,
    createEvidenceSummaryPath,
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
  // A second, wide synthetic source of the same organization: 30 columns, so
  // its legacy field-presence claims take the organization past one Claim
  // Library page (25). Values are synthetic placeholders.
  const FILE_WIDE = "21000000-0000-4000-8000-0000000000e2";
  const WIDE_COLUMNS = Array.from({ length: 30 }, (_, index) => `attribute_${index + 1}`);
  const WIDE_CSV = [WIDE_COLUMNS.join(","), WIDE_COLUMNS.map((_, index) => String(index)).join(","), ""].join("\n");
  // Independent verifier over the same bytes: non-empty lines after the header.
  const independentRecordCount = (text) => text.split(/\r?\n/).slice(1).filter((line) => line.split(",").some((cell) => cell.trim() !== "")).length;
  // No reviewer accepts the source-level limitations (owner decision
  // 2026-10-25): they are carried, unresolved, into every report.
  const MEASURED_LIMITATION_CODES = [
    "coverage.conflicting_source_indicators.unresolved",
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.requirement_alignment.unresolved",
    "coverage.small_cell_risk.unresolved",
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
  async function seedProfiledFile({ fileId = FILE_X, csv = CSV, filename = "sessions.csv", checksumChar = "c" } = {}) {
    const bytes = new TextEncoder().encode(csv);
    const profile = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
    assert.equal(profile.status, "profiled");
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $7, $7, $5, 'sha256', 'confirmed', 'synthetic-v1', $5, $6, now(),
         'text/csv', $6, 'clean', 'not_reviewed', 'passed', now())`,
      [fileId, BATCH_X, ORG_X, PROJECT_X, checksum, bytes.byteLength, filename],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`, [ORG_X, fileId, checksum]);
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`, [ORG_X, fileId, run.parser_run_id, checksum, JSON.stringify(profile)]);
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`, [ORG_X, fileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256]);
    for (const field of profile.fields) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'string')`, [dictionary.data_dictionary_id, ORG_X, fileProfile.file_profile_id, field.field_key]);
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [ORG_X, fileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256]);
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
  // The organization's claims as the database holds them (organization-wide).
  const claimRows = async () => query(
    `SELECT c.claim_id::text, e.evidence_type FROM kai.claims c
       JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id AND e.organization_id = c.organization_id
      WHERE c.organization_id = $1::uuid ORDER BY c.claim_id`, [ORG_X]);
  // A draft's persisted state: status, review status and every citation.
  const draftState = async (draftId) => (await query(
    `SELECT d.draft_status, d.review_status, d.content_type, d.requested_audience,
            (SELECT jsonb_agg(c.claim_id::text ORDER BY c.claim_id) FROM kai.generated_content_citations c
               JOIN kai.generated_content_blocks b ON b.generated_content_block_id = c.generated_content_block_id
              WHERE b.generated_content_draft_id = d.generated_content_draft_id) AS cited_claim_ids,
            (SELECT string_agg(b.text, '\n' ORDER BY b.ordinal) FROM kai.generated_content_blocks b
              WHERE b.generated_content_draft_id = d.generated_content_draft_id) AS text
       FROM kai.generated_content_drafts d WHERE d.generated_content_draft_id = $1::uuid`, [draftId]))[0];
  const draftIds = async () => (await query(
    "SELECT generated_content_draft_id::text AS id FROM kai.generated_content_drafts WHERE organization_id = $1::uuid ORDER BY created_at", [ORG_X])).map((row) => row.id);
  // Every decision, queue and release row that would mean a human approval.
  const approvalCounts = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_decisions,
      (SELECT count(*) FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid)::int AS coverage_decisions,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'export_review')::int AS export_reviews,
      (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid)::int AS measured_claim_followups,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_status <> 'open'
         AND queue_type IN ('evidence_review', 'claim_review', 'generated_content_review'))::int AS touched_queues,
      (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation LIKE 'generated_content_review_%')::int AS draft_reviews,
      (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS limitation_snapshots,
      (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS release_decisions,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG_X, ids.claimId || "00000000-0000-4000-8000-000000000000"]))[0];
  const NO_APPROVALS = Object.freeze({
    evidence_decisions: 0, claim_decisions: 0, coverage_decisions: 0, export_reviews: 0, measured_claim_followups: 0, touched_queues: 0,
    draft_reviews: 0, limitation_snapshots: 0, candidates: 0, release_decisions: 0, manifests: 0,
  });
  const attr = (page, selector, name) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.getAttribute(${JSON.stringify(name)}) : null; })()`);
  const listedDraftIds = () => adminPage.evaluate(`[...document.querySelectorAll("[data-client-internal-draft]")].map((el) => el.getAttribute("data-client-internal-draft"))`);
  const assertSubstantiveReport = (shown, heading) => {
    assert.ok(shown.startsWith(heading), shown.slice(0, 80));
    assert.match(shown, /\*\*Organization:\*\* Harbourline Session Society/);
    assert.match(shown, /\*\*Project \/ engagement:\*\* `Session Programme 2026`/);
    assert.equal(Number((/records \*\*(\d+) programme sessions\*\*/.exec(shown) || [])[1]), independentRecordCount(CSV));
    assert.match(shown, /for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(shown, /6 data records after the header, minus 1 blank record excluded = \*\*5\*\* counted/);
    assert.match(shown, /2 exact-duplicate records\. They are included in the count of 5, not removed or merged/);
    assert.match(shown, /## What this evidence does not establish[\s\S]*distinct people[\s\S]*distinct real-world sessions[\s\S]*caused any result/);
    for (const code of MEASURED_LIMITATION_CODES) assert.ok(shown.includes(`\`${code}\``), code);
    assert.ok(shown.includes(`\`${ids.claimId}\``) && shown.includes(`\`${ids.evidenceItemId}\``) && shown.includes(`\`${ids.sourceVersionId}\``), "traceability");
    assert.ok(shown.includes(COMPLIANT_TEXT), "the validated generated text");
    assert.doesNotMatch(shown, /field_\d|attribute_\d/, "never a field-presence claim in place of the measured result");
    assert.doesNotMatch(shown, /literacy|mentoring|2026-09-16|sessions\.csv/, "no row values or file names");
    assert.doesNotMatch(shown, /unique participants?|distinct participants? (were|was) served|improv(ed|es)|because of the programme/i, "no unsupported conclusion");
  };
  // Open a listed draft, open its internal report and return the Markdown shown (and check the download is the same).
  const openReport = async (draftId, label) => {
    await adminPage.clickIn(`[data-client-internal-draft="${draftId}"] button`, `Read ${label}`);
    await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-internal-report="${draftId}"]`)), `${label}: report action`);
    const mark = adminPage.mark();
    await adminPage.clickIn(`[data-client-open-internal-report="${draftId}"]`, "Open report");
    await adminPage.waitFor(async () => Boolean(await textOf(adminPage, "[data-client-internal-report-markdown]")), `${label}: Markdown`);
    await adminPage.idle();
    const requests = adminPage.requestsSince(mark);
    assert.deepEqual(requests.filter((entry) => entry.method !== "GET"), [], "opening a report sends no write");
    const shown = await textOf(adminPage, "[data-client-internal-report-markdown]");
    const download = await attr(adminPage, "[data-client-download-internal-report]", "href");
    assert.equal(download, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, draftId));
    const fetched = await fetchText(adminPage, download);
    assert.deepEqual([fetched.status, fetched.body], [200, shown], "the download is the report shown");
    return shown;
  };
  const generateInUi = async (buttonLabel, createdText) => {
    const before = await draftIds();
    await adminPage.clickButton(buttonLabel);
    // A new draft row, or the UI reporting a replay (which then fails below).
    await adminPage.waitFor(async () => (await draftIds()).length > before.length || (await adminPage.text()).includes(`${createdText.replace(/ created$/, "")} already created`), `${buttonLabel} result`);
    await adminPage.idle();
    await adminPage.waitForText(createdText);
    const after = await draftIds();
    return after.filter((id) => !before.includes(id));
  };
  try {
    // Every page starts on the app's origin, so its same-origin requests resolve.
    for (const page of [gkReviewerPage, gkAdminPage, adminPage, contributorPage, reviewerPage, inactiveAdminPage]) await page.goto("/impact-library");

    await test("setup: the established synthetic session log and a second wide synthetic source; both promoted with AI permitted and every section 7.2 category absent", async () => {
      const { sensitivityProfileId, profile } = await seedProfiledFile();
      assert.deepEqual([profile.counts.row_count, profile.counts.blank_record_count, profile.counts.duplicate_row_count], [6, 1, 2]);
      // Independent fixture check over the bytes: 6 data records after the header, 1 blank, 2 identical included -> 5 counted.
      const dataLines = CSV.split(/\r?\n/).slice(1).filter((line, index, all) => !(index === all.length - 1 && line === ""));
      assert.equal(dataLines.length, 6);
      assert.equal(dataLines.filter((line) => line.trim() === "").length, 1);
      const nonBlank = dataLines.filter((line) => line.trim() !== "");
      assert.equal(nonBlank.length - new Set(nonBlank).size, 1, "one pair of exact duplicates (2 records)");
      assert.equal(independentRecordCount(CSV), 5);
      const candidate = await reachReviewableSourceCandidate(sensitivityProfileId);
      const promoted = await gkReviewerPage.api("POST", decisionPath(candidate), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
      const [version] = await query("SELECT source_version_id::text FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current", [ORG_X]);
      ids.sourceVersionId = version.source_version_id;

      const wide = await seedProfiledFile({ fileId: FILE_WIDE, csv: WIDE_CSV, filename: "attributes.csv", checksumChar: "d" });
      assert.equal(wide.profile.fields.length, 30);
      const wideCandidate = await reachReviewableSourceCandidate(wide.sensitivityProfileId);
      const widePromoted = await gkReviewerPage.api("POST", decisionPath(wideCandidate), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(widePromoted.status, 200, JSON.stringify(widePromoted.body));
      const [wideVersion] = await query("SELECT source_version_id::text FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current AND source_version_id <> $2::uuid", [ORG_X, ids.sourceVersionId]);
      ids.wideSourceVersionId = wideVersion.source_version_id;
    });

    await test("history: the organization's legacy structural claims (field_2 and 30 more) and a saved Evidence Summary citing field_2, as the customer's account already holds", async () => {
      const extracted = await adminPage.api("POST", evidenceExtractionPath(ORG_X, ids.sourceVersionId), {});
      created(extracted, "field-presence extraction");
      const field2 = extracted.body.data.evidenceItems.find((item) => item.evidence_type === "dictionary_field_presence_fact" && /field_2\b/.test(item.statement));
      assert.ok(field2, JSON.stringify(extracted.body.data.evidenceItems.map((item) => item.statement)));
      const proposed = await adminPage.api("POST", claimProposalPath(ORG_X, field2.evidence_item_id), {});
      created(proposed, "field_2 claim");
      ids.legacyClaimId = proposed.body.data.claim.claim_id;
      const wideExtracted = await adminPage.api("POST", evidenceExtractionPath(ORG_X, ids.wideSourceVersionId), {});
      created(wideExtracted, "wide extraction");
      for (const item of wideExtracted.body.data.evidenceItems) created(await adminPage.api("POST", claimProposalPath(ORG_X, item.evidence_item_id), {}), "wide claim");
      const claims = await claimRows();
      assert.equal(claims.length, 31);
      assert.ok(claims.every((row) => row.evidence_type === "dictionary_field_presence_fact"));
      // The customer's earlier generation from the structural claim (the saved historical draft).
      const historical = await adminPage.api("POST", createEvidenceSummaryPath(ORG_X), {
        claim_ids: [ids.legacyClaimId], idempotency_key: "customer-historical-field-2-summary", engagement_id: PROJECT_X,
      });
      created(historical, "historical field_2 Evidence Summary");
      ids.historicalDraftId = historical.body.data.generatedContentDraftId;
      ids.historicalState = await draftState(ids.historicalDraftId);
      assert.deepEqual(ids.historicalState.cited_claim_ids, [ids.legacyClaimId]);
      assert.match(ids.historicalState.text, /field_2/);
      assert.equal(modelCalls.length, 1);
      results.history = { structuralClaims: claims.length, historicalDraft: ids.historicalState.review_status };
    });

    await test("missing measurement: with only structural claims the customer is told to count records first; structural claims are labelled and not offered as an impact finding; the historical draft is shown as metadata-only", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.legacyClaimId}"]`)), "the field_2 claim");
      assert.equal(await attr(adminPage, `[data-client-claim="${ids.legacyClaimId}"]`, "data-client-claim-kind"), "structural");
      assert.equal(await textOf(adminPage, `[data-client-claim="${ids.legacyClaimId}"] input[type=checkbox]`), null, "a structural claim is not offered for an impact report");
      assert.match(await textOf(adminPage, `[data-client-claim="${ids.legacyClaimId}"]`), /Structural fact/);
      assert.equal(await attr(adminPage, "[data-client-draft-readiness]", "data-client-draft-readiness"), "no_measured_claim");
      assert.match(await textOf(adminPage, "[data-client-draft-readiness]"), /Count records/);
      assert.equal(await adminPage.evaluate(`[...document.querySelectorAll("button")].find((el) => el.innerText.trim() === "Generate internal evidence summary").disabled`), true);
      await adminPage.clickIn(`[data-client-internal-draft="${ids.historicalDraftId}"] button`, "Read the historical draft");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-internal-draft-detail="${ids.historicalDraftId}"]`)), "the historical draft");
      await adminPage.idle();
      const detail = await textOf(adminPage, `[data-client-internal-draft-detail="${ids.historicalDraftId}"]`);
      assert.ok(await textOf(adminPage, "[data-client-internal-draft-metadata-only]"), detail);
      assert.match(detail, /structural/i);
      assert.doesNotMatch(detail, /Ask Get Kinder to review the cited claims/, "no review request in place of the missing measurement");
      assert.deepEqual(await draftState(ids.historicalDraftId), ids.historicalState, "reading changes nothing");
    });

    await test("measurement: the administrator records the definition and count in Data Sources and proposes the measured claim; the value is the independent count", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-open-source-measurement="${ids.sourceVersionId}"]`)), "Count records");
      await adminPage.clickIn(`[data-client-open-source-measurement="${ids.sourceVersionId}"]`, "Count records");
      await adminPage.waitForText("Counted records = data records minus blank records = 5");
      for (const [field, value] of [
        ["countedUnit", "programme session"], ["unitLabel", "programme sessions"],
        ["definitionText", "Each row of the session log records one delivered programme session."],
        ["inclusionRule", "Every data row after the header row that has at least one value."],
        ["exclusionRule", "The header row and empty rows."], ["periodStart", "2026-09-01"], ["periodEnd", "2026-09-30"],
      ]) assert.ok(await setInput(adminPage, `[data-client-source-measurement-field="${field}"]`, value), field);
      await adminPage.waitForText("Confirm that the reporting period is your organization's statement.");
      await adminPage.clickIn('[data-client-source-measurement-field="periodAttested"]', "attest period");
      await adminPage.clickIn("[data-client-source-measurement-submit]", "Record definition and count");
      await adminPage.waitForText("Measurement: 5 programme sessions");
      await adminPage.idle();
      const [measurement] = await query("SELECT measured_value, evidence_item_id::text FROM kai.evidence_measurements WHERE organization_id = $1::uuid", [ORG_X]);
      assert.equal(Number(measurement.measured_value), independentRecordCount(CSV));
      ids.evidenceItemId = measurement.evidence_item_id;
      await adminPage.clickIn(`[data-client-source-measurement-propose-claim="${ids.evidenceItemId}"]`, "Propose a claim");
      await adminPage.waitForText("Claim: The promoted source records 5 programme sessions");
      const [claim] = await query("SELECT claim_id::text FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_X, ids.evidenceItemId]);
      ids.claimId = claim.claim_id;
      const traced = await gkReviewerPage.api("GET", claimTraceabilityPath(ORG_X, ids.claimId, "internal"));
      assert.deepEqual([traced.body.data.eligible, traced.body.data.claim.claim_review_status], [true, "needs_gk_review"], "eligible by the ordinary authority; stored status unchanged");
      assert.deepEqual(await approvalCounts(), NO_APPROVALS);
      results.measurement = { value: Number(measurement.measured_value), internal: "eligible with 0 decisions" };
    });

    await test("Test 1: structural and measured claims coexist; every organization claim is listed; the measured claim shows its authoritative internal usability; selecting it generates a new report citing the measurement, and the historical field_2 draft is unchanged", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-claim="${ids.legacyClaimId}"]`)), "the claim list");
      await adminPage.idle();
      const listed = await adminPage.evaluate(`[...document.querySelectorAll("[data-client-claim]")].map((el) => el.getAttribute("data-client-claim"))`);
      const stored = (await claimRows()).map((row) => row.claim_id);
      assert.equal(stored.length, 32);
      assert.deepEqual([...listed].sort(), stored, "every claim of the organization is listed, not only the first page");
      const row = `[data-client-claim="${ids.claimId}"]`;
      assert.equal(await attr(adminPage, row, "data-client-claim-kind"), "measurement");
      assert.equal(await attr(adminPage, row, "data-client-claim-internal-use"), "usable");
      assert.match(await textOf(adminPage, row), /Usable in internal reports now/);
      assert.doesNotMatch(await textOf(adminPage, row), /needs_gk_review|Get Kinder review/, "no GK-review state contradicting the authoritative eligibility");
      assert.equal(listed.indexOf(ids.claimId), 0, "the measured finding is listed first");
      await adminPage.clickIn(`${row} input[type=checkbox]`, "Use the measured claim");
      const before = modelCalls.length;
      const [newDraft, ...extra] = await generateInUi("Generate internal evidence summary", "Internal evidence summary created");
      assert.deepEqual(extra, []);
      assert.ok(newDraft && newDraft !== ids.historicalDraftId, "a new draft");
      assert.equal(modelCalls.length, before + 1);
      assert.deepEqual(modelCalls.at(-1).claims.map((claim) => claim.claimId), [ids.claimId], "the generator receives exactly the selected measured claim");
      assert.equal(modelCalls.at(-1).claims[0].evidenceItemId, ids.evidenceItemId);
      assert.deepEqual(modelCalls.at(-1).claims[0].limitationCodes, MEASURED_LIMITATION_CODES);
      const state = await draftState(newDraft);
      assert.deepEqual(state.cited_claim_ids, [ids.claimId], "cites the measurement, not the structural claim");
      ids.summaryId = newDraft;
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-internal-draft-detail="${newDraft}"]`)), "the new draft opens");
      await adminPage.idle();
      assert.equal(await textOf(adminPage, `[data-client-internal-draft-detail="${ids.historicalDraftId}"]`), null, "the older field_2 draft is not reopened");
      assert.match(await textOf(adminPage, "[data-client-internal-draft-detail-review-state]"), /Ready for internal use/);
      assert.equal((await listedDraftIds())[0], newDraft, "the newest draft is listed first");
      assert.deepEqual(await draftState(ids.historicalDraftId), ids.historicalState, "the historical draft keeps its citations and status");
      results.test1 = { listedClaims: listed.length, cited: state.cited_claim_ids, historicalUnchanged: true };
    });

    await test("Test 2 + 4: the first Evidence Summary opens and downloads as complete Markdown with the 5-session measurement, methodology, period, citations and limitations; no approval of any kind", async () => {
      const shown = await openReport(ids.summaryId, "the Evidence Summary");
      assertSubstantiveReport(shown, "# Internal Evidence Summary");
      writeFileSync(join(WORKDIR, "customer-report-1-evidence-summary.md"), shown);
      console.log(`[measured-report-selection:evidence_summary:begin]\n${shown}[measured-report-selection:end]`);
      assert.deepEqual(await approvalCounts(), NO_APPROVALS);
      results.test2 = { status: 200, bytes: Buffer.byteLength(shown) };
    });

    await test("Test 3: an intentionally new second Evidence Summary and an impact narrative reuse the same fact with zero additional approvals; a retried key stays idempotent", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => (await textOf(adminPage, `[data-client-claim="${ids.claimId}"] input[type=checkbox]`)) !== null, "the measured claim");
      await adminPage.clickIn(`[data-client-claim="${ids.claimId}"] input[type=checkbox]`, "Use the measured claim");
      const [second] = await generateInUi("Generate internal evidence summary", "Internal evidence summary created");
      // The same selection, clicked again on purpose: a further new report.
      const [third] = await generateInUi("Generate internal evidence summary", "Internal evidence summary created");
      assert.ok(second && third && new Set([ids.summaryId, second, third]).size === 3, "each intentional generation is a new draft");
      assert.deepEqual((await draftState(third)).cited_claim_ids, [ids.claimId]);
      const [narrative] = await generateInUi("Generate internal impact narrative", "Internal impact narrative created");
      assert.ok(narrative);
      assert.equal((await draftState(narrative)).content_type, "impact_narrative");
      assert.deepEqual((await draftState(narrative)).cited_claim_ids, [ids.claimId]);
      // A retry of one request (same key) replays the same draft and writes nothing.
      const body = { claim_ids: [ids.claimId], idempotency_key: "customer-retry-same-key-0001", engagement_id: PROJECT_X };
      const first = await adminPage.api("POST", createEvidenceSummaryPath(ORG_X), body);
      created(first, "keyed generation");
      const count = (await draftIds()).length;
      const retried = await adminPage.api("POST", createEvidenceSummaryPath(ORG_X), body);
      created(retried, "retried generation");
      assert.equal(retried.body.data.generatedContentDraftId, first.body.data.generatedContentDraftId);
      assert.equal(retried.body.data.replayed, true);
      assert.equal((await draftIds()).length, count, "the retry wrote no draft");
      const narrativeShown = await openReport(narrative, "the impact narrative");
      assertSubstantiveReport(narrativeShown, "# Internal Impact Narrative");
      const secondShown = await openReport(third, "the second Evidence Summary");
      assertSubstantiveReport(secondShown, "# Internal Evidence Summary");
      writeFileSync(join(WORKDIR, "customer-report-2-impact-narrative.md"), narrativeShown);
      console.log(`[measured-report-selection:impact_narrative:begin]\n${narrativeShown}[measured-report-selection:end]`);
      const after = await approvalCounts();
      assert.deepEqual(after, NO_APPROVALS, "zero additional human approvals for the same fact and internal purpose");
      ids.narrativeId = narrative;
      results.test3 = {
        newDrafts: [second, third, narrative].length,
        retryReplayed: true,
        additionalHumanApprovals: after.evidence_decisions + after.claim_decisions + after.coverage_decisions + after.draft_reviews + after.release_decisions + after.limitation_snapshots,
      };
    });

    await test("Test 5: protected restrictions hold: other roles, organizations, Projects and non-human actors; the structural draft stays unavailable; a stale source; funder generation", async () => {
      const path = clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.summaryId);
      const outcomes = {};
      for (const [label, page, target, status] of [
        ["client_contributor", contributorPage, path, 403],
        ["client_reviewer", reviewerPage, path, 403],
        ["inactive organization administrator", inactiveAdminPage, path, 403],
        ["GK reviewer", gkReviewerPage, path, 403],
        ["GK administrator", gkAdminPage, path, 403],
        ["another organization", adminPage, clientInternalReportMarkdownPath(ORG_Y, PROJECT_Y, ids.summaryId), 403],
        ["another Project of the organization", adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X2, ids.summaryId), 404],
        ["the structural field_2 draft", adminPage, clientInternalReportMarkdownPath(ORG_X, PROJECT_X, ids.historicalDraftId), 422],
      ]) {
        const response = await fetchText(page, target);
        assert.equal(response.status, status, `${label}: ${response.body}`);
        assert.doesNotMatch(response.body, /programme sessions\*\*/, label);
        outcomes[label] = response.status;
      }
      const { getClientInternalReportMarkdown } = await import("../Backend/kai/services/kaiClientGeneratedContentService.js");
      for (const actorType of ["ai", "assistant", "system"]) {
        const refused = await getClientInternalReportMarkdown({
          organizationId: ORG_X, engagementId: PROJECT_X, generatedContentDraftId: ids.summaryId,
          actorContext: { actorType, actorUserId: adminUser.user_id, organizationMemberships: [{ organization_id: ORG_X, role_name: "client_admin", membership_status: "active" }] },
        });
        assert.equal(refused.error?.code, "authorization_denied", actorType);
        outcomes[actorType] = refused.error.code;
      }
      const funder = await adminPage.api("POST", `${createEvidenceSummaryPath(ORG_X)}/funder`, {
        claim_ids: [ids.claimId], idempotency_key: "customer-funder-attempt-0001", engagement_id: PROJECT_X,
      });
      assert.equal(funder.status, 403, JSON.stringify(funder.body));
      outcomes.funderGeneration = funder.status;
      // Injected state (labeled): no application operation supersedes a source version.
      await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      const stale = await fetchText(adminPage, path);
      assert.equal(stale.status, 409, stale.body);
      await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [ids.sourceVersionId]);
      assert.equal((await fetchText(adminPage, path)).status, 200);
      outcomes.staleSource = 409;
      // Denied AI processing and sensitive content are proven through the real corrective review in the assembled acceptance (F).
      assert.deepEqual(await draftState(ids.historicalDraftId), ids.historicalState, "the historical draft is still unchanged");
      results.test5 = outcomes;
    });

    await test("Test 6: after a reload the customer sees the newest usable report first, the historical field_2 draft as metadata-only, and no Get Kinder review state on the usable measured claim", async () => {
      await openDataSources();
      await adminPage.waitFor(async () => (await listedDraftIds()).length > 0, "the draft list");
      await adminPage.idle();
      const listed = await listedDraftIds();
      assert.equal(listed.at(-1), ids.historicalDraftId, "the oldest (historical) draft is listed last");
      const readyFlags = await adminPage.evaluate(`[...document.querySelectorAll("[data-client-internal-draft-report-available]")].map((el) => el.getAttribute("data-client-internal-draft-report-available"))`);
      assert.deepEqual(readyFlags.slice(0, -1).every((flag) => flag === "true"), true, "every measured report is ready");
      assert.equal(readyFlags.at(-1), "false");
      assert.doesNotMatch(await textOf(adminPage, `[data-client-claim="${ids.claimId}"]`), /needs_gk_review|Get Kinder review/);
      await adminPage.clickIn(`[data-client-internal-draft="${ids.historicalDraftId}"] button`, "Read the historical draft");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-internal-draft-detail="${ids.historicalDraftId}"]`)), "the historical draft");
      await adminPage.idle();
      assert.match(await textOf(adminPage, "[data-client-internal-draft-metadata-only]"), /^Structural facts only/);
      assert.match(await textOf(adminPage, `[data-client-internal-draft-detail="${ids.historicalDraftId}"]`), /field_2/, "its original text is kept");
      await adminPage.clickIn(`[data-client-internal-draft="${listed[0]}"] button`, "Read the newest report");
      await adminPage.waitFor(async () => Boolean(await textOf(adminPage, `[data-client-internal-draft-detail="${listed[0]}"]`)), "the newest report");
      await adminPage.idle();
      assert.equal(await textOf(adminPage, "[data-client-internal-draft-metadata-only]"), null);
      assert.ok(await textOf(adminPage, '[data-client-internal-report="available"]'), "the newest report is ready");
      assert.equal(await textOf(adminPage, "[data-client-internal-report-get-kinder-required]"), null, "no Get Kinder review blocker on a usable report");
      for (const page of [gkReviewerPage, gkAdminPage, adminPage, contributorPage, reviewerPage, inactiveAdminPage]) assert.deepEqual(page.exceptions, []);
      console.log(`[customer-measured-report-selection] ${JSON.stringify(results)}`);
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
  }
}
