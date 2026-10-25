import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Assembled acceptance of the binding-derived, non-superuser client_admin
 * evidence-to-draft workflow (owner decision 2026-10-18), run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-client-admin-evidence-to-draft-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router, service, repository, validator, and production
 * metadata-only audit on the runner cluster; resolveKaiActorContext with the
 * real GK organization binding and first-request JIT kai.users mapping; the
 * built frontend bundle in a real headless Chrome; the GK reviewer's P1-08
 * promotion, P2-12 evidence and claim decisions, and organization-Y setup
 * through the real routes; and every client_admin stage (Data Sources read,
 * P2-01 extraction, Evidence read, P2-03 proposal, Claim read, P2-04 claim
 * gap follow-ups, internal evidence summary, internal impact narrative)
 * through the client Knowledge Studio UI and the real routes.
 * Simulated / substituted (reported as such, never as pipeline proof):
 * - the Get Kinder session login (req.user from a harness cookie);
 * - the runner's synthetic kai.intake_batches / kai.intake_files mirrors and
 *   the P1-03..P1-05 rows of each fresh synthetic file (the P1 worker's
 *   output: upload, malware scan, parsing, and profiling are NOT executed);
 * - the P1-06 queue item and sensitivity decision, through the real services
 *   with a stubbed metadata-only audit (GK setup, not a client stage);
 * - a throwaway trigger that fails the P1-08 -> P2-01 server-side handoff for
 *   organization X, so the client_admin's own extraction creates the evidence;
 * - a throwaway trigger that fails one P2-04 gap insert (B5b), so the UI shows
 *   a real refused request;
 * - the model provider: the Anthropic SDK Messages prototype is patched in
 *   this process to a deterministic response (no network or model call).
 * Fresh claim to internal drafts (owner decision 2026-10-18): internal
 * generation revalidates each claim's P2-06 traceability, which needs the
 * claim's P2-04 gap follow-ups. B5a records both drafts refused without them;
 * the client_admin generates them from the claim (B5c); both drafts follow
 * (B5) with no GK action of any kind between the claim proposal (B3) and the
 * drafts. The earlier governed preparation (GK sensitivity review and source
 * promotion) is unchanged and still GK work. The GK reviewer's P2-12
 * decisions on the second claim come afterwards (E-setup).
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

