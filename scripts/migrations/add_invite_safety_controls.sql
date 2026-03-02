CREATE TABLE IF NOT EXISTS public.invite_sender_blocks (
  id BIGSERIAL PRIMARY KEY,
  blocker_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  blocked_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE IF NOT EXISTS public.invite_abuse_reports (
  id BIGSERIAL PRIMARY KEY,
  invite_id UUID NOT NULL REFERENCES public.invites(id) ON DELETE CASCADE,
  reporter_user_id INTEGER NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invite_id, reporter_user_id)
);

CREATE TABLE IF NOT EXISTS public.invite_moderation_logs (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  invite_id UUID REFERENCES public.invites(id) ON DELETE SET NULL,
  sender_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  recipient_user_id INTEGER REFERENCES public.userdata(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invites_sender_created_at
  ON public.invites (sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invites_event_sender_created_at
  ON public.invites (event_id, sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invites_event_recipient_created_at
  ON public.invites (event_id, recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invites_sender_lower_email_created_at
  ON public.invites (sender_user_id, LOWER(invitee_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invites_event_lower_email_created_at
  ON public.invites (event_id, LOWER(invitee_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invite_sender_blocks_blocker
  ON public.invite_sender_blocks (blocker_user_id, blocked_user_id);

CREATE INDEX IF NOT EXISTS idx_invite_abuse_reports_reporter_created
  ON public.invite_abuse_reports (reporter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invite_moderation_logs_sender_created
  ON public.invite_moderation_logs (sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invite_moderation_logs_event_created
  ON public.invite_moderation_logs (event_id, created_at DESC);
