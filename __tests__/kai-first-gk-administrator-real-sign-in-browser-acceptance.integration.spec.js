import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * Repair 2: first GK administrator bootstrap and delegated GK staff
 * administration, proven through the real Get Kinder application. Run only by
 *   node scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js \
 *     __tests__/kai-first-gk-administrator-real-sign-in-browser-acceptance.integration.spec.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Unlike the other browser acceptances, nothing here simulates sign-in. The
 * repository's own index.js runs as a child process on a loopback port, so
 * every request crosses the real stack: the real POST /login (bcrypt password
 * check, email verification), express-session with the connect-pg-simple
 * store, passport.session() deserializing public.userdata (including the
 * is_admin site-superuser column ensureAdmin/isAdminRequest read), the real
 * ensureAuthenticated / ensureAdmin page gates, the KAI routers as index.js
 * mounts them, resolveKaiActorContext (JIT kai.users mapping), the governed
 * access-administration and intake services, the local PostgreSQL
 * transactions and metadata-only audit, the real /impact-library EJS page,
 * and the built bundle in a real headless Chrome with one browser context
 * (cookie jar) per sign-in.
 *
 * Isolation: index.js starts with a minimal environment (no inherited
 * variables) in an empty working directory, so dotenv finds no .env; its
 * database is only the runner's loopback cluster, and Neo4j, OpenAI and every
 * other outbound dependency point at a non-listening loopback port. Chrome
 * resolves no host except 127.0.0.1.
 *
 * FIXTURES (written directly, never the behavior under test): Get Kinder
 * accounts (public.userdata with bcrypt passwords; one is_admin site
 * superuser), two KAI organizations with a Project each, one Get Kinder
 * organization binding (binding-derived client administrator), and the
 * organization's evidence (the real P2-01 extraction service over the
 * runner's smoke-seeded source). TESTED ACTIONS: every sign-in, every role
 * and membership write (through Team & Access or its governed routes), and
 * every protected read or write that follows.
 */

const RUNNER_DATABASE_URL = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_DATABASE_URL;
const CHROME = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_CHROME;
const WORKDIR = process.env.KAI_CLIENT_BROWSER_ACCEPTANCE_WORKDIR;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`browser acceptance refused a non-loopback database URL host: ${host}`);
  }
}

