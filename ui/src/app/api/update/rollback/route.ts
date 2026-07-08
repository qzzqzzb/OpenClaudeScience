import { NextResponse } from "next/server";
import { rollbackCurrentUpdate } from "@/server/domains/update/update.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await rollbackCurrentUpdate();

  return NextResponse.json(status, {
    status: status.state === "failed" ? 500 : 200,
  });
}
