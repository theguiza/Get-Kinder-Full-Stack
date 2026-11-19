import {
  SERVICE_DUPLICATE_POLICY,
  SERVICE_EVENTS_BASIS_VERSION,
  SERVICE_EVENTS_FAMILY,
  SERVICE_EVENTS_METHOD,
} from "../parsing/serviceEventReconciliation.js";
import { TABULAR_MEASUREMENT_BASIS_VERSION } from "../profiling/tabularMeasurementBasis.js";
import {
  PERIOD_SOURCE_ENGAGEMENT,
  SERVICE_EVENT_METRICS,
  computeMeasurementKey,
  derivedMeasurementArithmeticHolds,
  screenedTabularFields,
  serviceCountedUnitLabel,
  validateDerivedStatements,
} from "./kaiDerivedMeasurementValidators.js";

/**
 * KAI single-source service-delivery measurement: which columns of one
 * service-record table play which role, and which governed findings the
 * record-level reconciliation (parsing/serviceEventReconciliation.js) can
 * calculate from them. Pure.
 *
 * Roles are proposed from the source's own words and the committed profile:
 * the listed words of each column heading (read by the worker from the
 * verified upload, never stored), the profile's field roles and listed
 * category values, and any dictionary entity level. A field's position or
 * the shape of its values never decides what it means: an identifier-shaped
 * column is not an encounter or a household because of its values.
 *
 * Each role is `established` (the heading names it explicitly, the values
 * agree and exactly one column qualifies - or a person selected it),
 * `proposed` (one candidate whose meaning the source does not state
 * explicitly), `ambiguous` (several candidates, or several completed values)
 * or `unavailable`. A finding states service encounters or households only
 * when every role it uses is established; with a proposed role the same
 * arithmetic is kept as a source-value finding; with an ambiguous or
 * unavailable role the finding is not calculated and its requirement is
 * named. A person's selection is recorded with the measurement it was used
 * for (definition `roles[*].basis = person_selected`), bound to the source
 * version, worksheet, profile, actor and audit of that write.
 */

export const SERVICE_ROLE_DISCOVERY_VERSION = "kai_service_event_roles_v1";
export const SERVICE_ROLES = Object.freeze(["encounter_identifier", "status", "service_date", "programme", "activity", "entity_identifier", "eligibility"]);
export const ENTITY_KINDS = Object.freeze(["household", "person", "family"]);
const FIELD_KEY_RE = /^field_[1-9][0-9]{0,3}$/;
const VALUE_KEY_RE = /^value_[1-9][0-9]{0,2}$/;

const ID_TERMS = new Set(["id", "identifier", "number", "no", "num", "ref", "reference", "key", "code"]);
const ENCOUNTER_TERMS = new Map([["event", "service event"], ["events", "service event"], ["encounter", "service encounter"], ["encounters", "service encounter"],
  ["visit", "visit"], ["visits", "visit"], ["attendance", "attendance"], ["attendances", "attendance"], ["appointment", "appointment"], ["appointments", "appointment"]]);
const SESSION_TERMS = new Set(["session", "sessions"]);
const ENTITY_TERMS = new Map([["household", "household"], ["households", "household"], ["family", "family"], ["families", "family"],
  ["person", "person"], ["people", "person"], ["individual", "person"],
  ["client", null], ["clients", null], ["participant", null], ["participants", null], ["member", null], ["members", null], ["patient", null],
  ["student", null], ["customer", null], ["resident", null], ["attendee", null], ["beneficiary", null]]);
const STATUS_TERMS = new Set(["status", "outcome", "result", "state", "attended", "delivery", "delivered", "completion", "completed", "attendance"]);
const DATE_TERMS = new Set(["date", "day", "dated"]);
const DATE_QUALIFIERS = new Set(["service", "services", "event", "events", "encounter", "visit", "session", "attendance", "delivery", "activity", "appointment", "program", "programme"]);
const PERSONAL_DATE_TERMS = new Set(["birth", "dob", "born", "age"]);
const PROGRAMME_TERMS = new Set(["program", "programme", "programs", "programmes", "stream"]);
const ACTIVITY_TERMS = new Set(["activity", "activities"]);
const TYPE_TERMS = new Set(["type", "kind", "category"]);
const ACTIVITY_SUBJECT_TERMS = new Set(["service", "services", "session", "sessions", "event", "events", "encounter", "visit"]);
const RECORD_TYPE_SUBJECT_TERMS = new Set(["record", "entry", "row", "event"]);
const ELIGIBILITY_TERMS = new Set(["eligible", "eligibility", "include", "included", "inclusion", "exclude", "excluded", "exclusion", "valid", "validity", "void", "test", "countable", "reportable"]);
const USE_TERMS = new Set(["use", "consent", "consented", "authorized", "authorised", "authorization", "authorisation", "permission", "permitted", "share", "sharing", "disclose", "disclosure", "external", "publish", "publication"]);
// Listed category labels that state a completed service.
const COMPLETION_LABELS = new Set(["completed", "complete", "attended", "delivered", "served", "done", "fulfilled", "finished", "present"]);
const ENCOUNTER_UNIT_WORDS = ["encounter", "visit", "attendance", "appointment", "service", "session"];

export function columnLetter(position) {
  return position > 26 ? `${columnLetter(Math.floor((position - 1) / 26))}${String.fromCharCode(65 + (position - 1) % 26)}` : String.fromCharCode(64 + position);
}

export function columnOf(fieldKey) {
  return FIELD_KEY_RE.test(fieldKey ?? "") ? columnLetter(Number(fieldKey.slice(6))) : null;
}

