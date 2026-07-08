import {
  getAgentConfigPath,
  readAgentConfig,
  writeAgentConfig,
} from "./adapters/configFile.adapter";
import {
  getAgentEnvPath,
  readEnvValues,
  writeEnvValues,
} from "./adapters/envFile.adapter";
import {
  getCurrentLocalWorkspacePath,
  getWorkspaceResourcesPath,
  resolveLocalWorkspaceRoot,
  updateLocalWorkspacePath,
} from "./adapters/workspaceConfig.adapter";
import type {
  AgentConfig,
  AuthorizationMode,
  ConfigResponse,
  EnvUpdates,
  EnvValues,
  ModelProvider,
  ModelSelectionMode,
  OnboardingMissing,
  UpdateConfigRequest,
  UiLanguage,
} from "./config.types";

const DEFAULT_MANUAL_MODEL = "deepseek-v4-flash";
const DEFAULT_OPENAI_COMPATIBLE_MODEL = "deepseek-v4-flash";
const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = "https://openrouter.ai/api/v1";
const LEGACY_OPENROUTER_AUTO_MODEL = "openrouter/auto";
const RETIRED_GATEWAY_HOST = "43.106.18.167";

const WRITE_TOOLS = ["write_file", "edit_file"];
const COMMON_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "task",
  "write_todos",
  "compact_conversation",
  "web_search",
  "fetch_url",
  "start_async_task",
  "update_async_task",
  "cancel_async_task",
];

function isDesktopMode(): boolean {
  return process.env.INTERNAGENTS_DESKTOP === "1";
}

function normalizeLanguage(value: unknown): UiLanguage {
  return value === "en" ? "en" : "zh";
}

function stripModelProviderPrefix(model: string | undefined): string {
  if (!model) {
    return DEFAULT_MANUAL_MODEL;
  }
  for (const prefix of ["openrouter:", "openai:"]) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

function normalizeModel(
  model: unknown,
  fallback = DEFAULT_MANUAL_MODEL
): string {
  if (typeof model !== "string") {
    return fallback;
  }

  const trimmed = stripModelProviderPrefix(model.trim());
  if (!trimmed) {
    throw new Error("请选择或填写模型。");
  }
  return trimmed;
}

function normalizeOpenAiCompatibleModel(model: unknown): string {
  const normalized = normalizeModel(model, DEFAULT_OPENAI_COMPATIBLE_MODEL);
  return normalized === LEGACY_OPENROUTER_AUTO_MODEL
    ? DEFAULT_OPENAI_COMPATIBLE_MODEL
    : normalized;
}

function normalizeOpenAiCompatibleBaseUrl(
  value: unknown,
  fallback = ""
): string {
  if (typeof value !== "string") {
    if (fallback) {
      return fallback;
    }
    throw new Error("请填写 OpenAI 兼容接口 Base URL。");
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    if (fallback) {
      return fallback;
    }
    throw new Error("请填写 OpenAI 兼容接口 Base URL。");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("OpenAI 兼容接口 Base URL 格式不正确。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OpenAI 兼容接口 Base URL 必须是 http 或 https。");
  }
  return trimmed;
}

function isRetiredGatewayBaseUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    return new URL(value).hostname === RETIRED_GATEWAY_HOST;
  } catch {
    return false;
  }
}

function firstUsableBaseUrl(...values: Array<string | undefined>) {
  return values.find((value) => value && !isRetiredGatewayBaseUrl(value));
}

