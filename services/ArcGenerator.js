import { mapFriendArcRow } from "../Backend/lib/friendArcMapper.js";

const STARTER_TAG = "starter";
const STARTER_LENGTH_DAYS = 7;

function isStarterFlagEnabled() {
  return process.env.STARTER7_FIRST_PLAN === "1";
}

const DEFAULT_CHANNEL = "text";
const DEFAULT_EFFORT = "low";
const DEFAULT_LENGTH_DAYS = 3;
const DEFAULT_NEXT_THRESHOLD = 100;
const DEFAULT_ARC_POINTS = 0;
const DEFAULT_POINTS_TODAY = 0;
const DEFAULT_BADGE_STATE = { Acquaintance: "inProgress" };
const DEFAULT_LIFETIME = { xp: 0, streak: "0 days", drag: "0%" };

const CHANNEL_ALIASES = {
  sms: "text",
  message: "text",
  messages: "text",
  text: "text",
  chat: "text",
  dm: "text",
  email: "email",
  mail: "email",
  call: "call",
  phone: "call",
  voice: "call",
  video: "video",
  zoom: "video",
  mixed: "mixed",
  any: "mixed",
};

const SUPPORTED_CHANNELS = new Set(["text", "email", "call", "video", "mixed"]);

const EFFORT_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * @typedef {object} QuizPayload
 * @property {string|number} user_id
 * @property {string|number} friend_id
 * @property {string} friend_name
 * @property {string} tier
 * @property {string} [channel_pref]
 * @property {string|string[]} [availability]
 * @property {string|string[]} [goal]
 * @property {string} [effort_capacity]
 * @property {string|number|null} [quiz_session_id]
 */

let ensureSchemaPromise = null;

async function ensureArcGeneratorSchema(pool) {
  if (ensureSchemaPromise) return ensureSchemaPromise;
  ensureSchemaPromise = (async () => {
    await pool.query(
      `ALTER TABLE friend_arcs
         ADD COLUMN IF NOT EXISTS quiz_session_id text`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS friend_arcs_user_quiz_idx
         ON friend_arcs (user_id, quiz_session_id)`
    );
    await pool.query(
      `ALTER TABLE plan_templates
         ADD COLUMN IF NOT EXISTS channel text`
    );
    await pool.query(
      `ALTER TABLE plan_templates
         ADD COLUMN IF NOT EXISTS effort text`
    );
    await pool.query(
      `UPDATE plan_templates
          SET channel = COALESCE(channel, channel_variant)
        WHERE channel IS NULL`
    );
    await pool.query(
      `UPDATE plan_templates
          SET effort = COALESCE(effort, 'medium')
        WHERE effort IS NULL`
    );
    await pool.query(
      `ALTER TABLE plan_templates
         ALTER COLUMN channel SET DEFAULT 'mixed'`
    );
    await pool.query(
      `ALTER TABLE plan_templates
         ALTER COLUMN effort SET DEFAULT 'medium'`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS plan_templates_channel_idx
         ON plan_templates (channel)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS plan_templates_tier_idx
         ON plan_templates (tier)`
    );
    await pool.query(
      `ALTER TABLE step_templates
         ADD COLUMN IF NOT EXISTS title text`
    );
    await pool.query(
      `ALTER TABLE step_templates
         ADD COLUMN IF NOT EXISTS meta text`
    );
    await pool.query(
      `UPDATE step_templates
          SET title = COALESCE(title, title_template)`
    );
    await pool.query(
      `UPDATE step_templates
          SET meta = COALESCE(meta, meta_template)`
    );
  })().catch((err) => {
    ensureSchemaPromise = null;
    throw err;
  });
  return ensureSchemaPromise;
}

/**
 * Entry point to generate or fetch a friend arc for a quiz result.
 * @param {import("pg").Pool} pool
 * @param {QuizPayload} payload
 * @returns {Promise<object>}
 */
