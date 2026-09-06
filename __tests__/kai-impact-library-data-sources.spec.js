import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

import sprint2IntakeApiRouter, { __testables as intakeRouteTestables } from "../Backend/kai/routes/sprint2IntakeApi.js";
import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import { requireKaiSprint2Authenticated } from "../Backend/kai/middleware/kaiSprint2Authentication.js";
import {
  handleKaiSprint2JsonParserError,
  kaiSprint2ActorMutationLimiter,
  kaiSprint2MetadataJsonParser,
  kaiSprint2OrganizationMutationLimiter,
  setKaiSprint2NoStore,
} from "../Backend/kai/middleware/kaiSprint2RequestSafety.js";
import {
  listOrganizationSources,
  __sourceLibraryServiceContract,
} from "../Backend/kai/services/kaiSourceLibraryService.js";
import {
  listScopedSourcesForOrganization,
  listScopedSourceVersionsForSourceIds,
} from "../Backend/kai/db/kaiIntakeQueries.js";
import {
  organizationSourcesPath,
  projectOrganizationSources,
} from "../frontend/impactEvidenceLibraryLogic.js";

/**
 * Impact Library Data Sources completion package: an authorized organization-
 * scoped browse read of already-governed kai.sources/kai.source_versions rows
 * (created only by the existing P1-08 source-promotion authority), so a user
 * can discover a source_version_id on /impact-library instead of already
 * knowing one before using the existing Extract evidence / View coverage
 * assessment actions. This does not reopen source-promotion authority,
 * evidence/claim authority, or Funder Requirements/Gaps and Risks.
 */

const basePath = "/api/kai/sprint2/intake";
const organizationId = "00000000-0000-4000-8000-000000000001";
const otherOrganizationId = "00000000-0000-4000-8000-000000000002";
const sourceIdA = "00000000-0000-4000-8000-000000000301";
const sourceIdB = "00000000-0000-4000-8000-000000000302";
const sourceVersionIdA1 = "00000000-0000-4000-8000-000000000401";
const sourceVersionIdA2 = "00000000-0000-4000-8000-000000000402";
const sourceVersionIdB1 = "00000000-0000-4000-8000-000000000403";
const createdAt = "2026-08-01T00:00:00.000Z";

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [
    { organization_id: organizationId, membership_status: "active", role_name: "gk_reviewer" },
  ],
});

function sourceRow(overrides = {}) {
  return {
    source_id: sourceIdA,
    source_code: "a".repeat(64),
    reviewed_source_type: "organization_primary_record",
    created_at: createdAt,
    ...overrides,
  };
}

function sourceVersionRow(overrides = {}) {
  return {
    source_version_id: sourceVersionIdA1,
    source_id: sourceIdA,
    is_current: true,
    created_at: createdAt,
    ...overrides,
  };
}

// --- service unit tests ---

test("listOrganizationSources: feature-disabled, malformed input, non-human actor, and denied role all make zero repository calls", async () => {
  const cases = [
    [{ organizationId, actorContext }, { env: { KAI_SPRINT2_ENABLED: "false" } }],
    [{ organizationId: "", actorContext }, { env: { KAI_SPRINT2_ENABLED: "true" } }],
    [{ organizationId, actorContext, extra: true }, { env: { KAI_SPRINT2_ENABLED: "true" } }],
    [{ organizationId, actorContext: { actorType: "assistant" } }, { env: { KAI_SPRINT2_ENABLED: "true" } }],
    [
      { organizationId, actorContext: { ...actorContext, organizationMemberships: [] } },
      { env: { KAI_SPRINT2_ENABLED: "true" } },
    ],
    [
      {
        organizationId,
        actorContext: {
          ...actorContext,
          organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: "client_reviewer" }],
        },
      },
      { env: { KAI_SPRINT2_ENABLED: "true" } },
    ],
  ];
  for (const [input, dependencies] of cases) {
    let calls = 0;
    const result = await listOrganizationSources(input, {
      ...dependencies,
      listScopedSourcesForOrganization: async () => { calls += 1; throw new Error("must not be called"); },
      listScopedSourceVersionsForSourceIds: async () => { calls += 1; throw new Error("must not be called"); },
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  }
});

