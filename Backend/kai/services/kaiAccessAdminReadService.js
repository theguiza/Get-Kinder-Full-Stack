import { listActiveGkOrganizationBindingsForGkOrganizationIds } from "../db/kaiOrganizationBindingQueries.js";
import { findUserdataRowByExactEmail } from "../db/gkUserDirectoryQueries.js";

/**
 * Smallest read boundary for the admin-facing KAI Access UI
 * (routes/adminApi.js): resolves each Get Kinder organization's active KAI
 * organization UUID binding, and resolves one existing Get Kinder user by
 * exact normalized email. Delegates the actual SQL to the existing
 * kai.gk_organization_bindings query helper and to the new userdata query
 * helper - this service holds no SQL of its own. Never creates or mutates a
 * binding or a user row.
 */
export async function resolveActiveKaiOrganizationIdsByGkOrganizationId(gkOrganizationIds) {
  const bindings = await listActiveGkOrganizationBindingsForGkOrganizationIds(gkOrganizationIds);
  return new Map(
    bindings.map((binding) => [Number(binding.gk_organization_id), binding.kai_organization_id])
  );
}

export async function findExistingGkUserByExactEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;

  const row = await findUserdataRowByExactEmail(normalized);
  if (!row) return null;

  return {
    id: Number(row.id),
    email: row.email || "",
    firstname: row.firstname || "",
    lastname: row.lastname || "",
  };
}
