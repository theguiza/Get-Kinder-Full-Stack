import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the client Knowledge Studio intake -> review ->
 * evidence continuity (Processing & evidence status, explanatory Evidence
 * empty states, client Reviews), run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-client-evidence-pipeline-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: every KAI router/service/read model on the runner cluster,
 * resolveKaiActorContext with real memberships, the built frontend bundle, a
 * real headless Chrome over the DevTools protocol, and every governed step
 * the fixture advances (P1-06 sensitivity review queue item, Phase-5
 * sensitivity decision, P2-01 evidence extraction, P2-12 evidence review,
 * P2-03 claim proposal, P2-04 follow-ups, claim review, coverage
 * acceptance, P2-11 client follow-up completion, and the parser-run
 * repository for the failed-processing file).
 * Simulated: the Get Kinder session login (req.user from a harness cookie),
 * the runner's synthetic kai.intake_batches / kai.intake_files mirrors, and
 * the repository smoke seeds (file 1's P1-03..P1-05 lineage and its seeded
 * P1-08 promotion). The smoke seed leaves file 1 at the default
 * file_policy_status 'pending' although its parser lineage exists; the
 * fixture sets 'passed' to make that seed consistent.
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

test("evidence pipeline browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("client evidence pipeline browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as the other client Knowledge Studio acceptance specs, plus
// Fetch-domain control of the pipeline read (delay / fail).
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-evidence-pipeline");
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
  // An isolated browser context per actor: the harness login cookie is
  // per-context, so two actors never share a session.
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  // Fetch-domain control: `pipelineInterceptor(pausedEvent)` decides per
  // paused pipeline request: "continue", "fail", or "hold".
  let pipelineInterceptor = null;
  const held = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false, requestId: params.requestId };
      requests.push(entry);
      byId.set(params.requestId, entry);
    } else if (method === "Network.responseReceived" && byId.has(params.requestId)) {
      byId.get(params.requestId).status = params.response.status;
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && byId.has(params.requestId)) {
      byId.get(params.requestId).done = true;
    } else if (method === "Runtime.exceptionThrown") {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
    } else if (method === "Fetch.requestPaused") {
      const decision = pipelineInterceptor ? pipelineInterceptor(params) : "continue";
      if (decision === "hold") held.push(params.requestId);
      else if (decision === "fail") browser.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" }, sessionId).catch(() => {});
      else browser.send("Fetch.continueRequest", { requestId: params.requestId }, sessionId).catch(() => {});
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
  const idle = async ({ allowHeld = false } = {}) => {
    let quietSince = Date.now();
    for (let i = 0; i < 400; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const open = requests.filter((request) => !request.done);
      if (open.length > (allowHeld ? held.length : 0)) quietSince = Date.now();
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
    .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`);
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
  // Text of the Files tab's per-file pipeline entry.
  const pipelineFileText = (intakeFileId) => evaluate(`(() => {
    const el = document.querySelector('[data-pipeline-file="${intakeFileId}"]');
    return el ? el.innerText : null;
  })()`);
  const linkHrefs = () => evaluate(`[...document.querySelectorAll("a")].filter((a) => a.offsetParent !== null).map((a) => [a.innerText.trim(), a.getAttribute("href")])`);
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
    selectProject,
    pipelineFileText,
    linkHrefs,
    async interceptPipeline(interceptor) {
      pipelineInterceptor = interceptor;
      if (interceptor) {
        await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*client-evidence-pipeline*", requestStage: "Response" }] }, sessionId);
      } else {
        await browser.send("Fetch.disable", {}, sessionId);
      }
    },
    heldCount: () => held.length,
    async releaseHeld() {
      while (held.length) {
        await browser.send("Fetch.continueRequest", { requestId: held.shift() }, sessionId);
      }
    },
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
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { recordSensitivityAllowedUseDecision } = await import("../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { acceptInternalCoverageLimitation, acceptFunderCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { createPostgresParserRunRepository } = await import("../Backend/kai/parsing/postgresParserRunRepository.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const now = () => new Date().toISOString();
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  // The organization, file 1, and file 1's lineage (parser run, profile
  // 50..01, dictionary 60..01, sensitivity profile 80..01, candidate 90..01
  // and its promoted source/source_version) are the repository smoke seeds.
  const ORG = "00000000-0000-4000-8000-000000000001";
  const PROJECT = Object.freeze({
    alpha: "7c000000-0000-4000-8000-00000000a1f0",
    beta: "7c000000-0000-4000-8000-00000000b2f0",
    gamma: "7c000000-0000-4000-8000-00000000c3f0",
  });
  const BATCH = Object.freeze({ alpha: "10000000-0000-4000-8000-000000000001", beta: "10000000-0000-4000-8000-0000000000c2" });
  const FILE = Object.freeze({
    alpha: "20000000-0000-4000-8000-000000000001",
    betaQueued: "20000000-0000-4000-8000-0000000000c1",
    betaFailed: "20000000-0000-4000-8000-0000000000c2",
  });
  const SENSITIVITY_A = "80000000-0000-4000-8000-000000000001";
  const NAMES = Object.freeze({ alpha: "gate-a-one.pdf", betaQueued: "beta-queued-outcomes.csv", betaFailed: "beta-unreadable-roster.csv" });
  const USERS = Object.freeze({ clientAdmin: 901, clientReviewer: 902, gkReviewer: 903, gkOperator: 904 });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG]);
  for (const [engagementId, code] of [[PROJECT.alpha, "Project Alpha"], [PROJECT.beta, "Project Beta"], [PROJECT.gamma, "Project Gamma"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, ORG, code]);
  }
  const kaiUserIds = {};
  for (const [legacyId, role] of [
    [USERS.clientAdmin, "client_admin"],
    [USERS.clientReviewer, "client_reviewer"],
    [USERS.gkReviewer, "gk_reviewer"],
    [USERS.gkOperator, "gk_operator"],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[role] = kaiUser.user_id;
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [ORG, kaiUser.user_id, role]);
  }
  // Service-level actors for the governed steps the fixture advances (the
  // same membership shape resolveKaiActorContext produces).
  const serviceActor = (role) => ({
    actorType: "human",
    actorUserId: kaiUserIds[role],
    source: "public.userdata",
    kaiRoles: [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  });
  const gkReviewer = serviceActor("gk_reviewer");
  const gkOperator = serviceActor("gk_operator");
  const clientReviewerService = serviceActor("client_reviewer");

  // Batches (runner mirror) and files.
  for (const [batchId, engagementId, code] of [[BATCH.alpha, PROJECT.alpha, "alpha-intake-2026"], [BATCH.beta, PROJECT.beta, "beta-intake-2026"]]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, ORG, engagementId, code]);
  }
  // File 1 joins Alpha through the real Gate A lifecycle edges; its verified
  // checksum is the one its seeded parser run is bound to.
  await query(`UPDATE kai.intake_files SET engagement_id = $2::uuid, mime_type = 'application/pdf', file_size_bytes = 1024,
                 malware_scan_status = 'clean', review_status = 'not_reviewed', file_policy_status = 'passed',
                 upload_state = 'upload_started', upload_state_changed_at = '2026-08-02T12:10:00Z'
               WHERE intake_file_id = $1::uuid`, [FILE.alpha, PROJECT.alpha]);
  await query(`UPDATE kai.intake_files SET upload_state = 'uploaded_unconfirmed', object_version_id = 'synthetic-v1',
                 upload_state_changed_at = '2026-08-02T12:20:00Z' WHERE intake_file_id = $1::uuid`, [FILE.alpha]);
  await query(`UPDATE kai.intake_files SET upload_state = 'confirmed', verified_checksum = checksum, verified_size_bytes = 1024,
                 verified_at = '2026-08-02T12:30:00Z', upload_state_changed_at = '2026-08-02T12:30:00Z' WHERE intake_file_id = $1::uuid`, [FILE.alpha]);
  for (const [fileId, name, checksumChar] of [[FILE.betaQueued, NAMES.betaQueued, "c"], [FILE.betaFailed, NAMES.betaFailed, "d"]]) {
    await query(`INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
                   checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
                   mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, repeat($6, 64), 'sha256', 'confirmed', 'synthetic-v1', repeat($6, 64), 512, now(),
                   'text/csv', 512, 'clean', 'not_reviewed', 'passed', now())`,
      [fileId, BATCH.beta, ORG, PROJECT.beta, name, checksumChar]);
  }
  // The Beta failure is a real parser-run failure through the P1-03
  // repository (queued -> running -> failed with the worker's safe code).
  const parserRuns = createPostgresParserRunRepository();
  const failedIdentity = { organizationId: ORG, intakeFileId: FILE.betaFailed, parserName: "kai_local_profiling_kernel", parserVersion: "1.0.0", checksum: "d".repeat(64) };
  const queued = await parserRuns.ensureQueuedParserRun({ identity: failedIdentity, now: now() });
  assert.equal(queued.ok, true, JSON.stringify(queued));
  const claimed = await parserRuns.claimQueuedParserRun({ identity: failedIdentity, now: now(), metadataOnlyAudit: noAudit() });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  const failed = await parserRuns.failParserRunSafely({
    identity: failedIdentity, parserRunId: claimed.data.run.parser_run_id, errorCode: "safe_parser_error",
    errorMessageSafe: "Deterministic profiling could not safely profile this file.", now: now(), metadataOnlyAudit: noAudit(),
  });
  assert.equal(failed.ok, true, JSON.stringify(failed));

  // --- governed steps (advanced between browser phases) -------------------
  async function recordReviewedSensitivityDecision() {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: SENSITIVITY_A, actorContext: gkOperator, now: now() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`, [ORG, SENSITIVITY_A]);
    const decided = await recordSensitivityAllowedUseDecision({
      organizationId: ORG,
      intakeSensitivityProfileId: SENSITIVITY_A,
      reviewQueueItemId: item.review_queue_item_id,
      expectedUpdatedAt: new Date(item.updated_at).toISOString(),
      decision: "reviewed",
      reviewedSnapshot: {
        reviewed_personal_data_status: "unknown",
        reviewed_minor_data_status: "unknown",
        reviewed_health_housing_justice_immigration_status: "unknown",
        reviewed_indigenous_governance_status: "unknown",
        reviewed_staff_notes_status: "unknown",
        reviewed_story_testimonial_status: "unknown",
        reviewed_small_cell_risk_status: "unknown",
        reviewed_financial_records_status: "unknown",
        reviewed_consent_basis_status: "present",
        reviewed_allowed_use_status: "allowed",
        reviewed_llm_processing_allowed: false,
        reviewed_product_learning_allowed: false,
        reviewed_public_use_allowed: false,
        reviewed_funder_use_allowed: true,
      },
      actorContext: gkReviewer,
      now: now(),
    }, { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(decided.ok, true, JSON.stringify(decided));
  }
  async function extractEvidence() {
    // Two more synthetic dictionary fields, so extraction yields separate
    // evidence items for two claims (the P14-09 recipe).
    for (const suffix of ["03", "04"]) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
           profile_field_key, field_label_safe, data_type, created_at)
         VALUES ($1::uuid, '60000000-0000-4000-8000-000000000001', $2::uuid, '50000000-0000-4000-8000-000000000001', $3, $3, 'number', now())
         ON CONFLICT DO NOTHING`,
        [`70000000-0000-4000-8000-0000000000${suffix}`, ORG, `field_${Number(suffix)}`],
      );
    }
    const [sourceVersion] = await query(
      `SELECT v.source_version_id FROM kai.source_versions v WHERE v.organization_id = $1::uuid AND v.is_current = true
         AND v.intake_sensitivity_profile_id = $2::uuid`, [ORG, SENSITIVITY_A]);
    const extracted = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: gkReviewer, now: now() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(extracted.ok, true, JSON.stringify(extracted));
  }
  async function reviewEvidence(evidenceItemId) {
    const [queue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review'
         AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`, [ORG, evidenceItemId]);
    const reviewed = await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId, reviewQueueItemId: queue.review_queue_item_id,
      expectedUpdatedAt: new Date(queue.updated_at).toISOString(), decision: "supported", actorContext: gkReviewer, now: now(),
    }, { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  }
  async function buildGovernedClaim({ completeFollowups }) {
    const [evidence] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items e WHERE organization_id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = e.organization_id AND c.evidence_item_id = e.evidence_item_id)
       ORDER BY evidence_item_id LIMIT 1`, [ORG]);
    const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: evidence.evidence_item_id, actorContext: gkReviewer, now: now() },
      { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    const claimId = proposed.data.claim.claim_id;
    assert.equal((await generateClaimGapFollowups({ organizationId: ORG, claimId, actorContext: gkReviewer, now: now() },
      { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
    await reviewEvidence(evidence.evidence_item_id);
    const [claimQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review'
         AND target_object_type = 'claim' AND target_object_id = $2::uuid`, [ORG, claimId]);
    assert.equal((await recordClaimReviewDecision({
      organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id, expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(),
      decision: "approved", approvedAudiences: ["internal", "funder"], actorContext: gkReviewer, now: now(),
    }, { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
    for (const [audience, accept] of [["internal", acceptInternalCoverageLimitation], ["funder", acceptFunderCoverageLimitation]]) {
      const traced = await getClaimTraceabilitySummary({ organizationId: ORG, claimId, requestedAudience: audience, actorContext: gkReviewer }, { env: ENV });
      assert.equal(traced.ok, true, JSON.stringify(traced));
      for (const [dimensionKey, value] of Object.entries(traced.data.dimensions)) {
        if (value.assessment_status !== "unresolved") continue;
        const accepted = await accept({ organizationId: ORG, claimId, dimensionKey, actorContext: gkReviewer, now: now() }, { env: ENV, metadataOnlyAudit: noAudit() });
        assert.equal(accepted.ok, true, JSON.stringify(accepted));
      }
    }
    if (completeFollowups) {
      const rows = await query(
        `SELECT cfi.client_followup_item_id, rq.updated_at FROM kai.client_followup_items cfi
           JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
            AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
          WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key`, [ORG, claimId]);
      for (const row of rows) {
        assert.equal((await completeClientFollowup({
          organizationId: ORG, claimId, clientFollowupItemId: row.client_followup_item_id,
          expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: clientReviewerService, now: now(),
        }, { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
      }
    }
    return claimId;
  }
  async function governedCounts() {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.intake_sensitivity_review_decisions)::int AS decisions,
      (SELECT count(*) FROM kai.intake_source_candidates)::int AS candidates,
      (SELECT count(*) FROM kai.intake_promotion_decisions)::int AS promotions,
      (SELECT count(*) FROM kai.evidence_items)::int AS evidence,
      (SELECT count(*) FROM kai.evidence_review_decisions)::int AS evidence_decisions,
      (SELECT count(*) FROM kai.claims)::int AS claims,
      (SELECT count(*) FROM kai.review_queue_items)::int AS queue_items,
      (SELECT count(*) FROM kai.intake_files)::int AS files`);
    return row;
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
  app.use("/api/kai/sprint2/access-administration", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, kaiAccessAdministrationApiRouter);
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

  const pipelinePath = (engagementId) => `/api/kai/sprint2/intake/admin/organizations/${ORG}/engagements/${engagementId}/client-evidence-pipeline`;
  const isPipeline = (engagementId) => (r) => r.method === "GET" && new URL(r.url).pathname === pipelinePath(engagementId);
  // GK-internal reads the client product must never issue. The one
  // review-cockpit path allowed is the pre-existing boolean capability probe
  // (always 200, no queue/profile/decision data) that the shell's Needs
  // Attention hook issues for every actor.
  const ALLOWED_PATHS = new Set(["/api/kai/sprint2/intake/admin/review-cockpit/capabilities"]);
  const GK_ONLY_FRAGMENTS = ["/review-cockpit", "/evidence-library", "/claim-library", "/eligible-claims", "/traceability",
    "/review-queue", "/sources", "/client-followups", "/evidence-items", "/source-versions", "/data-dictionaries"];
  const GK_CONTROLS = ["Record decision", "Promote", "Approve", "Reject", "Extract evidence", "Propose claim", "Sensitivity & allowed-use review", "Review cockpit"];
  function assertClientBoundary(page, label, body) {
    for (const r of page.requests()) {
      const path = new URL(r.url).pathname;
      if (ALLOWED_PATHS.has(path)) continue;
      for (const fragment of GK_ONLY_FRAGMENTS) assert.ok(!path.includes(fragment), `${label}: GK-only request ${r.method} ${path}`);
    }
    for (const control of GK_CONTROLS) assert.ok(!body.includes(control), `${label}: GK control visible: ${control}`);
  }

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.clickNav("Knowledge Studio");
    await page.waitFor(async () => page.evaluate(`Boolean(document.getElementById("gk-shell-project-select"))`), "project selector");
    await page.idle();
  }
  async function pipelineRead(page, engagementId, mark, label) {
    await page.idle();
    const reads = page.requestsSince(mark).filter(isPipeline(engagementId));
    assert.ok(reads.length >= 1, `${label}: pipeline read issued`);
    for (const r of reads) assert.equal(r.status, 200, `${label}: pipeline read status`);
  }

  const clientAdminPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdmin });
  const clientReviewerPage = await openPage(browser, { baseUrl, legacyUserId: USERS.clientReviewer });
  const results = {};
  try {
    await openKnowledgeStudio(clientAdminPage);
    await openKnowledgeStudio(clientReviewerPage);
    const page = clientAdminPage;
    // Each actor has its own browser context (cookie jar); prove the
    // server sees the intended role for each.
    for (const [label, p, followups, contribution] of [["client_admin", clientAdminPage, false, true], ["client_reviewer", clientReviewerPage, true, false]]) {
      const caps = await p.evaluate(`fetch("/api/kai/sprint2/intake/admin/organizations/${ORG}/access-capabilities", { credentials: "same-origin" }).then((r) => r.json())`);
      assert.equal(caps.data.clientFollowupReview, followups, `${label} clientFollowupReview`);
      assert.equal(caps.data.intakeContribution, contribution, `${label} intakeContribution`);
      assert.equal(caps.data.internalKnowledgeWorkspace, false, `${label} is a client actor`);
    }

    await test("case 1 + case 4: an uploaded Alpha file shows its authoritative stage, responsible party, and next action (waiting for Get Kinder review)", async () => {
      const before = await governedCounts();
      const mark = page.mark();
      await page.selectProject(PROJECT.alpha);
      await page.waitForText("Processing & evidence status");
      await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE.alpha)), "Alpha pipeline entry");
      await pipelineRead(page, PROJECT.alpha, mark, "case 1");
      const entry = await page.pipelineFileText(FILE.alpha);
      console.log(`[evidence-pipeline-browser] case 1 Alpha entry:\n${entry}`);
      assert.match(entry, new RegExp(NAMES.alpha.replace(".", "\\.")));
      for (const [label, status] of [["Uploaded", "Complete"], ["Security check", "Complete"], ["Processing", "Complete"], ["Data dictionary", "Complete"],
        ["Sensitivity classification", "Complete"], ["Sensitivity review", "Waiting for Get Kinder"], ["Source review", "Not available yet"],
        ["Evidence creation", "Not available yet"]]) {
        assert.match(entry, new RegExp(`${label}\\s+${status}`), `${label} -> ${status}`);
      }
      assert.match(entry, /Next action: No action required from you\. Waiting for Get Kinder sensitivity review\./);
      // The Files persistence surface is still present alongside the status.
      await page.waitForText(NAMES.alpha);
      const body = await page.text();
      assertClientBoundary(page, "case 1", body);
      await page.clickTab("Reviews");
      await page.waitForText("Waiting for Get Kinder review");
      const reviews = await page.text();
      assert.ok(reviews.includes("No action is currently required from you."), "client_admin has nothing to approve");
      assert.ok(reviews.includes(`${NAMES.alpha}: Sensitivity review (Waiting for Get Kinder)`));
      assertClientBoundary(page, "case 4", reviews);
      assert.deepEqual(await governedCounts(), before, "browsing wrote nothing");
      results.case1 = results.case4 = "PASS";
    });

    await test("case 2: with no reviewed Impact Fact, Evidence explains the upstream state instead of '0 shown / No reviewed evidence yet'", async () => {
      const mark = page.mark();
      await page.clickTab("Evidence");
      await page.waitForText("Your data has been processed and is waiting for Get Kinder review (1 file).");
      await pipelineRead(page, PROJECT.alpha, mark, "case 2");
      const body = await page.text();
      assert.ok(body.includes("No reviewed evidence for this project yet. Here is where its files are:"));
      assert.ok(!body.includes("No reviewed evidence yet for this organization."), "org-wide zero message not shown for a Project");
      assert.ok(!body.includes("0 shown"));
      assertClientBoundary(page, "case 2", body);
      // Gamma: no files -> "Upload data in Files".
      await page.selectProject(PROJECT.gamma);
      await page.waitForText("No files have been uploaded to this project yet, so there is no evidence to review.");
      await page.clickButton("Upload data in Files");
      await page.waitForText("No files have been uploaded to this project yet.");
      assert.ok(!(await page.text()).includes(NAMES.alpha), "no Alpha state under Gamma");
      results.case2 = "PASS";
    });

    await test("case 7: a real processing failure and a failed pipeline read render as failures, never as zero evidence", async () => {
      await page.selectProject(PROJECT.beta);
      await page.clickTab("Files");
      await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE.betaFailed)), "Beta failed entry");
      const failedEntry = await page.pipelineFileText(FILE.betaFailed);
      const queuedEntry = await page.pipelineFileText(FILE.betaQueued);
      console.log(`[evidence-pipeline-browser] case 7 Beta entries:\n${failedEntry}\n---\n${queuedEntry}`);
      assert.match(failedEntry, /Processing\s+Failed/);
      assert.match(failedEntry, /Processing failed: KAI could not read this file's contents\./);
      assert.match(failedEntry, /Next action: Contact Get Kinder\. Processing cannot be retried from here\./);
      assert.ok(!failedEntry.includes("Deterministic profiling"), "the stored parser message never reaches the client");
      assert.match(queuedEntry, /Processing\s+Queued/);
      assert.match(queuedEntry, /KAI is processing this file\./);
      await page.clickTab("Evidence");
      await page.waitForText("1 file could not be processed. See Files for details.");
      assert.ok((await page.text()).includes("1 file is still being processed by KAI."));
      // Read failure: the pipeline request itself fails.
      await page.interceptPipeline(() => "fail");
      try {
        await page.clickTab("Files");
        await page.waitForText("Processing status could not be loaded.");
        await page.clickTab("Evidence");
        await page.waitForText("evidence status could not be loaded. This does not mean the project has no evidence.");
        const body = await page.text();
        assert.ok(!body.includes("0 shown") && !body.includes("No reviewed evidence"), "a failed read is not zero evidence");
      } finally {
        await page.interceptPipeline(null);
      }
      results.case7 = "PASS";
    });

    await test("case 6: Project isolation - Alpha status, files, and evidence disappear on Beta, and a late Alpha response never repopulates Beta", async () => {
      await page.clickTab("Files");
      await page.selectProject(PROJECT.alpha);
      await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE.alpha)), "Alpha entry");
      await page.waitForText(NAMES.alpha);
      // Plain switch.
      let mark = page.mark();
      await page.selectProject(PROJECT.beta);
      await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE.betaFailed)), "Beta entry after switch");
      await page.idle();
      let body = await page.text();
      assert.equal(await page.pipelineFileText(FILE.alpha), null, "Alpha pipeline status gone");
      assert.ok(!body.includes(NAMES.alpha), "Alpha files gone");
      assert.equal(page.requestsSince(mark).filter(isPipeline(PROJECT.alpha)).length, 0, "no Alpha pipeline read after Beta is authoritative");
      // Late Alpha response: hold Alpha's pipeline response, switch to Beta,
      // then release it.
      await page.interceptPipeline((params) => (params.request.url.includes(PROJECT.alpha) ? "hold" : "continue"));
      try {
        await page.selectProject(PROJECT.alpha);
        await page.waitFor(async () => page.heldCount() === 1, "Alpha pipeline response held");
        await page.selectProject(PROJECT.beta);
        await page.waitFor(async () => Boolean(await page.pipelineFileText(FILE.betaFailed)), "Beta entry while Alpha is held");
        await page.idle({ allowHeld: true });
        await page.releaseHeld();
        await page.idle();
        await new Promise((r) => setTimeout(r, 500));
        body = await page.text();
        assert.equal(await page.pipelineFileText(FILE.alpha), null, "late Alpha response did not repopulate Beta status");
        assert.ok(!body.includes(NAMES.alpha), "late Alpha response did not repopulate Beta files");
        assert.ok(body.includes(NAMES.betaFailed) && body.includes(NAMES.betaQueued), "Beta still shown");
      } finally {
        await page.releaseHeld();
        await page.interceptPipeline(null);
      }
      await page.clickTab("Evidence");
      await page.waitForText("1 file could not be processed.");
      body = await page.text();
      assert.ok(!body.includes("waiting for Get Kinder review (1 file)"), "Alpha evidence explanation gone under Beta");
      results.case6 = "PASS";
    });

    await test("governed progression: Alpha's reviewed sensitivity decision, then evidence extraction, each move the client-visible stage", async () => {
      await recordReviewedSensitivityDecision();
      await page.selectProject(PROJECT.alpha);
      await page.waitForText("The source from 1 file has been promoted. Get Kinder has not yet created evidence from it.");
      await extractEvidence();
      await page.clickTab("Files");
      await page.clickTab("Evidence");
      await page.waitForText("Evidence has been created from 1 file and is waiting for Get Kinder evidence review.");
      assert.ok(!(await page.text()).includes("Get Kinder has not yet created evidence"));
    });

    let eligibleStatement = "";
    await test("case 5 + case 3: reviewed Impact Fact renders under Evidence; the client reviewer sees the follow-up action and no GK control", async () => {
      await buildGovernedClaim({ completeFollowups: true });
      await buildGovernedClaim({ completeFollowups: false });
      // Evidence review for every remaining extracted item (real P2-12).
      for (const { evidence_item_id: id } of await query(
        "SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_review_status = 'needs_gk_review' ORDER BY evidence_item_id", [ORG])) {
        await reviewEvidence(id);
      }
      [{ statement: eligibleStatement }] = await query(
        `SELECT c.statement FROM kai.claims c WHERE c.organization_id = $1::uuid
           AND NOT EXISTS (SELECT 1 FROM kai.client_followup_items cf JOIN kai.review_queue_items rq ON rq.organization_id = cf.organization_id
             AND rq.queue_type = 'client_followup' AND rq.target_object_id = cf.client_followup_item_id
            WHERE cf.claim_id = c.claim_id AND rq.queue_status NOT IN ('resolved', 'cancelled'))`, [ORG]);
      const before = await governedCounts();

      // client_admin: Evidence shows the reviewed fact and the client wait.
      await page.clickTab("Files");
      const mark = page.mark();
      await page.clickTab("Evidence");
      await page.waitForText(eligibleStatement);
      await pipelineRead(page, PROJECT.alpha, mark, "case 5");
      let body = await page.text();
      console.log(`[evidence-pipeline-browser] case 5 Evidence (client_admin):\n${body.slice(body.indexOf("Reviewed evidence"), body.indexOf("Reviewed evidence") + 900)}`);
      assert.ok(body.includes("1 shown"));
      assert.ok(body.includes("Reviewed for internal use"));
      assert.ok(body.includes("1 file need an answer from a client reviewer in your organization before evidence can be used."));
      assertClientBoundary(page, "case 5 client_admin", body);
      await page.clickTab("Reviews");
      await page.waitForText("are waiting for a client");
      body = await page.text();
      assert.ok(body.includes("No action is currently required from you."));
      assert.ok(!(await page.linkHrefs()).some(([, href]) => href === "/kai/client-followups"), "client_admin gets no follow-up action");
      results.case5 = "PASS";

      // client_reviewer: the authorized follow-up action.
      const reviewer = clientReviewerPage;
      await reviewer.selectProject(PROJECT.alpha);
      await reviewer.waitFor(async () => Boolean(await reviewer.pipelineFileText(FILE.alpha)), "reviewer Alpha entry");
      const entry = await reviewer.pipelineFileText(FILE.alpha);
      assert.match(entry, /Impact Fact review\s+Waiting for your organization/);
      assert.match(entry, /Next action: Answer the follow-up questions Get Kinder sent about this file's evidence\./);
      assert.match(entry, /Reviewed evidence from this file: 1/);
      await reviewer.clickTab("Reviews");
      await reviewer.waitForText("Your action is needed");
      body = await reviewer.text();
      assert.ok(body.includes("Get Kinder sent follow-up questions about evidence from 1 file in this project."));
      assert.ok((await reviewer.linkHrefs()).some(([label, href]) => label === "Answer follow-up questions" && href === "/kai/client-followups"));
      assertClientBoundary(reviewer, "case 3 client_reviewer", body);
      await reviewer.clickTab("Evidence");
      await reviewer.waitForText(eligibleStatement);
      assert.deepEqual(await governedCounts(), before, "browsing wrote nothing");
      results.case3 = "PASS";

      // The Alpha fact is Project-scoped: it is not shown under Beta.
      await page.clickTab("Evidence");
      await page.selectProject(PROJECT.beta);
      await page.waitForText("1 file could not be processed.");
      assert.ok(!(await page.text()).includes(eligibleStatement), "Alpha evidence gone under Beta");
    });

    for (const p of [clientAdminPage, clientReviewerPage]) assert.deepEqual(p.exceptions, [], "page exceptions");
    console.log(`[evidence-pipeline-browser] results ${JSON.stringify(results)}`);
  } finally {
    await clientAdminPage.close().catch(() => {});
    await clientReviewerPage.close().catch(() => {});
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
