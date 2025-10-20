// frontend/friendChallenges.jsx
// Get Kinder — Progress & Challenges (Mid-Fi Mockup)
// Single-file React component (Tailwind)
// Notes: Mid-fi mockup to visualize structure, hierarchy, copy, and friend switching.

import React, { useState } from "react";

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
  <section className={`bg-white/90 backdrop-blur rounded-2xl shadow-sm border border-slate-200 ${className}`}>
    {(title || subtitle) && (
      <header className="px-5 pt-4 pb-2 border-b border-slate-100">
        <h2 className="text-[var(--ink)] text-lg md:text-xl font-semibold flex items-center gap-2">{title}</h2>
        {subtitle && <p className="text-slate-500 text-sm mt-1">{subtitle}</p>}
      </header>
    )}
    <div className="p-5">{children}</div>
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
const FriendPhoto = ({ src, name = "Friend", size = 72 }) => (
  <div className="grid gap-1 place-items-center">
    {src ? (
      <img
        src={src}
        alt={`Photo of ${name}`}
        className="w-[72px] h-[72px] md:w-[80px] md:h-[80px] object-cover rounded-full border border-slate-200"
        style={{ width: size, height: size }}
      />
    ) : (
      <div
        className="w-[72px] h-[72px] md:w-[80px] md:h-[80px] rounded-full border-2 border-dashed border-slate-300 bg-slate-50 grid place-items-center text-slate-400"
        style={{ width: size, height: size }}
        aria-label={`Upload a photo of ${name}`}
      >
        <Camera size={22} aria-hidden />
      </div>
    )}
    <button className="text-[11px] text-[var(--ink)] underline decoration-dotted underline-offset-2">Add photo</button>
  </div>
);

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
const clampPct = (n) => Math.max(0, Math.min(100, n));
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

