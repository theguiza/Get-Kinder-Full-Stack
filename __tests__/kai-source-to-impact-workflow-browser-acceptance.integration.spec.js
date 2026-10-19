import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assembled synthetic acceptance of the source-to-impact workflow repair
 * (owner decision 2026-10-19): a binding-derived Admin A and a delegated
 * Admin B (a stored client_admin granted through the governed, audited
 * access-administration route) take files of one Project from a recorded
 * sensitivity review to governed sources, evidence, claims, gap follow-ups,
 * and both internal drafts, which Admin B then reads - with the effective
 * allowed use enforced at every seam, the effective AI-processing permission
 * enforced before the model (VAL-KAI-B1A-02-004), every refusal writing
 * nothing, and the pipeline readable throughout. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-source-to-impact-workflow-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, transaction, and
 * production metadata-only audit on the runner cluster; the access-
 * administration grant/revoke routes; resolveKaiActorContext with the real GK
 * organization binding and JIT kai.users mapping; the built bundle in a real
 * headless Chrome (Data Sources > "Use for impact", the sensitivity and source
 * panels, internal drafts).
 * Simulated / substituted (reported as such, never as pipeline proof):
 * - the Get Kinder session login (req.user from a harness cookie);
 * - WORKER SIMULATION: each file's P1-03..P1-05 rows are seeded as the
 *   worker's output (upload, scan, parsing, profiling are NOT executed);
 * - HISTORICAL SIMULATION: one file's 'reviewed' decision is recorded through
 *   the real services by Admin A with P1-07 replaced, for that call only, by
 *   the refusal the pre-c8170d3 P1-07 returned (no candidate);
 * - HISTORICAL SIMULATION: another file's 'reviewed' decision is recorded
 *   through the real services with the exact payload the pre-repair form sent
 *   when submitted untouched (captured at 1e3d275): every dimension 'unknown'
 *   and an explicit AI-processing false the reviewer never chose;
 * - SYNTHETIC: one file's policy state is set to failed after profiling;
 * - the Anthropic messages client used by internal generation (a
 *   deterministic stand-in that cites the requested claims).
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

