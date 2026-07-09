"use client";

import type { StreamMode } from "@langchain/langgraph-sdk";

export interface AgentRuntimeStreamConfig {
  modes?: StreamMode[];
  subgraphs?: boolean;
}

export interface AgentRuntimeStreamEvent {
  id: string;
  at: number;
  threadId?: string | null;
  rawEvent: string;
  mode: string;
  namespace?: string[];
  data: unknown;
}
