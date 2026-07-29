import { KAI_SPRINT2_P0_CSV_LIMITS } from "../config/kaiSprint2P0Contract.js";
import { detectP0FileTypeAgreement } from "./p0FileTypeAgreementDetector.js";

const CSV_ROW_LIMIT_EXCEEDED_RESULT = Object.freeze({
  policy: "block",
  category: "csv_row_limit_exceeded",
});

const CSV_STATE = Object.freeze({
  FIELD_START: "field_start",
  UNQUOTED: "unquoted",
  QUOTED: "quoted",
  AFTER_QUOTE: "after_quote",
});

function sanitizedCsvFailure() {
  return new Error("CSV row-limit inspection failed.");
}

function isCsvTextGatePass(result) {
  return (
    result &&
    typeof result === "object" &&
    result.policy === "allow" &&
    result.category === "type_agreement_pass" &&
    result.evidence?.normalized_extension === ".csv" &&
    result.evidence?.text_gate_category === "encoding_gate_pass"
  );
}

function assertCrLf(bytes, index) {
  if (index + 1 >= bytes.byteLength || bytes[index + 1] !== 0x0A) {
    throw sanitizedCsvFailure();
  }
}

function countCsvLogicalRecordsUntilLimit(bytes, maximumRecords) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("countCsvLogicalRecordsUntilLimit requires bytes as a Uint8Array.");
  }
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 0) {
    throw new TypeError("countCsvLogicalRecordsUntilLimit requires a non-negative integer maximum.");
  }

  let records = 0;
  let recordHasContent = false;
  let state = CSV_STATE.FIELD_START;

  const establishRecord = () => {
    records += 1;
    recordHasContent = false;
    state = CSV_STATE.FIELD_START;
    return records <= maximumRecords;
  };

  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index];

    if (state === CSV_STATE.QUOTED) {
      if (byte === 0x22) {
        state = CSV_STATE.AFTER_QUOTE;
      } else if (byte === 0x0D) {
        assertCrLf(bytes, index);
        index += 1;
      }
      continue;
    }

    if (state === CSV_STATE.AFTER_QUOTE) {
      if (byte === 0x22) {
        state = CSV_STATE.QUOTED;
      } else if (byte === 0x2C) {
        state = CSV_STATE.FIELD_START;
      } else if (byte === 0x0A) {
        if (!establishRecord()) return Object.freeze({ records, exceeded: true });
      } else if (byte === 0x0D) {
        assertCrLf(bytes, index);
        if (!establishRecord()) return Object.freeze({ records, exceeded: true });
        index += 1;
      } else {
        throw sanitizedCsvFailure();
      }
      continue;
    }

    if (state === CSV_STATE.FIELD_START) {
      if (byte === 0x22) {
        recordHasContent = true;
        state = CSV_STATE.QUOTED;
      } else if (byte === 0x2C) {
        recordHasContent = true;
      } else if (byte === 0x0A) {
        if (!establishRecord()) return Object.freeze({ records, exceeded: true });
      } else if (byte === 0x0D) {
        assertCrLf(bytes, index);
        if (!establishRecord()) return Object.freeze({ records, exceeded: true });
        index += 1;
      } else {
        recordHasContent = true;
        state = CSV_STATE.UNQUOTED;
      }
      continue;
    }

    if (byte === 0x2C) {
      state = CSV_STATE.FIELD_START;
    } else if (byte === 0x22) {
      throw sanitizedCsvFailure();
    } else if (byte === 0x0A) {
      if (!establishRecord()) return Object.freeze({ records, exceeded: true });
    } else if (byte === 0x0D) {
      assertCrLf(bytes, index);
      if (!establishRecord()) return Object.freeze({ records, exceeded: true });
      index += 1;
    }
  }

  if (state === CSV_STATE.QUOTED) {
    throw sanitizedCsvFailure();
  }

  if (recordHasContent) {
    if (!establishRecord()) return Object.freeze({ records, exceeded: true });
  }

  return Object.freeze({ records, exceeded: false });
}

export function detectCsvRowLimitPolicy({ extension, declaredMime, bytes } = {}) {
  const typeAgreementResult = detectP0FileTypeAgreement({ extension, declaredMime, bytes });
  if (!isCsvTextGatePass(typeAgreementResult)) {
    throw sanitizedCsvFailure();
  }

  const countResult = countCsvLogicalRecordsUntilLimit(
    bytes,
    KAI_SPRINT2_P0_CSV_LIMITS.maxLogicalRecords,
  );

  if (countResult.exceeded) {
    return CSV_ROW_LIMIT_EXCEEDED_RESULT;
  }

  return undefined;
}

export const __testables = Object.freeze({
  countCsvLogicalRecordsUntilLimit,
  sanitizedCsvFailure,
});
