import express from "express";
import path from "path";
import { dirname} from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";
import bcrypt from 'bcrypt';
import session from 'express-session'; 
import passport from 'passport';
import cors from 'cors';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from "passport-facebook"; 
import { createThread, createMessage, createAndPollRun, listMessages } from './assistant.js';
import OpenAI from "openai";

const hashedPassword = await bcrypt.hash("userInputPassword", 10); 
dotenv.config(); 
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootPath = path.join(__dirname, "../");
const apiKey = process.env.OPENAI_API_KEY;
const app = express();
const port = 5001; 

const openai = new OpenAI();
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(cors({
  origin: 'http://localhost:5001', // ← your frontend URL (adjust if needed)
  credentials: true                // ← this allows cookies to be sent across origins
}));

app.use(session({
  secret: process.env.SESSION_SECRET || "default_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(rootPath, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
  res.locals.user = req.user; // Makes `user` accessible in all EJS templates
  next();
});
const db = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
}); 

db.connect();

db.query("SELECT * FROM userdata", (err, res) => {
  if (err) {
    console.error("Error connecting to the database", err);
  } else {
    console.log("Connected to the database", res.rows[0]);
  }
});

app.post("/login", async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const result = await db.query("SELECT * FROM userdata WHERE email = $1", [email]);
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

    // ✅ THIS is the key: login the user into the session
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect(`/?login=1&name=${encodeURIComponent(user.firstname || user.email)}`);
    });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).send("Internal server error");
  }
});

app.post("/register", async (req, res, next) => {
  const { firstname, lastname, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      "INSERT INTO userdata (firstname, lastname, email, password) VALUES ($1, $2, $3, $4) RETURNING *",
      [firstname, lastname, email, hashedPassword]
    );
    const newUser = result.rows[0];

    req.login(newUser, (err) => {
      if (err) return next(err);
      res.redirect(`/?login=1&name=${encodeURIComponent(newUser.firstname)}`);
    });
  } catch (err) {
    console.error("Registration error:", err.message);
    res.status(500).send("Error registering user");
  }
});

app.post("/profile", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }
  const {
    firstname,
    lastname,
    email,
    phone,
    address1,
    address2,
    city,
    state,
    country,
    interest1,
    interest2,
    interest3,
    sdg1,
    sdg2,
    sdg3
  } = req.body;
  try {
    await db.query(
      `UPDATE userdata
       SET firstname = $1, lastname = $2, email = $3, phone = $4,
           address1 = $5, address2 = $6, city = $7, state = $8, country = $9,
           interest1 = $10, interest2 = $11, interest3 = $12,
           sdg1 = $13, sdg2 = $14, sdg3 = $15
       WHERE email = $3`,
      [firstname, lastname, email, phone, address1, address2, city, state, country, interest1, interest2, interest3, sdg1, sdg2, sdg3]
    );
    // Update session user
    req.user = {
      ...req.user,
      firstname,
      lastname,
      email,
      phone,
      address1,
      address2,
      city,
      state,
      country,
      interest1,
      interest2,
      interest3,
      sdg1,
      sdg2,
      sdg3
    };

    res.redirect("/profile");
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).send("Error updating profile");
  }
});

// app.set('trust proxy', 1); // if behind reverse proxy like Heroku or Vercel

app.set("view engine", "ejs");
app.set("views", path.join(rootPath, "views")); // or wherever you store your .ejs files

// === Updated home route ===
app.get("/", async (req, res, next) => {
  try {
    // ▶️ existing logic
    const success      = req.query.success === "1";  // registration success
    const loginSuccess = req.query.login   === "1";  // login success
    const name         = req.query.name;            // user's name
    
    // ▶️ new chat-history logic
    let chatHistory = [];
    if (req.session && req.session.threadId) {
      const thread = await openai.beta.threads.retrieve(req.session.threadId);
      chatHistory = Array.isArray(thread.messages)
        ? thread.messages
        : [];
    }
    const threadId = (req.session && req.session.threadId) || "";
    
    // ▶️ render everything to your template
    res.render("index", {
      title:        "Home",
      success,
      loginSuccess,
      name,
      
      // our additions:
      chatHistory,
      threadId
    });
    
  } catch (err) {
    next(err);
  }
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] })); 

