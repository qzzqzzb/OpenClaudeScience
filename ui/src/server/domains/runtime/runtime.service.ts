import {
  checkBackendOk,
  isLocalBackendUrl,
} from "./adapters/backendHealth.adapter";
import { restartRuntimeBackend } from "./adapters/backendRestart.adapter";
import { getRuntimeBackendStatus } from "./adapters/backendStatus.adapter";
import { getDesktopRuntimeConfig } from "./adapters/desktopRuntime.adapter";
import type {
  BackendRestartResult,
  BackendStatusResult,
  RuntimeAdapter,
  RuntimeReadyResult,
} from "./runtime.types";

export class RuntimeRequestError extends Error {
  readonly statusCode: number;
  readonly payload: RuntimeReadyResult;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "RuntimeRequestError";
    this.statusCode = statusCode;
    this.payload = {
      ready: false,
      error: message,
    };
  }
}

export const runtimeAdapter: RuntimeAdapter = {
  async isReady(input = {}) {
    const deploymentUrl =
      process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
      `http://127.0.0.1:${process.env.INTERNAGENTS_BACKEND_PORT || "2024"}`;
    if (!isLocalBackendUrl(deploymentUrl)) {
      throw new RuntimeRequestError("Only local backend URLs can be checked.");
    }
    void input;
    return checkBackendOk(deploymentUrl);
  },
  getStatus: getRuntimeBackendStatus,
  restart: restartRuntimeBackend,
  getDesktopConfig: getDesktopRuntimeConfig,
};

export async function checkRuntimeBackendReady(
  deploymentUrl: string
): Promise<RuntimeReadyResult> {
  if (!isLocalBackendUrl(deploymentUrl)) {
    throw new RuntimeRequestError("Only local backend URLs can be checked.");
  }

  return checkBackendOk(deploymentUrl);
}

export async function getRuntimeStatus(): Promise<BackendStatusResult> {
  return runtimeAdapter.getStatus();
}

export async function restartRuntime(): Promise<BackendRestartResult> {
  return runtimeAdapter.restart();
}

export async function getDesktopRuntimeConfigScript(): Promise<string> {
  const config = await runtimeAdapter.getDesktopConfig();
  return `window.__INTERNAGENTS_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
}
