import {
  readWorkspaceFileData as legacyReadWorkspaceFileData,
  readWorkspaceRawFile as legacyReadWorkspaceRawFile,
  streamLocalWorkspaceRawFile as legacyStreamLocalWorkspaceRawFile,
  writeWorkspaceRawFile as legacyWriteWorkspaceRawFile,
} from "@/app/api/workspace/_lib/workspace";
import type {
  WorkspaceFileData,
  WorkspaceRawFileBufferData,
  WorkspaceRawFileStreamData,
} from "../workspace.types";

export async function readWorkspaceFileData(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  return legacyReadWorkspaceFileData(
    relativePath,
    resourceId,
    workspaceId
  ) as Promise<WorkspaceFileData>;
}

export async function streamLocalWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null,
  rangeHeader?: string | null
): Promise<WorkspaceRawFileStreamData> {
  return legacyStreamLocalWorkspaceRawFile(
    relativePath,
    resourceId,
    workspaceId,
    rangeHeader
  ) as Promise<WorkspaceRawFileStreamData>;
}

export async function readWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceRawFileBufferData> {
  return legacyReadWorkspaceRawFile(
    relativePath,
    resourceId,
    workspaceId
  ) as Promise<WorkspaceRawFileBufferData>;
}

export async function writeWorkspaceRawFile(
  relativePath: string,
  data: Buffer,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  return legacyWriteWorkspaceRawFile(
    relativePath,
    data,
    resourceId,
    workspaceId
  ) as Promise<WorkspaceFileData>;
}
