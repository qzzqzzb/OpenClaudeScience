import { NextRequest, NextResponse } from "next/server";
import {
  listLocalWorkspaceEntriesFromResolvedPath,
  listWorkspaceEntries,
  resolveWorkspacePath,
} from "../_lib/workspace";
import type { WorkspaceListResponse } from "@/app/types/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestedPath = searchParams.get("path") || "";
  const resourceId = searchParams.get("resourceId");
  const workspaceId = searchParams.get("workspaceId");

  try {
    const resolved = await resolveWorkspacePath(
      requestedPath,
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
      : await listWorkspaceEntries(resolved.relativePath, resourceId, workspaceId);
    const payload: WorkspaceListResponse = {
      path: resolved.relativePath,
      entries,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to list workspace files.",
      },
      { status: 400 }
    );
  }
}