function quoted(terms) {
  return terms.map((term) => `"${term}"`).join(", ");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function refusal(reason, message, fix) {
  return {
    ok: false,
    code: "validation_blocker",
    blockers: [{
      validator_key: "VAL-KAI-MVP-DERIVED-001", severity: "blocker", object_type: "service_event_roles", object_code: "record_source_derived_measurement",
      object_id: null, message, blocking_reason: reason, required_fix: fix, evidence: {},
    }],
  };
}

const SELECTION_KEYS = Object.freeze([
  "encounter_identifier_field_key", "status_field_key", "completed_value_key", "service_date_field_key", "programme_field_key",
  "activity_field_key", "entity_identifier_field_key", "entity_kind", "eligibility_field_key", "eligibility_value_key",
]);

/** The shape of a person's role selection: field keys, listed value keys and an entity kind, nothing else. */
export function validateServiceRoleSelections(input) {
  if (input === undefined || input === null) return { ok: true, selections: null };
  const invalid = () => refusal("service_role_selection_invalid", "A service-field selection names listed field keys, listed value keys and an entity kind only.",
    "Choose each column from the columns KAI lists.");
  if (!isPlainObject(input) || Object.keys(input).length === 0 || !Object.keys(input).every((key) => SELECTION_KEYS.includes(key))) return invalid();
  for (const [key, value] of Object.entries(input)) {
    if (key.endsWith("_field_key")) {
      const nullable = !["status_field_key", "service_date_field_key"].includes(key);
      if (!(value === null && nullable) && !FIELD_KEY_RE.test(value ?? "")) return invalid();
    } else if (key.endsWith("_value_key")) {
      if (!VALUE_KEY_RE.test(value ?? "")) return invalid();
    } else if (!ENTITY_KINDS.includes(value)) return invalid();
  }
  if ((input.completed_value_key !== undefined) !== (input.status_field_key !== undefined)) return invalid();
  if (input.eligibility_value_key !== undefined && !(typeof input.eligibility_field_key === "string")) return invalid();
  if (typeof input.eligibility_field_key === "string" && input.eligibility_value_key === undefined) return invalid();
  if (input.entity_kind !== undefined && input.entity_identifier_field_key === null) return invalid();
  return { ok: true, selections: Object.freeze({ ...input }) };
}

/** A worker's per-field heading facts: only vocabulary words and a personal-attribute flag. */
function headingOf(headings, fieldKey) {
  const entry = headings?.[fieldKey];
  return { terms: Array.isArray(entry?.terms) ? entry.terms : [], personal: entry?.personal === true };
}

function role(name, status, extra = {}) {
  return {
    role: name,
    status,
    field_key: null,
    column: null,
    basis: status === "established" ? "source_heading" : status === "proposed" ? "proposed" : null,
    candidates: [],
    evidence: [],
    ...extra,
  };
}

function withField(entry, field) {
  return { ...entry, field_key: field.field_key, column: columnOf(field.field_key) };
}

function listedValues(field) {
  return field?.categorical && !field.categorical.vocabulary_withheld && Array.isArray(field.categorical.values) ? field.categorical.values : [];
}

/**
 * Service-field discovery for one table: `basis` is the committed tabular
 * measurement basis, `headings` the worker's {field_key: {terms, personal}},
 * `dictionaryFields` [{field_key, entity_level}], `selections` a validated
 * person selection (or null). Returns the roles with status and evidence,
 * notes about source values KAI does not apply, and whether the table is a
 * service-record table at all (a listed completed value is required).
 */
export function discoverServiceEventRoles({ basis, headings = {}, dictionaryFields = [], selections = null }) {
  if (!isPlainObject(basis) || basis.basis_version !== TABULAR_MEASUREMENT_BASIS_VERSION || basis.status !== "assessed") {
    return { ok: true, discovery: { discovery_version: SERVICE_ROLE_DISCOVERY_VERSION, status: "not_service_events", reason: "tabular_basis_not_committed", roles: {}, source_value_notes: [] } };
  }
  const fields = screenedTabularFields(basis);
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  const terms = (field) => headingOf(headings, field.field_key).terms;
  const has = (field, set) => terms(field).some((term) => set.has(term));
  const matched = (field, ...sets) => terms(field).filter((term) => sets.some((set) => set.has(term)));
  const roles = {};

  // Encounter identifier: a heading naming an event/encounter/visit/attendance/
  // appointment identifier; a session identifier only when no such column exists.
  const tier1 = fields.filter((field) => has(field, ENCOUNTER_TERMS) && has(field, ID_TERMS));
  const tier2 = tier1.length === 0 ? fields.filter((field) => has(field, SESSION_TERMS) && has(field, ID_TERMS)) : [];
  const idCandidates = tier1.length > 0 ? tier1 : tier2;
  const recordType = fields.find((field) => has(field, TYPE_TERMS) && has(field, RECORD_TYPE_SUBJECT_TERMS)
    && listedValues(field).length === 1 && field.blank_count === 0 && (field.categorical.withheld_record_count ?? 0) === 0);
  const recordTypeLabel = recordType && ENCOUNTER_UNIT_WORDS.some((word) => listedValues(recordType)[0].label.toLowerCase().includes(word))
    ? listedValues(recordType)[0].label : null;
  const unitFromHeading = (field) => {
    const word = terms(field).find((term) => ENCOUNTER_TERMS.has(term) || SESSION_TERMS.has(term));
    return SESSION_TERMS.has(word) ? "session" : ENCOUNTER_TERMS.get(word) ?? "service event";
  };
  const idEvidence = (field) => [
    `Column ${columnOf(field.field_key)} heading names an ${SESSION_TERMS.has(terms(field).find((term) => ENCOUNTER_TERMS.has(term) || SESSION_TERMS.has(term))) ? "session" : "event"} identifier (${quoted(matched(field, ENCOUNTER_TERMS, SESSION_TERMS, ID_TERMS))}).`,
    ...(field.identifier ? [`KAI profiled ${field.identifier.distinct_count} distinct values in it; ${field.identifier.repeated_key_count} occur on more than one record.`] : []),
    ...(recordTypeLabel ? [`Every record's type (column ${columnOf(recordType.field_key)}) is ${recordTypeLabel}.`] : []),
  ];
  if (idCandidates.length === 1) {
    roles.encounter_identifier = withField(role("encounter_identifier", "established", {
      counted_unit: recordTypeLabel ? recordTypeLabel.replace(/_/g, " ") : unitFromHeading(idCandidates[0]),
      evidence: idEvidence(idCandidates[0]),
    }), idCandidates[0]);
  } else if (idCandidates.length > 1) {
    roles.encounter_identifier = role("encounter_identifier", "ambiguous", {
      evidence: [`${idCandidates.length} column headings name an event identifier: ${idCandidates.map((field) => columnOf(field.field_key)).join(", ")}. Choose the one that identifies a single service encounter.`],
    });
  } else {
    roles.encounter_identifier = role("encounter_identifier", "unavailable", {
      evidence: ["No column heading names an event, encounter, visit, attendance or appointment identifier, so repeated records of one encounter cannot be recognized."],
    });
  }
  roles.encounter_identifier.candidates = (idCandidates.length > 0 ? idCandidates : fields.filter((field) => field.roles.includes("identifier")))
    .map((field) => ({ field_key: field.field_key, column: columnOf(field.field_key) }));

  // Status and its completed value.
  const statusCandidates = fields.filter((field) => listedValues(field).some((value) => COMPLETION_LABELS.has(value.label.toLowerCase())));
  const headed = statusCandidates.filter((field) => has(field, STATUS_TERMS));
  const statusPool = headed.length > 0 ? headed : statusCandidates;
  const completedValues = (field) => listedValues(field).filter((value) => COMPLETION_LABELS.has(value.label.toLowerCase()));
  if (statusPool.length === 1) {
    const field = statusPool[0];
    const values = completedValues(field);
    const explicit = headed.length === 1;
    const status = values.length > 1 ? "ambiguous" : explicit ? "established" : "proposed";
    roles.status = withField(role("status", status, {
      completed_value_key: values.length === 1 ? values[0].value_key : null,
      completed_value_label: values.length === 1 ? values[0].label : null,
      values: listedValues(field).map((value) => ({ value_key: value.value_key, label: value.label, record_count: value.record_count })),
      evidence: [
        explicit ? `Column ${columnOf(field.field_key)} heading names a status (${quoted(matched(field, STATUS_TERMS))}).` : `Column ${columnOf(field.field_key)} lists a completed value, but its heading does not name a status.`,
        values.length > 1 ? `It lists ${values.length} values that can mean completed (${values.map((value) => value.label).join(", ")}); choose the one that means the service was delivered.`
          : `Its listed values: ${listedValues(field).map((value) => `${value.label} (${value.record_count})`).join(", ")}; ${values[0].label} is the completed value.`,
      ],
    }), field);
  } else {
    roles.status = role("status", statusPool.length > 1 ? "ambiguous" : "unavailable", {
      evidence: [statusPool.length > 1
        ? `${statusPool.length} columns list a completed value: ${statusPool.map((field) => columnOf(field.field_key)).join(", ")}. Choose the service status column.`
        : "No column lists a completed value (such as completed or attended)."],
    });
  }
  roles.status.candidates = fields.filter((field) => listedValues(field).length > 0).map((field) => ({
    field_key: field.field_key, column: columnOf(field.field_key), values: listedValues(field).map((value) => ({ value_key: value.value_key, label: value.label })),
  }));

  // Service date.
  const dateFields = fields.filter((field) => field.roles.includes("date") && !headingOf(headings, field.field_key).personal && !has(field, PERSONAL_DATE_TERMS));
  const qualified = dateFields.filter((field) => has(field, DATE_TERMS) && has(field, DATE_QUALIFIERS));
  if (qualified.length === 1) {
    roles.service_date = withField(role("service_date", "established", {
      evidence: [`Column ${columnOf(qualified[0].field_key)} heading names a service date (${quoted(matched(qualified[0], DATE_TERMS, DATE_QUALIFIERS))}); its values are dates.`],
    }), qualified[0]);
  } else if (qualified.length > 1 || (qualified.length === 0 && dateFields.length > 1)) {
    const pool = qualified.length > 1 ? qualified : dateFields;
    roles.service_date = role("service_date", "ambiguous", {
      evidence: [`${pool.length} date columns could be the service date: ${pool.map((field) => columnOf(field.field_key)).join(", ")}. Choose the date the service took place.`],
    });
  } else if (dateFields.length === 1) {
    roles.service_date = withField(role("service_date", "proposed", {
      evidence: [`Column ${columnOf(dateFields[0].field_key)} is the only date column, but its heading does not say it is the date the service took place.`],
    }), dateFields[0]);
  } else {
    roles.service_date = role("service_date", "unavailable", { evidence: ["No column holds service dates, so a reporting period cannot be applied."] });
  }
  roles.service_date.candidates = dateFields.map((field) => ({ field_key: field.field_key, column: columnOf(field.field_key) }));

  // Programme and activity: listed category columns named as such.
  const listedFields = fields.filter((field) => listedValues(field).length > 0);
  const categoryRole = (name, candidates, describe) => {
    if (candidates.length === 1) {
      return withField(role(name, "established", {
        values: listedValues(candidates[0]).map((value) => ({ value_key: value.value_key, label: value.label, record_count: value.record_count })),
        evidence: [`Column ${columnOf(candidates[0].field_key)} heading names ${describe} (${quoted(matched(candidates[0], PROGRAMME_TERMS, ACTIVITY_TERMS, TYPE_TERMS, ACTIVITY_SUBJECT_TERMS))}); its listed values: ${listedValues(candidates[0]).map((value) => value.label).join(", ")}.`],
      }), candidates[0]);
    }
    return role(name, candidates.length > 1 ? "ambiguous" : "unavailable", {
      evidence: [candidates.length > 1 ? `${candidates.length} columns could be the ${describe}: ${candidates.map((field) => columnOf(field.field_key)).join(", ")}.`
        : `No column with listed values is named as the ${describe}.`],
    });
  };
  roles.programme = categoryRole("programme", listedFields.filter((field) => has(field, PROGRAMME_TERMS)), "programme");
  roles.activity = categoryRole("activity", listedFields.filter((field) => !has(field, PROGRAMME_TERMS) && (has(field, ACTIVITY_TERMS)
    || (has(field, TYPE_TERMS) && has(field, ACTIVITY_SUBJECT_TERMS) && field !== recordType))), "activity");
  for (const name of ["programme", "activity"]) roles[name].candidates = listedFields.map((field) => ({ field_key: field.field_key, column: columnOf(field.field_key) }));

  // The counted entity (household, person or family) identifier.
  const dictionaryKind = (fieldKey) => {
    const level = dictionaryFields.find((entry) => entry?.field_key === fieldKey)?.entity_level;
    return ENTITY_KINDS.includes(level) ? level : null;
  };
  const encounterKey = roles.encounter_identifier.field_key;
  const entityCandidates = fields.filter((field) => field.field_key !== encounterKey && has(field, ENTITY_TERMS) && has(field, ID_TERMS));
  if (entityCandidates.length === 1) {
    const field = entityCandidates[0];
    const headingKinds = [...new Set(terms(field).filter((term) => ENTITY_TERMS.has(term)).map((term) => ENTITY_TERMS.get(term)))];
    const fromDictionary = dictionaryKind(field.field_key);
    const known = headingKinds.filter(Boolean);
    const kind = known.length === 1 ? known[0] : fromDictionary;
    const conflict = (known.length > 1) || (known.length === 1 && fromDictionary && fromDictionary !== known[0]);
    roles.entity_identifier = withField(role("entity_identifier", conflict ? "ambiguous" : kind ? "established" : "proposed", {
      entity_kind: conflict ? null : kind,
      evidence: [
        `Column ${columnOf(field.field_key)} heading names ${known.length === 1 ? `a ${known[0]}` : "a participant"} identifier (${quoted(matched(field, ENTITY_TERMS, ID_TERMS))}).`,
        ...(fromDictionary ? [`The data dictionary records its entity level as ${fromDictionary}.`] : []),
        ...(conflict ? ["The heading and the data dictionary disagree on what one identifier represents."]
          : kind ? [] : ["Whether one identifier is a household, a person or a family is not stated."]),
        ...(field.identifier ? [`KAI profiled ${field.identifier.distinct_count} distinct values in it.`] : []),
      ],
    }), field);
  } else {
    roles.entity_identifier = role("entity_identifier", entityCandidates.length > 1 ? "ambiguous" : "unavailable", {
      evidence: [entityCandidates.length > 1 ? `${entityCandidates.length} column headings name a household or participant identifier: ${entityCandidates.map((field) => columnOf(field.field_key)).join(", ")}.`
        : "No column heading names a household, person, family or participant identifier, so households or people served cannot be counted."],
    });
  }
  roles.entity_identifier.candidates = fields.filter((field) => field.field_key !== encounterKey && (field.roles.includes("identifier") || entityCandidates.includes(field)))
    .map((field) => ({ field_key: field.field_key, column: columnOf(field.field_key) }));

  // Eligibility: a column only a person can say decides which records count.
  const eligibilityCandidates = listedFields.filter((field) => has(field, ELIGIBILITY_TERMS));
  roles.eligibility = eligibilityCandidates.length > 0
    ? (eligibilityCandidates.length === 1
      ? withField(role("eligibility", "proposed", {
        values: listedValues(eligibilityCandidates[0]).map((value) => ({ value_key: value.value_key, label: value.label, record_count: value.record_count })),
        evidence: [`Column ${columnOf(eligibilityCandidates[0].field_key)} heading may state which records count (${quoted(matched(eligibilityCandidates[0], ELIGIBILITY_TERMS))}). KAI does not apply it until your organization says which value includes a record.`],
      }), eligibilityCandidates[0])
      : role("eligibility", "ambiguous", { evidence: [`${eligibilityCandidates.length} columns may state which records count: ${eligibilityCandidates.map((field) => columnOf(field.field_key)).join(", ")}.`] }))
    : role("eligibility", "unavailable", { evidence: ["No eligibility or exclusion column was found; a record counts when it is completed, has a consistent identifier and (with a period) a service date in the period."] });
  roles.eligibility.candidates = listedFields.map((field) => ({ field_key: field.field_key, column: columnOf(field.field_key),
    values: listedValues(field).map((value) => ({ value_key: value.value_key, label: value.label })) }));

  // Source values about use, consent or authorization are shown, never applied.
  const sourceValueNotes = listedFields.filter((field) => has(field, USE_TERMS) && !eligibilityCandidates.includes(field)).map((field) => ({
    field_key: field.field_key,
    column: columnOf(field.field_key),
    kind: "use_or_authorization_value",
    values: listedValues(field).map((value) => ({ label: value.label, record_count: value.record_count })),
    text: `Column ${columnOf(field.field_key)} records a source value about use or authorization (${listedValues(field).map((value) => value.label).join(", ")}). It is a value in the source, not an application permission decision, and KAI does not use it to include or exclude records. Your organization's recorded processing and disclosure permissions apply separately.`,
  }));

  // A person's selection establishes a role (or states that it does not apply).
  if (selections) {
    const applied = applyServiceRoleSelections({ roles, selections, byKey, fields, recordTypeLabel, headings, unitFromHeading });
    if (!applied.ok) return applied;
  }
  const isService = roles.status.status !== "unavailable";
  return {
    ok: true,
    discovery: {
      discovery_version: SERVICE_ROLE_DISCOVERY_VERSION,
      status: isService ? "service_events" : "not_service_events",
      ...(isService ? {} : { reason: "no_completed_status_value" }),
      roles,
      source_value_notes: sourceValueNotes,
    },
  };
}

function applyServiceRoleSelections({ roles, selections, byKey, recordTypeLabel, unitFromHeading }) {
  const selectedEvidence = "Selected by a person at your organization.";
  const invalid = (reason, message) => refusal(reason, message, "Choose a column KAI lists for this role.");
  const field = (key) => byKey.get(key) ?? null;
  if (selections.encounter_identifier_field_key !== undefined) {
    const key = selections.encounter_identifier_field_key;
    if (key === null) roles.encounter_identifier = { ...role("encounter_identifier", "unavailable"), basis: "person_selected", candidates: roles.encounter_identifier.candidates, evidence: ["A person at your organization stated that no column identifies a single encounter."] };
    else if (!field(key)) return invalid("service_role_field_not_listed", `${key} is not a column of this table.`);
    else roles.encounter_identifier = { ...withField(role("encounter_identifier", "established"), field(key)), basis: "person_selected", candidates: roles.encounter_identifier.candidates,
      counted_unit: roles.encounter_identifier.field_key === key && roles.encounter_identifier.counted_unit ? roles.encounter_identifier.counted_unit
        : recordTypeLabel ? recordTypeLabel.replace(/_/g, " ") : unitFromHeading(field(key)),
      evidence: [selectedEvidence] };
  }
  if (selections.status_field_key !== undefined) {
    const selected = field(selections.status_field_key);
    const value = listedValues(selected).find((item) => item.value_key === selections.completed_value_key);
    if (!selected || !value) return invalid("service_role_value_not_listed", "The completed value must be a listed value of the selected status column.");
    roles.status = { ...withField(role("status", "established"), selected), basis: "person_selected", candidates: roles.status.candidates,
      completed_value_key: value.value_key, completed_value_label: value.label,
      values: listedValues(selected).map((item) => ({ value_key: item.value_key, label: item.label, record_count: item.record_count })),
      evidence: [`${selectedEvidence} ${value.label} means the service was completed.`] };
  }
  if (selections.service_date_field_key !== undefined) {
    const selected = field(selections.service_date_field_key);
    if (!selected?.roles.includes("date") || !roles.service_date.candidates.some((candidate) => candidate.field_key === selected.field_key)) {
      return invalid("service_role_date_not_listed", "The service date must be a listed date column that does not describe a person.");
    }
    roles.service_date = { ...withField(role("service_date", "established"), selected), basis: "person_selected", candidates: roles.service_date.candidates, evidence: [selectedEvidence] };
  }
  for (const name of ["programme", "activity"]) {
    const key = selections[`${name}_field_key`];
    if (key === undefined) continue;
    if (key === null) {
      roles[name] = { ...role(name, "unavailable"), basis: "person_selected", candidates: roles[name].candidates, evidence: [`A person at your organization stated that no column records the ${name}.`] };
      continue;
    }
    const selected = field(key);
    if (listedValues(selected).length === 0) return invalid("service_role_field_not_listed", `The ${name} must be a column whose values KAI lists.`);
    roles[name] = { ...withField(role(name, "established"), selected), basis: "person_selected", candidates: roles[name].candidates,
      values: listedValues(selected).map((item) => ({ value_key: item.value_key, label: item.label, record_count: item.record_count })), evidence: [selectedEvidence] };
  }
  if (selections.entity_identifier_field_key !== undefined) {
    const key = selections.entity_identifier_field_key;
    if (key === null) roles.entity_identifier = { ...role("entity_identifier", "unavailable"), basis: "person_selected", candidates: roles.entity_identifier.candidates, evidence: ["A person at your organization stated that no column identifies the households or people served."] };
    else if (!field(key) || key === roles.encounter_identifier.field_key) return invalid("service_role_field_not_listed", "The household or participant identifier must be another column of this table.");
    else {
      const kind = selections.entity_kind ?? (roles.entity_identifier.field_key === key ? roles.entity_identifier.entity_kind : null);
      roles.entity_identifier = { ...withField(role("entity_identifier", kind ? "established" : "proposed"), field(key)), basis: kind ? "person_selected" : "proposed",
        candidates: roles.entity_identifier.candidates, entity_kind: kind ?? null,
        evidence: [kind ? `${selectedEvidence} One identifier is one ${kind}.` : `${selectedEvidence} Whether one identifier is a household, a person or a family is not stated.`] };
    }
  } else if (selections.entity_kind !== undefined) {
    if (!roles.entity_identifier.field_key) return invalid("service_role_field_not_listed", "Choose the household or participant identifier column before its entity.");
    roles.entity_identifier = { ...roles.entity_identifier, status: "established", basis: "person_selected", entity_kind: selections.entity_kind,
      evidence: [...roles.entity_identifier.evidence, `${selectedEvidence} One identifier is one ${selections.entity_kind}.`] };
  }
  if (selections.eligibility_field_key !== undefined) {
    const key = selections.eligibility_field_key;
    if (key === null) roles.eligibility = { ...role("eligibility", "unavailable"), basis: "person_selected", candidates: roles.eligibility.candidates, evidence: ["A person at your organization stated that no column decides which records count."] };
    else {
      const selected = field(key);
      const value = listedValues(selected).find((item) => item.value_key === selections.eligibility_value_key);
      if (!selected || !value) return invalid("service_role_value_not_listed", "The included value must be a listed value of the selected eligibility column.");
      roles.eligibility = { ...withField(role("eligibility", "established"), selected), basis: "person_selected", candidates: roles.eligibility.candidates,
        included_value_key: value.value_key, included_value_label: value.label, evidence: [`${selectedEvidence} Records with ${value.label} count; others are excluded and counted.`] };
    }
  }
  const keys = SERVICE_ROLES.map((name) => roles[name].field_key).filter(Boolean);
  if (new Set(keys).size !== keys.length) return refusal("service_role_fields_not_distinct", "Each role needs a different column.", "Choose a different column for each role.");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Findings: which measurements one discovery and Project period support.

const usable = (entry) => ["established", "proposed"].includes(entry?.status) && Boolean(entry.field_key);
const established = (entry) => entry?.status === "established" && Boolean(entry.field_key);

function roleRecord(entry, extra = {}) {
  return entry && entry.field_key ? { field_key: entry.field_key, basis: entry.basis === "person_selected" ? "person_selected" : entry.status === "established" ? "source_heading" : "proposed", ...extra } : null;
}

/**
 * The reconciliation plans and finding specifications of one discovery: an
 * in-period plan when the Project period is recorded and a service date is
 * usable, an all-date plan always, each with an identity mode (encounters
 * when an encounter identifier is usable, otherwise records). Unavailable
 * findings carry their precise requirement.
 */
export function planServiceEventFindings({ discovery, reportingPeriod = null, periodProblem = null, materialFieldKeys = [] }) {
  const roles = discovery.roles;
  const status = roles.status;
  const findings = [];
  const unavailable = [];
  if (discovery.status !== "service_events") return { plans: {}, findings, unavailable };
  const statusReady = usable(status) && Boolean(status.completed_value_label);
  if (!statusReady) {
    unavailable.push({ metric: SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, requirement: status.status === "ambiguous"
      ? `Choose which column and value mean a completed service. ${status.evidence.join(" ")}`
      : "No column states which records are completed services." });
    return { plans: {}, findings, unavailable };
  }
  const encounters = usable(roles.encounter_identifier);
  const date = usable(roles.service_date);
  const eligibilityApplied = roles.eligibility.status === "established";
  const eligibilityUnresolved = ["proposed", "ambiguous"].includes(roles.eligibility.status);
  const programme = usable(roles.programme) ? roles.programme : null;
  const activity = usable(roles.activity) ? roles.activity : null;
  const entity = usable(roles.entity_identifier) ? roles.entity_identifier : null;
  const base = {
    encounter_identifier_field_key: encounters ? roles.encounter_identifier.field_key : null,
    status_field_key: status.field_key,
    completed_value_label: status.completed_value_label,
    status_values: (status.values || []).map((value) => ({ value_key: value.value_key, label: value.label })),
    service_date_field_key: date ? roles.service_date.field_key : null,
    programme: programme ? { field_key: programme.field_key, values: programme.values.map((value) => ({ value_key: value.value_key, label: value.label })) } : null,
    activity: activity ? { field_key: activity.field_key, values: activity.values.map((value) => ({ value_key: value.value_key, label: value.label })) } : null,
    entity_identifier_field_key: entity ? entity.field_key : null,
    eligibility: eligibilityApplied ? { field_key: roles.eligibility.field_key, included_value_label: roles.eligibility.included_value_label } : null,
    material_field_keys: [...materialFieldKeys].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))),
  };
  const plans = { all_dates: { ...base, period: null, monthly: false } };
  const periodReady = date && reportingPeriod?.start && reportingPeriod?.end;
  if (periodReady) plans.period = { ...base, period: { start: reportingPeriod.start, end: reportingPeriod.end }, monthly: true };
  else {
    unavailable.push({ metric: "period_scope", requirement: !date
      ? (roles.service_date.status === "ambiguous" ? `Choose the service date column to apply the Project period. ${roles.service_date.evidence.join(" ")}` : "No column holds service dates, so results cover all dates.")
      : `${periodProblem || "The Project reporting period is not recorded."} Results cover all dates until it is.` });
  }
  const headlineMode = periodReady ? "period" : "all_dates";
  const strongCore = established(roles.encounter_identifier) && established(status) && !eligibilityUnresolved;
  const rolesFor = (mode, { group = null, withEntity = false } = {}) => ({
    encounter_identifier: encounters ? roleRecord(roles.encounter_identifier, { counted_unit: roles.encounter_identifier.counted_unit ?? null }) : null,
    status: roleRecord(status, { completed_value_key: status.completed_value_key, completed_value_label: status.completed_value_label }),
    service_date: mode === "period" ? roleRecord(roles.service_date) : null,
    programme: group?.role === "programme" ? roleRecord(programme) : null,
    activity: group?.role === "activity" ? roleRecord(activity) : null,
    entity_identifier: withEntity ? roleRecord(entity, { entity_kind: entity.entity_kind ?? null }) : null,
    eligibility: eligibilityApplied ? roleRecord(roles.eligibility, { included_value_key: roles.eligibility.included_value_key, included_value_label: roles.eligibility.included_value_label }) : null,
  });
  const add = (spec) => findings.push(spec);
  for (const mode of Object.keys(plans)) {
    const headline = mode === headlineMode;
    const coreBasis = strongCore && (mode === "all_dates" || established(roles.service_date)) ? "service_encounters" : "source_values";
    add({ metric: SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, mode, group: null, required: headline, finding_basis: coreBasis, roles: rolesFor(mode) });
    if (!headline) continue;
    for (const [name, entry] of [["programme", programme], ["activity", activity]]) {
      if (!entry) continue;
      for (const value of entry.values) {
        add({ metric: SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, mode, required: name === "programme",
          group: { role: name, field_key: entry.field_key, value_key: value.value_key, value_label: value.label },
          finding_basis: coreBasis === "service_encounters" && established(entry) ? "service_encounters" : "source_values",
          roles: rolesFor(mode, { group: { role: name } }) });
      }
    }
    if (entity) {
      const entityBasis = coreBasis === "service_encounters" && established(entity) && entity.entity_kind ? "service_encounters" : "source_values";
      add({ metric: SERVICE_EVENT_METRICS.DISTINCT_ENTITIES, mode, group: null, required: true, finding_basis: entityBasis, roles: rolesFor(mode, { withEntity: true }) });
      if (programme) {
        for (const value of programme.values) {
          add({ metric: SERVICE_EVENT_METRICS.GROUP_DISTINCT_ENTITIES, mode, required: false,
            group: { role: "programme", field_key: programme.field_key, value_key: value.value_key, value_label: value.label },
            finding_basis: entityBasis === "service_encounters" && established(programme) ? "service_encounters" : "source_values",
            roles: { ...rolesFor(mode, { group: { role: "programme" }, withEntity: true }) } });
        }
      }
    }
    if (mode === "period") add({ metric: SERVICE_EVENT_METRICS.MONTHLY, mode, group: null, required: false, finding_basis: coreBasis, roles: rolesFor(mode) });
  }
  if (!encounters) {
    unavailable.push({ metric: "distinct_encounters", requirement: roles.encounter_identifier.status === "ambiguous"
      ? `Choose the encounter identifier column to count each encounter once. ${roles.encounter_identifier.evidence.join(" ")}`
      : "No column is established as the encounter identifier, so these results count records: a repeated record of one encounter is counted again." });
  }
  if (!entity) {
    unavailable.push({ metric: SERVICE_EVENT_METRICS.DISTINCT_ENTITIES, requirement: roles.entity_identifier.status === "ambiguous"
      ? `Choose the household or participant identifier column. ${roles.entity_identifier.evidence.join(" ")}`
      : "No column is established as a household or participant identifier, so households or people served cannot be counted." });
  } else if (!entity.entity_kind) {
    unavailable.push({ metric: "entity_kind", requirement: `State whether one identifier in column ${entity.column} is a household, a person or a family; until then the result counts distinct identifier values.` });
  }
  if (!programme) {
    unavailable.push({ metric: SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, requirement: roles.programme.status === "ambiguous"
      ? `Choose the programme column. ${roles.programme.evidence.join(" ")}` : "No column is established as the programme, so results are not broken down by programme." });
  }
  if (eligibilityUnresolved) {
    unavailable.push({ metric: "eligibility", requirement: `${roles.eligibility.evidence.join(" ")} Until it is confirmed, these results are source-value findings that do not apply it.` });
  }
  return { plans, findings, unavailable };
}

