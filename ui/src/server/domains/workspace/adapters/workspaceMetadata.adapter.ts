import {
  assertReadableFilePath,
  getFileExtension,
  getMimeType,
  getPreviewContentSizeLimit,
  getPreviewKind,
  WorkspaceRangeNotSatisfiableError,
} from "@/app/api/workspace/_lib/workspace";

export {
  getFileExtension,
  getMimeType,
  getPreviewContentSizeLimit,
  getPreviewKind,
  WorkspaceRangeNotSatisfiableError,
};

export function assertReadableWorkspaceFilePath(relativePath: string): void {
  assertReadableFilePath(relativePath);
}
