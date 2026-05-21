import pool from "../Backend/db/pg.js";
import { isSeatTakingStatus, promoteWaitlistedAttendees } from "./waitlistService.js";

const RSVP_ACTION_TO_STATUS = new Map([
  ["accept", "accepted"],
  ["decline", "declined"],
]);

const columnExistsCache = new Map();
const tableExistsCache = new Map();

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function eventIsOwnedByHostScope(eventRow, hostUserIds = []) {
  if (!eventRow?.creator_user_id) return false;
  const normalizedHostUserIds = Array.isArray(hostUserIds)
    ? hostUserIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return normalizedHostUserIds.includes(String(eventRow.creator_user_id));
}

async function tableExists(tableName) {
  const key = String(tableName || "").toLowerCase();
  if (!key) return false;
  if (tableExistsCache.has(key)) return tableExistsCache.get(key);

  const { rows } = await pool.query("SELECT to_regclass($1) AS table_name", [`public.${key}`]);
  const exists = Boolean(rows?.[0]?.table_name);
  tableExistsCache.set(key, exists);
  return exists;
}

async function columnExists(tableName, columnName) {
  const table = String(tableName || "").toLowerCase();
  const column = String(columnName || "").toLowerCase();
  const key = `${table}.${column}`;
  if (!table || !column) return false;
  if (columnExistsCache.has(key)) return columnExistsCache.get(key);

  const { rows } = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
      ) AS exists
    `,
    [table, column]
  );

  const exists = Boolean(rows?.[0]?.exists);
  columnExistsCache.set(key, exists);
  return exists;
}

async function validateRoleAssignment({ client, eventId, roleId }) {
  const [supportsRoleId, hasRolesTable] = await Promise.all([
    columnExists("event_rsvps", "role_id"),
    tableExists("event_roles"),
  ]);
  if (!supportsRoleId || !hasRolesTable) {
    return {
      error: {
        statusCode: 400,
        code: "invalid_role_id",
        error: "This event does not support role-specific RSVPs.",
      },
    };
  }

  const { rows: eventRoles } = await client.query(
    `
      SELECT id, event_id, spots_needed, spots_filled
      FROM event_roles
      WHERE event_id = $1
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
    `,
    [eventId]
  );
  if (!eventRoles.length) {
    return {
      error: {
        statusCode: 400,
        code: "legacy_event_signups_closed",
        error: "This event is not currently accepting new signups. Contact the organizer if you believe this is an error.",
      },
    };
  }

  const normalizedRoleId = normalizeString(roleId);
  if (!normalizedRoleId) {
    if (eventRoles.length === 1) {
      // Single-role events can infer the role to keep the volunteer RSVP flow lightweight.
      return { role: eventRoles[0], roleId: String(eventRoles[0].id) };
    }
    return {
      error: {
        statusCode: 400,
        code: "role_id_required",
        error: "This event has multiple roles. Please specify which role you're signing up for.",
      },
    };
  }

  const matchingRole = eventRoles.find((row) => String(row.id) === normalizedRoleId);
  if (matchingRole) {
    return { role: matchingRole, roleId: normalizedRoleId };
  }

  const { rows: [roleRow] } = await client.query(
    `
      SELECT id, event_id, spots_needed, spots_filled
      FROM event_roles
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [normalizedRoleId]
  );
  if (!roleRow) {
    return {
      error: {
        statusCode: 404,
        code: "role_not_found",
        error: "Role not found.",
      },
    };
  }
  if (String(roleRow.event_id) !== String(eventId)) {
    return {
      error: {
        statusCode: 400,
        code: "invalid_role_id",
        error: "Role does not belong to this event.",
      },
    };
  }

  return { role: roleRow, roleId: normalizedRoleId };
}

export function resolveAcceptedRsvpStatus(eventRow, acceptedCount) {
  const capacity = Number(eventRow?.capacity);
  const hasCapacityLimit = Number.isFinite(capacity) && capacity > 0;
  if (!hasCapacityLimit) {
    return { status: "pending" };
  }
  if (acceptedCount >= capacity) {
    if (eventRow?.waitlist_enabled === false) {
      return {
        error: "EVENT_FULL",
        message: "This event is full and waitlist is disabled.",
      };
    }
    return {
      status: "waitlisted",
      message: "Event is full. You have been added to the waitlist.",
    };
  }
  return { status: "pending" };
}

