const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PROJECT_LIFECYCLE_STAGES = new Set(["draft", "recruiting", "live", "closing_out", "reported"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN_UPDATE_KEYS = new Set([
  "id",
  "organization_id",
  "organizationId",
  "created_by_user_id",
  "createdByUserId",
  "created_at",
  "createdAt",
]);

const PROJECT_UPDATE_COLUMNS = {
  programId: "program_id",
  name: "name",
  description: "description",
  startDate: "start_date",
  endDate: "end_date",
  languages: "languages",
  partnerOrgIds: "partner_org_ids",
  beneficiaryCount: "beneficiary_count",
  beneficiaryEquityBreakdown: "beneficiary_equity_breakdown",
  lifecycleStage: "lifecycle_stage",
};

function normalizeUuid(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!UUID_RE.test(normalized)) {
    throw new Error(`${fieldName} must be a valid UUID`);
  }
  return normalized;
}

function isValidUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function normalizeNullableUuid(value, fieldName) {
  if (value === null) return null;
  return normalizeUuid(value, fieldName);
}

function normalizeRequiredInteger(value, fieldName) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return num;
}

function normalizeRequiredName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("name is required");
  }
  return value.trim();
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function normalizeTextArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => String(item));
}

function normalizeIntegerArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((item) => normalizeRequiredInteger(item, `${fieldName} item`));
}

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${fieldName} must be a valid date`);
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${fieldName} must be a valid date`);
    return normalized;
  }
  throw new Error(`${fieldName} must be a valid date`);
}

function normalizeLifecycleStage(value) {
  const normalized = String(value || "").trim();
  if (!PROJECT_LIFECYCLE_STAGES.has(normalized)) {
    throw new Error("lifecycleStage must be one of: draft, recruiting, live, closing_out, reported");
  }
  return normalized;
}

function normalizeNullableNonNegativeInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return num;
}

function normalizeJsonb(value) {
  if (value === undefined || value === null) return null;
  return value;
}

function normalizeLimit(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(num), 1), MAX_LIMIT);
}

function normalizeOffset(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(Math.trunc(num), 0);
}

function normalizeProjectUpdateValue(key, value) {
  if (key === "programId") return normalizeNullableUuid(value, key);
  if (key === "name") return normalizeRequiredName(value);
  if (key === "startDate" || key === "endDate") return normalizeDate(value, key);
  if (key === "languages") return normalizeTextArray(value, key);
  if (key === "partnerOrgIds") return normalizeIntegerArray(value, key);
  if (key === "beneficiaryCount") return normalizeNullableNonNegativeInteger(value, key);
  if (key === "beneficiaryEquityBreakdown") return normalizeJsonb(value);
  if (key === "lifecycleStage") return normalizeLifecycleStage(value);
  return normalizeOptionalText(value);
}

export async function listProjectsForOrg(
  runner,
  organizationId,
  options = {}
) {
  const { programId, lifecycleStage = null, limit = DEFAULT_LIMIT, offset = 0 } = options;
  const values = [normalizeRequiredInteger(organizationId, "organizationId")];
  const filters = ["organization_id = $1"];

  if (Object.prototype.hasOwnProperty.call(options, "programId")) {
    if (programId === null) {
      filters.push("program_id IS NULL");
    } else {
      values.push(normalizeUuid(programId, "programId"));
      filters.push(`program_id = $${values.length}`);
    }
  }

  if (lifecycleStage !== null && lifecycleStage !== undefined) {
    values.push(normalizeLifecycleStage(lifecycleStage));
    filters.push(`lifecycle_stage = $${values.length}`);
  }

  values.push(normalizeLimit(limit));
  const limitParam = values.length;
  values.push(normalizeOffset(offset));
  const offsetParam = values.length;

  const { rows } = await runner.query(
    `
      SELECT *
        FROM public.projects
       WHERE ${filters.join(" AND ")}
       ORDER BY start_date DESC NULLS LAST, created_at DESC
       LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    values
  );

  return rows;
}

export async function listProjectsForProgram(runner, programId) {
  const id = normalizeUuid(programId, "programId");

  const { rows } = await runner.query(
    `
      SELECT *
        FROM public.projects
       WHERE program_id = $1
       ORDER BY start_date ASC NULLS LAST, created_at ASC
    `,
    [id]
  );

  return rows;
}

export async function getProjectById(runner, projectId) {
  if (!isValidUuid(projectId)) return null;

  const { rows } = await runner.query(
    `
      SELECT *
        FROM public.projects
       WHERE id = $1
       LIMIT 1
    `,
    [String(projectId).trim()]
  );

  return rows[0] || null;
}

export async function createProject(
  runner,
  {
    organizationId,
    programId = null,
    name,
    description = null,
    startDate = null,
    endDate = null,
    languages = [],
    partnerOrgIds = [],
    createdByUserId,
  } = {}
) {
  const { rows } = await runner.query(
    `
      INSERT INTO public.projects (
        organization_id,
        program_id,
        name,
        description,
        start_date,
        end_date,
        languages,
        partner_org_ids,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      normalizeRequiredInteger(organizationId, "organizationId"),
      programId === null || programId === undefined ? null : normalizeUuid(programId, "programId"),
      normalizeRequiredName(name),
      normalizeOptionalText(description),
      normalizeDate(startDate, "startDate"),
      normalizeDate(endDate, "endDate"),
      normalizeTextArray(languages, "languages"),
      normalizeIntegerArray(partnerOrgIds, "partnerOrgIds"),
      normalizeRequiredInteger(createdByUserId, "createdByUserId"),
    ]
  );

  return rows[0];
}

