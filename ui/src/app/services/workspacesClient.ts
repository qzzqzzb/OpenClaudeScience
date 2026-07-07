import { buildQuery, requestJson } from "@/app/services/apiClient";
import type { LocalWorkspace } from "@/app/types/workspace";

export interface WorkspacesResponse {
  cancelled?: boolean;
  defaultWorkspaceId?: string;
  workspaceId?: string;
  workspacePath?: string;
  workspaces?: LocalWorkspace[];
}

export interface UpdateWorkspaceRequest {
  workspaceId: string;
  label?: string;
  workspacePath?: string;
  chooseFolder?: boolean;
  refreshLabel?: boolean;
}

const DEFAULT_LIST_ERROR = "Unable to load workspaces.";
const DEFAULT_PICK_ERROR = "Unable to pick workspace.";
const DEFAULT_SET_DEFAULT_ERROR = "Unable to switch workspace.";
const DEFAULT_UPDATE_ERROR = "Unable to update workspace.";
const DEFAULT_REMOVE_ERROR = "Unable to remove workspace.";

export function listWorkspaces(
  fallbackMessage = DEFAULT_LIST_ERROR
): Promise<WorkspacesResponse> {
  return requestJson<WorkspacesResponse>("/api/workspaces", fallbackMessage, {
    cache: "no-store",
  });
}

export function pickWorkspace(
  fallbackMessage = DEFAULT_PICK_ERROR
): Promise<WorkspacesResponse> {
  return requestJson<WorkspacesResponse>("/api/workspaces", fallbackMessage, {
    method: "POST",
  });
}

export function setDefaultWorkspace(
  workspacePath: string,
  fallbackMessage = DEFAULT_SET_DEFAULT_ERROR
): Promise<WorkspacesResponse> {
  return requestJson<WorkspacesResponse>("/api/workspaces", fallbackMessage, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspacePath }),
  });
}

export function updateWorkspace(
  body: UpdateWorkspaceRequest,
  fallbackMessage = DEFAULT_UPDATE_ERROR
): Promise<WorkspacesResponse> {
  return requestJson<WorkspacesResponse>("/api/workspaces", fallbackMessage, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function removeWorkspace(
  workspaceId: string,
  fallbackMessage = DEFAULT_REMOVE_ERROR
): Promise<WorkspacesResponse> {
  const query = buildQuery({ id: workspaceId });
  return requestJson<WorkspacesResponse>(
    `/api/workspaces?${query.toString()}`,
    fallbackMessage,
    { method: "DELETE" }
  );
}
