// ===========================
// BOLT CHANGELOG
// Date: 2025-01-27
// What: Dashboard controller with proper database integration using existing styling approach
// Why: No Tailwind needed - using custom CSS and Bootstrap as in original files
// ===========================

/**
 * Dashboard Controller
 * Handles all dashboard-related database operations and business logic
 */

export function makeDashboardController(pool) {
  
  /**
   * Main dashboard data fetcher
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  const getDashboard = async (req, res) => {
    try {
      const userId = req.user.id;
      
      // BOLT: DB - Fetch or create active challenge for user
      let activeChallenge = await getActiveChallenge(userId);
      
      // BOLT: DB - Auto-assign first challenge if user has none
      if (!activeChallenge) {
        activeChallenge = await autoAssignFirstChallenge(userId);
      }
      
      // BOLT: DB - Get next available challenge for preview
      const nextChallenge = await getNextChallenge(userId);
      
      // BOLT: DB - Calculate user's kindness level
      const kindnessLevel = await calculateKindnessLevel(userId);
      const levelProgress = await calculateLevelProgress(userId);
      
      // BOLT: DB - Fetch user badges
      const userBadges = await getUserBadges(userId);
      
      // BOLT: DB - Get active quests for sidebar
      const quests = await getActiveQuests(userId);
      
      // BOLT: UI - Render dashboard with all data
      res.render('dashboard', {
        title: 'Kindness Challenge Dashboard',
        user: req.user,
        activeChallenge,
        nextChallenge,
        kindnessLevel,
        levelProgress,
        userBadges,
        quests,
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
   * Cancel current active challenge
   * @param {Object} req - Express request object  
   * @param {Object} res - Express response object
   */
  const cancelChallenge = async (req, res) => {
    try {
      const userId = req.user.id;
      
      // BOLT: DB - Update active challenge status to cancelled
      await pool.query(
        `UPDATE user_challenges 
         SET status = 'cancelled', 
             updated_at = NOW() 
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      
      // BOLT: UI - Redirect back to dashboard with success message
      res.redirect('/dashboard?cancelled=1');
      
    } catch (error) {
      console.error('Cancel challenge error:', error);
      res.status(500).json({ error: 'Failed to cancel challenge' });
    }
  };

  /**
   * Get user's active challenge with challenge details
   * @param {number} userId - User ID
   * @returns {Object|null} Active challenge data or null
   */
  async function getActiveChallenge(userId) {
    try {
      // BOLT: DB - Join user_challenges with challenges table for active challenge
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
      // BOLT: DB - Find the "Discover the Power of Kindness" challenge
      const challengeResult = await pool.query(`
        SELECT id, name, description, total_days, difficulty
        FROM challenges 
        WHERE name = 'Discover the Power of Kindness'
        LIMIT 1
      `);
      
      if (challengeResult.rows.length === 0) {
        // BOLT: DB - Fallback to first available challenge if default doesn't exist
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
        
        // BOLT: DB - Insert user_challenge record
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
      
      // BOLT: DB - Insert user_challenge record for default challenge
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
      // BOLT: DB - Find first challenge user hasn't started
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
      // BOLT: DB - Sum all completed challenge days and divide by 10
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
      // BOLT: DB - Get total completed days for progress calculation
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
      // BOLT: DB - Join user_badges with badges table
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
      // BOLT: DB - Get top 5 active quests with difficulty info
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
    cancelChallenge
  };
}