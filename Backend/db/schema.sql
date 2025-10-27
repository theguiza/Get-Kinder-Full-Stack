--
-- PostgreSQL database dump
--

\restrict u8bCMCrZSB4rAFSuzzDiyJ3T1GGLgjYQhvfvRux94WeRPnXWDYAcaMnzzuUjOu4

-- Dumped from database version 16.9 (Debian 16.9-1.pgdg120+1)
-- Dumped by pg_dump version 18.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: arc_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arc_revisions (
    id bigint NOT NULL,
    arc_id text NOT NULL,
    old_template_id bigint,
    new_template_id bigint,
    reason text NOT NULL,
    quiz_snapshot jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: arc_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.arc_revisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: arc_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.arc_revisions_id_seq OWNED BY public.arc_revisions.id;


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    icon character varying(255),
    description text,
    points_required integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.badges_id_seq OWNED BY public.badges.id;


--
-- Name: challenge_day_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_day_templates (
    id integer NOT NULL,
    challenge_id integer NOT NULL,
    day_number integer NOT NULL,
    day_title character varying(255) NOT NULL,
    principle text,
    body text,
    suggested_acts jsonb
);


--
-- Name: challenge_day_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenge_day_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenge_day_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenge_day_templates_id_seq OWNED BY public.challenge_day_templates.id;


--
-- Name: challenge_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    challenge_id integer NOT NULL,
    day_number integer NOT NULL,
    reflection text,
    completed boolean DEFAULT false,
    completed_at timestamp without time zone,
    kai_notes text
);


--
-- Name: challenge_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenge_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenge_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenge_logs_id_seq OWNED BY public.challenge_logs.id;


