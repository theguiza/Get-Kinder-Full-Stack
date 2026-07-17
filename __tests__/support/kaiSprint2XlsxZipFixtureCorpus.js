const textEncoder = new TextEncoder();

export const XLSX_ZIP_REQUIRED_ENTRIES = Object.freeze([
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
]);

export const XLSX_ZIP_FIXTURE_POLICIES = Object.freeze(["allow", "block"]);

export const XLSX_ZIP_FIXTURE_CATEGORIES = Object.freeze([
  "type_agreement_pass",
  "standalone_archive_or_non_xlsx",
  "truncated_or_malformed_type",
  "disallowed_binary_signature",
]);

export const XLSX_ZIP_FIXTURE_CORPUS_STATUSES = Object.freeze(["corpus_only"]);

export const XLSX_ZIP_FIXTURE_AUTHORITY_MAP = Object.freeze({
  "OWNER_DECISION.P0_05F.XLSX_MINIMUM_IDENTITY": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F XLSX shallow identity rule",
    requirement_summary:
      "Positive XLSX identity requires a ZIP local-file-header signature, readable EOCD, readable central directory, internally consistent bounds and offsets, and exact case-sensitive OOXML entry names.",
    supported_expected_policy: "allow",
    supported_expected_category: "type_agreement_pass",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.MISSING_XLSX_ENTRY": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F ZIP without minimum XLSX structure",
    requirement_summary:
      "Readable ZIP packages missing one or more exact required OOXML entries block as standalone_archive_or_non_xlsx, not malformed ZIP.",
    supported_expected_policy: "block",
    supported_expected_category: "standalone_archive_or_non_xlsx",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.CASE_SENSITIVE_XLSX_ENTRY": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F exact case-sensitive XLSX entry names",
    requirement_summary:
      "A readable ZIP with a case-variant required OOXML entry blocks because required-entry identity is exact and case-sensitive.",
    supported_expected_policy: "block",
    supported_expected_category: "standalone_archive_or_non_xlsx",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.RENAMED_NON_OOXML_ZIP": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F renamed ZIP is not XLSX identity",
    requirement_summary:
      "A readable ZIP containing plausible but non-authoritative renamed files is not XLSX merely because similar strings appear in raw bytes.",
    supported_expected_policy: "block",
    supported_expected_category: "standalone_archive_or_non_xlsx",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.MALFORMED_XLSX_ZIP": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F malformed XLSX ZIP identity incomplete",
    requirement_summary:
      "ZIP-prefixed bytes with unreadable or out-of-bounds directory structure block as truncated_or_malformed_type and remain distinct from missing-entry cases.",
    supported_expected_policy: "block",
    supported_expected_category: "truncated_or_malformed_type",
    authority_status: "contract_grounded",
  }),
  "OWNER_DECISION.P0_05F.STANDALONE_ZIP_SIGNATURE": Object.freeze({
    source_document: "Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md",
    section_or_decision_key: "P0-05F recognized standalone ZIP signature",
    requirement_summary:
      "A readable arbitrary standalone ZIP remains rejected unless it satisfies minimum XLSX OOXML identity.",
    supported_expected_policy: "block",
    supported_expected_category: "standalone_archive_or_non_xlsx",
    authority_status: "contract_grounded",
  }),
});

function writeUint16LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function localFileHeader(name, offset) {
  const nameBytes = textEncoder.encode(name);
  const header = new Uint8Array(30 + nameBytes.byteLength);
  writeUint32LE(header, 0, 0x04034b50);
  writeUint16LE(header, 4, 20);
  writeUint16LE(header, 6, 0);
  writeUint16LE(header, 8, 0);
  writeUint16LE(header, 10, 0);
  writeUint16LE(header, 12, 0);
  writeUint32LE(header, 14, 0);
  writeUint32LE(header, 18, 0);
  writeUint32LE(header, 22, 0);
  writeUint16LE(header, 26, nameBytes.byteLength);
  writeUint16LE(header, 28, 0);
  header.set(nameBytes, 30);
  return Object.freeze({ bytes: header, name, offset, recordLength: header.byteLength });
}

