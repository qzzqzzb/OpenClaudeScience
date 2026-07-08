import { NextRequest, NextResponse } from "next/server";
import { searchWorkspaceDirectoryFiles } from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query") || searchParams.get("q") || "";
  const requestedPath = searchParams.get("path") || "";
  const resourceId = searchParams.get("resourceId");
  const workspaceId = searchParams.get("workspaceId");
  const limitValue = Number(searchParams.get("limit") || "");

  try {
    const payload = await searchWorkspaceDirectoryFiles({
      query,
      path: requestedPath,
      resourceId,
      workspaceId,
      limit: limitValue,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to search workspace files.",
      },
      { status: 400 }
    );
  }
}
