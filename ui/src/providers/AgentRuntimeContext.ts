"use client";

import { createContext, useContext } from "react";
import { Client } from "@langchain/langgraph-sdk";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";
import type { WebRemoteAgent } from "@/lib/remote-agent";

export interface RemoteAgentContextValue {
  runtime: ClientAgentRuntimeAdapter;
  agent: WebRemoteAgent;
  client: Client;
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

export function useRemoteAgent(): WebRemoteAgent {
  const context = useContext(RemoteAgentContext);

  if (!context) {
    throw new Error("useRemoteAgent must be used within a RemoteAgentProvider");
  }
  return context.agent;
}

export function useClient(): Client {
  const context = useContext(RemoteAgentContext);

  if (!context) {
    throw new Error("useClient must be used within a RemoteAgentProvider");
  }
  return context.client;
}
