import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  runPdfAssessorWorkerBoundary,
  runPdfProfilingWorkerBoundary,
  __testables as pdfWorkerBoundaryTestables,
} from "../Backend/kai/validators/pdfAssessorWorkerBoundary.js";
import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";

const PDF_MIME = "application/pdf";
const RAW_SENTINELS = Object.freeze([
  "PDF visible text",
  "later page text",
  "encrypted synthetic text",
  "secret client content",
  "DependencyInternalError",
  "correct horse battery staple",
  "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf",
]);
const ENCRYPTED_SYNTHETIC_PDF_BASE64 = [
  "JVBERi0xLjQKJcK1wrYKJSBXcml0dGVuIGJ5IE11UERGIDEuMjguMAoKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKCjIgMCBvYmoKPDwvVHlwZS9QYWdlcy9LaWRzWzQgMCBSXS9Db3VudCAxPj4KZW5kb2JqCgozIDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgMyAwIFI+Pj4+L0NvbnRlbnRzIDUgMCBSPj4KZW5kb2JqCgo1IDAgb2JqCjw8L0xlbmd0aCA4MC9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KiVx/0wAIUzbrYTYrhKdxveLS62DyCuNhfmbYvFE0VYdQ82ES3QQ0F73DQMhhyp2mRjaGyCm7DyT581CA8oZ0VYeXe+L9p4+AGtp8eHEmv0gKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDQyIDAwMDAwIG4gCjAwMDAwMDAwODggMDAwMDAgbiAKMDAwMDAwMDE0MCAwMDAwMCBuIAowMDAwMDAwMjA0IDAwMDAwIG4gCjAwMDAwMDAzMTcgMDAwMDAgbiAKCnRyYWlsZXIKPDwvU2l6ZSA2L1Jvb3QgMSAwIFIvSURbPDgyN0I3MzBGQURENURBOTVERjNFNDAwQUY4MEVFQTlDPjxCOERCNTEzMzRFM0NCQTA0N0ZBODczNDM2RjdDQUJGNT5dL0VuY3J5cHQ8PC9GaWx0ZXIvU3RhbmRhcmQvUiA2L1YgNS9MZW5ndGggMjU2L1AgLTQvRW5jcnlwdE1ldGFkYXRhIHRydWUvU3RtRi9TdGRDRi9TdHJGL1N0ZENGL0NGPDwvU3RkQ0Y8PC9BdXRoRXZlbnQvRG9jT3Blbi9DRk0vQUVTVjMvTGVuZ3RoIDMyPj4+Pi9PPEIwRjgxRkMyRkM1REIwNUY1NkYzMjA2NDcxMTU0MDM4NDJCQjFFNjlCM0UwQzdDQ0NDNkVFNTEwM0Q4QkUxMDU0MjYxMTBDRTUxNzZGNENDQUExRjcxRTRDQzA5QTBCRD4vVTwyNzBFQkYxNkJFNDcyNDZFMkNDOTdGODg5NzVCNEUwQ0FCRTVENDJGM0IwQTc3NkM2ODQ0RThBRUQ2RkRGNkQyREU2OUI0NjhDNzEwMTgzRTNGNDY1QjY4RkYzMzJEMzQ+L09FPEQzOEE2Rjg2QUE3NDRBRTcyQ0IyN0QzNjI5QjE3MTc2NEIyNjA5ODA1QzAyMzNDQThDRTA3N0FENzAyNkEzRkU+L1VFPEExMjNDRkY0QkRCRDg1ODhGRjdEODBFQjJBQ0REMjRDMDlBMTUzMTdGMjMyNDgxMUQ3RkMzNjk4RENGRjNFNjA+L1Blcm1zPDYyNzVGMzc3M0M1NkZCQ0JDODQ4MTlEMUE5RTQzOTEzPj4+Pj4Kc3RhcnR4cmVmCjQ2NQolJUVPRgo=",
].join("");

