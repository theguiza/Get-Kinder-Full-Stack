BEGIN;

-- Smoke seed: enough synthetic public.organizations rows (ids assigned by
-- SERIAL, predictable in a fresh ephemeral database: 1..10) for the smoke
-- verifier's active/inactive/conflict probes, plus one already-active
-- binding (org 1) and one already-inactive binding (org 2) as starting
-- state. The smoke verifier performs the actual active/inactive/conflict
-- mutations and assertions.

INSERT INTO public.organizations (name) VALUES
  ('Synthetic Org 1'), ('Synthetic Org 2'), ('Synthetic Org 3'), ('Synthetic Org 4'),
  ('Synthetic Org 5'), ('Synthetic Org 6'), ('Synthetic Org 7'), ('Synthetic Org 8'),
  ('Synthetic Org 9'), ('Synthetic Org 10');

INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
VALUES (1, 'a5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');

INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
VALUES (2, 'b5d17c5a-c55f-43af-9b21-fe63aafe733f', 'inactive');

COMMIT;
