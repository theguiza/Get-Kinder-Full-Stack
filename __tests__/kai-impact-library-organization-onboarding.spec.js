import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getMyOrganizationOnboardingStatus,
} from "../Backend/kai/services/kaiOrganizationOnboardingService.js";
import {
  selectLatestOwnOrganizationApplication,
} from "../Backend/kai/db/gkOrganizationApplicationQueries.js";
import {
  deriveEffectiveClientOrganizationMemberships,
} from "../Backend/kai/auth/gkOrganizationBindingAuthority.js";
import {
  listAuthorizedOrganizations,
} from "../Backend/kai/services/kaiOrganizationContextService.js";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const KAI_ORG = "00000000-0000-4000-8000-0000000000aa";
const KAI_ORG_B = "00000000-0000-4000-8000-0000000000bb";

function actorContext(overrides = {}) {
  return {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    legacyPublicUserdataId: 501,
    organizationMemberships: [],
    ...overrides,
  };
}

function dependencies({
  application = null,
  memberships = [],
  authorizedItems = [],
  enablement = { ok: false, error: { code: "authorization_denied" } },
  seen = {},
} = {}) {
  return {
    env: enabledEnv,
    resolveKaiActorContext: async () => ({ ok: true, actorContext: actorContext() }),
    listAuthorizedOrganizations: async ({ actorContext: resolvedActor }) => {
      seen.listAuthorizedActor = resolvedActor;
      return { ok: true, data: { items: authorizedItems }, error: null };
    },
    selectLatestOwnOrganizationApplication: async (legacyPublicUserdataId) => {
      seen.applicationUserId = legacyPublicUserdataId;
      return application;
    },
    resolveOrgScopeForUserId: async (legacyPublicUserdataId) => {
      seen.scopeUserId = legacyPublicUserdataId;
      return { memberships };
    },
    getKaiEnablementStatusForOrganization: async ({ gkOrganizationId }) => {
      seen.enablementGkOrganizationId = gkOrganizationId;
      return enablement;
    },
  };
}

test("organization onboarding status: an authorized organization alone is not a completed request", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({ authorizedItems: [{ organization_id: KAI_ORG }] }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "NO_REQUEST");
  assert.equal(result.data.has_authorized_organizations, true);
  assert.equal(result.data.can_enable_kai, false);
});

test("organization onboarding status: NO_REQUEST exposes the request/create path state without another user's data", async () => {
  const seen = {};
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({ seen }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "NO_REQUEST");
  assert.equal(result.data.application, null);
  assert.equal(seen.applicationUserId, 501);
});

test("organization onboarding status: PENDING returns only safe own application fields", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      application: {
        id: 77,
        user_id: 501,
        status: "pending",
        org_name: "Northwind",
        notes: "admin-only",
        submitted_at: "2026-09-24T12:00:00.000Z",
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "PENDING");
  assert.deepEqual(Object.keys(result.data.application).sort(), ["application_id", "org_name", "reviewed_at", "submitted_at"]);
  assert.equal(result.data.application.org_name, "Northwind");
  assert.equal(result.data.application.notes, undefined);
});

test("organization onboarding status: DECLINED supports a new request without exposing admin notes", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      application: {
        id: 78,
        user_id: 501,
        status: "declined",
        org_name: "Declined Org",
        notes: "not for the browser",
        reviewed_at: "2026-09-24T13:00:00.000Z",
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "DECLINED");
  assert.equal(result.data.application.notes, undefined);
});

test("organization onboarding status: APPROVED_NOT_KAI_ENABLED exposes enablement only when existing authority permits it", async () => {
  const seen = {};
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      seen,
      application: { id: 79, user_id: 501, status: "approved", org_name: "Approved Org" },
      memberships: [{ orgId: 12, role: "admin", is_active: true, org_name: "Approved Org" }],
      enablement: { ok: true, data: { kai_enabled: false, kai_organization_id: null }, error: null },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "APPROVED_NOT_KAI_ENABLED");
  assert.equal(result.data.can_enable_kai, true);
  assert.equal(result.data.gk_organization_id, 12);
  assert.equal(seen.scopeUserId, 501);
  assert.equal(seen.enablementGkOrganizationId, 12);
});

test("organization onboarding status: approved but unauthorized for enablement shows no enablement action", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      application: { id: 80, user_id: 501, status: "approved", org_name: "Approved Org" },
      memberships: [{ orgId: 12, role: "admin", is_active: true, org_name: "Approved Org" }],
      enablement: { ok: false, error: { code: "authorization_denied" } },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "APPROVED_NOT_KAI_ENABLED");
  assert.equal(result.data.can_enable_kai, false);
  assert.equal(result.data.gk_organization_id, null);
});