--
-- Name: challenge_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenge_templates (
    id bigint NOT NULL,
    title_template text NOT NULL,
    description_template text NOT NULL,
    effort text NOT NULL,
    channel text NOT NULL,
    est_minutes integer NOT NULL,
    points integer NOT NULL,
    swaps_allowed integer DEFAULT 1 NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT challenge_templates_channel_check CHECK ((channel = ANY (ARRAY['text'::text, 'call'::text, 'irl'::text, 'any'::text]))),
    CONSTRAINT challenge_templates_effort_check CHECK ((effort = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT challenge_templates_est_minutes_check CHECK (((est_minutes >= 1) AND (est_minutes <= 60))),
    CONSTRAINT challenge_templates_points_check CHECK (((points >= 1) AND (points <= 50))),
    CONSTRAINT challenge_templates_swaps_allowed_check CHECK (((swaps_allowed >= 0) AND (swaps_allowed <= 5)))
);


--
-- Name: challenge_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenge_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenge_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenge_templates_id_seq OWNED BY public.challenge_templates.id;


--
-- Name: challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.challenges (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    total_days integer NOT NULL,
    is_active boolean DEFAULT true,
    ai_prompt_template text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.challenges_id_seq OWNED BY public.challenges.id;


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id integer,
    thread_id character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: friend_arcs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friend_arcs (
    id text NOT NULL,
    name text NOT NULL,
    day integer DEFAULT 0 NOT NULL,
    length integer DEFAULT 0 NOT NULL,
    arc_points integer DEFAULT 0 NOT NULL,
    next_threshold integer DEFAULT 100 NOT NULL,
    points_today integer DEFAULT 0 NOT NULL,
    friend_score integer,
    friend_type text,
    quiz_session_id text,
    lifetime jsonb DEFAULT '{}'::jsonb NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    challenge jsonb,
    badges jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer NOT NULL
);


--
-- Name: friends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.friends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_user_id integer NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(255),
    phone character varying(50),
    archetype_primary text,
    archetype_secondary text,
    score smallint,
    evidence_direct numeric(4,3) DEFAULT 0,
    evidence_proxy numeric(4,3) DEFAULT 0,
    flags_count integer DEFAULT 0,
    red_flags text[] DEFAULT '{}'::text[],
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    picture text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT friends_archetype_primary_check CHECK ((archetype_primary = ANY (ARRAY['Confidante'::text, 'Anchor'::text, 'Adventurer'::text, 'Communicator'::text, 'Connector'::text, 'Coach'::text, 'Collaborator'::text, 'Caregiver'::text]))),
    CONSTRAINT friends_archetype_secondary_check CHECK (((archetype_secondary IS NULL) OR (archetype_secondary = ANY (ARRAY['Confidante'::text, 'Anchor'::text, 'Adventurer'::text, 'Communicator'::text, 'Connector'::text, 'Coach'::text, 'Collaborator'::text, 'Caregiver'::text])))),
    CONSTRAINT friends_evidence_direct_check CHECK (((evidence_direct >= (0)::numeric) AND (evidence_direct <= (1)::numeric))),
    CONSTRAINT friends_evidence_proxy_check CHECK (((evidence_proxy >= (0)::numeric) AND (evidence_proxy <= (1)::numeric))),
    CONSTRAINT friends_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    item_id integer NOT NULL,
    name character varying,
    description character varying,
    owner_id integer
);


--
-- Name: items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.items_item_id_seq OWNED BY public.items.item_id;


--
-- Name: kai_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kai_interactions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    context_type character varying(50),
    context_id integer,
    message text,
    assistant_response text,
    function_called character varying(100),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: kai_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kai_interactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kai_interactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kai_interactions_id_seq OWNED BY public.kai_interactions.id;


--
-- Name: nudges_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nudges_outbox (
    id bigint NOT NULL,
    owner_user_id integer NOT NULL,
    friend_id uuid,
    channel text NOT NULL,
    to_address text,
    subject text,
    body_text text,
    body_html text,
    send_after timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    to_addr_lower text GENERATED ALWAYS AS (lower(to_address)) STORED,
    body_md5 text GENERATED ALWAYS AS (md5(COALESCE(body_text, ''::text))) STORED,
    send_day_utc date GENERATED ALWAYS AS (((send_after AT TIME ZONE 'UTC'::text))::date) STORED,
    CONSTRAINT nudges_outbox_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'sms'::text]))),
    CONSTRAINT nudges_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: nudges_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nudges_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nudges_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nudges_outbox_id_seq OWNED BY public.nudges_outbox.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    order_id integer NOT NULL,
    user_id integer,
    item_id integer
);


--
-- Name: orders_order_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orders_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orders_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orders_order_id_seq OWNED BY public.orders.order_id;


--
-- Name: plan_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_templates (
    id bigint NOT NULL,
    name text NOT NULL,
    tier text NOT NULL,
    length_days integer NOT NULL,
    cadence_per_week integer NOT NULL,
    channel_variant text NOT NULL,
    channel text DEFAULT 'mixed'::text,
    effort text DEFAULT 'medium'::text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plan_templates_cadence_per_week_check CHECK (((cadence_per_week >= 1) AND (cadence_per_week <= 7))),
    CONSTRAINT plan_templates_channel_variant_check CHECK ((channel_variant = ANY (ARRAY['text'::text, 'call'::text, 'irl'::text, 'mixed'::text]))),
    CONSTRAINT plan_templates_length_days_check CHECK (((length_days >= 7) AND (length_days <= 60))),
    CONSTRAINT plan_templates_tier_check CHECK ((tier = ANY (ARRAY['Acquaintance'::text, 'Casual Friend'::text, 'Friend'::text, 'Close Friend'::text, 'Best Friend'::text])))
);


--
-- Name: plan_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_templates_id_seq OWNED BY public.plan_templates.id;


--
-- Name: quest_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quest_logs (
    id integer NOT NULL,
    user_id integer NOT NULL,
    quest_id integer NOT NULL,
    day_number integer NOT NULL,
    task_generated text,
    reflection text,
    completed boolean DEFAULT false,
    completed_at timestamp without time zone
);


