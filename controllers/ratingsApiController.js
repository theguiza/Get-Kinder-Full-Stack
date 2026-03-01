import pool from "../Backend/db/pg.js";
import { getSummary } from "../services/ratingsService.js";

async function resolveUserId(req) {
  if (req.user?.email) {
    const { rows } = await pool.query(
      "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
      [req.user.email]
    );
    if (rows[0]?.id != null) {
      return String(rows[0].id);
    }
  }

  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  throw new Error("User record not found.");
}

export async function getRatingsSummary(req, res) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "NOT_ALLOWED", message: "Unauthorized." });

    const scope = String(req.query?.scope || "user").toLowerCase();
    let summary;
    let orgId = null;
    if (scope === "organization") {
      const { rows } = await pool.query(
        "SELECT org_id FROM public.userdata WHERE id = $1 LIMIT 1",
        [userId]
      );
      orgId = rows?.[0]?.org_id != null ? Number(rows[0].org_id) : null;
      if (!orgId) {
        return res.json({
          ok: true,
          data: {
            kindness_rating: null,
            rating_count: 0,
            scope: "organization",
            org_id: null,
          },
        });
      }
      summary = await getSummary({ orgId, limit: 20 });
    } else {
      summary = await getSummary({ userId, limit: 20 });
    }

    const sampleSize = summary.sampleSize || 0;
    return res.json({
      ok: true,
      data: {
        kindness_rating: sampleSize ? summary.kindnessRating : null,
        rating_count: sampleSize,
        scope: scope === "organization" ? "organization" : "user",
        org_id: orgId,
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
