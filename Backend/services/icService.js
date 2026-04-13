// Backend/services/icService.js
// Awards IC to a volunteer after attendance is verified.

import { computeVolunteerReward } from "../../services/volunteerRewardService.js";

export async function awardIcForRsvp(pool, { userId, eventId }) {
  // Fetch the RSVP, joined to the event and role
  const { rows } = await pool.query(
    `SELECT
       r.id                  AS rsvp_id,
       r.role_id,
       r.attended_minutes,
       r.verification_status,
       e.start_at,
       e.end_at,
       e.impact_credits_base,
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

  const reward = computeVolunteerReward({
    roleTier: rsvp.tier,
    impactCreditsBase: rsvp.impact_credits_base,
    attendedMinutes: rsvp.attended_minutes,
    startAt: rsvp.start_at,
    endAt: rsvp.end_at,
  });
  const icAmount = reward.impact_credits_award;

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

  return {
    awarded: true,
    icAmount,
    tier: reward.reward_tier || rsvp.tier,
    durationHours: reward.duration_hours,
    hourlyRate: reward.impact_credits_rate,
  };
}
