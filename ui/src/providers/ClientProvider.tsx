"use client";

import { useMemo, ReactNode } from "react";
import { createAgentRuntimeAdapter } from "@/lib/agent-runtime";
import { RemoteAgentContext } from "@/providers/AgentRuntimeContext";

interface ClientProviderProps {
  children: ReactNode;
  deploymentUrl: string;
  assistantId: string;
  apiKey: string;
}

export function RemoteAgentProvider({
  children,
  deploymentUrl,
  assistantId,
  apiKey,
}: ClientProviderProps) {
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
      agent: runtime.legacyAgent,
      client: runtime.client,
    }),
    [runtime]
  );

  return (
    <RemoteAgentContext.Provider value={value}>
      {children}
    </RemoteAgentContext.Provider>
  );
}