test("organization onboarding status security: caller cannot choose whose org_applications row is read", async () => {
  const seen = {};
  await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    {
      ...dependencies({ seen }),
      resolveKaiActorContext: async () => ({ ok: true, actorContext: actorContext({ legacyPublicUserdataId: 777 }) }),
    },
  );
  assert.equal(seen.applicationUserId, 777);
});

test("KAI enabled and bound: existing derived authority makes the organization visible through the authorized organization read path", async () => {
  const derived = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 12, role: "admin", is_active: true }],
    activeBindingsByGkOrganizationId: new Map([[12, { gk_organization_id: 12, kai_organization_id: KAI_ORG, status: "active" }]]),
  });
  const result = await listAuthorizedOrganizations(
    { actorContext: actorContext({ organizationMemberships: derived }) },
    { env: enabledEnv },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.items, [{ organization_id: KAI_ORG }]);
});

test("Impact Library organization onboarding UI exposes request/create states, not a fabricated Join workflow", () => {
  const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  assert.match(appSource, /You do not yet have an organization available in KAI\./);
  assert.match(appSource, /Set up an organization to start building your Impact Evidence Library\./);
  assert.match(appSource, /Request \/ create organization/);
  assert.match(appSource, /Your organization request has been submitted\./);
  assert.match(appSource, /Your organization request was not approved\./);
  assert.match(appSource, /KAI setup still needs to be completed before it appears in your Impact Library\./);
  assert.match(appSource, /Complete KAI setup/);
  assert.match(appSource, /organizationOnboardingStatusPath/);
  assert.match(appSource, /kaiEnablementPath/);
  assert.doesNotMatch(appSource, /Join existing organization|Join organization|invite code|domain matching/i);
});

test("Impact Library organization selection behavior is preserved while request/create another organization is reachable", () => {
  const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  const shellSource = readFileSync("frontend/impactLibraryShell.jsx", "utf8");
  const orgApplyRouteSource = readFileSync("routes/orgApplyApi.js", "utf8");
  const orgApplyViewSource = readFileSync("views/org-apply.ejs", "utf8");
  assert.match(appSource, /return items\[0\]\.organization_id/);
  assert.match(shellSource, /organizations\.length > 1/);
  assert.match(appSource, /Request another organization/);
  assert.match(appSource, /ORGANIZATION_REQUEST_HREF = "\/org-apply\?source=impact-library"/);
  assert.match(orgApplyRouteSource, /const fromImpactLibrary = req\.query\.source === "impact-library"/);
  assert.match(orgApplyRouteSource, /if \(!fromImpactLibrary && scope\?\.hasOrgRepAccess && scope\?\.orgId\) return res\.redirect\("\/home"\)/);
  assert.match(orgApplyViewSource, /name="source" value="impact-library"/);
  assert.match(orgApplyViewSource, /Back to Impact Library/);
});

test("organization onboarding route is a service-backed read with no route SQL", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf('router.get("/admin/organization-onboarding/status"');
  assert.ok(routeStart > -1);
  const routeSlice = routeSource.slice(routeStart, routeStart + 600);
  assert.match(routeSlice, /getOrganizationOnboardingService/);
  assert.match(routeSlice, /getMyOrganizationOnboardingStatus/);
  assert.doesNotMatch(routeSlice, /SELECT|INSERT|UPDATE|DELETE|FROM public\.org_applications/i);
});

const APPROVED_ORG_B = Object.freeze({ id: 90, user_id: 501, status: "approved", org_name: "Organization B" });
const ORG_B_MEMBERSHIP = Object.freeze({ orgId: 22, role: "admin", is_active: true, org_name: "Organization B" });

test("zero KAI organizations: approved + effective KAI availability for the requested organization -> KAI_AVAILABLE", async () => {
  const seen = {};
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      seen,
      application: APPROVED_ORG_B,
      memberships: [ORG_B_MEMBERSHIP],
      authorizedItems: [{ organization_id: KAI_ORG_B }],
      enablement: { ok: true, data: { kai_enabled: true, kai_organization_id: KAI_ORG_B }, error: null },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "KAI_AVAILABLE");
  assert.equal(result.data.kai_organization_id, KAI_ORG_B);
  assert.equal(result.data.can_enable_kai, false);
  assert.equal(seen.enablementGkOrganizationId, 22);
});

test("approved + enabled but the bound KAI organization is not authorized for the caller -> not KAI_AVAILABLE", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      application: APPROVED_ORG_B,
      memberships: [ORG_B_MEMBERSHIP],
      authorizedItems: [],
      enablement: { ok: true, data: { kai_enabled: true, kai_organization_id: KAI_ORG_B }, error: null },
    }),
  );
  assert.equal(result.data.status, "APPROVED_NOT_KAI_ENABLED");
  assert.equal(result.data.can_enable_kai, false);
  assert.equal(result.data.kai_organization_id, null);
});

