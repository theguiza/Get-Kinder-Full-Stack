// frontend/friendChallenges.jsx
// Get Kinder — Progress & Challenges (Mid-Fi Mockup)
// Single-file React component (Tailwind)
// Notes: Mid-fi mockup to visualize structure, hierarchy, copy, and friend switching.

import React, { useState } from "react";
import { progressPercent, clampPct, dayLabel as sharedDayLabel } from "../shared/metrics.js";

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB client-side guard
const DAILY_SURPRISE_LIMIT = 3;

const readCsrfToken = () => {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute("content") : null;
};

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `arc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function postJSON(url, body = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const token = readCsrfToken();
  if (token) headers["X-CSRF-Token"] = token;
  headers["Idempotency-Key"] = makeIdempotencyKey();

  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("Content-Type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (!payload) {
    return {};
  }

  const arc = payload.arc;
  if (arc && typeof arc === "object") {
    const serverPercent = arc.percent;
    const computedPercent = Number.isFinite(serverPercent)
      ? clampPct(serverPercent)
      : clampPct(progressPercent(arc.arcPoints, arc.nextThreshold));
    payload.arc = { ...arc, percent: computedPercent };
  }

  return payload;
}

// Minimal inline icons (replaces lucide-react dependency)
const Svg = ({ children, size = 20, className, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
    {...rest}
  >
    {children}
  </svg>
);
const CheckCircle2 = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
const Circle = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
  </Svg>
);
const Clock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Svg>
);
const Lock = (p) => (
  <Svg {...p}>
    <rect x="4" y="11" width="16" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
);
const Flame = (p) => (
  <Svg {...p}>
    <path d="M12 2C12 6 7 7 7 12a5 5 0 0 0 10 0c0-4-5-5-5-10z" />
  </Svg>
);
const Handshake = (p) => (
  <Svg {...p}>
    <path d="M4 12l4-4 4 4 4-4 4 4" />
    <path d="M8 12l4 4 4-4" />
  </Svg>
);
const Info = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Svg>
);
const ChevronRight = (p) => (
  <Svg {...p}>
    <path d="M9 18l6-6-6-6" />
  </Svg>
);
const Camera = (p) => (
  <Svg {...p}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </Svg>
);
const Award = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="5" />
    <path d="M8.5 13L7 22l5-3 5 3-1.5-9" />
  </Svg>
);

// -------------------------------
// Helpers
// -------------------------------
const SectionCard = ({ title, subtitle, children, className = "" }) => (
  <section
    className={`w-full max-w-full bg-white/90 backdrop-blur rounded-2xl shadow-sm border border-slate-200 overflow-hidden ${className}`}
  >
    {(title || subtitle) && (
      <header className="px-3.5 pt-3 pb-1.5 md:px-5 md:pt-4 md:pb-2 border-b border-slate-100">
        <h2 className="text-[var(--ink)] text-base md:text-xl font-semibold flex items-center gap-2">{title}</h2>
        {subtitle && <p className="text-slate-500 text-xs md:text-sm mt-1">{subtitle}</p>}
      </header>
    )}
    <div className="p-4 md:p-5">{children}</div>
  </section>
);

const Pill = ({ children, tone = "muted" }) => {
  const tones = {
    muted: "bg-[var(--canvas)] text-slate-600 border border-slate-200",
    coral: "bg-[var(--coral)]/10 text-[var(--coral)] border border-[var(--coral)]/20",
    ink: "bg-[var(--ink)]/10 text-[var(--ink)] border border-[var(--ink)]/20",
    warn: "bg-amber-50 text-amber-700 border border-amber-200",
    ok: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  };
  const klass = tones[tone] || tones.muted;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${klass}`}>{children}</span>
  );
};

// Friend photo placeholder (shows camera icon until a photo is uploaded)
const FriendPhoto = ({
  src,
  name = "Friend",
  size = "clamp(56px, 14vw, 80px)",
  onPick,
  loading = false,
}) => {
  const fileRef = React.useRef(null);
  const openPicker = React.useCallback(() => {
    if (loading) return;
    fileRef.current?.click();
  }, [loading]);

  const handleChange = React.useCallback(
    (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      onPick?.(file);
      event.target.value = "";
    },
    [onPick]
  );

  const buttonLabel = loading ? "Uploading..." : src ? "Change photo" : "Add photo";

  return (
    <div className="grid gap-1 place-items-center">
      {src ? (
        <img
          src={src}
          alt={`Photo of ${name}`}
          className="object-cover rounded-full border border-slate-200"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="rounded-full border-2 border-dashed border-slate-300 bg-slate-50 grid place-items-center text-slate-400"
          style={{ width: size, height: size }}
          aria-label={`Upload a photo of ${name}`}
        >
          <Camera size={22} aria-hidden />
        </div>
      )}
      <button
        type="button"
        onClick={openPicker}
        disabled={loading}
        className={`text-[11px] text-[var(--ink)] underline decoration-dotted underline-offset-2 ${
          loading ? "opacity-60 cursor-not-allowed" : "hover:opacity-80"
        }`}
      >
        {buttonLabel}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
};

// Level labels (order is important for the ladder)
const LEVEL_LABELS = ["Acquaintance", "Casual Friend", "Friend", "Close Friend", "Best Friend"];

// Visual badge component with brand ring, responsive sizing, and lock overlay
const BadgeArt = ({ state = "locked", label, src }) => {
  const [errored, setErrored] = React.useState(false);
  const size = "clamp(56px, 9vw, 96px)"; // small phones → desktops
  const base = "relative rounded-full grid place-items-center border mx-auto transition-all";
  const ring =
    state === "done"
      ? "bg-[var(--coral)]/6 border-[var(--coral)]/40 shadow-sm"
      : state === "inProgress"
      ? "bg-[var(--canvas)] border-slate-300"
      : "bg-white border-slate-200 opacity-70";
  const showImg = !!src && !errored;
  return (
    <div className={`${base} ${ring}`} style={{ width: size, height: size }} aria-label={`${label} badge ${state}`}>
      <div className={`w-full h-full rounded-full overflow-hidden ${state === "done" ? "p-1.5" : "p-1"}`}>
        {showImg ? (
          <img
            src={src}
            alt={`${label} badge`}
            className="w-full h-full rounded-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="w-full h-full grid place-items-center bg-white/60">
            <Award size={28} aria-hidden className={state === "done" ? "text-[var(--coral)]" : "text-slate-400"} />
          </div>
        )}
      </div>
      {state === "locked" && (
        <div className="absolute top-1 right-1 bg-white rounded-full border border-slate-200 p-1 shadow-sm" aria-hidden>
          <Lock size={12} className="text-slate-400" />
        </div>
      )}
    </div>
  );
};

// -------------------------------
// Progress ring utilities (fixes for inline style + tests)
// -------------------------------
export const makeConicStroke = (percent) => {
  const clamped = clampPct(percent);
  const endDeg = (clamped / 100) * 360; // numeric degrees
  // Return a valid CSS conic-gradient() string that uses our CSS variable token
  return `conic-gradient(var(--coral) ${endDeg}deg, #e6eaf2 ${endDeg}deg 360deg)`;
};

// Formatting helpers for quiz-backed values
export const formatFriendScore = (score) => {
  if (typeof score === "number" && isFinite(score)) return String(Math.max(0, Math.min(100, Math.round(score))));
  return "No Quiz score";
};
export const formatFriendType = (type) => {
  return type && String(type).trim().length > 0 ? String(type) : "No Quiz result";
};

export const isMissingQuiz = (score, type) => {
  const hasScore = typeof score === "number" && isFinite(score);
  const hasType = !!(type && String(type).trim().length > 0);
  return !hasScore && !hasType;
};

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const safeText = (value) => (typeof value === "string" ? value.trim() : "");
const toIdString = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};
const pickFinite = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
};

