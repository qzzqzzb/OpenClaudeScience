import type { RuntimeReadyResult } from "../runtime.types";

export function isLocalBackendUrl(value: string): boolean {
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

export async function checkBackendOk(
  deploymentUrl: string
): Promise<RuntimeReadyResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(new URL("/ok", deploymentUrl), {
      cache: "no-store",
      signal: controller.signal,
    });
    return {
      ready: response.ok,
      status: response.status,
    };
  } catch {
    return { ready: false };
  } finally {
    clearTimeout(timeout);
  }
}
