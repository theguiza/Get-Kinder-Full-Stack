#!/usr/bin/env node
// scripts/phraseScaffoldPrompt.js
// Quick CLI helper to scaffold a fully populated phrase object for authoring.

import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureArray } from '../shared/phraseSelector.js';

const LEVELS = [
  'starter',
  'acq-to-casual',
  'casual-to-friend',
  'casual-maintain',
  'friend-maintain',
  'friend-to-close',
  'close-to-best'
];

const FAMILIES = ['text', 'call', 'email', 'irl'];
const PURPOSES = [
  'invite_leisure',
  'striving_pivot',
  'surge_stack',
  'context_shift',
  'needing',
  'affirming',
  'ritualize'
];
const MATTERING = ['Noticing', 'Affirming', 'Needing'];

const DEFAULTS = {
  family: 'text',
  level: 'acq-to-casual',
  cluster: 'explorer,steady,rhythm',
  types: 'adventurer,collaborator,confidante,caregiver,coach,anchor,communicator,connector',
  effort: 'low',
  purpose: 'invite_leisure',
  mattering: 'Noticing',
  striving: 'true',
  timebox_minutes: '20'
};

function parseArgs() {
  const args = {};
  for (const token of process.argv.slice(2)) {
    if (token.startsWith('--out=')) {
      args.output = token.slice(6);
    } else if (token === '--out') {
      args.output = null; // placeholder when user passes --out path on next arg
    } else if (!args.output && args.pending === 'output') {
      args.output = token;
      args.pending = null;
    } else if (token === '--copy-template') {
      args.copyTemplate = true;
    } else if (token === '--help') {
      args.help = true;
    } else if (token === '--out') {
      args.pending = 'output';
    }
  }
  return args;
}

function parseList(raw, allowed) {
  const values = String(raw ?? '')
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.length) return allowed ? [allowed[0]] : [];
  if (Array.isArray(allowed) && allowed.length) {
    return values.map((value) => {
      const match = allowed.find((option) => option === value || option.toLowerCase() === value.toLowerCase());
      return match ?? value;
    });
  }
  return values;
}

async function prompt(question, fallback) {
  const rl = prompt.rl ??= readline.createInterface({ input, output });
  const suffix = fallback ? ` (${fallback})` : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback || '';
}

function finalizePrompt() {
  if (prompt.rl) {
    prompt.rl.close();
  }
}

function ensureFamily(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (!lower) return 'text';
  return FAMILIES.includes(lower) ? lower : 'text';
}

function ensureLevel(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (!lower) return LEVELS[0];
  return LEVELS.includes(lower) ? lower : LEVELS[0];
}

function ensurePurpose(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (!lower) return PURPOSES[0];
  return PURPOSES.includes(lower) ? lower : PURPOSES[0];
}

function ensureEffort(value) {
  const lower = String(value ?? '').trim().toLowerCase();
  if (lower === 'medium' || lower === 'high') return lower;
  return 'low';
}

function ensureBool(value) {
  if (typeof value === 'boolean') return value;
  const str = String(value ?? '').trim().toLowerCase();
  if (!str) return true;
  return str === 'true' || str === '1' || str === 'yes';
}

function ensureTimebox(value) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return Math.min(90, Math.max(1, Math.round(num)));
  return 20;
}

function usage() {
  console.log(`Usage: node scripts/phraseScaffoldPrompt.js [--out path]\n` +
    `Answer the interactive prompts to generate a full phrase object. Without --out, JSON is printed to STDOUT.`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const text = await prompt('Phrase text (use {{ friend_name }} etc.)', '');
  const family = ensureFamily(await prompt(`Family ${FAMILIES.join('/')}`, DEFAULTS.family));
  const level = ensureLevel(await prompt(`Level ${LEVELS.join('/')}`, DEFAULTS.level));
  const cluster = parseList(
    await prompt('Clusters (comma-separated)', DEFAULTS.cluster),
    ['explorer', 'steady', 'rhythm']
  );
  const types = parseList(await prompt('Types (comma-separated)', DEFAULTS.types));
  const effort = ensureEffort(await prompt('Effort (low/medium/high)', DEFAULTS.effort));
  const purpose = ensurePurpose(await prompt(`Purpose ${PURPOSES.join('/')}`, DEFAULTS.purpose));
  const matteringRaw = parseList(await prompt('Mattering categories', DEFAULTS.mattering), MATTERING);
  const striving = ensureBool(await prompt('Striving? (true/false)', DEFAULTS.striving));
  const timebox = ensureTimebox(await prompt('Timebox minutes', DEFAULTS.timebox_minutes));

  const phrase = {
    text,
    family,
    level,
    cluster: cluster.length ? cluster : ['steady', 'rhythm'],
    types: types.length ? types : ['confidante', 'anchor'],
    effort,
    purpose,
    mattering: matteringRaw.length ? matteringRaw : ['Noticing'],
    striving,
    timebox_minutes: timebox
  };

  finalizePrompt();

  const outputJson = `${JSON.stringify(phrase, null, 2)}\n`;
  if (args.output) {
    const dest = path.resolve(args.output);
    fs.writeFileSync(dest, outputJson);
    console.log(`✓ Phrase scaffold saved to ${dest}`);
  } else {
    console.log(outputJson);
  }
}

main().catch((error) => {
  finalizePrompt();
  console.error('✗ Failed to build phrase scaffold:', error);
  process.exit(1);
});
