// scripts/generateContentLibrary.js
// ESM + TLS-friendly content library generator

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Client } = pkg;

// -------------------- ESM __dirname --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------- small utils --------------------
const joinp = (...segs) => path.join(__dirname, '..', ...segs);

function readJSON(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (e) {
    console.error(`✗ Failed to read/parse ${absPath}:`, e.message);
    process.exit(1);
  }
}

// ONLY replace {{ est_minutes }} here. Leave {{ friend_name }} intact for runtime personalization.
function mustacheEst(str, vars) {
  return String(str ?? '').replace(/\{\{\s*est_minutes\s*\}\}/g, String(vars.est_minutes));
}

// Map blueprint “family” to step_templates.channel (schema allows: text|call|irl)
function familyToChannel(fam) {
  if (fam === 'text' || fam === 'call' || fam === 'irl') return fam;
  // Treat email/mixed/any as text for steps (UI channel)
  return 'text';
}

function pickFirst(arr, fallback) {
  return Array.isArray(arr) && arr.length ? arr[0] : fallback;
}

function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

// -------------------- load authoring files --------------------
const phrasesPath = joinp('content', 'phrases.json');
const blueprintsPath = joinp('content', 'blueprints.json');

if (!fs.existsSync(phrasesPath)) {
  console.error(`✗ Missing ${phrasesPath}`);
  process.exit(1);
}
if (!fs.existsSync(blueprintsPath)) {
  console.error(`✗ Missing ${blueprintsPath}`);
  process.exit(1);
}

const phrases = readJSON(phrasesPath);
const blueprints = readJSON(blueprintsPath);

// Basic validation
const openers = phrases?.openers ?? {};
const durations = phrases?.durations ?? {};
if (
  typeof openers !== 'object' ||
  !openers.text || !openers.call || !openers.email || !openers.irl ||
  typeof durations !== 'object' ||
  durations.low == null || durations.medium == null || durations.high == null
) {
  console.error('✗ phrases.json must contain { openers: {text,call,email,irl}, durations: {low,medium,high} }');
  process.exit(1);
}

// -------------------- DB client with TLS --------------------
if (!process.env.DATABASE_URL) {
  console.error('✗ DATABASE_URL is not set in your environment/.env');
  process.exit(1);
}