test("user already has Organization A: new pending request for Organization B stays PENDING and A stays usable", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      authorizedItems: [{ organization_id: KAI_ORG }],
      application: { id: 91, user_id: 501, status: "pending", org_name: "Organization B" },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "PENDING");
  assert.equal(result.data.application.org_name, "Organization B");
  assert.equal(result.data.has_authorized_organizations, true);
});

test("user already has Organization A: declined request for Organization B stays DECLINED and A stays usable", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      authorizedItems: [{ organization_id: KAI_ORG }],
      application: { id: 92, user_id: 501, status: "declined", org_name: "Organization B" },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "DECLINED");
  assert.equal(result.data.has_authorized_organizations, true);
});

test("user already has Organization A: approved Organization B is not masked as KAI_AVAILABLE by A", async () => {
  const result = await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      authorizedItems: [{ organization_id: KAI_ORG }],
      application: APPROVED_ORG_B,
      memberships: [{ orgId: 11, role: "admin", is_active: true, org_name: "Organization A" }, ORG_B_MEMBERSHIP],
      enablement: { ok: true, data: { kai_enabled: false, kai_organization_id: null }, error: null },
    }),
  );
  assert.equal(result.data.status, "APPROVED_NOT_KAI_ENABLED");
  assert.equal(result.data.can_enable_kai, true);
  assert.equal(result.data.gk_organization_id, 22);
  assert.equal(result.data.has_authorized_organizations, true);
});

test("approved organization correlation mirrors the approval route: lowest matching admin membership id, own memberships only", async () => {
  const seen = {};
  await getMyOrganizationOnboardingStatus(
    { req: { user: { id: 501 } } },
    dependencies({
      seen,
      application: { ...APPROVED_ORG_B, org_name: "  organization   b " },
      memberships: [
        { orgId: 40, role: "admin", is_active: true, org_name: "Organization B" },
        { orgId: 22, role: "admin", is_active: true, org_name: "Organization B" },
        { orgId: 5, role: "member", is_active: true, org_name: "Organization B" },
      ],
      enablement: { ok: true, data: { kai_enabled: false, kai_organization_id: null }, error: null },
    }),
  );
  assert.equal(seen.enablementGkOrganizationId, 22);
});

/**
 * Minimal fake pg client that executes the helper's real ORDER BY clause
 * against fixture rows. It only understands plain `column [ASC|DESC]
 * [NULLS FIRST|LAST]` terms and throws on anything else (for example a
 * status-priority CASE), so the proof is about the SQL the helper issues.
 */
function orderByEvaluatingDb(fixtureRows, seen = {}) {
  return {
    async query(sql, params) {
      seen.sql = sql;
      seen.params = params;
      const orderBy = /ORDER BY([\s\S]*?)LIMIT/i.exec(sql)?.[1];
      assert.ok(orderBy, "helper must order explicitly");
      const terms = orderBy.split(",").map((raw) => {
        const match = /^\s*([a-z_]+)(?:\s+(ASC|DESC))?(?:\s+NULLS\s+(FIRST|LAST))?\s*$/i.exec(raw);
        if (!match) throw new Error(`unsupported ORDER BY term: ${raw.trim()}`);
        const desc = /desc/i.test(match[2] || "");
        return { column: match[1], desc, nullsFirst: match[3] ? /first/i.test(match[3]) : desc };
      });
      const rows = fixtureRows
        .filter((row) => row.user_id === params[0])
        .sort((a, b) => {
          for (const { column, desc, nullsFirst } of terms) {
            const av = a[column] == null ? null : column.endsWith("_at") ? Date.parse(a[column]) : a[column];
            const bv = b[column] == null ? null : column.endsWith("_at") ? Date.parse(b[column]) : b[column];
            if (av === bv) continue;
            if (av === null) return nullsFirst ? -1 : 1;
            if (bv === null) return nullsFirst ? 1 : -1;
            return (av < bv ? -1 : 1) * (desc ? -1 : 1);
          }
          return 0;
        });
      return { rows: rows.slice(0, 1) };
    },
  };
}

test("latest application: older pending + newer approved -> newer approved selected", async () => {
  const row = await selectLatestOwnOrganizationApplication(501, orderByEvaluatingDb([
    { id: 1, user_id: 501, status: "pending", submitted_at: "2026-09-01T00:00:00.000Z" },
    { id: 2, user_id: 501, status: "approved", submitted_at: "2026-09-10T00:00:00.000Z" },
  ]));
  assert.equal(row.id, 2);
  assert.equal(row.status, "approved");
});

