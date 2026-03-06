-- One-time purge script: suspected bot-created local accounts.
--
-- FK references to public.userdata(id) seen in this repo (verify in your live DB before running DELETE):
--   public.arc_revisions(user_id)
--   public.challenge_logs(user_id)
--   public.friend_arcs(user_id)
--   public.friends(owner_user_id)
--   public.kai_interactions(user_id)
--   public.nudges_outbox(owner_user_id)
--   public.quest_logs(user_id)
--   public.user_badges(user_id)
--   public.user_challenges(user_id)
--   public.chat_sessions(user_id)
--   public.user_quests(user_id)
--   public.event_ratings(rater_user_id, ratee_user_id)            -- migration-managed
--   public.organizations(rep_user_id)                             -- migration-managed
--   public.org_applications(user_id)                              -- migration-managed
--   public.pending_credit_requests(volunteer_user_id, requested_by) -- migration-managed
--   public.invite_sender_blocks(blocker_user_id, blocked_user_id) -- migration-managed
--   public.invite_abuse_reports(reporter_user_id, sender_user_id) -- migration-managed
--   public.invite_moderation_logs(sender_user_id, recipient_user_id) -- migration-managed
--
-- Optional verification query for your actual DB:
-- SELECT
--   ns.nspname  AS child_schema,
--   cls.relname AS child_table,
--   att.attname AS child_column,
--   con.conname AS fk_name
-- FROM pg_constraint con
-- JOIN pg_class cls      ON cls.oid = con.conrelid
-- JOIN pg_namespace ns   ON ns.oid = cls.relnamespace
-- JOIN pg_attribute att  ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
-- WHERE con.contype = 'f'
--   AND con.confrelid = 'public.userdata'::regclass
--   AND array_length(con.conkey, 1) = 1
-- ORDER BY 1, 2, 3;

-- 1) REVIEW FIRST: rows that match purge criteria.
SELECT
  id,
  firstname,
  lastname,
  email,
  created_at,
  email_verified,
  google_id,
  facebook_id
FROM public.userdata
WHERE google_id IS NULL
  AND facebook_id IS NULL
  AND COALESCE(email_verified, FALSE) = FALSE
  AND char_length(firstname) > 15
  AND firstname ~ '^[A-Za-z]+$'
ORDER BY created_at DESC, id DESC;

-- 2) DELETE BLOCK (COMMENTED): Uncomment after reviewing the SELECT results.
-- BEGIN;
--
-- CREATE TEMP TABLE _bot_user_ids ON COMMIT DROP AS
-- SELECT id
-- FROM public.userdata
-- WHERE google_id IS NULL
--   AND facebook_id IS NULL
--   AND COALESCE(email_verified, FALSE) = FALSE
--   AND char_length(firstname) > 15
--   AND firstname ~ '^[A-Za-z]+$';
--
-- -- Delete dependent rows for all CURRENT FK constraints that reference public.userdata(id).
-- -- This uses live metadata, so it adapts to your current schema state.
-- DO $$
-- DECLARE
--   fk_row RECORD;
-- BEGIN
--   FOR fk_row IN
--     SELECT
--       quote_ident(ns.nspname) AS schema_name,
--       quote_ident(cls.relname) AS table_name,
--       quote_ident(att.attname) AS column_name
--     FROM pg_constraint con
--     JOIN pg_class cls     ON cls.oid = con.conrelid
--     JOIN pg_namespace ns  ON ns.oid = cls.relnamespace
--     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
--     WHERE con.contype = 'f'
--       AND con.confrelid = 'public.userdata'::regclass
--       AND array_length(con.conkey, 1) = 1
--   LOOP
--     EXECUTE format(
--       'DELETE FROM %s.%s WHERE %s IN (SELECT id FROM _bot_user_ids);',
--       fk_row.schema_name,
--       fk_row.table_name,
--       fk_row.column_name
--     );
--   END LOOP;
-- END
-- $$;
--
-- DELETE FROM public.userdata
-- WHERE id IN (SELECT id FROM _bot_user_ids);
--
-- COMMIT;
