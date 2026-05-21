import express from "express";
import http from "node:http";
import pool from "../Backend/db/pg.js";
import eventsApiRouter from "../routes/eventsApi.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";

const TEST_PREFIX = `Phase 2e-2 ${Date.now()}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function countCoreRows() {
  const { rows: [row] } = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM public.events) AS events,
        (SELECT COUNT(*)::int FROM public.event_roles) AS event_roles,
        (SELECT COUNT(*)::int FROM public.event_rsvps) AS event_rsvps
    `
  );
  return {
    events: Number(row.events) || 0,
    event_roles: Number(row.event_roles) || 0,
    event_rsvps: Number(row.event_rsvps) || 0,
  };
}

async function findFixtures() {
  const { rows: [orgRep] } = await pool.query(
    `
      SELECT u.id, u.email, COALESCE(u.org_id, m.org_id) AS org_id
        FROM public.userdata u
        LEFT JOIN public.user_org_memberships m
          ON m.user_id = u.id
         AND COALESCE(m.is_active, true) = true
       WHERE u.org_rep = true
         AND COALESCE(u.is_admin, false) = false
         AND COALESCE(u.org_id, m.org_id) IS NOT NULL
       ORDER BY u.id
       LIMIT 1
    `
  );
  assert(orgRep, "Need an org_rep=true user with org context");

  const { rows: [admin] } = await pool.query(
    "SELECT id, email FROM public.userdata WHERE id = 4 AND is_admin = true LIMIT 1"
  );
  assert(admin, "Need admin user_id=4 with is_admin=true");

  const { rows: [org] } = await pool.query(
    "SELECT id, name, rep_user_id FROM public.organizations WHERE rep_user_id IS NOT NULL ORDER BY id LIMIT 1"
  );
  assert(org, "Need an organization with rep_user_id");

  const { rows: volunteers } = await pool.query(
    `
      SELECT id, email
        FROM public.userdata
       WHERE COALESCE(org_rep, false) = false
         AND COALESCE(is_admin, false) = false
         AND id::text <> $1::text
       ORDER BY id
       LIMIT 4
    `,
    [orgRep.id]
  );
  assert(volunteers.length >= 4, "Need at least four non-org-rep volunteer users");

  const { rows: [legacyEvent] } = await pool.query(
    `
      SELECT e.id
        FROM public.events e
       WHERE NOT EXISTS (
             SELECT 1
               FROM public.event_roles er
              WHERE er.event_id = e.id
       )
       ORDER BY e.created_at ASC NULLS LAST, e.id ASC
       LIMIT 1
    `
  );
  assert(legacyEvent, "Need at least one legacy role-less event");

  return { orgRep, admin, org, volunteers, legacyEvent };
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const userId = req.get("X-Test-User-Id");
    if (!userId) return next();
    const { rows: [user] = [] } = await pool.query(
      "SELECT * FROM public.userdata WHERE id = $1 LIMIT 1",
      [userId]
    );
    req.user = user || { id: userId, user_id: userId };
    req.isAuthenticated = () => true;
    req.session = {
      activeOrgId: req.get("X-Test-Active-Org-Id") || undefined,
      save(callback) {
        callback?.();
      },
    };
    next();
  });
  app.use("/api/events", eventsApiRouter);
  return app;
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function client(baseUrl, user, orgId = null) {
  return async function request(method, path, body) {
    const headers = {
      "Content-Type": "application/json",
      "X-Test-User-Id": String(user.id),
    };
    if (orgId) headers["X-Test-Active-Org-Id"] = String(orgId);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
  };
}

function eventPayload(title, roles, extra = {}) {
  return {
    title,
    date: "2026-06-15",
    time_range: "10:00-12:00",
    tz: "America/Vancouver",
    location_text: "Phase 2e-2 Test Kitchen",
    capacity: 999,
    cause_tags: ["Food security"],
    attendance_methods: ["social_proof"],
    org_name: "Phase 2e-2 Test Org",
    status: "published",
    waitlist_enabled: true,
    roles,
    ...extra,
  };
}

