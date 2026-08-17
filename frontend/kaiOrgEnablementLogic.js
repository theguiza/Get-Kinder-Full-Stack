import { BASE_PATH, getJson, postJson } from "./kaiWebIntakeLogic.js";

export function kaiEnablementPath(gkOrganizationId) {
  return `${BASE_PATH}/admin/gk-organizations/${encodeURIComponent(gkOrganizationId)}/kai-enablement`;
}

export async function getKaiEnablementStatus(gkOrganizationId) {
  return getJson(kaiEnablementPath(gkOrganizationId));
}

export async function enableKai(gkOrganizationId) {
  return postJson(kaiEnablementPath(gkOrganizationId), {});
}
