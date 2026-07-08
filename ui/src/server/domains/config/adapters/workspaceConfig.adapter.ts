import {
  getResourcesConfigPath,
  getWorkspaceResource,
  getWorkspaceRoot,
  resolveWorkspacePath,
  updateLocalResourceWorkspace,
} from "@/app/api/workspace/_lib/workspace";

export function getConfigWorkspaceRoot(): string {
  return getWorkspaceRoot();
}

export function getWorkspaceResourcesPath(): string {
  return getResourcesConfigPath();
}

export function getCurrentLocalWorkspacePath(): string {
  return getWorkspaceResource("local").workspace || ".";
}

export async function resolveLocalWorkspaceRoot(): Promise<string> {
  const resolved = await resolveWorkspacePath("", "local");
  return resolved.root;
}

export async function updateLocalWorkspacePath(
  workspacePath: string
): Promise<void> {
  await updateLocalResourceWorkspace(workspacePath);
}
