import type {
  DesktopRuntimeConfig,
  RuntimeResourceConfig,
} from "../runtime.types";

const DEFAULT_LOCAL_RUNTIME_PORT = 22024;
const DEFAULT_LOCAL_RUNTIME_PORT_SCAN_COUNT = 32;

function isLocalUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const port = Number(trimmed);
  return port > 0 && port <= 65535 ? port : undefined;
}

function runtimeUrlForPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function runtimeIsHealthy(runtimeUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${runtimeUrl}/ok`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function localRuntimeUrl(
  deploymentUrl: string,
  desktopMode: boolean
): Promise<string | undefined> {
  const configuredPort = parsePort(process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT);
  if (configuredPort) {
    return runtimeUrlForPort(configuredPort);
  }

  if (!desktopMode && !isLocalUrl(deploymentUrl)) {
    return undefined;
  }

  const startPort =
    parsePort(process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT_START) ??
    DEFAULT_LOCAL_RUNTIME_PORT;
  const scanCount =
    parsePort(process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT_SCAN_COUNT) ??
    DEFAULT_LOCAL_RUNTIME_PORT_SCAN_COUNT;

  const candidates = await Promise.all(
    Array.from({ length: scanCount }, async (_, offset) => {
      const port = startPort + offset;
      if (port > 65535) {
        return undefined;
      }
      const runtimeUrl = runtimeUrlForPort(port);
      return (await runtimeIsHealthy(runtimeUrl)) ? runtimeUrl : undefined;
    })
  );

  return candidates.find((candidate) => candidate);
}

function attachLocalRuntimeUrl(
  resources: RuntimeResourceConfig[],
  runtimeUrl: string | undefined
): RuntimeResourceConfig[] {
  if (!runtimeUrl) {
    return resources;
  }
  return resources.map((resource) =>
    resource.id === "local" && !resource.runtimeUrl
      ? { ...resource, runtimeUrl }
      : resource
  );
}

function parseResources(
  value: string | undefined
): RuntimeResourceConfig[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const resources = parsed
      .map((item): RuntimeResourceConfig | null => {
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
          runtimeUrl:
            typeof record.runtimeUrl === "string"
              ? record.runtimeUrl
              : undefined,
        };
      })
      .filter((item): item is RuntimeResourceConfig => item !== null);
    return resources.length > 0 ? resources : undefined;
  } catch {
    return undefined;
  }
}

export async function getDesktopRuntimeConfig(): Promise<DesktopRuntimeConfig> {
  const desktopMode = process.env.INTERNAGENTS_DESKTOP === "1";
  const assistantId =
    process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID || "agent_local";
  const deploymentUrl = process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL || "";
  const runtimeUrl = await localRuntimeUrl(deploymentUrl, desktopMode);
  const resources = attachLocalRuntimeUrl(
    parseResources(process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCES) || [
      {
        id: "local",
        label: "Current Machine",
        assistantId,
        runtimeUrl,
      },
    ],
    runtimeUrl
  );

  return {
    desktopMode,
    deploymentUrl,
    assistantId,
    langsmithApiKey: process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "",
    defaultResourceId:
      process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID || resources[0].id,
    resources,
  };
}
