const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PROGRAM_STATUSES = new Set(["active", "completed", "archived"]);
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

const PROGRAM_UPDATE_COLUMNS = {
  name: "name",
  description: "description",
  funder: "funder",
  reportingPeriodStart: "reporting_period_start",
  reportingPeriodEnd: "reporting_period_end",
  intendedEquityGroups: "intended_equity_groups",
  proposalText: "proposal_text",
  status: "status",
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

function normalizeStatus(value) {
  const normalized = String(value || "").trim();
  if (!PROGRAM_STATUSES.has(normalized)) {
    throw new Error("status must be one of: active, completed, archived");
  }
  return normalized;
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

function normalizeProgramUpdateValue(key, value) {
  if (key === "name") return normalizeRequiredName(value);
  if (key === "intendedEquityGroups") return normalizeTextArray(value, key);
  if (key === "reportingPeriodStart" || key === "reportingPeriodEnd") return normalizeDate(value, key);
  if (key === "status") return normalizeStatus(value);
  return normalizeOptionalText(value);
}

export async function listProgramsForOrg(runner, organizationId, { status = null, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
  const orgId = normalizeRequiredInteger(organizationId, "organizationId");
  const values = [orgId];
  const filters = ["organization_id = $1"];

  if (status !== null && status !== undefined) {
    values.push(normalizeStatus(status));
    filters.push(`status = $${values.length}`);
  }

  values.push(normalizeLimit(limit));
  const limitParam = values.length;
  values.push(normalizeOffset(offset));
  const offsetParam = values.length;

  const { rows } = await runner.query(
    `
      SELECT *
        FROM public.programs
       WHERE ${filters.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${limitParam}
      OFFSET $${offsetParam}
    `,
    values
  );

  return rows;
}

export async function getProgramById(runner, programId) {
  if (!isValidUuid(programId)) return null;

  const { rows } = await runner.query(
    `
      SELECT *
        FROM public.programs
       WHERE id = $1
       LIMIT 1
    `,
    [String(programId).trim()]
  );

  return rows[0] || null;
}

export async function createProgram(
  runner,
  {
    organizationId,
    name,
    description = null,
    funder = null,
    reportingPeriodStart = null,
    reportingPeriodEnd = null,
    intendedEquityGroups = [],
    proposalText = null,
    createdByUserId,
  } = {}
) {
  const { rows } = await runner.query(
    `
      INSERT INTO public.programs (
        organization_id,
        name,
        description,
        funder,
        reporting_period_start,
        reporting_period_end,
        intended_equity_groups,
        proposal_text,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `,
    [
      normalizeRequiredInteger(organizationId, "organizationId"),
      normalizeRequiredName(name),
      normalizeOptionalText(description),
      normalizeOptionalText(funder),
      normalizeDate(reportingPeriodStart, "reportingPeriodStart"),
      normalizeDate(reportingPeriodEnd, "reportingPeriodEnd"),
      normalizeTextArray(intendedEquityGroups, "intendedEquityGroups"),
      normalizeOptionalText(proposalText),
      normalizeRequiredInteger(createdByUserId, "createdByUserId"),
    ]
  );

  return rows[0];
}

export async function updateProgram(runner, programId, updates = {}) {
  const id = normalizeUuid(programId, "programId");
  const updateKeys = Object.keys(updates || {});

  for (const key of updateKeys) {
    if (FORBIDDEN_UPDATE_KEYS.has(key)) {
      throw new Error(`${key} cannot be updated`);
    }
    if (!Object.prototype.hasOwnProperty.call(PROGRAM_UPDATE_COLUMNS, key)) {
      throw new Error(`${key} is not an allowed program update field`);
    }
  }

  if (!updateKeys.length) {
    throw new Error("No program updates provided");
  }

  const values = [];
  const assignments = updateKeys.map((key) => {
    values.push(normalizeProgramUpdateValue(key, updates[key]));
    return `${PROGRAM_UPDATE_COLUMNS[key]} = $${values.length}`;
  });

  values.push(id);
  const idParam = values.length;

  const { rows } = await runner.query(
    `
      UPDATE public.programs
         SET ${assignments.join(", ")}
       WHERE id = $${idParam}
      RETURNING *
    `,
    values
  );

  return rows[0] || null;
}

export async function archiveProgram(runner, programId) {
  return updateProgram(runner, programId, { status: "archived" });
}

export async function deleteProgram(runner, programId) {
  const id = normalizeUuid(programId, "programId");

  const { rows: linkedProjectRows } = await runner.query(
    `
      SELECT COUNT(*)::int AS count
        FROM public.projects
       WHERE program_id = $1
    `,
    [id]
  );

  if (Number(linkedProjectRows[0]?.count) > 0) {
    throw new Error("Cannot delete program while projects are linked");
  }

  const { rowCount } = await runner.query(
    `
      DELETE FROM public.programs
       WHERE id = $1
    `,
    [id]
  );

  return { deleted: rowCount > 0 };
}