const toDomSafeId = (value, fallback = "item") => {
  const str = String(value ?? "").trim();
  const sanitized = str.replace(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized.length ? sanitized : fallback;
};

const normalizeStepStatusValue = (value) => {
  const raw = safeText(value);
  if (!raw) return "todo";
  const token = raw.toLowerCase().replace(/[\s_-]+/g, "");
  switch (token) {
    case "todo":
    case "notstarted":
    case "pending":
    case "ready":
    case "queued":
    case "queue":
    case "idle":
    case "available":
    case "open":
    case "new":
      return "todo";
    case "inprogress":
    case "started":
    case "active":
    case "ongoing":
      return "inProgress";
    case "done":
    case "complete":
    case "completed":
    case "finished":
    case "resolved":
      return "done";
    case "overdue":
    case "late":
      return "overdue";
    case "frozen":
    case "paused":
    case "blocked":
      return "frozen";
    default:
      return "todo";
  }
};

const normalizeSteps = (steps, friendName) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return {
      steps: [
        {
          id: `step-${friendName ? toDomSafeId(friendName, "friend") : "friend"}-quiz`,
          title: `Start a plan with ${friendName}`,
          status: "todo",
          meta: "Complete their Friend Quiz to unlock personalised steps.",
        },
      ],
      hasStructuredSteps: false,
    };
  }

  const seenServerIds = new Map();
  const makeClientKey = (serverId, index) => {
    const base = toIdString(serverId) || `step-${index + 1}`;
    const count = (seenServerIds.get(base) ?? 0) + 1;
    seenServerIds.set(base, count);
    const clientId = count === 1 ? base : `${base}__${count}`;
    return { clientId, baseId: base, ordinal: count };
  };

  const inferStepDay = (step, index) => {
    const fallbackDay = Math.floor(index / 2) + 1;
    if (!isPlainObject(step)) return fallbackDay;
    const candidates = [
      step.day,
      step.day_number,
      step.dayNumber,
      step.day_index,
      step.dayIndex,
      step.day_id,
      step.dayId,
    ];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return Math.max(1, Math.round(numeric));
      }
    }
    return fallbackDay;
  };

  const coerced = steps.map((step, index) => {
    const combineStatus = (primary, secondary) => {
      const canonicalPrimary = normalizeStepStatusValue(primary);
      const canonicalSecondary = normalizeStepStatusValue(secondary);
      if (canonicalPrimary === canonicalSecondary) return canonicalPrimary;
      if (canonicalPrimary === "todo" && (canonicalSecondary === "inProgress" || canonicalSecondary === "done")) {
        return canonicalSecondary;
      }
      if (canonicalPrimary === "inProgress" && canonicalSecondary === "done") {
        return canonicalSecondary;
      }
      if (canonicalPrimary === "todo" && canonicalSecondary === "overdue") {
        return canonicalSecondary;
      }
      return canonicalPrimary !== "todo" ? canonicalPrimary : canonicalSecondary;
    };

    if (typeof step === "string") {
      const fallbackDay = Math.floor(index / 2) + 1;
      const { clientId, baseId, ordinal } = makeClientKey(null, index);
      return {
        id: clientId,
        title: step,
        status: "todo",
        serverId: baseId,
        serverOrdinal: ordinal,
        meta: "",
        day: fallbackDay,
        dayNumber: fallbackDay,
        day_number: fallbackDay,
      };
    }
    if (isPlainObject(step)) {
      const rawServerId = step.id ?? step.step_id ?? step.stepId ?? null;
      const { clientId, baseId, ordinal } = makeClientKey(rawServerId, index);
      const title = safeText(step.title) || safeText(step.name) || `Step ${index + 1}`;
      const status = combineStatus(step.status, step.state);
      const meta = safeText(step.meta) || safeText(step.hint) || safeText(step.summary) || "";
      const inferredDay = inferStepDay(step, index);
      return {
        ...step,
        id: clientId,
        serverId: baseId,
        serverOrdinal: ordinal,
        title,
        status,
        state: status,
        meta,
        day: inferredDay,
        dayNumber: inferredDay,
        day_number: inferredDay,
      };
    }
    const fallbackDay = Math.floor(index / 2) + 1;
    const { clientId, baseId, ordinal } = makeClientKey(null, index);
    return {
      id: clientId,
      title: `Step ${index + 1}`,
      status: "todo",
      serverId: baseId,
      serverOrdinal: ordinal,
      meta: "",
      day: fallbackDay,
      dayNumber: fallbackDay,
      day_number: fallbackDay,
    };
  });

  return { steps: coerced, hasStructuredSteps: true };
};

const normalizeChallenge = (challenge, fallbackName) => {
  if (isPlainObject(challenge)) {
    const toIdString = (value) =>
      value === null || value === undefined || value === ""
        ? null
        : String(value);
    const id = toIdString(challenge.id ?? challenge.challenge_id ?? challenge.challengeId);
    const templateId = toIdString(challenge.templateId ?? challenge.template_id ?? id);
    const description =
      safeText(challenge.description) ||
      safeText(challenge.body) ||
      safeText(challenge.summary) ||
      "";
    const channel = safeText(challenge.channel) || safeText(challenge.mode) || null;
    const tags = Array.isArray(challenge.tags) ? challenge.tags : [];

    return {
      id,
      templateId,
      title: safeText(challenge.title) || `Plan a kindness for ${fallbackName}`,
      description,
      channel,
      tags,
      effort: safeText(challenge.effort) || safeText(challenge.level) || "Low",
      estMinutes: pickFinite(challenge.estMinutes, challenge.estimate_minutes, challenge.minutes) ?? 5,
      points: pickFinite(challenge.points, challenge.xp, challenge.reward_points) ?? 0,
      swapsLeft: pickFinite(challenge.swapsLeft, challenge.swaps_left) ?? 0,
      isFallback: false,
    };
  }

  return {
    id: null,
    templateId: null,
    title: `You're all caught up${fallbackName ? ` for ${fallbackName}` : ""}!`,
    description: "New surprises unlock tomorrow. Keep streaking with your steps for now.",
    effort: "Low",
    estMinutes: 5,
    points: 0,
    swapsLeft: 0,
    isFallback: true,
  };
};

const normalizeLifetime = (lifetime) => {
  if (!isPlainObject(lifetime)) {
    return { xp: 0, streak: "—", streakDays: 0, drag: "0%", dragPercent: null };
  }

  const rawXp = pickFinite(lifetime.xp, lifetime.points, lifetime.total_xp, lifetime.totalXp) ?? 0;
  const xp = Math.max(0, Math.round(rawXp));

  const streakLabel = safeText(lifetime.streak);
  let streakDays =
    pickFinite(
      lifetime.streak_days,
      lifetime.days,
      lifetime.current_streak,
      lifetime.currentStreak
    ) ?? null;
  if (streakDays === null && streakLabel) {
    const match = streakLabel.match(/-?\d+/);
    if (match) {
      streakDays = Number(match[0]);
    }
  }
  if (!Number.isFinite(streakDays)) {
    streakDays = 0;
  } else {
    streakDays = Math.max(0, Math.round(streakDays));
  }
  const streak =
    streakLabel ||
    `${streakDays} ${streakDays === 1 ? "day" : "days"}`;

  let dragPercent = pickFinite(lifetime.drag_percent, lifetime.dragPercent);
  if (!Number.isFinite(dragPercent)) {
    dragPercent = null;
    if (typeof lifetime.drag === "string") {
      const match = lifetime.drag.match(/-?\d+(\.\d+)?/);
      if (match) {
        const parsed = Number(match[0]);
        if (Number.isFinite(parsed)) {
          dragPercent = parsed;
        }
      }
    }
  }
  const drag = safeText(lifetime.drag) || (dragPercent !== null ? `${dragPercent}%` : "0%");

  const dailySurpriseDate =
    safeText(lifetime.dailySurpriseDate ?? lifetime.daily_surprise_date) || null;
  const dailySurpriseCountRaw = pickFinite(
    lifetime.dailySurpriseCount,
    lifetime.daily_surprise_count
  );
  const dailySurpriseLimitRaw = pickFinite(
    lifetime.dailySurpriseLimit,
    lifetime.daily_surprise_limit
  );
  const dailySurpriseCount = Math.max(
    0,
    Number.isFinite(dailySurpriseCountRaw) ? Math.round(dailySurpriseCountRaw) : 0
  );
  const dailySurpriseLimit = Math.max(
    0,
    Number.isFinite(dailySurpriseLimitRaw)
      ? Math.round(dailySurpriseLimitRaw)
      : DAILY_SURPRISE_LIMIT
  );

  return {
    xp,
    streak,
    streakDays,
    drag,
    dragPercent: dragPercent !== null ? dragPercent : null,
    dailySurpriseDate,
    dailySurpriseCount,
    dailySurpriseLimit,
  };
};

