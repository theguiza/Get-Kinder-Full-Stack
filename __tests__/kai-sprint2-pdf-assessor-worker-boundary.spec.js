import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";

import {
  MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS,
  PDF_ASSESSOR_PARENT_TIMEOUT_MS,
  PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES,
  runPdfAssessorWorkerBoundary,
  __testables as pdfWorkerBoundaryTestables,
} from "../Backend/kai/validators/pdfAssessorWorkerBoundary.js";
import {
  assessOpenedPdfDocument,
  detectPdfActiveOrEmbeddedContent,
  detectPdfExtractableText,
  detectPdfEncryptionPassword,
} from "../Backend/kai/validators/pdfAssessorWorkerThread.js";

const mainSource = readFileSync("Backend/kai/validators/pdfAssessorWorkerBoundary.js", "utf8");
const workerSource = readFileSync("Backend/kai/validators/pdfAssessorWorkerThread.js", "utf8");
const protectedPdfResult = Object.freeze({
  policy: "block",
  category: "encrypted_or_password_protected",
});
const noExtractableTextPdfResult = Object.freeze({
  policy: "block",
  category: "pdf_no_extractable_text",
});
const activeOrEmbeddedPdfResult = Object.freeze({
  policy: "block",
  category: "pdf_active_or_embedded_content",
});
const fakeDocumentConstructor = Object.freeze({
  META_ENCRYPTION: "encryption",
});

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

function syntheticPdfBytesForPages(pages) {
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
    `<< /Type /Pages /Kids [${pageObjects
      .map(({ pageObjectId }) => `${pageObjectId} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
  );

  if (needsFont) {
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  }

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    let content = "";
    if (Object.hasOwn(page, "text")) {
      content = `BT /F1 12 Tf 20 100 Td (${escapePdfLiteralString(page.text)}) Tj ET`;
    } else if (page.graphics === true) {
      content = "q 0 0 10 10 re f Q";
    } else if (page.image === true) {
      content = "q 10 0 0 10 0 0 cm /Im1 Do Q";
    }

    const resourceEntries = [];
    if (needsFont) {
      resourceEntries.push(`/Font << /F1 ${fontObjectId} 0 R >>`);
    }
    if (page.image === true) {
      resourceEntries.push(`/XObject << /Im1 ${pageObjects[index].imageObjectId} 0 R >>`);
    }
    const resources = `/Resources << ${resourceEntries.join(" ")} >>`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] ${resources} /Contents ${pageObjects[index].contentObjectId} 0 R >>`,
    );
    objects.push(`<< /Length ${encodeAscii(content).byteLength} >>\nstream\n${content}\nendstream`);
    if (page.image === true) {
      const imageData = "FF0000>";
      objects.push([
        `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${imageData.length} >>`,
        "stream",
        imageData,
        "endstream",
      ].join("\n"));
    }
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

function syntheticPdfBytes() {
  return syntheticPdfBytesForPages([{}]);
}

function syntheticTextPdfBytes(text = "synthetic extractable text") {
  return syntheticPdfBytesForPages([{ text }]);
}

function syntheticLaterPageTextPdfBytes() {
  return syntheticPdfBytesForPages([{}, { text: "later page text" }]);
}

function syntheticWhitespaceOnlyPdfBytes() {
  return syntheticPdfBytesForPages([{ text: "       " }]);
}

function syntheticGraphicsOnlyPdfBytes() {
  return syntheticPdfBytesForPages([{ graphics: true }]);
}

function syntheticImageOnlyPdfBytes() {
  return syntheticPdfBytesForPages([{ image: true }]);
}

function syntheticInvalidButMupdfRepairedPdfBytes() {
  const text = new TextDecoder().decode(syntheticTextPdfBytes("repaired text layer remains only text evidence"));
  return encodeAscii(text.replace(/startxref\n\d+\n%%EOF\n$/, "startxref\n0\n%%EOF\n"));
}

function syntheticTextPdfBytesWithObjectExtras({
  catalogExtra = "",
  pageExtra = "",
  annotationObjects = [],
  extraObjects = [],
} = {}) {
  const text = "synthetic extractable text";
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  return syntheticPdfBytesFromObjects([
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R ${pageExtra} >>`,
    `<< /Length ${encodeAscii(content).byteLength} >>\nstream\n${content}\nendstream`,
    ...annotationObjects,
    ...extraObjects,
  ]);
}