--
-- Name: quest_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quest_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quest_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quest_logs_id_seq OWNED BY public.quest_logs.id;


--
-- Name: quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quests (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    total_days integer NOT NULL,
    is_active boolean DEFAULT true,
    random_task_seed text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    difficulty character varying(20) DEFAULT 'Medium'::character varying
);


--
-- Name: quests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.quests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: quests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.quests_id_seq OWNED BY public.quests.id;


--
-- Name: step_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.step_templates (
    id bigint NOT NULL,
    plan_template_id bigint NOT NULL,
    day_number integer NOT NULL,
    title_template text NOT NULL,
    title text,
    meta_template text,
    meta text,
    channel text NOT NULL,
    effort text NOT NULL,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT step_templates_channel_check CHECK ((channel = ANY (ARRAY['text'::text, 'call'::text, 'irl'::text]))),
    CONSTRAINT step_templates_effort_check CHECK ((effort = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))
);


--
-- Name: step_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.step_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: step_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.step_templates_id_seq OWNED BY public.step_templates.id;


--
-- Name: user_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_badges (
    id integer NOT NULL,
    user_id integer NOT NULL,
    badge_id integer NOT NULL,
    earned_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: user_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_badges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_badges_id_seq OWNED BY public.user_badges.id;


--
-- Name: user_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_challenges (
    id integer NOT NULL,
    user_id integer NOT NULL,
    challenge_id integer NOT NULL,
    status character varying(50) NOT NULL,
    current_day integer DEFAULT 0,
    start_date date,
    completed_at date
);


--
-- Name: user_challenges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_challenges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_challenges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_challenges_id_seq OWNED BY public.user_challenges.id;


--
-- Name: user_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_quests (
    id integer NOT NULL,
    user_id integer NOT NULL,
    quest_id integer NOT NULL,
    status character varying(50) NOT NULL,
    current_day integer DEFAULT 0,
    start_date date,
    completed_at date
);


--
-- Name: user_quests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_quests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_quests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_quests_id_seq OWNED BY public.user_quests.id;


--
-- Name: user_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: userdata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.userdata (
    id integer NOT NULL,
    firstname character varying(255) NOT NULL,
    lastname character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255),
    phone character varying(50),
    address1 character varying(255),
    kindness_style character varying(255),
    city character varying(100),
    state character varying(100),
    country character varying(100),
    interest1 character varying(100),
    interest2 character varying(100),
    interest3 character varying(100),
    sdg1 character varying(100),
    sdg2 character varying(100),
    sdg3 character varying(100),
    google_id character varying(255),
    facebook_id character varying(255),
    picture text,
    has_seen_onboarding boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    why_friend text,
    known_connection text,
    desired_outcome text,
    hours_per_week integer,
    age_bracket text
);


--
-- Name: userdata_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.userdata_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: userdata_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.userdata_id_seq OWNED BY public.userdata.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    email character varying NOT NULL,
    username character varying NOT NULL,
    hashed_password character varying NOT NULL
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: arc_revisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arc_revisions ALTER COLUMN id SET DEFAULT nextval('public.arc_revisions_id_seq'::regclass);


--
-- Name: badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges ALTER COLUMN id SET DEFAULT nextval('public.badges_id_seq'::regclass);


--
-- Name: challenge_day_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_day_templates ALTER COLUMN id SET DEFAULT nextval('public.challenge_day_templates_id_seq'::regclass);


--
-- Name: challenge_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_logs ALTER COLUMN id SET DEFAULT nextval('public.challenge_logs_id_seq'::regclass);


--
-- Name: challenge_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_templates ALTER COLUMN id SET DEFAULT nextval('public.challenge_templates_id_seq'::regclass);


--
-- Name: challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges ALTER COLUMN id SET DEFAULT nextval('public.challenges_id_seq'::regclass);


