import {
  chooseWorkspaceFolder,
  isUserCancelled,
} from "./adapters/folderPicker.adapter";
import {
  listLocalWorkspaces,
  removeLocalWorkspace,
  updateLocalResourceWorkspace,
  updateLocalWorkspaceRecord,
} from "./adapters/workspaces.adapter";
import type {
  SetDefaultWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspacesResponse,
} from "./workspaces.types";

export { isUserCancelled };

export class WorkspacesRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "WorkspacesRequestError";
    this.statusCode = statusCode;
  }
}

export async function getWorkspaces(): Promise<WorkspacesResponse> {
  return listLocalWorkspaces();
}

export async function setDefaultWorkspace({
  workspacePath,
}: SetDefaultWorkspaceInput): Promise<WorkspacesResponse> {
  const normalizedWorkspacePath =
    typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (!normalizedWorkspacePath) {
    throw new Error("项目路径不能为空。");
  }

  await updateLocalResourceWorkspace(normalizedWorkspacePath);
  return listLocalWorkspaces();
}

export async function updateWorkspace({
  workspaceId,
  label,
  workspacePath,
  chooseFolder,
  refreshLabel,
}: UpdateWorkspaceInput): Promise<WorkspacesResponse> {
  const normalizedWorkspaceId =
    typeof workspaceId === "string" ? workspaceId.trim() : "";
  if (!normalizedWorkspaceId) {
    throw new WorkspacesRequestError("项目 ID 不能为空。", 400);
  }

  let nextWorkspacePath =
    typeof workspacePath === "string" ? workspacePath.trim() : "";
  if (chooseFolder === true) {
    const selectedPath = await chooseWorkspaceFolder("重新选择项目文件夹");
    if (!selectedPath) {
      return { cancelled: true };
    }
    nextWorkspacePath = selectedPath;
  }

  return updateLocalWorkspaceRecord(normalizedWorkspaceId, {
    label: typeof label === "string" ? label : undefined,
    workspacePath: nextWorkspacePath || undefined,
    refreshLabel: refreshLabel === true,
  });
}

export async function deleteWorkspace(
  workspaceId: string
): Promise<WorkspacesResponse> {
  const normalizedWorkspaceId = workspaceId.trim();
  if (!normalizedWorkspaceId) {
    throw new WorkspacesRequestError("项目 ID 不能为空。", 400);
  }

  return removeLocalWorkspace(normalizedWorkspaceId);
}

export async function pickWorkspace(): Promise<WorkspacesResponse> {
  const selectedPath = await chooseWorkspaceFolder("选择本机项目文件夹");
  if (!selectedPath) {
    return { cancelled: true };
  }

  const updated = await updateLocalResourceWorkspace(selectedPath);
  const localWorkspaces = await listLocalWorkspaces();
  return {
    ...localWorkspaces,
    workspaceId: updated.workspaceId,
    workspacePath: updated.workspacePath,
  };
}
