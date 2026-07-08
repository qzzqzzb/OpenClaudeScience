import { NextRequest, NextResponse } from "next/server";
import { readWorkspaceFile } from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    const payload = await readWorkspaceFile({
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
            : "Unable to read workspace file.",
      },
      { status: 400 }
    );
  }
}
