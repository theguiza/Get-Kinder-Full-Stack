import pool from "../Backend/db/pg.js";
import { submitRating, RatingsServiceError } from "../services/ratingsService.js";

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

const isPastEnd = (endAt) => {
  if (!endAt) return false;
  const date = new Date(endAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < Date.now();
};

export async function submitEventRating(req, res) {
  try {
    const eventId = req.params.id;
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_STARS",
        message: "Stars must be an integer between 1 and 5.",
      });
    }
    const tags = req.body?.tags;
    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.length > 5 || tags.some((tag) => typeof tag !== "string")) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_TAGS",
          message: "Tags must be an array of up to 5 strings.",
        });
      }
    }
    const note = req.body?.note;
    if (note !== undefined) {
      if (typeof note !== "string" || note.length > 280) {
        return res.status(400).json({
          ok: false,
          error: "INVALID_NOTE",
          message: "Note must be 280 characters or less.",
        });
      }
    }

    const raterUserId = await resolveUserId(req);

    const { rows: eventRows } = await pool.query(
      `
        SELECT id, creator_user_id, status, end_at
        FROM events
        WHERE id = $1
        LIMIT 1
      `,
      [eventId]
    );
    if (!eventRows[0]) {
      return res.status(404).json({
        ok: false,
        error: "NOT_ALLOWED",
        message: "Event not found.",
      });
    }
    const event = eventRows[0];
    const eventCreatorId = String(event.creator_user_id);
    const isHost = String(raterUserId) === eventCreatorId;
    let rateeUserId;
    let raterRole;
    let rateeRole;

    if (isHost) {
      const targetUserId = req.body?.target_user_id;
      if (!targetUserId) {
        return res.status(400).json({
          ok: false,
          error: "NOT_ALLOWED",
          message: "target_user_id is required when rating a volunteer.",
        });
      }
      const { rows: rsvpRows } = await pool.query(
        `
          SELECT 1
          FROM event_rsvps
          WHERE event_id = $1
            AND attendee_user_id = $2
            AND status IN ('accepted','checked_in')
          LIMIT 1
        `,
        [eventId, targetUserId]
      );
      if (!rsvpRows[0]) {
        return res.status(400).json({
          ok: false,
          error: "RSVP_REQUIRED",
          message: "Volunteer must have an RSVP to be rated.",
        });
      }
      rateeUserId = String(targetUserId);
      raterRole = "host";
      rateeRole = "volunteer";
    } else {
      if (!(event.status === "completed" || isPastEnd(event.end_at))) {
        return res.status(400).json({
          ok: false,
          error: "EVENT_NOT_RATEABLE",
          message: "Event must be completed before rating.",
        });
      }
      const { rows: rsvpRows } = await pool.query(
        `
          SELECT 1
          FROM event_rsvps
          WHERE event_id = $1
            AND attendee_user_id = $2
            AND status IN ('accepted','checked_in')
          LIMIT 1
        `,
        [eventId, raterUserId]
      );
      if (!rsvpRows[0]) {
        return res.status(400).json({
          ok: false,
          error: "RSVP_REQUIRED",
          message: "You must RSVP before rating this event.",
        });
      }
      rateeUserId = eventCreatorId;
      raterRole = "volunteer";
      rateeRole = "host";
    }

    const { ratingId, revealed } = await submitRating({
      eventId,
      raterUserId,
      rateeUserId,
      raterRole,
      rateeRole,
      stars,
      tags: tags?.length ? tags : null,
      note: note?.trim() || null,
    });

    return res.json({
      ok: true,
      data: { rating_id: ratingId, revealed },
    });
  } catch (err) {
    if (err instanceof RatingsServiceError && err.code === "DUPLICATE_RATING") {
      return res.status(409).json({
        ok: false,
        error: "DUPLICATE_RATING",
        message: "You already submitted a rating for this event.",
      });
    }
    console.error("POST /api/events/:id/ratings error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      message: "Unable to submit rating.",
    });
  }
}