test("listOrganizationSources: gk_admin/gk_operator/gk_reviewer are authorized; a cross-tenant actor is denied", async () => {
  for (const roleName of ["gk_admin", "gk_operator", "gk_reviewer"]) {
    const result = await listOrganizationSources(
      {
        organizationId,
        actorContext: {
          ...actorContext,
          organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: roleName }],
        },
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        listScopedSourcesForOrganization: async () => [],
        listScopedSourceVersionsForSourceIds: async () => [],
      },
    );
    assert.equal(result.ok, true, roleName);
  }

  const crossTenant = await listOrganizationSources(
    { organizationId: otherOrganizationId, actorContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      listScopedSourcesForOrganization: async () => { throw new Error("must not be called"); },
    },
  );
  assert.equal(crossTenant.ok, false);
});

test("listOrganizationSources: groups each source with only its own governed source_versions, using only the safe fixed field set", async () => {
  const calls = [];
  const result = await listOrganizationSources(
    { organizationId, actorContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listScopedSourcesForOrganization(input) {
        calls.push(["sources", input]);
        return [
          sourceRow({ source_id: sourceIdA }),
          sourceRow({ source_id: sourceIdB, reviewed_source_type: "public_record" }),
        ];
      },
      async listScopedSourceVersionsForSourceIds(input) {
        calls.push(["versions", input]);
        return [
          sourceVersionRow({ source_version_id: sourceVersionIdA1, source_id: sourceIdA, is_current: false }),
          sourceVersionRow({ source_version_id: sourceVersionIdA2, source_id: sourceIdA, is_current: true }),
          sourceVersionRow({ source_version_id: sourceVersionIdB1, source_id: sourceIdB, is_current: true }),
        ];
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ["sources", { organizationId }]);
  assert.deepEqual(calls[1][1], { organizationId, sourceIds: [sourceIdA, sourceIdB] });

  assert.deepEqual(Object.keys(result.data.sources[0]).sort(), [
    "created_at", "reviewed_source_type", "source_code", "source_id", "source_versions",
  ].sort());
  assert.deepEqual(result.data.sources[0].source_versions.map((v) => v.source_version_id), [
    sourceVersionIdA1, sourceVersionIdA2,
  ]);
  assert.deepEqual(result.data.sources[1].source_versions.map((v) => v.source_version_id), [sourceVersionIdB1]);
  for (const version of result.data.sources[0].source_versions) {
    assert.deepEqual(Object.keys(version).sort(), ["created_at", "is_current", "source_id", "source_version_id"].sort());
  }
});

// --- safe-field allowlist: no lineage id, no storage location, no raw content ---

test("listOrganizationSources: never returns intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, storage_uri, signed_url, or raw content, even if the repository row carries them", async () => {
  const result = await listOrganizationSources(
    { organizationId, actorContext },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async listScopedSourcesForOrganization() {
        return [sourceRow({
          created_by: "should-not-appear",
          storage_uri: "s3://bucket/object",
        })];
      },
      async listScopedSourceVersionsForSourceIds() {
        return [sourceVersionRow({
          intake_source_candidate_id: "should-not-appear",
          intake_sensitivity_profile_id: "should-not-appear",
          profile_canonical_sha256: "should-not-appear",
          signed_url: "https://example.invalid/signed",
        })];
      },
    },
  );
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "intake_source_candidate_id", "intake_sensitivity_profile_id", "profile_canonical_sha256",
    "storage_uri", "signed_url", "created_by", "should-not-appear",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

// --- route wiring ---

function actorMiddlewareApp(getScenario) {
  const app = express();
  app.use(basePath, setKaiSprint2NoStore, requireKaiSprint2Enabled, kaiSprint2MetadataJsonParser);
  app.use(basePath, handleKaiSprint2JsonParserError);
  app.use(basePath, (req, res, next) => {
    const current = getScenario();
    req.isAuthenticated = () => current.authenticated;
    if (current.authenticated) {
      req.user = { id: 46 };
      req.kaiSprint2ActorContext = current.actorContext;
    }
    return next();
  });
  app.use(
    basePath,
    requireKaiSprint2Enabled,
    kaiSprint2OrganizationMutationLimiter,
    kaiSprint2ActorMutationLimiter,
    requireKaiSprint2Authenticated,
    sprint2IntakeApiRouter,
  );
  return app;
}

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function requestJson(server, path) {
  const { port } = server.address();
  return await new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("Data Sources route is mounted once as an authenticated read-only GET", () => {
  const matches = sprint2IntakeApiRouter.stack
    .filter((layer) => layer.route?.path === "/admin/organizations/:organizationId/sources" && layer.route?.methods?.get);
  assert.equal(matches.length, 1);
  assert.deepEqual(Object.keys(matches[0].route.methods), ["get"]);
});

test("Data Sources route delegates exactly once to kaiSourceLibraryService.listOrganizationSources and enforces authentication/UUID validation", async (t) => {
  let current = { authenticated: true, actorContext, calls: [], result: { ok: true, data: { sources: [] }, error: null } };
  const originalFeatureFlag = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  const restore = intakeRouteTestables.setIntakeServiceForTest({
    async listOrganizationSources(input) {
      current.calls.push(input);
      return current.result;
    },
  });
  const server = await listen(actorMiddlewareApp(() => current));

  t.after(async () => {
    restore();
    if (originalFeatureFlag === undefined) delete process.env.KAI_SPRINT2_ENABLED;
    else process.env.KAI_SPRINT2_ENABLED = originalFeatureFlag;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  current = { ...current, authenticated: false, calls: [] };
  const denied = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/sources`);
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(current.calls, []);

  current = { ...current, authenticated: true, calls: [] };
  const allowed = await requestJson(server, `${basePath}/admin/organizations/${organizationId}/sources`);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(current.calls, [{ organizationId, actorContext }]);

  current = { ...current, calls: [] };
  const invalidOrg = await requestJson(server, `${basePath}/admin/organizations/not-a-uuid/sources`);
  assert.equal(invalidOrg.statusCode, 422);
  assert.deepEqual(current.calls, []);
});

// --- frontend logic ---

test("organizationSourcesPath builds the organization-scoped Data Sources path", () => {
  assert.equal(
    organizationSourcesPath(organizationId),
    `${basePath}/admin/organizations/${organizationId}/sources`,
  );
});

test("projectOrganizationSources projects the safe DTO into camelCase without inventing eligibility/currentness", () => {
  const projected = projectOrganizationSources({
    sources: [
      {
        source_id: sourceIdA,
        source_code: "a".repeat(64),
        reviewed_source_type: "organization_primary_record",
        created_at: createdAt,
        source_versions: [
          { source_version_id: sourceVersionIdA1, source_id: sourceIdA, is_current: false, created_at: createdAt },
          { source_version_id: sourceVersionIdA2, source_id: sourceIdA, is_current: true, created_at: createdAt },
        ],
      },
    ],
  });
  assert.deepEqual(projected, [{
    sourceId: sourceIdA,
    sourceCode: "a".repeat(64),
    reviewedSourceType: "organization_primary_record",
    createdAt,
    sourceVersions: [
      { sourceVersionId: sourceVersionIdA1, sourceId: sourceIdA, isCurrent: false, createdAt },
      { sourceVersionId: sourceVersionIdA2, sourceId: sourceIdA, isCurrent: true, createdAt },
    ],
  }]);
});

test("projectOrganizationSources returns an empty array for a missing/malformed dto, never throwing", () => {
  assert.deepEqual(projectOrganizationSources(null), []);
  assert.deepEqual(projectOrganizationSources({}), []);
  assert.deepEqual(projectOrganizationSources({ sources: "not-an-array" }), []);
});

// --- kaiIntakeQueries organization-scoped reads are additive only ---

test("listScopedSourcesForOrganization and listScopedSourceVersionsForSourceIds are exported additively (do not throw on an empty sourceIds array)", async () => {
  assert.equal(typeof listScopedSourcesForOrganization, "function");
  assert.equal(typeof listScopedSourceVersionsForSourceIds, "function");
  const emptyVersions = await listScopedSourceVersionsForSourceIds({ organizationId, sourceIds: [] });
  assert.deepEqual(emptyVersions, []);
});

test("kaiSourceLibraryService role/operation contract matches the same role set already governing evidence-extraction/coverage-assessment on this surface", () => {
  assert.deepEqual(
    [...__sourceLibraryServiceContract.SOURCE_LIBRARY_ALLOWED_ROLES].sort(),
    ["gk_admin", "gk_operator", "gk_reviewer"],
  );
});