export async function getEventRsvpSnapshot(eventId, userId, { runner = pool } = {}) {
  const [{ rows: [viewer] }, { rows: [counts] }] = await Promise.all([
    runner.query(
      `SELECT status, check_in_method, checked_in_at
         FROM event_rsvps
        WHERE event_id=$1 AND attendee_user_id=$2
        LIMIT 1`,
      [eventId, userId]
    ),
    runner.query(
      `SELECT
          COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted
         FROM event_rsvps r
         JOIN events e ON e.id = r.event_id
        WHERE r.event_id=$1
          AND r.attendee_user_id::text <> e.creator_user_id::text`,
      [eventId]
    ),
  ]);

  return {
    viewer,
    counts: {
      accepted: Number(counts?.accepted) || 0,
    },
  };
}

function mapServiceError({ statusCode, code = null, error }) {
  return {
    ok: false,
    statusCode,
    ...(code ? { code } : {}),
    error,
  };
}

function shouldCountRoleSignup(status, noShow = false) {
  const normalized = normalizeString(status).toLowerCase();
  if (noShow === true) return false;
  return normalized === "pending" || normalized === "accepted" || normalized === "checked_in" || normalized === "waitlisted";
}

async function incrementRoleSignup(client, roleId) {
  if (!roleId) return null;
  const { rows: [row] = [] } = await client.query(
    "UPDATE event_roles SET spots_filled = spots_filled + 1 WHERE id = $1 RETURNING spots_filled",
    [roleId]
  );
  return row?.spots_filled ?? null;
}

async function decrementRoleSignup(client, roleId) {
  if (!roleId) return null;
  const { rows: [row] = [] } = await client.query(
    "UPDATE event_roles SET spots_filled = GREATEST(spots_filled - 1, 0) WHERE id = $1 RETURNING spots_filled",
    [roleId]
  );
  return row?.spots_filled ?? null;
}

