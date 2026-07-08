import crypto from "crypto";
import path from "path";
import type { WorkspaceOfficePreviewKind } from "@/app/types/workspace";
import {
  buildOfficeReadablePreview,
  extractPdfText,
  MAX_PDF_EXTRACT_CHARS,
  officePreviewToMarkdown,
  type PdfTextExtraction,
} from "./adapters/attachmentExtraction.adapter";
import {
  assertReadableWorkspaceFilePath,
  getMimeType,
} from "./adapters/workspaceMetadata.adapter";
import {
  readWorkspaceRawFile,
  writeWorkspaceRawFile,
} from "./adapters/workspaceFile.adapter";
import type { WorkspaceSelection } from "./workspace.types";

const MAX_ATTACHMENT_UPLOAD_SIZE = 16 * 1024 * 1024;
const MAX_OFFICE_MESSAGE_SUMMARY_CHARS = 24_000;

interface OfficeAttachmentType {
  kind: WorkspaceOfficePreviewKind;
  extension: string;
  mimeType: string;
  extensions: string[];
  mimeTypes: string[];
}

type OfficeAttachmentMatch = OfficeAttachmentType & {
  matchedExtension: string;
};

const OFFICE_ATTACHMENT_TYPES: Record<
  WorkspaceOfficePreviewKind,
  OfficeAttachmentType
> = {
  docx: {
    kind: "docx",
    extension: ".docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extensions: [".docx", ".doc"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
  },
  pptx: {
    kind: "pptx",
    extension: ".pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extensions: [".pptx", ".ppt"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
    ],
  },
  xlsx: {
    kind: "xlsx",
    extension: ".xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extensions: [".xlsx", ".xls"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
};

export class WorkspaceAttachmentUploadError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "WorkspaceAttachmentUploadError";
    this.statusCode = statusCode;
  }
}

export interface UploadWorkspaceAttachmentInput extends WorkspaceSelection {
  threadId?: string;
  workspacePath?: string;
  file?: File;
}

export interface UploadedWorkspaceAttachment {
  name: string;
  mimeType: string;
  size: number;
  kind: "file" | "pdf";
  workspacePath: string;
  extractedWorkspacePath: string;
  extractedTextSize: number;
  text?: string;
  pageCount?: number;
  extractedPageCount?: number;
  truncated?: boolean;
  extractionError?: string;
}

export interface UploadWorkspaceAttachmentOutput {
  attachment: UploadedWorkspaceAttachment;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[/\\]/g, "-")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return fallback;
  }
  return cleaned.startsWith(".") ? `file-${cleaned.slice(1)}` : cleaned;
}

function isPdfFile(file: File, data: Buffer): boolean {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  const hasPdfName = name.endsWith(".pdf");
  const hasPdfMime = mimeType === "application/pdf";
  const hasPdfMagic = data.subarray(0, 5).toString("ascii") === "%PDF-";
  return hasPdfMagic && (hasPdfName || hasPdfMime || !mimeType);
}

function getOfficeAttachmentType(
  fileName: string,
  mimeType: string,
  data: Buffer
): OfficeAttachmentMatch | null {
  const name = fileName.toLowerCase();
  const normalizedMimeType = mimeType.toLowerCase();
  const hasZipMagic = data.subarray(0, 2).toString("ascii") === "PK";

  for (const type of Object.values(OFFICE_ATTACHMENT_TYPES)) {
    const matchedExtension = type.extensions.find((extension) =>
      name.endsWith(extension)
    );
    const matchedMimeType = Boolean(
      normalizedMimeType && type.mimeTypes.includes(normalizedMimeType)
    );
    if (!matchedExtension && !matchedMimeType) {
      continue;
    }
    if (
      normalizedMimeType &&
      !type.mimeTypes.includes(normalizedMimeType) &&
      normalizedMimeType !== "application/octet-stream" &&
      normalizedMimeType !== "application/zip"
    ) {
      return null;
    }
    const usesLegacyFormat =
      matchedExtension === ".doc" ||
      matchedExtension === ".xls" ||
      matchedExtension === ".ppt" ||
      normalizedMimeType === "application/msword" ||
      normalizedMimeType === "application/vnd.ms-excel" ||
      normalizedMimeType === "application/vnd.ms-powerpoint";
    if (!hasZipMagic && !usesLegacyFormat) {
      return null;
    }
    return { ...type, matchedExtension: matchedExtension || type.extension };
  }

  return null;
}

function workspaceFilePath(filePath: string): string {
  return `/${filePath.replace(/^\/+/, "")}`;
}

function workspaceRuntimePath(filePath: string): string {
  return filePath.replace(/^\/+/, "") || ".";
}

function uploadScopeFromThreadId(value?: string): string {
  return sanitizePathSegment(value || "draft", "draft");
}

