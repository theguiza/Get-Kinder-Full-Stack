import pool from "../Backend/db/pg.js";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const LIVE_EVENT_STATUSES = new Set(["published", "scheduled"]);
const UPCOMING_RSVP_STATUSES = new Set(["pending", "accepted", "waitlisted"]);

function clampLimit(value) {
  const num = Number(value);
  const fallback = Number.isFinite(num) ? num : DEFAULT_LIMIT;
  return Math.min(Math.max(fallback, 1), MAX_LIMIT);
}

function normalizePortfolioStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function parsePortfolioDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateDurationHours(startAt, endAt) {
  const start = parsePortfolioDate(startAt);
  const end = parsePortfolioDate(endAt);
  if (!start || !end) return 0;
  const ms = Math.max(0, end.getTime() - start.getTime());
  return ms > 0 ? Math.round((ms / 36e5) * 10) / 10 : 0;
}

function getPortfolioSortTimestamp(row) {
  const primaryDate = row?.is_upcoming
    ? row.start_at || row.completed_at
    : row.completed_at || row.start_at;
  const time = primaryDate instanceof Date ? primaryDate.getTime() : NaN;
  return Number.isFinite(time)
    ? time
    : row?.is_upcoming
      ? Number.MAX_SAFE_INTEGER
      : 0;
}

export function normalizeVolunteerPortfolioRows(rawRows, { now = new Date() } = {}) {
  const currentTime = parsePortfolioDate(now) || new Date();
  const sourceRows = Array.isArray(rawRows) ? rawRows : [];

  return sourceRows.map((row) => {
    const startAt = parsePortfolioDate(row?.start_at);
    const endAt = parsePortfolioDate(row?.end_at);
    const completedAt = endAt || startAt || null;
    const eventStatus = normalizePortfolioStatus(row?.event_status);
    const rsvpStatus = normalizePortfolioStatus(row?.rsvp_status);
    const verificationStatus = normalizePortfolioStatus(row?.verification_status);
    const acceptedCount = Number(row?.accepted_count) || 0;
    const poolKind = row?.reward_pool_kind != null ? Number(row.reward_pool_kind) : 0;
    const safePoolKind = Number.isFinite(poolKind) ? poolKind : 0;
    const startsInFuture = !!(startAt && startAt > currentTime);
    const isVerified = verificationStatus === "verified";
    const isCompleted = !!(completedAt && completedAt <= currentTime);
    const isUpcoming =
      startsInFuture &&
      LIVE_EVENT_STATUSES.has(eventStatus) &&
      UPCOMING_RSVP_STATUSES.has(rsvpStatus);

    return {
      ...row,
      start_at: startAt,
      end_at: endAt,
      duration_hours: calculateDurationHours(startAt, endAt),
      is_upcoming: isUpcoming,
      is_verified: isVerified,
      is_completed: isCompleted,
      is_recent_impact: isVerified || isCompleted,
      completed_at: completedAt,
      kind_estimate_per_user: Math.floor(safePoolKind / Math.max(acceptedCount, 1)),
      accepted_count: acceptedCount,
    };
  });
}

export function sortVolunteerPortfolioRows(rows = []) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return [...sourceRows].sort((left, right) => {
    if (Boolean(left?.is_upcoming) !== Boolean(right?.is_upcoming)) {
      return left?.is_upcoming ? -1 : 1;
    }

    const leftTime = getPortfolioSortTimestamp(left);
    const rightTime = getPortfolioSortTimestamp(right);
    if (leftTime !== rightTime) {
      return left?.is_upcoming ? leftTime - rightTime : rightTime - leftTime;
    }

    const leftId = String(left?.id || left?.event_id || "");
    const rightId = String(right?.id || right?.event_id || "");
    return leftId.localeCompare(rightId);
  });
}

