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

export async function checkRuntimeBackendReady(
  deploymentUrl: string
): Promise<RuntimeReadyResult> {
  if (!isLocalBackendUrl(deploymentUrl)) {
    throw new RuntimeRequestError("Only local backend URLs can be checked.");
  }

  return checkBackendOk(deploymentUrl);
}

export async function getRuntimeStatus(): Promise<BackendStatusResult> {
  return getRuntimeBackendStatus();
}

export async function restartRuntime(): Promise<BackendRestartResult> {
  return restartRuntimeBackend();
}

export async function getDesktopRuntimeConfigScript(): Promise<string> {
  const config = await getDesktopRuntimeConfig();
  return `window.__INTERNAGENTS_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
}
