export const TXT_MD_BYTE_DETECTOR_VALIDATOR_KEY = "VAL-TXTMD-BYTE-P0-05E";

const UTF8_BOM = Object.freeze([0xEF, 0xBB, 0xBF]);
const UTF16_LE_BOM = Object.freeze([0xFF, 0xFE]);
const UTF16_BE_BOM = Object.freeze([0xFE, 0xFF]);
const UTF32_LE_BOM = Object.freeze([0xFF, 0xFE, 0x00, 0x00]);
const UTF32_BE_BOM = Object.freeze([0x00, 0x00, 0xFE, 0xFF]);

const utf8FatalDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

function hasPrefix(bytes, prefix) {
  if (bytes.byteLength < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function detectorResult({
  expected_policy,
  expected_category,
  scope_note,
  utf8_bom_removed = false,
  decoder_error_caught = false,
  decoded_ufeff_count = 0,
}) {
  return Object.freeze({
    validator_key: TXT_MD_BYTE_DETECTOR_VALIDATOR_KEY,
    expected_policy,
    expected_category,
    scope_note,
    evidence: Object.freeze({
      encoding_gate_pass_only: expected_policy === "allow",
      utf8_bom_removed,
      decoder_error_caught,
      decoded_ufeff_count,
    }),
  });
}

function allowResult({ utf8_bom_removed, decoded_ufeff_count }) {
  return detectorResult({
    expected_policy: "allow",
    expected_category: "encoding_gate_pass",
    scope_note: "encoding_gate_pass_only",
    utf8_bom_removed,
    decoded_ufeff_count,
  });
}

function blockResult({ expected_category, decoder_error_caught = false }) {
  return detectorResult({
    expected_policy: "block",
    expected_category,
    scope_note: "encoding_binary_gate_block_only",
    decoder_error_caught,
  });
}

function countDecodedUfeff(decodedText) {
  let count = 0;
  for (const char of decodedText) {
    if (char.codePointAt(0) === 0xFEFF) count += 1;
  }
  return count;
}

function firstBlockedControlCategory(decodedText) {
  for (let index = 0; index < decodedText.length; index += 1) {
    const codePoint = decodedText.codePointAt(index);
    if (codePoint > 0xFFFF) index += 1;

    if (codePoint === 0x0000) return "nul_rejection";
    if (codePoint === 0x000D && decodedText.codePointAt(index + 1) !== 0x000A) return "lone_cr";
    if (codePoint <= 0x001F && codePoint !== 0x0009 && codePoint !== 0x000A && codePoint !== 0x000D) {
      return "prohibited_control";
    }
    if (codePoint === 0x007F) return "prohibited_control";
    if (codePoint >= 0x0080 && codePoint <= 0x009F) return "prohibited_control";
  }

  return null;
}

export function detectTxtMdBytePolicy(inputBytes) {
  if (!(inputBytes instanceof Uint8Array)) {
    throw new TypeError("detectTxtMdBytePolicy accepts only Uint8Array-compatible byte input.");
  }

  const bytes = inputBytes;

  if (hasPrefix(bytes, UTF32_LE_BOM) || hasPrefix(bytes, UTF32_BE_BOM)) {
    return blockResult({ expected_category: "unsupported_bom_encoding" });
  }

  if (hasPrefix(bytes, UTF16_LE_BOM) || hasPrefix(bytes, UTF16_BE_BOM)) {
    return blockResult({ expected_category: "unsupported_bom_encoding" });
  }

  const utf8_bom_removed = hasPrefix(bytes, UTF8_BOM);
  const bytesForDecoding = utf8_bom_removed ? bytes.subarray(UTF8_BOM.length) : bytes;

  let decodedText;
  try {
    decodedText = utf8FatalDecoder.decode(bytesForDecoding);
  } catch {
    return blockResult({
      expected_category: "invalid_utf8",
      decoder_error_caught: true,
    });
  }

  const blockedControlCategory = firstBlockedControlCategory(decodedText);
  if (blockedControlCategory) {
    return blockResult({ expected_category: blockedControlCategory });
  }

  return allowResult({
    utf8_bom_removed,
    decoded_ufeff_count: countDecodedUfeff(decodedText),
  });
}
