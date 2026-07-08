import { NextRequest, NextResponse } from "next/server";
import { listWorkspaceDirectory } from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requestedPath = searchParams.get("path") || "";
  const resourceId = searchParams.get("resourceId");
  const workspaceId = searchParams.get("workspaceId");

  try {
    const payload = await listWorkspaceDirectory({
      path: requestedPath,
      resourceId,
      workspaceId,
    });

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
