#!/usr/bin/env node
// scripts/alignContent.js
// Normalize phrases/blueprints, merge updated sources, attach selector hints, and run validations.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_PURPOSES,
  MATTERING_VALUES,
  PURPOSE_PRIORITY_FALLBACK,
  ensureArray,
  normalizeTextKey,
  normalizePurposePriority,
  normalizeMatteringPriority,
  parseGoalTags,
  filterEligibleOpeners
} from '../shared/phraseSelector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');

const PHRASES_PATH = path.join(CONTENT_DIR, 'phrases.json');
const BLUEPRINTS_PATH = path.join(CONTENT_DIR, 'blueprints.json');
const UPDATED_PHRASES_JSON = path.join(CONTENT_DIR, 'updated_phrases.json');
const UPDATED_PHRASES_MD = path.join(CONTENT_DIR, 'updated_phrases.md');
const UPDATED_BLUEPRINTS_JSON = path.join(CONTENT_DIR, 'updated_blueprints.json');
const UPDATED_BLUEPRINTS_MD = path.join(CONTENT_DIR, 'updated_blueprints.md');

const BACKUP_TIMESTAMP = formatTimestamp(new Date());
const BACKUP_SUFFIX = `.bak.${BACKUP_TIMESTAMP}`;

const FAMILY_ORDER = ['text', 'call', 'email', 'irl'];
const LEVEL_ORDER = [
  'starter',
  'acq-to-casual',
  'casual-to-friend',
  'casual-maintain',
  'friend-maintain',
  'friend-to-close',
  'close-to-best'
];

const PURPOSE_REMAP = {
  close_next_step: 'surge_stack',
  nudge_commit: 'ritualize'
};

const CLUSTER_TYPES = {
  explorer: ['adventurer', 'collaborator'],
  steady: ['confidante', 'caregiver', 'coach'],
  rhythm: ['anchor', 'communicator', 'connector']
};

const DEFAULT_HINTS = {
  purpose_priority: [...PURPOSE_PRIORITY_FALLBACK],
  mattering_quota: { Noticing: 0.3, Affirming: 0.5, Needing: 0.2 }
};


async function main() {
  const summary = {
    added: 0,
    replaced: 0,
    kept: 0,
    planSlugs: new Set(),
    warnings: [],
    errors: []
  };

  const basePhrases = readJSON(PHRASES_PATH);
  const baseBlueprints = readJSON(BLUEPRINTS_PATH);
  const updatedPhraseSource = readOptionalJSON(UPDATED_PHRASES_JSON, UPDATED_PHRASES_MD);
  const updatedBlueprintSource = readOptionalJSON(UPDATED_BLUEPRINTS_JSON, UPDATED_BLUEPRINTS_MD);

  const mergedPhrases = mergePhrases(basePhrases, updatedPhraseSource, summary);
  const mergedBlueprints = mergeBlueprints(baseBlueprints, updatedBlueprintSource, summary);
  ensurePlanCoverage(mergedPhrases.openers, mergedBlueprints.plans, summary);

  runValidations(mergedPhrases, mergedBlueprints, summary);

  createBackup(PHRASES_PATH);
  createBackup(BLUEPRINTS_PATH);

  writeJSON(PHRASES_PATH, mergedPhrases);
  writeJSON(BLUEPRINTS_PATH, mergedBlueprints);

  printSummary(summary);

  if (summary.errors.length) {
    process.exitCode = 1;
  }
}

function readJSON(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (error) {
    console.error(`✗ Failed to read ${absPath}:`, error.message);
    process.exit(1);
  }
}

function readOptionalJSON(jsonPath, mdPath) {
  if (fs.existsSync(jsonPath)) {
    return readJSON(jsonPath);
  }
  if (mdPath && fs.existsSync(mdPath)) {
    const raw = fs.readFileSync(mdPath, 'utf8');
    const match = raw.match(/```json\s*([\s\S]+?)```/i);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      console.warn(`! Failed to parse JSON block in ${mdPath}:`, error.message);
      return null;
    }
  }
  return null;
}

