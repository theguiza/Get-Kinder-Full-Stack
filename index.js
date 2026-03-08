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
import { fetchVolunteerPortfolio, getVolunteerStats, resolveUserIdFromRequest } from "./services/profileService.js";
import { getSummary as getRatingsSummary } from "./services/ratingsService.js";
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
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { FUNCTIONS } from "./openaiFunctions.js";
import { makeDashboardController } from "./Backend/dashboardController.js";
import { generateArcForQuiz } from "./services/ArcGenerator.js";
import { verify as neoVerify, run as neoRun, close as neoClose } from './Backend/db/neo4j.js';
import { deliverQueuedNudges, sendNudgeEmail } from './kindnessEmailer.js';
const { fetchUserEmails, fetchKindnessPrompts, fetchEmailSubject } = await import("./fetchData.js");
const { sendDailyKindnessPrompts } = await import("./kindnessEmailer.js");
import cookieParser from "cookie-parser";
import quizHooksRouter from "./routes/quizHooks.js";
import arcsApiRouter from "./routes/arcsApi.js";
import { getEventsPage } from "./routes/eventsPage.js";
import eventsApiRouter from "./routes/eventsApi.js";
import invitesApiRouter from "./routes/invitesApi.js";
import meEventsRouter from "./routes/meEventsApi.js";
import meContactsRouter from "./routes/meContactsApi.js";
import carouselApiRouter from "./routes/carouselApi.js";
import walletApiRouter from "./routes/walletApi.js";
import ratingsApiRouter from "./routes/ratingsApi.js";
import redemptionsApiRouter from "./routes/redemptionsApi.js";
import donationsApiRouter from "./routes/donationsApi.js";
import donorApiRouter from "./routes/donorApi.js";
import orgPortalRouter from "./routes/orgPortalApi.js";
import orgApplyRouter from "./routes/orgApplyApi.js";
import adminApiRouter from "./routes/adminApi.js";
import squareWebhooksApiRouter from "./routes/squareWebhooksApi.js";
import { ensureOrgRepPage } from "./middleware/ensureOrgRep.js";
import { ensureAdmin, ensureAdminApi } from "./Backend/middleware/ensureAdmin.js";

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
You are KAI, a warm mattering coach helping people connect offline. You’re not a clinician—never diagnose or give medical/legal advice. Replies should be 30–60 words and follow this structure: empathic reflection → one concrete idea (offer Low/Medium/High effort options when useful) → one inviting question. Celebrate small wins, stay specific, human, and non-judgmental. Use OARS, active-constructive listening, and NAN (Noticing → Affirming → Needing) when relevant. If a message includes "User Context: {...}" followed by "User Message:", use the context silently and never quote the raw JSON. Prefer attached knowledge; otherwise rely on core coaching methods and don’t invent sources. You cannot send nudges, emails, SMS, reminders, or other account actions for guests. If asked, say "To send nudges or emails, please sign in." and provide a copy-paste draft instead. For imminent risk: "If you're in immediate danger, call your local emergency number now. US/Canada: call or text 988 (Suicide & Crisis Lifeline). UK & ROI: Samaritans 116 123. If you're elsewhere, contact local emergency services." Offer help drafting a message to a trusted person. Stay reality-grounded and practical.
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

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_RESEND_WINDOW_MINUTES = 2;
const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(rawEmail) {
  return typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
}

function hashPasswordResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getAppBaseUrl(req) {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/+$/, "");
  const host = req.get("host");
  return `${req.protocol}://${host}`;
}

async function verifyRecaptchaToken(token, remoteIp) {
  if (typeof token !== "string" || !token.trim()) return false;
  if (!RECAPTCHA_SECRET_KEY) {
    console.error("RECAPTCHA_SECRET_KEY is missing.");
    return false;
  }
  const verifyUrl = "https://www.google.com/recaptcha/api/siteverify";
  const body = new URLSearchParams({
    secret: RECAPTCHA_SECRET_KEY,
    response: token.trim(),
  });
  if (remoteIp) {
    body.set("remoteip", String(remoteIp));
  }
  const verifyRes = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!verifyRes.ok) return false;
  const verifyResult = await verifyRes.json();
  return verifyResult?.success === true;
}

const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  "If an account exists for that email, we sent password reset instructions.";
const INVALID_VERIFICATION_LINK_MESSAGE = "Invalid verification link.";
const EXPIRED_VERIFICATION_LINK_MESSAGE = "This verification link is invalid or has expired.";
const EMAIL_VERIFIED_SUCCESS_MESSAGE = "Your email has been verified!";
const VERIFY_PENDING_MESSAGE =
  "Thanks for signing up! Please check your email and click the verification link to activate your account.";
const VERIFY_REQUIRED_MESSAGE =
  "Please verify your email before signing in. Check your inbox for the verification link.";
const RECAPTCHA_SITE_KEY =
  process.env.RECAPTCHA_SITE_KEY
  || process.env.RECAPTCHA_SITEKEY
  || process.env.GOOGLE_RECAPTCHA_SITE_KEY
  || "";
const RECAPTCHA_SECRET_KEY =
  process.env.RECAPTCHA_SECRET_KEY
  || process.env.RECAPTCHA_SECRET
  || process.env.GOOGLE_RECAPTCHA_SECRET_KEY
  || "";
const AUTH_PAGE_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many accounts created from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

async function ensurePasswordResetColumns() {
  await pool.query(`
    ALTER TABLE public.userdata
      ADD COLUMN IF NOT EXISTS reset_password_token_hash text,
      ADD COLUMN IF NOT EXISTS reset_password_expires_at timestamptz,
      ADD COLUMN IF NOT EXISTS reset_password_sent_at timestamptz;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_userdata_reset_password_token_hash
      ON public.userdata (reset_password_token_hash);
  `);
}

ensurePasswordResetColumns()
  .then(() => console.log("Password reset columns ready."))
  .catch((err) => console.error("Could not initialize password reset columns:", err));


// 7) Compute rootPath if needed for static files
//const rootPath = __dirname;
//const rootPath = path.join(__dirname, "../");
app.set("trust proxy", 1);
// 8) Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PgSession = connectPgSimple(session);

// 9) Middleware setup
app.use(cookieParser());
app.use(cors());
app.use(cors());
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (AUTH_PAGE_PATHS.has(req.path)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Referrer-Policy", "no-referrer");
  }
  next();
});
app.use(express.json({
  limit: "5mb",
  verify: (req, res, buf) => {
    // Keep a copy of the raw body for signature verification (e.g., Square webhooks)
    req.rawBody = buf;
  },
}));
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
app.use("/internal/quiz", quizHooksRouter);
app.use(arcsApiRouter);
app.use("/api/webhooks", squareWebhooksApiRouter);
app.use("/api/events", eventsApiRouter);
app.use("/api/invites", ensureAuthenticatedApi, invitesApiRouter);
app.use("/api/me/events", ensureAuthenticatedApi, meEventsRouter);
app.use("/api/me/contacts", ensureAuthenticatedApi, meContactsRouter);
app.use("/api/carousel", ensureAuthenticatedApi, carouselApiRouter);
app.use("/api/wallet", ensureAuthenticatedApi, walletApiRouter);
app.use("/api/ratings", ensureAuthenticatedApi, ratingsApiRouter);
app.use("/api/redemptions", ensureAuthenticatedApi, redemptionsApiRouter);
app.use("/api/donations", ensureAuthenticatedApi, donationsApiRouter);
app.use("/api/donor", ensureAuthenticatedApi, donorApiRouter);
app.use("/api/admin", ensureAuthenticated, adminApiRouter);
app.use("/api/org", ensureAuthenticatedApi, orgPortalRouter);
app.use("/", orgApplyRouter);

// Make `user` available in all EJS templates
app.use((req, res, next) => {
  res.locals.user = req.user;
  res.locals.recaptchaSiteKey = RECAPTCHA_SITE_KEY;
  next();
});

const CSRF_HEADER_NAME = "X-CSRF-Token";

