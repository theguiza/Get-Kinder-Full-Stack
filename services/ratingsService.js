import pool from "../Backend/db/pg.js";

class RatingsServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const roundToTenth = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
};

export async function getSummary({ userId, limit = 20 }) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 20;
  const { rows } = await pool.query(
    `
      SELECT
        AVG(stars)::float AS avg,
        COUNT(*)::int AS cnt
      FROM (
        SELECT stars
        FROM event_ratings
        WHERE ratee_user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      ) t
    `,
    [userId, safeLimit]
  );

  const avg = rows?.[0]?.avg ?? null;
  const cnt = Number(rows?.[0]?.cnt) || 0;
  return {
    kindnessRating: cnt ? roundToTenth(avg) : null,
    sampleSize: cnt,
    limit: safeLimit,
  };
}

export async function submitRating({
  eventId,
  raterUserId,
  rateeUserId,
  raterRole,
  rateeRole,
  stars,
  tags,
  note,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
        INSERT INTO event_ratings (
          event_id,
          rater_user_id,
          ratee_user_id,
          rater_role,
          ratee_role,
          stars,
          tags,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [eventId, raterUserId, rateeUserId, raterRole, rateeRole, stars, tags, note]
    );

    const ratingId = rows?.[0]?.id ? String(rows[0].id) : null;

    const { rows: reverseRows } = await client.query(
      `
        SELECT id
        FROM event_ratings
        WHERE event_id = $1
          AND rater_user_id = $2
          AND ratee_user_id = $3
          AND rater_role = $4
          AND ratee_role = $5
        LIMIT 1
      `,
      [eventId, rateeUserId, raterUserId, rateeRole, raterRole]
    );

    let revealed = false;
    if (reverseRows?.[0]?.id && ratingId) {
      revealed = true;
      await client.query(
        `
          UPDATE event_ratings
          SET revealed_at = NOW()
          WHERE id = ANY($1::uuid[])
        `,
        [[ratingId, reverseRows[0].id]]
      );
    }

    await client.query("COMMIT");
    return { ratingId, revealed };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.code === "23505") {
      throw new RatingsServiceError("DUPLICATE_RATING", "Rating already submitted.");
    }
    throw err;
  } finally {
    client.release();
  }
}

export { RatingsServiceError };
