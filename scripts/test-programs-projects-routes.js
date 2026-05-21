import express from "express";
import http from "node:http";
import pool from "../Backend/db/pg.js";
import orgPortalRouter from "../routes/orgPortalApi.js";

const CSRF_TOKEN = "phase-2b-test-csrf";
const TEST_PREFIX = "Phase 2b Test";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function findOrgRepScopes() {
  const { rows } = await pool.query(
    `
      WITH rep_orgs AS (
        SELECT DISTINCT ON (COALESCE(m.org_id, u.org_id))
          u.id AS user_id,
          u.email,
          COALESCE(m.org_id, u.org_id) AS org_id
        FROM public.userdata u
        LEFT JOIN public.user_org_memberships m
          ON m.user_id = u.id
         AND COALESCE(m.is_active, true) = true
        JOIN public.organizations o
          ON o.id = COALESCE(m.org_id, u.org_id)
        WHERE (u.org_rep = true OR m.user_id IS NOT NULL)
          AND COALESCE(m.org_id, u.org_id) IS NOT NULL
          AND LOWER(COALESCE(o.status, '')) <> 'suspended'
        ORDER BY COALESCE(m.org_id, u.org_id), u.id
      )
      SELECT *
      FROM rep_orgs
      ORDER BY org_id
      LIMIT 2
    `
  );

  assert(rows.length >= 2, "Need at least two org rep users in different active organizations");
  return rows.map((row) => ({
    userId: Number(row.user_id),
    email: row.email,
    orgId: Number(row.org_id),
  }));
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = req.get("X-Test-User-Id");
    const email = req.get("X-Test-User-Email") || `phase2b-${userId}@example.test`;
    const activeOrgId = req.get("X-Test-Active-Org-Id");
    req.user = {
      id: userId,
      user_id: userId,
      email,
      org_rep: true,
    };
    req.session = {
      csrfToken: CSRF_TOKEN,
      activeOrgId: activeOrgId ? String(activeOrgId) : undefined,
    };
    next();
  });
  app.use("/api/org", orgPortalRouter);
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

function client(baseUrl, scope) {
  return async function request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": CSRF_TOKEN,
        "X-Test-User-Id": String(scope.userId),
        "X-Test-User-Email": scope.email,
        "X-Test-Active-Org-Id": String(scope.orgId),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, body: json };
  };
}

async function cleanupTestData() {
  await pool.query(
    `
      DELETE FROM public.projects
       WHERE name LIKE $1
    `,
    [`${TEST_PREFIX}%`]
  );
  await pool.query(
    `
      DELETE FROM public.programs
       WHERE name LIKE $1
    `,
    [`${TEST_PREFIX}%`]
  );
}