--
-- Name: items item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items ALTER COLUMN item_id SET DEFAULT nextval('public.items_item_id_seq'::regclass);


--
-- Name: kai_interactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kai_interactions ALTER COLUMN id SET DEFAULT nextval('public.kai_interactions_id_seq'::regclass);


--
-- Name: nudges_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nudges_outbox ALTER COLUMN id SET DEFAULT nextval('public.nudges_outbox_id_seq'::regclass);


--
-- Name: orders order_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders ALTER COLUMN order_id SET DEFAULT nextval('public.orders_order_id_seq'::regclass);


--
-- Name: plan_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates ALTER COLUMN id SET DEFAULT nextval('public.plan_templates_id_seq'::regclass);


--
-- Name: quest_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_logs ALTER COLUMN id SET DEFAULT nextval('public.quest_logs_id_seq'::regclass);


--
-- Name: quests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quests ALTER COLUMN id SET DEFAULT nextval('public.quests_id_seq'::regclass);


--
-- Name: step_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_templates ALTER COLUMN id SET DEFAULT nextval('public.step_templates_id_seq'::regclass);


--
-- Name: user_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges ALTER COLUMN id SET DEFAULT nextval('public.user_badges_id_seq'::regclass);


--
-- Name: user_challenges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_challenges ALTER COLUMN id SET DEFAULT nextval('public.user_challenges_id_seq'::regclass);


--
-- Name: user_quests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_quests ALTER COLUMN id SET DEFAULT nextval('public.user_quests_id_seq'::regclass);


