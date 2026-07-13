import { importSkills } from "./skillsInfrastructure.adapter";
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