export async function updateProject(runner, projectId, updates = {}) {
  const id = normalizeUuid(projectId, "projectId");
  const updateKeys = Object.keys(updates || {});

  for (const key of updateKeys) {
    if (FORBIDDEN_UPDATE_KEYS.has(key)) {
      throw new Error(`${key} cannot be updated`);
    }
    if (!Object.prototype.hasOwnProperty.call(PROJECT_UPDATE_COLUMNS, key)) {
      throw new Error(`${key} is not an allowed project update field`);
    }
  }

  if (!updateKeys.length) {
    throw new Error("No project updates provided");
  }

  const values = [];
  const assignments = updateKeys.map((key) => {
    values.push(normalizeProjectUpdateValue(key, updates[key]));
    return `${PROJECT_UPDATE_COLUMNS[key]} = $${values.length}`;
  });

  values.push(id);
  const idParam = values.length;

  const { rows } = await runner.query(
    `
      UPDATE public.projects
         SET ${assignments.join(", ")}
       WHERE id = $${idParam}
      RETURNING *
    `,
    values
  );

  return rows[0] || null;
}

export async function transitionLifecycleStage(runner, projectId, newStage) {
  const id = normalizeUuid(projectId, "projectId");
  const lifecycleStage = normalizeLifecycleStage(newStage);

  const { rows } = await runner.query(
    `
      UPDATE public.projects
         SET lifecycle_stage = $1
       WHERE id = $2
      RETURNING *
    `,
    [lifecycleStage, id]
  );

  return rows[0] || null;
}

export async function getProjectMetrics(runner, projectId) {
  const id = normalizeUuid(projectId, "projectId");

  const { rows } = await runner.query(
    `
      WITH project_row AS (
        SELECT id
          FROM public.projects
         WHERE id = $1
      )
      SELECT
        EXISTS (SELECT 1 FROM project_row) AS project_exists,
        COALESCE((SELECT COUNT(*)::int FROM public.events e WHERE e.project_id = $1), 0) AS total_events,
        COALESCE((SELECT COUNT(*)::int FROM public.event_roles er WHERE er.project_id = $1), 0) AS total_roles,
        COALESCE((
          SELECT COUNT(*)::int
            FROM public.event_rsvps r
            JOIN public.events e ON e.id = r.event_id
           WHERE e.project_id = $1
             AND r.status = 'accepted'
        ), 0) AS total_rsvps_accepted,
        COALESCE((
          SELECT COUNT(*)::int
            FROM public.event_rsvps r
            JOIN public.events e ON e.id = r.event_id
           WHERE e.project_id = $1
             AND r.verification_status = 'verified'
        ), 0) AS total_rsvps_verified,
        COALESCE((
          SELECT SUM(COALESCE(r.attended_minutes, 0))::int
            FROM public.event_rsvps r
            JOIN public.events e ON e.id = r.event_id
           WHERE e.project_id = $1
             AND r.verification_status = 'verified'
        ), 0) AS total_verified_minutes,
        COALESCE((
          SELECT ROUND((SUM(COALESCE(r.attended_minutes, 0)) / 60.0)::numeric, 1)::float
            FROM public.event_rsvps r
            JOIN public.events e ON e.id = r.event_id
           WHERE e.project_id = $1
             AND r.verification_status = 'verified'
        ), 0.0) AS total_verified_hours,
        COALESCE((
          SELECT COUNT(DISTINCT r.attendee_user_id)::int
            FROM public.event_rsvps r
            JOIN public.events e ON e.id = r.event_id
           WHERE e.project_id = $1
             AND r.verification_status = 'verified'
        ), 0) AS unique_volunteers
    `,
    [id]
  );

  const metrics = rows[0];
  if (!metrics?.project_exists) return null;

  delete metrics.project_exists;
  return metrics;
}

export async function deleteProject(runner, projectId) {
  const id = normalizeUuid(projectId, "projectId");

  const { rows: referenceRows } = await runner.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM public.events WHERE project_id = $1) AS events_count,
        (SELECT COUNT(*)::int FROM public.event_roles WHERE project_id = $1) AS roles_count
    `,
    [id]
  );

  const references = referenceRows[0] || {};
  if (Number(references.events_count) > 0 || Number(references.roles_count) > 0) {
    throw new Error("Cannot delete project while events or event roles reference it");
  }

  const { rowCount } = await runner.query(
    `
      DELETE FROM public.projects
       WHERE id = $1
    `,
    [id]
  );

  return { deleted: rowCount > 0 };
}
