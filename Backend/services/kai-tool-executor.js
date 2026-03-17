import pool from "../db/pg.js";
import { applyEventRsvpAction, resolveAcceptedRsvpStatus } from "../../services/eventRsvpService.js";
import { resolveHostUserIdsForUserId } from "../../services/orgScopeService.js";
import { getVolunteerStats } from "../../services/profileService.js";
import { getSummary as getRatingsSummary } from "../../services/ratingsService.js";
import { getWalletSummary } from "../../services/walletService.js";
import { fetchEventById, fetchEvents } from "../../services/eventsService.js";
import { getMatchedEventsForUser } from "../../services/eventMatchingService.js";

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
    const canonicalFeed = await fetchEvents({
      view: "upcoming",
      limit: 100,
    });
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
  return handler(toolInput || {}, userId);
}

export const __testables = {
  ensureKaiWriteAccess,
  isUserSuspended,
  normalizeSearchQuery,
  buildSearchEventsIntro,
  resolveAcceptedRsvpStatus,
};
