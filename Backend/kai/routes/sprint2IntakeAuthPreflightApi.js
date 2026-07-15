import express from "express";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { setKaiSprint2NoStore } from "../middleware/kaiSprint2RequestSafety.js";

const router = express.Router();

export function sendAuthPreflight(req, res) {
  return res.json({
    ok: true,
    data: {
      authenticated: true,
      session_authenticated: req.isAuthenticated?.() === true,
      feature_flag_required: true,
    },
    blockers: [],
    warnings: [],
  });
}

router.use(requireKaiSprint2Enabled);
router.use(setKaiSprint2NoStore);
router.get("/", sendAuthPreflight);

export default router;

export const __testables = {
  sendAuthPreflight,
};
