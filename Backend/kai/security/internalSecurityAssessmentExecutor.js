import { KAI_SPRINT2_P0_SECURITY_EXECUTOR } from "../config/kaiSprint2P0Contract.js";
import { assessBoundedFileSecurity } from "./boundedFileSecurityAssessor.js";

const REQUIRED_SEAM_KIND = "kai_sprint2_internal_security_assessment_executor";

function disabledResult() {
  return {
    ok: false,
    error: {
      code: "internal_security_executor_not_configured",
      message: "Internal security assessment executor is not configured.",
    },
    data: null,
  };
}

function invalidSeamResult() {
  return {
    ok: false,
    error: {
      code: "invalid_internal_security_executor",
      message: "Internal security assessment executor seam is invalid.",
    },
    data: null,
  };
}

function isExpectedExecutorIdentity(identity) {
  return (
    identity &&
    typeof identity === "object" &&
    identity.actorType === KAI_SPRINT2_P0_SECURITY_EXECUTOR.actorType &&
    identity.serviceIdentity === KAI_SPRINT2_P0_SECURITY_EXECUTOR.serviceIdentity &&
    identity.operationGroup === KAI_SPRINT2_P0_SECURITY_EXECUTOR.operationGroup
  );
}

function isCallableResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const keys = Object.keys(result);
  if (keys.length === 1) return result.policy === "pass";
  if (keys.length !== 2 || typeof result.category !== "string") return false;
  return result.policy === "block" || result.status === "failed";
}

export function createInternalSecurityAssessmentExecutor({
  assessor = assessBoundedFileSecurity,
} = {}) {
  if (typeof assessor !== "function") {
    throw new TypeError("Internal security assessment executor requires an assessor function.");
  }

  return Object.freeze({
    seamKind: REQUIRED_SEAM_KIND,
    identity: KAI_SPRINT2_P0_SECURITY_EXECUTOR,
    async execute(input = {}) {
      const result = await assessor(input);
      if (!isCallableResult(result)) {
        return {
          status: "failed",
          category: "security_assessment_timeout",
        };
      }
      return result;
    },
  });
}

export async function executeInjectedInternalSecurityAssessment(input = {}, dependencies = {}) {
  const executor = dependencies.internalSecurityAssessmentExecutor;
  if (!executor) return disabledResult();
  if (
    executor.seamKind !== REQUIRED_SEAM_KIND ||
    !isExpectedExecutorIdentity(executor.identity) ||
    typeof executor.execute !== "function"
  ) {
    return invalidSeamResult();
  }

  let result;
  try {
    result = await executor.execute(input);
  } catch {
    result = {
      status: "failed",
      category: "security_assessment_timeout",
    };
  }

  if (!isCallableResult(result)) {
    result = {
      status: "failed",
      category: "security_assessment_timeout",
    };
  }

  return {
    ok: true,
    data: {
      result,
    },
  };
}

export const __testables = Object.freeze({
  REQUIRED_SEAM_KIND,
  isCallableResult,
});
