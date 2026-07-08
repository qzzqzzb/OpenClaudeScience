import { NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspace,
  getWorkspaces,
  isUserCancelled,
  pickWorkspace,
  setDefaultWorkspace,
  updateWorkspace,
  WorkspacesRequestError,
} from "@/server/domains/workspaces/workspaces.service";
import type {
  SetDefaultWorkspaceInput,
  UpdateWorkspaceInput,
} from "@/server/domains/workspaces/workspaces.types";

export const runtime = "nodejs";

function errorStatus(error: unknown): number {
  return error instanceof WorkspacesRequestError ? error.statusCode : 500;
}

export async function GET() {
  try {
    return NextResponse.json(await getWorkspaces());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取项目列表。",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as SetDefaultWorkspaceInput;
    return NextResponse.json(await setDefaultWorkspace(body));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法切换项目。",
      },
      { status: errorStatus(error) }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateWorkspaceInput;
    return NextResponse.json(await updateWorkspace(body));
  } catch (error) {
    if (isUserCancelled(error)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法更新项目。",
      },
      { status: errorStatus(error) }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("id")?.trim() || "";
    return NextResponse.json(await deleteWorkspace(workspaceId));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法移除项目。",
      },
      { status: errorStatus(error) }
    );
  }
}

export async function POST() {
  try {
    return NextResponse.json(await pickWorkspace());
  } catch (error) {
    if (isUserCancelled(error)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开本地项目选择器。",
      },
      { status: 500 }
    );
  }
}
