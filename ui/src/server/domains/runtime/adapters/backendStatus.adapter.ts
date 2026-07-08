import { getBackendStatus } from "@/app/api/runtime/_lib/backend";
import type { BackendStatusResult } from "../runtime.types";

export async function getRuntimeBackendStatus(): Promise<BackendStatusResult> {
  return getBackendStatus();
}
