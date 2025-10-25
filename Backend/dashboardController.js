// Backend/dashboardController.js
// No `snapshot` usage. Ensures a real top-level `challenge` on each arc before render.
// Includes SQL logging with position marker if Postgres errors.

export function makeDashboardController(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg Pool instance is required');
  }

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

    await q(
      `
      UPDATE friend_arcs
      SET challenge = $1::jsonb,
          updated_at = NOW()
      WHERE id = $2
      `,
      [JSON.stringify(challengeObj), row.id],
      'ensureTopLevelChallenge.UPDATE friend_arcs'
    );

    // Reflect persisted value in memory for the render below.
    row.challenge = challengeObj;
  }

  return {
    async getDashboard(req, res) {
      try {
        const userId = req?.user?.id;
        if (!userId) {
          return res.status(401).render('error', {
            title: 'Unauthorized',
            message: 'Please sign in to view the dashboard.'
          });
        }

        // Keep your existing SELECT; log via q()
        const { rows: arcs } = await q(
          'select * from friend_arcs where user_id = $1 order by updated_at desc',
          [userId],
          'getDashboard.SELECT arcs'
        );

        // Ensure each arc has a top-level challenge object before rendering.
        for (const row of arcs) {
          await ensureTopLevelChallenge(row);
        }

        // Keep your existing render
        res.render('dashboard', {
          arcs,
          initialArcId: arcs[0]?.id || null,
          csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : null
        });
      } catch (error) {
        console.error('dashboardController.getDashboard error:', error);
        res.status(500).render('error', {
          title: 'Dashboard Error',
          message: 'Unable to load the dashboard. Please try again.'
        });
      }
    }
  };
}
