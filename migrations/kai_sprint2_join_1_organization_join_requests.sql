BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.organizations') IS NULL THEN
    RAISE EXCEPTION 'kai.organizations is required before the JOIN-1 organization-join-requests migration';
  END IF;
  IF to_regclass('kai.users') IS NULL THEN
    RAISE EXCEPTION 'kai.users is required before the JOIN-1 organization-join-requests migration';
  END IF;
END $$;

-- JOIN-1 (Join Existing Organization - persistence foundation): one new,
-- additive relation - kai.organization_join_requests. A KAI user asks to
-- join ONE existing KAI organization, identified only by its authoritative
-- kai.organizations.organization_id (never by name). kai.organizations and
-- kai.users are externally owned and are not modified here.
--
-- Deliberately NOT stored: any requested role. A join request is a request
-- for access, not a role claim; the role a reviewer grants on approval is
-- decided by the reviewer in a later package and recorded through the
-- existing kai.organization_memberships authority, never self-selected by
-- the requester. There is no client_admin/client_reviewer column or value
-- anywhere in this relation.
--
-- Lifecycle: pending -> approved | declined. approved/declined are terminal:
-- the row is never reopened or re-decided (enforced by the BEFORE UPDATE
-- trigger below). A requester who was declined may submit a NEW request
-- later - a new row - because uniqueness is enforced only over pending rows
-- (ux_organization_join_requests_j1_one_pending).
--
-- requester_user_id and reviewed_by_user_id both reference kai.users: both
-- are KAI identities (the requester must already be a mapped KAI user; the
-- reviewer is the KAI actor who decided).
CREATE TABLE IF NOT EXISTS kai.organization_join_requests (
  organization_join_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requester_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',

  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_join_requests_j1_id_org_unique
    UNIQUE (organization_join_request_id, organization_id),
  CONSTRAINT organization_join_requests_j1_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES kai.organizations (organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_join_requests_j1_requester_fk
    FOREIGN KEY (requester_user_id)
    REFERENCES kai.users (user_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_join_requests_j1_reviewer_fk
    FOREIGN KEY (reviewed_by_user_id)
    REFERENCES kai.users (user_id)
    ON DELETE RESTRICT,
  CONSTRAINT organization_join_requests_j1_status_check
    CHECK (status IN ('pending', 'approved', 'declined')),
  CONSTRAINT organization_join_requests_j1_review_fields_check
    CHECK (
      (status = 'pending' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
      OR (status IN ('approved', 'declined') AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
    ),
  CONSTRAINT organization_join_requests_j1_reviewed_after_created_check
    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at),
  CONSTRAINT organization_join_requests_j1_no_self_review_check
    CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> requester_user_id)
);

-- One pending request per requester + organization; any number of
-- historical approved/declined rows may coexist with it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_organization_join_requests_j1_one_pending
  ON kai.organization_join_requests (organization_id, requester_user_id)
  WHERE status = 'pending';

-- Reviewer queue: an organization's requests by status, oldest first.
CREATE INDEX IF NOT EXISTS ix_organization_join_requests_j1_tenant_status_created
  ON kai.organization_join_requests (organization_id, status, created_at);

-- Requester's own history across organizations, newest first.
CREATE INDEX IF NOT EXISTS ix_organization_join_requests_j1_requester_created
  ON kai.organization_join_requests (requester_user_id, created_at DESC);

-- Lifecycle guard + updated_at maintenance. Identity columns never change;
-- only a pending row may be updated, and only to a terminal decision.
CREATE OR REPLACE FUNCTION kai.guard_organization_join_requests_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_join_request_id IS DISTINCT FROM OLD.organization_join_request_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'kai.organization_join_requests identity columns are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'kai.organization_join_requests % request is terminal and cannot be updated', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'kai.organization_join_requests pending request may only transition to approved or declined'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_organization_join_requests_guard_update ON kai.organization_join_requests;
CREATE TRIGGER trg_organization_join_requests_guard_update
BEFORE UPDATE ON kai.organization_join_requests
FOR EACH ROW
EXECUTE FUNCTION kai.guard_organization_join_requests_update();

COMMIT;
