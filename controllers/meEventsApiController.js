import pool from "../Backend/db/pg.js";

const TAB_QUERY = {
  upcoming: {
    filter: "AND e.status = 'published' AND (e.start_at IS NULL OR e.start_at > NOW())",
    order: "ORDER BY e.start_at ASC NULLS LAST",
  },
  past: {
    filter:
      "AND e.end_at IS NOT NULL AND e.end_at <= NOW() AND e.status IN ('published','completed','cancelled')",
    order: "ORDER BY e.end_at DESC NULLS LAST",
  },
  drafts: {
    filter: "AND e.status = 'draft'",
    order: "ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC",
  },
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const FALLBACK_MY_EVENTS = [
  {
    id: "demo-1",
    title: "Community Coffee Drop-In",
    start_at: "2025-01-05T10:00:00-08:00",
    end_at: "2025-01-05T12:00:00-08:00",
    tz: "America/Vancouver",
    location_text: "Kind Grounds, Kitsilano",
    visibility: "public",
    capacity: 24,
    status: "published",
    reward_pool_kind: 50,
    rsvp_counts: { accepted: 12 },
  },
  {
    id: "demo-2",
    title: "Sunset Plog & Picnic",
    start_at: "2025-01-09T17:30:00-08:00",
    end_at: "2025-01-09T19:00:00-08:00",
    tz: "America/Vancouver",
    location_text: "Jericho Beach",
    visibility: "fof",
    capacity: 40,
    status: "draft",
    reward_pool_kind: 0,
    rsvp_counts: { accepted: 0 },
  },
];

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function clampOffset(value) {
  const num = Number(value);
  return Math.max(Number.isFinite(num) ? num : 0, 0);
}

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) throw new Error("User record not found.");
  return String(rows[0].id);
}

export async function listMyEvents(req, res) {
  try {
    const userId = await resolveUserId(req);
    const tab = (req.query.tab || "upcoming").toLowerCase();
    const limit = clampLimit(req.query.limit);
    const offset = clampOffset(req.query.offset);
    const { filter, order } = TAB_QUERY[tab] || TAB_QUERY.upcoming;

    const sql = `
      SELECT e.id,
             e.title,
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
             e.visibility,
             e.capacity,
             e.status,
             COALESCE(e.reward_pool_kind, 0) AS reward_pool_kind,
             COALESCE(r.accepted, 0) AS rsvp_accepted
        FROM events e
   LEFT JOIN (
          SELECT event_id,
                 COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted
            FROM event_rsvps
        GROUP BY event_id
        ) r ON r.event_id = e.id
       WHERE e.creator_user_id = $1
         ${filter}
       ${order}
       LIMIT $2 OFFSET $3
    `;

    let rows;
    try {
      const result = await pool.query(sql, [userId, limit, offset]);
      rows = result.rows;
    } catch (error) {
      if (error?.code === "42P01") {
        rows = FALLBACK_MY_EVENTS.slice(offset, offset + limit);
      } else {
        throw error;
      }
    }

    const data = rows.map((row) => ({
      id: String(row.id),
      title: row.title,
      start_at: row.start_at,
      end_at: row.end_at,
      tz: row.tz,
      location_text: row.location_text,
      org_name: row.org_name || null,
      community_tag: row.community_tag || null,
      cause_tags: Array.isArray(row.cause_tags) ? row.cause_tags : [],
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
      visibility: row.visibility,
      capacity: row.capacity,
      status: row.status,
      reward_pool_kind: row.reward_pool_kind ?? 0,
      rsvp_counts: { accepted: Number(row.rsvp_accepted) || 0 },
    }));

    return res.json({
      ok: true,
      data,
      paging: { limit, offset: offset + data.length, count: data.length },
    });
  } catch (error) {
    console.error("[meEvents] listMyEvents error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Unable to load events" });
  }
}

export async function cancelEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;
    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, start_at, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status !== "published") {
      return res.status(409).json({ ok: false, error: "Only published events can be cancelled" });
    }
    if (eventRow.start_at && new Date(eventRow.start_at) <= new Date()) {
      return res.status(409).json({ ok: false, error: "Event already started or past" });
    }

    await pool.query("UPDATE events SET status='cancelled' WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId, status: "cancelled" } });
  } catch (error) {
    console.error("[meEvents] cancelEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to cancel event" });
  }
}

export async function completeEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;

    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, end_at, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status === "cancelled") {
      return res.status(409).json({ ok: false, error: "Cancelled events cannot be completed" });
    }
    if (!eventRow.end_at || new Date(eventRow.end_at) > new Date()) {
      return res.status(409).json({ ok: false, error: "Event not finished yet" });
    }

    await pool.query("UPDATE events SET status='completed' WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId, status: "completed" } });
  } catch (error) {
    console.error("[meEvents] completeEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to complete event" });
  }
}

export async function deleteDraftEvent(req, res) {
  try {
    const userId = await resolveUserId(req);
    const eventId = req.params.id;
    let eventRow;
    try {
      const { rows } = await pool.query(
        `
          SELECT id, creator_user_id, status
            FROM events
           WHERE id = $1
        `,
        [eventId]
      );
      eventRow = rows[0];
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(500).json({ ok: false, error: "Events table missing. Please run migrations." });
      }
      throw error;
    }

    if (!eventRow) {
      return res.status(404).json({ ok: false, error: "Event not found" });
    }
    if (String(eventRow.creator_user_id) !== userId) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    if (eventRow.status !== "draft") {
      return res.status(409).json({ ok: false, error: "Only drafts can be deleted" });
    }

    await pool.query("DELETE FROM events WHERE id=$1", [eventId]);
    return res.json({ ok: true, data: { id: eventId } });
  } catch (error) {
    console.error("[meEvents] deleteDraftEvent error:", error);
    return res.status(500).json({ ok: false, error: "Unable to delete draft" });
  }
}
