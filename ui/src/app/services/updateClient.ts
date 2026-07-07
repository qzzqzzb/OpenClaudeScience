import { readJsonResponse } from "@/app/services/apiClient";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "failed";

export interface UpdateStatusResult {
  state: UpdateState;
  sourceRepo: string;
  sourceUrl: string;
  current: {
    version: string;
    exactTag?: string;
    branch?: string;
    commit?: string;
    dirty: boolean;
    dirtyReason?: string;
    appPath?: string;
    installMode: "desktop-app" | "source";
  };
  latest?: {
    tagName: string;
    name: string;
    htmlUrl: string;
    publishedAt?: string;
    notes?: string;
    asset?: {
      name: string;
      size?: number;
      downloadUrl: string;
    };
  };
  updateAvailable: boolean;
  canApply: boolean;
  blockReason?: string;
  message: string;
  previous?: {
    checkoutTarget: string;
    commit: string;
    label: string;
  };
  download?: {
    assetName: string;
    downloadedBytes: number;
    totalBytes?: number;
    percent?: number;
    startedAt: string;
    updatedAt: string;
  };
  backendRestart?: {
    message: string;
  };
  installLogPath?: string;
  log: Array<{
    at: string;
    message: string;
  }>;
  error?: string;
}

export interface UpdateActionResponse {
  responseOk: boolean;
  status: UpdateStatusResult;
}

async function requestUpdateAction(url: string): Promise<UpdateActionResponse> {
  const response = await fetch(url, { method: "POST" });
  const status = (await response.json()) as UpdateStatusResult;

  return {
    responseOk: response.ok,
    status,
  };
}

export async function getUpdateStatus(
  fallbackMessage: string
): Promise<UpdateStatusResult> {
  const response = await fetch("/api/update/status", {
    cache: "no-store",
  });
  return readJsonResponse<UpdateStatusResult>(response, fallbackMessage);
}

export function checkUpdate(): Promise<UpdateActionResponse> {
  return requestUpdateAction("/api/update/check");
}

export function applyUpdate(): Promise<UpdateActionResponse> {
  return requestUpdateAction("/api/update/apply");
}

export function rollbackUpdate(): Promise<UpdateActionResponse> {
  return requestUpdateAction("/api/update/rollback");
}
