import { blockerResult } from "./types.js";

const MACHINE_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,95}$/;
const VERSION_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const TEXT_200_PATTERN = /^[\x20-\x7e]{1,200}$/;
const EXTERNAL_SOURCE_TYPES = new Set([
  "standard_framework",
  "funder",
  "government_program",
  "reporting_template",
]);
const FRAMEWORK_STATUSES = new Set(["draft", "active", "retired"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : null;
}

function registrationBlocker(blockingReason, objectCode, requiredFix) {
  return blockerResult("VAL-KAI-EXT-REQ-REG-001", "External requirement-set registration payload is invalid.", {
    object_type: "external_requirement_set_registration",
    object_code: objectCode,
    object_id: null,
    blocking_reason: blockingReason,
    required_fix: requiredFix || "Send only the structured source, framework, requirement_set, and requirements fields with valid controlled values.",
    evidence: {},
  });
}

function requireOnlyKeys(value, allowedKeys, objectCode) {
  if (!isPlainObject(value)) {
    return registrationBlocker("payload_section_not_object", objectCode);
  }
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  return unknownKey ? registrationBlocker("unknown_field", `${objectCode}.${unknownKey}`) : null;
}

function normalizeRequiredToken(value, objectCode) {
  const normalized = normalizeString(value);
  if (!normalized || !MACHINE_TOKEN_PATTERN.test(normalized)) {
    return { ok: false, blocker: registrationBlocker("invalid_identifier", objectCode) };
  }
  return { ok: true, value: normalized };
}

function normalizeRequiredVersion(value, objectCode) {
  const normalized = normalizeString(value);
  if (!normalized || !VERSION_LABEL_PATTERN.test(normalized)) {
    return { ok: false, blocker: registrationBlocker("invalid_version_label", objectCode) };
  }
  return { ok: true, value: normalized };
}

function normalizeRequiredLabel(value, objectCode) {
  const normalized = normalizeString(value);
  if (!normalized || !TEXT_200_PATTERN.test(normalized)) {
    return { ok: false, blocker: registrationBlocker("invalid_label", objectCode) };
  }
  return { ok: true, value: normalized };
}

function normalizeOptionalDescription(value, objectCode) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const normalized = normalizeString(value);
  if (!normalized || normalized.length > 4000) {
    return { ok: false, blocker: registrationBlocker("invalid_description", objectCode) };
  }
  return { ok: true, value: normalized };
}

function normalizeSource(source) {
  const keyBlocker = requireOnlyKeys(source, new Set(["source_type", "source_code", "source_name"]), "source");
  if (keyBlocker) return { ok: false, blocker: keyBlocker };
  const sourceType = normalizeString(source.source_type);
  if (!EXTERNAL_SOURCE_TYPES.has(sourceType)) {
    return { ok: false, blocker: registrationBlocker("source_type_not_external", "source.source_type") };
  }
  const sourceCode = normalizeRequiredToken(source.source_code, "source.source_code");
  if (!sourceCode.ok) return { ok: false, blocker: sourceCode.blocker };
  const sourceName = normalizeRequiredLabel(source.source_name, "source.source_name");
  if (!sourceName.ok) return { ok: false, blocker: sourceName.blocker };
  return {
    ok: true,
    value: {
      source_type: sourceType,
      source_code: sourceCode.value,
      source_name: sourceName.value,
    },
  };
}

function normalizeFramework(framework) {
  const keyBlocker = requireOnlyKeys(
    framework,
    new Set(["framework_code", "framework_name", "version_label", "framework_status"]),
    "framework",
  );
  if (keyBlocker) return { ok: false, blocker: keyBlocker };
  const frameworkCode = normalizeRequiredToken(framework.framework_code, "framework.framework_code");
  if (!frameworkCode.ok) return { ok: false, blocker: frameworkCode.blocker };
  const frameworkName = normalizeRequiredLabel(framework.framework_name, "framework.framework_name");
  if (!frameworkName.ok) return { ok: false, blocker: frameworkName.blocker };
  const versionLabel = normalizeRequiredVersion(framework.version_label, "framework.version_label");
  if (!versionLabel.ok) return { ok: false, blocker: versionLabel.blocker };
  const frameworkStatus = normalizeString(framework.framework_status || "draft");
  if (!FRAMEWORK_STATUSES.has(frameworkStatus)) {
    return { ok: false, blocker: registrationBlocker("invalid_framework_status", "framework.framework_status") };
  }
  return {
    ok: true,
    value: {
      framework_code: frameworkCode.value,
      framework_name: frameworkName.value,
      version_label: versionLabel.value,
      framework_status: frameworkStatus,
    },
  };
}

