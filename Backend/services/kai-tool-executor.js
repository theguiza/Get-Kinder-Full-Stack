import pool from "../db/pg.js";

const DEFAULT_EVENTS_DAYS_AHEAD = 90;
const DEFAULT_EVENTS_LIMIT = 5;
const DEFAULT_HISTORY_LIMIT = 5;
const DEFAULT_NOT_IMPLEMENTED_RESPONSE = {
  status: "not_implemented",
  message: "This feature is coming soon.",
};
const GENERIC_ERROR_RESPONSE = {
  error: true,
  message: "Something went wrong. Please try again.",
};

const columnExistsCache = new Map();
const tableExistsCache = new Map();

const PLATFORM_FAQ_KB = {
  ic: {
    key: "ic",
    title: "How IC works",
    answer:
      "Impact Credits (IC) are earned from verified volunteering. The base is 25 IC per verified event, with reliability multipliers increasing rewards for consistent follow-through.",
  },
  subscriptions: {
    key: "subscriptions",
    title: "Subscription tiers",
    answer:
      "Free: $0/month. Kinder+: $9/month. Kinder Pro: $19/month. Kinder Impact: $79/month. Higher tiers unlock stronger matching, planning, and automation tools.",
  },
  reliability: {
    key: "reliability",
    title: "Reliability scoring",
    answer:
      "Reliability tracks consistency over time and updates after RSVP, attendance, and verification activity. Typical tiers are New, Standard, High, and Super. Late cancellations/no-shows can lower tier, while consistent verified attendance helps recovery.",
  },
  ratings: {
    key: "ratings",
    title: "Ratings",
    answer:
      "Get Kinder uses two-way 5-star ratings after volunteer events. Rolling averages are based on the most recent 20 ratings to keep scores current and fair.",
  },
  verification: {
    key: "verification",
    title: "Verification",
    answer:
      "Attendance verification uses event check-in/check-out flows, including QR-supported workflows. Verified completion is what finalizes attendance and unlocks IC crediting.",
  },
};

function parseInteger(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.min(max, Math.max(min, base));
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeString(value))
    .filter((value) => value.length > 0);
}

function isDuplicateRsvpError(error) {
  if (error?.code !== "23505") return false;
  const constraint = String(error?.constraint || "").toLowerCase();
  return constraint.includes("event_rsvps") || constraint.includes("uq_event_rsvps_attendee");
}

function isForeignKeyError(error) {
  return error?.code === "23503";
}