--
-- Name: userdata id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userdata ALTER COLUMN id SET DEFAULT nextval('public.userdata_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: arc_revisions arc_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arc_revisions
    ADD CONSTRAINT arc_revisions_pkey PRIMARY KEY (id);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: challenge_day_templates challenge_day_templates_challenge_id_day_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_day_templates
    ADD CONSTRAINT challenge_day_templates_challenge_id_day_number_key UNIQUE (challenge_id, day_number);


--
-- Name: challenge_day_templates challenge_day_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_day_templates
    ADD CONSTRAINT challenge_day_templates_pkey PRIMARY KEY (id);


--
-- Name: challenge_logs challenge_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_logs
    ADD CONSTRAINT challenge_logs_pkey PRIMARY KEY (id);


--
-- Name: challenge_templates challenge_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_templates
    ADD CONSTRAINT challenge_templates_pkey PRIMARY KEY (id);


--
-- Name: challenges challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenges
    ADD CONSTRAINT challenges_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: friend_arcs friend_arcs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friend_arcs
    ADD CONSTRAINT friend_arcs_pkey PRIMARY KEY (id);


--
-- Name: friends friends_owner_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_owner_name_unique UNIQUE (owner_user_id, name);


--
-- Name: friends friends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_pkey PRIMARY KEY (id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);


--
-- Name: kai_interactions kai_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kai_interactions
    ADD CONSTRAINT kai_interactions_pkey PRIMARY KEY (id);


--
-- Name: nudges_outbox nudges_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nudges_outbox
    ADD CONSTRAINT nudges_outbox_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: plan_templates plan_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_templates
    ADD CONSTRAINT plan_templates_pkey PRIMARY KEY (id);


--
-- Name: quest_logs quest_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_logs
    ADD CONSTRAINT quest_logs_pkey PRIMARY KEY (id);


--
-- Name: quests quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quests
    ADD CONSTRAINT quests_pkey PRIMARY KEY (id);


--
-- Name: user_session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: step_templates step_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_templates
    ADD CONSTRAINT step_templates_pkey PRIMARY KEY (id);


--
-- Name: step_templates step_templates_plan_template_id_day_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_templates
    ADD CONSTRAINT step_templates_plan_template_id_day_number_key UNIQUE (plan_template_id, day_number);


--
-- Name: user_badges user_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_pkey PRIMARY KEY (id);


--
-- Name: user_challenges user_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_challenges
    ADD CONSTRAINT user_challenges_pkey PRIMARY KEY (id);


--
-- Name: user_quests user_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_quests
    ADD CONSTRAINT user_quests_pkey PRIMARY KEY (id);


--
-- Name: userdata userdata_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userdata
    ADD CONSTRAINT userdata_email_key UNIQUE (email);


--
-- Name: userdata userdata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.userdata
    ADD CONSTRAINT userdata_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.user_session USING btree (expire);


--
-- Name: arc_revisions_arc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX arc_revisions_arc_idx ON public.arc_revisions USING btree (arc_id);


--
-- Name: arc_revisions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX arc_revisions_user_idx ON public.arc_revisions USING btree (user_id);


--
-- Name: challenge_templates_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX challenge_templates_tags_gin ON public.challenge_templates USING gin (tags);


--
-- Name: friend_arcs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX friend_arcs_user_idx ON public.friend_arcs USING btree (user_id);


--
-- Name: friend_arcs_user_quiz_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX friend_arcs_user_quiz_idx ON public.friend_arcs USING btree (user_id, quiz_session_id);


--
-- Name: plan_templates_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_templates_channel_idx ON public.plan_templates USING btree (channel);


--
-- Name: plan_templates_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_templates_tier_idx ON public.plan_templates USING btree (tier);


--
-- Name: idx_challenge_logs_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenge_logs_day ON public.challenge_logs USING btree (challenge_id, day_number);


--
-- Name: idx_challenge_logs_user_challenge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_challenge_logs_user_challenge ON public.challenge_logs USING btree (user_id, challenge_id);


--
-- Name: idx_friends_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_friends_owner ON public.friends USING btree (owner_user_id);


--
-- Name: idx_friends_snapshot_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_friends_snapshot_gin ON public.friends USING gin (snapshot);


--
-- Name: idx_kai_interactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kai_interactions_user_id ON public.kai_interactions USING btree (user_id);


--
-- Name: idx_nudges_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nudges_owner ON public.nudges_outbox USING btree (owner_user_id);


--
-- Name: idx_nudges_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nudges_queue ON public.nudges_outbox USING btree (status, send_after);


--
-- Name: idx_quest_logs_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quest_logs_day ON public.quest_logs USING btree (quest_id, day_number);


--
-- Name: idx_quest_logs_user_quest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quest_logs_user_quest ON public.quest_logs USING btree (user_id, quest_id);


--
-- Name: idx_quests_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quests_active ON public.quests USING btree (is_active);


--
-- Name: idx_user_badges_badge_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_badge_id ON public.user_badges USING btree (badge_id);


--
-- Name: idx_user_badges_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_badges_user_id ON public.user_badges USING btree (user_id);


--
-- Name: idx_user_challenges_challenge_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_challenges_challenge_id ON public.user_challenges USING btree (challenge_id);


--
-- Name: idx_user_challenges_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_challenges_status ON public.user_challenges USING btree (status);


--
-- Name: idx_user_challenges_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_challenges_user_id ON public.user_challenges USING btree (user_id);


--
-- Name: idx_user_quests_quest_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_quests_quest_id ON public.user_quests USING btree (quest_id);


--
-- Name: idx_user_quests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_quests_status ON public.user_quests USING btree (status);


--
-- Name: idx_user_quests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_quests_user_id ON public.user_quests USING btree (user_id);


--
-- Name: idx_user_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_session_expire ON public.user_session USING btree (expire);


--
-- Name: ix_items_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_items_item_id ON public.items USING btree (item_id);


--
-- Name: ix_items_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_items_name ON public.items USING btree (name);


--
-- Name: ix_orders_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_orders_order_id ON public.orders USING btree (order_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_users_user_id ON public.users USING btree (user_id);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: nudges_dedupe_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX nudges_dedupe_unique ON public.nudges_outbox USING btree (owner_user_id, to_addr_lower, body_md5, send_day_utc) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));