test("latest application: older approved + newer pending -> newer pending selected", async () => {
  const row = await selectLatestOwnOrganizationApplication(501, orderByEvaluatingDb([
    { id: 1, user_id: 501, status: "approved", submitted_at: "2026-09-01T00:00:00.000Z" },
    { id: 2, user_id: 501, status: "pending", submitted_at: "2026-09-10T00:00:00.000Z" },
  ]));
  assert.equal(row.id, 2);
  assert.equal(row.status, "pending");
});

test("latest application: older declined + newer pending -> newer pending selected", async () => {
  const row = await selectLatestOwnOrganizationApplication(501, orderByEvaluatingDb([
    { id: 3, user_id: 501, status: "declined", submitted_at: "2026-08-01T00:00:00.000Z" },
    { id: 4, user_id: 501, status: "pending", submitted_at: "2026-09-01T00:00:00.000Z" },
  ]));
  assert.equal(row.id, 4);
});

test("latest application: multiple applications resolve deterministically (same timestamp -> higher id, null timestamp last)", async () => {
  const fixtures = [
    { id: 5, user_id: 501, status: "pending", submitted_at: null },
    { id: 6, user_id: 501, status: "declined", submitted_at: "2026-09-05T00:00:00.000Z" },
    { id: 7, user_id: 501, status: "approved", submitted_at: "2026-09-05T00:00:00.000Z" },
    { id: 8, user_id: 777, status: "pending", submitted_at: "2026-09-20T00:00:00.000Z" },
  ];
  for (const ordering of [fixtures, [...fixtures].reverse()]) {
    const row = await selectLatestOwnOrganizationApplication(501, orderByEvaluatingDb(ordering));
    assert.equal(row.id, 7);
  }
});

test("latest application SQL: chronology only, own rows only, no admin fields, rejects invalid user ids", async () => {
  const seen = {};
  await selectLatestOwnOrganizationApplication(501, orderByEvaluatingDb([], seen));
  assert.deepEqual(seen.params, [501]);
  assert.match(seen.sql, /FROM public\.org_applications/);
  assert.match(seen.sql, /WHERE user_id = \$1/);
  assert.match(seen.sql, /ORDER BY submitted_at DESC NULLS LAST, id DESC/);
  assert.doesNotMatch(seen.sql, /CASE|notes|reviewed_by/i);
  let queried = false;
  const trapDb = { async query() { queried = true; return { rows: [] }; } };
  assert.equal(await selectLatestOwnOrganizationApplication("501; DROP", trapDb), null);
  assert.equal(await selectLatestOwnOrganizationApplication(0, trapDb), null);
  assert.equal(queried, false);
});

test("security: the onboarding route never forwards browser-supplied user or organization ids", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const routeStart = routeSource.indexOf('router.get("/admin/organization-onboarding/status"');
  const routeSlice = routeSource.slice(routeStart, routeSource.indexOf("});\n", routeStart));
  assert.match(routeSlice, /req: \{ user: safeAuthenticatedUser\(req\) \}/);
  assert.doesNotMatch(routeSlice, /req\.(query|body|params)/);
});

test("architecture: onboarding service has no raw pool/SQL; the DB helper owns the application read", () => {
  const serviceSource = readFileSync("Backend/kai/services/kaiOrganizationOnboardingService.js", "utf8");
  const helperSource = readFileSync("Backend/kai/db/gkOrganizationApplicationQueries.js", "utf8");
  assert.doesNotMatch(serviceSource, /db\/pg\.js|kaiDb\.js|\bpool\b|\.query\(/);
  assert.doesNotMatch(serviceSource, /SELECT|INSERT|UPDATE|DELETE|org_applications\s+WHERE/);
  assert.match(serviceSource, /from "\.\.\/db\/gkOrganizationApplicationQueries\.js"/);
  assert.match(helperSource, /FROM public\.org_applications/);
  assert.doesNotMatch(helperSource, /INSERT|UPDATE|DELETE/);
});

test("Impact Library keeps existing-user request state visible without replacing the organization selector", () => {
  const appSource = readFileSync("frontend/ImpactLibraryApp.jsx", "utf8");
  assert.match(appSource, /REQUEST_STATES_SHOWN_WITH_AUTHORIZED_ORGANIZATIONS/);
  assert.match(appSource, /new Set\(\["PENDING", "DECLINED", "APPROVED_NOT_KAI_ENABLED"\]\)/);
  assert.match(appSource, /hasAuthorizedOrganizations &&\s+activeSection === "home"/);
  assert.match(appSource, /<OrganizationOnboardingPanel\s+compact/);
  assert.doesNotMatch(appSource, /Harbourline/i);
});