function syntheticPdfBytesFromObjects(objects) {
  const header = "%PDF-1.4\n";
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

function linkAnnotationPdfBytes(annotationObject) {
  return syntheticTextPdfBytesWithObjectExtras({
    pageExtra: "/Annots [6 0 R]",
    annotationObjects: [annotationObject],
  });
}

class SyntheticWorker extends EventEmitter {
  constructor() {
    super();
    this.terminateCalls = 0;
    this.terminateResolve = null;
  }

  terminate() {
    this.terminateCalls += 1;
    return new Promise((resolve) => {
      this.terminateResolve = () => {
        this.emit("exit", 1);
        resolve(1);
      };
    });
  }

  finishTermination() {
    this.terminateResolve?.();
  }
}

function assertReadableAndUnchanged(input, expectedBytes) {
  assert.equal(input.byteLength, expectedBytes.byteLength);
  assert.deepEqual(Array.from(input), Array.from(expectedBytes));
  assert.equal(input[0], expectedBytes[0]);
  assert.deepEqual(Array.from(input.slice(0, input.byteLength)), Array.from(expectedBytes));
}

function ownershipInputs() {
  const visible = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];

  const allocatedBuffer = Buffer.alloc(visible.length);
  allocatedBuffer.set(visible);

  const fromBuffer = Buffer.from(visible);

  const standaloneUint8Array = new Uint8Array(visible);

  const bufferSubviewBacking = Buffer.from([
    0xa1,
    0xa2,
    0xa3,
    ...visible,
    0xb1,
    0xb2,
    0xb3,
  ]);
  const bufferSubview = bufferSubviewBacking.subarray(3, 3 + visible.length);
  assert.notEqual(bufferSubview.byteOffset, 0);

  const uint8ArraySubviewBacking = new Uint8Array([
    0xc1,
    0xc2,
    0xc3,
    0xc4,
    ...visible,
    0xd1,
    0xd2,
    0xd3,
    0xd4,
  ]);
  const uint8ArraySubview = uint8ArraySubviewBacking.subarray(4, 4 + visible.length);
  assert.notEqual(uint8ArraySubview.byteOffset, 0);

  return [
    {
      name: "Buffer.alloc",
      input: allocatedBuffer,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "Buffer.from",
      input: fromBuffer,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "standalone Uint8Array",
      input: standaloneUint8Array,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [],
    },
    {
      name: "Buffer subview with non-zero byteOffset",
      input: bufferSubview,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [0xa1, 0xa2, 0xa3, 0xb1, 0xb2, 0xb3],
    },
    {
      name: "Uint8Array subview with non-zero byteOffset",
      input: uint8ArraySubview,
      expectedBytes: Uint8Array.from(visible),
      forbiddenAdjacentBytes: [0xc1, 0xc2, 0xc3, 0xc4, 0xd1, 0xd2, 0xd3, 0xd4],
    },
  ];
}

function fakePdfDocument({
  needsPassword = false,
  encryptionMetadata = "None",
  authenticatePassword = () => {
    throw new Error("authenticatePassword must not be called");
  },
} = {}) {
  return {
    authenticatePassword,
    getMetaData(key) {
      assert.equal(key, "encryption");
      if (encryptionMetadata instanceof Error) {
        throw encryptionMetadata;
      }
      return encryptionMetadata;
    },
    needsPassword() {
      if (needsPassword instanceof Error) {
        throw needsPassword;
      }
      return needsPassword;
    },
  };
}

function fakeExtractableTextDocument(pages) {
  return {
    countPages() {
      return pages.length;
    },
    loadPage(index) {
      return pages[index];
    },
  };
}

function fakeStructuredTextPage(characters, {
  onCharThrows = null,
  characterOverride = undefined,
  useCharacterOverride = false,
} = {}) {
  return {
    destroyed: false,
    toStructuredText() {
      return {
        destroyed: false,
        walk(walker) {
          for (const character of characters) {
            if (onCharThrows) {
              throw onCharThrows;
            }
            walker.onChar?.(useCharacterOverride ? characterOverride : character);
          }
        },
        destroy() {
          this.destroyed = true;
        },
      };
    },
    destroy() {
      this.destroyed = true;
    },
  };
}

function assertProtectedResult(result) {
  assert.deepEqual(result, protectedPdfResult);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.equal(Object.hasOwn(result, "scope"), false);
  assert.equal(Object.hasOwn(result, "evidence"), false);
  assert.equal(Object.hasOwn(result, "metadata"), false);
  assert.equal(Object.hasOwn(result, "identifier"), false);
}

function assertNoExtractableTextResult(result) {
  assert.deepEqual(result, noExtractableTextPdfResult);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  assert.equal(Object.hasOwn(result, "scope"), false);
  assert.equal(Object.hasOwn(result, "evidence"), false);
  assert.equal(Object.hasOwn(result, "metadata"), false);
  assert.equal(Object.hasOwn(result, "identifier"), false);
}

function assertActiveOrEmbeddedResult(result) {
  assert.deepEqual(result, activeOrEmbeddedPdfResult);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
  for (const forbiddenKey of [
    "scope",
    "evidence",
    "metadata",
    "identifier",
    "url",
    "uri",
    "destination",
    "filename",
    "attachment",
    "script",
    "object",
    "path",
    "stack",
  ]) {
    assert.equal(Object.hasOwn(result, forbiddenKey), false, forbiddenKey);
  }
}

