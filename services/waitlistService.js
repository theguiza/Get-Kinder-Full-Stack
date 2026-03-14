function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

export function isSeatTakingStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized === "accepted" || normalized === "checked_in";
}

export async function promoteWaitlistedAttendees({ runner, eventId }) {
  if (!runner?.query) {
    throw new Error("promoteWaitlistedAttendees requires a query runner");
  }
  const normalizedEventId = String(eventId || "").trim();
  if (!normalizedEventId) return { promotedCount: 0, promotedUserIds: [] };

  const { rows: [eventRow] } = await runner.query(
    `
      SELECT id, capacity, status
        FROM events
       WHERE id = $1
       LIMIT 1
       FOR UPDATE
    `,
    [normalizedEventId]
  );
  if (!eventRow) return { promotedCount: 0, promotedUserIds: [] };
  if (normalizeStatus(eventRow.status) === "cancelled") {
    return { promotedCount: 0, promotedUserIds: [] };
  }

  const { rows: [countsRow] } = await runner.query(
    `
      SELECT
        COUNT(*) FILTER (WHERE status IN ('accepted','checked_in'))::int AS accepted_count,
        COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted_count
      FROM event_rsvps
      WHERE event_id = $1
    `,
    [normalizedEventId]
  );
  const acceptedCount = Number(countsRow?.accepted_count) || 0;
  const waitlistedCount = Number(countsRow?.waitlisted_count) || 0;
  if (waitlistedCount <= 0) return { promotedCount: 0, promotedUserIds: [] };

  const capacity = Number(eventRow.capacity);
  const hasCapacityLimit = Number.isFinite(capacity) && capacity > 0;
  const promotionLimit = hasCapacityLimit
    ? Math.max(0, capacity - acceptedCount)
    : waitlistedCount;
  if (promotionLimit <= 0) return { promotedCount: 0, promotedUserIds: [] };

  const { rows } = await runner.query(
    `
      WITH candidates AS (
        SELECT r.id
        FROM event_rsvps r
        WHERE r.event_id = $1
          AND r.status = 'waitlisted'
        ORDER BY r.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE event_rsvps r
         SET status = 'accepted',
             updated_at = NOW(),
             check_in_method = NULL,
             checked_in_at = NULL
        FROM candidates c
       WHERE r.id = c.id
      RETURNING r.attendee_user_id::text AS attendee_user_id
    `,
    [normalizedEventId, promotionLimit]
  );

  return {
    promotedCount: rows.length,
    promotedUserIds: rows.map((row) => String(row.attendee_user_id || "")).filter(Boolean),
  };
}