app.use((req, res, next) => {
  try {
    if (req.session && typeof req.session === "object") {
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString("hex");
      }
      req.csrfToken = () => req.session.csrfToken;
    } else {
      req.csrfToken = () => null;
    }
    res.locals.csrfToken = typeof req.csrfToken === "function" ? req.csrfToken() : null;
  } catch (csrfErr) {
    console.error("CSRF middleware error:", csrfErr);
    req.csrfToken = () => null;
    res.locals.csrfToken = null;
  }
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
        const email = normalizeEmail(profile.emails[0].value);

        // 2) Try to find an existing row by email
        const result = await pool.query(
          "SELECT * FROM userdata WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1",
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
          ? normalizeEmail(profile.emails[0].value)
          : null;
        if (!email) {
          return cb(new Error("Facebook profile did not return an email"), null);
        }

        // 2) See if this email already exists in userdata
        const result = await pool.query(
          "SELECT * FROM userdata WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1",
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
      "SELECT * FROM userdata WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1",
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
app.post("/register", registerLimiter, async (req, res, next) => {
  const firstname = typeof req.body?.firstname === "string" ? req.body.firstname : "";
  const lastname = typeof req.body?.lastname === "string" ? req.body.lastname : "";
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    const recaptchaResponse = req.body["g-recaptcha-response"];
    if (!recaptchaResponse) {
      return res.status(400).render("register", {
        title: "Sign Up",
        recaptchaSiteKey: RECAPTCHA_SITE_KEY,
        error: "Please complete the CAPTCHA.",
      });
    }
    const recaptchaPassed = await verifyRecaptchaToken(recaptchaResponse, req.ip);
    if (!recaptchaPassed) {
      console.log("[RECAPTCHA BLOCKED]", email || req.body?.email || "");
      return res.status(400).render("register", {
        title: "Sign Up",
        recaptchaSiteKey: RECAPTCHA_SITE_KEY,
        error: "CAPTCHA verification failed. Please try again.",
      });
    }
    if (!firstname.trim() || !lastname.trim() || !email || !password) {
      return res.status(400).send("Missing required fields.");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO userdata 
         (firstname, lastname, email, password) 
       VALUES 
         ($1, $2, $3, $4) 
       RETURNING *`,
      [firstname, lastname, email, hashedPassword]
    );
    let newUser = result.rows[0];
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");
    const { rows: [verificationUpdatedUser] } = await pool.query(
      `UPDATE public.userdata
          SET email_verification_token_hash = $1,
              email_verification_expires_at = NOW() + INTERVAL '24 hours'
        WHERE id = $2
        RETURNING *`,
      [verificationTokenHash, newUser.id]
    );
    if (verificationUpdatedUser) {
      newUser = verificationUpdatedUser;
    }
    const verificationBaseUrl = (process.env.BASE_URL || getAppBaseUrl(req)).replace(/\/+$/, "");
    const verificationUrl = `${verificationBaseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;
    try {
      await sendNudgeEmail({
        to: newUser.email,
        subject: "Verify your Get Kinder email",
        text: `Hi ${newUser.firstname},\n\nPlease verify your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create this account, you can ignore this email.`,
        html: `<p>Hi ${newUser.firstname},</p><p>Please verify your email address by clicking the link below:</p><p><a href="${verificationUrl}">Verify your email</a></p><p>This link expires in 24 hours.</p><p>If you did not create this account, you can ignore this email.</p>`,
        fromName: "Get Kinder"
      });
    } catch (mailErr) {
      console.error("Verification email send failed:", mailErr);
    }
    return res.redirect("/login?verify=pending");
  } catch (err) {
    if (err?.code === "23505" && err?.constraint === "userdata_email_key") {
      return res
        .status(409)
        .send("An account with that email already exists. Please log in or use Forgot Password.");
    }
    console.error("Registration error:", err);
    res.status(500).send("Error registering user");
  }
});
// 12.2) Login Route
app.post("/login", async (req, res, next) => {
  const submittedEmail = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  try {
    if (!submittedEmail || !password) {
      return res.status(400).render("login", {
        title: "Log In",
        facebookAppId: process.env.FACEBOOK_APP_ID,
        error: "Email and password are required.",
      });
    }

    const result = await pool.query(
      "SELECT * FROM userdata WHERE LOWER(email) = LOWER($1) ORDER BY (password IS NULL), id DESC LIMIT 1",
      [submittedEmail]
    );
    if (result.rows.length === 0) {
      return res.status(401).render("login", {
        title: "Log In",
        facebookAppId: process.env.FACEBOOK_APP_ID,
        error: "No account found with that email.",
      });
    }
    let user = result.rows[0];
    if (typeof user.password !== "string" || !user.password.trim()) {
      return res.status(401).render("login", {
        title: "Log In",
        facebookAppId: process.env.FACEBOOK_APP_ID,
        error: "This account does not have a password set. Use Forgot Password to create one.",
      });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } catch (compareErr) {
      console.error("Login compare error:", compareErr);
      return res.status(401).render("login", {
        title: "Log In",
        facebookAppId: process.env.FACEBOOK_APP_ID,
        error: "Invalid email or password.",
      });
    }

    if (!isMatch) {
      return res.status(401).render("login", {
        title: "Log In",
        facebookAppId: process.env.FACEBOOK_APP_ID,
        error: "Invalid email or password.",
      });
    }
    if (user?.email_verified !== true) {
      return res.redirect("/login?verify=required");
    }
    const needsOnboarding = user?.has_seen_onboarding === false;
    if (needsOnboarding) {
      const { rows: [updatedUser] } = await pool.query(
        "UPDATE userdata SET has_seen_onboarding = TRUE WHERE id = $1 RETURNING *",
        [user.id]
      );
      if (updatedUser) {
        user = updatedUser;
      } else {
        user.has_seen_onboarding = true;
      }
    }
    req.login(user, (err) => {
      if (err) return next(err);
      if (needsOnboarding) {
        const displayName = user.firstname || user.email;
        if (req.session) {
          req.session.showOnboarding = true;
          return req.session.save(() =>
            res.redirect(`/?login=1&name=${encodeURIComponent(displayName)}`)
          );
        }
        return res.redirect(`/?login=1&name=${encodeURIComponent(displayName)}`);
      }
      res.redirect("/dashboard");
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).render("login", {
      title: "Log In",
      facebookAppId: process.env.FACEBOOK_APP_ID,
      error: "Login is temporarily unavailable. Please try again in a minute.",
    });
  }
});
app.get("/forgot-password", (req, res) => {
  return res.render("forgot-password", {
    title: "Forgot Password",
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    message: null,
    messageType: null
  });
});

app.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const submittedEmail = normalizeEmail(req.body?.email);

  try {
    const recaptchaResponse = req.body["g-recaptcha-response"];
    if (!recaptchaResponse) {
      return res.status(400).render("forgot-password", {
        title: "Forgot Password",
        recaptchaSiteKey: RECAPTCHA_SITE_KEY,
        message: "Please complete the CAPTCHA.",
        messageType: "error",
      });
    }
    const recaptchaPassed = await verifyRecaptchaToken(recaptchaResponse, req.ip);
    if (!recaptchaPassed) {
      console.log("[RECAPTCHA BLOCKED]", submittedEmail || req.body?.email || "");
      return res.status(400).render("forgot-password", {
        title: "Forgot Password",
        recaptchaSiteKey: RECAPTCHA_SITE_KEY,
        message: "CAPTCHA verification failed. Please try again.",
        messageType: "error",
      });
    }
    if (submittedEmail) {
      const { rows: [candidate] } = await pool.query(
        `SELECT id, firstname, email, email_verified
           FROM public.userdata
          WHERE LOWER(email) = LOWER($1)
          ORDER BY (password IS NULL), id DESC
          LIMIT 1`,
        [submittedEmail]
      );

      if (!candidate || candidate.email_verified !== true) {
        return res.render("forgot-password", {
          title: "Forgot Password",
          recaptchaSiteKey: RECAPTCHA_SITE_KEY,
          message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
          messageType: "success",
        });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashPasswordResetToken(token);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

      const { rows: [user] } = await pool.query(
        `UPDATE public.userdata
            SET reset_password_token_hash = $1,
                reset_password_expires_at = $2,
                reset_password_sent_at = NOW()
          WHERE id = $3
            AND email_verified = TRUE
            AND (
              reset_password_sent_at IS NULL
              OR reset_password_sent_at <= NOW() - ($4::int * INTERVAL '1 minute')
            )
          RETURNING firstname, email`,
        [tokenHash, expiresAt, candidate.id, PASSWORD_RESET_RESEND_WINDOW_MINUTES]
      );

      if (user) {
        const resetUrl = `${getAppBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
        const firstName = (user.firstname || "there").trim() || "there";
        const subject = "Reset your Get Kinder password";
        const text = `Hi ${firstName},

We received a request to reset your Get Kinder password.
Reset it here: ${resetUrl}

This link expires in 1 hour.
If you did not request this, you can ignore this email.`;
        const html = `
          <p>Hi ${firstName},</p>
          <p>We received a request to reset your Get Kinder password.</p>
          <p><a href="${resetUrl}" target="_blank" rel="noopener">Reset your password</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you did not request this, you can ignore this email.</p>
        `;

        try {
          await sendNudgeEmail({
            to: user.email,
            subject,
            text,
            html,
            fromName: "Get Kinder"
          });
        } catch (mailErr) {
          console.error("Forgot-password email failed:", mailErr);
        }
      }
    }
  } catch (err) {
    console.error("Forgot-password flow error:", err);
  }

  return res.render("forgot-password", {
    title: "Forgot Password",
    recaptchaSiteKey: RECAPTCHA_SITE_KEY,
    message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    messageType: "success",
  });
});

app.get("/reset-password", async (req, res) => {
  const token = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    return res.status(400).render("reset-password", {
      title: "Reset Password",
      isValidToken: false,
      token: "",
      error: "This reset link is invalid or has expired.",
    });
  }

  try {
    const tokenHash = hashPasswordResetToken(token);
    const { rows: [user] } = await pool.query(
      `SELECT id
         FROM public.userdata
        WHERE reset_password_token_hash = $1
          AND reset_password_expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1`,
      [tokenHash]
    );

    if (!user) {
      return res.status(400).render("reset-password", {
        title: "Reset Password",
        isValidToken: false,
        token: "",
        error: "This reset link is invalid or has expired.",
      });
    }

    return res.render("reset-password", {
      title: "Reset Password",
      isValidToken: true,
      token,
      error: null,
    });
  } catch (err) {
    console.error("Reset-password token validation failed:", err);
    return res.status(500).render("reset-password", {
      title: "Reset Password",
      isValidToken: false,
      token: "",
      error: "Could not validate this link. Please request a new reset email.",
    });
  }
});

app.post("/reset-password", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

  if (!token) {
    return res.status(400).render("reset-password", {
      title: "Reset Password",
      isValidToken: false,
      token: "",
      error: "This reset link is invalid or has expired.",
    });
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).render("reset-password", {
      title: "Reset Password",
      isValidToken: true,
      token,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).render("reset-password", {
      title: "Reset Password",
      isValidToken: true,
      token,
      error: "Passwords do not match.",
    });
  }

  try {
    const tokenHash = hashPasswordResetToken(token);
    const { rows: [user] } = await pool.query(
      `SELECT id, email
         FROM public.userdata
        WHERE reset_password_token_hash = $1
          AND reset_password_expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1`,
      [tokenHash]
    );

    if (!user) {
      return res.status(400).render("reset-password", {
        title: "Reset Password",
        isValidToken: false,
        token: "",
        error: "This reset link is invalid or has expired.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE public.userdata
          SET password = $1,
              reset_password_token_hash = NULL,
              reset_password_expires_at = NULL,
              reset_password_sent_at = NULL
        WHERE LOWER(email) = LOWER($2)`,
      [hashedPassword, user.email]
    );

    return res.redirect("/login?reset=1");
  } catch (err) {
    console.error("Reset-password submit failed:", err);
    return res.status(500).render("reset-password", {
      title: "Reset Password",
      isValidToken: true,
      token,
      error: "Something went wrong while resetting your password. Please try again.",
    });
  }
});

app.get("/verify-email", async (req, res) => {
  const token = typeof req.query?.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    return res.redirect(`/login?error=${encodeURIComponent(INVALID_VERIFICATION_LINK_MESSAGE)}`);
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const { rows: [user] } = await pool.query(
      `SELECT id
         FROM public.userdata
        WHERE email_verification_token_hash = $1
          AND email_verification_expires_at > NOW()
        ORDER BY id DESC
        LIMIT 1`,
      [tokenHash]
    );

    if (!user) {
      return res.redirect(`/login?error=${encodeURIComponent(EXPIRED_VERIFICATION_LINK_MESSAGE)}`);
    }

    await pool.query(
      `UPDATE public.userdata
          SET email_verified = TRUE,
              email_verification_token_hash = NULL,
              email_verification_expires_at = NULL
        WHERE id = $1`,
      [user.id]
    );

    if (req.isAuthenticated && req.isAuthenticated()) {
      return res.redirect("/dashboard?verified=1");
    }
    return res.redirect("/login?verified=1");
  } catch (err) {
    console.error("Verify-email flow error:", err);
    return res.redirect(`/login?error=${encodeURIComponent(EXPIRED_VERIFICATION_LINK_MESSAGE)}`);
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
    if (req.user?.is_suspended) {
      req.logout((err) => {
        if (err) {
          console.error("Suspended-user logout failed:", err);
        }
        if (typeof req.flash === "function") {
          req.flash("error", "Your account has been suspended. Please contact support.");
        }
        return res.redirect("/login");
      });
      return;
    }
    return next();
  }
  return res.redirect("/login");
}

const AVAILABILITY_DAY_SET = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const AVAILABILITY_TIME_OF_DAY_SET = new Set(["morning", "afternoon", "evening"]);
const AVAILABILITY_FREQUENCY_SET = new Set(["1w", "2w", "flex"]);
const AVAILABILITY_NOTICE_SET = new Set(["same_day", "24h", "48h"]);
const DEFAULT_AVAILABILITY_TIMEZONE = "America/Vancouver";
const LOCATION_SOURCE_SET = new Set(["address", "pin", "gps"]);
const TRAVEL_MODE_SET = new Set(["walk", "bike", "transit", "drive"]);

function safeParseJsonValue(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseRequiredJsonString(rawValue, fieldName) {
  if (typeof rawValue !== "string") {
    throw new Error(`${fieldName} must be a JSON string.`);
  }
  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`${fieldName} is not valid JSON.`);
  }
}

function isPlausibleIanaTimezone(value) {
  if (typeof value !== "string") return false;
  const tz = value.trim();
  if (!tz || !/^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normalizeTimezone(value, fallback = DEFAULT_AVAILABILITY_TIMEZONE) {
  if (isPlausibleIanaTimezone(value)) return String(value).trim();
  if (isPlausibleIanaTimezone(fallback)) return String(fallback).trim();
  return DEFAULT_AVAILABILITY_TIMEZONE;
}

function normalizeOptionalString(value, maxLen = 255) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function parseCoordinate(value, kind) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${kind} must be a valid number.`);
  }
  const limit = kind === "latitude" ? 90 : 180;
  if (parsed < -limit || parsed > limit) {
    throw new Error(`${kind} is out of range.`);
  }
  return Math.round(parsed * 1000) / 1000;
}

function parseTravelRadiusKm(value, fallback = 5, { strict = false } = {}) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    if (strict) throw new Error("travel_radius_km must be a number.");
    return fallback;
  }
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 25) {
    if (strict) throw new Error("travel_radius_km must be between 1 and 25.");
    return fallback;
  }
  return rounded;
}

function normalizeTravelMode(value, fallback = "transit", { strict = false } = {}) {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (TRAVEL_MODE_SET.has(mode)) return mode;
  if (strict && value != null && value !== "") {
    throw new Error("travel_mode must be one of walk, bike, transit, drive.");
  }
  return TRAVEL_MODE_SET.has(fallback) ? fallback : "transit";
}

function normalizeLocationSource(value, fallback = null, { strict = false } = {}) {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (LOCATION_SOURCE_SET.has(source)) return source;
  if (strict && value != null && value !== "") {
    throw new Error("home_base_source must be one of address, pin, gps.");
  }
  return LOCATION_SOURCE_SET.has(fallback) ? fallback : null;
}

function normalizeDayToken(value) {
  if (value == null) return null;
  const token = String(value).trim().toLowerCase().slice(0, 3);
  return AVAILABILITY_DAY_SET.has(token) ? token : null;
}

function normalizeTimeValue(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v) ? v : null;
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value;
}

function normalizeWeeklyAvailability(raw, fallbackTimezone, { strict = false } = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const timezone = normalizeTimezone(source.timezone, fallbackTimezone);

  const days = Array.isArray(source.days)
    ? [...new Set(source.days.map(normalizeDayToken).filter(Boolean))]
    : [];

  const timeOfDay = Array.isArray(source.time_of_day)
    ? [...new Set(
        source.time_of_day
          .map((value) => String(value || "").trim().toLowerCase())
          .filter((value) => AVAILABILITY_TIME_OF_DAY_SET.has(value))
      )]
    : [];

  const frequency = AVAILABILITY_FREQUENCY_SET.has(String(source.frequency || ""))
    ? String(source.frequency)
    : "flex";
  const notice = AVAILABILITY_NOTICE_SET.has(String(source.notice || ""))
    ? String(source.notice)
    : "24h";

  let earliest = normalizeTimeValue(source.earliest_time);
  let latest = normalizeTimeValue(source.latest_time);
  if (earliest && latest && earliest >= latest) {
    if (strict) {
      throw new Error("Weekly earliest_time must be before latest_time.");
    }
    earliest = null;
    latest = null;
  }

  return {
    days,
    time_of_day: timeOfDay,
    earliest_time: earliest,
    latest_time: latest,
    frequency,
    notice,
    timezone,
  };
}

function normalizeAvailabilityExceptions(raw, fallbackTimezone, { strict = false } = {}) {
  const source = Array.isArray(raw) ? raw : [];
  if (strict && source.length > 10) {
    throw new Error("You can add up to 10 availability exceptions.");
  }

  const perDateCounts = new Map();
  const normalized = [];
  const list = strict ? source : source.slice(0, 10);

  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      if (strict) throw new Error("Each availability exception must be an object.");
      continue;
    }

    const date = typeof entry.date === "string" ? entry.date.trim() : "";
    const start = normalizeTimeValue(entry.start);
    const end = normalizeTimeValue(entry.end);
    const timezone = normalizeTimezone(entry.timezone, fallbackTimezone);

    if (!isValidDateOnly(date)) {
      if (strict) throw new Error("Each availability exception needs a valid date.");
      continue;
    }
    if (!start || !end) {
      if (strict) throw new Error("Each availability exception needs start and end times.");
      continue;
    }
    if (start >= end) {
      if (strict) throw new Error("Availability exception start must be before end.");
      continue;
    }

    const nextForDate = (perDateCounts.get(date) || 0) + 1;
    if (nextForDate > 3) {
      if (strict) throw new Error("You can add up to 3 exception windows per date.");
      continue;
    }
    perDateCounts.set(date, nextForDate);

    normalized.push({ date, start, end, timezone });
    if (!strict && normalized.length >= 10) break;
  }

  normalized.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.start !== b.start) return a.start.localeCompare(b.start);
    return a.end.localeCompare(b.end);
  });
  return normalized;
}

function buildAvailabilityStateForProfile(userRow = {}) {
  const parsedWeekly = safeParseJsonValue(userRow.availability_weekly, {});
  const timezone = normalizeTimezone(
    userRow.timezone,
    parsedWeekly && typeof parsedWeekly === "object" ? parsedWeekly.timezone : DEFAULT_AVAILABILITY_TIMEZONE
  );
  const weekly = normalizeWeeklyAvailability(parsedWeekly, timezone, { strict: false });
  const parsedExceptions = safeParseJsonValue(userRow.specfifc_availability, []);
  const exceptions = normalizeAvailabilityExceptions(parsedExceptions, weekly.timezone, { strict: false });
  return {
    weekly,
    exceptions,
    timezone: weekly.timezone,
  };
}

function parseAvailabilityFromRequestBody(body, existingUserRow = {}) {
  const existing = buildAvailabilityStateForProfile(existingUserRow);
  const requestedTimezone = normalizeTimezone(
    body.timezone || body.availability_timezone,
    existing.timezone
  );

  const weeklyRaw = (typeof body.availability_weekly_json === "string" && body.availability_weekly_json.trim())
    ? parseRequiredJsonString(body.availability_weekly_json, "availability_weekly_json")
    : existing.weekly;
  const weekly = normalizeWeeklyAvailability(weeklyRaw, requestedTimezone, { strict: true });

  const exceptionsRaw = (typeof body.availability_exceptions_json === "string" && body.availability_exceptions_json.trim())
    ? parseRequiredJsonString(body.availability_exceptions_json, "availability_exceptions_json")
    : existing.exceptions;
  const exceptions = normalizeAvailabilityExceptions(exceptionsRaw, weekly.timezone, { strict: true });

  return {
    weekly,
    exceptions,
    timezone: weekly.timezone,
  };
}

function buildLocationStateForProfile(userRow = {}) {
  const lat = userRow.home_base_lat == null ? null : Number(userRow.home_base_lat);
  const lng = userRow.home_base_lng == null ? null : Number(userRow.home_base_lng);
  const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const timezone = normalizeTimezone(userRow.timezone, DEFAULT_AVAILABILITY_TIMEZONE);

  return {
    lat: hasValidCoords ? Math.round(lat * 1000) / 1000 : null,
    lng: hasValidCoords ? Math.round(lng * 1000) / 1000 : null,
    label: normalizeOptionalString(userRow.home_base_label, 255),
    source: normalizeLocationSource(userRow.home_base_source),
    travel_radius_km: parseTravelRadiusKm(userRow.travel_radius_km, 5),
    travel_mode: normalizeTravelMode(userRow.travel_mode, "transit"),
    timezone,
  };
}

function parseLocationFromRequestBody(body, existingUserRow = {}) {
  const existing = buildLocationStateForProfile(existingUserRow);
  const timezone = normalizeTimezone(body.timezone || body.availability_timezone, existing.timezone);
  const latProvided = Object.prototype.hasOwnProperty.call(body, "home_base_lat");
  const lngProvided = Object.prototype.hasOwnProperty.call(body, "home_base_lng");
  const latRaw = latProvided ? body.home_base_lat : existing.lat;
  const lngRaw = lngProvided ? body.home_base_lng : existing.lng;
  const lat = parseCoordinate(latRaw, "latitude");
  const lng = parseCoordinate(lngRaw, "longitude");

  if ((lat == null) !== (lng == null)) {
    throw new Error("Both home_base_lat and home_base_lng are required.");
  }

  const explicitClear = latProvided && lngProvided && (body.home_base_lat === "" || body.home_base_lng === "");
  const hasCoords = !explicitClear && lat != null && lng != null;

  const travelRadius = parseTravelRadiusKm(
    body.travel_radius_km,
    existing.travel_radius_km,
    { strict: true }
  );
  const travelMode = normalizeTravelMode(
    body.travel_mode,
    existing.travel_mode,
    { strict: true }
  );

  if (!hasCoords) {
    return {
      lat: null,
      lng: null,
      label: null,
      source: null,
      travel_radius_km: travelRadius,
      travel_mode: travelMode,
      timezone,
    };
  }

  const label = normalizeOptionalString(body.home_base_label, 255)
    || existing.label
    || `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  const source = normalizeLocationSource(
    body.home_base_source,
    existing.source || "address",
    { strict: true }
  ) || "address";

  return {
    lat,
    lng,
    label,
    source,
    travel_radius_km: travelRadius,
    travel_mode: travelMode,
    timezone,
  };
}

app.post(
  '/profile',
  ensureAuthenticated,
  (req, res, next) => {
    uploadAvatar.single('picture')(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.redirect('/profile?uploadError=fileTooLarge');
      }
      console.error('Profile upload error:', err);
      return res.redirect('/profile?uploadError=uploadFailed');
    });
  },
  async (req, res) => {
    // 1) Extract text fields from req.body
    let {
      firstname,
      lastname,
      email,
      phone,
      address1,
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
      const authUserId = Number(req.user?.id);
      const existingResult = Number.isFinite(authUserId)
        ? await pool.query(
            `SELECT id, email, availability_weekly, specfifc_availability, timezone,
                    home_base_lat, home_base_lng, home_base_label, home_base_source,
                    travel_radius_km, travel_mode
               FROM userdata
              WHERE id = $1
              LIMIT 1`,
            [authUserId]
          )
        : await pool.query(
            `SELECT id, email, availability_weekly, specfifc_availability, timezone,
                    home_base_lat, home_base_lng, home_base_label, home_base_source,
                    travel_radius_km, travel_mode
               FROM userdata
              WHERE email = $1
              LIMIT 1`,
            [req.user.email]
          );
      const existingUserRow = existingResult.rows[0] || {};
      if (!existingUserRow.id) {
        return res.status(404).send('Profile record not found.');
      }

      if (typeof email !== "string" || !email.trim()) {
        email = existingUserRow.email;
      } else {
        email = email.trim();
      }

      let locationPrefs;
      try {
        locationPrefs = parseLocationFromRequestBody(req.body || {}, existingUserRow);
      } catch (validationErr) {
        return res.status(400).send(`Invalid location settings: ${validationErr.message}`);
      }

      let availability;
      try {
        availability = parseAvailabilityFromRequestBody(
          { ...(req.body || {}), timezone: locationPrefs.timezone },
          existingUserRow
        );
      } catch (validationErr) {
        return res.status(400).send(`Invalid availability settings: ${validationErr.message}`);
      }

      // 3) Update all fields, including picture (TEXT column)
      const updateResult = await pool.query(
        `
        UPDATE userdata
           SET
             firstname = $1,
             lastname  = $2,
             email     = $3,
             phone     = $4,
             address1  = $5,
             city      = $6,
             state     = $7,
             country   = $8,
             interest1 = $9,
             interest2 = $10,
             interest3 = $11,
             sdg1      = $12,
             sdg2      = $13,
             sdg3      = $14,
             availability_weekly = $15::jsonb,
             specfifc_availability = $16::jsonb,
             home_base_lat = $17,
             home_base_lng = $18,
             home_base_label = $19,
             home_base_source = $20,
             travel_radius_km = $21,
             travel_mode = $22,
             timezone = $23,
             picture   = $24
         WHERE id = $25
         RETURNING id, email, availability_weekly, specfifc_availability, timezone,
                   home_base_lat, home_base_lng, home_base_label, home_base_source,
                   travel_radius_km, travel_mode
        `,
        [
          firstname,
          lastname,
          email,
          phone,
          address1,
          city,
          state,
          country,
          interest1,
          interest2,
          interest3,
          sdg1,
          sdg2,
          sdg3,
          JSON.stringify(availability.weekly),
          JSON.stringify(availability.exceptions),
          locationPrefs.lat,
          locationPrefs.lng,
          locationPrefs.label,
          locationPrefs.source,
          locationPrefs.travel_radius_km,
          locationPrefs.travel_mode,
          locationPrefs.timezone,
          newPictureData,
          existingUserRow.id,
        ]
      );
      if (!updateResult.rowCount) {
        return res.status(500).send('Profile update did not persist.');
      }

      // 4) Update req.user so EJS picks up new picture immediately
      req.user = {
        ...req.user,
        firstname,
        lastname,
        email,
        phone,
        address1,
        city,
        state,
        country,
        interest1,
        interest2,
        interest3,
        sdg1,
        sdg2,
        sdg3,
        availability_weekly: availability.weekly,
        specfifc_availability: availability.exceptions,
        home_base_lat: locationPrefs.lat,
        home_base_lng: locationPrefs.lng,
        home_base_label: locationPrefs.label,
        home_base_source: locationPrefs.source,
        travel_radius_km: locationPrefs.travel_radius_km,
        travel_mode: locationPrefs.travel_mode,
        timezone: locationPrefs.timezone,
        picture: newPictureData,
      };

      return res.redirect('/profile');
    } catch (err) {
      console.error('Error updating profile:', err);
      if (err && err.code === '42703') {
        return res.status(500).send('Profile preference columns are missing. Run profile migrations in scripts/migrations.');
      }
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
    const userRow = result.rows[0];
    const availabilityInitial = buildAvailabilityStateForProfile(userRow);
    const locationInitial = buildLocationStateForProfile(userRow);
    const statsUserId = (await resolveUserIdFromRequest(req)) || String(userRow.id);
    const showStatsDebug = process.env.NODE_ENV !== "production" || Boolean(process.env.DEBUG);

    let topFriends = [];
    let friendPoints = { monthly: 0, total: 0, goal: 500 };
    try {
      const { rows: friendRows } = await pool.query(
        `SELECT
             COALESCE(f.name, fa.name)               AS name,
             COALESCE(f.score, fa.friend_score)      AS score,
             COALESCE(f.archetype_primary, fa.friend_type) AS archetype_primary,
             f.archetype_secondary
          FROM public.friend_arcs fa
          LEFT JOIN public.friends f
            ON f.id::text = fa.id::text
           AND f.owner_user_id = fa.user_id
         WHERE fa.user_id = $1
         ORDER BY COALESCE(f.score, fa.friend_score) DESC NULLS LAST,
                  COALESCE(f.name, fa.name) ASC
          LIMIT 3`,
        [statsUserId]
      );

      topFriends = friendRows.map((row) => {
        const score = Number.isFinite(row.score) ? Math.round(row.score) : null;
        const type = [row.archetype_primary, row.archetype_secondary]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .find((value) => value.length);

        return {
          name: row.name || 'Friend',
          score,
          type: type || '—'
        };
      });
    } catch (friendErr) {
      console.warn('Profile top friends query failed:', friendErr.message || friendErr);
      topFriends = [];
    }

    try {
      const { rows: [pointsRow] = [] } = await pool.query(
        `
        SELECT
          COALESCE(SUM(arc_points), 0)   AS total_points,
          COALESCE(SUM(points_today), 0) AS today_points
          FROM friend_arcs
         WHERE user_id = $1
        `,
        [statsUserId]
      );

      const total = Number(pointsRow?.total_points) || 0;
      const monthly = Number(pointsRow?.today_points) || 0; // fallback until monthly tracking exists
      friendPoints = {
        monthly,
        total,
        goal: 500
      };
    } catch (pointsErr) {
      console.warn('Profile friend points query failed:', pointsErr.message || pointsErr);
      friendPoints = { monthly: 0, total: 0, goal: 500 };
    }

    // 2) Mirror your home/about/blog locals
    const success      = req.query.success === '1';   // registration alert
    const loginSuccess = req.query.login   === '1';   // login alert
    const name         = req.query.name    || '';     // firstname/email
    const uploadError  = req.query.uploadError || '';
    // 3) Portfolio + derived skills/hours
    let portfolioRows = [];
    let portfolioSummary = { total_serves_verified: 0, total_hours_verified: 0, total_kind_est_earned: 0 };
    let skillsBreakdown = { topCategories: [], recentCategories: [] };

    try {
      const rawRows = await fetchVolunteerPortfolio({ userId: statsUserId, limit: 40 });
      const now = new Date();

      portfolioRows = rawRows.map((row) => {
        const startAt = row.start_at ? new Date(row.start_at) : null;
        const endAt = row.end_at ? new Date(row.end_at) : null;
        const ms = (startAt && endAt) ? Math.max(0, endAt - startAt) : 0;
        const duration_hours = ms > 0 ? Math.round((ms / 36e5) * 10) / 10 : 0;
        const is_upcoming = !!(startAt && startAt > now && ['published', 'scheduled'].includes(row.event_status));
        const is_verified = row.verification_status === "verified";
        const acceptedCount = Number(row.accepted_count) || 0;
        const poolKind = row.reward_pool_kind != null ? Number(row.reward_pool_kind) : 0;
        const safePoolKind = Number.isFinite(poolKind) ? poolKind : 0;
        const kind_estimate_per_user = Math.floor(safePoolKind / Math.max(acceptedCount, 1));

        return {
          ...row,
          start_at: startAt,
          end_at: endAt,
          duration_hours,
          is_upcoming,
          is_verified,
          kind_estimate_per_user,
          accepted_count: acceptedCount
        };
      });

      portfolioSummary = portfolioRows.reduce(
        (acc, row) => {
          if (row.is_verified) {
            acc.total_serves_verified += 1;
            acc.total_hours_verified += row.duration_hours || 0;
            acc.total_kind_est_earned += row.kind_estimate_per_user || 0;
          }
          return acc;
        },
        { total_serves_verified: 0, total_hours_verified: 0, total_kind_est_earned: 0 }
      );

      const categoryHours = new Map();
      portfolioRows.forEach((row) => {
        const cat = (row.category && String(row.category).trim()) || 'General Service';
        categoryHours.set(cat, (categoryHours.get(cat) || 0) + (row.duration_hours || 0));
      });
      const topCategories = Array.from(categoryHours.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, hours]) => ({ category, hours: Math.round(hours * 10) / 10 }));

      const recentCategories = [];
      for (const row of portfolioRows) {
        const cat = (row.category && String(row.category).trim()) || 'General Service';
        if (!recentCategories.includes(cat)) recentCategories.push(cat);
        if (recentCategories.length >= 6) break;
      }
      skillsBreakdown = { topCategories, recentCategories };
    } catch (portfolioErr) {
      console.warn('Profile portfolio query failed:', portfolioErr.message || portfolioErr);
      portfolioRows = [];
    }

    let volunteerStats;
    try {
      volunteerStats = await getVolunteerStats(statsUserId);
    } catch (statsErr) {
      console.warn("Volunteer stats query failed:", statsErr.message || statsErr);
      volunteerStats = null;
    }

    let volunteerRating = { value: 5, count: 0, hasRatings: false, starsFilled: 5 };
    try {
      const summary = await getRatingsSummary({ userId: statsUserId, limit: 20 });
      const count = Number(summary?.sampleSize) || 0;
      const hasRatings = count > 0 && Number.isFinite(Number(summary?.kindnessRating));
      const value = hasRatings ? Number(summary.kindnessRating) : 5;
      const starsFilled = Math.max(1, Math.min(5, Math.round(value)));
      volunteerRating = { value, count, hasRatings, starsFilled };
    } catch (ratingErr) {
      if (ratingErr?.code !== "42P01") {
        console.warn("Volunteer rating query failed:", ratingErr.message || ratingErr);
      }
    }
    if (showStatsDebug) {
      console.log("[profile] req.user:", {
        id: req.user?.id,
        email: req.user?.email,
      });
      console.log("[profile] stats_user_id:", statsUserId, "volunteerStats:", volunteerStats);
      console.log("[profile] volunteer_rating:", volunteerRating);
    }

    // 4) Render profile.ejs with all flags + user data
    return res.render('profile', {
      title:        'User Profile',
      user:         userRow,
      topFriends,
      friendPoints,
      portfolioRows,
      portfolioSummary,
      skillsBreakdown,
      volunteerStats,
      volunteerRating,
      debugStatsUserId: showStatsDebug ? statsUserId : null,
      showStatsDebug,
      success,
      loginSuccess,
      name,
      uploadError,
      availabilityInitial,
      locationInitial
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
app.get("/login", (req, res) => {
  const passwordResetSuccess = req.query.reset === "1";
  const emailVerifiedSuccess = req.query.verified === "1";
  const verifyPending = req.query.verify === "pending";
  const verifyRequired = req.query.verify === "required";
  const verificationError = typeof req.query.error === "string" ? req.query.error.trim() : "";
  const successMessage = verifyPending
    ? VERIFY_PENDING_MESSAGE
    : emailVerifiedSuccess
    ? EMAIL_VERIFIED_SUCCESS_MESSAGE
    : passwordResetSuccess
    ? "Password updated. You can log in now."
    : null;
  const verifyRequiredError = verifyRequired ? VERIFY_REQUIRED_MESSAGE : "";
  return res.render("login", {
    title: "Log In",
    facebookAppId: process.env.FACEBOOK_APP_ID,
    success: successMessage,
    error: verifyRequiredError || verificationError || null,
  });
});
app.get("/register", (req, res) => res.render("register", {
  title: "Sign Up",
  recaptchaSiteKey: RECAPTCHA_SITE_KEY,
}));
app.get("/404", (req, res) => res.render("404", { title: "404 ERROR" }));
app.get("/error", (req, res) => res.render("error", { title: "500 ERROR" }));
// Middleware to ensure authentication for API routes
function ensureAuthenticatedApi(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    if (req.user?.is_suspended) {
      return res.status(403).json({ error: "account_suspended" });
    }
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
}

function normalizeGeoQuery(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
}

function hasExplicitGeoContext(query) {
  if (!query) return false;
  if (query.includes(",")) return true;
  return /\b(vancouver|victoria|burnaby|surrey|richmond|coquitlam|langley|nanaimo|kelowna|abbotsford|whistler|british columbia|\bbc\b|canada|usa|united states)\b/i.test(query);
}

function buildGeocodeQueryCandidates(query) {
  const normalized = normalizeGeoQuery(query);
  if (!normalized) return [];
  const candidates = hasExplicitGeoContext(normalized)
    ? [normalized, `${normalized}, BC, Canada`, `${normalized}, Canada`]
    : [`${normalized}, Vancouver, BC, Canada`, `${normalized}, BC, Canada`, `${normalized}, Canada`, normalized];

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/geo/geocode', ensureAuthenticatedApi, async (req, res) => {
  const rawQuery = normalizeGeoQuery(req.query.q);
  if (!rawQuery || rawQuery.length < 3) {
    return res.status(400).json({ ok: false, error: "Query must be at least 3 characters." });
  }

  try {
    const queryCandidates = buildGeocodeQueryCandidates(rawQuery);
    let sawProviderError = false;
    let sawOkResponse = false;
    let sawInvalidCoordinates = false;

    for (const candidate of queryCandidates) {
      const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
      searchUrl.searchParams.set("q", candidate);
      searchUrl.searchParams.set("format", "jsonv2");
      searchUrl.searchParams.set("limit", "1");
      searchUrl.searchParams.set("addressdetails", "1");

      const response = await fetchJsonWithTimeout(searchUrl, {
        headers: {
          "User-Agent": process.env.GEO_USER_AGENT || "GetKinder.ai/1.0 (profile geocoder)",
          "Accept-Language": "en"
        }
      });
      if (!response.ok) {
        sawProviderError = true;
        continue;
      }

      sawOkResponse = true;
      const payload = await response.json();
      const first = Array.isArray(payload) ? payload[0] : null;
      if (!first) {
        continue;
      }

      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        sawInvalidCoordinates = true;
        continue;
      }

      const label = normalizeOptionalString(first.display_name, 255)
        || `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`;

      return res.json({
        ok: true,
        data: {
          lat,
          lng,
          label,
        }
      });
    }

    if (!sawOkResponse && sawProviderError) {
      return res.status(502).json({ ok: false, error: "Geocoding provider error." });
    }

    if (sawInvalidCoordinates) {
      return res.status(502).json({ ok: false, error: "Geocoding provider returned invalid coordinates." });
    }

    return res.status(404).json({ ok: false, error: "No matching location found." });
  } catch (err) {
    console.error("GET /api/geo/geocode error:", err);
    return res.status(500).json({ ok: false, error: "Unable to geocode location right now." });
  }
});

app.get('/api/geo/reverse', ensureAuthenticatedApi, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ ok: false, error: "Valid lat/lng are required." });
  }

  try {
    const reverseUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    reverseUrl.searchParams.set("lat", String(lat));
    reverseUrl.searchParams.set("lon", String(lng));
    reverseUrl.searchParams.set("format", "jsonv2");
    reverseUrl.searchParams.set("zoom", "16");

    const response = await fetchJsonWithTimeout(reverseUrl, {
      headers: {
        "User-Agent": process.env.GEO_USER_AGENT || "GetKinder.ai/1.0 (profile geocoder)",
        "Accept-Language": "en"
      }
    });
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: "Reverse geocoding provider error." });
    }

    const payload = await response.json();
    const label = normalizeOptionalString(payload?.display_name, 255)
      || `Near ${lat.toFixed(3)}, ${lng.toFixed(3)}`;

    return res.json({ ok: true, data: { label } });
  } catch (err) {
    console.error("GET /api/geo/reverse error:", err);
    return res.status(500).json({ ok: false, error: "Unable to reverse geocode right now." });
  }
});

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
    assetTag: process.env.ASSET_TAG ?? Date.now().toString(36),
    csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null
   });
});