export async function generateArcForQuiz(pool, payload) {
  assertPool(pool);
  await ensureArcGeneratorSchema(pool);
  const context = normalizePayload(payload);

  const existing = await findExistingArc(pool, context);
  if (existing) {
    return mapFriendArcRow(existing);
  }

  const plans = await fetchActivePlans(pool);
  if (!plans.length) {
    throw new Error("No active plan templates available");
  }

  const starterFlagEnabled = isStarterFlagEnabled();
  const starterSelection = starterFlagEnabled ? pickStarter7dPlan(plans, context) : null;
  const planSelection = starterSelection ?? selectPlan(plans, context);
  if (!planSelection) {
    throw new Error("No plan template matched the quiz payload");
  }

  console.info("[ArcGenerator] plan selected", {
    planTemplateId: planSelection.plan?.id ?? null,
    planName: planSelection.plan?.name ?? null,
    forcedStarter7: Boolean(starterSelection),
    starterFlag: starterFlagEnabled,
  });

  const stepRows = await fetchPlanSteps(pool, planSelection.plan.id);
  const hasDbSteps = stepRows.length > 0;

  const challengeRows = await fetchActiveChallenges(pool, context);
  if (!challengeRows.length) {
    throw new Error("No active challenge templates available");
  }

  const challengeSelection = selectChallenge(challengeRows, context);
  if (!challengeSelection) {
    throw new Error("No active challenge template matched channel and effort constraints");
  }

  const arcRecord = buildArcRecord({
    context,
    planSelection,
    steps: hasDbSteps ? stepRows : buildFallbackSteps(context, planSelection),
    usingFallbackSteps: !hasDbSteps,
    challengeSelection,
    forcedStarterPlan: Boolean(starterSelection),
  });

  const inserted = await insertArc(pool, context, arcRecord);
  return mapFriendArcRow(inserted);
}

export async function buildArcForSpecificPlan(pool, payload, planRow, options = {}) {
  assertPool(pool);
  if (!isPlainObject(planRow)) {
    throw new TypeError("A plan template row object is required");
  }
  await ensureArcGeneratorSchema(pool);
  const context = normalizePayload(payload);

  const planSelection = {
    plan: {
      id: planRow.id,
      name: planRow.name,
      channel: normalizeChannel(planRow.channel, "mixed"),
      effort: normalizeEffort(planRow.effort, "medium"),
      tier: normalizeTier(planRow.tier),
      lengthDays: toPositiveInteger(planRow.length_days, DEFAULT_LENGTH_DAYS),
      tags: normalizeTagList(planRow.tags),
    },
    score: null,
  };

  const stepRows = await fetchPlanSteps(pool, planSelection.plan.id);
  const hasDbSteps = stepRows.length > 0;

  const challengeRows = await fetchActiveChallenges(pool, context);
  if (!challengeRows.length) {
    throw new Error("No active challenge templates available");
  }

  const challengeSelection = selectChallenge(challengeRows, context);
  if (!challengeSelection) {
    throw new Error("No active challenge template matched channel and effort constraints");
  }

  const arcRecord = buildArcRecord({
    context,
    planSelection,
    steps: hasDbSteps ? stepRows : buildFallbackSteps(context, planSelection),
    usingFallbackSteps: !hasDbSteps,
    challengeSelection,
    forcedStarterPlan: Boolean(options?.forcedStarterPlan),
  });

  return arcRecord;
}

function assertPool(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A pg Pool instance with a query method is required");
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeChannel(value, fallback = DEFAULT_CHANNEL) {
  if (!value) return fallback;
  const canonical = CHANNEL_ALIASES[String(value).trim().toLowerCase()] || null;
  if (canonical && SUPPORTED_CHANNELS.has(canonical)) return canonical;
  const trimmed = String(value).trim().toLowerCase();
  if (SUPPORTED_CHANNELS.has(trimmed)) return trimmed;
  return fallback;
}

function normalizeEffort(value, fallback = DEFAULT_EFFORT) {
  if (!value) return fallback;
  const lowered = String(value).trim().toLowerCase();
  return EFFORT_ORDER[lowered] ? lowered : fallback;
}

function effortRank(value, fallback = DEFAULT_EFFORT) {
  const normalized = normalizeEffort(value, fallback);
  return EFFORT_ORDER[normalized] || EFFORT_ORDER[fallback];
}

function normalizeTier(value) {
  if (typeof value !== "string") {
    return String(value ?? "").trim().toLowerCase() || "general";
  }
  const trimmed = value.trim();
  if (!trimmed) return "general";
  return trimmed.toLowerCase();
}

function toPositiveInteger(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.round(num);
  return fallback;
}

function toTagList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => toTagList(item));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        const parsed = JSON.parse(trimmed);
        return toTagList(parsed);
      } catch {
        // fall through to split handling
      }
    }
    return trimmed
      .split(/[,|]/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }
  if (isPlainObject(value)) {
    return Object.values(value).flatMap((item) => toTagList(item));
  }
  return [String(value).trim().toLowerCase()].filter(Boolean);
}

