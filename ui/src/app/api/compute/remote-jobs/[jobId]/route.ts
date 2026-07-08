import { NextRequest, NextResponse } from "next/server";
import { getComputeJobSnapshot } from "@/server/domains/compute/compute.service";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const job = await getComputeJobSnapshot(jobId);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remote job lookup failed." },
      { status: 404 }
    );
  }
}
