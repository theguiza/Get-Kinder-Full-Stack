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
    org_name: row.org_name || null,
    community_tag: row.community_tag || null,
    cause_tags: normalizeTextArray(row.cause_tags),
    requirements: row.requirements || null,
    verification_method: row.verification_method || "host_attest",
    impact_credits_base:
      row.impact_credits_base !== null && row.impact_credits_base !== undefined
        ? Number(row.impact_credits_base)
        : 25,
    reliability_weight:
      row.reliability_weight !== null && row.reliability_weight !== undefined
        ? Number(row.reliability_weight)
        : 1,
    funding_pool_slug: row.funding_pool_slug || "general",
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

function normalizeTextArray(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
  if (!value) return [];
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export async function fetchEvents({ limit, offset, communityTag, causeTag } = {}) {
  const clampedLimit = clampLimit(limit);
  const clampedOffset = clampOffset(offset);
  const filters = [];
  const values = [];
  const normalizedCommunity = typeof communityTag === "string" ? communityTag.trim() : "";
  const normalizedCause = typeof causeTag === "string" ? causeTag.trim() : "";
  if (normalizedCommunity) {
    values.push(normalizedCommunity);
    filters.push(`e.community_tag = $${values.length}`);
  }
  if (normalizedCause) {
    values.push(normalizedCause);
    filters.push(`$${values.length} = ANY(e.cause_tags)`);
  }
  values.push(clampedLimit);
  values.push(clampedOffset);
  const limitParam = values.length - 1;
  const offsetParam = values.length;
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.description,
             e.start_at,
             e.end_at,
             e.tz,
             e.location_text,
             e.org_name,
             e.community_tag,
             e.cause_tags,
             e.requirements,
             e.verification_method,
             e.impact_credits_base,
             e.reliability_weight,
             e.funding_pool_slug,
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
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY e.start_at ASC NULLS LAST, e.id ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}
    `,
    values
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
             e.org_name,
             e.community_tag,
             e.cause_tags,
             e.requirements,
             e.verification_method,
             e.impact_credits_base,
             e.reliability_weight,
             e.funding_pool_slug,
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

export async function getEventByIdForVerify(client, eventId) {
  const runner = client?.query ? client : pool;
  const id = client?.query ? eventId : client;
  const { rows } = await runner.query(
    `
      SELECT id,
             creator_user_id,
             start_at,
             end_at,
             impact_credits_base,
             funding_pool_slug
        FROM events
       WHERE id = $1
       LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
}

export async function getRsvpForUpdate(client, eventId, attendeeUserId) {
  const runner = client || pool;
  const { rows } = await runner.query(
    `
      SELECT id,
             event_id,
             attendee_user_id,
             status,
             verification_status,
             attended_minutes
        FROM event_rsvps
       WHERE event_id = $1
         AND attendee_user_id = $2
       FOR UPDATE
    `,
    [eventId, attendeeUserId]
  );
  return rows[0] || null;
}

export async function countVerifiedShifts(client, attendeeUserId) {
  const runner = client || pool;
  const { rows } = await runner.query(
    `
      SELECT COUNT(*)::int AS total
        FROM event_rsvps
       WHERE attendee_user_id = $1
         AND verification_status = 'verified'
    `,
    [attendeeUserId]
  );
  return Number(rows?.[0]?.total) || 0;
}

export async function updateEventRsvpVerification(
  client,
  { eventId, attendeeUserId, decision, attendedMinutes, notes }
) {
  const runner = client || pool;
  const sets = [
    "verification_status = $1",
    "attended_minutes = $2",
    "verified_at = NOW()",
  ];
  const values = [decision, attendedMinutes];
  if (notes) {
    sets.push(`notes = $${values.length + 1}`);
    values.push(notes);
  }
  values.push(eventId, attendeeUserId);
  const { rows } = await runner.query(
    `
      UPDATE event_rsvps
         SET ${sets.join(", ")}
       WHERE event_id = $${values.length - 1}
         AND attendee_user_id = $${values.length}
       RETURNING verification_status, attended_minutes
    `,
    values
  );
  return rows[0] || null;
}