const normalizeArc = (raw, index) => {
  if (!raw) return null;
  const snapshot = isPlainObject(raw.snapshot) ? raw.snapshot : {};
  const metrics = isPlainObject(snapshot.metrics) ? snapshot.metrics : {};
  const name = safeText(raw.name) || `Friend ${index + 1}`;
  const domId = toDomSafeId(raw.id ?? raw.friend_id ?? index, `arc-${index}`);

  const day = pickFinite(
    raw.day,
    snapshot.day,
    snapshot.current_day,
    snapshot.currentDay,
    metrics.current_day,
    metrics.day
  ) ?? 0;

  const length = pickFinite(
    raw.length,
    snapshot.length,
    snapshot.total_days,
    snapshot.totalDays,
    metrics.total_days,
    metrics.length
  ) ?? 0;

  const pointsToday = pickFinite(
    raw.pointsToday,
    snapshot.points_today,
    snapshot.pointsToday,
    metrics.points_today
  ) ?? 0;

  const arcPoints = pickFinite(
    raw.arcPoints,
    snapshot.arc_points,
    snapshot.arcPoints,
    metrics.arc_points
  ) ?? 0;

  const nextThresholdRaw = pickFinite(
    raw.nextThreshold,
    snapshot.next_threshold,
    snapshot.nextThreshold,
    metrics.next_threshold
  );
  const nextThreshold = Number.isFinite(nextThresholdRaw) && nextThresholdRaw > 0 ? nextThresholdRaw : 100;
  const percentRaw = pickFinite(
    raw.percent,
    snapshot.percent,
    metrics.percent
  );
  const percent = Number.isFinite(percentRaw) ? percentRaw : progressPercent(arcPoints, nextThreshold);

  const friendScore = pickFinite(
    raw.friendScore,
    raw.friend_score,
    raw.score,
    snapshot.friend_score,
    snapshot.score,
    metrics.friend_score,
    metrics.score
  );

  const friendType =
    safeText(raw.friendType) ||
    safeText(raw.friend_type) ||
    safeText(raw.archetype_primary) ||
    safeText(raw.archetypePrimary) ||
    safeText(raw.archetype_secondary) ||
    safeText(snapshot.friend_type) ||
    safeText(snapshot.archetype_primary) ||
    safeText(snapshot.archetypePrimary) ||
    null;

  const { steps, hasStructuredSteps } = normalizeSteps(
    Array.isArray(raw.steps)
      ? raw.steps
      : Array.isArray(snapshot.steps)
      ? snapshot.steps
      : [],
    name
  );

  const challenge = normalizeChallenge(
    isPlainObject(raw.challenge)
      ? raw.challenge
      : isPlainObject(snapshot.challenge)
      ? snapshot.challenge
      : null,
    name
  );

  const lifetime = normalizeLifetime(
    isPlainObject(raw.lifetime)
      ? raw.lifetime
      : isPlainObject(snapshot.lifetime)
      ? snapshot.lifetime
      : null
  );

  const recent = Array.isArray(raw.recent)
    ? raw.recent
    : Array.isArray(snapshot.recent)
    ? snapshot.recent
    : [];

  const badges = isPlainObject(raw.badges)
    ? raw.badges
    : isPlainObject(snapshot.badges)
    ? snapshot.badges
    : {};

  const signals = Array.isArray(raw.signals)
    ? raw.signals
    : Array.isArray(snapshot.signals)
    ? snapshot.signals
    : [];

  const redFlags = Array.isArray(raw.redFlags)
    ? raw.redFlags
    : Array.isArray(snapshot.red_flags)
    ? snapshot.red_flags
    : Array.isArray(raw.red_flags)
    ? raw.red_flags
    : [];

  const friendDetails = isPlainObject(raw.friend) ? raw.friend : {};
  const photoSrc =
    raw.photoSrc ||
    raw.picture ||
    raw.photo ||
    raw.photo_url ||
    friendDetails.photoSrc ||
    friendDetails.picture ||
    friendDetails.photo ||
    friendDetails.photo_url ||
    snapshot.photo ||
    snapshot.picture ||
    null;

  return {
    domId,
    id: String(raw.id ?? raw.friend_id ?? `friend-${index}`),
    name,
    overdue: Boolean(raw.overdue ?? snapshot.overdue ?? snapshot.is_overdue ?? false),
    percent,
    day,
    length,
    pointsToday,
    friendScore: Number.isFinite(friendScore) ? friendScore : null,
    friendType,
    photoSrc,
    steps,
    hasStructuredSteps,
    challenge,
    arcPoints,
    nextThreshold,
    lifetime,
    recent,
    badges,
    signals,
    redFlags,
    meta: {
      rawSnapshot: snapshot,
      updatedAt: raw.updatedAt || snapshot.updated_at || null,
      notes: safeText(raw.notes) || safeText(snapshot.notes) || null,
      evidence: raw.evidence || snapshot.evidence || null,
    },
  };
};

const sanitizeArcs = (rawArcs) => {
  if (!Array.isArray(rawArcs)) return [];
  return rawArcs
    .filter(Boolean)
    .map((arc, index) => normalizeArc(arc, index))
    .filter((arc) => arc && arc.id && arc.name);
};

const ProgressRing = ({ percent = 68, size = "clamp(96px, 30vw, 128px)", label = "68%" }) => {
  const clamped = clampPct(percent);
  const stroke = makeConicStroke(clamped);
  return (
    <div
      aria-label={`Progress ${clamped}%`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <div className="rounded-full" style={{ width: size, height: size, background: stroke }} />
      <div className="absolute inset-2 bg-white rounded-full grid place-items-center border border-slate-100">
        <div className="text-center">
          <div className="text-xl font-semibold text-[var(--ink)]">{label}</div>
          <div className="text-[11px] text-slate-500">complete</div>
        </div>
      </div>
    </div>
  );
};

const StepRow = ({
  state = "todo",
  title,
  meta,
  onStart,
  onContinue,
  startDisabled = false,
  continueDisabled = false,
}) => {
  const canonicalState = normalizeStepStatusValue(state);
  const icon =
    canonicalState === "done" ? (
      <CheckCircle2 className="text-emerald-600" size={20} aria-hidden />
    ) : canonicalState === "inProgress" ? (
      <Clock className="text-[var(--ink)]" size={20} aria-hidden />
    ) : canonicalState === "frozen" ? (
      <Lock className="text-amber-600" size={20} aria-hidden />
    ) : canonicalState === "overdue" ? (
      <Clock className="text-[var(--coral)]" size={20} aria-hidden />
    ) : (
      <Circle className="text-slate-400" size={20} aria-hidden />
    );
  const tone =
    canonicalState === "overdue"
      ? "text-[var(--coral)]"
      : canonicalState === "frozen"
      ? "text-amber-700"
      : "text-slate-600";
  const buttonBase =
    "px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none";

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-[15px] text-[var(--ink)] font-medium">{title}</div>
        {meta && <div className={`text-xs ${tone}`}>{meta}</div>}
      </div>
      {canonicalState === "inProgress" ? (
        <button
          type="button"
          onClick={onContinue}
          disabled={continueDisabled}
          className={`${buttonBase} bg-[var(--coral)] text-white hover:opacity-90 focus:ring-[var(--coral)]`}
        >
          Continue
        </button>
      ) : canonicalState === "todo" ? (
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled}
          className={`${buttonBase} bg-[var(--ink)] text-white hover:opacity-90 focus:ring-[var(--ink)]`}
        >
          Start
        </button>
      ) : null}
    </div>
  );
};

