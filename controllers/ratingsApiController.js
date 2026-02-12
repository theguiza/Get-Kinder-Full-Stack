import pool from "../Backend/db/pg.js";
import { getSummary } from "../services/ratingsService.js";

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) {
    throw new Error("User record not found.");
  }
  return String(rows[0].id);
}

export async function getRatingsSummary(req, res) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "NOT_ALLOWED", message: "Unauthorized." });
    const summary = await getSummary({ userId, limit: 20 });
    const sampleSize = summary.sampleSize || 0;
    return res.json({
      ok: true,
      data: {
        kindness_rating: sampleSize ? summary.kindnessRating : null,
        rating_count: sampleSize,
      },
    });
  } catch (err) {
    if (err?.code === "42P01") {
      return res.json({
        ok: true,
        data: {
          kindness_rating: null,
          rating_count: 0,
        },
      });
    }
    console.error("GET /api/ratings/summary error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load ratings summary." });
  }
}
