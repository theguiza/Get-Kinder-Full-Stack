// index.js
// ─────────────────────────────────────────────────────────────────────────────
// ES Module version (package.json includes "type": "module")
// ─────────────────────────────────────────────────────────────────────────────
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pool from "./Backend/db/pg.js";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import OpenAI from "openai";
import connectPgSimple from "connect-pg-simple";
import multer from "multer";
import cron from "node-cron";
import { FUNCTIONS } from "./openaiFunctions.js";
import { makeDashboardController } from "./Backend/dashboardController.js";
import { verify as neoVerify, run as neoRun, close as neoClose } from './Backend/db/neo4j.js';
import { deliverQueuedNudges } from './kindnessEmailer.js';
const { fetchUserEmails, fetchKindnessPrompts, fetchEmailSubject } = await import("./fetchData.js");
const { sendDailyKindnessPrompts } = await import("./kindnessEmailer.js");

// Reuse the same tool schema for Chat Completions (strip any nonstandard fields if needed)
const CHAT_COMPLETIONS_TOOLS = DASHBOARD_TOOLS.map(t => ({ type: 'function', function: t.function }));
// ─────────────────────────────────────────────────────────────────────────────
neoVerify()
  .then(() => console.log('Neo4j connected ✅'))
  .catch(err => console.error('Neo4j connect failed (non-fatal):', err.message));

process.on('SIGINT',  () => { neoClose().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { neoClose().finally(() => process.exit(0)); });

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  },
});
// Map legacy FUNCTIONS → Chat Completions tools
const TOOLS = Array.isArray(FUNCTIONS)
  ? FUNCTIONS.map(fn => ({
      type: "function",
      function: {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters
      },
      ...(fn.strict !== undefined ? { strict: !!fn.strict } : {})
    }))
  : [];

// KAI (Assistants API) plumbing
import {
  // chat endpoints need these
  createThread,
  createMessage,
  createAndPollRun,
  createAndStreamRun,
  listMessages,
  // tool-aware / dashboard bits
  DASHBOARD_TOOLS,
  setToolContext,
  getOrCreateThread,
  createDashboardMessage,
  updateAssistantInstructions,
  KAI_ASSISTANT_INSTRUCTIONS
} from './Backend/assistant.js';

// === 6-line guest system prompt (used in Chat Completions path for guests) ===
const GUEST_SYSTEM_PROMPT = `
You are KAI, a warm, encouraging mattering coach helping people connect IRL and feel less lonely; you are not a clinician.
Default to 30-60 words; structure: brief reflection -> one practical idea -> one inviting question.
Use OARS, good listening with follow-ups, active-constructive responding, and NAN (Noticing–Affirming–Needing) when relevant.
You cannot send nudges, emails, SMS, or perform account actions for guests.
If asked to send anything, first say: "To send nudges or emails, please sign in." Then offer a copy-paste draft message.
Be concise, human, non-judgmental; celebrate small wins and suggest Low/Medium/High effort options when helpful.
`.trim();

// 3) Compute __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 4) Initialize Express application
const app = express();

// 5) Determine port (Render/Docker set process.env.PORT; fallback to 5001)
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;

try {
  await pool.query('SELECT 1');  // one-shot; no client to release
  console.log("🌐 Connected to Postgres successfully.");
} catch (err) {
  console.error("‼️  Error connecting to Postgres:", err);
}


// 7) Compute rootPath if needed for static files
//const rootPath = __dirname;
//const rootPath = path.join(__dirname, "../");
app.set("trust proxy", 1);
// 8) Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PgSession = connectPgSimple(session);

// 9) Middleware setup
app.use(cors());
app.use(express.json({ limit: "5mb" }));
//app.use(express.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new PgSession({
      pool: pool,                // ← your existing Pool instance
      tableName: "user_session", // ← table name that connect-pg-simple will use
      // ──────────────────────────────────────────────────────
      // ADD THIS PROPERTY to have connect-pg-simple auto‐create
      // the "user_session" table if it doesn’t already exist:
      createTableIfMissing: true
      // ──────────────────────────────────────────────────────
    }),
    secret: process.env.SESSION_SECRET || "default_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(__dirname, "public")));

// Make `user` available in all EJS templates
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

// 10) View engine setup (EJS)
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ─────────────────────────────────────────────────────────────────────────────
// 11) Passport / Authentication configuration
// ─────────────────────────────────────────────────────────────────────────────

// 11.1) Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID     || "YOUR_GOOGLE_CLIENT_ID",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "YOUR_GOOGLE_CLIENT_SECRET",
      callbackURL:  process.env.GOOGLE_CALLBACK_URL  || "/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // 1) Extract the user’s email
        const email = profile.emails[0].value;

        // 2) Try to find an existing row by email
        const result = await pool.query(
          "SELECT * FROM userdata WHERE email = $1",
          [email]
        );
        if (result.rows.length) {
          // If user already exists, return that row (including google_id & picture)
          return done(null, result.rows[0]);
        } else {
          // 3) This is a brand-new OAuth signup → extract Google ID + profile picture URL
          const googleId = profile.id || null;
          // profile.photos is often an array; pick index 0 if it exists
          const photoUrl =
            Array.isArray(profile.photos) && profile.photos.length
              ? profile.photos[0].value
              : null;

          // 4) Insert all required columns + google_id + picture
          const insert = await pool.query(
            `INSERT INTO userdata 
               (firstname, lastname, email, password, google_id, picture)
             VALUES
               ($1,       $2,       $3,    $4,       $5,        $6)
             RETURNING *`,
            [
              profile.name?.givenName || "",
              profile.name?.familyName || "",
              email,
              /* password = */ null,
              googleId,
              photoUrl,
            ]
          );
          return done(null, insert.rows[0]);
        }
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

