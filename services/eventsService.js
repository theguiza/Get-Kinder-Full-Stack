import pool from "../Backend/db/pg.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function clampOffset(value) {
  const num = Number(value);
  return Math.max(Number.isFinite(num) ? num : 0, 0);
}

function mapEventRow(row = {}) {
  return {
    id: row.id != null ? String(row.id) : null,
    title: row.title || "Untitled Event",
    description: row.description || null,
    start_at: row.start_at || null,
    end_at: row.end_at || null,
    tz: row.tz || null,
    location_text: row.location_text || null,
    capacity: typeof row.capacity === "number" ? row.capacity : null,
    rsvp_counts: {
      accepted: Number(row.rsvp_accepted) || 0,
    },
    attendance_methods: Array.isArray(row.attendance_methods)
      ? row.attendance_methods
      : safeParseJsonArray(row.attendance_methods),
    status: row.status || null,
    creator_user_id: row.creator_user_id ? String(row.creator_user_id) : null,
    cover_url: row.cover_url || null,
  };
}

function safeParseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function fetchEvents({ limit, offset } = {}) {
  const clampedLimit = clampLimit(limit);
  const clampedOffset = clampOffset(offset);
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.description,
             e.start_at,
             e.end_at,
             e.tz,
             e.location_text,
             e.capacity,
             e.cover_url,
             e.attendance_methods,
             e.status,
             e.creator_user_id,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN (
          SELECT event_id,
                 COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps
        GROUP BY event_id
        ) r ON r.event_id = e.id
       ORDER BY e.start_at ASC NULLS LAST, e.id ASC
       LIMIT $1 OFFSET $2
    `,
    [clampedLimit, clampedOffset]
  );
  return rows.map((row) => {
    const mapped = mapEventRow(row);
    delete mapped.description;
    return mapped;
  });
}

export async function fetchEventById(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.description,
             e.start_at,
             e.end_at,
             e.tz,
             e.location_text,
             e.capacity,
             e.cover_url,
             e.attendance_methods,
             e.status,
             e.creator_user_id,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN (
          SELECT event_id,
                 COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps
        GROUP BY event_id
        ) r ON r.event_id = e.id
       WHERE e.id = $1
       LIMIT 1
    `,
    [id]
  );
  if (!rows[0]) return null;
  return mapEventRow(rows[0]);
}
