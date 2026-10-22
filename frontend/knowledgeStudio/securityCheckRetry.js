import { postJson } from "../kaiWebIntakeLogic.js";
import { securityCheckRetryPath } from "./clientEvidencePipelineLogic.js";

// The one write the client pipeline status card makes: re-attempting a
// security check that could not run, through the existing upload
// confirmation. The server re-authorizes the actor (create_intake_file),
// re-verifies the stored bytes, and re-assesses only a still-pending file;
// a passed, blocked, or failed file is never changed by it.
export async function requestSecurityCheckRetry(organizationId, intakeFileId) {
  try {
    return await postJson(securityCheckRetryPath(organizationId, intakeFileId), { organization_id: organizationId });
  } catch {
    return null;
  }
}