function normalizeRequirementSet(requirementSet) {
  const keyBlocker = requireOnlyKeys(requirementSet, new Set(["set_key", "set_name"]), "requirement_set");
  if (keyBlocker) return { ok: false, blocker: keyBlocker };
  const setKey = normalizeRequiredToken(requirementSet.set_key, "requirement_set.set_key");
  if (!setKey.ok) return { ok: false, blocker: setKey.blocker };
  const setName = normalizeRequiredLabel(requirementSet.set_name, "requirement_set.set_name");
  if (!setName.ok) return { ok: false, blocker: setName.blocker };
  return { ok: true, value: { set_key: setKey.value, set_name: setName.value } };
}

function normalizeRequirements(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0 || requirements.length > 100) {
    return { ok: false, blocker: registrationBlocker("invalid_requirements_count", "requirements") };
  }
  const seenKeys = new Set();
  const seenOrders = new Set();
  const normalized = [];
  for (const [index, requirement] of requirements.entries()) {
    const objectCode = `requirements.${index}`;
    const keyBlocker = requireOnlyKeys(
      requirement,
      new Set(["requirement_key", "requirement_label", "requirement_description", "display_order"]),
      objectCode,
    );
    if (keyBlocker) return { ok: false, blocker: keyBlocker };
    const requirementKey = normalizeRequiredToken(requirement.requirement_key, `${objectCode}.requirement_key`);
    if (!requirementKey.ok) return { ok: false, blocker: requirementKey.blocker };
    if (seenKeys.has(requirementKey.value)) {
      return { ok: false, blocker: registrationBlocker("duplicate_requirement_key", `${objectCode}.requirement_key`) };
    }
    seenKeys.add(requirementKey.value);
    const requirementLabel = normalizeRequiredLabel(requirement.requirement_label, `${objectCode}.requirement_label`);
    if (!requirementLabel.ok) return { ok: false, blocker: requirementLabel.blocker };
    const requirementDescription = normalizeOptionalDescription(
      requirement.requirement_description,
      `${objectCode}.requirement_description`,
    );
    if (!requirementDescription.ok) return { ok: false, blocker: requirementDescription.blocker };
    const displayOrder = requirement.display_order;
    if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 9999) {
      return { ok: false, blocker: registrationBlocker("invalid_display_order", `${objectCode}.display_order`) };
    }
    if (seenOrders.has(displayOrder)) {
      return { ok: false, blocker: registrationBlocker("duplicate_display_order", `${objectCode}.display_order`) };
    }
    seenOrders.add(displayOrder);
    normalized.push({
      requirement_key: requirementKey.value,
      requirement_label: requirementLabel.value,
      requirement_description: requirementDescription.value,
      display_order: displayOrder,
    });
  }
  return { ok: true, value: normalized };
}

export function validateExternalRequirementSetRegistrationPayload(payload) {
  const topBlocker = requireOnlyKeys(
    payload,
    new Set(["source", "framework", "requirement_set", "requirements"]),
    "body",
  );
  if (topBlocker) return { ok: false, blockers: [topBlocker] };

  const source = normalizeSource(payload.source);
  if (!source.ok) return { ok: false, blockers: [source.blocker] };
  const framework = normalizeFramework(payload.framework);
  if (!framework.ok) return { ok: false, blockers: [framework.blocker] };
  const requirementSet = normalizeRequirementSet(payload.requirement_set);
  if (!requirementSet.ok) return { ok: false, blockers: [requirementSet.blocker] };
  const requirements = normalizeRequirements(payload.requirements);
  if (!requirements.ok) return { ok: false, blockers: [requirements.blocker] };

  return {
    ok: true,
    data: {
      source: source.value,
      framework: framework.value,
      requirement_set: requirementSet.value,
      requirements: requirements.value,
    },
  };
}

export const __externalRequirementSetRegistrationValidatorContract = Object.freeze({
  EXTERNAL_SOURCE_TYPES,
  FRAMEWORK_STATUSES,
});
