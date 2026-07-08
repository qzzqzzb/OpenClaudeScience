import { NextRequest, NextResponse } from "next/server";
import {
  getSkillConnections,
  updateSkillConnections,
} from "@/server/domains/skills/skills.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getSkillConnections());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "连接配置读取失败。",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    return NextResponse.json(await updateSkillConnections(await request.json()));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "连接配置保存失败。",
      },
      { status: 500 }
    );
  }
}
