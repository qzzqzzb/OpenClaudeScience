import { NextRequest, NextResponse } from "next/server";
import {
  uploadWorkspaceAttachment,
  WorkspaceAttachmentUploadError,
} from "@/server/domains/workspace/workspaceAttachment.service";

export const runtime = "nodejs";

function formString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const payload = await uploadWorkspaceAttachment({
      resourceId: formString(form.get("resourceId")),
      workspaceId: formString(form.get("workspaceId")),
      threadId: formString(form.get("threadId")),
      workspacePath: formString(form.get("workspacePath")),
      file: file instanceof File ? file : undefined,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload attachment.",
      },
      {
        status:
          error instanceof WorkspaceAttachmentUploadError
            ? error.statusCode
            : 400,
      }
    );
  }
}