test("first GK administrator acceptance isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("first GK administrator acceptance: index.js serves sign-in, sessions and the KAI routes this proof drives", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(indexSource, /app\.post\("\/login", async \(req, res, next\) => \{/);
  assert.match(indexSource, /app\.use\(passport\.session\(\)\);/);
  assert.match(indexSource, /app\.get\("\/logout", \(req, res, next\) => \{/);
  assert.match(indexSource, /"\/api\/kai\/sprint2\/access-administration",\s*requireKaiSprint2Enabled,\s*requireKaiSprint2Authenticated,\s*kaiAccessAdministrationApiRouter/);
  assert.match(indexSource, /app\.use\("\/api\/admin", ensureAuthenticated, adminApiRouter\);/);
  assert.match(indexSource, /app\.get\("\/admin", ensureAuthenticated, ensureAdmin,/);
  assert.match(indexSource, /app\.get\("\/impact-library", ensureAuthenticated, \(req, res\)/);
});

if (!RUNNER_DATABASE_URL || !CHROME || !WORKDIR) {
  test("first GK administrator acceptance requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runAcceptance();
}

// ---------------------------------------------------------------------------
// The real application, loopback only
// ---------------------------------------------------------------------------

async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startRealApplication() {
  const runnerUrl = new URL(RUNNER_DATABASE_URL);
  const appCwd = join(WORKDIR, "real-app-cwd");
  mkdirSync(appCwd, { recursive: true });
  assert.equal(existsSync(join(appCwd, ".env")), false, "the application's working directory has no .env");
  const port = await freeLoopbackPort();
  const sentinel = "127.0.0.1:9";
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "development",
    PORT: String(port),
    DATABASE_URL: "",
    DATABASE_URL_LOCAL: "",
    PGURL_LOCAL: "",
    RENDER_DATABASE_URL: "",
    PROD_DATABASE_URL: "",
    DB_HOST: runnerUrl.hostname,
    DB_PORT: runnerUrl.port,
    DB_NAME: runnerUrl.pathname.replace(/^\//, ""),
    DB_USER: decodeURIComponent(runnerUrl.username),
    DB_PASSWORD: "",
    SESSION_SECRET: `first-gk-admin-${Date.now()}-${Math.random()}`,
    KAI_SPRINT2_ENABLED: "true",
    NEO4J_URI: `bolt://${sentinel}`,
    NEO4J_USERNAME: "loopback-sentinel",
    NEO4J_PASSWORD: "loopback-sentinel",
    OPENAI_API_KEY: "sk-loopback-sentinel",
    OPENAI_BASE_URL: `http://${sentinel}/v1`,
  };
  const child = spawn(process.execPath, [join(REPO_ROOT, "index.js")], { cwd: appCwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  const deadline = Date.now() + 60000;
  while (!log.includes(`App running on port ${port}`)) {
    if (child.exitCode !== null) throw new Error(`index.js exited during start-up:\n${log.slice(-4000)}`);
    if (Date.now() > deadline) throw new Error(`index.js did not start:\n${log.slice(-4000)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  // The password-reset column set-up is index.js's own start-up write.
  for (let i = 0; i < 100 && !/Password reset columns ready|Could not initialize password reset columns/.test(log); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(log, /\[pg\] Using local connection/, "index.js uses the runner's loopback cluster, not a URL from any environment file");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    log: () => log,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      for (let i = 0; i < 50 && child.exitCode === null; i += 1) await new Promise((r) => setTimeout(r, 100));
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client, as in the other acceptance specs.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-first-gk-admin");
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
    // The real pages link CDN stylesheets and fonts; nothing leaves loopback.
    "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
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

// A fresh browser context (its own cookie jar): nothing is shared with any
// other sign-in, and no cookie is set except by the application itself.
async function openBrowserContext(browser, baseUrl) {
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
    throw new Error(`network never went idle: ${JSON.stringify(requests.filter((request) => !request.done))}`);
  };
  const waitFor = async (predicate, description, { timeout = 15000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 4000)}`);
  };
  const clickWhere = async (description, finder) => {
    const clicked = await evaluate(`(() => { const el = (${finder})(); if (!el) return false; el.click(); return true; })()`);
    if (!clicked) throw new Error(`no visible control: ${description}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const visibleControl = (label) => evaluate(`Boolean([...document.querySelectorAll("[role=button], a, button")]
    .find((el) => el.offsetParent !== null && !el.disabled && el.innerText.trim() === ${JSON.stringify(label)}))`);
  const setSelect = async (selectorExpression, value) => {
    const ok = await evaluate(`(() => {
      const el = (${selectorExpression})();
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === ${JSON.stringify(value)};
    })()`);
    assert.ok(ok, `select set to ${value}`);
  };
  const setInput = async (id, value) => {
    assert.ok(await evaluate(`(() => {
      const el = document.getElementById(${JSON.stringify(id)});
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`), `input ${id}`);
  };
  const page = {
    mark: () => requests.length,
    requestsSince: (mark) => requests.slice(mark),
    exceptions,
    evaluate,
    text,
    idle,
    waitFor,
    waitForText: (needle, options) => waitFor(async () => (await text()).includes(needle), `text: ${needle}`, options),
    visibleControl,
    setSelect,
    setInput,
    clickWhere,
    pathname: () => evaluate("location.pathname"),
    clickNav: (label) => clickWhere(`nav ${label}`, `() => [...document.querySelectorAll("[role=button], a, button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickTab: (label) => clickWhere(`tab ${label}`, `() => [...document.querySelectorAll(".nav-tabs button")]
      .filter((el) => el.offsetParent !== null).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    clickButton: (label) => clickWhere(`button ${label}`, `() => [...document.querySelectorAll("button")]
      .filter((el) => el.offsetParent !== null && !el.disabled).find((el) => el.innerText.trim() === ${JSON.stringify(label)})`),
    async cookies() {
      return (await browser.send("Network.getCookies", { urls: [baseUrl] }, sessionId)).cookies.map((cookie) => cookie.name).sort();
    },
    // A same-origin request carrying only this context's application cookie.
    fetchJson: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        credentials: "same-origin",
        redirect: "manual",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      let parsed = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      return {
        status: response.status,
        errorCode: parsed?.error?.code ?? (typeof parsed?.error === "string" ? parsed.error : null),
        blockingReason: Array.isArray(parsed?.blockers) ? parsed.blockers[0]?.blocking_reason ?? null : null,
        data: parsed?.data ?? null,
        body: parsed,
      };
    })()`),
    // The final document path of a top-level navigation (after redirects).
    async goto(path) {
      await browser.send("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      await waitFor(async () => (await evaluate("document.readyState")) === "complete", `load of ${path}`);
      await idle();
      return evaluate("location.pathname");
    },
    async close() {
      browser.listeners.delete(listener);
      await browser.send("Target.closeTarget", { targetId });
    },
  };
  return page;
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

async function runAcceptance() {
  const { Pool } = await import("pg");
  const bcrypt = (await import("bcrypt")).default;
  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");

  const ORG_F = "00000000-0000-4000-8000-000000000001"; // the runner's smoke-seeded organization (source, candidates, review queue)
  const ORG_G = "00000000-0000-4000-8000-0000000fa0b2"; // an unrelated organization
  const ORG_G_NAME = "Larkspur First-Admin Synthetic Shelter";
  const PROJECT_F = "7d000000-0000-4000-8000-0000000fa0f1";
  const PROJECT_G = "7d000000-0000-4000-8000-0000000fa0b2";
  const PASSWORD = "Synthetic-Sign-In-2026!";
  const USERS = Object.freeze({
    site: 2401, // Get Kinder site superuser (public.userdata.is_admin); no KAI identity, role, or membership
    admin: 2402, // verified account intended to become the first GK administrator; never used KAI
    operator: 2403, // verified account; never used KAI; onboarded as an operator by the first GK administrator
    reviewer: 2404, // verified account; never used KAI; onboarded as a reviewer by the first GK administrator
    plain: 2405, // verified account with no grant of any kind
    boundAdmin: 2406, // Get Kinder organization admin of ORG_F's bound organization: binding-derived client_admin only
  });
  const email = (legacyId) => `first-admin-${legacyId}@harbourline.test`;
  const ACCESS = "/api/kai/sprint2/access-administration";
  const INTAKE = "/api/kai/sprint2/intake";
  const COCKPIT = `${INTAKE}/admin/review-cockpit`;
  const contextPath = `${ACCESS}/administration-context`;
  const rosterPath = (organizationId) => `${ACCESS}/organizations/${organizationId}/access`;
  const membershipRolesPath = (organizationId, legacyId) => `${ACCESS}/organizations/${organizationId}/memberships/${legacyId}/roles`;
  const staffPath = (organizationId, legacyId = null) => `${ACCESS}/organizations/${organizationId}/gk-staff${legacyId === null ? "" : `/${legacyId}`}`;
  const globalRolePath = (legacyId) => `${ACCESS}/global-roles/${legacyId}`;
  const capabilitiesPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/access-capabilities`;
  const cockpitCapabilitiesPath = (organizationId) => `${COCKPIT}/capabilities?organization_id=${organizationId}`;
  const sourceQueuePath = (organizationId) => `${COCKPIT}/queue?organization_id=${organizationId}&queue_type=source_candidate_review&queue_status=open`;
  const projectsPath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/engagements`;
  const evidencePath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/evidence-library/candidates`;
  const reviewQueuePath = (organizationId) => `${INTAKE}/admin/organizations/${organizationId}/review-queue`;
  const pathOf = (r) => new URL(r.url).pathname;
  const writes = (requests) => requests.filter((r) => r.method !== "GET").map((r) => [r.method, pathOf(r), r.status]);
  const rowKey = (legacyId) => `legacy:${legacyId}`;
  const nowIso = () => new Date().toISOString();

  // =====================================================================
  // FIXTURES
  // =====================================================================
  await query(`ALTER TABLE public.userdata ADD COLUMN IF NOT EXISTS firstname text, ADD COLUMN IF NOT EXISTS lastname text,
                 ADD COLUMN IF NOT EXISTS password text, ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false`);
  // The bound Get Kinder organization's display column the shell header reads.
  await query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS logo_url text");
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic') ON CONFLICT (organization_id) DO NOTHING", [ORG_F]);
  await query("INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, $2, 'larkspur-first-admin')", [ORG_G, ORG_G_NAME]);
  const [{ name: ORG_F_NAME }] = await query("SELECT name FROM kai.organizations WHERE organization_id = $1::uuid", [ORG_F]);
  for (const [engagementId, organizationId, code] of [[PROJECT_F, ORG_F, "Project Harbourline First Admin"], [PROJECT_G, ORG_G, "Project Larkspur First Admin"]]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const [key, legacyId] of Object.entries(USERS)) {
    await query(`INSERT INTO public.userdata (id, email, firstname, lastname, password, email_verified, is_suspended, is_admin)
                 VALUES ($1, $2, 'Synthetic', $3, $4, true, false, $5)`,
      [legacyId, email(legacyId), `First-Admin ${key}`, passwordHash, legacyId === USERS.site]);
  }
  const [gkOrganization] = await query("INSERT INTO public.organizations (name, status) VALUES ($1, 'approved') RETURNING id", [ORG_F_NAME]);
  await query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2::uuid, 'active')", [gkOrganization.id, ORG_F]);
  await query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkOrganization.id, USERS.boundAdmin]);
  // The organization's evidence, through the real P2-01 extraction service
  // over the runner's smoke-seeded source version (a fixture, not a review).
  const [smokeVersion] = await query(
    "SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1", [ORG_F]);
  const fixtureExtraction = await extractEvidenceFromSourceVersion(
    { organizationId: ORG_F, sourceVersionId: smokeVersion.source_version_id, now: nowIso(),
      actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-0000000fa001", source: "public.userdata",
        organizationMemberships: [{ organization_id: ORG_F, membership_status: "active", role_name: "gk_reviewer" }] } },
    { env: { KAI_SPRINT2_ENABLED: "true" }, metadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } } },
  );
  assert.equal(fixtureExtraction.ok, true, JSON.stringify(fixtureExtraction));

  // --- database readers ----------------------------------------------------
  const kaiUserOf = async (legacyId) => (await query(
    "SELECT user_id::text, status, legacy_identity_source, legacy_public_userdata_id, email FROM kai.users WHERE legacy_public_userdata_id = $1", [legacyId]))[0] || null;
  const globalRolesOf = async (legacyId) => (await query(
    `SELECT r.role_name FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id JOIN kai.users u ON u.user_id = ur.user_id
      WHERE u.legacy_public_userdata_id = $1 AND ur.organization_id IS NULL AND ur.engagement_id IS NULL AND ur.active = true AND ur.revoked_at IS NULL
      ORDER BY r.role_name`, [legacyId])).map((row) => row.role_name);
  const membershipsOf = async (legacyId) => (await query(
    `SELECT m.organization_id::text, m.role_name, m.membership_status FROM kai.organization_memberships m JOIN kai.users u ON u.user_id = m.user_id
      WHERE u.legacy_public_userdata_id = $1 ORDER BY m.organization_id, m.role_name`, [legacyId]));
  const auditsAbout = async (legacyId) => (await query(
    `SELECT a.action, a.actor_user_id::text, a.metadata FROM kai.audit_events a JOIN kai.users u ON u.user_id::text = a.metadata->>'target_user_id'
      WHERE u.legacy_public_userdata_id = $1 ORDER BY a.audit_event_id`, [legacyId]));
  const gkAdminAssignmentCounts = async () => (await query(`SELECT
      (SELECT count(*)::int FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id WHERE r.role_name = 'gk_admin' AND ur.active = true AND ur.revoked_at IS NULL) AS global,
      (SELECT count(*)::int FROM kai.organization_memberships WHERE role_name = 'gk_admin' AND membership_status = 'active') AS organization`))[0];
  async function allKaiCounts() {
    const counts = {};
    for (const { table_name: table } of await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name",
    )) {
      counts[table] = (await query(`SELECT count(*)::int AS count FROM kai.${table}`))[0].count;
    }
    const [fingerprint] = await query(`SELECT
      (SELECT md5(coalesce(string_agg(organization_id::text || user_id::text || role_name || membership_status, ',' ORDER BY organization_id, user_id, role_name), '')) FROM kai.organization_memberships) AS memberships,
      (SELECT md5(coalesce(string_agg(user_id::text || role_id::text || active::text || coalesce(revoked_at::text, ''), ',' ORDER BY user_id, role_id), '')) FROM kai.user_roles) AS roles,
      (SELECT md5(coalesce(string_agg(engagement_id::text, ',' ORDER BY engagement_id), '')) FROM kai.engagements) AS projects`);
    counts.__fingerprint = fingerprint;
    return counts;
  }
  const changedTables = (before, after) => Object.keys(after).filter((table) => table !== "__fingerprint" && after[table] !== before[table]).sort();
  async function assertNothingWritten(before, label) {
    const after = await allKaiCounts();
    assert.deepEqual(changedTables(before, after), [], `${label}: no KAI table row count changed`);
    assert.deepEqual(after.__fingerprint, before.__fingerprint, `${label}: no membership, role, or Project row changed in place`);
  }

  // --- application, browser, sign-in ----------------------------------------
  const app = await startRealApplication();
  const { baseUrl } = app;
  const browser = await launchChrome();
  const contexts = [];
  const results = {};

  // Real Get Kinder sign-in: the /login form posted by the browser; the
  // application sets the session cookie. Returns the signed-in context.
  async function signIn(legacyId, password = PASSWORD) {
    const page = await openBrowserContext(browser, baseUrl);
    contexts.push(page);
    assert.equal(await page.goto("/login"), "/login");
    // The login page clears its form shortly after load; fill it afterwards.
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(await page.evaluate(`(() => {
      const form = document.getElementById("login-form");
      if (!form) return false;
      const set = (name, value) => {
        const input = form.querySelector('input[name="' + name + '"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set("email", ${JSON.stringify(email(legacyId))});
      set("password", ${JSON.stringify(password)});
      form.querySelector('button[type="submit"]').click();
      return true;
    })()`), "the real login form");
    await page.waitFor(async () => {
      try {
        return (await page.evaluate("document.readyState")) === "complete"
          && ((await page.pathname()) !== "/login" || (await page.text()).includes("Invalid email or password"));
      } catch {
        return false; // the document is being replaced by the form post
      }
    }, `sign-in of ${legacyId}`);
    await page.idle();
    return page;
  }
  async function signOut(page) {
    await page.goto("/logout");
    const after = await page.fetchJson("GET", contextPath);
    assert.equal(after.status, 401, "the session ended with sign-out");
    await page.close();
    contexts.splice(contexts.indexOf(page), 1);
  }
  async function openImpactLibrary(page) {
    assert.equal(await page.goto("/impact-library"), "/impact-library");
    await page.waitFor(async () => (await page.visibleControl("Knowledge Studio")) || (await page.visibleControl("Team & Access")), "the Impact Library shell");
    await page.idle();
  }
  async function openTeamAccess(page) {
    await openImpactLibrary(page);
    await page.clickNav("Team & Access");
    await page.waitForText("Members");
    await page.idle();
  }
  const memberRowText = (page, legacyId) => page.evaluate(`(() => {
    const el = document.querySelector('[data-team-access-member="${rowKey(legacyId)}"]');
    return el ? el.innerText : null;
  })()`);
  const memberHasRoleBadge = (page, legacyId, roleName) => page.evaluate(
    `Boolean(document.querySelector('[data-team-access-member="${rowKey(legacyId)}"] .gk-team-access-role--${roleName}'))`);
  const readinessOf = (page, legacyId, key) => page.evaluate(`(() => {
    const el = document.querySelector('[data-team-access-readiness="${rowKey(legacyId)}"] [data-readiness-key="${key}"]');
    return el ? el.getAttribute("data-ready") : null;
  })()`);
  const staffOnboardingStatusOf = (page, legacyId, roleName) => page.evaluate(`(() => {
    const el = document.querySelector('[data-team-access-staff-onboarding="${rowKey(legacyId)}"] [data-staff-onboarding-role="${roleName}"]');
    return el ? el.getAttribute("data-staff-onboarding-status") : null;
  })()`);
  const clickMemberButton = (page, legacyId, label) => page.clickWhere(`member ${legacyId} ${label}`,
    `() => [...document.querySelectorAll('[data-team-access-member="${rowKey(legacyId)}"] button')].find((el) => el.innerText.trim() === ${JSON.stringify(label)} && !el.disabled)`);
  async function confirmGlobalRole(page, legacyId, roleName, roleLabel, action) {
    if (action === "assign") {
      await page.setSelect(`() => document.getElementById("gk-team-access-global-role-legacy-${legacyId}")`, roleName);
      await clickMemberButton(page, legacyId, "Grant global role");
      await page.waitFor(async () => /Confirm granting global/.test(await memberRowText(page, legacyId) || ""), "grant confirmation");
      const mark = page.mark();
      await clickMemberButton(page, legacyId, `Confirm granting global ${roleLabel}`);
      await page.waitFor(async () => new RegExp(`Revoke global ${roleLabel}`).test(await memberRowText(page, legacyId) || ""), "the granted global role");
      await page.idle();
      return writes(page.requestsSince(mark));
    }
    await clickMemberButton(page, legacyId, `Revoke global ${roleLabel}`);
    await page.waitFor(async () => /Confirm revoking global/.test(await memberRowText(page, legacyId) || ""), "revoke confirmation");
    const mark = page.mark();
    await clickMemberButton(page, legacyId, `Confirm revoking global ${roleLabel}`);
    await page.waitFor(async () => !new RegExp(`Revoke global ${roleLabel}`).test(await memberRowText(page, legacyId) || ""), "the revoked global role");
    await page.idle();
    return writes(page.requestsSince(mark));
  }
  async function platformSelectOrganization(page, organizationId) {
    await page.setSelect(`() => document.getElementById("gk-team-access-administration-organization")`, organizationId);
    await page.waitFor(async () => !(await page.text()).includes("Loading team members"), "the selected organization's roster");
    await page.idle();
  }
  async function platformAddPerson(page, legacyId, roleName) {
    await page.setInput("gk-team-access-add-person-email", email(legacyId));
    await page.setSelect(`() => document.getElementById("gk-team-access-add-person-role")`, roleName);
    const mark = page.mark();
    await page.clickButton("Add person");
    await page.waitFor(() => memberHasRoleBadge(page, legacyId, roleName), `${legacyId} ${roleName} badge`);
    await page.idle();
    return page.requestsSince(mark).map((r) => [r.method, pathOf(r), r.status]);
  }
  async function addStaff(page, legacyId, roleName, expectedText) {
    await page.setInput("gk-team-access-add-staff-email", email(legacyId));
    await page.setSelect(`() => document.getElementById("gk-team-access-add-staff-role")`, roleName);
    const mark = page.mark();
    await page.clickButton("Add staff member");
    await page.waitForText(expectedText);
    await page.idle();
    return writes(page.requestsSince(mark));
  }
  // Capabilities and reads the actor's own server answers, per organization.
  async function effectiveAccess(page, organizationId) {
    const capabilities = await page.fetchJson("GET", capabilitiesPath(organizationId));
    const cockpit = await page.fetchJson("GET", cockpitCapabilitiesPath(organizationId));
    return {
      capabilitiesStatus: capabilities.status,
      workspace: capabilities.data?.internalKnowledgeWorkspace ?? null,
      intake: capabilities.data?.intakeContribution ?? null,
      projectManagement: capabilities.data?.projectManagement ?? null,
      teamAccess: capabilities.data?.organizationAccessManagement ?? null,
      evidenceReview: capabilities.data?.workflowOperations?.recordEvidenceReview ?? null,
      sourceReview: cockpit.data?.can_review_source_candidates ?? null,
      sensitivityReview: cockpit.data?.can_manage_sensitivity_review ?? null,
      projects: (await page.fetchJson("GET", projectsPath(organizationId))).status,
      evidence: (await page.fetchJson("GET", evidencePath(organizationId))).status,
      sourceQueue: (await page.fetchJson("GET", sourceQueuePath(organizationId))).status,
    };
  }

  try {
    // =====================================================================
    // Starting state
    // =====================================================================
    await test("R2-0 starting state: no GK administrator anywhere; no fixture account has a KAI identity; signed-out requests are refused by the real session middleware", async () => {
      assert.deepEqual(await gkAdminAssignmentCounts(), { global: 0, organization: 0 });
      for (const legacyId of Object.values(USERS)) assert.equal(await kaiUserOf(legacyId), null, `${legacyId}: no kai.users mapping`);
      const anonymous = await openBrowserContext(browser, baseUrl);
      contexts.push(anonymous);
      assert.equal(await anonymous.goto("/impact-library"), "/login", "ensureAuthenticated sends a signed-out visitor to /login");
      assert.equal((await anonymous.fetchJson("GET", contextPath)).status, 401);
      assert.equal((await anonymous.fetchJson("PUT", globalRolePath(USERS.admin), { role_name: "gk_admin", action: "assign" })).status, 401);
      await anonymous.close();
      contexts.splice(contexts.indexOf(anonymous), 1);
      // A wrong password creates no session.
      const refused = await signIn(USERS.site, "not-the-password");
      assert.equal(await refused.pathname(), "/login");
      assert.match(await refused.text(), /Invalid email or password/);
      assert.equal((await refused.fetchJson("GET", contextPath)).status, 401);
      await refused.close();
      contexts.splice(contexts.indexOf(refused), 1);
      assert.equal(await kaiUserOf(USERS.site), null);
      results.R2_0 = "PASS";
    });

    // =====================================================================
    // B4. First sign-in grants nothing; neither an ordinary account nor a
    // binding-derived client administrator can bootstrap a GK administrator.
    // =====================================================================
    await test("B4: an ordinary account's first sign-in and a binding-derived client administrator get no Get Kinder authority and cannot bootstrap a GK administrator; nothing is written", async () => {
      const before = await allKaiCounts();
      const plainPage = await signIn(USERS.plain);
      assert.ok((await plainPage.cookies()).includes("connect.sid"), "the application set its session cookie");
      const plainContext = await plainPage.fetchJson("GET", contextPath);
      assert.deepEqual([plainContext.status, plainContext.data?.platform_administration], [200, false]);
      const plainMapping = await kaiUserOf(USERS.plain);
      assert.equal(plainMapping?.status, "active", "first KAI request maps the account (JIT)");
      assert.deepEqual([await globalRolesOf(USERS.plain), await membershipsOf(USERS.plain)], [[], []], "and grants nothing");
      const afterMapping = await allKaiCounts();
      assert.deepEqual(changedTables(before, afterMapping), ["users"], "the only write is the account's own kai.users mapping");
      const refusals = {
        orgCapabilities: (await plainPage.fetchJson("GET", capabilitiesPath(ORG_F))).status,
        projects: (await plainPage.fetchJson("GET", projectsPath(ORG_F))).status,
        evidence: (await plainPage.fetchJson("GET", evidencePath(ORG_F))).status,
        roster: (await plainPage.fetchJson("GET", rosterPath(ORG_F))).status,
        globalGkAdmin: await plainPage.fetchJson("PUT", globalRolePath(USERS.admin), { role_name: "gk_admin", action: "assign" }),
        selfGlobalGkAdmin: await plainPage.fetchJson("PUT", globalRolePath(USERS.plain), { role_name: "gk_admin", action: "assign" }),
        organizationGkAdmin: await plainPage.fetchJson("POST", membershipRolesPath(ORG_F, USERS.admin), { role_name: "gk_admin" }),
        staff: await plainPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.admin), role_name: "gk_operator" }),
        adminLookup: (await plainPage.fetchJson("GET", `/api/admin/users/lookup?email=${encodeURIComponent(email(USERS.admin))}`)).status,
      };
      assert.deepEqual([refusals.orgCapabilities, refusals.projects, refusals.evidence, refusals.roster], [403, 403, 403, 403]);
      assert.deepEqual([refusals.globalGkAdmin.status, refusals.globalGkAdmin.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([refusals.selfGlobalGkAdmin.status, refusals.selfGlobalGkAdmin.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([refusals.organizationGkAdmin.status, refusals.organizationGkAdmin.blockingReason], [403, "missing_active_organization_membership"]);
      assert.deepEqual([refusals.staff.status, refusals.staff.blockingReason], [403, "missing_active_organization_membership"]);
      assert.equal(refusals.adminLookup, 403, "the site-superuser lookup (ensureAdminApi) is refused");
      assert.equal(await plainPage.goto("/admin"), "/", "ensureAdmin redirects a non-superuser away from /admin");
      await openImpactLibrary(plainPage);
      assert.equal(await plainPage.visibleControl("Team & Access"), false, "no Team & Access for an account with no organization");
      assert.equal(await plainPage.evaluate(`Boolean(document.getElementById("gk-team-access-add-person-email") || document.getElementById("gk-team-access-add-staff-email"))`), false);
      await assertNothingWritten(afterMapping, "B4 ordinary account");
      await signOut(plainPage);

      const boundPage = await signIn(USERS.boundAdmin);
      const boundBefore = await allKaiCounts();
      const boundCapabilities = await boundPage.fetchJson("GET", capabilitiesPath(ORG_F));
      const boundContext = await boundPage.fetchJson("GET", contextPath);
      assert.deepEqual([boundContext.status, boundContext.data?.platform_administration], [200, false]);
      assert.equal(boundCapabilities.status, 200);
      assert.equal(boundCapabilities.data.organizationAccessManagement, true, "keeps client administration of its organization");
      assert.equal(boundCapabilities.data.internalKnowledgeWorkspace, false, "no Get Kinder workspace");
      const boundRoster = await boundPage.fetchJson("GET", rosterPath(ORG_F));
      assert.equal(boundRoster.status, 200);
      assert.deepEqual([boundRoster.data.staff_onboarding_roles, boundRoster.data.assignable_global_roles, boundRoster.data.global_roles_visible], [[], [], false]);
      const boundRefusals = {
        globalGkAdmin: await boundPage.fetchJson("PUT", globalRolePath(USERS.admin), { role_name: "gk_admin", action: "assign" }),
        organizationGkAdmin: await boundPage.fetchJson("POST", membershipRolesPath(ORG_F, USERS.admin), { role_name: "gk_admin" }),
        staff: await boundPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.admin), role_name: "gk_operator" }),
        otherOrganization: (await boundPage.fetchJson("GET", rosterPath(ORG_G))).status,
      };
      assert.deepEqual([boundRefusals.globalGkAdmin.status, boundRefusals.globalGkAdmin.blockingReason], [403, "platform_superuser_required"]);
      assert.deepEqual([boundRefusals.organizationGkAdmin.status, boundRefusals.organizationGkAdmin.blockingReason], [403, "non_client_membership_not_client_managed"]);
      assert.equal(boundRefusals.staff.status, 403);
      assert.equal(boundRefusals.otherOrganization, 403);
      await openTeamAccess(boundPage);
      const boundText = await boundPage.text();
      assert.doesNotMatch(boundText, /Platform administration|Add Get Kinder staff|Grant global role/);
      assert.equal(await boundPage.evaluate(`Boolean(document.getElementById("gk-team-access-add-person-email") || document.getElementById("gk-team-access-add-staff-email"))`), false);
      const boundAfter = await allKaiCounts();
      assert.deepEqual(changedTables(boundBefore, boundAfter).filter((table) => table !== "users"), [], "only the account's own kai.users mapping");
      assert.deepEqual(await gkAdminAssignmentCounts(), { global: 0, organization: 0 });
      await signOut(boundPage);
      results.B4 = { plain: refusals.adminLookup, bound: boundRefusals.otherOrganization };
    });

    // =====================================================================
    // B1/B2. The site superuser, with no KAI identity, bootstraps the first
    // GK administrator in Team & Access.
    // =====================================================================
    let sitePage;
    await test("B1: the site superuser signs in with no KAI identity; its authority is the Get Kinder site-superuser (is_admin) session alone, independent of any KAI role or membership", async () => {
      assert.equal(await kaiUserOf(USERS.site), null, "no kai.users mapping before sign-in");
      sitePage = await signIn(USERS.site);
      // Every login success lands on /impact-library (JOIN-4), whose first
      // KAI request maps the signed-in account (JIT) - no prior KAI identity.
      assert.equal(await sitePage.pathname(), "/impact-library");
      assert.equal(await sitePage.goto("/admin"), "/admin", "the real ensureAdmin admits the site superuser");
      const context = await sitePage.fetchJson("GET", contextPath);
      assert.equal(context.status, 200);
      assert.equal(context.data.platform_administration, true);
      assert.ok(context.data.organizations.some((organization) => organization.organization_id === ORG_F), "the organization to administer is offered");
      const mapping = await kaiUserOf(USERS.site);
      assert.deepEqual([mapping?.status, mapping?.legacy_identity_source], ["active", "public.userdata"], "the first KAI request maps the superuser (JIT)");
      assert.deepEqual([await globalRolesOf(USERS.site), await membershipsOf(USERS.site)], [[], []], "with no KAI role or membership");
      assert.equal((await sitePage.fetchJson("GET", `/api/admin/users/lookup?email=${encodeURIComponent(email(USERS.admin))}`)).status, 200);
      results.B1 = "PASS";
    });

    await test("B2: in /impact-library -> Team & Access the site superuser makes the never-signed-in account organization gk_admin, then global gk_admin; the half-provisioned state is not delegated administration; persisted roles and audit are exact", async () => {
      assert.equal(await kaiUserOf(USERS.admin), null, "the recipient has never used KAI");
      await openTeamAccess(sitePage);
      await sitePage.waitForText("Platform administration");
      await platformSelectOrganization(sitePage, ORG_F);
      const before = await allKaiCounts();
      const added = await platformAddPerson(sitePage, USERS.admin, "gk_admin");
      assert.deepEqual(added.filter(([, path]) => path !== rosterPath(ORG_F)), [
        ["GET", "/api/admin/users/lookup", 200],
        ["POST", membershipRolesPath(ORG_F, USERS.admin), 200],
      ]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "users"]);
      const mapping = await kaiUserOf(USERS.admin);
      assert.deepEqual([mapping.status, mapping.legacy_identity_source, mapping.email], ["active", "public.userdata", email(USERS.admin)],
        "the governed grant mapped the recipient exactly as a first sign-in would");
      assert.deepEqual(await membershipsOf(USERS.admin), [{ organization_id: ORG_F, role_name: "gk_admin", membership_status: "active" }]);
      assert.deepEqual(await globalRolesOf(USERS.admin), []);
      // Organization and global authority are shown separately.
      assert.match(await memberRowText(sitePage, USERS.admin), /Global Get Kinder roles \(all organizations\): none/);
      assert.equal(await readinessOf(sitePage, USERS.admin, "delegated_administration"), "false", "half-provisioned: not yet a delegated administrator");

      // The half-provisioned recipient, signed in independently, administers nothing.
      const halfPage = await signIn(USERS.admin);
      const halfBefore = await allKaiCounts();
      const half = await halfPage.fetchJson("GET", capabilitiesPath(ORG_F));
      assert.deepEqual([half.status, half.data.organizationAccessManagement], [200, false]);
      assert.equal((await halfPage.fetchJson("GET", rosterPath(ORG_F))).status, 403);
      const halfStaff = await halfPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.operator), role_name: "gk_operator" });
      assert.deepEqual([halfStaff.status, halfStaff.blockingReason], [403, "role_not_allowed"]);
      await openImpactLibrary(halfPage);
      assert.equal(await halfPage.visibleControl("Team & Access"), false, "no Team & Access with organization gk_admin alone");
      await assertNothingWritten(halfBefore, "B2 half-provisioned recipient");
      await signOut(halfPage);

      // The global half, with the explanation and an explicit confirmation.
      await sitePage.waitFor(() => sitePage.evaluate(
        `Boolean(document.querySelector('[data-team-access-global-roles="${rowKey(USERS.admin)}"] [data-global-role-explanation]'))`), "global role control");
      await sitePage.setSelect(`() => document.getElementById("gk-team-access-global-role-legacy-${USERS.admin}")`, "gk_admin");
      const explanation = await sitePage.evaluate(`document.querySelector('[data-team-access-global-roles="${rowKey(USERS.admin)}"] [data-global-role-explanation="gk_admin"]')?.innerText || ""`);
      assert.match(explanation, /^High-risk Get Kinder governance role/);
      const globalBefore = await allKaiCounts();
      assert.deepEqual(await confirmGlobalRole(sitePage, USERS.admin, "gk_admin", "Get Kinder administrator", "assign"), [["PUT", globalRolePath(USERS.admin), 200]]);
      assert.deepEqual(changedTables(globalBefore, await allKaiCounts()), ["audit_events", "user_roles"]);
      await sitePage.waitFor(async () => (await readinessOf(sitePage, USERS.admin, "delegated_administration")) === "true", "delegated administration readiness");
      assert.match(await memberRowText(sitePage, USERS.admin), /Global Get Kinder roles \(all organizations\): Get Kinder administrator/);
      assert.ok(await memberHasRoleBadge(sitePage, USERS.admin, "gk_admin"), "the organization assignment is shown as its own badge");

      // Persisted: global and organization assignments separately.
      assert.deepEqual(await globalRolesOf(USERS.admin), ["gk_admin"]);
      assert.deepEqual(await membershipsOf(USERS.admin), [{ organization_id: ORG_F, role_name: "gk_admin", membership_status: "active" }]);
      assert.deepEqual(await gkAdminAssignmentCounts(), { global: 1, organization: 1 });
      // Metadata-only audit, attributed to the superuser's own KAI identity.
      const siteKaiUser = (await kaiUserOf(USERS.site)).user_id;
      const audits = await auditsAbout(USERS.admin);
      assert.deepEqual(audits.map((a) => [a.action, a.actor_user_id, a.metadata.role_name, a.metadata.authority_source, a.metadata.organization_id ?? null]), [
        ["organization_role_granted_access_admitted", siteKaiUser, "gk_admin", "platform_superuser", ORG_F],
        ["global_kai_role_assigned", siteKaiUser, "gk_admin", "platform_superuser", null],
      ]);
      for (const audit of audits) assert.doesNotMatch(JSON.stringify(audit.metadata), /@/, "no email in audit metadata");
      assert.deepEqual(sitePage.exceptions, []);
      // The superuser session ends before the recipient signs in alone.
      await signOut(sitePage);
      results.B2 = { audits: audits.map((a) => a.action) };
    });

    // =====================================================================
    // B3. The first GK administrator signs in alone and administers staff.
    // =====================================================================
    await test("B3: the first GK administrator signs in independently: own KAI identity, global and organization gk_admin effective, no platform-superuser authority, Team & Access with GK staff administration, organization and Project reads", async () => {
      const adminPage = await signIn(USERS.admin);
      const context = await adminPage.fetchJson("GET", contextPath);
      assert.deepEqual([context.status, context.data.platform_administration], [200, false], "gk_admin is not platform-superuser authority");
      assert.equal(await adminPage.goto("/admin"), "/", "ensureAdmin still redirects");
      assert.equal((await adminPage.fetchJson("GET", `/api/admin/users/lookup?email=${encodeURIComponent(email(USERS.operator))}`)).status, 403);
      const selfGlobal = await adminPage.fetchJson("PUT", globalRolePath(USERS.admin), { role_name: "gk_admin", action: "revoke" });
      assert.deepEqual([selfGlobal.status, selfGlobal.blockingReason], [403, "platform_superuser_required"]);
      const access = await effectiveAccess(adminPage, ORG_F);
      assert.deepEqual(access, { capabilitiesStatus: 200, workspace: true, intake: true, projectManagement: true, teamAccess: true, evidenceReview: true,
        sourceReview: true, sensitivityReview: true, projects: 200, evidence: 200, sourceQueue: 200 });
      const otherOrganization = await effectiveAccess(adminPage, ORG_G);
      assert.deepEqual([otherOrganization.capabilitiesStatus, otherOrganization.projects, otherOrganization.evidence, otherOrganization.sourceQueue], [403, 403, 403, 403]);
      const projects = await adminPage.fetchJson("GET", projectsPath(ORG_F));
      assert.ok(JSON.stringify(projects.data).includes(PROJECT_F), "the organization's Project is listed");
      const roster = await adminPage.fetchJson("GET", rosterPath(ORG_F));
      assert.deepEqual(roster.data.staff_onboarding_roles, ["gk_operator", "gk_reviewer"], "the server's scoped GK staff administration");
      assert.deepEqual([roster.data.global_roles_visible, roster.data.assignable_global_roles], [false, []]);
      assert.equal((await adminPage.fetchJson("GET", rosterPath(ORG_G))).status, 403);
      await openTeamAccess(adminPage);
      const body = await adminPage.text();
      assert.match(body, new RegExp(`Team & Access for ${ORG_F_NAME}`));
      assert.match(body, /Add Get Kinder staff/);
      assert.doesNotMatch(body, /Platform administration|Grant global role/);
      assert.ok(await memberHasRoleBadge(adminPage, USERS.admin, "gk_admin"));
      assert.equal(await adminPage.evaluate(`Boolean(document.getElementById("gk-team-access-add-role-legacy-${USERS.admin}"))`), false, "no Add role on the administrator's own row");
      assert.deepEqual(adminPage.exceptions, []);
      results.B3 = { access, otherOrganization: otherOrganization.capabilitiesStatus };

      // =================================================================
      // STEP 4: administrator -> operator onboarding in Team & Access.
      // =================================================================
      assert.equal(await kaiUserOf(USERS.operator), null, "the operator has never used KAI");
      const before = await allKaiCounts();
      const sent = await addStaff(adminPage, USERS.operator, "gk_operator",
        `${email(USERS.operator)} is now a Get Kinder operator here with the global Get Kinder operator role, and can sign in and start now.`);
      assert.deepEqual(sent, [["POST", staffPath(ORG_F), 200]], "one onboarding request, no platform step");
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles", "users"]);
      assert.equal((await kaiUserOf(USERS.operator)).status, "active");
      assert.deepEqual(await membershipsOf(USERS.operator), [{ organization_id: ORG_F, role_name: "gk_operator", membership_status: "active" }]);
      assert.deepEqual(await globalRolesOf(USERS.operator), ["gk_operator"]);
      const adminKaiUser = (await kaiUserOf(USERS.admin)).user_id;
      const audits = await auditsAbout(USERS.operator);
      assert.deepEqual(audits.map((a) => [a.action, a.actor_user_id, a.metadata.role_name, a.metadata.authority_source, a.metadata.organization_id]), [
        ["organization_role_granted_access_admitted", adminKaiUser, "gk_operator", "delegated_gk_admin", ORG_F],
        ["global_kai_role_assigned", adminKaiUser, "gk_operator", "delegated_gk_admin", ORG_F],
      ]);
      for (const audit of audits) assert.doesNotMatch(JSON.stringify(audit.metadata), /@/);
      await adminPage.waitFor(() => memberHasRoleBadge(adminPage, USERS.operator, "gk_operator"), "operator row");
      assert.equal(await readinessOf(adminPage, USERS.operator, "source_review"), "true");
      assert.equal(await staffOnboardingStatusOf(adminPage, USERS.operator, "gk_operator"), null, "complete onboarding shows no pending state");
      // Administrator-only limits, refused with nothing written.
      const limitsBefore = await allKaiCounts();
      const limits = {
        staffGkAdmin: await adminPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.plain), role_name: "gk_admin" }),
        organizationGkAdmin: await adminPage.fetchJson("POST", membershipRolesPath(ORG_F, USERS.plain), { role_name: "gk_admin" }),
        globalOperator: await adminPage.fetchJson("PUT", globalRolePath(USERS.plain), { role_name: "gk_operator", action: "assign" }),
        otherOrganization: await adminPage.fetchJson("POST", staffPath(ORG_G), { email: email(USERS.plain), role_name: "gk_operator" }),
        self: await adminPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.admin), role_name: "gk_reviewer" }),
      };
      assert.deepEqual(Object.values(limits).map((r) => r.status), [403, 403, 403, 403, 403]);
      assert.deepEqual([limits.staffGkAdmin.blockingReason, limits.globalOperator.blockingReason, limits.otherOrganization.blockingReason, limits.self.blockingReason],
        ["staff_onboarding_role_not_permitted", "platform_superuser_required", "missing_active_organization_membership", "self_role_elevation_not_allowed"]);
      await assertNothingWritten(limitsBefore, "delegated administrator limits");
      assert.deepEqual(adminPage.exceptions, []);
      await signOut(adminPage);
      results.STEP4_grant = { sent, audits: audits.map((a) => a.action) };
    });

    await test("STEP 4: the new operator signs in independently and creates a Project and reads the source-review queue in its organization; work beyond its authority is refused with nothing written", async () => {
      const operatorPage = await signIn(USERS.operator);
      const access = await effectiveAccess(operatorPage, ORG_F);
      assert.deepEqual(access, { capabilitiesStatus: 200, workspace: true, intake: true, projectManagement: true, teamAccess: false, evidenceReview: false,
        sourceReview: true, sensitivityReview: true, projects: 200, evidence: 200, sourceQueue: 200 });
      // The source-review queue the global operator role opens: the runner's
      // smoke-seeded open source candidates of this organization.
      const queue = await operatorPage.fetchJson("GET", sourceQueuePath(ORG_F));
      const [{ open: openSourceReviews }] = await query(
        "SELECT count(*)::int AS open FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'source_candidate_review' AND queue_status = 'open'", [ORG_F]);
      assert.equal(queue.data.items.length, openSourceReviews, "the operator receives the organization's open source reviews");
      // A permitted protected write: a new Project (kai.engagements) in its organization.
      const before = await allKaiCounts();
      const created = await operatorPage.fetchJson("POST", projectsPath(ORG_F), { engagement_code: "Operator First Project" });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const after = await allKaiCounts();
      assert.deepEqual(changedTables(before, after), ["audit_events", "engagements"]);
      const [project] = await query("SELECT engagement_id::text, organization_id::text FROM kai.engagements WHERE engagement_code = 'Operator First Project'");
      assert.equal(project.organization_id, ORG_F);
      const operatorKaiUser = (await kaiUserOf(USERS.operator)).user_id;
      assert.ok((await query("SELECT 1 FROM kai.audit_events WHERE actor_user_id = $1::uuid", [operatorKaiUser])).length > 0, "audited as the operator");
      // Beyond its authority.
      const refusals = {
        otherOrganizationProject: await operatorPage.fetchJson("POST", projectsPath(ORG_G), { engagement_code: "Operator Elsewhere" }),
        otherOrganizationQueue: (await operatorPage.fetchJson("GET", sourceQueuePath(ORG_G))).status,
        staff: await operatorPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.plain), role_name: "gk_operator" }),
        roster: (await operatorPage.fetchJson("GET", rosterPath(ORG_F))).status,
        globalRole: await operatorPage.fetchJson("PUT", globalRolePath(USERS.operator), { role_name: "gk_admin", action: "assign" }),
      };
      assert.deepEqual([refusals.otherOrganizationProject.status, refusals.otherOrganizationQueue, refusals.staff.status, refusals.roster, refusals.globalRole.status],
        [403, 403, 403, 403, 403]);
      await assertNothingWritten(after, "operator refusals");
      await openImpactLibrary(operatorPage);
      assert.equal(await operatorPage.visibleControl("Knowledge Studio"), true);
      assert.equal(await operatorPage.visibleControl("Team & Access"), false);
      assert.deepEqual(operatorPage.exceptions, []);
      await signOut(operatorPage);
      results.STEP4_operator = { access, sourceQueueItems: queue.data.items.length, project: created.status };
    });

    // =====================================================================
    // STEP 5: administrator -> reviewer onboarding, then reviewer sign-in.
    // =====================================================================
    await test("STEP 5: the GK administrator onboards a reviewer who never used KAI; the reviewer signs in, reads and sees the organization's evidence and review work, and is refused beyond its authority", async () => {
      const adminPage = await signIn(USERS.admin);
      await openTeamAccess(adminPage);
      assert.equal(await kaiUserOf(USERS.reviewer), null);
      const before = await allKaiCounts();
      const sent = await addStaff(adminPage, USERS.reviewer, "gk_reviewer",
        `${email(USERS.reviewer)} is now a Get Kinder reviewer here with the global Get Kinder reviewer role, and can sign in and start now.`);
      assert.deepEqual(sent, [["POST", staffPath(ORG_F), 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships", "user_roles", "users"]);
      assert.deepEqual(await membershipsOf(USERS.reviewer), [{ organization_id: ORG_F, role_name: "gk_reviewer", membership_status: "active" }]);
      assert.deepEqual(await globalRolesOf(USERS.reviewer), ["gk_reviewer"]);
      assert.deepEqual((await auditsAbout(USERS.reviewer)).map((a) => [a.action, a.metadata.authority_source]), [
        ["organization_role_granted_access_admitted", "delegated_gk_admin"], ["global_kai_role_assigned", "delegated_gk_admin"]]);
      await signOut(adminPage);

      const reviewerPage = await signIn(USERS.reviewer);
      const access = await effectiveAccess(reviewerPage, ORG_F);
      assert.deepEqual(access, { capabilitiesStatus: 200, workspace: true, intake: false, projectManagement: false, teamAccess: false, evidenceReview: true,
        sourceReview: true, sensitivityReview: true, projects: 200, evidence: 200, sourceQueue: 200 });
      const evidence = await reviewerPage.fetchJson("GET", evidencePath(ORG_F));
      const reviewQueue = await reviewerPage.fetchJson("GET", reviewQueuePath(ORG_F));
      assert.equal(reviewQueue.status, 200);
      const evidenceItemIds = (await query("SELECT evidence_item_id::text FROM kai.evidence_items WHERE organization_id = $1::uuid", [ORG_F])).map((row) => row.evidence_item_id);
      assert.ok(evidenceItemIds.length > 0, "the fixture organization has evidence");
      assert.ok(evidenceItemIds.some((id) => JSON.stringify(evidence.data).includes(id)), "the authorized read returns the organization's evidence");
      // The GK Studio presents it.
      await openImpactLibrary(reviewerPage);
      await reviewerPage.clickNav("Knowledge Studio");
      await reviewerPage.waitFor(async () => reviewerPage.evaluate(`Boolean(document.querySelector(".nav-tabs"))`), "Knowledge Studio tabs");
      await reviewerPage.clickTab("Evidence");
      await reviewerPage.waitFor(async () => reviewerPage.evaluate(`Boolean(document.querySelector("li.list-group-item[data-evidence-item-id]"))`), "evidence items listed");
      const shown = await reviewerPage.evaluate(`[...document.querySelectorAll("li.list-group-item[data-evidence-item-id]")].map((el) => el.getAttribute("data-evidence-item-id"))`);
      assert.ok(shown.every((id) => evidenceItemIds.includes(id)), "only this organization's evidence is shown");
      await reviewerPage.clickTab("Reviews");
      await reviewerPage.idle();
      // Beyond its authority.
      const refusalBefore = await allKaiCounts();
      const refusals = {
        project: await reviewerPage.fetchJson("POST", projectsPath(ORG_F), { engagement_code: "Reviewer Project" }),
        staff: await reviewerPage.fetchJson("POST", staffPath(ORG_F), { email: email(USERS.plain), role_name: "gk_reviewer" }),
        otherOrganizationEvidence: (await reviewerPage.fetchJson("GET", evidencePath(ORG_G))).status,
      };
      assert.deepEqual([refusals.project.status, refusals.staff.status, refusals.otherOrganizationEvidence], [403, 403, 403]);
      await assertNothingWritten(refusalBefore, "reviewer refusals");
      assert.equal(await reviewerPage.visibleControl("Team & Access"), false);
      assert.deepEqual(reviewerPage.exceptions, []);
      await signOut(reviewerPage);
      results.STEP5 = { access, evidenceShown: shown.length };
    });

    // =====================================================================
    // STEP 8: the known global-role policy boundaries, observed through the
    // same real sessions. Nothing here changes any policy.
    // =====================================================================
    await test("Risk B: after the site superuser revokes the reviewer's global role (organization role kept), the delegated administrator can re-complete the onboarding", async () => {
      const site = await signIn(USERS.site);
      await openTeamAccess(site);
      await platformSelectOrganization(site, ORG_F);
      await site.waitFor(() => memberHasRoleBadge(site, USERS.reviewer, "gk_reviewer"), "reviewer row");
      assert.deepEqual(await confirmGlobalRole(site, USERS.reviewer, "gk_reviewer", "Get Kinder reviewer", "revoke"), [["PUT", globalRolePath(USERS.reviewer), 200]]);
      assert.deepEqual(await globalRolesOf(USERS.reviewer), []);
      await signOut(site);
      const adminPage = await signIn(USERS.admin);
      await openTeamAccess(adminPage);
      await adminPage.waitFor(async () => (await staffOnboardingStatusOf(adminPage, USERS.reviewer, "gk_reviewer")) === "pending_completion", "pending completion");
      const mark = adminPage.mark();
      await clickMemberButton(adminPage, USERS.reviewer, "Complete Get Kinder reviewer onboarding");
      await adminPage.waitFor(async () => (await staffOnboardingStatusOf(adminPage, USERS.reviewer, "gk_reviewer")) === null, "completed");
      await adminPage.idle();
      assert.deepEqual(writes(adminPage.requestsSince(mark)), [["POST", staffPath(ORG_F, USERS.reviewer), 200]]);
      assert.deepEqual(await globalRolesOf(USERS.reviewer), ["gk_reviewer"], "the delegated administrator recreated the global role");
      const lastAudit = (await auditsAbout(USERS.reviewer)).at(-1);
      assert.deepEqual([lastAudit.action, lastAudit.metadata.authority_source], ["global_kai_role_assigned", "delegated_gk_admin"]);
      await signOut(adminPage);
      results.RISK_B = "observed: a delegated administrator re-completes a superuser-revoked global role while the person has no access elsewhere (Repair 1 open item 3)";
    });

    await test("Risk A / Risk D: later access in another organization lets the operator's global role take effect there; a new delegated onboarding for that person stays pending platform approval and is never shown as complete", async () => {
      const site = await signIn(USERS.site);
      await openTeamAccess(site);
      await platformSelectOrganization(site, ORG_G);
      // Later access elsewhere: an ordinary client membership in ORG_G.
      const added = await platformAddPerson(site, USERS.operator, "client_contributor");
      assert.ok(added.some(([method, path, status]) => method === "POST" && path === membershipRolesPath(ORG_G, USERS.operator) && status === 200));
      await signOut(site);
      const operatorPage = await signIn(USERS.operator);
      const elsewhere = await effectiveAccess(operatorPage, ORG_G);
      await signOut(operatorPage);
      results.RISK_A = { orgG: elsewhere };
      assert.equal(elsewhere.sourceReview, true, "observed: the global gk_operator role takes effect in ORG_G with a client membership there");

      const adminPage = await signIn(USERS.admin);
      await openTeamAccess(adminPage);
      const before = await allKaiCounts();
      const sent = await addStaff(adminPage, USERS.operator, "gk_reviewer",
        "is now a Get Kinder reviewer here, but the global Get Kinder reviewer role was not granted");
      assert.deepEqual(sent, [["POST", staffPath(ORG_F), 200]]);
      assert.deepEqual(changedTables(before, await allKaiCounts()), ["audit_events", "organization_memberships"], "no global role written");
      assert.deepEqual(await globalRolesOf(USERS.operator), ["gk_operator"]);
      await adminPage.waitFor(async () => (await staffOnboardingStatusOf(adminPage, USERS.operator, "gk_reviewer")) === "pending_platform_approval", "pending platform approval");
      assert.equal(await adminPage.evaluate(`Boolean([...document.querySelectorAll('[data-team-access-member="${rowKey(USERS.operator)}"] button')]
        .find((el) => el.innerText.trim() === "Complete Get Kinder reviewer onboarding"))`), false, "no completion offered");
      assert.match(await memberRowText(adminPage, USERS.operator), /Waiting for a platform administrator/);
      const roster = await adminPage.fetchJson("GET", rosterPath(ORG_F));
      const row = roster.data.access.find((entry) => entry.legacy_public_userdata_id === USERS.operator);
      assert.deepEqual(row.staff_onboarding.find((item) => item.role_name === "gk_reviewer").status, "pending_platform_approval");
      await signOut(adminPage);
      // What the pending organization role already gives (recorded, not decided here).
      const pendingPage = await signIn(USERS.operator);
      const pendingAccess = await effectiveAccess(pendingPage, ORG_F);
      await signOut(pendingPage);
      results.RISK_D = { status: "pending_platform_approval", globalWritten: false, completionOffered: false, organizationAccessWhilePending: pendingAccess };
    });

    await test("Risk C: a person who already holds the global role receives a new organization assignment elsewhere; the global role is effective there at once", async () => {
      const reviewerBefore = await signIn(USERS.reviewer);
      const beforeAccess = await effectiveAccess(reviewerBefore, ORG_G);
      await signOut(reviewerBefore);
      assert.equal(beforeAccess.capabilitiesStatus, 403);
      const site = await signIn(USERS.site);
      await openTeamAccess(site);
      await platformSelectOrganization(site, ORG_G);
      await platformAddPerson(site, USERS.reviewer, "gk_reviewer");
      await signOut(site);
      const reviewerPage = await signIn(USERS.reviewer);
      const afterAccess = await effectiveAccess(reviewerPage, ORG_G);
      await signOut(reviewerPage);
      results.RISK_C = { orgG: afterAccess };
      assert.equal(afterAccess.evidenceReview, true);
      assert.equal(afterAccess.sourceReview, true, "observed: the existing global role applies in the new organization without a new global grant");
    });
  } finally {
    console.log(`[first-gk-admin] results ${JSON.stringify(results)}`);
    for (const page of contexts.splice(0)) await page.close().catch(() => {});
    await browser.close();
    await app.stop();
    await seedPool.end();
  }
}
