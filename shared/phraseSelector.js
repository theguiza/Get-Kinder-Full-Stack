// shared/phraseSelector.js
// Centralized helpers for phrase metadata filtering & selection.

import fs from 'fs';

export const ALLOWED_PURPOSES = new Set([
  'invite_leisure',
  'striving_pivot',
  'surge_stack',
  'context_shift',
  'needing',
  'affirming',
  'ritualize'
]);

export const MATTERING_VALUES = ['Noticing', 'Affirming', 'Needing'];
export const PURPOSE_PRIORITY_FALLBACK = [
  'invite_leisure',
  'striving_pivot',
  'needing',
  'affirming'
];

export const EARLY_LEVELS = new Set(['starter', 'acq-to-casual', 'casual-maintain']);
export const LATE_LEVELS = new Set(['friend-to-close', 'close-to-best']);

export const EFFORT_ORDER = { low: 1, medium: 2, high: 3 };

const OPT_OUT_REGEX = /\b(no pressure|if not|if now's bad|fine to skip|totally fine|prefer|wave if|option)\b/i;

export function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function toSimplePhrase(phrase) {
  if (!phrase) return { text: '', family: 'text' };
  if (typeof phrase === 'string') {
    return { text: phrase, family: 'text' };
  }
  return {
    text: String(phrase.text ?? '').trim(),
    family: typeof phrase.family === 'string' && phrase.family.trim() ? phrase.family.trim() : 'text'
  };
}

export function toSimplePhraseList(list) {
  return ensureArray(list).map((item) => toSimplePhrase(item));
}

export function normalizeTextKey(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeEffort(value, fallback = 'low') {
  if (!value) return fallback;
  const lowered = String(value).trim().toLowerCase();
  return EFFORT_ORDER[lowered] ? lowered : fallback;
}

export function effortRank(value, fallback = 'low') {
  const normalized = normalizeEffort(value, fallback);
  return EFFORT_ORDER[normalized] || EFFORT_ORDER[fallback];
}

export function parseGoalTags(goalTags = []) {
  const levels = new Set();
  const clusters = new Set();
  const types = new Set();
  const families = new Set();
  let slug = null;

  for (const raw of goalTags) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('level:')) {
      levels.add(lower.slice(6));
    } else if (lower.startsWith('cluster:')) {
      clusters.add(lower.slice(8));
    } else if (lower.startsWith('type:')) {
      types.add(lower.slice(5));
    } else if (lower.startsWith('plan_slug:')) {
      slug = lower.slice(10);
    } else if (lower.startsWith('channel:')) {
      families.add(lower.slice(8));
    }
  }

  return { levels, clusters, types, families, slug };
}

export function normalizePurposePriority(list) {
  const ordered = [];
  const seen = new Set();
  for (const item of ensureArray(list)) {
    if (typeof item !== 'string') continue;
    const lower = item.trim().toLowerCase();
    if (!ALLOWED_PURPOSES.has(lower) || seen.has(lower)) continue;
    ordered.push(lower);
    seen.add(lower);
  }
  for (const fallback of PURPOSE_PRIORITY_FALLBACK) {
    if (!seen.has(fallback)) {
      ordered.push(fallback);
      seen.add(fallback);
    }
  }
  return ordered;
}

export function normalizeMatteringPriority(quota) {
  if (!quota || typeof quota !== 'object') return [...MATTERING_VALUES];
  const entries = Object.entries(quota)
    .filter(([key, value]) => MATTERING_VALUES.includes(key) && Number.isFinite(Number(value)))
    .map(([key, value]) => [key, Number(value)]);
  if (!entries.length) return [...MATTERING_VALUES];
  entries.sort((a, b) => b[1] - a[1]);
  const ordered = [];
  for (const [key] of entries) {
    ordered.push(key);
  }
  for (const fallback of MATTERING_VALUES) {
    if (!ordered.includes(fallback)) {
      ordered.push(fallback);
    }
  }
  return ordered;
}

export function determineTargetTimebox(levels) {
  if (!levels || !levels.size) return 20;
  for (const level of levels) {
    if (LATE_LEVELS.has(level)) return 45;
  }
  return 20;
}

export function hasOptOutLanguage(text) {
  if (!text) return false;
  return OPT_OUT_REGEX.test(text);
}

export function isEarlyLevel(levels) {
  if (!levels || !levels.size) return true;
  for (const level of levels) {
    if (EARLY_LEVELS.has(level)) return true;
  }
  return false;
}

