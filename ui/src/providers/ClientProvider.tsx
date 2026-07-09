"use client";

import { useMemo, ReactNode } from "react";
import { createAgentRuntimeAdapter } from "@/lib/agent-runtime";
import { AgentRuntimeContext } from "@/providers/AgentRuntimeContext";

interface AgentRuntimeProviderProps {
  children: ReactNode;
  deploymentUrl: string;
  assistantId: string;
  apiKey: string;
}

export function AgentRuntimeProvider({
  children,
  deploymentUrl,
  assistantId,
  apiKey,
}: AgentRuntimeProviderProps) {
  const runtime = useMemo(() => {
    return createAgentRuntimeAdapter({
      provider: "langgraph",
      deploymentUrl,
      assistantId,
      apiKey,
    });
  }, [deploymentUrl, assistantId, apiKey]);

  const value = useMemo(
    () => ({
      runtime,
    }),
    [runtime]
  );

  return (
    <AgentRuntimeContext.Provider value={value}>
      {children}
    </AgentRuntimeContext.Provider>
  );
}
