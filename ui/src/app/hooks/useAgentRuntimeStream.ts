"use client";

import { useCallback, useMemo } from "react";
import {
  useStream,
  type UseStream,
  type UseStreamOptions,
} from "@langchain/langgraph-sdk/react";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";
import type {
  AgentRuntimeRunDescriptor,
  AgentRuntimeStopDescriptor,
} from "@/lib/agent-runtime-runs";

export type {
  AgentRuntimeControlIntent,
  AgentRuntimeRunDescriptor,
  AgentRuntimeRunIntent,
  AgentRuntimeStopDescriptor,
  AgentRuntimeStopIntent,
} from "@/lib/agent-runtime-runs";

export interface UseAgentRuntimeStreamOptions<
  StateType extends Record<string, unknown>
> extends Omit<UseStreamOptions<StateType>, "client"> {
  agentRuntime: ClientAgentRuntimeAdapter;
}

export type AgentRuntimeRunInput<
  StateType extends Record<string, unknown>
> = Parameters<UseStream<StateType>["submit"]>[0];

export type AgentRuntimeRunOptions<
  StateType extends Record<string, unknown>
> = Parameters<UseStream<StateType>["submit"]>[1];

export interface AgentRuntimeStream<
  StateType extends Record<string, unknown>
> extends UseStream<StateType> {
  submitRun(
    input: AgentRuntimeRunInput<StateType>,
    options?: AgentRuntimeRunOptions<StateType>,
    descriptor?: AgentRuntimeRunDescriptor
  ): Promise<void>;
  stopRun(descriptor?: AgentRuntimeStopDescriptor): Promise<void>;
}

export function useAgentRuntimeStream<
  StateType extends Record<string, unknown> = Record<string, unknown>
>({
  agentRuntime,
  ...options
}: UseAgentRuntimeStreamOptions<StateType>): AgentRuntimeStream<StateType> {
  const stream = useStream<StateType>({
    ...options,
    client: agentRuntime.getStreamClient(),
  });

  const submitRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      submitOptions?: AgentRuntimeRunOptions<StateType>,
      _descriptor?: AgentRuntimeRunDescriptor
    ) => stream.submit(input, submitOptions),
    [stream]
  );

  const stopRun = useCallback(
    (_descriptor?: AgentRuntimeStopDescriptor) => stream.stop(),
    [stream]
  );

  return useMemo(
    () => ({
      ...stream,
      submitRun,
      stopRun,
    }),
    [stream, stopRun, submitRun]
  );
}