export async function fetchVolunteerPortfolio({ userId, limit } = {}) {
  if (!userId) return [];
  const clampedLimit = clampLimit(limit);
  const { rows } = await pool.query(
    `
      SELECT
        e.id,
        e.title,
        e.category,
        e.start_at,
        e.end_at,
        e.tz,
        e.location_text,
        e.status AS event_status,
        e.reward_pool_kind,
        r.status AS rsvp_status,
        r.verification_status,
        r.checked_in_at,
        (
          SELECT COUNT(*)
            FROM event_rsvps r2
           WHERE r2.event_id = e.id
             AND r2.status IN ('accepted','checked_in')
        ) AS accepted_count
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
     WHERE r.attendee_user_id = $1
     ORDER BY e.start_at DESC NULLS LAST, e.id DESC
     LIMIT $2
    `,
    [userId, clampedLimit]
  );
  return rows;
}

export async function resolveUserIdFromRequest(req) {
  const fallback =
    req?.user?.id != null
      ? String(req.user.id)
      : req?.user?.user_id != null
        ? String(req.user.user_id)
        : null;
  const email = req?.user?.email;
  if (!email) return fallback;
  try {
    const { rows } = await pool.query(
      "SELECT id FROM userdata WHERE email = $1 LIMIT 1",
      [email]
    );
    if (rows?.[0]?.id != null) return String(rows[0].id);
  } catch (error) {
    console.warn("[profileService] resolveUserIdFromRequest failed:", error?.message || error);
  }
  return fallback;
}

export async function getVolunteerPreferenceSignals(userId) {
  if (!userId) {
    return {
      interests: [],
      home_base_label: null,
    };
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT
          interest1,
          interest2,
          interest3,
          home_base_label
        FROM userdata
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );
    const row = rows?.[0] || null;
    if (!row) {
      return {
        interests: [],
        home_base_label: null,
      };
    }

    return {
      interests: [row.interest1, row.interest2, row.interest3]
        .filter((value) => value !== null && value !== undefined)
        .map((value) => String(value).trim())
        .filter(Boolean),
      home_base_label: row.home_base_label ? String(row.home_base_label).trim() : null,
    };
  } catch (error) {
    console.error("[profileService] getVolunteerPreferenceSignals error:", error);
    return {
      interests: [],
      home_base_label: null,
    };
  }
}

function clampMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(480, Math.max(15, num));
}

function calcDurationMinutes(startAt, endAt) {
  if (!startAt || !endAt) return 0;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  return clampMinutes(diff);
}

function getWeekStartUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function computeStreakWeeks(verifiedDates) {
  if (!Array.isArray(verifiedDates) || verifiedDates.length === 0) return 0;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekStarts = Array.from(
    new Set(
      verifiedDates
        .filter(Boolean)
        .map((value) => {
          const d = new Date(value);
          if (Number.isNaN(d.getTime())) return null;
          return getWeekStartUTC(d).getTime();
        })
        .filter((value) => value !== null)
    )
  ).sort((a, b) => a - b);

  if (weekStarts.length === 0) return 0;
  let streak = 1;
  for (let i = weekStarts.length - 1; i > 0; i -= 1) {
    const current = weekStarts[i];
    const prev = weekStarts[i - 1];
    if (current - prev === weekMs) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function getVolunteerStats(userId) {
  if (!userId) {
    return {
      impact_credits_balance: 0,
      verified_minutes_total: 0,
      verified_hours_total: 0,
      verified_shifts_total: 0,
      streak_weeks: 0,
      reliability_score: 0,
      priority_tier: "Bronze",
      recent_history: [],
      upcoming: [],
    };
  }

  try {
    const { rows: noShowRows } = await pool.query(
      `
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'event_rsvps'
           AND column_name = 'no_show'
         LIMIT 1
      `
    );
    const hasNoShow = noShowRows.length > 0;

    const { rows: balanceRows } = await pool.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'credit' THEN kind_amount ELSE 0 END), 0) AS credits,
          COALESCE(SUM(CASE WHEN direction = 'debit' THEN kind_amount ELSE 0 END), 0) AS debits
        FROM wallet_transactions
        WHERE user_id = $1
      `,
      [userId]
    );
    const credits = Number(balanceRows?.[0]?.credits) || 0;
    const debits = Number(balanceRows?.[0]?.debits) || 0;
    const impactCreditsBalance = credits - debits;

    const noShowSelect = hasNoShow ? "r.no_show" : "NULL::boolean AS no_show";
    const { rows } = await pool.query(
      `
        SELECT
          r.event_id,
          r.verification_status,
          r.attended_minutes,
          r.verified_at,
          r.status AS rsvp_status,
          ${noShowSelect},
          e.title,
          e.start_at,
          e.end_at,
          e.location_text,
          e.org_name,
          e.community_tag,
          e.status AS event_status
        FROM event_rsvps r
        JOIN events e ON e.id = r.event_id
        WHERE r.attendee_user_id = $1
        ORDER BY e.start_at DESC NULLS LAST, e.id DESC
        LIMIT 50
      `,
      [userId]
    );

    let verifiedMinutesTotal = 0;
    let verifiedShiftsTotal = 0;
    let noShowCount = 0;
    const verifiedDates = [];
    const now = new Date();

    const normalizedRows = rows.map((row) => {
      const attendedMinutes =
        row.attended_minutes !== null && row.attended_minutes !== undefined
          ? Number(row.attended_minutes)
          : calcDurationMinutes(row.start_at, row.end_at);
      const safeMinutes = clampMinutes(attendedMinutes);

      if (row.verification_status === "verified") {
        verifiedMinutesTotal += safeMinutes;
        verifiedShiftsTotal += 1;
        if (row.verified_at) verifiedDates.push(row.verified_at);
      }
      if (row.no_show === true) {
        noShowCount += 1;
      }

      return {
        event_id: row.event_id,
        title: row.title,
        start_at: row.start_at,
        end_at: row.end_at,
        location_text: row.location_text,
        org_name: row.org_name,
        community_tag: row.community_tag,
        event_status: row.event_status,
        status: row.event_status,
        rsvp_status: row.rsvp_status,
        verification_status: row.verification_status,
        attended_minutes: safeMinutes,
      };
    });
    const normalizedPortfolioRows = sortVolunteerPortfolioRows(
      normalizeVolunteerPortfolioRows(normalizedRows, { now })
    );

    const verifiedHoursTotal = Math.round((verifiedMinutesTotal / 60) * 10) / 10;
    const streakWeeks = computeStreakWeeks(verifiedDates);
    const reliabilityScore = clampScore(50 + 10 * Math.min(verifiedShiftsTotal, 3) - 20 * noShowCount);

    let priorityTier = "Bronze";
    if (verifiedShiftsTotal >= 8 && reliabilityScore >= 80) {
      priorityTier = "Gold";
    } else if (verifiedShiftsTotal >= 3 && reliabilityScore >= 60) {
      priorityTier = "Silver";
    }

    const upcoming = normalizedPortfolioRows
      .filter((row) => row.is_upcoming)
      .slice(0, 10)
      .map((row) => ({
        event_id: row.event_id,
        title: row.title,
        start_at: row.start_at,
        location_text: row.location_text,
        org_name: row.org_name,
        community_tag: row.community_tag,
        status: row.status,
        rsvp_status: row.rsvp_status,
      }));

    const recentHistory = normalizedPortfolioRows
      .filter((row) => row.is_recent_impact)
      .slice(0, 10)
      .map((row) => ({
        event_id: row.event_id,
        title: row.title,
        start_at: row.start_at,
        location_text: row.location_text,
        org_name: row.org_name,
        community_tag: row.community_tag,
        status: row.status,
        verification_status: row.verification_status,
        attended_minutes: row.attended_minutes,
      }));

    return {
      impact_credits_balance: impactCreditsBalance,
      verified_minutes_total: verifiedMinutesTotal,
      verified_hours_total: verifiedHoursTotal,
      verified_shifts_total: verifiedShiftsTotal,
      streak_weeks: streakWeeks,
      reliability_score: reliabilityScore,
      priority_tier: priorityTier,
      recent_history: recentHistory,
      upcoming,
    };
  } catch (error) {
    console.error("[profileService] getVolunteerStats error:", error);
    return {
      impact_credits_balance: 0,
      verified_minutes_total: 0,
      verified_hours_total: 0,
      verified_shifts_total: 0,
      streak_weeks: 0,
      reliability_score: 0,
      priority_tier: "Bronze",
      recent_history: [],
      upcoming: [],
    };
  }
}