function centralDirectoryRecord(localHeader) {
  const nameBytes = textEncoder.encode(localHeader.name);
  const record = new Uint8Array(46 + nameBytes.byteLength);
  writeUint32LE(record, 0, 0x02014b50);
  writeUint16LE(record, 4, 20);
  writeUint16LE(record, 6, 20);
  writeUint16LE(record, 8, 0);
  writeUint16LE(record, 10, 0);
  writeUint16LE(record, 12, 0);
  writeUint16LE(record, 14, 0);
  writeUint32LE(record, 16, 0);
  writeUint32LE(record, 20, 0);
  writeUint32LE(record, 24, 0);
  writeUint16LE(record, 28, nameBytes.byteLength);
  writeUint16LE(record, 30, 0);
  writeUint16LE(record, 32, 0);
  writeUint16LE(record, 34, 0);
  writeUint16LE(record, 36, 0);
  writeUint32LE(record, 38, 0);
  writeUint32LE(record, 42, localHeader.offset);
  record.set(nameBytes, 46);
  return record;
}

function endOfCentralDirectory(entryCount, centralDirectoryLength, centralDirectoryOffset) {
  const record = new Uint8Array(22);
  writeUint32LE(record, 0, 0x06054b50);
  writeUint16LE(record, 4, 0);
  writeUint16LE(record, 6, 0);
  writeUint16LE(record, 8, entryCount);
  writeUint16LE(record, 10, entryCount);
  writeUint32LE(record, 12, centralDirectoryLength);
  writeUint32LE(record, 16, centralDirectoryOffset);
  writeUint16LE(record, 20, 0);
  return record;
}

export function createStoredEmptyZip(entries) {
  const localHeaders = [];
  const localBytes = [];
  let localOffset = 0;

  for (const name of entries) {
    const localHeader = localFileHeader(name, localOffset);
    localHeaders.push(localHeader);
    localBytes.push(localHeader.bytes);
    localOffset += localHeader.recordLength;
  }

  const centralDirectoryOffset = localOffset;
  const centralDirectoryBytes = localHeaders.map((localHeader) => centralDirectoryRecord(localHeader));
  const centralDirectoryLength = centralDirectoryBytes.reduce((sum, record) => sum + record.byteLength, 0);
  const eocd = endOfCentralDirectory(entries.length, centralDirectoryLength, centralDirectoryOffset);

  return Object.freeze({
    bytes: concatBytes([...localBytes, ...centralDirectoryBytes, eocd]),
    entries: Object.freeze([...entries]),
    localHeaderOffsets: Object.freeze(localHeaders.map((localHeader) => localHeader.offset)),
    centralDirectoryRecordOffsets: Object.freeze(
      centralDirectoryBytes.reduce((offsets, record) => {
        const previousOffset = offsets.length === 0 ? centralDirectoryOffset : offsets[offsets.length - 1] + centralDirectoryBytes[offsets.length - 1].byteLength;
        offsets.push(previousOffset);
        return offsets;
      }, []),
    ),
    centralDirectoryLength,
    centralDirectoryOffset,
    entryCount: entries.length,
  });
}

function fixture({
  fixture_id,
  description,
  entries,
  expected_policy,
  expected_category,
  authority,
  fixture_family,
  structural_claim,
  missing_required_entry = null,
  wrong_case_entry = null,
  malformed_defect = null,
  buildBytes,
}) {
  const zip = buildBytes ? buildBytes() : createStoredEmptyZip(entries);
  return Object.freeze({
    fixture_id,
    description,
    extension: ".xlsx",
    declared_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: zip.bytes,
    entries: Object.freeze(entries),
    expected_policy,
    expected_category,
    authority,
    fixture_family,
    structural_claim,
    missing_required_entry,
    wrong_case_entry,
    malformed_defect,
    synthetic_provenance:
      "synthetic deterministic in-memory ZIP bytes created by the P0-05F test-only stored-empty-entry builder; not copied from client data, deployed data, external services, private material, disk files, or real documents",
    corpus_status: "corpus_only",
    decompression_required: false,
    raw_byte_search_proves_entry_presence: false,
    production_detector_claim: false,
  });
}

