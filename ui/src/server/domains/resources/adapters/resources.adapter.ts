import {
  readWorkspaceResourcesConfig,
  type ResourceRecord,
} from "@/app/api/workspace/_lib/workspace";
import type { ResourceConfig } from "@/lib/config";

function assistantIdForResource(resource: ResourceRecord): string {
  return resource.remote_assistant_id || `agent_${resource.id}`;
}

export function getDefaultResourceId(): string {
  const config = readWorkspaceResourcesConfig();
  return config.default_resource || "local";
}

export function listResources(): ResourceConfig[] {
  const resources = readWorkspaceResourcesConfig().resources || [];
  return resources
    .filter((resource) => resource.enabled !== false)
    .map((resource) => ({
      id: resource.id,
      label: resource.label || resource.id,
      assistantId: assistantIdForResource(resource),
      backend: resource.backend,
      runtimeUrl: resource.remote_url,
      remoteRuntimePort: resource.remote_runtime_port,
      workspacePath: resource.workspace,
    }));
}
