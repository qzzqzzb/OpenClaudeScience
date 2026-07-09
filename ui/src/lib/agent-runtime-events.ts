"use client";

export type AgentRuntimeStreamMode =
  | "values"
  | "messages"
  | "updates"
  | "events"
  | "debug"
  | "tasks"
  | "checkpoints"
  | "custom"
  | "messages-tuple";

export interface AgentRuntimeStreamConfig {
  modes?: AgentRuntimeStreamMode[];
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
