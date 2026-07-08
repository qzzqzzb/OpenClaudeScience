import { NextResponse } from "next/server";
import { getCurrentUpdateStatus } from "@/server/domains/update/update.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getCurrentUpdateStatus();
  return NextResponse.json(status);
}
