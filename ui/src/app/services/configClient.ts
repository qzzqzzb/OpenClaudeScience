import { requestJson } from "@/app/services/apiClient";
import type { UiLanguage } from "@/lib/i18n";

export type AuthorizationMode = "auto" | "write" | "all";
export type ModelSelectionMode = "auto" | "manual";
export type ModelProvider = "openai_compatible";
export type OnboardingMissing = "openaiCompatibleApiKey";

export interface ConfigResponse {
  configPath: string;
  envPath: string;
  modelProvider: ModelProvider;
  model: string;
  modelSelectionMode: ModelSelectionMode;
  autoModel: string;
  effectiveModel: string;
  openaiCompatibleModel: string;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleApiKey: string;
  openaiCompatibleApiKeySet: boolean;
  openaiCompatibleApiKeyPreview: string;
  authorizationMode: AuthorizationMode;
  language: UiLanguage;
  desktopMode: boolean;
  needsOnboarding: boolean;
  onboardingSkipped: boolean;
  missing: OnboardingMissing[];
  workspaceError?: string;
  message?: string;
}

export interface ConfigStatus {
  desktopMode?: boolean;
  needsOnboarding?: boolean;
}

export interface SaveConfigRequest {
  model?: string;
  modelProvider?: ModelProvider;
  modelSelectionMode?: ModelSelectionMode;
  openaiCompatibleApiKey?: string;
  openaiCompatibleBaseUrl?: string;
  openrouterApiKey?: string;
  authorizationMode?: AuthorizationMode;
  workspacePath?: string;
  language?: UiLanguage;
  onboardingSkipped?: boolean;
}

interface LoadConfigOptions {
  baseUrl?: string;
  fallbackMessage?: string;
}

const DEFAULT_LOAD_ERROR = "Unable to load config.";
const DEFAULT_SAVE_ERROR = "Unable to save config.";

function configUrl(baseUrl?: string) {
  return baseUrl ? new URL("/api/config", baseUrl).toString() : "/api/config";
}

export function loadConfig<T = ConfigResponse>({
  baseUrl,
  fallbackMessage = DEFAULT_LOAD_ERROR,
}: LoadConfigOptions = {}): Promise<T> {
  return requestJson<T>(configUrl(baseUrl), fallbackMessage, {
    cache: "no-store",
  });
}

export function saveConfig<T = ConfigResponse>(
  body: SaveConfigRequest,
  fallbackMessage = DEFAULT_SAVE_ERROR
): Promise<T> {
  return requestJson<T>("/api/config", fallbackMessage, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function shouldOpenOnboarding(): Promise<boolean> {
  try {
    const payload = await loadConfig<ConfigStatus>();
    return payload.desktopMode === true && payload.needsOnboarding === true;
  } catch {
    return false;
  }
}
