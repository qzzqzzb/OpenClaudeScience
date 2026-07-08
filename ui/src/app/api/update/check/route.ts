import { NextResponse } from "next/server";
import { checkForAvailableUpdate } from "@/server/domains/update/update.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await checkForAvailableUpdate();
  return NextResponse.json(status, {
    status: status.state === "failed" ? 502 : 200,
  });
}
