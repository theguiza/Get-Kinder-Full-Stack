import { processSquareWebhookEvent, verifySquareWebhookSignature } from "../services/squareWebhooksService.js";

function parseEvent(req, rawBody) {
  if (req?.body && typeof req.body === "object") return req.body;
  try {
    return rawBody ? JSON.parse(rawBody.toString("utf8") || "{}") : null;
  } catch (err) {
    console.error("Square webhook JSON parse error:", err);
    return null;
  }
}

export async function squareWebhookHandler(req, res) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  const logEntry = {
    signature_ok: false,
    event_type: null,
    payment_id: null,
    donation_id: null,
    credits_added: 0,
    error: null,
  };

  if (!signatureKey || !notificationUrl) {
    logEntry.error = "missing_config";
    console.log(JSON.stringify(logEntry));
    return res.status(500).json({ ok: false, error: "WEBHOOK_CONFIG_MISSING" });
  }

  const rawBody = req.rawBody;
  const signatureHeader = req.get("x-square-hmacsha256-signature") || "";

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    logEntry.error = "raw_body_missing";
    console.log(JSON.stringify(logEntry));
    return res.status(500).json({ ok: false, error: "WEBHOOK_CONFIG_MISSING" });
  }

  const event = parseEvent(req, rawBody);
  logEntry.event_type = event?.type || null;
  logEntry.payment_id = event?.data?.object?.payment?.id || event?.data?.object?.id || null;

  const signatureOk = verifySquareWebhookSignature({
    signatureKey,
    notificationUrl,
    rawBody,
    signatureHeader,
  });
  logEntry.signature_ok = !!signatureOk;

  if (!signatureOk) {
    logEntry.error = "invalid_signature";
    console.log(JSON.stringify(logEntry));
    return res.status(401).json({ ok: false, error: "INVALID_SIGNATURE" });
  }

  try {
    const centsPerCredit = Number.isFinite(Number(process.env.CENTS_PER_CREDIT))
      ? Number(process.env.CENTS_PER_CREDIT)
      : null;

    const result = await processSquareWebhookEvent({ event, centsPerCredit });
    logEntry.event_type = result?.eventType || logEntry.event_type;
    logEntry.payment_id = result?.paymentId || logEntry.payment_id;
    logEntry.donation_id = result?.donationId || null;
    logEntry.credits_added = result?.creditsAdded ?? 0;
    if (result?.error) logEntry.error = result.error;

    console.log(JSON.stringify(logEntry));

    if (result?.ok === false && result?.error) {
      return res.status(200).json({ ok: false, error: result.error });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    logEntry.error = err?.message || "processing_error";
    console.error("Square webhook handler error:", err);
    console.log(JSON.stringify(logEntry));
    return res.status(200).json({ ok: false, error: "PROCESSING_ERROR" });
  }
}
