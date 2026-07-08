import {
  chooseLocalSkillFolder,
  isUserCancelled,
} from "./adapters/skillFolderPicker.adapter";
import {
  readSkillSettings,
  writeSkillSettings,
} from "./adapters/skillsConfigFile.adapter";
import { importSkillCatalog } from "./adapters/skillsImport.adapter";
import {
  readSkillConnections,
  writeSkillConnections,
} from "./adapters/skillConnections.adapter";
import type {
  ImportSkillsInput,
  ImportSkillsResponse,
  LocalSkillFolderSelection,
  SkillConnectionsResponse,
  SkillsConfigResponse,
  SkillImportType,
  UpdateSkillConnectionsRequest,
  UpdateSkillsInput,
} from "./skills.types";

export { isUserCancelled };

export class SkillsRequestError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SkillsRequestError";
    this.statusCode = statusCode;
  }
}

export async function getSkillsConfig(): Promise<SkillsConfigResponse> {
  return readSkillSettings();
}

export async function updateSkills(
  body: UpdateSkillsInput
): Promise<SkillsConfigResponse> {
  const selected = Array.isArray(body.selected) ? body.selected : [];
  const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
  const skillsConfig = await writeSkillSettings(enabled, selected);

  return {
    ...skillsConfig,
    requiresRestart: true,
    message: "技能配置已保存，应用后生效。",
  };
}

function normalizeImportType(value: unknown): SkillImportType {
  if (value === "local" || value === "cloud") {
    return value;
  }
  throw new SkillsRequestError("请选择本地技能或云端技能。", 400);
}

export async function importSkillsFromSource(
  body: ImportSkillsInput
): Promise<ImportSkillsResponse> {
  const type = normalizeImportType(body.type);
  const source = typeof body.source === "string" ? body.source.trim() : "";

  if (!source) {
    throw new SkillsRequestError("请输入技能来源。", 400);
  }

  return importSkillCatalog(type, source);
}

export async function pickLocalSkillFolder(): Promise<LocalSkillFolderSelection> {
  const selectedPath = await chooseLocalSkillFolder();

  if (!selectedPath) {
    return { cancelled: true };
  }

  return { path: selectedPath };
}

export async function getSkillConnections(): Promise<SkillConnectionsResponse> {
  return readSkillConnections();
}

export async function updateSkillConnections(
  body: Partial<UpdateSkillConnectionsRequest>
): Promise<SkillConnectionsResponse> {
  return writeSkillConnections(body);
}
