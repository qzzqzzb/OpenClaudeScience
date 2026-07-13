import {
  getWorkspaceResource,
  resolveWorkspacePath as legacyResolveWorkspacePath,
} from "./workspaceFs.adapter";
import type { ResourceRecord } from "./workspaceFs.adapter";

export interface ResolvedWorkspacePath {
  root: string;
  absolutePath: string;
  relativePath: string;
  resource: ResourceRecord;
}

export function isLocalWorkspaceResource(resourceId?: string | null): boolean {
  const resource = getWorkspaceResource(resourceId);
  return (resource.backend || "local_shell") === "local_shell";
}

export async function resolveWorkspacePath(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<ResolvedWorkspacePath> {
  return legacyResolveWorkspacePath(
    relativePath,
    resourceId,
    workspaceId
  ) as Promise<ResolvedWorkspacePath>;
}
