import express from "express";
import pool from "../Backend/db/pg.js";
import { generateArcForQuiz } from "../services/ArcGenerator.js";

const router = express.Router();

// TODO: add basic auth / allow-list middleware to restrict internal access.

const REQUIRED_FIELDS = ["user_id", "friend_id", "friend_name", "tier", "channel_pref"];

router.post("/completed", async (req, res) => {
  try {
    if (!req.is("application/json")) {
      return res.status(400).json({ ok: false, error: "Request body must be JSON" });
    }

    const payload = req.body ?? {};
    const missing = REQUIRED_FIELDS.filter((field) => {
      const value = payload[field];
      if (value === null || value === undefined) return true;
      if (typeof value === "string" && !value.trim()) return true;
      return false;
    });

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const arc = await generateArcForQuiz(pool, payload);
    const arcId = arc?.id || null;

    if (!arcId) {
      return res.status(500).json({ ok: false, error: "Arc generated without an identifier" });
    }

    return res.status(200).json({ ok: true, arcId });
  } catch (error) {
    const clientErrorMarkers = [
      "payload.",
      "No active plan",
      "No plan template matched",
      "Selected plan template has no step templates",
      "No active challenge templates available",
      "No active challenge template matched",
      "Request body must be JSON",
      "Missing required field",
    ];
    const message = error?.message || "Failed to generate friend arc";
    const status = clientErrorMarkers.some((marker) => message.includes(marker)) ? 400 : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;
