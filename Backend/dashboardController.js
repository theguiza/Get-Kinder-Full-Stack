// ===========================
// What: Dashboard controller with proper database integration using existing styling approach
// Why: No Tailwind needed - using custom CSS and Bootstrap as in original files
// ===========================

/**
 * Dashboard Controller
 * Handles all dashboard-related database operations and business logic
 */

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const trimOrEmpty = (value) => (typeof value === "string" ? value.trim() : "");
const firstFiniteNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
};
const clampNumber = (value, min = 0, max = 100) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const maskValue = (value = "", opts = { keepStart: 4, keepEnd: 2 }) => {
  if (!value) return "";
  const str = String(value);
  const { keepStart = 4, keepEnd = 2 } = opts || {};
  if (str.length <= keepStart + keepEnd) return "*".repeat(Math.max(3, str.length));
  return `${str.slice(0, keepStart)}…${str.slice(-keepEnd)}`;
};

const formatDbUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    const maskedAuth = `${url.username || ""}:${maskValue(url.password || "")}`;
    return `${url.protocol}//${maskedAuth}@${url.hostname}:${url.port || ""}${url.pathname || ""}`;
  } catch (err) {
    return maskValue(value, { keepStart: 6, keepEnd: 4 });
  }
};

let envLogged = false;

