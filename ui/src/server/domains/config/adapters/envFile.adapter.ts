import { promises as fs } from "fs";
import path from "path";
import type { EnvUpdates, EnvValues } from "../config.types";
import { getConfigWorkspaceRoot } from "./workspaceConfig.adapter";

export function getAgentEnvPath(): string {
  return path.join(getConfigWorkspaceRoot(), ".env");
}

function parseEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export async function readEnvValues(): Promise<EnvValues> {
  try {
    const content = await fs.readFile(getAgentEnvPath(), "utf8");
    const values: EnvValues = {};
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

export async function writeEnvValues(updates: EnvUpdates): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(getAgentEnvPath(), "utf8");
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
    .filter(
      (_, index) => index < nextLines.length - 1 || nextLines[index] !== ""
    )
    .join("\n")}\n`;

  await fs.writeFile(getAgentEnvPath(), nextContent);
}
