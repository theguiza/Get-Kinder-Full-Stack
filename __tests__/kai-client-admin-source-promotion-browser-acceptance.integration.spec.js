import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assembled acceptance of client-admin source preparation (owner decision
 * 2026-10-18): profile ready -> P1-06 pending review item (the P1 worker's
 * system handoff) -> the binding-derived, non-superuser client_admin's
 * sensitivity decision -> P1-07 source candidate -> the same administrator's
 * P1-08 promotion -> source / source_version -> P2-01 evidence, with no Get
 * Kinder human anywhere in organization X. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-client-admin-source-promotion-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, transaction, and
 * production metadata-only audit (kai.audit_events and
 * kai.upload_lifecycle_audit) on the runner cluster; the P1 worker runtime's
 * processKaiP1IntakeFile and its P1-06 handoff; resolveKaiActorContext with
 * the real GK organization binding and first-request JIT kai.users mapping;
 * the built frontend bundle in a real headless Chrome. The sensitivity
 * decision and the promotion are made through the client Knowledge Studio UI
 * (Data Sources > Source preparation) and the real routes.
 * Simulated / substituted (reported as such, never as pipeline proof):
 * - the Get Kinder session login (req.user from a harness cookie);
 * - WORKER SIMULATION: the P1-03..P1-05 rows of each synthetic file (upload,
 *   malware scan, parsing, profiling, dictionary, and sensitivity
 *   classification are NOT executed), seeded as the worker's output; inside
 *   processKaiP1IntakeFile the P1-03 activation is a stub reporting that
 *   completed run and the P1-04/P1-05 recovery claims report those seeded
 *   rows as already succeeded, so only the runtime's real P1-06 handoff runs;
 * The P1-05 table's CHECK constraints make a non-fail-closed profile
 * impossible (proven directly); prohibited permission grants are therefore
 * exercised at the sensitivity decision, the only place they can be asked.
 * No model call is made anywhere in this chain.
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

