import type {
  WorkspaceFileResponse,
  WorkspaceListResponse,
  WorkspaceSearchResponse,
} from "@/app/types/workspace";

export interface WorkspaceSelection {
  resourceId?: string | null;
  workspaceId?: string | null;
}

export interface WorkspacePathSelection extends WorkspaceSelection {
  path?: string;
}

export interface SearchWorkspaceFilesInput extends WorkspacePathSelection {
  query?: string;
  limit?: number;
}

export interface ReadWorkspaceFileInput extends WorkspaceSelection {
  path: string;
}

export interface ReadWorkspaceRawFileInput extends ReadWorkspaceFileInput {
  rangeHeader?: string | null;
}

export interface WorkspaceFileData {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isFile: boolean;
  content?: string;
  tooLarge?: boolean;
  dataBase64?: string;
}

export interface WorkspaceByteRange {
  start: number;
  end: number;
}

export interface WorkspaceRawFileStreamData extends WorkspaceFileData {
  stream: ReadableStream<Uint8Array>;
  contentLength: number;
  range?: WorkspaceByteRange;
}

export interface WorkspaceRawFileBufferData extends WorkspaceFileData {
  data: Buffer;
}

export type WorkspaceRawFileResult =
  | ({ kind: "stream" } & WorkspaceRawFileStreamData)
  | ({ kind: "buffer" } & WorkspaceRawFileBufferData);

export type ListWorkspaceDirectoryOutput = WorkspaceListResponse;
export type SearchWorkspaceFilesOutput = WorkspaceSearchResponse;
export type ReadWorkspaceFileOutput = WorkspaceFileResponse;