function withinFortyEightHours(startAt) {
  if (!startAt) return false;
  const startTime = new Date(startAt).getTime();
  if (Number.isNaN(startTime)) return false;
  const diff = startTime - Date.now();
  return diff > 0 && diff <= 48 * 60 * 60 * 1000;
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

async function recomputeReliability(userId) {
  await pool.query("SELECT compute_reliability($1)", [userId]);
}

async function handlePlatformFaq(toolInput = {}) {
  try {
    const topic = normalizeString(toolInput.topic).toLowerCase();
    const matchers = [
      { key: "ic", patterns: ["ic", "impact credit", "credits", "earning", "earn"] },
      { key: "subscriptions", patterns: ["subscription", "tier", "plan", "price", "pricing", "kinder+"] },
      { key: "reliability", patterns: ["reliability", "no-show", "noshow", "penalty", "recover"] },
      { key: "ratings", patterns: ["rating", "stars", "review"] },
      { key: "verification", patterns: ["verification", "verify", "qr", "check-in", "check in", "check-out"] },
    ];

    const match = matchers.find((candidate) =>
      candidate.patterns.some((pattern) => topic.includes(pattern))
    );

    if (!match) {
      return {
        status: "success",
        category: "overview",
        available_topics: Object.values(PLATFORM_FAQ_KB).map((entry) => ({
          key: entry.key,
          title: entry.title,
        })),
        message: "Topic not recognized. Try asking about IC, subscriptions, reliability, ratings, or verification.",
      };
    }

    return {
      status: "success",
      category: match.key,
      data: PLATFORM_FAQ_KB[match.key],
    };
  } catch (error) {
    console.error("[kai-tool-executor] platform_faq error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleSearchEvents(toolInput = {}) {
  try {
    const query = normalizeString(toolInput.query);
    const category = normalizeString(toolInput.category);
    const causeTags = normalizeStringArray(toolInput.cause_tags);
    const daysAhead = parseInteger(toolInput.days_ahead, DEFAULT_EVENTS_DAYS_AHEAD, { min: 1, max: 365 });
    const limit = parseInteger(toolInput.limit, DEFAULT_EVENTS_LIMIT, { min: 1, max: 50 });

    const whereClauses = ["e.status = 'published'", "e.start_at > NOW()"];
    const values = [];

    values.push(daysAhead);
    whereClauses.push(`e.start_at <= NOW() + ($${values.length}::int * INTERVAL '1 day')`);

    if (query) {
      // Split query into individual words and match any of them
      // This handles cases like "Victoria BC" where the DB has "Victoria" but not "Victoria BC"
      const words = query.split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        const wordClauses = [];
        for (const word of words) {
          values.push(`%${word}%`);
          const idx = values.length;
          wordClauses.push(`(e.title ILIKE $${idx} OR e.description ILIKE $${idx} OR e.location_text ILIKE $${idx} OR e.community_tag ILIKE $${idx} OR e.org_name ILIKE $${idx})`);
        }
        whereClauses.push(`(${wordClauses.join(' OR ')})`);
      }
    }

    if (category) {
      values.push(category);
      whereClauses.push(`e.category = $${values.length}`);
    }

    if (causeTags.length > 0) {
      values.push(causeTags);
      whereClauses.push(`COALESCE(e.cause_tags, ARRAY[]::text[]) && $${values.length}::text[]`);
    }

    values.push(limit);
    const limitParam = values.length;

    const { rows } = await pool.query(
      `
        SELECT
          e.id,
          e.title,
          e.start_at,
          e.end_at,
          e.location_text,
          e.org_name,
          e.category,
          e.cause_tags,
          e.capacity
        FROM events e
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY e.start_at ASC
        LIMIT $${limitParam}
      `,
      values
    );

    return {
      status: "success",
      events: rows,
    };
  } catch (error) {
    console.error("[kai-tool-executor] search_events error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetEventDetails(toolInput = {}) {
  try {
    const eventId = normalizeString(toolInput.event_id);
    if (!eventId) return { status: "error", message: "event_id is required." };

    const { rows: eventRows } = await pool.query("SELECT * FROM events WHERE id = $1 LIMIT 1", [eventId]);
    const event = eventRows?.[0];
    if (!event) {
      return { status: "not_found", message: "Event not found." };
    }

    const [roles, rsvpSummaryRow] = await Promise.all([
      (async () => {
        const hasRolesTable = await tableExists("event_roles");
        if (!hasRolesTable) return [];
        const { rows } = await pool.query(
          `
            SELECT *
            FROM event_roles
            WHERE event_id = $1
            ORDER BY id ASC
          `,
          [eventId]
        );
        return rows;
      })(),
      (async () => {
        const { rows } = await pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE status = 'accepted') AS accepted,
              COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in,
              COUNT(*) FILTER (WHERE status = 'pending') AS pending
            FROM event_rsvps
            WHERE event_id = $1
          `,
          [eventId]
        );
        return rows?.[0] || {};
      })(),
    ]);

    return {
      status: "success",
      event: {
        ...event,
        roles,
        rsvp_summary: {
          accepted: Number(rsvpSummaryRow.accepted) || 0,
          checked_in: Number(rsvpSummaryRow.checked_in) || 0,
          pending: Number(rsvpSummaryRow.pending) || 0,
        },
      },
    };
  } catch (error) {
    console.error("[kai-tool-executor] get_event_details error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function calculateIcBalance(userId) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN kind_amount ELSE 0 END), 0) AS credits,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN kind_amount ELSE 0 END), 0) AS debits
      FROM wallet_transactions
      WHERE user_id = $1
    `,
    [userId]
  );

  const credits = Number(rows?.[0]?.credits) || 0;
  const debits = Number(rows?.[0]?.debits) || 0;
  return credits - debits;
}

async function handleGetUserProfile(_toolInput = {}, userId) {
  try {
    if (!userId) return { status: "error", message: "User is required for this tool." };

    const { rows: userRows } = await pool.query(
      `
        SELECT
          id,
          firstname,
          lastname,
          email,
          home_base_label,
          reliability_tier,
          created_at
        FROM userdata
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const user = userRows?.[0];
    if (!user) {
      return { status: "not_found", message: "User profile not found." };
    }

    const [icBalance, ratingStats, upcomingRsvps] = await Promise.all([
      calculateIcBalance(userId),
      (async () => {
        const hasRatingsTable = await tableExists("event_ratings");
        if (!hasRatingsTable) {
          return { average_rating: 0, rating_count: 0 };
        }
        const { rows } = await pool.query(
          `
            WITH recent AS (
              SELECT stars
              FROM event_ratings
              WHERE ratee_user_id = $1
              ORDER BY created_at DESC
              LIMIT 20
            )
            SELECT
              COUNT(*)::int AS rating_count,
              COALESCE(AVG(stars), 0)::float8 AS average_rating
            FROM recent
          `,
          [userId]
        );
        return rows?.[0] || { average_rating: 0, rating_count: 0 };
      })(),
      (async () => {
        const { rows } = await pool.query(
          `
            SELECT
              r.event_id,
              r.status,
              e.title,
              e.start_at,
              e.end_at,
              e.location_text,
              e.org_name
            FROM event_rsvps r
            JOIN events e ON e.id = r.event_id
            WHERE r.attendee_user_id = $1
              AND r.status IN ('accepted', 'pending')
              AND e.start_at > NOW()
            ORDER BY e.start_at ASC
            LIMIT 10
          `,
          [userId]
        );
        return rows;
      })(),
    ]);

    return {
      status: "success",
      profile: {
        user_id: user.id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        home_base_label: user.home_base_label || null,
        reliability_tier: user.reliability_tier || "new",
        member_since: user.created_at || null,
        ic_balance: icBalance,
        rating: {
          average: Number(ratingStats.average_rating) || 0,
          count: Number(ratingStats.rating_count) || 0,
          window: 20,
        },
        upcoming_rsvps: upcomingRsvps,
      },
    };
  } catch (error) {
    console.error("[kai-tool-executor] get_user_profile error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetIcBalance(toolInput = {}, userId) {
  try {
    if (!userId) return { status: "error", message: "User is required for this tool." };

    const includeHistory = parseBoolean(toolInput.include_history, false);
    const historyLimit = parseInteger(toolInput.history_limit, DEFAULT_HISTORY_LIMIT, { min: 1, max: 100 });
    const balance = await calculateIcBalance(userId);

    if (!includeHistory) {
      return {
        status: "success",
        balance,
      };
    }

    const { rows } = await pool.query(
      `
        SELECT
          id,
          kind_amount,
          direction,
          reason,
          event_id,
          note,
          created_at
        FROM wallet_transactions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [userId, historyLimit]
    );

    return {
      status: "success",
      balance,
      transactions: rows,
    };
  } catch (error) {
    console.error("[kai-tool-executor] get_ic_balance error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleRsvpToEvent(toolInput = {}, userId) {
  try {
    if (!userId) return { status: "error", message: "User is required for this tool." };

    const eventId = normalizeString(toolInput.event_id);
    const roleId = normalizeString(toolInput.role_id);
    if (!eventId) return { status: "error", message: "event_id is required." };

    const { rows: eventRows } = await pool.query(
      "SELECT id, title, start_at FROM events WHERE id = $1 LIMIT 1",
      [eventId]
    );
    const event = eventRows?.[0];
    if (!event) {
      return { status: "not_found", message: "Event not found." };
    }

    try {
      const supportsRoleId = roleId ? await columnExists("event_rsvps", "role_id") : false;
      if (supportsRoleId) {
        await pool.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status, role_id)
            VALUES ($1, $2, 'pending', $3)
          `,
          [eventId, userId, roleId]
        );
      } else {
        await pool.query(
          `
            INSERT INTO event_rsvps (event_id, attendee_user_id, status)
            VALUES ($1, $2, 'pending')
          `,
          [eventId, userId]
        );
      }
    } catch (error) {
      if (isDuplicateRsvpError(error)) {
        return {
          status: "already_exists",
          message: "You already have an RSVP for this event.",
        };
      }
      if (isForeignKeyError(error)) {
        return {
          status: "not_found",
          message: "Event not found.",
        };
      }
      throw error;
    }

    try {
      await recomputeReliability(userId);
    } catch (error) {
      console.error("[kai-tool-executor] rsvp_to_event compute_reliability error:", error);
    }

    return {
      status: "success",
      message: "RSVP submitted.",
      event: {
        id: event.id,
        title: event.title,
        start_at: event.start_at,
      },
    };
  } catch (error) {
    console.error("[kai-tool-executor] rsvp_to_event error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleCancelRsvp(toolInput = {}, userId) {
  try {
    if (!userId) return { status: "error", message: "User is required for this tool." };

    const eventId = normalizeString(toolInput.event_id);
    const reason = normalizeString(toolInput.reason);
    if (!eventId) return { status: "error", message: "event_id is required." };

    const { rows: eventRows } = await pool.query(
      "SELECT id, title, start_at FROM events WHERE id = $1 LIMIT 1",
      [eventId]
    );
    const event = eventRows?.[0];
    if (!event) {
      return { status: "not_found", message: "Event not found." };
    }

    const setClauses = ["status = 'declined'"];
    const values = [];

    const [hasUpdatedAt, hasNotes] = await Promise.all([
      columnExists("event_rsvps", "updated_at"),
      columnExists("event_rsvps", "notes"),
    ]);

    if (hasUpdatedAt) {
      setClauses.push("updated_at = NOW()");
    }
    if (hasNotes) {
      values.push(reason || null);
      setClauses.push(`notes = $${values.length}`);
    }

    values.push(eventId);
    const eventIdParam = values.length;
    values.push(userId);
    const userIdParam = values.length;

    const { rowCount } = await pool.query(
      `
        UPDATE event_rsvps
        SET ${setClauses.join(", ")}
        WHERE event_id = $${eventIdParam}
          AND attendee_user_id = $${userIdParam}
      `,
      values
    );

    if (!rowCount) {
      return { status: "not_found", message: "No RSVP found to cancel for this event." };
    }

    try {
      await recomputeReliability(userId);
    } catch (error) {
      console.error("[kai-tool-executor] cancel_rsvp compute_reliability error:", error);
    }

    const warning = withinFortyEightHours(event.start_at)
      ? "This cancellation is within 48 hours of the event and may impact reliability."
      : null;

    return {
      status: "success",
      message: "RSVP cancelled.",
      warning,
      event: {
        id: event.id,
        title: event.title,
        start_at: event.start_at,
      },
    };
  } catch (error) {
    console.error("[kai-tool-executor] cancel_rsvp error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetMatchedEvents() {
  try {
    // TODO: Use the 7-signal matching engine to rank events for this volunteer.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] get_matched_events error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetWeeklyDigest() {
  try {
    // TODO: Build a personalized weekly digest from upcoming opportunities.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] get_weekly_digest error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetEarningOptimization() {
  try {
    // TODO: Analyze historical earnings and recommend IC-maximizing actions.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] get_earning_optimization error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleManageSchedule() {
  try {
    // TODO: Aggregate upcoming commitments and detect scheduling conflicts.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] manage_schedule error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleAutoFindAndRsvp() {
  try {
    // TODO: Autonomously pick the best event match and submit an RSVP.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] auto_find_and_rsvp error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleDraftEventListing() {
  try {
    // TODO: Convert natural language into a structured draft event listing.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] draft_event_listing error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetMatchedVolunteers() {
  try {
    // TODO: Rank volunteers by fit for a target event and role.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] get_matched_volunteers error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleFlagNoshowRisk() {
  try {
    // TODO: Score RSVPs for no-show probability and return high-risk flags.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] flag_noshow_risk error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleSendVolunteerReminder() {
  try {
    // TODO: Deliver reminder messages to selected RSVP volunteers.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] send_volunteer_reminder error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleAutoStaffEvent() {
  try {
    // TODO: Autonomously source, invite, and manage staffing for an event.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] auto_staff_event error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGeneratePostEventReport() {
  try {
    // TODO: Build a post-event attendance and impact report for organizers.
    return { ...DEFAULT_NOT_IMPLEMENTED_RESPONSE };
  } catch (error) {
    console.error("[kai-tool-executor] generate_post_event_report error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

const TOOL_HANDLERS = {
  platform_faq: handlePlatformFaq,
  search_events: handleSearchEvents,
  get_event_details: handleGetEventDetails,
  get_user_profile: handleGetUserProfile,
  get_ic_balance: handleGetIcBalance,
  get_matched_events: handleGetMatchedEvents,
  get_weekly_digest: handleGetWeeklyDigest,
  rsvp_to_event: handleRsvpToEvent,
  cancel_rsvp: handleCancelRsvp,
  get_earning_optimization: handleGetEarningOptimization,
  manage_schedule: handleManageSchedule,
  auto_find_and_rsvp: handleAutoFindAndRsvp,
  draft_event_listing: handleDraftEventListing,
  get_matched_volunteers: handleGetMatchedVolunteers,
  flag_noshow_risk: handleFlagNoshowRisk,
  send_volunteer_reminder: handleSendVolunteerReminder,
  auto_staff_event: handleAutoStaffEvent,
  generate_post_event_report: handleGeneratePostEventReport,
};

export async function executeToolCall(toolName, toolInput = {}, userId) {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      error: true,
      message: `Unknown tool: ${toolName}`,
    };
  }
  return handler(toolInput || {}, userId);
}
