import {
  readWorkspaceFileData as legacyReadWorkspaceFileData,
  readWorkspaceRawFile as legacyReadWorkspaceRawFile,
  streamLocalWorkspaceRawFile as legacyStreamLocalWorkspaceRawFile,
  writeWorkspaceRawFile as legacyWriteWorkspaceRawFile,
} from "@/app/api/workspace/_lib/workspace";
import type {
  ReadWorkspaceFileInput,
  ReadWorkspaceRawFileInput,
  WorkspaceFileAdapter,
  WorkspaceFileData,
  WorkspaceRawFileBufferData,
  WorkspaceRawFileStreamData,
} from "../workspace.types";

export const workspaceFileAdapter: WorkspaceFileAdapter = {
  async readFile({
    path: relativePath,
    resourceId,
    workspaceId,
  }: ReadWorkspaceFileInput): Promise<WorkspaceFileData> {
    return legacyReadWorkspaceFileData(
      relativePath,
      resourceId,
      workspaceId
    ) as Promise<WorkspaceFileData>;
  },

  async streamLocalRawFile({
    path: relativePath,
    resourceId,
    workspaceId,
    rangeHeader,
  }: ReadWorkspaceRawFileInput): Promise<WorkspaceRawFileStreamData> {
    return legacyStreamLocalWorkspaceRawFile(
      relativePath,
      resourceId,
      workspaceId,
      rangeHeader
    ) as Promise<WorkspaceRawFileStreamData>;
  },

  async readRawFile({
    path: relativePath,
    resourceId,
    workspaceId,
  }: ReadWorkspaceFileInput): Promise<WorkspaceRawFileBufferData> {
    return legacyReadWorkspaceRawFile(
      relativePath,
      resourceId,
      workspaceId
    ) as Promise<WorkspaceRawFileBufferData>;
  },

  async writeRawFile({
    path: relativePath,
    data,
    resourceId,
    workspaceId,
  }): Promise<WorkspaceFileData> {
    return legacyWriteWorkspaceRawFile(
      relativePath,
      data,
      resourceId,
      workspaceId
    ) as Promise<WorkspaceFileData>;
  },
};

export async function readWorkspaceFileData(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  return workspaceFileAdapter.readFile({
    path: relativePath,
    resourceId,
    workspaceId,
  });
}

export async function streamLocalWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null,
  rangeHeader?: string | null
): Promise<WorkspaceRawFileStreamData> {
  return workspaceFileAdapter.streamLocalRawFile({
    path: relativePath,
    resourceId,
    workspaceId,
    rangeHeader,
  });
}

export async function readWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceRawFileBufferData> {
  return workspaceFileAdapter.readRawFile({
    path: relativePath,
    resourceId,
    workspaceId,
  });
}

export async function writeWorkspaceRawFile(
  relativePath: string,
  data: Buffer,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  return workspaceFileAdapter.writeRawFile({
    path: relativePath,
    data,
    resourceId,
    workspaceId,
  });
}
