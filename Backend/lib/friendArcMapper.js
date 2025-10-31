import { progressPercent } from "../../shared/metrics.js";

const DEFAULT_LIFETIME = {
  xp: 0,
  total_xp: 0,
  totalXp: 0,
  streak: "0 days",
  streak_days: 0,
  days: 0,
  current_streak: 0,
  currentStreak: 0,
  drag: "0%",
  drag_percent: 0,
  dragPercent: 0,
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const parseNumericToken = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizeLifetime(raw) {
  const source = isPlainObject(raw) ? JSON.parse(JSON.stringify(raw)) : {};

  const xpCandidate =
    toFiniteNumber(source.xp) ??
    toFiniteNumber(source.total_xp) ??
    toFiniteNumber(source.totalXp) ??
    0;
  const xp = Math.max(0, Math.round(xpCandidate));

  const daysCandidate =
    toFiniteNumber(source.streak_days) ??
    toFiniteNumber(source.days) ??
    toFiniteNumber(source.current_streak) ??
    toFiniteNumber(source.currentStreak) ??
    parseNumericToken(source.streak) ??
    0;
  const days = Math.max(0, Math.round(daysCandidate));

  let dragPercent =
    toFiniteNumber(source.drag_percent) ?? toFiniteNumber(source.dragPercent);
  if (dragPercent === null) {
    dragPercent = parseNumericToken(source.drag);
  }

  const drag =
    typeof source.drag === "string" && source.drag.trim()
      ? source.drag.trim()
      : dragPercent !== null
      ? `${dragPercent}%`
      : DEFAULT_LIFETIME.drag;

  const streakLabel =
    typeof source.streak === "string" && source.streak.trim()
      ? source.streak
      : `${days} ${days === 1 ? "day" : "days"}`;

  return {
    ...DEFAULT_LIFETIME,
    ...source,
    xp,
    total_xp: xp,
    totalXp: xp,
    streak_days: days,
    days,
    current_streak: days,
    currentStreak: days,
    streak: streakLabel,
    drag,
    ...(dragPercent !== null ? { drag_percent: dragPercent, dragPercent } : {}),
  };
}

export const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const toSafeString = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str.length ? str : fallback;
};

export const toArray = (value) => (Array.isArray(value) ? value : []);

const toObjectOrNull = (value) => (value && typeof value === "object" ? value : null);

export function mapFriendArcRow(row) {
  if (!row || typeof row !== "object") {
    return {
      id: null,
      name: "Friend",
      day: 0,
      length: 0,
      arcPoints: 0,
      nextThreshold: 100,
      pointsToday: 0,
      friendScore: null,
      friendType: null,
      lifetime: { xp: 0, streak: "0 days", drag: "0%" },
      steps: [],
      challenge: null,
      badges: {},
      percent: 0,
    };
  }

  const nextThresholdRaw = toNumber(row.next_threshold, 0);
  const nextThreshold = nextThresholdRaw > 0 ? nextThresholdRaw : 100;
  const arcPoints = toNumber(row.arc_points, 0);

  const arc = {
    id: row.id,
    name: toSafeString(row.name, row.friend_name || `Friend ${row.id ?? ""}`),
    day: Math.max(0, toNumber(row.day, 0)),
    length: Math.max(0, toNumber(row.length, 0)),
    arcPoints,
    nextThreshold,
    pointsToday: Math.max(0, toNumber(row.points_today, 0)),
    friendScore: row.friend_score == null ? null : toNumber(row.friend_score, 0),
    friendType: toSafeString(row.friend_type, null) || null,
    lifetime: normalizeLifetime(row.lifetime),
    steps: toArray(row.steps),
    challenge: toObjectOrNull(row.challenge),
    badges: toObjectOrNull(row.badges) ?? {},
  };

  arc.percent = progressPercent(arc.arcPoints, arc.nextThreshold);
  arc.friend_id = arc.id; // temporary compatibility until UI stops referencing friend_id
  return arc;
}
