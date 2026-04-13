import pool from "../Backend/db/pg.js";
import { addRewardPresentation } from "./volunteerRewardService.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function normalizeView(value) {
  return value === "archive" ? "archive" : "upcoming";
}

function normalizeCursorTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCursorId(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

function normalizeFilterToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function roundToTenth(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

function parseBooleanish(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "true" || normalized === "t" || normalized === "1";
}

function deriveEventType(row = {}) {
  const recurrenceRule = typeof row.recurrence_rule === "string"
    ? row.recurrence_rule.trim()
    : "";
  if (recurrenceRule || parseBooleanish(row.is_recurring)) {
    return "recurring";
  }

  const startMs = row.start_at ? new Date(row.start_at).getTime() : Number.NaN;
  const endMs = row.end_at ? new Date(row.end_at).getTime() : Number.NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs > 20 * 60 * 60 * 1000) {
    return "multi_day";
  }

  return "one_time";
}

function mapEventRow(row = {}) {
  const orgId = row.org_id !== null && row.org_id !== undefined
    ? Number(row.org_id)
    : null;
  const orgRatingCount = Number(row.org_rating_count) || 0;
  const orgRatingValueRaw = Number(row.org_rating_value);
  const orgRatingValue = Number.isInteger(orgId) && orgId > 0
    ? (
      orgRatingCount > 0 && Number.isFinite(orgRatingValueRaw)
        ? roundToTenth(orgRatingValueRaw)
        : 5
    )
    : null;
  return addRewardPresentation({
    id: row.id != null ? String(row.id) : null,
    title: row.title || "Untitled Event",
    category: row.category || null,
    description: row.description || null,
    safety_notes: row.safety_notes || null,
    start_at: row.start_at || null,
    end_at: row.end_at || null,
    tz: row.tz || null,
    location_text: row.location_text || null,
    org_name: row.org_name || null,
    org_id: row.org_id !== null && row.org_id !== undefined
      ? Number(row.org_id)
      : null,
    community_tag: row.community_tag || null,
    cause_tags: normalizeTextArray(row.cause_tags),
    requirements: row.requirements || null,
    verification_method: row.verification_method || "host_attest",
    impact_credits_base:
      row.impact_credits_base !== null && row.impact_credits_base !== undefined
        ? Number(row.impact_credits_base)
        : 10,
    reliability_weight:
      row.reliability_weight !== null && row.reliability_weight !== undefined
        ? Number(row.reliability_weight)
        : 1,
    funding_pool_slug: row.funding_pool_slug || "general",
    capacity: typeof row.capacity === "number" ? row.capacity : null,
    waitlist_enabled: row.waitlist_enabled !== false,
    rsvp_counts: {
      accepted: Number(row.rsvp_accepted) || 0,
    },
    attendance_methods: Array.isArray(row.attendance_methods)
      ? row.attendance_methods
      : safeParseJsonArray(row.attendance_methods),
    status: row.status || null,
    creator_user_id: row.creator_user_id ? String(row.creator_user_id) : null,
    cover_url: row.cover_url || null,
    org_rating_value: orgRatingValue,
    org_rating_count: Number.isInteger(orgId) && orgId > 0 ? orgRatingCount : 0,
    event_type: deriveEventType(row),
  });
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

let hasEventRsvpNoShowColumnPromise = null;

export async function hasEventRsvpNoShowColumn(client = null) {
  if (!hasEventRsvpNoShowColumnPromise) {
    const runner = client || pool;
    hasEventRsvpNoShowColumnPromise = runner
      .query(
        `
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'event_rsvps'
             AND column_name = 'no_show'
           LIMIT 1
        `
      )
      .then((result) => Array.isArray(result?.rows) && result.rows.length > 0)
      .catch(() => false);
  }
  return hasEventRsvpNoShowColumnPromise;
}

export async function fetchEvents({
  limit,
  view,
  cursor,
  communityTag,
  causeTag,
  community_tag,
  cause_tag,
  after_start_at,
  after_id,
  before_start_at,
  before_id,
} = {}) {
  const clampedLimit = clampLimit(limit);
  const normalizedView = normalizeView(view);
  const filters = ["e.status = 'published'"];
  filters.push(
    normalizedView === "archive"
      ? "COALESCE(e.end_at, e.start_at) < NOW() - INTERVAL '2 hours'"
      : "COALESCE(e.end_at, e.start_at) >= NOW() - INTERVAL '2 hours'"
  );
  const values = [];
  const normalizedCommunity = typeof community_tag === "string"
    ? community_tag.trim().toLowerCase()
    : typeof communityTag === "string"
      ? communityTag.trim().toLowerCase()
      : "";
  const normalizedCause = normalizeFilterToken(
    typeof cause_tag === "string" ? cause_tag : causeTag
  );
  if (normalizedCommunity) {
    values.push(normalizedCommunity);
    filters.push(`LOWER(TRIM(COALESCE(e.community_tag, ''))) = $${values.length}`);
  }
  if (normalizedCause) {
    values.push(normalizedCause);
    const causeParam = values.length;
    // Match case-insensitively and ignore punctuation/spaces so chip filters
    // still match tags like "Animals", "Arts & Culture", etc.
    filters.push(`
      (
        EXISTS (
          SELECT 1
          FROM unnest(COALESCE(e.cause_tags, ARRAY[]::text[])) AS cause_tag
          WHERE REGEXP_REPLACE(LOWER(TRIM(cause_tag)), '[^a-z0-9]+', '', 'g') = $${causeParam}
             OR REGEXP_REPLACE(LOWER(TRIM(cause_tag)), '[^a-z0-9]+', '', 'g') LIKE $${causeParam} || '%'
             OR $${causeParam} LIKE REGEXP_REPLACE(LOWER(TRIM(cause_tag)), '[^a-z0-9]+', '', 'g') || '%'
        )
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(e.category, ''))), '[^a-z0-9]+', '', 'g') = $${causeParam}
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(e.category, ''))), '[^a-z0-9]+', '', 'g') LIKE $${causeParam} || '%'
        OR $${causeParam} LIKE REGEXP_REPLACE(LOWER(TRIM(COALESCE(e.category, ''))), '[^a-z0-9]+', '', 'g') || '%'
      )
    `);
  }
  const cursorInput = cursor || {};
  const afterStartAt = normalizeCursorTimestamp(cursorInput.after_start_at ?? after_start_at);
  const afterId = normalizeCursorId(cursorInput.after_id ?? after_id);
  const beforeStartAt = normalizeCursorTimestamp(cursorInput.before_start_at ?? before_start_at);
  const beforeId = normalizeCursorId(cursorInput.before_id ?? before_id);

  const sortStartExpr = normalizedView === "archive"
    ? "COALESCE(e.start_at, '-infinity'::timestamptz)"
    : "COALESCE(e.start_at, 'infinity'::timestamptz)";
  const cursorStartAt = normalizedView === "archive" ? beforeStartAt : afterStartAt;
  const cursorId = normalizedView === "archive" ? beforeId : afterId;

  if (cursorId) {
    values.push(cursorStartAt);
    const cursorStartParam = values.length;
    values.push(cursorId);
    const cursorIdParam = values.length;
    const cursorFallback = normalizedView === "archive"
      ? "'-infinity'::timestamptz"
      : "'infinity'::timestamptz";
    const cursorOperator = normalizedView === "archive" ? "<" : ">";
    filters.push(
      `(${sortStartExpr}, e.id) ${cursorOperator} (COALESCE($${cursorStartParam}::timestamptz, ${cursorFallback}), $${cursorIdParam}::uuid)`
    );
  }

  values.push(clampedLimit + 1);
  const limitParam = values.length;
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.category,
             e.description,
             e.safety_notes,
             e.start_at,
             e.end_at,
             NULLIF(BTRIM(COALESCE(to_jsonb(e) ->> 'recurrence_rule', '')), '') AS recurrence_rule,
             COALESCE((to_jsonb(e) ->> 'is_recurring')::boolean, FALSE) AS is_recurring,
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
             e.waitlist_enabled,
             e.cover_url,
             e.attendance_methods,
             e.status,
             e.creator_user_id,
             creator.org_id,
             org_rating.avg AS org_rating_value,
             COALESCE(org_rating.cnt, 0) AS org_rating_count,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN userdata creator
          ON creator.id = e.creator_user_id
   LEFT JOIN (
          SELECT r.event_id,
                 COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps r
            JOIN events e ON e.id = r.event_id
           WHERE r.attendee_user_id::text <> e.creator_user_id::text
        GROUP BY r.event_id
        ) r ON r.event_id = e.id
   LEFT JOIN LATERAL (
          SELECT AVG(recent.stars)::float AS avg,
                 COUNT(*)::int AS cnt
            FROM (
                  SELECT er.stars
                    FROM event_ratings er
               LEFT JOIN userdata hu
                      ON hu.id = er.ratee_user_id
                   WHERE creator.org_id IS NOT NULL
                     AND (
                       (er.ratee_role = 'organization' AND er.ratee_org_id = creator.org_id)
                       OR
                       (er.ratee_role = 'host' AND hu.org_id = creator.org_id)
                     )
                ORDER BY er.created_at DESC
                   LIMIT 20
                 ) recent
        ) org_rating ON creator.org_id IS NOT NULL
      ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY ${sortStartExpr} ${normalizedView === "archive" ? "DESC" : "ASC"},
                e.id ${normalizedView === "archive" ? "DESC" : "ASC"}
       LIMIT $${limitParam}
    `,
    values
  );

  const hasMore = rows.length > clampedLimit;
  const pageRows = hasMore ? rows.slice(0, clampedLimit) : rows;
  const events = pageRows.map((row) => mapEventRow(row));
  const last = pageRows[pageRows.length - 1];
  const lastStartAt = last?.start_at ? new Date(last.start_at).toISOString() : null;
  const nextCursor = hasMore && last
    ? normalizedView === "archive"
      ? { before_start_at: lastStartAt, before_id: String(last.id) }
      : { after_start_at: lastStartAt, after_id: String(last.id) }
    : null;

  return {
    events,
    nextCursor,
    view: normalizedView,
  };
}

export async function fetchOrganizations() {
  const { rows } = await pool.query(
    `
      SELECT 
        o.id,
        o.name,
        o.description,
        o.logo_url,
        o.website,
        COALESCE(event_stats.upcoming_event_count, 0) AS upcoming_event_count,
        event_stats.next_event_at,
        COALESCE(rating_summary.rating_value, 5)::float AS rating_value,
        COALESCE(rating_summary.rating_count, 0)::int AS rating_count
      FROM organizations o
 LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT e.id) FILTER (
                 WHERE e.status = 'published'
                   AND e.start_at > NOW()
               ) AS upcoming_event_count,
               MIN(e.start_at) FILTER (
                 WHERE e.status = 'published'
                   AND e.start_at > NOW()
               ) AS next_event_at
          FROM userdata u
     LEFT JOIN events e
            ON e.creator_user_id = u.id
         WHERE u.org_id = o.id
      ) event_stats ON TRUE
 LEFT JOIN LATERAL (
        SELECT COALESCE(AVG(recent.stars)::float, 5) AS rating_value,
               COUNT(*)::int AS rating_count
          FROM (
                SELECT er.stars
                  FROM event_ratings er
             LEFT JOIN userdata hu
                    ON hu.id = er.ratee_user_id
                 WHERE (er.ratee_role = 'organization' AND er.ratee_org_id = o.id)
                    OR (er.ratee_role = 'host' AND hu.org_id = o.id)
              ORDER BY er.created_at DESC
                 LIMIT 20
               ) recent
      ) rating_summary ON TRUE
      WHERE o.status = 'approved'
      ORDER BY COALESCE(event_stats.upcoming_event_count, 0) DESC, o.name ASC;
    `
  );

  return rows.map((row) => ({
    id: row.id !== null && row.id !== undefined ? Number(row.id) : null,
    name: row.name || null,
    description: row.description || null,
    logo_url: row.logo_url || null,
    website: row.website || null,
    upcoming_event_count: Number(row.upcoming_event_count) || 0,
    next_event_at: row.next_event_at || null,
    rating_value: Number.isFinite(Number(row.rating_value)) ? Number(row.rating_value) : 5,
    rating_count: Number(row.rating_count) || 0,
  }));
}

export async function fetchEventsByOrg(orgId) {
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.category,
             e.description,
             e.safety_notes,
             e.start_at,
             e.end_at,
             NULLIF(BTRIM(COALESCE(to_jsonb(e) ->> 'recurrence_rule', '')), '') AS recurrence_rule,
             COALESCE((to_jsonb(e) ->> 'is_recurring')::boolean, FALSE) AS is_recurring,
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
             e.waitlist_enabled,
             e.cover_url,
             e.attendance_methods,
             e.status,
             e.creator_user_id,
             creator.org_id,
             org_rating.avg AS org_rating_value,
             COALESCE(org_rating.cnt, 0) AS org_rating_count,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN userdata creator
          ON creator.id = e.creator_user_id
   LEFT JOIN (
          SELECT r.event_id,
                 COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps r
            JOIN events e ON e.id = r.event_id
           WHERE r.attendee_user_id::text <> e.creator_user_id::text
        GROUP BY r.event_id
        ) r ON r.event_id = e.id
   LEFT JOIN LATERAL (
          SELECT AVG(recent.stars)::float AS avg,
                 COUNT(*)::int AS cnt
            FROM (
                  SELECT er.stars
                    FROM event_ratings er
               LEFT JOIN userdata hu
                      ON hu.id = er.ratee_user_id
                   WHERE creator.org_id IS NOT NULL
                     AND (
                       (er.ratee_role = 'organization' AND er.ratee_org_id = creator.org_id)
                       OR
                       (er.ratee_role = 'host' AND hu.org_id = creator.org_id)
                     )
                ORDER BY er.created_at DESC
                   LIMIT 20
                 ) recent
        ) org_rating ON creator.org_id IS NOT NULL
       WHERE e.status = 'published'
         AND e.start_at > NOW()
         AND creator.org_id = $1
       ORDER BY COALESCE(e.start_at, 'infinity'::timestamptz) ASC,
                e.id ASC
    `,
    [orgId]
  );

  return rows.map((row) => mapEventRow(row));
}