test("client_admin workflow browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("client_admin evidence-to-draft browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, the same shape as the other
// Knowledge Studio acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-client-admin-workflow");
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
  // Model provider substitution: a dummy key for the SDK constructor (never
  // a real credential) and a deterministic Messages.create on the shared
  // prototype, installed before any generator module is imported.
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-unused-dummy-key";
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const messagesPrototype = Object.getPrototypeOf(new Anthropic({ apiKey: "sk-ant-test-unused-dummy-key" }).messages);
  const modelCalls = [];
  messagesPrototype.create = async function deterministicCreate(payload) {
    const requestBody = JSON.parse(payload.messages[0].content);
    modelCalls.push({ system: payload.system, claimIds: requestBody.claims.map((claim) => claim.claimId) });
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
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const {
    claimGapFollowupsPath,
    claimTraceabilityPath,
    coverageInternalAcceptancePath,
    organizationAccessCapabilitiesPath,
    claimLibraryCandidatesPath,
    claimProposalPath,
    claimReviewCompletePath,
    claimReviewDecisionBody,
    clientGeneratedDraftsPath,
    createDataGapMemoPath,
    createEvidenceSummaryPath,
    createFunderEvidenceSummaryPath,
    createImpactNarrativePath,
    createReadinessAssessmentPath,
    evidenceExtractionPath,
    evidenceLibraryCandidatesPath,
    evidenceReviewCompletePath,
    evidenceReviewDecisionBody,
    generatedDraftReviewPacketPath,
    organizationSourcesPath,
  } = await import("../frontend/impactEvidenceLibraryLogic.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const ORG_X = "0c000000-0000-4000-8000-0000000000a1";
  const ORG_Y = "0c000000-0000-4000-8000-0000000000b1";
  const PROJECT_X = "7c000000-0000-4000-8000-0000000000e1";
  const PROJECT_Y = "7c000000-0000-4000-8000-0000000000e2";
  const BATCH_X = "10000000-0000-4000-8000-0000000000e1";
  const BATCH_Y = "10000000-0000-4000-8000-0000000000e2";
  const FILE_X = "20000000-0000-4000-8000-0000000000e1";
  const FILE_Y = "20000000-0000-4000-8000-0000000000e2";
  const FIELD_KEYS = ["households_served", "programme_month"];
  const USERS = Object.freeze({ gkReviewer: 981, clientAdmin: 982, contributor: 983, clientReviewer: 984 });

  // --- organizations, projects, GK binding, users ---------------------------
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  for (const [organizationId, name, code] of [[ORG_X, "Harbourline Workflow Society", "harbourline-workflow"], [ORG_Y, "Larchmont Other Society", "larchmont-other"]]) {
    await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, $3)", [organizationId, name, code]);
  }
  for (const [engagementId, organizationId, code, batchId] of [[PROJECT_X, ORG_X, "Project Harbourline", BATCH_X], [PROJECT_Y, ORG_Y, "Project Larchmont", BATCH_Y]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)", [engagementId, organizationId, code]);
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, `${code}-intake`]);
  }
  for (const legacyId of Object.values(USERS)) await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
  // The organization administrator: an active Get Kinder organization-admin
  // membership in a GK organization bound to KAI organization X. No kai.users
  // row (first request maps it), no stored membership, no global role.
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ('Harbourline Workflow Society', 'approved') RETURNING id");
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_X]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.clientAdmin]);
  // GK reviewer: organization gk_reviewer in X and Y plus the global role.
  const gkReviewer = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.gkReviewer, email: `user${USERS.gkReviewer}@harbourline.test` });
  for (const organizationId of [ORG_X, ORG_Y]) {
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'gk_reviewer', 'active')", [organizationId, gkReviewer.user_id]);
  }
  await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = 'gk_reviewer'", [gkReviewer.user_id]);
  const contributor = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.contributor, email: `user${USERS.contributor}@harbourline.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_contributor', 'active')", [ORG_X, contributor.user_id]);
  const clientReviewer = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: USERS.clientReviewer, email: `user${USERS.clientReviewer}@harbourline.test` });
  await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, 'client_reviewer', 'active')", [ORG_X, clientReviewer.user_id]);
  const gkReviewerService = {
    actorType: "human",
    actorUserId: gkReviewer.user_id,
    kaiRoles: ["gk_reviewer"],
    platformSuperuser: false,
    organizationMemberships: [ORG_X, ORG_Y].map((organization_id) => ({ organization_id, membership_status: "active", role_name: "gk_reviewer" })),
  };

  /** P1-03..P1-05 rows of one fresh confirmed Project file (the P1 worker's output - simulated). */
  async function seedFreshFile({ organizationId, engagementId, batchId, intakeFileId, name, checksumChar }) {
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
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256],
    );
    return sensitivity.intake_sensitivity_profile_id;
  }

  /** Real P1-06 work and the real sensitivity 'reviewed' decision with its P1-07 handoff (audit stubbed). */
  async function reachReviewableSourceCandidate(organizationId, intakeSensitivityProfileId) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId, actorContext: gkReviewerService, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid",
      [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId,
      intakeSensitivityProfileId,
      actorContext: gkReviewerService,
      payload: {
        expected_updated_at: new Date(item.updated_at).toISOString(),
        review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "absent",
          reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent",
          reviewed_indigenous_governance_status: "unknown",
          reviewed_staff_notes_status: "absent",
          reviewed_story_testimonial_status: "absent",
          reviewed_small_cell_risk_status: "unknown",
          reviewed_financial_records_status: "absent",
          reviewed_consent_basis_status: "unknown",
          // AI processing is permitted, so the internal drafts may reach the model (VAL-KAI-B1A-02-004).
          reviewed_allowed_use_status: "allowed",
          reviewed_llm_processing_allowed: true,
          reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false,
          reviewed_funder_use_allowed: false,
        },
      },
    }, { env: ENV });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.source_candidate_handoff.status, "created");
    return decided.data.source_candidate_handoff.intake_source_candidate_id;
  }

  async function counts(organizationId) {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.sources WHERE organization_id = $1::uuid)::int AS sources,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = $1::uuid)::int AS evidence,
      (SELECT count(*) FROM kai.claims WHERE organization_id = $1::uuid)::int AS claims,
      (SELECT count(*) FROM kai.generation_runs WHERE organization_id = $1::uuid)::int AS generation_runs,
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
      (SELECT count(*) FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claim_review_decisions WHERE organization_id = $1::uuid)::int AS claim_decisions,
      (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid)::int AS promotions,
      (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = $1::uuid)::int AS gaps,
      (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = $1::uuid)::int AS followups,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'client_followup')::int AS followup_queue`, [organizationId]);
    return row;
  }
  const delta = (after, before) => Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));

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
  const decisionPath = (organizationId, candidateId) =>
    `/api/kai/sprint2/intake/admin/review-cockpit/source-candidates/${candidateId}/decision?organization_id=${organizationId}`;
  const DRAFT_BODY = (claimIds, key, engagementId = PROJECT_X) => ({ claim_ids: claimIds, idempotency_key: key, engagement_id: engagementId });

  const gkPage = await openPage(browser, { baseUrl, legacyUserId: USERS.gkReviewer });
  const adminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const contributorPage = await openPage(browser, { baseUrl, legacyUserId: USERS.contributor });
  const reviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const results = {};
  const ids = {};
  try {
    await gkPage.goto("/impact-library");

    // --- governed setup ------------------------------------------------------
    await test("setup: organization Y has a GK-promoted source, server-created evidence, and a GK-proposed claim", async () => {
      const profile = await seedFreshFile({ organizationId: ORG_Y, engagementId: PROJECT_Y, batchId: BATCH_Y, intakeFileId: FILE_Y, name: "larchmont-households.csv", checksumChar: "b" });
      const candidate = await reachReviewableSourceCandidate(ORG_Y, profile);
      const promoted = await gkPage.api("POST", decisionPath(ORG_Y, candidate), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
      assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
      const [version] = await query("SELECT source_version_id::text FROM kai.source_versions WHERE organization_id = $1::uuid", [ORG_Y]);
      const evidence = await query("SELECT evidence_item_id::text, statement FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY statement", [ORG_Y]);
      assert.equal(evidence.length, 2);
      const proposed = await gkPage.api("POST", claimProposalPath(ORG_Y, evidence[0].evidence_item_id), {});
      assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
      ids.y = { sourceVersionId: version.source_version_id, evidenceItemId: evidence[0].evidence_item_id, claimId: proposed.body.data.claim.claim_id, statements: evidence.map((row) => row.statement) };
    });

    await test("setup: GK promotes organization X's source; the server-side handoff is made to fail so no evidence exists yet", async () => {
      const profile = await seedFreshFile({ organizationId: ORG_X, engagementId: PROJECT_X, batchId: BATCH_X, intakeFileId: FILE_X, name: "harbourline-households.csv", checksumChar: "a" });
      const candidate = await reachReviewableSourceCandidate(ORG_X, profile);
      await query(`CREATE FUNCTION kai.client_admin_workflow_fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN RAISE EXCEPTION 'synthetic handoff fault'; END $$`);
      await query(`CREATE TRIGGER client_admin_workflow_fail_evidence BEFORE INSERT ON kai.evidence_items
                   FOR EACH ROW EXECUTE FUNCTION kai.client_admin_workflow_fail_evidence()`);
      try {
        const promoted = await gkPage.api("POST", decisionPath(ORG_X, candidate), { outcome: "promoted", reviewed_source_type: "organization_primary_record" });
        assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
        assert.notEqual(promoted.body.data.evidence_extraction_handoff?.status, "created");
      } finally {
        await query("DROP TRIGGER client_admin_workflow_fail_evidence ON kai.evidence_items");
        await query("DROP FUNCTION kai.client_admin_workflow_fail_evidence()");
      }
      const [source] = await query("SELECT source_id::text, source_code FROM kai.sources WHERE organization_id = $1::uuid", [ORG_X]);
      const [version] = await query("SELECT source_version_id::text, is_current FROM kai.source_versions WHERE organization_id = $1::uuid", [ORG_X]);
      assert.equal(version.is_current, true);
      ids.x = { sourceId: source.source_id, sourceCode: source.source_code, sourceVersionId: version.source_version_id };
      assert.deepEqual(await counts(ORG_X), { sources: 1, evidence: 0, claims: 0, generation_runs: 0, drafts: 0, evidence_decisions: 0, claim_decisions: 0, promotions: 1, gaps: 0, followups: 0, followup_queue: 0 });
    });

    // --- B. the assembled client_admin workflow in the real UI ---------------
    await test("B1: the binding-derived client_admin opens Knowledge Studio > Data Sources; first request maps the identity without granting any stored role", async () => {
      await adminPage.goto("/impact-library");
      await adminPage.waitForText("Knowledge Studio");
      await adminPage.clickNav("Knowledge Studio");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
      await adminPage.idle();
      const [mapped] = await query("SELECT user_id::text, status FROM kai.users WHERE legacy_public_userdata_id = $1", [USERS.clientAdmin]);
      assert.equal(mapped.status, "active", "JIT mapping on first request");
      ids.adminKaiUser = mapped.user_id;
      assert.deepEqual(await query("SELECT role_id FROM kai.user_roles WHERE user_id = $1::uuid", [mapped.user_id]), [], "no global role");
      assert.deepEqual(await query("SELECT organization_id FROM kai.organization_memberships WHERE user_id = $1::uuid", [mapped.user_id]), [], "no stored membership");
      assert.ok((await adminPage.tabLabels()).includes("Data Sources"), "Data Sources offered to client_admin");
      await adminPage.clickTab("Data Sources");
      await adminPage.waitForText(ids.x.sourceCode);
      await adminPage.idle();
      const projectValue = await adminPage.evaluate(`document.getElementById("gk-shell-project-select").value`);
      if (!projectValue) await adminPage.waitForText("Select a Project above: each draft belongs to one Project.");
      await adminPage.selectProject(PROJECT_X);
      await adminPage.idle();
      await adminPage.waitForText("Select at least one claim below to draft from.");
      assert.ok(!(await adminPage.text()).includes(ids.y.statements[0]), "no organization-Y data");
      results.b1 = "PASS";
    });

    await test("B2: Extract evidence on the selected source version creates organization X's evidence through the real P2-01 route", async () => {
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-source-version="${ids.x.sourceVersionId}"] button`, "Extract evidence");
      await adminPage.waitForText("Evidence extracted: 2 evidence item(s) created, awaiting Get Kinder evidence review.");
      await adminPage.idle();
      const posts = adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]);
      assert.deepEqual(posts, [[evidenceExtractionPath(ORG_X, ids.x.sourceVersionId), 200]]);
      assert.deepEqual(delta(await counts(ORG_X), before), { sources: 0, evidence: 2, claims: 0, generation_runs: 0, drafts: 0, evidence_decisions: 0, claim_decisions: 0, promotions: 0, gaps: 0, followups: 0, followup_queue: 0 });
      const evidence = await query(
        `SELECT e.evidence_item_id::text, e.statement, e.evidence_review_status, e.created_by::text, e.source_version_id::text, q.queue_status
           FROM kai.evidence_items e JOIN kai.review_queue_items q ON q.organization_id = e.organization_id
            AND q.queue_type = 'evidence_review' AND q.target_object_id = e.evidence_item_id
          WHERE e.organization_id = $1::uuid ORDER BY e.statement`, [ORG_X]);
      for (const row of evidence) {
        assert.deepEqual([row.evidence_review_status, row.queue_status, row.created_by, row.source_version_id], ["needs_gk_review", "open", ids.adminKaiUser, ids.x.sourceVersionId]);
        await adminPage.waitForText(row.statement);
      }
      ids.x.evidence = evidence;
      const [audit] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'evidence_lineage_extracted'", [ORG_X]);
      assert.equal(audit.n, 1, "the production extraction audit row");
      results.b2 = "PASS";
    });

    await test("B3: Propose claim on each evidence item creates a review-gated internal claim through the real P2-03 route", async () => {
      // Audit high-water mark: no GK audit event may follow until both drafts exist (B5).
      ids.x.auditMarkBeforeProposal = (await query("SELECT coalesce(max(audit_event_id), 0)::bigint AS id FROM kai.audit_events"))[0].id;
      for (const [index, row] of ids.x.evidence.entries()) {
        const mark = adminPage.mark();
        await adminPage.clickIn(`[data-client-evidence="${row.evidence_item_id}"] button`, `Propose claim ${index}`);
        await adminPage.waitFor(async () => (await adminPage.evaluate(`document.querySelector('[data-client-evidence="${row.evidence_item_id}"]').innerText`)).includes("Claim proposed"), "claim proposed marker");
        await adminPage.idle();
        assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
          [[claimProposalPath(ORG_X, row.evidence_item_id), 200]]);
      }
      const claims = await query(
        `SELECT claim_id::text, evidence_item_id::text, claim_status, claim_review_status, claim_strength, internal_only, funder_use_allowed, public_use_allowed, created_by::text
           FROM kai.claims WHERE organization_id = $1::uuid ORDER BY evidence_item_id`, [ORG_X]);
      assert.equal(claims.length, 2);
      for (const claim of claims) {
        assert.deepEqual(
          [claim.claim_status, claim.claim_review_status, claim.claim_strength, claim.internal_only, claim.funder_use_allowed, claim.public_use_allowed, claim.created_by],
          ["proposed", "needs_gk_review", "unassessed", true, false, false, ids.adminKaiUser],
        );
      }
      ids.x.claims = claims;
      const [audit] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'claim_proposed'", [ORG_X]);
      assert.equal(audit.n, 2);
      results.b3 = "PASS";
    });

    await test("B4: claim selection - both fresh claims are selectable, each offers Generate gap follow-ups, and the first is selected", async () => {
      ids.x.usableClaimId = ids.x.claims[0].claim_id;
      ids.x.usableEvidenceId = ids.x.claims[0].evidence_item_id;
      ids.x.secondClaimId = ids.x.claims[1].claim_id;
      ids.x.secondEvidenceId = ids.x.claims[1].evidence_item_id;
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.x.secondClaimId}"]'))`), "claims listed");
      await adminPage.idle();
      for (const claimId of [ids.x.usableClaimId, ids.x.secondClaimId]) {
        const entry = await adminPage.evaluate(`document.querySelector('[data-client-claim="${claimId}"]').innerText`);
        assert.match(entry, /Review: needs_gk_review · Strength: unassessed/, "actual status shown, not promoted");
        assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim-gap-followups="${claimId}"]'))`), true, "Generate gap follow-ups offered");
        assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${claimId}"] input'))`), true, "selectable");
      }
      await adminPage.clickIn(`[data-client-claim="${ids.x.usableClaimId}"] input`, "Use in an internal draft");
      await adminPage.waitFor(async () => !(await adminPage.text()).includes("Select at least one claim below to draft from."), "draft readiness satisfied");
      results.b4 = "PASS";
    });

    await test("B5a (before P2-04): both internal draft requests for the fresh claim are refused at traceability revalidation and create nothing", async () => {
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickButton("Generate internal evidence summary");
      // Owner authorization 2026-10-24: the refusal is diagnosed from the
      // claim's client-safe internal traceability read (409, missing P2-04 state).
      await adminPage.waitForText("cannot be drafted from yet: its coverage gap follow-ups have not been generated yet. Use \"Generate gap follow-ups\" on that claim, then try again. Nothing was created.");
      await adminPage.idle();
      await adminPage.clickButton("Generate internal impact narrative");
      await adminPage.idle();
      const requests = adminPage.requestsSince(mark);
      assert.deepEqual(requests.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
        [[createEvidenceSummaryPath(ORG_X), 422], [createImpactNarrativePath(ORG_X), 422]]);
      const diagnosticReads = requests.filter((r) => new URL(r.url).pathname.endsWith("/traceability"));
      assert.deepEqual(diagnosticReads.map((r) => [r.method, new URL(r.url).pathname + new URL(r.url).search, r.status]),
        [0, 1].map(() => ["GET", claimTraceabilityPath(ORG_X, ids.x.usableClaimId, "internal"), 409]));
      const diagnostic = await adminPage.api("GET", claimTraceabilityPath(ORG_X, ids.x.usableClaimId, "internal"));
      assert.deepEqual([diagnostic.status, diagnostic.body.data], [409, { traceability_conflict_reason: "gap_dimension_requires_missing_p204_state" }]);
      for (const [path, key] of [[createEvidenceSummaryPath(ORG_X), "client-admin-before-p204-summary"], [createImpactNarrativePath(ORG_X), "client-admin-before-p204-narrative"]]) {
        const direct = await adminPage.api("POST", path, DRAFT_BODY([ids.x.usableClaimId], key));
        assert.deepEqual([direct.status, direct.body.error.code, direct.body.blockers[0].blocking_reason], [422, "validation_blocker", "traceability_result_contract_invalid"], path);
      }
      assert.equal(modelCalls.length, 0, "no generator call");
      assert.deepEqual(await counts(ORG_X), before);
      results.b5a = "OBSERVED: evidence summary 422 + impact narrative 422 traceability_result_contract_invalid before P2-04; nothing written";
    });

    await test("B5b (refused P2-04): a synthetic gap-insert fault returns a real 422 the UI explains, and writes nothing", async () => {
      await query(`CREATE FUNCTION kai.client_admin_workflow_fail_gaps() RETURNS trigger LANGUAGE plpgsql AS $$
                   BEGIN RAISE EXCEPTION 'synthetic gap write fault'; END $$`);
      await query(`CREATE TRIGGER client_admin_workflow_fail_gaps BEFORE INSERT ON kai.gap_log_items
                   FOR EACH ROW EXECUTE FUNCTION kai.client_admin_workflow_fail_gaps()`);
      try {
        const before = await counts(ORG_X);
        const mark = adminPage.mark();
        await adminPage.clickIn(`[data-client-claim-gap-followups="${ids.x.usableClaimId}"]`, "Generate gap follow-ups (fault)");
        await adminPage.waitForText("Gap follow-ups cannot be generated for this claim: it did not pass validation");
        await adminPage.idle();
        assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]),
          [[claimGapFollowupsPath(ORG_X, ids.x.usableClaimId), 422]]);
        assert.ok((await adminPage.text()).includes("Nothing was written."));
        assert.deepEqual(await counts(ORG_X), before, "the refused request wrote nothing");
        const [audit] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'claim_gap_and_followup_generated'", [ORG_X]);
        assert.equal(audit.n, 0);
      } finally {
        await query("DROP TRIGGER client_admin_workflow_fail_gaps ON kai.gap_log_items");
        await query("DROP FUNCTION kai.client_admin_workflow_fail_gaps()");
      }
      results.b5b = "PASS: P2-04 422 shown as a blocker; nothing written";
    });

    await test("B5c: the client_admin's Generate gap follow-ups persists the claim's open gaps and client follow-ups through the real P2-04 route, audited, and resolves nothing", async () => {
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickIn(`[data-client-claim-gap-followups="${ids.x.usableClaimId}"]`, "Generate gap follow-ups");
      await adminPage.waitForText("Gap follow-ups generated:");
      await adminPage.idle();
      const since = adminPage.requestsSince(mark);
      const posts = since.filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]);
      assert.equal(posts.length, 1);
      assert.equal(posts[0][0], claimGapFollowupsPath(ORG_X, ids.x.usableClaimId));
      assert.ok([200, 201].includes(posts[0][1]), JSON.stringify(posts));
      const refreshed = since.filter((r) => r.method === "GET").map((r) => new URL(r.url).pathname);
      for (const path of [organizationSourcesPath(ORG_X), evidenceLibraryCandidatesPath(ORG_X).split("?")[0], claimLibraryCandidatesPath(ORG_X).split("?")[0]]) {
        assert.ok(refreshed.includes(path), `refreshed ${path}`);
      }

      const gaps = await query(
        `SELECT gap_log_item_id::text, claim_id::text, evidence_item_id::text, source_version_id::text, dimension_key, assessment_status, created_by_type
           FROM kai.gap_log_items WHERE organization_id = $1::uuid ORDER BY dimension_key`, [ORG_X]);
      assert.ok(gaps.length > 0, "the fresh claim has coverage gaps");
      for (const gap of gaps) {
        assert.deepEqual([gap.claim_id, gap.evidence_item_id, gap.source_version_id], [ids.x.usableClaimId, ids.x.usableEvidenceId, ids.x.sourceVersionId]);
      }
      const followups = await query(
        `SELECT f.client_followup_item_id::text, f.claim_id::text, f.dimension_key, q.queue_status, q.review_status, q.target_object_type
           FROM kai.client_followup_items f
           JOIN kai.review_queue_items q ON q.organization_id = f.organization_id AND q.queue_type = 'client_followup' AND q.target_object_id = f.client_followup_item_id
          WHERE f.organization_id = $1::uuid ORDER BY f.dimension_key`, [ORG_X]);
      for (const followup of followups) {
        assert.deepEqual([followup.claim_id, followup.queue_status, followup.review_status, followup.target_object_type],
          [ids.x.usableClaimId, "waiting_on_client", "proposed", "client_followup_item"], "open, unanswered follow-up");
        assert.ok(gaps.some((gap) => gap.dimension_key === followup.dimension_key));
      }
      assert.deepEqual(delta(await counts(ORG_X), before), {
        sources: 0, evidence: 0, claims: 0, generation_runs: 0, drafts: 0, evidence_decisions: 0, claim_decisions: 0, promotions: 0,
        gaps: gaps.length, followups: followups.length, followup_queue: followups.length,
      });
      await adminPage.waitForText(`Gap follow-ups generated: ${gaps.length} open gap(s) and ${followups.length} client follow-up question(s) recorded.`);

      const [lifecycleAudit] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'claim_gap_and_followup_generated'", [ORG_X]);
      assert.equal(lifecycleAudit.n, 1, "the P2-04 lifecycle audit row");
      // The only fresh P2-04 write in organization X so far (B5b rolled back).
      const auditEvents = await query(
        `SELECT actor_user_id::text, actor_type, action FROM kai.audit_events
          WHERE organization_id = $1::uuid AND action = 'claim_gap_and_followup_generated'`, [ORG_X]);
      assert.equal(auditEvents.length, 1, JSON.stringify(auditEvents));
      assert.deepEqual([auditEvents[0].actor_user_id, auditEvents[0].actor_type], [ids.adminKaiUser, "human"], "attributed to the client_admin");

      const [claim] = await query(
        `SELECT claim_status, claim_review_status, claim_strength, internal_only, funder_use_allowed, public_use_allowed, statement AS claim_statement
           FROM kai.claims WHERE claim_id = $1::uuid`, [ids.x.usableClaimId]);
      assert.deepEqual([claim.claim_status, claim.claim_review_status, claim.claim_strength, claim.internal_only, claim.funder_use_allowed, claim.public_use_allowed],
        ["proposed", "needs_gk_review", "unassessed", true, false, false], "the claim is not reviewed, approved, or released by P2-04");

      // Replay: idempotent, nothing new, and the response carries no evidence or claim text.
      const replay = await adminPage.api("POST", claimGapFollowupsPath(ORG_X, ids.x.usableClaimId), {});
      assert.equal(replay.status, 200, JSON.stringify(replay.body));
      assert.equal(replay.body.data.replayed, true);
      assert.deepEqual(replay.body.data.gapItems.map((gap) => gap.gap_log_item_id).sort(), gaps.map((gap) => gap.gap_log_item_id).sort());
      const replayText = JSON.stringify(replay.body);
      for (const statement of [claim.claim_statement, ...ids.x.evidence.map((row) => row.statement), ...ids.y.statements]) {
        assert.ok(!replayText.includes(statement), "no claim or evidence statement in the P2-04 response");
      }
      assert.ok(!replayText.includes(ORG_Y));
      assert.deepEqual(delta(await counts(ORG_X), before), {
        sources: 0, evidence: 0, claims: 0, generation_runs: 0, drafts: 0, evidence_decisions: 0, claim_decisions: 0, promotions: 0,
        gaps: gaps.length, followups: followups.length, followup_queue: followups.length,
      }, "replay wrote nothing");
      ids.x.gapDimensionKey = gaps[0].dimension_key;
      ids.x.followup = followups[0] || null;
      results.b5c = `PASS: client_admin P2-04 ${posts[0][1]}; ${gaps.length} gap(s) [${gaps.map((gap) => gap.dimension_key).join(", ")}], ${followups.length} follow-up(s) waiting_on_client/proposed; audit actor client_admin; replay 200 replayed`;
    });

    await test("B5: with no GK action since the claim was proposed, both internal drafts persist for project X citing the fresh claim", async () => {
      const before = await counts(ORG_X);
      const mark = adminPage.mark();
      await adminPage.clickButton("Generate internal evidence summary");
      await adminPage.waitForText("Internal evidence summary created: 1 block(s) citing 1 claim(s).");
      await adminPage.idle();
      await adminPage.clickButton("Generate internal impact narrative");
      await adminPage.waitForText("Internal impact narrative created: 1 block(s) citing 1 claim(s).");
      await adminPage.idle();
      assert.deepEqual(adminPage.requestsSince(mark).filter((r) => r.method === "POST").map((r) => [new URL(r.url).pathname, r.status]), [
        [createEvidenceSummaryPath(ORG_X), 201],
        [createImpactNarrativePath(ORG_X), 201],
      ]);
      assert.equal(modelCalls.length, 2, "the substituted model was called once per draft");
      assert.deepEqual(modelCalls.map((call) => call.claimIds), [[ids.x.usableClaimId], [ids.x.usableClaimId]]);
      assert.deepEqual(delta(await counts(ORG_X), before), { sources: 0, evidence: 0, claims: 0, generation_runs: 2, drafts: 2, evidence_decisions: 0, claim_decisions: 0, promotions: 0, gaps: 0, followups: 0, followup_queue: 0 });
      const drafts = await query(
        `SELECT d.generated_content_draft_id::text, d.content_type, d.requested_audience, d.draft_status, d.review_status, r.engagement_id::text,
                q.queue_status, q.queue_type
           FROM kai.generated_content_drafts d
           JOIN kai.generation_runs r ON r.organization_id = d.organization_id AND r.generation_run_id = d.generation_run_id
           JOIN kai.review_queue_items q ON q.organization_id = d.organization_id AND q.target_object_id = d.generated_content_draft_id
          WHERE d.organization_id = $1::uuid ORDER BY d.content_type`, [ORG_X]);
      assert.deepEqual(drafts.map((row) => [row.content_type, row.requested_audience, row.draft_status, row.review_status, row.engagement_id, row.queue_type, row.queue_status]), [
        ["evidence_summary", "internal", "draft", "needs_gk_review", PROJECT_X, "generated_content_review", "open"],
        ["impact_narrative", "internal", "draft", "needs_gk_review", PROJECT_X, "generated_content_review", "open"],
      ]);
      const citations = await query(
        `SELECT DISTINCT c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_citations c WHERE c.organization_id = $1::uuid`, [ORG_X]);
      assert.deepEqual(citations, [{ claim_id: ids.x.usableClaimId, evidence_item_id: ids.x.usableEvidenceId }]);
      const [audit] = await query("SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'generated_content_draft_created'", [ORG_X]);
      assert.equal(audit.n, 2);
      // No GK action of any kind between the claim proposal (B3) and here: no
      // GK audit event, no review decision, no GK-run P2-04.
      const gkEvents = await query("SELECT action FROM kai.audit_events WHERE audit_event_id > $1 AND actor_user_id = $2::uuid", [ids.x.auditMarkBeforeProposal, gkReviewer.user_id]);
      assert.deepEqual(gkEvents, [], "no GK audit event since the proposal");
      const actors = await query("SELECT DISTINCT actor_user_id::text FROM kai.audit_events WHERE audit_event_id > $1 AND organization_id = $2::uuid", [ids.x.auditMarkBeforeProposal, ORG_X]);
      assert.deepEqual(actors.map((row) => row.actor_user_id), [ids.adminKaiUser], "every audited action since the proposal is the client_admin's");
      ids.x.draftIds = drafts.map((row) => row.generated_content_draft_id);
      const body = await adminPage.text();
      assert.ok(body.includes("Internal use only. It is opened from your saved drafts below; when every cited claim is usable for internal use it is ready to read and download there."),
        "owner decisions 2026-10-19 and 2026-10-25: the persisted draft is read back, and no review is announced as required");
      // Owner decision 2026-10-19: the administrator reads its own persisted
      // draft back, only inside the internal-draft view with its true review
      // state and limitations.
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector("[data-client-internal-draft-detail]"))`), "internal draft detail");
      const detail = await adminPage.evaluate(`(() => { const el = document.querySelector("[data-client-internal-draft-detail]"); return el ? el.innerText : null; })()`);
      assert.ok(detail && detail.includes("Internal draft text for:"), `the persisted draft is read back: ${detail}`);
      for (const text of ["Awaiting Get Kinder review", "Internal use only.", "Not approved for funder or public use, export, or release.", "Get Kinder has not reviewed this draft."]) {
        assert.ok(detail.includes(text), text);
      }
      results.b5 = "PASS: proposal -> client P2-04 -> evidence summary 201 + impact narrative 201; zero GK audit events or decisions in between";
    });

    await test("B5-verify: a GK read of the fresh claim's P2-06 traceability (after drafting) is valid, and the claim is not eligible for funders or the public", async () => {
      const eligibility = {};
      for (const audience of ["internal", "funder", "public"]) {
        const response = await gkPage.api("GET", claimTraceabilityPath(ORG_X, ids.x.usableClaimId, audience));
        assert.equal(response.status, 200, `${audience}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.data.claim.claim_id, ids.x.usableClaimId);
        eligibility[audience] = { eligible: response.body.data.eligible, blockers: response.body.data.blockerCodes };
      }
      assert.equal(eligibility.funder.eligible, false, JSON.stringify(eligibility.funder));
      assert.equal(eligibility.public.eligible, false, JSON.stringify(eligibility.public));
      const [claim] = await query("SELECT claim_review_status, claim_strength, funder_use_allowed, public_use_allowed FROM kai.claims WHERE claim_id = $1::uuid", [ids.x.usableClaimId]);
      assert.deepEqual(claim, { claim_review_status: "needs_gk_review", claim_strength: "unassessed", funder_use_allowed: false, public_use_allowed: false });
      results.b5verify = eligibility;
    });

    await test("B6: the client-visible Generated Drafts path does not show the unreviewed drafts (existing reviewed-only rule)", async () => {
      const list = await adminPage.api("GET", clientGeneratedDraftsPath(ORG_X, PROJECT_X));
      assert.equal(list.status, 200, JSON.stringify(list.body));
      for (const draftId of ids.x.draftIds) assert.ok(!JSON.stringify(list.body).includes(draftId), "an unreviewed draft is not client-visible");
      results.b6 = "PASS: persisted drafts await GK review before the client Generated Drafts read shows them";
    });

    await test("B7: the Data Sources requests were organization X's Sources, Evidence, Claim reads and the five permitted writes only", async () => {
      const allowedPrefixes = [
        organizationSourcesPath(ORG_X), evidenceLibraryCandidatesPath(ORG_X).split("?")[0], claimLibraryCandidatesPath(ORG_X).split("?")[0],
        `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/source-versions/`, `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/evidence-items/`,
        createEvidenceSummaryPath(ORG_X), createImpactNarrativePath(ORG_X),
      ];
      const gapFollowupPost = new RegExp(`^/api/kai/sprint2/intake/admin/organizations/${ORG_X}/claims/[0-9a-f-]{36}/claim-gap-followups$`);
      const forbidden = ["/evidence-summary/funder", "/readiness-assessment", "/data-gap-memo", "/review-packet", "/review-queue", "/eligible-claims",
        "/review-cockpit", "/evidence-review/", "/claim-review/", "/start", "/complete", "/client-followups", "/coverage-dimensions"];
      // The shell's existing Needs Attention reads for the bound organization
      // administrator's sensitivity review (owner decision 2026-10-12) are not
      // part of this workflow: review-cockpit capabilities and its queue GET.
      const shellReads = new Set(["/api/kai/sprint2/intake/admin/review-cockpit/capabilities", "/api/kai/sprint2/intake/admin/review-cockpit/queue"]);
      for (const request of adminPage.requests()) {
        const path = new URL(request.url).pathname;
        if (shellReads.has(path) && request.method === "GET") continue;
        // Owner authorization 2026-10-24: only the client-safe internal diagnostic GET.
        if (path.includes("/traceability")) {
          assert.ok(request.method === "GET" && new RegExp(`^/api/kai/sprint2/intake/admin/organizations/${ORG_X}/claims/[0-9a-f-]{36}/traceability$`).test(path)
            && new URL(request.url).search === "?requested_audience=internal", `forbidden request ${request.method} ${path}`);
        }
        for (const fragment of forbidden) assert.ok(!path.includes(fragment), `forbidden request ${request.method} ${path}`);
        if (request.method === "POST") assert.ok(allowedPrefixes.some((prefix) => path.startsWith(prefix)) || gapFollowupPost.test(path), `unexpected POST ${path}`);
        assert.ok(!path.includes(ORG_Y), `organization Y request ${path}`);
      }
      assert.deepEqual(adminPage.exceptions, []);
    });

    await test("E-setup (after the drafts): the client_admin generates the second claim's gap follow-ups, then a GK reviewer rejects that claim (real P2-12 routes); the client sees it as not usable", async () => {
      await adminPage.clickIn(`[data-client-claim-gap-followups="${ids.x.secondClaimId}"]`, "Generate gap follow-ups (second claim)");
      await adminPage.waitFor(async () => (await adminPage.evaluate(`document.querySelector('[data-client-claim="${ids.x.secondClaimId}"]').innerText`)).includes("Gap follow-ups generated:"), "second claim follow-ups");
      await adminPage.idle();
      const [secondGaps] = await query("SELECT count(*)::int AS n FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid", [ORG_X, ids.x.secondClaimId]);
      assert.ok(secondGaps.n > 0);
      const [evidenceQueue] = await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_id = $2::uuid", [ORG_X, ids.x.secondEvidenceId]);
      const evidenceDecision = await gkPage.api("POST", evidenceReviewCompletePath(ORG_X, ids.x.secondEvidenceId, evidenceQueue.review_queue_item_id),
        evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" }));
      assert.equal(evidenceDecision.status, 200, JSON.stringify(evidenceDecision.body));
      const [claimQueue] = await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid", [ORG_X, ids.x.secondClaimId]);
      const claimDecision = await gkPage.api("POST", claimReviewCompletePath(ORG_X, ids.x.secondClaimId, claimQueue.review_queue_item_id),
        claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "rejected" }));
      assert.equal(claimDecision.status, 200, JSON.stringify(claimDecision.body));
      const [rejected] = await query("SELECT claim_strength FROM kai.claims WHERE claim_id = $1::uuid", [ids.x.secondClaimId]);
      assert.equal(rejected.claim_strength, "reviewed_not_supported");
      ids.x.rejectedClaimId = ids.x.secondClaimId;

      await adminPage.clickTab("Files");
      await adminPage.clickTab("Data Sources");
      await adminPage.waitFor(async () => adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.x.rejectedClaimId}"]'))`), "claims listed");
      await adminPage.idle();
      const rejectedEntry = await adminPage.evaluate(`document.querySelector('[data-client-claim="${ids.x.rejectedClaimId}"]').innerText`);
      assert.match(rejectedEntry, /Strength: reviewed_not_supported/);
      assert.match(rejectedEntry, /Get Kinder review found this claim not supported, so it cannot be used in a draft\./);
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim="${ids.x.rejectedClaimId}"] input'))`), false);
      assert.equal(await adminPage.evaluate(`Boolean(document.querySelector('[data-client-claim-gap-followups="${ids.x.rejectedClaimId}"]'))`), false);
    });

    // --- C. organization Y and foreign identifiers -----------------------------
    await test("C: the same client_admin is denied every organization-Y operation, and foreign identifiers in organization X return no organization-Y data", async () => {
      const beforeX = await counts(ORG_X);
      const beforeY = await counts(ORG_Y);
      const inY = [
        ["GET", organizationSourcesPath(ORG_Y)],
        ["GET", evidenceLibraryCandidatesPath(ORG_Y)],
        ["GET", claimLibraryCandidatesPath(ORG_Y)],
        ["POST", evidenceExtractionPath(ORG_Y, ids.y.sourceVersionId), {}],
        ["POST", claimProposalPath(ORG_Y, ids.y.evidenceItemId), {}],
        ["POST", claimGapFollowupsPath(ORG_Y, ids.y.claimId), {}],
        ["POST", createEvidenceSummaryPath(ORG_Y), DRAFT_BODY([ids.y.claimId], "client-admin-y-summary", PROJECT_Y)],
        ["POST", createImpactNarrativePath(ORG_Y), DRAFT_BODY([ids.y.claimId], "client-admin-y-narrative", PROJECT_Y)],
      ];
      for (const [method, path, body] of inY) {
        const response = await adminPage.api(method, path, body);
        assert.equal(response.status, 403, `${method} ${path}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.error.code, "authorization_denied");
        assert.equal(response.body.blockers[0].blocking_reason, "missing_active_organization_membership");
        for (const statement of ids.y.statements) assert.ok(!JSON.stringify(response.body).includes(statement));
      }
      const foreign = [
        ["extract Y's source version in X", evidenceExtractionPath(ORG_X, ids.y.sourceVersionId), {}, 404],
        ["propose from Y's evidence in X", claimProposalPath(ORG_X, ids.y.evidenceItemId), {}, 404],
        ["P2-04 on Y's claim in X", claimGapFollowupsPath(ORG_X, ids.y.claimId), {}, 404],
      ];
      for (const [label, path, body, status] of foreign) {
        const response = await adminPage.api("POST", path, body);
        assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.error.code, "not_found", label);
        for (const statement of ids.y.statements) assert.ok(!JSON.stringify(response.body).includes(statement));
      }
      const yEngagement = await adminPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([ids.x.usableClaimId], "client-admin-foreign-engagement", PROJECT_Y));
      assert.equal(yEngagement.body.error?.code, "tenant_boundary_violation", JSON.stringify(yEngagement.body));
      const yClaim = await adminPage.api("POST", createImpactNarrativePath(ORG_X), DRAFT_BODY([ids.y.claimId], "client-admin-foreign-claim"));
      assert.equal(yClaim.body.ok, false, JSON.stringify(yClaim.body));
      assert.notEqual(yClaim.status, 201);
      for (const response of [yEngagement, yClaim]) {
        for (const statement of ids.y.statements) assert.ok(!JSON.stringify(response.body).includes(statement));
      }
      assert.deepEqual(await counts(ORG_X), beforeX, "nothing written in X");
      assert.deepEqual(await counts(ORG_Y), beforeY, "nothing written in Y");
      results.c = `PASS: Y 403 x${inY.length} (incl. P2-04); foreign source/evidence/claim 404; foreign engagement ${yEngagement.status} tenant_boundary_violation; foreign claim draft ${yClaim.status} ${yClaim.body.error?.code}`;
    });

    // --- D. protected operations ---------------------------------------------
    await test("D: the client_admin cannot reach funder or other generators, GK review decisions, review packets, the GK source review list, funder P2-06 traceability or the GK traceability DTO, follow-up answers, or coverage acceptance", async () => {
      const before = await counts(ORG_X);
      const evidenceQueue = (await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_id = $2::uuid", [ORG_X, ids.x.usableEvidenceId]))[0];
      const claimQueue = (await query("SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid", [ORG_X, ids.x.usableClaimId]))[0];
      const protectedRequests = [
        ["funder evidence summary", "POST", createFunderEvidenceSummaryPath(ORG_X), DRAFT_BODY([ids.x.usableClaimId], "client-admin-funder")],
        ["readiness assessment", "POST", createReadinessAssessmentPath(ORG_X), DRAFT_BODY([ids.x.usableClaimId], "client-admin-readiness")],
        ["data gap memo", "POST", createDataGapMemoPath(ORG_X), { idempotency_key: "client-admin-gap-memo", engagement_id: PROJECT_X }],
        ["GK review packet", "GET", generatedDraftReviewPacketPath(ORG_X, ids.x.draftIds[0])],
        // P1-08 promotion is admitted for this binding-derived administrator
        // (owner decision 2026-10-18; kai-client-admin-source-promotion acceptance);
        // the GK source review list stays GK-only.
        ["GK source review queue", "GET", `/api/kai/sprint2/intake/admin/review-cockpit/queue?organization_id=${ORG_X}&queue_type=source_candidate_review&queue_status=open`],
        // Owner authorization 2026-10-24: internal reads return only the client-safe diagnostic (below).
        ["P2-06 funder traceability read", "GET", claimTraceabilityPath(ORG_X, ids.x.usableClaimId, "funder")],
        ["client follow-up list", "GET", `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/client-followups`],
      ];
      // Owner authorization 2026-10-24: the administrator's own evidence,
      // claim, and internal coverage decisions are admitted only for an
      // ordinary record-count measurement; this field-presence evidence stays
      // Get Kinder's, refused before any write.
      const organizationDecisions = [
        ["evidence review decision", "POST", evidenceReviewCompletePath(ORG_X, ids.x.usableEvidenceId, evidenceQueue.review_queue_item_id),
          evidenceReviewDecisionBody({ expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported" })],
        ["claim review decision", "POST", claimReviewCompletePath(ORG_X, ids.x.usableClaimId, claimQueue.review_queue_item_id),
          claimReviewDecisionBody({ expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"] })],
        ["P2-10 internal coverage limitation acceptance", "POST", coverageInternalAcceptancePath(ORG_X, ids.x.usableClaimId, ids.x.gapDimensionKey), {}],
      ];
      if (ids.x.followup) {
        const [followupQueue] = await query("SELECT updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'client_followup' AND target_object_id = $2::uuid", [ORG_X, ids.x.followup.client_followup_item_id]);
        protectedRequests.push(["P2-11 client follow-up completion", "POST",
          `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/claims/${ids.x.usableClaimId}/client-followups/${ids.x.followup.client_followup_item_id}/complete`,
          { expected_updated_at: new Date(followupQueue.updated_at).toISOString() }]);
      }
      const outcomes = {};
      for (const [label, method, path, body] of protectedRequests) {
        const response = await adminPage.api(method, path, body);
        assert.equal(response.status, 403, `${label}: ${response.status} ${JSON.stringify(response.body)}`);
        assert.equal(response.body.error.code, "authorization_denied", label);
        outcomes[label] = response.body.blockers?.[0]?.blocking_reason || response.body.error.code;
      }
      for (const [label, method, path, body] of organizationDecisions) {
        const response = await adminPage.api(method, path, body);
        assert.ok([409, 422].includes(response.status), `${label}: ${response.status} ${JSON.stringify(response.body)}`);
        if (response.status === 409) assert.ok(["evidence_review_unresolved", "human_review_incomplete", "conflict_current_state_changed"].includes(response.body.error.code), label);
        if (response.status === 422) {
          assert.deepEqual(response.body.blockers?.map((b) => b.blocking_reason), ["evidence_type_requires_get_kinder_review"], label);
        }
        outcomes[label] = response.body.blockers?.[0]?.blocking_reason || response.body.error.code;
      }
      assert.equal(outcomes["evidence review decision"], "evidence_type_requires_get_kinder_review");
      const diagnostic = await adminPage.api("GET", claimTraceabilityPath(ORG_X, ids.x.usableClaimId, "internal"));
      if (diagnostic.status === 200) {
        assert.equal(diagnostic.body.data.view, "organization_internal_traceability_diagnostic", JSON.stringify(diagnostic.body));
        assert.deepEqual(Object.keys(diagnostic.body.data).sort(), ["blocked", "blocker_codes", "claim_id", "eligible", "requested_audience", "traceability_conflict_reason", "traceability_passed", "view"]);
      } else {
        assert.equal(diagnostic.status, 409, JSON.stringify(diagnostic.body));
        assert.deepEqual(Object.keys(diagnostic.body.data || {}), ["traceability_conflict_reason"]);
      }
      for (const field of ["graph_relationships", "evidence", "source_version", "claim_review_decision", "potential_conflict_groups", "statement"]) {
        assert.equal(JSON.stringify(diagnostic.body).includes(`"${field}"`), false, field);
      }
      outcomes["P2-06 internal traceability diagnostic"] = diagnostic.status === 200 ? diagnostic.body.data.view : diagnostic.body.data.traceability_conflict_reason;
      assert.deepEqual(await counts(ORG_X), before, "no protected write");
      const followupStates = await query("SELECT DISTINCT queue_status, review_status FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'client_followup'", [ORG_X]);
      assert.deepEqual(followupStates, [{ queue_status: "waiting_on_client", review_status: "proposed" }], "every follow-up is still open");
      results.d = outcomes;
    });

    await test("D: client_contributor gets no Data Sources tab and is refused the workflow writes and reads, including P2-04", async () => {
      await contributorPage.goto("/impact-library");
      await contributorPage.waitForText("Knowledge Studio");
      await contributorPage.clickNav("Knowledge Studio");
      await contributorPage.waitFor(async () => contributorPage.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
      await contributorPage.idle();
      assert.ok(!(await contributorPage.tabLabels()).includes("Data Sources"));
      const before = await counts(ORG_X);
      for (const [method, path, body] of [
        ["GET", organizationSourcesPath(ORG_X)],
        ["GET", evidenceLibraryCandidatesPath(ORG_X)],
        ["GET", claimLibraryCandidatesPath(ORG_X)],
        ["POST", evidenceExtractionPath(ORG_X, ids.x.sourceVersionId), {}],
        ["POST", claimProposalPath(ORG_X, ids.x.usableEvidenceId), {}],
        ["POST", claimGapFollowupsPath(ORG_X, ids.x.usableClaimId), {}],
        ["POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([ids.x.usableClaimId], "contributor-summary")],
        ["POST", createImpactNarrativePath(ORG_X), DRAFT_BODY([ids.x.usableClaimId], "contributor-narrative")],
      ]) {
        const response = await contributorPage.api(method, path, body);
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.body.blockers[0].blocking_reason, "role_not_allowed");
      }
      assert.deepEqual(await counts(ORG_X), before);
      assert.deepEqual(contributorPage.exceptions, []);
    });

    await test("D: client_reviewer gets no Data Sources tab or P2-04, and keeps its own follow-up list over the client_admin-generated follow-ups", async () => {
      await reviewerPage.goto("/impact-library");
      await reviewerPage.waitForText("Knowledge Studio");
      await reviewerPage.clickNav("Knowledge Studio");
      await reviewerPage.waitFor(async () => reviewerPage.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
      await reviewerPage.idle();
      assert.ok(!(await reviewerPage.tabLabels()).includes("Data Sources"));
      const capabilities = await reviewerPage.api("GET", organizationAccessCapabilitiesPath(ORG_X));
      assert.equal(capabilities.status, 200, JSON.stringify(capabilities.body));
      assert.equal(capabilities.body.data.workflowOperations.generateClaimGapFollowups, false);
      const before = await counts(ORG_X);
      const denied = await reviewerPage.api("POST", claimGapFollowupsPath(ORG_X, ids.x.usableClaimId), {});
      assert.deepEqual([denied.status, denied.body.error.code, denied.body.blockers[0].blocking_reason], [403, "authorization_denied", "role_not_allowed"]);
      assert.deepEqual(await counts(ORG_X), before);
      const list = await reviewerPage.api("GET", `/api/kai/sprint2/intake/admin/organizations/${ORG_X}/client-followups`);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      if (ids.x.followup) assert.ok(JSON.stringify(list.body).includes(ids.x.followup.client_followup_item_id), "the client_reviewer's existing follow-up read is unchanged");
      assert.deepEqual(reviewerPage.exceptions, []);
    });

    // --- E. claim eligibility and draft governance -----------------------------
    await test("E: internal generation requires explicit claim ids; a reviewed_not_supported claim is refused before generation even though its P2-04 ran", async () => {
      const before = await counts(ORG_X);
      const modelCallsBefore = modelCalls.length;
      const empty = await adminPage.api("POST", createEvidenceSummaryPath(ORG_X), DRAFT_BODY([], "client-admin-empty-claims"));
      assert.equal(empty.status, 422, JSON.stringify(empty.body));
      assert.equal(empty.body.error.code, "validation_blocker");
      for (const [path, key] of [[createEvidenceSummaryPath(ORG_X), "client-admin-rejected-summary"], [createImpactNarrativePath(ORG_X), "client-admin-rejected-narrative"]]) {
        const rejected = await adminPage.api("POST", path, DRAFT_BODY([ids.x.rejectedClaimId], key));
        assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
        assert.equal(rejected.body.error.code, "claim_reviewed_not_supported");
      }
      assert.equal(modelCalls.length, modelCallsBefore, "no generator call for a refused request");
      assert.deepEqual(await counts(ORG_X), before);
      // The persisted drafts stay internal, unreviewed drafts.
      const states = await query("SELECT DISTINCT requested_audience, draft_status, review_status FROM kai.generated_content_drafts WHERE organization_id = $1::uuid", [ORG_X]);
      assert.deepEqual(states, [{ requested_audience: "internal", draft_status: "draft", review_status: "needs_gk_review" }]);
      results.e = "PASS";
    });

    // --- R. revoked authority ------------------------------------------------
    await test("R: a deactivated Get Kinder administrator membership, then an inactive binding, give no P2-04 authority and write nothing", async () => {
      const before = await counts(ORG_X);
      const path = claimGapFollowupsPath(ORG_X, ids.x.usableClaimId);
      await query("UPDATE public.user_org_memberships SET is_active = false WHERE org_id = $1 AND user_id = $2", [gkOrganization.id, USERS.clientAdmin]);
      try {
        const revoked = await adminPage.api("POST", path, {});
        assert.deepEqual([revoked.status, revoked.body.error.code, revoked.body.blockers[0].blocking_reason], [403, "authorization_denied", "missing_active_organization_membership"], JSON.stringify(revoked.body));
      } finally {
        await query("UPDATE public.user_org_memberships SET is_active = true WHERE org_id = $1 AND user_id = $2", [gkOrganization.id, USERS.clientAdmin]);
      }
      await query("UPDATE kai.gk_organization_bindings SET status = 'inactive' WHERE gk_organization_id = $1", [gkOrganization.id]);
      try {
        const unbound = await adminPage.api("POST", path, {});
        assert.deepEqual([unbound.status, unbound.body.error.code, unbound.body.blockers[0].blocking_reason], [403, "authorization_denied", "missing_active_organization_membership"], JSON.stringify(unbound.body));
      } finally {
        await query("UPDATE kai.gk_organization_bindings SET status = 'active' WHERE gk_organization_id = $1", [gkOrganization.id]);
      }
      const restored = await adminPage.api("POST", path, {});
      assert.deepEqual([restored.status, restored.body.data?.replayed], [200, true], "restored authority replays, proving the denials were authority-only");
      assert.deepEqual(await counts(ORG_X), before, "no write");
      results.r = "PASS: revoked membership 403; inactive binding 403; restored replay 200";
    });

    console.log(`[client-admin-workflow-browser] results ${JSON.stringify(results)}`);
    console.log(`[client-admin-workflow-browser] model substitution calls ${modelCalls.length}`);
  } finally {
    await gkPage.close().catch(() => {});
    await adminPage.close().catch(() => {});
    await contributorPage.close().catch(() => {});
    await reviewerPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
