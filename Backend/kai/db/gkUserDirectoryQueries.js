import pool from "../../db/pg.js";

/**
 * Read-only, exact-match userdata lookup by normalized email. Used by the
 * KAI Access admin workflow to resolve an existing Get Kinder user before
 * assigning/changing their organization-scoped KAI role - never creates,
 * updates, or returns anything beyond the minimum identifying fields.
 */
export async function findUserdataRowByExactEmail(normalizedEmail, db = pool) {
  const {
    rows: [row] = [],
  } = await db.query(
    `
      SELECT id, email, firstname, lastname
      FROM userdata
      WHERE LOWER(TRIM(email)) = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );
  return row || null;
}