function mergePhrases(base, updated, summary) {
  const result = { openers: {}, nudges: [], closers: [], durations: {} };
  const updatedOpeners = updated?.openers ?? {};
  const updatedNudges = ensureArray(updated?.nudges);
  const updatedClosers = ensureArray(updated?.closers);
  const baseNudges = ensureArray(base?.nudges);
  const baseClosers = ensureArray(base?.closers);

  for (const family of FAMILY_ORDER) {
    const updatedList = ensureArray(updatedOpeners[family]).map((item) =>
      normalizePhraseObject(item, { family })
    );
    const legacyList = convertLegacyList(ensureArray(base?.openers?.[family]), family);
    const merged = mergePhraseLists(legacyList, updatedList, summary);
    result.openers[family] = merged;
  }

  ensureLevelCoverage(result.openers, summary);

  result.nudges = mergePhraseLists(
    convertLegacyList(baseNudges, 'text', { section: 'nudges' }),
    updatedNudges.map((item) =>
      normalizePhraseObject(item, { family: item.family ?? 'text', section: 'nudges' })
    ),
    summary
  );
  result.closers = mergePhraseLists(
    convertLegacyList(baseClosers, 'text', { section: 'closers' }),
    updatedClosers.map((item) =>
      normalizePhraseObject(item, { family: item.family ?? 'text', section: 'closers' })
    ),
    summary
  );

  const durations = updated?.durations ?? base?.durations ?? {};
  result.durations = {
    low: Number(durations.low ?? 5),
    medium: Number(durations.medium ?? 15),
    high: Number(durations.high ?? 30)
  };

  return result;
}

function ensureLevelCoverage(openers, summary) {
  for (const family of FAMILY_ORDER) {
    const list = openers[family];
    if (!Array.isArray(list) || !list.length) continue;
    for (const level of LEVEL_ORDER) {
      const exists = list.some((phrase) => phrase.level === level);
      if (!exists) {
        const source = list[0];
        const clone = {
          ...source,
          level,
          timebox_minutes: normalizeTimebox(source.timebox_minutes, level)
        };
        list.push(clone);
        summary.added += 1;
      }
    }
    list.sort((a, b) => {
      const textCompare = a.text.localeCompare(b.text);
      if (textCompare !== 0) return textCompare;
      return LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
    });
  }
}

function ensurePlanCoverage(openers, plans, summary) {
  if (!Array.isArray(plans)) return;
  for (const plan of plans) {
    const goalTags = ensureArray(plan?.goal_tags);
    const { levels } = parseGoalTags(goalTags);
    const planLevel = Array.from(levels)[0] || "casual-maintain";
    const selectorHints = plan?.selector_hints ?? DEFAULT_HINTS;
    const families = new Set(
      ensureArray(plan?.day_types).map((dt) => normalizeFamily(dt?.family ?? "text"))
    );

    for (const family of families) {
      const list = openers[family];
      if (!Array.isArray(list) || !list.length) continue;
      for (const purpose of selectorHints.purpose_priority ?? []) {
        if (!list.some((phrase) => phrase.level === planLevel && phrase.purpose === purpose)) {
          const template = pickTemplateByPurpose(list, purpose) ?? list[0];
          list.push(
            clonePhrase(template, {
              level: planLevel,
              purpose,
              mattering: [defaultMatteringForPurpose(purpose)],
              striving: purpose !== "affirming",
            })
          );
          summary.added += 1;
        }
      }
      for (const category of Object.keys(selectorHints.mattering_quota ?? {})) {
        if (!list.some((phrase) => phrase.level === planLevel && phrase.mattering?.includes(category))) {
          const template = list[0];
          list.push(
            clonePhrase(template, {
              level: planLevel,
              mattering: [category],
            })
          );
          summary.added += 1;
        }
      }
      list.sort(sortPhrase);
    }
  }
}

