import { requestJson } from "@/app/services/apiClient";
import type { ResourceConfig } from "@/lib/config";

export interface ResourcesResponse {
  defaultResourceId?: string;
  resources?: ResourceConfig[];
}

const DEFAULT_RESOURCES_ERROR = "Unable to load resources.";

export function listResources(
  fallbackMessage = DEFAULT_RESOURCES_ERROR
): Promise<ResourcesResponse> {
  return requestJson<ResourcesResponse>("/api/resources", fallbackMessage, {
    cache: "no-store",
  });
}
