import pool from "../Backend/db/pg.js";

const LEGACY_PROJECT_NAME = "Legacy events";
const LEGACY_PROJECT_DESCRIPTION =
  "Auto-created during Programs/Projects migration to bucket pre-existing events. Review and re-assign as needed.";
const OARCA_ORG_NAME = "OARCA";
const OARCA_PROJECT_NAME = "Cadborosaurus Coastal Endurance Regatta";

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function stringifyId(value) {
  return value == null ? null : String(value);
}

function addCandidate(candidateMap, row) {
  const eventId = stringifyId(row.event_id);
  const orgId = Number(row.organization_id);
  if (!eventId || !Number.isInteger(orgId) || orgId <= 0) return;
  if (!candidateMap.has(eventId)) candidateMap.set(eventId, new Map());
  const eventCandidates = candidateMap.get(eventId);
  if (!eventCandidates.has(orgId)) {
    eventCandidates.set(orgId, {
      id: orgId,
      name: row.organization_name || "",
      repUserId: row.rep_user_id == null ? null : Number(row.rep_user_id),
      sources: new Set(),
    });
  }
  eventCandidates.get(orgId).sources.add(row.source || "unknown");
}

async function hasUserOrgMembershipTable(client) {
  const { rows: [row] = [] } = await client.query(
    "SELECT to_regclass('public.user_org_memberships') AS table_name"
  );
  return Boolean(row?.table_name);
}

async function fetchOrphanEvents(client, { lockRows = false } = {}) {
  const { rows } = await client.query(
    `
      SELECT id, title, creator_user_id
      FROM public.events
      WHERE project_id IS NULL
      ORDER BY creator_user_id ASC NULLS LAST, start_at ASC NULLS LAST, id ASC
      ${lockRows ? "FOR UPDATE" : ""}
    `
  );
  return rows;
}

async function fetchOrgCandidatesForEvents(client, orphanEvents, membershipTableExists) {
  const eventIds = orphanEvents.map((event) => stringifyId(event.id)).filter(Boolean);
  if (!eventIds.length) return new Map();

  const candidateMap = new Map();

  if (membershipTableExists) {
    const { rows } = await client.query(
      `
        SELECT DISTINCT
          e.id AS event_id,
          o.id AS organization_id,
          o.name AS organization_name,
          o.rep_user_id,
          'user_org_memberships' AS source
        FROM public.events e
        JOIN public.user_org_memberships m
          ON m.user_id::text = e.creator_user_id::text
         AND COALESCE(m.is_active, true) = true
        JOIN public.organizations o
          ON o.id = m.org_id
        WHERE e.id::text = ANY($1::text[])
          AND e.project_id IS NULL
      `,
      [eventIds]
    );
    rows.forEach((row) => addCandidate(candidateMap, row));
  }

  const { rows: legacyRows } = await client.query(
    `
      SELECT DISTINCT
        e.id AS event_id,
        o.id AS organization_id,
        o.name AS organization_name,
        o.rep_user_id,
        'userdata.org_id' AS source
      FROM public.events e
      JOIN public.userdata u
        ON u.id::text = e.creator_user_id::text
      JOIN public.organizations o
        ON o.id = u.org_id
      WHERE e.id::text = ANY($1::text[])
        AND e.project_id IS NULL
    `,
    [eventIds]
  );
  legacyRows.forEach((row) => addCandidate(candidateMap, row));

  return candidateMap;
}

async function fetchSkippedStructuredOrgIds(client) {
  const { rows } = await client.query(
    `
      SELECT id, name, 'organization_name' AS reason
      FROM public.organizations
      WHERE name = $1

      UNION

      SELECT o.id, o.name, 'cadborosaurus_project' AS reason
      FROM public.organizations o
      JOIN public.projects p
        ON p.organization_id = o.id
      WHERE p.name = $2

      ORDER BY id ASC
    `,
    [OARCA_ORG_NAME, OARCA_PROJECT_NAME]
  );

  const byId = new Map();
  for (const row of rows) {
    const orgId = Number(row.id);
    if (!byId.has(orgId)) {
      byId.set(orgId, {
        id: orgId,
        name: row.name || "",
        reasons: [],
      });
    }
    byId.get(orgId).reasons.push(row.reason);
  }
  return byId;
}