async function assertBoundaryRejectsSanitized(workerMessage) {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
  });

  worker.emit("message", workerMessage);
  worker.finishTermination();

  let error = null;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }

  assert.match(String(error?.message), /PDF assessor worker failed\./);
  const text = String(error?.stack ?? error?.message ?? error);
  for (const forbidden of [
    "secret client content",
    "secret extractable client content",
    "correct horse battery staple",
    "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf",
    "synthetic-file-id-123",
    "DependencyInternalError",
    "at dependency",
    "https://secret.example.invalid",
    "secret-file-name.txt",
    "[4 0 R /Fit]",
    "<< /S /Launch >>",
    "secret script content",
    "%PDF",
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
}

function assertFreshVisibleRangeCopy({ input, transferredBytes, expectedBytes, forbiddenAdjacentBytes }) {
  assert.ok(transferredBytes instanceof Uint8Array);
  assert.equal(transferredBytes.buffer === input.buffer, false);
  assert.equal(transferredBytes.byteOffset, 0);
  assert.equal(transferredBytes.byteLength, expectedBytes.byteLength);
  assert.equal(transferredBytes.buffer.byteLength, expectedBytes.byteLength);
  assert.deepEqual(Array.from(transferredBytes), Array.from(expectedBytes));

  for (const forbiddenByte of forbiddenAdjacentBytes) {
    assert.equal(transferredBytes.includes(forbiddenByte), false);
  }
}

test("P0-05 PDF worker boundary rejects non-Buffer and non-Uint8Array input", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  for (const input of [
    null,
    undefined,
    "not bytes",
    new ArrayBuffer(4),
    new Int8Array(4),
  ]) {
    await assert.rejects(
      runPdfAssessorWorkerBoundary(input),
      /accepts only Buffer or Uint8Array input/,
    );
  }

  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary rejects over-25-MiB input before worker creation", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  let workerCreated = false;
  const result = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(
    new Uint8Array(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES + 1),
    {
      createWorker() {
        workerCreated = true;
        throw new Error("worker must not be created");
      },
    },
  );

  assert.equal(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES, 25 * 1024 * 1024);
  assert.deepEqual(result, {
    status: "failed",
    category: "input_size_exceeds_pre_parse_gate",
  });
  assert.equal(workerCreated, false);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary returns undefined when first page has extractable text", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const workerMessages = [];
  const result = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(
    Buffer.from(syntheticTextPdfBytes("first page text")),
    {
      onWorkerMessageForTest(message) {
        workerMessages.push(message);
      },
    },
  );

  assert.equal(result, undefined);
  assert.equal(await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytes("first page text"))), undefined);
  assert.equal(workerMessages.length, 1);
  assert.deepEqual(workerMessages[0], {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  for (const forbiddenKey of ["status", "policy", "category", "scope", "eligibility", "security_result"]) {
    assert.equal(Object.hasOwn(workerMessages[0], forbiddenKey), false, forbiddenKey);
  }
  assert.equal(globalThis.$libmupdf_log_error, undefined);
  assert.equal(globalThis.$libmupdf_log_warning, undefined);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary returns undefined when only a later page has extractable text", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticLaterPageTextPdfBytes()));

  assert.equal(result, undefined);
});

test("P0-05 PDF extractable-text detector blocks whitespace-only text blocks", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  assertNoExtractableTextResult(
    await runPdfAssessorWorkerBoundary(Buffer.from(syntheticWhitespaceOnlyPdfBytes())),
  );
});

test("P0-05 PDF extractable-text detector blocks a valid blank PDF", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  assertNoExtractableTextResult(await runPdfAssessorWorkerBoundary(Buffer.from(syntheticPdfBytes())));
});

test("P0-05 PDF extractable-text detector blocks graphics and image-only PDFs", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  assertNoExtractableTextResult(
    await runPdfAssessorWorkerBoundary(Buffer.from(syntheticGraphicsOnlyPdfBytes())),
  );
  assertNoExtractableTextResult(
    await runPdfAssessorWorkerBoundary(Buffer.from(syntheticImageOnlyPdfBytes())),
  );
});

test("P0-05 PDF extractable-text block result has exactly two keys", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticPdfBytes()));

  assertNoExtractableTextResult(result);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
});

test("P0-05 PDF extractable-text detector returns undefined only as text-presence evidence", () => {
  const result = detectPdfExtractableText(
    fakeExtractableTextDocument([fakeStructuredTextPage(["s", "a", "f", "e"])]),
    1,
  );

  assert.equal(result, undefined);
  assert.equal(result?.policy, undefined);
  assert.notDeepEqual(result, { policy: "allow" });
});

