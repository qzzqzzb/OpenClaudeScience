import { requestJson } from "@/app/services/apiClient";
import type {
  ImportSkillsRequest,
  ImportSkillsResponse,
  SkillConnectionsResponse,
  SkillsConfigResponse,
  UpdateSkillConnectionsRequest,
  UpdateSkillsRequest,
} from "@/app/skills/types";

export interface LocalSkillPickerResponse {
  path?: string;
  cancelled?: boolean;
}

const DEFAULT_SKILLS_LOAD_ERROR = "Unable to load skills.";
const DEFAULT_SKILLS_SAVE_ERROR = "Unable to save skills.";
const DEFAULT_CONNECTIONS_LOAD_ERROR = "Unable to load connections.";
const DEFAULT_CONNECTIONS_SAVE_ERROR = "Unable to save connections.";
const DEFAULT_IMPORT_ERROR = "Unable to import skill.";
const DEFAULT_PICKER_ERROR = "Unable to open local skill folder picker.";

export function loadSkills(
  fallbackMessage = DEFAULT_SKILLS_LOAD_ERROR
): Promise<SkillsConfigResponse> {
  return requestJson<SkillsConfigResponse>("/api/skills", fallbackMessage, {
    cache: "no-store",
  });
}

export function saveSkills(
  body: UpdateSkillsRequest,
  fallbackMessage = DEFAULT_SKILLS_SAVE_ERROR
): Promise<SkillsConfigResponse> {
  return requestJson<SkillsConfigResponse>("/api/skills", fallbackMessage, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function loadSkillConnections(
  fallbackMessage = DEFAULT_CONNECTIONS_LOAD_ERROR
): Promise<SkillConnectionsResponse> {
  return requestJson<SkillConnectionsResponse>(
    "/api/skills/connections",
    fallbackMessage,
    { cache: "no-store" }
  );
}

export function saveSkillConnections(
  body: UpdateSkillConnectionsRequest,
  fallbackMessage = DEFAULT_CONNECTIONS_SAVE_ERROR
): Promise<SkillConnectionsResponse> {
  return requestJson<SkillConnectionsResponse>(
    "/api/skills/connections",
    fallbackMessage,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function importSkills(
  body: ImportSkillsRequest,
  options: {
    fallbackMessage?: string;
    signal?: AbortSignal;
  } = {}
): Promise<ImportSkillsResponse> {
  return requestJson<ImportSkillsResponse>(
    "/api/skills/import",
    options.fallbackMessage || DEFAULT_IMPORT_ERROR,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify(body),
    }
  );
}

export function pickLocalSkillFolder(
  fallbackMessage = DEFAULT_PICKER_ERROR
): Promise<LocalSkillPickerResponse> {
  return requestJson<LocalSkillPickerResponse>(
    "/api/skills/local-picker",
    fallbackMessage,
    { method: "POST" }
  );
}
