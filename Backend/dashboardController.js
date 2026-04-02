import {
  fetchVolunteerPortfolio,
  getVolunteerStats,
  normalizeVolunteerPortfolioRows,
  resolveUserIdFromRequest,
  sortVolunteerPortfolioRows,
} from '../services/profileService.js';
import { buildProfileCompletion } from '../services/profileCompletionService.js';
import { getSummary as getRatingsSummary } from '../services/ratingsService.js';
import { getMatchedEventsForUser } from '../services/eventMatchingService.js';

export function makeDashboardController(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg Pool instance is required');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  let hasLoggedStatsFallbackWarning = false;
  let hasLoggedDashboardFallbackWarning = false;

  console.log('[dashboardController] loaded -> Backend/dashboardController.js v3');

  return {
    async getDashboard(req, res) {
      const templateUser = req?.user || res?.locals?.user || null;
      const baseViewLocals = {
        user: templateUser,
        name: templateUser?.firstname || templateUser?.email || null,
        success: typeof res?.locals?.success !== 'undefined' ? res.locals.success : false,
        loginSuccess: typeof res?.locals?.loginSuccess !== 'undefined' ? res.locals.loginSuccess : false
      };

      try {
        const resolvedUserId = await resolveUserIdFromRequest(req);
        const userId = resolvedUserId || req?.user?.id;
        if (!userId) {
          return res.status(401).render('error', {
            title: 'Unauthorized',
            message: 'Please sign in to view the dashboard.'
          });
        }

        let dashboardCompletedEvent = null;
        let dashboardCompletedEvents = [];
        let dashboardUpcomingEvent = null;
        let dashboardRecommendedEvents = [];
        let dashboardRecommendationsSummary = "";
        let dashboardRecommendationsFallbackMode = null;
        try {
          const rawPortfolioRows = await fetchVolunteerPortfolio({ userId, limit: 40 });
          const now = new Date();
          const portfolioRows = sortVolunteerPortfolioRows(
            normalizeVolunteerPortfolioRows(rawPortfolioRows, { now })
          );

          const upcomingRows = portfolioRows.filter((row) => row.is_upcoming);
          const completedRows = portfolioRows
            .filter((row) => row.is_completed && row.is_verified)
            .sort((a, b) => {
              const aTime = a.completed_at ? a.completed_at.getTime() : 0;
              const bTime = b.completed_at ? b.completed_at.getTime() : 0;
              return bTime - aTime;
            });
          dashboardUpcomingEvent = upcomingRows[0] || null;
          dashboardCompletedEvents = completedRows.slice(0, 3);
          dashboardCompletedEvent = dashboardCompletedEvents[0] || null;
        } catch (portfolioErr) {
          console.warn('[dashboardController] dashboard portfolio query failed:', portfolioErr.message || portfolioErr);
        }

        try {
          const matched = await getMatchedEventsForUser({
            userId,
            daysAhead: 35,
            limit: 3,
            minScore: 25,
          });
          if (matched?.status === 'success') {
            dashboardRecommendedEvents = Array.isArray(matched.events) ? matched.events.slice(0, 3) : [];
            dashboardRecommendationsSummary = typeof matched.summary === 'string' ? matched.summary : "";
            dashboardRecommendationsFallbackMode = matched.fallback_mode || null;
          }
        } catch (recommendationErr) {
          console.warn('[dashboardController] dashboard recommendations failed:', recommendationErr.message || recommendationErr);
        }

        let volunteerStats = null;
        try {
          volunteerStats = await getVolunteerStats(userId);
        } catch (statsErr) {
          if (!isProduction) {
            if (!hasLoggedStatsFallbackWarning) {
              console.warn(
                '[dashboardController] DB unavailable in dev; using dashboard stats fallback for UI QA.',
                statsErr.message || statsErr
              );
              hasLoggedStatsFallbackWarning = true;
            }
            volunteerStats = {
              impact_credits_balance: 0,
              verified_hours_total: 0,
              reliability_score: 50,
              streak_weeks: 0,
              priority_tier: 'Bronze'
            };
          } else {
            console.warn('[dashboardController] volunteer stats failed:', statsErr.message || statsErr);
            volunteerStats = null;
          }
        }

        let volunteerRating = { value: 5, count: 0, hasRatings: false, starsFilled: 5 };
        try {
          const summary = await getRatingsSummary({ userId, limit: 20 });
          const count = Number(summary?.sampleSize) || 0;
          const hasRatings = count > 0 && Number.isFinite(Number(summary?.kindnessRating));
          const value = hasRatings ? Number(summary.kindnessRating) : 5;
          const starsFilled = Math.max(1, Math.min(5, Math.round(value)));
          volunteerRating = { value, count, hasRatings, starsFilled };
        } catch (ratingErr) {
          if (ratingErr?.code !== '42P01') {
            console.warn('[dashboardController] volunteer rating failed:', ratingErr.message || ratingErr);
          }
        }
        const showStatsDebug = process.env.NODE_ENV !== "production" || Boolean(process.env.DEBUG);
        if (showStatsDebug) {
          console.log("[dashboard] req.user:", {
            id: req.user?.id,
            email: req.user?.email,
          });
          console.log("[dashboard] stats_user_id:", userId, "volunteerStats:", volunteerStats);
          console.log("[dashboard] volunteer_rating:", volunteerRating);
        }

        res.render('dashboard', {
          ...baseViewLocals,
          csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null,
          volunteerStats,
          volunteerRating,
          dashboardCompletedEvent,
          dashboardCompletedEvents,
          dashboardUpcomingEvent,
          dashboardRecommendedEvents,
          dashboardRecommendationsSummary,
          dashboardRecommendationsFallbackMode,
          profileCompletion: buildProfileCompletion({ user: templateUser }),
          debugStatsUserId: showStatsDebug ? String(userId) : null,
          showStatsDebug
        });
      } catch (error) {
        if (!isProduction) {
          if (!hasLoggedDashboardFallbackWarning) {
            console.warn(
              '[dashboardController] Falling back to dev dashboard UI stub because DB queries failed.',
              error?.message || error
            );
            hasLoggedDashboardFallbackWarning = true;
          }

          return res.render('dashboard', {
            ...baseViewLocals,
            csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null,
            volunteerStats: {
              impact_credits_balance: 0,
              verified_hours_total: 0,
              reliability_score: 50,
              streak_weeks: 0,
              priority_tier: 'Bronze'
            },
            volunteerRating: {
              value: 5,
              count: 0,
              hasRatings: false,
              starsFilled: 5
            },
            profileCompletion: buildProfileCompletion({ user: templateUser }),
            dashboardCompletedEvent: null,
            dashboardCompletedEvents: [],
            dashboardUpcomingEvent: null,
            dashboardRecommendedEvents: [],
            dashboardRecommendationsSummary: "",
            dashboardRecommendationsFallbackMode: null,
            debugStatsUserId: null,
            showStatsDebug: false
          });
        }

        console.error('dashboardController.getDashboard error:', error);
        res.status(500).render('error', {
          title: 'Dashboard Error',
          message: 'Unable to load the dashboard. Please try again.'
        });
      }
    }
  };
}
