import { NextResponse } from "next/server";
import {
  pickLocalSkillFolder,
  isUserCancelled,
} from "@/server/domains/skills/skills.service";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await pickLocalSkillFolder());
  } catch (error) {
    if (isUserCancelled(error)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      {
        error: "无法打开本地文件夹选择器，请手动粘贴本地技能路径。",
      },
      { status: 500 }
    );
  }
}
