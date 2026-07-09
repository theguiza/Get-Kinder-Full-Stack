import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError, notImplemented, validationBlocked } from "../errors/kaiErrors.js";
import { recordBlockedAttemptAudit } from "./auditService.js";
import { intakeValidatorGroups } from "../validators/intakeValidators.js";
import { runValidators } from "../validators/runValidators.js";

const PASS1D_CONTRACT = "p0_pass1d_intake_validator_service_contract";
const PASS1E_CONTRACT = "p0_pass1e_state_assistant_audit_contract";
const PASS1F_CONTRACT = "p0_pass1f_metadata_write_storage_boundary_contract";

function normalizeContractInput(input = {}, operation) {
  return {
    ...input,
    payload: input.payload || {},
    validatorGroupKey: operation,
  };
}

function safeContractData(operation) {
  return {
    operation,
    contract: PASS1D_CONTRACT,
    pass1e_contract: PASS1E_CONTRACT,
    pass1f_contract: PASS1F_CONTRACT,
    mutating_behavior_enabled: false,
    metadata_write_enabled: false,
    audit_write_enabled: false,
    storage_provider_enabled: false,
    raw_upload_enabled: false,
    signed_upload_enabled: false,
    signed_read_enabled: false,
    upload_confirmation_enabled: false,
    parser_raw_file_work_enabled: false,
    source_promotion_enabled: false,
  };
}

export async function validateBlockedAttemptAuditContract(input = {}, dependencies = {}) {
  return await recordBlockedAttemptAudit({
    payload: {
      contract: PASS1E_CONTRACT,
      sprint_phase: "p0_pass1e",
      attempted_operation: input.operation || "intake_contract_blocked_attempt",
      object_type: input.objectType || "intake_service_contract",
      blocked_reason_code: input.blockedReasonCode || "not_implemented_in_pass1e",
      actor_type: input.actorType || "human",
      storage_provider: input.storageProvider || "gcs",
      file_policy_status: input.filePolicyStatus || "pending",
      request_scope: "metadata_only",
      route_contract: PASS1D_CONTRACT,
      validator_key: "VAL-AUD-SVC-001",
    },
  }, dependencies);
}

async function runIntakePreflight(input, operation) {
  const validatorGroup = intakeValidatorGroups[operation] || intakeValidatorGroups.future_intake_creation;
  return await runValidators(
    validatorGroup,
    normalizeContractInput(input, operation),
    { group_key: operation },
  );
}

function blockedByValidation(validation) {
  return validationBlocked(validation.blockers, {
    warnings: validation.warnings,
    data: {
      contract: PASS1D_CONTRACT,
      mutating_behavior_enabled: false,
    },
  });
}

function notImplementedContract(operation, validation) {
  return notImplemented({
    message: "KAI Sprint 2 intake metadata writes are scaffolded only in P0 Pass 1F.",
    blockers: [
      {
        validator_key: "VAL-INT-SVC-001",
        severity: "blocker",
        object_type: "intake_service_contract",
        object_code: operation,
        object_id: null,
        message: "Future intake metadata write behavior is not implemented in Pass 1F.",
        blocking_reason: "not_implemented_in_pass1f",
        required_fix: "Implement this behavior in a later controlled pass.",
        evidence: {
          contract: PASS1D_CONTRACT,
          pass1f_contract: PASS1F_CONTRACT,
          mutating_behavior_enabled: false,
          metadata_write_enabled: false,
        },
      },
    ],
    warnings: validation.warnings,
    data: safeContractData(operation),
  });
}

export async function validateIntakePreflight(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(input, "intake_preflight");
  if (!validation.ok) return blockedByValidation(validation);

  return {
    ok: true,
    data: safeContractData("intake_preflight"),
    blockers: [],
    warnings: validation.warnings,
  };
}

export async function createIntakeBatch(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(input, "create_intake_batch");
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("create_intake_batch", validation);
}

export async function registerIntakeFileMetadata(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(input, "register_intake_file_metadata");
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("register_intake_file_metadata", validation);
}

export async function reserveIntakeFile(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(input, "reserve_intake_file");
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("reserve_intake_file", validation);
}

export async function requestUploadUrl(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  return buildKaiError("operation_not_enabled", {
    message: "KAI Sprint 2 upload URL issuance is disabled for P0 Pass 1F.",
    data: safeContractData("request_upload_url"),
  });
}

export async function confirmUpload(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(input, "confirm_upload");
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("confirm_upload", validation);
}

export async function requestIntakeFileTransfer(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(
    {
      ...input,
      signedUploadUrlRequested: true,
      signedReadUrlRequested: true,
    },
    "request_intake_file_transfer",
  );
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("request_intake_file_transfer", validation);
}

export async function parseIntakeRawFile(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(
    {
      ...input,
      parserRawFileWorkRequested: true,
    },
    "parse_intake_raw_file",
  );
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("parse_intake_raw_file", validation);
}

export async function promoteIntakeSource(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = await runIntakePreflight(
    {
      ...input,
      sourcePromotionRequested: true,
    },
    "promote_intake_source",
  );
  if (!validation.ok) return blockedByValidation(validation);
  return notImplementedContract("promote_intake_source", validation);
}
