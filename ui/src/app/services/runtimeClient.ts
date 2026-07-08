import { buildQuery, type ApiErrorPayload } from "@/app/services/apiClient";

export interface BackendReadyResult {
  ready?: boolean;
  status?: number;
  error?: string;
}

export interface BackendRestartResult {
  status: "restarted" | "failed";
  message: string;
  url: string;
  pid?: number;
  oldPid?: number;
  logPath: string;
}

export interface BackendStatusResult {
  status: "idle" | "busy" | "unavailable";
  message: string;
  url: string;
  busyThreads: number;
  interruptedThreads: number;
}

const DEFAULT_STATUS_ERROR = "Unable to load backend status.";
const DEFAULT_RESTART_ERROR = "Unable to restart backend.";
const RESTART_REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    const maybeAbort = error as { name?: string };
    if (maybeAbort?.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function isLocalDeploymentUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export async function isLocalBackendReady(
  deploymentUrl: string
): Promise<boolean> {
  try {
    const params = buildQuery({ url: deploymentUrl });
    const response = await fetch(`/api/runtime/backend/ready?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | BackendReadyResult
      | null;
    return response.ok && payload?.ready === true;
  } catch {
    return false;
  }
}

export async function isWorkbenchHomeReady(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getBackendStatus(
  fallbackMessage = DEFAULT_STATUS_ERROR
): Promise<BackendStatusResult> {
  const response = await fetch("/api/runtime/backend/status", {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | (Partial<BackendStatusResult> & ApiErrorPayload)
    | null;

  if (payload?.status) {
    return payload as BackendStatusResult;
  }

  throw new Error(payload?.error || payload?.message || fallbackMessage);
}

export async function restartBackend(
  fallbackMessage = DEFAULT_RESTART_ERROR
): Promise<BackendRestartResult> {
  const response = await fetchWithTimeout(
    "/api/runtime/backend/restart",
    {
      method: "POST",
    },
    RESTART_REQUEST_TIMEOUT_MS,
    fallbackMessage
  );
  const payload = (await response.json().catch(() => null)) as
    | (Partial<BackendRestartResult> & ApiErrorPayload)
    | null;

  if (payload?.status) {
    return payload as BackendRestartResult;
  }

  throw new Error(payload?.error || payload?.message || fallbackMessage);
}