test("P0-05 PDF active-action and embedded-file detector returns undefined for clean text PDFs", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const bytes = Buffer.from(syntheticTextPdfBytes("clean text pdf"));

  assert.equal(await runPdfAssessorWorkerBoundary(bytes), undefined);
  assert.equal(await runPdfAssessorWorkerBoundary(bytes), undefined);
});

test("P0-05 PDF active-action and embedded-file detector blocks JavaScript actions", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/OpenAction << /S /JavaScript /JS (secret script content) >>",
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks OpenAction Launch", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/OpenAction << /S /Launch /F (secret-file-name.txt) >>",
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks dangerous AA actions", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const cases = [
    syntheticTextPdfBytesWithObjectExtras({
      catalogExtra: "/AA << /WC << /S /URI /URI (https://secret.example.invalid) >> >>",
    }),
    syntheticTextPdfBytesWithObjectExtras({
      pageExtra: "/AA << /O << /S /Launch /F (secret-file-name.txt) >> >>",
    }),
    linkAnnotationPdfBytes(
      "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /AA << /E << /S /Launch /F (secret-file-name.txt) >> >> >>",
    ),
  ];

  for (const bytes of cases) {
    assertActiveOrEmbeddedResult(await runPdfAssessorWorkerBoundary(Buffer.from(bytes)));
  }
});

test("P0-05 PDF active-action and embedded-file detector blocks unknown action subtypes", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/OpenAction << /S /MadeUpAction /X 1 >>",
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector allows internal destinations and GoTo actions", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const cases = [
    syntheticTextPdfBytesWithObjectExtras({
      catalogExtra: "/OpenAction [4 0 R /Fit]",
    }),
    syntheticTextPdfBytesWithObjectExtras({
      catalogExtra: "/OpenAction << /S /GoTo /D [4 0 R /Fit] >>",
    }),
    syntheticTextPdfBytesWithObjectExtras({
      pageExtra: "/AA << /O << /S /GoTo /D [4 0 R /Fit] >> >>",
    }),
    linkAnnotationPdfBytes(
      "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /GoTo /D [4 0 R /Fit] >> >>",
    ),
  ];

  for (const bytes of cases) {
    assert.equal(await runPdfAssessorWorkerBoundary(Buffer.from(bytes)), undefined);
  }
});

test("P0-05 PDF active-action and embedded-file detector allows Link annotations with no action", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(linkAnnotationPdfBytes(
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] >>",
  )));

  assert.equal(result, undefined);
});

test("P0-05 PDF active-action and embedded-file detector blocks Link URI actions", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(linkAnnotationPdfBytes(
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://secret.example.invalid) >> >>",
  )));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks Names JavaScript entries", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/Names << /JavaScript << /Names [(secret-name) << /S /JavaScript /JS (secret script content) >>] >> >>",
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks Names EmbeddedFiles entries", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra:
      "/Names << /EmbeddedFiles << /Names [(secret-file-name.txt) << /Type /Filespec /F (secret-file-name.txt) /EF << /F 6 0 R >> >>] >> >>",
    extraObjects: ["<< /Type /EmbeddedFile /Length 1 >>\nstream\nx\nendstream"],
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks EF embedded-file references", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/EF << /F 6 0 R >>",
    extraObjects: ["<< /Type /EmbeddedFile /Length 1 >>\nstream\nx\nendstream"],
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks AF associated files", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/AF [6 0 R]",
    extraObjects: [
      "<< /Type /Filespec /F (secret-file-name.txt) /EF << /F 7 0 R >> >>",
      "<< /Type /EmbeddedFile /Length 1 >>\nstream\nx\nendstream",
    ],
  })));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file detector blocks FileAttachment annotations", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(linkAnnotationPdfBytes(
    "<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 10 10] /FS << /Type /Filespec /F (secret-file-name.txt) /EF << /F 7 0 R >> >> >>",
  )));

  assertActiveOrEmbeddedResult(result);
});

test("P0-05 PDF active-action and embedded-file block result has exactly two keys", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra: "/OpenAction << /S /Launch /F (secret-file-name.txt) >>",
  })));

  assertActiveOrEmbeddedResult(result);
  assert.deepEqual(Object.keys(result), ["policy", "category"]);
});

test("P0-05 PDF encryption/password detector blocks when needsPassword is true", () => {
  const result = detectPdfEncryptionPassword(
    fakePdfDocument({ needsPassword: true, encryptionMetadata: "None" }),
    fakeDocumentConstructor,
  );

  assertProtectedResult(result);
});

test("P0-05 PDF encryption/password detector blocks when encryption metadata is non-None", () => {
  const result = detectPdfEncryptionPassword(
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "Standard V5 R6" }),
    fakeDocumentConstructor,
  );

  assertProtectedResult(result);
});