function countOverlap(list, tagSet) {
  if (!Array.isArray(list) || !list.length || !tagSet.size) return 0;
  let count = 0;
  for (const item of list) {
    if (tagSet.has(item)) count += 1;
  }
  return count;
}

function normalizePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new TypeError("Quiz payload must be an object");
  }

  const userId = payload.user_id ?? payload.userId;
  const friendId = payload.friend_id ?? payload.friendId;
  const friendNameRaw = payload.friend_name ?? payload.friendName;
  const tierRaw = payload.tier;
  const friendScoreRaw =
    payload.friend_score ??
    payload.friendScore ??
    payload.score ??
    null;
  const parsedScore = friendScoreRaw === null || friendScoreRaw === undefined
    ? null
    : Number(friendScoreRaw);
  const friendScore = Number.isFinite(parsedScore) ? parsedScore : null;

  const friendTypeRaw =
    payload.friend_type ??
    payload.friendType ??
    payload.archetype_primary ??
    payload.archetypePrimary ??
    null;
  const friendType =
    typeof friendTypeRaw === "string" && friendTypeRaw.trim().length
      ? friendTypeRaw.trim()
      : null;

  if (!userId && userId !== 0) throw new Error("payload.user_id is required");
  if (!friendId && friendId !== 0) throw new Error("payload.friend_id is required");
  if (!friendNameRaw || !String(friendNameRaw).trim()) throw new Error("payload.friend_name is required");
  if (!tierRaw || !String(tierRaw).trim()) throw new Error("payload.tier is required");

  const friendName = String(friendNameRaw).trim();
  const tier = normalizeTier(tierRaw);
  const channel = normalizeChannel(payload.channel_pref ?? payload.channelPref ?? null, DEFAULT_CHANNEL);
  const effortCapacity = normalizeEffort(payload.effort_capacity ?? payload.effortCapacity ?? null, DEFAULT_EFFORT);
  const quizSessionId = payload.quiz_session_id ?? payload.quizSessionId ?? null;

  const tagSet = new Set([
    tier,
    channel,
    ...toTagList(payload.goal ?? payload.goals),
    ...toTagList(payload.availability),
  ]);

  return {
    userId,
    friendId,
    friendName,
    tier,
    tierRaw: String(tierRaw).trim(),
    channel,
    effortCapacity,
    capacityRank: effortRank(effortCapacity, DEFAULT_EFFORT),
    quizSessionId,
    tags: tagSet,
    friendScore,
    friendType,
  };
}

async function findExistingArc(pool, context) {
  const { userId, friendId, quizSessionId } = context;
  const { rows } = await pool.query(
    `
      SELECT
        id,
        user_id,
        name,
        day,
        length,
        arc_points,
        next_threshold,
        points_today,
        friend_score,
        friend_type,
        lifetime,
        steps,
        challenge,
        badges
        FROM friend_arcs
       WHERE user_id = $1
         AND id = $2
         AND quiz_session_id IS NOT DISTINCT FROM $3
       LIMIT 1
    `,
    [userId, friendId, quizSessionId]
  );
  return rows[0] || null;
}

async function fetchActivePlans(pool) {
  const { rows } = await pool.query(
    `
      SELECT id, name, tier, channel, effort, length_days, tags
        FROM plan_templates
       WHERE is_active = TRUE
    `
  );
  return rows || [];
}

async function fetchPlanSteps(pool, planId) {
  const { rows } = await pool.query(
    `
      SELECT id,
             COALESCE(title, title_template) AS title,
             COALESCE(meta, meta_template)   AS meta,
             channel,
             effort,
             day_number
        FROM step_templates
       WHERE plan_template_id = $1
       ORDER BY day_number ASC NULLS LAST, id ASC
    `,
    [planId]
  );
  return rows || [];
}

function buildFallbackSteps(context, planSelection) {
  const friendName =
    (context.friendName && String(context.friendName).trim()) || "your friend";
  const friendId = String(context.friendId || "friend");
  const planChannel =
    planSelection?.plan?.channel || planSelection?.plan?.channel_variant;
  const planEffort = planSelection?.plan?.effort;
  const channel = normalizeChannel(planChannel, context.channel || DEFAULT_CHANNEL);
  const effort = normalizeEffort(planEffort, context.effortCapacity || DEFAULT_EFFORT);

  const templates = [
    {
      title: `Send ${friendName} a quick check-in`,
      meta: "Kick off the arc with a warm message and ask how their week is going.",
    },
    {
      title: `Share a micro-kindness idea with ${friendName}`,
      meta: "Mention something you’d love to try together or a small favor you can offer.",
    },
    {
      title: `Lock in a 10-minute catch-up`,
      meta: "Suggest a short call or coffee to keep momentum going.",
    },
  ];

  return templates.map((tpl, index) => ({
    id: `${friendId}-fallback-${index + 1}`,
    day_number: index + 1,
    title: tpl.title,
    meta: tpl.meta,
    channel,
    effort,
    fallback: true,
  }));
}

