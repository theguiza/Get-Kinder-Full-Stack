DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'userdata'
      AND column_name = 'availability_exceptions'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'userdata'
      AND column_name = 'specfifc_availability'
  ) THEN
    EXECUTE 'ALTER TABLE public.userdata RENAME COLUMN availability_exceptions TO specfifc_availability';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'userdata'
      AND column_name = 'specfifc_availability'
  ) THEN
    EXECUTE 'ALTER TABLE public.userdata ADD COLUMN specfifc_availability JSONB';
  END IF;
END $$;
