import { restartBackend } from "@/app/api/runtime/_lib/backend";
import type { BackendRestartResult } from "../runtime.types";

const RESTART_ROUTE_TIMEOUT_MS = 45_000;
const STALE_RESTART_MS = 120_000;

let activeRestart:
  | {
      startedAt: number;
      promise: Promise<BackendRestartResult>;
    }
  | null = null;

function backendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
    `http://127.0.0.1:${process.env.INTERNAGENTS_BACKEND_PORT || "2024"}`
  );
}

function restartStillRunningResult(): BackendRestartResult {
  return {
    status: "failed",
    message: "后台配置仍在应用中，请稍后刷新状态。",
    url: backendUrl(),
    logPath: ".internagents/logs/backend.log",
  };
}

function restartTimedOutResult(): BackendRestartResult {
  return {
    status: "failed",
    message: "后台重启请求等待超时，系统将继续检查后台状态。",
    url: backendUrl(),
    logPath: ".internagents/logs/backend.log",
  };
}

async function withRestartTimeout(
  restartPromise: Promise<BackendRestartResult>
): Promise<BackendRestartResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      restartPromise,
      new Promise<BackendRestartResult>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(restartTimedOutResult()),
          RESTART_ROUTE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function restartRuntimeBackend(): Promise<BackendRestartResult> {
  const now = Date.now();

  if (activeRestart) {
    if (now - activeRestart.startedAt < STALE_RESTART_MS) {
      return restartStillRunningResult();
    }
    activeRestart = null;
  }

  const restartPromise = restartBackend().finally(() => {
    if (activeRestart?.promise === restartPromise) {
      activeRestart = null;
    }
  });
  activeRestart = {
    startedAt: now,
    promise: restartPromise,
  };

  return withRestartTimeout(restartPromise);
}
