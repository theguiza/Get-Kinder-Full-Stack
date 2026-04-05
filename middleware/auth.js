import jwt from "jsonwebtoken";
import pool from "../Backend/db/pg.js";

export function getBearerToken(req) {
  const authorizationHeader = req.get("Authorization");
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token || null;
}

export function verifyBearerToken(token) {
  if (!token) {
    return { ok: false, error: "missing_bearer_token" };
  }

  if (!process.env.JWT_SECRET || !String(process.env.JWT_SECRET).trim()) {
    console.error("verifyToken error: JWT_SECRET is not configured.");
    return { ok: false, error: "jwt_secret_not_configured", status: 500 };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { ok: true, decoded };
  } catch (error) {
    if (error?.name === "TokenExpiredError") {
      return { ok: false, error: "token_expired", status: 401 };
    }
    return { ok: false, error: "invalid_token", status: 401 };
  }
}

export function verifyToken(req, res, next) {
  const result = verifyBearerToken(getBearerToken(req));
  if (!result.ok) {
    return res.status(result.status || 401).json({ error: result.error });
  }

  req.auth = result.decoded;
  req.jwtUser = result.decoded;
  return next();
}

export async function ensureAuthenticatedApi(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    if (req.user?.is_suspended) {
      return res.status(403).json({ error: "account_suspended" });
    }
    return next();
  }

  const token = getBearerToken(req);
  const verification = verifyBearerToken(token);
  if (!verification.ok) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const userId = Number(verification.decoded?.id ?? verification.decoded?.sub);
  if (!Number.isInteger(userId)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { rows } = await pool.query(
    "SELECT * FROM userdata WHERE id = $1 LIMIT 1",
    [userId]
  );
  const user = rows?.[0] || null;
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (user.is_suspended) {
    return res.status(403).json({ error: "account_suspended" });
  }

  req.user = user;
  return next();
}
