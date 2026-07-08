import { NextRequest, NextResponse } from "next/server";
import {
  getWorkspaceRawFileDownloadName,
  getWorkspaceRawFileMimeType,
  readWorkspaceRawFileContent,
  WorkspaceRangeNotSatisfiableError,
} from "@/server/domains/workspace/workspace.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    const fileData = await readWorkspaceRawFileContent({
      path: requestedPath,
      resourceId,
      workspaceId,
      rangeHeader: request.headers.get("range"),
    });

    if (fileData.kind === "stream") {
      const headers: Record<string, string> = {
        "Content-Type": getWorkspaceRawFileMimeType(fileData.path),
        "Content-Disposition": `inline; filename="${getWorkspaceRawFileDownloadName(
          fileData.path
        )}"`,
        "Cache-Control": "no-store",
        "Content-Length": String(fileData.contentLength),
        "Accept-Ranges": "bytes",
      };
      if (fileData.range) {
        headers[
          "Content-Range"
        ] = `bytes ${fileData.range.start}-${fileData.range.end}/${fileData.size}`;
      }

      return new NextResponse(fileData.stream, {
        status: fileData.range ? 206 : 200,
        headers,
      });
    }

    const body = new Uint8Array(fileData.data);

    return new NextResponse(body, {
      headers: {
        "Content-Type": getWorkspaceRawFileMimeType(fileData.path),
        "Content-Disposition": `inline; filename="${getWorkspaceRawFileDownloadName(
          fileData.path
        )}"`,
        "Cache-Control": "no-store",
        "Content-Length": String(fileData.data.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceRangeNotSatisfiableError) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${error.size}`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to stream workspace file.",
      },
      { status: 400 }
    );
  }
}
