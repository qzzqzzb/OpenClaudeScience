import type { ResourceConfig } from "@/lib/config";

export interface ResourcesResponse {
  defaultResourceId: string;
  resources: ResourceConfig[];
}