// -------------------------------
// Mock data for friend switching (fallback)
// -------------------------------

const LEVEL_TO_BADGE_ID = {
  Acquaintance: 1,
  "Casual Friend": 2,
  Friend: 3,
  "Close Friend": undefined,
  "Best Friend": undefined,
};

// Static, locally-hosted badge images (MVP). Place files in /public/images/badges
export const LEVEL_TO_BADGE_SRC = {
  Acquaintance: "/images/badges/badge1.png",
  "Casual Friend": "/images/badges/badge2.png",
  Friend: "/images/badges/badge3.png",
  "Close Friend": null,
  "Best Friend": null,
};

// DB-driven icon resolution
export const iconForLevel = (level, state, earned, badges) => {
  if (state !== "done") return null; // only replace placeholder for achieved levels
  const id = LEVEL_TO_BADGE_ID[level];
  if (!id) return null;
  const b = Array.isArray(badges) ? badges.find((x) => x && x.id === id) : null;
  if (!b || !b.icon) return null;
  return earned && typeof earned.has === "function" && earned.has(id) ? b.icon : null;
};

// Pure helper that includes static fallback
export const getLevelIconPure = (level, state, earned, badges, staticMap) => {
  const fromDb = iconForLevel(level, state, earned, badges);
  if (fromDb) return fromDb;
  return state === "done" ? (staticMap && staticMap[level]) || null : null;
};

const INITIAL_ARCS = [
  {
    id: "alex",
    name: "Alex",
    overdue: false,
    percent: 68,
    day: 9,
    length: 21,
    pointsToday: 34,
    friendScore: null,
    friendType: null,
    photoSrc: null,
    steps: [
      { title: "Day 7 — Send a quick invite", status: "done", meta: "Completed yesterday" },
      { title: "Day 8 — 10-min check-in (Noticing)", status: "inProgress", meta: "Due today • Try a Noticing or Affirming message" },
      { title: "Day 9 — Pick a place for coffee", status: "todo", meta: "Prep ~5m • Suggest 2 options" },
    ],
    challenge: { title: "Share a small win today", effort: "Low", estMinutes: 5, points: 10, swapsLeft: 1 },
    arcPoints: 340,
    nextThreshold: 500,
    lifetime: { xp: 2430, streak: "4 days", drag: "-8%" },
    recent: [
      { delta: 15, reason: "Completed Day 8 step" },
      { delta: 10, reason: "Reply in Pods" },
      { delta: 5, reason: "Invite sent" },
    ],
    badges: { Acquaintance: "done", "Casual Friend": "inProgress", Friend: "locked", "Close Friend": "locked", "Best Friend": "locked" },
  },
  {
    id: "sam",
    name: "Sam",
    overdue: true,
    percent: 22,
    day: 3,
    length: 14,
    pointsToday: 8,
    friendScore: null,
    friendType: null,
    photoSrc: null,
    steps: [
      { title: "Day 1 — React to a story", status: "done", meta: "Completed" },
      { title: "Day 2 — Share a link they'll enjoy", status: "overdue", meta: "Try again today" },
      { title: "Day 3 — Suggest a quick call", status: "todo", meta: "Prep ~3m • 2 time options" },
    ],
    challenge: { title: "Send a 'thinking of you' gif", effort: "Low", estMinutes: 2, points: 6, swapsLeft: 1 },
    arcPoints: 120,
    nextThreshold: 400,
    lifetime: { xp: 1950, streak: "2 days", drag: "-5%" },
    recent: [
      { delta: 6, reason: "Reacted to story" },
      { delta: 2, reason: "Daily check-in" },
    ],
    badges: { Acquaintance: "inProgress", "Casual Friend": "locked", Friend: "locked", "Close Friend": "locked", "Best Friend": "locked" },
  },
  {
    id: "priya",
    name: "Priya",
    overdue: false,
    percent: 48,
    day: 6,
    length: 21,
    pointsToday: 16,
    friendScore: null,
    friendType: null,
    photoSrc: null,
    steps: [
      { title: "Day 5 — Ask for a recommendation", status: "done", meta: "Completed" },
      { title: "Day 6 — Plan a 10-min call", status: "inProgress", meta: "Scheduled for tonight" },
      { title: "Day 7 — Confirm IRL plan", status: "todo", meta: "Add date & place" },
    ],
    challenge: { title: "Affirm something they did well", effort: "Low", estMinutes: 4, points: 9, swapsLeft: 1 },
    arcPoints: 260,
    nextThreshold: 500,
    lifetime: { xp: 2150, streak: "3 days", drag: "-3%" },
    recent: [
      { delta: 12, reason: "Planned call" },
      { delta: 4, reason: "Daily check-in" },
    ],
    badges: { Acquaintance: "inProgress", "Casual Friend": "locked", Friend: "locked", "Close Friend": "locked", "Best Friend": "locked" },
  },
];

const INITIAL_ARCS_SANITISED = sanitizeArcs(INITIAL_ARCS);

// -------------------------------
// Dev checks (lightweight, non-blocking)
// -------------------------------
const IS_DEV =
  typeof process !== "undefined" &&
  process.env &&
  process.env.NODE_ENV !== "production";

