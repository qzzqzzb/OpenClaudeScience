import {
  assertReadableFilePath,
  getFileExtension,
  getMimeType,
  getPreviewContentSizeLimit,
  getPreviewKind,
  WorkspaceRangeNotSatisfiableError,
} from "./workspaceFs.adapter";

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
