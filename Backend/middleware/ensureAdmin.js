function parseAdminEmails(raw) {
  return String(raw || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function hasEnvAdminEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return false;
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);
  return adminEmails.includes(normalizedEmail);
}

export function isAdminRequest(req) {
  if (!req?.user) return false;
  if (req.user.is_admin === true) return true;
  return hasEnvAdminEmail(req.user.email);
}

export function ensureAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.redirect("/");
}

export function ensureAdminApi(req, res, next) {
  if (isAdminRequest(req)) return next();
  return res.status(403).json({ error: "forbidden" });
}
