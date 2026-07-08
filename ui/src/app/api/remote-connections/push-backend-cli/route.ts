import { NextRequest, NextResponse } from "next/server";
import { createPushRemoteBackendCliStream } from "@/server/domains/remote/remote.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid request body.",
      },
      { status: 400 }
    );
  }

  const stream = createPushRemoteBackendCliStream(body);

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
