import { NextRequest, NextResponse } from "next/server";
import {
  importSkillsFromSource,
  SkillsRequestError,
} from "@/server/domains/skills/skills.service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    return NextResponse.json(await importSkillsFromSource(await request.json()));
  } catch (error) {
    if (error instanceof SkillsRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "技能添加失败，请检查来源。",
      },
      { status: 500 }
    );
  }
}