function pickTemplateByPurpose(list, purpose) {
  return (
    list.find((phrase) => phrase.purpose === purpose) ??
    list.find((phrase) => phrase.text.toLowerCase().includes(purpose.split("_")[0])) ??
    null
  );
}

function clonePhrase(template, overrides = {}) {
  const level = overrides.level ?? template.level;
  const purpose = overrides.purpose ?? template.purpose;
  const mattering = overrides.mattering ?? template.mattering;
  const striving =
    typeof overrides.striving === "boolean"
      ? overrides.striving
      : purpose !== "affirming";

  return {
    text: template.text,
    family: template.family,
    level,
    cluster: [...template.cluster],
    types: [...template.types],
    effort: template.effort,
    purpose,
    mattering: Array.from(new Set(mattering)),
    striving,
    timebox_minutes: normalizeTimebox(template.timebox_minutes, level),
  };
}

function defaultMatteringForPurpose(purpose) {
  if (purpose === "needing") return "Needing";
  if (purpose === "affirming" || purpose === "ritualize" || purpose === "surge_stack") return "Affirming";
  return "Noticing";
}

function sortPhrase(a, b) {
  const textCompare = a.text.localeCompare(b.text);
  if (textCompare !== 0) return textCompare;
  const levelCompare = LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level);
  if (levelCompare !== 0) return levelCompare;
  return a.purpose.localeCompare(b.purpose);
}

function convertLegacyList(list, family, options = {}) {
  return ensureArray(list)
    .map((value) => {
      if (value && typeof value === 'object' && value.text) {
        return normalizePhraseObject(value, { family: value.family ?? family });
      }
      return normalizePhraseObject(
        { text: value, family },
        { family, section: options.section }
      );
    })
    .filter(Boolean);
}

function mergePhraseLists(legacyList, updatedList, summary) {
  const merged = [];
  const seen = new Set();
  const legacyMap = new Map();

  for (const phrase of legacyList) {
    const key = normalizeTextKey(phrase.text);
    if (!legacyMap.has(key)) {
      legacyMap.set(key, phrase);
    }
  }

  for (const phrase of updatedList) {
    const key = normalizeTextKey(phrase.text);
    if (!key) continue;
    if (legacyMap.has(key)) {
      summary.replaced += 1;
      legacyMap.delete(key);
    } else {
      summary.added += 1;
    }
    if (!seen.has(key)) {
      merged.push(phrase);
      seen.add(key);
    }
  }

  for (const [key, phrase] of legacyMap.entries()) {
    if (seen.has(key)) continue;
    merged.push(phrase);
    summary.kept += 1;
    seen.add(key);
  }

  merged.sort((a, b) => a.text.localeCompare(b.text));
  return merged;
}

function normalizePhraseObject(value, { family, section } = {}) {
  const text = String(value?.text ?? value ?? '').trim();
  if (!text) return null;
  const normalizedFamily = normalizeFamily(value?.family ?? family);
  const inferred = inferMetadataFromText(text, normalizedFamily, section);
  const level = normalizeLevel(value?.level ?? inferred.level);
  const effort = normalizeEffort(value?.effort ?? inferred.effort);
  const purpose = normalizePurpose(applyPurposeOverrides(text, value?.purpose ?? inferred.purpose));
  const mattering = normalizeMattering(value?.mattering ?? inferred.mattering);
  const cluster = normalizeClusterList(value?.cluster ?? inferred.cluster);
  const types = normalizeTypes(value?.types ?? inferred.types ?? deriveTypes(cluster));
  const timebox = normalizeTimebox(
    value?.timebox_minutes ?? inferred.timebox_minutes,
    level
  );
  const striving =
    typeof value?.striving === 'boolean' ? value.striving : inferred.striving;

  return {
    text,
    family: normalizedFamily,
    level,
    cluster,
    types,
    effort,
    purpose,
    mattering,
    striving,
    timebox_minutes: timebox
  };
}

function normalizeFamily(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  return FAMILY_ORDER.includes(lower) ? lower : 'text';
}

