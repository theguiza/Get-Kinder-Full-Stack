export const BASE_PATH = "/api/kai/sprint2/intake";

export function clientFollowupsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/client-followups`;
}

export function clientFollowupCompletePath(organizationId, claimId, clientFollowupItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/client-followups/${encodeURIComponent(clientFollowupItemId)}/complete`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export function completionBody(expectedUpdatedAt) {
  return { expected_updated_at: expectedUpdatedAt };
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

export function projectClientFollowupWorkflows(dto) {
  const items = Array.isArray(dto?.items) ? dto.items : [];
  return items.map((item) => ({
    claimId: item.claim_id,
    clientFollowupItemId: item.client_followup_item_id,
    dimensionKey: item.dimension_key,
    questionText: item.question_text,
    reviewQueueItemId: item.review_queue_item_id,
    queueStatus: item.queue_status,
    reviewStatus: item.review_status,
    updatedAt: item.updated_at,
  })).filter((item) => typeof item.clientFollowupItemId === "string");
}

export function canCompleteClientFollowup(item) {
  return Boolean(item) && item.queueStatus === "waiting_on_client" && item.reviewStatus === "proposed";
}

export const CLIENT_FOLLOWUP_DISPOSITION_LABEL =
  "Reviewed — no additional client information is being supplied for this internal workflow.";