async function countTestData() {
  const { rows: [row] } = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM public.programs WHERE name LIKE $1) AS programs,
        (SELECT COUNT(*)::int FROM public.projects WHERE name LIKE $1) AS projects
    `,
    [`${TEST_PREFIX}%`]
  );
  return {
    programs: Number(row?.programs) || 0,
    projects: Number(row?.projects) || 0,
  };
}

async function main() {
  await cleanupTestData();
  const [primaryScope, otherScope] = await findOrgRepScopes();
  const app = createTestApp();
  const server = await listen(app);
  const primary = client(server.baseUrl, primaryScope);
  const other = client(server.baseUrl, otherScope);
  const runId = Date.now();
  let programId = null;
  let secondProgramId = null;
  let projectId = null;

  try {
    console.log("1. org rep scopes:", { primaryScope, otherScope });

    let response = await primary("GET", "/api/org/programs");
    assert(response.status === 200, `List programs expected 200, got ${response.status}`);
    console.log("2. list programs:", {
      status: response.status,
      returned: response.body.pagination?.returned,
    });

    response = await primary("POST", "/api/org/programs", {
      name: `${TEST_PREFIX} Program ${runId} delete`,
      description: "Temporary route test program",
      funder: "Phase 2b",
      intendedEquityGroups: ["test_group"],
    });
    assert(response.status === 201, `Create program expected 201, got ${response.status}`);
    programId = response.body.program?.id;
    assert(programId, "Create program did not return id");
    console.log("3. create program:", { status: response.status, id: programId });

    response = await primary("GET", `/api/org/programs/${programId}`);
    assert(response.status === 200 && response.body.program?.id === programId, "Get program failed");
    console.log("4. get program:", { status: response.status, id: response.body.program.id });

    response = await primary("PATCH", `/api/org/programs/${programId}`, {
      description: "Updated by Phase 2b route test",
    });
    assert(response.status === 200, `Update program expected 200, got ${response.status}`);
    console.log("5. update program:", { status: response.status, description: response.body.program.description });

    response = await primary("POST", `/api/org/programs/${programId}/archive`);
    assert(response.status === 200 && response.body.program?.status === "archived", "Archive program failed");
    console.log("6. archive program:", { status: response.status, programStatus: response.body.program.status });

    response = await primary("GET", "/api/org/programs?status=archived&limit=100");
    assert(
      response.status === 200 && response.body.programs.some((program) => program.id === programId),
      "Archived program did not appear in filtered list"
    );
    console.log("7. list archived programs includes test program:", true);

    response = await primary("DELETE", `/api/org/programs/${programId}`);
    assert(response.status === 200 && response.body.deleted === true, "Delete standalone program failed");
    console.log("8. delete standalone program:", response.body);
    programId = null;

    response = await primary("POST", "/api/org/programs", {
      name: `${TEST_PREFIX} Program ${runId} linked`,
      description: "Temporary linked route test program",
    });
    assert(response.status === 201, `Create second program expected 201, got ${response.status}`);
    secondProgramId = response.body.program?.id;
    console.log("9. create linked program:", { status: response.status, id: secondProgramId });

    response = await primary("POST", "/api/org/projects", {
      name: `${TEST_PREFIX} Project ${runId}`,
      programId: secondProgramId,
      description: "Temporary route test project",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      languages: ["en"],
      partnerOrgIds: [],
    });
    assert(response.status === 201, `Create project expected 201, got ${response.status}`);
    projectId = response.body.project?.id;
    assert(projectId, "Create project did not return id");
    console.log("10. create project:", { status: response.status, id: projectId });

    response = await primary("GET", `/api/org/projects/${projectId}`);
    assert(response.status === 200 && response.body.project?.id === projectId, "Get project failed");
    console.log("11. get project:", { status: response.status, id: response.body.project.id });

    response = await primary("GET", `/api/org/projects/${projectId}/metrics`);
    assert(response.status === 200, `Get metrics expected 200, got ${response.status}`);
    assert(Number(response.body.metrics?.total_events) === 0, "Expected project metrics total_events=0");
    console.log("12. get project metrics:", response.body.metrics);

    response = await primary("PATCH", `/api/org/projects/${projectId}`, {
      name: `${TEST_PREFIX} Project ${runId} Updated`,
      lifecycleStage: "draft",
    });
    assert(response.status === 200 && response.body.project?.name.includes("Updated"), "Update project failed");
    console.log("13. update project:", { status: response.status, name: response.body.project.name });

    response = await primary("POST", `/api/org/projects/${projectId}/lifecycle`, { stage: "recruiting" });
    assert(response.status === 200 && response.body.project?.lifecycle_stage === "recruiting", "Lifecycle transition failed");
    console.log("14. transition lifecycle:", { status: response.status, lifecycle_stage: response.body.project.lifecycle_stage });

    response = await primary("DELETE", `/api/org/programs/${secondProgramId}`);
    assert(response.status === 409, `Delete linked program expected 409, got ${response.status}`);
    console.log("15. delete linked program blocked:", { status: response.status, error: response.body.error });

    response = await other("GET", `/api/org/programs/${secondProgramId}`);
    assert(response.status === 404, `Cross-org program access expected 404, got ${response.status}`);
    console.log("16. cross-org program access hidden:", response.status);

    response = await other("GET", `/api/org/projects/${projectId}`);
    assert(response.status === 404, `Cross-org project access expected 404, got ${response.status}`);
    console.log("17. cross-org project access hidden:", response.status);

    response = await primary("POST", "/api/org/programs", { description: "missing name" });
    assert(response.status === 400, `Missing name expected 400, got ${response.status}`);
    console.log("18. missing program name rejected:", { status: response.status, error: response.body.error });

    response = await primary("PATCH", `/api/org/programs/${secondProgramId}`, { organization_id: otherScope.orgId });
    assert(response.status === 400, `Forbidden patch expected 400, got ${response.status}`);
    console.log("19. forbidden program patch rejected:", { status: response.status, error: response.body.error });

    response = await primary("POST", `/api/org/projects/${projectId}/lifecycle`, { stage: "not_a_stage" });
    assert(response.status === 400, `Invalid lifecycle stage expected 400, got ${response.status}`);
    console.log("20. invalid lifecycle stage rejected:", { status: response.status, error: response.body.error });

    response = await primary("DELETE", `/api/org/projects/${projectId}`);
    assert(response.status === 200 && response.body.deleted === true, "Delete project failed");
    console.log("21. delete project:", response.body);
    projectId = null;

    response = await primary("DELETE", `/api/org/programs/${secondProgramId}`);
    assert(response.status === 200 && response.body.deleted === true, "Delete linked program after project failed");
    console.log("22. delete final program:", response.body);
    secondProgramId = null;

    console.log("PASS: programs/projects route integration test completed");
  } finally {
    await cleanupTestData();
    const remaining = await countTestData();
    console.log("cleanup remaining test rows:", remaining);
    await server.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exitCode = 1;
});
