import { progressPercent } from "../../shared/metrics.js";

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
    lifetime: toObjectOrNull(row.lifetime) ?? { xp: 0, streak: "0 days", drag: "0%" },
    steps: toArray(row.steps),
    challenge: toObjectOrNull(row.challenge),
    badges: toObjectOrNull(row.badges) ?? {},
  };

  arc.percent = progressPercent(arc.arcPoints, arc.nextThreshold);
  arc.friend_id = arc.id; // temporary compatibility until UI stops referencing friend_id
  return arc;
}
