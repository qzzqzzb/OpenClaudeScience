import assert from "node:assert/strict";
import test from "node:test";

import {
  getPreviewContentSizeLimit,
  MAX_PREVIEW_FILE_SIZE,
  MAX_TEXT_FILE_SIZE,
} from "../src/server/domains/workspace/adapters/workspaceFs.adapter.ts";
import type { WorkspacePreviewKind } from "../src/app/types/workspace.ts";

const ONE_HUNDRED_MIB = 100 * 1024 * 1024;

test("content-backed workspace previews allow up to 100 MiB", () => {
  assert.equal(MAX_PREVIEW_FILE_SIZE, ONE_HUNDRED_MIB);
  assert.equal(MAX_TEXT_FILE_SIZE, ONE_HUNDRED_MIB);

  const contentPreviewKinds: WorkspacePreviewKind[] = [
    "markdown",
    "molecule",
    "science",
    "text",
  ];

  for (const previewKind of contentPreviewKinds) {
    assert.equal(getPreviewContentSizeLimit(previewKind), ONE_HUNDRED_MIB);
  }
});

test("raw-backed workspace previews do not request text content", () => {
  const rawPreviewKinds: WorkspacePreviewKind[] = [
    "binary",
    "docx",
    "image",
    "pdf",
    "pptx",
    "unsupported",
    "xlsx",
  ];

  for (const previewKind of rawPreviewKinds) {
    assert.equal(getPreviewContentSizeLimit(previewKind), 0);
  }
});