export async function fetchEventById(id) {
  if (!id) return null;
  const { rows } = await pool.query(
    `
      SELECT e.id,
             e.title,
             e.category,
             e.description,
             e.safety_notes,
             e.start_at,
             e.end_at,
             NULLIF(BTRIM(COALESCE(to_jsonb(e) ->> 'recurrence_rule', '')), '') AS recurrence_rule,
             COALESCE((to_jsonb(e) ->> 'is_recurring')::boolean, FALSE) AS is_recurring,
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
             e.waitlist_enabled,
             e.cover_url,
             e.attendance_methods,
             e.status,
             e.creator_user_id,
             creator.org_id,
             org_rating.avg AS org_rating_value,
             COALESCE(org_rating.cnt, 0) AS org_rating_count,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN userdata creator
          ON creator.id = e.creator_user_id
   LEFT JOIN (
          SELECT r.event_id,
                 COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps r
            JOIN events e ON e.id = r.event_id
           WHERE r.attendee_user_id::text <> e.creator_user_id::text
        GROUP BY r.event_id
        ) r ON r.event_id = e.id
   LEFT JOIN LATERAL (
          SELECT AVG(recent.stars)::float AS avg,
                 COUNT(*)::int AS cnt
            FROM (
                  SELECT er.stars
                    FROM event_ratings er
               LEFT JOIN userdata hu
                      ON hu.id = er.ratee_user_id
                   WHERE creator.org_id IS NOT NULL
                     AND (
                       (er.ratee_role = 'organization' AND er.ratee_org_id = creator.org_id)
                       OR
                       (er.ratee_role = 'host' AND hu.org_id = creator.org_id)
                     )
                ORDER BY er.created_at DESC
                   LIMIT 20
                 ) recent
        ) org_rating ON creator.org_id IS NOT NULL
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
  const hasNoShow = await hasEventRsvpNoShowColumn(runner);
  const noShowSelect = hasNoShow ? "no_show" : "NULL::boolean AS no_show";
  const { rows } = await runner.query(
    `
      SELECT id,
             event_id,
             attendee_user_id,
             status,
             verification_status,
             attended_minutes,
             ${noShowSelect}
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
