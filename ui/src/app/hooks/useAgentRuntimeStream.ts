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
  AgentRuntimeRunIntent,
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
  submitSendMessageRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitRetryMessageRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitSingleStepRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitRerunSubagentStepRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitContinueRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitResolveThreadRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  submitResumeInterruptRun(
    input: AgentRuntimeRunInput<StateType>,
    options: AgentRuntimeRunOptions<StateType>
  ): Promise<void>;
  stopCurrentRun(): Promise<void>;
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
      descriptor?: AgentRuntimeRunDescriptor
    ) =>
      agentRuntime.submitStreamRun({
        driver: stream,
        input,
        options: submitOptions,
        descriptor,
      }),
    [agentRuntime, stream]
  );

  const stopRun = useCallback(
    (descriptor?: AgentRuntimeStopDescriptor) =>
      agentRuntime.stopStreamRun({
        driver: stream,
        descriptor,
      }),
    [agentRuntime, stream]
  );

  const submitRunWithIntent = useCallback(
    (
      intent: AgentRuntimeRunIntent,
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRun(input, runOptions, { intent }),
    [submitRun]
  );

  const submitSendMessageRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("send_message", input, runOptions),
    [submitRunWithIntent]
  );

  const submitRetryMessageRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("retry_message", input, runOptions),
    [submitRunWithIntent]
  );

  const submitSingleStepRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("single_step", input, runOptions),
    [submitRunWithIntent]
  );

  const submitRerunSubagentStepRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("rerun_subagent_step", input, runOptions),
    [submitRunWithIntent]
  );

  const submitContinueRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("continue_run", input, runOptions),
    [submitRunWithIntent]
  );

  const submitResolveThreadRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("resolve_thread", input, runOptions),
    [submitRunWithIntent]
  );

  const submitResumeInterruptRun = useCallback(
    (
      input: AgentRuntimeRunInput<StateType>,
      runOptions: AgentRuntimeRunOptions<StateType>
    ) => submitRunWithIntent("resume_interrupt", input, runOptions),
    [submitRunWithIntent]
  );

  const stopCurrentRun = useCallback(
    () => stopRun({ intent: "stop_run" }),
    [stopRun]
  );

  return useMemo(
    () => ({
      ...stream,
      submitRun,
      stopRun,
      submitSendMessageRun,
      submitRetryMessageRun,
      submitSingleStepRun,
      submitRerunSubagentStepRun,
      submitContinueRun,
      submitResolveThreadRun,
      submitResumeInterruptRun,
      stopCurrentRun,
    }),
    [
      stream,
      stopRun,
      stopCurrentRun,
      submitContinueRun,
      submitResolveThreadRun,
      submitResumeInterruptRun,
      submitRetryMessageRun,
      submitRerunSubagentStepRun,
      submitRun,
      submitSendMessageRun,
      submitSingleStepRun,
    ]
  );
}
