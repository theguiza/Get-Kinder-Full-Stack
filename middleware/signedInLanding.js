// JOIN-4 signed-in landing: the one central seam that makes /impact-library
// the normal KAI landing for an authenticated user. Every existing login
// success path (local POST /login, Google and Facebook OAuth callbacks, and
// email-verified signup, which returns through /login) already converges on
// GET /home, so redirecting an authenticated GET /home here avoids editing
// each authentication provider. Unauthenticated visitors still get the
// normal public /home page, and the /home/<section> marketing deep links and
// "/" are separate routes this middleware is never mounted on.
export const SIGNED_IN_LANDING_PATH = "/impact-library";

export function redirectAuthenticatedHomeToSignedInLanding(req, res, next) {
  const isAuthenticated = typeof req.isAuthenticated === "function" && req.isAuthenticated();
  if (!isAuthenticated) return next();
  return res.redirect(302, SIGNED_IN_LANDING_PATH);
}
