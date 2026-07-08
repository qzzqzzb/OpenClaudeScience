import { NextRequest, NextResponse } from "next/server";
import { openWorkspaceRoot } from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      resourceId?: unknown;
      workspaceId?: unknown;
    };
    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId : undefined;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : undefined;
    const payload = await openWorkspaceRoot({ resourceId, workspaceId });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开项目文件夹。",
      },
      { status: 500 }
    );
  }
}
