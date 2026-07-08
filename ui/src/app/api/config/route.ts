import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  updateConfig,
} from "@/server/domains/config/config.service";
import type { UpdateConfigRequest } from "@/server/domains/config/config.types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getConfig());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "配置读取失败。",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateConfigRequest;
    return NextResponse.json(await updateConfig(body));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "配置保存失败。",
      },
      { status: 500 }
    );
  }
}