async function fetchActiveChallenges(pool) {
  const { rows } = await pool.query(
    `
      SELECT id,
             title_template AS title,
             description_template AS description,
             channel,
             effort,
             tags,
             est_minutes,
             points,
             swaps_allowed AS swaps_left
        FROM challenge_templates
       WHERE is_active = TRUE
    `
  );
  return rows || [];
}

function selectPlan(planRows, context) {
  let best = null;
  for (const row of planRows) {
    const planChannel = normalizeChannel(row.channel, "mixed");
    const planEffort = normalizeEffort(row.effort, "medium");
    const planTags = normalizeTagList(row.tags);

    const tierMatch = normalizeTier(row.tier) === context.tier;
    const channelMatch = channelsCompatible(planChannel, context.channel);
    const effortOk = effortRank(planEffort, "medium") <= context.capacityRank;
    const overlap = countOverlap(planTags, context.tags);

    const score =
      (tierMatch ? 100 : 0) +
      (channelMatch ? 20 : 0) +
      (effortOk ? 10 : 0) +
      overlap * 2;

    if (!best || score > best.score || (score === best.score && compareIds(row.id, best.plan.id) < 0)) {
      best = {
        plan: {
          id: row.id,
          name: row.name,
          channel: planChannel,
          effort: planEffort,
          tier: normalizeTier(row.tier),
          lengthDays: toPositiveInteger(row.length_days, DEFAULT_LENGTH_DAYS),
          tags: planTags,
        },
        score,
      };
    }
  }
  return best;
}

function pickStarter7dPlan(planRows, context) {
  if (!Array.isArray(planRows) || !planRows.length) return null;

  const candidates = planRows.filter((row) => {
    const length = Number(row.length_days ?? row.lengthDays ?? NaN);
    if (!Number.isFinite(length) || length !== STARTER_LENGTH_DAYS) {
      return false;
    }
    const tags = normalizeTagList(row.tags);
    return tags.includes(STARTER_TAG);
  });

  if (!candidates.length) {
    return null;
  }

  return selectPlan(candidates, context);
}

function selectChallenge(challengeRows, context) {
  const candidates = [];
  for (const row of challengeRows) {
    const challengeChannel = normalizeChannel(row.channel, "mixed");
    const challengeEffort = normalizeEffort(row.effort, "medium");

    if (!channelsCompatible(challengeChannel, context.channel)) continue;
    if (effortRank(challengeEffort, "medium") > context.capacityRank) continue;

    const tags = normalizeTagList(row.tags);
    const overlap = countOverlap(tags, context.tags);

    candidates.push({
      challenge: row,
      normalized: {
        channel: challengeChannel,
        effort: challengeEffort,
        tags,
      },
      overlap,
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return compareIds(a.challenge.id, b.challenge.id);
  });

  return candidates[0];
}

function channelsCompatible(candidate, requested) {
  if (candidate === "mixed" || requested === "mixed") return true;
  return candidate === requested;
}

function compareIds(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  const aFinite = Number.isFinite(numA);
  const bFinite = Number.isFinite(numB);

  if (aFinite && bFinite) return numA - numB;
  if (aFinite) return -1;
  if (bFinite) return 1;

  return String(a).localeCompare(String(b));
}

function normalizeTagList(value) {
  const list = toTagList(value);
  if (!list.length) return [];
  return Array.from(new Set(list));
}

function renderTemplateString(value, context) {
  if (typeof value !== "string") return value;
  if (!value.includes("{{")) return value;
  const replacements = {
    friend_name: context.friendName,
    friend_type: context.friendType ?? context.tierRaw ?? "",
    friend_score: context.friendScore ?? "",
  };
  return value.replace(/{{\s*(friend_name|friend_type|friend_score)\s*}}/gi, (_, key) => {
    const normalizedKey = String(key).toLowerCase();
    const replacement = replacements[normalizedKey];
    return replacement == null ? "" : String(replacement);
  });
}

function renderTemplateValue(value, context) {
  if (typeof value === "string") return renderTemplateString(value, context);
  if (Array.isArray(value)) return value.map((item) => renderTemplateValue(item, context));
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = renderTemplateValue(item, context);
    }
    return result;
  }
  return value;
}

