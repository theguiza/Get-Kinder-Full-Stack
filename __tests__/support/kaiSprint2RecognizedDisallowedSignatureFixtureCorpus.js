export const RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY =
  "OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES";

export const RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY =
  "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1";

export const RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_POLICIES = Object.freeze(["block"]);

export const RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CATEGORIES = Object.freeze([
  "disallowed_binary_signature",
]);

export const RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURE_CORPUS_STATUSES = Object.freeze([
  "corpus_only",
]);

export const RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY_MAP = Object.freeze({
  [RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY]: Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F recognized disallowed-signature byte authority",
    requirement_summary:
      "DOS/PE MZ, ELF, gzip, 7z, RAR 4, and RAR 5 match only when the complete committed byte sequence begins at byte offset zero, and each blocks as disallowed_binary_signature.",
    supported_expected_policy: "block",
    supported_expected_category: "disallowed_binary_signature",
    authority_status: "contract_grounded",
  }),
  [RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY]: Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F declared file-MIME matrix",
    requirement_summary:
      ".txt plus text/plain is an independently permitted metadata pairing used to isolate byte-signature behavior.",
    supported_expected_policy: "block",
    supported_expected_category: "disallowed_binary_signature",
    authority_status: "contract_grounded",
  }),
});

function bytesFromHex(hex) {
  return new Uint8Array(hex.split(" ").map((byte) => Number.parseInt(byte, 16)));
}

function fixture({
  fixture_id,
  description,
  signature_family,
  signature_hex,
  signature_offset,
  extension,
  declared_mime,
  expected_policy,
  expected_category,
  scope_note,
  authority,
  metadata_pairing_authority,
  corpus_status,
}) {
  return Object.freeze({
    fixture_id,
    description,
    signature_family,
    extension,
    normalized_extension: extension.toLowerCase(),
    declared_mime,
    normalized_declared_mime: declared_mime.trim().toLowerCase(),
    bytes: bytesFromHex(signature_hex),
    byte_length: signature_hex.split(" ").length,
    signature_hex,
    signature_offset,
    byte_source_kind: "contract_committed_minimum_signature_bytes_only",
    expected_policy,
    expected_category,
    scope_note,
    authority,
    metadata_pairing_authority,
    synthetic_provenance:
      "synthetic inert recognized disallowed-signature corpus-only bytes created locally from the committed P0-05F contract table; not copied from client data, deployed data, external services, secrets, private material, executable files, archives, or real documents",
    corpus_status,
    executable_validation_claim: false,
    archive_validity_claim: false,
    decompression_claim: false,
    parser_safety_claim: false,
    malware_scanning_claim: false,
    source_eligibility_claim: false,
    upload_acceptance_claim: false,
    production_detector_claim: false,
    production_detector_answer_key: false,
    unknown_binary_fixture_claim: false,
  });
}

export const RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES = Object.freeze([
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-001-BLOCK-DOS-PE-MZ",
    description: "DOS/PE MZ minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "DOS/PE MZ",
    signature_hex: "4D 5A",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-002-BLOCK-ELF",
    description: "ELF minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "ELF",
    signature_hex: "7F 45 4C 46",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-003-BLOCK-GZIP",
    description: "gzip minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "gzip",
    signature_hex: "1F 8B",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-004-BLOCK-7Z",
    description: "7z minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "7z",
    signature_hex: "37 7A BC AF 27 1C",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-005-BLOCK-RAR4",
    description: "RAR 4 minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "RAR 4",
    signature_hex: "52 61 72 21 1A 07 00",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
  fixture({
    fixture_id: "DISALLOWEDSIG-P0-05F-2D1-006-BLOCK-RAR5",
    description: "RAR 5 minimum committed signature bytes at offset zero block as a recognized disallowed binary signature.",
    signature_family: "RAR 5",
    signature_hex: "52 61 72 21 1A 07 01 00",
    signature_offset: 0,
    extension: ".txt",
    declared_mime: "text/plain",
    expected_policy: "block",
    expected_category: "disallowed_binary_signature",
    scope_note: "type_agreement_block_only",
    authority: RECOGNIZED_DISALLOWED_SIGNATURE_AUTHORITY,
    metadata_pairing_authority: RECOGNIZED_DISALLOWED_SIGNATURE_METADATA_AUTHORITY,
    corpus_status: "corpus_only",
  }),
]);

export function getRecognizedDisallowedSignatureFixtureExpectations() {
  return RECOGNIZED_DISALLOWED_SIGNATURE_FIXTURES.map((item) =>
    Object.freeze({
      fixture_id: item.fixture_id,
      signature_family: item.signature_family,
      normalized_extension: item.normalized_extension,
      normalized_declared_mime: item.normalized_declared_mime,
      signature_hex: item.signature_hex,
      signature_offset: item.signature_offset,
      expected_policy: item.expected_policy,
      expected_category: item.expected_category,
      scope_note: item.scope_note,
      authority: item.authority,
    }),
  );
}
