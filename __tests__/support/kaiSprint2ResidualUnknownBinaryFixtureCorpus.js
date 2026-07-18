export const RESIDUAL_UNKNOWN_BINARY_AUTHORITY =
  "OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1";

export const RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY =
  "OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1";

export const RESIDUAL_UNKNOWN_BINARY_FIXTURE_POLICIES = Object.freeze(["block"]);

export const RESIDUAL_UNKNOWN_BINARY_FIXTURE_CATEGORIES = Object.freeze([
  "unknown_binary",
]);

export const RESIDUAL_UNKNOWN_BINARY_FIXTURE_CORPUS_STATUSES = Object.freeze([
  "corpus_only",
]);

export const RESIDUAL_UNKNOWN_BINARY_AUTHORITY_MAP = Object.freeze({
  [RESIDUAL_UNKNOWN_BINARY_AUTHORITY]: Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1",
    requirement_summary:
      "Exactly one synthetic .pdf plus application/pdf fixture with bytes 00 01 at offset zero blocks as unknown_binary after all higher-priority outcomes are excluded.",
    supported_expected_policy: "block",
    supported_expected_category: "unknown_binary",
    supported_scope_note: "unknown_binary_block_only",
    authority_status: "contract_grounded",
  }),
  [RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY]: Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F declared file-MIME matrix",
    requirement_summary:
      ".pdf plus application/pdf is an independently permitted metadata pairing used to isolate residual unknown_binary reachability.",
    supported_expected_policy: "block",
    supported_expected_category: "unknown_binary",
    supported_scope_note: "unknown_binary_block_only",
    authority_status: "contract_grounded",
  }),
});

export const RESIDUAL_UNKNOWN_BINARY_FIXTURES = Object.freeze([
  Object.freeze({
    fixture_id: "UNKNOWNBIN-P0-05F-2D3-001-BLOCK-PDF-APPLICATION-PDF-0001",
    description:
      "Synthetic inert .pdf plus application/pdf fixture with committed bytes 00 01 at offset zero blocking as residual unknown_binary only.",
    extension: ".pdf",
    normalized_extension: ".pdf",
    declared_mime: "application/pdf",
    normalized_declared_mime: "application/pdf",
    bytes: new Uint8Array([0x00, 0x01]),
    byte_length: 2,
    bytes_hex: "00 01",
    byte_offset: 0,
    byte_source_kind: "contract_committed_residual_unknown_binary_fixture_bytes_only",
    expected_policy: "block",
    expected_category: "unknown_binary",
    scope_note: "unknown_binary_block_only",
    authority: RESIDUAL_UNKNOWN_BINARY_AUTHORITY,
    metadata_pairing_authority: RESIDUAL_UNKNOWN_BINARY_METADATA_AUTHORITY,
    synthetic_provenance:
      "synthetic inert residual unknown-binary corpus-only bytes created locally from the committed P0-05F owner decision; not copied from client data, deployed data, external services, secrets, private material, executable files, archives, or real documents",
    corpus_status: "corpus_only",
    fixture_family: "residual_unknown_binary",
    complete_pdf_identity_claim: false,
    incomplete_pdf_signalling_claim: false,
    readable_zip_or_xlsx_claim: false,
    recognized_disallowed_signature_claim: false,
    other_permitted_identity_claim: false,
    malware_scanning_claim: false,
    parser_safety_claim: false,
    archive_validity_claim: false,
    upload_acceptance_claim: false,
    source_eligibility_claim: false,
    usable_document_claim: false,
    production_detector_claim: false,
    production_detector_answer_key: false,
  }),
]);

export function getResidualUnknownBinaryFixtureExpectations() {
  return RESIDUAL_UNKNOWN_BINARY_FIXTURES.map((fixture) =>
    Object.freeze({
      fixture_id: fixture.fixture_id,
      normalized_extension: fixture.normalized_extension,
      normalized_declared_mime: fixture.normalized_declared_mime,
      bytes_hex: fixture.bytes_hex,
      byte_offset: fixture.byte_offset,
      expected_policy: fixture.expected_policy,
      expected_category: fixture.expected_category,
      scope_note: fixture.scope_note,
      authority: fixture.authority,
    }),
  );
}
