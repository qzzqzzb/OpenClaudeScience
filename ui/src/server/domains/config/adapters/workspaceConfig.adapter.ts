import {
  getResourcesConfigPath,
  getWorkspaceResource,
  resolveWorkspacePath,
  updateLocalResourceWorkspace,
} from "@/server/domains/workspace/adapters/workspaceFs.adapter";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";

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
