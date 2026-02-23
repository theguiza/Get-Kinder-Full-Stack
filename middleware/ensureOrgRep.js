export function ensureOrgRep(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!req.user?.org_rep) {
    return res.status(403).json({
      error: "forbidden",
      message: "Organization representative access required.",
    });
  }
  return next();
}

export function ensureOrgRepPage(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect("/login");
  }
  if (!req.user?.org_rep) {
    return res.redirect("/org-apply");
  }
  return next();
}
