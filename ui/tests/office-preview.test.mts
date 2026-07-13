import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfficePreview,
  officePreviewToMarkdown,
} from "../src/server/domains/workspace/adapters/officePreview.adapter.ts";

type ZipInput = Record<string, string>;

function makeZip(entries: ZipInput): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test("buildOfficePreview extracts DOCX text and markdown summary", () => {
  const docx = makeZip({
    "word/document.xml":
      "<w:document><w:body><w:p><w:r><w:t>项目摘要</w:t></w:r></w:p><w:p><w:r><w:t>关键结论</w:t></w:r></w:p></w:body></w:document>",
  });

  const preview = buildOfficePreview("report.docx", docx);
  const markdown = officePreviewToMarkdown({
    name: "report.docx",
    sourceWorkspacePath: "/.internagents/uploads/report.docx",
    preview,
  });

  assert.equal(preview.kind, "docx");
  assert.deepEqual(preview.blocks[0].lines, ["项目摘要", "关键结论"]);
  assert.match(
    markdown,
    /Source file logical path \(file tools\): \/.internagents\/uploads\/report\.docx/
  );
  assert.match(
    markdown,
    /Source file shell\/script path: \.internagents\/uploads\/report\.docx/
  );
  assert.match(markdown, /项目摘要/);
});

test("buildOfficePreview extracts PPTX slide text", () => {
  const pptx = makeZip({
    "ppt/slides/slide1.xml":
      "<p:sld><p:cSld><a:t>方法概览</a:t><a:t>步骤一</a:t></p:cSld></p:sld>",
  });

  const preview = buildOfficePreview("slides.pptx", pptx);
  const markdown = officePreviewToMarkdown({
    name: "slides.pptx",
    sourceWorkspacePath: "/.internagents/uploads/slides.pptx",
    preview,
  });

  assert.equal(preview.kind, "pptx");
  assert.deepEqual(preview.blocks[0].lines, ["方法概览", "步骤一"]);
  assert.match(markdown, /### 第 1 页/);
});

test("buildOfficePreview extracts XLSX shared strings as a table", () => {
  const xlsx = makeZip({
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Sheet A" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      "<sst><si><t>Metric</t></si><si><t>Value</t></si><si><t>Accuracy</t></si></sst>",
    "xl/worksheets/sheet1.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.97</v></c></row></sheetData></worksheet>',
  });

  const preview = buildOfficePreview("table.xlsx", xlsx);
  const markdown = officePreviewToMarkdown({
    name: "table.xlsx",
    sourceWorkspacePath: "/.internagents/uploads/table.xlsx",
    preview,
  });

  assert.equal(preview.kind, "xlsx");
  assert.deepEqual(preview.blocks[0].rows, [
    ["Metric", "Value"],
    ["Accuracy", "0.97"],
  ]);
  assert.match(markdown, /\| # \| A \| B \|/);
  assert.match(markdown, /\| 2 \| Accuracy \| 0\.97 \|/);
});

test("buildOfficePreview maps legacy Office extensions to existing preview kinds", () => {
  const legacyDoc = buildOfficePreview("legacy.doc", Buffer.from("legacy"));
  const legacyXls = buildOfficePreview("legacy.xls", Buffer.from("legacy"));
  const legacyPpt = buildOfficePreview("legacy.ppt", Buffer.from("legacy"));

  assert.equal(legacyDoc.kind, "docx");
  assert.equal(legacyXls.kind, "xlsx");
  assert.equal(legacyPpt.kind, "pptx");
  assert.match(legacyDoc.error || "", /Office 文件包/);
});
