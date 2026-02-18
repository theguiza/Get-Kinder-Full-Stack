# Get Kinder Website Technical Report (for Codex)

As of: February 17, 2026  
Codebase root: `Get-Kinder-Full-Stack-Deploy`

## 1) System Snapshot

Get Kinder is a Node/Express monolith that serves:

- Server-rendered EJS pages
- JSON APIs for product features
- React "islands" mounted inside selected EJS pages via a single Vite bundle
- Session-based auth (Passport + PostgreSQL session store)
- AI chat endpoints (OpenAI Chat Completions + Assistants API)
- Event verification and donor-attribution flows tied to wallet/funding-pool ledgers

Primary runtime entrypoint:

- `index.js`

## 2) Stack and Runtime

Backend:

- Node.js + Express 5 (`package.json`)
- EJS view engine (`index.js`)
- PostgreSQL (`Backend/db/pg.js`)
- Neo4j for graph features (`Backend/db/neo4j.js`)
- Passport auth (local + Google + Facebook) (`index.js`)
- Session store in Postgres via `connect-pg-simple` (`index.js`)

Frontend:

- EJS templates in `views/`
- Global CSS in `public/css/style.css`
- Page CSS in `public/css/how-it-works.css` for `/how-it-works`
- React 19 bundle produced by Vite to `public/js/bundles/entry.js` (`vite.config.mjs`)

Core third-party integrations:

- OpenAI (`index.js`, `Backend/assistant.js`)
- Square payments/webhooks (`controllers/squareWebhooksController.js`, `services/*square*`)
- SMTP email sending (`kindnessEmailer.js`)
- Bootstrap + Font Awesome loaded via CDN in most views

## 3) Server Architecture

### 3.1 Global middleware order (`index.js`)

1. `cookieParser()`
2. `cors()` (called twice; duplicate)
3. `express.json()` with raw-body capture for webhook signature verification
4. `express.urlencoded({ extended: false })`
5. `express-session` with Postgres store (`user_session`)
6. `passport.initialize()` and `passport.session()`
7. `express.static("public")`
8. Mounted routers (`/api/...`, `/internal/quiz`, etc.)
9. `res.locals.user` injection
10. Custom CSRF token generation on session (`req.csrfToken`, `res.locals.csrfToken`)
11. EJS view engine configuration

### 3.2 Auth model

- Session cookie auth (`express-session`)
- Passport strategies:
  - Local email/password (`/login`, `/register`)
  - Google OAuth (`/auth/google`, callback)
  - Facebook OAuth (`/auth/facebook`, callback)
- Auth helpers:
  - `ensureAuthenticated`: redirects to `/login`
  - `ensureAuthenticatedApi`: returns `401 { error: "unauthorized" }`
  - `ensureAdmin`: checks `ADMIN_EMAILS`

### 3.3 CSRF model

- Custom per-session token is generated and stored at `req.session.csrfToken`
- Exposed to templates as `csrfToken`
- Verified on key state-changing routes using header `X-CSRF-Token`
- Not all POST endpoints enforce CSRF; coverage is selective

## 4) Rendering Model (Important for New Pages)

There are two UI composition patterns:

### Pattern A: Pure EJS page

Used by pages like `how-it-works`, `about`, `blog`, `privacy`, etc.

Common structure:

- Bootstrap and Font Awesome CDN links
- `<link rel="stylesheet" href="/css/style.css">`
- Shared header partial:
  - `<%- include("partials/site-header", { currentPage: "..." }) %>`
- Optional page-specific stylesheet with `assetTag` query string cache-bust
- Inline scripts for page-specific behavior

### Pattern B: EJS shell + React island(s)

Used by pages like `dashboard`, `events`, `donor`, `donate`, `friendQuiz`.

Common structure:

- EJS lays out header/footer and mount `<div>` targets
- Optional JSON props embedded in `<script type="application/json" id="...">`
- Load `entry.js` bundle:
  - `/js/bundles/entry.js?<%= assetTag %>`
- Call `window.renderXxx(...)` helper exposed by `frontend/entry.jsx`

This is the preferred approach for interactive new product surfaces.

## 5) Navigation and Shared Layout

Primary header partial:

- `views/partials/site-header.ejs`

`currentPage` controls nav behavior and active state. Existing keys:

- `home`
- `how-it-works`
- `events`
- `dashboard`
- `profile`
- `donor`
- `donate`
- `other`

If you add a new top-level page, update:

