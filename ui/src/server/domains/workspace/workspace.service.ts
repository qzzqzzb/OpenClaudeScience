import path from "path";
import {
  buildOfficePreview,
  isOfficePreviewKind,
} from "./adapters/officePreview.adapter";
import {
  workspaceDirectoryAdapter,
} from "./adapters/workspaceDirectory.adapter";
import {
  workspaceFileAdapter,
} from "./adapters/workspaceFile.adapter";
import {
  assertReadableWorkspaceFilePath,
  getFileExtension,
  getMimeType,
  getPreviewContentSizeLimit,
  getPreviewKind,
  WorkspaceRangeNotSatisfiableError,
} from "./adapters/workspaceMetadata.adapter";
import {
  isLocalWorkspaceResource,
  resolveWorkspacePath,
} from "./adapters/workspacePath.adapter";
import {
  assertLocalFile,
  openLocalFile,
  openLocalFolder,
} from "./adapters/localDesktop.adapter";
import type {
  ListWorkspaceDirectoryOutput,
  ReadWorkspaceFileInput,
  ReadWorkspaceFileOutput,
  ReadWorkspaceRawFileInput,
  SearchWorkspaceFilesInput,
  SearchWorkspaceFilesOutput,
  WorkspacePathSelection,
  WorkspaceRawFileResult,
} from "./workspace.types";

export { WorkspaceRangeNotSatisfiableError };

export async function listWorkspaceDirectory({
  path: requestedPath = "",
  resourceId,
  workspaceId,
}: WorkspacePathSelection): Promise<ListWorkspaceDirectoryOutput> {
  return workspaceDirectoryAdapter.listEntries({
    path: requestedPath,
    resourceId,
    workspaceId,
  });
}

export async function searchWorkspaceDirectoryFiles({
  query = "",
  path: requestedPath = "",
  resourceId,
  workspaceId,
  limit,
}: SearchWorkspaceFilesInput): Promise<SearchWorkspaceFilesOutput> {
  const entries = await workspaceDirectoryAdapter.searchFiles({
    query,
    path: requestedPath,
    resourceId,
    workspaceId,
    limit,
  });

  return {
    query,
    entries,
  };
}

export async function readWorkspaceFile({
  path: requestedPath,
  resourceId,
  workspaceId,
}: ReadWorkspaceFileInput): Promise<ReadWorkspaceFileOutput> {
  assertReadableWorkspaceFilePath(requestedPath);
  const fileData = await workspaceFileAdapter.readFile({
    path: requestedPath,
    resourceId,
    workspaceId,
  });

  if (!fileData.isFile) {
    throw new Error("Selected workspace path is not a file.");
  }

  const previewKind = getPreviewKind(fileData.path);
  const rawParams = new URLSearchParams({ path: fileData.path });
  if (resourceId) {
    rawParams.set("resourceId", resourceId);
  }
  if (workspaceId) {
    rawParams.set("workspaceId", workspaceId);
  }

  const payload: ReadWorkspaceFileOutput = {
    name: fileData.name,
    path: fileData.path,
    extension: getFileExtension(fileData.path) || undefined,
    size: fileData.size,
    modifiedAt: fileData.modifiedAt,
    previewKind,
    mimeType: getMimeType(fileData.path),
    rawUrl: `/api/workspace/file/raw?${rawParams.toString()}`,
  };

  const previewContentSizeLimit = getPreviewContentSizeLimit(previewKind);
  if (previewContentSizeLimit > 0) {
    if (
      fileData.size <= previewContentSizeLimit &&
      fileData.content !== undefined
    ) {
      payload.content = fileData.content;
    } else {
      payload.tooLarge = true;
    }
  }

  if (isOfficePreviewKind(previewKind)) {
    try {
      const rawFile = await workspaceFileAdapter.readRawFile({
        path: fileData.path,
        resourceId,
        workspaceId,
      });
      payload.officePreview = buildOfficePreview(rawFile.path, rawFile.data);
    } catch (previewError) {
      payload.officePreview = {
        kind: previewKind,
        blocks: [],
        error:
          previewError instanceof Error
            ? previewError.message
            : "无法生成 Office 文件预览。",
      };
    }
  }

  return payload;
}

export async function readWorkspaceRawFileContent({
  path: requestedPath,
  resourceId,
  workspaceId,
  rangeHeader,
}: ReadWorkspaceRawFileInput): Promise<WorkspaceRawFileResult> {
  assertReadableWorkspaceFilePath(requestedPath);

  if (isLocalWorkspaceResource(resourceId)) {
    const fileData = await workspaceFileAdapter.streamLocalRawFile({
      path: requestedPath,
      resourceId,
      workspaceId,
      rangeHeader,
    });
    if (!fileData.isFile) {
      throw new Error("Selected workspace path is not a file.");
    }
    return {
      kind: "stream",
      ...fileData,
    };
  }

  const fileData = await workspaceFileAdapter.readRawFile({
    path: requestedPath,
    resourceId,
    workspaceId,
  });
  if (!fileData.isFile) {
    throw new Error("Selected workspace path is not a file.");
  }

  return {
    kind: "buffer",
    ...fileData,
  };
}

export function getWorkspaceRawFileMimeType(filePath: string): string {
  return getMimeType(filePath);
}

export function getWorkspaceRawFileDownloadName(filePath: string): string {
  return path.basename(filePath).replace(/["\r\n]/g, "_");
}

export async function openWorkspaceRoot({
  resourceId,
  workspaceId,
}: WorkspacePathSelection): Promise<{ path: string }> {
  const resolved = await resolveWorkspacePath("", resourceId, workspaceId);

  if ((resolved.resource.backend || "local_shell") !== "local_shell") {
    throw new Error("只能打开本机项目文件夹。");
  }

  await openLocalFolder(resolved.root);
  return { path: resolved.root };
}

export async function openWorkspaceFile({
  path: requestedPath,
  resourceId,
  workspaceId,
}: ReadWorkspaceFileInput): Promise<{ path: string }> {
  assertReadableWorkspaceFilePath(requestedPath);
  const resolved = await resolveWorkspacePath(
    requestedPath,
    resourceId,
    workspaceId
  );

  if ((resolved.resource.backend || "local_shell") !== "local_shell") {
    throw new Error("只能打开本机项目文件。");
  }

  await assertLocalFile(resolved.absolutePath);
  await openLocalFile(resolved.absolutePath);
  return { path: resolved.absolutePath };
}