export function filterEligibleOpeners(openers, { levels, clusters, types, planEffort }) {
  if (!Array.isArray(openers) || !openers.length) return [];
  const effortCeiling = effortRank(planEffort, 'low');
  return openers.filter((phrase) => {
    if (!phrase || typeof phrase !== 'object') return false;
    if (levels?.size && phrase.level && !levels.has(String(phrase.level))) return false;
    if (clusters?.size) {
      const phraseClusters = ensureArray(phrase.cluster).map((c) => String(c || '').toLowerCase());
      if (!phraseClusters.some((cluster) => clusters.has(cluster))) {
        return false;
      }
    }
    if (types?.size) {
      const phraseTypes = ensureArray(phrase.types).map((t) => String(t || '').toLowerCase());
      if (!phraseTypes.some((type) => types.has(type))) {
        return false;
      }
    }
    const phraseEffortRank = effortRank(phrase.effort, 'low');
    if (phraseEffortRank > effortCeiling) return false;
    return true;
  });
}

export function scorePhrase(phrase, { purposePriority, matteringPriority, earlyLevel, targetTimebox, family }) {
  const purposeIndex = purposePriority.indexOf(phrase.purpose);
  const normalizedPurposeIndex = purposeIndex === -1 ? purposePriority.length : purposeIndex;
  const matteringSet = ensureArray(phrase.mattering);
  let matteringIndex = matteringPriority.length;
  for (const category of matteringPriority) {
    if (matteringSet.includes(category)) {
      matteringIndex = matteringPriority.indexOf(category);
      break;
    }
  }
  const strivingPenalty = phrase.striving ? 0 : 1;
  const timebox = Number.isFinite(Number(phrase.timebox_minutes))
    ? Number(phrase.timebox_minutes)
    : targetTimebox;
  const timeboxPenalty = Math.abs(timebox - targetTimebox);
  const optOutPenalty =
    (family === 'call' || family === 'irl') && !hasOptOutLanguage(phrase.text) ? 10 : 0;
  const earlyBonus = earlyLevel && phrase.purpose === 'invite_leisure' ? -5 : 0;

  return (
    normalizedPurposeIndex * 100 +
    matteringIndex * 10 +
    strivingPenalty * 5 +
    timeboxPenalty +
    optOutPenalty +
    earlyBonus
  );
}

export function selectOpenerPhrase({
  library,
  family,
  goalTags = [],
  planEffort = 'low',
  selectorHints = null,
  excludeKeys = new Set(),
  rng = Math.random
}) {
  const openers = library?.openers?.[family];
  if (!Array.isArray(openers) || !openers.length) {
    return { phrase: null, eligible: [] };
  }
  const { levels, clusters, types } = parseGoalTags(goalTags);
  const eligible = filterEligibleOpeners(openers, { levels, clusters, types, planEffort }).filter(
    (phrase) => !excludeKeys.has(normalizeTextKey(phrase.text))
  );
  if (!eligible.length) {
    return { phrase: null, eligible: [] };
  }
  const purposePriority = normalizePurposePriority(selectorHints?.purpose_priority);
  const matteringPriority = normalizeMatteringPriority(selectorHints?.mattering_quota);
  const targetTimebox = determineTargetTimebox(levels);
  const earlyLevel = isEarlyLevel(levels);

  const scored = eligible.map((phrase) => ({
    phrase,
    score: scorePhrase(phrase, {
      purposePriority,
      matteringPriority,
      earlyLevel,
      targetTimebox,
      family
    })
  }));
  scored.sort((a, b) => a.score - b.score);
  const bestScore = scored[0].score;
  const top = scored.filter((entry) => Math.abs(entry.score - bestScore) < 1e-6);
  const index = rng && top.length > 1 ? Math.floor(rng() * top.length) : 0;
  return { phrase: top[index].phrase, eligible };
}

export function buildSelectorHintMap(blueprints) {
  const map = new Map();
  if (!blueprints || !Array.isArray(blueprints.plans)) return map;
  for (const plan of blueprints.plans) {
    if (!plan?.slug) continue;
    if (plan.selector_hints) {
      map.set(String(plan.slug).toLowerCase(), plan.selector_hints);
    }
  }
  return map;
}

export function loadBlueprintSelectorHints(blueprintsPath) {
  try {
    const raw = fs.readFileSync(blueprintsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return buildSelectorHintMap(parsed);
  } catch {
    return new Map();
  }
}

export function dedupeTagsPreserveOrder(tags = []) {
  const seen = new Set();
  const result = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(trimmed);
  }
  return result;
}

export function extractPlanSlugFromTags(tags = []) {
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const lower = tag.trim().toLowerCase();
    if (lower.startsWith('plan_slug:')) {
      return lower.slice(10);
    }
  }
  return null;
}

export function resolveSelectorHints(selectorHintMap, tags = []) {
  const slug = extractPlanSlugFromTags(tags);
  if (!slug) return null;
  return selectorHintMap.get(slug) ?? null;
}
