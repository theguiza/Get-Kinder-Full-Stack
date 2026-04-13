import pool from "../Backend/db/pg.js";
import { insertEarnShiftTx } from "./walletService.js";
import { buildFundingPolicyProfile } from "./fundingAllocationService.js";
import { fundEarnShiftFromPool } from "./poolFundingService.js";
import { normalizePoolSlug } from "./poolRoutingService.js";
import { computeVolunteerReward } from "./volunteerRewardService.js";

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export async function reconcileEarnShiftCredits({ limit = 200, dryRun = false } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 200;

  const { rows } = await pool.query(
    `
      SELECT
        r.event_id,
        r.attendee_user_id,
        r.attended_minutes,
        r.verified_at,
        e.reward_pool_kind,
        e.impact_credits_base,
        e.funding_pool_slug,
        e.funding_class_override,
        e.subsidy_eligible_override,
        e.subsidy_cap_percent_override,
        e.creator_user_id,
        e.title,
        e.start_at,
        e.end_at,
        COALESCE(er.tier, NULL) AS role_tier,
        COALESCE(primary_org.id, rep_org.id) AS host_org_id,
        COALESCE(primary_org.status, rep_org.status) AS host_org_status,
        COALESCE(primary_org.funding_class, rep_org.funding_class, 'mixed') AS host_org_funding_class,
        COALESCE(primary_org.subsidy_eligible, rep_org.subsidy_eligible, false) AS host_org_subsidy_eligible,
        COALESCE(primary_org.manual_override_only, rep_org.manual_override_only, false) AS host_org_manual_override_only
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      LEFT JOIN event_roles er ON er.id = r.role_id
      LEFT JOIN userdata host ON host.id = e.creator_user_id
      LEFT JOIN organizations primary_org ON primary_org.id = host.org_id
      LEFT JOIN organizations rep_org ON rep_org.rep_user_id = e.creator_user_id
      WHERE r.verification_status = 'verified'
      ORDER BY r.verified_at NULLS LAST, r.created_at ASC
      LIMIT $1
    `,
    [safeLimit]
  );

  const summary = {
    scanned: rows.length,
    awarded: 0,
    funded: 0,
    skippedExisting: 0,
    skippedZero: 0,
    errors: 0,
  };

  for (const row of rows) {
    const reward = computeVolunteerReward({
      roleTier: row.role_tier,
      impactCreditsBase: row.impact_credits_base,
      attendedMinutes: row.attended_minutes,
      startAt: row.start_at,
      endAt: row.end_at,
    });
    const creditsToAward = reward.impact_credits_award;

    if (!Number.isFinite(creditsToAward) || creditsToAward <= 0) {
      summary.skippedZero += 1;
      continue;
    }

    const noteBase = `earn_shift:${row.event_id || ""}`;
    const note = noteBase.length > 180 ? noteBase.slice(0, 180) : noteBase;

    if (dryRun) {
      summary.awarded += 1;
      summary.funded += 1;
      continue;
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const { inserted, amount, walletTxId } = await insertEarnShiftTx({
        client,
        userId: row.attendee_user_id,
        eventId: row.event_id,
        amount: creditsToAward,
        note,
      });

      if (!inserted) {
        summary.skippedExisting += 1;
        await client.query("ROLLBACK");
        continue;
      }

      await fundEarnShiftFromPool({
        client,
        ownerUserId: row.creator_user_id,
        poolSlug: normalizePoolSlug(row.funding_pool_slug),
        eventId: row.event_id,
        organizationId: row.host_org_id,
        volunteerUserId: row.attendee_user_id,
        walletTxId: walletTxId,
        creditsToFund: amount,
        minutesVerified: row.attended_minutes ?? null,
        policyProfile: buildFundingPolicyProfile({
          funding_class_override: row.funding_class_override,
          subsidy_eligible_override: row.subsidy_eligible_override,
          subsidy_cap_percent_override: row.subsidy_cap_percent_override,
          organization_status: row.host_org_status,
          org_funding_class: row.host_org_funding_class,
          org_subsidy_eligible: row.host_org_subsidy_eligible,
          org_manual_override_only: row.host_org_manual_override_only,
        }),
      });

      await client.query("COMMIT");
      summary.awarded += 1;
      summary.funded += 1;
    } catch (err) {
      summary.errors += 1;
      try {
        if (client) await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Reconcile rollback error:", rollbackErr);
      }
      console.error("Reconcile earn_shift error:", err);
    } finally {
      if (client) client.release();
    }
  }

  return summary;
}