const tierFromScore = (score) => {
  const num = Number(score);
  if (!Number.isFinite(num)) return null;
  if (num >= 85) return "Bestie Material";
  if (num >= 70) return "Strong Contender";
  if (num >= 50) return "Potential Pal";
  return "Acquaintance Energy";
};

const chooseTier = (explicitTier, score) => {
  const tierCandidate =
    typeof explicitTier === "string" && explicitTier.trim()
      ? explicitTier.trim()
      : null;
  if (tierCandidate) {
    return tierCandidate;
  }
  return tierFromScore(score) || "General";
};

const chooseChannelPref = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "mixed";
};

const buildArcPayload = (ownerId, friend, body) => {
  if (!ownerId || !friend?.id || !friend?.name) return null;
  const tier = chooseTier(
    body?.tier ?? body?.friend_tier ?? body?.friendTier,
    friend?.score
  );
  const channelPref = chooseChannelPref(
    body?.channel_pref ?? body?.channelPref ?? body?.preferred_channel
  );
  if (!tier || !channelPref) return null;

  const payload = {
    user_id: ownerId,
    friend_id: friend.id,
    friend_name: friend.name,
    tier,
    channel_pref: channelPref,
    friend_score: friend?.score ?? null,
    friend_type: friend?.archetype_primary ?? null,
    effort_capacity:
      typeof body?.effort_capacity === "string" && body.effort_capacity.trim()
        ? body.effort_capacity.trim()
        : typeof body?.effortCapacity === "string" && body.effortCapacity.trim()
        ? body.effortCapacity.trim()
        : undefined,
    goal: body?.goal ?? body?.goals,
    availability: body?.availability,
    quiz_session_id: body?.quiz_session_id ?? body?.quizSessionId ?? null,
  };

  if (payload.effort_capacity === undefined) {
    delete payload.effort_capacity;
  }
  if (payload.goal === undefined) {
    delete payload.goal;
  }
  if (payload.availability === undefined) {
    delete payload.availability;
  }

  return payload;
};

