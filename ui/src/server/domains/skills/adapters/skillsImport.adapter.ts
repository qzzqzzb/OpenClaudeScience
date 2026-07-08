import { importSkills } from "@/app/api/skills/_lib/skills";
import type {
  ImportSkillsResponse,
  SkillImportType,
} from "../skills.types";

export async function importSkillCatalog(
  type: SkillImportType,
  source: string
): Promise<ImportSkillsResponse> {
  return importSkills(type, source);
}
