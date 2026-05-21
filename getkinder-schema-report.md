# GetKinder Volunteer Event Lifecycle Schema and Route Report

Generated: 2026-05-04T22:22:50.685Z

Database connection used: same selection logic as `Backend/db/pg.js`; selected source `DATABASE_URL`, host `dpg-d0u9dau3jp1c73fm2tm0-a.oregon-postgres.render.com`, database `get_kinder_db`, user `get_kinder_db_user`, server address `10.31.117.30:5432`, schema `public`.

Samples below use `SELECT * FROM table LIMIT 3`; email addresses, personal identifiers, location/contact fields, secrets, large images, and free-text personal fields are replaced with `[REDACTED]` or truncated.

## Schema

### Table Discovery

- Opportunity table: `public.events` is the table used by route/controller code and database FKs. `public.opportunities` was searched for and was not found.
- RSVP/signup/check-in/attendance table: `public.event_rsvps`. No separate check-ins or attendance table was found.
- Impact credit ledger tables found: `public.wallet_transactions` for volunteer wallet credits, `public.donor_ic_ledger` for donor IC ledger, plus `public.funding_pools`/`public.pool_transactions`/`public.funding_credits` for org funding-credit availability and allocation.
- Scheduling/date/shift storage: `public.events` has event date/time fields; `public.event_roles` and `public.event_role_skills` model role staffing. No recurrence, series, schedule, or shift-named table was found.

Searched table-name patterns:

- opportunities: none
- RSVP/signup/registration: `public.event_rsvps`
- attendance/check-in: none
- attendance: none
- schedule: none
- shift: none
- recurrence: none
- series: none
- Impact Credits/wallet/ledger: `public.donor_ic_ledger`
- wallet: `public.wallet_transactions`
- funding/pool/credit: `public.funding_credits`, `public.pending_credit_requests`
- organization: `public.org_applications`, `public.organizations`, `public.user_org_memberships`
- event: `public.event_package_rollovers`, `public.event_ratings`, `public.event_role_skills`, `public.event_roles`, `public.event_rsvps`, `public.events`

Direct foreign keys to `public.events`:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| donation_allocation_reviews_manual_target_event_id_fkey | manual_target_event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (manual_target_event_id) REFERENCES events(id) ON DELETE SET NULL |
| donor_receipts_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_package_rollovers_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_ratings_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_roles_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_rsvps_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| funding_allocations_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| funding_credits_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| invite_abuse_reports_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| invite_moderation_logs_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| invites_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| pending_credit_requests_event_id_fkey | event_id | public.events(id) | NO ACTION | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) |
| pool_transactions_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| wallet_transactions_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |

### public.userdata

Role: Users/volunteers/org representatives. Personal fields are redacted in samples.

Row count: 499

CREATE TABLE:

