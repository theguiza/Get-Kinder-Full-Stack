import { progressPercent } from '../shared/metrics.js';
import { mapFriendArcRow } from './lib/friendArcMapper.js';
import { fetchVolunteerPortfolio, getVolunteerStats, resolveUserIdFromRequest } from '../services/profileService.js';

// Backend/dashboardController.js
// No `snapshot` usage. Ensures a real top-level `challenge` on each arc before render.
// Includes SQL logging with position marker if Postgres errors.

export function makeDashboardController(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg Pool instance is required');
  }

  const DAILY_SURPRISE_LIMIT = 3;
  const isProduction = process.env.NODE_ENV === 'production';
  let hasLoggedStatsFallbackWarning = false;
  let hasLoggedDashboardFallbackWarning = false;

  // --- identify the loaded file/version so you know THIS file is running
  console.log('[dashboardController] loaded -> Backend/dashboardController.js v3');

  // ---------- tiny SQL helper with error position marker ----------
  async function q(text, values = [], label = '') {
    try {
      // comment label so it shows in logs but stays valid SQL
      const sql = label ? `/* ${label} */\n${text}` : text;
      // log compact SQL (first line only) to confirm what's executing
      console.log('[SQL]', (sql.split('\n')[0] || sql).trim(), values || []);
      return await pool.query(sql, values);
    } catch (err) {
      // Visualize exact failing character position, if provided by Postgres
      if (err && err.position && typeof err.position === 'string') {
        const pos = Number(err.position);
        const before = text.slice(0, pos - 1);
        const after  = text.slice(pos - 1);
        console.error('--- SQL ERROR POSITION ---');
        console.error((label ? `/* ${label} */\n` : '') + before + '⟂' + after);
        console.error('--------------------------');
      }
      throw err;
    }
  }

  // ---------- small helpers ----------
  const MUSTACHE_NAME = /\{\{\s*friend_name\s*\}\}/gi;
  const MUSTACHE_MIN  = /\{\{\s*est_minutes\s*\}\}/gi;

  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const ensureNormalizedArc = (row) => {
    const normalized = mapFriendArcRow(row);
    const merged = {
      ...row,
      ...normalized,
      friend_score: normalized.friendScore ?? row.friend_score ?? null,
      friendScore: normalized.friendScore ?? row.friendScore ?? null,
      friend_type: normalized.friendType ?? row.friend_type ?? null,
      friendType: normalized.friendType ?? row.friendType ?? null,
      arc_points: normalized.arcPoints ?? row.arc_points ?? 0,
      arcPoints: normalized.arcPoints ?? row.arcPoints ?? 0,
      next_threshold: normalized.nextThreshold ?? row.next_threshold ?? 100,
      nextThreshold: normalized.nextThreshold ?? row.nextThreshold ?? 100,
      points_today: normalized.pointsToday ?? row.points_today ?? 0,
      pointsToday: normalized.pointsToday ?? row.pointsToday ?? 0,
      percent: normalized.percent ?? row.percent ?? 0,
      lifetime: normalized.lifetime,
      steps: normalized.steps,
      challenge: normalized.challenge,
      badges: normalized.badges,
      friend_id: normalized.friend_id ?? row.friend_id ?? row.id
    };

    if (normalized.pendingDay) {
      merged.pendingDay = normalized.pendingDay;
      merged.pending_day = normalized.pendingDay;
    } else {
      delete merged.pendingDay;
      delete merged.pending_day;
    }

    if (normalized.pendingDayUnlockAt) {
      merged.pendingDayUnlockAt = normalized.pendingDayUnlockAt;
      merged.pending_day_unlock_at = normalized.pendingDayUnlockAt;
    } else {
      delete merged.pendingDayUnlockAt;
      delete merged.pending_day_unlock_at;
    }

    if (normalized.awaitingNextDay) {
      merged.awaitingNextDay = true;
    } else {
      delete merged.awaitingNextDay;
    }

    return merged;
  };

  function renderTemplate(str, vars) {
    if (!str) return '';
    const name = vars.friend_name ?? vars.friendName ?? 'your friend';
    const mins = String(vars.est_minutes ?? vars.estMinutes ?? 5);
    return String(str).replace(MUSTACHE_NAME, name).replace(MUSTACHE_MIN, mins);
  }

  async function pickOneActiveChallengeTemplate() {
    const { rows } = await q(
      `SELECT id, title_template, description_template, effort, channel,
              est_minutes, points, swaps_allowed
       FROM challenge_templates
       WHERE is_active = TRUE
       ORDER BY random()
       LIMIT 1`,
      [],
      'pickOneActiveChallengeTemplate'
    );
    return rows[0] || null;
  }

  async function ensureTopLevelChallenge(row) {
    // If friend_arcs.challenge already exists and is a JSON object, keep it.
    if (isPlainObject(row.challenge)) return;

    const lifetime = isPlainObject(row.lifetime) ? { ...row.lifetime } : {};
    const today = new Date().toISOString().slice(0, 10);
    let limit = Number(lifetime.dailySurpriseLimit ?? lifetime.daily_surprise_limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = DAILY_SURPRISE_LIMIT;
    }
    let count = Number(lifetime.dailySurpriseCount ?? lifetime.daily_surprise_count);
    if (!Number.isFinite(count) || count < 0) {
      count = 0;
    }
    const storedDateRaw =
      typeof lifetime.dailySurpriseDate === 'string'
        ? lifetime.dailySurpriseDate
        : typeof lifetime.daily_surprise_date === 'string'
        ? lifetime.daily_surprise_date
        : null;
    const storedDate = storedDateRaw && storedDateRaw.trim() ? storedDateRaw.trim() : null;

    let lifetimeChanged = false;
    if (storedDate !== today) {
      count = 0;
      lifetime.dailySurpriseDate = today;
      lifetime.daily_surprise_date = today;
      lifetimeChanged = true;
    }
    if ((lifetime.dailySurpriseLimit ?? lifetime.daily_surprise_limit) !== limit) {
      lifetimeChanged = true;
    }
    lifetime.dailySurpriseLimit = limit;
    lifetime.daily_surprise_limit = limit;
    lifetime.dailySurpriseCount = count;
    lifetime.daily_surprise_count = count;

    if (limit > 0 && storedDate === today && count >= limit) {
      if (lifetimeChanged) {
        await q(
          `
          UPDATE friend_arcs
             SET lifetime   = $1::jsonb,
                 updated_at = NOW()
           WHERE id = $2
             AND user_id = $3
          `,
          [JSON.stringify(lifetime), row.id, row.user_id],
          'ensureTopLevelChallenge.UPDATE lifetime (limit reached)'
        );
        row.lifetime = lifetime;
      }
      row.lifetime = lifetime;
      row.challenge = null;
      return;
    }

    // Otherwise, pick a template and persist a personalized challenge.
    const tmpl = await pickOneActiveChallengeTemplate();
    if (!tmpl) {
      // No templates seeded; leave null so the UI can fall back.
      row.challenge = null;
      return;
    }

    const friendName =
      (typeof row.name === 'string' && row.name.trim()) ||
      (typeof row.friend_name === 'string' && row.friend_name.trim()) ||
      'your friend';

    const est = Number(tmpl.est_minutes) || 5;

    // Include both camel & snake variants (client tolerates either).
    const challengeObj = {
      id: tmpl.id,
      templateId: tmpl.id,
      template_id: tmpl.id,
      channel: tmpl.channel || 'text',
      title: renderTemplate(tmpl.title_template, { friend_name: friendName, est_minutes: est }),
      description: renderTemplate(tmpl.description_template, { friend_name: friendName, est_minutes: est }),
      effort: (tmpl.effort || 'low'), // keep lower-case for logic
      effortLabel: (tmpl.effort || 'low').replace(/^./, c => c.toUpperCase()),
      estMinutes: est,
      est_minutes: est,
      points: Number(tmpl.points) || 0,
      swapsLeft: Number(tmpl.swaps_allowed) || 0,
      swaps_allowed: Number(tmpl.swaps_allowed) || 0,
      isFallback: false
    };

    lifetime.dailySurpriseLimit = limit;
    lifetime.daily_surprise_limit = limit;
    row.lifetime = lifetime;

    await q(
      `
      UPDATE friend_arcs
      SET challenge   = $1::jsonb,
          lifetime    = $2::jsonb,
          updated_at  = NOW()
      WHERE id = $3
        AND user_id = $4
      `,
      [JSON.stringify(challengeObj), JSON.stringify(lifetime), row.id, row.user_id],
      'ensureTopLevelChallenge.UPDATE friend_arcs'
    );

    // Reflect persisted value in memory for the render below.
    row.challenge = challengeObj;
  }

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
        let dashboardUpcomingEvent = null;
        try {
          const rawPortfolioRows = await fetchVolunteerPortfolio({ userId, limit: 40 });
          const now = new Date();
          const portfolioRows = rawPortfolioRows.map((row) => {
            const startAt = row.start_at ? new Date(row.start_at) : null;
            const endAt = row.end_at ? new Date(row.end_at) : null;
            const ms = (startAt && endAt) ? Math.max(0, endAt - startAt) : 0;
            const duration_hours = ms > 0 ? Math.round((ms / 36e5) * 10) / 10 : 0;
            const is_upcoming = !!(startAt && startAt > now && ['published', 'scheduled'].includes(row.event_status));
            const is_verified = row.verification_status === 'verified';
            const acceptedCount = Number(row.accepted_count) || 0;
            const poolKind = row.reward_pool_kind != null ? Number(row.reward_pool_kind) : 0;
            const safePoolKind = Number.isFinite(poolKind) ? poolKind : 0;
            const kind_estimate_per_user = Math.floor(safePoolKind / Math.max(acceptedCount, 1));

            return {
              ...row,
              start_at: startAt,
              end_at: endAt,
              duration_hours,
              is_upcoming,
              is_verified,
              kind_estimate_per_user,
              accepted_count: acceptedCount
            };
          });

          const upcomingRows = portfolioRows.filter((row) => row.is_upcoming);
          const completedRows = portfolioRows.filter((row) => !row.is_upcoming);
          dashboardUpcomingEvent = upcomingRows[0] || null;
          dashboardCompletedEvent = completedRows[0] || null;
        } catch (portfolioErr) {
          console.warn('[dashboardController] dashboard portfolio query failed:', portfolioErr.message || portfolioErr);
        }

        // Keep your existing SELECT; log via q()
        const { rows: arcRows } = await q(
          'select * from friend_arcs where user_id = $1 order by updated_at desc',
          [userId],
          'getDashboard.SELECT arcs'
        );
        const arcs = Array.isArray(arcRows) ? arcRows : [];

        let hydratedArcs = arcs;
        if (arcs.length) {
          const friendIds = Array.from(
            new Set(
              arcs
                .map((row) => (row?.id != null ? String(row.id) : null))
                .filter((id) => typeof id === 'string' && id.length > 0)
            )
          );
          if (friendIds.length) {
            const { rows: friendRows } = await q(
              `
              SELECT id::text AS id, name, score, archetype_primary, picture
                FROM friends
               WHERE owner_user_id = $1
                 AND id::text = ANY($2::text[])
              `,
              [userId, friendIds],
              'getDashboard.SELECT friendsForArcs'
            );
            const friendMap = new Map(friendRows.map((f) => [f.id, f]));
            hydratedArcs = arcs.map((arc) => {
              const friend = friendMap.get(String(arc.id));
              if (!friend) return arc;
              const next = { ...arc };
              if (next.friend_score == null && friend.score != null) {
                next.friend_score = friend.score;
              }
              if (next.friendScore == null && next.friend_score != null) {
                next.friendScore = next.friend_score;
              }
              if (!next.friend_type && friend.archetype_primary) {
                next.friend_type = friend.archetype_primary;
              }
              if (!next.friendType && next.friend_type) {
                next.friendType = next.friend_type;
              }
              if (!next.archetype_primary && friend.archetype_primary) {
                next.archetype_primary = friend.archetype_primary;
              }
              if (!next.picture && friend.picture) {
                next.picture = friend.picture;
              }
              if (!next.photoSrc && (next.picture || friend.picture)) {
                next.photoSrc = next.picture || friend.picture;
              }

              const baseSnapshot =
                next.snapshot && typeof next.snapshot === 'object'
                  ? { ...next.snapshot }
                  : {};
              if (friend.score != null && baseSnapshot.score == null) {
                baseSnapshot.score = friend.score;
              }
              if (friend.archetype_primary && baseSnapshot.friend_type == null) {
                baseSnapshot.friend_type = friend.archetype_primary;
              }
              if (friend.archetype_primary && baseSnapshot.archetype_primary == null) {
                baseSnapshot.archetype_primary = friend.archetype_primary;
              }
              if (friend.picture && baseSnapshot.photo == null) {
                baseSnapshot.photo = friend.picture;
              }
              if (friend.picture && baseSnapshot.picture == null) {
                baseSnapshot.picture = friend.picture;
              }
              next.snapshot = baseSnapshot;
              return next;
            });
          }
        }

        // Ensure each arc has a top-level challenge object before rendering.
        const normalizedArcs = [];
        for (const row of hydratedArcs) {
          await ensureTopLevelChallenge(row);
          const rawPoints = Number(row.arc_points ?? row.arcPoints);
          const points = Number.isFinite(rawPoints) ? rawPoints : 0;
          const rawThreshold = Number(row.next_threshold ?? row.nextThreshold);
          const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 100;
          row.next_threshold = threshold;
          if (!Number.isFinite(Number(row.nextThreshold)) || Number(row.nextThreshold) <= 0) {
            row.nextThreshold = threshold;
          }
          row.percent = progressPercent(points, threshold);
          normalizedArcs.push(ensureNormalizedArc(row));
        }

        let arcsForRender = normalizedArcs;
        if (!arcsForRender.length) {
          const { rows: friendFallback } = await q(
            `
            SELECT id::text AS id, name, score, archetype_primary, picture
              FROM friends
             WHERE owner_user_id = $1
             ORDER BY updated_at DESC
            `,
            [userId],
            'getDashboard.SELECT friendsFallback'
          );
          arcsForRender = friendFallback.map((friend) => ({
            id: friend.id,
            name: friend.name,
            friend_score: friend.score,
            friendScore: friend.score,
            score: friend.score,
            friend_type: friend.archetype_primary,
            friendType: friend.archetype_primary,
            archetype_primary: friend.archetype_primary,
            picture: friend.picture,
            photoSrc: friend.picture,
            snapshot: {
              score: friend.score,
              friend_type: friend.archetype_primary,
              archetype_primary: friend.archetype_primary,
              photo: friend.picture,
              picture: friend.picture
            }
          }));
        }

        // Keep your existing render
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
              streak_weeks: 0,
              priority_tier: 'Bronze'
            };
          } else {
            console.warn('[dashboardController] volunteer stats failed:', statsErr.message || statsErr);
            volunteerStats = null;
          }
        }
        const showStatsDebug = process.env.NODE_ENV !== "production" || Boolean(process.env.DEBUG);
        if (showStatsDebug) {
          console.log("[dashboard] req.user:", {
            id: req.user?.id,
            email: req.user?.email,
          });
          console.log("[dashboard] stats_user_id:", userId, "volunteerStats:", volunteerStats);
        }

        res.render('dashboard', {
          ...baseViewLocals,
          arcs: Array.isArray(arcsForRender) ? arcsForRender : [],
          initialArcId: arcsForRender[0]?.id || null,
          csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null,
          volunteerStats,
          dashboardCompletedEvent,
          dashboardUpcomingEvent,
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
            arcs: [],
            initialArcId: null,
            csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null,
            volunteerStats: {
              impact_credits_balance: 0,
              streak_weeks: 0,
              priority_tier: 'Bronze'
            },
            dashboardCompletedEvent: null,
            dashboardUpcomingEvent: null,
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