function readableXlsxLikeFixture(args) {
  return fixture({
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.MISSING_XLSX_ENTRY",
    fixture_family: "readable_zip_missing_or_non_xlsx_identity",
    structural_claim: "readable_zip",
    ...args,
  });
}

const genericZipEntries = Object.freeze(["metadata.json", "notes/readme.txt"]);

export const XLSX_ZIP_FIXTURES = Object.freeze([
  fixture({
    fixture_id: "XLSXZIP-P0-05F-001-ALLOW-MINIMUM-XLSX",
    description: "Minimum positive XLSX identity with only required OOXML entries as parsed central-directory names.",
    entries: XLSX_ZIP_REQUIRED_ENTRIES,
    expected_policy: "allow",
    expected_category: "type_agreement_pass",
    authority: "OWNER_DECISION.P0_05F.XLSX_MINIMUM_IDENTITY",
    fixture_family: "positive_minimum_xlsx_identity",
    structural_claim: "readable_zip_with_minimum_ooxml_identity",
  }),
  readableXlsxLikeFixture({
    fixture_id: "XLSXZIP-P0-05F-002-BLOCK-MISSING-CONTENT-TYPES",
    description: "Readable ZIP missing only the exact [Content_Types].xml OOXML entry.",
    entries: Object.freeze(["_rels/.rels", "xl/workbook.xml"]),
    missing_required_entry: "[Content_Types].xml",
  }),
  readableXlsxLikeFixture({
    fixture_id: "XLSXZIP-P0-05F-003-BLOCK-MISSING-RELS",
    description: "Readable ZIP missing only the exact _rels/.rels OOXML entry.",
    entries: Object.freeze(["[Content_Types].xml", "xl/workbook.xml"]),
    missing_required_entry: "_rels/.rels",
  }),
  readableXlsxLikeFixture({
    fixture_id: "XLSXZIP-P0-05F-004-BLOCK-MISSING-WORKBOOK",
    description: "Readable ZIP missing only the exact xl/workbook.xml OOXML entry.",
    entries: Object.freeze(["[Content_Types].xml", "_rels/.rels"]),
    missing_required_entry: "xl/workbook.xml",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-005-BLOCK-WRONG-CASE-WORKBOOK",
    description: "Readable ZIP where workbook exists only as xl/Workbook.xml and fails exact case-sensitive identity.",
    entries: Object.freeze(["[Content_Types].xml", "_rels/.rels", "xl/Workbook.xml"]),
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.CASE_SENSITIVE_XLSX_ENTRY",
    fixture_family: "readable_zip_wrong_case_ooxml_identity",
    structural_claim: "readable_zip",
    missing_required_entry: "xl/workbook.xml",
    wrong_case_entry: "xl/Workbook.xml",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-006-BLOCK-RENAMED-NON-OOXML-ZIP",
    description: "Readable ZIP with plausible renamed files that are not the authoritative exact OOXML entries.",
    entries: Object.freeze(["Content_Types.xml", "_rels/rels.xml", "xl/workbook.xml.txt", "xl/workbook.xml.bak"]),
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.RENAMED_NON_OOXML_ZIP",
    fixture_family: "readable_renamed_non_ooxml_zip",
    structural_claim: "readable_zip",
    missing_required_entry: "[Content_Types].xml",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-007-BLOCK-ARBITRARY-ZIP-NON-XLSX-METADATA",
    description: "Readable arbitrary ZIP with allowed non-XLSX metadata but no OOXML identity.",
    entries: genericZipEntries,
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.STANDALONE_ZIP_SIGNATURE",
    fixture_family: "readable_arbitrary_zip",
    structural_claim: "readable_zip",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-008-BLOCK-XLSX-METADATA-MISSING-OOXML",
    description: "Readable ZIP with .xlsx metadata but missing the minimum OOXML structure.",
    entries: Object.freeze(["docProps/core.xml", "xl/styles.xml"]),
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.STANDALONE_ZIP_SIGNATURE",
    fixture_family: "readable_zip_xlsx_metadata_missing_ooxml",
    structural_claim: "readable_zip",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-009-BLOCK-STANDALONE-ZIP-SIGNATURE",
    description: "Recognized standalone ZIP signature with otherwise permitted non-XLSX metadata.",
    entries: Object.freeze(["archive-manifest.json"]),
    expected_policy: "block",
    expected_category: "standalone_archive_or_non_xlsx",
    authority: "OWNER_DECISION.P0_05F.STANDALONE_ZIP_SIGNATURE",
    fixture_family: "recognized_standalone_zip_signature",
    structural_claim: "readable_zip",
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-010-BLOCK-TRUNCATED-LOCAL-SIGNATURE",
    description: "Truncated local-file-header signature is not a readable ZIP identity.",
    entries: Object.freeze([]),
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    authority: "OWNER_DECISION.P0_05F.MALFORMED_XLSX_ZIP",
    fixture_family: "malformed_or_truncated_zip",
    structural_claim: "malformed_zip",
    malformed_defect: "truncated local-file-header signature",
    buildBytes: () => Object.freeze({ bytes: new Uint8Array([0x50, 0x4b, 0x03]), entries: Object.freeze([]) }),
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-011-BLOCK-NO-CENTRAL-DIRECTORY",
    description: "Local header exists without a readable central directory or EOCD.",
    entries: Object.freeze(["[Content_Types].xml"]),
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    authority: "OWNER_DECISION.P0_05F.MALFORMED_XLSX_ZIP",
    fixture_family: "malformed_or_truncated_zip",
    structural_claim: "malformed_zip",
    malformed_defect: "local header without readable central directory",
    buildBytes: () => {
      const zip = createStoredEmptyZip(["[Content_Types].xml"]);
      return Object.freeze({ bytes: zip.bytes.slice(0, zip.centralDirectoryOffset), entries: Object.freeze(["[Content_Types].xml"]) });
    },
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-012-BLOCK-OUT-OF-BOUNDS-CD-OFFSET",
    description: "EOCD records a central-directory offset beyond fixture byte bounds.",
    entries: Object.freeze(["[Content_Types].xml"]),
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    authority: "OWNER_DECISION.P0_05F.MALFORMED_XLSX_ZIP",
    fixture_family: "malformed_or_truncated_zip",
    structural_claim: "malformed_zip",
    malformed_defect: "invalid or out-of-bounds central-directory offset",
    buildBytes: () => {
      const zip = createStoredEmptyZip(["[Content_Types].xml"]);
      const bytes = zip.bytes.slice();
      writeUint32LE(bytes, bytes.byteLength - 6, bytes.byteLength + 100);
      return Object.freeze({ bytes, entries: Object.freeze(["[Content_Types].xml"]) });
    },
  }),
  fixture({
    fixture_id: "XLSXZIP-P0-05F-013-BLOCK-TRUNCATED-CD-RECORD",
    description: "EOCD is readable but the central-directory record is truncated before its recorded name bytes.",
    entries: Object.freeze(["[Content_Types].xml"]),
    expected_policy: "block",
    expected_category: "truncated_or_malformed_type",
    authority: "OWNER_DECISION.P0_05F.MALFORMED_XLSX_ZIP",
    fixture_family: "malformed_or_truncated_zip",
    structural_claim: "malformed_zip",
    malformed_defect: "truncated central-directory record",
    buildBytes: () => {
      const zip = createStoredEmptyZip(["[Content_Types].xml"]);
      const truncatedCentralDirectoryLength = 46;
      const eocd = endOfCentralDirectory(1, truncatedCentralDirectoryLength, zip.centralDirectoryOffset);
      return Object.freeze({
        bytes: concatBytes([zip.bytes.slice(0, zip.centralDirectoryOffset + truncatedCentralDirectoryLength), eocd]),
        entries: Object.freeze(["[Content_Types].xml"]),
      });
    },
  }),
]);

export function getXlsxZipFixtureExpectations() {
  return XLSX_ZIP_FIXTURES.map((item) =>
    Object.freeze({
      fixture_id: item.fixture_id,
      expected_policy: item.expected_policy,
      expected_category: item.expected_category,
    }),
  );
}
