import uiConfig from "../../deepagent-ui.config.json";
import type { AgentRuntimeStreamMode } from "@/lib/agent-runtime-events";

export interface StreamConfig {
  modes: AgentRuntimeStreamMode[];
  subgraphs: boolean;
}

export interface ResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  backend?: "local_shell" | "ssh_shell";
  runtimeUrl?: string;
  remoteRuntimePort?: number;
  workspacePath?: string;
}

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  defaultResourceId: string;
  resources: ResourceConfig[];
  stream: StreamConfig;
}

export type ConnectionConfig = Pick<
  StandaloneConfig,
  "deploymentUrl" | "assistantId" | "langsmithApiKey"
>;

interface RuntimeConfig extends Partial<StandaloneConfig> {
  desktopMode?: boolean;
}

declare global {
  interface Window {
    __INTERNAGENTS_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const DEFAULT_STREAM_CONFIG: StreamConfig = {
  modes: ["messages-tuple", "updates", "values"],
  subgraphs: true,
};

const rawConfig = uiConfig as Partial<StandaloneConfig>;
const CONNECTION_STORAGE_KEY = "internagents.connection";

function parseResourceEnv(value: string | undefined): ResourceConfig[] | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    const resources = parsed
      .map((item): ResourceConfig | null => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.label !== "string" ||
          typeof record.assistantId !== "string"
        ) {
          return null;
        }
        return {
          id: record.id,
          label: record.label,
          assistantId: record.assistantId,
          backend:
            record.backend === "local_shell" || record.backend === "ssh_shell"
              ? record.backend
              : undefined,
          runtimeUrl:
            typeof record.runtimeUrl === "string"
              ? record.runtimeUrl
              : undefined,
          remoteRuntimePort:
            typeof record.remoteRuntimePort === "number"
              ? record.remoteRuntimePort
              : undefined,
          workspacePath:
            typeof record.workspacePath === "string"
              ? record.workspacePath
              : undefined,
        };
      })
      .filter((item): item is ResourceConfig => item !== null);
    return resources.length > 0 ? resources : null;
  } catch {
    return null;
  }
}

function normalizeStreamConfig(stream?: Partial<StreamConfig>): StreamConfig {
  return {
    modes:
      Array.isArray(stream?.modes) && stream.modes.length > 0
        ? stream.modes
        : DEFAULT_STREAM_CONFIG.modes,
    subgraphs:
      typeof stream?.subgraphs === "boolean"
        ? stream.subgraphs
        : DEFAULT_STREAM_CONFIG.subgraphs,
  };
}

function readRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") {
    return {};
  }
  return window.__INTERNAGENTS_RUNTIME_CONFIG__ || {};
}

function buildDefaultConfig(): StandaloneConfig {
  const runtimeConfig = readRuntimeConfig();
  const configuredResources = (
    runtimeConfig.resources?.length
      ? runtimeConfig.resources
      : parseResourceEnv(process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCES) ||
        (rawConfig.resources?.length
          ? rawConfig.resources
          : [
              {
                id: "local",
                label: "Current Machine",
                assistantId:
                  runtimeConfig.assistantId || rawConfig.assistantId || "agent",
              },
            ])
  ) as ResourceConfig[];

  const defaultResourceId =
    runtimeConfig.defaultResourceId ||
    process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID ||
    rawConfig.defaultResourceId ||
    configuredResources[0]?.id ||
    "local";

  const selectedDefaultResource =
    configuredResources.find((resource) => resource.id === defaultResourceId) ||
    configuredResources[0];

  return {
    deploymentUrl:
      runtimeConfig.deploymentUrl ||
      process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
      rawConfig.deploymentUrl ||
      "http://127.0.0.1:2024",
    assistantId:
      runtimeConfig.assistantId ||
      process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ||
      selectedDefaultResource?.assistantId ||
      rawConfig.assistantId ||
      "agent",
    langsmithApiKey:
      runtimeConfig.langsmithApiKey ||
      process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
      rawConfig.langsmithApiKey ||
      undefined,
    defaultResourceId,
    resources: configuredResources,
    stream: normalizeStreamConfig(runtimeConfig.stream || rawConfig.stream),
  };
}

function readStoredConnectionConfig(): Partial<ConnectionConfig> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Partial<ConnectionConfig>;
    return {
      deploymentUrl:
        typeof parsed.deploymentUrl === "string" && parsed.deploymentUrl.trim()
          ? parsed.deploymentUrl.trim()
          : undefined,
      assistantId:
        typeof parsed.assistantId === "string" && parsed.assistantId.trim()
          ? parsed.assistantId.trim()
          : undefined,
      langsmithApiKey:
        typeof parsed.langsmithApiKey === "string"
          ? parsed.langsmithApiKey.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

export function getDefaultConfig(): StandaloneConfig {
  return buildDefaultConfig();
}

export function getConfig(): StandaloneConfig {
  const defaultConfig = buildDefaultConfig();
  const stored = readRuntimeConfig().desktopMode
    ? {}
    : readStoredConnectionConfig();
  return {
    ...defaultConfig,
    ...stored,
    defaultResourceId: defaultConfig.defaultResourceId,
    resources: defaultConfig.resources,
    stream: defaultConfig.stream,
  };
}

export function getResource(
  config: StandaloneConfig,
  resourceId?: string | null
) {
  return (
    config.resources.find((resource) => resource.id === resourceId) ||
    config.resources.find(
      (resource) => resource.id === config.defaultResourceId
    ) ||
    config.resources[0]
  );
}

export function saveConnectionConfig(config: ConnectionConfig): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({
      deploymentUrl: config.deploymentUrl.trim(),
      assistantId: config.assistantId.trim(),
      langsmithApiKey: config.langsmithApiKey?.trim() || "",
    })
  );
}

export function clearConnectionConfig(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(CONNECTION_STORAGE_KEY);
}