app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // Successful authentication, redirect home.
    res.redirect(`/?login=1&name=${encodeURIComponent(req.user.displayName)}`);
  }
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).send("Error logging out");
    }
    res.redirect("/?login=0");
  });
}
);

app.get("/about", (req, res) => {
  res.render("about", { title: "About Us" });
});

app.get("/contact", (req, res) => {
  res.render("contact", { title: "Contact Us" });
});

app.get("/accessability", (req, res) => {
  res.render("accessability", { title: "Accessability" });
});

app.get("/privacy", (req, res) => {
  res.render("privacy", { title: "Terms of Privacy" });
});

app.get("/terms", (req, res) => {
  res.render("terms", { title: "Terms of Service" });
});

app.get("/login", (req, res) => {
  res.render("login", {
    title: "Log In",
    facebookAppId: process.env.FACEBOOK_APP_ID
  });
});

app.get("/register", (req, res) => {
  res.render("register", { title: "Sign Up" });
});

app.get("/profile", async (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }
  try {
    const result = await db.query("SELECT * FROM userdata WHERE email = $1", [req.user.email]);
    if (result.rows.length === 0) {
      return res.redirect("/login");
    }
    const userFromDb = result.rows[0];
    res.render("profile", {
      title: "User Profile",
      user: userFromDb
    });
  } catch (err) {
    console.error("Profile DB error:", err);
    res.status(500).send("Error loading profile.");
  }
});

app.get('/api/chat/init', async (req, res) => {
  const thread = await createThread();
  res.json({ thread_id: thread.id });
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
    console.error("🔥 Error in /api/chat/message:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID,
  clientSecret: process.env.FACEBOOK_APP_SECRET,
  callbackURL: "http://localhost:5001/auth/facebook/callback", // production = "https://getkinder.ai/auth/facebook/callback" ... change at facebook too!
  profileFields: ['id', 'emails', 'name', 'picture.type(large)']
}, async (accessToken, refreshToken, profile, cb) => {
  try {
    const email = profile.emails?.[0]?.value;
    const firstname = profile.name?.givenName || '';
    const lastname = profile.name?.familyName || '';
    const facebookId = profile.id;
    const picture = profile.photos?.[0]?.value;

    // Check if user exists
    const result = await db.query("SELECT * FROM userdata WHERE email = $1", [email]);

    let user;
    if (result.rows.length === 0) {
      const insertResult = await db.query(
        "INSERT INTO userdata (firstname, lastname, email, password, facebook_id, picture) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [firstname, lastname, email, null, facebookId, picture]
      );
      user = insertResult.rows[0];
    } else {
      user = result.rows[0];
    }

    return cb(null, user); // 👈 consistent with Google return structure
  } catch (err) {
    console.error("Facebook login error:", err.message);
    return cb(err, null);
  }
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5001/auth/google/callback",
  userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
}, async (accessToken, refreshToken, profile, cb) => {
  try {
    const email = profile.emails?.[0]?.value;
    const nameParts = profile.displayName.split(" ");
    const firstname = nameParts[0];
    const lastname = nameParts.slice(1).join(" ");
    const googleId = profile.id;
    // Check if user exists
    const result = await db.query("SELECT * FROM userdata WHERE email = $1", [email]);

    let user;
    if (result.rows.length === 0) {
const picture = profile.photos?.[0]?.value;

const insertResult = await db.query(
  "INSERT INTO userdata (firstname, lastname, email, password, google_id, picture) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
  [firstname, lastname, email, null, googleId, picture]
);
      user = insertResult.rows[0];
    } else {
      user = result.rows[0];
    }
    return cb(null, user); // 👈 now returns user with email
  } catch (err) {
    console.error("Google login error:", err.message);
    return cb(err, null);
  }
}));

app.get("/auth/facebook", passport.authenticate("facebook", { scope: ["email"] }));

app.get("/auth/facebook/callback", passport.authenticate("facebook", { failureRedirect: "/login" }),
  (req, res) => {
    res.redirect(`/?login=1&name=${encodeURIComponent(req.user.firstname || req.user.email)}`);
  }
);

passport.serializeUser((user, done) => {
  done(null, user.email); // or user.id if you're using a numeric ID
});

passport.deserializeUser(async (email, done) => {
  try {
    const result = await db.query("SELECT * FROM userdata WHERE email = $1", [email]);
    const user = result.rows[0];
    done(null, user || false);
  } catch (err) {
    done(err, null);
  }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}.`);
}); 