test("source-to-impact workflow browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("source-to-impact workflow browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-source-to-impact-workflow");
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
      const entry = { url: params.request.url, method: params.request.method, body: params.request.postData ?? null, status: null, done: false };
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
  // Deterministic stand-in for the Anthropic client internal generation uses,
  // installed before any generation module is loaded.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ claimIds: requestBody.claims.map((claim) => claim.claimId) });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          blocks: requestBody.claims.map((claim) => ({
            text: `Internal draft text for: ${claim.claimStatement}`,
            citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }],
          })),
        }),
      }],
    };
  };

  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 6 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { createSourceCandidateStub } = await import("../Backend/kai/services/kaiSourceCandidateService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const {
    buildSensitivityDecisionRequestBody,
    claimGapFollowupsPath,
    claimProposalPath,
    clientInternalDraftPath,
    clientInternalDraftsPath,
    createEvidenceSummaryPath,
    createImpactNarrativePath,
    defaultSensitivityReviewFormState,
    evidenceExtractionPath,
    intakeFileSourceCandidatePath,
    organizationAccessCapabilitiesPath,
    sensitivityProfilePath,
    sensitivityReviewFormStateFromDecision,
    withSensitivityAllowedUse,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const ORG_X = "0e100000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0e100000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7e100000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7e100000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7e100000-0000-4000-8000-0000000000e2";
  const BATCH_X = "1e100000-0000-4000-8000-0000000000e1";
  const BATCH_Y = "1e100000-0000-4000-8000-0000000000e2";
  const FILE = Object.freeze({
    ui: "2e100000-0000-4000-8000-0000000000a1", // Admin A reviews in the UI; Admin B takes it to impact
    hist: "2e100000-0000-4000-8000-0000000000a2", // historical: A reviewed, no candidate
    conc: "2e100000-0000-4000-8000-0000000000a3", // concurrency
    notAllowed: "2e100000-0000-4000-8000-0000000000b1", // A records reviewed not_allowed
    later: "2e100000-0000-4000-8000-0000000000b2", // promoted under 'unknown', later re-reviewed not_allowed
    legacy: "2e100000-0000-4000-8000-0000000000a4", // historical: the pre-repair untouched form's decision, later corrected
    policyFailed: "2e100000-0000-4000-8000-0000000000b3",
    y: "2e100000-0000-4000-8000-0000000000d1",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ adminA: 1501, adminB: 1502, revokedB: 1503, invitedB: 1504, contributor: 1505, clientReviewer: 1506, adminY: 1507, globalAdminRole: 1508 });
  const email = (legacyId) => `user${legacyId}@harbourline-impact.test`;
  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const ACCESS = "/api/kai/sprint2/access-administration";
  const INTAKE = "/api/kai/sprint2/intake";
  const continuationPath = (organizationId, engagementId, intakeFileId) => intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId);
  const detailPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}?organization_id=${organizationId}`;
  const decisionPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}/decision?organization_id=${organizationId}`;
  const sensitivityDecisionPath = (organizationId, profileId) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const pipelinePath = (organizationId, engagementId) => `${INTAKE}/admin/organizations/${organizationId}/engagements/${engagementId}/client-evidence-pipeline`;
  const grantPath = (organizationId, legacyId) => `${ACCESS}/organizations/${organizationId}/memberships/${legacyId}/roles`;
  const PROMOTE = { outcome: "promoted", reviewed_source_type: "organization_primary_record" };
  const DRAFT_BODY = (claimIds, key) => ({ claim_ids: claimIds, idempotency_key: key, engagement_id: PROJECT_X });
  const PRE_FIX_P1_07_REFUSAL = async () => ({ ok: false, error: { code: "tenant_boundary_violation", status: 403 } });

  // --- organizations, projects, GK bindings, users (authorized setup) ------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Impact Society", "harbourline-impact"], [ORG_Y, "Larchmont Impact Society", "larchmont-impact"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code] of [[PROJECT_X, ORG_X, "Project Harbourline Impact"], [PROJECT_X2, ORG_X, "Project Harbourline Other"], [PROJECT_Y, ORG_Y, "Project Larchmont Impact"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId, code] of [[BATCH_X, ORG_X, PROJECT_X, "harbourline-impact-intake"], [BATCH_Y, ORG_Y, PROJECT_Y, "larchmont-impact-intake"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, code]);
  }
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  // Admin A of X and the administrator of Y: binding-derived (an active Get
  // Kinder organization-admin membership of a bound GK organization). No
  // Get Kinder staff user exists in either organization.
  const gkOrganizations = {};
  for (const [organizationId, name, adminUser] of [[ORG_X, "Harbourline Impact Society", USERS.adminA], [ORG_Y, "Larchmont Impact Society", USERS.adminY]]) {
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, adminUser]);
    gkOrganizations[organizationId] = gkOrganization.id;
  }
  // Every other account exists in Get Kinder with an email and a KAI mapping;
  // none holds any KAI role yet.
  const kai = {};
  for (const [key, legacyId] of Object.entries(USERS)) {
    kai[key] = (await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: email(legacyId) })).user_id;
  }
  // Non-administrator members, an "invited" client_admin row (DDL-valid,
  // never written by a governed route), and a global client_admin role over
  // a contributor membership.
  for (const [key, roleName, status] of [["contributor", "client_contributor", "active"], ["clientReviewer", "client_reviewer", "active"], ["invitedB", "client_admin", "invited"], ["globalAdminRole", "client_contributor", "active"]]) {
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, $4)", [ORG_X, kai[key], roleName, status]);
  }
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'client_admin'", [kai.globalAdminRole]);
  const actorOf = async (legacyId) => {
    const resolved = await resolveKaiActorContext({ user: { id: legacyId, email: email(legacyId) } });
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    return resolved.actorContext;
  };

  /** WORKER SIMULATION: the P1-03..P1-05 rows of one confirmed, policy-passed Project file. */
  async function seedProfiledFile({ organizationId, engagementId, batchId, intakeFileId, name, checksumChar }) {
    const checksum = checksumChar.repeat(64);
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [intakeFileId, batchId, organizationId, engagementId, name, checksum],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', now()) RETURNING parser_run_id::text`,
      [organizationId, intakeFileId, checksum],
    );
    const profile = { status: "profiled", format: "csv", counts: { row_count: 1, column_count: FIELD_KEYS.length, field_count: FIELD_KEYS.length }, fields: FIELD_KEYS.map((key) => ({ field_key: key })) };
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'))
       RETURNING file_profile_id::text, profile_canonical_sha256`,
      [organizationId, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile)],
    );
    await query("UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $2::uuid WHERE parser_run_id = $1::uuid",
      [run.parser_run_id, fileProfile.file_profile_id]);
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING data_dictionary_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256],
    );
    for (const key of FIELD_KEYS) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number')`,
        [dictionary.data_dictionary_id, organizationId, fileProfile.file_profile_id, key],
      );
    }
    const [sensitivityProfile] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256],
    );
    return sensitivityProfile.intake_sensitivity_profile_id;
  }

  const REVIEWED_SNAPSHOT = Object.freeze({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent", reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "unknown", reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "unknown", reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown", reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
  });
  // A reviewed decision that establishes the allowed-use basis and permits AI processing.
  const AI_PERMITTED_SNAPSHOT = Object.freeze({ ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "allowed", reviewed_llm_processing_allowed: true });
  // The reviewed_snapshot the pre-repair form sent when submitted untouched (captured at 1e3d275).
  const PRE_REPAIR_UNTOUCHED_FORM_SNAPSHOT = Object.freeze({
    reviewed_personal_data_status: "unknown", reviewed_minor_data_status: "unknown", reviewed_health_housing_justice_immigration_status: "unknown",
    reviewed_indigenous_governance_status: "unknown", reviewed_staff_notes_status: "unknown", reviewed_story_testimonial_status: "unknown",
    reviewed_small_cell_risk_status: "unknown", reviewed_financial_records_status: "unknown", reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown", reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
    reviewed_funder_use_allowed: false, reviewed_public_use_allowed: false,
  });

  async function sensitivityQueue(organizationId, profileId) {
    const [item] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`, [organizationId, profileId]);
    return item;
  }

  /** Admin A's real review work and decisions through the real services (each later one a UI-style resubmission). */
  async function recordDecisions({ organizationId, profileId, actorContext, outcomes, snapshot = REVIEWED_SNAPSHOT, p1_07 = null, ensure = true }) {
    if (ensure) {
      const ensured = await ensureSensitivityReviewQueueItem({ organizationId, intakeSensitivityProfileId: profileId, actorContext, now: new Date().toISOString() }, { env: ENV });
      assert.equal(ensured.ok, true, JSON.stringify(ensured));
    }
    const handoffs = [];
    for (const outcome of outcomes) {
      const item = await sensitivityQueue(organizationId, profileId);
      const decided = await submitSensitivityProfileDecision({
        organizationId, intakeSensitivityProfileId: profileId, actorContext,
        payload: {
          expected_updated_at: new Date(item.updated_at).toISOString(), review_queue_item_id: item.review_queue_item_id, decision: outcome,
          ...(outcome === "reviewed" ? { reviewed_snapshot: snapshot } : {}),
        },
      }, { env: ENV, ...(p1_07 ? { createSourceCandidateStub: p1_07 } : {}) });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      handoffs.push(decided.data.source_candidate_handoff);
    }
    return handoffs;
  }

  async function counts(organizationId) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review')::int AS sensitivity_items,
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid)::int AS sensitivity_decisions,
      (SELECT count(*) FROM kai.intake_source_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'source_candidate_review')::int AS candidate_items,
      (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid)::int AS promotions,
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS source_versions,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
      (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = $1::uuid)::int AS gaps,
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.organization_memberships WHERE organization_id = $1::uuid)::int AS memberships,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audit_events`, [organizationId]);
    return row;
  }
  const delta = (after, before) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  const ZERO = Object.freeze(Object.fromEntries(["sensitivity_items", "sensitivity_decisions", "candidates", "candidate_items", "promotions", "sources",
    "source_versions", "evidence", "claims", "gaps", "drafts", "memberships", "audit_events"].map((key) => [key, 0])));
  async function decisionsOf(organizationId, profileId) {
    return query(
      `SELECT d.decision_id::text, d.decision_outcome, d.decided_by::text, d.decided_by_role, d.reviewed_allowed_use_status,
              d.reviewed_llm_processing_allowed, d.supersedes_decision_id::text,
              NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id) AS is_head
         FROM kai.intake_sensitivity_review_decisions d WHERE d.organization_id = $1::uuid AND d.intake_sensitivity_profile_id = $2::uuid ORDER BY d.created_at`,
      [organizationId, profileId]);
  }
  async function candidateOf(organizationId, profileId) {
    return query(
      `SELECT c.intake_source_candidate_id::text, c.candidate_status, c.created_by::text FROM kai.intake_source_candidates c
        WHERE c.organization_id = $1::uuid AND c.intake_sensitivity_profile_id = $2::uuid`, [organizationId, profileId]);
  }

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: email(match[1]) };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.use(ACCESS, requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
  app.get("/impact-library", (_req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Impact Library</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="impact-evidence-library-root"></div><script src="/js/bundles/entry.js"></script>
    <script>window.renderImpactEvidenceLibrary();</script></body></html>`));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const pages = {};
  for (const key of ["adminA", "adminB", "revokedB", "invitedB", "contributor", "clientReviewer", "adminY", "globalAdminRole"]) {
    pages[key] = await openPage(browser, { baseUrl, legacyUserId: USERS[key] });
  }
  const { adminA: adminAPage, adminB: adminBPage } = pages;
  const results = {};
  const ids = { profile: {}, candidate: {} };
  const pathOf = (request) => new URL(request.url).pathname;
  const postsSince = (page, mark) => page.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);
  const fileOf = (pipeline, intakeFileId) => pipeline.body.data.files.find((file) => file.intakeFileId === intakeFileId);
  const currentOf = (file) => [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
  const has = (page, selector) => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  async function openDataSources(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await page.idle();
    await page.clickTab("Data Sources");
    await page.selectProject(PROJECT_X);
    await page.idle();
  }
  const setPanelSelect = (page, labelText, value) => page.evaluate(`(() => {
    const panel = document.querySelector("[data-client-source-promotion-panel]");
    const label = panel && [...panel.querySelectorAll("label")].find((el) => el.innerText.trim().startsWith(${JSON.stringify(labelText)}));
    const el = label && label.querySelector("select");
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  /** The source authorization and P1-08 decision a "Use for impact" flow stops at, given by the person. */
  async function authorizeAndPromote(page, candidateId) {
    await page.waitFor(() => has(page, "[data-client-source-authorization]"), "source authorization shown");
    await page.waitFor(() => has(page, "[data-client-source-restrictions]"), "recorded restrictions shown");
    const restrictions = await page.evaluate(`document.querySelector("[data-client-source-restrictions]").innerText`);
    const authorization = await page.evaluate(`document.querySelector("[data-client-source-authorization]").innerText`);
    assert.ok(authorization.includes("Intended use: Internal impact evidence for this organization"), authorization);
    assert.ok(authorization.includes("Funder use: not permitted; public use: not permitted"), authorization);
    assert.ok(await setPanelSelect(page, "Decision outcome", "promoted"), "outcome");
    await page.waitForText("Reviewed source type");
    assert.ok(await setPanelSelect(page, "Reviewed source type", "organization_primary_record"), "source type");
    let mark = page.mark();
    await page.clickButton("Promote");
    await page.waitForText("Confirm the source authorization above before promoting. Nothing was sent.");
    assert.deepEqual(postsSince(page, mark), [], "no promotion without the explicit confirmation");
    await page.clickIn("[data-client-source-authorization-confirm]", "source authorization confirmation");
    mark = page.mark();
    await page.clickButton("Promote");
    await page.waitForText("Use for impact: this file's evidence exists.");
    await page.idle();
    const posts = postsSince(page, mark);
    assert.deepEqual(posts[0], [`${COCKPIT}/source-candidates/${candidateId}/decision`, 200], JSON.stringify(posts));
    return { posts, restrictions };
  }

  try {
    // --- 0: delegation through the governed route ------------------------------
    await test("SETUP: Admin A (binding-derived) delegates client_admin to Admin B and to a second account through the governed, audited grant route; one grant is then revoked", async () => {
      await adminAPage.goto("/impact-library");
      for (const key of ["adminB", "revokedB"]) {
        const granted = await adminAPage.api("POST", grantPath(ORG_X, USERS[key]), { role_name: "client_admin" });
        assert.equal(granted.status, 200, `${key}: ${JSON.stringify(granted.body)}`);
      }
      const revoked = await adminAPage.api("POST", `${grantPath(ORG_X, USERS.revokedB)}/client_admin/revoke`, {});
      assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
      const rows = await query("SELECT user_id::text, role_name, membership_status FROM kai.organization_memberships WHERE organization_id = $1::uuid AND user_id = ANY($2::uuid[]) ORDER BY 1",
        [ORG_X, [kai.adminB, kai.revokedB]]);
      assert.deepEqual(rows.map((r) => [r.user_id, r.role_name, r.membership_status]).sort(),
        [[kai.adminB, "client_admin", "active"], [kai.revokedB, "client_admin", "inactive"]].sort());
      const audits = await query(
        `SELECT action::text AS action, actor_user_id::text AS actor, metadata->>'authority_source' AS authority FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text LIKE 'organization_role_%' ORDER BY audit_event_id`, [ORG_X]);
      assert.ok(audits.length >= 3, JSON.stringify(audits));
      assert.ok(audits.every((a) => a.actor === kai.adminA), "every grant and revocation is attributed to Admin A");
      const adminB = await actorOf(USERS.adminB);
      assert.deepEqual(adminB.organizationMemberships.map((m) => [m.organization_id, m.role_name, m.membership_status, m.source]),
        [[ORG_X, "client_admin", "active", "kai_organization_membership"]], "Admin B's only authority is the stored grant");
      assert.deepEqual(adminB.kaiRoles, []);
      results.setup = `PASS: Admin A granted Admin B and a second account client_admin (audited, authority ${audits[0].authority}); the second revoked`;
    });

    // --- files ---------------------------------------------------------------
    await test("FILES: one profiled file waiting for review; a historical reviewed file with no candidate (Admin A); a concurrency file; a not_allowed file; a file promoted under 'unknown'; a failed-policy file; Y's file", async () => {
      const adminA = await actorOf(USERS.adminA);
      ids.adminA = adminA.actorUserId;
      const seed = (key, char, organizationId = ORG_X, engagementId = PROJECT_X, batchId = BATCH_X) =>
        seedProfiledFile({ organizationId, engagementId, batchId, intakeFileId: FILE[key], name: `harbourline-impact-${key}.csv`, checksumChar: char })
          .then((profileId) => { ids.profile[key] = profileId; });
      await seed("ui", "1");
      await seed("hist", "2");
      const [historical] = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.hist, actorContext: adminA, outcomes: ["reviewed"], p1_07: PRE_FIX_P1_07_REFUSAL,
        snapshot: AI_PERMITTED_SNAPSHOT });
      assert.deepEqual([historical.status, historical.error_code], ["not_created", "tenant_boundary_violation"]);
      await seed("conc", "3");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.conc, actorContext: adminA, outcomes: ["reviewed"], p1_07: PRE_FIX_P1_07_REFUSAL });
      await seed("notAllowed", "4");
      const [prohibited] = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.notAllowed, actorContext: adminA, outcomes: ["reviewed"],
        snapshot: { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed" } });
      assert.deepEqual([prohibited.status, prohibited.error_code], ["not_created", "validation_blocker"], "normal decision seam: no candidate for not_allowed");
      await seed("later", "5");
      const [laterHandoff] = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.later, actorContext: adminA, outcomes: ["reviewed"] });
      assert.equal(laterHandoff.status, "created");
      // Promoted by Admin A through the real decision route (its P2-01 handoff creates the evidence).
      const promoted = await adminAPage.api("POST", decisionPath(ORG_X, laterHandoff.intake_source_candidate_id), PROMOTE);
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
      assert.equal(promoted.body.data.evidence_extraction_handoff.status, "created");
      ids.laterSourceVersion = promoted.body.data.source_version.source_version_id;
      // HISTORICAL SIMULATION: the decision the pre-repair form recorded when submitted untouched, then promoted.
      await seed("legacy", "8");
      const [legacyHandoff] = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.legacy, actorContext: adminA, outcomes: ["reviewed"],
        snapshot: PRE_REPAIR_UNTOUCHED_FORM_SNAPSHOT });
      assert.equal(legacyHandoff.status, "created");
      const legacyPromoted = await adminAPage.api("POST", decisionPath(ORG_X, legacyHandoff.intake_source_candidate_id), PROMOTE);
      assert.equal(legacyPromoted.status, 200, JSON.stringify(legacyPromoted.body));
      assert.equal(legacyPromoted.body.data.evidence_extraction_handoff.status, "created");
      ids.legacySourceVersion = legacyPromoted.body.data.source_version.source_version_id;
      await seed("policyFailed", "6");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.policyFailed, actorContext: adminA, outcomes: ["reviewed"], p1_07: PRE_FIX_P1_07_REFUSAL });
      // SYNTHETIC: the file's policy state is failed after profiling.
      await query("UPDATE kai.intake_files SET file_policy_status = 'failed' WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid", [ORG_X, FILE.policyFailed]);
      await seed("y", "7", ORG_Y, PROJECT_Y, BATCH_Y);
      await recordDecisions({ organizationId: ORG_Y, profileId: ids.profile.y, actorContext: await actorOf(USERS.adminY), outcomes: ["reviewed"], p1_07: PRE_FIX_P1_07_REFUSAL });
      for (const key of ["hist", "conc", "notAllowed", "policyFailed"]) assert.deepEqual(await candidateOf(ORG_X, ids.profile[key]), [], key);
      results.files = "PASS: historical (A, no candidate), concurrency, not_allowed (normal seam refused the candidate), later (promoted under 'unknown'), legacy (pre-repair untouched-form decision, promoted), failed policy, Y";
    });

    // --- 1: Admin A's review through the UI ------------------------------------
    await test("1: Admin A's untouched review form sends nothing and direct submissions without a valid AI disposition are refused; Admin A's deliberate review through Data Sources > Use for impact is recorded and the P1-07 handoff creates the candidate", async () => {
      await openDataSources(adminAPage);
      await adminAPage.waitFor(() => has(adminAPage, `[data-client-use-for-impact="${FILE.ui}"]`), "Use for impact offered");
      const before = await counts(ORG_X);
      let mark = adminAPage.mark();
      await adminAPage.clickIn(`[data-client-use-for-impact="${FILE.ui}"]`, "Use for impact");
      await adminAPage.waitForText("Use for impact: this file first needs your sensitivity & allowed-use review.");
      await adminAPage.waitForText("Start review work");
      assert.deepEqual(postsSince(adminAPage, mark), [], "opening the review writes nothing");
      await adminAPage.clickButton("Start review work");
      await adminAPage.waitFor(async () => (await adminAPage.text()).includes("Submit review"), "decision form");
      await adminAPage.idle();
      // The untouched form: allowed use 'unknown', no AI disposition selected ("Permitted" needs allowed use 'allowed').
      const radios = `["sensitivity-ai-processing-permitted", "sensitivity-ai-processing-not-permitted"].map((id) => document.getElementById(id))`;
      assert.deepEqual(await adminAPage.evaluate(`${radios}.map((el) => [el.checked, el.disabled])`), [[false, true], [false, false]]);
      assert.ok((await adminAPage.text()).includes("Not selected. Choose whether AI processing is permitted before submitting this review."));
      const untouchedBefore = await counts(ORG_X);
      mark = adminAPage.mark();
      await adminAPage.clickButton("Submit review");
      await adminAPage.waitForText("Review not submitted: choose whether AI processing is permitted, or use Needs more information. Nothing was sent.");
      await adminAPage.idle();
      assert.deepEqual(postsSince(adminAPage, mark), [], "the untouched form sends no decision");
      // Direct submissions bypassing the form, through the real route: the untouched form's body (AI field
      // omitted by the builder), a null, a non-boolean, and an AI permission without the allowed-use basis.
      const queue = await sensitivityQueue(ORG_X, ids.profile.ui);
      const untouchedBody = buildSensitivityDecisionRequestBody({
        decision: "reviewed", expectedUpdatedAt: new Date(queue.updated_at).toISOString(), reviewQueueItemId: queue.review_queue_item_id,
        formState: defaultSensitivityReviewFormState(),
      });
      const withAi = (value) => ({ ...untouchedBody, reviewed_snapshot: { ...untouchedBody.reviewed_snapshot, reviewed_llm_processing_allowed: value } });
      const bypasses = [
        ["untouched form body", untouchedBody, "reviewed_snapshot_incomplete"],
        ["null", withAi(null), "invalid_permission_flag"],
        ["string \"false\"", withAi("false"), "invalid_permission_flag"],
        ["true under unknown allowed use", withAi(true), "llm_processing_basis_not_established"],
      ];
      for (const [label, requestBody, reason] of bypasses) {
        const refused = await adminAPage.api("POST", sensitivityDecisionPath(ORG_X, ids.profile.ui), requestBody);
        assert.deepEqual([refused.status, refused.body.blockers?.[0]?.blocking_reason], [422, reason], `${label}: ${JSON.stringify(refused.body)}`);
      }
      assert.deepEqual(delta(await counts(ORG_X), untouchedBefore), ZERO, "no write (audit included) by the untouched form or any refused submission");
      // The reviewer deliberately records AI processing as not permitted.
      await adminAPage.evaluate(`document.getElementById("sensitivity-ai-processing-not-permitted").click()`);
      mark = adminAPage.mark();
      await adminAPage.clickButton("Submit review");
      // The recorded decision resumes the flow at the next human step: the source authorization.
      await adminAPage.waitFor(() => has(adminAPage, "[data-client-source-authorization]"), "flow resumed at the source authorization");
      await adminAPage.idle();
      assert.deepEqual(postsSince(adminAPage, mark)[0], [`${COCKPIT}/sensitivity-profiles/${ids.profile.ui}/decision`, 200]);
      const sent = JSON.parse(adminAPage.requestsSince(mark).find((r) => r.method === "POST").body);
      assert.equal(Object.keys(sent.reviewed_snapshot).length, 14);
      assert.equal(sent.reviewed_snapshot.reviewed_llm_processing_allowed, false, "the deliberate choice is sent as chosen");
      console.log(`[source-to-impact-workflow-browser] deliberate decision payload ${JSON.stringify(sent)}`);
      const [decision] = await decisionsOf(ORG_X, ids.profile.ui);
      assert.deepEqual([decision.decision_outcome, decision.decided_by, decision.decided_by_role], ["reviewed", ids.adminA, "client_admin"]);
      const [candidate] = await candidateOf(ORG_X, ids.profile.ui);
      assert.deepEqual([candidate.candidate_status, candidate.created_by], ["needs_gk_review", ids.adminA]);
      ids.candidate.ui = candidate.intake_source_candidate_id;
      ids.uiDecision = decision.decision_id;
      assert.ok((await adminAPage.text()).includes("Use for impact: confirm the source authorization below"));
      await adminAPage.clickButton("Close source review");
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual({ ...d, audit_events: 0 }, { ...ZERO, sensitivity_items: 1, sensitivity_decisions: 1, candidates: 1, candidate_items: 1 });
      results.step1 = "PASS: untouched form: no POST; direct untouched/null/non-boolean/unbased bodies 422 with zero writes; deliberate review through the UI (client_admin, Admin A, AI not permitted as chosen); candidate by Admin A; the flow resumed at the source authorization";
    });

    // --- before: responsibility -----------------------------------------------
    await test("PIPELINE: each administrator is offered its own steps; a contributor sees the organization's administrator - not Get Kinder - as responsible; a not_allowed file is closed for everyone", async () => {
      await adminBPage.goto("/impact-library");
      const forB = await adminBPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(forB.status, 200, JSON.stringify(forB.body));
      assert.deepEqual(currentOf(fileOf(forB, FILE.ui)), ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"]);
      assert.deepEqual(currentOf(fileOf(forB, FILE.hist)), ["source_review", "waiting_for_client", "client", "continue_source_preparation", "source_preparation_ready"],
        "Admin A's review is continuable by Admin B");
      assert.deepEqual(currentOf(fileOf(forB, FILE.notAllowed)), ["source_review", "closed", "none", "none", "allowed_use_not_allowed"]);
      assert.deepEqual(currentOf(fileOf(forB, FILE.policyFailed)).slice(0, 3), ["security_check", "failed", "get_kinder"]);
      await pages.contributor.goto("/impact-library");
      const forContributor = await pages.contributor.api("GET", pipelinePath(ORG_X, PROJECT_X));
      for (const key of ["ui", "hist"]) {
        assert.deepEqual(currentOf(fileOf(forContributor, FILE[key])),
          ["source_review", "waiting_for_client", "client", "ask_organization_administrator", "organization_administrator_action_ready"], key);
      }
      assert.deepEqual(currentOf(fileOf(forContributor, FILE.notAllowed)), ["source_review", "closed", "none", "none", "allowed_use_not_allowed"]);
      results.pipeline = "PASS: A/B offered promote/continue; contributor: the organization's administrator is responsible; not_allowed closed for everyone";
    });

    // --- 2-3: Admin B continues Admin A's historical review, to evidence -------
    await test("2-3: Admin B's Use for impact continues Admin A's historical review (A's decision unchanged), stops for B's explicit source authorization, promotes, and evidence follows - one candidate, one source, one current version", async () => {
      await openDataSources(adminBPage);
      await adminBPage.waitFor(() => has(adminBPage, `[data-client-use-for-impact="${FILE.hist}"]`), "Use for impact offered to Admin B");
      const decisionsBefore = await decisionsOf(ORG_X, ids.profile.hist);
      const before = await counts(ORG_X);
      const mark = adminBPage.mark();
      await adminBPage.clickIn(`[data-client-use-for-impact="${FILE.hist}"]`, "Use for impact");
      await adminBPage.waitForText("Use for impact: confirm the source authorization below");
      const [candidate] = await candidateOf(ORG_X, ids.profile.hist);
      assert.equal(candidate.created_by, kai.adminB, "the continuation runs as Admin B");
      ids.candidate.hist = candidate.intake_source_candidate_id;
      assert.deepEqual(postsSince(adminBPage, mark)[0], [continuationPath(ORG_X, PROJECT_X, FILE.hist).split("?")[0], 200], "the existing continuation route");
      const { restrictions } = await authorizeAndPromote(adminBPage, ids.candidate.hist);
      assert.ok(restrictions.includes("recorded AI processing permission: permitted."), restrictions);
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual([d.candidates, d.candidate_items, d.promotions, d.sources, d.source_versions, d.sensitivity_decisions, d.evidence],
        [1, 1, 1, 1, 1, 0, 2], JSON.stringify(d));
      assert.deepEqual(await decisionsOf(ORG_X, ids.profile.hist), decisionsBefore, "Admin A's decision and attribution are unchanged");
      const [version] = await query(
        `SELECT v.source_version_id::text, v.is_current, v.created_by::text, d.created_by::text AS decided_by FROM kai.source_versions v
           JOIN kai.intake_promotion_decisions d ON d.organization_id = v.organization_id AND d.source_version_id = v.source_version_id
          WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid`, [ORG_X, ids.candidate.hist]);
      assert.deepEqual([version.is_current, version.created_by, version.decided_by], [true, kai.adminB, kai.adminB]);
      ids.histSourceVersion = version.source_version_id;
      ids.histEvidence = await query("SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid ORDER BY statement",
        [ORG_X, version.source_version_id]);
      const pipeline = await adminBPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(fileOf(pipeline, FILE.hist).currentStage, "evidence_review");
      assert.equal(await has(adminBPage, `[data-client-use-for-impact="${FILE.hist}"]`), false, "no further action offered");
      results.steps2_3 = "PASS: B continued A's review (decision unchanged), explicit authorization required, promoted by B; 1 candidate/source/current version, 2 evidence";
    });

    // --- 4: an existing candidate bypasses recovery ----------------------------
    await test("4: Admin B's Use for impact on Admin A's file with an existing candidate goes straight to the source authorization and promotes without creating anything twice", async () => {
      const before = await counts(ORG_X);
      const continued = await adminBPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.ui), {});
      assert.deepEqual([continued.status, continued.body.data.source_candidate_handoff.status], [200, "existing"], "recovery is bypassed");
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      await adminBPage.waitFor(() => has(adminBPage, `[data-client-use-for-impact="${FILE.ui}"]`), "offered");
      const mark = adminBPage.mark();
      await adminBPage.clickIn(`[data-client-use-for-impact="${FILE.ui}"]`, "Use for impact");
      await adminBPage.waitForText("Use for impact: confirm the source authorization below");
      assert.deepEqual(postsSince(adminBPage, mark), [], "nothing is posted before the confirmation");
      const { restrictions } = await authorizeAndPromote(adminBPage, ids.candidate.ui);
      assert.ok(restrictions.includes("recorded AI processing permission: not permitted."), `the affected reviewer sees the recorded AI restriction: ${restrictions}`);
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual([d.candidates, d.candidate_items, d.promotions, d.sources, d.source_versions, d.evidence], [0, 0, 1, 1, 1, 2], JSON.stringify(d));
      assert.equal((await candidateOf(ORG_X, ids.profile.ui)).length, 1);
      results.step4 = "PASS: existing candidate reused ('existing', zero writes), promoted once";
    });

    // --- 5: idempotency ---------------------------------------------------------
    await test("5: concurrent continuation by Admin A and Admin B (and repeats) creates one candidate, one review item, and one audit; nothing is promoted automatically", async () => {
      const before = await counts(ORG_X);
      const path = continuationPath(ORG_X, PROJECT_X, FILE.conc);
      const request = `fetch(${JSON.stringify(path)}, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}" })
        .then(async (response) => ({ status: response.status, body: await response.json() }))`;
      const all = (await Promise.all([
        adminAPage.evaluate(`Promise.all([0, 1].map(() => ${request}))`),
        adminBPage.evaluate(`Promise.all([0, 1].map(() => ${request}))`),
      ])).flat();
      assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200], JSON.stringify(all));
      const statuses = all.map((r) => r.body.data.source_candidate_handoff.status);
      assert.equal(statuses.filter((s) => s === "created").length, 1, JSON.stringify(statuses));
      assert.equal(new Set(all.map((r) => r.body.data.source_candidate_handoff.intake_source_candidate_id)).size, 1);
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual([d.candidates, d.candidate_items, d.audit_events, d.promotions, d.sensitivity_decisions], [1, 1, 1, 0, 0], JSON.stringify(d));
      const repeat = await adminBPage.api("POST", path, {});
      assert.equal(repeat.body.data.source_candidate_handoff.status, "existing");
      results.step5 = `PASS: 4 concurrent requests by two administrators [${statuses.join(", ")}] -> 1 candidate/item/audit; repeat existing; no promotion`;
    });

    // --- 6: effective not_allowed through every entry point ---------------------
    await test("6: an effective not_allowed use is refused through the normal seam, the continuation, and every direct entry point (P1-07, P1-08, P2-01, P2-03, P2-04, generation), writing nothing and calling no model", async () => {
      // 'later' was promoted under 'unknown' and has evidence, a claim, and gap follow-ups; Admin A then re-reviews it as not_allowed.
      const adminB = await actorOf(USERS.adminB);
      const [laterEvidence, laterEvidence2] = await query("SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid ORDER BY statement",
        [ORG_X, ids.laterSourceVersion]);
      const proposed = await adminBPage.api("POST", claimProposalPath(ORG_X, laterEvidence.evidence_item_id), {});
      assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
      ids.laterClaim = proposed.body.data.claim.claim_id;
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.later, actorContext: await actorOf(USERS.adminA), outcomes: ["reviewed"], ensure: false,
        snapshot: { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed" } });
      const before = await counts(ORG_X);
      const callsBefore = modelCalls.length;
      const refusals = {
        continuation: await adminBPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.notAllowed), {}),
        extraction: await adminBPage.api("POST", evidenceExtractionPath(ORG_X, ids.laterSourceVersion), {}),
        proposal: await adminBPage.api("POST", claimProposalPath(ORG_X, laterEvidence2.evidence_item_id), {}),
        followups: await adminBPage.api("POST", claimGapFollowupsPath(ORG_X, ids.laterClaim), {}),
        summary: await adminBPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([ids.laterClaim], "na-summary")),
        narrative: await adminBPage.api("POST", createImpactNarrativePath(ORG_X), DRAFT_BODY([ids.laterClaim], "na-narrative")),
      };
      for (const [label, response] of Object.entries(refusals)) {
        assert.equal(response.status, 422, `${label}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.blockers?.[0]?.blocking_reason, "allowed_use_not_allowed", `${label}: ${JSON.stringify(response.body)}`);
      }
      for (const response of Object.values(refusals).slice(1)) assert.equal(response.body.blockers[0].validator_key, "VAL-KAI-B1A-02-003");
      // Direct service entries (a GK-style caller with no administrator prerequisite would meet the same gate).
      const directCandidate = await createSourceCandidateStub(
        { organizationId: ORG_X, intakeSensitivityProfileId: ids.profile.notAllowed, actorContext: adminB, now: new Date().toISOString() },
        { env: ENV, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) } });
      assert.deepEqual([directCandidate.ok, directCandidate.blockers?.[0]?.blocking_reason], [false, "allowed_use_not_allowed"], JSON.stringify(directCandidate));
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO, "no write by any refusal");
      assert.equal(modelCalls.length, callsBefore, "no claim of a not_allowed file reached the model");
      // A not_allowed candidate created before the repair cannot be promoted either (P1-08).
      const [legacyCandidate] = await query(
        `INSERT INTO kai.intake_source_candidates (organization_id, intake_file_id, file_profile_id, data_dictionary_id, intake_sensitivity_profile_id,
           profile_canonical_sha256, proposed_source_type, candidate_status, created_by, created_by_type)
         SELECT organization_id, intake_file_id, file_profile_id, data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
                'unknown', 'needs_gk_review', $3::uuid, 'human'
           FROM kai.intake_sensitivity_profiles WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid
         RETURNING intake_source_candidate_id::text`, [ORG_X, ids.profile.notAllowed, ids.adminA]);
      await query(
        `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by, created_by_type)
         VALUES ($1::uuid, 'source_candidate_review', 'intake_source_candidate', $2::uuid, 'medium', 'open', 'needs_gk_review', 'Review intake source-candidate stub for human classification.',
                 'Human review is required.', '{"p0_stub": true}'::jsonb, $3::uuid, 'human')`, [ORG_X, legacyCandidate.intake_source_candidate_id, ids.adminA]);
      const legacyBefore = await counts(ORG_X);
      const promotion = await adminBPage.api("POST", decisionPath(ORG_X, legacyCandidate.intake_source_candidate_id), PROMOTE);
      assert.deepEqual([promotion.status, promotion.body.data?.exact_verification_phase, promotion.body.blockers?.[0]?.blocking_reason],
        [422, "source_promotion_allowed_use_not_allowed", "allowed_use_not_allowed"], JSON.stringify(promotion.body));
      assert.deepEqual(delta(await counts(ORG_X), legacyBefore), ZERO);
      const pipeline = await adminBPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(pipeline.status, 200, "the pipeline stays readable with a refused claim in the Project");
      assert.deepEqual(currentOf(fileOf(pipeline, FILE.later)).slice(0, 2), ["evidence_review", "waiting_for_get_kinder"], "existing evidence is never hidden");
      results.step6 = "PASS: continuation, P2-01, P2-03, P2-04, both drafts 422 allowed_use_not_allowed; direct P1-07 refused; legacy candidate P1-08 422; zero writes; 0 model calls";
    });

    // --- 7-8: the permitted source reaches claims, follow-ups, drafts; B reads them
    await test("7-8: Admin B takes the permitted source to a claim, gap follow-ups, and both internal drafts through the UI, then reads the persisted drafts with their true review state and citations", async () => {
      const [evidence] = ids.histEvidence;
      await adminBPage.waitFor(() => has(adminBPage, `[data-client-evidence="${evidence.evidence_item_id}"] button`), "evidence listed");
      let mark = adminBPage.mark();
      await adminBPage.clickIn(`[data-client-evidence="${evidence.evidence_item_id}"] button`, "Propose claim");
      await adminBPage.waitFor(async () => (await adminBPage.evaluate(`document.querySelector('[data-client-evidence="${evidence.evidence_item_id}"]').innerText`)).includes("Claim proposed"), "claim proposed");
      await adminBPage.idle();
      assert.deepEqual(postsSince(adminBPage, mark), [[claimProposalPath(ORG_X, evidence.evidence_item_id), 200]]);
      const [claim] = await query("SELECT claim_id::text, claim_review_status, internal_only FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid", [ORG_X, evidence.evidence_item_id]);
      assert.deepEqual([claim.claim_review_status, claim.internal_only], ["needs_gk_review", true]);
      ids.histClaim = claim.claim_id;
      await adminBPage.waitFor(() => has(adminBPage, `[data-client-claim-gap-followups="${claim.claim_id}"]`), "gap follow-ups offered");
      mark = adminBPage.mark();
      await adminBPage.clickIn(`[data-client-claim-gap-followups="${claim.claim_id}"]`, "Generate gap follow-ups");
      await adminBPage.waitForText("Gap follow-ups generated:");
      await adminBPage.idle();
      assert.ok([200, 201].includes(postsSince(adminBPage, mark)[0][1]));
      await adminBPage.clickIn(`[data-client-claim="${claim.claim_id}"] input`, "Use in an internal draft");
      await adminBPage.waitFor(async () => !(await adminBPage.text()).includes("Select at least one claim below to draft from."), "draft readiness");
      const callsBefore = modelCalls.length;
      mark = adminBPage.mark();
      await adminBPage.clickButton("Generate internal evidence summary");
      await adminBPage.waitForText("Internal evidence summary created: 1 block(s) citing 1 claim(s).");
      // The persisted draft is read back and rendered.
      await adminBPage.waitFor(() => has(adminBPage, "[data-client-internal-draft-detail]"), "summary read back");
      await adminBPage.idle();
      await adminBPage.clickButton("Generate internal impact narrative");
      await adminBPage.waitForText("Internal impact narrative created: 1 block(s) citing 1 claim(s).");
      await adminBPage.idle();
      const posts = postsSince(adminBPage, mark);
      assert.deepEqual(posts, [[createEvidenceSummaryPath(ORG_X), 201], [createImpactNarrativePath(ORG_X), 201]]);
      assert.equal(modelCalls.length - callsBefore, 2);
      const drafts = await query(
        `SELECT d.generated_content_draft_id::text AS id, d.content_type, d.requested_audience, q.queue_status, q.review_status
           FROM kai.generated_content_drafts d JOIN kai.review_queue_items q ON q.organization_id = d.organization_id
            AND q.queue_type = 'generated_content_review' AND q.target_object_id = d.generated_content_draft_id
          WHERE d.organization_id = $1::uuid ORDER BY d.content_type`, [ORG_X]);
      assert.deepEqual(drafts.map((d) => [d.content_type, d.requested_audience, d.queue_status, d.review_status]),
        [["evidence_summary", "internal", "open", "needs_gk_review"], ["impact_narrative", "internal", "open", "needs_gk_review"]]);
      // Actual authorized reads (not generation status): list + both details, through the routes.
      const gets = adminBPage.requestsSince(mark).filter((r) => r.method === "GET" && pathOf(r).includes("/client-internal-drafts")).map((r) => [pathOf(r), r.status]);
      assert.ok(gets.some(([p, s]) => p.endsWith(`/client-internal-drafts/${drafts[0].id}`) && s === 200), JSON.stringify(gets));
      const list = await adminBPage.api("GET", clientInternalDraftsPath(ORG_X, PROJECT_X));
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.data.items.map((item) => [item.contentType, item.reviewState]).sort(),
        [["evidence_summary", "awaiting_get_kinder_review"], ["impact_narrative", "awaiting_get_kinder_review"]]);
      for (const draft of drafts) {
        const read = await adminBPage.api("GET", clientInternalDraftPath(ORG_X, PROJECT_X, draft.id));
        assert.equal(read.status, 200, JSON.stringify(read.body));
        assert.deepEqual([read.body.data.audience, read.body.data.reviewState, read.body.data.citedClaimsCurrentlyEligible], ["internal", "awaiting_get_kinder_review", false]);
        assert.deepEqual(read.body.data.blocks.map((block) => block.supportingClaimIds), [[claim.claim_id]]);
        assert.ok(read.body.data.blocks[0].text.startsWith("Internal draft text for:"));
        assert.deepEqual(read.body.data.limitations, ["internal_use_only", "not_approved_for_external_use", "awaiting_get_kinder_review", "cited_claims_not_currently_eligible"]);
        const serialized = JSON.stringify(read.body);
        for (const hidden of ["reviewQueueItemId", "evidenceItemId", "sourceVersionId", "blockerCodes", "needs_gk_review", "generationRunId"]) {
          assert.ok(!serialized.includes(hidden), `${hidden} is not returned`);
        }
      }
      // The rendered page shows the persisted text, review state, citations, and limitations.
      const rendered = await adminBPage.evaluate(`document.querySelector("[data-client-internal-drafts]").innerText`);
      assert.ok(rendered.includes("Awaiting Get Kinder review"), rendered);
      assert.ok(rendered.includes("Internal draft text for:"), rendered);
      assert.ok(rendered.includes("Not approved for funder or public use, export, or release."), rendered);
      assert.ok(rendered.includes("claim review: needs_gk_review"), rendered);
      assert.deepEqual(adminBPage.exceptions, []);
      results.steps7_8 = "PASS: claim -> P2-04 -> evidence summary 201 + impact narrative 201 (2 model calls) -> Admin B lists and reads both persisted drafts (awaiting review, cited claim, limitations) via the routes and the page";
    });

    // --- 8b: AI processing not permitted ------------------------------------------
    await test("8b: a file whose current reviewed decision does not permit AI processing keeps its non-AI processing (claim, gap follow-ups), but its claim reaches the model through neither draft, alone or mixed with a permitted claim, and nothing is written", async () => {
      // The 'ui' file's decision was recorded through the UI form, where Admin A deliberately chose "Not permitted".
      const [uiDecision] = await query(
        `SELECT reviewed_allowed_use_status, reviewed_llm_processing_allowed FROM kai.intake_sensitivity_review_decisions
          WHERE organization_id = $1::uuid AND decision_id = $2::uuid`, [ORG_X, ids.uiDecision]);
      assert.deepEqual([uiDecision.reviewed_allowed_use_status, uiDecision.reviewed_llm_processing_allowed], ["unknown", false]);
      const [uiEvidence] = await query(
        `SELECT e.evidence_item_id::text FROM kai.evidence_items e
           JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
          WHERE e.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid ORDER BY e.statement`, [ORG_X, ids.candidate.ui]);
      const proposed = await adminBPage.api("POST", claimProposalPath(ORG_X, uiEvidence.evidence_item_id), {});
      assert.equal(proposed.status, 200, `non-AI claim proposal: ${JSON.stringify(proposed.body)}`);
      const uiClaim = proposed.body.data.claim.claim_id;
      ids.uiClaim = uiClaim;
      const followups = await adminBPage.api("POST", claimGapFollowupsPath(ORG_X, uiClaim), {});
      assert.ok([200, 201].includes(followups.status), `non-AI gap follow-ups: ${JSON.stringify(followups.body)}`);
      const before = await counts(ORG_X);
      const callsBefore = modelCalls.length;
      const mixed = [ids.histClaim, uiClaim].sort();
      const refusals = {
        summary: await adminBPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([uiClaim], "ai-summary")),
        narrative: await adminBPage.api("POST", createImpactNarrativePath(ORG_X), DRAFT_BODY([uiClaim], "ai-narrative")),
        mixedSummary: await adminBPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY(mixed, "ai-mixed-summary")),
        mixedNarrative: await adminBPage.api("POST", createImpactNarrativePath(ORG_X), DRAFT_BODY(mixed, "ai-mixed-narrative")),
      };
      for (const [label, response] of Object.entries(refusals)) {
        assert.equal(response.status, 422, `${label}: ${JSON.stringify(response.body)}`);
        // The route's blocker projection carries the key and reason (the basis is proven in kai-effective-ai-processing-enforcement.spec.js).
        const [blocker] = response.body.blockers || [];
        assert.deepEqual([blocker?.validator_key, blocker?.blocking_reason], ["VAL-KAI-B1A-02-004", "ai_processing_not_permitted"], label);
        assert.match(blocker.message, /does not permit AI processing/, `${label}: the refusal names the restriction`);
      }
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO, "no write by any refusal");
      assert.equal(modelCalls.length, callsBefore, "no claim of the file reached the model");
      results.step8b = "PASS: claim proposal 200 + gap follow-ups for the AI-restricted file; both drafts, alone and mixed with the permitted claim, 422 ai_processing_not_permitted; zero writes; 0 model calls";
    });

    // --- 8c: historical reviewed 'unknown', authorized correction, continuation ---
    await test("8c: the pre-repair untouched-form decision keeps its conservative AI restriction; a deliberate new decision by Admin B supersedes it through the normal decision route (history preserved, replay idempotent, others refused); Admin B then drafts from the file through the UI; explicit and unresolved restrictions still hold", async () => {
      const draftCounts = {};
      const profileId = ids.profile.legacy;
      const legacyEvidence = await query("SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid ORDER BY statement",
        [ORG_X, ids.legacySourceVersion]);
      assert.equal(legacyEvidence.length, 2);
      // The historical record is preserved as recorded and stays conservative (reviewed 'unknown' cannot carry AI permission).
      const [historical, ...none] = await decisionsOf(ORG_X, profileId);
      assert.deepEqual(none, []);
      assert.deepEqual([historical.decision_outcome, historical.reviewed_allowed_use_status, historical.reviewed_llm_processing_allowed, historical.is_head],
        ["reviewed", "unknown", false, true]);
      // Non-AI processing continues under the AI-only restriction.
      const proposed = await adminBPage.api("POST", claimProposalPath(ORG_X, legacyEvidence[0].evidence_item_id), {});
      assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
      const legacyClaim = proposed.body.data.claim.claim_id;
      const followups = await adminBPage.api("POST", claimGapFollowupsPath(ORG_X, legacyClaim), {});
      assert.ok([200, 201].includes(followups.status), JSON.stringify(followups.body));
      let before = await counts(ORG_X);
      let callsBefore = modelCalls.length;
      for (const [label, path, claimIds] of [
        ["historical summary", createEvidenceSummaryPath(ORG_X), [legacyClaim]],
        ["historical narrative", createImpactNarrativePath(ORG_X), [legacyClaim]],
        ["historical mixed with a permitted claim", createEvidenceSummaryPath(ORG_X), [ids.histClaim, legacyClaim].sort()],
      ]) {
        const refused = await adminBPage.api("POST", path, DRAFT_BODY(claimIds, `legacy-${label.replace(/\W+/g, "-")}`));
        assert.deepEqual([refused.status, refused.body.blockers?.[0]?.validator_key, refused.body.blockers?.[0]?.blocking_reason], [422, "VAL-KAI-B1A-02-004", "ai_processing_not_permitted"], label);
      }
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      draftCounts.historicalRefusals = modelCalls.length - callsBefore;
      assert.equal(draftCounts.historicalRefusals, 0, "no model call for the historical reviewed-unknown file");

      // The correction body is the form's own: a re-review seeded from the current decision, with the
      // allowed use and the AI disposition deliberately chosen (the seed never restates the old AI fact).
      const detail = await adminBPage.api("GET", sensitivityProfilePath(ORG_X, profileId));
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      const seeded = sensitivityReviewFormStateFromDecision(detail.body.data.current_decision);
      assert.equal(seeded.reviewed_llm_processing_allowed, null, "the re-review starts with no AI disposition");
      const queue = await sensitivityQueue(ORG_X, profileId);
      const correction = buildSensitivityDecisionRequestBody({
        decision: "reviewed", expectedUpdatedAt: new Date(queue.updated_at).toISOString(), reviewQueueItemId: queue.review_queue_item_id,
        formState: { ...withSensitivityAllowedUse(seeded, "allowed"), reviewed_llm_processing_allowed: true },
      });
      // Unauthorized and cross-tenant review attempts are refused first, writing nothing.
      const refusedReviewers = [["client_contributor", pages.contributor], ["revoked delegated admin", pages.revokedB], ["client_reviewer", pages.clientReviewer], ["other organization's administrator", pages.adminY]];
      for (const [, page] of refusedReviewers) await page.goto("/impact-library");
      before = await counts(ORG_X);
      for (const [label, page] of refusedReviewers) {
        const refused = await page.api("POST", sensitivityDecisionPath(ORG_X, profileId), correction);
        assert.equal(refused.status, 403, `${label}: ${JSON.stringify(refused.body)}`);
      }
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO, "no write by any refused reviewer");
      // Admin B (a delegated client_admin) records the correction through the normal decision route.
      before = await counts(ORG_X);
      const corrected = await adminBPage.api("POST", sensitivityDecisionPath(ORG_X, profileId), correction);
      assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
      assert.deepEqual([corrected.body.data.replayed, corrected.body.data.current_decision.reviewed_allowed_use_status, corrected.body.data.current_decision.reviewed_llm_processing_allowed],
        [false, "allowed", true]);
      const afterCorrection = delta(await counts(ORG_X), before);
      assert.deepEqual([afterCorrection.sensitivity_decisions, afterCorrection.candidates, afterCorrection.sources, afterCorrection.evidence], [1, 0, 0, 0], JSON.stringify(afterCorrection));
      // A replay of the same request is idempotent; a different outcome on the consumed stamp is a conflict.
      before = await counts(ORG_X);
      const replay = await adminBPage.api("POST", sensitivityDecisionPath(ORG_X, profileId), correction);
      assert.deepEqual([replay.status, replay.body.data?.replayed], [200, true], JSON.stringify(replay.body));
      const stale = await adminBPage.api("POST", sensitivityDecisionPath(ORG_X, profileId),
        { expected_updated_at: correction.expected_updated_at, review_queue_item_id: correction.review_queue_item_id, decision: "needs_more_information" });
      assert.equal(stale.status, 409, JSON.stringify(stale.body));
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO, "no write by the replay or the conflict");
      // History: the historical decision is preserved unchanged and superseded; the correction is the one current head.
      const history = await decisionsOf(ORG_X, profileId);
      assert.deepEqual(history.map((d) => [d.decision_outcome, d.reviewed_allowed_use_status, d.reviewed_llm_processing_allowed, d.decided_by, d.is_head, d.supersedes_decision_id]), [
        ["reviewed", "unknown", false, ids.adminA, false, null],
        ["reviewed", "allowed", true, kai.adminB, true, historical.decision_id],
      ]);
      // Each decision's two required same-transaction audits: the lifecycle row (decision lineage) and the metadata-only event (actor).
      const lifecycleAudits = await query(
        `SELECT metadata->>'decision_id' AS decision_id, metadata->>'supersedes_decision_id' AS supersedes FROM kai.upload_lifecycle_audit
          WHERE organization_id = $1::uuid AND operation = 'sensitivity_review_decision_recorded' AND metadata->>'intake_sensitivity_profile_id' = $2 ORDER BY created_at`,
        [ORG_X, profileId]);
      assert.deepEqual(lifecycleAudits.map((a) => [a.decision_id, a.supersedes]),
        [[historical.decision_id, null], [history[1].decision_id, historical.decision_id]], "each decision's lineage audited once");
      const actorAudits = await query(
        `SELECT actor_user_id::text AS actor FROM kai.audit_events
          WHERE organization_id = $1::uuid AND metadata->>'object_id' = $2 AND metadata->>'operation' = 'sensitivity_review_decision_recorded' ORDER BY audit_event_id`,
        [ORG_X, profileId]);
      assert.deepEqual(actorAudits.map((a) => a.actor), [ids.adminA, kai.adminB], "each decision's actor audited once");

      // Continuation: Admin B selects the corrected file's claim in Data Sources and generates both internal drafts.
      await openDataSources(adminBPage);
      await adminBPage.waitFor(() => has(adminBPage, `[data-client-claim="${legacyClaim}"] input`), "the corrected file's claim offered for drafting");
      await adminBPage.clickIn(`[data-client-claim="${legacyClaim}"] input`, "Use in an internal draft");
      await adminBPage.waitFor(async () => !(await adminBPage.text()).includes("Select at least one claim below to draft from."), "draft readiness");
      callsBefore = modelCalls.length;
      const draftsBefore = new Set((await query("SELECT generated_content_draft_id::text AS id FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X])).map((d) => d.id));
      const mark = adminBPage.mark();
      await adminBPage.clickButton("Generate internal evidence summary");
      await adminBPage.waitForText("Internal evidence summary created: 1 block(s) citing 1 claim(s).");
      await adminBPage.idle();
      await adminBPage.clickButton("Generate internal impact narrative");
      await adminBPage.waitForText("Internal impact narrative created: 1 block(s) citing 1 claim(s).");
      await adminBPage.idle();
      assert.deepEqual(postsSince(adminBPage, mark), [[createEvidenceSummaryPath(ORG_X), 201], [createImpactNarrativePath(ORG_X), 201]]);
      assert.deepEqual(modelCalls.slice(callsBefore).map((call) => call.claimIds), [[legacyClaim], [legacyClaim]]);
      draftCounts.afterCorrection = modelCalls.length - callsBefore;
      const created = (await query(
        `SELECT generated_content_draft_id::text AS id, content_type, requested_audience FROM kai.generated_content_drafts
          WHERE organization_id = $1::uuid ORDER BY content_type`, [ORG_X])).filter((d) => !draftsBefore.has(d.id));
      assert.deepEqual(created.map((d) => [d.content_type, d.requested_audience]), [["evidence_summary", "internal"], ["impact_narrative", "internal"]]);
      for (const draft of created) {
        const read = await adminBPage.api("GET", clientInternalDraftPath(ORG_X, PROJECT_X, draft.id));
        assert.equal(read.status, 200, JSON.stringify(read.body));
        assert.deepEqual([read.body.data.audience, read.body.data.reviewState], ["internal", "awaiting_get_kinder_review"]);
        assert.deepEqual(read.body.data.blocks.map((block) => block.supportingClaimIds), [[legacyClaim]]);
        assert.ok(read.body.data.blocks[0].text.startsWith("Internal draft text for:"));
        assert.deepEqual(read.body.data.limitations, ["internal_use_only", "not_approved_for_external_use", "awaiting_get_kinder_review", "cited_claims_not_currently_eligible"]);
      }

      // The deliberate prohibition on another file still holds, alone or mixed with the corrected claim.
      before = await counts(ORG_X);
      callsBefore = modelCalls.length;
      const mixed = await adminBPage.api("POST", createImpactNarrativePath(ORG_X), DRAFT_BODY([legacyClaim, ids.uiClaim].sort(), "legacy-ui-mixed"));
      assert.deepEqual([mixed.status, mixed.body.blockers?.[0]?.validator_key, mixed.body.blockers?.[0]?.blocking_reason], [422, "VAL-KAI-B1A-02-004", "ai_processing_not_permitted"]);
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      draftCounts.mixedWithExplicitProhibition = modelCalls.length - callsBefore;
      assert.equal(draftCounts.mixedWithExplicitProhibition, 0);

      // A deliberately unresolved decision (needs more information) restricts AI again; non-AI processing continues.
      const reopenQueue = await sensitivityQueue(ORG_X, profileId);
      const reopened = await adminAPage.api("POST", sensitivityDecisionPath(ORG_X, profileId),
        { expected_updated_at: new Date(reopenQueue.updated_at).toISOString(), review_queue_item_id: reopenQueue.review_queue_item_id, decision: "needs_more_information" });
      assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
      const nonAi = await adminBPage.api("POST", claimProposalPath(ORG_X, legacyEvidence[1].evidence_item_id), {});
      assert.equal(nonAi.status, 200, `non-AI claim proposal under an unresolved review: ${JSON.stringify(nonAi.body)}`);
      before = await counts(ORG_X);
      callsBefore = modelCalls.length;
      const unresolved = await adminBPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([legacyClaim], "legacy-unresolved"));
      assert.deepEqual([unresolved.status, unresolved.body.blockers?.[0]?.validator_key, unresolved.body.blockers?.[0]?.blocking_reason], [422, "VAL-KAI-B1A-02-004", "ai_processing_not_permitted"]);
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      draftCounts.unresolved = modelCalls.length - callsBefore;
      assert.equal(draftCounts.unresolved, 0);
      assert.deepEqual((await decisionsOf(ORG_X, profileId)).map((d) => [d.decision_outcome, d.is_head]), [["reviewed", false], ["reviewed", false], ["needs_more_information", true]]);
      assert.deepEqual(adminBPage.exceptions, []);
      console.log(`[source-to-impact-workflow-browser] 8c model calls ${JSON.stringify(draftCounts)}`);
      results.step8c = `PASS: historical reviewed-unknown preserved and refused (0 calls); 4 unauthorized/cross-tenant reviewers 403; Admin B's correction superseded it (history + audits preserved, replay idempotent, stale 409); UI drafts 201 x2 (${draftCounts.afterCorrection} calls) read back with citations; mixed with the explicit prohibition 422 (0 calls); needs-more-information 422 (0 calls) with non-AI proposal 200`;
    });

    // --- 9: refusals --------------------------------------------------------------
    await test("9: revoked and invited grants, a global client_admin role, other client roles, the other organization and Project, and failed file policy are refused with nothing written", async () => {
      const before = await counts(ORG_X);
      const beforeY = await counts(ORG_Y);
      const roleRefusals = [["revoked delegated admin", pages.revokedB], ["invited (inactive) grant", pages.invitedB], ["global client_admin role", pages.globalAdminRole],
        ["client_contributor", pages.contributor], ["client_reviewer", pages.clientReviewer]];
      for (const [label, page] of roleRefusals) {
        await page.goto("/impact-library");
        const capabilities = await page.api("GET", organizationAccessCapabilitiesPath(ORG_X));
        const ops = capabilities.body.data?.workflowOperations || {};
        assert.deepEqual([ops.reviewSensitivity === true, ops.promoteSource === true, ops.readInternalDrafts === true], [false, false, false], label);
        const attempts = [
          await page.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.policyFailed), {}),
          await page.api("GET", detailPath(ORG_X, ids.candidate.ui)),
          await page.api("GET", clientInternalDraftsPath(ORG_X, PROJECT_X)),
        ];
        for (const attempt of attempts) assert.equal(attempt.status, 403, `${label}: ${JSON.stringify(attempt.body)}`);
      }
      const failed = await adminBPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.policyFailed), {});
      assert.deepEqual([failed.status, failed.body.blockers?.[0]?.blocking_reason], [422, "file_policy_not_passed"]);
      await pages.adminY.goto("/impact-library");
      for (const [label, page, organizationId, engagementId, intakeFileId, status] of [
        ["B on another Project", adminBPage, ORG_X, PROJECT_X2, FILE.hist, 404],
        ["B naming Y", adminBPage, ORG_Y, PROJECT_Y, FILE.y, 403],
        ["Y naming X", pages.adminY, ORG_X, PROJECT_X, FILE.conc, 403],
      ]) {
        const refused = await page.api("POST", continuationPath(organizationId, engagementId, intakeFileId), {});
        assert.equal(refused.status, status, `${label}: ${JSON.stringify(refused.body)}`);
      }
      const yDrafts = await pages.adminY.api("GET", clientInternalDraftsPath(ORG_X, PROJECT_X));
      assert.equal(yDrafts.status, 403, "Y cannot read X's drafts");
      const otherProject = await adminBPage.api("GET", clientInternalDraftsPath(ORG_X, PROJECT_X2));
      assert.deepEqual([otherProject.status, otherProject.body.data.items], [200, []], "another Project's draft list is its own");
      // Admin B's grant revoked by Admin A: the next request is refused.
      await adminAPage.api("POST", `${grantPath(ORG_X, USERS.adminB)}/client_admin/revoke`, {});
      try {
        const afterRevoke = await adminBPage.api("GET", clientInternalDraftsPath(ORG_X, PROJECT_X));
        assert.equal(afterRevoke.status, 403);
        const promote = await adminBPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.conc), {});
        assert.equal(promote.status, 403);
      } finally {
        const regranted = await adminAPage.api("POST", grantPath(ORG_X, USERS.adminB), { role_name: "client_admin" });
        assert.equal(regranted.status, 200);
      }
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual({ ...d, audit_events: 0 }, ZERO, JSON.stringify(d));
      assert.deepEqual(delta(await counts(ORG_Y), beforeY), ZERO);
      results.step9 = "PASS: revoked/invited/global-role/contributor/reviewer 403 (capabilities false); failed policy 422; other Project 404; cross-organization 403; B revoked -> 403, regranted; zero domain writes";
    });

    // --- 10: an incomplete claim does not hide the pipeline -----------------------
    await test("10: a Project claim with no P2-04 state and a claim the evaluator refuses leave the pipeline readable for every member, with the other files' state intact", async () => {
      // The 'later' file's claim (refused: not_allowed) and a fresh claim with no gap follow-ups.
      const [, second] = ids.histEvidence;
      const fresh = await adminBPage.api("POST", claimProposalPath(ORG_X, second.evidence_item_id), {});
      assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
      for (const [label, page] of [["Admin B", adminBPage], ["contributor", pages.contributor], ["Admin A", adminAPage]]) {
        const pipeline = await page.api("GET", pipelinePath(ORG_X, PROJECT_X));
        assert.equal(pipeline.status, 200, `${label}: ${JSON.stringify(pipeline.body)}`);
        assert.equal(fileOf(pipeline, FILE.hist).currentStage, "evidence_review", label);
        assert.equal(fileOf(pipeline, FILE.notAllowed).reason, "allowed_use_not_allowed", label);
      }
      results.step10 = "PASS: pipeline 200 for Admin B, contributor, Admin A with an unevaluable and a refused claim in the Project";
    });

    // --- 11-12: no system approvals; GK controls unchanged ------------------------
    await test("11-12: no assistant or system actor approved anything; no evidence, claim, draft, or export review was recorded; the GK queue, generated-draft review, and the GK draft library stay closed to the administrators", async () => {
      const [reviews] = await query(`SELECT
        (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
        (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_decisions,
        (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'generated_content_review' AND queue_status <> 'open')::int AS reviewed_drafts,
        (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid AND created_by_type <> 'human')::int AS machine_promotions,
        (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND created_by_type <> 'human')::int AS machine_decisions`, [ORG_X]);
      assert.deepEqual(reviews, { evidence_decisions: 0, claim_decisions: 0, reviewed_drafts: 0, machine_promotions: 0, machine_decisions: 0 });
      const deciders = await query(
        `SELECT DISTINCT actor_type::text AS actor_type, actor_user_id::text AS actor FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text IN ('sensitivity_review_decision_recorded', 'source_promotion_decision_persisted')`, [ORG_X]);
      assert.ok(deciders.every((row) => row.actor_type === "human" && [ids.adminA, kai.adminB].includes(row.actor)), JSON.stringify(deciders));
      for (const page of [adminAPage, adminBPage]) {
        const queue = await page.api("GET", `${COCKPIT}/queue?organization_id=${ORG_X}&queue_type=source_candidate_review`);
        assert.equal(queue.status, 403, "the GK source review queue");
        const library = await page.api("GET", `${INTAKE}/admin/organizations/${ORG_X}/generated-content-drafts`);
        assert.equal(library.status, 403, "the GK generated-draft library");
        const capabilities = await page.api("GET", organizationAccessCapabilitiesPath(ORG_X));
        const ops = capabilities.body.data.workflowOperations;
        assert.deepEqual([ops.readGeneratedDrafts, ops.reviewGeneratedDrafts, ops.recordEvidenceReview, ops.recordClaimReview, ops.generateAllDraftTypes], [false, false, false, false, false]);
      }
      console.log(`[source-to-impact-workflow-browser] results ${JSON.stringify(results)}`);
      results.steps11_12 = "PASS";
    });
  } finally {
    for (const page of Object.values(pages)) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
