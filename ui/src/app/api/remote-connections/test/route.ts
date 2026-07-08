import { NextRequest, NextResponse } from "next/server";
import { testRemoteConnection } from "@/server/domains/remote/remote.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      connectionMode?: unknown;
      host?: unknown;
      sshCommand?: unknown;
    };
    const result = await testRemoteConnection(body);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : "SSH 测试失败。",
      },
      { status: 400 }
    );
  }
}
