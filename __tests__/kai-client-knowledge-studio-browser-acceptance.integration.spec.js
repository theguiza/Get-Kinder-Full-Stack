import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser acceptance of the client Knowledge Studio, run only by
 * scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js
 * against its ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: governed state (seeded through the real services), every KAI router,
 * service, repository, and evaluator (ambient pool on the runner cluster),
 * resolveKaiActorContext with real memberships, the built frontend bundle,
 * and a real headless Chrome driven over the DevTools protocol.
 * Simulated: only the Get Kinder session login (req.user from a harness
 * cookie on this loopback app, as the route tests set req.user).
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

test("browser acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("client Knowledge Studio browser acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runBrowserAcceptance();
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket).
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile");
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
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document" && params.request.url.includes("/api/")) {
      requests.set(params.requestId, { url: params.request.url, method: params.request.method, status: null, done: false });
    } else if (method === "Network.responseReceived" && requests.has(params.requestId)) {
      requests.get(params.requestId).status = params.response.status;
    } else if ((method === "Network.loadingFinished" || method === "Network.loadingFailed") && requests.has(params.requestId)) {
      requests.get(params.requestId).done = true;
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
    for (let i = 0; i < 300; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if ([...requests.values()].some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 400) return;
    }
    throw new Error("network never went idle");
  };
  const waitForText = async (needle, { timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await text()).includes(needle)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for text: ${needle}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const click = async (label, { exact = true, within = null } = {}) => {
    const clicked = await evaluate(`(() => {
      const root = ${within ? `document.querySelector(${JSON.stringify(within)})` : "document"};
      if (!root) return false;
      const candidates = [...root.querySelectorAll("button, a, [role=button]")].filter((el) => el.offsetParent !== null);
      const match = candidates.find((el) => ${exact ? `el.innerText.trim() === ${JSON.stringify(label)}` : `el.innerText.includes(${JSON.stringify(label)})`});
      if (!match) return false;
      match.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`no visible control labelled ${label}\n--- page ---\n${(await text()).slice(0, 2000)}`);
  };
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
  const buttons = () => evaluate(`[...document.querySelectorAll("button, a")].filter((el) => el.offsetParent !== null).map((el) => el.innerText.trim()).filter(Boolean)`);
  return {
    sessionId,
    // Every request this page made (never cleared), and a windowed view.
    requests: () => [...requests.values()],
    mark: () => requests.size,
    requestsSince: (mark) => [...requests.values()].slice(mark),
    exceptions,
    evaluate,
    text,
    idle,
    waitForText,
    click,
    selectProject,
    buttons,
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
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { acceptInternalCoverageLimitation, acceptFunderCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { evaluateClaimTraceabilityInTransaction } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const {
    proposeEngagementRequirementSetApplicability,
    approveEngagementRequirementSetApplicability,
  } = await import("../Backend/kai/services/kaiEngagementRequirementApplicabilityService.js");
  const { assessEngagementRequirement } = await import("../Backend/kai/services/kaiEngagementRequirementAssessmentService.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const kaiAccessAdministrationApiRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-0000000000f2";
  const NOW = new Date().toISOString();
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const PROJECT = Object.freeze({
    alpha: "7a000000-0000-4000-8000-00000000a1f0",
    beta: "7a000000-0000-4000-8000-00000000b2f0",
    gamma: "7a000000-0000-4000-8000-00000000c3f0",
  });
  const USERS = Object.freeze({ admin: 701, reviewer: 702, contributor: 703, foreign: 704 });
  const gk = (role, id) => ({
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-0000000009${id}`,
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  });
  const gkReviewer = gk("gk_reviewer", "01");
  const gkOperator = gk("gk_operator", "02");
  const clientReviewerService = gk("client_reviewer", "03");
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  // --- organization, projects, users, memberships -------------------------
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG]);
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Foreign Synthetic Org', 'foreign-synthetic')`, [OTHER_ORG]);
  const ALPHA_TARGET = { target_funder_id: "city_impact_fund", target_framework: "annual_outcomes_v1", reporting_period_start: "2026-01-01", reporting_period_end: "2026-12-31" };
  const BETA_TARGET = { target_funder_id: "harbour_foundation", target_framework: "community_v2" };
  for (const [engagementId, code, target] of [
    [PROJECT.alpha, "Project Alpha", ALPHA_TARGET],
    [PROJECT.beta, "Project Beta", BETA_TARGET],
    [PROJECT.gamma, "Project Gamma", null],
  ]) {
    await query(
      "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)",
      [engagementId, ORG, code, JSON.stringify(target ? { engagement_requirement_target: target } : {})],
    );
  }
  for (const [legacyId, organizationId, role] of [
    [USERS.admin, ORG, "client_admin"],
    [USERS.reviewer, ORG, "client_reviewer"],
    [USERS.contributor, ORG, "client_contributor"],
    [USERS.foreign, OTHER_ORG, "client_admin"],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [organizationId, kaiUser.user_id, role]);
  }

  // --- governed claims (the P14-09 funder-authority recipe) ---------------
  for (const suffix of ["03", "04"]) {
    await query(
      `INSERT INTO kai.data_dictionary_fields (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
         profile_field_key, field_label_safe, data_type, created_at)
       VALUES ($1::uuid, '60000000-0000-4000-8000-000000000001', $2::uuid, '50000000-0000-4000-8000-000000000001', $3, $3, 'number', now())
       ON CONFLICT DO NOTHING`,
      [`70000000-0000-4000-8000-0000000000${suffix}`, ORG, `field_${Number(suffix)}`],
    );
  }
  async function traceDimensions(claimId, audience) {
    const traced = await getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience: audience, actorContext: gkReviewer },
      { env: ENV },
    );
    assert.equal(traced.ok, true, JSON.stringify(traced));
    return Object.entries(traced.data.dimensions).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k);
  }
  async function followupRows(claimId) {
    return query(
      `SELECT cfi.client_followup_item_id, rq.updated_at FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key`,
      [ORG, claimId],
    );
  }
  async function buildGovernedClaim({ completeFollowups }) {
    const [sourceVersion] = await query(
      "SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1", [ORG]);
    const extracted = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: gkReviewer, now: NOW },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(extracted.ok, true, JSON.stringify(extracted));
    const [evidence] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items e WHERE organization_id = $1::uuid
         AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = e.organization_id AND c.evidence_item_id = e.evidence_item_id)
       ORDER BY evidence_item_id LIMIT 1`, [ORG]);
    const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: evidence.evidence_item_id, actorContext: gkReviewer, now: NOW },
      { env: ENV, metadataOnlyAudit: noAudit() });
    assert.equal(proposed.ok, true, JSON.stringify(proposed));
    const claimId = proposed.data.claim.claim_id;
    assert.equal((await generateClaimGapFollowups({ organizationId: ORG, claimId, actorContext: gkReviewer, now: NOW },
      { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
    const [evidenceQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review'
         AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`, [ORG, evidence.evidence_item_id]);
    assert.equal((await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId: evidence.evidence_item_id, reviewQueueItemId: evidenceQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: gkReviewer, now: NOW,
    }, { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id FROM kai.evidence_items e JOIN kai.source_versions sv
         ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
        WHERE e.organization_id = $1::uuid AND e.evidence_item_id = $2::uuid`, [ORG, evidence.evidence_item_id]);
    let [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`, [ORG, lineage.intake_sensitivity_profile_id]);
    if (!sensitivityQueue) {
      [sensitivityQueue] = await query(
        `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status,
           summary, required_action, queue_metadata, created_by_type)
         VALUES ($1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid, 'medium', 'open', 'needs_gk_review',
           'Review sensitivity and allowed-use metadata.', 'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human')
         RETURNING review_queue_item_id`, [ORG, lineage.intake_sensitivity_profile_id]);
    }
    const [head] = await query(
      `SELECT d.decision_id FROM kai.intake_sensitivity_review_decisions d WHERE d.organization_id = $1::uuid AND d.intake_sensitivity_profile_id = $2::uuid
         AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, lineage.intake_sensitivity_profile_id]);
    await query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
         reviewed_personal_data_status, reviewed_minor_data_status, reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status, reviewed_financial_records_status,
         reviewed_consent_basis_status, reviewed_allowed_use_status, reviewed_llm_processing_allowed, reviewed_product_learning_allowed,
         reviewed_public_use_allowed, reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'reviewed', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown',
         'present', 'allowed', false, false, false, true, $4::uuid, 'gk_reviewer', $5::timestamptz, $6, 'human', now())`,
      [ORG, lineage.intake_sensitivity_profile_id, sensitivityQueue.review_queue_item_id, gkReviewer.actorUserId, NOW, head?.decision_id ?? null]);
    const [claimQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review'
         AND target_object_type = 'claim' AND target_object_id = $2::uuid`, [ORG, claimId]);
    assert.equal((await recordClaimReviewDecision({
      organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id, expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(),
      decision: "approved", approvedAudiences: ["internal", "funder"], actorContext: gkReviewer, now: NOW,
    }, { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
    for (const [audience, accept] of [["internal", acceptInternalCoverageLimitation], ["funder", acceptFunderCoverageLimitation]]) {
      for (const dimensionKey of await traceDimensions(claimId, audience)) {
        const accepted = await accept({ organizationId: ORG, claimId, dimensionKey, actorContext: gkReviewer, now: NOW }, { env: ENV, metadataOnlyAudit: noAudit() });
        assert.equal(accepted.ok, true, JSON.stringify(accepted));
      }
    }
    if (completeFollowups) {
      for (const row of await followupRows(claimId)) {
        assert.equal((await completeClientFollowup({
          organizationId: ORG, claimId, clientFollowupItemId: row.client_followup_item_id,
          expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: clientReviewerService, now: NOW,
        }, { env: ENV, metadataOnlyAudit: noAudit() })).ok, true);
      }
    }
    return { claimId, evidenceItemId: evidence.evidence_item_id };
  }
  async function realEvaluation(claimId, requestedAudience) {
    const client = await seedPool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await evaluateClaimTraceabilityInTransaction(client, { organizationId: ORG, claimId, requestedAudience });
      await client.query("COMMIT");
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.data;
    } finally {
      client.release();
    }
  }

  const eligible = await buildGovernedClaim({ completeFollowups: true });
  const held = await buildGovernedClaim({ completeFollowups: false });
  assert.equal((await realEvaluation(eligible.claimId, "internal")).eligible, true, "eligible claim is internal-eligible (real P2-06)");
  assert.equal((await realEvaluation(eligible.claimId, "funder")).eligible, true, "eligible claim is funder-eligible (real P2-06)");
  const heldEvaluation = await realEvaluation(held.claimId, "internal");
  assert.deepEqual([...new Set(heldEvaluation.blockerCodes)], ["client_followup_unresolved"]);
  const [{ statement: eligibleStatement }] = await query("SELECT statement FROM kai.claims WHERE claim_id = $1::uuid", [eligible.claimId]);

  // --- Funder Requirements (real applicability + assessment services) -----
  async function seedCatalogue({ sourceCode, sourceName, frameworkCode, frameworkName, requirements }) {
    const [{ requirement_source_id: sourceId }] = await query(
      "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('funder', $1, $2) RETURNING requirement_source_id", [sourceCode, sourceName]);
    const [{ requirement_framework_version_id: versionId }] = await query(
      `INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label, framework_status)
       VALUES ($1, $2, $3, 'v1', 'active') RETURNING requirement_framework_version_id`, [sourceId, frameworkCode, frameworkName]);
    const [{ requirement_set_id: setId }] = await query(
      "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, $2, $3) RETURNING requirement_set_id",
      [versionId, frameworkCode, frameworkName]);
    const ids = [];
    for (const [index, [key, label, description]] of requirements.entries()) {
      const [{ requirement_id: requirementId }] = await query(
        `INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, requirement_description, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING requirement_id`, [setId, key, label, description, index]);
      ids.push(requirementId);
    }
    return { setId, requirementIds: ids };
  }
  async function review(engagementId, setId, decision) {
    assert.equal((await proposeEngagementRequirementSetApplicability({ organizationId: ORG, engagementId, requirementSetId: setId, actorContext: gkOperator })).ok, true);
    assert.equal((await approveEngagementRequirementSetApplicability({ organizationId: ORG, engagementId, requirementSetId: setId, decision, actorContext: gkReviewer })).ok, true);
  }
  await query(
    `INSERT INTO kai.impact_outcome_contexts (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label, created_by_type)
     VALUES ($1::uuid, NULL, 'stable_employment', 'Participants gain stable employment.', 'participants', 'Program participants', 'human')`, [ORG]);
  const alphaCatalogue = await seedCatalogue({
    sourceCode: "city_impact_fund", sourceName: "City Impact Fund", frameworkCode: "annual_outcomes_v1", frameworkName: "Annual Outcomes",
    requirements: [
      ["ir_pur_001", "Intended outcomes are defined", "Each program states the change it intends."],
      ["ir_contrib_002", "Known limitations affecting confidence in a reported result are documented", null],
    ],
  });
  const betaCatalogue = await seedCatalogue({
    sourceCode: "harbour_foundation", sourceName: "Harbour Foundation", frameworkCode: "community_v2", frameworkName: "Community Framework",
    requirements: [["ir_stk_001", "Stakeholders are identified", null]],
  });
  await review(PROJECT.alpha, alphaCatalogue.setId, "applicable");
  await review(PROJECT.beta, betaCatalogue.setId, "not_applicable");
  const assessed = await assessEngagementRequirement(
    { organizationId: ORG, engagementId: PROJECT.alpha, requirementId: alphaCatalogue.requirementIds[0], actorContext: gkReviewer, now: NOW }, { env: ENV });
  assert.equal(assessed.ok, true, JSON.stringify(assessed));
  assert.equal(assessed.data.assessment_state, "satisfied");
  // The second Alpha requirement is left unassessed (not_yet_assessed).

  // --- generated drafts (real rows; GK review states set directly) ---------
  let draftCounter = 0;
  async function seedDraft({ prefix, engagementId, claim, text, audience = "internal", contentType = "evidence_summary", review: reviewState = "resolved" }) {
    draftCounter += 1;
    const n = String(draftCounter).padStart(4, "0");
    const id = (kind) => `${prefix}${kind}000000-0000-4000-8000-00000000${n}`;
    const draftId = id("d");
    await query(
      `INSERT INTO kai.generation_runs (generation_run_id, organization_id, engagement_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'system')`,
      [id("a"), ORG, engagementId, `browser-${n}`, n.repeat(16), contentType, audience]);
    await query(
      `INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, draft_status,
         review_status, validator_results, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'draft', 'needs_gk_review', '[]'::jsonb, 'system')`, [draftId, id("a"), ORG, contentType, audience]);
    await query("INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)",
      [id("b"), draftId, ORG, text]);
    await query(
      "INSERT INTO kai.generated_content_citations (generated_content_citation_id, generated_content_block_id, organization_id, claim_id, evidence_item_id) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)",
      [id("c"), id("b"), ORG, claim.claimId, claim.evidenceItemId]);
    const [queueStatus, reviewStatus] = reviewState === "resolved" ? ["resolved", "resolved"] : ["open", "needs_gk_review"];
    await query(
      `INSERT INTO kai.review_queue_items (review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id, priority, queue_status,
         review_status, assigned_to, due_at, summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, $2::uuid, 'generated_content_review', 'generated_content_draft', $3::uuid, 'medium', $4, $5, NULL, NULL,
         'Generated draft requires human review.',
         'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.', '{}'::jsonb, 'system')`,
      [id("e"), ORG, draftId, queueStatus, reviewStatus]);
    return draftId;
  }
  const TEXT = Object.freeze({
    alphaBoard: "Alpha internal summary: participants completed the program.",
    alphaFunder: "Alpha funder paragraph: outcomes for the City Impact Fund.",
    alphaHeld: "ALPHA HELD NARRATIVE awaiting a client answer.",
    alphaInReview: "ALPHA IN GK REVIEW TEXT.",
    beta: "Beta internal summary for the Harbour Foundation project.",
  });
  // Low ids (first page): the four Alpha cases; then 52 more reviewed Alpha
  // drafts so the list needs a second bounded page; then Beta.
  const alphaBoardDraft = await seedDraft({ prefix: "a", engagementId: PROJECT.alpha, claim: eligible, text: TEXT.alphaBoard });
  await seedDraft({ prefix: "a", engagementId: PROJECT.alpha, claim: eligible, text: TEXT.alphaFunder, audience: "funder" });
  const alphaHeldDraft = await seedDraft({ prefix: "a", engagementId: PROJECT.alpha, claim: held, text: TEXT.alphaHeld, contentType: "impact_narrative" });
  await seedDraft({ prefix: "a", engagementId: PROJECT.alpha, claim: eligible, text: TEXT.alphaInReview, review: "open" });
  for (let i = 0; i < 52; i += 1) {
    await seedDraft({ prefix: "b", engagementId: PROJECT.alpha, claim: eligible, text: `Alpha data gap memo ${i + 1}.`, contentType: "data_gap_memo" });
  }
  const betaDraft = await seedDraft({ prefix: "c", engagementId: PROJECT.beta, claim: eligible, text: TEXT.beta });
  const ALPHA_VISIBLE_COUNT = 2 + 52;

  // --- harness app ---------------------------------------------------------
  const publicDir = new URL("../public/", import.meta.url).pathname;
  const pageShell = (title, rootId, script) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>${title}</title>
    <link rel="stylesheet" href="/css/style.css" /><link rel="stylesheet" href="/css/gk-design-tokens.css" /></head>
    <body><div id="${rootId}"></div><script src="/js/bundles/entry.js"></script><script>${script}</script></body></html>`;
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
  app.get("/impact-library", (_req, res) => res.send(pageShell("Impact Library", "impact-evidence-library-root", "window.renderImpactEvidenceLibrary();")));
  app.get("/kai/client-followups", (_req, res) => res.send(pageShell(
    "KAI Client Follow-ups",
    "kai-client-followup-review-root",
    `window.renderKaiClientFollowupReview("#kai-client-followup-review-root", ${JSON.stringify({ organizationId: ORG })});`,
  )));
  app.use(express.static(publicDir));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChrome();

  // Client-safe routes the client UI may call (Packages 1-4), by path shape.
  const orgPath = `/api/kai/sprint2/intake/admin/organizations/${ORG}`;
  const ALLOWED_CLIENT_ROUTES = [
    /^\/api\/kai\/sprint2\/intake\/admin\/organizations$/,
    /^\/api\/kai\/sprint2\/intake\/admin\/organization-onboarding\/status$/,
    /^\/api\/kai\/sprint2\/intake\/admin\/organization-join\/requests\/mine$/,
    new RegExp(`^${orgPath}/(profile|engagements|access-capabilities|impact-home/summary|impact-facts|improvement-practices|client-followups)$`),
    /^\/api\/kai\/sprint2\/intake\/admin\/review-cockpit\/capabilities$/,
    /^\/api\/kai\/sprint2\/intake\/admin\/batches$/,
    new RegExp(`^${orgPath}/engagements/[0-9a-f-]{36}/(client-funder-requirements|client-generated-drafts|client-generated-drafts/[0-9a-f-]{36}|client-grant-response-packet|client-board-reporting)$`),
    new RegExp(`^${orgPath}/claims/[0-9a-f-]{36}/client-followups/[0-9a-f-]{36}/complete$`),
    new RegExp(`^/api/kai/sprint2/access-administration/organizations/${ORG}/join-requests$`),
  ];
  const GK_ROUTE_PATTERN = /generated-content-drafts|review-packet|generated-content-review|\/grant-response-packet|\/board-reporting|export-review|export-candidates|export-manifests|final-release|claim-library|evidence-library|eligible-claims|traceability|review-queue|\/sources|\/requirements|funder-requirements(-state)?$|review-cockpit\/queue/;

  function assertNetworkBoundary(page, label, { allowJoinReview }) {
    const observed = [...new Set(page.requests().map((request) => {
      const { pathname, search } = new URL(request.url);
      const shape = `${pathname}${search.startsWith("?cursor=") ? "?cursor=…" : ""}`.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id");
      return `${request.method} ${shape} ${request.status}`;
    }))].sort();
    console.log(`[browser-acceptance] ${label} requests:\n  ${observed.join("\n  ")}`);
    for (const request of page.requests()) {
      const { pathname } = new URL(request.url);
      assert.ok(ALLOWED_CLIENT_ROUTES.some((pattern) => pattern.test(pathname)), `${label}: unexpected client request ${request.method} ${pathname}`);
      if (!/client-(generated-drafts|grant-response-packet|board-reporting|funder-requirements)/.test(pathname)) {
        assert.doesNotMatch(pathname, GK_ROUTE_PATTERN, `${label}: GK-internal route called ${pathname}`);
      }
      if (pathname.includes("/join-requests")) assert.ok(allowJoinReview, `${label}: join review probed without capability`);
      assert.ok(request.status !== null && request.status < 400, `${label}: ${request.method} ${pathname} -> ${request.status}`);
    }
  }

  // Whole words/phrases only ("Generated Drafts" is the tab, not a control).
  const FORBIDDEN_CONTROL = /\b(generate|regenerate|export|release|finali[sz]e|approve|assess)\b|create draft|start review|complete review|request export|mark reviewed|\+ new project|\+ new practice/i;
  const SECRETS = [eligible.evidenceItemId, held.claimId, "needs_gk_review", "client_followup_unresolved", "reviewed_by", "assessment_explanation",
    "governed evidence/claim items", "organization-level impact outcome context", "review_queue", TEXT.alphaInReview];

  async function openKnowledgeStudio(page) {
    await page.goto("/impact-library");
    await page.waitForText("Knowledge Studio");
    await page.click("Knowledge Studio", { exact: false, within: "nav" }).catch(() => page.click("Knowledge Studio", { exact: false }));
    await page.waitForText("Funder Requirements");
    await page.idle();
  }

  async function assertAlphaFunderRequirements(page) {
    await page.click("Funder Requirements");
    await page.waitForText("Intended outcomes are defined");
    await page.idle();
    const body = await page.text();
    assert.match(body, /Target: city_impact_fund · annual_outcomes_v1 · 2026-01-01 to 2026-12-31/);
    assert.match(body, /City Impact Fund · Annual Outcomes · v1/);
    assert.match(body, /Intended outcomes are defined[\s\S]*Supported/);
    assert.match(body, /Known limitations affecting confidence[\s\S]*Not yet assessed/);
    for (const secret of SECRETS) assert.ok(!body.includes(secret), `Funder Requirements leaked ${secret}`);
  }

  async function assertAlphaGeneratedDrafts(page, { reviewer }) {
    await page.click("Generated Drafts");
    await page.waitForText("Grant Response Packet");
    await page.waitForText(TEXT.alphaFunder);
    await page.waitForText(TEXT.alphaBoard);
    await page.idle();
    let body = await page.text();
    for (const hidden of [TEXT.alphaHeld, TEXT.alphaInReview, TEXT.beta]) assert.ok(!body.includes(hidden), `Alpha drafts showed ${hidden}`);
    for (const secret of SECRETS) assert.ok(!body.includes(secret), `Generated Drafts leaked ${secret}`);
    const firstPageCount = await page.evaluate(`document.querySelectorAll(".list-group-item button").length`);
    assert.ok(firstPageCount > 0 && firstPageCount < ALPHA_VISIBLE_COUNT, `first bounded page shows ${firstPageCount}`);
    assert.match(body, /More drafts for this project have not been checked yet\./);
    // The held draft is counted; only the reviewer is offered the follow-up link.
    if (reviewer) assert.match(body, /1 reviewed draft\(s\) are waiting on answers from your organization\./);
    else assert.ok(!body.includes("waiting on answers"), "follow-up prompt shown without clientFollowupReview");
    assert.equal((await page.buttons()).includes("Answer follow-up questions"), reviewer);
    const beforeLoadMore = page.mark();
    await page.click("Load more");
    await page.idle();
    const loadMore = page.requestsSince(beforeLoadMore).filter((r) => r.url.includes("client-generated-drafts"));
    assert.equal(loadMore.length, 1);
    assert.match(loadMore[0].url, /client-generated-drafts\?cursor=c1\./);
    const allCount = await page.evaluate(`document.querySelectorAll(".list-group-item button").length`);
    assert.equal(allCount, ALPHA_VISIBLE_COUNT, "every visible Alpha draft, once");
    body = await page.text();
    assert.ok(!body.includes("More drafts for this project have not been checked yet."), "no more pages");
    // Detail with client-safe traceability.
    await page.evaluate(`(() => {
      const item = [...document.querySelectorAll(".list-group-item")].find((el) => el.innerText.includes("Evidence summary") && el.innerText.includes("internal use"));
      item.querySelector("button").click();
    })()`);
    await page.waitForText(TEXT.alphaBoard);
    await page.idle();
    body = await page.text();
    assert.match(body, /Reviewed by Get Kinder/);
    assert.ok(body.includes(eligibleStatement), "supporting Impact Fact statement resolved from client impact-facts");
    assert.match(body, /not a final document/);
    await page.click("← Back to Generated Drafts");
    await page.waitForText("Grant Response Packet");
  }

  async function assertProjectSwitch(page) {
    const beforeSwitch = page.mark();
    await page.selectProject(PROJECT.beta);
    await page.waitForText(TEXT.beta);
    await page.idle();
    let body = await page.text();
    for (const alpha of [TEXT.alphaBoard, TEXT.alphaFunder, "Alpha data gap memo"]) assert.ok(!body.includes(alpha), `stale Alpha content after switching: ${alpha}`);
    const betaRequests = page.requestsSince(beforeSwitch).filter((r) => /client-(generated-drafts|grant-response-packet|board-reporting)/.test(r.url));
    assert.ok(betaRequests.length >= 3);
    for (const request of betaRequests) {
      assert.ok(request.url.includes(PROJECT.beta), `request not scoped to Beta: ${request.url}`);
      assert.ok(!request.url.includes("cursor="), "pagination reset on project change");
    }
    assert.match(body, /No reviewed drafts are ready for this project yet\./, "Beta has no funder packet member");
    assert.ok(!body.includes("More drafts for this project"));
    await page.click("Funder Requirements");
    await page.waitForText("reviewed as not applicable");
    body = await page.text();
    assert.ok(!body.includes("Intended outcomes are defined"), "stale Alpha requirements after switching");
    assert.match(body, /Target: harbour_foundation · community_v2/);
    // Gamma: honest empty states.
    await page.selectProject(PROJECT.gamma);
    await page.waitForText("No funder or framework is selected for this project yet.");
    await page.click("Generated Drafts");
    await page.waitForText("No reviewed drafts yet for this project.");
    await page.idle();
    body = await page.text();
    assert.equal((body.match(/No reviewed drafts are ready for this project yet\./g) || []).length, 2, "both previews empty");
    // Back to Alpha restores Alpha.
    await page.selectProject(PROJECT.alpha);
    await page.waitForText(TEXT.alphaFunder);
    await page.idle();
    body = await page.text();
    assert.ok(!body.includes(TEXT.beta));
  }

  async function assertNoForbiddenControls(page, label) {
    for (const control of await page.buttons()) assert.doesNotMatch(control, FORBIDDEN_CONTROL, `${label}: forbidden control "${control}"`);
  }

  async function authorityCounts() {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.review_queue_items WHERE queue_type = 'generated_content_review')::int AS gc_review,
      (SELECT string_agg(queue_status || review_status, ',' ORDER BY review_queue_item_id) FROM kai.review_queue_items WHERE queue_type = 'generated_content_review') AS gc_state,
      (SELECT count(*) FROM kai.review_queue_items WHERE queue_type = 'export_review')::int AS export_review,
      (SELECT count(*) FROM kai.generated_content_drafts)::int AS drafts,
      (SELECT count(*) FROM kai.requirement_assessments)::int AS assessments,
      (SELECT count(*) FROM kai.engagement_requirement_sets)::int AS applicability`);
    return row;
  }

  try {
    for (const [role, legacyUserId] of [["client_admin", USERS.admin], ["client_contributor", USERS.contributor]]) {
      await test(`browser (${role}): Knowledge Studio, Funder Requirements, Generated Drafts, previews, pagination, project switch, network boundary`, async () => {
        const before = await authorityCounts();
        const page = await openPage(browser, { baseUrl, legacyUserId });
        try {
          await openKnowledgeStudio(page);
          const options = await page.evaluate(`[...document.getElementById("gk-shell-project-select").options].map((o) => o.text)`);
          assert.deepEqual(options, ["All organizational knowledge", "Project Alpha", "Project Beta", "Project Gamma"]);
          await page.click("Generated Drafts");
          await page.waitForText("Select a project to see its Generated Drafts");
          await page.click("Funder Requirements");
          await page.waitForText("Select a project to see its funder requirements.");
          await page.selectProject(PROJECT.alpha);
          await assertAlphaFunderRequirements(page);
          await assertAlphaGeneratedDrafts(page, { reviewer: false });
          await assertProjectSwitch(page);
          await assertNoForbiddenControls(page, role);
          assertNetworkBoundary(page, role, { allowJoinReview: role === "client_admin" });
          assert.deepEqual(page.exceptions, [], `${role}: page exceptions`);
        } finally {
          await page.close();
        }
        assert.deepEqual(await authorityCounts(), before, `${role}: browsing wrote nothing`);
      });
    }

    await test("browser (client_reviewer): same reads, follow-up link, real P2-11 completion through the follow-up page makes the held draft visible, no GK/export/final state", async () => {
      const page = await openPage(browser, { baseUrl, legacyUserId: USERS.reviewer });
      try {
        await openKnowledgeStudio(page);
        await page.selectProject(PROJECT.alpha);
        await assertAlphaFunderRequirements(page);
        await assertAlphaGeneratedDrafts(page, { reviewer: true });
        await assertNoForbiddenControls(page, "client_reviewer");
        assertNetworkBoundary(page, "client_reviewer", { allowJoinReview: false });

        const before = await authorityCounts();
        const beforeFollowups = page.mark();
        await page.click("Answer follow-up questions");
        await page.waitForText("Client Follow-ups");
        await page.click("Load follow-ups");
        await page.waitForText("Mark reviewed");
        let remaining = (await followupRows(held.claimId)).length;
        assert.ok(remaining > 0);
        for (let guard = 0; guard < 20 && (await page.buttons()).includes("Mark reviewed"); guard += 1) {
          await page.click("Mark reviewed");
          await page.idle();
        }
        assert.ok(!(await page.buttons()).includes("Mark reviewed"));
        const completions = page.requestsSince(beforeFollowups).filter((r) => r.url.endsWith("/complete"));
        assert.ok(completions.length >= remaining && completions.every((r) => r.method === "POST" && r.status === 200));
        assertNetworkBoundary(page, "client_reviewer follow-ups", { allowJoinReview: false });
        assert.equal((await realEvaluation(held.claimId, "internal")).eligible, true, "the real evaluator now clears the held claim");
        assert.deepEqual(await authorityCounts(), before, "completion created no generated-content review, export, draft, assessment, or applicability state");

        await openKnowledgeStudio(page);
        await page.selectProject(PROJECT.alpha);
        await page.click("Generated Drafts");
        await page.waitForText(TEXT.alphaFunder);
        await page.idle();
        const body = await page.text();
        assert.ok(!body.includes("waiting on answers"), "nothing is waiting any more");
        const listed = await page.evaluate(`[...document.querySelectorAll(".list-group-item")].map((el) => el.innerText)`);
        assert.ok(listed.some((item) => item.includes("Impact narrative")), "the formerly held impact narrative is now listed");
        assert.deepEqual(page.exceptions, []);
      } finally {
        await page.close();
      }
    });

    await test("browser (foreign client_admin): another organization's projects and drafts are not reachable", async () => {
      const page = await openPage(browser, { baseUrl, legacyUserId: USERS.foreign });
      try {
        await page.goto("/impact-library");
        await page.waitForText("Knowledge Studio");
        const probes = await page.evaluate(`(async () => {
          const base = ${JSON.stringify(`${orgPath}/engagements/${PROJECT.alpha}`)};
          const out = {};
          for (const path of ["/client-generated-drafts", "/client-generated-drafts/${alphaBoardDraft}", "/client-funder-requirements", "/client-grant-response-packet"]) {
            const response = await fetch(base + path, { credentials: "include" });
            out[path] = { status: response.status, body: await response.text() };
          }
          return out;
        })()`);
        for (const [path, probe] of Object.entries(probes)) {
          assert.equal(probe.status, 403, path);
          assert.match(probe.body, /VAL-AUT-003/);
          for (const secret of [TEXT.alphaBoard, TEXT.alphaFunder, "Intended outcomes"]) assert.ok(!probe.body.includes(secret), `${path} leaked ${secret}`);
        }
      } finally {
        await page.close();
      }
    });

    await test("browser acceptance fixture sanity: Beta's draft and Alpha's held draft ids exist and belong to their own projects", async () => {
      const rows = await query(
        `SELECT d.generated_content_draft_id::text AS id, r.engagement_id::text AS engagement FROM kai.generated_content_drafts d
           JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id WHERE d.generated_content_draft_id = ANY($1::uuid[])`,
        [[betaDraft, alphaHeldDraft, alphaBoardDraft]]);
      const byId = Object.fromEntries(rows.map((row) => [row.id, row.engagement]));
      assert.equal(byId[betaDraft], PROJECT.beta);
      assert.equal(byId[alphaHeldDraft], PROJECT.alpha);
    });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  }
}
