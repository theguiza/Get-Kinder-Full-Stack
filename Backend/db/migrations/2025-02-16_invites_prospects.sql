BEGIN;

ALTER TABLE invites
  ALTER COLUMN recipient_user_id DROP NOT NULL;

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS invitee_email text,
  ADD COLUMN IF NOT EXISTS invitee_name text;

UPDATE invites i
   SET invitee_email = COALESCE(invitee_email, LOWER(u.email)),
       invitee_name  = COALESCE(invitee_name, NULLIF(TRIM(u.firstname || ' ' || u.lastname), ''))
  FROM userdata u
 WHERE i.recipient_user_id = u.id;

UPDATE invites
   SET invitee_email = LOWER(invitee_email)
 WHERE invitee_email IS NOT NULL;

ALTER TABLE invites
  ALTER COLUMN invitee_email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invites_event_email
  ON invites (event_id, invitee_email);

COMMIT;

-- Down instructions:
-- BEGIN;
--   DROP INDEX IF EXISTS uq_invites_event_email;
--   ALTER TABLE invites ALTER COLUMN invitee_email DROP NOT NULL;
--   ALTER TABLE invites DROP COLUMN IF EXISTS invitee_name;
--   ALTER TABLE invites DROP COLUMN IF EXISTS invitee_email;
--   ALTER TABLE invites ALTER COLUMN recipient_user_id SET NOT NULL;
-- COMMIT;
