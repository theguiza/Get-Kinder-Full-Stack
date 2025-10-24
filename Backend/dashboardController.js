export function makeDashboardController(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A pg Pool instance is required');
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

        const { rows: arcs } = await pool.query(
          'select * from friend_arcs where user_id = $1 order by updated_at desc',
          [userId]
        );

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
