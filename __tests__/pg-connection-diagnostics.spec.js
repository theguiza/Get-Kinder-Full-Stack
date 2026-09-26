import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PG_MODULE_URL = pathToFileURL(fileURLToPath(new URL("../Backend/db/pg.js", import.meta.url))).href;
const SYNTHETIC_CREDENTIAL = "Zq9Xsynthetic-kai-test-credential-never-log";
const CREDENTIAL_FIELD_PATTERN = /password|passwd|secret|token|credential/i;

// Imports Backend/db/pg.js in an isolated child process (no .env, no real connection
// variables) and returns everything it wrote to stdout/stderr. Pool creation is lazy,
// so nothing connects.
function captureDiagnostics(connectionEnv) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(PG_MODULE_URL)}); process.exit(0);`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DOTENV_CONFIG_PATH: join(tmpdir(), "kai-pg-diagnostics-no-such-env-file"),
        DATABASE_URL_LOCAL: "",
        PGURL_LOCAL: "",
        DATABASE_URL: "",
        RENDER_DATABASE_URL: "",
        PROD_DATABASE_URL: "",
        ...connectionEnv,
      },
    }
  );
  assert.equal(result.status, 0, "pg module import should succeed in the child process");
  return `${result.stdout}\n${result.stderr}`;
}

function assertNoCredentialMaterial(output) {
  assert.equal(CREDENTIAL_FIELD_PATTERN.test(output), false, "diagnostics must not name credential fields");
  assert.equal(output.includes(SYNTHETIC_CREDENTIAL), false, "diagnostics must not contain the credential");
  assert.equal(
    output.includes(SYNTHETIC_CREDENTIAL.slice(0, 4)),
    false,
    "diagnostics must not contain a partial credential"
  );
}

test("local connection diagnostics omit the password but keep non-sensitive metadata", () => {
  const output = captureDiagnostics({
    DB_USER: "kai_synthetic_user",
    DB_HOST: "127.0.0.1",
    DB_NAME: "kai_synthetic_db",
    DB_PORT: "1",
    DB_PASSWORD: SYNTHETIC_CREDENTIAL,
  });

  assert.match(output, /\[pg\] Using local connection/);
  assert.match(output, /kai_synthetic_user/);
  assert.match(output, /127\.0\.0\.1/);
  assert.match(output, /kai_synthetic_db/);
  assertNoCredentialMaterial(output);
});

test("unparseable connection string diagnostics omit the connection string entirely", () => {
  const output = captureDiagnostics({ DATABASE_URL_LOCAL: SYNTHETIC_CREDENTIAL });

  assert.match(output, /\[pg\] Using remote connection string/);
  assert.match(output, /DATABASE_URL_LOCAL/);
  assertNoCredentialMaterial(output);
});
