import type {
  WorkspaceFileResponse,
  WorkspaceListResponse,
  WorkspaceSearchResponse,
} from "@/app/types/workspace";
import { buildQuery, requestJson } from "@/app/services/apiClient";

interface WorkspaceScope {
  resourceId?: string;
  workspaceId?: string;
  fallbackMessage?: string;
}

interface WorkspacePathParams extends WorkspaceScope {
  path: string;
}

interface SearchWorkspaceParams extends WorkspaceScope {
  query: string;
  path?: string;
  limit?: number;
  signal?: AbortSignal;
}

interface OpenWorkspacePathResponse {
  path: string;
}

interface UploadWorkspaceAttachmentOptions {
  form: FormData;
  fallbackMessage: string;
}

interface WorkspaceAttachmentUploadResponse<TAttachment> {
  attachment?: TAttachment;
  error?: string;
}

const DEFAULT_LIST_ERROR = "Unable to load workspace files.";
const DEFAULT_FILE_ERROR = "Unable to load file.";
const DEFAULT_RAW_FILE_ERROR = "Unable to read raw file.";
const DEFAULT_SEARCH_ERROR = "Unable to search workspace files.";
const DEFAULT_OPEN_FOLDER_ERROR = "Unable to open workspace folder.";
const DEFAULT_OPEN_FILE_ERROR = "Unable to open local file.";

export function workspaceRawFileUrl({
  path,
  resourceId,
  workspaceId,
}: WorkspacePathParams): string {
  const query = buildQuery({ path, resourceId, workspaceId });
  return `/api/workspace/file/raw?${query.toString()}`;
}

export function listWorkspaceFiles({
  path,
  resourceId,
  workspaceId,
  fallbackMessage = DEFAULT_LIST_ERROR,
}: WorkspacePathParams): Promise<WorkspaceListResponse> {
  const query = buildQuery({ path, resourceId, workspaceId });
  return requestJson<WorkspaceListResponse>(
    `/api/workspace/files?${query.toString()}`,
    fallbackMessage
  );
}

export function getWorkspaceFile({
  path,
  resourceId,
  workspaceId,
  fallbackMessage = DEFAULT_FILE_ERROR,
}: WorkspacePathParams): Promise<WorkspaceFileResponse> {
  const query = buildQuery({ path, resourceId, workspaceId });
  return requestJson<WorkspaceFileResponse>(
    `/api/workspace/file?${query.toString()}`,
    fallbackMessage
  );
}

export async function getWorkspaceRawFileBlob({
  path,
  resourceId,
  workspaceId,
  fallbackMessage = DEFAULT_RAW_FILE_ERROR,
}: WorkspacePathParams): Promise<Blob> {
  const response = await fetch(
    workspaceRawFileUrl({ path, resourceId, workspaceId }),
    { cache: "no-store" }
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error || fallbackMessage);
  }

  return response.blob();
}

export function searchWorkspace({
  query,
  path,
  resourceId,
  workspaceId,
  limit,
  signal,
  fallbackMessage = DEFAULT_SEARCH_ERROR,
}: SearchWorkspaceParams): Promise<WorkspaceSearchResponse> {
  const params = buildQuery({
    query,
    path,
    resourceId,
    workspaceId,
    limit,
  });

  return requestJson<WorkspaceSearchResponse>(
    `/api/workspace/search?${params.toString()}`,
    fallbackMessage,
    { signal }
  );
}

export async function uploadWorkspaceAttachment<TAttachment>({
  form,
  fallbackMessage,
}: UploadWorkspaceAttachmentOptions): Promise<TAttachment> {
  const response = await fetch("/api/workspace/attachments", {
    method: "POST",
    body: form,
  });
  const contentType = response.headers.get("content-type") || "";
  let payload: WorkspaceAttachmentUploadResponse<TAttachment>;
  if (contentType.includes("application/json")) {
    payload = (await response.json().catch(
      () => ({})
    )) as WorkspaceAttachmentUploadResponse<TAttachment>;
  } else {
    const text = (await response.text().catch(() => "")).trim();
    payload = {
      error: text && text !== "Internal Server Error" ? text : fallbackMessage,
    };
  }

  if (!response.ok || !payload.attachment) {
    throw new Error(payload.error || `${fallbackMessage} (${response.status})`);
  }

  return payload.attachment;
}

export function openWorkspaceFolder({
  resourceId,
  workspaceId,
  fallbackMessage = DEFAULT_OPEN_FOLDER_ERROR,
}: WorkspaceScope): Promise<OpenWorkspacePathResponse> {
  return requestJson<OpenWorkspacePathResponse>(
    "/api/workspace/open-folder",
    fallbackMessage,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, workspaceId }),
    }
  );
}

export function openWorkspaceFile({
  path,
  resourceId,
  workspaceId,
  fallbackMessage = DEFAULT_OPEN_FILE_ERROR,
}: WorkspacePathParams): Promise<OpenWorkspacePathResponse> {
  return requestJson<OpenWorkspacePathResponse>(
    "/api/workspace/open-file",
    fallbackMessage,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, resourceId, workspaceId }),
    }
  );
}
