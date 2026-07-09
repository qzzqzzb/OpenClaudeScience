"use client";

import { createContext, useContext } from "react";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";

export interface AgentRuntimeContextValue {
  runtime: ClientAgentRuntimeAdapter;
}

export const AgentRuntimeContext =
  createContext<AgentRuntimeContextValue | null>(null);

export function useAgentRuntime(): ClientAgentRuntimeAdapter {
  const context = useContext(AgentRuntimeContext);

  if (!context) {
    throw new Error("useAgentRuntime must be used within an AgentRuntimeProvider");
  }
  return context.runtime;
}