function buildPdfExtractionMarkdown(
  name: string,
  pdfWorkspacePath: string,
  extracted: PdfTextExtraction
): string {
  const pdfRuntimePath = workspaceRuntimePath(pdfWorkspacePath);
  const lines = [
    `# ${name}`,
    "",
    "This file was generated by InternAgentS during PDF attachment upload.",
    "",
    `Source PDF logical path (file tools): ${pdfWorkspacePath}`,
    `Source PDF shell/script path: ${pdfRuntimePath}`,
    `Pages extracted: ${extracted.extractedPageCount ?? 0}${
      extracted.pageCount ? ` / ${extracted.pageCount}` : ""
    }`,
    `Text limit: ${MAX_PDF_EXTRACT_CHARS} characters`,
    `Truncated: ${extracted.truncated ? "yes" : "no"}`,
  ];

  if (extracted.extractionError) {
    lines.push("", "## Extraction Error", "", extracted.extractionError);
  }

  lines.push("", "## Extracted Text", "");

  if (extracted.text) {
    lines.push(extracted.text);
  } else {
    lines.push(
      "No extractable text was found. Use the source PDF when layout, figures, tables, OCR, or manual inspection is required."
    );
  }

  return `${lines.join("\n")}\n`;
}

function officeMessageSummary(markdown: string): {
  text: string;
  truncated: boolean;
} {
  if (markdown.length <= MAX_OFFICE_MESSAGE_SUMMARY_CHARS) {
    return { text: markdown.trim(), truncated: false };
  }

  return {
    text: `${markdown
      .slice(0, MAX_OFFICE_MESSAGE_SUMMARY_CHARS)
      .trimEnd()}\n\n[Office attachment summary truncated in this message. Use the readable summary file in the workspace for the full extracted preview.]`,
    truncated: true,
  };
}

async function attachExistingWorkspaceOfficeFile({
  workspacePath,
  resourceId,
  workspaceId,
  uploadScope,
}: {
  workspacePath: string;
  resourceId?: string | null;
  workspaceId?: string | null;
  uploadScope: string;
}): Promise<UploadWorkspaceAttachmentOutput> {
  assertReadableWorkspaceFilePath(workspacePath);
  const rawFile = await readWorkspaceRawFile(
    workspacePath,
    resourceId,
    workspaceId
  );
  const sourceWorkspacePath = workspaceFilePath(rawFile.path);
  const officeType = getOfficeAttachmentType(
    rawFile.name || path.basename(rawFile.path),
    getMimeType(rawFile.path),
    rawFile.data
  );
  if (!officeType) {
    throw new WorkspaceAttachmentUploadError(
      "Only valid DOC, DOCX, XLS, XLSX, PPT, or PPTX workspace attachments are supported here."
    );
  }

  const uploadId = crypto.randomUUID();
  const summaryWorkspacePath = [
    ".internagents",
    "uploads",
    uploadScope,
    `${uploadId}-${path.basename(
      rawFile.name,
      officeType.matchedExtension
    )}.summary.md`,
  ].join("/");
  const preview = await buildOfficeReadablePreview(rawFile.path, rawFile.data);
  const summaryMarkdown = officePreviewToMarkdown({
    name: rawFile.name || path.basename(rawFile.path),
    sourceWorkspacePath,
    preview,
  });
  const summary = officeMessageSummary(summaryMarkdown);
  const summaryFileData = await writeWorkspaceRawFile(
    summaryWorkspacePath,
    Buffer.from(summaryMarkdown, "utf8"),
    resourceId,
    workspaceId
  );

  return {
    attachment: {
      name: rawFile.name || path.basename(rawFile.path),
      mimeType: officeType.mimeType,
      size: rawFile.size,
      kind: "file",
      workspacePath: sourceWorkspacePath,
      extractedWorkspacePath: workspaceFilePath(summaryFileData.path),
      extractedTextSize: summaryFileData.size,
      text: summary.text,
      truncated: Boolean(preview.truncated || summary.truncated),
      extractionError: preview.error,
    },
  };
}

async function attachUploadedOfficeFile({
  file,
  data,
  officeType,
  filename,
  uploadWorkspacePath,
  uploadId,
  uploadScope,
  resourceId,
  workspaceId,
}: {
  file: File;
  data: Buffer;
  officeType: OfficeAttachmentMatch;
  filename: string;
  uploadWorkspacePath: string;
  uploadId: string;
  uploadScope: string;
  resourceId?: string | null;
  workspaceId?: string | null;
}): Promise<UploadWorkspaceAttachmentOutput> {
  const summaryWorkspacePath = [
    ".internagents",
    "uploads",
    uploadScope,
    `${uploadId}-${path.basename(
      filename,
      officeType.matchedExtension
    )}.summary.md`,
  ].join("/");
  const fileData = await writeWorkspaceRawFile(
    uploadWorkspacePath,
    data,
    resourceId,
    workspaceId
  );
  const sourceWorkspacePath = workspaceFilePath(fileData.path);
  const preview = await buildOfficeReadablePreview(fileData.path, data);
  const summaryMarkdown = officePreviewToMarkdown({
    name: file.name || fileData.name,
    sourceWorkspacePath,
    preview,
  });
  const summary = officeMessageSummary(summaryMarkdown);
  const summaryFileData = await writeWorkspaceRawFile(
    summaryWorkspacePath,
    Buffer.from(summaryMarkdown, "utf8"),
    resourceId,
    workspaceId
  );

  return {
    attachment: {
      name: file.name || fileData.name,
      mimeType: officeType.mimeType,
      size: fileData.size,
      kind: "file",
      workspacePath: sourceWorkspacePath,
      extractedWorkspacePath: workspaceFilePath(summaryFileData.path),
      extractedTextSize: summaryFileData.size,
      text: summary.text,
      truncated: Boolean(preview.truncated || summary.truncated),
      extractionError: preview.error,
    },
  };
}