test("P0-05 PDF encryption/password detector blocks when either signal alone or both signals are present", () => {
  for (const document of [
    fakePdfDocument({ needsPassword: true, encryptionMetadata: undefined }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "AES-256" }),
    fakePdfDocument({ needsPassword: true, encryptionMetadata: "AES-256" }),
  ]) {
    assertProtectedResult(detectPdfEncryptionPassword(document, fakeDocumentConstructor));
  }
});

test("P0-05 PDF encryption/password detector returns undefined only for false plus undefined or exact None", () => {
  assert.equal(
    detectPdfEncryptionPassword(
      fakePdfDocument({ needsPassword: false, encryptionMetadata: undefined }),
      fakeDocumentConstructor,
    ),
    undefined,
  );
  assert.equal(
    detectPdfEncryptionPassword(
      fakePdfDocument({ needsPassword: false, encryptionMetadata: "None" }),
      fakeDocumentConstructor,
    ),
    undefined,
  );
});

test("P0-05 PDF encryption/password detector treats malformed dependency returns as failures", () => {
  for (const document of [
    fakePdfDocument({ needsPassword: "true", encryptionMetadata: "None" }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "" }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: null }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: { encryption: "None" } }),
  ]) {
    assert.throws(
      () => detectPdfEncryptionPassword(document, fakeDocumentConstructor),
      /PDF dependency inspection failed\./,
    );
  }
});

test("P0-05 PDF encryption/password detector treats thrown inspection operations as failures", () => {
  for (const document of [
    fakePdfDocument({ needsPassword: new Error("DependencyInternalError at dependency") }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: new Error("DependencyInternalError at dependency") }),
  ]) {
    assert.throws(
      () => detectPdfEncryptionPassword(document, fakeDocumentConstructor),
      /PDF dependency inspection failed\./,
    );
  }
});

test("P0-05 PDF encryption/password detector never calls authenticatePassword", () => {
  let authenticatePasswordCalls = 0;
  const result = detectPdfEncryptionPassword(
    fakePdfDocument({
      needsPassword: true,
      encryptionMetadata: "None",
      authenticatePassword() {
        authenticatePasswordCalls += 1;
      },
    }),
    fakeDocumentConstructor,
  );

  assertProtectedResult(result);
  assert.equal(authenticatePasswordCalls, 0);
  assert.doesNotMatch(workerSource, /authenticatePassword\s*\(/);
});

test("P0-05 PDF encryption/password detector repeated evaluations are deterministic", () => {
  const cases = [
    fakePdfDocument({ needsPassword: false, encryptionMetadata: undefined }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "None" }),
    fakePdfDocument({ needsPassword: true, encryptionMetadata: "None" }),
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "Standard" }),
    fakePdfDocument({ needsPassword: true, encryptionMetadata: "Standard" }),
  ];

  for (const document of cases) {
    const first = detectPdfEncryptionPassword(document, fakeDocumentConstructor);
    const second = detectPdfEncryptionPassword(document, fakeDocumentConstructor);
    assert.deepEqual(second, first);
  }
});

test("P0-05 PDF extractable-text detector repeated evaluations are deterministic", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  const textBytes = Buffer.from(syntheticTextPdfBytes("deterministic text"));
  assert.equal(await runPdfAssessorWorkerBoundary(textBytes), undefined);
  assert.equal(await runPdfAssessorWorkerBoundary(textBytes), undefined);

  const blankBytes = Buffer.from(syntheticPdfBytes());
  assertNoExtractableTextResult(await runPdfAssessorWorkerBoundary(blankBytes));
  assertNoExtractableTextResult(await runPdfAssessorWorkerBoundary(blankBytes));
});

test("P0-05 PDF extractable-text detector uses dependency failure for extraction failures", () => {
  for (const document of [
    fakeExtractableTextDocument([
      {
        destroy() {},
        toStructuredText() {
          throw new Error("secret client content from extraction");
        },
      },
    ]),
    fakeExtractableTextDocument([
      fakeStructuredTextPage(["x"], {
        onCharThrows: new Error("secret client content from onChar"),
      }),
    ]),
    fakeExtractableTextDocument([
      fakeStructuredTextPage(["x"], {
        characterOverride: { text: "secret client content" },
        useCharacterOverride: true,
      }),
    ]),
  ]) {
    assert.throws(
      () => detectPdfExtractableText(document, 1),
      /PDF dependency inspection failed\./,
    );
  }
});

