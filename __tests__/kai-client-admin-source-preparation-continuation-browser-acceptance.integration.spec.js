import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assembled acceptance of the source-preparation continuation (owner decision
 * 2026-10-19): files whose authoritative sensitivity review is complete but
 * whose P1-07 source candidate was never created - the observed production
 * shape - continue through the binding-derived client_admin's Data Sources >
 * Source preparation "Continue source preparation" step and the real P1-07
 * handoff, then the existing P1-08 "Review & promote source" step, P2-01
 * evidence, P2-03 claim, P2-04 gap follow-ups, and both internal drafts,
 * with no Get Kinder human in organization X. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-client-admin-source-preparation-continuation-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, transaction, and
 * production metadata-only audit on the runner cluster; the review-work,
 * sensitivity-decision, continuation, P1-07, P1-08, P2-01, P2-03, P2-04, and
 * generation paths; resolveKaiActorContext with the real GK organization
 * binding and JIT kai.users mapping; the built bundle in a real headless
 * Chrome.
 * Simulated / substituted (reported as such, never as pipeline proof):
 * - the Get Kinder session login (req.user from a harness cookie);
 * - WORKER SIMULATION: each file's P1-03..P1-05 rows are seeded as the
 *   worker's output (upload, scan, parsing, profiling, dictionary, and
 *   classification are NOT executed);
 * - HISTORICAL SIMULATION: the historical files' review work and their two
 *   real 'reviewed' decisions (the first, then a UI-style resubmission that
 *   supersedes it) are recorded through the real services as the deciding
 *   administrator, with P1-07 replaced for those calls only by the refusal
 *   the pre-c8170d3 P1-07 returned to a binding-derived client_admin
 *   (tenant_boundary_violation): exactly how a reviewed file came to have no
 *   candidate. The continuation itself always runs the real P1-07;
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

