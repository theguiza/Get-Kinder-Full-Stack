import pool from "../Backend/db/pg.js";

const CADBOROSAURUS_PROJECT_NAME = "Cadborosaurus Coastal Endurance Regatta";
const EXPECTED_CADBOROSAURUS_EVENT_COUNT = 16;
const ROLE_TITLE_SEPARATOR = " | ";
const FILLED_STATUSES = ["accepted", "checked_in"];

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
  };
}

function stringifyId(value) {
  return value == null ? null : String(value);
}

function truncateId(value) {
  return stringifyId(value)?.slice(0, 8) || "";
}

function deriveRoleTitle(eventTitle, warnings) {
  const title = eventTitle || "";
  const separatorIndex = title.indexOf(ROLE_TITLE_SEPARATOR);
  if (separatorIndex === -1) return title;

  const derived = title.slice(0, separatorIndex).trim();
  if (!derived) {
    warnings.push("derived role title was empty; used full event title");
    return title;
  }
  return derived;
}

function deriveSpotsNeeded(capacity, warnings) {
  if (capacity == null) {
    warnings.push("capacity was NULL; defaulted spots_needed to 1");
    return 1;
  }
  return Number(capacity);
}

async function fetchCadborosaurusProject(client) {
  const { rows } = await client.query(
    `
      SELECT id, name
      FROM public.projects
      WHERE name = $1
      ORDER BY created_at ASC, id ASC
    `,
    [CADBOROSAURUS_PROJECT_NAME]
  );

  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly 1 project named "${CADBOROSAURUS_PROJECT_NAME}", found ${rows.length}. Aborting.`
    );
  }

  return rows[0];
}

async function fetchCadborosaurusEvents(client, projectId, { lockRows = false } = {}) {
  const { rows } = await client.query(
    `
      SELECT
        id,
        title,
        capacity,
        description,
        requirements,
        safety_notes
      FROM public.events
      WHERE project_id = $1
      ORDER BY start_at ASC NULLS LAST, title ASC, id ASC
      ${lockRows ? "FOR UPDATE" : ""}
    `,
    [projectId]
  );
  return rows;
}

async function assertNoExistingRoles(client, eventIds) {
  if (!eventIds.length) return;

  const { rows } = await client.query(
    `
      SELECT event_id, COUNT(*)::int AS role_count
      FROM public.event_roles
      WHERE event_id = ANY($1::uuid[])
      GROUP BY event_id
      ORDER BY event_id ASC
    `,
    [eventIds]
  );

  if (rows.length) {
    throw new Error(
      "Roles already exist for Cadborosaurus events. Refusing to re-run to avoid duplicates. " +
        "To redo, manually delete the existing roles and re-run."
    );
  }
}

async function createRole(client, event, projectId, roleTitle, spotsNeeded) {
  const { rows: [role] = [] } = await client.query(
    `
      INSERT INTO public.event_roles (
        event_id,
        project_id,
        title,
        description,
        tier,
        spots_needed,
        spots_filled,
        requirements,
        safety_notes,
        created_at
      )
      VALUES ($1, $2, $3, $4, 'standard', $5, 0, $6, $7, NOW())
      RETURNING id
    `,
    [
      event.id,
      projectId,
      roleTitle,
      event.description || null,
      spotsNeeded,
      event.requirements || null,
      event.safety_notes || null,
    ]
  );
  return role;
}

async function repointRsvps(client, eventId, roleId) {
  const { rowCount } = await client.query(
    `
      UPDATE public.event_rsvps
      SET role_id = $1
      WHERE event_id = $2
    `,
    [roleId, eventId]
  );
  return rowCount;
}

async function countFilledRsvps(client, roleId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM public.event_rsvps
      WHERE role_id = $1
        AND status = ANY($2::text[])
        AND no_show = false
    `,
    [roleId, FILLED_STATUSES]
  );
  return Number(row?.count) || 0;
}

async function updateSpotsFilled(client, roleId, spotsFilled) {
  await client.query(
    `
      UPDATE public.event_roles
      SET spots_filled = $1
      WHERE id = $2
    `,
    [spotsFilled, roleId]
  );
}

function printReport({ dryRun, project, reports }) {
  console.log("");
  console.log(`Phase 2e-1 Cadborosaurus role backfill ${dryRun ? "(dry-run)" : "(wet-run)"}`);
  console.log(`Project: ${project.name} (${project.id})`);
  console.log(`Events to process: ${reports.length}`);
  if (reports.length !== EXPECTED_CADBOROSAURUS_EVENT_COUNT) {
    console.log(
      `WARNING: Expected ${EXPECTED_CADBOROSAURUS_EVENT_COUNT} Cadborosaurus events, found ${reports.length}.`
    );
  }
  console.log("");
  console.log("Per-event report:");

  if (!reports.length) {
    console.log("- No Cadborosaurus events found.");
  }

  for (const report of reports) {
    const warnings = report.warnings.length ? `; warnings=${report.warnings.join("; ")}` : "";
    console.log(
      `- ${report.eventId}: ${report.originalTitle} | role="${report.roleTitle}" | ` +
        `capacity ${report.capacity ?? "NULL"} -> spots_needed ${report.spotsNeeded} | ` +
        `rsvps ${report.rsvpCount} -> spots_filled ${report.spotsFilled}${warnings}`
    );
  }

  console.log("");
  console.log(dryRun ? "Dry-run complete; rolled back all changes." : "Wet-run complete; committed changes.");
}

async function run() {
  const { dryRun } = parseArgs();
  const client = await pool.connect();
  const reports = [];

  try {
    await client.query("BEGIN");

    const project = await fetchCadborosaurusProject(client);
    const events = await fetchCadborosaurusEvents(client, project.id, { lockRows: !dryRun });
    if (!dryRun && events.length !== EXPECTED_CADBOROSAURUS_EVENT_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_CADBOROSAURUS_EVENT_COUNT} Cadborosaurus events, found ${events.length}. ` +
          "Refusing wet-run until the project event set is corrected."
      );
    }
    const eventIds = events.map((event) => event.id);
    await assertNoExistingRoles(client, eventIds);

    for (const event of events) {
      const warnings = [];
      const roleTitle = deriveRoleTitle(event.title, warnings);
      const spotsNeeded = deriveSpotsNeeded(event.capacity, warnings);
      const role = await createRole(client, event, project.id, roleTitle, spotsNeeded);
      const rsvpCount = await repointRsvps(client, event.id, role.id);
      const spotsFilled = await countFilledRsvps(client, role.id);

      if (spotsFilled > spotsNeeded) {
        warnings.push(
          `spots_filled ${spotsFilled} exceeds spots_needed ${spotsNeeded}; database constraint will reject this update`
        );
      }

      await updateSpotsFilled(client, role.id, spotsFilled);

      reports.push({
        eventId: truncateId(event.id),
        originalTitle: event.title,
        roleTitle,
        capacity: event.capacity,
        spotsNeeded,
        rsvpCount,
        spotsFilled,
        warnings,
      });
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }

    printReport({ dryRun, project, reports });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError);
    }
    console.error("Phase 2e-1 Cadborosaurus role backfill failed:", error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
