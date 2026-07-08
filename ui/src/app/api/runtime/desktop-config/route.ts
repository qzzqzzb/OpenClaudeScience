import { NextResponse } from "next/server";
import { getDesktopRuntimeConfigScript } from "@/server/domains/runtime/runtime.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new NextResponse(await getDesktopRuntimeConfigScript(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
