import { getBackendStatus } from "./backendProcess.adapter";
import type { BackendStatusResult } from "../runtime.types";

export async function getRuntimeBackendStatus(): Promise<BackendStatusResult> {
  return getBackendStatus();
}