async function attachUploadedPdfFile({
  file,
  data,
  filename,
  uploadWorkspacePath,
  uploadId,
  uploadScope,
  resourceId,
  workspaceId,
}: {
  file: File;
  data: Buffer;
  filename: string;
  uploadWorkspacePath: string;
  uploadId: string;
  uploadScope: string;
  resourceId?: string | null;
  workspaceId?: string | null;
}): Promise<UploadWorkspaceAttachmentOutput> {
  const extractedWorkspacePath = [
    ".internagents",
    "uploads",
    uploadScope,
    `${uploadId}-${path.basename(filename, ".pdf")}.extracted.md`,
  ].join("/");

  const [fileData, extracted] = await Promise.all([
    writeWorkspaceRawFile(uploadWorkspacePath, data, resourceId, workspaceId),
    extractPdfText(data),
  ]);
  const pdfWorkspacePath = workspaceFilePath(fileData.path);
  const extractedMarkdown = buildPdfExtractionMarkdown(
    file.name || fileData.name,
    pdfWorkspacePath,
    extracted
  );
  const extractedFileData = await writeWorkspaceRawFile(
    extractedWorkspacePath,
    Buffer.from(extractedMarkdown, "utf8"),
    resourceId,
    workspaceId
  );

  return {
    attachment: {
      name: file.name || fileData.name,
      mimeType: "application/pdf",
      size: fileData.size,
      kind: "pdf",
      workspacePath: pdfWorkspacePath,
      extractedWorkspacePath: workspaceFilePath(extractedFileData.path),
      extractedTextSize: extractedFileData.size,
      pageCount: extracted.pageCount,
      extractedPageCount: extracted.extractedPageCount,
      truncated: extracted.truncated,
      extractionError: extracted.extractionError,
    },
  };
}

export async function uploadWorkspaceAttachment({
  resourceId,
  workspaceId,
  threadId,
  workspacePath,
  file,
}: UploadWorkspaceAttachmentInput): Promise<UploadWorkspaceAttachmentOutput> {
  const uploadScope = uploadScopeFromThreadId(threadId);

  if (workspacePath) {
    return attachExistingWorkspaceOfficeFile({
      workspacePath,
      resourceId,
      workspaceId,
      uploadScope,
    });
  }

  if (!file) {
    throw new WorkspaceAttachmentUploadError("Missing uploaded file.");
  }

  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_ATTACHMENT_UPLOAD_SIZE) {
    throw new WorkspaceAttachmentUploadError(
      "Attachment file is too large to upload.",
      413
    );
  }

  const isPdf = isPdfFile(file, data);
  const officeType = isPdf
    ? null
    : getOfficeAttachmentType(file.name, file.type, data);
  if (!isPdf && !officeType) {
    throw new WorkspaceAttachmentUploadError(
      "Only valid PDF, DOC, DOCX, XLS, XLSX, PPT, or PPTX attachments are supported here."
    );
  }

  const expectedExtension = isPdf ? ".pdf" : officeType!.matchedExtension;
  const originalName = sanitizePathSegment(
    file.name || `attachment${expectedExtension}`,
    `attachment${expectedExtension}`
  );
  const extension = path.extname(originalName).toLowerCase();
  const filename =
    extension === expectedExtension
      ? originalName
      : `${path.basename(originalName, extension)}${expectedExtension}`;
  const uploadId = crypto.randomUUID();
  const uploadWorkspacePath = [
    ".internagents",
    "uploads",
    uploadScope,
    `${uploadId}-${filename}`,
  ].join("/");

  if (officeType) {
    return attachUploadedOfficeFile({
      file,
      data,
      officeType,
      filename,
      uploadWorkspacePath,
      uploadId,
      uploadScope,
      resourceId,
      workspaceId,
    });
  }

  return attachUploadedPdfFile({
    file,
    data,
    filename,
    uploadWorkspacePath,
    uploadId,
    uploadScope,
    resourceId,
    workspaceId,
  });
}