async function fetchLegacyProjectsByOrgId(client, orgIds) {
  if (!orgIds.length) return new Map();

  const { rows } = await client.query(
    `
      SELECT id, organization_id, name, created_at
      FROM public.projects
      WHERE organization_id = ANY($1::int[])
        AND name = $2
      ORDER BY organization_id ASC, created_at ASC, id ASC
    `,
    [orgIds, LEGACY_PROJECT_NAME]
  );

  const byOrgId = new Map();
  for (const row of rows) {
    const orgId = Number(row.organization_id);
    if (!byOrgId.has(orgId)) byOrgId.set(orgId, []);
    byOrgId.get(orgId).push(row);
  }
  return byOrgId;
}

function groupOrphansByOrganization(orphanEvents, candidateMap) {
  const groups = new Map();
  const warnings = [];

  for (const event of orphanEvents) {
    const eventId = stringifyId(event.id);
    const candidates = Array.from(candidateMap.get(eventId)?.values() || []);

    if (!candidates.length) {
      warnings.push({
        type: "missing_event_org",
        eventId,
        title: event.title || "",
        creatorUserId: event.creator_user_id == null ? null : String(event.creator_user_id),
      });
      continue;
    }

    if (candidates.length > 1) {
      warnings.push({
        type: "ambiguous_event_org",
        eventId,
        title: event.title || "",
        creatorUserId: event.creator_user_id == null ? null : String(event.creator_user_id),
        organizations: candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          sources: Array.from(candidate.sources).sort(),
        })),
      });
      continue;
    }

    const [org] = candidates;
    if (!groups.has(org.id)) {
      groups.set(org.id, {
        id: org.id,
        name: org.name,
        repUserId: org.repUserId,
        events: [],
      });
    }
    groups.get(org.id).events.push(event);
  }

  return { groups, warnings };
}

async function createLegacyProject(client, org) {
  const { rows: [project] = [] } = await client.query(
    `
      INSERT INTO public.projects (
        organization_id,
        program_id,
        name,
        description,
        lifecycle_stage,
        created_by_user_id
      )
      VALUES ($1, NULL, $2, $3, 'draft', $4)
      RETURNING id, organization_id, name
    `,
    [org.id, LEGACY_PROJECT_NAME, LEGACY_PROJECT_DESCRIPTION, org.repUserId]
  );
  return project;
}

async function updateOrphanEvents(client, eventIds, projectId) {
  const { rows } = await client.query(
    `
      UPDATE public.events
         SET project_id = $1,
             updated_at = NOW()
       WHERE project_id IS NULL
         AND id::text = ANY($2::text[])
      RETURNING id
    `,
    [projectId, eventIds]
  );
  return rows;
}

