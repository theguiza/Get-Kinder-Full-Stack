import pool from "../db/pg.js";
import { applyEventRsvpAction, resolveAcceptedRsvpStatus } from "../../services/eventRsvpService.js";
import { resolveHostUserIdsForUserId } from "../../services/orgScopeService.js";
import { getVolunteerStats } from "../../services/profileService.js";
import { getSummary as getRatingsSummary } from "../../services/ratingsService.js";
import { getWalletSummary } from "../../services/walletService.js";
import { fetchEventById, fetchEvents } from "../../services/eventsService.js";
import { getMatchedEventsForUser } from "../../services/eventMatchingService.js";
import { sendNudgeEmail } from "../../kindnessEmailer.js";

const IC_RATE_BY_TIER = {
  standard: 10,
  skilled: 15,
  specialist: 20,
  leadership: 30,
};

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
const GUEST_TOOL_ALLOWLIST = new Set(["search_events"]);
const GENERIC_SEARCH_STOP_WORDS = new Set([
  "find",
  "search",
  "show",
  "list",
  "browse",
  "look",
  "for",
  "volunteer",
  "volunteering",
  "events",
  "event",
  "opportunities",
  "opportunity",
  "help",
  "please",
  "weekend",
  "week",
  "today",
  "tomorrow",
  "tonight",
  "this",
  "what",
  "can",
  "should",
  "where",
  "how",
  "near",
  "nearby",
  "city",
  "location",
  "date",
  "me",
  "i",
  "do",
]);

const columnExistsCache = new Map();
const tableExistsCache = new Map();

