const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  duplicate_conflict: 409,
  system_error: 500,
});

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textOrNull(value) {
  return value == null ? null : String(value);
}

function rowTimestamp(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

function sourceDto(row) {
  return {
    requirement_source_id: textOrNull(row.requirement_source_id),
    source_type: row.source_type,
    source_code: row.source_code,
    source_name: row.source_name,
    organization_id: row.organization_id || null,
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: rowTimestamp(row.created_at),
  };
}

function frameworkDto(row) {
  return {
    requirement_framework_version_id: textOrNull(row.requirement_framework_version_id),
    requirement_source_id: textOrNull(row.requirement_source_id),
    framework_code: row.framework_code,
    framework_name: row.framework_name,
    version_label: row.version_label,
    framework_status: row.framework_status,
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: rowTimestamp(row.created_at),
  };
}

function setDto(row) {
  return {
    requirement_set_id: textOrNull(row.requirement_set_id),
    requirement_framework_version_id: textOrNull(row.requirement_framework_version_id),
    set_key: row.set_key,
    set_name: row.set_name,
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: rowTimestamp(row.created_at),
  };
}

function requirementDto(row) {
  return {
    requirement_id: textOrNull(row.requirement_id),
    requirement_set_id: textOrNull(row.requirement_set_id),
    requirement_key: row.requirement_key,
    requirement_label: row.requirement_label,
    requirement_description: row.requirement_description || null,
    display_order: Number(row.display_order),
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: rowTimestamp(row.created_at),
  };
}

function exactSourceMatches(row, source) {
  return row?.source_name === source.source_name && row?.organization_id == null;
}

function exactFrameworkMatches(row, framework) {
  return (
    row?.framework_name === framework.framework_name &&
    row?.framework_status === framework.framework_status
  );
}

function exactSetMatches(row, requirementSet) {
  return row?.set_name === requirementSet.set_name;
}

function exactRequirementMatches(row, requirement) {
  return (
    row?.requirement_label === requirement.requirement_label &&
    (row?.requirement_description || null) === (requirement.requirement_description || null) &&
    Number(row?.display_order) === requirement.display_order
  );
}

async function selectSource(tx, source) {
  const { rows } = await tx.query(
    `SELECT requirement_source_id::text AS requirement_source_id,
            source_type, source_code, source_name, organization_id::text AS organization_id,
            created_by::text AS created_by, created_by_type, created_at
       FROM kai.requirement_sources
      WHERE organization_id IS NULL
        AND source_type = $1
        AND source_code = $2
      LIMIT 1`,
    [source.source_type, source.source_code],
  );
  return rows[0] || null;
}

async function insertSource(tx, source, actorUserId) {
  const { rows } = await tx.query(
    `INSERT INTO kai.requirement_sources (
       source_type, source_code, source_name, organization_id, created_by, created_by_type
     ) VALUES ($1, $2, $3, NULL, $4::uuid, 'human')
     RETURNING requirement_source_id::text AS requirement_source_id,
               source_type, source_code, source_name, organization_id::text AS organization_id,
               created_by::text AS created_by, created_by_type, created_at`,
    [source.source_type, source.source_code, source.source_name, actorUserId],
  );
  return rows[0] || null;
}

async function selectFramework(tx, sourceId, framework) {
  const { rows } = await tx.query(
    `SELECT requirement_framework_version_id::text AS requirement_framework_version_id,
            requirement_source_id::text AS requirement_source_id,
            framework_code, framework_name, version_label, framework_status,
            created_by::text AS created_by, created_by_type, created_at
       FROM kai.requirement_framework_versions
      WHERE requirement_source_id = $1::uuid
        AND framework_code = $2
        AND version_label = $3
      LIMIT 1`,
    [sourceId, framework.framework_code, framework.version_label],
  );
  return rows[0] || null;
}

async function insertFramework(tx, sourceId, framework, actorUserId) {
  const { rows } = await tx.query(
    `INSERT INTO kai.requirement_framework_versions (
       requirement_source_id, framework_code, framework_name, version_label,
       framework_status, created_by, created_by_type
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, 'human')
     RETURNING requirement_framework_version_id::text AS requirement_framework_version_id,
               requirement_source_id::text AS requirement_source_id,
               framework_code, framework_name, version_label, framework_status,
               created_by::text AS created_by, created_by_type, created_at`,
    [
      sourceId,
      framework.framework_code,
      framework.framework_name,
      framework.version_label,
      framework.framework_status,
      actorUserId,
    ],
  );
  return rows[0] || null;
}

async function selectSet(tx, frameworkId, requirementSet) {
  const { rows } = await tx.query(
    `SELECT requirement_set_id::text AS requirement_set_id,
            requirement_framework_version_id::text AS requirement_framework_version_id,
            set_key, set_name, created_by::text AS created_by, created_by_type, created_at
       FROM kai.requirement_sets
      WHERE requirement_framework_version_id = $1::uuid
        AND set_key = $2
      LIMIT 1`,
    [frameworkId, requirementSet.set_key],
  );
  return rows[0] || null;
}

async function insertSet(tx, frameworkId, requirementSet, actorUserId) {
  const { rows } = await tx.query(
    `INSERT INTO kai.requirement_sets (
       requirement_framework_version_id, set_key, set_name, created_by, created_by_type
     ) VALUES ($1::uuid, $2, $3, $4::uuid, 'human')
     RETURNING requirement_set_id::text AS requirement_set_id,
               requirement_framework_version_id::text AS requirement_framework_version_id,
               set_key, set_name, created_by::text AS created_by, created_by_type, created_at`,
    [frameworkId, requirementSet.set_key, requirementSet.set_name, actorUserId],
  );
  return rows[0] || null;
}

async function selectRequirement(tx, requirementSetId, requirement) {
  const { rows } = await tx.query(
    `SELECT requirement_id::text AS requirement_id,
            requirement_set_id::text AS requirement_set_id,
            requirement_key, requirement_label, requirement_description, display_order,
            created_by::text AS created_by, created_by_type, created_at
       FROM kai.requirements
      WHERE requirement_set_id = $1::uuid
        AND requirement_key = $2
      LIMIT 1`,
    [requirementSetId, requirement.requirement_key],
  );
  return rows[0] || null;
}

async function insertRequirement(tx, requirementSetId, requirement, actorUserId) {
  const { rows } = await tx.query(
    `INSERT INTO kai.requirements (
       requirement_set_id, requirement_key, requirement_label,
       requirement_description, display_order, created_by, created_by_type
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, 'human')
     RETURNING requirement_id::text AS requirement_id,
               requirement_set_id::text AS requirement_set_id,
               requirement_key, requirement_label, requirement_description, display_order,
               created_by::text AS created_by, created_by_type, created_at`,
    [
      requirementSetId,
      requirement.requirement_key,
      requirement.requirement_label,
      requirement.requirement_description,
      requirement.display_order,
      actorUserId,
    ],
  );
  return rows[0] || null;
}

function inputIsValid(input) {
  return (
    isPlainObject(input) &&
    isPlainObject(input.source) &&
    isPlainObject(input.framework) &&
    isPlainObject(input.requirementSet) &&
    Array.isArray(input.requirements) &&
    typeof input.actorUserId === "string" &&
    input.actorUserId.length > 0
  );
}

export function createPostgresExternalRequirementSetRegistrationRepository() {
  return Object.freeze({
    async registerExternalRequirementSet(input, tx) {
      if (!inputIsValid(input) || !tx || typeof tx.query !== "function") {
        return failure("validation_blocker");
      }

      const { source, framework, requirementSet, requirements, actorUserId } = input;
      const inserted = {
        source: false,
        framework: false,
        requirement_set: false,
        requirements: 0,
      };

      try {
        let sourceRow = await selectSource(tx, source);
        if (sourceRow && !exactSourceMatches(sourceRow, source)) return failure("duplicate_conflict");
        if (!sourceRow) {
          sourceRow = await insertSource(tx, source, actorUserId);
          inserted.source = true;
        }

        let frameworkRow = await selectFramework(tx, sourceRow.requirement_source_id, framework);
        if (frameworkRow && !exactFrameworkMatches(frameworkRow, framework)) return failure("duplicate_conflict");
        if (!frameworkRow) {
          frameworkRow = await insertFramework(tx, sourceRow.requirement_source_id, framework, actorUserId);
          inserted.framework = true;
        }

        let setRow = await selectSet(tx, frameworkRow.requirement_framework_version_id, requirementSet);
        if (setRow && !exactSetMatches(setRow, requirementSet)) return failure("duplicate_conflict");
        if (!setRow) {
          setRow = await insertSet(tx, frameworkRow.requirement_framework_version_id, requirementSet, actorUserId);
          inserted.requirement_set = true;
        }

        const requirementRows = [];
        for (const requirement of requirements) {
          let requirementRow = await selectRequirement(tx, setRow.requirement_set_id, requirement);
          if (requirementRow && !exactRequirementMatches(requirementRow, requirement)) {
            return failure("duplicate_conflict");
          }
          if (!requirementRow) {
            requirementRow = await insertRequirement(tx, setRow.requirement_set_id, requirement, actorUserId);
            inserted.requirements += 1;
          }
          requirementRows.push(requirementRow);
        }

        const replayed = !inserted.source &&
          !inserted.framework &&
          !inserted.requirement_set &&
          inserted.requirements === 0;

        return success({
          replayed,
          inserted,
          requirement_source: sourceDto(sourceRow),
          requirement_framework_version: frameworkDto(frameworkRow),
          requirement_set: setDto(setRow),
          requirements: requirementRows.map(requirementDto),
        });
      } catch (error) {
        if (error?.code === "23505") return failure("duplicate_conflict");
        if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
        return failure("system_error");
      }
    },
  });
}
