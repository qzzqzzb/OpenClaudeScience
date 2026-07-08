import {
  listLocalWorkspaceEntriesFromResolvedPath,
  listWorkspaceEntries as legacyListWorkspaceEntries,
  searchWorkspaceFiles as legacySearchWorkspaceFiles,
} from "@/app/api/workspace/_lib/workspace";
import type { WorkspaceEntry } from "@/app/types/workspace";
import { resolveWorkspacePath } from "./workspacePath.adapter";

export async function listWorkspaceDirectoryEntries(
  relativePath = "",
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<{ path: string; entries: WorkspaceEntry[] }> {
  const resolved = await resolveWorkspacePath(
    relativePath,
    resourceId,
    workspaceId
  );
  const isLocalWorkspace =
    (resolved.resource.backend || "local_shell") === "local_shell";
  const entries = isLocalWorkspace
    ? await listLocalWorkspaceEntriesFromResolvedPath(
        resolved,
        resourceId,
        workspaceId
      )
    : await legacyListWorkspaceEntries(
        resolved.relativePath,
        resourceId,
        workspaceId
      );

  return {
    path: resolved.relativePath,
    entries,
  };
}

export async function searchWorkspaceFiles(
  query = "",
  resourceId?: string | null,
  workspaceId?: string | null,
  options: {
    relativePath?: string;
    maxResults?: number;
  } = {}
): Promise<WorkspaceEntry[]> {
  return legacySearchWorkspaceFiles(query, resourceId, workspaceId, options);
}