/**
 * The persistable measurement of one finding over its reconciliation. The
 * definition holds the roles (with whether each was established by the
 * source heading or selected by a person), the period, the group and the
 * duplicate policy, so the measurement's identity changes with any of them.
 */
export function serviceEventMeasurementOf({ finding, reconciliation, sheetKey = null, reportingPeriod = null, requiredKeys = [] }) {
  const c = reconciliation.counts;
  const component = {
    [SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS]: "eligible_encounter_count",
    [SERVICE_EVENT_METRICS.MONTHLY]: "eligible_encounter_count",
    [SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS]: "group_encounter_count",
    [SERVICE_EVENT_METRICS.DISTINCT_ENTITIES]: "distinct_entity_count",
    [SERVICE_EVENT_METRICS.GROUP_DISTINCT_ENTITIES]: "group_distinct_entity_count",
  }[finding.metric];
  const groups = finding.group?.role === "activity" ? c.activities : c.groups;
  const groupRow = finding.group ? groups.find((group) => group.value_key === finding.group.value_key) : null;
  const componentCounts = {
    ...c,
    ...(groupRow ? { group_encounter_count: groupRow.encounter_count, ...(Number.isSafeInteger(groupRow.distinct_entity_count) ? { group_distinct_entity_count: groupRow.distinct_entity_count } : {}) } : {}),
    required_measurement_keys: [...requiredKeys],
  };
  const definition = {
    metric: finding.metric,
    measured_component: component,
    finding_basis: finding.finding_basis,
    counted_unit: { kind: finding.roles.encounter_identifier ? "encounter" : "record", label: serviceCountedUnitLabel({ roles: finding.roles, finding_basis: finding.finding_basis }) },
    roles: finding.roles,
    group: finding.group,
    duplicate_policy: SERVICE_DUPLICATE_POLICY,
    material_field_keys: reconciliation.material_field_keys ?? [],
    period: finding.mode === "period" && reportingPeriod
      ? { period_source: PERIOD_SOURCE_ENGAGEMENT, period_start: reportingPeriod.start, period_end: reportingPeriod.end, precision: "day" }
      : null,
    discovery_version: SERVICE_ROLE_DISCOVERY_VERSION,
  };
  const fieldKeys = [...new Set(Object.values(finding.roles).filter(Boolean).map((entry) => entry.field_key))]
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  const value = componentCounts[component];
  return Object.freeze({
    family: SERVICE_EVENTS_FAMILY,
    calculationMethod: SERVICE_EVENTS_METHOD,
    basisVersion: SERVICE_EVENTS_BASIS_VERSION,
    sheetKey,
    measurementKey: computeMeasurementKey({ family: SERVICE_EVENTS_FAMILY, calculationMethod: SERVICE_EVENTS_METHOD, definition }),
    definition: Object.freeze(definition),
    fieldKeys: Object.freeze(fieldKeys),
    measuredValue: value,
    numerator: value,
    denominator: null,
    percentage: null,
    componentCounts: Object.freeze(componentCounts),
    exclusions: reconciliation.row_exclusions,
    rowLocators: null,
  });
}

