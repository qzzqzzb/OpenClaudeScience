import { NextRequest, NextResponse } from "next/server";
import {
  getComputeJobs,
  submitRemoteComputeJob,
} from "@/server/domains/compute/compute.service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ jobs: await getComputeJobs() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const job = await submitRemoteComputeJob(request, body);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remote job submit failed." },
      { status: 400 }
    );
  }
}
