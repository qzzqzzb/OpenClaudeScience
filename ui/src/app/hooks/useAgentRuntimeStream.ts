"use client";

import {
  useStream,
  type UseStream,
  type UseStreamOptions,
} from "@langchain/langgraph-sdk/react";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";

export interface UseAgentRuntimeStreamOptions<
  StateType extends Record<string, unknown>
> extends Omit<UseStreamOptions<StateType>, "client"> {
  agentRuntime: ClientAgentRuntimeAdapter;
}

export function useAgentRuntimeStream<
  StateType extends Record<string, unknown> = Record<string, unknown>
>({
  agentRuntime,
  ...options
}: UseAgentRuntimeStreamOptions<StateType>): UseStream<StateType> {
  return useStream<StateType>({
    ...options,
    client: agentRuntime.client,
  });
}
