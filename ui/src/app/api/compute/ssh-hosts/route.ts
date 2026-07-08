import { NextRequest, NextResponse } from "next/server";
import {
  getComputeHosts,
  upsertComputeHost,
} from "@/server/domains/compute/compute.service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ hosts: await getComputeHosts() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const host = await upsertComputeHost(request, body);
    return NextResponse.json({ host });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SSH host setup failed." },
      { status: 400 }
    );
  }
}