function encodeAscii(text) {
  return new TextEncoder().encode(text);
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function escapePdfLiteralString(text) {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

function syntheticPdfBytesForPages(pages, { decoyCount = null } = {}) {
  const header = "%PDF-1.4\n";
  const needsFont = pages.some((page) => Object.hasOwn(page, "text"));
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");

  let nextObjectId = 3;
  const fontObjectId = needsFont ? nextObjectId++ : null;
  const pageObjects = pages.map((page) => {
    const pageObject = {
      pageObjectId: nextObjectId++,
      contentObjectId: nextObjectId++,
      imageObjectId: null,
    };
    if (page.image === true) {
      pageObject.imageObjectId = nextObjectId++;
    }
    return pageObject;
  });

  objects.push(
    `<< /Type /Pages /Kids [${pageObjects.map(({ pageObjectId }) => `${pageObjectId} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  if (needsFont) {
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    let content = "";
    if (Object.hasOwn(page, "text")) {
      content = `BT /F1 12 Tf 20 100 Td (${escapePdfLiteralString(page.text)}) Tj ET`;
    } else if (page.image === true) {
      content = "q 10 0 0 10 0 0 cm /Im1 Do Q";
    }

    const resources = [];
    if (needsFont) resources.push(`/Font << /F1 ${fontObjectId} 0 R >>`);
    if (page.image === true) resources.push(`/XObject << /Im1 ${pageObjects[index].imageObjectId} 0 R >>`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << ${resources.join(" ")} >> /Contents ${pageObjects[index].contentObjectId} 0 R >>`);
    objects.push(`<< /Length ${encodeAscii(content).byteLength} >>\nstream\n${content}\nendstream`);
    if (page.image === true) {
      objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream");
    }
  }
  if (decoyCount !== null) {
    objects.push(`<< /Decoy true /Count ${decoyCount} >>`);
  }

  const offsets = [0];
  const parts = [encodeAscii(header)];
  let byteOffset = parts[0].byteLength;
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
    offsets.push(byteOffset);
    const objectBytes = encodeAscii(`${objectIndex + 1} 0 obj\n${objects[objectIndex]}\nendobj\n`);
    parts.push(objectBytes);
    byteOffset += objectBytes.byteLength;
  }

  const xrefOffset = byteOffset;
  parts.push(encodeAscii([
    `xref\n0 ${objects.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("")));
  return concatBytes(parts);
}

async function profilePdf(bytes) {
  return await runPdfProfilingWorkerBoundary({
    extension: ".pdf",
    declaredMime: PDF_MIME,
    byteSize: bytes.byteLength,
    bytes,
  });
}

function assertNoRawSentinels(result) {
  const serialized = JSON.stringify(result);
  for (const sentinel of RAW_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /\/Users\/|correct horse|prompt|previous instructions|extractedText|rawContent/i);
}

function snapshotRelevantTmpEntries() {
  return readdirSync(tmpdir()).filter((entry) => /kai-pdf-profile|mupdf-profile/i.test(entry)).sort();
}

test("P1-01B worker-backed PDF profiling returns page count from MuPDF and redacted structural shapes", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const bytes = syntheticPdfBytesForPages([
    { text: "PDF visible text" },
    { text: "later page text" },
  ], { decoyCount: 999 });

  const beforeTmp = snapshotRelevantTmpEntries();
  const result = await profilePdf(Buffer.from(bytes));
  const afterTmp = snapshotRelevantTmpEntries();

  assert.equal(result.status, "profiled");
  assert.equal(result.format, "pdf");
  assert.equal(result.counts.page_count, 2);
  assert.notEqual(result.counts.page_count, 999);
  assert.equal(result.structural_metadata.page_count_source, "mupdf_worker");
  assert.equal(result.structural_metadata.extractable_text_source, "mupdf_structured_text_worker");
  assert.equal(result.structural_metadata.extractable_text_confirmed, true);
  assert.equal(result.structural_metadata.ocr_performed, false);
  assert.equal(result.counts.extractable_text_page_count, 2);
  assert.ok(result.counts.non_whitespace_character_count > 0);
  assert.equal(result.section_shapes.length, 2);
  assert.equal(result.section_shapes[0].redacted, true);
  assert.equal(result.block_shapes.every((block) => block.redacted === true), true);
  assert.equal(result.trusted_metadata.byte_size, bytes.byteLength);
  assert.deepEqual(beforeTmp, afterTmp);
  assertNoRawSentinels(result);
  assert.deepEqual(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState(), {
    active: 0,
    maxObserved: 1,
    configuredMaximum: 1,
  });
});

test("P1-01B worker-backed PDF profiling rejects encrypted and image-only PDFs without partial profiles", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const encryptedBytes = Buffer.from(ENCRYPTED_SYNTHETIC_PDF_BASE64, "base64");
  const encrypted = await profilePdf(encryptedBytes);
  assert.equal(encrypted.status, "not_profilable");
  assert.equal(encrypted.reason, "encrypted_or_password_protected");
  assert.equal(encrypted.counts, undefined);
  assert.equal(encrypted.section_shapes, undefined);
  assertNoRawSentinels(encrypted);

  const imageOnly = await profilePdf(Buffer.from(syntheticPdfBytesForPages([{ image: true }])));
  assert.equal(imageOnly.status, "not_profilable");
  assert.equal(imageOnly.reason, "pdf_no_extractable_text");
  assert.equal(imageOnly.counts, undefined);
  assert.equal(imageOnly.block_shapes, undefined);
  assertNoRawSentinels(imageOnly);
});

test("P1-01B malformed PDFs and malformed worker results fail safely with cleanup and no raw content", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const repairedBytes = Buffer.from(
    new TextDecoder().decode(syntheticPdfBytesForPages([{ text: "secret client content" }]))
      .replace(/startxref\n\d+\n%%EOF\n$/, "startxref\n0\n%%EOF\n"),
  );
  const beforeTmp = snapshotRelevantTmpEntries();
  const malformed = await profilePdf(repairedBytes);
  const afterTmp = snapshotRelevantTmpEntries();
  assert.equal(malformed.status, "failed");
  assert.equal(malformed.error.category, "pdf_profile_worker_failed");
  assert.equal(malformed.counts, undefined);
  assert.deepEqual(beforeTmp, afterTmp);
  assertNoRawSentinels(malformed);

  const badWorker = await pdfWorkerBoundaryTestables.runPdfProfilingWorkerBoundaryWithTestControls(
    {
      extension: ".pdf",
      declaredMime: PDF_MIME,
      byteSize: repairedBytes.byteLength,
      bytes: repairedBytes,
    },
    {
      createWorker() {
        return {
          on(event, handler) {
            if (event === "message") {
              queueMicrotask(() => handler({
                type: "kai_pdf_profile_worker_ok",
                profile: {
                  status: "profiled",
                  format: "pdf",
                  rawContent: "secret client content",
                },
              }));
            }
            return this;
          },
          off() {},
          async terminate() {},
        };
      },
    },
  );
  assert.equal(badWorker.status, "failed");
  assert.equal(badWorker.error.category, "pdf_profile_worker_failed");
  assertNoRawSentinels(badWorker);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P1-01B pure kernel PDF behavior and P0 PDF security acceptance are unchanged", async () => {
  const pdfBytes = syntheticPdfBytesForPages([{ text: "PDF visible text" }]);
  const pure = await profileLocalTrustedFile({
    extension: ".pdf",
    declaredMime: PDF_MIME,
    byteSize: pdfBytes.byteLength,
    bytes: pdfBytes,
  });
  assert.equal(pure.status, "not_profilable");
  assert.equal(pure.reason, "structural_pdf_profiling_requires_separately_governed_worker_boundary");
  assert.equal(pure.counts, undefined);
  assert.equal(pure.structural_metadata, undefined);

  assert.equal(await runPdfAssessorWorkerBoundary(Buffer.from(pdfBytes)), undefined);
  assert.deepEqual(
    await runPdfAssessorWorkerBoundary(Buffer.from(syntheticPdfBytesForPages([{ image: true }]))),
    { policy: "block", category: "pdf_no_extractable_text" },
  );
});

test("P1-01B PDF profiling boundary introduces no prohibited dependencies or OCR", () => {
  const boundarySource = readFileSync("Backend/kai/validators/pdfAssessorWorkerBoundary.js", "utf8");
  const workerSource = readFileSync("Backend/kai/validators/pdfAssessorWorkerThread.js", "utf8");
  const kernelSource = readFileSync("Backend/kai/profiling/localProfilingKernel.js", "utf8");

  assert.doesNotMatch(kernelSource, /runPdfProfilingWorkerBoundary|node:worker_threads|mupdf|performOcr|runOcr/i);
  assert.doesNotMatch(`${boundarySource}\n${workerSource}`, /\b(?:pg|express|Router|listen|multer|storage|queue|enqueue|lifecycle|source_candidate|source_version|evidence|claim|openai|anthropic|performOcr|runOcr|tesseract|ocr)\b/i);
  assert.doesNotMatch(workerSource, /\.asText\s*\(|\.asJSON\s*\(|\.copy\s*\(/);
  assert.doesNotMatch(`${boundarySource}\n${workerSource}`, /\b(?:mkdtemp|writeFile|appendFile|createWriteStream|rm|unlink)\b/);
});