// 11.2) Facebook OAuth Strategy
passport.use(
  new FacebookStrategy(
    {
      clientID:     process.env.FACEBOOK_APP_ID     || "YOUR_FACEBOOK_APP_ID",
      clientSecret: process.env.FACEBOOK_APP_SECRET || "YOUR_FACEBOOK_APP_SECRET",
      callbackURL:  process.env.FACEBOOK_CALLBACK_URL || "/auth/facebook/callback",
      profileFields: [
        "id",
        "displayName",
        "emails",
        "photos"              // ← request the “photos” array so that we can read profile picture
      ],
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        // 1) Pull the user’s email (Facebook may not always return one, but if it does…)
        const email = Array.isArray(profile.emails) && profile.emails.length
          ? profile.emails[0].value
          : null;
        if (!email) {
          return cb(new Error("Facebook profile did not return an email"), null);
        }

        // 2) See if this email already exists in userdata
        const result = await pool.query(
          "SELECT * FROM userdata WHERE email = $1",
          [email]
        );
        if (result.rows.length) {
          // If user already exists, return that record (including existing facebook_id/picture)
          return cb(null, result.rows[0]);
        } else {
          //
          // 3) First‐time Facebook signup → extract facebook_id + profile picture URL
          //
          const facebookId = profile.id || null;

          // The “photos” array is returned because we put "photos" in profileFields.
          // Typically, profile.photos = [ { value: "https://.../picture.jpg", ... } ]
          const photoUrl =
            Array.isArray(profile.photos) && profile.photos.length
              ? profile.photos[0].value
              : null;

          //
          // 4) INSERT into userdata (including facebook_id + picture)
          //
          const insert = await pool.query(
            `INSERT INTO userdata
              (firstname,    lastname,     email,      password,    facebook_id,  picture)
             VALUES
              ($1,           $2,           $3,         $4,          $5,           $6)
             RETURNING *`,
            [
              // Split displayName into first/last if you like; here we just do a simple attempt:
              (profile.name?.givenName  || ""), 
              (profile.name?.familyName || ""), 
              email,
              /* password */             null, 
              facebookId,
              photoUrl,
            ]
          );
          return cb(null, insert.rows[0]);
        }
      } catch (err) {
        return cb(err, null);
      }
    }
  )
);
// 11.3) Serialize / Deserialize
passport.serializeUser((user, done) => {
  done(null, user.email);
});
passport.deserializeUser(async (email, done) => {
  try {
    const result = await pool.query(
      "SELECT * FROM userdata WHERE email = $1",
      [email]
    );
    const user = result.rows[0] || false;
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// --- Neo4j mirror helper ---
// ─────────────────────────────────────────────────────────────────────────────
async function mirrorAssessmentToGraph({
  ownerId, friendId, name,
  score = 0,
  evidence_direct = 0,
  evidence_proxy = 0,
  archetype_primary = null,
  archetype_secondary = null,
  red_flags = [],
  snapshot = {},
  signals = {}
}) {
  const nowIso = new Date().toISOString();

  // tier bucketing (same thresholds you’ve been using)
  const tier =
    evidence_direct < 0.35 ? 'Provisional • Low Evidence' :
    score >= 85           ? 'Bestie Material' :
    score >= 70           ? 'Strong Contender' :
    score >= 50           ? 'Potential Pal' :
                            'Acquaintance Energy';

  const cypher = `
    MERGE (u:User {id:$user_id})
    MERGE (p:Person {id:$friend_id})
      ON CREATE SET p.display_name = $name
      ON MATCH  SET p.display_name = coalesce($name, p.display_name)
    MERGE (u)-[r:CONSIDERS]->(p)
      SET r.last_assessed_at = datetime($created_at),
          r.last_score       = $score,
          r.last_tier        = $tier,
          r.flags_count      = size($flags)
    WITH u,p
    CREATE (a:Assessment {
      id: randomUUID(),
      created_at: datetime($created_at),
      score: $score,
      tier:  $tier,
      direct_ratio: $direct_ratio,
      proxy_ratio:  $proxy_ratio,
      source: "webapp"
    })
    MERGE (p)-[:HAS_ASSESSMENT]->(a)
    WITH a, $snapshot AS snap, $signals AS sigs, $flags AS flags

    // 1) SNAPSHOT → Observations (mostly 'direct')
    WITH a, sigs, flags, snap,
         [k IN keys(snap) | {
           field: k,
           value: toFloat(snap[k]),
           round:
             CASE
               WHEN k IN ['reliability','reciprocity','logistics'] THEN 'Adulting Round'
               WHEN k IN ['values','safety','activity']           THEN 'Values Round'
               WHEN k IN ['chemistry','interaction']              THEN 'Vibes Round'
               WHEN k STARTS WITH 'arch_'                         THEN 'Archetype Round'
               ELSE 'Signals Round'
             END,
           source: CASE WHEN k STARTS WITH 'sig_' THEN 'signal' ELSE 'direct' END
         }] AS obs1
    UNWIND obs1 AS o1
      WITH a, sigs, flags, snap, o1
      WHERE o1.value IS NOT NULL
      CREATE (ob1:Observation {
        field:o1.field, value:o1.value, round:o1.round, source:o1.source, observed_at:a.created_at
      })
      MERGE (a)-[:REPORTED]->(ob1)

    // 2) SIGNALS → Observations (dedupe if same key existed in snapshot)
    WITH a, flags, snap, sigs,
         [k IN [x IN keys(sigs) WHERE NOT x IN keys(snap)] | {
           field: k,
           value: toFloat(sigs[k]),
           round:  'Signals Round',
           source: 'signal'
         }] AS obs2
    UNWIND obs2 AS o2
      WITH a, flags, o2
      WHERE o2.value IS NOT NULL
      CREATE (ob2:Observation {
        field:o2.field, value:o2.value, round:o2.round, source:o2.source, observed_at:a.created_at
      })
      MERGE (a)-[:REPORTED]->(ob2)

    // 3) ARCHETYPES → ranked edges
    WITH a, $archetype_primary AS ap, $archetype_secondary AS asec
    FOREACH (_ IN CASE WHEN ap   IS NULL THEN [] ELSE [1] END |
      MERGE (ar1:Archetype {name: ap})
      MERGE (a)-[:TOP_ARCHETYPE {rank:1}]->(ar1)
    )
    FOREACH (_ IN CASE WHEN asec IS NULL THEN [] ELSE [1] END |
      MERGE (ar2:Archetype {name: asec})
      MERGE (a)-[:TOP_ARCHETYPE {rank:2}]->(ar2)
    )

    // 4) FLAGS → edges
    WITH a, $flags AS flist
    UNWIND flist AS f
      MERGE (fl:Flag {id:f})
      MERGE (a)-[:HAS_FLAG]->(fl)
  `;

  const params = {
    user_id: String(ownerId),
    friend_id: String(friendId),
    name: name || 'Unknown',
    created_at: nowIso,
    score: Number(score) || 0,
    direct_ratio: Number(evidence_direct) || 0,
    proxy_ratio: Number(evidence_proxy) || 0,
    tier, // must be present for $tier
    archetype_primary,
    archetype_secondary,
    flags: Array.isArray(red_flags) ? red_flags : [],
    snapshot,
    signals
  };

  await neoRun(cypher, params);
}
// ─────────────────────────────────────────────────────────────────────────────
// 12) Signup & Login Routes
// ─────────────────────────────────────────────────────────────────────────────
// 12.1) Signup Route
app.post("/register", async (req, res, next) => {
  const { firstname, lastname, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO userdata 
         (firstname, lastname, email, password) 
       VALUES 
         ($1, $2, $3, $4) 
       RETURNING *`,
      [firstname, lastname, email, hashedPassword]
    );
    const newUser = result.rows[0];
    req.login(newUser, (err) => {
      if (err) return next(err);
      res.redirect(`/?login=1&name=${encodeURIComponent(newUser.firstname)}`);
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).send("Error registering user");
  }
});
// 12.2) Login Route
app.post("/login", async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM userdata WHERE email = $1",
      [email]
    );
    if (result.rows.length === 0) {
      return res.render("login", {
        title: "Log In",
        error: "No account found with that email.",
      });
    }
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send("Invalid password");
    }
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect(`/?login=1&name=${encodeURIComponent(user.firstname || user.email)}`);
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Internal server error");
  }
});
// 12.3) Logout Route
app.get("/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect("/?login=0");
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// 13) Profile Update Route
// ─────────────────────────────────────────────────────────────────────────────
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.redirect("/login");
}
app.post(
  '/profile',
  ensureAuthenticated,
  uploadAvatar.single('picture'),
  async (req, res) => {
    // 1) Extract text fields from req.body
    const {
      firstname,
      lastname,
      email,
      phone,
      address1,
      kindness_style,
      city,
      state,
      country,
      interest1,
      interest2,
      interest3,
      sdg1,
      sdg2,
      sdg3,
    } = req.body;

    // 2) Build Base64‐encoded data URI if a file was uploaded; otherwise keep existing
    let newPictureData = req.user.picture || null;
    if (req.file) {
      const mimeType = req.file.mimetype; // e.g. "image/png"
      const base64str = req.file.buffer.toString('base64');
      newPictureData = `data:${mimeType};base64,${base64str}`;
    }

    try {
      // 3) Update all fields, including picture (TEXT column)
      await pool.query(
        `
        UPDATE userdata
           SET
             firstname = $1,
             lastname  = $2,
             email     = $3,
             phone     = $4,
             address1  = $5,
             kindness_style  = $6,
             city      = $7,
             state     = $8,
             country   = $9,
             interest1 = $10,
             interest2 = $11,
             interest3 = $12,
             sdg1      = $13,
             sdg2      = $14,
             sdg3      = $15,
             picture   = $16
         WHERE email = $3
        `,
        [
          firstname,
          lastname,
          email,
          phone,
          address1,
          kindness_style,
          city,
          state,
          country,
          interest1,
          interest2,
          interest3,
          sdg1,
          sdg2,
          sdg3,
          newPictureData,
        ]
      );

      // 4) Update req.user so EJS picks up new picture immediately
      req.user = {
        ...req.user,
        firstname,
        lastname,
        email,
        phone,
        address1,
        kindness_style,
        city,
        state,
        country,
        interest1,
        interest2,
        interest3,
        sdg1,
        sdg2,
        sdg3,
        picture: newPictureData,
      };

      return res.redirect('/profile');
    } catch (err) {
      console.error('Error updating profile:', err);
      return res.status(500).send('Error updating profile');
    }
  }
);
// 13.4) View Profile Route
app.get('/profile', ensureAuthenticated, async (req, res) => {
  try {
    // 1) Fetch the user's record
    const result = await pool.query(
      'SELECT * FROM userdata WHERE email = $1',
      [req.user.email]
    );
    if (result.rows.length === 0) {
      return res.redirect('/login');
    }
    // 2) Mirror your home/about/blog locals
    const success      = req.query.success === '1';   // registration alert
    const loginSuccess = req.query.login   === '1';   // login alert
    const name         = req.query.name    || '';     // firstname/email
    // 3) Render profile.ejs with all flags + user data
    return res.render('profile', {
      title:        'User Profile',
      user:         result.rows[0],
      success,
      loginSuccess,
      name
    });
  } catch (err) {
    console.error('Profile DB error:', err);
    return res.status(500).send('Error loading profile.');
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// 14) Static Content Pages
app.get("/contact", (req, res) => res.render("contact", { title: "Contact Us" }));
app.get("/accessability", (req, res) => res.render("accessability", { title: "Accessibility" }));
app.get("/privacy",      (req, res) => res.render("privacy",      { title: "Privacy Policy" }));
app.get("/terms",        (req, res) => res.render("terms",        { title: "Terms of Service" }));
// 14.1) Login and Register pages (GET)
app.get("/login",    (req, res) => res.render("login",    { title: "Log In",     facebookAppId: process.env.FACEBOOK_APP_ID }));
app.get("/register", (req, res) => res.render("register", { title: "Sign Up" }));
app.get("/404", (req, res) => res.render("404", { title: "404 ERROR" }));
app.get("/error", (req, res) => res.render("error", { title: "500 ERROR" }));
// Middleware to ensure authentication for API routes
function ensureAuthenticatedApi(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).json({ error: "unauthorized" });
}
function ensureAdmin(req, res, next) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = (req.user?.email || '').toLowerCase();
  if (list.includes(userEmail)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
async function resolveOwnerId(req, pool) {
  // Prefer the authenticated id if present
  if (req.user?.id) return String(req.user.id);

  // Otherwise look up by email
  if (!req.user?.email) throw new Error("Missing req.user.email");
  const { rows: [owner] } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!owner) throw new Error("owner not found");
  return String(owner.id);
}

app.get('/api/graph/friends/latest', ensureAuthenticatedApi, async (req, res) => {
  try {
    const { rows: [owner] } = await pool.query(
      'SELECT id FROM public.userdata WHERE email=$1 LIMIT 1',
      [req.user.email]
    );
    if (!owner) return res.status(400).json({ error: 'owner not found' });

    const q = `
      MATCH (u:User {id:$ownerId})-[:CONSIDERS]->(p:Person)-[:HAS_ASSESSMENT]->(a:Assessment)
      WITH p, a ORDER BY a.created_at DESC
      WITH p, collect(a)[0] AS la
      RETURN p.id AS friend_id, p.display_name AS name,
             la.score AS score, la.tier AS tier,
             la.direct_ratio AS direct_ratio, la.proxy_ratio AS proxy_ratio,
             la.created_at AS assessed_at
      ORDER BY assessed_at DESC
      LIMIT $limit
    `;

    const result = await neoRun(q, { ownerId: String(owner.id), limit: 100 });

    res.json(result.records.map(r => ({
      friend_id:    r.get('friend_id'),
      name:         r.get('name'),
      score:        r.get('score'),
      tier:         r.get('tier'),
      direct_ratio: r.get('direct_ratio'),
      proxy_ratio:  r.get('proxy_ratio'),
      assessed_at:  r.get('assessed_at'),
    })));
  } catch (e) {
    console.error('GET /api/graph/friends/latest error:', e);
    res.status(500).json({ error: 'graph query failed' });
  }
});

app.get(['/friend-quiz', '/friendQuiz'], (req, res) => {
  const isAuthed = !!(req.isAuthenticated && req.isAuthenticated());
  res.render('friendQuiz', { 
    isAuthed,
    assetTag: process.env.ASSET_TAG ?? Date.now().toString(36)
   });
});

  app.post("/api/friends", ensureAuthenticatedApi, async (req, res) => {
  try {
    const { rows: [owner] } =
      await pool.query("SELECT id FROM public.userdata WHERE email=$1", [req.user.email]);
    if (!owner) return res.status(400).json({ error: "owner not found" });

    // Normalize name on the server to reduce duplicates
    const {
      name: rawName, email, phone,
      archetype_primary, archetype_secondary,
      score, evidence_direct, evidence_proxy,
      flags_count, red_flags = [],
      snapshot = {}, signals = {},
      notes = null, picture = null,
    } = req.body;

    const name = (typeof rawName === 'string' ? rawName.trim() : 'Unknown');

    const { rows: [friend] } = await pool.query(`
      INSERT INTO public.friends (
        owner_user_id, name, email, phone,
        archetype_primary, archetype_secondary,
        score, evidence_direct, evidence_proxy,
        flags_count, red_flags, snapshot, signals, notes, picture
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (owner_user_id, name) DO UPDATE SET
        email               = EXCLUDED.email,
        phone               = EXCLUDED.phone,
        archetype_primary   = EXCLUDED.archetype_primary,
        archetype_secondary = EXCLUDED.archetype_secondary,
        score               = EXCLUDED.score,
        evidence_direct     = EXCLUDED.evidence_direct,
        evidence_proxy      = EXCLUDED.evidence_proxy,
        flags_count         = EXCLUDED.flags_count,
        red_flags           = EXCLUDED.red_flags,
        snapshot            = EXCLUDED.snapshot,
        signals             = EXCLUDED.signals,
        notes               = COALESCE(public.friends.notes, EXCLUDED.notes),
        picture             = COALESCE(EXCLUDED.picture, public.friends.picture),
        updated_at          = now()
      RETURNING *;
    `, [
      owner.id, name, email, phone,
      archetype_primary, archetype_secondary,
      score, evidence_direct, evidence_proxy,
      flags_count, red_flags, snapshot, signals, notes, picture
    ]);

    // Mirror to Neo4j (best-effort)
    try {
      await mirrorAssessmentToGraph({
        ownerId: owner.id,
        friendId: friend.id,
        name: friend.name,
        score: friend.score,
        evidence_direct: friend.evidence_direct,
        evidence_proxy: friend.evidence_proxy,
        archetype_primary: friend.archetype_primary,
        archetype_secondary: friend.archetype_secondary,
        red_flags: friend.red_flags || [],
        snapshot: friend.snapshot || {},
        signals: friend.signals || {}
      });
    } catch (e) {
      console.error('Neo4j mirror failed (continuing):', e.message);
    }

    // ✅ Always respond
    return res.json({ ok: true, id: friend.id, name: friend.name });
  } catch (err) {
    console.error('Error in /api/friends:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Dashboard - Initialize dashboard controller with all functions
const { getDashboard, getMorningPrompt, saveReflection, markDayDone, cancelChallenge } = makeDashboardController(pool);

// BOLT: Dashboard - All dashboard routes
app.get("/dashboard", ensureAuthenticated, getDashboard);
app.get('/dashboard/morning-prompt', ensureAuthenticated, getMorningPrompt);
app.post('/dashboard/reflect', ensureAuthenticated, saveReflection);
app.post('/dashboard/mark-done', ensureAuthenticated, markDayDone);
app.post("/challenge/cancel", ensureAuthenticated, cancelChallenge);

app.get("/about", (req, res) => {
  // mirror the same flags you use on your home route
  const success      = req.query.success === "1";
  const loginSuccess = req.query.login   === "1";
  const name         = req.query.name    || "";

  res.render("about", {
    title:        "About Us",
    success,
    loginSuccess,
    name,
    user:         req.user
  });
});

app.get("/blog", (req, res) => {
  const success      = req.query.success === "1";
  const loginSuccess = req.query.login   === "1";
  const name         = req.query.name    || "";

  res.render("blog", {
    title:        "Kinder Blog",
    success,
    loginSuccess,
    name,
    user:         req.user
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// 15) Updated Home Route (with DB time check and chat-history logic)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/", async (req, res, next) => {
  try {
    // A) Existing query-param logic
    const success      = req.query.success === "1";   // registration success
    const loginSuccess = req.query.login   === "1";   // login success
    const name         = req.query.name   || "";      // user’s name/email
     const title        = "Home";  // title for the EJS template
    // B) Database connectivity check
    let dbTime = null;
    try {
      const result = await pool.query("SELECT NOW()");
      dbTime = result.rows[0].now; // e.g. "2025-05-31Txx:xx:xx.000Z"
    } catch (dbErr) {
      console.error("Error querying Postgres in GET '/' route:", dbErr);
      dbTime = null; // or "unavailable"
    }

    // C) Chat-history logic (OpenAI threads)
// C) Chat-history logic
let chatHistory = [];
if (req.session && req.session.threadId) {
  const thread = await openai.beta.threads.retrieve(req.session.threadId);
  chatHistory = Array.isArray(thread.messages) ? thread.messages : [];
}
const threadId = (req.session && req.session.threadId) || "";

// NEW: are they new?
const isNewUser = chatHistory.length === 0;

// D) Render index.ejs (pass the flag)
return res.render("index", {
  title:        "Home",
  success,
  loginSuccess,
  name,
  chatHistory,
  threadId,
  dbTime,
  isNewUser    // ← add this line
});

  } catch (err) {
    return next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 16) OAuth Callback Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect(`/?login=1&name=${encodeURIComponent(req.user.firstname || req.user.email)}`);
  }
);

app.get("/auth/facebook", passport.authenticate("facebook", { scope: ["email"] }));
app.get("/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect(`/?login=1&name=${encodeURIComponent(req.user.firstname || req.user.email)}`);
  }
);
// --- for mattering graph in neo4j: latest assessment per friend, ordered by score ---
app.get('/api/graph/suggestions', ensureAuthenticatedApi, async (req, res) => {
  try {
    const { rows: [owner] } = await pool.query(
      'SELECT id FROM public.userdata WHERE email=$1 LIMIT 1',
      [req.user.email]
    );
    if (!owner) return res.status(400).json({ error: 'owner not found' });

    const cypher = `
      MATCH (u:User {id:$user_id})-[:CONSIDERS]->(p:Person)-[:HAS_ASSESSMENT]->(a:Assessment)
WITH p, a ORDER BY a.created_at DESC
WITH p, collect(a)[0] AS la
WITH p, la,
     la.score AS base,
     duration.between(date(la.created_at), date()).days AS days,
     CASE
       WHEN days <= 14 THEN 6
       WHEN days <= 30 THEN 3
       WHEN days <= 60 THEN 1
       ELSE 0
     END AS recency_bonus
RETURN p.id AS friend_id, p.display_name AS name,
       la.score AS score, la.tier AS tier,
       la.direct_ratio AS direct_ratio, la.proxy_ratio AS proxy_ratio,
       la.created_at AS assessed_at,
       (base + recency_bonus) AS rank_score
ORDER BY rank_score DESC
LIMIT $limit
    `;
    const result = await neoRun(cypher, { user_id: String(owner.id), limit: 20 });
    const suggestions = result.records.map(r => ({
      friend_id:   r.get('friend_id'),
      name:        r.get('name'),
      score:       r.get('score'),
      tier:        r.get('tier'),
      direct_ratio:r.get('direct_ratio'),
      proxy_ratio: r.get('proxy_ratio'),
      assessed_at: r.get('assessed_at'),
    }));
    res.json({ suggestions });
  } catch (err) {
    console.error('GET /api/graph/suggestions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// 17) Chat API Endpoints (assistant functionality)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/chat/init', async (req, res) => {
  try {
    const thread = await createThread();
    req.session.threadId = thread.id;
    res.json({ thread_id: thread.id });
  } catch (err) {
    console.error("Error initializing chat:", err);
    res.status(500).json({ error: "Unable to initialize chat." });
  }
});
// Unified public chat endpoint: tools when authed, plain model otherwise
app.post('/api/chat/message', async (req, res) => {
  try {
    const { message, userContext, context } = req.body || {};
    const msg = (message ?? '').toString().trim();
    if (!msg) return res.status(400).json({ error: 'message (string) is required' });

    const isAuthed = !!(req.isAuthenticated && req.isAuthenticated());

    if (isAuthed) {
      // ==== TOOL-AWARE PATH (logged-in users only) ====
      const ownerId = await resolveOwnerId(req, pool);
      setToolContext({ ownerId, pool });

      const threadId = await getOrCreateThread(req);

      const ctx = userContext || context || {
        user_email: req.user?.email || null,
        user_name:  req.user?.firstname || req.user?.name || null
      };

      await createDashboardMessage(threadId, msg, ctx);
      await createAndPollRun(threadId, DASHBOARD_TOOLS);

      const msgList = await listMessages(threadId);
      const assistantMsgs = (msgList?.data || [])
        .filter(m => m.role === 'assistant')
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const latest = assistantMsgs[0];

      const reply = (latest?.content || [])
        .map(c => c?.text?.value)
        .filter(Boolean)
        .join('\n')
        .trim() || '(No reply)';

      return res.json({ reply }); // chat.js expects { reply }
    }

    // ==== CHAT-ONLY PATH (guests) ====
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: GUEST_SYSTEM_PROMPT },
        { role: "user", content: msg }
      ]
      // IMPORTANT: do NOT pass `functions` here (prevents the earlier `strict` error).
    });

    const m = completion.choices[0].message;
    const reply = (m?.content || '').toString().trim() || "I’m here to help!";
    return res.json({ reply });
  } catch (err) {
    console.error('Error in /api/chat/message:', err?.stack || err);
return res.status(500).json({
  error: 'assistant_run_failed',
  details: typeof err?.message === 'string' ? err.message : String(err)
});
  }
});

// On-demand function-call endpoint
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
       const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: GUEST_SYSTEM_PROMPT },
        { role: "user",   content: message }
      ],
      tools:       CHAT_COMPLETIONS_TOOLS, // unified tool schema
      tool_choice: "auto"      // let the model decide if/when to call
    });
    const msg = completion.choices[0].message;
    // Tools path: model decided to call one or more functions
    if (msg.finish_reason === "tool_calls" && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      for (const call of msg.tool_calls) {
        const name   = call?.function?.name;
        const argStr = call?.function?.arguments || "{}";
        let args = {};
        try { args = JSON.parse(argStr); } catch {} // tolerate minor JSON issues

        if (name === "send_daily_kindness_prompts") {
          await sendDailyKindnessPrompts(args);
          return res.json({ role: "assistant", content: "✅ Prompts sent!" });
        }
        // add more handlers here if you later expose more tools via TOOLS
      }
    }
    // fallback to normal chat response
    res.json({
      role:    msg.role,
      content: msg.content
    });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({
      role:    "assistant",
      content: `❌ ${err.message}`
    });
  }
});
// Streaming Assistants route (SSE): best UX for authed users
app.post('/kai-chat/stream', ensureAuthenticatedApi, async (req, res) => {
  // 1) SSE headers
  res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders?.();

  // tiny helper
  const send = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload || {})}\n\n`);
  };

  // 2) Heartbeat to keep the connection open (Heroku/Render/CDN friendly)
  const heartbeat = setInterval(() => send('ping', { t: Date.now() }), 15000);

  try {
    // 3) Resolve owner + tool context (graph/DB/email)
    const ownerId = await resolveOwnerId(req, pool);
    setToolContext({ ownerId, pool });

    // 4) Thread management (reuse if present)
    const threadId = await getOrCreateThread(req);

    // 5) Add user message (+ optional context) to the thread
    const { message, userContext } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      send('error', { message: 'message (string) is required' });
      return res.end();
    }
    const ctx = userContext || {
      user_email: req.user?.email || null,
      user_name:  req.user?.firstname || req.user?.name || null
    };
    await createDashboardMessage(threadId, message, ctx);

    // 6) Stream the run (pass your server tools)
    await createAndStreamRun(threadId, DASHBOARD_TOOLS, (evt) => {
      // Forward useful events to the browser
      switch (evt.type) {
        case 'thread.message.delta': {
          // accumulate token text
          const chunk = (evt.data?.delta?.content || [])
            .map(c => c?.text?.value || '')
            .join('');
          if (chunk) send('delta', { text: chunk });
          break;
        }
        case 'thread.message.completed': {
          const full = (evt.data?.content || [])
            .map(c => c?.text?.value || '')
            .join('');
          send('message_completed', { text: full });
          break;
        }
        case 'thread.run.requires_action': {
          const calls = evt.data?.required_action?.submit_tool_outputs?.tool_calls || [];
          send('requires_action', {
            run_id: evt.data?.id,
            tool_calls: calls.map(c => ({ id: c.id, name: c.function?.name }))
          });
          break;
        }
        case 'tool.result': {
          send('tool_result', {
            name: evt.call?.function?.name,
            output: evt.data
          });
          break;
        }
        case 'openai.done':
          // run is finished
          send('done', { thread_id: threadId });
          res.end();
          break;
        default:
          // optional: forward raw event types for debugging
          // send('debug', evt);
          break;
      }
    });
  } catch (e) {
    console.error('SSE /kai-chat/stream error:', e);
    send('error', { message: e.message });
    res.end();
  } finally {
    clearInterval(heartbeat);
  }
});

// Tool-aware Assistants route (uses DASHBOARD_TOOLS and sets tool context)
app.post('/kai-chat', ensureAuthenticatedApi, async (req, res) => {
  try {
    const { message, userContext } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message (string) is required' });
    }
    // 1) Resolve who this request is for (tools use this)
    const ownerId = await resolveOwnerId(req, pool);
    // 2) Make ownerId and pool available to tools (graph + DB tools)
    setToolContext({ ownerId, pool });
    // 3) Thread management (persist per session)
    if (!req.session.threadId) {
      const thread = await createThread();
      req.session.threadId = thread.id;
    }
    const threadId = req.session.threadId;
    // 4) Add message; include optional user context for KAI to read
    const contextForKai = userContext || {
      user_email: req.user?.email || null,
      user_name:  req.user?.firstname || req.user?.name || null
    };
    await createDashboardMessage(threadId, message, contextForKai);
    // 5) Run the assistant WITH tools (Assistants API v2)
    const run = await createAndPollRun(threadId, DASHBOARD_TOOLS);
    // 6) Fetch latest assistant reply
    const msgList = await listMessages(threadId);
    const assistantMsgs = (msgList?.data || [])
      .filter(m => m.role === 'assistant')
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const latest = assistantMsgs[0];

    const textParts = (latest?.content || [])
      .map(c => c?.text?.value)
      .filter(Boolean);
    const reply = textParts.join('\n').trim() || '(No reply)';
    return res.json({
      ok: true,
      thread_id: threadId,
      reply,
      run_status: run?.status || null
    });
  } catch (e) {
    console.error('POST /kai-chat error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// Admin-only: update OpenAI Assistant instructions from our canonical string
app.post("/admin/assistant-instructions/update",
  ensureAuthenticatedApi,
  ensureAdmin,
  async (req, res) => {
    try {
      const text = (req.body && typeof req.body.instructions === 'string')
        ? req.body.instructions
        : KAI_ASSISTANT_INSTRUCTIONS;
      const r = await updateAssistantInstructions(text);
      return res.json({
        ok: true,
        assistant_id: r.id,
        instructions_preview: (r.instructions || '').slice(0, 180) + '...'
      });
    } catch (e) {
      console.error("Assistant update error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// Admin: deliver any queued nudges now (safe for prod)
app.post('/admin/nudges/deliver-now',
  ensureAuthenticatedApi,
  ensureAdmin,
  async (req, res) => {
    try {
      const { max = 50 } = req.body || {};
      const result = await deliverQueuedNudges(pool, { max: Number(max) });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('deliver-now error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);
// Deliver queued nudges every 5 minutes in production
if (process.env.NODE_ENV === 'production') {
  cron.schedule(
    '*/5 * * * *',
    async () => {
      try {
        const result = await deliverQueuedNudges(pool, { max: 100 });
        if (result?.sent) {
          console.log(`[nudges] sent=${result.sent} failed=${result.failed}`);
        }
      } catch (e) {
        console.error('[nudges] cron failed:', e);
      }
    },
    { timezone: 'America/Vancouver' }
  );
}
// Cron: run every day at KINDNESS_SEND_TIME (HH:MM, Vancouver)
const KINDNESS_SEND_TIME = process.env.KINDNESS_SEND_TIME || "09:00";
const [hour, minute] = KINDNESS_SEND_TIME.split(":");

cron.schedule(
  `${minute} ${hour} * * *`,
  async () => {
    console.log(`[${new Date().toISOString()}] running daily kindness job…`);
    try {
      const user_emails      = await fetchUserEmails();
      const kindness_prompts = await fetchKindnessPrompts();
      const subject          = fetchEmailSubject();
      const send_time        = new Date().toISOString();

      await sendDailyKindnessPrompts({
        user_emails,
        kindness_prompts,
        subject,
        send_time
      });
    } catch (e) {
      console.error("Daily job failed:", e);
    }
  },
  { timezone: "America/Vancouver" }
);
// ─────────────────────────────────────────────────────────────────────────────
// DEV UTIL: backfill Neo4j from existing Postgres friends
// Auth: requires login (uses ensureAuthenticatedApi). Safe to keep dev-only.
// ─────────────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'production') {
  app.post('/dev/graph/backfill', ensureAuthenticatedApi, async (req, res) => {
    try {
      const ownerId = await resolveOwnerId(req, pool);
      const { limit = 1000, offset = 0, dry = false } = req.body || {};

      const { rows } = await pool.query(
        `SELECT id, name, email, phone,
                archetype_primary, archetype_secondary,
                score, evidence_direct, evidence_proxy,
                flags_count, red_flags, snapshot, signals, notes, picture
           FROM public.friends
          WHERE owner_user_id = $1
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $2 OFFSET $3`,
        [ownerId, Number(limit), Number(offset)]
      );
      if (dry) {
        return res.json({ ok: true, owner_id: ownerId, found: rows.length, mirrored: 0, errors: [] });
      }
      const errors = [];
      let mirrored = 0;
      for (const f of rows) {
        try {
          await mirrorAssessmentToGraph({
            ownerId,
            friendId: f.id,
            name: f.name || 'Unknown',
            score: f.score ?? 0,
            evidence_direct: f.evidence_direct ?? 0,
            evidence_proxy: f.evidence_proxy ?? 0,
            archetype_primary: f.archetype_primary || null,
            archetype_secondary: f.archetype_secondary || null,
            red_flags: Array.isArray(f.red_flags) ? f.red_flags : [],
            snapshot: f.snapshot || {},
            signals: f.signals || {}
          });
          mirrored++;
        } catch (e) {
          errors.push({ id: f.id, name: f.name, error: e.message });
        }
      }

      return res.json({ ok: true, owner_id: ownerId, found: rows.length, mirrored, errors });
    } catch (e) {
      console.error('POST /dev/graph/backfill error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });
}
// ADMIN: backfill Neo4j from existing Postgres friends (prod-safe)
app.post('/admin/graph/backfill', ensureAuthenticatedApi, ensureAdmin, async (req, res) => {
  try {
    const ownerId = await resolveOwnerId(req, pool);
    const { limit = 200, offset = 0, dry = true } = req.body || {};

    const { rows } = await pool.query(
      `SELECT id, name, email, phone,
              archetype_primary, archetype_secondary,
              score, evidence_direct, evidence_proxy,
              flags_count, red_flags, snapshot, signals, notes, picture
         FROM public.friends
        WHERE owner_user_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT $2 OFFSET $3`,
      [ownerId, Number(limit), Number(offset)]
    );

    if (dry) {
      return res.json({ ok: true, owner_id: ownerId, found: rows.length, mirrored: 0, errors: [] });
    }

    const errors = [];
    let mirrored = 0;

    for (const f of rows) {
      try {
        await mirrorAssessmentToGraph({
          ownerId,
          friendId: f.id,
          name: f.name || 'Unknown',
          score: f.score ?? 0,
          evidence_direct: f.evidence_direct ?? 0,
          evidence_proxy: f.evidence_proxy ?? 0,
          archetype_primary: f.archetype_primary || null,
          archetype_secondary: f.archetype_secondary || null,
          red_flags: Array.isArray(f.red_flags) ? f.red_flags : [],
          snapshot: f.snapshot || {},
          signals: f.signals || {}
        });
        mirrored++;
      } catch (e) {
        errors.push({ id: f.id, name: f.name, error: e.message });
      }
    }

    return res.json({ ok: true, owner_id: ownerId, found: rows.length, mirrored, errors });
  } catch (e) {
    console.error('POST /admin/graph/backfill error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// 18) Start the server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
