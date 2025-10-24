const REQUIRED_EFFORTS = new Set(['low', 'medium', 'high']);
const REQUIRED_CHANNELS = new Set(['text', 'call', 'irl']);
const EFFORT_RANK = { low: 1, medium: 2, high: 3 };

export function channelsCompatible(variant, preferred) {
  return variant === 'mixed' || variant === preferred;
}

function assertPool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg Pool (or compatible) instance with a query method is required');
  }
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Quiz payload must be an object');
  }

  const userIdRaw = payload.user_id ?? payload.userId;
  const friendIdRaw = payload.friend_id ?? payload.friendId;
  const friendNameRaw = payload.friend_name ?? payload.friendName;
  const tierRaw = payload.tier ?? payload.friend_type ?? payload.friendType;
  const channelRaw =
    payload.preferredChannel ??
    payload.preferred_channel ??
    payload.channel_pref ??
    payload.channelPref ??
    payload.channel;
  const effortRaw =
    payload.capacityEffort ??
    payload.capacity_effort ??
    payload.effort_capacity ??
    payload.effort ??
    payload.effortCapacity;
  const tagsRaw = payload.tags ?? payload.goal_tags ?? payload.goals ?? [];
  const friendScoreRaw = payload.friend_score ?? payload.friendScore ?? null;

  if (userIdRaw === undefined || userIdRaw === null) {
    throw new Error('Quiz payload is missing user_id');
  }
  if (friendIdRaw === undefined || friendIdRaw === null) {
    throw new Error('Quiz payload is missing friend_id');
  }
  if (!friendNameRaw || !String(friendNameRaw).trim()) {
    throw new Error('Quiz payload is missing friend_name');
  }
  if (!tierRaw || !String(tierRaw).trim()) {
    throw new Error('Quiz payload is missing tier');
  }

  const userId = toInteger(userIdRaw, 'user_id');
  const friendId = String(friendIdRaw).trim();
  const friendName = String(friendNameRaw).trim();
  const tier = String(tierRaw).trim();
  const preferredChannel = normalizeChannel(channelRaw);
  const capacityEffort = normalizeEffort(effortRaw);
  const tags = normalizeTags(tagsRaw);
  const friendScore = friendScoreRaw === null || friendScoreRaw === undefined ? null : toInteger(friendScoreRaw, 'friend_score');

  return {
    userId,
    friendId,
    friendName,
    tier,
    preferredChannel,
    capacityEffort,
    tags,
    friendScore
  };
}

function normalizeChannel(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (REQUIRED_CHANNELS.has(value)) {
    return value;
  }
  if (value === 'sms' || value === 'message' || value === 'texting' || value === 'chat') {
    return 'text';
  }
  if (value === 'phone' || value === 'call' || value === 'voice') {
    return 'call';
  }
  if ((value === 'irl') || value === 'meet' || value === 'inperson' || value === 'in-person') {
    return 'irl';
  }
  return 'text';
}

function normalizeEffort(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (REQUIRED_EFFORTS.has(value)) {
    return value;
  }
  if (value === 'medium-low') {
    return 'medium';
  }
  if (value === 'medium-high') {
    return 'high';
  }
  return 'low';
}

function normalizeTags(raw) {
  if (raw === null || raw === undefined) {
    return [];
  }
  if (Array.isArray(raw)) {
    const tags = [];
    for (const item of raw) {
      tags.push(...normalizeTags(item));
    }
    return uniqueStrings(tags);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeTags(parsed);
      } catch {
        // fall through into split
      }
    }
    return trimmed
      .split(/[,|]/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof raw === 'object') {
    return normalizeTags(Object.values(raw));
  }
  return [String(raw).trim().toLowerCase()].filter(Boolean);
}

function uniqueStrings(list) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const lowered = String(item).trim().toLowerCase();
    if (!lowered || seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    result.push(lowered);
  }
  return result;
}

