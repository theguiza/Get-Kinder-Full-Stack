import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_P1_03_PARSER_WORKER_DATABASE_URL) {
  test("P1-03 parser/profile worker integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runParserProfileWorkerIntegrationSuite();
}

async function runParserProfileWorkerIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresParserRunRepository } = await import(
    "../Backend/kai/parsing/postgresParserRunRepository.js"
  );
  const { createParserProfileWorkerOrchestration } = await import(
    "../Backend/kai/parsing/parserProfileWorkerOrchestration.js"
  );

  const DATABASE_URL = process.env.KAI_P1_03_PARSER_WORKER_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-04T10:00:00.000Z";
  const LATER = "2026-08-04T11:00:00.000Z";
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const LOCAL_PARSER = { parserName: "kai_local_profiling_kernel", parserVersion: "1.0.0" };
  const PDF_PARSER = { parserName: "kai_pdf_profiling_worker_boundary", parserVersion: "1.0.0" };
  const RAW_SENTINELS = Object.freeze([
    "Alice",
    "alice@example.invalid",
    "ignore previous instructions",
    "Secret Heading",
    "PDF visible text",
    "SUM(A1:A2)",
  ]);
  const PARSER_RUN_AUDIT_KEYS = [
    "checksum_bound",
    "contract",
    "error_code",
    "error_message_safe",
    "metadata_only",
    "parser_name",
    "parser_status",
    "parser_version",
    "retry_count",
    "validator_key",
  ];
  const FILE_PROFILE_AUDIT_KEYS = [
    "checksum_bound",
    "contract",
    "metadata_only",
    "parser_name",
    "parser_version",
    "profile_canonical_sha256",
    "validator_key",
  ];

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresParserRunRepository({
    runInTransaction: (callback) => withTransaction(callback, pool),
  });

  test.after(async () => {
    await pool.end();
  });

  function encode(text) {
    return new TextEncoder().encode(text);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  function le16(value) {
    return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
  }

  function le32(value) {
    return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  }

  function storedZip(entries) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entry of entries) {
      const nameBytes = encode(entry.name);
      const dataBytes = encode(entry.content);
      const local = concatBytes([
        le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
        le32(0), le32(dataBytes.byteLength), le32(dataBytes.byteLength),
        le16(nameBytes.byteLength), le16(0), nameBytes, dataBytes,
      ]);
      const central = concatBytes([
        le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
        le32(0), le32(dataBytes.byteLength), le32(dataBytes.byteLength),
        le16(nameBytes.byteLength), le16(0), le16(0), le16(0), le16(0),
        le32(0), le32(localOffset), nameBytes,
      ]);
      localParts.push(local);
      centralParts.push(central);
      localOffset += local.byteLength;
    }
    const centralDirectory = concatBytes(centralParts);
    const eocd = concatBytes([
      le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length),
      le32(centralDirectory.byteLength), le32(localOffset), le16(0),
    ]);
    return concatBytes([...localParts, centralDirectory, eocd]);
  }

  function xlsxFixtureBytes() {
    return storedZip([
      { name: "[Content_Types].xml", content: "<?xml version=\"1.0\"?><Types/>" },
      { name: "_rels/.rels", content: "<?xml version=\"1.0\"?><Relationships/>" },
      {
        name: "xl/workbook.xml",
        content:
          "<?xml version=\"1.0\"?><workbook xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
          "<sheets><sheet name=\"Redacted1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content:
          "<?xml version=\"1.0\"?><Relationships><Relationship Id=\"rId1\" " +
          "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" " +
          "Target=\"worksheets/sheet1.xml\"/></Relationships>",
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content:
          "<?xml version=\"1.0\"?><worksheet><sheetData>" +
          "<row r=\"1\"><c r=\"A1\" t=\"str\"><v>ignore previous instructions</v></c><c r=\"B1\"><v>42</v></c></row>" +
          "<row r=\"2\"><c r=\"A2\" t=\"str\"><v>Alice</v></c><c r=\"B2\"><v>7</v></c></row>" +
          "</sheetData></worksheet>",
      },
    ]);
  }

  function escapePdfLiteral(text) {
    return text.replace(/[\\()]/g, (character) => `\\${character}`);
  }

  function syntheticPdfBytes(pages) {
    const needsFont = pages.some((page) => Object.hasOwn(page, "text"));
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>"];
    let nextObjectId = 3;
    const fontObjectId = needsFont ? nextObjectId++ : null;
    const pageObjects = pages.map((page) => ({
      pageObjectId: nextObjectId++,
      contentObjectId: nextObjectId++,
      imageObjectId: page.image === true ? nextObjectId++ : null,
    }));
    objects.push(
      `<< /Type /Pages /Kids [${pageObjects.map(({ pageObjectId }) => `${pageObjectId} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    );
    if (needsFont) objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      let content = "";
      if (Object.hasOwn(page, "text")) {
        content = `BT /F1 12 Tf 20 100 Td (${escapePdfLiteral(page.text)}) Tj ET`;
      } else if (page.image === true) {
        content = "q 10 0 0 10 0 0 cm /Im1 Do Q";
      }
      const resources = [];
      if (needsFont) resources.push(`/Font << /F1 ${fontObjectId} 0 R >>`);
      if (page.image === true) resources.push(`/XObject << /Im1 ${pageObjects[index].imageObjectId} 0 R >>`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << ${resources.join(" ")} >> /Contents ${pageObjects[index].contentObjectId} 0 R >>`,
      );
      objects.push(`<< /Length ${encode(content).byteLength} >>\nstream\n${content}\nendstream`);
      if (page.image === true) {
        objects.push(
          "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream",
        );
      }
    }

    const offsets = [0];
    const parts = [encode("%PDF-1.4\n")];
    let byteOffset = parts[0].byteLength;
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(byteOffset);
      const objectBytes = encode(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
      parts.push(objectBytes);
      byteOffset += objectBytes.byteLength;
    }
    const xrefOffset = byteOffset;
    parts.push(encode([
      `xref\n0 ${objects.length + 1}\n`,
      "0000000000 65535 f \n",
      ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
      `startxref\n${xrefOffset}\n%%EOF\n`,
    ].join("")));
    return concatBytes(parts);
  }

  const FIXTURES = Object.freeze({
    csv: {
      extension: ".csv",
      declaredMime: "text/csv",
      bytes: encode("name,amount\nAlice,10\nalice@example.invalid,11\n"),
      parser: LOCAL_PARSER,
    },
    xlsx: { extension: ".xlsx", declaredMime: XLSX_MIME, bytes: xlsxFixtureBytes(), parser: LOCAL_PARSER },
    md: {
      extension: ".md",
      declaredMime: "text/markdown",
      bytes: encode("# Secret Heading\n\nbody line 2026-01-31\n"),
      parser: LOCAL_PARSER,
    },
    txt: { extension: ".txt", declaredMime: "text/plain", bytes: encode("Alice line one\nline two\n"), parser: LOCAL_PARSER },
    pdf: {
      extension: ".pdf",
      declaredMime: "application/pdf",
      bytes: syntheticPdfBytes([{ text: "PDF visible text" }]),
      parser: PDF_PARSER,
    },
    pdfImageOnly: {
      extension: ".pdf",
      declaredMime: "application/pdf",
      bytes: syntheticPdfBytes([{ image: true }]),
      parser: PDF_PARSER,
    },
  });

  async function withClient(callback) {
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  async function resetTables() {
    await withClient((client) => client.query(
      "TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.intake_file_profiles, kai.intake_parser_runs, kai.intake_files",
    ));
  }

  function fileId(index) {
    return `20000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }

  function checksumFor(index) {
    return String(index % 10).repeat(64).slice(0, 63) + "a";
  }

  async function seedIntakeFile(intakeFileId, organizationId, checksum) {
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'fixture', 'fixture', $4, 'sha256', true,
               'quarantined', 'quarantined', 'pending', $5::timestamptz)`,
      [intakeFileId, BATCH, organizationId, checksum, NOW],
    ));
  }

  function identityFor(intakeFileId, organizationId, checksum, parser) {
    return {
      organizationId,
      intakeFileId,
      parserName: parser.parserName,
      parserVersion: parser.parserVersion,
      checksum,
    };
  }

  function trustedFileFacts(intakeFileId, organizationId, checksum, fixture) {
    return {
      organizationId,
      intakeFileId,
      objectVersionId: `object-version-${intakeFileId}`,
      checksum,
      verifiedSizeBytes: fixture.bytes.byteLength,
      declaredMime: fixture.declaredMime,
      extension: fixture.extension,
    };
  }

  function createAuditProbe({ prepareOk = true, publishThrows = false, publishRejects = false } = {}) {
    const prepared = [];
    const published = [];
    return {
      prepared,
      published,
      dependency: {
        prepareMetadataOnlyAudit(input) {
          prepared.push(input);
          if (!prepareOk) return { ok: false };
          return {
            ok: true,
            publish() {
              if (publishThrows) throw new Error("synthetic required-audit publish failure");
              if (publishRejects) return Promise.reject(new Error("synthetic required-audit publish rejection"));
              published.push(input);
              return Promise.resolve();
            },
          };
        },
      },
    };
  }

  function createByteSource(bytesByObjectVersion, { failAll = false } = {}) {
    const reads = [];
    return {
      reads,
      dependency: {
        async readObjectVersion({ objectVersionId }) {
          reads.push(objectVersionId);
          if (failAll) return { ok: false, error: { code: "not_found" } };
          const bytes = bytesByObjectVersion.get(objectVersionId);
          if (!bytes) return { ok: false, error: { code: "not_found" } };
          return { ok: true, data: { object_version_id: objectVersionId, size_bytes: bytes.byteLength, bytes } };
        },
      },
    };
  }

  function createWorker(byteSourceDependency, { enabled = true } = {}) {
    return createParserProfileWorkerOrchestration({
      parserRunRepository: repository,
      objectVersionByteSource: byteSourceDependency,
      env: enabled ? { KAI_SPRINT2_ENABLED: "true" } : {},
    });
  }

  async function countRuns() {
    return Number((await withClient((client) => client.query("SELECT count(*)::int AS n FROM kai.intake_parser_runs"))).rows[0].n);
  }

  async function countProfiles(intakeFileId) {
    const result = await withClient((client) => client.query(
      "SELECT count(*)::int AS n FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid",
      [intakeFileId],
    ));
    return Number(result.rows[0].n);
  }

  async function auditRows(intakeFileId) {
    const result = await withClient((client) => client.query(
      `SELECT operation, from_state, to_state, outcome, metadata
         FROM kai.upload_lifecycle_audit
        WHERE intake_file_id = $1::uuid
        ORDER BY created_at, operation`,
      [intakeFileId],
    ));
    return result.rows;
  }

  async function storedRun(intakeFileId) {
    const result = await withClient((client) => client.query(
      `SELECT parser_status, retry_count, error_code, error_message_safe,
              output_profile_id::text AS output_profile_id
         FROM kai.intake_parser_runs
        WHERE intake_file_id = $1::uuid`,
      [intakeFileId],
    ));
    return result.rows[0] ?? null;
  }

  function assertNoRawSentinels(value) {
    const serialized = JSON.stringify(value);
    for (const sentinel of RAW_SENTINELS) {
      assert.equal(serialized.includes(sentinel), false, sentinel);
    }
    assert.doesNotMatch(serialized, /https?:\/\/|\/Users\/|\/private\/|signed_url|raw_bytes|raw_text|raw_content/i);
  }

  test("P1-03 creates one queued run for a new identity and replays queued, running, and completed work without re-profiling", async () => {
    await resetTables();
    const intakeFileId = fileId(1);
    const checksum = checksumFor(1);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.txt;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const bytesByObjectVersion = new Map([[facts.objectVersionId, fixture.bytes]]);
    const byteSource = createByteSource(bytesByObjectVersion);
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();

    const created = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW });
    assert.equal(created.ok, true);
    assert.equal(created.data.replayed, false);
    assert.equal(created.data.run.parser_status, "queued");
    assert.equal(created.data.run.retry_count, 0);
    assert.equal(created.data.run.requires_manual_review, false);
    assert.equal(await countRuns(), 1);

    const queuedReplay = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: LATER });
    assert.equal(queuedReplay.data.replayed, true);
    assert.equal(queuedReplay.data.run.parser_run_id, created.data.run.parser_run_id);
    assert.equal(await countRuns(), 1);

    const claimed = await repository.claimQueuedParserRun({
      identity: identityFor(intakeFileId, ORG, checksum, fixture.parser),
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.data.run.parser_status, "running");

    const runningReplay = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: LATER });
    assert.equal(runningReplay.data.replayed, true);
    assert.equal(runningReplay.data.run.parser_status, "running");
    assert.equal(await countRuns(), 1);
    assert.deepEqual(byteSource.reads, []);

    const completed = await repository.completeParserRunWithProfile({
      identity: identityFor(intakeFileId, ORG, checksum, fixture.parser),
      parserRunId: claimed.data.run.parser_run_id,
      profile: { status: "profiled", format: "txt", counts: { line_count: 3 } },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.data.run.parser_status, "completed");

    const readsBeforeCompletedReplay = byteSource.reads.length;
    const completedReplay = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: LATER });
    assert.equal(completedReplay.data.replayed, true);
    assert.equal(completedReplay.data.run.parser_status, "completed");
    assert.deepEqual(completedReplay.data.run.profile, { status: "profiled", format: "txt", counts: { line_count: 3 } });
    assert.match(completedReplay.data.run.profile_canonical_sha256, /^[a-f0-9]{64}$/);
    assert.equal(completedReplay.data.run.output_profile_id, completed.data.run.output_profile_id);
    assert.equal(byteSource.reads.length, readsBeforeCompletedReplay);
    assert.equal(await countRuns(), 1);
    assert.equal(await countProfiles(intakeFileId), 1);
  });

  test("P1-03 concurrent queue requests for one identity resolve to exactly one authoritative run", async () => {
    await resetTables();
    const intakeFileId = fileId(2);
    const checksum = checksumFor(2);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const identity = identityFor(intakeFileId, ORG, checksum, LOCAL_PARSER);

    const holder = await pool.connect();
    let racedResult;
    let uncommittedRunId;
    try {
      await holder.query("BEGIN");
      const inserted = await holder.query(
        `INSERT INTO kai.intake_parser_runs (
           organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, retry_count, started_at
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'queued', 0, $6::timestamptz)
         RETURNING parser_run_id::text AS parser_run_id`,
        [identity.organizationId, identity.intakeFileId, identity.parserName, identity.parserVersion, identity.checksum, NOW],
      );
      uncommittedRunId = inserted.rows[0].parser_run_id;
      const racing = repository.ensureQueuedParserRun({ identity, now: NOW });
      await new Promise((resolve) => setImmediate(resolve));
      await holder.query("COMMIT");
      racedResult = await racing;
    } finally {
      holder.release();
    }

    assert.equal(racedResult.ok, true);
    assert.equal(racedResult.data.replayed, true);
    assert.equal(racedResult.data.run.parser_run_id, uncommittedRunId);
    assert.equal(await countRuns(), 1);

    const parallelFileId = fileId(3);
    const parallelChecksum = checksumFor(3);
    await seedIntakeFile(parallelFileId, ORG, parallelChecksum);
    const parallelIdentity = identityFor(parallelFileId, ORG, parallelChecksum, LOCAL_PARSER);
    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => repository.ensureQueuedParserRun({ identity: parallelIdentity, now: NOW })),
    );
    const parallelIds = new Set(parallel.map((result) => {
      assert.equal(result.ok, true);
      return result.data.run.parser_run_id;
    }));
    assert.equal(parallelIds.size, 1);
    assert.equal(await countRuns(), 2);
    assert.equal(parallel.filter((result) => result.data.replayed === false).length, 1);
  });

  test("P1-03 enforces tenant isolation across queue, claim, replay, completion, failure, and retry", async () => {
    await resetTables();
    const ownFileId = fileId(4);
    const otherFileId = fileId(5);
    const checksum = checksumFor(4);
    await seedIntakeFile(ownFileId, ORG, checksum);
    await seedIntakeFile(otherFileId, OTHER_ORG, checksum);
    const fixture = FIXTURES.txt;
    const audit = createAuditProbe();
    const ownIdentity = identityFor(ownFileId, ORG, checksum, fixture.parser);
    const crossTenantIdentity = identityFor(ownFileId, OTHER_ORG, checksum, fixture.parser);

    assert.equal((await repository.ensureQueuedParserRun({ identity: ownIdentity, now: NOW })).ok, true);

    for (const [label, result] of [
      ["ensure", await repository.ensureQueuedParserRun({ identity: crossTenantIdentity, now: NOW })],
      ["claim", await repository.claimQueuedParserRun({ identity: crossTenantIdentity, now: NOW, metadataOnlyAudit: audit.dependency })],
      ["get", await repository.getParserRun({ identity: crossTenantIdentity })],
      ["complete", await repository.completeParserRunWithProfile({
        identity: crossTenantIdentity,
        parserRunId: "40000000-0000-4000-8000-000000000099",
        profile: { status: "profiled", format: "txt" },
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      })],
      ["fail", await repository.failParserRunSafely({
        identity: crossTenantIdentity,
        parserRunId: "40000000-0000-4000-8000-000000000099",
        errorCode: "safe_parser_error",
        errorMessageSafe: "Deterministic profiling could not safely profile this file.",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      })],
      ["retry", await repository.requeueFailedParserRunForRetry({ identity: crossTenantIdentity, now: NOW, metadataOnlyAudit: audit.dependency })],
    ]) {
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, "not_found", label);
      assert.equal(result.error.status, 404, label);
    }

    assert.equal(await countRuns(), 1);
    assert.equal((await storedRun(ownFileId)).parser_status, "queued");

    const otherTenantOwnWork = await repository.ensureQueuedParserRun({
      identity: identityFor(otherFileId, OTHER_ORG, checksum, fixture.parser),
      now: NOW,
    });
    assert.equal(otherTenantOwnWork.ok, true);
    assert.equal(otherTenantOwnWork.data.replayed, false);
    assert.equal(await countRuns(), 2);
    const otherTenantAudit = await auditRows(otherFileId);
    assert.equal(otherTenantAudit.length, 1);
    assert.equal(otherTenantAudit[0].operation, "parser_run_recorded");
    assert.equal(otherTenantAudit[0].metadata.parser_status, "queued");
  });

  test("P1-03 prevents two workers from claiming the same queued run and leaves independent runs claimable", async () => {
    await resetTables();
    const firstFileId = fileId(6);
    const secondFileId = fileId(7);
    const checksum = checksumFor(6);
    await seedIntakeFile(firstFileId, ORG, checksum);
    await seedIntakeFile(secondFileId, ORG, checksum);
    const firstIdentity = identityFor(firstFileId, ORG, checksum, LOCAL_PARSER);
    const secondIdentity = identityFor(secondFileId, ORG, checksum, LOCAL_PARSER);
    const audit = createAuditProbe();
    assert.equal((await repository.ensureQueuedParserRun({ identity: firstIdentity, now: NOW })).ok, true);
    assert.equal((await repository.ensureQueuedParserRun({ identity: secondIdentity, now: NOW })).ok, true);

    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      const locked = await holder.query(
        `SELECT parser_run_id FROM kai.intake_parser_runs
          WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid FOR UPDATE`,
        [firstIdentity.organizationId, firstIdentity.intakeFileId],
      );
      assert.equal(locked.rowCount, 1);

      const blockedClaim = await repository.claimQueuedParserRun({
        identity: firstIdentity,
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(blockedClaim.ok, false);
      assert.equal(blockedClaim.error.code, "conflict_current_state_changed");
      assert.equal(blockedClaim.error.status, 409);

      const independentClaim = await repository.claimQueuedParserRun({
        identity: secondIdentity,
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(independentClaim.ok, true);
      assert.equal(independentClaim.data.run.parser_status, "running");
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }

    const firstClaim = await repository.claimQueuedParserRun({
      identity: firstIdentity,
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(firstClaim.ok, true);
    assert.equal(firstClaim.data.run.parser_status, "running");

    const doubleClaim = await repository.claimQueuedParserRun({
      identity: firstIdentity,
      now: LATER,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(doubleClaim.ok, false);
    assert.equal(doubleClaim.error.code, "conflict_current_state_changed");
    assert.equal((await storedRun(firstFileId)).parser_status, "running");
  });

  test("P1-03 completes CSV, XLSX, Markdown, TXT, and machine-readable PDF profiling with canonical hashes and metadata-only audit", async () => {
    await resetTables();
    const bytesByObjectVersion = new Map();
    const byteSource = createByteSource(bytesByObjectVersion);
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();
    const cases = [
      ["csv", FIXTURES.csv, 11],
      ["xlsx", FIXTURES.xlsx, 12],
      ["md", FIXTURES.md, 13],
      ["txt", FIXTURES.txt, 14],
      ["pdf", FIXTURES.pdf, 15],
    ];

    for (const [label, fixture, index] of cases) {
      const intakeFileId = fileId(index);
      const checksum = checksumFor(index);
      await seedIntakeFile(intakeFileId, ORG, checksum);
      const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
      bytesByObjectVersion.set(facts.objectVersionId, fixture.bytes);

      const queued = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW });
      assert.equal(queued.ok, true, label);
      assert.equal(queued.data.replayed, false, label);

      const executed = await worker.runQueuedParserProfileWork({
        trustedFileFacts: facts,
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(executed.ok, true, label);
      assert.equal(executed.data.run.parser_status, "completed", label);
      assert.equal(executed.data.run.parser_name, fixture.parser.parserName, label);
      assert.equal(executed.data.run.error_code, null, label);
      assert.ok(executed.data.run.output_profile_id, label);
      assert.equal(executed.data.run.profile.status, "profiled", label);
      assert.match(executed.data.run.profile_canonical_sha256, /^[a-f0-9]{64}$/, label);
      assertNoRawSentinels(executed.data.run);

      const stored = await withClient((client) => client.query(
        `SELECT profile_canonical_sha256,
                encode(digest(profile::text, 'sha256'), 'hex') AS recomputed
           FROM kai.intake_file_profiles
          WHERE intake_file_id = $1::uuid`,
        [intakeFileId],
      ));
      assert.equal(stored.rowCount, 1, label);
      assert.equal(stored.rows[0].profile_canonical_sha256, stored.rows[0].recomputed, label);
      assert.equal(stored.rows[0].profile_canonical_sha256, executed.data.run.profile_canonical_sha256, label);

      const rows = await auditRows(intakeFileId);
      assert.deepEqual(
        [...new Set(rows.map((row) => row.operation))].sort(),
        ["file_profile_persisted", "parser_run_recorded"],
        label,
      );
      for (const row of rows) {
        assert.equal(row.outcome, "success", label);
        assert.equal(row.from_state, row.to_state, label);
        assert.equal(row.metadata.metadata_only, true, label);
        assert.equal(row.metadata.contract, "p1_parser_run_and_file_profile_v1", label);
        assert.equal(row.metadata.checksum_bound, true, label);
        assert.equal(row.metadata.validator_key, "VAL-KAI-P1-02-001", label);
        assert.equal(Object.hasOwn(row.metadata, "checksum"), false, label);
        assert.equal(Object.hasOwn(row.metadata, "profile"), false, label);
        assert.deepEqual(
          Object.keys(row.metadata).sort(),
          row.operation === "parser_run_recorded" ? PARSER_RUN_AUDIT_KEYS : FILE_PROFILE_AUDIT_KEYS,
          label,
        );
        assertNoRawSentinels(row.metadata);
      }
    }

    const persisted = await withClient((client) => client.query(
      "SELECT profile::text AS profile_text FROM kai.intake_file_profiles",
    ));
    assert.equal(persisted.rowCount, 5);
    for (const row of persisted.rows) {
      assertNoRawSentinels(row.profile_text);
    }
  });

  test("P1-03 records a safe failure for a non-profilable PDF with no partial profile", async () => {
    await resetTables();
    const intakeFileId = fileId(16);
    const checksum = checksumFor(16);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.pdfImageOnly;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const byteSource = createByteSource(new Map([[facts.objectVersionId, fixture.bytes]]));
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();

    assert.equal((await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW })).ok, true);
    const failed = await worker.runQueuedParserProfileWork({
      trustedFileFacts: facts,
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(failed.ok, true);
    assert.equal(failed.data.run.parser_status, "failed");
    assert.equal(failed.data.run.retry_count, 1);
    assert.equal(failed.data.run.output_profile_id, null);
    assert.equal(failed.data.run.profile, null);
    assert.equal(failed.data.run.profile_canonical_sha256, null);
    assert.match(failed.data.run.error_code, /^[a-z0-9_]{1,64}$/);
    assert.equal(failed.data.run.error_code, "pdf_no_extractable_text");
    assert.ok(failed.data.run.error_message_safe.length >= 1);
    assertNoRawSentinels(failed.data.run);
    assert.equal(await countProfiles(intakeFileId), 0);

    const rows = await auditRows(intakeFileId);
    assert.deepEqual([...new Set(rows.map((row) => row.operation))], ["parser_run_recorded"]);
    assert.equal(rows.at(-1).metadata.parser_status, "failed");
    assert.equal(rows.at(-1).metadata.retry_count, 1);
  });

  test("P1-03 rolls back every completion domain write when the required metadata-only audit fails", async () => {
    await resetTables();
    const intakeFileId = fileId(17);
    const checksum = checksumFor(17);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const identity = identityFor(intakeFileId, ORG, checksum, LOCAL_PARSER);
    const successAudit = createAuditProbe();
    assert.equal((await repository.ensureQueuedParserRun({ identity, now: NOW })).ok, true);
    const claimed = await repository.claimQueuedParserRun({ identity, now: NOW, metadataOnlyAudit: successAudit.dependency });
    assert.equal(claimed.ok, true);
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    for (const [label, probe, expectedCode] of [
      ["rejected_guard", createAuditProbe({ prepareOk: false }), "validation_blocker"],
      ["publish_sync_throw", createAuditProbe({ publishThrows: true }), "system_error"],
      ["publish_promise_rejection", createAuditProbe({ publishRejects: true }), "system_error"],
    ]) {
      const result = await repository.completeParserRunWithProfile({
        identity,
        parserRunId: claimed.data.run.parser_run_id,
        profile: { status: "profiled", format: "txt", counts: { line_count: 1 } },
        now: NOW,
        metadataOnlyAudit: probe.dependency,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, expectedCode, label);
      assert.equal(await countProfiles(intakeFileId), 0, label);
      const stored = await storedRun(intakeFileId);
      assert.equal(stored.parser_status, "running", label);
      assert.equal(stored.output_profile_id, null, label);
      assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore, label);
      assert.deepEqual(probe.published, [], label);
    }

    const committed = await repository.completeParserRunWithProfile({
      identity,
      parserRunId: claimed.data.run.parser_run_id,
      profile: { status: "profiled", format: "txt", counts: { line_count: 1 } },
      now: NOW,
      metadataOnlyAudit: successAudit.dependency,
    });
    assert.equal(committed.ok, true);
    assert.equal(await countProfiles(intakeFileId), 1);
    assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore + 2);
  });

  test("P1-03 rolls back the safe-failure transition when the required failure audit fails", async () => {
    await resetTables();
    const intakeFileId = fileId(18);
    const checksum = checksumFor(18);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const identity = identityFor(intakeFileId, ORG, checksum, LOCAL_PARSER);
    const successAudit = createAuditProbe();
    assert.equal((await repository.ensureQueuedParserRun({ identity, now: NOW })).ok, true);
    const claimed = await repository.claimQueuedParserRun({ identity, now: NOW, metadataOnlyAudit: successAudit.dependency });
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    for (const [label, probe, expectedCode] of [
      ["rejected_guard", createAuditProbe({ prepareOk: false }), "validation_blocker"],
      ["publish_sync_throw", createAuditProbe({ publishThrows: true }), "system_error"],
      ["publish_promise_rejection", createAuditProbe({ publishRejects: true }), "system_error"],
    ]) {
      const result = await repository.failParserRunSafely({
        identity,
        parserRunId: claimed.data.run.parser_run_id,
        errorCode: "safe_parser_error",
        errorMessageSafe: "Deterministic profiling could not safely profile this file.",
        now: NOW,
        metadataOnlyAudit: probe.dependency,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, expectedCode, label);
      const stored = await storedRun(intakeFileId);
      assert.equal(stored.parser_status, "running", label);
      assert.equal(stored.retry_count, 0, label);
      assert.equal(stored.error_code, null, label);
      assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore, label);
      assert.deepEqual(probe.published, [], label);
    }
  });

  test("P1-03 rolls back the claim transition when the required claim audit fails", async () => {
    await resetTables();
    const intakeFileId = fileId(23);
    const checksum = checksumFor(23);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const identity = identityFor(intakeFileId, ORG, checksum, LOCAL_PARSER);
    const successAudit = createAuditProbe();
    assert.equal((await repository.ensureQueuedParserRun({ identity, now: NOW })).ok, true);
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    for (const [label, probe, expectedCode] of [
      ["rejected_guard", createAuditProbe({ prepareOk: false }), "validation_blocker"],
      ["publish_sync_throw", createAuditProbe({ publishThrows: true }), "system_error"],
      ["publish_promise_rejection", createAuditProbe({ publishRejects: true }), "system_error"],
    ]) {
      const result = await repository.claimQueuedParserRun({
        identity,
        now: NOW,
        metadataOnlyAudit: probe.dependency,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, expectedCode, label);
      const stored = await storedRun(intakeFileId);
      assert.equal(stored.parser_status, "queued", label);
      assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore, label);
      assert.deepEqual(probe.published, [], label);
    }

    const claimed = await repository.claimQueuedParserRun({ identity, now: NOW, metadataOnlyAudit: successAudit.dependency });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.data.run.parser_status, "running");
    assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore + 1);
  });

  test("P1-03 rolls back the retry requeue transition when the required requeue audit fails", async () => {
    await resetTables();
    const intakeFileId = fileId(24);
    const checksum = checksumFor(24);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const identity = identityFor(intakeFileId, ORG, checksum, LOCAL_PARSER);
    const successAudit = createAuditProbe();
    assert.equal((await repository.ensureQueuedParserRun({ identity, now: NOW })).ok, true);
    const claimed = await repository.claimQueuedParserRun({ identity, now: NOW, metadataOnlyAudit: successAudit.dependency });
    assert.equal(claimed.ok, true);
    const failed = await repository.failParserRunSafely({
      identity,
      parserRunId: claimed.data.run.parser_run_id,
      errorCode: "safe_parser_error",
      errorMessageSafe: "Deterministic profiling could not safely profile this file.",
      now: NOW,
      metadataOnlyAudit: successAudit.dependency,
    });
    assert.equal(failed.ok, true);
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    for (const [label, probe, expectedCode] of [
      ["rejected_guard", createAuditProbe({ prepareOk: false }), "validation_blocker"],
      ["publish_sync_throw", createAuditProbe({ publishThrows: true }), "system_error"],
      ["publish_promise_rejection", createAuditProbe({ publishRejects: true }), "system_error"],
    ]) {
      const result = await repository.requeueFailedParserRunForRetry({
        identity,
        now: LATER,
        metadataOnlyAudit: probe.dependency,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, expectedCode, label);
      const stored = await storedRun(intakeFileId);
      assert.equal(stored.parser_status, "failed", label);
      assert.equal(stored.retry_count, 1, label);
      assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore, label);
      assert.deepEqual(probe.published, [], label);
    }

    const requeued = await repository.requeueFailedParserRunForRetry({
      identity,
      now: LATER,
      metadataOnlyAudit: successAudit.dependency,
    });
    assert.equal(requeued.ok, true);
    assert.equal(requeued.data.run.parser_status, "queued");
    assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore + 1);
  });

  test("P1-03 increments retry_count exactly once per safe failure, retries below three, refuses execution at three, and derives manual review", async () => {
    await resetTables();
    const intakeFileId = fileId(19);
    const checksum = checksumFor(19);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.txt;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const byteSource = createByteSource(new Map(), { failAll: true });
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();

    assert.equal((await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW })).ok, true);
    const first = await worker.runQueuedParserProfileWork({
      trustedFileFacts: facts,
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.run.parser_status, "failed");
    assert.equal(first.data.run.retry_count, 1);
    assert.equal(first.data.run.error_code, "byte_source_unavailable");
    assert.equal(first.data.run.requires_manual_review, false);

    for (const expectedRetryCount of [2, 3]) {
      const retried = await worker.retryParserProfileWork({
        trustedFileFacts: facts,
        now: LATER,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(retried.ok, true);
      assert.equal(retried.data.run.parser_status, "failed");
      assert.equal(retried.data.run.retry_count, expectedRetryCount);
    }

    const atCap = await storedRun(intakeFileId);
    assert.equal(atCap.retry_count, 3);
    const readsBefore = byteSource.reads.length;
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    const blockedRetry = await worker.retryParserProfileWork({
      trustedFileFacts: facts,
      now: LATER,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(blockedRetry.ok, true);
    assert.equal(blockedRetry.data.requires_manual_review, true);
    assert.equal(blockedRetry.data.requeued, false);
    assert.equal(blockedRetry.data.run.parser_status, "failed");
    assert.equal(blockedRetry.data.run.retry_count, 3);
    assert.equal(blockedRetry.data.run.requires_manual_review, true);
    assert.equal(byteSource.reads.length, readsBefore);
    assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore);
    assert.equal((await storedRun(intakeFileId)).retry_count, 3);
    assert.equal(await countProfiles(intakeFileId), 0);

    const columns = await withClient((client) => client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs'
          AND column_name IN ('requires_manual_review', 'manual_review_required')`,
    ));
    assert.equal(columns.rowCount, 0);
  });

  test("P1-03 never claims or retries a cancelled run", async () => {
    await resetTables();
    const intakeFileId = fileId(20);
    const checksum = checksumFor(20);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.txt;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const identity = identityFor(intakeFileId, ORG, checksum, fixture.parser);
    const byteSource = createByteSource(new Map([[facts.objectVersionId, fixture.bytes]]));
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();

    assert.equal((await repository.ensureQueuedParserRun({ identity, now: NOW })).ok, true);
    await withClient((client) => client.query(
      `UPDATE kai.intake_parser_runs
          SET parser_status = 'cancelled', completed_at = $2::timestamptz
        WHERE intake_file_id = $1::uuid`,
      [intakeFileId, NOW],
    ));
    const auditRowsBefore = (await auditRows(intakeFileId)).length;

    const claim = await worker.runQueuedParserProfileWork({
      trustedFileFacts: facts,
      now: LATER,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(claim.ok, false);
    assert.equal(claim.error.code, "conflict_current_state_changed");

    const retry = await worker.retryParserProfileWork({
      trustedFileFacts: facts,
      now: LATER,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(retry.ok, false);
    assert.equal(retry.error.code, "state_transition_denied");
    assert.equal(retry.error.status, 422);

    const replay = await worker.queueParserProfileWork({ trustedFileFacts: facts, now: LATER });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.run.parser_status, "cancelled");

    assert.deepEqual(byteSource.reads, []);
    assert.equal((await auditRows(intakeFileId)).length, auditRowsBefore);
    assert.equal((await storedRun(intakeFileId)).parser_status, "cancelled");
    assert.equal(await countRuns(), 1);
  });

  test("P1-03 disabled KAI_SPRINT2_ENABLED performs zero claims, writes, byte reads, or audit writes against the database", async () => {
    await resetTables();
    const intakeFileId = fileId(21);
    const checksum = checksumFor(21);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.txt;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const byteSource = createByteSource(new Map([[facts.objectVersionId, fixture.bytes]]));
    const worker = createWorker(byteSource.dependency, { enabled: false });
    const audit = createAuditProbe();

    for (const result of [
      await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW }),
      await worker.runQueuedParserProfileWork({ trustedFileFacts: facts, now: NOW, metadataOnlyAudit: audit.dependency }),
      await worker.retryParserProfileWork({ trustedFileFacts: facts, now: NOW, metadataOnlyAudit: audit.dependency }),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "feature_disabled");
      assert.equal(result.error.status, 403);
    }

    assert.equal(await countRuns(), 0);
    assert.equal(await countProfiles(intakeFileId), 0);
    assert.equal((await auditRows(intakeFileId)).length, 0);
    assert.deepEqual(byteSource.reads, []);
    assert.deepEqual(audit.prepared, []);
  });

  test("P1-03 creates no record outside the two authorized P1-02 tables and the existing audit table", async () => {
    await resetTables();
    const intakeFileId = fileId(22);
    const checksum = checksumFor(22);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const fixture = FIXTURES.csv;
    const facts = trustedFileFacts(intakeFileId, ORG, checksum, fixture);
    const byteSource = createByteSource(new Map([[facts.objectVersionId, fixture.bytes]]));
    const worker = createWorker(byteSource.dependency);
    const audit = createAuditProbe();

    assert.equal((await worker.queueParserProfileWork({ trustedFileFacts: facts, now: NOW })).ok, true);
    assert.equal((await worker.runQueuedParserProfileWork({
      trustedFileFacts: facts,
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    })).ok, true);

    const tables = await withClient((client) => client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' ORDER BY table_name`,
    ));
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "intake_file_profiles",
      "intake_files",
      "intake_parser_runs",
      "upload_lifecycle_audit",
      "upload_policy_decision_replay",
    ]);

    const replayRows = await withClient((client) => client.query(
      "SELECT count(*)::int AS n FROM kai.upload_policy_decision_replay",
    ));
    assert.equal(Number(replayRows.rows[0].n), 0);

    const fileState = await withClient((client) => client.query(
      `SELECT upload_state, file_policy_status, parse_status, processing_status
         FROM kai.intake_files WHERE intake_file_id = $1::uuid`,
      [intakeFileId],
    ));
    assert.equal(fileState.rows[0].file_policy_status, "pending");
    assert.equal(fileState.rows[0].parse_status, "quarantined");
    assert.equal(fileState.rows[0].processing_status, "quarantined");
  });
}
