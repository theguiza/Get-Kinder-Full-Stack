// Backend/dashboardController.js
export function makeDashboardController(pool) {
  async function getDashboard(req, res) {
    try {
      if (!req.user) {
        return res.redirect('/login');
      }

      // If your req.user already carries the id from userdata, great.
      // If not, you can do a quick lookup to get it from email.
      const userId = req.user.id
        ? req.user.id
        : (await pool.query('SELECT id FROM userdata WHERE email = $1', [req.user.email])).rows[0]?.id;

      if (!userId) {
        return res.redirect('/login');
      }

      // ─────────────────────────────────────────────────────────
      // 1) ACTIVE CHALLENGE
      // ─────────────────────────────────────────────────────────
      const activeChallengeRes = await pool.query(
        `
        SELECT
          c.name AS challenge_name,
          c.description,
          uc.current_day,
          c.total_days,
          uc.start_date
        FROM user_challenges uc
        JOIN challenges c ON c.id = uc.challenge_id
        WHERE uc.user_id = $1
          AND uc.status = 'active'
        ORDER BY uc.start_date DESC
        LIMIT 1
        `,
        [userId]
      );
      const activeChallenge = activeChallengeRes.rows[0] || null;

      // ─────────────────────────────────────────────────────────
      // 2) UPCOMING CHALLENGE
      // (first available challenge the user hasn't started yet)
      // ─────────────────────────────────────────────────────────
      const upcomingChallengeRes = await pool.query(
        `
        SELECT c.id, c.name, c.description, c.total_days
        FROM challenges c
        WHERE c.is_active = TRUE
          AND NOT EXISTS (
            SELECT 1
            FROM user_challenges uc
            WHERE uc.challenge_id = c.id
              AND uc.user_id = $1
          )
        ORDER BY c.created_at DESC
        LIMIT 1
        `,
        [userId]
      );
      const upcomingChallenge = upcomingChallengeRes.rows[0] || null;

      // ─────────────────────────────────────────────────────────
      // 3) USER BADGES
      // ─────────────────────────────────────────────────────────
      const userBadgesRes = await pool.query(
        `
        SELECT b.name, b.icon, b.description
        FROM user_badges ub
        JOIN badges b ON b.id = ub.badge_id
        WHERE ub.user_id = $1
        ORDER BY ub.earned_at DESC
        `,
        [userId]
      );
      const userBadges = userBadgesRes.rows || [];

      // ─────────────────────────────────────────────────────────
      // 4) QUESTS (available list)
      // NOTE: dashboard.ejs expects a difficulty column. If you don't have it yet,
      //       either add it to the schema OR default to 'Medium' for now.
      // ─────────────────────────────────────────────────────────
      const questsRes = await pool.query(
        `
        SELECT id, name, description,
          COALESCE(difficulty, 'Medium') AS difficulty
        FROM quests
        WHERE is_active = TRUE
        ORDER BY id DESC
        LIMIT 5
        `
      );
      const quests = questsRes.rows || [];

      // ─────────────────────────────────────────────────────────
      // 5) Kindness Level calculation
      // - Example logic: sum the current_day for completed challenges
      //   -> every 10 days == +1 level
      // ─────────────────────────────────────────────────────────
      const totalDaysRes = await pool.query(
        `
        SELECT COALESCE(SUM(current_day), 0) AS total_days
        FROM user_challenges
        WHERE user_id = $1
          AND status = 'completed'
        `,
        [userId]
      );
      const totalDays = Number(totalDaysRes.rows[0]?.total_days || 0);

      const kindnessLevel = Math.floor(totalDays / 10) + 1;
      const levelProgress = (totalDays % 10) * 10; // 0–90 (as %)

      return res.render('dashboard', {
        activeChallenge,
        upcomingChallenge,
        userBadges,
        quests,
        kindnessLevel,
        levelProgress,
        user: req.user
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      return res
        .status(500)
        .render('error', {
          error: 'Database Error',
          message: 'Unable to load dashboard data.'
        });
    }
  }

  return { getDashboard };
}
