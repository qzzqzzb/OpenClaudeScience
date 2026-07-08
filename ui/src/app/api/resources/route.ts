import { NextResponse } from "next/server";
import { getResources } from "@/server/domains/resources/resources.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getResources());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取机器资源。",
      },
      { status: 500 }
    );
  }
}
