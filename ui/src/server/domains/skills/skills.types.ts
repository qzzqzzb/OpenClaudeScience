import type {
  ImportSkillsResponse,
  SkillConnectionsResponse,
  SkillImportType,
  SkillsConfigResponse,
  UpdateSkillConnectionsRequest,
} from "@/app/skills/types";

export type {
  ImportSkillsResponse,
  SkillConnectionsResponse,
  SkillImportType,
  SkillsConfigResponse,
  UpdateSkillConnectionsRequest,
};

export interface UpdateSkillsInput {
  enabled?: unknown;
  selected?: unknown;
}

export interface ImportSkillsInput {
  type?: unknown;
  source?: unknown;
}

export interface LocalSkillFolderSelection {
  cancelled?: boolean;
  path?: string;
}

export type EnvUpdates = Record<string, string | null>;
