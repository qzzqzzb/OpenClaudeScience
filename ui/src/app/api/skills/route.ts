import { NextRequest, NextResponse } from "next/server";
import {
  getSkillsConfig,
  updateSkills,
} from "@/server/domains/skills/skills.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getSkillsConfig());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load skills configuration.",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    return NextResponse.json(await updateSkills(await request.json()));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save skills configuration.",
      },
      { status: 500 }
    );
  }
}
