import pool from "../Backend/db/pg.js";

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) throw new Error("User record not found.");
  return String(rows[0].id);
}

export async function listContacts(req, res) {
  try {
    const ownerId = await resolveUserId(req);
    const { rows } = await pool.query(
      `SELECT id, name, email
         FROM friends
        WHERE owner_user_id = $1
          AND email IS NOT NULL
        ORDER BY (NULLIF(TRIM(name), '')) IS NULL, name ASC, email ASC
        LIMIT 200`,
      [ownerId]
    );
    const data = rows
      .filter((row) => row.email)
      .map((row) => ({
        id: String(row.id),
        name: row.name?.trim() || row.email,
        email: row.email.trim(),
      }));
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("[meContacts] listContacts error:", error);
    return res.status(500).json({ ok: false, error: "Unable to load contacts" });
  }
}