if (IS_DEV) {
  try {
    // 1) Ensure Pill can render text containing '>' without JSX parsing issues
    const t1 = React.createElement(Pill, { tone: "muted" }, "Quality > hours");
    console.assert(!!t1, "Pill with '>' should create a React element");

    // 2) ProgressRing bounds clamp
    const clamp = (n) => Math.max(0, Math.min(100, n));
    console.assert(clamp(-10) === 0 && clamp(120) === 100, "ProgressRing clamps percent 0–100");

    // 2b) makeConicStroke produces valid strings (new tests)
    const s0 = makeConicStroke(0);
    const s68 = makeConicStroke(68);
    const s999 = makeConicStroke(999);
    const isValid = (s) => s.startsWith("conic-gradient(") && s.includes("var(--coral)") && s.includes("deg");
    console.assert(isValid(s0) && isValid(s68) && isValid(s999), "makeConicStroke returns a valid CSS gradient string");

    // 2b+) extra edge cases for makeConicStroke
    const sNeg = makeConicStroke(-25);
    const sOver = makeConicStroke(250);
    console.assert(isValid(sNeg) && isValid(sOver), "makeConicStroke clamps out-of-range inputs");

    // 2c) Quiz formatting helpers behave as expected
    console.assert(formatFriendScore(null) === "No Quiz score", "Null score shows placeholder");
    console.assert(formatFriendScore(undefined) === "No Quiz score", "Undefined score shows placeholder");
    console.assert(formatFriendScore(105) === "100", "Scores clamp to 0–100");
    console.assert(formatFriendScore(-3) === "0", "Negative scores clamp to 0");
    console.assert(formatFriendScore(Number.NaN) === "No Quiz score", "NaN score shows placeholder");
    console.assert(formatFriendType("") === "No Quiz result", "Empty type shows placeholder");
    console.assert(formatFriendType("   ") === "No Quiz result", "Whitespace type shows placeholder");
    console.assert(formatFriendType("Casual Friend") === "Casual Friend", "Non-empty type passes through");

    // 2d) CTA visibility conditions
    console.assert(isMissingQuiz(null, null) === true, "CTA shows when both missing");
    console.assert(isMissingQuiz(50, null) === false, "CTA hidden when score present");
    console.assert(isMissingQuiz(null, "Casual Friend") === false, "CTA hidden when type present");

    // 2e) CTA anchor existence & href
    const linkCta = React.createElement('a', { href: 'friendQuiz' }, 'Do the Friend Quiz Now');
    console.assert(!!linkCta && linkCta.props && linkCta.props.href === 'friendQuiz', 'CTA anchor created with friendQuiz href');

    // 2f) iconForLevel + fallback behavior via pure fn
    const iconBadges = [{ id: 1, name: 'Kindness Starter', icon: '/icons/badge1.png', description: null, points_required: 10 }];
    const earnedOne = new Set([1]);
    console.assert(typeof getLevelIconPure === 'function', 'getLevelIconPure is defined');
    console.assert(getLevelIconPure('Acquaintance', 'done', earnedOne, iconBadges, LEVEL_TO_BADGE_SRC) === '/icons/badge1.png', 'Uses DB icon when earned');
    console.assert(getLevelIconPure('Acquaintance', 'done', new Set(), [], LEVEL_TO_BADGE_SRC) === '/images/badges/badge1.png', 'Falls back to static icon when no DB icon');
    console.assert(getLevelIconPure('Acquaintance', 'inProgress', earnedOne, iconBadges, LEVEL_TO_BADGE_SRC) === null, 'No icon when not done');
    console.assert(iconForLevel('Friend', 'inProgress', earnedOne, iconBadges) === null, 'iconForLevel null when not done');

    // 3) FriendPhoto renders without a src
    const t2 = React.createElement(FriendPhoto, { name: "Test" });
    console.assert(!!t2, "FriendPhoto without src should still render a placeholder");

    // 4) Badge labels reflect expected order
    const expected = Array.from(LEVEL_LABELS);
    console.assert(JSON.stringify(LEVEL_LABELS) === JSON.stringify(expected), "Badge level labels match expected order");

    // 5) Exactly one earned badge for initial arc (Alex)
    const earnedCount = Object.values(INITIAL_ARCS[0].badges).filter((s) => s === "done").length;
    console.assert(earnedCount === 1, `Expected 1 earned badge for initial arc, got ${earnedCount}`);
  } catch (e) {
    console.error("Dev checks failed", e);
  }
}

