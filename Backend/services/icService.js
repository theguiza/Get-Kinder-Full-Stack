// Backend/services/icService.js
// Awards IC to a volunteer after attendance is verified.

export async function awardIcForRsvp(pool, { userId, eventId }) {
  // Fetch the RSVP, joined to the event and role
  const { rows } = await pool.query(
    `SELECT
       r.id                  AS rsvp_id,
       r.role_id,
       r.verification_status,
       e.start_at,
       e.end_at,
       COALESCE(er.tier, 'standard') AS tier
     FROM event_rsvps r
     JOIN events e ON e.id = r.event_id
     LEFT JOIN event_roles er ON er.id = r.role_id
     WHERE r.attendee_user_id = $1
       AND r.event_id = $2
     ORDER BY r.created_at DESC
     LIMIT 1`,
    [userId, eventId]
  );

  if (!rows.length) throw new Error('rsvp_not_found');

  const rsvp = rows[0];

  if (rsvp.verification_status === 'verified') {
    return { skipped: true, reason: 'already_verified' };
  }

  // Calculate duration in hours, minimum 0
  const startAt = rsvp.start_at ? new Date(rsvp.start_at) : null;
  const endAt   = rsvp.end_at   ? new Date(rsvp.end_at)   : null;

  let durationHours = 0;
  if (startAt && endAt && endAt > startAt) {
    durationHours = (endAt - startAt) / (1000 * 60 * 60);
  }

  const IC_RATE_BY_TIER = {
    standard:   10,
    skilled:    15,
    specialist: 20,
    leadership: 30,
  };

  const rate    = IC_RATE_BY_TIER[rsvp.tier] ?? 10;
  const icAmount = Math.max(1, Math.round(durationHours * rate));

  // Mark RSVP verified and insert IC credit in one transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE event_rsvps
       SET verification_status = 'verified',
           updated_at = NOW()
       WHERE id = $1`,
      [rsvp.rsvp_id]
    );
    await client.query(
      `INSERT INTO wallet_transactions
         (user_id, kind_amount, direction, reason, event_id, note)
       VALUES ($1, $2, 'credit', 'earn_shift', $3, $4)`,
      [userId, icAmount, eventId, `Verified attendance: ${icAmount} IC earned`]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { awarded: true, icAmount, tier: rsvp.tier, durationHours };
}