test("P0-05 PDF extractable-text detector does not expose extracted text in results or errors", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const extractedText = "secret extractable client content";

  assert.equal(
    await runPdfAssessorWorkerBoundary(Buffer.from(syntheticTextPdfBytes(extractedText))),
    undefined,
  );

  let error = null;
  try {
    detectPdfExtractableText(
      fakeExtractableTextDocument([
        fakeStructuredTextPage([extractedText], {
          onCharThrows: new Error(extractedText),
        }),
      ]),
      1,
    );
  } catch (caught) {
    error = caught;
  }

  assert.match(String(error?.message), /PDF dependency inspection failed\./);
  assert.equal(String(error?.message).includes(extractedText), false);
  assert.equal(String(error?.stack ?? "").includes(extractedText), false);
});

test("P0-05 PDF encryption/password block short-circuits extractable-text inspection", () => {
  let loadPageCalls = 0;
  const result = assessOpenedPdfDocument(
    {
      ...fakePdfDocument({ needsPassword: true, encryptionMetadata: "None" }),
      loadPage() {
        loadPageCalls += 1;
        throw new Error("extractable-text detector must not run");
      },
    },
    fakeDocumentConstructor,
    1,
  );

  assertProtectedResult(result);
  assert.equal(loadPageCalls, 0);
});

test("P0-05 PDF encryption and no-text results short-circuit active-action and embedded-file detection", () => {
  let encryptedAsPdfCalls = 0;
  const encryptedResult = assessOpenedPdfDocument(
    {
      ...fakePdfDocument({ needsPassword: true, encryptionMetadata: "None" }),
      asPDF() {
        encryptedAsPdfCalls += 1;
        throw new Error("active detector must not run");
      },
      loadPage() {
        throw new Error("extractable-text detector must not run");
      },
    },
    fakeDocumentConstructor,
    1,
  );

  assertProtectedResult(encryptedResult);
  assert.equal(encryptedAsPdfCalls, 0);

  let noTextAsPdfCalls = 0;
  const noTextResult = assessOpenedPdfDocument(
    {
      ...fakePdfDocument({ needsPassword: false, encryptionMetadata: "None" }),
      asPDF() {
        noTextAsPdfCalls += 1;
        throw new Error("active detector must not run after no-text block");
      },
      loadPage() {
        return fakeStructuredTextPage([" ", "\n", "\t"]);
      },
    },
    fakeDocumentConstructor,
    1,
  );

  assertNoExtractableTextResult(noTextResult);
  assert.equal(noTextAsPdfCalls, 0);
});

test("P0-05 PDF active-action and embedded-file detector treats traversal failures as sanitized dependency failures", () => {
  const secrets = [
    "secret client content",
    "https://secret.example.invalid",
    "secret-file-name.txt",
    "[4 0 R /Fit]",
    "<< /S /Launch >>",
    "DependencyInternalError at dependency",
    "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf",
  ];

  let error = null;
  try {
    detectPdfActiveOrEmbeddedContent(
      {
        asPDF() {
          throw new Error(secrets.join(" "));
        },
      },
      1,
    );
  } catch (caught) {
    error = caught;
  }

  assert.match(String(error?.message), /PDF dependency inspection failed\./);
  const text = String(error?.stack ?? error?.message ?? error);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test("P0-05 PDF worker boundary returns exactly the protected result and short-circuits later worker checks", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
  });

  worker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
    later_pdf_checks_started: false,
    result: protectedPdfResult,
  });
  worker.finishTermination();

  assertProtectedResult(await promise);
});

test("P0-05 PDF worker boundary uses safe failure for malformed result shapes", async () => {
  for (const result of [
    { policy: "block", category: "encrypted_or_password_protected", scope: "extra" },
    { policy: "block", category: "pdf_no_extractable_text", scope: "extra" },
    { policy: "block", category: "pdf_active_or_embedded_content", scope: "extra" },
    { policy: "allow", category: "encrypted_or_password_protected" },
    { policy: "allow", category: "pdf_no_extractable_text" },
    { policy: "allow", category: "pdf_active_or_embedded_content" },
    { status: "failed", category: "encrypted_or_password_protected" },
    { status: "failed", category: "pdf_active_or_embedded_content" },
    { policy: "block", category: "pdf_text_probe_internal_error" },
    undefined,
  ]) {
    await assertBoundaryRejectsSanitized({
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
      result,
      rawContent: "%PDF secret client content",
      extractedText: "secret extractable client content",
      password: "correct horse battery staple",
      privatePath: "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf",
      identifier: "synthetic-file-id-123",
      dependencyMetadata: "DependencyInternalError at dependency",
    });
  }
});

