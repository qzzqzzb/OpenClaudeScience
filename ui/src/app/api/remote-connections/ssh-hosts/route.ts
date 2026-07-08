import { NextResponse } from "next/server";
import { getRemoteSshHosts } from "@/server/domains/remote/remote.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ hosts: await getRemoteSshHosts() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取 SSH config。",
      },
      { status: 500 }
    );
  }
}
