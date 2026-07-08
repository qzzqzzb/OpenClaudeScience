import {
  buildOfficeReadablePreview,
  officePreviewToMarkdown,
} from "@/app/api/workspace/_lib/office-preview";

const MAX_PDF_EXTRACT_PAGES = 80;
export const MAX_PDF_EXTRACT_CHARS = 200_000;

export interface PdfTextExtraction {
  text: string;
  pageCount?: number;
  extractedPageCount?: number;
  truncated: boolean;
  extractionError?: string;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export async function extractPdfText(
  data: Buffer
): Promise<PdfTextExtraction> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const result = await parser.getText({ first: MAX_PDF_EXTRACT_PAGES });
      const normalizedText = normalizeExtractedText(result.text || "");
      const text =
        normalizedText.length > MAX_PDF_EXTRACT_CHARS
          ? normalizedText.slice(0, MAX_PDF_EXTRACT_CHARS).trimEnd()
          : normalizedText;

      return {
        text,
        pageCount: result.total,
        extractedPageCount: Math.min(result.total, MAX_PDF_EXTRACT_PAGES),
        truncated:
          result.total > MAX_PDF_EXTRACT_PAGES ||
          normalizedText.length > MAX_PDF_EXTRACT_CHARS,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    return {
      text: "",
      truncated: false,
      extractionError:
        error instanceof Error ? error.message : "Unable to extract PDF text.",
    };
  }
}

export { buildOfficeReadablePreview, officePreviewToMarkdown };