test("P0-05 PDF worker boundary uses safe failure when document open or inspection fails", async () => {
  for (const workerMessage of [
    {
      type: "kai_pdf_worker_liveness_failed",
      rawContent: "%PDF secret client content",
      extractedText: "secret extractable client content",
      password: "correct horse battery staple",
      privatePath: "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf",
      identifier: "synthetic-file-id-123",
      dependencyMetadata: "DependencyInternalError at dependency",
    },
    {
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
      result: {
        policy: "block",
        category: "encrypted_or_password_protected",
        extractedText: "secret extractable client content",
        dependencyMetadata: "DependencyInternalError at dependency",
      },
    },
    {
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
      result: {
        policy: "block",
        category: "pdf_active_or_embedded_content",
        script: "secret script content",
        url: "https://secret.example.invalid",
        filename: "secret-file-name.txt",
        destination: "[4 0 R /Fit]",
        objectData: "<< /S /Launch >>",
        dependencyMetadata: "DependencyInternalError at dependency",
      },
    },
  ]) {
    await assertBoundaryRejectsSanitized(workerMessage);
  }
});

test("P0-05 PDF active-action and embedded-file detector does not leak content or internals", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const bytes = Buffer.from(syntheticTextPdfBytesWithObjectExtras({
    catalogExtra:
      "/OpenAction << /S /URI /URI (https://secret.example.invalid) /JS (secret script content) /D [4 0 R /Fit] >>",
  }));

  const result = await runPdfAssessorWorkerBoundary(bytes);
  assertActiveOrEmbeddedResult(result);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "secret script content",
    "https://secret.example.invalid",
    "secret-file-name.txt",
    "[4 0 R /Fit]",
    "<< /S /URI",
    "DependencyInternalError",
    "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy",
    "%PDF",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("P0-05 PDF encryption/password detector records truncated repaired PDF limitation as deferred integrity detection", () => {
  const result = detectPdfEncryptionPassword(
    fakePdfDocument({ needsPassword: false, encryptionMetadata: "None" }),
    fakeDocumentConstructor,
  );

  assert.equal(result, undefined);
  assert.equal(result?.policy, undefined);
  assert.notDeepEqual(result, { policy: "allow" });
  assert.match(
    "integrity detection is deferred for truncated-but-repaired PDFs",
    /integrity detection is deferred/,
  );
});

test("P0-05 PDF encryption/password detector returns undefined for synthetic invalid-but-repaired PDF and defers integrity detection", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();

  const result = await runPdfAssessorWorkerBoundary(Buffer.from(syntheticInvalidButMupdfRepairedPdfBytes()));

  assert.equal(result, undefined);
  assert.equal(result?.policy, undefined);
  assert.notDeepEqual(result, { policy: "allow" });
  assert.match(
    "integrity detection is deferred for truncated or invalid but openable PDFs",
    /integrity detection is deferred/,
  );
});

test("P0-05 PDF worker boundary transfers only an owned exact visible-range copy", async () => {
  for (const { name, input, expectedBytes, forbiddenAdjacentBytes } of ownershipInputs()) {
    pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
    const originalByteLength = input.byteLength;
    const originalBytes = Uint8Array.from(input);
    const worker = new SyntheticWorker();
    let transferredBytes = null;

    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(input, {
      createWorker(bytes) {
        transferredBytes = bytes;
        return worker;
      },
    });

    assertFreshVisibleRangeCopy({
      input,
      transferredBytes,
      expectedBytes,
      forbiddenAdjacentBytes,
    });

    worker.emit("message", {
      type: "kai_pdf_worker_liveness_ok",
      liveness_operation: "Document.countPages",
      handles_destroyed: true,
    });
    worker.finishTermination();

    assert.equal(await promise, undefined, name);
    assert.equal(input.byteLength, originalByteLength, name);
    assertReadableAndUnchanged(input, originalBytes);
    assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0, name);
  }
});

test("P0-05 PDF worker boundary timeout latches only failed / security_assessment_timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
    timeoutMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(worker.terminateCalls, 1);
  worker.finishTermination();

  assert.deepEqual(await promise, {
    status: "failed",
    category: "security_assessment_timeout",
  });
  assert.equal(PDF_ASSESSOR_PARENT_TIMEOUT_MS, 60_000);
});

test("P0-05 PDF worker boundary preserves caller-owned input after timeout", async () => {
  for (const { name, input, expectedBytes, forbiddenAdjacentBytes } of ownershipInputs()) {
    pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
    const originalByteLength = input.byteLength;
    const originalBytes = Uint8Array.from(input);
    const worker = new SyntheticWorker();
    let transferredBytes = null;

    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(input, {
      createWorker(bytes) {
        transferredBytes = bytes;
        return worker;
      },
      timeoutMs: 1,
    });

    assertFreshVisibleRangeCopy({
      input,
      transferredBytes,
      expectedBytes,
      forbiddenAdjacentBytes,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.finishTermination();

    assert.deepEqual(await promise, {
      status: "failed",
      category: "security_assessment_timeout",
    }, name);
    assert.equal(input.byteLength, originalByteLength, name);
    assertReadableAndUnchanged(input, originalBytes);
    assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0, name);
  }
});

test("P0-05 PDF worker boundary rejects late worker messages after timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  let lateMessagesRejected = 0;
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      setTimeout(() => {
        worker.emit("message", {
          type: "kai_pdf_worker_liveness_ok",
          category: "late_worker_success",
          policy: "late_policy",
        });
      }, 5);
      return worker;
    },
    onLateWorkerMessageRejectedForTest() {
      lateMessagesRejected += 1;
    },
    timeoutMs: 1,
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  worker.finishTermination();

  assert.deepEqual(await promise, {
    status: "failed",
    category: "security_assessment_timeout",
  });
  assert.equal(lateMessagesRejected, 1);
});