function normalizeLevel(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (LEVEL_ORDER.includes(lower)) return lower;
  return 'casual-maintain';
}

function normalizeEffort(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (lower === 'medium' || lower === 'high') return lower;
  return 'low';
}

function normalizePurpose(value) {
  if (!value) return 'invite_leisure';
  const lower = String(value).trim().toLowerCase();
  if (ALLOWED_PURPOSES.has(lower)) return lower;
  if (PURPOSE_REMAP[lower]) return PURPOSE_REMAP[lower];
  return 'invite_leisure';
}

function applyPurposeOverrides(text, current) {
  const lower = text.toLowerCase();
  if (/needing|favor|sanity-check|borrow|perspective|recommendation|help/.test(lower)) return 'needing';
  if (/striving|stuck|tiny thing|building|next step/.test(lower)) return 'striving_pivot';
  if (/fail-forward|resched|reset|float two new|punt/.test(lower)) return 'context_shift';
  if (/thanks|appreciate|same time|recurring|next week|hold a/.test(lower)) return 'ritualize';
  if (/affirming|proud|brave|cheering/.test(lower)) return 'affirming';
  if (/reply 1|reply 2|option|calendar|windows|slot|lock in/.test(lower)) return 'surge_stack';
  return current;
}

function normalizeMattering(list) {
  const normalized = [];
  for (const entry of ensureArray(list)) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const match = MATTERING_VALUES.find((value) => value.toLowerCase() === trimmed.toLowerCase());
    if (match && !normalized.includes(match)) {
      normalized.push(match);
    }
  }
  if (!normalized.length) {
    normalized.push('Noticing');
  }
  return normalized;
}

function normalizeClusterList(value) {
  const clusters = [];
  for (const entry of ensureArray(value)) {
    if (typeof entry !== 'string') continue;
    const lower = entry.trim().toLowerCase();
    if (lower && !clusters.includes(lower)) {
      clusters.push(lower);
    }
  }
  if (!clusters.length) {
    clusters.push('explorer', 'steady', 'rhythm');
  }
  return clusters;
}

function deriveTypes(clusters) {
  const set = new Set();
  for (const cluster of clusters) {
    for (const type of CLUSTER_TYPES[cluster] ?? []) {
      set.add(type);
    }
  }
  if (!set.size) {
    for (const typeList of Object.values(CLUSTER_TYPES)) {
      for (const type of typeList) set.add(type);
    }
  }
  return Array.from(set);
}

function normalizeTypes(value) {
  const set = new Set();
  for (const entry of ensureArray(value)) {
    if (typeof entry !== 'string') continue;
    const lower = entry.trim().toLowerCase();
    if (!lower) continue;
    for (const [cluster, typeList] of Object.entries(CLUSTER_TYPES)) {
      if (typeList.includes(lower)) {
        set.add(lower);
      }
    }
  }
  if (!set.size) {
    for (const typeList of Object.values(CLUSTER_TYPES)) {
      for (const type of typeList) set.add(type);
    }
  }
  return Array.from(set);
}

function normalizeTimebox(value, level) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) {
    const upper = level === 'friend-to-close' || level === 'close-to-best' ? 90 : 30;
    return Math.max(1, Math.min(upper, Math.round(num)));
  }
  return level === 'friend-to-close' || level === 'close-to-best' ? 40 : 15;
}

