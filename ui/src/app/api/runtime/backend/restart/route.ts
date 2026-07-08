import { NextResponse } from "next/server";
import { restartRuntime } from "@/server/domains/runtime/runtime.service";

export const runtime = "nodejs";

export async function POST() {
  const result = await restartRuntime();
  return NextResponse.json(result, {
    status: result.status === "restarted" ? 200 : 500,
  });
}
