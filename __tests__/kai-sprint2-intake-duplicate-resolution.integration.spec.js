import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { deflateRawSync } from "node:zlib";

/**
 * Real-PostgreSQL proof of the duplicate-upload resolution workflow
 * (kai_intake_duplicate_resolution_v1), run only by
 *   node scripts/kai-sprint2-intake-duplicate-resolution-local-postgres.js
 * against that runner's ephemeral loopback PostgreSQL. Skipped otherwise.
 *
 * Real: the mounted Sprint 2 intake router over HTTP, resolveKaiActorContext
 * with real memberships and roles, the intake service and every SQL
 * statement it issues (declared-checksum lookup, match listing, FOR UPDATE
 * lock, lineage insert, required audit, both partial unique indexes, the
 * lineage self-FKs, the Gate A lifecycle trigger), the Postgres upload
 * lifecycle repository, confirm-time byte verification, the bounded per-type
 * security detectors and policy CAS, the frontend's own request/parse/view
 * logic, and - for the dialog - the real KaiWebIntake component compiled
 * from source and driven in headless Chrome.
 * Synthetic: object storage (an in-process stand-in for the GCS signed-PUT
 * and exact-generation read contract), the malware scanner verdict, the Get
 * Kinder session login (req.user from a harness cookie), and every
 * identifier and byte.
 */

const RUNNER_DATABASE_URL = process.env.KAI_INTAKE_DUPLICATE_RESOLUTION_DATABASE_URL;
const RUNNER_DATABASE_NAME = process.env.KAI_INTAKE_DUPLICATE_RESOLUTION_DATABASE_NAME;
const CHROME = process.env.KAI_INTAKE_DUPLICATE_RESOLUTION_CHROME;
const WORKDIR = process.env.KAI_INTAKE_DUPLICATE_RESOLUTION_WORKDIR;
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`duplicate-resolution proof refused a non-loopback database URL host: ${host}`);
  }
}

