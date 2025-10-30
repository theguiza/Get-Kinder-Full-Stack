-- Idempotency cache for arc mutations to guarantee at-most-once semantics.
CREATE TABLE IF NOT EXISTS arc_mutations (
  arc_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (arc_id, idempotency_key)
);