async function cleanup(createdEventIds) {
  if (!createdEventIds.length) return;
  await pool.query("DELETE FROM public.event_rsvps WHERE event_id = ANY($1::uuid[])", [createdEventIds]);
  await pool.query("DELETE FROM public.event_roles WHERE event_id = ANY($1::uuid[])", [createdEventIds]);
  await pool.query("DELETE FROM public.events WHERE id = ANY($1::uuid[])", [createdEventIds]);
}

async function getRole(roleId) {
  const { rows: [role] = [] } = await pool.query(
    "SELECT id, event_id, spots_needed, spots_filled FROM public.event_roles WHERE id = $1",
    [roleId]
  );
  return role;
}

async function getRsvp(eventId, userId) {
  const { rows: [rsvp] = [] } = await pool.query(
    "SELECT event_id, attendee_user_id, status, role_id FROM public.event_rsvps WHERE event_id = $1 AND attendee_user_id = $2",
    [eventId, userId]
  );
  return rsvp;
}

async function main() {
  const before = await countCoreRows();
  const fixtures = await findFixtures();
  const createdEventIds = [];
  const server = await listen(createTestApp());

  try {
    const orgReq = client(server.baseUrl, fixtures.orgRep, fixtures.orgRep.org_id);
    const adminReq = client(server.baseUrl, fixtures.admin);
    const volunteerReqs = fixtures.volunteers.map((volunteer) => client(server.baseUrl, volunteer));

    let res = await orgReq("POST", "/api/events", eventPayload(`${TEST_PREFIX} multi`, [
      { title: "Server", spotsNeeded: 4 },
      { title: "Dishwasher", spotsNeeded: 2 },
    ]));
    assert(res.status === 201, `multi-role create expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const multiEvent = res.body.data.event;
    const multiRoles = res.body.data.roles;
    createdEventIds.push(multiEvent.id);
    assert(multiRoles.length === 2, "Expected two roles");
    assert(Number(multiEvent.capacity) === 6, "Expected capacity auto-set to 6");
    console.log("1-2. org rep created multi-role event:", { eventId: multiEvent.id, capacity: multiEvent.capacity });

    res = await orgReq("POST", "/api/events", eventPayload(`${TEST_PREFIX} no roles`, undefined));
    assert(res.status === 400, `no roles expected 400, got ${res.status}`);
    console.log("3. create without roles rejected:", res.body.error);

    res = await orgReq("POST", "/api/events", eventPayload(`${TEST_PREFIX} empty roles`, []));
    assert(res.status === 400, `empty roles expected 400, got ${res.status}`);
    console.log("4. create with empty roles rejected:", res.body.error);

    res = await orgReq("POST", "/api/events", eventPayload(`${TEST_PREFIX} one role`, [
      { title: "Greeter", spotsNeeded: 2 },
    ]));
    assert(res.status === 201, `one-role create expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const oneRoleEvent = res.body.data.event;
    const oneRole = res.body.data.roles[0];
    createdEventIds.push(oneRoleEvent.id);
    console.log("5. org rep created single-role event:", { eventId: oneRoleEvent.id, roleId: oneRole.id });

    res = await volunteerReqs[0]("POST", `/api/events/${oneRoleEvent.id}/rsvp`, { action: "accept" });
    assert(res.status === 200, `single-role RSVP expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    let rsvp = await getRsvp(oneRoleEvent.id, fixtures.volunteers[0].id);
    let role = await getRole(oneRole.id);
    assert(String(rsvp.role_id) === String(oneRole.id), "Expected RSVP role_id to auto-fill");
    assert(Number(role.spots_filled) === 1, "Expected spots_filled to increment to 1");
    console.log("6. single-role RSVP auto-filled role:", { status: rsvp.status, spots_filled: role.spots_filled });

    await volunteerReqs[1]("POST", `/api/events/${oneRoleEvent.id}/rsvp`, { action: "accept" });
    await volunteerReqs[2]("POST", `/api/events/${oneRoleEvent.id}/rsvp`, { action: "accept" });
    role = await getRole(oneRole.id);
    rsvp = await getRsvp(oneRoleEvent.id, fixtures.volunteers[2].id);
    assert(Number(role.spots_filled) === 3, "Expected over-capacity spots_filled to reach 3");
    assert(["pending", "accepted", "waitlisted"].includes(String(rsvp.status)), "Expected third RSVP to use existing waitlist/status behavior");
    console.log("7. over-capacity RSVP allowed:", { thirdStatus: rsvp.status, spots_filled: role.spots_filled });

    res = await volunteerReqs[0]("POST", `/api/events/${oneRoleEvent.id}/rsvp`, { action: "decline", require_existing: true });
    assert(res.status === 200, `cancel expected 200, got ${res.status}`);
    role = await getRole(oneRole.id);
    assert(Number(role.spots_filled) === 2, "Expected spots_filled to decrement after cancel");
    console.log("8. cancel decremented spots_filled:", role.spots_filled);

    res = await volunteerReqs[3]("POST", `/api/events/${fixtures.legacyEvent.id}/rsvp`, { action: "accept" });
    assert(res.status === 400, `legacy event RSVP expected 400, got ${res.status}`);
    assert(String(res.body.error || "").includes("not currently accepting new signups"), "Expected frozen-event error");
    console.log("9. legacy role-less RSVP rejected:", res.body.error);

    res = await volunteerReqs[3]("POST", `/api/events/${multiEvent.id}/rsvp`, { action: "accept" });
    assert(res.status === 400, `multi-role RSVP without roleId expected 400, got ${res.status}`);
    console.log("10. multi-role RSVP without roleId rejected:", res.body.error);

    res = await adminReq("POST", "/api/events", eventPayload(`${TEST_PREFIX} admin`, [
      { title: "Host", spotsNeeded: 1 },
    ], { organizationId: fixtures.org.id }));
    assert(res.status === 201, `admin create expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    createdEventIds.push(res.body.data.event.id);
    assert(String(res.body.data.event.creator_user_id) === String(fixtures.org.rep_user_id), "Expected admin-created event creator_user_id to use org rep_user_id");
    console.log("11. admin created on behalf of org:", { eventId: res.body.data.event.id, creator_user_id: res.body.data.event.creator_user_id });

    res = await volunteerReqs[0]("POST", "/api/events", eventPayload(`${TEST_PREFIX} forbidden`, [
      { title: "Helper", spotsNeeded: 1 },
    ]));
    assert(res.status === 403, `non-org create expected 403, got ${res.status}`);
    console.log("12. non-org event creation rejected:", res.body.error);

    const kaiDraft = await executeToolCall("draft_event_listing", {
      description: "Serve a community meal",
      date: "2026-06-20",
      location: "Community Hall",
      roles: [
        { title: "Server", spots_needed: 3, description: "Plate meals" },
        { title: "Dishwasher", spots_needed: 1 },
      ],
    }, fixtures.orgRep.id, fixtures.orgRep.org_id);
    assert(Array.isArray(kaiDraft?.draft?.roles), "Expected KAI draft roles array");
    assert(kaiDraft.draft.roles.length === 2, "Expected two KAI draft roles");
    console.log("13. KAI draft includes roles:", kaiDraft.draft.roles);
  } finally {
    await cleanup(createdEventIds);
    await server.close();
    const after = await countCoreRows();
    console.log("14. cleanup complete:", { createdEventIds, before, after });
    assert(before.events === after.events, "events count changed after cleanup");
    assert(before.event_roles === after.event_roles, "event_roles count changed after cleanup");
    assert(before.event_rsvps === after.event_rsvps, "event_rsvps count changed after cleanup");
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
