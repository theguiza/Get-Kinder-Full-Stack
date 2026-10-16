import test from "node:test";
import assert from "node:assert/strict";

/**
 * Repair 1 real-PostgreSQL proof: after the platform superuser's bootstrap, a
 * delegated GK administrator completes routine operator/reviewer onboarding
 * of verified Get Kinder accounts end to end - and offboarding - without
 * returning to the platform superuser, unless a global role would also take
 * effect in another organization.
 *
 * Run only by scripts/kai-sprint2-p2-access-administration-local-postgres.js
 * against its ephemeral loopback cluster. Real: the production
 * access-administration router with no service override,
 * requireKaiSprint2Authenticated -> attachKaiSprint2ActorContext (real
 * resolveKaiActorContext, org scope, and GK binding derivation), the
 * services' default repositories on the ambient pool, kai.users JIT mapping,
 * the metadata-only audit writer, and each recipient's next sign-in resolved
 * the same way. Simulated: only the Get Kinder session login (req.user,
 * including site-admin is_admin, from harness headers).
 */

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_ACCESS_ADMINISTRATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`gk staff onboarding integration refused a non-loopback database URL host: ${host}`);
  }
}

test("gk staff onboarding PostgreSQL isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("gk staff onboarding integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const express = (await import("express")).default;
  const accessAdministrationRouter = (await import("../Backend/kai/routes/kaiAccessAdministrationApi.js")).default;
  const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
  const { validateActorCanPerformOperation, validateActorCanAccessKnowledgeWorkspace } = await import("../Backend/kai/auth/kaiAuthorizationService.js");
  const { getReviewCockpitCapabilities } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getOrganizationAccessCapabilities } = await import("../Backend/kai/services/kaiOrganizationAccessCapabilitiesService.js");
  const { onboardGkStaffMember } = await import("../Backend/kai/services/kaiAccessAdministrationService.js");

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  const BASE = "/api/kai/sprint2/access-administration";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const SUPERUSER = { "x-harness-admin": "1" };
  // orgScopeService (binding-derived access at sign-in) selects
  // public.organizations.status, the production column other runners'
  // synthetic mirrors also add.
  await pool.query("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text");

  async function resetAllTables() {
    await pool.query("TRUNCATE kai.audit_events, kai.user_roles, kai.organization_memberships, kai.gk_organization_bindings, kai.users RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE public.user_org_memberships, public.organizations, public.userdata RESTART IDENTITY CASCADE");
  }
  const newOrgId = async () => (await pool.query("SELECT gen_random_uuid() AS id")).rows[0].id;
  const emailOf = (legacyId) => `staff${legacyId}@onboarding.test`;

  // One Get Kinder account (public.userdata); verified unless stated, and
  // never mapped to kai.users until it signs in or is administered.
  async function seedAccount({ verified = true, suspended = false, email = undefined, gkAdminOf = null } = {}) {
    const legacyId = (await pool.query(
      "INSERT INTO public.userdata (org_id, email, email_verified, is_suspended) VALUES (NULL, NULL, $1, $2) RETURNING id", [verified, suspended],
    )).rows[0].id;
    await pool.query("UPDATE public.userdata SET email = $2 WHERE id = $1", [legacyId, email === undefined ? emailOf(legacyId) : email]);
    if (gkAdminOf) {
      await pool.query("INSERT INTO public.user_org_memberships (org_id, user_id, role, is_active) VALUES ($1, $2, 'admin', true)", [gkAdminOf, legacyId]);
    }
    return legacyId;
  }
  async function kaiUserIdOf(legacyId) {
    return (await pool.query("SELECT user_id FROM kai.users WHERE legacy_public_userdata_id = $1", [legacyId])).rows[0]?.user_id || null;
  }
  async function mapAccount(legacyId, status = "active") {
    return (await pool.query(
      "INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, email, status) VALUES ('public.userdata', $1, $2, $3) RETURNING user_id",
      [legacyId, emailOf(legacyId), status],
    )).rows[0].user_id;
  }
  async function storeMembership(organizationId, legacyId, roleName, status = "active") {
    const userId = (await kaiUserIdOf(legacyId)) || (await mapAccount(legacyId));
    await pool.query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, $3, $4)",
      [organizationId, userId, roleName, status]);
  }
  async function boundOrganization() {
    const orgId = await newOrgId();
    const gkOrganizationId = (await pool.query("INSERT INTO public.organizations (name, status) VALUES ('Bound Staff Org', 'approved') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')", [gkOrganizationId, orgId]);
    return { orgId, gkOrganizationId };
  }
  async function membershipsOf(legacyId, organizationId) {
    return (await pool.query(
      `SELECT role_name, membership_status FROM kai.organization_memberships om JOIN kai.users u ON u.user_id = om.user_id
        WHERE u.legacy_public_userdata_id = $1 AND om.organization_id = $2 ORDER BY role_name`, [legacyId, organizationId])).rows;
  }
  async function globalRolesOf(legacyId) {
    return (await pool.query(
      `SELECT r.role_name FROM kai.user_roles ur JOIN kai.roles r ON r.role_id = ur.role_id JOIN kai.users u ON u.user_id = ur.user_id
        WHERE u.legacy_public_userdata_id = $1 AND ur.organization_id IS NULL AND ur.engagement_id IS NULL AND ur.active AND ur.revoked_at IS NULL
        ORDER BY r.role_name`, [legacyId])).rows.map((row) => row.role_name);
  }
  async function auditsFor(legacyId) {
    return (await pool.query(
      `SELECT a.action, a.organization_id, a.actor_user_id, a.metadata FROM kai.audit_events a
        WHERE a.metadata->>'target_user_id' = (SELECT user_id::text FROM kai.users WHERE legacy_public_userdata_id = $1)
        ORDER BY a.audit_event_id`, [legacyId])).rows;
  }
  // Every row an access change could touch, fingerprinted.
  async function snapshot() {
    return (await pool.query(`SELECT
      (SELECT count(*)::int FROM kai.users) AS users,
      (SELECT md5(coalesce(string_agg(user_id::text || status, ',' ORDER BY user_id), '')) FROM kai.users) AS user_status,
      (SELECT count(*)::int FROM kai.audit_events) AS audits,
      (SELECT md5(coalesce(string_agg(organization_id::text || user_id::text || role_name || membership_status, ',' ORDER BY organization_id, user_id, role_name), '')) FROM kai.organization_memberships) AS memberships,
      (SELECT md5(coalesce(string_agg(user_id::text || role_id::text || active::text || coalesce(revoked_at::text, ''), ',' ORDER BY user_id, role_id), '')) FROM kai.user_roles) AS roles`)).rows[0];
  }

  async function withRealRouter(work) {
    const previousEnabled = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const legacyId = Number(req.headers["x-harness-user"]);
      if (Number.isInteger(legacyId) && legacyId > 0) {
        req.user = { id: legacyId, email: emailOf(legacyId), ...(req.headers["x-harness-admin"] === "1" ? { is_admin: true } : {}) };
      }
      req.isAuthenticated = () => Boolean(req.user);
      next();
    });
    app.use(BASE, accessAdministrationRouter);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const { port } = server.address();
    const call = async (asLegacyId, method, path, body, extraHeaders = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${BASE}${path}`, {
        method,
        headers: { "x-harness-user": String(asLegacyId), ...extraHeaders, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const parsed = await response.json().catch(() => null);
      return { status: response.status, code: parsed?.error?.code ?? null, reason: parsed?.blockers?.[0]?.blocking_reason ?? null, body: parsed };
    };
    try {
      return await work(call);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      if (previousEnabled === undefined) delete process.env.KAI_SPRINT2_ENABLED;
      else process.env.KAI_SPRINT2_ENABLED = previousEnabled;
    }
  }

  // The recipient's next sign-in, resolved exactly as every KAI request is,
  // and what that actor may do in one organization.
  async function signIn(legacyId) {
    const resolved = await resolveKaiActorContext({ user: { id: legacyId, email: emailOf(legacyId) } });
    assert.equal(resolved.ok, true, JSON.stringify(resolved));
    return resolved.actorContext;
  }
  async function effectiveAccess(legacyId, organizationId) {
    const actorContext = await signIn(legacyId);
    const cockpit = await getReviewCockpitCapabilities({ organizationId, actorContext }, { env: ENV });
    const capabilities = await getOrganizationAccessCapabilities({ organizationId, actorContext }, { env: ENV });
    return {
      globalRoles: actorContext.kaiRoles,
      workspace: validateActorCanAccessKnowledgeWorkspace(actorContext, organizationId).ok === true,
      sourceReview: cockpit.data?.can_review_source_candidates === true,
      sensitivityReview: cockpit.data?.can_manage_sensitivity_review === true,
      intakeCreation: validateActorCanPerformOperation(actorContext, "create_intake_batch", organizationId).ok === true,
      extractEvidence: capabilities.data?.workflowOperations?.extractEvidence === true,
      evidenceReview: capabilities.data?.workflowOperations?.recordEvidenceReview === true,
      claimReview: capabilities.data?.workflowOperations?.recordClaimReview === true,
      coverageAcceptance: capabilities.data?.workflowOperations?.acceptCoverageLimitation === true,
      teamAccess: capabilities.data?.organizationAccessManagement === true,
      capabilitiesStatus: capabilities.ok ? 200 : capabilities.error?.code,
    };
  }

  // The platform superuser's privileged bootstrap through the existing
  // governed paths: global gk_admin (superuser-only route) and organization
  // gk_admin (additive grant) for one account.
  async function bootstrap(call) {
    const orgA = await newOrgId();
    const orgB = await newOrgId();
    const superuser = await seedAccount();
    const gkAdmin = await seedAccount();
    const globalGrant = await call(superuser, "PUT", `/global-roles/${gkAdmin}`, { role_name: "gk_admin", action: "assign" }, SUPERUSER);
    const organizationGrant = await call(superuser, "POST", `/organizations/${orgA}/memberships/${gkAdmin}/roles`, { role_name: "gk_admin" }, SUPERUSER);
    assert.deepEqual([globalGrant.status, organizationGrant.status], [200, 200], JSON.stringify([globalGrant.body, organizationGrant.body]));
    return { orgA, orgB, superuser, gkAdmin };
  }
  const onboardByEmail = (call, actor, organizationId, email, roleName) =>
    call(actor, "POST", `/organizations/${organizationId}/gk-staff`, { email, role_name: roleName });
  const onboardById = (call, actor, organizationId, legacyId, roleName) =>
    call(actor, "POST", `/organizations/${organizationId}/gk-staff/${legacyId}`, { role_name: roleName });
  const offboard = (call, actor, organizationId, legacyId, roleName) =>
    call(actor, "POST", `/organizations/${organizationId}/gk-staff/${legacyId}/roles/${roleName}/revoke`);
  const roster = async (call, actor, organizationId, headers) => (await call(actor, "GET", `/organizations/${organizationId}/access`, undefined, headers)).body.data;

  await test("Repair 1 delegated GK staff onboarding real PostgreSQL proof", async (t) => {
    try {
      await t.test("1. the platform superuser's existing privileged bootstrap makes an account a delegated GK administrator, audited as platform_superuser", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, gkAdmin } = await bootstrap(call);
          assert.deepEqual(await globalRolesOf(gkAdmin), ["gk_admin"]);
          assert.deepEqual(await membershipsOf(gkAdmin, orgA), [{ role_name: "gk_admin", membership_status: "active" }]);
          assert.deepEqual((await auditsFor(gkAdmin)).map((a) => [a.action, a.metadata.authority_source]), [
            ["global_kai_role_assigned", "platform_superuser"],
            ["organization_role_granted_access_admitted", "platform_superuser"],
          ]);
          assert.equal((await effectiveAccess(gkAdmin, orgA)).teamAccess, true, "Team & Access is offered to the delegated administrator");
          // Bootstrap remains the superuser's: the delegated path never grants gk_admin.
          assert.equal((await onboardByEmail(call, gkAdmin, orgA, emailOf(await seedAccount()), "gk_admin")).reason, "staff_onboarding_role_not_permitted");
        });
      });

      await t.test("2-5. REGRESSION: the delegated administrator onboards a verified account that never used KAI as an operator by exact email; the operator signs in and works immediately", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, orgB, gkAdmin } = await bootstrap(call);
          const operator = await seedAccount();
          assert.equal(await kaiUserIdOf(operator), null, "never signed in to KAI");
          const before = await effectiveAccess(gkAdmin, orgA);
          assert.equal(before.teamAccess, true);

          const onboarded = await onboardByEmail(call, gkAdmin, orgA, `  ${emailOf(operator).toUpperCase()} `, "gk_operator");
          assert.equal(onboarded.status, 200, JSON.stringify(onboarded.body));
          const data = onboarded.body.data;
          assert.deepEqual([data.legacy_public_userdata_id, data.onboarding_status, data.global_role, data.pending_blockers],
            [operator, "complete", { role_name: "gk_operator", status: "assigned" }, []]);
          assert.deepEqual([data.organization_role.granted, data.organization_role.organization_access_admitted], [true, true]);
          assert.equal(data.operation_readiness.find((item) => item.key === "source_review").ready, true);

          // 5. The identity was mapped exactly as its first sign-in would map it.
          const [mapping] = (await pool.query("SELECT legacy_identity_source, legacy_public_userdata_id, email, status FROM kai.users WHERE legacy_public_userdata_id = $1", [operator])).rows;
          assert.deepEqual(mapping, { legacy_identity_source: "public.userdata", legacy_public_userdata_id: operator, email: emailOf(operator), status: "active" });
          assert.deepEqual(await membershipsOf(operator, orgA), [{ role_name: "gk_operator", membership_status: "active" }]);
          assert.deepEqual(await membershipsOf(operator, orgB), []);
          assert.deepEqual(await globalRolesOf(operator), ["gk_operator"]);

          // 4. The operator's next sign-in carries the complete authority.
          const access = await effectiveAccess(operator, orgA);
          assert.deepEqual(
            [access.globalRoles, access.workspace, access.sourceReview, access.sensitivityReview, access.intakeCreation, access.extractEvidence, access.teamAccess],
            [["gk_operator"], true, true, true, true, true, false],
          );
          assert.deepEqual([access.evidenceReview, access.claimReview], [false, false], "an operator records no review decision");
          const orgBAccess = await effectiveAccess(operator, orgB);
          assert.deepEqual([orgBAccess.workspace, orgBAccess.sourceReview, orgBAccess.intakeCreation, orgBAccess.capabilitiesStatus],
            [false, false, false, "authorization_denied"], "nothing in another organization");

          // 13. Both writes are audited, metadata only, attributed to the delegated administrator.
          const gkAdminKaiUserId = await kaiUserIdOf(gkAdmin);
          const audits = await auditsFor(operator);
          assert.deepEqual(audits.map((a) => [a.action, a.metadata.role_name, a.metadata.authority_source, a.organization_id, a.actor_user_id]), [
            ["organization_role_granted_access_admitted", "gk_operator", "delegated_gk_admin", orgA, gkAdminKaiUserId],
            ["global_kai_role_assigned", "gk_operator", "delegated_gk_admin", orgA, gkAdminKaiUserId],
          ]);
          for (const audit of audits) assert.doesNotMatch(JSON.stringify(audit.metadata), /@/, "metadata-only audit");

          // A replay writes nothing.
          const state = await snapshot();
          const replay = await onboardById(call, gkAdmin, orgA, operator, "gk_operator");
          assert.deepEqual([replay.status, replay.body.data.replayed, replay.body.data.global_role.status], [200, true, "already_held"]);
          assert.deepEqual(await snapshot(), state);
        });
      });

      await t.test("3-4. the delegated administrator onboards an existing member as a reviewer by account id; the client role is kept and the reviewer decides immediately", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, gkAdmin } = await bootstrap(call);
          const reviewer = await seedAccount();
          await storeMembership(orgA, reviewer, "client_contributor");
          const onboarded = await onboardById(call, gkAdmin, orgA, reviewer, "gk_reviewer");
          assert.equal(onboarded.status, 200, JSON.stringify(onboarded.body));
          assert.deepEqual([onboarded.body.data.onboarding_status, onboarded.body.data.organization_role.organization_access_admitted], ["complete", false]);
          assert.deepEqual(await membershipsOf(reviewer, orgA), [
            { role_name: "client_contributor", membership_status: "active" }, { role_name: "gk_reviewer", membership_status: "active" },
          ]);
          const access = await effectiveAccess(reviewer, orgA);
          assert.deepEqual(
            [access.globalRoles, access.workspace, access.sourceReview, access.sensitivityReview, access.evidenceReview, access.claimReview, access.coverageAcceptance],
            [["gk_reviewer"], true, true, true, true, true, true],
          );
          assert.equal(access.intakeCreation, false, "intake creation stays an operator/administrator write");
          assert.deepEqual((await auditsFor(reviewer)).map((a) => [a.action, a.metadata.authority_source]), [
            ["organization_role_granted", "delegated_gk_admin"], ["global_kai_role_assigned", "delegated_gk_admin"],
          ]);
          // The delegated administrator's roster reads the completed onboarding.
          const row = (await roster(call, gkAdmin, orgA)).access.find((entry) => entry.legacy_public_userdata_id === reviewer);
          assert.deepEqual(row.staff_onboarding, [{ role_name: "gk_reviewer", global_role: "gk_reviewer", status: "complete" }]);
        });
      });

      await t.test("6, 14. unknown, unverified, suspended, ambiguous, and deactivated identities receive no authority and nothing is written", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, gkAdmin } = await bootstrap(call);
          const unverified = await seedAccount({ verified: false });
          const suspended = await seedAccount({ suspended: true });
          const deactivated = await seedAccount();
          await mapAccount(deactivated, "inactive");
          const shared = "shared@onboarding.test";
          await seedAccount({ email: shared });
          await seedAccount({ email: "Shared@Onboarding.test " });
          const state = await snapshot();
          for (const [label, request, status, reason] of [
            ["unknown email", () => onboardByEmail(call, gkAdmin, orgA, "nobody@onboarding.test", "gk_operator"), 404, "target_account_not_found"],
            ["unknown account id", () => onboardById(call, gkAdmin, orgA, 987654, "gk_operator"), 404, "target_account_not_found"],
            ["unverified email", () => onboardByEmail(call, gkAdmin, orgA, emailOf(unverified), "gk_operator"), 422, "target_account_not_verified"],
            ["unverified account id", () => onboardById(call, gkAdmin, orgA, unverified, "gk_reviewer"), 422, "target_account_not_verified"],
            ["suspended account", () => onboardById(call, gkAdmin, orgA, suspended, "gk_operator"), 422, "target_account_suspended"],
            ["ambiguous email", () => onboardByEmail(call, gkAdmin, orgA, shared, "gk_operator"), 422, "target_account_ambiguous"],
            ["deactivated KAI account", () => onboardById(call, gkAdmin, orgA, deactivated, "gk_operator"), 422, "target_kai_account_inactive"],
            ["malformed email", () => onboardByEmail(call, gkAdmin, orgA, "not-an-email", "gk_operator"), 422, null],
            ["extra body field", () => call(gkAdmin, "POST", `/organizations/${orgA}/gk-staff/${unverified}`, { role_name: "gk_operator", global: true }), 422, null],
            // The organization-only delegated grant applies the same identity rule.
            ["organization-only grant to an unverified account", () => call(gkAdmin, "POST", `/organizations/${orgA}/memberships/${unverified}/roles`, { role_name: "gk_reviewer" }), 422, "target_account_not_verified"],
          ]) {
            const refused = await request();
            assert.deepEqual([refused.status, refused.reason], [status, reason], `${label}: ${JSON.stringify(refused.body)}`);
            assert.doesNotMatch(JSON.stringify(refused.body), /@/, `${label}: no email in the refusal`);
          }
          assert.deepEqual(await snapshot(), state, "no mapping, membership, role, or audit was written");
          assert.equal((await pool.query("SELECT status FROM kai.users WHERE legacy_public_userdata_id = $1", [deactivated])).rows[0].status, "inactive", "never revived");
          const unverifiedSignIn = await resolveKaiActorContext({ user: { id: unverified, email: emailOf(unverified) } });
          assert.deepEqual([unverifiedSignIn.actorContext.kaiRoles, unverifiedSignIn.actorContext.organizationMemberships], [[], []]);
        });
      });

      await t.test("7-10, 14. no gk_admin, no client role, no self-elevation, no other organization, and no client administrator (stored or binding-derived) - zero writes", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, orgB, gkAdmin } = await bootstrap(call);
          const { orgId: boundOrg, gkOrganizationId } = await boundOrganization();
          const boundAdmin = await seedAccount({ gkAdminOf: gkOrganizationId });
          const storedClientAdmin = await seedAccount();
          await storeMembership(orgA, storedClientAdmin, "client_admin");
          const candidate = await seedAccount();
          const operator = await seedAccount();
          assert.equal((await onboardById(call, gkAdmin, orgA, operator, "gk_operator")).status, 200);
          // Each actor has signed in before (their own first request maps them to kai.users).
          await signIn(boundAdmin);
          const state = await snapshot();
          for (const [label, request, status, reason] of [
            ["organization gk_admin", () => onboardById(call, gkAdmin, orgA, candidate, "gk_admin"), 403, "staff_onboarding_role_not_permitted"],
            ["a client role", () => onboardById(call, gkAdmin, orgA, candidate, "client_reviewer"), 403, "staff_onboarding_role_not_permitted"],
            ["an unknown role", () => onboardById(call, gkAdmin, orgA, candidate, "platform_superuser"), 422, null],
            ["self-elevation by id", () => onboardById(call, gkAdmin, orgA, gkAdmin, "gk_reviewer"), 403, "self_role_elevation_not_allowed"],
            ["self-elevation by email", () => onboardByEmail(call, gkAdmin, orgA, emailOf(gkAdmin), "gk_operator"), 403, "self_role_elevation_not_allowed"],
            ["another organization", () => onboardById(call, gkAdmin, orgB, candidate, "gk_operator"), 403, "missing_active_organization_membership"],
            ["another organization's offboarding", () => offboard(call, gkAdmin, orgB, operator, "gk_operator"), 403, "missing_active_organization_membership"],
            ["a global role directly", () => call(gkAdmin, "PUT", `/global-roles/${candidate}`, { role_name: "gk_operator", action: "assign" }), 403, "platform_superuser_required"],
            ["stored client administrator", () => onboardById(call, storedClientAdmin, orgA, candidate, "gk_operator"), 403, "non_client_membership_not_client_managed"],
            ["binding-derived client administrator", () => onboardById(call, boundAdmin, boundOrg, candidate, "gk_reviewer"), 403, "non_client_membership_not_client_managed"],
            ["binding-derived client administrator offboarding", () => offboard(call, boundAdmin, boundOrg, operator, "gk_operator"), 403, "non_client_membership_not_client_managed"],
            ["the onboarded operator", () => onboardById(call, operator, orgA, candidate, "gk_operator"), 403, "role_not_allowed"],
          ]) {
            const refused = await request();
            assert.deepEqual([refused.status, refused.reason], [status, reason], `${label}: ${JSON.stringify(refused.body)}`);
          }
          assert.deepEqual(await snapshot(), state, "every refusal wrote nothing");
          assert.equal((await effectiveAccess(boundAdmin, boundOrg)).teamAccess, true, "the binding-derived administrator keeps client administration only");
        });
      });

      await t.test("11. a global role that would also take effect in another organization is not granted: the organization role is the pending state, and only the platform superuser completes it", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, orgB, superuser, gkAdmin } = await bootstrap(call);
          // Stored access elsewhere: a client role in Org B.
          const clientElsewhere = await seedAccount();
          await storeMembership(orgB, clientElsewhere, "client_contributor");
          // Binding-derived access elsewhere: Get Kinder organization admin of a bound organization.
          const { orgId: boundOrg, gkOrganizationId } = await boundOrganization();
          const boundElsewhere = await seedAccount({ gkAdminOf: gkOrganizationId });

          for (const [person, role] of [[clientElsewhere, "gk_reviewer"], [boundElsewhere, "gk_operator"]]) {
            const pending = await onboardById(call, gkAdmin, orgA, person, role);
            assert.equal(pending.status, 200, JSON.stringify(pending.body));
            const [blocker] = pending.body.data.pending_blockers;
            assert.deepEqual([pending.body.data.onboarding_status, pending.body.data.global_role.status, blocker.blocking_reason, blocker.evidence.approval_path],
              ["pending_platform_approval", "pending_platform_approval", "cross_organization_global_role_side_effect", "platform_superuser_global_role"]);
            assert.doesNotMatch(JSON.stringify(blocker), new RegExp(`${orgB}|${boundOrg}|@`), "the blocker names no other organization or person");
            assert.deepEqual(await membershipsOf(person, orgA), [{ role_name: role, membership_status: "active" }], "the scoped onboarding is kept");
            assert.deepEqual(await globalRolesOf(person), [], "no global role was written");
            assert.deepEqual((await auditsFor(person)).map((a) => a.action), ["organization_role_granted_access_admitted"]);
            // The other organization gains nothing; in Org A the global-only work waits.
            const elsewhere = await effectiveAccess(person, person === clientElsewhere ? orgB : boundOrg);
            assert.deepEqual([elsewhere.workspace, elsewhere.sourceReview, elsewhere.evidenceReview], [false, false, false]);
            assert.equal((await effectiveAccess(person, orgA)).sourceReview, false);
            // Retrying stays pending and writes nothing.
            const state = await snapshot();
            assert.equal((await onboardById(call, gkAdmin, orgA, person, role)).body.data.onboarding_status, "pending_platform_approval");
            assert.deepEqual(await snapshot(), state);
          }
          const pendingRow = (await roster(call, gkAdmin, orgA)).access.find((entry) => entry.legacy_public_userdata_id === clientElsewhere);
          assert.deepEqual(pendingRow.staff_onboarding, [{ role_name: "gk_reviewer", global_role: "gk_reviewer", status: "pending_platform_approval" }]);

          // The existing authorized platform path completes the exceptional grant.
          const approved = await call(superuser, "PUT", `/global-roles/${clientElsewhere}`, { role_name: "gk_reviewer", action: "assign" }, SUPERUSER);
          assert.equal(approved.status, 200);
          assert.equal((await effectiveAccess(clientElsewhere, orgA)).sourceReview, true);
          const completedRow = (await roster(call, superuser, orgA, SUPERUSER)).access.find((entry) => entry.legacy_public_userdata_id === clientElsewhere);
          assert.deepEqual(completedRow.staff_onboarding, [{ role_name: "gk_reviewer", global_role: "gk_reviewer", status: "complete" }]);
          assert.deepEqual((await auditsFor(clientElsewhere)).map((a) => [a.action, a.metadata.authority_source]), [
            ["organization_role_granted_access_admitted", "delegated_gk_admin"], ["global_kai_role_assigned", "platform_superuser"],
          ]);
        });
      });

      await t.test("12-13. offboarding removes the global role only when nothing else needs it, preserves every unrelated assignment, and audits each completed revocation", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, orgB, superuser, gkAdmin } = await bootstrap(call);
          const orgC = await newOrgId();
          // Confined operator with a client role here.
          const operator = await seedAccount();
          await storeMembership(orgA, operator, "client_contributor");
          assert.equal((await onboardById(call, gkAdmin, orgA, operator, "gk_operator")).body.data.onboarding_status, "complete");
          // A reviewer whose global role a reviewer assignment in Org C also needs.
          const sharedReviewer = await seedAccount();
          await storeMembership(orgC, sharedReviewer, "gk_reviewer");
          assert.equal((await call(superuser, "PUT", `/global-roles/${sharedReviewer}`, { role_name: "gk_reviewer", action: "assign" }, SUPERUSER)).status, 200);
          const sharedOnboarding = await onboardById(call, gkAdmin, orgA, sharedReviewer, "gk_reviewer");
          assert.deepEqual([sharedOnboarding.body.data.onboarding_status, sharedOnboarding.body.data.global_role.status], ["complete", "already_held"]);
          // An operator with a client role in Org B whose global role the platform approved.
          const approvedElsewhere = await seedAccount();
          await storeMembership(orgB, approvedElsewhere, "client_contributor");
          await onboardById(call, gkAdmin, orgA, approvedElsewhere, "gk_operator");
          assert.equal((await call(superuser, "PUT", `/global-roles/${approvedElsewhere}`, { role_name: "gk_operator", action: "assign" }, SUPERUSER)).status, 200);
          const bystander = await seedAccount();
          await storeMembership(orgA, bystander, "client_contributor");

          const others = async () => [await membershipsOf(bystander, orgA), await membershipsOf(sharedReviewer, orgC), await membershipsOf(approvedElsewhere, orgB), await membershipsOf(gkAdmin, orgA)];
          const othersBefore = await others();

          const confined = await offboard(call, gkAdmin, orgA, operator, "gk_operator");
          assert.equal(confined.status, 200, JSON.stringify(confined.body));
          assert.deepEqual([confined.body.data.global_role, confined.body.data.remaining_active_role_names, confined.body.data.pending_blockers],
            [{ role_name: "gk_operator", status: "revoked", reason: null }, ["client_contributor"], []]);
          assert.deepEqual(await membershipsOf(operator, orgA), [
            { role_name: "client_contributor", membership_status: "active" }, { role_name: "gk_operator", membership_status: "inactive" },
          ]);
          assert.deepEqual(await globalRolesOf(operator), []);
          const after = await effectiveAccess(operator, orgA);
          assert.deepEqual([after.workspace, after.sourceReview, after.intakeCreation, after.extractEvidence], [false, false, false, false],
            "the next request enforces the complete revocation");
          assert.deepEqual((await auditsFor(operator)).slice(-2).map((a) => [a.action, a.metadata.authority_source, a.organization_id]), [
            ["organization_role_revoked", "delegated_gk_admin", orgA], ["global_kai_role_revoked", "delegated_gk_admin", orgA],
          ]);

          const shared = await offboard(call, gkAdmin, orgA, sharedReviewer, "gk_reviewer");
          assert.deepEqual(shared.body.data.global_role, { role_name: "gk_reviewer", status: "retained", reason: "required_by_another_assignment" });
          assert.deepEqual(await globalRolesOf(sharedReviewer), ["gk_reviewer"]);
          assert.equal((await effectiveAccess(sharedReviewer, orgC)).evidenceReview, true, "the Org C reviewer assignment keeps working");

          const elsewhere = await offboard(call, gkAdmin, orgA, approvedElsewhere, "gk_operator");
          assert.deepEqual([elsewhere.body.data.global_role.status, elsewhere.body.data.global_role.reason, elsewhere.body.data.pending_blockers[0].blocking_reason],
            ["retained", "access_in_another_organization", "cross_organization_global_role_side_effect"]);
          assert.deepEqual(await globalRolesOf(approvedElsewhere), ["gk_operator"], "the platform-approved global role is left to the platform superuser");

          assert.deepEqual(await others(), othersBefore, "unrelated assignments are untouched");
          assert.deepEqual(await membershipsOf(approvedElsewhere, orgB), [{ role_name: "client_contributor", membership_status: "active" }]);
          // Revoking twice is a replay; an assignment that never existed is not_found; neither writes.
          const state = await snapshot();
          assert.deepEqual([(await offboard(call, gkAdmin, orgA, operator, "gk_operator")).body.data.replayed], [true]);
          assert.deepEqual([(await offboard(call, gkAdmin, orgA, bystander, "gk_reviewer")).status], [404]);
          assert.deepEqual(await snapshot(), state);
        });
      });

      await t.test("14. a required audit that fails rolls back the whole onboarding: no organization role, no global role", async () => {
        await resetAllTables();
        await withRealRouter(async (call) => {
          const { orgA, gkAdmin } = await bootstrap(call);
          const recipient = await seedAccount();
          await signIn(recipient);
          const actorContext = await signIn(gkAdmin);
          const state = await snapshot();
          let publishes = 0;
          const result = await onboardGkStaffMember(
            { actorContext, organizationId: orgA, targetLegacyPublicUserdataId: recipient, roleName: "gk_operator", now: new Date().toISOString() },
            {
              env: ENV,
              // The organization-role audit publishes; the global-role audit fails.
              createProductionMetadataOnlyAuditForAccessAdministration: (args) => ({
                prepareMetadataOnlyAudit: ({ payload, db }) => ({
                  ok: true,
                  async publish() {
                    publishes += 1;
                    if (payload.attempted_operation === "global_kai_role_assigned") throw new Error("forced_audit_failure");
                    const { createProductionMetadataOnlyAuditForAccessAdministration: real } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
                    return real(args).prepareMetadataOnlyAudit({ payload, db }).publish();
                  },
                }),
              }),
            },
          );
          assert.deepEqual([result.ok, result.error.code, publishes], [false, "system_error", 2]);
          assert.deepEqual(await snapshot(), state, "the transaction rolled back every write");
          const disabled = await onboardGkStaffMember(
            { actorContext, organizationId: orgA, targetLegacyPublicUserdataId: recipient, roleName: "gk_operator", now: new Date().toISOString() },
            { env: { KAI_SPRINT2_ENABLED: "false" } },
          );
          assert.equal(disabled.error.code, "feature_disabled");
          assert.deepEqual(await snapshot(), state);
        });
      });
    } finally {
      await pool.end();
    }
  });
}