function inferMetadataFromText(text, family, section = 'openers') {
  const lower = text.toLowerCase();
  let level = 'casual-maintain';
  if (/starter|quick wave|first coffee|intro/.test(lower) || lower.includes('noticing')) {
    level = 'starter';
  } else if (/invite|walk|coffee|hang|window|option/.test(lower)) {
    level = 'casual-to-friend';
  } else if (/fail-forward|resched|reschedule|punt/.test(lower)) {
    level = 'casual-maintain';
  } else if (/striving|building|stuck/.test(lower)) {
    level = 'friend-maintain';
  } else if (/thanks|appreciate|next week|same time/.test(lower)) {
    level = 'close-to-best';
  } else if (/favor|need|borrow|sanity-check|what would you do/.test(lower)) {
    level = 'friend-to-close';
  }

  let purpose = 'invite_leisure';
  if (/striving|building|stuck|next tiny step/.test(lower)) {
    purpose = 'striving_pivot';
  } else if (/favor|need|sanity|borrow|perspective|help/.test(lower)) {
    purpose = 'needing';
  } else if (/affirming|proud|brave|cheering/.test(lower)) {
    purpose = 'affirming';
  } else if (/thanks|appreciate|same time/.test(lower)) {
    purpose = 'ritualize';
  } else if (/fail-forward|reset|resched|context/.test(lower)) {
    purpose = 'context_shift';
  } else if (/victory|celebrate|surge|stack|window/.test(lower)) {
    purpose = 'surge_stack';
  }

  const mattering = [];
  if (/noticing/.test(lower)) mattering.push('Noticing');
  if (/affirming|proud|brave/.test(lower)) mattering.push('Affirming');
  if (/needing|favor|help|borrow/.test(lower)) mattering.push('Needing');
  if (!mattering.length) {
    mattering.push(purpose === 'needing' ? 'Needing' : purpose === 'affirming' ? 'Affirming' : 'Noticing');
  }

  const clusterSet = new Set();
  if (/adventure|walk|park|public|window|option|invite/.test(lower)) {
    clusterSet.add('explorer');
  }
  if (/support|check-in|thanks|affirm|need|favor|resched|context/.test(lower)) {
    clusterSet.add('steady');
  }
  if (/routine|same time|reply|option|schedule|thread|keep/.test(lower)) {
    clusterSet.add('rhythm');
  }
  if (!clusterSet.size) {
    clusterSet.add('steady');
    clusterSet.add('rhythm');
  }

  let effort = family === 'call' || family === 'irl' ? 'medium' : 'low';
  if (/30|45|hour|long/.test(lower)) effort = 'high';
  if (/2-min|2 minute|micro|tiny|quick/.test(lower)) effort = 'low';

  const striving = purpose !== 'affirming';
  const timeboxMinutes =
    family === 'call'
      ? 20
      : family === 'irl'
      ? 20
      : family === 'email'
      ? 15
      : 12;

  if (section === 'closers') {
    purpose = purpose === 'needing' ? 'needing' : 'ritualize';
  } else if (section === 'nudges') {
    purpose = purpose === 'needing' ? 'needing' : 'striving_pivot';
  }

  return {
    level,
    purpose,
    mattering,
    cluster: Array.from(clusterSet),
    types: deriveTypes(Array.from(clusterSet)),
    effort,
    striving,
    timebox_minutes: timeboxMinutes
  };
}

function mergeBlueprints(base, updated, summary) {
  const basePlans = ensureArray(base?.plans);
  const updatedPlansMap = new Map();
  ensureArray(updated?.plans).forEach((plan) => {
    if (plan?.slug) {
      updatedPlansMap.set(String(plan.slug), plan);
    }
  });

  const mergedPlans = basePlans.map((plan) => {
    const patch = updatedPlansMap.get(plan.slug);
    const selectorHints = normalizeSelectorHints(patch?.selector_hints ?? plan?.selector_hints);
    if (selectorHints && plan.slug) {
      summary.planSlugs.add(plan.slug);
    }
    return orderPlanKeys(plan, selectorHints);
  });

  return {
    ...base,
    plans: mergedPlans
  };
}

function normalizeSelectorHints(hints) {
  const priority = normalizePurposePriority(hints?.purpose_priority);
  const matteringOrder = normalizeMatteringPriority(hints?.mattering_quota);
  return {
    purpose_priority: priority,
    mattering_quota: buildMatteringQuota(matteringOrder)
  };
}

function buildMatteringQuota(order) {
  const quota = {};
  const total = order.length || MATTERING_VALUES.length;
  order.forEach((key, index) => {
    quota[key] = Number(((total - index) / total).toFixed(2));
  });
  return quota;
}

