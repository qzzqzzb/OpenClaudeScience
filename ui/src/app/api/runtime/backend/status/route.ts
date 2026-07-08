import { NextResponse } from "next/server";
import { getRuntimeStatus } from "@/server/domains/runtime/runtime.service";

export const runtime = "nodejs";

export async function GET() {
  const result = await getRuntimeStatus();
  return NextResponse.json(result, {
    status: result.status === "unavailable" ? 503 : 200,
  });
}