--
-- Name: plan_templates_tags_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX plan_templates_tags_gin ON public.plan_templates USING gin (tags);


--
-- Name: step_templates_plan_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX step_templates_plan_day_idx ON public.step_templates USING btree (plan_template_id, day_number);


--
-- Name: uniq_friends_owner_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_friends_owner_name ON public.friends USING btree (owner_user_id, lower((name)::text));


--
-- Name: challenge_templates challenge_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER challenge_templates_set_updated_at BEFORE UPDATE ON public.challenge_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: friend_arcs friend_arcs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER friend_arcs_set_updated_at BEFORE UPDATE ON public.friend_arcs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: friends friends_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER friends_set_updated_at BEFORE UPDATE ON public.friends FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: plan_templates plan_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER plan_templates_set_updated_at BEFORE UPDATE ON public.plan_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: step_templates step_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER step_templates_set_updated_at BEFORE UPDATE ON public.step_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: arc_revisions arc_revisions_arc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arc_revisions
    ADD CONSTRAINT arc_revisions_arc_id_fkey FOREIGN KEY (arc_id) REFERENCES public.friend_arcs(id) ON DELETE CASCADE;


--
-- Name: arc_revisions arc_revisions_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arc_revisions
    ADD CONSTRAINT arc_revisions_user_fk FOREIGN KEY (user_id) REFERENCES public.userdata(id);


--
-- Name: challenge_day_templates challenge_day_templates_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_day_templates
    ADD CONSTRAINT challenge_day_templates_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_logs challenge_logs_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_logs
    ADD CONSTRAINT challenge_logs_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: challenge_logs challenge_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.challenge_logs
    ADD CONSTRAINT challenge_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: friend_arcs friend_arcs_user_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friend_arcs
    ADD CONSTRAINT friend_arcs_user_fk FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: friends friends_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.friends
    ADD CONSTRAINT friends_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: items items_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(user_id);


--
-- Name: kai_interactions kai_interactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kai_interactions
    ADD CONSTRAINT kai_interactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: nudges_outbox nudges_outbox_friend_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nudges_outbox
    ADD CONSTRAINT nudges_outbox_friend_id_fkey FOREIGN KEY (friend_id) REFERENCES public.friends(id) ON DELETE SET NULL;


--
-- Name: nudges_outbox nudges_outbox_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nudges_outbox
    ADD CONSTRAINT nudges_outbox_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: orders orders_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(item_id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: quest_logs quest_logs_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_logs
    ADD CONSTRAINT quest_logs_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quests(id) ON DELETE CASCADE;


--
-- Name: quest_logs quest_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quest_logs
    ADD CONSTRAINT quest_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: step_templates step_templates_plan_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_templates
    ADD CONSTRAINT step_templates_plan_template_id_fkey FOREIGN KEY (plan_template_id) REFERENCES public.plan_templates(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_badge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_badge_id_fkey FOREIGN KEY (badge_id) REFERENCES public.badges(id) ON DELETE CASCADE;


--
-- Name: user_badges user_badges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_badges
    ADD CONSTRAINT user_badges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: user_challenges user_challenges_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_challenges
    ADD CONSTRAINT user_challenges_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id) ON DELETE CASCADE;


--
-- Name: user_challenges user_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_challenges
    ADD CONSTRAINT user_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- Name: chat_sessions user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT user_id_fk FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE SET NULL;


--
-- Name: user_quests user_quests_quest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_quests
    ADD CONSTRAINT user_quests_quest_id_fkey FOREIGN KEY (quest_id) REFERENCES public.quests(id) ON DELETE CASCADE;


--
-- Name: user_quests user_quests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_quests
    ADD CONSTRAINT user_quests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.userdata(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict u8bCMCrZSB4rAFSuzzDiyJ3T1GGLgjYQhvfvRux94WeRPnXWDYAcaMnzzuUjOu4
