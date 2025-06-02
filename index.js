// index.js

// ─────────────────────────────────────────────────────────────────────────────
// ES Module version (package.json includes "type": "module")
// ─────────────────────────────────────────────────────────────────────────────

// 1) Load environment variables
import dotenv from "dotenv";
dotenv.config();

// 2) Import dependencies via ES module syntax
import express from "express";
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { createThread, createMessage, createAndPollRun, listMessages } from "./Backend/assistant.js";
import OpenAI from "openai";
import connectPgSimple from "connect-pg-simple";

// 3) Compute __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 4) Initialize Express application
const app = express();

// 5) Determine port (Render/Docker set process.env.PORT; fallback to 5001)
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5001;

// 6) Configure PostgreSQL connection with a single Pool instance - 
let pool;

if (process.env.DATABASE_URL) {
  // === Running on Render.com ===
  // Use the single DATABASE_URL that Render provides; enable SSL with rejectUnauthorized: false
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  // === Local / Docker setup ===
  pool = new Pool({
    user:     process.env.DB_USER     || "postgres",
    host:     process.env.DB_HOST     || "postgres",
    database: process.env.DB_NAME     || "my_local_db",
    password: process.env.DB_PASSWORD || "postgres",
    port:     process.env.DB_PORT
               ? parseInt(process.env.DB_PORT, 10)
               : 5432
  });
}
// Immediately test the database connection (optional)
await pool.connect()
  .then(() => console.log("🌐 Connected to Postgres successfully."))
  .catch(err => console.error("‼️  Error connecting to Postgres:", err));

// 7) Compute rootPath if needed for static files
//const rootPath = __dirname;
//const rootPath = path.join(__dirname, "../");

// 8) Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PgSession = connectPgSimple(session);

// 9) Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new PgSession({
      pool: pool,                // ← use your existing Pool instance
      tableName: "user_session", // ← name of the table in Postgres
      // You can omit “tableName” entirely; default is “session”
      // If the table does not exist, connect-pg-simple will create it.
    }),
    secret: process.env.SESSION_SECRET || "default_secret",
    resave: false,              // recommended: false
    saveUninitialized: false,   // recommended: false
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      secure: process.env.NODE_ENV === "production", // only send cookie over HTTPS in prod
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
app.post("/profile", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }

  // Now we are also expecting `picture` from the form (e.g. a URL or some upload handler)
  const {
    firstname, lastname, email, phone,
    address1, address2, city, state, country,
    interest1, interest2, interest3,
    sdg1, sdg2, sdg3,
    picture   // <— newly added field from your profile form
  } = req.body;

  try {
    await pool.query(
      `UPDATE userdata
         SET 
           firstname = $1,
           lastname  = $2,
           email     = $3,
           phone     = $4,
           address1  = $5,
           address2  = $6,
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
       WHERE email = $3`,
      [
        firstname, lastname, email, phone,
        address1, address2, city, state, country,
        interest1, interest2, interest3,
        sdg1, sdg2, sdg3,
        picture        // <— include picture as $16
      ]
    );

    // Update session user object so res.locals.user is fresh.
    req.user = {
      ...req.user,
      firstname, lastname, email, phone,
      address1, address2, city, state, country,
      interest1, interest2, interest3,
      sdg1, sdg2, sdg3,
      picture        // <— reflect new picture URL
    };

    return res.redirect("/profile");
  } catch (err) {
    console.error("Error updating profile:", err);
    return res.status(500).send("Error updating profile");
  }
});

// 13.4) View Profile Route
app.get("/profile", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }
  try {
    const result = await pool.query(
      "SELECT * FROM userdata WHERE email = $1",
      [req.user.email]
    );
    if (result.rows.length === 0) {
      return res.redirect("/login");
    }
    res.render("profile", {
      title: "User Profile",
      user: result.rows[0]
    });
  } catch (err) {
    console.error("Profile DB error:", err);
    res.status(500).send("Error loading profile.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 14) Static Content Pages
// ─────────────────────────────────────────────────────────────────────────────
app.get("/about",   (req, res) => res.render("about",   { title: "About Us" }));
app.get("/contact", (req, res) => res.render("contact", { title: "Contact Us" }));
app.get("/accessability", (req, res) => res.render("accessability", { title: "Accessibility" }));
app.get("/privacy",      (req, res) => res.render("privacy",      { title: "Privacy Policy" }));
app.get("/terms",        (req, res) => res.render("terms",        { title: "Terms of Service" }));

// 14.1) Login and Register pages (GET)
app.get("/login",    (req, res) => res.render("login",    { title: "Log In",     facebookAppId: process.env.FACEBOOK_APP_ID }));
app.get("/register", (req, res) => res.render("register", { title: "Sign Up" }));

// ─────────────────────────────────────────────────────────────────────────────
// 15) Updated Home Route (with DB time check and chat-history logic)
// ─────────────────────────────────────────────────────────────────────────────
app.get("/", async (req, res, next) => {
  try {
    // A) Existing query-param logic
    const success      = req.query.success === "1";   // registration success
    const loginSuccess = req.query.login   === "1";   // login success
    const name         = req.query.name   || "";      // user’s name/email

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
    let chatHistory = [];
    if (req.session && req.session.threadId) {
      const thread = await openai.beta.threads.retrieve(req.session.threadId);
      chatHistory = Array.isArray(thread.messages) ? thread.messages : [];
    }
    const threadId = (req.session && req.session.threadId) || "";

    // D) Render index.ejs with all variables
    return res.render("index", {
      title:        "Home",
      success,
      loginSuccess,
      name,
      chatHistory,
      threadId,
      dbTime
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

app.post('/api/chat/message', async (req, res) => {
  try {
    if (!req.session.threadId) {
      const thread = await createThread();
      req.session.threadId = thread.id;
    }
    const threadId = req.session.threadId;
    const userMessage = req.body.message;
    await createMessage(threadId, userMessage);
    await createAndPollRun(threadId);
    const messages = await listMessages(threadId);
    const lastMessage = messages.data.find(m => m.role === 'assistant');
    const reply = lastMessage ? lastMessage.content[0].text.value : "(No reply)";
    res.json({ reply });
  } catch (err) {
    console.error("Error in /api/chat/message:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 18) Start the server
// ─────────────────────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`App running on port ${port}`);
});
