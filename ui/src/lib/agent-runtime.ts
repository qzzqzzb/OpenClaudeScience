"use client";

import {
  Client,
  type Assistant,
  type Thread,
  type ThreadState,
} from "@langchain/langgraph-sdk";
import { WebRemoteAgent } from "@/lib/remote-agent";
import type {
  AgentRuntimeStreamConfig,
  AgentRuntimeStreamEvent,
} from "@/lib/agent-runtime-events";
import { mapLangGraphStreamEventToRuntimeEvents } from "@/lib/langgraph-runtime-event-mapper";
import {
  loadPendingRunInputPreview,
  type PendingRunInputPreview,
} from "@/lib/pending-run-input";
import type { AgentRuntimeRunEvent } from "@/lib/agent-runtime-protocol";

export type AgentRuntimeProvider = "langgraph";

export interface AgentRuntimeConfig {
  provider?: AgentRuntimeProvider;
  deploymentUrl: string;
  assistantId: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface SearchAgentThreadsInput {
  limit: number;
  offset: number;
  status?: Thread["status"];
  metadata?: Record<string, unknown>;
}

export interface UpdateAgentThreadMetadataInput {
  threadId: string;
  metadata: Record<string, unknown>;
}

export interface UpdateAgentThreadStateInput {
  threadId: string;
  values: Record<string, unknown>;
}

export interface GetAgentThreadHistoryInput {
  threadId: string;
  limit?: number;
}

export interface ClientAgentRuntimeAdapter {
  readonly provider: AgentRuntimeProvider;
  readonly deploymentUrl: string;
  readonly assistantId: string;
  subscribe(listener: (event: AgentRuntimeStreamEvent) => void): () => void;
  subscribeProtocolEvents(
    listener: (event: AgentRuntimeRunEvent) => void
  ): () => void;
  getStreamClient(): Client;
  getStreamSubmitOptions(
    streamConfig?: AgentRuntimeStreamConfig
  ): ReturnType<WebRemoteAgent["getStreamSubmitOptions"]>;
  resolveAssistant(): Promise<Assistant>;
  searchThreads(input: SearchAgentThreadsInput): Promise<Thread[]>;
  getThread<ValuesType = unknown>(threadId: string): Promise<Thread<ValuesType>>;
  getThreadState<ValuesType = unknown>(
    threadId: string
  ): Promise<ThreadState<ValuesType>>;
  getThreadHistory<ValuesType = unknown>(
    input: GetAgentThreadHistoryInput
  ): Promise<ThreadState<ValuesType>[]>;
  getPendingRunInputPreview(
    threadId: string
  ): Promise<PendingRunInputPreview | null>;
  updateThreadMetadata(
    input: UpdateAgentThreadMetadataInput
  ): Promise<void>;
  updateState(input: UpdateAgentThreadStateInput): Promise<void>;
}

export class LangGraphAgentRuntimeAdapter
  implements ClientAgentRuntimeAdapter
{
  readonly provider = "langgraph" as const;
  readonly deploymentUrl: string;
  readonly assistantId: string;
  private readonly legacyAgent: WebRemoteAgent;
  private readonly protocolListeners = new Set<
    (event: AgentRuntimeRunEvent) => void
  >();

  constructor({
    apiKey,
    assistantId,
    deploymentUrl,
    headers,
  }: AgentRuntimeConfig) {
    this.deploymentUrl = deploymentUrl;
    this.assistantId = assistantId;
    this.legacyAgent = new WebRemoteAgent({
      url: deploymentUrl,
      graphName: assistantId,
      apiKey,
      headers,
    });
    this.legacyAgent.subscribe((event) => {
      this.publishProtocolEvents(event);
    });
  }

  private get client(): Client {
    return this.legacyAgent.client;
  }

  getStreamClient(): Client {
    return this.client;
  }

  subscribe(listener: (event: AgentRuntimeStreamEvent) => void): () => void {
    return this.legacyAgent.subscribe(listener);
  }

  subscribeProtocolEvents(
    listener: (event: AgentRuntimeRunEvent) => void
  ): () => void {
    this.protocolListeners.add(listener);
    return () => {
      this.protocolListeners.delete(listener);
    };
  }

  private publishProtocolEvents(event: AgentRuntimeStreamEvent): void {
    const protocolEvents = mapLangGraphStreamEventToRuntimeEvents(event, {
      includeStateEvents: true,
    });
    if (protocolEvents.length === 0) {
      return;
    }

    for (const protocolEvent of protocolEvents) {
      for (const listener of this.protocolListeners) {
        listener(protocolEvent);
      }
    }
  }

  getStreamSubmitOptions(streamConfig?: AgentRuntimeStreamConfig) {
    return this.legacyAgent.getStreamSubmitOptions(streamConfig);
  }

  resolveAssistant(): Promise<Assistant> {
    return this.legacyAgent.resolveAssistant();
  }

  searchThreads(input: SearchAgentThreadsInput): Promise<Thread[]> {
    return this.legacyAgent.searchThreads(input);
  }

  getThread<ValuesType = unknown>(
    threadId: string
  ): Promise<Thread<ValuesType>> {
    return this.client.threads.get<ValuesType>(threadId);
  }

  getThreadState<ValuesType = unknown>(
    threadId: string
  ): Promise<ThreadState<ValuesType>> {
    return this.client.threads.getState<ValuesType>(threadId);
  }

  getThreadHistory<ValuesType = unknown>({
    limit,
    threadId,
  }: GetAgentThreadHistoryInput): Promise<ThreadState<ValuesType>[]> {
    return this.client.threads.getHistory<ValuesType>(
      threadId,
      limit ? { limit } : undefined
    );
  }

  getPendingRunInputPreview(
    threadId: string
  ): Promise<PendingRunInputPreview | null> {
    return loadPendingRunInputPreview(this.client, threadId);
  }

  async updateThreadMetadata({
    metadata,
    threadId,
  }: UpdateAgentThreadMetadataInput): Promise<void> {
    await this.client.threads.update(threadId, { metadata });
  }

  updateState({ threadId, values }: UpdateAgentThreadStateInput): Promise<void> {
    return this.legacyAgent.updateState(threadId, values);
  }
}

export function createAgentRuntimeAdapter(
  config: AgentRuntimeConfig
): ClientAgentRuntimeAdapter {
  const provider = config.provider || "langgraph";

  if (provider !== "langgraph") {
    throw new Error(`Unsupported agent runtime provider: ${provider}`);
  }

  return new LangGraphAgentRuntimeAdapter(config);
}
