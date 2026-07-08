import { promises as fs } from "fs";
import path from "path";
import type { AgentConfig } from "../config.types";
import { getConfigWorkspaceRoot } from "./workspaceConfig.adapter";

export function getAgentConfigPath(): string {
  return path.join(getConfigWorkspaceRoot(), "deepagent.config.json");
}

export async function readAgentConfig(): Promise<AgentConfig> {
  try {
    const content = await fs.readFile(getAgentConfigPath(), "utf8");
    return JSON.parse(content) as AgentConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function writeAgentConfig(config: AgentConfig): Promise<void> {
  await fs.writeFile(
    getAgentConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`
  );
}
