ALTER TABLE userdata
  ADD COLUMN IF NOT EXISTS availability_weekly JSONB,
  ADD COLUMN IF NOT EXISTS specfifc_availability JSONB,
  ADD COLUMN IF NOT EXISTS timezone TEXT;
