import {
  readSkillsConfig,
  updateSkillsConfig,
} from "@/app/api/skills/_lib/skills";
import type { SkillsConfigResponse } from "../skills.types";

export async function readSkillSettings(): Promise<SkillsConfigResponse> {
  return readSkillsConfig();
}

export async function writeSkillSettings(
  enabled: boolean,
  selected: string[]
): Promise<SkillsConfigResponse> {
  return updateSkillsConfig(enabled, selected);
}