test("P0-05 PDF worker boundary terminates the worker and completes exit cleanup", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const worker = new SyntheticWorker();
  const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return worker;
    },
  });

  worker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  assert.equal(worker.terminateCalls, 1);
  worker.finishTermination();

  assert.equal(await promise, undefined);
  assert.equal(worker.listenerCount("message"), 0);
  assert.equal(worker.listenerCount("error"), 0);
  assert.equal(worker.listenerCount("exit"), 0);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary permits at most one active worker", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const firstWorker = new SyntheticWorker();
  let workerCreations = 0;
  const first = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      workerCreations += 1;
      return firstWorker;
    },
  });
  const second = await pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      workerCreations += 1;
      return new SyntheticWorker();
    },
  });

  assert.equal(MAXIMUM_CONCURRENT_PDF_ASSESSOR_WORKERS, 1);
  assert.deepEqual(second, {
    status: "failed",
    category: "maximum_concurrent_pdf_assessor_workers_exceeded",
  });
  assert.equal(workerCreations, 1);
  assert.deepEqual(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState(), {
    active: 1,
    maxObserved: 1,
    configuredMaximum: 1,
  });

  firstWorker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  firstWorker.finishTermination();
  assert.equal(await first, undefined);
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary releases the concurrency permit after success and timeout", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const successWorker = new SyntheticWorker();
  const success = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return successWorker;
    },
  });
  successWorker.emit("message", {
    type: "kai_pdf_worker_liveness_ok",
    liveness_operation: "Document.countPages",
    handles_destroyed: true,
  });
  successWorker.finishTermination();
  await success;
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);

  const timeoutWorker = new SyntheticWorker();
  const timeout = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(syntheticPdfBytes(), {
    createWorker() {
      return timeoutWorker;
    },
    timeoutMs: 1,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  timeoutWorker.finishTermination();
  await timeout;
  assert.equal(pdfWorkerBoundaryTestables.getPdfAssessorWorkerState().active, 0);
});

test("P0-05 PDF worker boundary prohibits main-thread MuPDF import", () => {
  assert.doesNotMatch(mainSource, /from\s+["']mupdf["']/);
  assert.doesNotMatch(mainSource, /import\(\s*["']mupdf["']\s*\)/);
  assert.match(workerSource, /await import\("mupdf"\)/);
  assert.match(workerSource, /!isMainThread && parentPort/);
});

test("P0-05 PDF worker boundary uses no data-URL or eval worker", () => {
  assert.equal(pdfWorkerBoundaryTestables.getDefaultWorkerUrlProtocol(), "file:");
  assert.doesNotMatch(mainSource, /new Worker\(\s*["'`]data:/);
  assert.doesNotMatch(mainSource, /eval\s*:\s*true/);
});

test("P0-05 PDF worker boundary omits raw bytes, PDF content, and private paths from results, errors, and logs", async () => {
  pdfWorkerBoundaryTestables.resetPdfAssessorWorkerState();
  const logs = [];
  const originalConsole = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  console.error = (...args) => logs.push(args.join(" "));
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => logs.push(args.join(" "));

  try {
    const privatePath = "/Users/mikewoz/Get-Kinder-Full-Stack-Deploy/private.pdf";
    const rawContent = "%PDF-1.4 secret client content";
    const worker = new SyntheticWorker();
    const promise = pdfWorkerBoundaryTestables.runPdfAssessorWorkerBoundaryWithTestControls(encodeAscii(rawContent), {
      createWorker() {
        return worker;
      },
    });
    worker.emit("message", {
      type: "kai_pdf_worker_liveness_failed",
      rawContent,
      privatePath,
      bytes: [0x25, 0x50, 0x44, 0x46],
    });
    worker.finishTermination();
    await assert.rejects(promise, /PDF assessor worker failed\./);

    const oversizeResult = await runPdfAssessorWorkerBoundary(
      new Uint8Array(PDF_ASSESSOR_PRE_PARSE_INPUT_GATE_BYTES + 1),
    );
    const combined = JSON.stringify({
      oversizeResult,
      logs,
    });
    assert.equal(combined.includes(rawContent), false);
    assert.equal(combined.includes("secret client content"), false);
    assert.equal(combined.includes(privatePath), false);
    assert.equal(combined.includes("%PDF"), false);
  } finally {
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }
});