```sql
CREATE TABLE "public"."userdata" (
  "id" integer DEFAULT nextval('userdata_id_seq'::regclass) NOT NULL,
  "firstname" character varying(255) NOT NULL,
  "lastname" character varying(255) NOT NULL,
  "email" character varying(255) NOT NULL,
  "password" character varying(255),
  "phone" character varying(50),
  "address1" character varying(255),
  "kindness_style" character varying(255),
  "city" character varying(100),
  "state" character varying(100),
  "country" character varying(100),
  "interest1" character varying(100),
  "interest2" character varying(100),
  "interest3" character varying(100),
  "sdg1" character varying(100),
  "sdg2" character varying(100),
  "sdg3" character varying(100),
  "google_id" character varying(255),
  "facebook_id" character varying(255),
  "picture" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "why_friend" text,
  "known_connection" text,
  "desired_outcome" text,
  "hours_per_week" integer,
  "age_bracket" text,
  "org_rep" boolean DEFAULT false NOT NULL,
  "org_id" integer,
  "availability_weekly" jsonb,
  "availability_exceptions" jsonb,
  "timezone" text,
  "specfifc_availability" jsonb,
  "home_base_lat" double precision,
  "home_base_lng" double precision,
  "home_base_label" text,
  "home_base_source" text,
  "travel_radius_km" integer DEFAULT 5 NOT NULL,
  "travel_mode" text DEFAULT 'transit'::text NOT NULL,
  "reset_password_token_hash" text,
  "reset_password_expires_at" timestamp with time zone,
  "reset_password_sent_at" timestamp with time zone,
  "is_admin" boolean DEFAULT false NOT NULL,
  "is_suspended" boolean DEFAULT false NOT NULL,
  "email_verified" boolean DEFAULT false NOT NULL,
  "email_verification_token_hash" character varying(255),
  "email_verification_expires_at" timestamp without time zone,
  "reliability_score" numeric(5,2),
  "reliability_tier" text,
  "reliability_updated" timestamp with time zone,
  "donor_tier" text DEFAULT 'casual'::text NOT NULL,
  "account_status" text DEFAULT 'active'::text NOT NULL,
  "ghost_added_by" integer,
  "claim_token" text,
  "claim_token_expires_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  CONSTRAINT "userdata_pkey" PRIMARY KEY (id),
  CONSTRAINT "userdata_email_key" UNIQUE (email),
  CONSTRAINT "userdata_ghost_added_by_fkey" FOREIGN KEY (ghost_added_by) REFERENCES userdata(id),
  CONSTRAINT "userdata_donor_tier_check" CHECK (donor_tier = ANY (ARRAY['casual'::text, 'impact'::text, 'champion'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| userdata_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX userdata_pkey ON public.userdata USING btree (id) |
| userdata_email_key | email | yes | btree | CREATE UNIQUE INDEX userdata_email_key ON public.userdata USING btree (email) |
| idx_userdata_reset_password_token_hash | reset_password_token_hash | no | btree | CREATE INDEX idx_userdata_reset_password_token_hash ON public.userdata USING btree (reset_password_token_hash) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| userdata_ghost_added_by_fkey | ghost_added_by | public.userdata(id) | NO ACTION | NO ACTION | FOREIGN KEY (ghost_added_by) REFERENCES userdata(id) |

CHECK constraints:

- `userdata_donor_tier_check`: `CHECK (donor_tier = ANY (ARRAY['casual'::text, 'impact'::text, 'champion'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": 11,
    "firstname": "[REDACTED]",
    "lastname": "[REDACTED]",
    "email": "[REDACTED]",
    "password": "[REDACTED]",
    "phone": "[REDACTED]",
    "address1": "",
    "kindness_style": "",
    "city": "[REDACTED]",
    "state": "[REDACTED]",
    "country": "",
    "interest1": "",
    "interest2": "",
    "interest3": "",
    "sdg1": "1 – No Poverty",
    "sdg2": "2 – Zero Hunger",
    "sdg3": "13 – Climate Action",
    "google_id": null,
    "facebook_id": null,
    "picture": null,
    "created_at": "2025-06-05T18:04:11.180Z",
    "why_friend": null,
    "known_connection": null,
    "desired_outcome": null,
    "hours_per_week": null,
    "age_bracket": null,
    "org_rep": false,
    "org_id": null,
    "availability_weekly": null,
    "availability_exceptions": null,
    "timezone": null,
    "specfifc_availability": null,
    "home_base_lat": null,
    "home_base_lng": null,
    "home_base_label": null,
    "home_base_source": null,
    "travel_radius_km": 5,
    "travel_mode": "transit",
    "reset_password_token_hash": null,
    "reset_password_expires_at": null,
    "reset_password_sent_at": null,
    "is_admin": false,
    "is_suspended": false,
    "email_verified": "[REDACTED]",
    "email_verification_token_hash": null,
    "email_verification_expires_at": null,
    "reliability_score": null,
    "reliability_tier": "new",
    "reliability_updated": "2026-03-10T22:55:28.644Z",
    "donor_tier": "casual",
    "account_status": "active",
    "ghost_added_by": null,
    "claim_token": null,
    "claim_token_expires_at": null,
    "claimed_at": null
  },
  {
    "id": 587,
    "firstname": "[REDACTED]",
    "lastname": "[REDACTED]",
    "email": "[REDACTED]",
    "password": null,
    "phone": null,
    "address1": null,
    "kindness_style": null,
    "city": null,
    "state": null,
    "country": null,
    "interest1": null,
    "interest2": null,
    "interest3": null,
    "sdg1": null,
    "sdg2": null,
    "sdg3": null,
    "google_id": "104158661806928757642",
    "facebook_id": null,
    "picture": "[REDACTED]",
    "created_at": "2026-03-24T15:15:00.751Z",
    "why_friend": null,
    "known_connection": null,
    "desired_outcome": null,
    "hours_per_week": null,
    "age_bracket": null,
    "org_rep": false,
    "org_id": null,
    "availability_weekly": null,
    "availability_exceptions": null,
    "timezone": null,
    "specfifc_availability": null,
    "home_base_lat": null,
    "home_base_lng": null,
    "home_base_label": null,
    "home_base_source": null,
    "travel_radius_km": 5,
    "travel_mode": "transit",
    "reset_password_token_hash": null,
    "reset_password_expires_at": null,
    "reset_password_sent_at": null,
    "is_admin": false,
    "is_suspended": false,
    "email_verified": "[REDACTED]",
    "email_verification_token_hash": null,
    "email_verification_expires_at": null,
    "reliability_score": null,
    "reliability_tier": null,
    "reliability_updated": null,
    "donor_tier": "casual",
    "account_status": "active",
    "ghost_added_by": null,
    "claim_token": null,
    "claim_token_expires_at": null,
    "claimed_at": null
  },
  {
    "id": 12,
    "firstname": "[REDACTED]",
    "lastname": "[REDACTED]",
    "email": "[REDACTED]",
    "password": "[REDACTED]",
    "phone": null,
    "address1": null,
    "kindness_style": null,
    "city": null,
    "state": null,
    "country": null,
    "interest1": null,
    "interest2": null,
    "interest3": null,
    "sdg1": null,
    "sdg2": null,
    "sdg3": null,
    "google_id": null,
    "facebook_id": null,
    "picture": null,
    "created_at": "2025-06-17T11:34:14.732Z",
    "why_friend": null,
    "known_connection": null,
    "desired_outcome": null,
    "hours_per_week": null,
    "age_bracket": null,
    "org_rep": false,
    "org_id": null,
    "availability_weekly": null,
    "availability_exceptions": null,
    "timezone": null,
    "specfifc_availability": null,
    "home_base_lat": null,
    "home_base_lng": null,
    "home_base_label": null,
    "home_base_source": null,
    "travel_radius_km": 5,
    "travel_mode": "transit",
    "reset_password_token_hash": null,
    "reset_password_expires_at": null,
    "reset_password_sent_at": null,
    "is_admin": false,
    "is_suspended": false,
    "email_verified": "[REDACTED]",
    "email_verification_token_hash": null,
    "email_verification_expires_at": null,
    "reliability_score": null,
    "reliability_tier": "new",
    "reliability_updated": "2026-03-10T22:55:28.644Z",
    "donor_tier": "casual",
    "account_status": "active",
    "ghost_added_by": null,
    "claim_token": null,
    "claim_token_expires_at": null,
    "claimed_at": null
  }
]
```

### public.organizations

Role: Organization account/profile table.

Row count: 2

CREATE TABLE:

```sql
CREATE TABLE "public"."organizations" (
  "id" integer DEFAULT nextval('organizations_id_seq'::regclass) NOT NULL,
  "name" character varying(255) NOT NULL,
  "description" text,
  "website" character varying(255),
  "logo_url" text,
  "rep_user_id" integer,
  "rep_role" character varying(255),
  "status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now(),
  "approved_at" timestamp with time zone,
  "approved_by" character varying(255),
  "created_at" timestamp with time zone DEFAULT now(),
  "funding_class" text DEFAULT 'mixed'::text NOT NULL,
  "subsidy_eligible" boolean DEFAULT false NOT NULL,
  "subsidy_cap_percent" integer,
  "manual_override_only" boolean DEFAULT false NOT NULL,
  "funding_notes" text,
  CONSTRAINT "organizations_pkey" PRIMARY KEY (id),
  CONSTRAINT "organizations_rep_user_id_fkey" FOREIGN KEY (rep_user_id) REFERENCES userdata(id),
  CONSTRAINT "organizations_funding_class_check" CHECK (funding_class = ANY (ARRAY['commercial'::text, 'mixed'::text, 'mission_priority'::text])),
  CONSTRAINT "organizations_subsidy_cap_percent_check" CHECK (subsidy_cap_percent IS NULL OR subsidy_cap_percent >= 0 AND subsidy_cap_percent <= 100)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| organizations_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX organizations_pkey ON public.organizations USING btree (id) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| organizations_rep_user_id_fkey | rep_user_id | public.userdata(id) | NO ACTION | NO ACTION | FOREIGN KEY (rep_user_id) REFERENCES userdata(id) |

CHECK constraints:

- `organizations_funding_class_check`: `CHECK (funding_class = ANY (ARRAY['commercial'::text, 'mixed'::text, 'mission_priority'::text]))`
- `organizations_subsidy_cap_percent_check`: `CHECK (subsidy_cap_percent IS NULL OR subsidy_cap_percent >= 0 AND subsidy_cap_percent <= 100)`

Sample rows (redacted):

```json
[
  {
    "id": 1,
    "name": "[REDACTED]",
    "description": "[REDACTED]",
    "website": "[REDACTED]",
    "logo_url": "[REDACTED]",
    "rep_user_id": "[REDACTED]",
    "rep_role": "Executive Director",
    "status": "approved",
    "applied_at": "2026-02-20T23:17:57.137Z",
    "approved_at": "2026-02-20T23:17:57.137Z",
    "approved_by": "[REDACTED]",
    "created_at": "2026-02-20T23:17:57.137Z",
    "funding_class": "mission_priority",
    "subsidy_eligible": true,
    "subsidy_cap_percent": null,
    "manual_override_only": false,
    "funding_notes": "[REDACTED]"
  },
  {
    "id": 3,
    "name": "[REDACTED]",
    "description": "[REDACTED]",
    "website": "[REDACTED]",
    "logo_url": "[REDACTED]",
    "rep_user_id": "[REDACTED]",
    "rep_role": "volunteer coordinator",
    "status": "approved",
    "applied_at": "2026-03-03T22:21:33.048Z",
    "approved_at": "2026-03-03T22:21:33.048Z",
    "approved_by": "[REDACTED]",
    "created_at": "2026-03-03T22:21:33.048Z",
    "funding_class": "commercial",
    "subsidy_eligible": false,
    "subsidy_cap_percent": null,
    "manual_override_only": false,
    "funding_notes": "[REDACTED]"
  }
]
```

### public.events

Role: Confirmed opportunity table. The `opportunities` table does not exist; event/opportunity code uses `events`. Holds title, timing, location, status, capacity, funding pool, attendance methods, and publication state.

Row count: 38

CREATE TABLE:

```sql
CREATE TABLE "public"."events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "creator_user_id" integer NOT NULL,
  "title" text NOT NULL,
  "category" text,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "tz" text DEFAULT 'UTC'::text NOT NULL,
  "location_text" text NOT NULL,
  "visibility" text DEFAULT 'public'::text NOT NULL,
  "capacity" integer,
  "waitlist_enabled" boolean DEFAULT true NOT NULL,
  "cover_url" text,
  "description" text,
  "reward_pool_kind" bigint DEFAULT 0 NOT NULL,
  "attendance_methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "safety_notes" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "org_name" text,
  "community_tag" text,
  "cause_tags" text[] DEFAULT '{}'::text[],
  "requirements" text,
  "verification_method" text DEFAULT 'host_attest'::text,
  "impact_credits_base" integer DEFAULT 25,
  "reliability_weight" integer DEFAULT 1,
  "funding_pool_slug" text DEFAULT 'general'::text NOT NULL,
  "location_lat" double precision,
  "location_lng" double precision,
  "funding_class_override" text,
  "subsidy_eligible_override" boolean,
  "subsidy_cap_percent_override" integer,
  "event_package_locked" boolean DEFAULT false NOT NULL,
  "event_package_expires_at" timestamp with time zone,
  CONSTRAINT "events_pkey" PRIMARY KEY (id),
  CONSTRAINT "events_creator_user_id_fkey" FOREIGN KEY (creator_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "events_attendance_methods_check" CHECK (jsonb_typeof(attendance_methods) = 'array'::text),
  CONSTRAINT "events_capacity_check" CHECK (capacity > 0),
  CONSTRAINT "events_funding_class_override_check" CHECK (funding_class_override IS NULL OR (funding_class_override = ANY (ARRAY['commercial'::text, 'mixed'::text, 'mission_priority'::text]))),
  CONSTRAINT "events_funding_pool_slug_check" CHECK (funding_pool_slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text),
  CONSTRAINT "events_reward_pool_kind_check" CHECK (reward_pool_kind >= 0),
  CONSTRAINT "events_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text, 'completed'::text])),
  CONSTRAINT "events_subsidy_cap_percent_override_check" CHECK (subsidy_cap_percent_override IS NULL OR subsidy_cap_percent_override >= 0 AND subsidy_cap_percent_override <= 100),
  CONSTRAINT "events_verification_method_chk" CHECK (verification_method = ANY (ARRAY['host_attest'::text, 'qr_stub'::text, 'social_proof'::text])),
  CONSTRAINT "events_visibility_check" CHECK (visibility = ANY (ARRAY['public'::text, 'fof'::text, 'private'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| events_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id) |
| idx_events_cause_tags_gin | cause_tags | no | gin | CREATE INDEX idx_events_cause_tags_gin ON public.events USING gin (cause_tags) |
| idx_events_community_tag | community_tag | no | btree | CREATE INDEX idx_events_community_tag ON public.events USING btree (community_tag) |
| idx_events_creator_start | creator_user_id, start_at | no | btree | CREATE INDEX idx_events_creator_start ON public.events USING btree (creator_user_id, start_at) |
| idx_events_funding_pool_slug | funding_pool_slug | no | btree | CREATE INDEX idx_events_funding_pool_slug ON public.events USING btree (funding_pool_slug) |
| idx_events_location | location_lat, location_lng | no | btree | CREATE INDEX idx_events_location ON public.events USING btree (location_lat, location_lng) WHERE ((location_lat IS NOT NULL) AND (location_lng IS NOT NULL)) |
| idx_events_published_start_id | start_at, id | no | btree | CREATE INDEX idx_events_published_start_id ON public.events USING btree (start_at, id) WHERE (status = 'published'::text) |
| idx_events_status_start | status, start_at | no | btree | CREATE INDEX idx_events_status_start ON public.events USING btree (status, start_at) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| events_creator_user_id_fkey | creator_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (creator_user_id) REFERENCES userdata(id) ON DELETE CASCADE |

CHECK constraints:

- `events_attendance_methods_check`: `CHECK (jsonb_typeof(attendance_methods) = 'array'::text)`
- `events_capacity_check`: `CHECK (capacity > 0)`
- `events_funding_class_override_check`: `CHECK (funding_class_override IS NULL OR (funding_class_override = ANY (ARRAY['commercial'::text, 'mixed'::text, 'mission_priority'::text])))`
- `events_funding_pool_slug_check`: `CHECK (funding_pool_slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'::text)`
- `events_reward_pool_kind_check`: `CHECK (reward_pool_kind >= 0)`
- `events_status_check`: `CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'cancelled'::text, 'completed'::text]))`
- `events_subsidy_cap_percent_override_check`: `CHECK (subsidy_cap_percent_override IS NULL OR subsidy_cap_percent_override >= 0 AND subsidy_cap_percent_override <= 100)`
- `events_verification_method_chk`: `CHECK (verification_method = ANY (ARRAY['host_attest'::text, 'qr_stub'::text, 'social_proof'::text]))`
- `events_visibility_check`: `CHECK (visibility = ANY (ARRAY['public'::text, 'fof'::text, 'private'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "1b8f0589-d35e-45a3-951c-b654c89477c3",
    "creator_user_id": "[REDACTED]",
    "title": "testing",
    "category": "Outdoors",
    "start_at": "2026-03-14T16:45:00.000Z",
    "end_at": "2026-03-14T17:30:00.000Z",
    "tz": "America/Vancouver",
    "location_text": "[REDACTED]",
    "visibility": "public",
    "capacity": 1,
    "waitlist_enabled": true,
    "cover_url": "[REDACTED]",
    "description": "[REDACTED]",
    "reward_pool_kind": "0",
    "attendance_methods": [
      "social_proof"
    ],
    "safety_notes": null,
    "status": "cancelled",
    "created_at": "2026-03-14T16:22:42.995Z",
    "updated_at": "2026-04-29T20:43:45.014Z",
    "org_name": "[REDACTED]",
    "community_tag": "Vancouver",
    "cause_tags": [
      "Outdoors"
    ],
    "requirements": null,
    "verification_method": "host_attest",
    "impact_credits_base": 25,
    "reliability_weight": 1,
    "funding_pool_slug": "general",
    "location_lat": "[REDACTED]",
    "location_lng": "[REDACTED]",
    "funding_class_override": "commercial",
    "subsidy_eligible_override": false,
    "subsidy_cap_percent_override": null,
    "event_package_locked": false,
    "event_package_expires_at": null
  },
  {
    "id": "a41370e2-e39b-4254-909d-c41bcf3cb84c",
    "creator_user_id": "[REDACTED]",
    "title": "Site Set Up - April 19 | Cadborosaurus Coastal Endurance Regatta | Victoria",
    "category": "Sports",
    "start_at": "2026-04-19T14:00:00.000Z",
    "end_at": "2026-04-19T15:30:00.000Z",
    "tz": "America/Vancouver",
    "location_text": "[REDACTED]",
    "visibility": "public",
    "capacity": 10,
    "waitlist_enabled": true,
    "cover_url": "[REDACTED]",
    "description": "[REDACTED]",
    "reward_pool_kind": "0",
    "attendance_methods": [
      "social_proof"
    ],
    "safety_notes": "[REDACTED]",
    "status": "published",
    "created_at": "2026-03-04T20:02:26.293Z",
    "updated_at": "2026-04-19T03:25:02.855Z",
    "org_name": "[REDACTED]",
    "community_tag": "Victoria",
    "cause_tags": [
      "Sports"
    ],
    "requirements": "Please arrive 15 minutes prior to the scheduled set-up time and Check in with the Volunteer Coordinator on arrival and let them know\n>Wear closed-toe shoes with good grip, sun protection (a hat is a good idea), and clothing you don't mind getting dirty or wet. \n>Must be able to lift and carry heavy ...[truncated]",
    "verification_method": "host_attest",
    "impact_credits_base": 25,
    "reliability_weight": 1,
    "funding_pool_slug": "general",
    "location_lat": "[REDACTED]",
    "location_lng": "[REDACTED]",
    "funding_class_override": "commercial",
    "subsidy_eligible_override": false,
    "subsidy_cap_percent_override": null,
    "event_package_locked": false,
    "event_package_expires_at": null
  },
  {
    "id": "62b860fa-c127-48f6-aa97-96927d691f55",
    "creator_user_id": "[REDACTED]",
    "title": "tanzi con zoe",
    "category": null,
    "start_at": "2025-11-15T05:00:00.000Z",
    "end_at": "2025-11-15T07:00:00.000Z",
    "tz": "America/Vancouver",
    "location_text": "[REDACTED]",
    "visibility": "public",
    "capacity": 2,
    "waitlist_enabled": true,
    "cover_url": "[REDACTED]",
    "description": "[REDACTED]",
    "reward_pool_kind": "0",
    "attendance_methods": [
      "host_code",
      "social_proof"
    ],
    "safety_notes": null,
    "status": "completed",
    "created_at": "2025-11-12T21:19:21.060Z",
    "updated_at": "2026-04-10T21:23:19.820Z",
    "org_name": null,
    "community_tag": null,
    "cause_tags": [],
    "requirements": null,
    "verification_method": "host_attest",
    "impact_credits_base": 25,
    "reliability_weight": 1,
    "funding_pool_slug": "general",
    "location_lat": "[REDACTED]",
    "location_lng": "[REDACTED]",
    "funding_class_override": "commercial",
    "subsidy_eligible_override": false,
    "subsidy_cap_percent_override": null,
    "event_package_locked": false,
    "event_package_expires_at": null
  }
]
```

### public.event_roles

Role: Role/shift staffing table for events. No separate recurrence/series table was found.

Row count: 0

CREATE TABLE:

```sql
CREATE TABLE "public"."event_roles" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "tier" text DEFAULT 'standard'::text NOT NULL,
  "spots_needed" integer DEFAULT 1 NOT NULL,
  "spots_filled" integer DEFAULT 0 NOT NULL,
  "requirements" text,
  "safety_notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_roles_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_roles_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "event_roles_spots_check" CHECK (spots_needed > 0 AND spots_filled >= 0 AND spots_filled <= spots_needed),
  CONSTRAINT "event_roles_tier_check" CHECK (tier = ANY (ARRAY['standard'::text, 'skilled'::text, 'specialist'::text, 'leadership'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| event_roles_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX event_roles_pkey ON public.event_roles USING btree (id) |
| idx_event_roles_event | event_id | no | btree | CREATE INDEX idx_event_roles_event ON public.event_roles USING btree (event_id) |
| idx_event_roles_unfilled | event_id | no | btree | CREATE INDEX idx_event_roles_unfilled ON public.event_roles USING btree (event_id) WHERE (spots_filled < spots_needed) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| event_roles_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |

CHECK constraints:

- `event_roles_spots_check`: `CHECK (spots_needed > 0 AND spots_filled >= 0 AND spots_filled <= spots_needed)`
- `event_roles_tier_check`: `CHECK (tier = ANY (ARRAY['standard'::text, 'skilled'::text, 'specialist'::text, 'leadership'::text]))`

Sample rows (redacted):

```json
[]
```

### public.event_role_skills

Role: Skills required/preferred by event roles; indirect event lifecycle table through `event_roles`.

Row count: 0

CREATE TABLE:

```sql
CREATE TABLE "public"."event_role_skills" (
  "role_id" uuid NOT NULL,
  "skill_id" integer NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  CONSTRAINT "event_role_skills_pkey" PRIMARY KEY (role_id, skill_id),
  CONSTRAINT "event_role_skills_role_id_fkey" FOREIGN KEY (role_id) REFERENCES event_roles(id) ON DELETE CASCADE,
  CONSTRAINT "event_role_skills_skill_id_fkey" FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| event_role_skills_pkey | role_id, skill_id | yes (primary) | btree | CREATE UNIQUE INDEX event_role_skills_pkey ON public.event_role_skills USING btree (role_id, skill_id) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| event_role_skills_role_id_fkey | role_id | public.event_roles(id) | CASCADE | NO ACTION | FOREIGN KEY (role_id) REFERENCES event_roles(id) ON DELETE CASCADE |
| event_role_skills_skill_id_fkey | skill_id | public.skill_definitions(id) | CASCADE | NO ACTION | FOREIGN KEY (skill_id) REFERENCES skill_definitions(id) ON DELETE CASCADE |

CHECK constraints:

None.

Sample rows (redacted):

```json
[]
```

### public.event_rsvps

Role: RSVP/signup table and also the check-in/attendance/verified-hours table via `status`, `check_in_method`, `checked_in_at`, `verification_status`, `attended_minutes`, `verified_at`, and `no_show`.

Row count: 97

CREATE TABLE:

```sql
CREATE TABLE "public"."event_rsvps" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "attendee_user_id" integer NOT NULL,
  "status" text DEFAULT 'interested'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "check_in_method" text,
  "checked_in_at" timestamp with time zone,
  "verification_status" text DEFAULT 'pending'::text,
  "attended_minutes" integer,
  "verified_at" timestamp with time zone,
  "no_show" boolean DEFAULT false,
  "notes" text,
  "role_id" uuid,
  CONSTRAINT "event_rsvps_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_rsvps_attendee_user_id_fkey" FOREIGN KEY (attendee_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "event_rsvps_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "event_rsvps_role_id_fkey" FOREIGN KEY (role_id) REFERENCES event_roles(id) ON DELETE SET NULL,
  CONSTRAINT "event_rsvps_check_in_method_check" CHECK (check_in_method = ANY (ARRAY['host_code'::text, 'social_proof'::text, 'geo'::text])),
  CONSTRAINT "event_rsvps_status_check" CHECK (status = ANY (ARRAY['accepted'::text, 'checked_in'::text, 'declined'::text, 'pending'::text])),
  CONSTRAINT "event_rsvps_verification_status_chk" CHECK (verification_status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| event_rsvps_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX event_rsvps_pkey ON public.event_rsvps USING btree (id) |
| uq_event_rsvps_attendee | event_id, attendee_user_id | yes | btree | CREATE UNIQUE INDEX uq_event_rsvps_attendee ON public.event_rsvps USING btree (event_id, attendee_user_id) |
| idx_event_rsvps_attendee_verification_status | attendee_user_id, verification_status | no | btree | CREATE INDEX idx_event_rsvps_attendee_verification_status ON public.event_rsvps USING btree (attendee_user_id, verification_status) |
| idx_event_rsvps_checked_in | event_id | no | btree | CREATE INDEX idx_event_rsvps_checked_in ON public.event_rsvps USING btree (event_id) WHERE (status = 'checked_in'::text) |
| idx_event_rsvps_event_verification_status | event_id, verification_status | no | btree | CREATE INDEX idx_event_rsvps_event_verification_status ON public.event_rsvps USING btree (event_id, verification_status) |
| idx_event_rsvps_status | event_id, status | no | btree | CREATE INDEX idx_event_rsvps_status ON public.event_rsvps USING btree (event_id, status) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| event_rsvps_attendee_user_id_fkey | attendee_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (attendee_user_id) REFERENCES userdata(id) ON DELETE CASCADE |
| event_rsvps_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_rsvps_role_id_fkey | role_id | public.event_roles(id) | SET NULL | NO ACTION | FOREIGN KEY (role_id) REFERENCES event_roles(id) ON DELETE SET NULL |

CHECK constraints:

- `event_rsvps_check_in_method_check`: `CHECK (check_in_method = ANY (ARRAY['host_code'::text, 'social_proof'::text, 'geo'::text]))`
- `event_rsvps_status_check`: `CHECK (status = ANY (ARRAY['accepted'::text, 'checked_in'::text, 'declined'::text, 'pending'::text]))`
- `event_rsvps_verification_status_chk`: `CHECK (verification_status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "9dda6b29-fc33-4cea-a391-f214d3d39599",
    "event_id": "f975f057-483d-4591-94b8-41acfcacb88e",
    "attendee_user_id": "[REDACTED]",
    "status": "accepted",
    "created_at": "2026-04-10T16:35:34.789Z",
    "updated_at": "2026-04-20T03:58:34.931Z",
    "check_in_method": null,
    "checked_in_at": null,
    "verification_status": "verified",
    "attended_minutes": 210,
    "verified_at": "2026-04-20T03:58:34.931Z",
    "no_show": false,
    "notes": null,
    "role_id": null
  },
  {
    "id": "e59bf4a9-deca-482f-9f73-722c1f57829e",
    "event_id": "f975f057-483d-4591-94b8-41acfcacb88e",
    "attendee_user_id": "[REDACTED]",
    "status": "accepted",
    "created_at": "2026-04-11T20:00:45.182Z",
    "updated_at": "2026-04-20T03:58:35.076Z",
    "check_in_method": null,
    "checked_in_at": null,
    "verification_status": "verified",
    "attended_minutes": 210,
    "verified_at": "2026-04-20T03:58:35.076Z",
    "no_show": false,
    "notes": null,
    "role_id": null
  },
  {
    "id": "ceaa1b6c-aa2b-4f6e-9748-6fd825573b3b",
    "event_id": "a3b16ca2-d7ef-450e-8d9a-c4e7cd6d2d86",
    "attendee_user_id": "[REDACTED]",
    "status": "accepted",
    "created_at": "2026-04-15T20:21:29.788Z",
    "updated_at": "2026-04-20T03:58:43.541Z",
    "check_in_method": null,
    "checked_in_at": null,
    "verification_status": "verified",
    "attended_minutes": 240,
    "verified_at": "2026-04-20T03:58:43.541Z",
    "no_show": false,
    "notes": null,
    "role_id": null
  }
]
```

### public.wallet_transactions

Role: Volunteer Impact Credit wallet ledger. Attendance verification inserts `earn_shift` credit rows here.

Row count: 64

CREATE TABLE:

```sql
CREATE TABLE "public"."wallet_transactions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer NOT NULL,
  "kind_amount" bigint NOT NULL,
  "direction" text NOT NULL,
  "reason" text NOT NULL,
  "event_id" uuid,
  "charity_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "wallet_transactions_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "wallet_transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "wallet_transactions_direction_check" CHECK (direction = ANY (ARRAY['credit'::text, 'debit'::text])),
  CONSTRAINT "wallet_transactions_kind_amount_check" CHECK (kind_amount >= 0),
  CONSTRAINT "wallet_transactions_reason_check" CHECK (reason = ANY (ARRAY['earn'::text, 'donate'::text, 'adjustment'::text, 'earn_shift'::text, 'redeem'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| wallet_transactions_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX wallet_transactions_pkey ON public.wallet_transactions USING btree (id) |
| wallet_transactions_earn_shift_unique_idx | user_id, event_id | yes | btree | CREATE UNIQUE INDEX wallet_transactions_earn_shift_unique_idx ON public.wallet_transactions USING btree (user_id, event_id) WHERE ((reason = 'earn_shift'::text) AND (direction = 'credit'::text)) |
| idx_wallet_transactions_event_id | event_id | no | btree | CREATE INDEX idx_wallet_transactions_event_id ON public.wallet_transactions USING btree (event_id) |
| idx_wallet_transactions_user_created | user_id, created_at | no | btree | CREATE INDEX idx_wallet_transactions_user_created ON public.wallet_transactions USING btree (user_id, created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| wallet_transactions_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| wallet_transactions_user_id_fkey | user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (user_id) REFERENCES userdata(id) ON DELETE CASCADE |

CHECK constraints:

- `wallet_transactions_direction_check`: `CHECK (direction = ANY (ARRAY['credit'::text, 'debit'::text]))`
- `wallet_transactions_kind_amount_check`: `CHECK (kind_amount >= 0)`
- `wallet_transactions_reason_check`: `CHECK (reason = ANY (ARRAY['earn'::text, 'donate'::text, 'adjustment'::text, 'earn_shift'::text, 'redeem'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "46f038cb-129a-4f83-9e56-4841f1c3a6d2",
    "user_id": "[REDACTED]",
    "kind_amount": "25",
    "direction": "credit",
    "reason": "earn_shift",
    "event_id": "a7b0f87c-ff4b-48d9-8400-b67e5ccfb12e",
    "charity_id": null,
    "note": "[REDACTED]",
    "created_at": "2026-01-05T17:34:03.769Z"
  },
  {
    "id": "6f0835dc-4365-40e7-b06d-db834f797b1c",
    "user_id": "[REDACTED]",
    "kind_amount": "25",
    "direction": "credit",
    "reason": "earn_shift",
    "event_id": "c2480717-8f47-443b-85be-ccd98cb90c96",
    "charity_id": null,
    "note": "[REDACTED]",
    "created_at": "2026-02-23T19:25:17.471Z"
  },
  {
    "id": "7d8f0ad2-662e-4023-8175-18208ba242cf",
    "user_id": "[REDACTED]",
    "kind_amount": "25",
    "direction": "credit",
    "reason": "earn_shift",
    "event_id": "7ba42905-4c47-4e48-aebf-01606c7ce762",
    "charity_id": null,
    "note": "[REDACTED]",
    "created_at": "2026-02-28T17:22:32.007Z"
  }
]
```

### public.donor_ic_ledger

Role: Donor IC ledger table found in code/database; separate from volunteer wallet transactions.

Row count: 4

CREATE TABLE:

```sql
CREATE TABLE "public"."donor_ic_ledger" (
  "id" bigint DEFAULT nextval('donor_ic_ledger_id_seq'::regclass) NOT NULL,
  "donor_user_id" integer NOT NULL,
  "donation_id" bigint NOT NULL,
  "ic_amount" integer NOT NULL,
  "ic_rate" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "donor_ic_ledger_pkey" PRIMARY KEY (id),
  CONSTRAINT "donor_ic_ledger_donation_id_key" UNIQUE (donation_id),
  CONSTRAINT "donor_ic_ledger_donation_id_fkey" FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  CONSTRAINT "donor_ic_ledger_donor_user_id_fkey" FOREIGN KEY (donor_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "donor_ic_ledger_ic_amount_check" CHECK (ic_amount >= 0),
  CONSTRAINT "donor_ic_ledger_ic_rate_check" CHECK (ic_rate = ANY (ARRAY[5, 7, 10]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| donor_ic_ledger_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX donor_ic_ledger_pkey ON public.donor_ic_ledger USING btree (id) |
| donor_ic_ledger_donation_id_key | donation_id | yes | btree | CREATE UNIQUE INDEX donor_ic_ledger_donation_id_key ON public.donor_ic_ledger USING btree (donation_id) |
| idx_donor_ic_ledger_donation_id | donation_id | no | btree | CREATE INDEX idx_donor_ic_ledger_donation_id ON public.donor_ic_ledger USING btree (donation_id) |
| idx_donor_ic_ledger_donor_user_id | donor_user_id | no | btree | CREATE INDEX idx_donor_ic_ledger_donor_user_id ON public.donor_ic_ledger USING btree (donor_user_id) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| donor_ic_ledger_donation_id_fkey | donation_id | public.donations(id) | CASCADE | NO ACTION | FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE |
| donor_ic_ledger_donor_user_id_fkey | donor_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (donor_user_id) REFERENCES userdata(id) ON DELETE CASCADE |

CHECK constraints:

- `donor_ic_ledger_ic_amount_check`: `CHECK (ic_amount >= 0)`
- `donor_ic_ledger_ic_rate_check`: `CHECK (ic_rate = ANY (ARRAY[5, 7, 10]))`

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "donor_user_id": "[REDACTED]",
    "donation_id": "1",
    "ic_amount": 125,
    "ic_rate": 5,
    "expires_at": "2028-01-07T18:05:17.137Z",
    "created_at": "2026-01-07T18:05:17.137Z"
  },
  {
    "id": "2",
    "donor_user_id": "[REDACTED]",
    "donation_id": "2",
    "ic_amount": 25,
    "ic_rate": 5,
    "expires_at": "2028-01-07T18:45:13.867Z",
    "created_at": "2026-01-07T18:45:13.867Z"
  },
  {
    "id": "3",
    "donor_user_id": "[REDACTED]",
    "donation_id": "3",
    "ic_amount": 100,
    "ic_rate": 5,
    "expires_at": "2028-01-07T21:05:20.931Z",
    "created_at": "2026-01-07T21:05:20.931Z"
  }
]
```

### public.funding_pools

Role: Funding pool balance source for org KPI impact credits available.

Row count: 6

CREATE TABLE:

```sql
CREATE TABLE "public"."funding_pools" (
  "id" bigint DEFAULT nextval('funding_pools_id_seq'::regclass) NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "funding_pools_pkey" PRIMARY KEY (id),
  CONSTRAINT "funding_pools_slug_key" UNIQUE (slug)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| funding_pools_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX funding_pools_pkey ON public.funding_pools USING btree (id) |
| funding_pools_slug_key | slug | yes | btree | CREATE UNIQUE INDEX funding_pools_slug_key ON public.funding_pools USING btree (slug) |

Foreign keys:

None.

CHECK constraints:

None.

Sample rows (redacted):

```json
[
  {
    "id": "18",
    "slug": "u19__general",
    "name": "[REDACTED]",
    "created_at": "2026-02-13T21:54:19.598Z"
  },
  {
    "id": "19",
    "slug": "u4__general",
    "name": "[REDACTED]",
    "created_at": "2026-02-13T22:07:15.492Z"
  },
  {
    "id": "24",
    "slug": "u7__general",
    "name": "[REDACTED]",
    "created_at": "2026-02-13T22:38:31.726Z"
  }
]
```

### public.pool_transactions

Role: Funding pool ledger; direct FK to events and used for org available impact credits.

Row count: 82

CREATE TABLE:

```sql
CREATE TABLE "public"."pool_transactions" (
  "id" bigint DEFAULT nextval('pool_transactions_id_seq'::regclass) NOT NULL,
  "pool_id" bigint NOT NULL,
  "direction" text NOT NULL,
  "amount_credits" integer NOT NULL,
  "reason" text NOT NULL,
  "donation_id" bigint,
  "event_id" uuid,
  "wallet_tx_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notes" text,
  CONSTRAINT "pool_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "pool_transactions_donation_id_fkey" FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL,
  CONSTRAINT "pool_transactions_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "pool_transactions_pool_id_fkey" FOREIGN KEY (pool_id) REFERENCES funding_pools(id) ON DELETE CASCADE,
  CONSTRAINT "pool_transactions_wallet_tx_id_fkey" FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  CONSTRAINT "pool_transactions_amount_credits_check" CHECK (amount_credits >= 0),
  CONSTRAINT "pool_transactions_direction_check" CHECK (direction = ANY (ARRAY['credit'::text, 'debit'::text])),
  CONSTRAINT "pool_transactions_reason_check" CHECK (reason = ANY (ARRAY['donation_in'::text, 'shift_out'::text, 'manual_adjust'::text, 'org_topup'::text, 'subscription_topup'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| pool_transactions_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX pool_transactions_pkey ON public.pool_transactions USING btree (id) |
| pool_transactions_shift_out_wallet_tx_uniq | wallet_tx_id | yes | btree | CREATE UNIQUE INDEX pool_transactions_shift_out_wallet_tx_uniq ON public.pool_transactions USING btree (wallet_tx_id) WHERE ((reason = 'shift_out'::text) AND (direction = 'debit'::text)) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| pool_transactions_donation_id_fkey | donation_id | public.donations(id) | SET NULL | NO ACTION | FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL |
| pool_transactions_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| pool_transactions_pool_id_fkey | pool_id | public.funding_pools(id) | CASCADE | NO ACTION | FOREIGN KEY (pool_id) REFERENCES funding_pools(id) ON DELETE CASCADE |
| pool_transactions_wallet_tx_id_fkey | wallet_tx_id | public.wallet_transactions(id) | SET NULL | NO ACTION | FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE SET NULL |

CHECK constraints:

- `pool_transactions_amount_credits_check`: `CHECK (amount_credits >= 0)`
- `pool_transactions_direction_check`: `CHECK (direction = ANY (ARRAY['credit'::text, 'debit'::text]))`
- `pool_transactions_reason_check`: `CHECK (reason = ANY (ARRAY['donation_in'::text, 'shift_out'::text, 'manual_adjust'::text, 'org_topup'::text, 'subscription_topup'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "pool_id": "1",
    "direction": "credit",
    "amount_credits": 25,
    "reason": "donation_in",
    "donation_id": "1",
    "event_id": null,
    "wallet_tx_id": null,
    "created_at": "2026-01-07T18:05:17.137Z",
    "notes": null
  },
  {
    "id": "2",
    "pool_id": "1",
    "direction": "credit",
    "amount_credits": 5,
    "reason": "donation_in",
    "donation_id": "2",
    "event_id": null,
    "wallet_tx_id": null,
    "created_at": "2026-01-07T18:45:13.867Z",
    "notes": null
  },
  {
    "id": "3",
    "pool_id": "1",
    "direction": "credit",
    "amount_credits": 20,
    "reason": "donation_in",
    "donation_id": "3",
    "event_id": null,
    "wallet_tx_id": null,
    "created_at": "2026-01-07T21:05:20.931Z",
    "notes": null
  }
]
```

### public.funding_credits

Role: Funding-credit inventory; direct FK to events.

Row count: 19

CREATE TABLE:

```sql
CREATE TABLE "public"."funding_credits" (
  "id" bigint DEFAULT nextval('funding_credits_id_seq'::regclass) NOT NULL,
  "pool_id" bigint NOT NULL,
  "origin_pool_transaction_id" bigint NOT NULL,
  "source_type" text NOT NULL,
  "scope_type" text NOT NULL,
  "organization_id" integer,
  "event_id" uuid,
  "donation_id" bigint,
  "subscription_topup_id" bigint,
  "amount_ic" integer NOT NULL,
  "remaining_ic" integer NOT NULL,
  "allocation_status" text DEFAULT 'available'::text NOT NULL,
  "expires_at" timestamp with time zone,
  "created_by_user_id" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "funding_credits_pkey" PRIMARY KEY (id),
  CONSTRAINT "funding_credits_origin_pool_transaction_id_key" UNIQUE (origin_pool_transaction_id),
  CONSTRAINT "funding_credits_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES userdata(id) ON DELETE SET NULL,
  CONSTRAINT "funding_credits_donation_id_fkey" FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL,
  CONSTRAINT "funding_credits_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "funding_credits_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT "funding_credits_origin_pool_transaction_id_fkey" FOREIGN KEY (origin_pool_transaction_id) REFERENCES pool_transactions(id) ON DELETE CASCADE,
  CONSTRAINT "funding_credits_pool_id_fkey" FOREIGN KEY (pool_id) REFERENCES funding_pools(id) ON DELETE CASCADE,
  CONSTRAINT "funding_credits_subscription_topup_id_fkey" FOREIGN KEY (subscription_topup_id) REFERENCES subscription_topups(id) ON DELETE SET NULL,
  CONSTRAINT "funding_credits_allocation_status_check" CHECK (allocation_status = ANY (ARRAY['available'::text, 'held_pending_manual_review'::text, 'held_pending_subscription'::text, 'allocated'::text, 'partially_spent'::text, 'spent'::text, 'expired'::text, 'reversed'::text])),
  CONSTRAINT "funding_credits_amount_ic_check" CHECK (amount_ic >= 0),
  CONSTRAINT "funding_credits_remaining_ic_check" CHECK (remaining_ic >= 0 AND remaining_ic <= amount_ic),
  CONSTRAINT "funding_credits_scope_type_check" CHECK (scope_type = ANY (ARRAY['event'::text, 'org'::text, 'unrestricted'::text])),
  CONSTRAINT "funding_credits_source_type_check" CHECK (source_type = ANY (ARRAY['donation'::text, 'event_package'::text, 'subscription'::text, 'admin_grant'::text, 'pilot_subsidy'::text, 'org_topup'::text, 'reserve'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| funding_credits_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX funding_credits_pkey ON public.funding_credits USING btree (id) |
| funding_credits_origin_pool_transaction_id_key | origin_pool_transaction_id | yes | btree | CREATE UNIQUE INDEX funding_credits_origin_pool_transaction_id_key ON public.funding_credits USING btree (origin_pool_transaction_id) |
| funding_credits_donation_idx | donation_id | no | btree | CREATE INDEX funding_credits_donation_idx ON public.funding_credits USING btree (donation_id) |
| funding_credits_event_status_expiry_idx | event_id, allocation_status, expires_at | no | btree | CREATE INDEX funding_credits_event_status_expiry_idx ON public.funding_credits USING btree (event_id, allocation_status, expires_at) |
| funding_credits_org_status_expiry_idx | organization_id, allocation_status, expires_at | no | btree | CREATE INDEX funding_credits_org_status_expiry_idx ON public.funding_credits USING btree (organization_id, allocation_status, expires_at) |
| funding_credits_scope_status_idx | scope_type, allocation_status | no | btree | CREATE INDEX funding_credits_scope_status_idx ON public.funding_credits USING btree (scope_type, allocation_status) |
| funding_credits_source_status_idx | source_type, allocation_status | no | btree | CREATE INDEX funding_credits_source_status_idx ON public.funding_credits USING btree (source_type, allocation_status) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| funding_credits_created_by_user_id_fkey | created_by_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (created_by_user_id) REFERENCES userdata(id) ON DELETE SET NULL |
| funding_credits_donation_id_fkey | donation_id | public.donations(id) | SET NULL | NO ACTION | FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL |
| funding_credits_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| funding_credits_organization_id_fkey | organization_id | public.organizations(id) | SET NULL | NO ACTION | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL |
| funding_credits_origin_pool_transaction_id_fkey | origin_pool_transaction_id | public.pool_transactions(id) | CASCADE | NO ACTION | FOREIGN KEY (origin_pool_transaction_id) REFERENCES pool_transactions(id) ON DELETE CASCADE |
| funding_credits_pool_id_fkey | pool_id | public.funding_pools(id) | CASCADE | NO ACTION | FOREIGN KEY (pool_id) REFERENCES funding_pools(id) ON DELETE CASCADE |
| funding_credits_subscription_topup_id_fkey | subscription_topup_id | public.subscription_topups(id) | SET NULL | NO ACTION | FOREIGN KEY (subscription_topup_id) REFERENCES subscription_topups(id) ON DELETE SET NULL |

CHECK constraints:

- `funding_credits_allocation_status_check`: `CHECK (allocation_status = ANY (ARRAY['available'::text, 'held_pending_manual_review'::text, 'held_pending_subscription'::text, 'allocated'::text, 'partially_spent'::text, 'spent'::text, 'expired'::text, 'reversed'::text]))`
- `funding_credits_amount_ic_check`: `CHECK (amount_ic >= 0)`
- `funding_credits_remaining_ic_check`: `CHECK (remaining_ic >= 0 AND remaining_ic <= amount_ic)`
- `funding_credits_scope_type_check`: `CHECK (scope_type = ANY (ARRAY['event'::text, 'org'::text, 'unrestricted'::text]))`
- `funding_credits_source_type_check`: `CHECK (source_type = ANY (ARRAY['donation'::text, 'event_package'::text, 'subscription'::text, 'admin_grant'::text, 'pilot_subsidy'::text, 'org_topup'::text, 'reserve'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "pool_id": "26",
    "origin_pool_transaction_id": "20",
    "source_type": "admin_grant",
    "scope_type": "unrestricted",
    "organization_id": null,
    "event_id": null,
    "donation_id": null,
    "subscription_topup_id": null,
    "amount_ic": 100,
    "remaining_ic": 100,
    "allocation_status": "available",
    "expires_at": null,
    "created_by_user_id": null,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u46__general",
      "origin_reason": "org_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-11T17:25:09.892Z",
    "updated_at": "2026-04-11T17:25:09.892Z"
  },
  {
    "id": "3",
    "pool_id": "19",
    "origin_pool_transaction_id": "17",
    "source_type": "subscription",
    "scope_type": "org",
    "organization_id": 1,
    "event_id": null,
    "donation_id": null,
    "subscription_topup_id": null,
    "amount_ic": 100,
    "remaining_ic": 100,
    "allocation_status": "available",
    "expires_at": null,
    "created_by_user_id": null,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u4__general",
      "origin_reason": "subscription_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-11T17:25:09.892Z",
    "updated_at": "2026-04-11T17:25:09.892Z"
  },
  {
    "id": "5",
    "pool_id": "18",
    "origin_pool_transaction_id": "12",
    "source_type": "admin_grant",
    "scope_type": "unrestricted",
    "organization_id": null,
    "event_id": null,
    "donation_id": null,
    "subscription_topup_id": null,
    "amount_ic": 100,
    "remaining_ic": 100,
    "allocation_status": "available",
    "expires_at": null,
    "created_by_user_id": null,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u19__general",
      "origin_reason": "org_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-11T17:25:09.892Z",
    "updated_at": "2026-04-11T17:25:09.892Z"
  }
]
```

### public.funding_allocations

Role: Funding allocation rows; direct FK to events.

Row count: 12

CREATE TABLE:

```sql
CREATE TABLE "public"."funding_allocations" (
  "id" bigint DEFAULT nextval('funding_allocations_id_seq'::regclass) NOT NULL,
  "funding_credit_id" bigint NOT NULL,
  "pool_transaction_id" bigint,
  "wallet_tx_id" uuid,
  "donor_receipt_id" bigint,
  "event_id" uuid,
  "organization_id" integer,
  "volunteer_user_id" integer,
  "amount_ic" integer NOT NULL,
  "minutes_funded" integer,
  "allocation_rank" integer DEFAULT 1 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "funding_allocations_pkey" PRIMARY KEY (id),
  CONSTRAINT "funding_allocations_donor_receipt_id_fkey" FOREIGN KEY (donor_receipt_id) REFERENCES donor_receipts(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_funding_credit_id_fkey" FOREIGN KEY (funding_credit_id) REFERENCES funding_credits(id) ON DELETE CASCADE,
  CONSTRAINT "funding_allocations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_pool_transaction_id_fkey" FOREIGN KEY (pool_transaction_id) REFERENCES pool_transactions(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_volunteer_user_id_fkey" FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_wallet_tx_id_fkey" FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  CONSTRAINT "funding_allocations_amount_ic_check" CHECK (amount_ic > 0)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| funding_allocations_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX funding_allocations_pkey ON public.funding_allocations USING btree (id) |
| funding_allocations_credit_idx | funding_credit_id | no | btree | CREATE INDEX funding_allocations_credit_idx ON public.funding_allocations USING btree (funding_credit_id) |
| funding_allocations_event_org_idx | event_id, organization_id | no | btree | CREATE INDEX funding_allocations_event_org_idx ON public.funding_allocations USING btree (event_id, organization_id) |
| funding_allocations_volunteer_idx | volunteer_user_id | no | btree | CREATE INDEX funding_allocations_volunteer_idx ON public.funding_allocations USING btree (volunteer_user_id) |
| funding_allocations_wallet_tx_idx | wallet_tx_id | no | btree | CREATE INDEX funding_allocations_wallet_tx_idx ON public.funding_allocations USING btree (wallet_tx_id) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| funding_allocations_donor_receipt_id_fkey | donor_receipt_id | public.donor_receipts(id) | SET NULL | NO ACTION | FOREIGN KEY (donor_receipt_id) REFERENCES donor_receipts(id) ON DELETE SET NULL |
| funding_allocations_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| funding_allocations_funding_credit_id_fkey | funding_credit_id | public.funding_credits(id) | CASCADE | NO ACTION | FOREIGN KEY (funding_credit_id) REFERENCES funding_credits(id) ON DELETE CASCADE |
| funding_allocations_organization_id_fkey | organization_id | public.organizations(id) | SET NULL | NO ACTION | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL |
| funding_allocations_pool_transaction_id_fkey | pool_transaction_id | public.pool_transactions(id) | SET NULL | NO ACTION | FOREIGN KEY (pool_transaction_id) REFERENCES pool_transactions(id) ON DELETE SET NULL |
| funding_allocations_volunteer_user_id_fkey | volunteer_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id) ON DELETE SET NULL |
| funding_allocations_wallet_tx_id_fkey | wallet_tx_id | public.wallet_transactions(id) | SET NULL | NO ACTION | FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE SET NULL |

CHECK constraints:

- `funding_allocations_amount_ic_check`: `CHECK (amount_ic > 0)`

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "funding_credit_id": "4",
    "pool_transaction_id": "41",
    "wallet_tx_id": "27abdba5-af44-4cd8-b9e7-9ebaba8eb19d",
    "donor_receipt_id": "17",
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "organization_id": 3,
    "volunteer_user_id": "[REDACTED]",
    "amount_ic": 75,
    "minutes_funded": 180,
    "allocation_rank": 1,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u9__general",
      "scope_type": "org",
      "donation_id": null,
      "source_type": "admin_grant",
      "origin_reason": "org_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-22T15:14:22.310Z"
  },
  {
    "id": "2",
    "funding_credit_id": "4",
    "pool_transaction_id": "42",
    "wallet_tx_id": "53d40b62-aae5-4307-8521-5be6ff166e6a",
    "donor_receipt_id": "18",
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "organization_id": 3,
    "volunteer_user_id": "[REDACTED]",
    "amount_ic": 25,
    "minutes_funded": 60,
    "allocation_rank": 1,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u9__general",
      "scope_type": "org",
      "donation_id": null,
      "source_type": "admin_grant",
      "origin_reason": "org_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-22T15:14:27.912Z"
  },
  {
    "id": "3",
    "funding_credit_id": "10",
    "pool_transaction_id": "42",
    "wallet_tx_id": "53d40b62-aae5-4307-8521-5be6ff166e6a",
    "donor_receipt_id": "18",
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "organization_id": 3,
    "volunteer_user_id": "[REDACTED]",
    "amount_ic": 50,
    "minutes_funded": 120,
    "allocation_rank": 2,
    "metadata": {
      "stage": "stage4_backfill",
      "pool_slug": "u9__general",
      "scope_type": "org",
      "donation_id": null,
      "source_type": "admin_grant",
      "origin_reason": "org_topup",
      "scoped_rep_user_id": "[REDACTED]"
    },
    "created_at": "2026-04-22T15:14:27.912Z"
  }
]
```

### public.donation_allocation_reviews

Role: Donation review table with optional manual target event FK.

Row count: 0

CREATE TABLE:

```sql
CREATE TABLE "public"."donation_allocation_reviews" (
  "id" bigint DEFAULT nextval('donation_allocation_reviews_id_seq'::regclass) NOT NULL,
  "donation_id" bigint NOT NULL,
  "status" text DEFAULT 'pending_manual_review'::text NOT NULL,
  "review_due_at" timestamp with time zone NOT NULL,
  "manual_target_type" text,
  "manual_target_org_id" integer,
  "manual_target_event_id" uuid,
  "reviewed_by_user_id" integer,
  "reviewed_at" timestamp with time zone,
  "policy_reason_code" text,
  "notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "notification_sent_at" timestamp with time zone,
  "notification_sent_to" text,
  "last_notification_error" text,
  CONSTRAINT "donation_allocation_reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "donation_allocation_reviews_donation_id_key" UNIQUE (donation_id),
  CONSTRAINT "donation_allocation_reviews_donation_id_fkey" FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE,
  CONSTRAINT "donation_allocation_reviews_manual_target_event_id_fkey" FOREIGN KEY (manual_target_event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "donation_allocation_reviews_manual_target_org_id_fkey" FOREIGN KEY (manual_target_org_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT "donation_allocation_reviews_reviewed_by_user_id_fkey" FOREIGN KEY (reviewed_by_user_id) REFERENCES userdata(id) ON DELETE SET NULL,
  CONSTRAINT "donation_allocation_reviews_manual_target_type_check" CHECK (manual_target_type IS NULL OR (manual_target_type = ANY (ARRAY['org'::text, 'event'::text, 'unrestricted'::text]))),
  CONSTRAINT "donation_allocation_reviews_status_check" CHECK (status = ANY (ARRAY['pending_manual_review'::text, 'manually_allocated'::text, 'policy_allocated'::text, 'cancelled'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| donation_allocation_reviews_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX donation_allocation_reviews_pkey ON public.donation_allocation_reviews USING btree (id) |
| donation_allocation_reviews_donation_id_key | donation_id | yes | btree | CREATE UNIQUE INDEX donation_allocation_reviews_donation_id_key ON public.donation_allocation_reviews USING btree (donation_id) |
| donation_allocation_reviews_event_idx | manual_target_event_id | no | btree | CREATE INDEX donation_allocation_reviews_event_idx ON public.donation_allocation_reviews USING btree (manual_target_event_id) |
| donation_allocation_reviews_notification_due_idx | status, review_due_at, notification_sent_at | no | btree | CREATE INDEX donation_allocation_reviews_notification_due_idx ON public.donation_allocation_reviews USING btree (status, review_due_at, notification_sent_at) |
| donation_allocation_reviews_org_idx | manual_target_org_id | no | btree | CREATE INDEX donation_allocation_reviews_org_idx ON public.donation_allocation_reviews USING btree (manual_target_org_id) |
| donation_allocation_reviews_status_due_idx | status, review_due_at | no | btree | CREATE INDEX donation_allocation_reviews_status_due_idx ON public.donation_allocation_reviews USING btree (status, review_due_at) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| donation_allocation_reviews_donation_id_fkey | donation_id | public.donations(id) | CASCADE | NO ACTION | FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE CASCADE |
| donation_allocation_reviews_manual_target_event_id_fkey | manual_target_event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (manual_target_event_id) REFERENCES events(id) ON DELETE SET NULL |
| donation_allocation_reviews_manual_target_org_id_fkey | manual_target_org_id | public.organizations(id) | SET NULL | NO ACTION | FOREIGN KEY (manual_target_org_id) REFERENCES organizations(id) ON DELETE SET NULL |
| donation_allocation_reviews_reviewed_by_user_id_fkey | reviewed_by_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (reviewed_by_user_id) REFERENCES userdata(id) ON DELETE SET NULL |

CHECK constraints:

- `donation_allocation_reviews_manual_target_type_check`: `CHECK (manual_target_type IS NULL OR (manual_target_type = ANY (ARRAY['org'::text, 'event'::text, 'unrestricted'::text])))`
- `donation_allocation_reviews_status_check`: `CHECK (status = ANY (ARRAY['pending_manual_review'::text, 'manually_allocated'::text, 'policy_allocated'::text, 'cancelled'::text]))`

Sample rows (redacted):

```json
[]
```

### public.donor_receipts

Role: Donor receipt rows tied to funded events.

Row count: 63

CREATE TABLE:

```sql
CREATE TABLE "public"."donor_receipts" (
  "id" bigint DEFAULT nextval('donor_receipts_id_seq'::regclass) NOT NULL,
  "donation_id" bigint,
  "event_id" uuid NOT NULL,
  "volunteer_user_id" integer NOT NULL,
  "wallet_tx_id" uuid NOT NULL,
  "credits_funded" integer NOT NULL,
  "minutes_verified" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "donor_receipts_pkey" PRIMARY KEY (id),
  CONSTRAINT "donor_receipts_donation_id_fkey" FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL,
  CONSTRAINT "donor_receipts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "donor_receipts_volunteer_user_id_fkey" FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "donor_receipts_wallet_tx_id_fkey" FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  CONSTRAINT "donor_receipts_credits_funded_check" CHECK (credits_funded >= 0),
  CONSTRAINT "donor_receipts_minutes_verified_check" CHECK (minutes_verified >= 0)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| donor_receipts_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX donor_receipts_pkey ON public.donor_receipts USING btree (id) |
| donor_receipts_wallet_tx_id_uniq | wallet_tx_id | yes | btree | CREATE UNIQUE INDEX donor_receipts_wallet_tx_id_uniq ON public.donor_receipts USING btree (wallet_tx_id) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| donor_receipts_donation_id_fkey | donation_id | public.donations(id) | SET NULL | NO ACTION | FOREIGN KEY (donation_id) REFERENCES donations(id) ON DELETE SET NULL |
| donor_receipts_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| donor_receipts_volunteer_user_id_fkey | volunteer_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id) ON DELETE CASCADE |
| donor_receipts_wallet_tx_id_fkey | wallet_tx_id | public.wallet_transactions(id) | CASCADE | NO ACTION | FOREIGN KEY (wallet_tx_id) REFERENCES wallet_transactions(id) ON DELETE CASCADE |

CHECK constraints:

- `donor_receipts_credits_funded_check`: `CHECK (credits_funded >= 0)`
- `donor_receipts_minutes_verified_check`: `CHECK (minutes_verified >= 0)`

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "donation_id": "1",
    "event_id": "a7b0f87c-ff4b-48d9-8400-b67e5ccfb12e",
    "volunteer_user_id": "[REDACTED]",
    "wallet_tx_id": "46f038cb-129a-4f83-9e56-4841f1c3a6d2",
    "credits_funded": 25,
    "minutes_verified": 90,
    "created_at": "2026-01-07T21:56:58.968Z"
  },
  {
    "id": "5",
    "donation_id": null,
    "event_id": "c2480717-8f47-443b-85be-ccd98cb90c96",
    "volunteer_user_id": "[REDACTED]",
    "wallet_tx_id": "6f0835dc-4365-40e7-b06d-db834f797b1c",
    "credits_funded": 25,
    "minutes_verified": 60,
    "created_at": "2026-02-23T19:25:17.471Z"
  },
  {
    "id": "6",
    "donation_id": null,
    "event_id": "7ba42905-4c47-4e48-aebf-01606c7ce762",
    "volunteer_user_id": "[REDACTED]",
    "wallet_tx_id": "7d8f0ad2-662e-4023-8175-18208ba242cf",
    "credits_funded": 25,
    "minutes_verified": 60,
    "created_at": "2026-02-28T17:22:32.007Z"
  }
]
```

### public.event_package_rollovers

Role: Event package rollover rows tied to events.

Row count: 0

CREATE TABLE:

```sql
CREATE TABLE "public"."event_package_rollovers" (
  "id" bigint DEFAULT nextval('event_package_rollovers_id_seq'::regclass) NOT NULL,
  "event_id" uuid NOT NULL,
  "organization_id" integer NOT NULL,
  "funding_credit_id" bigint NOT NULL,
  "unused_ic" integer NOT NULL,
  "status" text NOT NULL,
  "held_until" timestamp with time zone,
  "subscription_required" boolean DEFAULT true NOT NULL,
  "notified_at" timestamp with time zone,
  "rolled_over_at" timestamp with time zone,
  "expired_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "event_package_rollovers_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_package_rollovers_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "event_package_rollovers_funding_credit_id_fkey" FOREIGN KEY (funding_credit_id) REFERENCES funding_credits(id) ON DELETE CASCADE,
  CONSTRAINT "event_package_rollovers_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT "event_package_rollovers_status_check" CHECK (status = ANY (ARRAY['eligible_for_rollover'::text, 'held_pending_subscription'::text, 'rolled_to_org_pool'::text, 'expired_unused'::text, 'manually_overridden'::text])),
  CONSTRAINT "event_package_rollovers_unused_ic_check" CHECK (unused_ic >= 0)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| event_package_rollovers_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX event_package_rollovers_pkey ON public.event_package_rollovers USING btree (id) |
| event_package_rollovers_event_status_idx | event_id, status | no | btree | CREATE INDEX event_package_rollovers_event_status_idx ON public.event_package_rollovers USING btree (event_id, status) |
| event_package_rollovers_org_status_held_idx | organization_id, status, held_until | no | btree | CREATE INDEX event_package_rollovers_org_status_held_idx ON public.event_package_rollovers USING btree (organization_id, status, held_until) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| event_package_rollovers_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_package_rollovers_funding_credit_id_fkey | funding_credit_id | public.funding_credits(id) | CASCADE | NO ACTION | FOREIGN KEY (funding_credit_id) REFERENCES funding_credits(id) ON DELETE CASCADE |
| event_package_rollovers_organization_id_fkey | organization_id | public.organizations(id) | CASCADE | NO ACTION | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |

CHECK constraints:

- `event_package_rollovers_status_check`: `CHECK (status = ANY (ARRAY['eligible_for_rollover'::text, 'held_pending_subscription'::text, 'rolled_to_org_pool'::text, 'expired_unused'::text, 'manually_overridden'::text]))`
- `event_package_rollovers_unused_ic_check`: `CHECK (unused_ic >= 0)`

Sample rows (redacted):

```json
[]
```

### public.event_ratings

Role: Ratings tied to events.

Row count: 7

CREATE TABLE:

```sql
CREATE TABLE "public"."event_ratings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "rater_user_id" integer NOT NULL,
  "ratee_user_id" integer,
  "rater_role" text NOT NULL,
  "ratee_role" text NOT NULL,
  "stars" smallint NOT NULL,
  "tags" text[],
  "note" text,
  "revealed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ratee_org_id" integer,
  CONSTRAINT "event_ratings_pkey" PRIMARY KEY (id),
  CONSTRAINT "event_ratings_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "event_ratings_ratee_org_id_fkey" FOREIGN KEY (ratee_org_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT "event_ratings_ratee_role_check" CHECK (ratee_role = ANY (ARRAY['volunteer'::text, 'host'::text, 'organization'::text])),
  CONSTRAINT "event_ratings_ratee_target_check" CHECK (ratee_role = 'organization'::text AND ratee_org_id IS NOT NULL AND ratee_user_id IS NULL OR (ratee_role = ANY (ARRAY['volunteer'::text, 'host'::text])) AND ratee_user_id IS NOT NULL AND ratee_org_id IS NULL),
  CONSTRAINT "event_ratings_rater_role_check" CHECK (rater_role = ANY (ARRAY['volunteer'::text, 'host'::text])),
  CONSTRAINT "event_ratings_stars_check" CHECK (stars >= 1 AND stars <= 5)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| event_ratings_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX event_ratings_pkey ON public.event_ratings USING btree (id) |
| uq_event_ratings_pair | event_id, rater_user_id, rater_role, ratee_role, COALESCE(ratee_user_id, '-1'::integer), COALESCE(ratee_org_id, '-1'::integer) | yes | btree | CREATE UNIQUE INDEX uq_event_ratings_pair ON public.event_ratings USING btree (event_id, rater_user_id, rater_role, ratee_role, COALESCE(ratee_user_id, '-1'::integer), COALESCE(ratee_org_id, '-1'::integer)) |
| idx_event_ratings_event | event_id | no | btree | CREATE INDEX idx_event_ratings_event ON public.event_ratings USING btree (event_id) |
| idx_event_ratings_ratee_created | ratee_user_id, created_at | no | btree | CREATE INDEX idx_event_ratings_ratee_created ON public.event_ratings USING btree (ratee_user_id, created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| event_ratings_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| event_ratings_ratee_org_id_fkey | ratee_org_id | public.organizations(id) | CASCADE | NO ACTION | FOREIGN KEY (ratee_org_id) REFERENCES organizations(id) ON DELETE CASCADE |

CHECK constraints:

- `event_ratings_ratee_role_check`: `CHECK (ratee_role = ANY (ARRAY['volunteer'::text, 'host'::text, 'organization'::text]))`
- `event_ratings_ratee_target_check`: `CHECK (ratee_role = 'organization'::text AND ratee_org_id IS NOT NULL AND ratee_user_id IS NULL OR (ratee_role = ANY (ARRAY['volunteer'::text, 'host'::text])) AND ratee_user_id IS NOT NULL AND ratee_org_id IS NULL)`
- `event_ratings_rater_role_check`: `CHECK (rater_role = ANY (ARRAY['volunteer'::text, 'host'::text]))`
- `event_ratings_stars_check`: `CHECK (stars >= 1 AND stars <= 5)`

Sample rows (redacted):

```json
[
  {
    "id": "01bac763-1699-4a84-b4f6-8af2e15a63ed",
    "event_id": "c2480717-8f47-443b-85be-ccd98cb90c96",
    "rater_user_id": "[REDACTED]",
    "ratee_user_id": "[REDACTED]",
    "rater_role": "host",
    "ratee_role": "volunteer",
    "stars": 5,
    "tags": null,
    "note": "[REDACTED]",
    "revealed_at": null,
    "created_at": "2026-02-26T20:42:12.845Z",
    "ratee_org_id": null
  },
  {
    "id": "050c8555-86cd-4abb-80d3-52a006fee2a7",
    "event_id": "7ba42905-4c47-4e48-aebf-01606c7ce762",
    "rater_user_id": "[REDACTED]",
    "ratee_user_id": "[REDACTED]",
    "rater_role": "host",
    "ratee_role": "volunteer",
    "stars": 4,
    "tags": null,
    "note": "[REDACTED]",
    "revealed_at": null,
    "created_at": "2026-02-28T16:42:09.447Z",
    "ratee_org_id": null
  },
  {
    "id": "e1d11f73-8a80-4260-a5cb-6961530e8f11",
    "event_id": "7ba42905-4c47-4e48-aebf-01606c7ce762",
    "rater_user_id": "[REDACTED]",
    "ratee_user_id": "[REDACTED]",
    "rater_role": "host",
    "ratee_role": "volunteer",
    "stars": 4,
    "tags": null,
    "note": "[REDACTED]",
    "revealed_at": null,
    "created_at": "2026-02-28T16:42:35.465Z",
    "ratee_org_id": null
  }
]
```

### public.invite_abuse_reports

Role: Invite abuse reports with optional event FK.

Row count: 0

CREATE TABLE:

```sql
CREATE TABLE "public"."invite_abuse_reports" (
  "id" bigint DEFAULT nextval('invite_abuse_reports_id_seq'::regclass) NOT NULL,
  "invite_id" uuid NOT NULL,
  "reporter_user_id" integer NOT NULL,
  "sender_user_id" integer,
  "event_id" uuid,
  "reason" text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invite_abuse_reports_pkey" PRIMARY KEY (id),
  CONSTRAINT "invite_abuse_reports_invite_id_reporter_user_id_key" UNIQUE (invite_id, reporter_user_id),
  CONSTRAINT "invite_abuse_reports_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "invite_abuse_reports_invite_id_fkey" FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE,
  CONSTRAINT "invite_abuse_reports_reporter_user_id_fkey" FOREIGN KEY (reporter_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "invite_abuse_reports_sender_user_id_fkey" FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE SET NULL,
  CONSTRAINT "invite_abuse_reports_status_check" CHECK (status = ANY (ARRAY['open'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| invite_abuse_reports_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX invite_abuse_reports_pkey ON public.invite_abuse_reports USING btree (id) |
| invite_abuse_reports_invite_id_reporter_user_id_key | invite_id, reporter_user_id | yes | btree | CREATE UNIQUE INDEX invite_abuse_reports_invite_id_reporter_user_id_key ON public.invite_abuse_reports USING btree (invite_id, reporter_user_id) |
| idx_invite_abuse_reports_reporter_created | reporter_user_id, created_at | no | btree | CREATE INDEX idx_invite_abuse_reports_reporter_created ON public.invite_abuse_reports USING btree (reporter_user_id, created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| invite_abuse_reports_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| invite_abuse_reports_invite_id_fkey | invite_id | public.invites(id) | CASCADE | NO ACTION | FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE CASCADE |
| invite_abuse_reports_reporter_user_id_fkey | reporter_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (reporter_user_id) REFERENCES userdata(id) ON DELETE CASCADE |
| invite_abuse_reports_sender_user_id_fkey | sender_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE SET NULL |

CHECK constraints:

- `invite_abuse_reports_status_check`: `CHECK (status = ANY (ARRAY['open'::text, 'reviewing'::text, 'resolved'::text, 'dismissed'::text]))`

Sample rows (redacted):

```json
[]
```

### public.invite_moderation_logs

Role: Invite moderation logs with optional event FK.

Row count: 1

CREATE TABLE:

```sql
CREATE TABLE "public"."invite_moderation_logs" (
  "id" bigint DEFAULT nextval('invite_moderation_logs_id_seq'::regclass) NOT NULL,
  "event_id" uuid,
  "invite_id" uuid,
  "sender_user_id" integer,
  "recipient_user_id" integer,
  "action" text NOT NULL,
  "reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invite_moderation_logs_pkey" PRIMARY KEY (id),
  CONSTRAINT "invite_moderation_logs_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT "invite_moderation_logs_invite_id_fkey" FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE SET NULL,
  CONSTRAINT "invite_moderation_logs_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES userdata(id) ON DELETE SET NULL,
  CONSTRAINT "invite_moderation_logs_sender_user_id_fkey" FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE SET NULL
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| invite_moderation_logs_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX invite_moderation_logs_pkey ON public.invite_moderation_logs USING btree (id) |
| idx_invite_moderation_logs_event_created | event_id, created_at | no | btree | CREATE INDEX idx_invite_moderation_logs_event_created ON public.invite_moderation_logs USING btree (event_id, created_at DESC) |
| idx_invite_moderation_logs_sender_created | sender_user_id, created_at | no | btree | CREATE INDEX idx_invite_moderation_logs_sender_created ON public.invite_moderation_logs USING btree (sender_user_id, created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| invite_moderation_logs_event_id_fkey | event_id | public.events(id) | SET NULL | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL |
| invite_moderation_logs_invite_id_fkey | invite_id | public.invites(id) | SET NULL | NO ACTION | FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE SET NULL |
| invite_moderation_logs_recipient_user_id_fkey | recipient_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (recipient_user_id) REFERENCES userdata(id) ON DELETE SET NULL |
| invite_moderation_logs_sender_user_id_fkey | sender_user_id | public.userdata(id) | SET NULL | NO ACTION | FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE SET NULL |

CHECK constraints:

None.

Sample rows (redacted):

```json
[
  {
    "id": "1",
    "event_id": "f975f057-483d-4591-94b8-41acfcacb88e",
    "invite_id": "9dde3655-70d9-42f2-bac3-675e80d81c8f",
    "sender_user_id": "[REDACTED]",
    "recipient_user_id": "[REDACTED]",
    "action": "invite_sent",
    "reason": "ok",
    "metadata": {
      "tone": "friendly",
      "sendByKai": false,
      "inviteeEmail": "[REDACTED]"
    },
    "created_at": "2026-03-25T00:23:06.271Z"
  }
]
```

### public.invites

Role: Invite rows tied to events.

Row count: 7

CREATE TABLE:

```sql
CREATE TABLE "public"."invites" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "sender_user_id" integer NOT NULL,
  "recipient_user_id" integer,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp with time zone,
  "invitee_email" text NOT NULL,
  "invitee_name" text,
  CONSTRAINT "invites_pkey" PRIMARY KEY (id),
  CONSTRAINT "invites_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT "invites_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "invites_sender_user_id_fkey" FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE CASCADE,
  CONSTRAINT "invites_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text]))
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| invites_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX invites_pkey ON public.invites USING btree (id) |
| uq_invites_event_email | event_id, invitee_email | yes | btree | CREATE UNIQUE INDEX uq_invites_event_email ON public.invites USING btree (event_id, invitee_email) |
| uq_invites_event_recipient | event_id, recipient_user_id | yes | btree | CREATE UNIQUE INDEX uq_invites_event_recipient ON public.invites USING btree (event_id, recipient_user_id) |
| idx_invites_event_lower_email_created_at | event_id, lower(invitee_email), created_at | no | btree | CREATE INDEX idx_invites_event_lower_email_created_at ON public.invites USING btree (event_id, lower(invitee_email), created_at DESC) |
| idx_invites_event_recipient_created_at | event_id, recipient_user_id, created_at | no | btree | CREATE INDEX idx_invites_event_recipient_created_at ON public.invites USING btree (event_id, recipient_user_id, created_at DESC) |
| idx_invites_event_sender_created_at | event_id, sender_user_id, created_at | no | btree | CREATE INDEX idx_invites_event_sender_created_at ON public.invites USING btree (event_id, sender_user_id, created_at DESC) |
| idx_invites_recipient_created | recipient_user_id, created_at | no | btree | CREATE INDEX idx_invites_recipient_created ON public.invites USING btree (recipient_user_id, created_at DESC) |
| idx_invites_sender_created | sender_user_id, created_at | no | btree | CREATE INDEX idx_invites_sender_created ON public.invites USING btree (sender_user_id, created_at DESC) |
| idx_invites_sender_created_at | sender_user_id, created_at | no | btree | CREATE INDEX idx_invites_sender_created_at ON public.invites USING btree (sender_user_id, created_at DESC) |
| idx_invites_sender_lower_email_created_at | sender_user_id, lower(invitee_email), created_at | no | btree | CREATE INDEX idx_invites_sender_lower_email_created_at ON public.invites USING btree (sender_user_id, lower(invitee_email), created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| invites_event_id_fkey | event_id | public.events(id) | CASCADE | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE |
| invites_recipient_user_id_fkey | recipient_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (recipient_user_id) REFERENCES userdata(id) ON DELETE CASCADE |
| invites_sender_user_id_fkey | sender_user_id | public.userdata(id) | CASCADE | NO ACTION | FOREIGN KEY (sender_user_id) REFERENCES userdata(id) ON DELETE CASCADE |

CHECK constraints:

- `invites_status_check`: `CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text]))`

Sample rows (redacted):

```json
[
  {
    "id": "325e8e88-d1af-4ad3-b903-c337dc19a487",
    "event_id": "4eb7e350-c196-43fd-b370-7306aac6cf65",
    "sender_user_id": "[REDACTED]",
    "recipient_user_id": "[REDACTED]",
    "status": "pending",
    "created_at": "2025-11-13T19:36:38.721Z",
    "responded_at": null,
    "invitee_email": "[REDACTED]",
    "invitee_name": "[REDACTED]"
  },
  {
    "id": "e21fb1ca-caa2-437c-815d-ae6f614095a5",
    "event_id": "a7b0f87c-ff4b-48d9-8400-b67e5ccfb12e",
    "sender_user_id": "[REDACTED]",
    "recipient_user_id": null,
    "status": "pending",
    "created_at": "2026-01-05T19:14:16.340Z",
    "responded_at": null,
    "invitee_email": "[REDACTED]",
    "invitee_name": null
  },
  {
    "id": "bc5160cf-6a8e-4580-9140-c5816f691806",
    "event_id": "e6781746-12a8-4b38-acd5-6273750187ef",
    "sender_user_id": "[REDACTED]",
    "recipient_user_id": "[REDACTED]",
    "status": "pending",
    "created_at": "2026-02-13T22:59:57.310Z",
    "responded_at": null,
    "invitee_email": "[REDACTED]",
    "invitee_name": "[REDACTED]"
  }
]
```

### public.pending_credit_requests

Role: Pending credit request rows tied to events.

Row count: 51

CREATE TABLE:

```sql
CREATE TABLE "public"."pending_credit_requests" (
  "id" integer DEFAULT nextval('pending_credit_requests_id_seq'::regclass) NOT NULL,
  "event_id" uuid,
  "volunteer_user_id" integer,
  "org_id" integer,
  "requested_by" integer,
  "amount" numeric NOT NULL,
  "reason" text,
  "status" character varying(50) DEFAULT 'pending'::character varying NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "reviewed_at" timestamp with time zone,
  "reviewed_by" character varying(255),
  CONSTRAINT "pending_credit_requests_pkey" PRIMARY KEY (id),
  CONSTRAINT "pending_credit_requests_event_id_fkey" FOREIGN KEY (event_id) REFERENCES events(id),
  CONSTRAINT "pending_credit_requests_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT "pending_credit_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES userdata(id),
  CONSTRAINT "pending_credit_requests_volunteer_user_id_fkey" FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id)
);
```

Indexes:

| Name | Columns / expressions | Unique | Type | Definition |
|---|---|---:|---|---|
| pending_credit_requests_pkey | id | yes (primary) | btree | CREATE UNIQUE INDEX pending_credit_requests_pkey ON public.pending_credit_requests USING btree (id) |
| pending_credit_requests_event_volunteer_pending_idx | event_id, volunteer_user_id | yes | btree | CREATE UNIQUE INDEX pending_credit_requests_event_volunteer_pending_idx ON public.pending_credit_requests USING btree (event_id, volunteer_user_id) WHERE ((status)::text = 'pending'::text) |
| pending_credit_requests_status_idx | status, created_at | no | btree | CREATE INDEX pending_credit_requests_status_idx ON public.pending_credit_requests USING btree (status, created_at DESC) |

Foreign keys:

| Constraint | Column(s) | References | ON DELETE | ON UPDATE | Definition |
|---|---|---|---|---|---|
| pending_credit_requests_event_id_fkey | event_id | public.events(id) | NO ACTION | NO ACTION | FOREIGN KEY (event_id) REFERENCES events(id) |
| pending_credit_requests_org_id_fkey | org_id | public.organizations(id) | NO ACTION | NO ACTION | FOREIGN KEY (org_id) REFERENCES organizations(id) |
| pending_credit_requests_requested_by_fkey | requested_by | public.userdata(id) | NO ACTION | NO ACTION | FOREIGN KEY (requested_by) REFERENCES userdata(id) |
| pending_credit_requests_volunteer_user_id_fkey | volunteer_user_id | public.userdata(id) | NO ACTION | NO ACTION | FOREIGN KEY (volunteer_user_id) REFERENCES userdata(id) |

CHECK constraints:

None.

Sample rows (redacted):

```json
[
  {
    "id": 2,
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "volunteer_user_id": "[REDACTED]",
    "org_id": 3,
    "requested_by": 9,
    "amount": "75",
    "reason": "earn_shift",
    "status": "approved",
    "created_at": "2026-04-19T03:27:54.495Z",
    "reviewed_at": "2026-04-22T15:14:22.310Z",
    "reviewed_by": "[REDACTED]"
  },
  {
    "id": 3,
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "volunteer_user_id": "[REDACTED]",
    "org_id": 3,
    "requested_by": 9,
    "amount": "75",
    "reason": "earn_shift",
    "status": "approved",
    "created_at": "2026-04-19T03:27:55.670Z",
    "reviewed_at": "2026-04-22T15:14:27.912Z",
    "reviewed_by": "[REDACTED]"
  },
  {
    "id": 4,
    "event_id": "e74b559c-ef6c-48cc-972c-dcac96d328d3",
    "volunteer_user_id": "[REDACTED]",
    "org_id": 3,
    "requested_by": 9,
    "amount": "75",
    "reason": "earn_shift",
    "status": "approved",
    "created_at": "2026-04-19T03:27:56.432Z",
    "reviewed_at": "2026-04-22T15:14:31.229Z",
    "reviewed_by": "[REDACTED]"
  }
]
```

## Routes

### Mount Points

- `index.js`: `app.use("/api/kai", kaiRouter)`
- `index.js`: `app.use("/api/organizations", organizationsApiRouter)`
- `index.js`: `app.use("/api/events", eventsApiRouter)`
- `index.js`: `app.use("/api/me/events", ensureAuthenticatedApi, meEventsRouter)`
- `index.js`: `app.use("/api/org", ensureAuthenticatedApi, orgPortalRouter)`
- `index.js`: `app.use("/", orgApplyRouter)`

### Org Portal Routes

`index.js` page/form routes:

| Method | Path | Handler | Notes |
|---|---|---|---|
| POST | /org-portal/logo | anonymous async handler after `uploadAvatar.single("logo")` | Updates `public.organizations.logo_url`. |
| POST | /org-portal/description | anonymous async handler | Updates `public.organizations.description`. |
| GET | /org-portal | anonymous async handler after `ensureOrgRepPage` | Renders `views/org-portal.ejs`. |
| GET | /checkin/:eventId | anonymous render handler after `ensureAuthenticated` | Renders `views/checkin.ejs`. |

`routes/orgPortalApi.js` mounted at `/api/org`:

| Method | Full path | Handler |
|---|---|---|
| USE | /api/org/* | anonymous scope/suspension middleware |
| GET | /api/org/context | anonymous async handler |
| POST | /api/org/active-org | anonymous async handler |
| GET | /api/org/comms/queue | anonymous async handler |
| POST | /api/org/comms/send | anonymous async handler |
| GET | /api/org/queue | anonymous async handler |
| GET | /api/org/opportunities | anonymous async handler |
| GET | /api/org/schedule | anonymous async handler |
| GET | /api/org/opportunities/:eventId/applicants | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/approve | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/decline | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/verify | anonymous async handler calling `awardIcForRsvp` |
| GET | /api/org/credits | anonymous async handler |
| GET | /api/org/credits/:eventId | anonymous async handler |
| GET | /api/org/reports | anonymous async handler |
| GET | /api/org/kpis | anonymous async handler |

`routes/orgApplyApi.js` mounted at `/` and related to org onboarding/access:

| Method | Full path | Handler |
|---|---|---|
| GET | /org-apply | anonymous async handler after `ensureAuthenticated` |
| POST | /org-apply | anonymous async handler after `ensureAuthenticated` |
| GET | /admin/org-applications | anonymous async handler after `ensureAuthenticated`, `ensureAdmin` |
| POST | /admin/org-applications/:id/approve | anonymous async handler after `ensureAuthenticated`, `ensureAdmin` |
| POST | /admin/org-applications/:id/decline | anonymous async handler after `ensureAuthenticated`, `ensureAdmin` |

### Opportunity Creation, Editing, and Listing Routes

`routes/eventsApi.js` mounted at `/api/events`:

| Method | Full path | Handler function | Owner file |
|---|---|---|---|
| GET | /api/events/ | listEvents | controllers/eventsApiController.js |
| GET | /api/events/:id | getEventById | controllers/eventsApiController.js |
| GET | /api/events/:id/calendar.ics | downloadEventCalendar | controllers/eventsApiController.js |
| POST | /api/events/ | createEvent | controllers/eventsApiController.js |
| POST | /api/events/:id/cancel | cancelEvent | controllers/meEventsApiController.js |
| POST | /api/events/:id/force-cancel | forceCancelEvent | controllers/meEventsApiController.js |
| POST | /api/events/:id/complete | completeEvent | controllers/meEventsApiController.js |
| POST | /api/events/:id/invites | createInvite | controllers/eventsApiController.js |
| POST | /api/events/:id/admin-signup | createAdminSignup | controllers/eventsApiController.js |
| POST | /api/events/:id/invite-copy | draftInviteCopy | controllers/eventsApiController.js |
| PATCH | /api/events/:id | updateEvent | controllers/eventsApiController.js |
| DELETE | /api/events/:id | deleteDraftEvent | controllers/meEventsApiController.js |

`routes/eventsApi.js` / `organizationsApiRouter` mounted at `/api/organizations`:

| Method | Full path | Handler |
|---|---|---|
| GET | /api/organizations/ | anonymous async handler calling `fetchOrganizations` |
| GET | /api/organizations/:orgId/events | anonymous async handler calling `fetchEventsByOrg` |

`index.js` page routes for opportunity UI:

| Method | Path | Handler | Template |
|---|---|---|---|
| GET | /events | getEventsPage | views/events.ejs |
| GET | /events/:id | getEventsPage | views/events.ejs |
| GET | /events/:id/rsvp/thanks | redirect handler | redirects to /event-rsvp-thanks |

`routes/orgPortalApi.js` opportunity list/schedule/admin paths under `/api/org`:

| Method | Full path | Handler |
|---|---|---|
| GET | /api/org/opportunities | anonymous async handler |
| GET | /api/org/schedule | anonymous async handler |
| GET | /api/org/opportunities/:eventId/applicants | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/approve | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/decline | anonymous async handler |
| POST | /api/org/opportunities/:eventId/applicants/:userId/verify | anonymous async handler |

### RSVP, Check-in, and Attendance Routes

| Method | Full path | Handler function | Owner file |
|---|---|---|---|
| POST | /api/events/:id/rsvp | respondToEventRsvp | controllers/eventsApiController.js |
| POST | /api/events/:id/checkins | checkInToEvent | controllers/eventsApiController.js |
| GET | /api/events/:id/roster | listEventRoster | controllers/eventsApiController.js |
| POST | /api/events/:id/no-show | markEventNoShow | controllers/eventsApiController.js |
| POST | /api/events/:id/verify | verifyEventRsvp | controllers/eventsApiController.js |
| POST | /api/events/:id/admin-signup | createAdminSignup | controllers/eventsApiController.js |
| POST | /api/org/opportunities/:eventId/applicants/:userId/approve | anonymous async handler | routes/orgPortalApi.js |
| POST | /api/org/opportunities/:eventId/applicants/:userId/decline | anonymous async handler | routes/orgPortalApi.js |
| POST | /api/org/opportunities/:eventId/applicants/:userId/verify | anonymous async handler -> awardIcForRsvp | routes/orgPortalApi.js / Backend/services/icService.js |
| POST | /api/kai/verify-attendance | anonymous async handler -> awardIcForRsvp | Backend/routes/kaiApi.js / Backend/services/icService.js |
| GET | /checkin/:eventId | anonymous render handler | index.js |

Service-level RSVP/attendance functions:

- `services/eventRsvpService.js`: `applyEventRsvpAction({ eventId, attendeeId, action, hostUserIds, roleId, reason, requireExistingForDecline })` inserts/updates `event_rsvps` and handles waitlist promotion.
- `services/eventRsvpService.js`: `getEventRsvpSnapshot(eventId, userId, { runner })` reads current RSVP status and accepted count.
- `Backend/services/icService.js`: `awardIcForRsvp(pool, { userId, eventId })` verifies RSVP and inserts `wallet_transactions` credit.
- `services/earnShiftReconcileService.js`: `reconcileEarnShiftCredits({ limit, dryRun })` backfills/settles verified RSVP earn-shift credits and funding.
## Templates

The current org portal tabs are rendered by the React entry in `frontend/orgPortal.jsx`, mounted into `views/org-portal.ejs`. I found no separate EJS partial per tab.

| Visible UI tab | EJS template file | Client component file | Notes |
|---|---|---|---|
| Opportunities | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Schedule | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Check-in & Check-Out | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Reconcile | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Comms | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Funding & Events | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |
| Reports | views/org-portal.ejs | frontend/orgPortal.jsx | Same EJS template/root; tab body is client-rendered. |

Additional related EJS templates:

- `views/checkin.ejs`: check-in page rendered by `GET /checkin/:eventId`.
- `views/events.ejs`: public/event app shell rendered by `getEventsPage`.
- `views/event-rsvp-thanks.ejs`: RSVP confirmation page rendered by `getEventRsvpThanksPage`.
- `views/org-apply.ejs`: organization application page.
- `views/partials/site-header.ejs`: included by `views/org-portal.ejs`.
## KAI tools

KAI does not directly insert an event/opportunity in the current tool executor. The only event-creation-related tool returns a draft payload for review in the editor.

| Tool | Definition file | Handler file | Handler | Creates DB row? |
|---|---|---|---|---|
| draft_event_listing | Backend/services/kai-tool-definitions.js | Backend/services/kai-tool-executor.js | handleDraftEventListing(toolInput = {}, _userId, orgId) | No; returns a draft object with status `draft`. |

JSON input schema for `draft_event_listing`:

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string"
    },
    "date": {
      "type": "string"
    },
    "location": {
      "type": "string"
    },
    "volunteer_count": {
      "type": "integer"
    }
  },
  "required": [
    "description"
  ],
  "additionalProperties": false
}
```

Other KAI event lifecycle tools found but not event-creating: `search_events`, `get_event_details`, `rsvp_to_event`, `cancel_rsvp`, `get_matched_events`, `manage_schedule`, `auto_find_and_rsvp` (TODO/not implemented), `get_matched_volunteers`, `flag_noshow_risk`, `send_volunteer_reminder`, `auto_staff_event`, and `generate_post_event_report`. Their schemas are in `Backend/services/kai-tool-definitions.js`; handlers are in `Backend/services/kai-tool-executor.js`.

## Dashboard queries

Primary org dashboard KPI endpoint: `routes/orgPortalApi.js`, route `GET /api/org/kpis`, anonymous async handler. It resolves host scope with `resolveUserIdCandidates(req)` and uses `EXCLUDE_HOST_SELF_RSVP_SQL = "r.attendee_user_id::text <> e.creator_user_id::text"`.

### totalHours

```sql
SELECT COALESCE(SUM(COALESCE(r.attended_minutes, 0)), 0)::numeric / 60.0 AS total_hours
FROM event_rsvps r
JOIN events e ON e.id = r.event_id
WHERE e.creator_user_id::text = ANY($1::text[])
  AND ${EXCLUDE_HOST_SELF_RSVP_SQL}
  AND r.verification_status = 'verified'
```

### fillRate

```sql
WITH per_event AS (
  SELECT
    e.id,
    e.capacity::numeric AS capacity,
    COUNT(r.id)::numeric AS accepted_count
  FROM events e
  LEFT JOIN event_rsvps r
    ON r.event_id = e.id
   AND r.status = 'accepted'
   AND ${EXCLUDE_HOST_SELF_RSVP_SQL}
  WHERE e.creator_user_id::text = ANY($1::text[])
    AND e.capacity IS NOT NULL
    AND e.capacity > 0
  GROUP BY e.id, e.capacity
)
SELECT COALESCE(ROUND(AVG(LEAST(1.0, accepted_count / capacity)) * 100, 1), 0)::numeric AS fill_rate
FROM per_event
```

### impactCredits available

```sql
SELECT
  COALESCE(
    SUM(
      CASE
        WHEN pt.direction = 'credit' THEN pt.amount_credits
        WHEN pt.direction = 'debit' THEN -pt.amount_credits
        ELSE 0
      END
    ),
    0
  )::numeric AS impact_credits
FROM funding_pools fp
JOIN UNNEST($1::text[]) pref(prefix)
  ON LEFT(fp.slug, LENGTH(pref.prefix)) = pref.prefix
LEFT JOIN pool_transactions pt ON pt.pool_id = fp.id
```

Parameter note: the handler builds `scopedPoolPrefixes = hostUserIds.map((id) => `u${id}__`)` and passes that as `$1::text[]`.

### noShowRate

```sql
WITH per_event AS (
  SELECT
    e.id,
    COUNT(*) FILTER (WHERE r.no_show = true)::numeric AS no_show_count,
    COUNT(*) FILTER (
      WHERE r.status IN ('accepted', 'checked_in')
         OR r.no_show = true
    )::numeric AS approved_attendance_count
  FROM events e
  LEFT JOIN event_rsvps r
    ON r.event_id = e.id
   AND ${EXCLUDE_HOST_SELF_RSVP_SQL}
  WHERE e.creator_user_id::text = ANY($1::text[])
  GROUP BY e.id
)
SELECT
  CASE
    WHEN COALESCE(SUM(approved_attendance_count), 0) > 0
      THEN ROUND((SUM(no_show_count) / SUM(approved_attendance_count)) * 100, 1)
    ELSE 0
  END::numeric AS no_show_rate
FROM per_event
```

Secondary reporting endpoint: `routes/orgPortalApi.js`, route `GET /api/org/reports`, anonymous async handler. It produces daily range series for hours, fill rate, impact credits earned, no-show rate, top volunteers, opportunity filters, and volunteer filters. The metrics use the same core tables: `events`, `event_rsvps`, `wallet_transactions`, and user data.

## Notes and uncertainties

- The configured app DB helper selected `DATABASE_URL`, not a separate local Postgres fallback in this environment. That means this report reflects the currently configured app database, which is the same selection Express would use on port 5001.
- `public.opportunities` does not exist. The route/UI naming says “opportunities,” but persistence uses `public.events`.
- There is no separate check-ins/attendance table. Check-in, no-show, verification, attended minutes, and verified-at state live on `public.event_rsvps`.
- There is no recurrence/series table visible in the database. Scheduling is one row per event with `start_at`, `end_at`, and `tz`; role staffing is modeled in `event_roles`.
- The org portal UI tabs are not EJS partials. `views/org-portal.ejs` mounts React from `frontend/orgPortal.jsx`, where the tab labels and tab bodies live.
- KAI `draft_event_listing` does not insert into `events`; actual creation is `POST /api/events/` -> `createEvent`.
- There are two IC-related ledger concepts: volunteer wallet credits in `wallet_transactions`, and funding/donor ledgers in `funding_pools`, `pool_transactions`, `funding_credits`, and `donor_ic_ledger`. The top org KPI “impact credits” availability uses funding pools plus pool transactions, not volunteer wallet transactions.
- Sample row redaction is conservative, so representative rows may hide organization names, user IDs, locations, URLs, descriptions, and notes. The schema, constraints, indexes, counts, and query text are unredacted.