test("duplicate-resolution real-PostgreSQL isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

// ---------------------------------------------------------------------------
// Synthetic file bytes for the five supported formats. Each factory returns
// distinct, valid bytes per label, so every scenario has its own content.
// The XLSX/PDF builders follow kai-sprint2-p0-acceptance.spec.js.
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function concatBytes(parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function writeUint16LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function createZip(entries) {
  const localRecords = [];
  const localBytes = [];
  let localHeaderOffset = 0;
  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const contentBytes = textEncoder.encode(entry.content);
    const compressedBytes = entry.deflate ? deflateRawSync(contentBytes) : contentBytes;
    const compressionMethod = entry.deflate ? 8 : 0;
    const header = new Uint8Array(30 + nameBytes.byteLength);
    writeUint32LE(header, 0, 0x04034b50);
    writeUint16LE(header, 4, 20);
    writeUint16LE(header, 8, compressionMethod);
    writeUint32LE(header, 18, compressedBytes.byteLength);
    writeUint32LE(header, 22, contentBytes.byteLength);
    writeUint16LE(header, 26, nameBytes.byteLength);
    header.set(nameBytes, 30);
    localRecords.push({
      nameBytes,
      compressionMethod,
      compressedSize: compressedBytes.byteLength,
      uncompressedSize: contentBytes.byteLength,
      localHeaderOffset,
    });
    localBytes.push(header, compressedBytes);
    localHeaderOffset += header.byteLength + compressedBytes.byteLength;
  }
  const centralDirectoryBytes = localRecords.map((entry) => {
    const record = new Uint8Array(46 + entry.nameBytes.byteLength);
    writeUint32LE(record, 0, 0x02014b50);
    writeUint16LE(record, 4, 20);
    writeUint16LE(record, 6, 20);
    writeUint16LE(record, 10, entry.compressionMethod);
    writeUint32LE(record, 20, entry.compressedSize);
    writeUint32LE(record, 24, entry.uncompressedSize);
    writeUint16LE(record, 28, entry.nameBytes.byteLength);
    writeUint32LE(record, 42, entry.localHeaderOffset);
    record.set(entry.nameBytes, 46);
    return record;
  });
  const centralDirectoryLength = centralDirectoryBytes.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = new Uint8Array(22);
  writeUint32LE(eocd, 0, 0x06054b50);
  writeUint16LE(eocd, 8, entries.length);
  writeUint16LE(eocd, 10, entries.length);
  writeUint32LE(eocd, 12, centralDirectoryLength);
  writeUint32LE(eocd, 16, localHeaderOffset);
  return concatBytes([...localBytes, ...centralDirectoryBytes, eocd]);
}

function xlsxBytes(label) {
  const value = Number.parseInt(sha256(Buffer.from(label)).slice(0, 8), 16);
  return createZip([
    {
      name: "[Content_Types].xml",
      content: "<?xml version=\"1.0\"?><Types><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/></Types>",
    },
    { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
    {
      name: "xl/workbook.xml",
      content: "<?xml version=\"1.0\"?><workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"S1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>",
      deflate: true,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet><sheetData><row><c><v>${value}</v></c></row></sheetData></worksheet>`,
    },
  ]);
}

function pdfBytes(label) {
  const text = `KAI synthetic program notes ${label.replace(/[^A-Za-z0-9 -]/g, "")}`;
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  const offsets = [0];
  const parts = [Buffer.from("%PDF-1.4\n", "latin1")];
  let byteOffset = parts[0].byteLength;
  objects.forEach((object, index) => {
    offsets.push(byteOffset);
    const objectBytes = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1");
    parts.push(objectBytes);
    byteOffset += objectBytes.byteLength;
  });
  parts.push(Buffer.from([
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${byteOffset}\n%%EOF\n`,
  ].join(""), "latin1"));
  return Buffer.concat(parts);
}

const FORMATS = Object.freeze([
  { name: "CSV", extension: ".csv", make: (label) => Buffer.from(`program,outcome\n${label},1\n`, "utf8") },
  { name: "XLSX", extension: ".xlsx", make: xlsxBytes },
  { name: "MD", extension: ".md", make: (label) => Buffer.from(`# Program notes\n\n${label} kindness outcomes.\n`, "utf8") },
  { name: "TXT", extension: ".txt", make: (label) => Buffer.from(`Program notes: ${label} kindness outcomes.\n`, "utf8") },
  { name: "PDF", extension: ".pdf", make: pdfBytes },
]);

// ---------------------------------------------------------------------------
// Minimal Chrome DevTools protocol client (Node's built-in WebSocket), the
// same shape as kai-web-intake-files-rehydration-browser-acceptance.
// ---------------------------------------------------------------------------

async function launchChrome() {
  const profileDir = join(WORKDIR, "chrome-profile-duplicate-resolution");
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
  const requests = [];
  const byId = new Map();
  const exceptions = [];
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const { method, params } = message;
    if (method === "Network.requestWillBeSent" && params.type !== "Document") {
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
  for (const domain of ["Page", "Network", "Runtime", "DOM"]) await browser.send(`${domain}.enable`, {}, sessionId);
  await browser.send("Network.setCookie", { name: "kai_harness_user", value: String(legacyUserId), url: baseUrl }, sessionId);

  const evaluate = async (expression) => {
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} ${expression.slice(0, 120)}`);
    return result.result.value;
  };
  const text = () => evaluate("document.body ? document.body.innerText : ''");
  const idle = async () => {
    let quietSince = Date.now();
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (requests.some((request) => !request.done)) quietSince = Date.now();
      else if (Date.now() - quietSince > 400) return;
    }
    throw new Error("network never went idle");
  };
  const waitFor = async (predicate, description, { timeout = 20000 } = {}) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${description}\n--- page ---\n${(await text()).slice(0, 3000)}`);
  };
  const waitForText = (needle, options) => waitFor(async () => (await text()).includes(needle), `text: ${needle}`, options);
  const clickButton = async (label, { within = "document" } = {}) => {
    // Waits for the control to be present and enabled (not busy), as a user would.
    const deadline = Date.now() + 15000;
    let clicked = false;
    while (!clicked && Date.now() < deadline) {
      clicked = await evaluate(`(() => {
        const scope = ${within};
        const button = scope && [...scope.querySelectorAll("button")]
          .filter((el) => el.offsetParent !== null && !el.disabled)
          .find((el) => el.innerText.trim() === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`);
      if (!clicked) await new Promise((r) => setTimeout(r, 100));
    }
    if (!clicked) throw new Error(`no enabled button: ${label}\n--- page ---\n${(await text()).slice(0, 2000)}`);
  };
  const dialogScope = "[...document.querySelectorAll('[role=status]')].find((el) => el.innerText.includes('This file has already been added.'))";
  const dialog = () => evaluate(`(() => {
    const el = ${dialogScope};
    if (!el) return null;
    return { text: el.innerText, buttons: [...el.querySelectorAll("button")].map((b) => b.innerText.trim()) };
  })()`);
  const chooseFile = async (path) => {
    // A fresh selection each time: clear the input, then set the file, which
    // dispatches the input's change event exactly as a user selection does.
    await evaluate("(() => { const input = document.querySelector('input[type=file]'); input.value = ''; return true; })()");
    const { root } = await browser.send("DOM.getDocument", { depth: -1 }, sessionId);
    const { nodeId } = await browser.send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" }, sessionId);
    await browser.send("DOM.setFileInputFiles", { nodeId, files: [path] }, sessionId);
  };
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
    clickButton,
    dialog,
    dialogScope,
    chooseFile,
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
// Suite
// ---------------------------------------------------------------------------

async function runDuplicateResolutionRealPostgresSuite() {
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const esbuild = await import("esbuild");
  const ambientPool = (await import("../Backend/db/pg.js")).default;
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { requireKaiSprint2Authenticated } = await import("../Backend/kai/middleware/kaiSprint2Authentication.js");
  const { setKaiIntakeRuntimeDependenciesForTest } = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const { createPostgresUploadLifecycleRepository } = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const { createInternalSecurityAssessmentExecutor } = await import("../Backend/kai/security/internalSecurityAssessmentExecutor.js");
  const { assessBoundedFileSecurity } = await import("../Backend/kai/security/boundedFileSecurityAssessor.js");
  const intakeLogic = await import("../frontend/kaiWebIntakeLogic.js");
  const {
    confirmUploadPath,
    declaredMimeTypeForFile,
    duplicateResolutionFromResult,
    duplicateResolutionView,
    fileDetailPath,
    fileExtensionOf,
    fileReservationsPath,
    requestUploadUrlPath,
  } = intakeLogic;

  const seedPool = new Pool({ connectionString: RUNNER_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await seedPool.query(sql, params)).rows;

  // The ambient pool every unmodified service/query default uses must be the
  // runner-owned loopback cluster, never anything .env could name.
  const ambientTarget = (await ambientPool.query(
    "SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr",
  )).rows[0];
  assert.equal(ambientTarget.database_name, RUNNER_DATABASE_NAME);
  assert.ok(["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(ambientTarget.server_addr));

  // --- fixture --------------------------------------------------------------
  const ORG_A = "00000000-0000-4000-8000-0000000d0a01";
  const ORG_B = "00000000-0000-4000-8000-0000000d0b01";
  const USERS = Object.freeze({ gk: 911, clientAdminA: 912, clientViewerA: 913, clientAdminB: 914 });
  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code)
               VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-dup'),
                      ($2::uuid, 'Ridgeway Synthetic Trust', 'ridgeway-dup')`, [ORG_A, ORG_B]);
  const kaiUserIds = {};
  for (const [name, legacyId, org, role, global] of [
    ["gk", USERS.gk, ORG_A, "gk_operator", true],
    ["clientAdminA", USERS.clientAdminA, ORG_A, "client_admin", false],
    ["clientViewerA", USERS.clientViewerA, ORG_A, "client_viewer", false],
    ["clientAdminB", USERS.clientAdminB, ORG_B, "client_admin", false],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    kaiUserIds[name] = kaiUser.user_id;
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [org, kaiUser.user_id, role]);
    if (global) {
      await query("INSERT INTO kai.user_roles (user_id, role_id) SELECT $1::uuid, role_id FROM kai.roles WHERE role_name = $2", [kaiUser.user_id, role]);
    }
  }

  async function createEngagement(organizationId, code) {
    const engagementId = randomUUID();
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, $3)",
      [engagementId, organizationId, code]);
    return engagementId;
  }
  async function createBatch(organizationId, engagementId, code) {
    const intakeBatchId = randomUUID();
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, created_by)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid)`, [intakeBatchId, organizationId, engagementId, code, kaiUserIds.gk]);
    return intakeBatchId;
  }

  // --- synthetic object storage + malware verdicts ---------------------------
  const objects = new Map();
  const signedTargets = new Map();
  let generation = 1700000000000001n;
  let baseUrl = "";
  const malwareDetected = new Set();
  const malwareScanFailures = new Set();
  // Set by a test: the next confirm completes on the server, but its response
  // is replaced by a gateway timeout, as a proxy in front of a long confirm does.
  const gateway = { dropNextConfirmResponse: false };
  const syntheticProvenance = Object.freeze({ adapter_id: "kai_synthetic_fixture_adapter", signature_set: "v1" });
  const storage = Object.freeze({
    enabled: true,
    async createSignedUploadUrl({ objectKey, contentType }) {
      const token = randomUUID();
      signedTargets.set(token, { objectKey, contentType });
      return {
        ok: true,
        data: {
          url: `${baseUrl}/synthetic-storage/${token}`,
          method: "PUT",
          headers: { "Content-Type": contentType },
          expires_in_seconds: 900,
        },
      };
    },
    async headObject({ objectKey }) {
      const stored = objects.get(objectKey);
      if (!stored) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { candidate_generation: stored.generation, size_bytes: stored.bytes.byteLength } };
    },
    async statExactGeneration({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength } };
    },
    async openExactGenerationReadStream({ objectKey, gcsGeneration }) {
      const stored = objects.get(objectKey);
      if (!stored || stored.generation !== gcsGeneration) return { ok: false, error: { code: "not_found" } };
      return { ok: true, data: { size_bytes: stored.bytes.byteLength, byte_source: Readable.from([Buffer.from(stored.bytes)]) } };
    },
  });
  const malwareScanAdapter = Object.freeze({
    async scan({ sha256: digest }) {
      if (malwareDetected.has(digest)) return { status: "malware_detected", provenance: { ...syntheticProvenance } };
      if (malwareScanFailures.has(digest)) return { status: "failed", category: "malware_scan_failed" };
      return { status: "clean", provenance: { ...syntheticProvenance } };
    },
  });
  const restoreRuntime = setKaiIntakeRuntimeDependenciesForTest(Object.freeze({
    env: process.env,
    gcsProvider: storage,
    gcsUploadSignerProvider: storage,
    gcsParserReaderProvider: storage,
    uploadLifecycleRepository: createPostgresUploadLifecycleRepository(),
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      assessor: (input) => assessBoundedFileSecurity(input, { malwareScanAdapter }),
    }),
  }));

  // --- harness app ------------------------------------------------------------
  const harnessBundle = await esbuild.build({
    stdin: {
      contents: `
        import React, { useState } from "react";
        import { createRoot } from "react-dom/client";
        import KaiWebIntake from "./KaiWebIntake.jsx";
        const config = window.__KAI_DUPLICATE_HARNESS__;
        function Harness() {
          const [intakeBatchId, setIntakeBatchId] = useState("");
          return React.createElement(KaiWebIntake, {
            organizationId: config.organizationId,
            engagementId: config.engagementId,
            embedded: true,
            intakeBatchId,
            onIntakeBatchIdChange: setIntakeBatchId,
            processingStatus: { status: "not_started", data: null, error: null },
          });
        }
        createRoot(document.getElementById("root")).render(React.createElement(Harness));
      `,
      resolveDir: join(REPO_ROOT, "frontend"),
      loader: "jsx",
      sourcefile: "kai-duplicate-resolution-harness.jsx",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    jsx: "automatic",
    loader: { ".js": "jsx", ".jsx": "jsx" },
    define: { "process.env.NODE_ENV": JSON.stringify("production"), global: "window" },
    logLevel: "silent",
  });
  const harnessScript = harnessBundle.outputFiles[0].text;

  const app = express();
  app.put("/synthetic-storage/:token", express.raw({ type: () => true, limit: "10mb" }), (req, res) => {
    const target = signedTargets.get(req.params.token);
    // Like a V4 signed PUT: only the signed object key, with the signed type.
    if (!target || req.get("content-type") !== target.contentType) return res.status(403).end();
    generation += 1n;
    objects.set(target.objectKey, { bytes: Buffer.from(req.body), generation: generation.toString() });
    return res.status(200).end();
  });
  app.use(express.json());
  app.post("/api/kai/sprint2/intake/admin/files/:intakeFileId/confirm-upload", (_req, res, next) => {
    if (!gateway.dropNextConfirmResponse) return next();
    gateway.dropNextConfirmResponse = false;
    const send = res.json.bind(res);
    res.json = () => res.status(504) && send({ ok: false, error: { code: "gateway_timeout", message: "Gateway timeout." } });
    return next();
  });
  app.use((req, _res, next) => {
    const match = /(?:^|;\s*)kai_harness_user=(\d+)/.exec(req.headers.cookie || "");
    if (match) req.user = { id: Number(match[1]), email: `user${match[1]}@harbourline.test` };
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/kai/sprint2/intake", requireKaiSprint2Enabled, requireKaiSprint2Authenticated, sprint2IntakeApiRouter);
  app.get("/harness.js", (_req, res) => res.type("application/javascript").send(harnessScript));
  app.get("/duplicate-harness", (req, res) => res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>Intake</title></head>
    <body><div id="root"></div>
    <script>window.__KAI_DUPLICATE_HARNESS__ = ${JSON.stringify({ organizationId: req.query.organization_id, engagementId: req.query.engagement_id })};</script>
    <script src="/harness.js"></script></body></html>`));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Tests are awaited one by one below; this runs after the last of them.
  async function closeHarness() {
    restoreRuntime();
    await new Promise((resolve) => server.close(resolve));
    await seedPool.end();
    await ambientPool.end();
  }

  // --- client: the frontend's own paths, MIME fallback, and result shape -----
  async function call(legacyUserId, method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Cookie: `kai_harness_user=${legacyUserId}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let parsed = null;
    try { parsed = await response.json(); } catch { parsed = null; }
    return { statusCode: response.status, body: parsed };
  }

  // A browser-like selected file (the browser reports no type for every
  // format here, so the request exercises the declared-MIME fallback).
  function selectedFile(format, label, name = `program-results${format.extension}`) {
    const bytes = format.make(label);
    return { name, type: "", size: bytes.byteLength, bytes, checksum: sha256(bytes) };
  }

  function reserve(legacyUserId, { organizationId, engagementId, intakeBatchId, file, key, duplicateOf = null }) {
    return call(legacyUserId, "POST", fileReservationsPath(intakeBatchId), {
      organization_id: organizationId,
      engagement_id: engagementId,
      original_filename: file.name,
      file_extension: fileExtensionOf(file.name),
      mime_type: declaredMimeTypeForFile(file),
      file_size_bytes: file.size,
      checksum: file.checksum,
      hash_algorithm: "sha256",
      idempotency_key: key,
      ...(duplicateOf ? { force_new_version: true, duplicate_of_intake_file_id: duplicateOf } : {}),
    });
  }

  // KaiWebIntake's transferAndConfirm: sign, PUT the selected bytes, confirm.
  async function transferAndConfirm(legacyUserId, { organizationId, engagementId, intakeBatchId, intakeFileId, file, uploadState = "reserved" }) {
    if (uploadState === "reserved") {
      const signed = await call(legacyUserId, "POST", requestUploadUrlPath(intakeBatchId), {
        organization_id: organizationId,
        engagement_id: engagementId,
        intake_file_id: intakeFileId,
      });
      assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
      const put = await fetch(signed.body.data.upload_url, {
        method: signed.body.data.upload_method,
        headers: signed.body.data.upload_headers,
        body: file.bytes,
      });
      assert.equal(put.status, 200);
    }
    return call(legacyUserId, "POST", confirmUploadPath(organizationId, intakeFileId), { organization_id: organizationId });
  }

  async function uploadNew(legacyUserId, context, file, key) {
    const reserved = await reserve(legacyUserId, { ...context, file, key });
    assert.equal(reserved.statusCode, 201, JSON.stringify(reserved.body));
    const intakeFileId = reserved.body.data.intake_file_id;
    const confirmed = await transferAndConfirm(legacyUserId, { ...context, intakeFileId, file });
    assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
    return intakeFileId;
  }

  const fileRow = async (intakeFileId) => (await query(
    `SELECT intake_file_id, intake_batch_id, organization_id, engagement_id, upload_state, file_policy_status,
            processing_status::text AS processing_status, force_new_version, original_intake_file_id,
            supersedes_intake_file_id, verified_checksum, file_metadata
       FROM kai.intake_files WHERE intake_file_id = $1::uuid`,
    [intakeFileId],
  ))[0];
  const rowsForChecksum = (organizationId, checksum) => query(
    "SELECT intake_file_id, force_new_version FROM kai.intake_files WHERE organization_id = $1::uuid AND checksum = $2 ORDER BY created_at",
    [organizationId, checksum],
  );
  const newVersionAudits = (intakeFileId) => query(
    "SELECT action, organization_id, actor_user_id, reason_code, metadata FROM kai.audit_events WHERE action = 'reserve_intake_file_new_version' AND metadata->>'intake_file_id' = $1",
    [intakeFileId],
  );

  function assertDuplicate422(result, { status, existingId, actions, restriction = null, checksum }) {
    assert.equal(result.statusCode, 422, JSON.stringify(result.body));
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.code, "validation_blocker");
    assert.equal(result.body.blockers[0].validator_key, "VAL-IDEMP-006");
    assert.equal(result.body.blockers[0].blocking_reason, "duplicate_checksum");
    const resolution = result.body.data.duplicate_resolution;
    assert.equal(resolution.contract, "kai_intake_duplicate_resolution_v1");
    assert.equal(resolution.duplicate_status, status);
    assert.equal(resolution.existing_file.intake_file_id, existingId);
    assert.deepEqual(resolution.available_actions, actions);
    assert.equal(resolution.restriction_code, restriction);
    assertNoUnsafeFields(result.body, checksum);
    // The browser's own parser and view render exactly the server's actions.
    const parsed = duplicateResolutionFromResult(result);
    assert.ok(parsed, "frontend recognizes the duplicate resolution");
    assert.deepEqual(duplicateResolutionView(parsed).actions.map((item) => item.action), actions);
    return resolution;
  }

  function assertNoUnsafeFields(body, checksum) {
    const serialized = JSON.stringify(body);
    for (const forbidden of [checksum, "storage_object_key", "storage_uri", "reservation://", "synthetic-storage", "/org/"]) {
      assert.equal(serialized.includes(forbidden), false, `response must not disclose ${forbidden}`);
    }
  }

  const keyFor = (...parts) => `dup-${parts.join("-")}-${randomUUID().slice(0, 8)}`;

  // -------------------------------------------------------------------------
  // Per format: the complete duplicate path on real PostgreSQL.
  // -------------------------------------------------------------------------
  for (const format of FORMATS) {
    await test(`${format.name}: first upload, replay, 422 resolution, use existing, explicit new version with lineage and audit, replay, stale 409, other batch/engagement, tenant isolation, denied actor - on real PostgreSQL`, async () => {
      const tag = format.name.toLowerCase();
      const engagement = await createEngagement(ORG_A, `dup-${tag}-alpha`);
      const otherEngagement = await createEngagement(ORG_A, `dup-${tag}-beta`);
      const engagementB = await createEngagement(ORG_B, `dup-${tag}-ridgeway`);
      const batch = await createBatch(ORG_A, engagement, `dup-${tag}-a1`);
      const sameEngagementBatch = await createBatch(ORG_A, engagement, `dup-${tag}-a2`);
      const otherEngagementBatch = await createBatch(ORG_A, otherEngagement, `dup-${tag}-b1`);
      const batchB = await createBatch(ORG_B, engagementB, `dup-${tag}-r1`);
      const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };
      const file = selectedFile(format, `${tag}-main`);
      const checksum = file.checksum;

      // 1. First upload: ordinary reservation, transfer, byte verification,
      // and the real per-type security assessment.
      const firstKey = keyFor(tag, "first");
      const firstId = await uploadNew(USERS.clientAdminA, ctx, file, firstKey);
      const first = await fileRow(firstId);
      assert.equal(first.upload_state, "confirmed");
      assert.equal(first.file_policy_status, "passed");
      assert.equal(first.force_new_version, false);
      assert.equal(first.original_intake_file_id, null);
      assert.equal(first.verified_checksum, checksum);

      // 2. Exact replay of the same reservation intent: the same record.
      const replay = await reserve(USERS.clientAdminA, { ...ctx, file, key: firstKey });
      assert.equal(replay.statusCode, 201);
      assert.equal(replay.body.data.intake_file_id, firstId);
      assert.equal((await rowsForChecksum(ORG_A, checksum)).length, 1);

      // 3. The reported failure: a repeat upload of the same bytes is 422
      // VAL-IDEMP-006 / duplicate_checksum - now with an executable resolution.
      const repeat = await reserve(USERS.clientAdminA, { ...ctx, file, key: keyFor(tag, "repeat") });
      assertDuplicate422(repeat, {
        status: "duplicate_in_batch",
        existingId: firstId,
        actions: ["use_existing_file", "upload_new_intake_version", "cancel"],
        checksum,
      });
      assert.equal((await rowsForChecksum(ORG_A, checksum)).length, 1);
      const blockedAudit = (await query(
        "SELECT action, reason_code, metadata FROM kai.audit_events WHERE organization_id = $1::uuid AND metadata->>'intake_batch_id' = $2",
        [ORG_A, batch],
      )).filter((row) => JSON.stringify(row).toUpperCase().includes("VAL-IDEMP-006"));
      assert.equal(blockedAudit.length, 1, "the VAL-IDEMP-006 blocked attempt is audited");
      assert.equal(JSON.stringify(blockedAudit[0]).includes(checksum), false);

      // 4. Use existing file: the existing record's detail is readable.
      const detail = await call(USERS.clientAdminA, "GET", fileDetailPath(ORG_A, firstId));
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.body.data.intake_file_id, firstId);

      // 5. Upload as a new intake version: lineage, required audit, and the
      // full upload/verification/security path for the new record.
      const versionKey = keyFor(tag, "version");
      const version = await reserve(USERS.clientAdminA, { ...ctx, file, key: versionKey, duplicateOf: firstId });
      assert.equal(version.statusCode, 201, JSON.stringify(version.body));
      assert.deepEqual(version.body.warnings.map((warning) => warning.code), ["duplicate_in_batch"]);
      const versionId = version.body.data.intake_file_id;
      let versionRow = await fileRow(versionId);
      assert.equal(versionRow.upload_state, "reserved");
      assert.equal(versionRow.file_policy_status, "pending");
      assert.equal(versionRow.processing_status, "quarantined");
      assert.equal(versionRow.force_new_version, true);
      assert.equal(versionRow.original_intake_file_id, firstId);
      assert.equal(versionRow.supersedes_intake_file_id, firstId);
      assert.deepEqual(versionRow.file_metadata.duplicate_resolution, {
        force_new_version: true,
        duplicate_of_intake_file_id: firstId,
        duplicate_status: "duplicate_in_batch",
      });
      const audits = await newVersionAudits(versionId);
      assert.equal(audits.length, 1);
      assert.equal(audits[0].organization_id, ORG_A);
      assert.equal(audits[0].actor_user_id, kaiUserIds.clientAdminA);
      assert.equal(audits[0].reason_code, "duplicate_in_batch");
      assert.equal(audits[0].metadata.original_intake_file_id, firstId);
      assert.equal(audits[0].metadata.supersedes_intake_file_id, firstId);
      assert.equal(audits[0].metadata.duplicate_of_intake_file_id, firstId);
      assert.equal(JSON.stringify(audits[0].metadata).includes(checksum), false);
      const versionConfirmed = await transferAndConfirm(USERS.clientAdminA, { ...ctx, intakeFileId: versionId, file });
      assert.equal(versionConfirmed.statusCode, 200, JSON.stringify(versionConfirmed.body));
      versionRow = await fileRow(versionId);
      assert.equal(versionRow.upload_state, "confirmed");
      assert.equal(versionRow.file_policy_status, "passed");
      assert.equal(versionRow.verified_checksum, checksum);
      assert.equal((await fileRow(firstId)).upload_state, "confirmed", "the original record is preserved");

      // 6. Replay of the new-version request: the same record, no new audit;
      // the same key for a different intent is refused.
      const versionReplay = await reserve(USERS.clientAdminA, { ...ctx, file, key: versionKey, duplicateOf: firstId });
      assert.equal(versionReplay.statusCode, 201);
      assert.equal(versionReplay.body.data.intake_file_id, versionId);
      assert.equal((await newVersionAudits(versionId)).length, 1);
      const conflicting = await reserve(USERS.clientAdminA, { ...ctx, file, key: versionKey });
      assert.equal(conflicting.statusCode, 409);
      assert.equal(conflicting.body.error.code, "duplicate_conflict");
      assert.equal((await rowsForChecksum(ORG_A, checksum)).length, 2);

      // 7. Stale: the record presented earlier is no longer the batch's
      // current one, so a new request naming it gets 409 with a fresh
      // resolution, which the frontend accepts.
      const stale = await reserve(USERS.clientAdminA, { ...ctx, file, key: keyFor(tag, "stale"), duplicateOf: firstId });
      assert.equal(stale.statusCode, 409);
      assert.equal(stale.body.error.code, "conflict_current_state_changed");
      assert.equal(stale.body.data.duplicate_resolution.existing_file.intake_file_id, versionId);
      assert.deepEqual(stale.body.data.duplicate_resolution.available_actions, ["use_existing_file", "upload_new_intake_version", "cancel"]);
      assert.ok(duplicateResolutionFromResult(stale));
      assertNoUnsafeFields(stale.body, checksum);
      assert.equal((await rowsForChecksum(ORG_A, checksum)).length, 2);

      // 8. Same project, other batch: a linked record only.
      const otherCtx = { ...ctx, intakeBatchId: sameEngagementBatch };
      const otherBatch = await reserve(USERS.clientAdminA, { ...otherCtx, file, key: keyFor(tag, "other-batch") });
      const otherResolution = assertDuplicate422(otherBatch, {
        status: "duplicate_in_other_batch",
        existingId: versionId,
        actions: ["upload_new_intake_version", "cancel"],
        checksum,
      });
      const linked = await reserve(USERS.clientAdminA, {
        ...otherCtx,
        file,
        key: keyFor(tag, "linked"),
        duplicateOf: otherResolution.existing_file.intake_file_id,
      });
      assert.equal(linked.statusCode, 201, JSON.stringify(linked.body));
      assert.deepEqual(linked.body.warnings.map((warning) => warning.code), ["duplicate_candidate_recorded"]);
      const linkedConfirmed = await transferAndConfirm(USERS.clientAdminA, { ...otherCtx, intakeFileId: linked.body.data.intake_file_id, file });
      assert.equal(linkedConfirmed.statusCode, 200);
      const linkedRow = await fileRow(linked.body.data.intake_file_id);
      assert.equal(linkedRow.intake_batch_id, sameEngagementBatch);
      assert.equal(linkedRow.original_intake_file_id, firstId);
      assert.equal(linkedRow.supersedes_intake_file_id, null);
      assert.equal(linkedRow.file_policy_status, "passed");

      // 9. Other project in the same organization.
      const otherEngagementCtx = { organizationId: ORG_A, engagementId: otherEngagement, intakeBatchId: otherEngagementBatch };
      const otherProject = await reserve(USERS.clientAdminA, { ...otherEngagementCtx, file, key: keyFor(tag, "other-project") });
      assertDuplicate422(otherProject, {
        status: "duplicate_in_other_engagement",
        existingId: otherProject.body.data.duplicate_resolution.existing_file.intake_file_id,
        actions: ["upload_new_intake_version", "cancel"],
        checksum,
      });

      // 10. Tenant isolation: another organization never matches, sees, or
      // versions organization A's record.
      const ctxB = { organizationId: ORG_B, engagementId: engagementB, intakeBatchId: batchB };
      const crossForce = await reserve(USERS.clientAdminB, { ...ctxB, file, key: keyFor(tag, "cross-force"), duplicateOf: firstId });
      assert.equal(crossForce.statusCode, 409);
      assert.equal(crossForce.body.data, null);
      assert.equal(JSON.stringify(crossForce.body).includes(firstId), false);
      const firstB = await uploadNew(USERS.clientAdminB, ctxB, file, keyFor(tag, "org-b"));
      assert.equal((await fileRow(firstB)).force_new_version, false, "org B's identical file is its own first record");
      const crossDetail = await call(USERS.clientAdminB, "GET", fileDetailPath(ORG_A, firstId));
      assert.equal(crossDetail.statusCode, 403);
      const repeatB = await reserve(USERS.clientAdminB, { ...ctxB, file, key: keyFor(tag, "org-b-repeat") });
      assertDuplicate422(repeatB, {
        status: "duplicate_in_batch",
        existingId: firstB,
        actions: ["use_existing_file", "upload_new_intake_version", "cancel"],
        checksum,
      });
      for (const id of [firstId, versionId, linked.body.data.intake_file_id]) {
        assert.equal(JSON.stringify(repeatB.body).includes(id), false, "organization A's records are never disclosed to B");
      }
      const crossVersion = await reserve(USERS.clientAdminB, { ...ctxB, file, key: keyFor(tag, "cross-version"), duplicateOf: firstId });
      assert.equal(crossVersion.statusCode, 409);
      assert.equal(crossVersion.body.data.duplicate_resolution.existing_file.intake_file_id, firstB);
      assert.equal((await rowsForChecksum(ORG_B, checksum)).length, 1);

      // 11. An actor without create_intake_file can neither reserve nor
      // version, and learns nothing about the existing record.
      for (const duplicateOf of [null, firstId]) {
        const denied = await reserve(USERS.clientViewerA, { ...ctx, file, key: keyFor(tag, "viewer"), duplicateOf });
        assert.equal(denied.statusCode, 403);
        assert.equal(JSON.stringify(denied.body).includes(firstId), false);
      }

      // 12. Modified bytes under the same filename are not duplicates.
      const modified = selectedFile(format, `${tag}-modified`);
      assert.notEqual(modified.checksum, checksum);
      const modifiedId = await uploadNew(USERS.clientAdminA, ctx, modified, keyFor(tag, "modified"));
      assert.equal((await fileRow(modifiedId)).force_new_version, false);

      assert.equal((await rowsForChecksum(ORG_A, checksum)).length, 3);
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle and protection states, every format.
  // -------------------------------------------------------------------------
  await test("unfinished and lapsed uploads: Continue upload completes the existing record; a lapsed one is replaced by a new version that supersedes it", async () => {
    const engagement = await createEngagement(ORG_A, "dup-lifecycle");
    for (const format of FORMATS) {
      const tag = format.name.toLowerCase();
      const batch = await createBatch(ORG_A, engagement, `dup-lifecycle-${tag}`);
      const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };

      // Reserved but never transferred (the browser was closed).
      const pending = selectedFile(format, `${tag}-pending`);
      const reserved = await reserve(USERS.clientAdminA, { ...ctx, file: pending, key: keyFor(tag, "pending") });
      assert.equal(reserved.statusCode, 201);
      const pendingId = reserved.body.data.intake_file_id;
      const again = await reserve(USERS.clientAdminA, { ...ctx, file: pending, key: keyFor(tag, "pending-again") });
      const resolution = assertDuplicate422(again, {
        status: "duplicate_in_batch",
        existingId: pendingId,
        actions: ["continue_upload", "cancel"],
        restriction: "upload_in_progress",
        checksum: pending.checksum,
      });
      assert.equal(resolution.existing_file.upload_state, "reserved");
      const premature = await reserve(USERS.clientAdminA, { ...ctx, file: pending, key: keyFor(tag, "premature"), duplicateOf: pendingId });
      assert.equal(premature.statusCode, 422, "a new version is not offered or accepted while the upload can still complete");
      assert.equal((await rowsForChecksum(ORG_A, pending.checksum)).length, 1);
      // Continue upload: the existing reservation, with the selected bytes.
      const continued = await transferAndConfirm(USERS.clientAdminA, {
        ...ctx,
        intakeFileId: pendingId,
        file: pending,
        uploadState: resolution.existing_file.upload_state,
      });
      assert.equal(continued.statusCode, 200, JSON.stringify(continued.body));
      const continuedRow = await fileRow(pendingId);
      assert.equal(continuedRow.upload_state, "confirmed");
      assert.equal(continuedRow.file_policy_status, "passed");

      // Reserved, then past its upload window: Continue is never offered.
      const lapsed = selectedFile(format, `${tag}-lapsed`);
      const lapsedReserved = await reserve(USERS.clientAdminA, { ...ctx, file: lapsed, key: keyFor(tag, "lapsed") });
      assert.equal(lapsedReserved.statusCode, 201);
      const lapsedId = lapsedReserved.body.data.intake_file_id;
      await query("UPDATE kai.intake_files SET upload_expires_at = now() - interval '1 minute' WHERE intake_file_id = $1::uuid", [lapsedId]);
      const afterLapse = await reserve(USERS.clientAdminA, { ...ctx, file: lapsed, key: keyFor(tag, "after-lapse") });
      assertDuplicate422(afterLapse, {
        status: "duplicate_in_batch",
        existingId: lapsedId,
        actions: ["upload_new_intake_version", "cancel"],
        checksum: lapsed.checksum,
      });
      const replacement = await reserve(USERS.clientAdminA, { ...ctx, file: lapsed, key: keyFor(tag, "replacement"), duplicateOf: lapsedId });
      assert.equal(replacement.statusCode, 201, JSON.stringify(replacement.body));
      const replacementId = replacement.body.data.intake_file_id;
      assert.equal((await transferAndConfirm(USERS.clientAdminA, { ...ctx, intakeFileId: replacementId, file: lapsed })).statusCode, 200);
      const replacementRow = await fileRow(replacementId);
      assert.equal(replacementRow.original_intake_file_id, lapsedId);
      assert.equal(replacementRow.supersedes_intake_file_id, lapsedId);
      assert.equal(replacementRow.file_policy_status, "passed");
      assert.equal((await fileRow(lapsedId)).upload_state, "reserved", "the lapsed record's history is kept");
    }
  });

  await test("policy-blocked and security-check-failed content stays unavailable in every batch, and an explicit override is refused", async () => {
    const engagement = await createEngagement(ORG_A, "dup-protection");
    const otherEngagement = await createEngagement(ORG_A, "dup-protection-other");
    for (const format of FORMATS) {
      const tag = format.name.toLowerCase();
      const batch = await createBatch(ORG_A, engagement, `dup-protection-${tag}`);
      const otherBatch = await createBatch(ORG_A, otherEngagement, `dup-protection-other-${tag}`);
      const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };
      const otherCtx = { organizationId: ORG_A, engagementId: otherEngagement, intakeBatchId: otherBatch };

      for (const [label, verdicts, expectedStatus, restriction] of [
        ["blocked", malwareDetected, "blocked", "blocked_by_policy"],
        ["scan-failed", malwareScanFailures, "failed", "security_check_failed"],
      ]) {
        const file = selectedFile(format, `${tag}-${label}`);
        verdicts.add(file.checksum);
        const originalId = await uploadNew(USERS.clientAdminA, ctx, file, keyFor(tag, label));
        assert.equal((await fileRow(originalId)).file_policy_status, expectedStatus, `${format.name} ${label}`);
        for (const target of [ctx, otherCtx]) {
          const repeat = await reserve(USERS.clientAdminA, { ...target, file, key: keyFor(tag, label, "repeat") });
          const resolution = assertDuplicate422(repeat, {
            status: target === ctx ? "duplicate_in_batch" : "duplicate_in_other_engagement",
            existingId: originalId,
            actions: ["cancel"],
            restriction,
            checksum: file.checksum,
          });
          assert.ok(duplicateResolutionView(resolution).restriction);
          const override = await reserve(USERS.clientAdminA, { ...target, file, key: keyFor(tag, label, "override"), duplicateOf: originalId });
          assert.equal(override.statusCode, 422);
          assert.deepEqual(override.body.data.duplicate_resolution.available_actions, ["cancel"]);
        }
        assert.equal((await rowsForChecksum(ORG_A, file.checksum)).length, 1, "no override record exists");
      }
    }
  });

  // -------------------------------------------------------------------------
  // PostgreSQL-specific guarantees.
  // -------------------------------------------------------------------------
  await test("concurrency on PostgreSQL: racing ordinary reservations hit the partial unique index and still answer 422 with a resolution; racing new versions are serialized by the original-row lock", async () => {
    const engagement = await createEngagement(ORG_A, "dup-concurrency");
    const batch = await createBatch(ORG_A, engagement, "dup-concurrency");
    const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };
    const file = selectedFile(FORMATS[0], "concurrency");

    const racing = await Promise.all(Array.from({ length: 6 }, (_, index) => reserve(USERS.clientAdminA, {
      ...ctx,
      file,
      key: keyFor("race", String(index)),
    })));
    assert.equal(racing.filter((result) => result.statusCode === 201).length, 1, JSON.stringify(racing.map((r) => r.statusCode)));
    for (const result of racing.filter((candidate) => candidate.statusCode !== 201)) {
      assert.equal(result.statusCode, 422, JSON.stringify(result.body));
      assert.equal(result.body.data.duplicate_resolution.contract, "kai_intake_duplicate_resolution_v1");
    }
    const originalId = racing.find((result) => result.statusCode === 201).body.data.intake_file_id;
    assert.equal((await transferAndConfirm(USERS.clientAdminA, { ...ctx, intakeFileId: originalId, file })).statusCode, 200);

    const versions = await Promise.all(Array.from({ length: 6 }, (_, index) => reserve(USERS.clientAdminA, {
      ...ctx,
      file,
      key: keyFor("version-race", String(index)),
      duplicateOf: originalId,
    })));
    assert.equal(versions.filter((result) => result.statusCode === 201).length, 1, JSON.stringify(versions.map((r) => r.statusCode)));
    const createdId = versions.find((result) => result.statusCode === 201).body.data.intake_file_id;
    for (const result of versions.filter((candidate) => candidate.statusCode !== 201)) {
      // Each later request saw the first one's committed, still-unfinished
      // version: stale (409) with that record and Continue upload only.
      assert.equal(result.statusCode, 409, JSON.stringify(result.body));
      assert.equal(result.body.data.duplicate_resolution.existing_file.intake_file_id, createdId);
      assert.deepEqual(result.body.data.duplicate_resolution.available_actions, ["continue_upload", "cancel"]);
    }
    const rows = await rowsForChecksum(ORG_A, file.checksum);
    assert.deepEqual(rows.map((row) => row.force_new_version), [false, true]);
    assert.equal((await newVersionAudits(createdId)).length, 1);
  });

  await test("a failed required audit rolls the new intake version back on PostgreSQL and fails closed", async () => {
    const engagement = await createEngagement(ORG_A, "dup-audit");
    const batch = await createBatch(ORG_A, engagement, "dup-audit");
    const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };
    const file = selectedFile(FORMATS[3], "audit-rollback");
    const originalId = await uploadNew(USERS.clientAdminA, ctx, file, keyFor("audit", "original"));
    await query(`CREATE FUNCTION kai.dup_resolution_reject_new_version_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN RAISE EXCEPTION 'synthetic audit store failure'; END $$`);
    await query(`CREATE TRIGGER dup_resolution_reject_new_version_audit BEFORE INSERT ON kai.audit_events
                 FOR EACH ROW WHEN (NEW.action = 'reserve_intake_file_new_version')
                 EXECUTE FUNCTION kai.dup_resolution_reject_new_version_audit()`);
    try {
      const failed = await reserve(USERS.clientAdminA, { ...ctx, file, key: keyFor("audit", "version"), duplicateOf: originalId });
      assert.equal(failed.statusCode, 500);
      assert.equal(failed.body.error.code, "system_error");
      assert.equal((await rowsForChecksum(ORG_A, file.checksum)).length, 1, "no version row survives without its audit");
    } finally {
      await query("DROP TRIGGER dup_resolution_reject_new_version_audit ON kai.audit_events");
      await query("DROP FUNCTION kai.dup_resolution_reject_new_version_audit()");
    }
    const retried = await reserve(USERS.clientAdminA, { ...ctx, file, key: keyFor("audit", "retry"), duplicateOf: originalId });
    assert.equal(retried.statusCode, 201, "the same decision succeeds once the audit store accepts it");
  });

  // -------------------------------------------------------------------------
  // The dialog: the real KaiWebIntake component in headless Chrome.
  // -------------------------------------------------------------------------
  await test("dialog: KaiWebIntake shows only server-authorized actions and executes each one - Cancel, Use existing file, new intake version, stale 409 refresh, Continue upload, and a blocked file", async () => {
    const engagement = await createEngagement(ORG_A, "dup-dialog");
    const batch = await createBatch(ORG_A, engagement, "dup-dialog");
    const ctx = { organizationId: ORG_A, engagementId: engagement, intakeBatchId: batch };
    const filesDir = join(WORKDIR, "dialog-files");
    mkdirSync(filesDir, { recursive: true });
    const writeSelection = (format, label, name) => {
      const file = selectedFile(format, label, name);
      const path = join(filesDir, name);
      writeFileSync(path, file.bytes);
      return { ...file, path };
    };
    const outcomes = writeSelection(FORMATS[1], "dialog-outcomes", "dialog_outcomes.xlsx");
    const notes = writeSelection(FORMATS[2], "dialog-notes", "dialog_notes.md");
    const flagged = writeSelection(FORMATS[4], "dialog-flagged", "dialog_flagged.pdf");
    const retried = writeSelection(FORMATS[3], "dialog-retried", "dialog_retried.txt");
    malwareDetected.add(flagged.checksum);

    const browser = await launchChrome();
    const page = await openPage(browser, { baseUrl, legacyUserId: USERS.clientAdminA });
    try {
      await page.goto(`/duplicate-harness?organization_id=${ORG_A}&engagement_id=${engagement}`);
      await page.waitForText("Upload the selected file");
      await page.waitForText(`Batch id: ${batch}`);
      const reservations = (since) => page.requestsSince(since).filter((r) => r.method === "POST" && r.url.includes("/file-reservations"));

      // First upload of an XLSX (the browser reports a type for it).
      await page.chooseFile(outcomes.path);
      await page.clickButton("Upload the selected file");
      await page.waitForText("File reserved, uploaded, and confirmed.");
      const firstId = (await rowsForChecksum(ORG_A, outcomes.checksum))[0].intake_file_id;
      assert.equal((await fileRow(firstId)).file_policy_status, "passed");

      // Same file chosen again: the dialog lists exactly the server's actions.
      await page.chooseFile(outcomes.path);
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "duplicate dialog");
      let shown = await page.dialog();
      assert.deepEqual(shown.buttons, ["Use existing file", "Upload again as a new intake version", "Cancel"]);
      assert.ok(shown.text.includes("Existing file: dialog_outcomes.xlsx"), shown.text);
      assert.ok(shown.text.includes("Location: In this batch"), shown.text);
      assert.ok(shown.text.includes("Status: Uploaded"), shown.text);
      assert.equal(shown.text.includes(outcomes.checksum), false);

      // Cancel: closes, sends nothing.
      let mark = page.mark();
      await page.clickButton("Cancel", { within: page.dialogScope });
      await page.waitFor(async () => !(await page.dialog()), "dialog closed");
      await page.idle();
      assert.equal(page.requestsSince(mark).length, 0, "Cancel makes no request");

      // Use existing file: opens the existing record.
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "duplicate dialog again");
      mark = page.mark();
      await page.clickButton("Use existing file", { within: page.dialogScope });
      await page.waitForText(`Intake file id: ${firstId}`);
      await page.waitForText("Using the existing file dialog_outcomes.xlsx.");
      await page.idle();
      assert.ok(page.requestsSince(mark).some((r) => r.method === "GET" && r.url.includes(`/admin/files/${firstId}?`) && r.status === 200));
      assert.equal(reservations(mark).length, 0);
      assert.equal((await rowsForChecksum(ORG_A, outcomes.checksum)).length, 1);

      // Upload again as a new intake version: the selected bytes, uploaded,
      // verified, and assessed as a new record superseding the original.
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "duplicate dialog for a new version");
      mark = page.mark();
      await page.clickButton("Upload again as a new intake version", { within: page.dialogScope });
      await page.waitForText("New intake version reserved, uploaded, and confirmed.");
      assert.deepEqual(reservations(mark).map((r) => r.status), [201]);
      let rows = await rowsForChecksum(ORG_A, outcomes.checksum);
      assert.equal(rows.length, 2);
      const versionRow = await fileRow(rows[1].intake_file_id);
      assert.equal(versionRow.force_new_version, true);
      assert.equal(versionRow.supersedes_intake_file_id, firstId);
      assert.equal(versionRow.upload_state, "confirmed");
      assert.equal(versionRow.file_policy_status, "passed");
      assert.equal(versionRow.verified_checksum, outcomes.checksum);

      // Stale state: while the dialog is open, another request starts a new
      // version of the presented record. Choosing the now-stale action gets a
      // 409 whose fresh resolution replaces the dialog, offering only
      // Continue upload - which then completes that record with the bytes
      // still selected here.
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "dialog before the concurrent change");
      shown = await page.dialog();
      assert.deepEqual(shown.buttons, ["Use existing file", "Upload again as a new intake version", "Cancel"]);
      const concurrent = await reserve(USERS.gk, { ...ctx, file: outcomes, key: keyFor("dialog", "concurrent"), duplicateOf: versionRow.intake_file_id });
      assert.equal(concurrent.statusCode, 201, JSON.stringify(concurrent.body));
      const concurrentId = concurrent.body.data.intake_file_id;
      mark = page.mark();
      await page.clickButton("Upload again as a new intake version", { within: page.dialogScope });
      await page.waitFor(async () => {
        const current = await page.dialog();
        return Boolean(current) && current.buttons.includes("Continue upload");
      }, "refreshed dialog after the 409");
      shown = await page.dialog();
      assert.deepEqual(shown.buttons, ["Continue upload", "Cancel"]);
      assert.ok(shown.text.includes("Status: Upload not finished"), shown.text);
      assert.deepEqual(reservations(mark).map((r) => r.status), [409]);
      assert.equal((await rowsForChecksum(ORG_A, outcomes.checksum)).length, 3, "the stale choice created nothing");
      await page.clickButton("Continue upload", { within: page.dialogScope });
      await page.waitForText("Upload continued and confirmed.");
      const concurrentRow = await fileRow(concurrentId);
      assert.equal(concurrentRow.upload_state, "confirmed");
      assert.equal(concurrentRow.verified_checksum, outcomes.checksum);
      assert.equal(concurrentRow.file_policy_status, "passed");

      // Continue upload from a fresh selection of a Markdown file whose
      // earlier reservation never transferred (the browser reports no type
      // for .md; the fallback MIME is the one the reservation declared).
      const abandoned = await reserve(USERS.clientAdminA, { ...ctx, file: notes, key: keyFor("dialog", "abandoned") });
      assert.equal(abandoned.statusCode, 201);
      await page.chooseFile(notes.path);
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "dialog for the unfinished upload");
      shown = await page.dialog();
      assert.deepEqual(shown.buttons, ["Continue upload", "Cancel"]);
      assert.ok(shown.text.includes("hasn't finished"), shown.text);
      await page.clickButton("Continue upload", { within: page.dialogScope });
      await page.waitForText("Upload continued and confirmed.");
      const notesRow = await fileRow(abandoned.body.data.intake_file_id);
      assert.equal(notesRow.upload_state, "confirmed");
      assert.equal(notesRow.file_policy_status, "passed");
      assert.equal((await rowsForChecksum(ORG_A, notes.checksum)).length, 1);

      // Retry of the same selection after the server finished the upload
      // but the browser never saw the confirmation: the replayed reservation
      // is no longer "reserved", so it must be confirmed (a server-verified
      // replay), not re-signed - and never left at a stale 409.
      await page.chooseFile(retried.path);
      gateway.dropNextConfirmResponse = true;
      await page.clickButton("Upload the selected file");
      await page.waitForText("Gateway timeout.");
      const retriedId = (await rowsForChecksum(ORG_A, retried.checksum))[0].intake_file_id;
      assert.equal((await fileRow(retriedId)).upload_state, "confirmed", "the server completed the first attempt");
      mark = page.mark();
      await page.clickButton("Upload the selected file");
      await page.waitForText("File reserved, uploaded, and confirmed.");
      assert.deepEqual(reservations(mark).map((r) => r.status), [201], "the same intent replays its reservation");
      assert.equal(page.requestsSince(mark).some((r) => r.url.includes("/synthetic-storage/")), false, "no second transfer");
      assert.equal((await rowsForChecksum(ORG_A, retried.checksum)).length, 1);
      assert.equal((await fileRow(retriedId)).file_policy_status, "passed");

      // A file blocked by the security policy: Cancel is the only action.
      await page.chooseFile(flagged.path);
      await page.clickButton("Upload the selected file");
      await page.waitForText("File reserved, uploaded, and confirmed.");
      const flaggedId = (await rowsForChecksum(ORG_A, flagged.checksum))[0].intake_file_id;
      assert.equal((await fileRow(flaggedId)).file_policy_status, "blocked");
      await page.clickButton("Upload the selected file");
      await page.waitFor(async () => Boolean(await page.dialog()), "dialog for blocked content");
      shown = await page.dialog();
      assert.deepEqual(shown.buttons, ["Cancel"]);
      assert.ok(shown.text.includes("blocked by a file security policy"), shown.text);
      await page.clickButton("Cancel", { within: page.dialogScope });
      assert.equal((await rowsForChecksum(ORG_A, flagged.checksum)).length, 1);

      assert.deepEqual(page.exceptions, []);
    } finally {
      await page.close();
      await browser.close();
    }
  });

  await closeHarness();
}

// Runs last, so every module-level fixture above is initialized first.
if (!RUNNER_DATABASE_URL || !RUNNER_DATABASE_NAME || !CHROME || !WORKDIR) {
  test("duplicate-resolution real-PostgreSQL proof requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_DATABASE_URL);
  await runDuplicateResolutionRealPostgresSuite();
}
