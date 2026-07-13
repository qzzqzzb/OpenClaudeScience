import {
  readSkillsConfig,
  updateSkillsConfig,
} from "./skillsInfrastructure.adapter";
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