test("source preparation continuation browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("source preparation continuation browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-client-admin-source-preparation-continuation");
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
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const {
    claimGapFollowupsPath,
    claimProposalPath,
    createEvidenceSummaryPath,
    createImpactNarrativePath,
    intakeFileSourceCandidatePath,
    organizationAccessCapabilitiesPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const ORG_X = "0b000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0b000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7b000000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7b000000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7b000000-0000-4000-8000-0000000000e2";
  const BATCH_X = "1b000000-0000-4000-8000-0000000000e1";
  const BATCH_Y = "1b000000-0000-4000-8000-0000000000e2";
  // Mirrors the observed Project: three reviewed files with no candidate, two
  // reviewed files with an open candidate; plus the refusal shapes.
  const FILE = Object.freeze({
    hist1: "2b000000-0000-4000-8000-0000000000a1",
    hist2: "2b000000-0000-4000-8000-0000000000a2",
    hist3: "2b000000-0000-4000-8000-0000000000a3",
    cand1: "2b000000-0000-4000-8000-0000000000b1",
    cand2: "2b000000-0000-4000-8000-0000000000b2",
    otherAdmin: "2b000000-0000-4000-8000-0000000000c1",
    reviewedNotAllowed: "2b000000-0000-4000-8000-0000000000c2",
    profileNotAllowed: "2b000000-0000-4000-8000-0000000000c3",
    needsMore: "2b000000-0000-4000-8000-0000000000c4",
    policyFailed: "2b000000-0000-4000-8000-0000000000c5",
    y: "2b000000-0000-4000-8000-0000000000d1",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ adminX: 971, adminX2: 972, adminY: 973, contributor: 974, clientReviewer: 975, storedAdmin: 976 });
  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const continuationPath = (organizationId, engagementId, intakeFileId) => intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId);
  const detailPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}?organization_id=${organizationId}`;
  const decisionPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}/decision?organization_id=${organizationId}`;
  const pipelinePath = (organizationId, engagementId) =>
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementId}/client-evidence-pipeline`;
  const PROMOTE = { outcome: "promoted", reviewed_source_type: "organization_primary_record" };
  const DRAFT_BODY = (claimIds, key) => ({ claim_ids: claimIds, idempotency_key: key, engagement_id: PROJECT_X });
  // The P1-07 refusal a binding-derived client_admin received before c8170d3
  // (HISTORICAL SIMULATION only; never used by the continuation).
  const PRE_FIX_P1_07_REFUSAL = async () => ({ ok: false, error: { code: "tenant_boundary_violation", status: 403 } });

  // --- organizations, projects, GK bindings, users (authorized setup) ------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Continuation Society", "harbourline-continuation"], [ORG_Y, "Larchmont Continuation Society", "larchmont-continuation"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code] of [[PROJECT_X, ORG_X, "Project Harbourline"], [PROJECT_X2, ORG_X, "Project Harbourline Two"], [PROJECT_Y, ORG_Y, "Project Larchmont"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId, code] of [[BATCH_X, ORG_X, PROJECT_X, "harbourline-intake"], [BATCH_Y, ORG_Y, PROJECT_Y, "larchmont-intake"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, code]);
  }
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  // Organization administrators: active Get Kinder organization-admin
  // memberships in a GK organization bound to the KAI organization. No stored
  // KAI membership, no global role. No Get Kinder staff user exists.
  const gkOrganizations = {};
  for (const [organizationId, name, adminUsers] of [[ORG_X, "Harbourline Continuation Society", [USERS.adminX, USERS.adminX2]], [ORG_Y, "Larchmont Continuation Society", [USERS.adminY]]]) {
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    for (const adminUser of adminUsers) {
      await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, adminUser]);
    }
    gkOrganizations[organizationId] = gkOrganization.id;
  }
  for (const [legacyId, roleName] of [[USERS.contributor, "client_contributor"], [USERS.clientReviewer, "client_reviewer"], [USERS.storedAdmin, "client_admin"]]) {
    const user = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')", [ORG_X, user.user_id, roleName]);
  }
  const actorOf = async (legacyId) => {
    const resolved = await resolveKaiActorContext({ user: { id: legacyId, email: `user${legacyId}@harbourline.test` } });
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    return resolved.actorContext;
  };

  /**
   * WORKER SIMULATION: the P1-03..P1-05 rows of one confirmed, policy-passed
   * Project file. `sensitivity` overrides the P1-05 row.
   */
  async function seedProfiledFile({ organizationId, engagementId, batchId, intakeFileId, name, checksumChar, sensitivity = {} }) {
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
    const profile = {
      status: "profiled", format: "csv",
      counts: { row_count: 1, column_count: FIELD_KEYS.length, field_count: FIELD_KEYS.length },
      fields: FIELD_KEYS.map((key) => ({ field_key: key })),
    };
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
    const columns = Object.keys(sensitivity);
    const [sensitivityProfile] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256${columns.map((c) => `, ${c}`).join("")})
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5${columns.map((_, i) => `, $${i + 6}`).join("")}) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256, ...columns.map((c) => sensitivity[c])],
    );
    return sensitivityProfile.intake_sensitivity_profile_id;
  }

  const REVIEWED_SNAPSHOT = Object.freeze({
    reviewed_personal_data_status: "absent",
    reviewed_minor_data_status: "absent",
    reviewed_health_housing_justice_immigration_status: "absent",
    reviewed_indigenous_governance_status: "unknown",
    reviewed_staff_notes_status: "absent",
    reviewed_story_testimonial_status: "absent",
    reviewed_small_cell_risk_status: "unknown",
    reviewed_financial_records_status: "absent",
    reviewed_consent_basis_status: "unknown",
    reviewed_allowed_use_status: "unknown",
    reviewed_llm_processing_allowed: false,
    reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false,
    reviewed_funder_use_allowed: false,
  });

  async function sensitivityQueue(organizationId, profileId) {
    const [item] = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`,
      [organizationId, profileId],
    );
    return item;
  }

  /**
   * The decider's real review work (the human "Start review work") and each
   * real decision in `outcomes`, in order: the first against the new item, each
   * later one as a UI-style resubmission with the queue's current stamp, which
   * supersedes the previous head. `p1_07` replaces P1-07 for these calls only.
   */
  async function recordDecisions({ organizationId, profileId, actorContext, outcomes, snapshot = REVIEWED_SNAPSHOT, p1_07 = PRE_FIX_P1_07_REFUSAL }) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId: profileId, actorContext, now: new Date().toISOString() },
      { env: ENV },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const handoffs = [];
    for (const outcome of outcomes) {
      const item = await sensitivityQueue(organizationId, profileId);
      const decided = await submitSensitivityProfileDecision({
        organizationId,
        intakeSensitivityProfileId: profileId,
        actorContext,
        payload: {
          expected_updated_at: new Date(item.updated_at).toISOString(),
          review_queue_item_id: item.review_queue_item_id,
          decision: outcome,
          ...(outcome === "reviewed" ? { reviewed_snapshot: snapshot } : {}),
        },
      }, { env: ENV, ...(p1_07 ? { createSourceCandidateStub: p1_07 } : {}) });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      assert.equal(decided.data.replayed, false, "each decision is a new head, not a replay");
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
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audit_events,
      (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid)::int AS lifecycle_audit`, [organizationId]);
    return row;
  }
  const delta = (after, before) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  const ZERO = Object.freeze({
    sensitivity_items: 0, sensitivity_decisions: 0, candidates: 0, candidate_items: 0, promotions: 0, sources: 0,
    source_versions: 0, evidence: 0, claims: 0, drafts: 0, audit_events: 0, lifecycle_audit: 0,
  });
  const CONTINUED = Object.freeze({ ...ZERO, candidates: 1, candidate_items: 1, audit_events: 1, lifecycle_audit: 1 });

  async function candidateOf(organizationId, profileId) {
    return query(
      `SELECT c.intake_source_candidate_id::text, c.candidate_status, c.created_by::text, c.created_by_type,
              q.review_queue_item_id::text AS queue_id, q.queue_status, q.review_status, q.created_by::text AS queue_created_by
         FROM kai.intake_source_candidates c
         LEFT JOIN kai.review_queue_items q ON q.organization_id = c.organization_id AND q.queue_type = 'source_candidate_review'
          AND q.target_object_id = c.intake_source_candidate_id
        WHERE c.organization_id = $1::uuid AND c.intake_sensitivity_profile_id = $2::uuid`,
      [organizationId, profileId],
    );
  }
  async function decisionsOf(organizationId, profileId) {
    return query(
      `SELECT d.decision_id::text, d.decision_outcome, d.decided_by::text, d.decided_by_role, d.supersedes_decision_id::text,
              NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id) AS is_head
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid AND d.intake_sensitivity_profile_id = $2::uuid
        ORDER BY d.created_at`,
      [organizationId, profileId],
    );
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
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.adminX });
  const admin2Page = await openPage(browser, { baseUrl, legacyUserId: USERS.adminX2 });
  const adminYPage = await openPage(browser, { baseUrl, legacyUserId: USERS.adminY });
  const contributorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.contributor });
  const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const storedAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.storedAdmin });
  const results = {};
  const ids = { profile: {}, candidate: {} };
  const pathOf = (request) => new URL(request.url).pathname;
  const postsSince = (page, mark) => page.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);
  const fileOf = (pipeline, intakeFileId) => pipeline.body.data.files.find((file) => file.intakeFileId === intakeFileId);
  const currentOf = (file) => [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
  const CONTINUE = ["source_review", "waiting_for_client", "client", "continue_source_preparation", "source_preparation_ready"];
  const MISSING = ["source_review", "waiting_for_get_kinder", "get_kinder", "contact_get_kinder", "source_candidate_missing"];
  const PROMOTE_READY = ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"];
  const has = (page, selector) => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const setPanelSelect = (labelText, value) => adminPage.evaluate(`(() => {
    const panel = document.querySelector("[data-client-source-promotion-panel]");
    const label = panel && [...panel.querySelectorAll("label")].find((el) => el.innerText.trim().startsWith(${JSON.stringify(labelText)}));
    const el = label && label.querySelector("select");
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value === ${JSON.stringify(value)};
  })()`);
  async function promoteThroughPanel(intakeFileId, candidateId) {
    await adminPage.clickIn(`[data-client-open-source-review="${intakeFileId}"]`, "Review & promote source");
    await adminPage.waitForText("Decision outcome");
    await adminPage.idle();
    assert.ok(await setPanelSelect("Decision outcome", "promoted"), "outcome");
    await adminPage.waitForText("Reviewed source type");
    assert.ok(await setPanelSelect("Reviewed source type", "organization_primary_record"), "source type");
    const mark = adminPage.mark();
    await adminPage.clickButton("Promote");
    await adminPage.waitForText("Source promoted. Evidence extraction created 2 evidence item(s)");
    await adminPage.idle();
    assert.deepEqual(postsSince(adminPage, mark), [[`${COCKPIT}/source-candidates/${candidateId}/decision`, 200]], "exactly the existing P1-08 decision route");
    await adminPage.clickButton("Close source review");
    await adminPage.idle();
  }

  try {
    // --- the historical state ------------------------------------------------
    await test("HISTORICAL STATE: reviewed files with a two-decision history, resolved review, and zero source candidates; and the two files that have candidates", async () => {
      const adminX = await actorOf(USERS.adminX);
      const adminX2 = await actorOf(USERS.adminX2);
      const adminY = await actorOf(USERS.adminY);
      ids.adminX = adminX.actorUserId;
      ids.adminX2 = adminX2.actorUserId;
      const seed = (key, checksumChar, sensitivity, organizationId = ORG_X, engagementId = PROJECT_X, batchId = BATCH_X) =>
        seedProfiledFile({ organizationId, engagementId, batchId, intakeFileId: FILE[key], name: `harbourline-${key}.csv`, checksumChar, sensitivity })
          .then((profileId) => { ids.profile[key] = profileId; return profileId; });

      for (const [key, char] of [["hist1", "1"], ["hist2", "2"], ["hist3", "3"]]) {
        await seed(key, char);
        const handoffs = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile[key], actorContext: adminX, outcomes: ["reviewed", "reviewed"] });
        assert.deepEqual(handoffs.map((h) => [h.status, h.error_code]), [["not_created", "tenant_boundary_violation"], ["not_created", "tenant_boundary_violation"]]);
      }
      // Two files whose candidate exists (the current, repaired handoff).
      for (const [key, char] of [["cand1", "4"], ["cand2", "5"]]) {
        await seed(key, char);
        const [handoff] = await recordDecisions({ organizationId: ORG_X, profileId: ids.profile[key], actorContext: adminX, outcomes: ["reviewed"], p1_07: null });
        assert.equal(handoff.status, "created", JSON.stringify(handoff));
        ids.candidate[key] = handoff.intake_source_candidate_id;
      }
      // Refusal shapes.
      await seed("otherAdmin", "6");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.otherAdmin, actorContext: adminX2, outcomes: ["reviewed", "reviewed"] });
      await seed("reviewedNotAllowed", "7");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.reviewedNotAllowed, actorContext: adminX, outcomes: ["reviewed", "reviewed"],
        snapshot: { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed" } });
      await seed("profileNotAllowed", "8", { allowed_use_status: "not_allowed" });
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.profileNotAllowed, actorContext: adminX, outcomes: ["reviewed", "reviewed"] });
      await seed("needsMore", "9");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.needsMore, actorContext: adminX, outcomes: ["reviewed", "needs_more_information"] });
      await seed("policyFailed", "a");
      await recordDecisions({ organizationId: ORG_X, profileId: ids.profile.policyFailed, actorContext: adminX, outcomes: ["reviewed", "reviewed"] });
      // SYNTHETIC: the file's policy state is set to failed afterwards, so the
      // continuation's own file-policy gate is what refuses it.
      await query("UPDATE kai.intake_files SET file_policy_status = 'failed' WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid", [ORG_X, FILE.policyFailed]);
      // Organization Y: its administrator's own historical file.
      await seed("y", "b", {}, ORG_Y, PROJECT_Y, BATCH_Y);
      await recordDecisions({ organizationId: ORG_Y, profileId: ids.profile.y, actorContext: adminY, outcomes: ["reviewed", "reviewed"] });

      for (const key of ["hist1", "hist2", "hist3"]) {
        const decisions = await decisionsOf(ORG_X, ids.profile[key]);
        assert.equal(decisions.length, 2, key);
        assert.deepEqual(decisions.map((d) => [d.decision_outcome, d.decided_by, d.decided_by_role, d.is_head]),
          [["reviewed", ids.adminX, "client_admin", false], ["reviewed", ids.adminX, "client_admin", true]], key);
        assert.equal(decisions[1].supersedes_decision_id, decisions[0].decision_id, "a single lineage, not two files");
        const item = await sensitivityQueue(ORG_X, ids.profile[key]);
        assert.deepEqual([item.queue_status, item.review_status], ["resolved", "resolved"]);
        assert.deepEqual(await candidateOf(ORG_X, ids.profile[key]), [], `${key}: zero candidates`);
        ids[`${key}Head`] = decisions[1].decision_id;
      }
      // The repeated-decision join the production SQL used returns one row per
      // decision; the file count is still five reviewed files.
      const joined = await query(
        `SELECT f.intake_file_id::text FROM kai.intake_files f
           JOIN kai.intake_sensitivity_profiles s ON s.organization_id = f.organization_id AND s.intake_file_id = f.intake_file_id
           JOIN kai.intake_sensitivity_review_decisions d ON d.organization_id = s.organization_id AND d.intake_sensitivity_profile_id = s.intake_sensitivity_profile_id
          WHERE f.organization_id = $1::uuid AND f.intake_file_id = ANY($2::uuid[])`,
        [ORG_X, [FILE.hist1, FILE.hist2, FILE.hist3, FILE.cand1, FILE.cand2]]);
      assert.equal(joined.length, 8, "3 x 2 decisions + 2 x 1");
      assert.equal(new Set(joined.map((row) => row.intake_file_id)).size, 5);
      for (const key of ["cand1", "cand2"]) {
        const [candidate] = await candidateOf(ORG_X, ids.profile[key]);
        assert.deepEqual([candidate.candidate_status, candidate.queue_status], ["needs_gk_review", "open"]);
      }
      const totals = await counts(ORG_X);
      assert.deepEqual([totals.candidates, totals.promotions, totals.sources, totals.evidence, totals.claims, totals.drafts], [2, 0, 0, 0, 0, 0]);
      results.historical = "PASS: 3 reviewed files x 2 client_admin decisions (one lineage each), queue resolved, 0 candidates; 2 files with an open candidate; 0 promotions/sources/evidence/claims/drafts";
    });

    // --- before: the pipeline and the Data Sources step ----------------------
    await test("pipeline: each historical file is the deciding administrator's continue_source_preparation; every ineligible file and every other actor keeps its actual state", async () => {
      await adminPage.goto("/impact-library");
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(pipeline.status, 200, JSON.stringify(pipeline.body));
      for (const key of ["hist1", "hist2", "hist3"]) assert.deepEqual(currentOf(fileOf(pipeline, FILE[key])), CONTINUE, key);
      for (const key of ["cand1", "cand2"]) assert.deepEqual(currentOf(fileOf(pipeline, FILE[key])), PROMOTE_READY, key);
      for (const key of ["otherAdmin", "reviewedNotAllowed", "profileNotAllowed"]) assert.deepEqual(currentOf(fileOf(pipeline, FILE[key])), MISSING, key);
      assert.equal(fileOf(pipeline, FILE.needsMore).currentStage, "sensitivity_review");
      assert.deepEqual(currentOf(fileOf(pipeline, FILE.policyFailed)).slice(0, 3), ["security_check", "failed", "get_kinder"]);
      // The other administrator: only the file whose current decision is theirs.
      await admin2Page.goto("/impact-library");
      const pipeline2 = await admin2Page.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.deepEqual(currentOf(fileOf(pipeline2, FILE.otherAdmin)), CONTINUE);
      assert.deepEqual(currentOf(fileOf(pipeline2, FILE.hist1)), MISSING);
      // Other client roles are never offered it.
      for (const [label, page] of [["client_contributor", contributorPage], ["client_reviewer", reviewerPage], ["stored client_admin", storedAdminPage]]) {
        await page.goto("/impact-library");
        const other = await page.api("GET", pipelinePath(ORG_X, PROJECT_X));
        assert.equal(other.status, 200, `${label}: ${JSON.stringify(other.body)}`);
        assert.equal(fileOf(other, FILE.hist1).nextAction, "contact_get_kinder", label);
        assert.ok(!other.body.data.files.some((file) => file.nextAction === "continue_source_preparation"), label);
      }
      results.pipeline_before = "PASS: hist1-3 continue_source_preparation for the decider only; cand1-2 promote_source; refusal shapes unchanged";
    });

    await test("Data Sources > Source preparation offers Continue source preparation only on the eligible reviewed files", async () => {
      await adminPage.waitForText("Knowledge Studio");
      await adminPage.clickNav("Knowledge Studio");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await adminPage.idle();
      await adminPage.clickTab("Data Sources");
      await adminPage.selectProject(PROJECT_X);
      await adminPage.idle();
      await adminPage.waitFor(() => has(adminPage, `[data-client-continue-source-preparation="${FILE.hist1}"]`), "continue offered");
      for (const key of ["hist1", "hist2", "hist3"]) {
        assert.equal(await has(adminPage, `[data-client-continue-source-preparation="${FILE[key]}"]`), true, key);
        assert.equal(await has(adminPage, `[data-client-open-source-review="${FILE[key]}"]`), false, key);
      }
      for (const key of ["cand1", "cand2"]) {
        assert.equal(await has(adminPage, `[data-client-open-source-review="${FILE[key]}"]`), true, key);
        assert.equal(await has(adminPage, `[data-client-continue-source-preparation="${FILE[key]}"]`), false, key);
      }
      for (const key of ["otherAdmin", "reviewedNotAllowed", "profileNotAllowed", "needsMore", "policyFailed"]) {
        assert.equal(await has(adminPage, `[data-client-continue-source-preparation="${FILE[key]}"]`), false, key);
        assert.equal(await has(adminPage, `[data-client-open-source-review="${FILE[key]}"]`), false, key);
      }
      const text = await adminPage.text();
      assert.ok(text.includes("Continue source preparation in Data Sources to create it; your review is not changed."));
      assert.ok(text.includes("Contact Get Kinder. The sensitivity review is recorded, but no source candidate was created"), "the actual blocker stays visible");
      results.ui_offer = "PASS";
    });

    // --- refusals: nothing is written ----------------------------------------
    await test("refusals: ineligible files, other roles, revoked authority, other Projects and organizations, and a non-empty body write nothing", async () => {
      const beforeX = await counts(ORG_X);
      const beforeY = await counts(ORG_Y);
      for (const [key, status, reason] of [
        ["otherAdmin", 403, "sensitivity_decision_recorded_by_another_reviewer"],
        ["reviewedNotAllowed", 422, "allowed_use_not_allowed"],
        ["profileNotAllowed", 422, "allowed_use_not_allowed"],
        ["needsMore", 422, "sensitivity_review_not_complete"],
        ["policyFailed", 422, "file_policy_not_passed"],
      ]) {
        const refused = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE[key]), {});
        assert.deepEqual([refused.status, refused.body.blockers?.[0]?.blocking_reason, refused.body.blockers?.[0]?.validator_key],
          [status, reason, "VAL-KAI-P1-07-002"], `${key}: ${JSON.stringify(refused.body)}`);
      }
      for (const [label, page] of [["client_contributor", contributorPage], ["client_reviewer", reviewerPage], ["stored client_admin", storedAdminPage]]) {
        const refused = await page.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.hist3), {});
        assert.deepEqual([refused.status, refused.body.error.code, refused.body.blockers?.[0]?.blocking_reason], [403, "authorization_denied", "role_not_allowed"], label);
      }
      for (const [label, revoke, restore] of [
        ["deactivated GK administrator membership",
          "UPDATE public.user_org_memberships SET is_active = false WHERE org_id = $1 AND user_id = $2",
          "UPDATE public.user_org_memberships SET is_active = true WHERE org_id = $1 AND user_id = $2"],
        ["inactive binding",
          "UPDATE kai.gk_organization_bindings SET status = 'inactive' WHERE gk_organization_id = $1 AND $2::int IS NOT NULL",
          "UPDATE kai.gk_organization_bindings SET status = 'active' WHERE gk_organization_id = $1 AND $2::int IS NOT NULL"],
      ]) {
        await query(revoke, [gkOrganizations[ORG_X], USERS.adminX]);
        try {
          const refused = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.hist3), {});
          assert.deepEqual([refused.status, refused.body.error.code, refused.body.blockers?.[0]?.blocking_reason],
            [403, "authorization_denied", "missing_active_organization_membership"], label);
          const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
          assert.notEqual(pipeline.status === 200 && fileOf(pipeline, FILE.hist3).nextAction, "continue_source_preparation", `${label}: no offer`);
        } finally {
          await query(restore, [gkOrganizations[ORG_X], USERS.adminX]);
        }
      }
      await adminYPage.goto("/impact-library");
      for (const [label, page, organizationId, engagementId, intakeFileId, status] of [
        ["another Project of the same organization", adminPage, ORG_X, PROJECT_X2, FILE.hist3, 404],
        ["X admin, Y file under X", adminPage, ORG_X, PROJECT_Y, FILE.y, 404],
        ["X admin naming Y", adminPage, ORG_Y, PROJECT_Y, FILE.y, 403],
        ["Y admin naming X", adminYPage, ORG_X, PROJECT_X, FILE.hist3, 403],
        ["Y admin, X file under Y", adminYPage, ORG_Y, PROJECT_Y, FILE.hist3, 404],
      ]) {
        const refused = await page.api("POST", continuationPath(organizationId, engagementId, intakeFileId), {});
        assert.equal(refused.status, status, `${label}: ${JSON.stringify(refused.body)}`);
      }
      for (const body of [{ decided_by: ids.adminX }, { decision: "reviewed" }]) {
        const refused = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.hist3), body);
        assert.deepEqual([refused.status, refused.body.blockers?.[0]?.blocking_reason], [422, "unknown_field"]);
      }
      assert.deepEqual(delta(await counts(ORG_X), beforeX), ZERO, "no write in X");
      assert.deepEqual(delta(await counts(ORG_Y), beforeY), ZERO, "no write in Y");
      assert.deepEqual(await candidateOf(ORG_X, ids.profile.otherAdmin), []);
      results.refusals = "PASS: other reviewer 403; reviewed/P1-05 not_allowed 422; needs_more_information 422; failed policy 422; contributor/reviewer/stored admin 403 role_not_allowed; revoked membership/binding 403; other Project 404; cross-organization 403/404; body 422; zero writes";
    });

    // --- continuation -> candidate -> promotion -> source -> evidence -------
    await test("CONTINUE (UI): one POST creates one valid candidate from the authoritative decision, as the administrator, without a new decision; Review & promote source appears", async () => {
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-continue-source-preparation="${FILE.hist1}"]`, "Continue source preparation");
      await adminPage.waitForText("Source preparation continued: the source candidate was created from your recorded sensitivity review.");
      await adminPage.waitFor(() => has(adminPage, `[data-client-open-source-review="${FILE.hist1}"]`), "Review & promote source offered");
      await adminPage.idle();
      assert.deepEqual(postsSince(adminPage, mark), [[continuationPath(ORG_X, PROJECT_X, FILE.hist1).split("?")[0], 200]], "exactly the continuation route");
      assert.ok(adminPage.requestsSince(mark).some((r) => r.method === "GET" && pathOf(r).endsWith("/client-evidence-pipeline")), "the pipeline was re-read");
      assert.equal(await has(adminPage, `[data-client-continue-source-preparation="${FILE.hist1}"]`), false);
      assert.deepEqual(delta(await counts(ORG_X), before), CONTINUED);
      const [candidate] = await candidateOf(ORG_X, ids.profile.hist1);
      assert.deepEqual(
        [candidate.candidate_status, candidate.created_by, candidate.created_by_type, candidate.queue_status, candidate.review_status, candidate.queue_created_by],
        ["needs_gk_review", ids.adminX, "human", "open", "needs_gk_review", ids.adminX]);
      ids.candidate.hist1 = candidate.intake_source_candidate_id;
      const decisions = await decisionsOf(ORG_X, ids.profile.hist1);
      assert.equal(decisions.length, 2, "no sensitivity decision recorded");
      assert.equal(decisions.find((d) => d.is_head).decision_id, ids.hist1Head, "the head is unchanged");
      const audits = await query(
        `SELECT action::text AS action, actor_type::text, actor_user_id::text FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text = 'intake_source_candidate_persisted'`, [ORG_X]);
      assert.deepEqual(audits.filter((a) => a.actor_user_id === ids.adminX).length, 3, "cand1, cand2, and this continuation");
      const [lifecycle] = await query(
        "SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid AND operation = 'intake_source_candidate_persisted'",
        [ORG_X, FILE.hist1]);
      assert.equal(lifecycle.n, 1);
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.deepEqual(currentOf(fileOf(pipeline, FILE.hist1)), PROMOTE_READY);
      results.continue = "PASS: 1 POST -> 1 needs_gk_review candidate + 1 open review item by the administrator, audited; decisions unchanged (2, same head); pipeline promote_source";
    });

    await test("PROMOTE: the existing P1-08 step promotes the recovered candidate; source, current source_version, and P2-01 evidence follow", async () => {
      const before = await counts(ORG_X);
      await promoteThroughPanel(FILE.hist1, ids.candidate.hist1);
      const { lifecycle_audit: _lifecycle, ...promotedDelta } = delta(await counts(ORG_X), before);
      const { lifecycle_audit: _zero, ...zeroWithoutLifecycle } = ZERO;
      assert.deepEqual(promotedDelta, { ...zeroWithoutLifecycle, promotions: 1, sources: 1, source_versions: 1, evidence: 2, audit_events: 2 });
      const [version] = await query(
        `SELECT v.source_version_id::text, v.is_current, v.created_by::text, d.decision_status, d.created_by::text AS decided_by
           FROM kai.source_versions v JOIN kai.intake_promotion_decisions d ON d.organization_id = v.organization_id AND d.source_version_id = v.source_version_id
          WHERE v.organization_id = $1::uuid AND v.intake_source_candidate_id = $2::uuid`, [ORG_X, ids.candidate.hist1]);
      assert.deepEqual([version.is_current, version.created_by, version.decision_status, version.decided_by], [true, ids.adminX, "promoted", ids.adminX]);
      ids.hist1SourceVersionId = version.source_version_id;
      ids.hist1Evidence = await query(
        `SELECT evidence_item_id::text, evidence_review_status FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid ORDER BY statement`,
        [ORG_X, version.source_version_id]);
      assert.equal(ids.hist1Evidence.length, 2);
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      const file = fileOf(pipeline, FILE.hist1);
      assert.equal(file.currentStage, "evidence_review");
      assert.equal(file.evidenceItemCount, 2);
      const lifecycle = await query(
        "SELECT operation FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid ORDER BY created_at, operation", [ORG_X, FILE.hist1]);
      results.promote = `PASS: promoted by the administrator; 1 source, 1 current source_version, 2 evidence (needs_gk_review); file lifecycle ${lifecycle.map((row) => row.operation).join(" > ")}`;
    });

    // --- idempotency -----------------------------------------------------------
    await test("IDEMPOTENT: a repeat, three concurrent requests, and a later repeat create one candidate, one review item, one audit, and no promotion", async () => {
      // Repeat on the continued (and now promoted) file: reported, nothing written.
      let before = await counts(ORG_X);
      const repeat = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.hist1), {});
      assert.deepEqual([repeat.status, repeat.body.data.source_candidate_handoff.status, repeat.body.data.source_candidate_handoff.intake_source_candidate_id],
        [200, "existing", ids.candidate.hist1]);
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);

      before = await counts(ORG_X);
      const path = continuationPath(ORG_X, PROJECT_X, FILE.hist2);
      const concurrent = await adminPage.evaluate(`Promise.all([0, 1, 2].map(() => fetch(${JSON.stringify(path)}, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
      }).then(async (response) => ({ status: response.status, body: await response.json() }))))`);
      assert.deepEqual(concurrent.map((r) => r.status), [200, 200, 200], JSON.stringify(concurrent));
      const statuses = concurrent.map((r) => r.body.data.source_candidate_handoff.status).sort();
      assert.equal(statuses.filter((s) => s === "created").length, 1, JSON.stringify(statuses));
      assert.ok(statuses.every((s) => ["created", "replayed", "existing"].includes(s)), JSON.stringify(statuses));
      assert.equal(new Set(concurrent.map((r) => r.body.data.source_candidate_handoff.intake_source_candidate_id)).size, 1, "one candidate id");
      assert.deepEqual(delta(await counts(ORG_X), before), CONTINUED);
      const [candidate] = await candidateOf(ORG_X, ids.profile.hist2);
      ids.candidate.hist2 = candidate.intake_source_candidate_id;
      before = await counts(ORG_X);
      const later = await adminPage.api("POST", path, {});
      assert.deepEqual([later.status, later.body.data.source_candidate_handoff.status], [200, "existing"]);
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      assert.equal((await counts(ORG_X)).promotions, 1, "nothing promoted automatically");
      results.idempotent = `PASS: repeat existing; concurrent [${statuses.join(", ")}] -> 1 candidate/1 item/1 audit; later repeat existing; 0 extra promotions`;
    });

    await test("EXISTING CANDIDATES: no duplicate, no recreation, no automatic promotion; the existing P1-08 action stays usable", async () => {
      const before = await counts(ORG_X);
      for (const key of ["cand1", "cand2"]) {
        const response = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE[key]), {});
        assert.deepEqual([response.status, response.body.data.source_candidate_handoff.status, response.body.data.source_candidate_handoff.intake_source_candidate_id],
          [200, "existing", ids.candidate[key]], key);
      }
      assert.deepEqual(delta(await counts(ORG_X), before), ZERO);
      await adminPage.waitFor(() => has(adminPage, `[data-client-open-source-review="${FILE.cand1}"]`), "cand1 promote offered");
      await promoteThroughPanel(FILE.cand1, ids.candidate.cand1);
      const [cand2] = await candidateOf(ORG_X, ids.profile.cand2);
      assert.deepEqual([cand2.candidate_status, cand2.queue_status], ["needs_gk_review", "open"], "cand2 untouched");
      assert.deepEqual(await query("SELECT count(*)::int AS n FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid", [ORG_X, ids.candidate.cand2]), [{ n: 0 }]);
      for (const key of ["cand1", "cand2"]) assert.equal((await candidateOf(ORG_X, ids.profile[key])).length, 1, key);
      results.existing = "PASS: cand1/cand2 continuation 'existing' zero-write; cand1 promoted through the existing step; cand2 still open with no decision";
    });

    await test("all three historical files recover: hist3 through the UI; the other administrator continues their own file", async () => {
      await adminPage.waitFor(() => has(adminPage, `[data-client-continue-source-preparation="${FILE.hist3}"]`), "hist3 continue offered");
      const before = await counts(ORG_X);
      await adminPage.clickIn(`[data-client-continue-source-preparation="${FILE.hist3}"]`, "Continue source preparation hist3");
      await adminPage.waitFor(() => has(adminPage, `[data-client-open-source-review="${FILE.hist3}"]`), "hist3 promote offered");
      await adminPage.idle();
      assert.deepEqual(delta(await counts(ORG_X), before), CONTINUED);
      const own = await admin2Page.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.otherAdmin), {});
      assert.deepEqual([own.status, own.body.data.source_candidate_handoff.status], [200, "created"]);
      const [candidate] = await candidateOf(ORG_X, ids.profile.otherAdmin);
      assert.equal(candidate.created_by, ids.adminX2);
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      for (const key of ["hist2", "hist3", "otherAdmin", "cand2"]) assert.deepEqual(currentOf(fileOf(pipeline, FILE[key])), PROMOTE_READY, key);
      for (const key of ["reviewedNotAllowed", "profileNotAllowed"]) assert.deepEqual(currentOf(fileOf(pipeline, FILE[key])), MISSING, key);
      assert.deepEqual(adminPage.exceptions, []);
      results.all_recovered = "PASS: hist1-3 each have one candidate; the other administrator's own file continued by them";
    });

    // --- downstream internal drafting from the recovered source ---------------
    await test("DOWNSTREAM: the recovered source's evidence -> P2-03 claim -> P2-04 gap follow-ups -> both internal drafts, unchanged generators, no GK action", async () => {
      const auditMark = (await query("SELECT coalesce(max(audit_event_id), 0)::bigint AS id FROM kai.audit_events"))[0].id;
      const [evidence] = ids.hist1Evidence;
      await adminPage.waitFor(() => has(adminPage, `[data-client-evidence="${evidence.evidence_item_id}"] button`), "evidence listed");
      let mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-evidence="${evidence.evidence_item_id}"] button`, "Propose claim");
      await adminPage.waitFor(async () => (await adminPage.evaluate(`document.querySelector('[data-client-evidence="${evidence.evidence_item_id}"]').innerText`)).includes("Claim proposed"), "claim proposed");
      await adminPage.idle();
      assert.deepEqual(postsSince(adminPage, mark), [[claimProposalPath(ORG_X, evidence.evidence_item_id), 200]]);
      const [claim] = await query(
        `SELECT c.claim_id::text, c.claim_review_status, c.internal_only, c.funder_use_allowed, c.public_use_allowed, v.intake_source_candidate_id::text
           FROM kai.claims c JOIN kai.evidence_items e ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
           JOIN kai.source_versions v ON v.organization_id = e.organization_id AND v.source_version_id = e.source_version_id
          WHERE c.organization_id = $1::uuid AND c.evidence_item_id = $2::uuid`, [ORG_X, evidence.evidence_item_id]);
      assert.deepEqual([claim.claim_review_status, claim.internal_only, claim.funder_use_allowed, claim.public_use_allowed, claim.intake_source_candidate_id],
        ["needs_gk_review", true, false, false, ids.candidate.hist1], "lineage: the recovered candidate");
      results.pipeline_status_after_claim_before_p2_04 = (await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X))).status;

      await adminPage.waitFor(() => has(adminPage, `[data-client-claim-gap-followups="${claim.claim_id}"]`), "gap follow-ups offered");
      mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-claim-gap-followups="${claim.claim_id}"]`, "Generate gap follow-ups");
      await adminPage.waitForText("Gap follow-ups generated:");
      await adminPage.idle();
      const p204 = postsSince(adminPage, mark);
      assert.equal(p204.length, 1);
      assert.equal(p204[0][0], claimGapFollowupsPath(ORG_X, claim.claim_id));
      assert.ok([200, 201].includes(p204[0][1]), JSON.stringify(p204));

      await adminPage.clickIn(`[data-client-claim="${claim.claim_id}"] input`, "Use in an internal draft");
      await adminPage.waitFor(async () => !(await adminPage.text()).includes("Select at least one claim below to draft from."), "draft readiness");
      const before = await counts(ORG_X);
      mark = adminPage.mark();
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created: 1 block(s) citing 1 claim(s).");
      await adminPage.idle();
      await adminPage.clickButton("Generate internal impact narrative");
      await adminPage.waitForText("Internal impact narrative created: 1 block(s) citing 1 claim(s).");
      await adminPage.idle();
      assert.deepEqual(postsSince(adminPage, mark), [[createEvidenceSummaryPath(ORG_X), 201], [createImpactNarrativePath(ORG_X), 201]]);
      assert.equal(delta(await counts(ORG_X), before).drafts, 2);
      assert.deepEqual(modelCalls.map((call) => call.claimIds), [[claim.claim_id], [claim.claim_id]]);
      const drafts = await query(
        `SELECT content_type, requested_audience, draft_status, review_status FROM kai.generated_content_drafts WHERE organization_id = $1::uuid ORDER BY content_type`, [ORG_X]);
      assert.deepEqual(drafts.map((d) => [d.content_type, d.requested_audience, d.draft_status, d.review_status]),
        [["evidence_summary", "internal", "draft", "needs_gk_review"], ["impact_narrative", "internal", "draft", "needs_gk_review"]]);
      const citations = await query("SELECT DISTINCT claim_id::text, evidence_item_id::text FROM kai.generated_content_citations WHERE organization_id = $1::uuid", [ORG_X]);
      assert.deepEqual(citations, [{ claim_id: claim.claim_id, evidence_item_id: evidence.evidence_item_id }]);
      const actors = await query("SELECT DISTINCT actor_user_id::text FROM kai.audit_events WHERE audit_event_id > $1 AND organization_id = $2::uuid AND actor_type::text = 'human'", [auditMark, ORG_X]);
      assert.deepEqual(actors.map((row) => row.actor_user_id), [ids.adminX], "only the administrator acted");
      const humans = await query("SELECT DISTINCT actor_user_id::text FROM kai.audit_events WHERE organization_id = $1::uuid AND actor_type::text = 'human' ORDER BY 1", [ORG_X]);
      assert.deepEqual(humans.map((row) => row.actor_user_id).sort(), [ids.adminX, ids.adminX2].sort(), "no Get Kinder human in organization X");
      results.pipeline_status_after_drafts = (await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X))).status;
      const capabilities = await adminPage.api("GET", organizationAccessCapabilitiesPath(ORG_X));
      assert.equal(capabilities.body.data.workflowOperations.readGeneratedDrafts, false, "generated-draft reads unchanged");
      results.downstream = `PASS: recovered source -> claim (needs_gk_review, internal) -> P2-04 ${p204[0][1]} -> evidence summary 201 + impact narrative 201 citing it; only the administrator acted`;
    });

    await test("the decision seam and the continuation agree: a reviewed not_allowed decision on a new file is recorded but creates no candidate (VAL-KAI-B1A-02-003)", async () => {
      const intakeFileId = "2b000000-0000-4000-8000-0000000000e9";
      const profileId = await seedProfiledFile({ organizationId: ORG_X, engagementId: PROJECT_X, batchId: BATCH_X, intakeFileId, name: "harbourline-observed.csv", checksumChar: "f" });
      const [handoff] = await recordDecisions({ organizationId: ORG_X, profileId, actorContext: await actorOf(USERS.adminX), outcomes: ["reviewed"], p1_07: null,
        snapshot: { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed" } });
      assert.deepEqual([handoff.status, handoff.error_code], ["not_created", "validation_blocker"]);
      assert.deepEqual(await candidateOf(ORG_X, profileId), []);
      const refusedContinuation = await adminPage.api("POST", continuationPath(ORG_X, PROJECT_X, FILE.reviewedNotAllowed), {});
      assert.equal(refusedContinuation.body.blockers?.[0]?.blocking_reason, "allowed_use_not_allowed");
      results.decision_seam_reviewed_not_allowed = "PASS: decision recorded, handoff not_created validation_blocker, 0 candidates; continuation 422 allowed_use_not_allowed";
    });

    console.log(`[client-admin-source-preparation-continuation-browser] results ${JSON.stringify(results)}`);
  } finally {
    for (const page of [adminPage, admin2Page, adminYPage, contributorPage, reviewerPage, storedAdminPage]) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