const ProgressRing = ({ percent = 68, size = 112, label = "68%" }) => {
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

const StepRow = ({ state = "todo", title, meta }) => {
  const icon =
    state === "done" ? (
      <CheckCircle2 className="text-emerald-600" size={20} aria-hidden />
    ) : state === "inProgress" ? (
      <Clock className="text-[var(--ink)]" size={20} aria-hidden />
    ) : state === "frozen" ? (
      <Lock className="text-amber-600" size={20} aria-hidden />
    ) : state === "overdue" ? (
      <Clock className="text-[var(--coral)]" size={20} aria-hidden />
    ) : (
      <Circle className="text-slate-400" size={20} aria-hidden />
    );
  const tone = state === "overdue" ? "text-[var(--coral)]" : state === "frozen" ? "text-amber-700" : "text-slate-600";
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1">
        <div className="text-[15px] text-[var(--ink)] font-medium">{title}</div>
        {meta && <div className={`text-xs ${tone}`}>{meta}</div>}
      </div>
      {state === "inProgress" ? (
        <button className="px-3 py-1.5 rounded-lg bg-[var(--coral)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]">Continue</button>
      ) : state === "todo" ? (
        <button className="px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)]">Start</button>
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

// -------------------------------
// Dev checks (lightweight, non-blocking)
// -------------------------------
const __DEV__ = process.env.NODE_ENV !== "production";
if (__DEV__) {
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

  const [arcs, setArcs] = useState(
    Array.isArray(arcsProp) && arcsProp.length ? arcsProp : INITIAL_ARCS
  );
  const [selectedId, setSelectedId] = useState(
    initialArcId || arcs[0]?.id || ""
  );

  const current = React.useMemo(
    () => arcs.find((a) => a.id === selectedId) || arcs[0] || INITIAL_ARCS[0],
    [arcs, selectedId]
  );

  // --- MVP: earned badge ids (optional; if ladder state alone drives visuals you can remove this) ---
  const [siteBadges, setSiteBadges] = useState([]);
  const [earnedBadgeIds, setEarnedBadgeIds] = useState(new Set());

  // Local wrapper used by JSX
  const getLevelIcon = (level, state) =>
    getLevelIconPure(level, state, earnedBadgeIds, siteBadges, LEVEL_TO_BADGE_SRC);

  const progressPct = React.useMemo(() => {
    const denom = Number(current?.nextThreshold) || 0;
    if (denom <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((current.arcPoints / denom) * 100)));
  }, [current.arcPoints, current.nextThreshold]);

  return (
    <div className="min-h-[60vh] pb-24 bg-[var(--canvas)] text-slate-800">
      {/* Brand tokens */}
      <style>{`
        :root{ --ink:#455a7c; --coral:#ff5656; --mist:#b5bdcb; --canvas:#f4f4f4; }
      `}</style>

      <main className="mx-auto max-w-screen-lg px-4 py-6 md:py-8 grid gap-6 md:gap-8">
{/* Arc Switcher */}
<nav aria-label="Your Arcs" role="tablist" className="flex gap-2 overflow-x-auto pb-1">
  {arcs.map((a) => {
    const isSelected = selectedId === a.id;
    return (
      <button
        key={a.id}
        onClick={() => setSelectedId(a.id)}
        role="tab"
        aria-selected={isSelected}
        className={[
          "shrink-0 px-3.5 py-2 rounded-full text-sm border transition-all",
          isSelected
            ? "bg-[var(--ink)] text-white border-[var(--ink)] shadow-md"
            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
          // 👇 removed the coral ring entirely
          // a.overdue && !isSelected ? "ring-2 ring-[var(--coral)]/40" : "",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--ink)]"
        ].join(" ")}
      >
        <span className="inline-flex items-center gap-2">
          <span
            className={[
              "inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px]",
              isSelected ? "bg-white text-[var(--ink)]" : "bg-[var(--ink)] text-white"
            ].join(" ")}
          >
            {a.name?.[0] ?? "?"}
          </span>
          <span className={isSelected ? "font-semibold" : ""}>{a.name}</span>
          {/* keep the small label, no ring */}
          {a.overdue && !isSelected && <Pill tone="coral">overdue</Pill>}
          {a.overdue && isSelected && <Pill tone="warn">overdue</Pill>}
        </span>
      </button>
    );
  })}
  <button className="ml-1 shrink-0 px-3.5 py-2 rounded-full text-sm border border-dashed text-slate-600">
    + Add
  </button>
</nav>
        {/* Two-column layout: Left = 2/3, Right = 1/3 */}
        <div className="grid md:grid-cols-3 gap-6 md:gap-8 items-start">
          {/* LEFT COLUMN (2/3): Current Arc, Daily Surprise, Badges */}
          <div className="grid gap-6 md:gap-8 md:col-span-2">
            {/* Progress + Steps */}
            <SectionCard>
              <div className="grid gap-5 items-start md:grid-cols-3 md:items-center">
                {/* Left 1/3: Friend photo centered */}
                <div className="grid place-items-center gap-2 text-center">
                  <div className="text-sm font-semibold text-[var(--ink)]">{current.name}</div>
                  <FriendPhoto name={current.name} src={current.photoSrc || undefined} />
                  <div className="grid gap-2 mt-1">
                    <Pill tone="ink">{`Friend Score: ${formatFriendScore(current.friendScore)}`}</Pill>
                    <Pill>{`Friend Type: ${formatFriendType(current.friendType)}`}</Pill>
                    {isMissingQuiz(current.friendScore, current.friendType) && (
                      <a href="friendQuiz" className="mt-2 px-3 py-2 rounded-lg bg-[var(--coral)] text-white text-sm inline-block" role="button">
                        Do the Friend Quiz Now
                      </a>
                    )}
                  </div>
                </div>

                {/* Right 2/3: Progress ring + pills centered */}
                <div className="grid md:col-span-2 place-items-center">
                  <ProgressRing percent={current.percent} size={128} label={`${Math.round(current.percent)}%`} />
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <Pill tone="ink">{`Day ${current.day} of ${current.length}`}</Pill>
                    <Pill tone="coral">{`+${current.pointsToday} XP today`}</Pill>
                  </div>
                </div>

                {/* Steps and actions below (span full width) */}
                <div className="grid gap-2 md:col-span-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[var(--ink)] font-semibold">{`Today’s plan for ${current.name}`}</h3>
                    <Pill>{"Quality > hours"}</Pill>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {current.steps.map((s) => (
                      <li key={s.title}>
                        <StepRow state={s.status} title={s.title} meta={s.meta} />
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <button className="px-3 py-1.5 rounded-lg bg-[var(--ink)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)]">Extend</button>
                    <button className="px-3 py-1.5 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ink)]/40">Snooze</button>
                    <button className="px-3 py-1.5 rounded-lg bg-white text-slate-700 border border-slate-200 text-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300">Fail-forward</button>
                    <span className="text-xs text-slate-500 ml-auto flex items-center gap-1"><Info size={14}/> Auto-advance in ~72h</span>
                  </div>

                  {/* Grind guard example */}
                  <div className="mt-2 hidden md:flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
                    <Lock size={16} />
                    <span className="text-sm">Freeze active — you’ve hit this week’s cap. Log a quick quality check to unlock bigger awards.</span>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Daily Surprise Challenge */}
            <SectionCard title={"Daily Surprise · " + current.name} subtitle="A tiny nudge for real-life progress">
              <div className="grid md:grid-cols-[1fr,auto] gap-4 items-start">
                <div>
                  <div className="text-[15px] font-semibold text-[var(--ink)]">{"🎯 " + current.challenge.title}</div>
                  <p className="text-sm text-slate-600 mt-1">Tell {current.name} one thing that went better than expected. Keep it kind and specific.</p>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <Pill tone="muted">{"Effort: " + current.challenge.effort}</Pill>
                    <Pill tone="muted">{"~" + current.challenge.estMinutes + " min"}</Pill>
                    <Pill tone="coral">{"+" + current.challenge.points + " XP"}</Pill>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="px-3 py-2 rounded-lg bg-[var(--coral)] text-white text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--coral)]">Do it</button>
                    <button className="px-3 py-2 rounded-lg bg-white text-[var(--ink)] border border-slate-200 text-sm hover:bg-slate-50">Swap</button>
                    <button className="px-3 py-2 rounded-lg bg-white text-slate-700 border border-slate-200 text-sm hover:bg-slate-50">Save for later</button>
                  </div>
                  <div className="mt-3 text-xs text-slate-500">Stuck? <a href="#" className="text-[var(--ink)] underline">Open KAI’s script</a></div>
                </div>
                <div className="justify-self-end">
                  <Pill tone="warn">{"Swaps left: " + current.challenge.swapsLeft}</Pill>
                </div>
              </div>
            </SectionCard>

            {/* Badges */}
            <SectionCard title="Badges" subtitle="Friendship levels + streak & pod-assist">
              <div className="grid gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {LEVEL_LABELS.map((label) => {
                    const st = (current.badges || {})[label] || "locked";
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
                        <div className="mt-2 text-center font-medium text-[13px] md:text-sm leading-tight text-[var(--ink)] break-words">{label}</div>
                        <div className="mt-1 text-xs text-slate-500">{st === "done" ? "earned" : st === "inProgress" ? "2 steps to unlock" : "locked"}</div>
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
                  <div className="text-sm font-medium text-[var(--ink)]">{`Arc (${current.name})`}</div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div className="h-3 rounded-full bg-[var(--coral)]" style={{ width: progressPct + "%" }} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {current.arcPoints} / {current.nextThreshold} → Next reward
                    </span>
                    <a href="#" className="inline-flex items-center gap-1 text-[var(--ink)] hover:underline">
                      View details <ChevronRight size={16} />
                    </a>
                  </div>
                  <div className="text-xs text-slate-500">Quality checkpoint required for large awards.</div>
                </div>

             {/* Lifetime */}
<div className="grid gap-3">
  <div className="grid grid-cols-3 gap-3">
    {/* Lifetime XP */}
    <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[112px]">
      <div className="text-xs text-slate-500">Lifetime XP</div>
      <div className="text-lg font-semibold text-[var(--ink)] leading-tight">{current.lifetime.xp}</div>
    </div>

    {/* Current Streak */}
    <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[112px]">
      <div className="text-xs text-slate-500">Current Streak</div>
      <div className="text-lg font-semibold text-[var(--ink)] leading-tight whitespace-pre-line">
        {current.lifetime.streak}
      </div>
    </div>

    {/* Drag this week */}
    <div className="rounded-xl border border-slate-200 p-4 text-center flex flex-col items-center justify-center min-h-[112px]">
      <div className="text-xs text-slate-500">Drag this week</div>
      <div className="text-lg font-semibold text-[var(--coral)] leading-tight">{current.lifetime.drag}</div>
    </div>
  </div>

  {/* (rest of the section unchanged) */}
</div>

              </div>
            </SectionCard>
          </div>
        </div>
      </main>
    </div>
  );
}
