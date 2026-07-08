import {
  getDefaultResourceId,
  listResources,
} from "./adapters/resources.adapter";
import type { ResourcesResponse } from "./resources.types";

export function getResources(): ResourcesResponse {
  return {
    defaultResourceId: getDefaultResourceId(),
    resources: listResources(),
  };
}
