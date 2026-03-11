import express from "express";
import { handleKaiMessage, getConversationHistory } from "../services/kai.js";
import { determineKaiTier } from "../middleware/kai-tier.js";

const router = express.Router();

const DAILY_LIMIT = 10;
const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;
const usageByKey = new Map();

const resetTimer = setInterval(() => {
  usageByKey.clear();
}, RESET_INTERVAL_MS);

if (typeof resetTimer.unref === "function") {
  resetTimer.unref();
}

function isFreeOrGuestTier(tier) {
  return tier === "guest" || tier === "free";
}

function hitRateLimitIfNeeded({ key, tier, res }) {
  if (!isFreeOrGuestTier(tier)) return false;

  const currentCount = usageByKey.get(key) || 0;
  if (currentCount >= DAILY_LIMIT) {
    res.status(429).json({
      success: false,
      error: "You've reached your daily message limit. Upgrade for unlimited KAI access.",
      rateLimited: true,
    });
    return true;
  }

  usageByKey.set(key, currentCount + 1);
  return false;
}

function validateIncomingMessage(message) {
  if (typeof message !== "string") return { valid: false };
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 2000) return { valid: false };
  return { valid: true, value: trimmed };
}

router.post("/message", async (req, res) => {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { message, conversationId } = req.body || {};
    const validation = validateIncomingMessage(message);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: "Message must be a non-empty string up to 2000 characters.",
      });
    }

    const tier = determineKaiTier(req.user);
    const rateLimitKey = String(req.user?.id ?? "");
    if (hitRateLimitIfNeeded({ key: rateLimitKey, tier, res })) return;

    const result = await handleKaiMessage({
      userId: req.user.id,
      userMessage: validation.value,
      conversationId: conversationId || null,
      tier,
    });

    if (result?.error) {
      return res.status(500).json({
        success: false,
        error: "KAI is having trouble right now. Please try again.",
      });
    }

    return res.json({
      success: true,
      message: result.message,
      conversationId: result.conversationId,
    });
  } catch (error) {
    console.error("[kaiApi] POST /message error:", error);
    return res.status(500).json({
      success: false,
      error: "KAI is having trouble right now. Please try again.",
    });
  }
});

router.post("/guest", async (req, res) => {
  try {
    const { message } = req.body || {};
    const validation = validateIncomingMessage(message);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: "Message must be a non-empty string up to 2000 characters.",
      });
    }

    const tier = "guest";
    const rateLimitKey = `ip:${req.ip || "unknown"}`;
    if (hitRateLimitIfNeeded({ key: rateLimitKey, tier, res })) return;

    const result = await handleKaiMessage({
      userId: null,
      userMessage: validation.value,
      conversationId: null,
      tier,
    });

    if (result?.error) {
      return res.status(500).json({
        success: false,
        error: "KAI is having trouble right now. Please try again.",
      });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error("[kaiApi] POST /guest error:", error);
    return res.status(500).json({
      success: false,
      error: "KAI is having trouble right now. Please try again.",
    });
  }
});

router.get("/history/:conversationId", async (req, res) => {
  try {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const result = await getConversationHistory(req.params.conversationId, req.user.id);
    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    return res.json({ success: true, messages: result });
  } catch (error) {
    console.error("[kaiApi] GET /history/:conversationId error:", error);
    return res.status(500).json({
      success: false,
      error: "KAI is having trouble right now. Please try again.",
    });
  }
});

router.post("/new", (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  return res.json({ success: true, conversationId: null });
});

export default router;

