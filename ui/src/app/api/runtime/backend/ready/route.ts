import { NextRequest, NextResponse } from "next/server";
import {
  checkRuntimeBackendReady,
  RuntimeRequestError,
} from "@/server/domains/runtime/runtime.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const deploymentUrl = request.nextUrl.searchParams.get("url")?.trim() || "";

  try {
    return NextResponse.json(await checkRuntimeBackendReady(deploymentUrl));
  } catch (error) {
    if (error instanceof RuntimeRequestError) {
      return NextResponse.json(error.payload, { status: error.statusCode });
    }

    return NextResponse.json({ ready: false });
  }
}
