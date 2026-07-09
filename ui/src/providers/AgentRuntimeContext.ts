"use client";

import { createContext, useContext } from "react";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";

export interface RemoteAgentContextValue {
  runtime: ClientAgentRuntimeAdapter;
}

export const RemoteAgentContext =
  createContext<RemoteAgentContextValue | null>(null);

export function useAgentRuntime(): ClientAgentRuntimeAdapter {
  const context = useContext(RemoteAgentContext);

  if (!context) {
    throw new Error("useAgentRuntime must be used within a RemoteAgentProvider");
  }
  return context.runtime;
}
