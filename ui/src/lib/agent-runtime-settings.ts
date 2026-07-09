import type { AgentRuntimeProviderKind } from "./agent-runtime-protocol";
import { isAgentRuntimeProviderKind } from "./agent-runtime-provider.ts";

export interface AgentRuntimeProviderSettings {
  provider: AgentRuntimeProviderKind;
  enabled?: boolean;
  options?: Record<string, unknown>;
}

export interface AgentRuntimeSettings {
  defaultProvider: AgentRuntimeProviderKind;
  providers: AgentRuntimeProviderSettings[];
}

export const DEFAULT_AGENT_RUNTIME_SETTINGS: AgentRuntimeSettings = {
  defaultProvider: "langgraph",
  providers: [
    {
      provider: "langgraph",
      enabled: true,
    },
  ],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseProviderSettings(
  value: unknown
): AgentRuntimeProviderSettings | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const provider = record.provider;
  if (!isAgentRuntimeProviderKind(provider)) {
    return null;
  }

  return {
    provider,
    enabled:
      typeof record.enabled === "boolean" ? record.enabled : undefined,
    options: asRecord(record.options) ?? undefined,
  };
}

export function parseAgentRuntimeSettings(
  value: unknown
): AgentRuntimeSettings {
  const record = asRecord(value);
  if (!record) {
    return DEFAULT_AGENT_RUNTIME_SETTINGS;
  }

  const defaultProvider = isAgentRuntimeProviderKind(record.defaultProvider)
    ? record.defaultProvider
    : isAgentRuntimeProviderKind(record.default_provider)
    ? record.default_provider
    : DEFAULT_AGENT_RUNTIME_SETTINGS.defaultProvider;
  const providers = Array.isArray(record.providers)
    ? record.providers
        .map(parseProviderSettings)
        .filter(
          (provider): provider is AgentRuntimeProviderSettings =>
            provider !== null
        )
    : DEFAULT_AGENT_RUNTIME_SETTINGS.providers;

  return {
    defaultProvider,
    providers: providers.length
      ? providers
      : DEFAULT_AGENT_RUNTIME_SETTINGS.providers,
  };
}

export function resolveEnabledRuntimeProvider(
  settings: AgentRuntimeSettings
): AgentRuntimeProviderKind {
  const defaultProvider = settings.providers.find(
    (provider) =>
      provider.provider === settings.defaultProvider &&
      provider.enabled !== false
  );
  if (defaultProvider) {
    return defaultProvider.provider;
  }

  return (
    settings.providers.find((provider) => provider.enabled !== false)
      ?.provider ?? DEFAULT_AGENT_RUNTIME_SETTINGS.defaultProvider
  );
}
