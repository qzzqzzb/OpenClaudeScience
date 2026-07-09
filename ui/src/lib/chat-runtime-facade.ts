"use client";

import type { Run, Thread, ThreadState } from "@langchain/langgraph-sdk";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";
import type {
  ProjectRuntimeClient,
  ProjectRuntimeStreamEvent,
  JoinProjectRuntimeRunStreamInput,
} from "@/lib/project-runtime-client";
import type { PendingRunInputPreview } from "@/lib/pending-run-input";

export interface ChatRuntimeFacade<StateType = Record<string, unknown>> {
  readonly cacheScope: string;
  listRuntimeRuns(threadId: string, options?: { limit?: number }): Promise<Run[]>;
  joinRuntimeRunStream(
    input: JoinProjectRuntimeRunStreamInput
  ): AsyncGenerator<ProjectRuntimeStreamEvent>;
  getMainThread<ValuesType = StateType>(threadId: string): Promise<Thread<ValuesType>>;
  getMainThreadState<ValuesType = StateType>(
    threadId: string
  ): Promise<ThreadState<ValuesType>>;
  getMainThreadHistory<ValuesType = StateType>(
    input: { threadId: string; limit?: number }
  ): Promise<ThreadState<ValuesType>[]>;
  getRuntimeThread<ValuesType = StateType>(
    threadId: string
  ): Promise<Thread<ValuesType>>;
  getRuntimeThreadState<ValuesType = StateType>(
    threadId: string
  ): Promise<ThreadState<ValuesType>>;
  getRuntimeThreadHistory<ValuesType = StateType>(
    threadId: string,
    options?: { limit?: number }
  ): Promise<ThreadState<ValuesType>[]>;
  getPendingRunInputPreview(
    threadId: string
  ): Promise<PendingRunInputPreview | null>;
  updateState(input: { threadId: string; values: Record<string, unknown> }): Promise<void>;
  updateThreadMetadata(input: {
    threadId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export function createChatRuntimeFacade<StateType = Record<string, unknown>>({
  agentRuntime,
  resourceId,
  runtimeClient,
  runtimeUrl,
  workspaceId,
}: {
  agentRuntime: ClientAgentRuntimeAdapter;
  runtimeClient: ProjectRuntimeClient<StateType> | null;
  runtimeUrl?: string;
  resourceId?: string;
  workspaceId?: string;
}): ChatRuntimeFacade<StateType> {
  return {
    cacheScope: [
      agentRuntime.deploymentUrl,
      agentRuntime.assistantId,
      runtimeUrl || "",
      resourceId || "",
      workspaceId || "",
    ].join("|"),

    listRuntimeRuns(threadId, options) {
      if (!runtimeClient) {
        return Promise.resolve([]);
      }
      return runtimeClient.listRuns(threadId, options);
    },

    joinRuntimeRunStream(input) {
      if (!runtimeClient) {
        throw new Error("Runtime protocol facade has no project runtime client.");
      }
      return runtimeClient.joinRunStream(input);
    },

    getMainThread(threadId) {
      return agentRuntime.getThread(threadId);
    },

    getMainThreadState(threadId) {
      return agentRuntime.getThreadState(threadId);
    },

    getMainThreadHistory(input) {
      return agentRuntime.getThreadHistory(input);
    },

    getRuntimeThread(threadId) {
      if (!runtimeClient) {
        return Promise.reject(new Error("Runtime client is not configured."));
      }
      return runtimeClient.getThread(threadId);
    },

    getRuntimeThreadState(threadId) {
      if (!runtimeClient) {
        return Promise.reject(new Error("Runtime client is not configured."));
      }
      return runtimeClient.getThreadState(threadId);
    },

    getRuntimeThreadHistory(threadId, options) {
      if (!runtimeClient) {
        return Promise.reject(new Error("Runtime client is not configured."));
      }
      return runtimeClient.getThreadHistory(threadId, options);
    },

    async getPendingRunInputPreview(threadId) {
      return (
        (await agentRuntime.getPendingRunInputPreview(threadId)) ??
        (runtimeClient
          ? await runtimeClient.getPendingRunInputPreview(threadId)
          : null)
      );
    },

    updateState(input) {
      return agentRuntime.updateState(input);
    },

    updateThreadMetadata(input) {
      return agentRuntime.updateThreadMetadata(input);
    },
  };
}