function printReport({
  dryRun,
  orphanCountBefore,
  organizationReports,
  warnings,
  orphanCountAfter,
  projectedOrphanCountAfter,
}) {
  console.log("");
  console.log(`Phase 2d Legacy events backfill ${dryRun ? "(dry-run)" : "(wet-run)"}`);
  console.log(`Total orphan events found before run: ${orphanCountBefore}`);
  console.log("");
  console.log("Per-organization report:");

  if (!organizationReports.length) {
    console.log("- No organizations had bucketable orphan events.");
  }

  for (const report of organizationReports) {
    const action = report.skipped
      ? `skipped: ${report.skipped}`
      : dryRun
        ? report.projectAction
        : `${report.projectAction}; events bucketed=${report.bucketedCount}`;
    console.log(
      `- ${report.orgName} (org id=${report.orgId}): orphan_events=${report.orphanEventCount}; ` +
        `project=${report.projectId || "none"}; ${action}`
    );
  }

  if (warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${JSON.stringify(warning)}`);
    }
  }

  console.log("");
  if (dryRun) {
    console.log(`Projected orphan events remaining after wet-run: ${projectedOrphanCountAfter}`);
    console.log(`Total orphan events remaining after run: ${orphanCountAfter} (dry-run, unchanged)`);
  } else {
    console.log(`Total orphan events remaining after run: ${orphanCountAfter}`);
  }
}

async function run() {
  const { dryRun } = parseArgs();
  const client = await pool.connect();
  const organizationReports = [];
  const warnings = [];
  let orphanCountBefore = 0;
  let orphanCountAfter = 0;
  let projectedOrphanCountAfter = 0;

  try {
    await client.query("BEGIN");

    const orphanEvents = await fetchOrphanEvents(client, { lockRows: !dryRun });
    orphanCountBefore = orphanEvents.length;

    const membershipTableExists = await hasUserOrgMembershipTable(client);
    const candidateMap = await fetchOrgCandidatesForEvents(client, orphanEvents, membershipTableExists);
    const structuredOrgIds = await fetchSkippedStructuredOrgIds(client);
    const { groups, warnings: groupingWarnings } = groupOrphansByOrganization(orphanEvents, candidateMap);
    warnings.push(...groupingWarnings);

    const orgIds = Array.from(groups.keys()).sort((a, b) => a - b);
    const legacyProjectsByOrgId = await fetchLegacyProjectsByOrgId(client, orgIds);
    let projectedBucketedCount = 0;

    for (const orgId of orgIds) {
      const org = groups.get(orgId);
      const eventIds = org.events.map((event) => stringifyId(event.id)).filter(Boolean);

      if (structuredOrgIds.has(orgId)) {
        organizationReports.push({
          orgId,
          orgName: org.name,
          orphanEventCount: eventIds.length,
          bucketedCount: 0,
          projectId: null,
          skipped: "already structured",
        });
        continue;
      }

      const legacyProjects = legacyProjectsByOrgId.get(orgId) || [];
      let project = legacyProjects[0] || null;
      let projectAction = project ? "using existing Legacy events project" : "would create Legacy events project";

      if (legacyProjects.length > 1) {
        warnings.push({
          type: "duplicate_legacy_projects",
          orgId,
          orgName: org.name,
          projectIds: legacyProjects.map((row) => stringifyId(row.id)),
          usingProjectId: stringifyId(project?.id),
        });
      }

      if (!project && org.repUserId == null) {
        warnings.push({
          type: "missing_rep_user_id",
          orgId,
          orgName: org.name,
          skippedEventIds: eventIds,
        });
        organizationReports.push({
          orgId,
          orgName: org.name,
          orphanEventCount: eventIds.length,
          bucketedCount: 0,
          projectId: null,
          skipped: "missing rep_user_id",
        });
        continue;
      }

      let bucketedCount = eventIds.length;
      if (!dryRun) {
        if (!project) {
          project = await createLegacyProject(client, org);
          projectAction = "created Legacy events project";
        } else {
          projectAction = "used existing Legacy events project";
        }

        const updatedEvents = await updateOrphanEvents(client, eventIds, project.id);
        bucketedCount = updatedEvents.length;
        if (bucketedCount !== eventIds.length) {
          warnings.push({
            type: "partial_event_update",
            orgId,
            orgName: org.name,
            expectedCount: eventIds.length,
            updatedCount: bucketedCount,
          });
        }
      } else if (project) {
        projectAction = "would use existing Legacy events project";
      }

      projectedBucketedCount += eventIds.length;
      organizationReports.push({
        orgId,
        orgName: org.name,
        orphanEventCount: eventIds.length,
        bucketedCount,
        projectId: stringifyId(project?.id),
        projectAction,
      });
    }

    if (dryRun) {
      projectedOrphanCountAfter = orphanCountBefore - projectedBucketedCount;
      orphanCountAfter = orphanCountBefore;
      await client.query("ROLLBACK");
    } else {
      const { rows: [remaining] = [] } = await client.query(
        "SELECT COUNT(*)::int AS count FROM public.events WHERE project_id IS NULL"
      );
      orphanCountAfter = Number(remaining?.count) || 0;
      await client.query("COMMIT");
    }

    printReport({
      dryRun,
      orphanCountBefore,
      organizationReports,
      warnings,
      orphanCountAfter,
      projectedOrphanCountAfter,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    console.error("Phase 2d Legacy events backfill failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
