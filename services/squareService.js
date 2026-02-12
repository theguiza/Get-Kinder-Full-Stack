import "dotenv/config";

const SQUARE_VERSION = "2024-08-21";

function getBaseUrl() {
  const env = (process.env.SQUARE_ENV || "").toLowerCase();
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function getAccessToken() {
  return process.env.SQUARE_ACCESS_TOKEN || null;
}

export async function fetchSquarePayment(paymentId) {
  if (!paymentId || typeof paymentId !== "string") {
    throw new Error("payment_id_required");
  }
  const token = getAccessToken();
  if (!token) {
    throw new Error("square_token_missing");
  }

  const url = `${getBaseUrl()}/v2/payments/${encodeURIComponent(paymentId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.errors?.[0]?.detail || "Square fetch failed";
    const err = new Error(msg);
    err.code = "square_fetch_failed";
    throw err;
  }
  const payment = json?.payment;
  if (!payment) {
    const err = new Error("Square payment not found");
    err.code = "square_payment_missing";
    throw err;
  }
  return payment;
}

export function parsePaymentAmount(payment) {
  const status = payment?.status;
  const amountCents = Number(payment?.amount_money?.amount);
  const currency = payment?.amount_money?.currency || "CAD";
  const captured = status === "COMPLETED" || status === "APPROVED" || status === "CAPTURED";
  return { captured, amountCents, currency, status };
}