function normalizeApiKey(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function usableOpenAiCompatibleKey(env: EnvValues): string {
  const retiredKey = env.INTERNAGENTS_GATEWAY_KEY || "";
  const openAiKey =
    env.OPENAI_API_KEY && env.OPENAI_API_KEY !== retiredKey
      ? env.OPENAI_API_KEY
      : "";
  const openRouterKey =
    env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY !== retiredKey
      ? env.OPENROUTER_API_KEY
      : "";
  return openAiKey || openRouterKey;
}

function isAuthorizationMode(value: unknown): value is AuthorizationMode {
  return value === "auto" || value === "write" || value === "all";
}

function normalizeModelProvider(value: unknown): ModelProvider | null {
  if (
    value === "openai_compatible" ||
    value === "openai" ||
    value === "openrouter" ||
    value === "gateway"
  ) {
    return "openai_compatible";
  }
  return null;
}

function inferModelProvider(
  config: AgentConfig,
  env: EnvValues
): ModelProvider {
  return (
    normalizeModelProvider(config.model_provider) ||
    normalizeModelProvider(env.INTERNAGENTS_MODEL_PROVIDER) ||
    "openai_compatible"
  );
}

function inferAuthorizationMode(config: AgentConfig): AuthorizationMode {
  if (isAuthorizationMode(config.authorization_mode)) {
    return config.authorization_mode;
  }

  const interruptOn =
    config.interrupt_on && typeof config.interrupt_on === "object"
      ? config.interrupt_on
      : {};
  const tools = Object.keys(interruptOn);
  if (tools.length === 0) {
    return "auto";
  }

  if (tools.every((tool) => WRITE_TOOLS.includes(tool))) {
    return "write";
  }

  return "all";
}

function approvalConfig(description: string) {
  return {
    allowed_decisions: ["approve", "reject"],
    description,
  };
}

function buildInterruptOn(mode: AuthorizationMode) {
  if (mode === "auto") {
    return undefined;
  }

  const tools = mode === "write" ? WRITE_TOOLS : COMMON_TOOLS;
  return Object.fromEntries(
    tools.map((tool) => [
      tool,
      approvalConfig(
        mode === "write"
          ? "写入或修改本地文件前需要确认。"
          : "执行此工具调用前需要确认。"
      ),
    ])
  );
}

async function normalizedResponse(
  config: AgentConfig
): Promise<ConfigResponse> {
  const env = await readEnvValues();
  const modelProvider = inferModelProvider(config, env);
  const envModel = normalizeModel(
    env.DEEPAGENT_MODEL || env.LLM_MODEL || DEFAULT_OPENAI_COMPATIBLE_MODEL
  );
  const openaiCompatibleModel = normalizeOpenAiCompatibleModel(
    config.openai_compatible_model || config.openrouter_model || envModel
  );
  const openaiCompatibleBaseUrl = normalizeOpenAiCompatibleBaseUrl(
    config.openai_compatible_base_url ||
      firstUsableBaseUrl(
        env.OPENAI_BASE_URL,
        env.OPENAI_API_BASE,
        env.OPENROUTER_API_BASE,
        env.OPENROUTER_BASE_URL
      ) ||
      DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
    DEFAULT_OPENAI_COMPATIBLE_BASE_URL
  );
  const openaiCompatibleKey = usableOpenAiCompatibleKey(env);
  let workspacePath = ".";
  let workspaceResolvedPath = "";
  let workspaceError: string | undefined;
  try {
    workspacePath = getCurrentLocalWorkspacePath();
    workspaceResolvedPath = await resolveLocalWorkspaceRoot();
  } catch (error) {
    workspaceError =
      error instanceof Error ? error.message : "项目配置读取失败。";
  }

  const missing: OnboardingMissing[] = [];
  if (!openaiCompatibleKey?.trim()) {
    missing.push("openaiCompatibleApiKey");
  }
  const desktopMode = isDesktopMode();

  return {
    configPath: getAgentConfigPath(),
    envPath: getAgentEnvPath(),
    resourcesPath: getWorkspaceResourcesPath(),
    workspacePath,
    workspaceResolvedPath,
    workspaceError,
    modelProvider,
    model: openaiCompatibleModel,
    modelSelectionMode: "manual" as ModelSelectionMode,
    effectiveModel: openaiCompatibleModel,
    autoModel: "",
    openaiCompatibleModel,
    openaiCompatibleBaseUrl,
    openaiCompatibleApiKey: "",
    openaiCompatibleApiKeySet: Boolean(openaiCompatibleKey),
    openaiCompatibleApiKeyPreview: "",
    openrouterModel: openaiCompatibleModel,
    openrouterApiKey: "",
    openrouterApiKeySet: Boolean(openaiCompatibleKey),
    openrouterApiKeyPreview: "",
    authorizationMode: inferAuthorizationMode(config),
    language: normalizeLanguage(config.ui_language),
    desktopMode,
    onboardingSkipped: config.onboarding_skipped === true,
    needsOnboarding: missing.length > 0 && config.onboarding_skipped !== true,
    missing,
  };
}

function buildOpenAiCompatibleEnvUpdates({
  body,
  config,
  env,
  allowMissingApiKey = false,
}: {
  body: UpdateConfigRequest;
  config: AgentConfig;
  env: EnvValues;
  allowMissingApiKey?: boolean;
}): EnvUpdates {
  const apiKey =
    normalizeApiKey(body.openaiCompatibleApiKey) ||
    normalizeApiKey(body.openrouterApiKey) ||
    usableOpenAiCompatibleKey(env);
  if (!apiKey && !allowMissingApiKey) {
    throw new Error("请填写 OpenAI 兼容接口 API Key。");
  }

  const model = normalizeOpenAiCompatibleModel(
    config.openai_compatible_model ||
      body.model ||
      DEFAULT_OPENAI_COMPATIBLE_MODEL
  );
  const apiBaseUrl = normalizeOpenAiCompatibleBaseUrl(
    body.openaiCompatibleBaseUrl ||
      config.openai_compatible_base_url ||
      firstUsableBaseUrl(
        env.OPENAI_BASE_URL,
        env.OPENAI_API_BASE,
        env.OPENROUTER_API_BASE,
        env.OPENROUTER_BASE_URL
      ) ||
      DEFAULT_OPENAI_COMPATIBLE_BASE_URL
  );
  config.openai_compatible_model = model;
  config.openai_compatible_base_url = apiBaseUrl;
  delete config.openrouter_direct_enabled;
  delete config.openrouter_model;
  delete config.gateway_base_url;
  delete config.gateway_model;

  return {
    INTERNAGENTS_MODEL_PROVIDER: "openai_compatible",
    INTERNAGENTS_INSTALL_ID: null,
    INTERNAGENTS_USER_EMAIL: null,
    INTERNAGENTS_USER_NAME: null,
    INTERNAGENTS_INVITE_CODE: null,
    INTERNAGENTS_GATEWAY_INVITE_CODE: null,
    INTERNAGENTS_GATEWAY_URL: null,
    INTERNAGENTS_GATEWAY_BASE_URL: null,
    INTERNAGENTS_GATEWAY_MODEL: null,
    INTERNAGENTS_GATEWAY_KEY: null,
    INTERNAGENTS_GATEWAY_CREDIT_RMB: null,
    INTERNAGENTS_GATEWAY_REMAINING_RMB: null,
    LLM_PROVIDER: "openai",
    LLM_MODEL: model,
    DEEPAGENT_MODEL: `openai:${model}`,
    OPENROUTER_API_KEY: null,
    OPENROUTER_API_BASE: null,
    OPENROUTER_BASE_URL: null,
    OPENAI_API_KEY: apiKey || null,
    OPENAI_BASE_URL: apiBaseUrl,
    OPENAI_API_BASE: apiBaseUrl,
  };
}

export async function getConfig(): Promise<ConfigResponse> {
  return normalizedResponse(await readAgentConfig());
}

export async function updateConfig(
  body: UpdateConfigRequest
): Promise<ConfigResponse> {
  const currentConfig = await readAgentConfig();
  const currentEnv = await readEnvValues();
  const model = normalizeOpenAiCompatibleModel(
    body.model || DEFAULT_OPENAI_COMPATIBLE_MODEL
  );
  const openaiCompatibleBaseUrl = normalizeOpenAiCompatibleBaseUrl(
    body.openaiCompatibleBaseUrl ||
      currentConfig.openai_compatible_base_url ||
      firstUsableBaseUrl(
        currentEnv.OPENAI_BASE_URL,
        currentEnv.OPENAI_API_BASE,
        currentEnv.OPENROUTER_API_BASE,
        currentEnv.OPENROUTER_BASE_URL
      ) ||
      DEFAULT_OPENAI_COMPATIBLE_BASE_URL
  );
  const authorizationMode = isAuthorizationMode(body.authorizationMode)
    ? body.authorizationMode
    : "auto";
  const language = normalizeLanguage(body.language ?? currentConfig.ui_language);
  const hasOpenAiCompatibleKey = Boolean(
    normalizeApiKey(body.openaiCompatibleApiKey) ||
      normalizeApiKey(body.openrouterApiKey) ||
      usableOpenAiCompatibleKey(currentEnv)
  );
  const onboardingSkipped =
    !hasOpenAiCompatibleKey &&
    (body.onboardingSkipped === true ||
      currentConfig.onboarding_skipped === true);
  const workspacePath =
    typeof body.workspacePath === "string" ? body.workspacePath.trim() : undefined;
  if (workspacePath === "") {
    throw new Error("项目路径不能为空。");
  }
  const currentWorkspacePath = getCurrentLocalWorkspacePath();
  const shouldUpdateWorkspace =
    workspacePath !== undefined && workspacePath !== currentWorkspacePath;

  const nextConfig: AgentConfig = {
    ...currentConfig,
    authorization_mode: authorizationMode,
    model_provider: "openai_compatible",
    model_selection_mode: "manual",
    manual_model: DEFAULT_MANUAL_MODEL,
    openai_compatible_model: model,
    openai_compatible_base_url: openaiCompatibleBaseUrl,
    ui_language: language,
  };
  if (onboardingSkipped) {
    nextConfig.onboarding_skipped = true;
  } else {
    delete nextConfig.onboarding_skipped;
  }
  delete nextConfig.openrouter_direct_enabled;
  delete nextConfig.openrouter_model;
  delete nextConfig.gateway_model;
  delete nextConfig.gateway_base_url;

  const interruptOn = buildInterruptOn(authorizationMode);
  if (interruptOn) {
    nextConfig.interrupt_on = interruptOn;
  } else {
    delete nextConfig.interrupt_on;
  }

  const envUpdates = buildOpenAiCompatibleEnvUpdates({
    body,
    config: nextConfig,
    env: currentEnv,
    allowMissingApiKey: onboardingSkipped,
  });
  await writeAgentConfig(nextConfig);
  await writeEnvValues(envUpdates);
  if (shouldUpdateWorkspace) {
    await updateLocalWorkspacePath(workspacePath);
  }

  return {
    ...(await normalizedResponse(nextConfig)),
    message: "配置已保存，重启后台后生效。",
  };
}