export async function applyEventRsvpAction({
  eventId,
  attendeeId,
  action,
  hostUserIds = [],
  roleId = null,
  reason = null,
  requireExistingForDecline = false,
}) {
  const normalizedEventId = normalizeString(eventId);
  const normalizedAttendeeId = String(attendeeId || "").trim();
  const normalizedAction = normalizeString(action).toLowerCase();
  let targetStatus = RSVP_ACTION_TO_STATUS.get(normalizedAction);

  if (!normalizedEventId) {
    return mapServiceError({ statusCode: 400, error: "Event not found" });
  }
  if (!normalizedAttendeeId) {
    return mapServiceError({ statusCode: 401, error: "Unauthorized" });
  }
  if (!targetStatus) {
    return mapServiceError({ statusCode: 400, error: "Invalid RSVP action" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: [eventRow] } = await client.query(
      `SELECT id, creator_user_id, title, start_at, status, capacity, waitlist_enabled
         FROM events
        WHERE id=$1
        LIMIT 1
        FOR UPDATE`,
      [normalizedEventId]
    );
    if (!eventRow) {
      await client.query("ROLLBACK");
      return mapServiceError({ statusCode: 404, error: "Event not found" });
    }
    if (eventIsOwnedByHostScope(eventRow, hostUserIds)) {
      await client.query("ROLLBACK");
      return mapServiceError({ statusCode: 400, error: "Hosts do not need to RSVP" });
    }
    if (eventRow.status === "cancelled") {
      await client.query("ROLLBACK");
      return mapServiceError({ statusCode: 409, error: "Event has been cancelled" });
    }

    let roleValidation = { roleId: null, role: null };
    if (normalizedAction === "accept") {
      roleValidation = await validateRoleAssignment({
        client,
        eventId: normalizedEventId,
        roleId,
      });
      if (roleValidation.error) {
        await client.query("ROLLBACK");
        return mapServiceError(roleValidation.error);
      }
    }
    const hasNoShow = await columnExists("event_rsvps", "no_show");
    const { rows: [existingRsvp] } = await client.query(
      `SELECT status, role_id${hasNoShow ? ", no_show" : ", FALSE AS no_show"}
         FROM event_rsvps
        WHERE event_id=$1
          AND attendee_user_id=$2
        LIMIT 1
        FOR UPDATE`,
      [normalizedEventId, normalizedAttendeeId]
    );
    const existingStatus = normalizeString(existingRsvp?.status).toLowerCase();
    const existingRoleId = existingRsvp?.role_id ? String(existingRsvp.role_id) : null;
    const existingRoleCounted = shouldCountRoleSignup(existingStatus, existingRsvp?.no_show === true);
    const seatReleased = normalizedAction === "decline" && isSeatTakingStatus(existingStatus);

    if (normalizedAction === "accept") {
      if (existingStatus === "accepted" || existingStatus === "checked_in") {
        const snapshot = await getEventRsvpSnapshot(normalizedEventId, normalizedAttendeeId, { runner: client });
        await client.query("COMMIT");
        return {
          ok: true,
          data: {
            status: snapshot.viewer?.status || existingStatus,
            previous_status: existingStatus || null,
            counts: snapshot.counts,
            message: null,
            event: {
              id: eventRow.id,
              title: eventRow.title,
              start_at: eventRow.start_at,
            },
          },
        };
      }

      const { rows: [countRow] } = await client.query(
        `
          SELECT COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in'))::int AS accepted_count
          FROM event_rsvps r
          JOIN events e ON e.id = r.event_id
          WHERE r.event_id = $1
            AND r.attendee_user_id::text <> e.creator_user_id::text
        `,
        [normalizedEventId]
      );
      const acceptedCount = Number(countRow?.accepted_count) || 0;
      const resolvedStatus = resolveAcceptedRsvpStatus(eventRow, acceptedCount);
      if (resolvedStatus.error) {
        if (roleValidation.roleId) {
          targetStatus = "pending";
        } else {
          await client.query("ROLLBACK");
          return mapServiceError({
            statusCode: 409,
            code: resolvedStatus.error,
            error: resolvedStatus.message,
          });
        }
      } else {
        targetStatus = resolvedStatus.status;
      }
      const roleIsFull = Number(roleValidation.role?.spots_filled) >= Number(roleValidation.role?.spots_needed);
      let waitlistMessage = null;
      if (roleIsFull) {
        targetStatus = "pending";
        waitlistMessage = "Role is full. You have been added to the waitlist.";
      }

      if (roleValidation.roleId) {
        await client.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status, role_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_id, attendee_user_id)
              DO UPDATE SET status = EXCLUDED.status, role_id = EXCLUDED.role_id, updated_at = NOW(), check_in_method = NULL, checked_in_at = NULL
          `,
          [normalizedEventId, normalizedAttendeeId, targetStatus, roleValidation.roleId]
        );
      } else {
        await client.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id, attendee_user_id)
              DO UPDATE SET status = EXCLUDED.status, updated_at = NOW(), check_in_method = NULL, checked_in_at = NULL
          `,
          [normalizedEventId, normalizedAttendeeId, targetStatus]
        );
      }
      const nextRoleCounted = shouldCountRoleSignup(targetStatus, false);
      const nextRoleId = roleValidation.roleId || existingRoleId;
      if (existingRoleCounted && existingRoleId && existingRoleId !== nextRoleId) {
        await decrementRoleSignup(client, existingRoleId);
      }
      if (nextRoleCounted && nextRoleId && (!existingRoleCounted || existingRoleId !== nextRoleId)) {
        await incrementRoleSignup(client, nextRoleId);
      }
      roleValidation.message = waitlistMessage;
    } else {
      if (requireExistingForDecline && !existingStatus) {
        await client.query("ROLLBACK");
        return mapServiceError({ statusCode: 404, error: "No RSVP found to cancel for this event." });
      }

      const hasNotes = reason ? await columnExists("event_rsvps", "notes") : false;
      if (hasNotes) {
        await client.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status, notes)
            VALUES ($1, $2, 'declined', $3)
            ON CONFLICT (event_id, attendee_user_id)
              DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, updated_at = NOW(), check_in_method = NULL, checked_in_at = NULL
          `,
          [normalizedEventId, normalizedAttendeeId, reason]
        );
      } else {
        await client.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status)
            VALUES ($1, $2, 'declined')
            ON CONFLICT (event_id, attendee_user_id)
              DO UPDATE SET status = EXCLUDED.status, updated_at = NOW(), check_in_method = NULL, checked_in_at = NULL
          `,
          [normalizedEventId, normalizedAttendeeId]
        );
      }
      if (existingRoleCounted && existingRoleId) {
        await decrementRoleSignup(client, existingRoleId);
      }
    }

    if (seatReleased) {
      await promoteWaitlistedAttendees({ runner: client, eventId: normalizedEventId });
    }

    const snapshot = await getEventRsvpSnapshot(normalizedEventId, normalizedAttendeeId, { runner: client });
    await client.query("COMMIT");
    const nextStatus = snapshot.viewer?.status || targetStatus;

    return {
      ok: true,
      data: {
        status: nextStatus,
        previous_status: existingStatus || null,
        counts: snapshot.counts,
        message: normalizedAction === "accept" && nextStatus === "waitlisted"
          ? "Event is full. You have been added to the waitlist."
          : roleValidation.message || null,
        role_id: roleValidation.roleId || existingRoleId || null,
        event: {
          id: eventRow.id,
          title: eventRow.title,
          start_at: eventRow.start_at,
        },
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}