test("client_admin source promotion browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("client_admin source promotion browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-client-admin-source-promotion");
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
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { processKaiP1IntakeFile } = await import("../Backend/kai/parsing/p1WorkerRuntime.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const {
    evidenceExtractionPath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    organizationAccessCapabilitiesPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  const ORG_X = "0d000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0d000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7d000000-0000-4000-8000-0000000000e1";
  const PROJECT_X2 = "7d000000-0000-4000-8000-0000000000e3";
  const PROJECT_Y = "7d000000-0000-4000-8000-0000000000e2";
  const BATCH_X = "1d000000-0000-4000-8000-0000000000e1";
  const BATCH_Y = "1d000000-0000-4000-8000-0000000000e2";
  const FILE = Object.freeze({
    main: "2d000000-0000-4000-8000-0000000000e1",
    allowedUse: "2d000000-0000-4000-8000-0000000000e4",
    policyBlocked: "2d000000-0000-4000-8000-0000000000e5",
    y: "2d000000-0000-4000-8000-0000000000e2",
  });
  const NAMES = Object.freeze({
    main: "harbourline-households.csv",
    allowedUse: "harbourline-partner-records.csv",
    policyBlocked: "harbourline-blocked.csv",
    y: "larchmont-households.csv",
  });
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ adminX: 991, adminY: 992, contributor: 993, clientReviewer: 994, storedAdmin: 995 });
  const COCKPIT = "/api/kai/sprint2/intake/admin/review-cockpit";
  const lookupPath = (organizationId, engagementId, intakeFileId) =>
    `${COCKPIT}/intake-files/${intakeFileId}/source-candidate?organization_id=${organizationId}&engagement_id=${engagementId}`;
  const detailPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}?organization_id=${organizationId}`;
  const decisionPath = (organizationId, candidateId) => `${COCKPIT}/source-candidates/${candidateId}/decision?organization_id=${organizationId}`;
  const sensitivityDecisionPath = (organizationId, profileId) => `${COCKPIT}/sensitivity-profiles/${profileId}/decision?organization_id=${organizationId}`;
  const pipelinePath = (organizationId, engagementId) =>
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementId}/client-evidence-pipeline`;
  const PROMOTE = { outcome: "promoted", reviewed_source_type: "organization_primary_record" };

  // --- organizations, projects, GK bindings, users (authorized setup) ------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Source Society", "harbourline-source"], [ORG_Y, "Larchmont Source Society", "larchmont-source"]]) {
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
  // Each organization's administrator: an active Get Kinder organization-admin
  // membership in a GK organization bound to that KAI organization. No
  // kai.users row (the first request maps it), no stored membership, no
  // global role. No Get Kinder staff user exists in either organization.
  const gkOrganizations = {};
  for (const [organizationId, name, adminUser] of [[ORG_X, "Harbourline Source Society", USERS.adminX], [ORG_Y, "Larchmont Source Society", USERS.adminY]]) {
    const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [name]);
    await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, organizationId]);
    await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, adminUser]);
    gkOrganizations[organizationId] = gkOrganization.id;
  }
  const storedMembers = {};
  for (const [legacyId, roleName] of [[USERS.contributor, "client_contributor"], [USERS.clientReviewer, "client_reviewer"], [USERS.storedAdmin, "client_admin"]]) {
    const user = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')", [ORG_X, user.user_id, roleName]);
    storedMembers[roleName] = user.user_id;
  }

  /**
   * WORKER SIMULATION: the P1-03..P1-05 rows of one confirmed, policy-passed
   * Project file, as the P1 worker writes them (upload, scan, parsing, and
   * profiling are not executed). `sensitivity` overrides the P1-05 row.
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
    return {
      checksum,
      fileProfileId: fileProfile.file_profile_id,
      dataDictionaryId: dictionary.data_dictionary_id,
      intakeSensitivityProfileId: sensitivityProfile.intake_sensitivity_profile_id,
    };
  }

  /**
   * The real P1 worker file operation for one seeded file. WORKER SIMULATION
   * inside it: the P1-03 activation reports the seeded completed run, and the
   * P1-04/P1-05 recovery claims report the seeded rows as already succeeded,
   * so neither stage re-runs. The P1-06 handoff, its repository, and its
   * production audit are real.
   */
  async function runWorker(organizationId, intakeFileId, seeded) {
    return processKaiP1IntakeFile({ organizationId, intakeFileId }, {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true" },
      activateParserProfileWorkForIntakeFile: async () => ({
        ok: true,
        data: { run: { run: { parser_status: "completed", output_profile_id: seeded.fileProfileId, checksum: seeded.checksum } } },
        error: null,
      }),
      p1DownstreamRecoveryRepository: {
        async claimDownstreamAttempt({ identity }) {
          return {
            ok: true,
            data: {
              decision: "already_succeeded",
              outputId: identity.stage === "p1_04_data_dictionary" ? seeded.dataDictionaryId : seeded.intakeSensitivityProfileId,
            },
          };
        },
        async completeDownstreamAttempt() { throw new Error("a reconciled stage is never acknowledged"); },
      },
      createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: false }) }),
    });
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
    return query(
      `SELECT review_queue_item_id::text, queue_status, created_by::text, created_by_type, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid`,
      [organizationId, profileId],
    );
  }

  async function counts(organizationId) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review')::int AS sensitivity_items,
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid)::int AS sensitivity_decisions,
      (SELECT count(*) FROM kai.intake_source_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid)::int AS promotions,
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.source_versions WHERE organization_id = $1::uuid)::int AS source_versions,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = $1::uuid)::int AS audit_events`, [organizationId]);
    return row;
  }
  const delta = (after, before) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
  const ZERO = Object.freeze({ sensitivity_items: 0, sensitivity_decisions: 0, candidates: 0, promotions: 0, sources: 0, source_versions: 0, evidence: 0, claims: 0, evidence_decisions: 0, audit_events: 0 });

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
  const adminYPage = await openPage(browser, { baseUrl, legacyUserId: USERS.adminY });
  const contributorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.contributor });
  const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const storedAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.storedAdmin });
  const results = {};
  const ids = { seeded: {} };
  const pathOf = (request) => new URL(request.url).pathname;
  const fileOf = (pipeline, intakeFileId) => pipeline.body.data.files.find((file) => file.intakeFileId === intakeFileId);
  const currentOf = (file) => [file.currentStage, file.currentStatus, file.responsibleParty, file.nextAction, file.reason];
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

  try {
    // --- P1-05 -> P1-06: the worker's system handoff ------------------------
    await test("P1-06: after profiling, the worker's handoff creates each eligible profile's pending sensitivity review item as the system - no human, no GK setup", async () => {
      ids.seeded.main = await seedProfiledFile({ organizationId: ORG_X, engagementId: PROJECT_X, batchId: BATCH_X, intakeFileId: FILE.main, name: NAMES.main, checksumChar: "a" });
      // WORKER SIMULATION: a P1-05 output whose committed allowed-use fact is not_allowed.
      ids.seeded.allowedUse = await seedProfiledFile({
        organizationId: ORG_X, engagementId: PROJECT_X, batchId: BATCH_X, intakeFileId: FILE.allowedUse, name: NAMES.allowedUse, checksumChar: "c",
        sensitivity: { allowed_use_status: "not_allowed" },
      });
      ids.seeded.y = await seedProfiledFile({ organizationId: ORG_Y, engagementId: PROJECT_Y, batchId: BATCH_Y, intakeFileId: FILE.y, name: NAMES.y, checksumChar: "b" });
      const beforeX = await counts(ORG_X);
      for (const [organizationId, key, intakeFileId] of [[ORG_X, "main", FILE.main], [ORG_X, "allowedUse", FILE.allowedUse], [ORG_Y, "y", FILE.y]]) {
        const processed = await runWorker(organizationId, intakeFileId, ids.seeded[key]);
        assert.equal(processed.ok, true, JSON.stringify(processed));
        assert.equal(processed.data.stoppedAt, undefined, JSON.stringify(processed.data));
        assert.equal(processed.data.sensitivityReviewWork.ok, true, JSON.stringify(processed.data));
        assert.equal(processed.data.sensitivityReviewWork.replayed, false);
        const [item] = await sensitivityQueue(organizationId, ids.seeded[key].intakeSensitivityProfileId);
        assert.deepEqual([item.queue_status, item.created_by, item.created_by_type], ["open", null, "system"], key);
        assert.equal(item.review_queue_item_id, processed.data.sensitivityReviewWork.reviewQueueItemId);
      }
      // The required audit, attributed to the system.
      const audits = await query(
        `SELECT actor_type, actor_user_id::text FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text = 'sensitivity_review_queue_item_created'`, [ORG_X]);
      assert.deepEqual(audits, [{ actor_type: "system", actor_user_id: null }, { actor_type: "system", actor_user_id: null }]);
      const lifecycle = await query(
        "SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'sensitivity_review_queue_item_created'", [ORG_X]);
      assert.equal(lifecycle[0].n, 2);
      assert.deepEqual(delta(await counts(ORG_X), beforeX), { ...ZERO, sensitivity_items: 2, audit_events: 2 }, "only the pending items and their audit");
      // A re-run of the worker operation replays the idempotent handoff.
      const replay = await runWorker(ORG_X, FILE.main, ids.seeded.main);
      assert.deepEqual([replay.data.sensitivityReviewWork.ok, replay.data.sensitivityReviewWork.replayed], [true, true]);
      assert.equal((await sensitivityQueue(ORG_X, ids.seeded.main.intakeSensitivityProfileId)).length, 1);
      results.p1_06 = "PASS: worker system handoff created 3 open items (created_by NULL, system), audited; replay wrote nothing";
    });

    await test("P1-05 schema: a sensitivity profile that is not fail-closed cannot exist, so P1-06/P1-07/P1-08 only ever see the restricted posture", async () => {
      const client = await seedPool.connect();
      try {
        await client.query("BEGIN");
        for (const [label, overrides] of [
          ["human review not required", "false, false, false, false, false"],
          ["LLM processing allowed", "true, true, false, false, false"],
          ["public use allowed", "true, false, false, true, false"],
        ]) {
          await client.query("SAVEPOINT attempt");
          await assert.rejects(
            client.query(
              `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256,
                 human_review_required, llm_processing_allowed, product_learning_allowed, public_use_allowed, funder_use_allowed)
               SELECT organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, ${overrides}
                 FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
              [ids.seeded.main.intakeSensitivityProfileId],
            ),
            (error) => error.code === "23514",
            label,
          );
          await client.query("ROLLBACK TO SAVEPOINT attempt");
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      results.p1_05_schema = "PASS: CHECK constraints refuse non-fail-closed P1-05 rows (23514)";
    });

    // --- the client_admin's Knowledge Studio ----------------------------------
    await test("UI 1: the binding-derived client_admin sees Source preparation in Data Sources; capabilities match server authority; the pipeline is accurate before any decision", async () => {
      await adminPage.goto("/impact-library");
      await adminPage.waitForText("Knowledge Studio");
      await adminPage.clickNav("Knowledge Studio");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await adminPage.idle();
      const [mapped] = await query("SELECT user_id::text, status FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.adminX]);
      assert.equal(mapped.status, "active", "JIT mapping on first request");
      ids.adminX = mapped.user_id;
      assert.deepEqual(await query("SELECT role_id FROM kai.user_roles WHERE user_id = $1::uuid", [mapped.user_id]), [], "no global role");
      assert.deepEqual(await query("SELECT organization_id FROM kai.organization_memberships WHERE user_id = $1::uuid", [mapped.user_id]), [], "no stored membership");

      const capabilities = await adminPage.api("GET", organizationAccessCapabilitiesPath(ORG_X));
      assert.equal(capabilities.status, 200);
      const operations = capabilities.body.data.workflowOperations;
      assert.deepEqual(
        [operations.reviewSensitivity, operations.promoteSource, operations.extractEvidence, operations.readGeneratedDrafts,
          operations.recordEvidenceReview, operations.recordClaimReview, operations.reviewGeneratedDrafts, capabilities.body.data.internalKnowledgeWorkspace],
        [true, true, true, false, false, false, false, false],
      );
      const cockpit = await adminPage.api("GET", `${COCKPIT}/capabilities?organization_id=${ORG_X}`);
      assert.deepEqual(cockpit.body.data, { can_manage_sensitivity_review: true, can_review_source_candidates: false, can_promote_source_candidates: true });

      assert.ok((await adminPage.tabLabels()).includes("Data Sources"));
      await adminPage.clickTab("Data Sources");
      await adminPage.selectProject(PROJECT_X);
      await adminPage.idle();
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector('[data-client-preparation-file="${FILE.main}"]'))`), "main file listed");
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      // Owner decision 2026-10-19: the sensitivity review is the administrator's own step.
      assert.deepEqual(currentOf(fileOf(pipeline, FILE.main)),
        ["sensitivity_review", "waiting_for_client", "client", "review_sensitivity", "sensitivity_review_ready"]);
      const body = await adminPage.text();
      assert.ok(body.includes("Your action is needed: review this file's sensitivity & allowed use."), "actor-accurate guidance");
      assert.ok(!body.includes(NAMES.y), "no organization-Y file");
      results.ui1 = "PASS";
    });

    await test("P1-06 -> decision -> P1-07: the administrator reviews the worker-created item and records 'reviewed'; one candidate is created by the administrator", async () => {
      const profileId = ids.seeded.main.intakeSensitivityProfileId;
      const [workerItem] = await sensitivityQueue(ORG_X, profileId);
      const before = await counts(ORG_X);
      let mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-sensitivity-review="${FILE.main}"]`, "Review sensitivity & allowed use");
      await adminPage.waitFor(async () => (await adminPage.text()).includes("Submit review"), "decision form");
      await adminPage.idle();
      assert.equal(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").length, 0, "opening writes nothing");
      assert.ok(!(await adminPage.text()).includes("Start review work"), "the worker already created the review work");
      mark = adminPage.mark();
      await adminPage.clickButton("Submit review");
      await adminPage.waitForText("Sensitivity decision recorded.");
      await adminPage.waitForText("Source-candidate handoff completed");
      await adminPage.idle();
      const posts = adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);
      assert.deepEqual(posts, [[`${COCKPIT}/sensitivity-profiles/${profileId}/decision`, 200]], "exactly the existing decision route; no review-work POST");
      const [decision] = await query(
        "SELECT decision_outcome, decided_by::text, decided_by_role, created_by_type, review_queue_item_id::text FROM kai.intake_sensitivity_review_decisions WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG_X, profileId]);
      assert.deepEqual(decision, { decision_outcome: "reviewed", decided_by: ids.adminX, decided_by_role: "client_admin", created_by_type: "human", review_queue_item_id: workerItem.review_queue_item_id });
      const [candidate] = await query(
        "SELECT intake_source_candidate_id::text, candidate_status, created_by::text FROM kai.intake_source_candidates WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid",
        [ORG_X, profileId]);
      assert.deepEqual([candidate.candidate_status, candidate.created_by], ["needs_gk_review", ids.adminX]);
      ids.mainCandidate = candidate.intake_source_candidate_id;
      const [item] = await sensitivityQueue(ORG_X, profileId);
      assert.equal(item.queue_status, "resolved");
      const d = delta(await counts(ORG_X), before);
      assert.deepEqual({ ...d, audit_events: 0 }, { ...ZERO, sensitivity_decisions: 1, candidates: 1 }, JSON.stringify(d));
      const actors = await query(
        `SELECT DISTINCT actor_type, actor_user_id::text FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text IN ('sensitivity_review_decision_recorded', 'intake_source_candidate_persisted')`, [ORG_X]);
      assert.deepEqual(actors, [{ actor_type: "human", actor_user_id: ids.adminX }]);
      results.p1_07 = "PASS: decision client_admin on the system-created item; candidate created_by the administrator";
    });

    await test("pipeline before promotion: the eligible candidate is the administrator's own promotion step; other client roles still see a Get Kinder wait", async () => {
      await adminPage.waitFor(async () => adminPage.evaluate(`document.querySelector('[data-client-preparation-file="${FILE.main}"]')?.dataset.clientPreparationNext === "promote_source"`), "promotion step shown");
      const admin = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.deepEqual(currentOf(fileOf(admin, FILE.main)), ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"]);
      assert.equal(fileOf(admin, FILE.main).evidenceItemCount, 0);
      assert.ok(admin.body.data.summary.reasons.some((r) => r.reason === "source_promotion_ready" && r.fileCount === 1));
      const body = await adminPage.text();
      assert.ok(body.includes("Your action is needed: review this file's source candidate and promote it as a source in Data Sources."));
      assert.ok(body.includes("Review & promote source"));
      await contributorPage.goto("/impact-library");
      const contributor = await contributorPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(contributor.status, 200);
      // The organization has administrators: the contributor sees the promotion waiting on them (owner decision 2026-10-19).
      assert.deepEqual(currentOf(fileOf(contributor, FILE.main)),
        ["source_review", "waiting_for_client", "client", "ask_organization_administrator", "organization_administrator_action_ready"]);
      // A delegated (stored, active) client_admin holds the same authority (owner decision 2026-10-19).
      await storedAdminPage.goto("/impact-library");
      const stored = await storedAdminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.deepEqual(currentOf(fileOf(stored, FILE.main)), ["source_review", "waiting_for_client", "client", "promote_source", "source_promotion_ready"]);
      results.pipeline_before = "PASS: promote_source for the binding-derived and the stored administrator; the contributor waits on the organization's administrator";
    });

    await test("negatives before promotion: other roles, revoked authority, another Project, and another organization are refused; nothing is written", async () => {
      const before = await counts(ORG_X);
      const candidate = ids.mainCandidate;
      // The stored administrator may read the candidate it could promote; nothing is decided here.
      const storedCapabilities = await storedAdminPage.api("GET", organizationAccessCapabilitiesPath(ORG_X));
      assert.equal(storedCapabilities.body.data.workflowOperations.promoteSource, true);
      for (const path of [lookupPath(ORG_X, PROJECT_X, FILE.main), detailPath(ORG_X, candidate)]) {
        const read = await storedAdminPage.api("GET", path);
        assert.equal(read.status, 200, `stored client_admin GET ${path}: ${JSON.stringify(read.body)}`);
      }
      for (const [label, page] of [["client_contributor", contributorPage], ["client_reviewer", reviewerPage]]) {
        if (page !== contributorPage) await page.goto("/impact-library");
        const capabilities = await page.api("GET", organizationAccessCapabilitiesPath(ORG_X));
        assert.equal(capabilities.body.data.workflowOperations.promoteSource, false, label);
        for (const [method, path, body] of [["GET", lookupPath(ORG_X, PROJECT_X, FILE.main)], ["GET", detailPath(ORG_X, candidate)], ["POST", decisionPath(ORG_X, candidate), PROMOTE]]) {
          const refused = await page.api(method, path, body);
          assert.deepEqual([refused.status, refused.body.error.code, refused.body.blockers?.[0]?.blocking_reason], [403, "authorization_denied", "role_not_allowed"], `${label} ${method} ${path}`);
        }
      }
      // Another Project of the same organization: the file is not in it.
      const otherProject = await adminPage.api("GET", lookupPath(ORG_X, PROJECT_X2, FILE.main));
      assert.deepEqual([otherProject.status, otherProject.body.error.code], [404, "not_found"]);
      // Revoked Get Kinder administrator membership, then an inactive binding.
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
          for (const [method, path, body] of [["GET", detailPath(ORG_X, candidate)], ["POST", decisionPath(ORG_X, candidate), PROMOTE]]) {
            const refused = await adminPage.api(method, path, body);
            assert.deepEqual([refused.status, refused.body.error.code, refused.body.blockers?.[0]?.blocking_reason],
              [403, "authorization_denied", "missing_active_organization_membership"], `${label} ${method}`);
          }
        } finally {
          await query(restore, [gkOrganizations[ORG_X], USERS.adminX]);
        }
      }
      // Organization Y: its own administrator records its own decision through the real route.
      await adminYPage.goto("/impact-library");
      const profileY = ids.seeded.y.intakeSensitivityProfileId;
      const [itemY] = await sensitivityQueue(ORG_Y, profileY);
      const decidedY = await adminYPage.api("POST", sensitivityDecisionPath(ORG_Y, profileY), {
        expected_updated_at: new Date(itemY.updated_at).toISOString(), review_queue_item_id: itemY.review_queue_item_id, decision: "reviewed", reviewed_snapshot: REVIEWED_SNAPSHOT,
      });
      assert.equal(decidedY.status, 200, JSON.stringify(decidedY.body));
      assert.equal(decidedY.body.data.source_candidate_handoff.status, "created");
      ids.yCandidate = decidedY.body.data.source_candidate_handoff.intake_source_candidate_id;
      // X's administrator against Y, and Y's against X.
      for (const [label, page, organizationId, candidateId, status, code] of [
        ["X admin naming Y", adminPage, ORG_Y, ids.yCandidate, 403, "authorization_denied"],
        ["X admin, Y candidate under X", adminPage, ORG_X, ids.yCandidate, 404, "not_found"],
        ["Y admin naming X", adminYPage, ORG_X, candidate, 403, "authorization_denied"],
      ]) {
        const detail = await page.api("GET", detailPath(organizationId, candidateId));
        assert.deepEqual([detail.status, detail.body.error.code], [status, code], `${label} detail`);
        const decision = await page.api("POST", decisionPath(organizationId, candidateId), PROMOTE);
        assert.deepEqual([decision.status, decision.body.error.code], [status, code], `${label} decision`);
      }
      assert.deepEqual(await counts(ORG_X), before, "no write in X by any refusal");
      assert.equal((await counts(ORG_Y)).promotions, 0, "no promotion in Y");
      results.negatives = "PASS: stored client_admin may read (200); contributor/reviewer 403 role_not_allowed; revoked membership and inactive binding 403; other Project 404; cross-organization 403/404";
    });

    await test("P1-08 -> P2-01: the administrator promotes through Source preparation; source, source_version, and evidence follow, attributed to the administrator", async () => {
      const before = await counts(ORG_X);
      let mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-open-source-review="${FILE.main}"]`, "Review & promote source");
      await adminPage.waitForText("Decision outcome");
      await adminPage.idle();
      const reads = adminPage.requestsSince(mark).filter((r) => r.method === "GET" && pathOf(r).startsWith(COCKPIT)).map((r) => [pathOf(r), r.status]);
      // The candidate reads, plus the file's current sensitivity decision for the
      // source authorization's restrictions (owner decision 2026-10-19).
      assert.deepEqual(reads.map(([path]) => path.replace(/sensitivity-profiles\/[0-9a-f-]{36}$/, "sensitivity-profiles/:id")).sort(), [
        `${COCKPIT}/intake-files/${FILE.main}/sensitivity-profile`,
        `${COCKPIT}/intake-files/${FILE.main}/source-candidate`,
        `${COCKPIT}/sensitivity-profiles/:id`,
        `${COCKPIT}/source-candidates/${ids.mainCandidate}`,
      ].sort());
      assert.ok(reads.every(([, status]) => status === 200), JSON.stringify(reads));
      assert.equal(adminPage.requestsSince(mark).filter((r) => r.method !== "GET").length, 0, "opening writes nothing");
      const detail = await adminPage.api("GET", detailPath(ORG_X, ids.mainCandidate));
      assert.equal(detail.body.data.decision_controls_enabled, true);
      assert.deepEqual(detail.body.data.allowed_reviewed_source_types,
        ["organization_primary_record", "organization_secondary_record", "third_party_provided_record", "public_record"]);
      assert.ok(await setPanelSelect("Decision outcome", "promoted"), "outcome");
      await adminPage.waitForText("Reviewed source type");
      assert.ok(await setPanelSelect("Reviewed source type", "organization_primary_record"), "source type");
      // Without the explicit source authorization nothing is sent (owner decision 2026-10-19).
      mark = adminPage.mark();
      await adminPage.clickButton("Promote");
      await adminPage.waitForText("Confirm the source authorization above before promoting. Nothing was sent.");
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST"), []);
      const authorization = await adminPage.evaluate(`document.querySelector("[data-client-source-authorization]").innerText`);
      assert.ok(authorization.includes("Intended use: Internal impact evidence for this organization"), authorization);
      assert.ok(authorization.includes("Allowed use: unknown; consent basis: unknown."), authorization);
      await adminPage.clickIn("[data-client-source-authorization-confirm]", "source authorization confirmation");
      mark = adminPage.mark();
      await adminPage.clickButton("Promote");
      await adminPage.waitForText("Source promoted. Evidence extraction created 2 evidence item(s)");
      await adminPage.idle();
      const posts = adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]);
      assert.deepEqual(posts, [[`${COCKPIT}/source-candidates/${ids.mainCandidate}/decision`, 200]], "exactly the existing P1-08 decision route");
      assert.deepEqual(delta(await counts(ORG_X), before), { ...ZERO, promotions: 1, sources: 1, source_versions: 1, evidence: 2, audit_events: 2 });
      const [promotion] = await query(
        "SELECT decision_status, reviewed_source_type, created_by::text, created_by_type, source_version_id::text FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid",
        [ORG_X]);
      assert.deepEqual({ ...promotion, source_version_id: undefined },
        { decision_status: "promoted", reviewed_source_type: "organization_primary_record", created_by: ids.adminX, created_by_type: "human", source_version_id: undefined });
      const [version] = await query(
        `SELECT v.source_version_id::text, v.is_current, v.created_by::text, s.created_by::text AS source_created_by, s.source_code, s.reviewed_source_type
           FROM kai.source_versions v JOIN kai.sources s ON s.organization_id = v.organization_id AND s.source_id = v.source_id
          WHERE v.organization_id = $1::uuid`, [ORG_X]);
      assert.deepEqual([version.is_current, version.created_by, version.source_created_by, version.reviewed_source_type], [true, ids.adminX, ids.adminX, "organization_primary_record"]);
      assert.equal(version.source_version_id, promotion.source_version_id, "lineage: the decision is bound to the current version");
      ids.sourceVersionId = version.source_version_id;
      ids.sourceCode = version.source_code;
      const evidence = await query(
        `SELECT e.evidence_item_id::text, e.evidence_review_status, e.created_by::text, e.source_version_id::text, q.queue_status, q.review_queue_item_id::text, q.updated_at
           FROM kai.evidence_items e JOIN kai.review_queue_items q ON q.organization_id = e.organization_id
            AND q.queue_type = 'evidence_review' AND q.target_object_id = e.evidence_item_id
          WHERE e.organization_id = $1::uuid ORDER BY e.statement`, [ORG_X]);
      assert.equal(evidence.length, 2);
      for (const row of evidence) {
        assert.deepEqual([row.evidence_review_status, row.created_by, row.source_version_id, row.queue_status], ["needs_gk_review", ids.adminX, version.source_version_id, "open"]);
      }
      ids.evidence = evidence;
      const audits = await query(
        `SELECT action::text AS action, actor_type, actor_user_id::text FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action::text IN ('source_promotion_decision_persisted', 'evidence_lineage_extracted') ORDER BY action`, [ORG_X]);
      assert.deepEqual(audits, [
        { action: "evidence_lineage_extracted", actor_type: "human", actor_user_id: ids.adminX },
        { action: "source_promotion_decision_persisted", actor_type: "human", actor_user_id: ids.adminX },
      ]);
      // No Get Kinder human acted anywhere in organization X.
      const humans = await query("SELECT DISTINCT actor_user_id::text FROM kai.audit_events WHERE organization_id = $1::uuid AND actor_type::text = 'human'", [ORG_X]);
      assert.deepEqual(humans, [{ actor_user_id: ids.adminX }], "the administrator is the only human actor");
      assert.deepEqual(adminPage.exceptions, []);
      results.p1_08_p2_01 = "PASS: promoted by the administrator; 1 source, 1 current source_version, 2 evidence items, audited, no GK human";
    });

    await test("pipeline after promotion and extraction, and P2-01 reuse of the governed source", async () => {
      const after = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      const main = fileOf(after, FILE.main);
      assert.deepEqual(currentOf(main), ["evidence_review", "waiting_for_get_kinder", "get_kinder", "none_waiting_for_get_kinder", "evidence_awaiting_review"]);
      assert.equal(main.evidenceItemCount, 2);
      assert.deepEqual(main.stages.slice(5, 8).map((stage) => [stage.key, stage.status]),
        [["sensitivity_review", "complete"], ["source_review", "complete"], ["evidence_extraction", "complete"]]);
      await adminPage.waitForText(ids.sourceCode);
      await adminPage.waitFor(async () => !(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-preparation-file="${FILE.main}"]'))`)), "main file leaves Source preparation");
      // The promoted source is usable by the existing P2-01 path: its extraction replays.
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-source-version="${ids.sourceVersionId}"] button`, "Extract evidence");
      await adminPage.waitForText("Evidence was already extracted from this source version (2 evidence item(s)). Nothing new was written.");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [pathOf(r), r.status]),
        [[evidenceExtractionPath(ORG_X, ids.sourceVersionId), 200]]);
      assert.deepEqual(await counts(ORG_X), before);
      // A repeated promotion is a zero-write replay.
      const replay = await adminPage.api("POST", decisionPath(ORG_X, ids.mainCandidate), PROMOTE);
      assert.deepEqual([replay.status, replay.body.data.replayed, replay.body.data.evidence_extraction_handoff.status], [200, true, "replayed"]);
      assert.deepEqual(await counts(ORG_X), before);
      results.pipeline_after = "PASS: evidence_review with 2 evidence items; P2-01 replay; promotion replay zero-write";
    });

    await test("protected operations: evidence review, claim review, generated-draft reads, and external release stay unavailable to the administrator", async () => {
      const before = await counts(ORG_X);
      const [first] = ids.evidence;
      const evidenceDecision = await adminPage.api("POST", evidenceReviewCompletePath(ORG_X, first.evidence_item_id, first.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(first.updated_at).toISOString(), decision: "supported" }));
      assert.deepEqual([evidenceDecision.status, evidenceDecision.body.error.code, evidenceDecision.body.blockers?.[0]?.blocking_reason], [403, "authorization_denied", "role_not_allowed"]);
      const capabilities = await adminPage.api("GET", organizationAccessCapabilitiesPath(ORG_X));
      const operations = capabilities.body.data.workflowOperations;
      assert.deepEqual([operations.readGeneratedDrafts, operations.recordEvidenceReview, operations.recordClaimReview, operations.reviewGeneratedDrafts, operations.generateAllDraftTypes],
        [false, false, false, false, false]);
      // The GK source review list (queue read) stays GK-only.
      const queue = await adminPage.api("GET", `${COCKPIT}/queue?organization_id=${ORG_X}&queue_type=source_candidate_review&queue_status=open`);
      assert.equal(queue.status, 403);
      assert.deepEqual(await counts(ORG_X), before);
      results.protected = "PASS: evidence review 403 role_not_allowed; readGeneratedDrafts false; review/release capabilities false; GK source queue 403";
    });

    await test("failed file policy remains blocked in the pipeline and the candidate lookup", async () => {
      await query(
        `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
           checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
           mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, now(),
           'text/csv', 512, 'clean', 'not_reviewed', 'blocked', now())`,
        [FILE.policyBlocked, BATCH_X, ORG_X, PROJECT_X, NAMES.policyBlocked, "e".repeat(64)],
      );
      const pipeline = await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X));
      assert.equal(pipeline.status, 200, JSON.stringify(pipeline.body));
      assert.deepEqual(currentOf(fileOf(pipeline, FILE.policyBlocked)), ["security_check", "failed", "client", "upload_new_file", "failed"]);
      const lookup = await adminPage.api("GET", lookupPath(ORG_X, PROJECT_X, FILE.policyBlocked));
      assert.deepEqual([lookup.status, lookup.body.data.intake_source_candidate_id], [200, null]);
      const profile = await adminPage.api("GET", `${COCKPIT}/intake-files/${FILE.policyBlocked}/sensitivity-profile?organization_id=${ORG_X}`);
      assert.deepEqual([profile.status, profile.body.data.intake_sensitivity_profile_id], [200, null]);
      assert.ok(!(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-preparation-file="${FILE.policyBlocked}"]'))`)), "no preparation action");
      results.blocked = "PASS: policy-blocked file failed at security_check; no profile, no candidate, no action";
    });

    await test("sensitivity and allowed use: prohibited permission grants are refused at the decision; an effective 'not_allowed' allowed use records the decision but prepares no source (VAL-KAI-B1A-02-003)", async () => {
      const profileId = ids.seeded.allowedUse.intakeSensitivityProfileId;
      const [item] = await sensitivityQueue(ORG_X, profileId);
      const before = await counts(ORG_X);
      const base = { expected_updated_at: new Date(item.updated_at).toISOString(), review_queue_item_id: item.review_queue_item_id, decision: "reviewed" };
      for (const [label, snapshot] of [
        ["LLM processing with allowed use not_allowed", { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed", reviewed_llm_processing_allowed: true }],
        ["public use without allowed use and consent", { ...REVIEWED_SNAPSHOT, reviewed_minor_data_status: "present", reviewed_public_use_allowed: true }],
        ["funder use with allowed use unknown", { ...REVIEWED_SNAPSHOT, reviewed_funder_use_allowed: true }],
      ]) {
        const refused = await adminPage.api("POST", sensitivityDecisionPath(ORG_X, profileId), { ...base, reviewed_snapshot: snapshot });
        assert.equal(refused.status, 422, `${label}: ${JSON.stringify(refused.body)}`);
      }
      assert.deepEqual(await counts(ORG_X), before, "refused decisions write nothing");
      // The file's committed P1-05 allowed use is not_allowed (WORKER SIMULATION
      // above) and the administrator also records a reviewed not_allowed: the
      // decision is recorded, the P1-07 handoff refuses, and nothing downstream exists.
      const decided = await adminPage.api("POST", sensitivityDecisionPath(ORG_X, profileId), {
        ...base, reviewed_snapshot: { ...REVIEWED_SNAPSHOT, reviewed_allowed_use_status: "not_allowed" },
      });
      assert.equal(decided.status, 200, JSON.stringify(decided.body));
      assert.deepEqual([decided.body.data.source_candidate_handoff.status, decided.body.data.source_candidate_handoff.error_code],
        ["not_created", "validation_blocker"]);
      const after = await counts(ORG_X);
      assert.equal(after.sensitivity_decisions - before.sensitivity_decisions, 1, "the human decision is recorded");
      assert.deepEqual([after.candidates - before.candidates, after.promotions - before.promotions, after.sources - before.sources, after.evidence - before.evidence],
        [0, 0, 0, 0], "no candidate, promotion, source, or evidence");
      const lookup = await adminPage.api("GET", lookupPath(ORG_X, PROJECT_X, FILE.allowedUse));
      assert.equal(lookup.body.data?.intake_source_candidate_id ?? null, null);
      results.pipeline_with_prohibited_file_status = (await adminPage.api("GET", pipelinePath(ORG_X, PROJECT_X))).status;
      results.allowed_use = "PASS: 3 prohibited snapshots 422; reviewed not_allowed recorded (200), P1-07 handoff not_created validation_blocker; 0 candidates/promotions/sources/evidence";
    });

    console.log(`[client-admin-source-promotion-browser] results ${JSON.stringify(results)}`);
  } finally {
    for (const page of [adminPage, adminYPage, contributorPage, reviewerPage, storedAdminPage]) await page.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
