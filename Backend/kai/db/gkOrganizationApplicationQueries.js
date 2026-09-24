import pool from "../../db/pg.js";

function normalizeUserdataId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

/**
 * Read-only lookup of the caller's own most recently submitted
 * public.org_applications row. "Latest" is strictly submission chronology
 * (submitted_at, then the monotonic SERIAL id as a deterministic tiebreak);
 * status never influences which row is selected. The caller must supply the
 * authenticated user's legacy userdata id - this helper never accepts
 * browser input directly. Returns only the fields the onboarding status
 * projection needs (never admin notes or reviewer identity).
 */
export async function selectLatestOwnOrganizationApplication(legacyPublicUserdataId, db = pool) {
  const normalizedUserId = normalizeUserdataId(legacyPublicUserdataId);
  if (!normalizedUserId) return null;
  const {
    rows: [row] = [],
  } = await db.query(
    `
      SELECT id, org_name, status, submitted_at, reviewed_at
      FROM public.org_applications
      WHERE user_id = $1
      ORDER BY submitted_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
    [normalizedUserId]
  );
  return row || null;
}