// Decide SSL: local hosts (localhost/127.0.0.1) -> no SSL, anything else -> SSL
let connectionString = process.env.DATABASE_URL;
let sslOption = false;
try {
  const u = new URL(connectionString);
  const host = (u.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  if (!isLocal) {
    if (!u.searchParams.has('sslmode') && !u.searchParams.has('ssl')) {
      u.searchParams.set('sslmode', 'require');
    }
    connectionString = u.toString();
    sslOption = { rejectUnauthorized: false }; // satisfies managed PG providers
  }
} catch {
  // If DATABASE_URL isn't a valid URL, fall back to forcing SSL
  sslOption = { rejectUnauthorized: false };
}

const client = new Client({ connectionString, ssl: sslOption });

// -------------------- DDL helpers (make UPSERT safe) --------------------
async function ensureIndexes() {
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS plan_templates_uq_name
    ON plan_templates(name);
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS step_templates_uq_day
    ON step_templates(plan_template_id, day_number);
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS challenge_templates_uq
    ON challenge_templates(title_template, channel, effort);
  `);
}

// -------------------- UPSERTs --------------------
async function upsertPlan(p) {
  const q = `
    INSERT INTO plan_templates
      (name, tier, length_days, cadence_per_week, channel_variant, tags, is_active)
    VALUES ($1,$2,$3,$4,$5,$6, TRUE)
    ON CONFLICT (name) DO UPDATE
      SET tier = EXCLUDED.tier,
          length_days = EXCLUDED.length_days,
          cadence_per_week = EXCLUDED.cadence_per_week,
          channel_variant = EXCLUDED.channel_variant,
          tags = EXCLUDED.tags,
          is_active = TRUE
    RETURNING id
  `;
  const tagsJson = JSON.stringify(ensureArray(p.goal_tags));
  const { rows } = await client.query(q, [
    p.name,
    p.tier,
    p.length_days,
    p.cadence_per_week,
    p.channel_variant,
    tagsJson
  ]);
  return rows[0].id;
}

async function upsertStep(planId, step) {
  const q = `
    INSERT INTO step_templates
      (plan_template_id, day_number, title_template, meta_template, channel, effort, tags)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (plan_template_id, day_number) DO UPDATE
      SET title_template = EXCLUDED.title_template,
          meta_template  = EXCLUDED.meta_template,
          channel        = EXCLUDED.channel,
          effort         = EXCLUDED.effort,
          tags           = EXCLUDED.tags
  `;
  await client.query(q, [
    planId,
    step.day_number,
    step.title_template,
    step.meta_template ?? null,
    step.channel,
    step.effort,
    JSON.stringify(ensureArray(step.tags))
  ]);
}

async function upsertChallenge(c) {
  const q = `
    INSERT INTO challenge_templates
      (title_template, description_template, effort, channel, est_minutes, points, swaps_allowed, tags, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8, TRUE)
    ON CONFLICT (title_template, channel, effort) DO UPDATE
      SET description_template = EXCLUDED.description_template,
          est_minutes          = EXCLUDED.est_minutes,
          points               = EXCLUDED.points,
          swaps_allowed        = EXCLUDED.swaps_allowed,
          tags                 = EXCLUDED.tags,
          is_active            = TRUE
  `;
  await client.query(q, [
    c.title_template,
    c.description_template,
    c.effort,
    c.channel,
    c.est_minutes,
    c.points,
    c.swaps_allowed,
    JSON.stringify(ensureArray(c.tags))
  ]);
}

// -------------------- main --------------------
(async () => {
  await client.connect();
  try {
    await client.query('BEGIN');
    await ensureIndexes();

    let planCount = 0;
    let stepCount = 0;
    let challengeCount = 0;

    // ------------ plans + steps ------------
    for (const p of ensureArray(blueprints.plans)) {
      // Validate minimal blueprint fields
      if (!p?.name || !p?.tier || !p?.channel_variant || !p?.length_days || !p?.cadence_per_week) {
        console.warn('! Skipping plan with missing required fields:', p);
        continue;
      }
      const planId = await upsertPlan(p);
      planCount++;

      const effort = p.effort || 'low';
      const est = durations[effort] ?? 5; // steps don't store description; est goes into meta_template
      const meta_template = `est=${Math.max(1, Math.min(60, est))}m`;

      for (const dt of ensureArray(p.day_types)) {
        const family = dt?.family || 'text';
        const chan = familyToChannel(family); // text|call|irl
        const openerList =
          (phrases.openers[family]) ||
          (family === 'email' ? phrases.openers.text : null) ||
          [];
        const opener = pickFirst(openerList, 'Message {{ friend_name }} to say hi.');

        const title_template = opener; // keep {{ friend_name }}

        await upsertStep(planId, {
          day_number: Number(dt.day || 0) || 1,
          title_template,
          meta_template,
          channel: chan,
          effort, // step_templates.effort is required
          tags: ensureArray(p.goal_tags)
        });
        stepCount++;
      }
    }

    // ------------ daily surprise challenges ------------
    for (const s of ensureArray(blueprints.daily_surprise)) {
      const effort = s?.effort || 'low';

      // clamp to schema: 1..60
      const estRaw = durations[effort] ?? 5;
      const est = Math.max(1, Math.min(60, estRaw));

      const nudge = pickFirst(phrases.nudges, 'Keep it short.');
      const closer = pickFirst(phrases.closers, 'Hit send without overthinking.');
      const chan = s?.channel || 'text'; // can be 'any'

      const openerList =
        (phrases.openers[chan]) ||
        (chan === 'any' ? phrases.openers.text : null) ||
        [];
      const opener = pickFirst(openerList, 'Ping {{ friend_name }} with a quick hello.');

      const title_template = opener; // keep {{ friend_name }}
      const description_template = `${mustacheEst(nudge, { est_minutes: est })} ${closer}`.trim();

      // respect schema: points 1..50
      const points = effort === 'high' ? 50 : effort === 'medium' ? 35 : 20;

      // respect schema: swaps_allowed 0..5 (we use 0 or 1)
      const swaps_allowed = effort === 'high' ? 0 : 1;

      await upsertChallenge({
        title_template,
        description_template,
        effort,
        channel: chan, // 'text' | 'call' | 'irl' | 'any'
        est_minutes: est,
        points,
        swaps_allowed,
        tags: ensureArray(s.goal_tags)
      });
      challengeCount++;
    }

    await client.query('COMMIT');
    console.log(`✅ Content library upserted: plans=${planCount}, steps=${stepCount}, challenges=${challengeCount}`);
    process.exitCode = 0;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Generation failed:', e?.message || e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();