function toInteger(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Expected numeric value for ${label}`);
  }
  return Math.trunc(num);
}

function toTagList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    try {
      return toTagList(Object.values(value));
    } catch {
      return [];
    }
  }
  return [String(value).trim().toLowerCase()].filter(Boolean);
}

function countOverlap(planTags, tagSet) {
  if (!planTags.length || !tagSet.size) {
    return 0;
  }
  let count = 0;
  for (const tag of planTags) {
    if (tagSet.has(tag)) {
      count += 1;
    }
  }
  return count;
}

function applyFriendName(template, friendName) {
  if (template == null) {
    return '';
  }
  return String(template).replace(/{{\s*friend_name\s*}}/gi, friendName);
}

function mapStepRow(row, friendName) {
  const step = {
    day: Number(row.day_number),
    title: applyFriendName(row.title_template, friendName),
    channel: row.channel,
    effort: row.effort,
    status: 'todo'
  };
  if (row.meta_template !== null && row.meta_template !== undefined && row.meta_template !== '') {
    step.meta = String(row.meta_template);
  }
  return step;
}

export async function generateArcForQuiz(pool, payload) {
  assertPool(pool);
  const context = normalizePayload(payload);

  const plan = await selectBestPlan(pool, context);
  if (!plan) {
    throw new Error('No active plan template matched the quiz payload');
  }

  const steps = await fetchPlanSteps(pool, plan.id);
  if (!steps.length) {
    throw new Error('Selected plan template has no step templates');
  }

  const challenge = await selectChallenge(pool, context);
  if (!challenge) {
    throw new Error('No active challenge template matched channel and effort constraints');
  }

  const planLength = toInteger(plan.length_days, 'plan.length_days');

  const stepsPayload = steps.map((row) => mapStepRow(row, context.friendName));
  const challengePayload = {
    title: applyFriendName(challenge.title_template, context.friendName),
    description: applyFriendName(challenge.description_template, context.friendName),
    channel: challenge.channel,
    effort: challenge.effort,
    estMinutes: toInteger(challenge.est_minutes, 'challenge.est_minutes'),
    points: toInteger(challenge.points, 'challenge.points'),
    swapsAllowed: toInteger(challenge.swaps_allowed, 'challenge.swaps_allowed')
  };

  const insertParams = {
    id: `${context.userId}:${context.friendId}`,
    userId: context.userId,
    friendName: context.friendName,
    planLength,
    friendType: plan.tier,
    friendScore: context.friendScore,
    steps: JSON.stringify(stepsPayload),
    challenge: JSON.stringify(challengePayload)
  };

  const inserted = await insertFriendArc(pool, insertParams);
  return inserted;
}

async function selectBestPlan(pool, context) {
  const result = await pool.query(
    `
      SELECT id, name, tier, length_days, cadence_per_week, channel_variant, tags
      FROM plan_templates
      WHERE is_active = TRUE
    `
  );

  if (!result.rows.length) {
    return null;
  }

  const tagSet = new Set(context.tags);
  const tierLower = context.tier.toLowerCase();
  let best = null;

  for (const row of result.rows) {
    const planTags = toTagList(row.tags);
    const overlap = countOverlap(planTags, tagSet);
    const tierScore = row.tier && row.tier.toLowerCase() === tierLower ? 100 : 0;
    const channelScore = channelsCompatible(row.channel_variant, context.preferredChannel) ? 20 : 0;
    const score = tierScore + channelScore + overlap * 2;

    if (!best) {
      best = { row, score };
      continue;
    }

    if (score > best.score) {
      best = { row, score };
      continue;
    }

    if (score === best.score) {
      const currentId = BigInt(row.id);
      const bestId = BigInt(best.row.id);
      if (currentId < bestId) {
        best = { row, score };
      }
    }
  }

  return best ? best.row : null;
}

async function fetchPlanSteps(pool, planId) {
  const result = await pool.query(
    `
      SELECT plan_template_id, day_number, title_template, meta_template, channel, effort, tags
      FROM step_templates
      WHERE plan_template_id = $1
      ORDER BY day_number ASC
    `,
    [planId]
  );

  return result.rows;
}

async function selectChallenge(pool, context) {
  const capacityRank = EFFORT_RANK[context.capacityEffort];
  const tagArray = context.tags;

  const result = await pool.query(
    `
      WITH ranked AS (
        SELECT
          id,
          title_template,
          description_template,
          channel,
          effort,
          est_minutes,
          points,
          swaps_allowed,
          tags,
          (
            SELECT COUNT(*)
            FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag(val)
            WHERE val = ANY($2)
          ) AS tag_overlap,
          CASE effort
            WHEN 'low' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'high' THEN 3
          END AS effort_rank
        FROM challenge_templates
        WHERE is_active = TRUE
          AND (channel = 'any' OR channel = $1)
      )
      SELECT
        id,
        title_template,
        description_template,
        channel,
        effort,
        est_minutes,
        points,
        swaps_allowed,
        tag_overlap
      FROM ranked
      WHERE effort_rank <= $3
      ORDER BY tag_overlap DESC, id ASC
      LIMIT 1
    `,
    [context.preferredChannel, tagArray, capacityRank]
  );

  return result.rows[0] ?? null;
}

async function insertFriendArc(pool, params) {
  const result = await pool.query(
    `
      INSERT INTO friend_arcs (
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
      )
      VALUES (
        $1,
        $2,
        $3,
        1,
        $4,
        0,
        500,
        0,
        $5,
        $6,
        '{}'::jsonb,
        $7::jsonb,
        $8::jsonb,
        '{}'::jsonb
      )
      RETURNING id, user_id, name, day, length, arc_points, next_threshold, points_today, friend_score, friend_type, lifetime, steps, challenge, badges
    `,
    [
      params.id,
      params.userId,
      params.friendName,
      params.planLength,
      params.friendScore,
      params.friendType,
      params.steps,
      params.challenge
    ]
  );

  return result.rows[0];
}
