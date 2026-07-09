import { promises as fs } from "fs";
import path from "path";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";
import type {
  EnvUpdates,
  SkillConnectionsResponse,
  UpdateSkillConnectionsRequest,
} from "../skills.types";

const SCP_ENV_KEY = "SCP_HUB_API_KEY";
const EMPTY_MCP_CONFIG = {
  mcpServers: {},
};

function envPath() {
  return path.join(getWorkspaceRoot(), ".env");
}

function mcpConfigPath() {
  return path.join(getWorkspaceRoot(), ".mcp.json");
}

function parseEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readEnvValues(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(envPath(), "utf8");
    const values: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) {
        continue;
      }
      values[match[1]] = parseEnvValue(match[2]);
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeEnvValues(updates: EnvUpdates) {
  let content = "";
  try {
    content = await fs.readFile(envPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const nextLines = lines.flatMap((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || line.trim().startsWith("#")) {
      return [line];
    }

    const key = match[2];
    if (!(key in updates)) {
      return [line];
    }

    seen.add(key);
    const value = updates[key];
    if (value === null) {
      return [];
    }
    return [`${match[1]}${key}${match[3]}${JSON.stringify(value)}`];
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key) && value !== null) {
      nextLines.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  const nextContent = `${nextLines
    .filter((_, index) => index < nextLines.length - 1 || nextLines[index] !== "")
    .join("\n")}\n`;

  await fs.writeFile(envPath(), nextContent);
}

function previewSecret(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= 8
    ? "••••"
    : `••••${trimmed.slice(Math.max(0, trimmed.length - 4))}`;
}

function normalizeMcpConfigText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${JSON.stringify(EMPTY_MCP_CONFIG, null, 2)}\n`;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 格式不正确。";
    throw new Error(`MCP 配置不是有效 JSON：${message}`);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("mcpServers" in parsed)
  ) {
    throw new Error("MCP 配置需要包含 mcpServers 对象。");
  }

  const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error("mcpServers 必须是对象。");
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

async function readMcpConfig() {
  const configPath = mcpConfigPath();
  try {
    const configText = await fs.readFile(configPath, "utf8");
    try {
      const parsed = JSON.parse(configText) as { mcpServers?: unknown };
      const servers =
        parsed.mcpServers &&
        typeof parsed.mcpServers === "object" &&
        !Array.isArray(parsed.mcpServers)
          ? parsed.mcpServers
          : {};
      return {
        configPath,
        exists: true,
        configText,
        serverCount: Object.keys(servers).length,
      };
    } catch (error) {
      return {
        configPath,
        exists: true,
        configText,
        serverCount: 0,
        error:
          error instanceof Error
            ? `MCP 配置 JSON 解析失败：${error.message}`
            : "MCP 配置 JSON 解析失败。",
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        configPath,
        exists: false,
        configText: `${JSON.stringify(EMPTY_MCP_CONFIG, null, 2)}\n`,
        serverCount: 0,
      };
    }
    throw error;
  }
}

export async function readSkillConnections(
  options: { message?: string; changed?: boolean } = {}
): Promise<SkillConnectionsResponse> {
  const env = await readEnvValues();
  const scpApiKey = env[SCP_ENV_KEY] || "";
  return {
    scp: {
      envKey: SCP_ENV_KEY,
      apiKeySet: Boolean(scpApiKey.trim()),
      apiKeyPreview: previewSecret(scpApiKey),
    },
    mcp: await readMcpConfig(),
    message: options.message,
    requiresRestart: options.changed || undefined,
  };
}

export async function writeSkillConnections(
  body: Partial<UpdateSkillConnectionsRequest>
): Promise<SkillConnectionsResponse> {
  let changed = false;

  const envUpdates: EnvUpdates = {};
  if (body.clearScpApiKey === true) {
    envUpdates[SCP_ENV_KEY] = null;
  } else if (typeof body.scpApiKey === "string" && body.scpApiKey.trim()) {
    envUpdates[SCP_ENV_KEY] = body.scpApiKey.trim();
  }
  if (Object.keys(envUpdates).length > 0) {
    await writeEnvValues(envUpdates);
    changed = true;
  }

  if (typeof body.mcpConfigText === "string") {
    const nextMcpConfigText = normalizeMcpConfigText(body.mcpConfigText);
    await fs.writeFile(mcpConfigPath(), nextMcpConfigText);
    changed = true;
  }

  return readSkillConnections({
    changed,
    message: changed ? "连接配置已保存，重启后台后生效。" : "连接配置没有变化。",
  });
}