/** The measurement key a finding has, before its counts are known (identity ignores counts). */
function findingKey({ finding, reconciliation, sheetKey, reportingPeriod }) {
  return serviceEventMeasurementOf({ finding, reconciliation, sheetKey, reportingPeriod }).measurementKey;
}

/**
 * Every finding of one discovery as a persistable measurement, from the
 * worker's reconciliations ({period?, all_dates}). The required set (the
 * headline completed encounters, its programme breakdown and households
 * served) is named on every measurement so a saved subset is never read as
 * the completed set.
 */
export function deriveServiceEventMeasurements({ planned, reconciliations, sheetKey = null, reportingPeriod = null }) {
  const material = (mode) => ({ ...reconciliations[mode], material_field_keys: planned.plans[mode].material_field_keys });
  const keyed = planned.findings.map((finding) => ({ finding, key: findingKey({ finding, reconciliation: material(finding.mode), sheetKey, reportingPeriod }) }));
  const requiredKeys = keyed.filter((entry) => entry.finding.required).map((entry) => entry.key).sort();
  return keyed.map(({ finding }) => {
    const measurement = serviceEventMeasurementOf({ finding, reconciliation: material(finding.mode), sheetKey, reportingPeriod, requiredKeys });
    return { finding, measurement };
  });
}

