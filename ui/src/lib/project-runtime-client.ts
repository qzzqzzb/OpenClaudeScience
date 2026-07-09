"use client";

import {
  Client,
  type Run,
  type Thread,
  type ThreadState,
} from "@langchain/langgraph-sdk";
import type { AgentRuntimeStreamMode } from "@/lib/agent-runtime-events";
import {
  loadPendingRunInputPreview,
  type PendingRunInputPreview,
} from "@/lib/pending-run-input";

export interface ProjectRuntimeStreamEvent {
  id?: string;
  event: unknown;
  data: unknown;
}

export interface JoinProjectRuntimeRunStreamInput {
  threadId: string | null;
  runId: string;
  signal?: AbortSignal;
  lastEventId?: string;
  streamMode?: AgentRuntimeStreamMode | AgentRuntimeStreamMode[];
}

export interface ProjectRuntimeClient<StateType = Record<string, unknown>> {
  readonly runtimeUrl: string;
  getThread<ValuesType = StateType>(threadId: string): Promise<Thread<ValuesType>>;
  getThreadState<ValuesType = StateType>(
    threadId: string
  ): Promise<ThreadState<ValuesType>>;
  getThreadHistory<ValuesType = StateType>(
    threadId: string,
    options?: { limit?: number }
  ): Promise<ThreadState<ValuesType>[]>;
  getPendingRunInputPreview(
    threadId: string
  ): Promise<PendingRunInputPreview | null>;
  listRuns(threadId: string, options?: { limit?: number }): Promise<Run[]>;
  joinRunStream(
    input: JoinProjectRuntimeRunStreamInput
  ): AsyncGenerator<ProjectRuntimeStreamEvent>;
}

class LangGraphProjectRuntimeClient<StateType = Record<string, unknown>>
  implements ProjectRuntimeClient<StateType>
{
  private readonly client: Client<StateType>;

  constructor(readonly runtimeUrl: string) {
    this.client = new Client<StateType>({
      apiUrl: runtimeUrl,
      defaultHeaders: { "Content-Type": "application/json" },
    });
  }

  getThread<ValuesType = StateType>(
    threadId: string
  ): Promise<Thread<ValuesType>> {
    return this.client.threads.get<ValuesType>(threadId);
  }

  getThreadState<ValuesType = StateType>(
    threadId: string
  ): Promise<ThreadState<ValuesType>> {
    return this.client.threads.getState<ValuesType>(threadId);
  }

  getThreadHistory<ValuesType = StateType>(
    threadId: string,
    options?: { limit?: number }
  ): Promise<ThreadState<ValuesType>[]> {
    return this.client.threads.getHistory<ValuesType>(threadId, options);
  }

  getPendingRunInputPreview(
    threadId: string
  ): Promise<PendingRunInputPreview | null> {
    return loadPendingRunInputPreview(this.client, threadId);
  }

  listRuns(threadId: string, options?: { limit?: number }): Promise<Run[]> {
    return this.client.runs.list(threadId, options);
  }

  joinRunStream({
    lastEventId,
    runId,
    signal,
    streamMode,
    threadId,
  }: JoinProjectRuntimeRunStreamInput): AsyncGenerator<ProjectRuntimeStreamEvent> {
    return this.client.runs.joinStream(threadId, runId, {
      signal,
      lastEventId,
      streamMode,
    });
  }
}

export function createProjectRuntimeClient<
  StateType = Record<string, unknown>
>(runtimeUrl: string): ProjectRuntimeClient<StateType> {
  return new LangGraphProjectRuntimeClient<StateType>(runtimeUrl);
}
