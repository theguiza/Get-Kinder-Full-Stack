import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_ORGANIZATION_ONBOARDING_APPROVED_STATUS_DATABASE_URL;

/**
 * Production 500 reproduction for GET
 * /api/kai/sprint2/intake/admin/organization-onboarding/status after an
 * organization application is approved (USER_CONFIRMED condition: pending
 * works; approved + public organization + active GK org-admin membership +
 * no GK->KAI binding returns 500). STATE C/D cover the USER_CONFIRMED
 * production defect - the same approved GK admin with NO kai.users mapping,
 * against the USER_CONFIRMED NOT NULL kai.users.email contract: the
 * authenticated email must reach the JIT insert (STATE C), and a user
 * without a usable email must get 403 mapped_kai_user_required with no row,
 * never 500 (STATE D). STATE E covers mapped + active binding -> KAI_AVAILABLE.
 *
 * Runs only inside scripts/kai-sprint2-organization-onboarding-approved-status-local-postgres.js,
 * which points the application's real ambient pool (Backend/db/pg.js via
 * DB_HOST/DB_PORT/DB_NAME) at a throwaway loopback cluster. Everything on
 * the request path is real: the mounted sprint2IntakeApi route,
 * kaiOrganizationOnboardingService, resolveKaiActorContext,
 * resolveOrgScopeForUserId, the GK organization-binding authority,
 * getKaiEnablementStatusForOrganization, and listAuthorizedOrganizations.
 * Synthetic rows only.
 */

