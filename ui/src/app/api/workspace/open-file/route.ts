import { NextRequest, NextResponse } from "next/server";
import { openWorkspaceFile } from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      path?: unknown;
      resourceId?: unknown;
      workspaceId?: unknown;
    };
    const requestedPath = typeof body.path === "string" ? body.path : "";
    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId : undefined;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : undefined;

    const payload = await openWorkspaceFile({
      path: requestedPath,
      resourceId,
      workspaceId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开本地文件。",
      },
      { status: 500 }
    );
  }
}
