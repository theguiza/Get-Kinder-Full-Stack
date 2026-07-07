import express from "express";

const router = express.Router();

export function sendAuthPreflight(req, res) {
  return res.json({
    ok: true,
    data: {
      authenticated: true,
      session_authenticated: req.isAuthenticated?.() === true,
      feature_flag_required: false,
    },
    blockers: [],
    warnings: [],
  });
}

router.get("/", sendAuthPreflight);

export default router;

export const __testables = {
  sendAuthPreflight,
};