function buildArcRecord({
  context,
  planSelection,
  steps,
  challengeSelection,
  usingFallbackSteps = false,
  forcedStarterPlan = false,
}) {
  const { plan } = planSelection;
  const planLength = usingFallbackSteps
    ? Math.max(steps.length, plan.lengthDays || DEFAULT_LENGTH_DAYS)
    : plan.lengthDays || DEFAULT_LENGTH_DAYS;
  const friendId = String(context.friendId);

  const renderedSteps = steps.map((step, index) => {
    const dayNumber = toPositiveInteger(step.day_number, index + 1);
    const stepChannel = normalizeChannel(step.channel, plan.channel || context.channel);
    const stepEffort = normalizeEffort(step.effort, plan.effort || context.effortCapacity);
    const title = renderTemplateString(step.title || `Day ${dayNumber} Step`, context);

    return {
      id: `${friendId}-d${dayNumber}`,
      title,
      meta: renderTemplateValue(step.meta ?? null, context),
      status: "todo",
      channel: stepChannel,
      effort: stepEffort,
      day: dayNumber,
      fallback: Boolean(step.fallback),
    };
  });

  const { challenge, normalized } = challengeSelection;
  const basePointsRaw = Number(challenge.points);
  const basePoints = Number.isFinite(basePointsRaw) ? basePointsRaw : 100;
  const normalizedEffort = normalizeEffort(normalized.effort, context.effortCapacity || DEFAULT_EFFORT);
  const adjustedPoints =
    normalizedEffort === "low" && basePoints <= 25 ? basePoints * 2 : basePoints;
  const challengePoints = Math.max(0, Math.round(adjustedPoints));
  const renderedChallenge = {
    id: `${friendId}-first`,
    templateId: challenge.id,
    title: renderTemplateString(challenge.title || "First Challenge", context),
    description: renderTemplateString(challenge.description || "", context),
    effort: normalized.effort || context.effortCapacity,
    channel: normalized.channel || context.channel,
    estMinutes: toPositiveInteger(challenge.est_minutes, 30),
    points: challengePoints,
    swapsLeft: toPositiveInteger(challenge.swaps_left, 0),
  };

  const lifetimeState = {
    ...DEFAULT_LIFETIME,
    planTemplateId: plan.id,
    planName: plan.name ?? null,
  };
  if (forcedStarterPlan) {
    lifetimeState.starter7AutoSelected = true;
  }

  return {
    name: context.friendName,
    day: 1,
    length: planLength,
    arcPoints: DEFAULT_ARC_POINTS,
    nextThreshold: DEFAULT_NEXT_THRESHOLD,
    pointsToday: DEFAULT_POINTS_TODAY,
    friendScore: context.friendScore ?? null,
    friendType: context.friendType ?? context.tierRaw,
    lifetime: lifetimeState,
    steps: renderedSteps,
    challenge: renderedChallenge,
    badges: { ...DEFAULT_BADGE_STATE },
  };
}

async function insertArc(pool, context, arcRecord) {
  const { rows } = await pool.query(
    `
      INSERT INTO friend_arcs (
        id,
        user_id,
        quiz_session_id,
        name,
        day,
        length,
        arc_points,
        next_threshold,
        points_today,
        friend_score,
        friend_type,
        lifetime,
        steps,
        challenge,
        badges
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13::jsonb,
        $14::jsonb,
        $15::jsonb
      )
      RETURNING
        id,
        user_id,
        name,
        day,
        length,
        arc_points,
        next_threshold,
        points_today,
        friend_score,
        friend_type,
        lifetime,
        steps,
        challenge,
        badges
    `,
    [
      context.friendId,
      context.userId,
      context.quizSessionId,
      arcRecord.name,
      arcRecord.day,
      arcRecord.length,
      arcRecord.arcPoints,
      arcRecord.nextThreshold,
      arcRecord.pointsToday,
      arcRecord.friendScore,
      arcRecord.friendType,
      JSON.stringify(arcRecord.lifetime),
      JSON.stringify(arcRecord.steps),
      JSON.stringify(arcRecord.challenge),
      JSON.stringify(arcRecord.badges),
    ]
  );
  return rows[0];
}

export const __testables = {
  pickStarter7dPlan,
  normalizeTagList,
};
