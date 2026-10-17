import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * Real Get Kinder application harness for browser acceptances run by
 * scripts/kai-client-knowledge-studio-browser-acceptance-local-postgres.js.
 *
 * startRealApplication runs the repository's own index.js as a loopback child
 * process: a minimal environment (nothing inherited), an empty working
 * directory (dotenv finds no .env), the runner's loopback PostgreSQL as its
 * only database, and Neo4j, OpenAI and SMTP pointed at loopback - SMTP at an
 * in-process sink that records each message and delivers nothing. Every
 * request therefore crosses the real stack: POST /login, express-session with
 * connect-pg-simple, passport deserialization of public.userdata, the real
 * page gates and routers. openBrowserContext gives each sign-in its own
 * Chrome cookie jar; signIn posts the real /login form.
 */

const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SENTINEL = "127.0.0.1:9";

export function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`browser acceptance refused a non-loopback database URL host: ${host}`);
  }
}

export async function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * A minimal loopback SMTP server: accepts every message, stores its envelope
 * and raw data, and never relays anything.
 */
export async function startLoopbackSmtpSink() {
  const messages = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let current = { from: null, to: [], data: "" };
    const reply = (line) => socket.write(`${line}\r\n`);
    reply("220 loopback-smtp-sink ready");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push(current);
            current = { from: null, to: [], data: "" };
            reply("250 OK: queued in the loopback sink");
          } else {
            current.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === "EHLO" || command === "HELO") reply("250 loopback-smtp-sink");
        else if (command === "MAIL") { current.from = line; reply("250 OK"); }
        else if (command === "RCPT") { current.to.push(line.replace(/^RCPT TO:\s*/i, "").replace(/[<>]/g, "")); reply("250 OK"); }
        else if (command === "DATA") { inData = true; reply("354 End data with <CR><LF>.<CR><LF>"); }
        else if (command === "QUIT") { reply("221 Bye"); socket.end(); }
        else reply("250 OK");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    messages,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export async function startRealApplication({ databaseUrl, workdir, name = "real-app", env: extraEnv = {}, smtpPort = null }) {
  const runnerUrl = new URL(databaseUrl);
  const appCwd = join(workdir, `${name}-cwd`);
  mkdirSync(appCwd, { recursive: true });
  assert.equal(existsSync(join(appCwd, ".env")), false, "the application's working directory has no .env");
  const port = await freeLoopbackPort();
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
    SESSION_SECRET: `${name}-${Date.now()}-${Math.random()}`,
    KAI_SPRINT2_ENABLED: "true",
    NEO4J_URI: `bolt://${SENTINEL}`,
    NEO4J_USERNAME: "loopback-sentinel",
    NEO4J_PASSWORD: "loopback-sentinel",
    OPENAI_API_KEY: "sk-loopback-sentinel",
    OPENAI_BASE_URL: `http://${SENTINEL}/v1`,
    SMTP_URL: `smtp://127.0.0.1:${smtpPort || 9}`,
    SMTP_USER: "loopback-sentinel@harness.test",
    MAIL_FROM: "Get Kinder harness <loopback-sentinel@harness.test>",
    APP_URL: `http://127.0.0.1:${port}`,
    ...extraEnv,
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

// Minimal Chrome DevTools protocol client, as in the other acceptance specs.
// loopbackHostnames (optional) resolve to 127.0.0.1, so a spec can serve a
// page from a different site than the application; nothing leaves loopback.
export async function launchChrome({ chrome, workdir, profileName, loopbackHostnames = [] }) {
  const profileDir = join(workdir, `chrome-profile-${profileName}`);
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(chrome, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    // The real pages link CDN stylesheets and fonts; nothing leaves loopback.
    `--host-resolver-rules=${[...loopbackHostnames.map((hostname) => `MAP ${hostname} 127.0.0.1`), "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"].join(" , ")}`,
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
// Every fetch/XHR the page makes is recorded with its status.
export async function openBrowserContext(browser, baseUrl) {
  const { browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && (params.type === "Fetch" || params.type === "XHR")) {
      // A redirect reuses the request id: the previous hop is complete.
      if (params.redirectResponse && byId.has(params.requestId)) {
        Object.assign(byId.get(params.requestId), { status: params.redirectResponse.status, done: true });
      }
      const entry = { url: params.request.url, method: params.request.method, status: null, done: false, requestId: params.requestId };
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
      try {
        if (await predicate()) return;
      } catch {
        // the document is being replaced (a navigation); try again
      }
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
      const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`), `input ${id}`);
  };
  return {
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
    async responseJson(entry) {
      const { body, base64Encoded } = await browser.send("Network.getResponseBody", { requestId: entry.requestId }, sessionId);
      return JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body);
    },
    async cookies() {
      return (await browser.send("Network.getCookies", { urls: [baseUrl] }, sessionId)).cookies.map((cookie) => cookie.name).sort();
    },
    // A same-origin request carrying only this context's application cookie;
    // redirects are followed and reported (redirected, finalPath).
    fetchJson: (method, path, body) => evaluate(`(async () => {
      const response = await fetch(${JSON.stringify(`${baseUrl}${path}`)}, {
        method: ${JSON.stringify(method)},
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        ${body === undefined ? "" : `body: ${JSON.stringify(JSON.stringify(body))},`}
      });
      let parsed = null;
      try { parsed = await response.json(); } catch { parsed = null; }
      return {
        status: response.status,
        redirected: response.redirected,
        finalPath: new URL(response.url).pathname,
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
}

/**
 * Real Get Kinder sign-in: the /login form posted by the browser in a fresh
 * context; the application sets the session cookie. Returns the context.
 */
export async function signIn(browser, baseUrl, emailAddress, password) {
  const page = await openBrowserContext(browser, baseUrl);
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
    set("email", ${JSON.stringify(emailAddress)});
    set("password", ${JSON.stringify(password)});
    form.querySelector('button[type="submit"]').click();
    return true;
  })()`), "the real login form");
  await page.waitFor(async () => (await page.evaluate("document.readyState")) === "complete"
    && ((await page.pathname()) !== "/login" || (await page.text()).includes("Invalid email or password")), `sign-in of ${emailAddress}`);
  await page.idle();
  return page;
}

// Real sign-out; the next request from this context is unauthenticated.
export async function signOut(page, probePath) {
  await page.goto("/logout");
  assert.equal((await page.fetchJson("GET", probePath)).status, 401, "the session ended with sign-out");
  await page.close();
}