export function makeDashboardController(pool) {
  
  /**
   * Main dashboard data fetcher
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  const getDashboard = async (req, res) => {
    try {
      const userId = req.user.id;
      
      //  DB - Fetch or create active challenge for user
      let activeChallenge = await getActiveChallenge(userId);
      
      // DB - Auto-assign first challenge if user has none
      if (!activeChallenge) {
        activeChallenge = await autoAssignFirstChallenge(userId);
      }
      
      //  DB - Check if challenge is completed (current_day > total_days)
      if (activeChallenge && activeChallenge.current_day > activeChallenge.total_days) {
        await completeChallenge(userId, activeChallenge.user_challenge_id);
        activeChallenge = null; // Will show next challenge suggestion
      }
      
      //  DB - Get next available challenge for preview
      const nextChallenge = await getNextChallenge(userId);
      
      // DB - Calculate user's kindness level
      const kindnessLevel = await calculateKindnessLevel(userId);
      const levelProgress = await calculateLevelProgress(userId);
      
      //  DB - Fetch user badges
      const userBadges = await getUserBadges(userId);
      
      //  DB - Get active quests for sidebar
      const quests = await getActiveQuests(userId);
      
      // DB - Fetch friend arcs for dashboard React mount
      // TODO: add smoke tests for dashboard friend arcs when test harness is available
      let arcs = [];
      let initialArcId = "";

      if (!envLogged) {
        envLogged = true;
        console.log("[dashboard] DB env summary", {
          DATABASE_URL: formatDbUrl(process.env.DATABASE_URL),
          DB_HOST: process.env.DB_HOST || null,
          DB_PORT: process.env.DB_PORT || null,
          DB_NAME: process.env.DB_NAME || null,
          DB_USER: process.env.DB_USER || null,
          NODE_ENV: process.env.NODE_ENV || null
        });
      }

      let dbContext = null;

      try {
        const { rows: ctxRows } = await pool.query(
          `SELECT current_database() AS database,
                  current_schema()   AS schema,
                  current_user       AS user,
                  current_setting('search_path') AS search_path`
        );
        dbContext = ctxRows[0] || null;
        if (dbContext) {
          console.log("[dashboard] DB context", dbContext);
        }
      } catch (ctxError) {
        console.warn("[dashboard] unable to read DB context:", ctxError.message || ctxError);
      }

      try {
        const friendsResult = await pool.query(
          `SELECT
              id::text       AS id,
              name,
              score,
              archetype_primary,
              archetype_secondary,
              picture,
              snapshot,
              signals,
              notes,
              flags_count,
              red_flags,
              evidence_direct,
              evidence_proxy,
              updated_at
           FROM public.friends
          WHERE owner_user_id = $1
          ORDER BY updated_at DESC NULLS LAST, name ASC`,
          [userId]
        );

        arcs = (friendsResult.rows || []).map((row, index) => {
          const snapshot = isPlainObject(row.snapshot) ? row.snapshot : {};
          const metrics = isPlainObject(snapshot.metrics) ? snapshot.metrics : {};
          const percent = clampNumber(
            firstFiniteNumber(
              row.percent,
              snapshot.percent,
              snapshot.progress_percent,
              snapshot.progressPercent,
              snapshot.completion_percent,
              snapshot.completionPercent,
              metrics.progress_percent,
              metrics.progressPercent
            ) ?? 0,
            0,
            100
          );
          const day = firstFiniteNumber(
            row.day,
            snapshot.day,
            snapshot.current_day,
            snapshot.currentDay,
            metrics.current_day,
            metrics.day
          ) ?? 0;
          const length = firstFiniteNumber(
            row.length,
            snapshot.length,
            snapshot.total_days,
            snapshot.totalDays,
            metrics.total_days,
            metrics.length
          ) ?? 0;
          const pointsToday = firstFiniteNumber(
            row.pointsToday,
            snapshot.points_today,
            snapshot.pointsToday,
            metrics.points_today
          ) ?? 0;
          const arcPoints = firstFiniteNumber(
            row.arcPoints,
            snapshot.arc_points,
            snapshot.arcPoints,
            metrics.arc_points
          ) ?? 0;
          const nextThreshold = firstFiniteNumber(
            row.nextThreshold,
            snapshot.next_threshold,
            snapshot.nextThreshold,
            metrics.next_threshold
          ) ?? 0;

          return {
            id: String(row.id ?? `friend-${index}`),
            name: trimOrEmpty(row.name) || `Friend ${index + 1}`,
            overdue: Boolean(
              typeof row.overdue === "boolean"
                ? row.overdue
                : snapshot.overdue ?? snapshot.is_overdue ?? false
            ),
            percent,
            day,
            length,
            pointsToday,
            friendScore: firstFiniteNumber(row.friendScore, row.score, snapshot.friend_score),
            friendType:
              trimOrEmpty(row.friendType) ||
              trimOrEmpty(row.archetype_primary) ||
              trimOrEmpty(row.archetype_secondary) ||
              trimOrEmpty(snapshot.friend_type) ||
              null,
            photoSrc: row.picture || snapshot.photo || null,
            steps: Array.isArray(row.steps)
              ? row.steps
              : Array.isArray(snapshot.steps)
              ? snapshot.steps
              : [],
            challenge: isPlainObject(row.challenge)
              ? row.challenge
              : isPlainObject(snapshot.challenge)
              ? snapshot.challenge
              : null,
            arcPoints,
            nextThreshold,
            lifetime: isPlainObject(row.lifetime)
              ? row.lifetime
              : isPlainObject(snapshot.lifetime)
              ? snapshot.lifetime
              : null,
            recent: Array.isArray(row.recent)
              ? row.recent
              : Array.isArray(snapshot.recent)
              ? snapshot.recent
              : [],
            badges: isPlainObject(row.badges)
              ? row.badges
              : isPlainObject(snapshot.badges)
              ? snapshot.badges
              : {},
            signals: Array.isArray(row.signals)
              ? row.signals
              : Array.isArray(snapshot.signals)
              ? snapshot.signals
              : [],
            redFlags: Array.isArray(row.red_flags)
              ? row.red_flags
              : Array.isArray(snapshot.red_flags)
              ? snapshot.red_flags
              : [],
            evidence: {
              direct: firstFiniteNumber(row.evidence_direct),
              proxy: firstFiniteNumber(row.evidence_proxy)
            },
            flagsCount: firstFiniteNumber(row.flags_count) ?? 0,
            notes: trimOrEmpty(row.notes),
            updatedAt: row.updated_at || null,
            snapshot
          };
        });

        initialArcId = arcs[0]?.id || "";
      } catch (friendError) {
        if (friendError?.code === "42P01") {
          console.warn(
            "friends table not found in current database; skipping arc hydration (set DATABASE_URL to production to use live data).",
            { dbContext }
          );
        } else if (friendError) {
          console.warn(
            "Dashboard friends query failed:",
            friendError.code ? { code: friendError.code, message: friendError.message, dbContext } : friendError
          );
        }
        arcs = [];
        initialArcId = "";
      }

      //  UI - Render dashboard with all data
      res.render('dashboard', {
        title: 'Kindness Challenge Dashboard',
        user: req.user,
        activeChallenge,
        nextChallenge,
        kindnessLevel,
        levelProgress,
        userBadges,
        quests,
        arcs,
        initialArcId,
        success: req.query.success === '1',
        loginSuccess: req.query.login === '1',
        name: req.query.name || req.user.firstname || req.user.email
      });
      
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).render('error', {
        title: 'Dashboard Error',
        message: 'Unable to load dashboard. Please try again.',
        user: req.user
      });
    }
  };

  /**
   * Morning Prompt - Get current day's challenge content
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  const getMorningPrompt = async (req, res) => {
    try {
      console.log('getMorningPrompt called for user:', req.user.id);
      
      const userId = req.user.id;
      
      // DB - Get user's active challenge
      const activeChallenge = await getActiveChallenge(userId);
      console.log('Active challenge:', activeChallenge);
      
      if (!activeChallenge) {
        console.log('No active challenge found, returning mock data');
        // Return mock data for testing
        return res.json({
          dayNumber: 1,
          dayTitle: 'Welcome to Your Kindness Journey',
          principle: 'Every small act of kindness creates ripples of positive change.',
          body: 'Today, focus on being present and noticing opportunities to spread kindness around you.',
          suggestedActs: [
            'Smile at three strangers',
            'Hold the door open for someone',
            'Send a thank you message to a friend'
          ],
          existingReflection: '',
          challengeName: 'Discover the Power of Kindness'
        });
      }
      
      // DB - Fetch day template for current day
      const dayTemplate = await pool.query(`
        SELECT day_number, day_title, principle, body, suggested_acts
        FROM challenge_day_templates
        WHERE challenge_id = $1 AND day_number = $2
      `, [activeChallenge.challenge_id, activeChallenge.current_day]);
      
      if (dayTemplate.rows.length === 0) {
        return res.status(404).json({ error: 'Day template not found' });
      }
      
      const template = dayTemplate.rows[0];
      
      //  DB - Check if user has existing reflection for this day
      const existingReflection = await pool.query(`
        SELECT reflection
        FROM challenge_logs
        WHERE user_id = $1 AND challenge_id = $2 AND day_number = $3
      `, [userId, activeChallenge.challenge_id, activeChallenge.current_day]);
      
      res.json({
        dayNumber: template.day_number,
        dayTitle: template.day_title,
        principle: template.principle,
        body: template.body,
        suggestedActs: Array.isArray(template.suggested_acts) ? template.suggested_acts : [],
        existingReflection: existingReflection.rows[0]?.reflection || '',
        challengeName: activeChallenge.challenge_name
      });
      
    } catch (error) {
      console.error('Morning prompt error:', error);
      res.status(500).json({ error: 'Failed to load morning prompt' });
    }
  };

  /**
   * Reflection - Save user reflection to database and KAI
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  const saveReflection = async (req, res) => {
    try {
      const userId = req.user.id;
      const { reflection } = req.body;
      
      if (!reflection || reflection.trim().length === 0) {
        return res.status(400).json({ error: 'Reflection cannot be empty' });
      }
      
      //  DB - Get user's active challenge
      const activeChallenge = await getActiveChallenge(userId);
      if (!activeChallenge) {
        return res.status(404).json({ error: 'No active challenge found' });
      }
      
      //  DB - Save reflection to challenge_logs
      await pool.query(`
        INSERT INTO challenge_logs (user_id, challenge_id, day_number, reflection, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (user_id, challenge_id, day_number)
        DO UPDATE SET reflection = EXCLUDED.reflection, updated_at = NOW()
      `, [userId, activeChallenge.challenge_id, activeChallenge.current_day, reflection.trim()]);
      
      // KAI integration - Save to KAI interactions for context
      await pool.query(`
        INSERT INTO kai_interactions (user_id, context_type, context_id, message, created_at)
        VALUES ($1, 'reflection', $2, $3, NOW())
      `, [userId, activeChallenge.challenge_id, reflection.trim()]);
      
      res.json({ 
        success: true, 
        message: 'Reflection saved successfully!' 
      });
      
    } catch (error) {
      console.error('Save reflection error:', error);
      res.status(500).json({ error: 'Failed to save reflection' });
    }
  };

  /**
   *  Progress - Mark current day as done and advance challenge
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  const markDayDone = async (req, res) => {
    try {
      const userId = req.user.id;
      
      //  DB - Get user's active challenge
      const activeChallenge = await getActiveChallenge(userId);
      if (!activeChallenge) {
        return res.status(404).json({ error: 'No active challenge found' });
      }
      
      const newDay = activeChallenge.current_day + 1;
      
      //  DB - Mark current day as completed in challenge_logs
      await pool.query(`
        INSERT INTO challenge_logs (user_id, challenge_id, day_number, completed, completed_at)
        VALUES ($1, $2, $3, true, NOW())
        ON CONFLICT (user_id, challenge_id, day_number)
        DO UPDATE SET completed = true, completed_at = NOW()
      `, [userId, activeChallenge.challenge_id, activeChallenge.current_day]);
      
      // DB - Check if challenge is completed
      if (newDay > activeChallenge.total_days) {
        //  DB - Mark challenge as completed
        await completeChallenge(userId, activeChallenge.user_challenge_id);
        
        res.json({ 
          success: true, 
          challengeCompleted: true,
          message: 'Congratulations! You completed the challenge!' 
        });
      } else {
        //  DB - Advance to next day
        await pool.query(`
          UPDATE user_challenges 
          SET current_day = $1, updated_at = NOW()
          WHERE id = $2
        `, [newDay, activeChallenge.user_challenge_id]);
        
        res.json({ 
          success: true, 
          challengeCompleted: false,
          newDay: newDay,
          message: `Great job! Moving to day ${newDay}` 
        });
      }
      
    } catch (error) {
      console.error('Mark day done error:', error);
      res.status(500).json({ error: 'Failed to mark day as done' });
    }
  };
  /**
   * Cancel current active challenge
   * @param {Object} req - Express request object  
   * @param {Object} res - Express response object
   */
  const cancelChallenge = async (req, res) => {
    try {
      const userId = req.user.id;
      
      // DB - Update active challenge status to cancelled
      await pool.query(
        `UPDATE user_challenges 
         SET status = 'cancelled', 
             updated_at = NOW() 
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      
      //  UI - Redirect back to dashboard with success message
      res.redirect('/dashboard?cancelled=1');
      
    } catch (error) {
      console.error('Cancel challenge error:', error);
      res.status(500).json({ error: 'Failed to cancel challenge' });
    }
  };

  /**
   *  DB - Complete a challenge and update status
   * @param {number} userId - User ID
   * @param {number} userChallengeId - User challenge ID
   */
  async function completeChallenge(userId, userChallengeId) {
    try {
      await pool.query(`
        UPDATE user_challenges 
        SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2
      `, [userChallengeId, userId]);
      
      console.log(`Challenge completed for user ${userId}`);
    } catch (error) {
      console.error('Error completing challenge:', error);
      throw error;
    }
  }
  /**
   * Get user's active challenge with challenge details
   * @param {number} userId - User ID
   * @returns {Object|null} Active challenge data or null
   */
  async function getActiveChallenge(userId) {
    try {
      // DB - Join user_challenges with challenges table for active challenge
      const result = await pool.query(`
        SELECT 
          uc.id as user_challenge_id,
          uc.current_day,
          uc.start_date,
          uc.status,
          c.id as challenge_id,
          c.name as challenge_name,
          c.description,
          c.total_days,
          c.difficulty
        FROM user_challenges uc
        JOIN challenges c ON uc.challenge_id = c.id
        WHERE uc.user_id = $1 AND uc.status = 'active'
        LIMIT 1
      `, [userId]);
      
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching active challenge:', error);
      return null;
    }
  }

  /**
   * Auto-assign the first challenge to new users
   * @param {number} userId - User ID
   * @returns {Object|null} Newly assigned challenge or null
   */
  async function autoAssignFirstChallenge(userId) {
    try {
      // DB - Find the "Discover the Power of Kindness" challenge
      const challengeResult = await pool.query(`
        SELECT id, name, description, total_days, difficulty
        FROM challenges 
        WHERE name = 'Discover the Power of Kindness'
        LIMIT 1
      `);
      
      if (challengeResult.rows.length === 0) {
        // DB - Fallback to first available challenge if default doesn't exist
        const fallbackResult = await pool.query(`
          SELECT id, name, description, total_days, difficulty
          FROM challenges 
          ORDER BY id ASC
          LIMIT 1
        `);
        
        if (fallbackResult.rows.length === 0) {
          return null; // No challenges available
        }
        
        const challenge = fallbackResult.rows[0];
        
        //  DB - Insert user_challenge record
        await pool.query(`
          INSERT INTO user_challenges (user_id, challenge_id, status, current_day, start_date)
          VALUES ($1, $2, 'active', 1, NOW())
        `, [userId, challenge.id]);
        
        return {
          challenge_id: challenge.id,
          challenge_name: challenge.name,
          description: challenge.description,
          total_days: challenge.total_days,
          current_day: 1,
          status: 'active'
        };
      }
      
      const challenge = challengeResult.rows[0];
      
      // DB - Insert user_challenge record for default challenge
      await pool.query(`
        INSERT INTO user_challenges (user_id, challenge_id, status, current_day, start_date)
        VALUES ($1, $2, 'active', 1, NOW())
      `, [userId, challenge.id]);
      
      return {
        challenge_id: challenge.id,
        challenge_name: challenge.name,
        description: challenge.description,
        total_days: challenge.total_days,
        current_day: 1,
        status: 'active'
      };
      
    } catch (error) {
      console.error('Error auto-assigning first challenge:', error);
      return null;
    }
  }

  /**
   * Get next available challenge for user to preview
   * @param {number} userId - User ID
   * @returns {Object|null} Next challenge data or null
   */
  async function getNextChallenge(userId) {
    try {
      //  DB - Find first challenge user hasn't started
      const result = await pool.query(`
        SELECT c.id, c.name, c.description, c.total_days, c.difficulty
        FROM challenges c
        WHERE c.id NOT IN (
          SELECT challenge_id 
          FROM user_challenges 
          WHERE user_id = $1
        )
        ORDER BY c.id ASC
        LIMIT 1
      `, [userId]);
      
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error fetching next challenge:', error);
      return null;
    }
  }

  /**
   * Calculate user's kindness level based on completed days
   * @param {number} userId - User ID
   * @returns {number} Kindness level
   */
  async function calculateKindnessLevel(userId) {
    try {
      //  DB - Sum all completed challenge days and divide by 10
      const result = await pool.query(`
        SELECT COALESCE(SUM(current_day), 0) as total_days
        FROM user_challenges
        WHERE user_id = $1 AND status = 'completed'
      `, [userId]);
      
      const totalDays = parseInt(result.rows[0].total_days) || 0;
      return Math.floor(totalDays / 10) + 1; // Start at level 1
    } catch (error) {
      console.error('Error calculating kindness level:', error);
      return 1;
    }
  }

  /**
   * Calculate progress toward next level
   * @param {number} userId - User ID
   * @returns {number} Progress percentage (0-100)
   */
  async function calculateLevelProgress(userId) {
    try {
      //  DB - Get total completed days for progress calculation
      const result = await pool.query(`
        SELECT COALESCE(SUM(current_day), 0) as total_days
        FROM user_challenges
        WHERE user_id = $1 AND status = 'completed'
      `, [userId]);
      
      const totalDays = parseInt(result.rows[0].total_days) || 0;
      const progressInCurrentLevel = totalDays % 10;
      return Math.round((progressInCurrentLevel / 10) * 100);
    } catch (error) {
      console.error('Error calculating level progress:', error);
      return 0;
    }
  }

  /**
   * Get user's earned badges
   * @param {number} userId - User ID
   * @returns {Array} Array of badge objects
   */
  async function getUserBadges(userId) {
    try {
      //  DB - Join user_badges with badges table
      const result = await pool.query(`
        SELECT b.id, b.name, b.description, b.icon, ub.earned_at
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = $1
        ORDER BY ub.earned_at DESC
      `, [userId]);
      
      return result.rows;
    } catch (error) {
      console.error('Error fetching user badges:', error);
      return [];
    }
  }

  /**
   * Get active quests for sidebar display
   * @param {number} userId - User ID
   * @returns {Array} Array of quest objects
   */
  async function getActiveQuests(userId) {
    try {
      //  DB - Get top 5 active quests with difficulty info
      const result = await pool.query(`
        SELECT 
          q.id,
          q.name,
          q.description,
          COALESCE(q.difficulty, 'Medium') as difficulty
        FROM quests q
        WHERE q.id NOT IN (
          SELECT quest_id 
          FROM user_quests 
          WHERE user_id = $1 AND status = 'completed'
        )
        ORDER BY q.id ASC
        LIMIT 5
      `, [userId]);
      
      return result.rows;
    } catch (error) {
      console.error('Error fetching active quests:', error);
      return [];
    }
  }

  return {
    getDashboard,
    getMorningPrompt,
    saveReflection,
    markDayDone,
    cancelChallenge
  };
}