app.post("/api/friends", ensureAuthenticatedApi, async (req, res) => {
  try {
    const expectedCsrf = req.session?.csrfToken;
    const providedCsrf = req.get(CSRF_HEADER_NAME);
    if (!expectedCsrf || !providedCsrf || providedCsrf !== expectedCsrf) {
      return res.status(403).json({ error: "invalid csrf token" });
    }

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
    const friendIdRaw = req.query.id ?? req.body.id ?? null;
    const friendId = (typeof friendIdRaw === 'string' && friendIdRaw.trim().length > 0)
      ? friendIdRaw.trim()
      : friendIdRaw != null
      ? String(friendIdRaw)
      : null;

    let friend;

    if (friendId) {
      const { rows: [updated] } = await pool.query(`
        UPDATE public.friends AS f
           SET name               = $3,
               email              = $4,
               phone              = $5,
               archetype_primary  = $6,
               archetype_secondary= $7,
               score              = $8,
               evidence_direct    = $9,
               evidence_proxy     = $10,
               flags_count        = $11,
               red_flags          = $12,
               snapshot           = $13,
               signals            = $14,
               notes              = COALESCE(f.notes, $15),
               picture            = COALESCE($16, f.picture),
               updated_at         = now()
         WHERE f.id = $1
           AND f.owner_user_id = $2
       RETURNING f.*;
      `, [
        friendId,
        owner.id,
        name,
        email,
        phone,
        archetype_primary,
        archetype_secondary,
        score,
        evidence_direct,
        evidence_proxy,
        flags_count,
        red_flags,
        snapshot,
        signals,
        notes,
        picture
      ]);

      if (!updated) {
        return res.status(404).json({ error: "friend not found" });
      }
      friend = updated;
    } else {
      const { rows: [inserted] } = await pool.query(`
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
      friend = inserted;
    }

    try {
      const arcPayload = buildArcPayload(owner.id, friend, req.body);
      if (arcPayload) {
        await generateArcForQuiz(pool, arcPayload);
      } else {
        console.warn("Skipped arc generation: insufficient payload", {
          ownerId: owner.id,
          friendId: friend?.id || null,
        });
      }
    } catch (arcErr) {
      console.error("generateArcForQuiz failed (continuing):", arcErr);
    }

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

// Dashboard - All dashboard routes
app.get("/dashboard", ensureAuthenticated, getDashboard);
app.get("/events", getEventsPage);
app.get("/checkin/:eventId", ensureAuthenticated, (req, res) => {
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);
  const eventId = String(req.params.eventId || "").trim();
  res.render("checkin", {
    title: "Event Check-In",
    assetTag,
    eventId,
    csrfToken: typeof req.csrfToken === "function" ? req.csrfToken() : null,
  });
});
//app.get('/dashboard/morning-prompt', ensureAuthenticated, getMorningPrompt);
//app.post('/dashboard/reflect', ensureAuthenticated, saveReflection);
//app.post('/dashboard/mark-done', ensureAuthenticated, markDayDone);
//app.post("/challenge/cancel", ensureAuthenticated, cancelChallenge);

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

app.get("/donor", ensureAuthenticated, async (req, res) => {
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);
  let donorRow = null;
  try {
    if (req.user?.id) {
      const byId = await pool.query(
        "SELECT firstname, lastname, email, picture FROM public.userdata WHERE id = $1 LIMIT 1",
        [req.user.id]
      );
      donorRow = byId.rows[0] || null;
    }
    if (!donorRow && req.user?.email) {
      const byEmail = await pool.query(
        "SELECT firstname, lastname, email, picture FROM public.userdata WHERE email = $1 LIMIT 1",
        [req.user.email]
      );
      donorRow = byEmail.rows[0] || null;
    }
  } catch (err) {
    console.error("GET /donor profile load error:", err);
  }

  const donorProfile = {
    firstname: donorRow?.firstname || req.user?.firstname || req.user?.first_name || "",
    lastname: donorRow?.lastname || req.user?.lastname || req.user?.last_name || "",
    name: req.user?.name || req.user?.displayName || "",
    email: donorRow?.email || req.user?.email || "",
    picture: donorRow?.picture || req.user?.picture || req.user?.avatar || req.user?.photo || "",
  };
  res.render("donor", { title: "Donor Dashboard", assetTag, donorProfile });
});

app.get("/admin", ensureAuthenticated, ensureAdmin, (req, res) => {
  const assetTag = Date.now();
  res.render("admin", {
    assetTag,
    user: req.user,
    csrfToken: req.session.csrfToken,
  });
});

app.get("/org-portal", ensureOrgRepPage, async (req, res) => {
  const assetTag = Date.now();
  const orgRating = {
    orgId: null,
    value: 5,
    count: 0,
    hasRatings: false,
    starsFilled: 5,
  };
  let organizationName = "";

  try {
    const numericSessionId = Number(req.user?.id);
    let resolvedUserId = Number.isInteger(numericSessionId) ? String(numericSessionId) : null;
    let orgId = req.user?.org_id != null ? Number(req.user.org_id) : null;

    if (req.user?.email) {
      const byEmail = await pool.query(
        "SELECT id, org_id FROM public.userdata WHERE email = $1 LIMIT 1",
        [req.user.email]
      );
      if (byEmail.rows[0]?.id != null) {
        resolvedUserId = String(byEmail.rows[0].id);
      }
      if (byEmail.rows[0]?.org_id != null) {
        orgId = Number(byEmail.rows[0].org_id);
      }
    }

    if (orgId == null && resolvedUserId) {
      const byId = await pool.query(
        "SELECT org_id FROM public.userdata WHERE id = $1 LIMIT 1",
        [resolvedUserId]
      );
      if (byId.rows[0]?.org_id != null) {
        orgId = Number(byId.rows[0].org_id);
      }
    }

    if (orgId != null && Number.isFinite(orgId)) {
      const { rows: [orgRow] } = await pool.query(
        "SELECT name FROM public.organizations WHERE id = $1 LIMIT 1",
        [orgId]
      );
      if (typeof orgRow?.name === "string" && orgRow.name.trim()) {
        organizationName = orgRow.name.trim();
      }

      const summary = await getRatingsSummary({ orgId, limit: 20 });
      const count = Number(summary?.sampleSize) || 0;
      const hasRatings = count > 0 && Number.isFinite(Number(summary?.kindnessRating));
      const value = hasRatings ? Number(summary.kindnessRating) : 5;
      const starsFilled = Math.max(1, Math.min(5, Math.round(value)));
      orgRating.orgId = orgId;
      orgRating.value = value;
      orgRating.count = count;
      orgRating.hasRatings = hasRatings;
      orgRating.starsFilled = starsFilled;
    }
  } catch (error) {
    console.warn("[org-portal] org context lookup failed:", error?.message || error);
  }

  res.render("org-portal", { assetTag, user: req.user, orgRating, organizationName });
});

app.get("/donate", ensureAuthenticated, (req, res) => {
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);
  res.render("donate", { title: "Donate", assetTag });
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

app.get("/how-it-works", (req, res) => {
  const assetTag = process.env.ASSET_TAG ?? Date.now().toString(36);
  res.render("how-it-works", { assetTag });
});

async function renderIndexPage(req, res, next) {
  try {
    const success      = req.query.success === "1";
    const loginSuccess = req.query.login   === "1";
    const name         = req.query.name   || "";
    const title        = "Home";

    let dbTime = null;
    try {
      const result = await pool.query("SELECT NOW()");
      dbTime = result.rows[0].now;
    } catch (dbErr) {
      console.error("Error querying Postgres in GET '/' route:", dbErr);
      dbTime = null;
    }

    let chatHistory = [];
    if (req.session && req.session.threadId) {
      const thread = await openai.beta.threads.retrieve(req.session.threadId);
      chatHistory = Array.isArray(thread.messages) ? thread.messages : [];
    }

    const threadId = (req.session && req.session.threadId) || "";
    const isNewUser = chatHistory.length === 0;
    const onboardingDone = req.cookies && req.cookies.onboarding_done === "1";

    return res.render("index", {
      title,
      success,
      loginSuccess,
      name,
      chatHistory,
      threadId,
      dbTime,
      isNewUser,
      onboardingDone
    });
  } catch (err) {
    return next(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 15) Updated Home Route (with DB time check and chat-history logic)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/", async (req, res, next) => {
  const isAuthenticated = req.isAuthenticated && req.isAuthenticated();
  if (isAuthenticated) {
    const showOnboarding =
      (req.session && req.session.showOnboarding) ||
      (req.user && req.user.has_seen_onboarding === false);
    if (showOnboarding) {
      if (req.session) {
        req.session.showOnboarding = false;
      }
      return renderIndexPage(req, res, next);
    }
    return res.redirect("/dashboard");
  }
  return renderIndexPage(req, res, next);
});

app.get("/home", renderIndexPage);

// ─────────────────────────────────────────────────────────────────────────────
// 16) OAuth Callback Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (req, res, next) => {
    try {
      const needsOnboarding = req.user && req.user.has_seen_onboarding === false;
      if (needsOnboarding && req.user.id) {
        const { rows: [updatedUser] } = await pool.query(
          "UPDATE userdata SET has_seen_onboarding = TRUE WHERE id = $1 RETURNING *",
          [req.user.id]
        );
        if (updatedUser) {
          req.user = updatedUser;
        } else if (req.user) {
          req.user.has_seen_onboarding = true;
        }
        if (req.session) {
          req.session.showOnboarding = true;
        }
      }
      if (req.session && req.session.showOnboarding) {
        const displayName =
          (req.user && (req.user.firstname || req.user.email)) || "";
        return req.session.save(() =>
          res.redirect(`/?login=1&name=${encodeURIComponent(displayName)}`)
        );
      }
      return res.redirect("/dashboard");
    } catch (err) {
      return next(err);
    }
  }
);

app.get("/auth/facebook", passport.authenticate("facebook", { scope: ["email"] }));
app.get("/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  async (req, res, next) => {
    try {
      const needsOnboarding = req.user && req.user.has_seen_onboarding === false;
      if (needsOnboarding && req.user.id) {
        const { rows: [updatedUser] } = await pool.query(
          "UPDATE userdata SET has_seen_onboarding = TRUE WHERE id = $1 RETURNING *",
          [req.user.id]
        );
        if (updatedUser) {
          req.user = updatedUser;
        } else if (req.user) {
          req.user.has_seen_onboarding = true;
        }
        if (req.session) {
          req.session.showOnboarding = true;
        }
      }
      if (req.session && req.session.showOnboarding) {
        const displayName =
          (req.user && (req.user.firstname || req.user.email)) || "";
        return req.session.save(() =>
          res.redirect(`/?login=1&name=${encodeURIComponent(displayName)}`)
        );
      }
      return res.redirect("/dashboard");
    } catch (err) {
      return next(err);
    }
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
    const combinedContext = userContext || context || null;

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
    let promptContent = msg;
    if (combinedContext && typeof combinedContext === 'object' && Object.keys(combinedContext).length) {
      try {
        promptContent = `User Context: ${JSON.stringify(combinedContext)}\n\nUser Message: ${msg}`;
      } catch (contextErr) {
        console.error('Failed to serialize guest userContext:', contextErr);
      }
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: GUEST_SYSTEM_PROMPT },
        { role: "user", content: promptContent }
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
  ensureAdminApi,
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
  ensureAdminApi,
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
app.post('/admin/graph/backfill', ensureAuthenticatedApi, ensureAdminApi, async (req, res) => {
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
// Onboarding completion endpoint.
//  - Always sets onboarding_done cookie (as today)
//  - If logged in (req.user.email) AND answers are present, persist to `userdata`
app.post("/api/onboarding/complete", async (req, res) => {
  // keep current cookie behavior
  res.cookie("onboarding_done", "1", {
    path: "/",
    maxAge: 1000 * 60 * 60 * 24 * 365,
    httpOnly: false,             // client reads it
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const email = req.user?.email; // /profile already relies on this being set when logged in
  const raw = (req.body && typeof req.body === "object") ? (req.body.answers || {}) : {};

  // If not logged in or no answers, just return OK (cookie-only)
  if (!email || !raw || Object.keys(raw).length === 0) {
    return res.json({ ok: true, persisted: false });
  }

  // Normalize both payload shapes:
  //  - Direct wizard POST: { answers: { whyFriend, knownConnection, outcome, timeCommitment, age, interests[] } }
  //  - Post-login flush:   { answers: { why_friend, known_connection, desired_outcome, hours_per_week, age_bracket, interest1..3 } }
  const take = (...vals) => {
    for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    return null;
  };
  const toIntOrNull = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
    };

  const interestsArray = Array.isArray(raw.interests)
    ? raw.interests.map(String).map(s => s.trim()).filter(Boolean)
    : [];

  const normalized = {
    why_friend:       take(raw.why_friend,      raw.whyFriend),
    known_connection: take(raw.known_connection,raw.knownConnection),
    desired_outcome:  take(raw.desired_outcome, raw.outcome),
    hours_per_week:   toIntOrNull(take(raw.hours_per_week, raw.timeCommitment)),
    age_bracket:      take(raw.age_bracket,     raw.age),

    // Prefer explicit interest1..3 if provided by the flush script; else fall back to interests[0..2]
    interest1: take(raw.interest1, interestsArray[0] || ""),
    interest2: take(raw.interest2, interestsArray[1] || ""),
    interest3: take(raw.interest3, interestsArray[2] || ""),
  };

  try {
    await pool.query("BEGIN");

    // First try to update an existing row for this email
    const upd = await pool.query(
      `
      UPDATE userdata
         SET why_friend       = $1,
             known_connection = $2,
             desired_outcome  = $3,
             hours_per_week   = $4,
             age_bracket      = $5,
             interest1        = COALESCE(NULLIF($6, ''), interest1),
             interest2        = COALESCE(NULLIF($7, ''), interest2),
             interest3        = COALESCE(NULLIF($8, ''), interest3)
       WHERE email = $9
      `,
      [
        normalized.why_friend,
        normalized.known_connection,
        normalized.desired_outcome,
        normalized.hours_per_week,
        normalized.age_bracket,
        normalized.interest1 || "",
        normalized.interest2 || "",
        normalized.interest3 || "",
        email,
      ]
    );

    // If no row exists yet, insert a minimal one
    if (upd.rowCount === 0) {
      await pool.query(
        `
        INSERT INTO userdata
          (email, why_friend, known_connection, desired_outcome, hours_per_week, age_bracket, interest1, interest2, interest3)
        VALUES ($1,    $2,         $3,              $4,              $5,            $6,          $7,        $8,        $9)
        `,
        [
          email,
          normalized.why_friend,
          normalized.known_connection,
          normalized.desired_outcome,
          normalized.hours_per_week,
          normalized.age_bracket,
          normalized.interment1 || "", // typo fix below
          normalized.interest2 || "",
          normalized.interest3 || "",
        ]
      );
    }

    await pool.query("COMMIT");
    return res.json({ ok: true, persisted: true });
  } catch (e) {
    await pool.query("ROLLBACK");
    console.error("POST /api/onboarding/complete persist error:", e);
    return res.status(500).json({ ok: false, error: "persist_failed" });
  }
});

// Friendship Energy self-assessment
app.post("/api/friendship-energy", ensureAuthenticatedApi, async (req, res) => {
  try {
    const expectedCsrf = req.session?.csrfToken;
    const providedCsrf = req.get(CSRF_HEADER_NAME);
    if (!expectedCsrf || !providedCsrf || providedCsrf !== expectedCsrf) {
      return res.status(403).json({ ok: false, error: "invalid csrf token" });
    }

    const email = req.user?.email;
    if (!email) return res.status(401).json({ ok: false, error: "not authenticated" });

    const { rows: [userRow] } = await pool.query(
      "SELECT id FROM public.userdata WHERE email=$1",
      [email]
    );
    if (!userRow) return res.status(400).json({ ok: false, error: "user not found" });
    const userId = userRow.id;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.friendship_energy (
        id serial PRIMARY KEY,
        user_id integer REFERENCES public.userdata(id) ON DELETE CASCADE,
        answers jsonb,
        skills jsonb,
        archetypes jsonb,
        ladder jsonb,
        growth_edges jsonb,
        strengths jsonb,
        stuck_transitions jsonb,
        completed_at timestamptz DEFAULT now()
      );
    `);

    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const completedAt = body.completedAt && typeof body.completedAt === "string"
      ? body.completedAt
      : new Date().toISOString();

    // Ensure all JSON payloads are valid JSON (strip functions/undefined)
    const toJson = (val, fallback) => {
      try {
        const clean = JSON.parse(JSON.stringify(val ?? fallback));
        return clean;
      } catch {
        return fallback;
      }
    };
    const answers = toJson(body.answers, {});
    const skillsPayload = toJson(body.skills, {});
    const archetypesPayload = toJson(body.archetypes, {});
    const ladderPayload = toJson(body.ladderSnapshot, {});
    const growthPayload = toJson(body.growthEdges, []);
    const strengthsPayload = toJson(body.strengths, []);
    const stuckPayload = toJson(body.stuckTransitions, []);

    const insert = await pool.query(
      `
      INSERT INTO public.friendship_energy
        (user_id, answers, skills, archetypes, ladder, growth_edges, strengths, stuck_transitions, completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id;
      `,
      [
        userId,
        JSON.stringify(answers),
        JSON.stringify(skillsPayload),
        JSON.stringify(archetypesPayload),
        JSON.stringify(ladderPayload),
        JSON.stringify(growthPayload),
        JSON.stringify(strengthsPayload),
        JSON.stringify(stuckPayload),
        completedAt,
      ]
    );

    // Update profile "friendship type" using the primary archetype label from payload
    const primaryArchetype =
      Array.isArray(body?.archetypes?.main) && body.archetypes.main.length
        ? body.archetypes.main[0]
        : null;
    const primaryLabel =
      (primaryArchetype && typeof primaryArchetype.label === "string" && primaryArchetype.label.trim()) ||
      (primaryArchetype && typeof primaryArchetype.code === "string" && primaryArchetype.code.trim()) ||
      null;
    if (primaryLabel) {
      try {
        await pool.query(
          `UPDATE userdata SET kindness_style = $1 WHERE id = $2`,
          [primaryLabel, userId]
        );
      } catch (updateErr) {
        console.warn("Could not update friendship type on profile:", updateErr.message || updateErr);
      }
    }

    return res.json({ ok: true, id: insert.rows[0].id });
  } catch (e) {
    console.error("POST /api/friendship-energy error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
