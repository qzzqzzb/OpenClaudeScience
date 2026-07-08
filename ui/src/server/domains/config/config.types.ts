export type AuthorizationMode = "auto" | "write" | "all";
export type ModelSelectionMode = "manual";
export type ModelProvider = "openai_compatible";
export type StoredModelProvider =
  | ModelProvider
  | "openai"
  | "openrouter"
  | "gateway";
export type OnboardingMissing = "openaiCompatibleApiKey";
export type UiLanguage = "zh" | "en";

export interface AgentConfig {
  interrupt_on?: Record<string, unknown>;
  authorization_mode?: AuthorizationMode;
  model_provider?: StoredModelProvider;
  model_selection_mode?: ModelSelectionMode | "auto";
  manual_model?: string;
  openai_compatible_model?: string;
  openai_compatible_base_url?: string;
  openrouter_direct_enabled?: boolean;
  openrouter_model?: string;
  gateway_base_url?: string;
  gateway_model?: string;
  onboarding_skipped?: boolean;
  ui_language?: UiLanguage;
  [key: string]: unknown;
}

export interface UpdateConfigRequest {
  modelProvider?: unknown;
  model?: unknown;
  modelSelectionMode?: unknown;
  openaiCompatibleApiKey?: unknown;
  openaiCompatibleBaseUrl?: unknown;
  openrouterApiKey?: unknown;
  authorizationMode?: unknown;
  workspacePath?: unknown;
  language?: unknown;
  onboardingSkipped?: unknown;
}

export interface ConfigResponse {
  configPath: string;
  envPath: string;
  resourcesPath: string;
  workspacePath: string;
  workspaceResolvedPath: string;
  workspaceError?: string;
  modelProvider: ModelProvider;
  model: string;
  modelSelectionMode: ModelSelectionMode;
  effectiveModel: string;
  autoModel: string;
  openaiCompatibleModel: string;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleApiKey: string;
  openaiCompatibleApiKeySet: boolean;
  openaiCompatibleApiKeyPreview: string;
  openrouterModel: string;
  openrouterApiKey: string;
  openrouterApiKeySet: boolean;
  openrouterApiKeyPreview: string;
  authorizationMode: AuthorizationMode;
  language: UiLanguage;
  desktopMode: boolean;
  onboardingSkipped: boolean;
  needsOnboarding: boolean;
  missing: OnboardingMissing[];
  message?: string;
}

export type EnvValues = Record<string, string>;
export type EnvUpdates = Record<string, string | null>;