- Route in `index.js`
- Header nav items in `views/partials/site-header.ejs` (if it should appear in nav)
- Footer links if needed

## 6) Key Page Routes

Defined in `index.js`:

- `/`, `/home` -> `index.ejs`
- `/dashboard` (auth) -> `dashboard.ejs`
- `/events` (auth) -> `events.ejs` via `getEventsPage` (`routes/eventsPage.js`)
- `/profile` (auth) -> `profile.ejs`
- `/donor` (auth) -> `donor.ejs`
- `/donate` (auth) -> `donate.ejs`
- `/how-it-works` -> `how-it-works.ejs`
- `/about`, `/blog`, `/contact`, `/privacy`, `/terms`, `/accessability`
- `/friend-quiz` and `/friendQuiz` -> `friendQuiz.ejs`
- `/login`, `/register`, `/logout`

## 7) API Surface (Primary)

Mounted in `index.js`:

- `/api/events` (auth) -> CRUD, RSVP, check-in, verify, roster, calendar
- `/api/invites` (auth)
- `/api/me/events` (auth) -> host event + pool summary/transactions/topups
- `/api/me/contacts` (auth)
- `/api/carousel` (auth)
- `/api/wallet` (auth)
- `/api/ratings` (auth)
- `/api/redemptions` (auth)
- `/api/donations` (auth)
- `/api/donor` (auth) -> summary + receipts
- `/api/webhooks/square` (public webhook endpoint)
- `/api/chat/*` and `/kai-chat*` (chat endpoints)
- `/api/friends`, `/api/arcs/*`, `/api/friendship-energy`, onboarding endpoints

## 8) Core Product Flows

### 8.1 Volunteer events flow

1. Host creates event (`POST /api/events`)
2. People RSVP (`POST /api/events/:id/rsvp`)
3. Accepted attendees check in (`POST /api/events/:id/checkins`)
4. Host verifies attendance (`POST /api/events/:id/verify`)
5. Verification triggers funding pipeline:
   - Wallet earn-shift credit (`wallet_transactions`)
   - Pool debit (`pool_transactions`, reason `shift_out`)
   - Donor receipt attribution (`donor_receipts`)

Main implementation:

- `controllers/eventsApiController.js` (`verifyEventRsvp`)
- `services/earnShiftFundingService.js`

### 8.2 Donor funding flow

Donation sources:

- Manual donation API (admin-gated in production)
- Square confirmation endpoint
- Square webhook ingestion

Pipeline:

- Donation recorded in `donations`
- Credits added to a funding pool in `pool_transactions` (`donation_in`)
- Later consumed by verified shifts and traced in donor receipts

Main files:

- `controllers/donationsApiController.js`
- `controllers/squareWebhooksController.js`
- `services/donationsService.js`
- `services/squareWebhooksService.js`

### 8.3 Friendship quiz + arcs flow

- Friend assessment writes to Postgres friends table (`/api/friends`)
- Generates friend arc plans (`generateArcForQuiz`)
- Mirrors assessment snapshot to Neo4j for graph features
- Arc progression APIs under `/api/arcs/...` award points and update state

Main files:

- `index.js` (`/api/friends`)
- `services/ArcGenerator.js`
- `routes/arcsApi.js`

### 8.4 AI chat flow

Public unified endpoint:

- `POST /api/chat/message`
- Authed users: Assistants API + server tools
- Guests: Chat Completions with constrained system prompt

Additional endpoints:

- `POST /kai-chat` (auth)
- `POST /kai-chat/stream` (auth, SSE)
- `POST /chat` (tool-call path for legacy function schema)

Main files:

- `index.js`
- `Backend/assistant.js`
- `openaiFunctions.js`

## 9) Data Stores and Key Tables in Active Use

Postgres tables used heavily by runtime code:

- `userdata`
- `user_session`
- `friends`
- `friend_arcs`
- `events`
- `event_rsvps`
- `invites`
- `wallet_transactions`
- `funding_pools`
- `pool_transactions`
- `donations`
- `donor_receipts`
- `nudges_outbox`
- `friendship_energy` (created lazily by endpoint if missing)

Neo4j entities used:

- `User`, `Person`, `Assessment`, `Observation`, `Archetype`, `Flag`

## 10) Frontend Styling and Visual Conventions

Current brand colors used broadly:

- Coral/red: `#ff5656`
- Ink blue: `#455a7c`

Global visual conventions:

- Fixed top navbar; many pages add top padding to clear header
- Bootstrap components + custom classes
- Shared gradient footer section with social links
- Font Awesome iconography

For a new page to feel native:

- Include shared header partial
- Use `/css/style.css` and existing color tokens
- Maintain Bootstrap spacing patterns (`container`, `row`, `col-*`)
- Keep footer style consistent with existing public pages

## 11) Build and Deployment Notes

Build:

- Vite builds one bundle (`frontend/entry.jsx`) into `public/js/bundles/entry.js`
- `npm run build`

Start:

- `npm start` runs prestart `backfill:surprises` stub, then starts `index.js`

Containerization:

- `Dockerfile` runs `npm install --only=production` and `npm start`
- `docker-compose.yml` provides local Postgres + app service

## 12) Known Implementation Gaps / Risks (Important for Accurate Prompting)

1. `index.js` references `DASHBOARD_TOOLS` before import when defining `CHAT_COMPLETIONS_TOOLS`; this is fragile and should be reviewed.
2. Duplicate middleware call `app.use(cors())`.
3. Onboarding insert path has a typo `normalized.interment1` (likely intended `interest1`) in `/api/onboarding/complete`.
4. Mixed legacy and current client scripts exist (`public/js/dashboard.js` references endpoints currently commented out in server).
5. Some templates use relative links (`href="events"`) while others use absolute (`/events`).

These are existing code realities; do not "normalize away" in generated changes unless explicitly requested.

## 13) New Page Integration Blueprint (Use This)

### Option A: Server-rendered EJS page (recommended for mostly static marketing content)

1. Add route in `index.js`:
   - `app.get("/new-page", (req, res) => { const assetTag = ...; res.render("new-page", { assetTag }); });`
2. Create `views/new-page.ejs`
3. Include:
   - Header partial with correct `currentPage`
   - Shared CSS + optional page CSS
   - Footer pattern used by `how-it-works.ejs` or `about.ejs`
4. Add CSS file in `public/css/new-page.css` if needed
5. If nav item needed, update `views/partials/site-header.ejs`

### Option B: EJS + React island page (recommended for interactive product surface)

1. Add route in `index.js` and render `views/new-page.ejs` with `assetTag`
2. Add mount div in EJS, e.g. `<div id="new-page-root"></div>`
3. Add React component in `frontend/newPage.jsx`
4. Export window mount helper in `frontend/entry.jsx`, e.g. `window.renderNewPage`
5. In EJS:
   - load `/js/bundles/entry.js?<%= assetTag %>`
   - call `window.renderNewPage("#new-page-root", props)`
6. Run `npm run build`

## 14) Prompt Package for Codex (Copy/Paste)

Use this exact prompt to generate a native-aligned page:

```text
You are editing the Get Kinder codebase (Node/Express + EJS + React islands).
Follow existing project conventions exactly.

Goal:
- Create a new page at route /<ROUTE_SLUG> with title "<PAGE_TITLE>".
- Make it visually and structurally consistent with existing pages (especially how-it-works, dashboard, donor, donate).

Hard requirements:
1) Keep header/footer conventions from existing EJS pages.
2) Use existing brand colors (#ff5656 and #455a7c) and /css/style.css.
3) If page is static/marketing: implement as pure EJS + optional page CSS in public/css.
4) If page is interactive: implement as EJS shell + React mount via frontend/entry.jsx and /js/bundles/entry.js.
5) Use current auth conventions:
   - Page route auth if needed: ensureAuthenticated middleware.
   - API auth if needed: ensureAuthenticatedApi.
   - CSRF for state-changing calls using X-CSRF-Token from meta/session patterns.
6) Wire route in index.js and nav entry in views/partials/site-header.ejs only if requested.
7) Do not refactor unrelated files.

Project facts to respect:
- Server entry: index.js
- View engine: EJS
- Static dir: /public
- Main bundle: frontend/entry.jsx -> public/js/bundles/entry.js
- Existing pages use Bootstrap CDN + Font Awesome + style.css

Deliverables:
- All code changes
- Short summary of files changed
- Quick verification steps
```

## 15) Fast Validation Checklist for Any New Page

- Route returns `200` and renders expected EJS
- Header displays correctly and nav collapse still works
- Footer matches existing site style
- Mobile spacing works under fixed navbar
- If React island is used: mount function exists on `window` and runs once
- Any POST endpoint uses auth + CSRF where applicable
- `npm run build` succeeds if frontend changed

