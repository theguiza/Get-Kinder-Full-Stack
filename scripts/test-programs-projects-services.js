import pool from "../Backend/db/pg.js";
import {
  createProgram,
  deleteProgram,
  listProgramsForOrg,
} from "../Backend/services/programsService.js";
import {
  createProject,
  deleteProject,
  getProjectMetrics,
  listProjectsForProgram,
  transitionLifecycleStage,
  updateProject,
} from "../Backend/services/projectsService.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function findTestScope() {
  const { rows } = await pool.query(
    `
      SELECT
        o.id AS organization_id,
        COALESCE(o.rep_user_id, u.id, any_user.id) AS created_by_user_id
      FROM public.organizations o
      LEFT JOIN public.userdata u ON u.org_id = o.id
      CROSS JOIN LATERAL (
        SELECT id
          FROM public.userdata
         ORDER BY id
         LIMIT 1
      ) any_user
      ORDER BY CASE WHEN o.id = 1 THEN 0 ELSE 1 END, o.id
      LIMIT 1
    `
  );

  const scope = rows[0];
  assert(scope?.organization_id, "No organization found for service test");
  assert(scope?.created_by_user_id, "No user found for service test created_by_user_id");
  return {
    organizationId: Number(scope.organization_id),
    createdByUserId: Number(scope.created_by_user_id),
  };
}

async function main() {
  const runId = Date.now();
  const programName = `Phase 2a Test Program ${runId}`;
  const projectName = `Phase 2a Test Project ${runId}`;
  const updatedProjectName = `${projectName} Updated`;
  let program = null;
  let project = null;

  try {
    const scope = await findTestScope();
    console.log("1. test scope selected:", scope);

    program = await createProgram(pool, {
      organizationId: scope.organizationId,
      name: programName,
      description: "Temporary service-layer verification program",
      funder: "Phase 2a Test",
      intendedEquityGroups: ["test_group"],
      createdByUserId: scope.createdByUserId,
    });
    assert(program?.id, "Program was not created");
    console.log("2. program created:", { id: program.id, name: program.name });

    project = await createProject(pool, {
      organizationId: scope.organizationId,
      programId: program.id,
      name: projectName,
      description: "Temporary service-layer verification project",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      languages: ["en"],
      partnerOrgIds: [],
      createdByUserId: scope.createdByUserId,
    });
    assert(project?.id, "Project was not created");
    console.log("3. project created:", { id: project.id, name: project.name, program_id: project.program_id });

    const programs = await listProgramsForOrg(pool, scope.organizationId, { limit: 100 });
    assert(programs.some((row) => row.id === program.id), "Created program did not appear in org list");
    console.log("4. listProgramsForOrg includes test program:", true);

    const projects = await listProjectsForProgram(pool, program.id);
    assert(projects.some((row) => row.id === project.id), "Created project did not appear in program list");
    console.log("5. listProjectsForProgram includes test project:", true);

    project = await updateProject(pool, project.id, { name: updatedProjectName });
    assert(project?.name === updatedProjectName, "Project name update failed");
    console.log("6. project updated:", { id: project.id, name: project.name });

    const metrics = await getProjectMetrics(pool, project.id);
    assert(metrics, "Project metrics returned null for existing project");
    assert(Number(metrics.total_events) === 0, "Expected total_events to be 0");
    assert(Number(metrics.total_roles) === 0, "Expected total_roles to be 0");
    assert(Number(metrics.total_rsvps_accepted) === 0, "Expected total_rsvps_accepted to be 0");
    assert(Number(metrics.total_rsvps_verified) === 0, "Expected total_rsvps_verified to be 0");
    assert(Number(metrics.total_verified_minutes) === 0, "Expected total_verified_minutes to be 0");
    assert(Number(metrics.total_verified_hours) === 0, "Expected total_verified_hours to be 0");
    assert(Number(metrics.unique_volunteers) === 0, "Expected unique_volunteers to be 0");
    console.log("7. project metrics are zero:", metrics);

    project = await transitionLifecycleStage(pool, project.id, "recruiting");
    assert(project?.lifecycle_stage === "recruiting", "Lifecycle transition failed");
    console.log("8. lifecycle transitioned:", { id: project.id, lifecycle_stage: project.lifecycle_stage });

    let programDeleteFailed = false;
    try {
      await deleteProgram(pool, program.id);
    } catch (err) {
      programDeleteFailed = true;
      console.log("9. deleteProgram blocked while project exists:", err.message);
    }
    assert(programDeleteFailed, "deleteProgram should fail while a project is linked");

    const projectDelete = await deleteProject(pool, project.id);
    assert(projectDelete.deleted === true, "Project delete did not report success");
    console.log("10. project deleted:", projectDelete);
    project = null;

    const programDelete = await deleteProgram(pool, program.id);
    assert(programDelete.deleted === true, "Program delete did not report success");
    console.log("11. program deleted:", programDelete);
    program = null;

    console.log("PASS: programs/projects services smoke test completed");
  } finally {
    if (project?.id) {
      await deleteProject(pool, project.id).catch((err) => {
        console.error("Cleanup project delete failed:", err.message);
      });
    }
    if (program?.id) {
      await deleteProgram(pool, program.id).catch((err) => {
        console.error("Cleanup program delete failed:", err.message);
      });
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exitCode = 1;
});
