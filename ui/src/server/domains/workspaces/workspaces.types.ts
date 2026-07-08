import type { LocalWorkspace } from "@/app/types/workspace";

export interface WorkspacesResponse {
  cancelled?: boolean;
  defaultWorkspaceId?: string;
  workspaceId?: string;
  workspacePath?: string;
  workspaces?: LocalWorkspace[];
}

export interface SetDefaultWorkspaceInput {
  workspacePath?: unknown;
}

export interface UpdateWorkspaceInput {
  workspaceId?: unknown;
  label?: unknown;
  workspacePath?: unknown;
  chooseFolder?: unknown;
  refreshLabel?: unknown;
}