/** Whether a derived measurement is still statable and keeps its arithmetic (a write-path check). */
export function serviceEventMeasurementRecordable(measurement) {
  const row = {
    measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: measurement.sheetKey,
    definition: measurement.definition, field_keys: measurement.fieldKeys, measured_value: measurement.measuredValue, numerator: measurement.numerator,
    denominator: measurement.denominator, percentage: measurement.percentage, component_counts: measurement.componentCounts, exclusions: measurement.exclusions,
  };
  return derivedMeasurementArithmeticHolds(row) && validateDerivedStatements({ measurementRow: row }).ok;
}

/** A short customer name for a finding (also the name planned-target matching reads). */
export function serviceFindingName(definition) {
  const roles = definition.roles || {};
  const unit = definition.counted_unit?.label || "record";
  const plural = /s$/.test(unit) ? unit : `${unit}s`;
  const encounters = definition.counted_unit?.kind === "record" ? "Completed-status records" : definition.finding_basis === "service_encounters" ? `Completed ${plural}` : `Completed-status ${plural}`;
  const kind = roles.entity_identifier?.entity_kind;
  const entities = definition.finding_basis === "service_encounters" && kind
    ? `Distinct ${kind === "person" ? "people" : kind === "family" ? "families" : "households"} served`
    : "Distinct identifier values served";
  const scope = definition.group ? ` in ${definition.group.value_label}` : "";
  switch (definition.metric) {
    case SERVICE_EVENT_METRICS.DISTINCT_ENTITIES:
    case SERVICE_EVENT_METRICS.GROUP_DISTINCT_ENTITIES:
      return `${entities}${scope}`;
    case SERVICE_EVENT_METRICS.MONTHLY:
      return `${encounters} by month`;
    default:
      return `${encounters}${scope}`;
  }
}

/** The structured fields every copy of an identity must agree on (profile identifier, category and date columns). */
// A withheld vocabulary (free text, a person's attribute) is not a structured
// fact about the encounter, so a difference there never makes copies conflict.
export function serviceMaterialFieldKeys(basis) {
  return screenedTabularFields(basis).filter((field) => field.roles.includes("identifier") || field.roles.includes("date")
    || (field.roles.includes("categorical") && listedValues(field).length > 0)).map((field) => field.field_key);
}