const PLATFORM_FAQ_KB = {
  ic: {
    key: "ic",
    title: "How IC works",
    answer:
      "Impact Credits (IC) are earned from verified volunteering based on role complexity and verified time. Current tiers are 10, 15, 20, and 30 IC per hour for helper, skilled, specialist, and leadership roles.",
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

function normalizeSearchQuery(query) {
  const raw = normalizeString(query).toLowerCase();
  if (!raw) {
    return {
      normalizedQuery: "",
      broadSearch: true,
      needsLocationHint: false,
    };
  }

  const needsLocationHint = /\b(near me|nearby)\b/.test(raw);
  const stripped = raw
    .replace(/\bwhat can i do\b/g, " ")
    .replace(/\bwhat should i do\b/g, " ")
    .replace(/\bwhere can i help\b/g, " ")
    .replace(/\bwhere should i help\b/g, " ")
    .replace(/\bnear me\b/g, " ")
    .replace(/\bnearby\b/g, " ")
    .replace(/\bthis weekend\b/g, " ")
    .replace(/\bthis week\b/g, " ")
    .replace(/\b(today|tomorrow|tonight)\b/g, " ");

  const normalizedQuery = Array.from(
    new Set(
      stripped
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
        .filter((token) => !GENERIC_SEARCH_STOP_WORDS.has(token))
    )
  ).join(" ");

  return {
    normalizedQuery,
    broadSearch: normalizedQuery.length === 0,
    needsLocationHint,
  };
}

function matchesEventSearchQuery(event, query) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  if (!normalizedQuery) return true;
  const words = normalizedQuery.split(/\s+/).filter((word) => word.length > 1);
  if (!words.length) return true;
  const searchable = [
    event?.title,
    event?.description,
    event?.location_text,
    event?.community_tag,
    event?.org_name,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.toLowerCase());

  return words.some((word) => searchable.some((value) => value.includes(word)));
}

function buildSearchEventsIntro({ events, broadSearch, needsLocationHint, hasExplicitFilters }) {
  if (events.length === 0) {
    if (needsLocationHint) {
      return "I do not know your city yet. Try sharing a city or postal code, or ask for a cause like animal welfare or environment.";
    }
    if (broadSearch || !hasExplicitFilters) {
      return "I could not find public volunteer events in that window. Try adding a cause, city, or date to narrow the search.";
    }
    return "I could not find matching public volunteer events right now. Try a different cause, city, or date.";
  }

  if (needsLocationHint) {
    return "I do not know your city yet, so these are broader upcoming opportunities. Share a city to narrow the search.";
  }
  if (broadSearch) {
    return "Here are some public volunteer opportunities. Add a cause, city, or date if you want a narrower list.";
  }
  return "Here are some public volunteer opportunities that match your search.";
}

function eventMatchesCauseTags(event, causeTags) {
  if (!Array.isArray(causeTags) || !causeTags.length) return true;
  const normalizedEventTags = new Set(
    normalizeStringArray(event?.cause_tags).map((tag) => tag.toLowerCase())
  );
  return causeTags.some((tag) => normalizedEventTags.has(tag.toLowerCase()));
}

function eventStartsWithinDays(event, daysAhead) {
  const startAt = event?.start_at ? new Date(event.start_at).getTime() : Number.NaN;
  if (Number.isNaN(startAt)) return false;
  return startAt <= Date.now() + daysAhead * 24 * 60 * 60 * 1000;
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

async function isUserSuspended(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `
      SELECT COALESCE(is_suspended, false) AS is_suspended
      FROM userdata
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );
  return rows?.[0]?.is_suspended === true;
}

async function ensureKaiWriteAccess(userId) {
  if (!userId) {
    return { status: "error", message: "User is required for this tool." };
  }
  if (await isUserSuspended(userId)) {
    return {
      status: "error",
      code: "account_suspended",
      message: "Your account is suspended.",
    };
  }
  return null;
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
    const rawQuery = normalizeString(toolInput.query);
    const normalizedSearch = normalizeSearchQuery(rawQuery);
    const category = normalizeString(toolInput.category);
    const causeTags = normalizeStringArray(toolInput.cause_tags);
    const daysAhead = parseInteger(toolInput.days_ahead, DEFAULT_EVENTS_DAYS_AHEAD, { min: 1, max: 365 });
    const limit = parseInteger(toolInput.limit, DEFAULT_EVENTS_LIMIT, { min: 1, max: 50 });
    const searchWords = normalizedSearch.normalizedQuery
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 1);
    const countValues = [];
    const countFilters = [
      "e.status = 'published'",
      "COALESCE(e.end_at, e.start_at) >= NOW() - INTERVAL '2 hours'",
      "e.start_at IS NOT NULL",
    ];

    countValues.push(daysAhead);
    countFilters.push(`e.start_at <= NOW() + ($${countValues.length}::int * INTERVAL '1 day')`);

    if (searchWords.length > 0) {
      countValues.push(searchWords);
      countFilters.push(
        `
          EXISTS (
            SELECT 1
            FROM unnest($${countValues.length}::text[]) AS word
            WHERE LOWER(COALESCE(e.title, '')) LIKE '%' || word || '%'
               OR LOWER(COALESCE(e.description, '')) LIKE '%' || word || '%'
               OR LOWER(COALESCE(e.location_text, '')) LIKE '%' || word || '%'
               OR LOWER(COALESCE(e.community_tag, '')) LIKE '%' || word || '%'
               OR LOWER(COALESCE(e.org_name, '')) LIKE '%' || word || '%'
          )
        `
      );
    }

    if (category) {
      countValues.push(category);
      countFilters.push(`BTRIM(COALESCE(e.category, '')) = $${countValues.length}`);
    }

    if (causeTags.length > 0) {
      countValues.push(causeTags.map((tag) => tag.toLowerCase()));
      countFilters.push(
        `
          EXISTS (
            SELECT 1
            FROM unnest(COALESCE(e.cause_tags, ARRAY[]::text[])) AS cause_tag
            WHERE LOWER(BTRIM(cause_tag)) = ANY($${countValues.length}::text[])
          )
        `
      );
    }

    const [{ rows: countRows }, canonicalFeed] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*)::int AS total_matching
          FROM events e
          WHERE ${countFilters.join(" AND ")}
        `,
        countValues
      ),
      fetchEvents({
        view: "upcoming",
        limit: 100,
      }),
    ]);
    const events = (Array.isArray(canonicalFeed?.events) ? canonicalFeed.events : [])
      .filter((event) => eventStartsWithinDays(event, daysAhead))
      .filter((event) => matchesEventSearchQuery(event, normalizedSearch.normalizedQuery))
      .filter((event) => !category || normalizeString(event?.category) === category)
      .filter((event) => eventMatchesCauseTags(event, causeTags))
      .slice(0, limit);

    return {
      status: "success",
      intro: buildSearchEventsIntro({
        events,
        broadSearch: normalizedSearch.broadSearch,
        needsLocationHint: normalizedSearch.needsLocationHint,
        hasExplicitFilters: Boolean(normalizedSearch.normalizedQuery || category || causeTags.length),
      }),
      search_context: {
        broad_search: normalizedSearch.broadSearch,
        needs_location_hint: normalizedSearch.needsLocationHint,
      },
      events,
      total_returned: events.length,
      limit_applied: limit,
      total_matching: Number(countRows?.[0]?.total_matching) || 0,
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

    const event = await fetchEventById(eventId);
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
              COUNT(*) FILTER (WHERE status IN ('accepted', 'checked_in')) AS accepted,
              COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in,
              COUNT(*) FILTER (WHERE status = 'waitlisted') AS waitlisted
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
          accepted: Number(rsvpSummaryRow.accepted) || Number(event?.rsvp_counts?.accepted) || 0,
          checked_in: Number(rsvpSummaryRow.checked_in) || 0,
          waitlisted: Number(rsvpSummaryRow.waitlisted) || 0,
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

    const [volunteerStats, ratingsSummary, walletSummary] = await Promise.all([
      getVolunteerStats(userId),
      (async () => {
        try {
          return await getRatingsSummary({ userId, limit: 20 });
        } catch (error) {
          if (error?.code !== "42P01") {
            console.warn("[kai-tool-executor] get_user_profile ratings summary failed:", error);
          }
          return {
            kindnessRating: null,
            sampleSize: 0,
            limit: 20,
          };
        }
      })(),
      (async () => {
        try {
          return await getWalletSummary({ userId });
        } catch (error) {
          console.warn("[kai-tool-executor] get_user_profile wallet summary failed:", error);
          return {
            balance: 0,
            earned_lifetime: 0,
            donated_lifetime: 0,
            earnable_this_week: 0,
          };
        }
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
        member_since: user.created_at || null,
        ic_balance: Number(walletSummary?.balance) || 0,
        wallet_summary: walletSummary,
        verified_minutes_total: Number(volunteerStats?.verified_minutes_total) || 0,
        verified_hours_total: Number(volunteerStats?.verified_hours_total) || 0,
        verified_shifts_total: Number(volunteerStats?.verified_shifts_total) || 0,
        streak_weeks: Number(volunteerStats?.streak_weeks) || 0,
        reliability_score: Number(volunteerStats?.reliability_score) || 0,
        priority_tier: volunteerStats?.priority_tier || "Bronze",
        rating: {
          average:
            ratingsSummary?.kindnessRating !== null && ratingsSummary?.kindnessRating !== undefined
              ? Number(ratingsSummary.kindnessRating)
              : null,
          count: Number(ratingsSummary?.sampleSize) || 0,
          window: Number(ratingsSummary?.limit) || 20,
        },
        upcoming_rsvps: Array.isArray(volunteerStats?.upcoming) ? volunteerStats.upcoming : [],
        recent_history: Array.isArray(volunteerStats?.recent_history) ? volunteerStats.recent_history : [],
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
    const writeAccessError = await ensureKaiWriteAccess(userId);
    if (writeAccessError) return writeAccessError;

    const eventId = normalizeString(toolInput.event_id);
    const roleId = normalizeString(toolInput.role_id);
    if (!eventId) return { status: "error", message: "event_id is required." };
    const hostUserIds = await resolveHostUserIdsForUserId(userId);
    const result = await applyEventRsvpAction({
      eventId,
      attendeeId: userId,
      action: "accept",
      hostUserIds,
      roleId,
    });
    if (!result.ok) {
      if (result.statusCode === 404) {
        return { status: "not_found", code: result.code, message: result.error };
      }
      return { status: "error", ...(result.code ? { code: result.code } : {}), message: result.error };
    }

    try {
      await recomputeReliability(userId);
    } catch (error) {
      console.error("[kai-tool-executor] rsvp_to_event compute_reliability error:", error);
    }

    return {
      status: "success",
      message: result.data.message || "RSVP submitted.",
      rsvp_status: result.data.status,
      event: result.data.event,
    };
  } catch (error) {
    console.error("[kai-tool-executor] rsvp_to_event error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleCancelRsvp(toolInput = {}, userId) {
  try {
    const writeAccessError = await ensureKaiWriteAccess(userId);
    if (writeAccessError) return writeAccessError;

    const eventId = normalizeString(toolInput.event_id);
    const reason = normalizeString(toolInput.reason);
    if (!eventId) return { status: "error", message: "event_id is required." };
    const hostUserIds = await resolveHostUserIdsForUserId(userId);
    const result = await applyEventRsvpAction({
      eventId,
      attendeeId: userId,
      action: "decline",
      hostUserIds,
      reason: reason || null,
      requireExistingForDecline: true,
    });
    if (!result.ok) {
      if (result.statusCode === 404) {
        return { status: "not_found", code: result.code, message: result.error };
      }
      return { status: "error", ...(result.code ? { code: result.code } : {}), message: result.error };
    }

    try {
      await recomputeReliability(userId);
    } catch (error) {
      console.error("[kai-tool-executor] cancel_rsvp compute_reliability error:", error);
    }

    const warning = withinFortyEightHours(result.data.event?.start_at)
      ? "This cancellation is within 48 hours of the event and may impact reliability."
      : null;

    return {
      status: "success",
      message: "RSVP cancelled.",
      warning,
      event: result.data.event,
    };
  } catch (error) {
    console.error("[kai-tool-executor] cancel_rsvp error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetMatchedEvents(toolInput = {}, userId) {
  try {
    const daysAhead = parseInteger(toolInput.days_ahead, 14, { min: 1, max: 365 });
    const limit = parseInteger(toolInput.limit, 5, { min: 1, max: 20 });
    const minScore = parseInteger(toolInput.min_score, 30, { min: 0, max: 100 });
    return getMatchedEventsForUser({
      userId,
      daysAhead,
      limit,
      minScore,
    });
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

async function handleDraftEventListing(toolInput = {}, _userId, orgId) {
  try {
    if (orgId === null || orgId === undefined) {
      return { error: true, message: "Event creation requires an org rep account." };
    }

    const description = normalizeString(toolInput.description);
    const date = normalizeString(toolInput.date);
    const location = normalizeString(toolInput.location);
    const volunteerCountRaw = parseInteger(toolInput.volunteer_count, null, { min: 1 });

    const { rows } = await pool.query(
      "SELECT name FROM organizations WHERE id = $1",
      [orgId]
    );
    const orgName = rows?.[0]?.name ?? null;

    return {
      draft: {
        org_name: orgName,
        title: null,
        description,
        location_text: location || null,
        start_at: date || null,
        capacity: volunteerCountRaw,
        status: "draft",
        visibility: "public",
        verification_method: "host_attest",
        impact_credits_base: 10,
        waitlist_enabled: true,
        cause_tags: [],
        attendance_methods: [],
      },
      next_step: "Review this draft and complete missing fields (title, exact date/time, cause tags) in the event editor before publishing.",
    };
  } catch (error) {
    console.error("[kai-tool-executor] draft_event_listing error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGetMatchedVolunteers(toolInput = {}, _userId, orgId) {
  try {
    const eventId = normalizeString(toolInput.event_id);
    const roleId = normalizeString(toolInput.role_id);
    const limit = parseInteger(toolInput.limit, 10, { min: 1, max: 100 });
    const minReliability = normalizeString(toolInput.min_reliability).toLowerCase() || "any";

    const reliabilityRank = (tier) => {
      const normalizedTier = normalizeString(tier).toLowerCase();
      if (normalizedTier === "super") return 3;
      if (normalizedTier === "high") return 2;
      if (normalizedTier === "standard") return 1;
      return 0;
    };

    const { rows: eventRows } = await pool.query(
      `
        SELECT e.id
        FROM events e
        JOIN userdata u ON u.id = e.creator_user_id
        WHERE e.id = $1 AND u.org_id = $2
      `,
      [eventId, orgId]
    );
    if (!eventRows?.[0]?.id) {
      return { error: true, message: "Event not found or access denied." };
    }

    let requiredSkillIds = [];
    if (roleId) {
      const { rows: roleSkillRows } = await pool.query(
        "SELECT skill_id, required FROM event_role_skills WHERE role_id = $1",
        [roleId]
      );
      requiredSkillIds = (roleSkillRows || [])
        .filter((row) => row?.required === true)
        .map((row) => row.skill_id)
        .filter((skillId) => skillId !== null && skillId !== undefined);
    }

    const { rows: candidateRows } = await pool.query(
      `
        SELECT u.id, u.firstname, u.lastname, u.reliability_tier, u.reliability_score,
               u.home_base_label
        FROM userdata u
        WHERE u.id NOT IN (
          SELECT attendee_user_id FROM event_rsvps
          WHERE event_id = $1 AND status IN ('accepted','checked_in')
        )
        AND u.is_suspended = false
        AND u.email_verified = true
        LIMIT 100
      `,
      [eventId]
    );

    let matchedSkillsByUserId = new Map();
    if (requiredSkillIds.length > 0 && candidateRows.length > 0) {
      const candidateIds = candidateRows.map((row) => row.id);
      const { rows: skillMatchRows } = await pool.query(
        `
          SELECT vs.user_id, COUNT(*)::int AS matched_skills
          FROM volunteer_skills vs
          WHERE vs.user_id = ANY($1::int[])
            AND vs.skill_id = ANY($2::int[])
            AND (vs.verified = true OR vs.self_reported = true)
          GROUP BY vs.user_id
        `,
        [candidateIds, requiredSkillIds]
      );
      matchedSkillsByUserId = new Map(
        (skillMatchRows || []).map((row) => [row.user_id, Number(row.matched_skills) || 0])
      );
    }

    const minReliabilityRank = reliabilityRank(minReliability);
    const matches = (candidateRows || [])
      .map((candidate) => {
        const reliabilityScore = Number(candidate.reliability_score) || 0;
        const matchedSkills = matchedSkillsByUserId.get(candidate.id) || 0;
        const score = matchedSkills * 10 + reliabilityScore;
        return {
          user_id: candidate.id,
          name: [candidate.firstname, candidate.lastname].filter(Boolean).join(" ").trim(),
          reliability_tier: candidate.reliability_tier ?? null,
          reliability_score: reliabilityScore,
          home_base_label: candidate.home_base_label ?? null,
          matched_skills: matchedSkills,
          score,
        };
      })
      .filter((candidate) => reliabilityRank(candidate.reliability_tier) >= minReliabilityRank)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return {
      event_id: eventId,
      role_id: roleId || null,
      matches,
    };
  } catch (error) {
    console.error("[kai-tool-executor] get_matched_volunteers error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleFlagNoshowRisk(toolInput = {}, _userId, orgId) {
  try {
    const eventId = normalizeString(toolInput.event_id);

    const { rows: eventRows } = await pool.query(
      `
        SELECT e.id, e.title, e.start_at FROM events e
        JOIN userdata u ON u.id = e.creator_user_id
        WHERE e.id = $1 AND u.org_id = $2
      `,
      [eventId, orgId]
    );
    const event = eventRows?.[0];
    if (!event) {
      return { error: true, message: "Event not found or access denied." };
    }

    const { rows: rsvpRows } = await pool.query(
      `
        SELECT r.attendee_user_id, r.role_id, r.created_at as rsvp_created_at,
               u.firstname, u.lastname, u.reliability_tier, u.reliability_score
        FROM event_rsvps r
        JOIN userdata u ON u.id = r.attendee_user_id
        WHERE r.event_id = $1
        AND r.status = 'accepted'
      `,
      [eventId]
    );

    const eventStartTime = event.start_at ? new Date(event.start_at).getTime() : Number.NaN;
    const flagged = (rsvpRows || [])
      .map((row) => {
        let riskScore = 0;
        const reliabilityTier = normalizeString(row.reliability_tier).toLowerCase() || null;
        const reliabilityScore =
          row.reliability_score === null || row.reliability_score === undefined
            ? null
            : Number(row.reliability_score);

        if (reliabilityTier === null || reliabilityTier === "new") {
          riskScore += 40;
        } else if (reliabilityTier === "standard") {
          riskScore += 20;
        } else if (reliabilityTier === "high") {
          riskScore += 5;
        }

        if (reliabilityScore !== null && reliabilityScore < 60) {
          riskScore += 20;
        }
        if (reliabilityScore !== null && reliabilityScore < 40) {
          riskScore += 20;
        }

        const rsvpCreatedAtTime = row.rsvp_created_at ? new Date(row.rsvp_created_at).getTime() : Number.NaN;
        const leadTimeMs = eventStartTime - rsvpCreatedAtTime;
        if (
          Number.isFinite(eventStartTime) &&
          Number.isFinite(rsvpCreatedAtTime) &&
          leadTimeMs >= 0 &&
          leadTimeMs <= 24 * 60 * 60 * 1000
        ) {
          riskScore += 15;
        }

        return {
          user_id: row.attendee_user_id,
          name: [row.firstname, row.lastname].filter(Boolean).join(" ").trim(),
          reliability_tier: row.reliability_tier ?? null,
          reliability_score: reliabilityScore,
          risk_score: riskScore,
          rsvp_created_at: row.rsvp_created_at ?? null,
        };
      })
      .filter((row) => row.risk_score >= 50)
      .sort((left, right) => right.risk_score - left.risk_score);

    return {
      event_id: event.id,
      title: event.title ?? null,
      start_at: event.start_at ?? null,
      total_accepted: rsvpRows?.length || 0,
      high_risk_count: flagged.length,
      flagged,
    };
  } catch (error) {
    console.error("[kai-tool-executor] flag_noshow_risk error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleSendVolunteerReminder(toolInput = {}, _userId, orgId) {
  try {
    const eventId = normalizeString(toolInput.event_id);
    const message = normalizeString(toolInput.message);
    const volunteerIds = Array.isArray(toolInput.volunteer_ids)
      ? toolInput.volunteer_ids
          .map((value) => parseInteger(value, Number.NaN))
          .filter((value) => Number.isInteger(value))
      : [];

    if (!eventId) {
      return { error: true, message: "event_id is required." };
    }
    if (!message) {
      return { error: true, message: "message is required." };
    }

    const { rows: eventRows } = await pool.query(
      `
        SELECT e.id, e.title, e.start_at FROM events e
        JOIN userdata u ON u.id = e.creator_user_id
        WHERE e.id = $1 AND u.org_id = $2
      `,
      [eventId, orgId]
    );
    const event = eventRows?.[0];
    if (!event) {
      return { error: true, message: "Event not found or access denied." };
    }

    const recipientQuery = volunteerIds.length > 0
      ? `
          SELECT u.id, u.firstname, u.email FROM userdata u
          JOIN event_rsvps r ON r.attendee_user_id = u.id
          WHERE r.event_id = $1
          AND r.status IN ('accepted','checked_in')
          AND u.id = ANY($2::int[])
          AND u.email_verified = true
          AND u.is_suspended = false
        `
      : `
          SELECT u.id, u.firstname, u.email FROM userdata u
          JOIN event_rsvps r ON r.attendee_user_id = u.id
          WHERE r.event_id = $1
          AND r.status IN ('accepted','checked_in')
          AND u.email_verified = true
          AND u.is_suspended = false
        `;
    const recipientParams = volunteerIds.length > 0 ? [eventId, volunteerIds] : [eventId];
    const { rows: recipientRows } = await pool.query(recipientQuery, recipientParams);

    if (!recipientRows?.length) {
      return { sent: 0, message: "No eligible recipients found." };
    }

    const sendResults = await Promise.allSettled(
      recipientRows.map((recipient) =>
        sendNudgeEmail({
          to: recipient.email,
          subject: `Reminder: ${event.title}`,
          text: message,
          html: `<p>${message}</p>`,
          fromName: "KAI via Get Kinder",
          sendByKai: true,
        })
      )
    );

    const sent = sendResults.filter((result) => result.status === "fulfilled").length;
    const failed = sendResults.filter((result) => result.status === "rejected").length;

    return {
      sent,
      failed,
      event_id: event.id,
      title: event.title ?? null,
    };
  } catch (error) {
    console.error("[kai-tool-executor] send_volunteer_reminder error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleAutoStaffEvent(toolInput = {}, _userId, orgId) {
  try {
    const eventId = normalizeString(toolInput.event_id);
    const requestedStrategy = normalizeString(toolInput.strategy).toLowerCase();
    const strategy = ["conservative", "balanced", "aggressive"].includes(requestedStrategy)
      ? requestedStrategy
      : "balanced";

    const { rows: eventRows } = await pool.query(
      `
        SELECT e.id
        FROM events e
        JOIN userdata u ON u.id = e.creator_user_id
        WHERE e.id = $1 AND u.org_id = $2
      `,
      [eventId, orgId]
    );
    if (!eventRows?.[0]?.id) {
      return { error: true, message: "Event not found or access denied." };
    }

    const { rows: roleRows } = await pool.query(
      `
        SELECT id, title, spots_needed, spots_filled, tier
        FROM event_roles
        WHERE event_id = $1
        AND spots_filled < spots_needed
      `,
      [eventId]
    );

    const minReliabilityByStrategy = {
      conservative: "high",
      balanced: "standard",
      aggressive: "any",
    };

    const roles = await Promise.all(
      (roleRows || []).map(async (role) => {
        const spotsOpen = Math.max(0, (Number(role.spots_needed) || 0) - (Number(role.spots_filled) || 0));
        const candidatesResult = await handleGetMatchedVolunteers(
          {
            event_id: eventId,
            role_id: role.id,
            limit: spotsOpen * 2,
            min_reliability: minReliabilityByStrategy[strategy],
          },
          _userId,
          orgId
        );

        return {
          role_id: role.id,
          title: role.title ?? null,
          spots_open: spotsOpen,
          candidates: Array.isArray(candidatesResult?.matches) ? candidatesResult.matches : [],
        };
      })
    );

    return {
      event_id: eventId,
      strategy,
      roles,
      next_step: "Review these candidates and use send_volunteer_reminder to reach out, or invite them directly through the event roster.",
    };
  } catch (error) {
    console.error("[kai-tool-executor] auto_staff_event error:", error);
    return GENERIC_ERROR_RESPONSE;
  }
}

async function handleGeneratePostEventReport(toolInput = {}, _userId, orgId) {
  try {
    const eventId = normalizeString(toolInput.event_id);

    const { rows: eventRows } = await pool.query(
      `
        SELECT e.id, e.title, e.start_at, e.capacity FROM events e
        JOIN userdata u ON u.id = e.creator_user_id
        WHERE e.id = $1 AND u.org_id = $2
      `,
      [eventId, orgId]
    );
    const event = eventRows?.[0];
    if (!event) {
      return { error: true, message: "Event not found or access denied." };
    }

    const [
      { rows: summaryRows },
      { rows: rosterRows },
      { rows: creditRows },
      { rows: noShowRows },
    ] = await Promise.all([
      pool.query(
        `
          SELECT status, COUNT(*) as count
          FROM event_rsvps
          WHERE event_id = $1
          GROUP BY status
        `,
        [eventId]
      ),
      pool.query(
        `
          SELECT u.id, u.firstname, u.lastname, r.role_id,
                 r.verified_at, r.no_show, r.attended_minutes
          FROM event_rsvps r
          JOIN userdata u ON u.id = r.attendee_user_id
          WHERE r.event_id = $1
          AND r.status = 'checked_in'
        `,
        [eventId]
      ),
      pool.query(
        `
          SELECT COUNT(*) as pending_count, COALESCE(SUM(amount),0) as total_ic
          FROM pending_credit_requests
          WHERE event_id = $1 AND status = 'pending'
        `,
        [eventId]
      ),
      pool.query(
        `
          SELECT COUNT(*) AS no_show_count
          FROM event_rsvps
          WHERE event_id = $1 AND no_show = true
        `,
        [eventId]
      ),
    ]);

    const summaryCounts = new Map(
      (summaryRows || []).map((row) => [normalizeString(row.status).toLowerCase(), Number(row.count) || 0])
    );
    const creditSummary = creditRows?.[0] || {};

    return {
      event_id: event.id,
      title: event.title ?? null,
      start_at: event.start_at ?? null,
      capacity: event.capacity ?? null,
      summary: {
        accepted: summaryCounts.get("accepted") || 0,
        checked_in: summaryCounts.get("checked_in") || 0,
        declined: summaryCounts.get("declined") || 0,
        waitlisted: summaryCounts.get("waitlisted") || 0,
        no_show_count: Number(noShowRows?.[0]?.no_show_count) || 0,
      },
      roster: (rosterRows || []).map((row) => ({
        user_id: row.id,
        name: [row.firstname, row.lastname].filter(Boolean).join(" ").trim(),
        role_id: row.role_id ?? null,
        verified_at: row.verified_at ?? null,
        attended_minutes: Number(row.attended_minutes) || 0,
      })),
      credits: {
        pending_requests: Number(creditSummary.pending_count) || 0,
        total_ic_pending: Number(creditSummary.total_ic) || 0,
      },
    };
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
  draft_event_listing: (toolInput, userId, orgId) => handleDraftEventListing(toolInput, userId, orgId),
  get_matched_volunteers: (toolInput, userId, orgId) => handleGetMatchedVolunteers(toolInput, userId, orgId),
  flag_noshow_risk: (toolInput, userId, orgId) => handleFlagNoshowRisk(toolInput, userId, orgId),
  send_volunteer_reminder: (toolInput, userId, orgId) => handleSendVolunteerReminder(toolInput, userId, orgId),
  auto_staff_event: (toolInput, userId, orgId) => handleAutoStaffEvent(toolInput, userId, orgId),
  generate_post_event_report: (toolInput, userId, orgId) => handleGeneratePostEventReport(toolInput, userId, orgId),
};

export async function executeToolCall(toolName, toolInput = {}, userId, orgId) {
  if ((userId === null || userId === undefined) && !GUEST_TOOL_ALLOWLIST.has(toolName)) {
    return {
      status: "error",
      code: "login_required",
      message: "Please sign in to use that feature.",
    };
  }
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return {
      error: true,
      message: `Unknown tool: ${toolName}`,
    };
  }
  return handler(toolInput || {}, userId, orgId);
}

export const __testables = {
  ensureKaiWriteAccess,
  isUserSuspended,
  normalizeSearchQuery,
  buildSearchEventsIntro,
  resolveAcceptedRsvpStatus,
};
