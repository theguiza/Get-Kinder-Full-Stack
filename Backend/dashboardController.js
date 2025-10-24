// ===========================
// What: Dashboard controller with proper database integration using existing styling approach
// Why: No Tailwind needed - using custom CSS and Bootstrap as in original files
// ===========================

import { mapFriendArcRow } from "./lib/friendArcMapper.js";

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
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).render("error", {
          title: "Unauthorized",
          message: "Please sign in to view the dashboard.",
        });
      }
      // Build arcs directly from completed Friend Quizzes stored in `friends`
      const { rows } = await pool.query(
        `
          SELECT
            id   AS friend_id,
            name AS friend_name,
            score   AS friend_score,
            archetype_primary AS friend_type
          FROM public.friends
          WHERE owner_user_id = $1
          ORDER BY name ASC NULLS LAST
        `,
        [userId]
      );

      const arcs = (rows || []).map((r, i) => ({
        id: r.friend_id ?? r.id ?? `friend-${i + 1}`,
        name: r.friend_name ?? r.name ?? `Friend ${i + 1}`,
        friend_score: r.friend_score ?? null,
        friend_type: r.friend_type ?? null
      }));

      res.render("dashboard", {
        arcs,
        initialArcId: arcs[0]?.id || null,
        assetTag: process.env.ASSET_TAG || "",
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).render("error", {
        title: "Dashboard Error",
        message: "Unable to load dashboard. Please try again.",
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