function orderPlanKeys(plan, selectorHints) {
  const ordered = {};
  const orderedKeys = [
    'slug',
    'name',
    'tier',
    'channel_variant',
    'effort',
    'length_days',
    'cadence_per_week',
    'goal_tags',
    'day_types'
  ];
  for (const key of orderedKeys) {
    if (plan[key] !== undefined) {
      ordered[key] = plan[key];
    }
  }
  ordered.selector_hints = selectorHints ?? DEFAULT_HINTS;
  for (const [key, value] of Object.entries(plan)) {
    if (!orderedKeys.includes(key) && key !== 'selector_hints') {
      ordered[key] = value;
    }
  }
  return ordered;
}

function runValidations(phrases, blueprints, summary) {
  const openers = phrases?.openers ?? {};
  for (const plan of ensureArray(blueprints?.plans)) {
    const goalTags = ensureArray(plan.goal_tags);
    const { levels, clusters, types } = parseGoalTags(goalTags);
    const planEffort = plan?.effort ?? 'low';
    const dayTypes = ensureArray(plan?.day_types);
    const famEligible = new Map();

    for (const day of dayTypes) {
      const family = normalizeFamily(day?.family ?? 'text');
      if (!famEligible.has(family)) {
        const eligible = filterEligibleOpeners(openers[family], { levels, clusters, types, planEffort });
        famEligible.set(family, eligible);
      }
      if (!famEligible.get(family)?.length) {
        summary.warnings.push(
          `Plan ${plan.slug} day ${day?.day ?? '?'} missing eligible ${family} phrases`
        );
      }
      if (planEffort === 'low') {
        const hasHigh = ensureArray(openers[family]).some(
          (phrase) =>
            phrase.level &&
            (!levels.size || levels.has(phrase.level)) &&
            normalizeEffort(phrase.effort) === 'high'
        );
        if (hasHigh) {
          summary.errors.push(`Plan ${plan.slug} allows high-effort ${family} phrases`);
        }
      }
    }

    const selectorHints = plan.selector_hints ?? DEFAULT_HINTS;
    const aggEligible = Array.from(famEligible.values()).flat();

    for (const purpose of selectorHints.purpose_priority ?? []) {
      if (!aggEligible.some((phrase) => phrase.purpose === purpose)) {
        summary.warnings.push(`Plan ${plan.slug} lacks purpose "${purpose}" coverage`);
      }
    }

    const matteringTargets = Object.keys(selectorHints.mattering_quota ?? {});
    for (const category of matteringTargets) {
      if (!aggEligible.some((phrase) => phrase.mattering?.includes(category))) {
        summary.warnings.push(`Plan ${plan.slug} lacks mattering "${category}" coverage`);
      }
    }
  }
}

function createBackup(filePath) {
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  fs.copyFileSync(filePath, backupPath);
}

function writeJSON(absPath, data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(absPath, `${json}\n`);
}

function formatTimestamp(date) {
  const pad = (num) => `${num}`.padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('');
}

function printSummary(summary) {
  console.log('— Alignment Summary —');
  console.log(`phrases added: ${summary.added}`);
  console.log(`phrases replaced: ${summary.replaced}`);
  console.log(`phrases kept: ${summary.kept}`);
  console.log(`selector_hints strategy: inline (${summary.planSlugs.size} plans touched)`);
  if (summary.planSlugs.size) {
    console.log('plans updated:', Array.from(summary.planSlugs).join(', '));
  }
  if (summary.warnings.length) {
    console.log('\nWarnings:');
    summary.warnings.forEach((msg) => console.log(`- ${msg}`));
  }
  if (summary.errors.length) {
    console.log('\nErrors:');
    summary.errors.forEach((msg) => console.log(`- ${msg}`));
  }
}

main().catch((error) => {
  console.error('✗ alignContent failed', error);
  process.exit(1);
});
