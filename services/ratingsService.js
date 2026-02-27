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

export async function getSummary({ userId, orgId, limit = 20 }) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 20;
  let rows;
  if (orgId != null) {
    ({ rows } = await pool.query(
      `
        SELECT
          AVG(stars)::float AS avg,
          COUNT(*)::int AS cnt
        FROM (
          SELECT er.stars
          FROM event_ratings er
          LEFT JOIN userdata hu ON hu.id = er.ratee_user_id
          WHERE
            (er.ratee_role = 'organization' AND er.ratee_org_id = $1)
            OR
            (er.ratee_role = 'host' AND hu.org_id = $1)
          ORDER BY er.created_at DESC
          LIMIT $2
        ) t
      `,
      [orgId, safeLimit]
    ));
  } else {
    ({ rows } = await pool.query(
      `
        SELECT
          AVG(stars)::float AS avg,
          COUNT(*)::int AS cnt
        FROM (
          SELECT stars
          FROM event_ratings
          WHERE ratee_user_id = $1
            AND ratee_role = 'volunteer'
          ORDER BY created_at DESC
          LIMIT $2
        ) t
      `,
      [userId, safeLimit]
    ));
  }

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
  rateeOrgId,
  raterRole,
  rateeRole,
  stars,
  tags,
  note,
  organizationId,
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
          ratee_org_id,
          rater_role,
          ratee_role,
          stars,
          tags,
          note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `,
      [eventId, raterUserId, rateeUserId ?? null, rateeOrgId ?? null, raterRole, rateeRole, stars, tags, note]
    );

    const ratingId = rows?.[0]?.id ? String(rows[0].id) : null;

    let reverseRows = [];
    if (raterRole === "host" && rateeRole === "volunteer") {
      const reverseQuery = organizationId
        ? `
          SELECT er.id
          FROM event_ratings er
          LEFT JOIN userdata hu ON hu.id = er.ratee_user_id
          WHERE er.event_id = $1
            AND er.rater_user_id = $2
            AND er.rater_role = 'volunteer'
            AND (
              (er.ratee_role = 'organization' AND er.ratee_org_id = $3)
              OR
              (er.ratee_role = 'host' AND hu.org_id = $3)
            )
          LIMIT 1
        `
        : `
          SELECT er.id
          FROM event_ratings er
          WHERE er.event_id = $1
            AND er.rater_user_id = $2
            AND er.rater_role = 'volunteer'
          LIMIT 1
        `;
      const reverseParams = organizationId ? [eventId, rateeUserId, organizationId] : [eventId, rateeUserId];
      ({ rows: reverseRows } = await client.query(reverseQuery, reverseParams));
    } else if (raterRole === "volunteer") {
      const reverseQuery = rateeOrgId
        ? `
          SELECT er.id
          FROM event_ratings er
          LEFT JOIN userdata hu ON hu.id = er.rater_user_id
          WHERE er.event_id = $1
            AND er.rater_role = 'host'
            AND er.ratee_role = 'volunteer'
            AND er.ratee_user_id = $2
            AND hu.org_id = $3
          LIMIT 1
        `
        : `
          SELECT er.id
          FROM event_ratings er
          WHERE er.event_id = $1
            AND er.rater_role = 'host'
            AND er.ratee_role = 'volunteer'
            AND er.ratee_user_id = $2
          LIMIT 1
        `;
      const reverseParams = rateeOrgId ? [eventId, raterUserId, rateeOrgId] : [eventId, raterUserId];
      ({ rows: reverseRows } = await client.query(reverseQuery, reverseParams));
    } else {
      ({ rows: reverseRows } = await client.query(
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
      ));
    }

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

export async function getPairRatingStatus({
  eventId,
  raterUserId,
  rateeUserId,
  rateeOrgId,
  raterRole,
  rateeRole,
  organizationId,
}) {
  const myQuery = pool.query(
    `
      SELECT id, stars, tags, note, revealed_at, created_at
      FROM event_ratings
      WHERE event_id = $1
        AND rater_user_id = $2
        AND rater_role = $3
        AND ratee_role = $4
        AND ratee_user_id IS NOT DISTINCT FROM $5
        AND ratee_org_id IS NOT DISTINCT FROM $6
      LIMIT 1
    `,
    [eventId, raterUserId, raterRole, rateeRole, rateeUserId ?? null, rateeOrgId ?? null]
  );

  let otherQuery;
  if (raterRole === "host" && rateeRole === "volunteer") {
    otherQuery = organizationId
      ? pool.query(
          `
            SELECT er.id, er.revealed_at
            FROM event_ratings er
            LEFT JOIN userdata hu ON hu.id = er.ratee_user_id
            WHERE er.event_id = $1
              AND er.rater_user_id = $2
              AND er.rater_role = 'volunteer'
              AND (
                (er.ratee_role = 'organization' AND er.ratee_org_id = $3)
                OR
                (er.ratee_role = 'host' AND hu.org_id = $3)
              )
            LIMIT 1
          `,
          [eventId, rateeUserId, organizationId]
        )
      : pool.query(
          `
            SELECT er.id, er.revealed_at
            FROM event_ratings er
            WHERE er.event_id = $1
              AND er.rater_user_id = $2
              AND er.rater_role = 'volunteer'
            LIMIT 1
          `,
          [eventId, rateeUserId]
        );
  } else if (raterRole === "volunteer") {
    otherQuery = rateeOrgId
      ? pool.query(
          `
            SELECT er.id, er.revealed_at
            FROM event_ratings er
            LEFT JOIN userdata hu ON hu.id = er.rater_user_id
            WHERE er.event_id = $1
              AND er.rater_role = 'host'
              AND er.ratee_role = 'volunteer'
              AND er.ratee_user_id = $2
              AND hu.org_id = $3
            LIMIT 1
          `,
          [eventId, raterUserId, rateeOrgId]
        )
      : pool.query(
          `
            SELECT er.id, er.revealed_at
            FROM event_ratings er
            WHERE er.event_id = $1
              AND er.rater_role = 'host'
              AND er.ratee_role = 'volunteer'
              AND er.ratee_user_id = $2
            LIMIT 1
          `,
          [eventId, raterUserId]
        );
  } else {
    otherQuery = pool.query(
      `
        SELECT id, revealed_at
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
  }

  const [myResult, otherResult] = await Promise.all([myQuery, otherQuery]);

  const myRow = myResult?.rows?.[0] || null;
  const otherRow = otherResult?.rows?.[0] || null;

  return {
    myRating: myRow
      ? {
          id: String(myRow.id),
          stars: Number(myRow.stars),
          tags: Array.isArray(myRow.tags) ? myRow.tags : [],
          note: myRow.note || null,
          created_at: myRow.created_at || null,
          revealed_at: myRow.revealed_at || null,
        }
      : null,
    otherRatingExists: Boolean(otherRow?.id),
    revealed: Boolean(myRow?.revealed_at),
  };
}

export { RatingsServiceError };