function assertLoopback(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`organization-onboarding approved-status suite refused a non-loopback database host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("organization-onboarding approved-status integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopback(RUNNER_OWNED_DATABASE_URL);
  if (process.env.DB_HOST !== "127.0.0.1" || process.env.DATABASE_URL) {
    throw new Error("organization-onboarding approved-status suite requires the runner's loopback DB_HOST and an empty DATABASE_URL");
  }

  const express = (await import("express")).default;
  const pool = (await import("../Backend/db/pg.js")).default;
  const sprint2IntakeApiRouter = (await import("../Backend/kai/routes/sprint2IntakeApi.js")).default;
  const { requireKaiSprint2Enabled } = await import("../Backend/kai/config/kaiSprint2Config.js");
  const { resolveEffectiveClientOrganizationMembershipsForLegacyUser } = await import("../Backend/kai/auth/gkOrganizationBindingAuthority.js");

  const LEGACY_USER_ID = 97001;
  const ORG_NAME = "Onboarding Synthetic Harbour Collective";
  // Exact production condition: authenticated public.userdata user, approved
  // application, active GK org-admin membership, NO kai.users row, NO binding.
  const UNMAPPED_JIT_USER_ID = 97002;
  const UNMAPPED_JIT_ORG_NAME = "Onboarding Synthetic Unmapped Society";
  // Same condition, but the authenticated identity carries no usable email,
  // so the JIT insert cannot satisfy kai.users.email NOT NULL.
  const UNMAPPED_REJECTED_USER_ID = 97003;
  const UNMAPPED_REJECTED_ORG_NAME = "Onboarding Synthetic Rejected Society";

  // Exactly what routes/orgApplyApi.js POST /admin/org-applications/:id/approve
  // writes, preceded by the applicant's own pending application.
  async function seedApprovedApplicant(legacyUserId, orgName) {
    await pool.query(`INSERT INTO public.userdata (id, org_id, org_rep) VALUES ($1, NULL, false)`, [legacyUserId]);
    const { rows: [application] } = await pool.query(
      `INSERT INTO public.org_applications (user_id, org_name, org_description, org_website, rep_role, status)
       VALUES ($1, $2, 'Synthetic', 'https://synthetic.test', 'Director', 'pending') RETURNING id`,
      [legacyUserId, orgName],
    );
    const { rows: [organization] } = await pool.query(
      `INSERT INTO organizations (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
       VALUES ($1, 'Synthetic', 'https://synthetic.test', $2, 'Director', 'approved', NOW(), 'site.admin@synthetic.test')
       RETURNING id`,
      [orgName, legacyUserId],
    );
    const orgId = Number(organization.id);
    await pool.query(`UPDATE userdata SET org_rep = true, org_id = $1 WHERE id = $2`, [orgId, legacyUserId]);
    await pool.query(
      `INSERT INTO public.user_org_memberships (user_id, org_id, role, is_active, added_by_user_id)
       VALUES ($1, $2, 'admin', true, NULL)`,
      [legacyUserId, orgId],
    );
    await pool.query(
      `UPDATE org_applications SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'site.admin@synthetic.test' WHERE id = $1`,
      [application.id],
    );
    return orgId;
  }

  async function kaiUsersFor(legacyUserId) {
    const { rows } = await pool.query(
      `SELECT user_id, status, legacy_identity_source, email FROM kai.users WHERE legacy_public_userdata_id = $1`,
      [legacyUserId],
    );
    return rows;
  }

  async function bindingCountFor(gkOrganizationId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.gk_organization_bindings WHERE gk_organization_id = $1`,
      [gkOrganizationId],
    );
    return rows[0].n;
  }
  const BASE = "/api/kai/sprint2/intake";

  const authenticatedEmailFor = (legacyUserId) => `onboarding.${legacyUserId}@synthetic.test`;

  // The authenticated user mirrors a deserialized public.userdata row
  // (index.js passport.deserializeUser selects *), including fields the
  // onboarding route must never forward.
  async function callStatus(legacyUserId = LEGACY_USER_ID, options = {}) {
    // An explicit `email: undefined` must stay undefined (no default).
    const email = Object.hasOwn(options, "email") ? options.email : authenticatedEmailFor(legacyUserId);
    const app = express();
    app.use(BASE, (req, res, next) => {
      req.isAuthenticated = () => true;
      req.user = { id: legacyUserId, email, password: "synthetic-hash", is_admin: false, org_id: 424242 };
      next();
    });
    app.use(BASE, requireKaiSprint2Enabled, sprint2IntakeApiRouter);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const captured = [];
    const originalError = console.error;
    console.error = (...args) => {
      captured.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack}\ncode=${a.code ?? ""}` : String(a))).join(" "));
      originalError(...args);
    };
    try {
      const { port } = server.address();
      const response = await fetch(`http://127.0.0.1:${port}${BASE}/admin/organization-onboarding/status`);
      return { status: response.status, body: await response.json().catch(() => null), errors: captured };
    } finally {
      console.error = originalError;
      await new Promise((resolve) => server.close(resolve));
    }
  }

  let applicationId;
  let approvedOrgId;

  test.before(async () => {
    await pool.query(`INSERT INTO public.userdata (id, org_id, org_rep) VALUES ($1, NULL, false)`, [LEGACY_USER_ID]);
    await pool.query(
      `INSERT INTO kai.users (legacy_identity_source, legacy_public_userdata_id, status, email)
       VALUES ('public.userdata', $1, 'active', $2)`,
      [LEGACY_USER_ID, authenticatedEmailFor(LEGACY_USER_ID)],
    );
    const { rows } = await pool.query(
      `INSERT INTO public.org_applications (user_id, org_name, org_description, org_website, rep_role, status)
       VALUES ($1, $2, 'Synthetic', 'https://synthetic.test', 'Director', 'pending') RETURNING id`,
      [LEGACY_USER_ID, ORG_NAME],
    );
    applicationId = rows[0].id;
  });

  test.after(async () => {
    await pool.end();
  });

  test("STATE A - pending application, no GK org-admin membership, no binding -> controlled PENDING", async () => {
    const result = await callStatus();
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.data.status, "PENDING");
    assert.equal(result.body.data.has_authorized_organizations, false);
  });

  test("STATE B - same user after the exact approval-route writes, no binding -> APPROVED_NOT_KAI_ENABLED (never 500)", async () => {
    // Exactly what routes/orgApplyApi.js POST /admin/org-applications/:id/approve writes.
    const { rows: [organization] } = await pool.query(
      `INSERT INTO organizations (name, description, website, rep_user_id, rep_role, status, approved_at, approved_by)
       VALUES ($1, 'Synthetic', 'https://synthetic.test', $2, 'Director', 'approved', NOW(), 'site.admin@synthetic.test')
       RETURNING id`,
      [ORG_NAME, LEGACY_USER_ID],
    );
    approvedOrgId = Number(organization.id);
    await pool.query(`UPDATE userdata SET org_rep = true, org_id = $1 WHERE id = $2`, [approvedOrgId, LEGACY_USER_ID]);
    await pool.query(
      `INSERT INTO public.user_org_memberships (user_id, org_id, role, is_active, added_by_user_id)
       VALUES ($1, $2, 'admin', true, $3)
       ON CONFLICT (user_id, org_id)
       DO UPDATE SET role = 'admin', is_active = true,
         added_by_user_id = COALESCE(EXCLUDED.added_by_user_id, public.user_org_memberships.added_by_user_id)`,
      [LEGACY_USER_ID, approvedOrgId, null],
    );
    await pool.query(
      `UPDATE org_applications SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'site.admin@synthetic.test' WHERE id = $1`,
      [applicationId],
    );
    const { rows: bindings } = await pool.query(`SELECT 1 FROM kai.gk_organization_bindings WHERE gk_organization_id = $1`, [approvedOrgId]);
    assert.equal(bindings.length, 0, "no GK->KAI binding for the approved organization");

    const result = await callStatus();
    assert.notEqual(result.status, 500, `REPRODUCED 500: ${JSON.stringify(result.body)}\n${result.errors.join("\n---\n")}`);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.data.status, "APPROVED_NOT_KAI_ENABLED");
    assert.equal(result.body.data.has_authorized_organizations, false);
    assert.equal(result.body.data.can_enable_kai, true);
    assert.equal(result.body.data.gk_organization_id, approvedOrgId);
    assert.equal(result.body.data.kai_organization_id, null);
  });

  test("no GK->KAI binding -> zero derived KAI memberships, no throw (valid pre-enablement state)", async () => {
    const derived = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(LEGACY_USER_ID);
    assert.deepEqual(derived, []);
  });

  test("STATE C - production condition: approved GK admin with NO kai.users row, no binding -> JIT mapping then APPROVED_NOT_KAI_ENABLED", async () => {
    const orgId = await seedApprovedApplicant(UNMAPPED_JIT_USER_ID, UNMAPPED_JIT_ORG_NAME);
    assert.deepEqual(await kaiUsersFor(UNMAPPED_JIT_USER_ID), [], "precondition: no kai.users mapping");
    assert.equal(await bindingCountFor(orgId), 0, "precondition: no GK->KAI binding");

    const result = await callStatus(UNMAPPED_JIT_USER_ID);
    assert.notEqual(result.status, 500, `REPRODUCED 500: ${JSON.stringify(result.body)}\n${result.errors.join("\n---\n")}`);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.data.status, "APPROVED_NOT_KAI_ENABLED");
    assert.equal(result.body.data.has_authorized_organizations, false);
    assert.equal(result.body.data.can_enable_kai, true);
    assert.equal(result.body.data.gk_organization_id, orgId);

    const mapped = await kaiUsersFor(UNMAPPED_JIT_USER_ID);
    assert.equal(mapped.length, 1, "exactly one JIT-provisioned kai.users row");
    assert.equal(mapped[0].status, "active");
    assert.equal(mapped[0].legacy_identity_source, "public.userdata");
    assert.equal(mapped[0].email, authenticatedEmailFor(UNMAPPED_JIT_USER_ID), "JIT row carries the authenticated email");
    assert.ok(
      !result.errors.some((line) => line.includes("kai.users JIT provisioning failed")),
      "a valid-email JIT insert must succeed, not fall through to the controlled 403",
    );
    const { rows: memberships } = await pool.query(
      `SELECT 1 FROM kai.organization_memberships WHERE user_id = $1`,
      [mapped[0].user_id],
    );
    assert.equal(memberships.length, 0, "identity mapping alone grants no KAI tenant membership");
    assert.equal(await bindingCountFor(orgId), 0, "status read never creates a GK->KAI binding");
  });

  test("STATE D - production condition with no usable authenticated email -> no kai.users row, controlled 403 mapped_kai_user_required, never 500", async () => {
    const orgId = await seedApprovedApplicant(UNMAPPED_REJECTED_USER_ID, UNMAPPED_REJECTED_ORG_NAME);
    for (const email of [undefined, null, "", "   "]) {
      const result = await callStatus(UNMAPPED_REJECTED_USER_ID, { email });
      assert.notEqual(result.status, 500, `REPRODUCED 500: ${JSON.stringify(result.body)}\n${result.errors.join("\n---\n")}`);
      assert.equal(result.status, 403, JSON.stringify(result));
      assert.equal(result.body.error.code, "mapped_kai_user_required");
      assert.deepEqual(await kaiUsersFor(UNMAPPED_REJECTED_USER_ID), [], "no invalid kai.users row");
      assert.equal(await bindingCountFor(orgId), 0, "no GK->KAI binding created");
    }
  });

  test("STATE E - mapped approved GK admin + active GK->KAI binding + initial engagement -> KAI_AVAILABLE", async () => {
    const { rows: [kaiOrganization] } = await pool.query(
      `INSERT INTO kai.organizations DEFAULT VALUES RETURNING organization_id`,
    );
    await pool.query(
      `INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1, 'initial-pilot-assessment')`,
      [kaiOrganization.organization_id],
    );
    await pool.query(
      `INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')`,
      [approvedOrgId, kaiOrganization.organization_id],
    );

    const result = await callStatus(LEGACY_USER_ID);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.data.status, "KAI_AVAILABLE");
    assert.equal(result.body.data.kai_organization_id, kaiOrganization.organization_id);
    assert.equal(result.body.data.has_authorized_organizations, true);

    // The unmapped-then-JIT user from STATE C still has no tenant access: a
    // mapping alone never grants another organization's binding.
    const other = await callStatus(UNMAPPED_JIT_USER_ID);
    assert.equal(other.status, 200, JSON.stringify(other));
    assert.equal(other.body.data.status, "APPROVED_NOT_KAI_ENABLED");
    assert.equal(other.body.data.has_authorized_organizations, false);
  });
}
