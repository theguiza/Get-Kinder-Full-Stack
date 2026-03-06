CREATE TABLE IF NOT EXISTS pending_credit_requests (
  id SERIAL PRIMARY KEY,
  event_id UUID REFERENCES events(id),
  volunteer_user_id INTEGER REFERENCES userdata(id),
  org_id INTEGER REFERENCES organizations(id),
  requested_by INTEGER REFERENCES userdata(id),
  amount NUMERIC NOT NULL,
  reason TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS pending_credit_requests_status_idx
  ON pending_credit_requests(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS pending_credit_requests_event_volunteer_pending_idx
  ON pending_credit_requests(event_id, volunteer_user_id)
  WHERE status = 'pending';