export default function FriendChallenges(props = {}) {
  const { arcs: arcsProp, initialArcId } = props;

  const sanitizedPropArcs = React.useMemo(() => sanitizeArcs(arcsProp), [arcsProp]);
  const hasServerArcs = sanitizedPropArcs.length > 0;

  const [arcs, setArcs] = useState(() => {
    if (hasServerArcs) return sanitizedPropArcs;
    if (IS_DEV && (!Array.isArray(arcsProp) || arcsProp.length === 0)) {
      return INITIAL_ARCS_SANITISED;
    }
    return [];
  });

  const [selectedId, setSelectedId] = useState(() => {
    if (hasServerArcs) {
      if (
        initialArcId &&
        sanitizedPropArcs.some((arc) => arc.id === initialArcId)
      ) {
        return initialArcId;
      }
      return sanitizedPropArcs[0]?.id || "";
    }
    if (IS_DEV && (!Array.isArray(arcsProp) || arcsProp.length === 0)) {
      return INITIAL_ARCS_SANITISED[0]?.id || "";
    }
    return "";
  });

  React.useEffect(() => {
    if (!hasServerArcs) return;
    setArcs(sanitizedPropArcs);
    setSelectedId((prev) => {
      if (prev && sanitizedPropArcs.some((arc) => arc.id === prev)) {
        return prev;
      }
      if (
        initialArcId &&
        sanitizedPropArcs.some((arc) => arc.id === initialArcId)
      ) {
        return initialArcId;
      }
      return sanitizedPropArcs[0]?.id || prev || "";
    });
  }, [hasServerArcs, sanitizedPropArcs, initialArcId]);

  React.useEffect(() => {
    if (!arcs.length) return;
    if (!arcs.some((arc) => arc.id === selectedId)) {
      setSelectedId(arcs[0].id);
    }
  }, [arcs, selectedId]);

  const current = React.useMemo(
    () => arcs.find((a) => a.id === selectedId) || arcs[0] || null,
    [arcs, selectedId]
  );

  const [loadingKey, setLoadingKey] = React.useState(null);
  const [errorMessage, setErrorMessage] = React.useState(null);

  const isLoadingAction = React.useCallback(
    (key) => !!key && loadingKey === key,
    [loadingKey]
  );

  React.useEffect(() => {
    if (!errorMessage) return undefined;
    const timer = setTimeout(() => setErrorMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [errorMessage]);

  const updateArcFromServer = React.useCallback(
    (rawArc) => {
      if (!rawArc) return;
      setArcs((prev) => {
        const next = Array.isArray(prev) ? [...prev] : [];
        const idx = next.findIndex((arc) => arc.id === rawArc.id);
        const normalized = normalizeArc(rawArc, idx === -1 ? next.length : idx);
        if (idx === -1) {
          next.push(normalized);
        } else {
          next[idx] = normalized;
        }
        return next;
      });
    },
    [setArcs]
  );

  const mutateArc = React.useCallback(
    async (key, url, body = {}, options = {}) => {
      setLoadingKey(key);
      setErrorMessage(null);
      let rollback = null;
      try {
        if (typeof options.optimistic === "function") {
          rollback = options.optimistic();
        }
      } catch (optimisticError) {
        console.error(optimisticError);
      }
      try {
        const payload = await postJSON(url, body);
        if (!payload || !payload.arc) {
          throw new Error("Server response missing arc payload");
        }
        updateArcFromServer(payload.arc);
        return payload;
      } catch (err) {
        if (typeof rollback === "function") {
          try {
            rollback();
          } catch (rollbackError) {
            console.error("Optimistic rollback failed", rollbackError);
          }
        }
        console.error(err);
        setErrorMessage(err.message || "Action failed. Please try again.");
        return null;
      } finally {
        setLoadingKey(null);
      }
    },
    [updateArcFromServer]
  );

  const handlePhotoPick = React.useCallback(
    (arc, file) => {
      if (!arc || !arc.id || !file) return;
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setErrorMessage("Please choose an image that is 2MB or smaller.");
        return;
      }
      setErrorMessage(null);
      const reader = new FileReader();
      const key = `photo-upload:${arc.id}`;
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string" || !result.startsWith("data:image/")) {
          setErrorMessage("Unsupported image type. Please choose a PNG or JPG image.");
          return;
        }
        mutateArc(key, `/api/arcs/${encodeURIComponent(arc.id)}/photo`, {
          picture: result,
        });
      };
      reader.onerror = () => {
        console.error(reader.error);
        setErrorMessage("Could not read image file. Please try again.");
      };
      reader.readAsDataURL(file);
    },
    [mutateArc, setErrorMessage]
  );

  const handlePlanAction = React.useCallback(
    (arc, action) => {
      if (!arc || !arc.id) return;
      const key = `plan-${action}:${arc.id}`;
      const path = `/api/arcs/${encodeURIComponent(arc.id)}/steps/${action}`;
      return mutateArc(key, path);
    },
    [mutateArc]
  );

  const handleStepStart = React.useCallback(
    (arc, step) => {
      const serverId = toIdString(step?.serverId) || toIdString(step?.id) || null;
      const serverOrdinal = Number.isFinite(Number(step?.serverOrdinal)) ? Number(step.serverOrdinal) : 1;
      if (!arc || !arc.id || !serverId) return;
      const arcId = String(arc.id);
      const stepKey = serverOrdinal > 1 ? `${serverId}__${serverOrdinal}` : serverId;
      const previousStatus = normalizeStepStatusValue(step.status ?? step.state ?? "todo");
      const optimistic = () => {
        let applied = false;
        setArcs((prev) =>
          prev.map((candidate) => {
            if (!candidate || String(candidate.id) !== arcId) return candidate;
            if (!Array.isArray(candidate.steps)) return candidate;
            const nextSteps = candidate.steps.map((existing) => {
              if (!existing) return existing;
              const existingServerId = toIdString(existing.serverId) || toIdString(existing.id);
              const existingOrdinal = Number.isFinite(Number(existing.serverOrdinal))
                ? Number(existing.serverOrdinal)
                : 1;
              if (existingServerId !== serverId || existingOrdinal !== serverOrdinal) return existing;
              applied = true;
              const currentStatus = normalizeStepStatusValue(existing.status ?? existing.state ?? "todo");
              if (currentStatus === "inProgress") {
                return existing;
              }
              return { ...existing, status: "inProgress" };
            });
            return applied ? { ...candidate, steps: nextSteps } : candidate;
          })
        );
        if (!applied) return null;
        return () => {
          setArcs((prev) =>
            prev.map((candidate) => {
              if (!candidate || String(candidate.id) !== arcId) return candidate;
              if (!Array.isArray(candidate.steps)) return candidate;
              const revertedSteps = candidate.steps.map((existing) => {
                if (!existing) return existing;
                const existingServerId = toIdString(existing.serverId) || toIdString(existing.id);
                const existingOrdinal = Number.isFinite(Number(existing.serverOrdinal))
                  ? Number(existing.serverOrdinal)
                  : 1;
                if (existingServerId !== serverId || existingOrdinal !== serverOrdinal) return existing;
                return { ...existing, status: previousStatus };
              });
              return { ...candidate, steps: revertedSteps };
            })
          );
        };
      };
      const key = `step-start:${arcId}:${stepKey}`;
      const path = `/api/arcs/${encodeURIComponent(arcId)}/steps/${encodeURIComponent(stepKey)}/start`;
      return mutateArc(key, path, {}, { optimistic });
    },
    [mutateArc, setArcs]
  );

  const handleStepComplete = React.useCallback(
    (arc, step) => {
      const serverId = toIdString(step?.serverId) || toIdString(step?.id) || null;
      const serverOrdinal = Number.isFinite(Number(step?.serverOrdinal)) ? Number(step.serverOrdinal) : 1;
      if (!arc || !arc.id || !serverId) return;
      const stepKey = serverOrdinal > 1 ? `${serverId}__${serverOrdinal}` : serverId;
      const key = `step-complete:${arc.id}:${stepKey}`;
      const path = `/api/arcs/${encodeURIComponent(arc.id)}/steps/${encodeURIComponent(stepKey)}/complete`;
      return mutateArc(key, path);
    },
    [mutateArc]
  );

  const handleChallengeComplete = React.useCallback(
    (arc) => {
      const challenge = arc?.challenge;
      if (!arc || !arc.id || !challenge || challenge.isFallback) return;
      const challengeId = challenge.templateId || challenge.template_id || challenge.id;
      if (!challengeId) return;
      const key = `challenge-complete:${arc.id}`;
      const path = `/api/arcs/${encodeURIComponent(arc.id)}/challenge/${encodeURIComponent(challengeId)}/complete`;
      return mutateArc(key, path);
    },
    [mutateArc]
  );

  const handleChallengeSwap = React.useCallback(
    (arc) => {
      const challenge = arc?.challenge;
      if (!arc || !arc.id || !challenge || challenge.isFallback) return;
      const swapsRemaining = Number(challenge.swapsLeft ?? challenge.swaps_left ?? 0);
      if (!Number.isFinite(swapsRemaining) || swapsRemaining <= 0) return;
      const key = `challenge-swap:${arc.id}`;
      const path = `/api/arcs/${encodeURIComponent(arc.id)}/challenge/swap`;
      return mutateArc(key, path);
    },
    [mutateArc]
  );

  const removeArc = React.useCallback((id) => {
    setArcs((prev) => prev.filter((arc) => arc.id !== id));
  }, []);

  if (!arcs.length || !current) {
    return (
      <div className="min-h-[60vh] pb-24 bg-[var(--canvas)] text-slate-800 overflow-x-hidden">
        <style>{`
        :root{ --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
      `}</style>
        <main className="mx-auto max-w-screen-md px-3 md:px-4 py-6 md:py-8 grid gap-6">
          <SectionCard
            title="Welcome to Friend Challenges"
            subtitle="Add a friend to see personalised arcs and action steps"
          >
            <div className="grid gap-4 text-sm text-slate-600">
              <p>
                You haven't added any friends yet. Take the Friend Quiz to create
                your first arc and unlock tailored steps, challenges, and badges.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="friendQuiz"
                  className="px-4 py-2 rounded-lg bg-[var(--coral)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]"
                >
                  Take the Friend Quiz
                </a>
                <a
                  href="/profile"
                  className="px-4 py-2 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)]/40"
                >
                  Manage your friends
                </a>
              </div>
              <p className="text-xs text-slate-500">
                Tip: once you complete a friend's quiz, their arc will appear here
                with personalised micro-actions and badges.
              </p>
            </div>
          </SectionCard>
        </main>
      </div>
    );
  }

  // --- MVP: earned badge ids (optional; if ladder state alone drives visuals you can remove this) ---
  const [siteBadges, setSiteBadges] = useState([]);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState(new Set());

  // Local wrapper used by JSX
  const getLevelIcon = (level, state) =>
    getLevelIconPure(level, state, earnedBadgeIds, siteBadges, LEVEL_TO_BADGE_SRC);

  const renderArcPanelContent = (arc) => {
    const challenge = arc.challenge || normalizeChallenge(null, arc.name);
    const hasActiveChallenge = Boolean(challenge) && !challenge.isFallback;
    const challengeDescription = hasActiveChallenge
      ? challenge.description || `Keep up the momentum with ${arc.name}.`
      : "You're all caught up for today. New surprises unlock tomorrow.";

    const swapsLeft =
      hasActiveChallenge && Number.isFinite(challenge.swapsLeft) ? challenge.swapsLeft : 0;

    const lifetime = normalizeLifetime(arc.lifetime);
    const surpriseLimit =
      Number.isFinite(lifetime.dailySurpriseLimit) && lifetime.dailySurpriseLimit > 0
        ? lifetime.dailySurpriseLimit
        : DAILY_SURPRISE_LIMIT;
    const surprisesUsed = Number.isFinite(lifetime.dailySurpriseCount)
      ? lifetime.dailySurpriseCount
      : 0;
    const surprisesRemaining = Math.max(surpriseLimit - surprisesUsed, 0);
    const surprisePillLabel = `${surprisesRemaining} surprise${
      surprisesRemaining === 1 ? "" : "s"
    } left today`;

    const arcPoints = Number.isFinite(arc.arcPoints) ? arc.arcPoints : 0;
    const nextThreshold =
      Number.isFinite(arc.nextThreshold) && arc.nextThreshold > 0 ? arc.nextThreshold : 100;
    const pointsToday = Number.isFinite(arc.pointsToday) ? arc.pointsToday : 0;
    const day = Number.isFinite(arc.day) ? arc.day : 0;
    const length = Number.isFinite(arc.length) ? arc.length : 0;
    const progressPct = Number.isFinite(arc.percent)
      ? arc.percent
      : progressPercent(arcPoints, nextThreshold);
    const safePercent = clampPct(Number.isFinite(progressPct) ? progressPct : 0);
    const progressLabel = `${safePercent}%`;
    const dayLabel = sharedDayLabel(day, length);
    const pointsTodayLabel = pointsToday > 0 ? `+${pointsToday} XP today` : "0 XP logged today";
    const showFallbackStepsNote = !arc.hasStructuredSteps;
    const progressBarWidth = `${safePercent}%`;
    const displayArcPoints =
      Number.isFinite(arcPoints) && arcPoints > 0
        ? arcPoints
        : Math.round((safePercent / 100) * nextThreshold);
    const planExtendKey = `plan-extend:${arc.id}`;
    const planSnoozeKey = `plan-snooze:${arc.id}`;
    const planFailKey = `plan-fail-forward:${arc.id}`;
    const challengeCompleteKey = `challenge-complete:${arc.id}`;
    const challengeSwapKey = `challenge-swap:${arc.id}`;
    const photoUploadKey = `photo-upload:${arc.id}`;
    const photoUploading = isLoadingAction(photoUploadKey);
    const activeDay = Math.max(1, Number.isFinite(day) && day > 0 ? Math.round(day) : 1);
    const visibleSteps = Array.isArray(arc.steps)
      ? arc.steps.filter((step, index) => {
          const fallbackDay = Math.floor(index / 2) + 1;
          const candidate = pickFinite(
            step?.day,
            step?.day_number,
            step?.dayNumber,
            step?.day_index,
            step?.dayIndex
          );
          const normalized = Number.isFinite(candidate) && candidate > 0 ? candidate : fallbackDay;
          const stepDay = Math.max(1, Math.round(normalized));
          return stepDay === activeDay;
        })
      : [];
    const hasVisibleSteps = visibleSteps.length > 0;
    const showAllCompleteMessage = arc.hasStructuredSteps && !hasVisibleSteps;

    return (
      <div className="grid md:grid-cols-3 gap-6 md:gap-8 items-start">
        {/* LEFT COLUMN (2/3): Current Arc, Daily Surprise, Badges */}
        <div className="grid gap-6 md:gap-8 md:col-span-2">
          {/* Progress + Steps */}
          <SectionCard>
            <div className="grid gap-5 items-start md:grid-cols-3 md:items-center">
              {/* Left 1/3: Friend photo centered */}
              <div className="grid place-items-center gap-2 text-center">
                <div className="text-sm font-semibold text-[var(--ink)]">{arc.name}</div>
                <FriendPhoto
                  name={arc.name}
                  src={arc.photoSrc || undefined}
                  loading={photoUploading}
                  onPick={(file) => handlePhotoPick(arc, file)}
                />
                <div className="grid gap-2 mt-1">
                  <Pill tone="ink">{`Friend Score: ${formatFriendScore(arc.friendScore)}`}</Pill>
                  <Pill>{`Friend Type: ${formatFriendType(arc.friendType)}`}</Pill>
                  {isMissingQuiz(arc.friendScore, arc.friendType) && (
                    <a
                      href="friendQuiz"
                      className="mt-2 px-3 py-2 rounded-lg bg-[var(--coral)] text-white text-sm inline-block"
                      role="button"
                    >
                      Do the Friend Quiz Now
                    </a>
                  )}
                </div>
              </div>

              {/* Right 2/3: Progress ring + pills centered */}
              <div className="grid md:col-span-2 place-items-center">
                <ProgressRing
                  percent={progressPct}
                  size={"clamp(96px, 28vw, 128px)"}
                  label={progressLabel}
                />
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Pill tone="ink">{dayLabel}</Pill>
                  <Pill tone="coral">{pointsTodayLabel}</Pill>
                </div>
              </div>

              {/* Steps and actions below (span full width) */}
              <div className="grid gap-2 md:col-span-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[var(--ink)] font-semibold">{`Today’s plan for ${arc.name}`}</h3>
                  <Pill>{"Quality > hours"}</Pill>
                </div>
                {hasVisibleSteps ? (
                  <ul className="divide-y divide-slate-100">
                    {visibleSteps.map((s, idx) => {
                      const serverId = toIdString(s.serverId) || toIdString(s.id);
                      const serverOrdinal = Number.isFinite(Number(s.serverOrdinal)) ? Number(s.serverOrdinal) : 1;
                      const actionKey = serverOrdinal > 1 ? `${serverId}__${serverOrdinal}` : serverId;
                      const startKey = `step-start:${arc.id}:${actionKey}`;
                      const completeKey = `step-complete:${arc.id}:${actionKey}`;
                      const normalizedStatus = normalizeStepStatusValue(s.status ?? s.state);
                      return (
                        <li key={s.id || `${arc.id}-step-${idx}`}>
                          <StepRow
                            state={normalizedStatus}
                            title={s.title}
                            meta={s.meta}
                            onStart={normalizedStatus === "todo" ? () => handleStepStart(arc, s) : undefined}
                            onContinue={
                              normalizedStatus === "inProgress" ? () => handleStepComplete(arc, s) : undefined
                            }
                            startDisabled={isLoadingAction(startKey)}
                            continueDisabled={isLoadingAction(completeKey)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : showAllCompleteMessage ? (
                  <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    All actions for today are complete. Check back tomorrow for two new prompts.
                  </div>
                ) : null}

                {showFallbackStepsNote && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    Complete this friend’s quiz to unlock a personalised daily plan.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => handlePlanAction(arc, "extend")}
                    disabled={isLoadingAction(planExtendKey)}
                    className="px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)] disabled:opacity-60 disabled:pointer-events-none"
                  >
                    Extend
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePlanAction(arc, "snooze")}
                    disabled={isLoadingAction(planSnoozeKey)}
                    className="px-3 py-1.5 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)]/40 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    Snooze
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePlanAction(arc, "fail-forward")}
                    disabled={isLoadingAction(planFailKey)}
                    className="px-3 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300 disabled:opacity-60 disabled:pointer-events-none"
                  >
                    Fail-forward
                  </button>
                  <span className="text-xs text-slate-500 ml-auto flex items-center gap-1">
                    <Info size={14} /> Auto-advance in ~12h
                  </span>
                </div>

                {/* Grind guard example */}
                <div className="mt-2 hidden md:flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                  <Lock size={16} />
                  <span className="text-sm">
                    Freeze active — you’ve hit this week’s cap. Log a quick quality check to unlock bigger awards.
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Daily Surprise Challenge */}
          <SectionCard title={`Daily Surprise · ${arc.name}`} subtitle="A tiny nudge for real-life progress">
              <div className="grid md:grid-cols-[1fr_auto] gap-4 items-start">
              <div className="grid gap-3">
                <h3 className="text-lg font-semibold text-[var(--ink)]">{challenge.title}</h3>
                <p className="text-slate-600 text-sm leading-relaxed">{challengeDescription}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {hasActiveChallenge && (
                    <>
                      <Pill tone="ink">{`${challenge.effort} effort`}</Pill>
                      <Pill tone="coral">{`${challenge.estMinutes} min`}</Pill>
                      <Pill tone="ok">{`+${challenge.points} XP`}</Pill>
                    </>
                  )}
                  <Pill tone={surprisesRemaining > 0 ? "ok" : "muted"}>{surprisePillLabel}</Pill>
                </div>
              </div>
              <div className="grid gap-2 justify-items-end">
                {hasActiveChallenge ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleChallengeComplete(arc)}
                      disabled={isLoadingAction(challengeCompleteKey)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--coral)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)] disabled:opacity-60 disabled:pointer-events-none"
                    >
                      Do it
                      <ChevronRight size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChallengeSwap(arc)}
                      disabled={swapsLeft <= 0 || isLoadingAction(challengeSwapKey)}
                      className="inline-flex items-center gap-2 text-xs text-[var(--ink)] hover:underline disabled:opacity-60 disabled:pointer-events-none"
                    >
                      {swapsLeft > 0 ? "Swap this idea" : "No swaps left"}
                    </button>
                  </>
                ) : (
                  <div className="text-xs text-slate-500 text-right max-w-[220px]">
                    You're all caught up. KAI will drop fresh surprises tomorrow.
                  </div>
                )}
              </div>
              {hasActiveChallenge && Number.isFinite(swapsLeft) && (
                <div className="justify-self-end">
                  <Pill tone={swapsLeft > 0 ? "warn" : "muted"}>{`Swaps left: ${swapsLeft}`}</Pill>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Badges */}
          <SectionCard title="Badges" subtitle="Friendship levels + streak & pod-assist">
            <div className="grid gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {LEVEL_LABELS.map((label) => {
                  const st = (arc.badges || {})[label] || "locked";
                  return (
                    <div
                      key={label}
                      className={`rounded-xl border p-3 text-center flex flex-col items-center ${
                        st === "done"
                          ? "bg-emerald-50 border-emerald-200"
                          : st === "inProgress"
                          ? "bg-[var(--canvas)] border-slate-200"
                          : "bg-white border-slate-200 opacity-70"
                      }`}
                    >
                      <div className="grid place-items-center">
                        <BadgeArt state={st} label={label} src={getLevelIcon(label, st)} />
                      </div>
                      <div className="mt-2 text-center font-medium text-[13px] md:text-sm leading-tight text-[var(--ink)] break-words">
                        {label}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {st === "done" ? "earned" : st === "inProgress" ? "2 steps to unlock" : "locked"}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                  <Flame className="text-[var(--coral)]" />
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">7-Day Streak</div>
                    <div className="text-xs text-slate-500">2/7 — keep your daily reps going</div>
                  </div>
                  <div className="ml-auto text-xs">
                    <Pill tone="ink">{"+5% bonus"}</Pill>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
                  <Handshake className="text-[var(--ink)]" />
                  <div>
                    <div className="text-sm font-medium text-[var(--ink)]">Pod Assist</div>
                    <div className="text-xs text-slate-500">Help 3 podmates complete a step • 1/3</div>
                  </div>
                  <div className="ml-auto text-xs">
                    <Pill>{"accountability"}</Pill>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* RIGHT COLUMN (1/3): Points & Rewards */}
        <div className="grid md:col-span-1 gap-6 md:gap-8 md:sticky md:top-6 self-start">
          <SectionCard title="Points & Rewards" subtitle="Per-arc progress • Lifetime totals">
            <div className="grid gap-6">
              {/* Per-Arc */}
              <div className="grid gap-3">
                <div className="text-sm font-medium text-[var(--ink)]">{`Arc (${arc.name})`}</div>
                <div className="w-full bg-slate-100 rounded-full h-2.5 md:h-3 overflow-hidden">
                  <div
                    className="h-2.5 md:h-3 rounded-full bg-[var(--coral)]"
                    style={{ width: progressBarWidth }}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {displayArcPoints} / {nextThreshold} → Next level
                  </span>
                </div>
                <div className="text-xs text-slate-500">Earn XP to complete this friend arc.</div>
              </div>

              {/* Lifetime */}
              <div className="grid gap-3">
                <div className="grid grid-cols-3 gap-3">
                  {/* Lifetime XP */}
                  <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[92px] md:min-h-[112px]">
                    <div className="text-xs text-slate-500">Lifetime XP</div>
                    <div className="text-lg font-semibold text-[var(--ink)] leading-tight">{lifetime.xp}</div>
                  </div>

                  {/* Current Streak */}
                  <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[92px] md:min-h-[112px]">
                    <div className="text-xs text-slate-500">Current Streak</div>
                    <div className="text-lg font-semibold text-[var(--ink)] leading-tight whitespace-pre-line">
                      {lifetime.streak}
                    </div>
                  </div>

                  {/* Drag this week */}
                  <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[92px] md:min-h-[112px]">
                    <div className="text-xs text-slate-500">Drag this week</div>
                    <div className="text-lg font-semibold text-[var(--coral)] leading-tight">{lifetime.drag}</div>
                  </div>
                </div>

                {/* (rest of the section unchanged) */}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[60vh] pb-24 bg-[var(--canvas)] text-slate-800 overflow-x-hidden">
      {/* Brand tokens */}
      <style>{`
        :root{ --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
      `}</style>
      {errorMessage && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md bg-[var(--ink)] text-white text-sm px-4 py-2 shadow-lg">
          {errorMessage}
        </div>
      )}

      <main className="mx-auto max-w-screen-lg px-3 md:px-4 py-6 md:py-8 grid gap-6 md:gap-8">
        {/* Arc Switcher */}
        <div className="overflow-x-auto pb-1 pt-1">
          <nav aria-label="Your Arcs" role="tablist" className="flex gap-2">
            {arcs.map((a, index) => {
              const safeArcId = a.domId || toDomSafeId(a.id, `arc-${index}`);
              const tabId = `arc-tab-${safeArcId}`;
              const panelId = `arc-panel-${safeArcId}`;
              const isSelected = selectedId === a.id;
              const handleRemove = (event) => {
                event.preventDefault();
                event.stopPropagation();
                removeArc(a.id);
              };

              return (
                <div key={a.id} className="relative shrink-0 pr-2">
                  <button
                    id={tabId}
                    onClick={() => setSelectedId(a.id)}
                    role="tab"
                    aria-selected={isSelected}
                    aria-controls={panelId}
                    className={[
                      "shrink-0 pr-7 pl-3.5 py-2 rounded-full text-sm border transition-all",
                      isSelected
                        ? "bg-[var(--ink)] text-white border-[var(--ink)] shadow-md"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ink)]",
                    ].join(" ")}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={[
                          "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px]",
                          isSelected ? "bg-white text-[var(--ink)]" : "bg-[var(--ink)] text-white",
                        ].join(" ")}
                      >
                        {a.name?.[0] ?? "?"}
                      </span>
                      <span className={isSelected ? "font-semibold" : ""}>{a.name}</span>
                      {a.overdue && !isSelected && <Pill tone="coral">overdue</Pill>}
                      {a.overdue && isSelected && <Pill tone="warn">overdue</Pill>}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRemove}
                    aria-label={`Remove ${a.name}`}
                    className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--coral)] text-white text-[10px] shadow hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <a
    className="ml-1 shrink-0 px-3.5 py-2 rounded-full text-sm border border-dashed text-slate-600 hover:bg-slate-50"
    href="friendQuiz"
  >
    + Add
  </a>
</nav>
</div>
        {/* Arc panels */}
        {arcs.map((arc, index) => {
          const safeArcId = arc.domId || toDomSafeId(arc.id, `arc-${index}`);
          const tabId = `arc-tab-${safeArcId}`;
          const panelId = `arc-panel-${safeArcId}`;
          const isSelected = selectedId === arc.id;
          return (
            <div
              key={panelId}
              role="tabpanel"
              id={panelId}
              aria-labelledby={tabId}
              hidden={!isSelected}
            >
              {isSelected ? renderArcPanelContent(arc) : null}
            </div>
          );
        })}
      </main>
    </div>
  );
}
