"use client";

import {
  Client,
  type Assistant,
  type StreamMode,
  type Thread,
} from "@langchain/langgraph-sdk";
import type {
  AgentRuntimeStreamConfig,
  AgentRuntimeStreamEvent,
} from "@/lib/agent-runtime-events";

export const TEXTUAL_COMPAT_STREAM_MODES: StreamMode[] = [
  "messages-tuple",
  "updates",
  "values",
];

export type RemoteAgentStreamConfig = AgentRuntimeStreamConfig;
export type RemoteAgentStreamEvent = AgentRuntimeStreamEvent;

interface WebRemoteAgentOptions {
  url: string;
  graphName: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

type StreamListener = (event: RemoteAgentStreamEvent) => void;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function fallbackAssistant(graphName: string): Assistant {
  const now = new Date().toISOString();
  return {
    assistant_id: graphName,
    graph_id: graphName,
    created_at: now,
    updated_at: now,
    config: {},
    metadata: {},
    version: 1,
    name: graphName,
    context: {},
  };
}

function normalizeStreamModes(modes?: StreamMode[]): StreamMode[] {
  const normalized: StreamMode[] = (
    modes?.length ? modes : TEXTUAL_COMPAT_STREAM_MODES
  ).map((mode) => (mode === "messages" ? "messages-tuple" : mode));
  const result: StreamMode[] = [...normalized];

  for (const requiredMode of TEXTUAL_COMPAT_STREAM_MODES) {
    if (!result.includes(requiredMode)) {
      result.push(requiredMode);
    }
  }

  return [...new Set(result)];
}

function splitRawEvent(rawEvent: string): {
  mode: string;
  namespace?: string[];
} {
  const [mode, ...namespace] = rawEvent.split("|");
  return {
    mode,
    namespace: namespace.length > 0 ? namespace : undefined,
  };
}

export function shouldForwardEventToUseStream(rawEvent: string): boolean {
  const { namespace } = splitRawEvent(rawEvent);
  // Keep all subgraph events in streamEvents, but out of the top-level chat reducer.
  return !namespace?.length;
}

export class WebRemoteAgent {
  readonly url: string;
  readonly graphName: string;
  readonly client: Client;

  private listeners = new Set<StreamListener>();
  private eventSequence = 0;

  constructor({ url, graphName, apiKey, headers }: WebRemoteAgentOptions) {
    this.url = url;
    this.graphName = graphName;
    this.client = new Client({
      apiUrl: url,
      defaultHeaders: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-Api-Key": apiKey } : {}),
        ...headers,
      },
    });
    this.tapClientStreams();
  }

  subscribe(listener: StreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStreamSubmitOptions(streamConfig?: RemoteAgentStreamConfig) {
    return {
      streamMode: normalizeStreamModes(streamConfig?.modes),
      streamSubgraphs: streamConfig?.subgraphs ?? true,
      durability: "exit" as const,
    };
  }

  async resolveAssistant(): Promise<Assistant> {
    if (isUuid(this.graphName)) {
      try {
        return await this.client.assistants.get(this.graphName);
      } catch (error) {
        console.error("Failed to fetch assistant:", error);
        return fallbackAssistant(this.graphName);
      }
    }

    try {
      const assistants = await this.client.assistants.search({
        graphId: this.graphName,
        limit: 100,
      });
      const defaultAssistant = assistants.find(
        (assistant) => assistant.metadata?.["created_by"] === "system"
      );
      if (defaultAssistant) {
        return defaultAssistant;
      }
      throw new Error("No default assistant found");
    } catch (error) {
      console.error(
        "Failed to find default assistant from graph_id: try setting the assistant_id directly:",
        error
      );
      return fallbackAssistant(this.graphName);
    }
  }

  async searchThreads({
    limit,
    offset,
    status,
    metadata,
  }: {
    limit: number;
    offset: number;
    status?: Thread["status"];
    metadata?: Record<string, unknown>;
  }): Promise<Thread[]> {
    const metadataFilter = {
      ...(metadata ?? {}),
      ...(isUuid(this.graphName) ? { assistant_id: this.graphName } : {}),
    };

    return this.client.threads.search({
      limit,
      offset,
      sortBy: "updated_at" as const,
      sortOrder: "desc" as const,
      status,
      ...(Object.keys(metadataFilter).length > 0
        ? { metadata: metadataFilter }
        : {}),
    });
  }

  async updateState(threadId: string, values: Record<string, unknown>) {
    await this.client.threads.updateState(threadId, { values });
  }

  private tapClientStreams() {
    const runs = this.client.runs as any;
    const originalStream = runs.stream.bind(runs);
    const originalJoinStream = runs.joinStream.bind(runs);

    runs.stream = async function* tappedStream(
      this: WebRemoteAgent,
      ...args: unknown[]
    ) {
      const threadId =
        typeof args[0] === "string" || args[0] === null ? args[0] : undefined;
      for await (const event of originalStream(...args)) {
        this.captureSdkEvent(event, threadId);
        if (shouldForwardEventToUseStream(event.event)) {
          yield event;
        }
      }
    }.bind(this);

    runs.joinStream = async function* tappedJoinStream(
      this: WebRemoteAgent,
      ...args: unknown[]
    ) {
      const threadId =
        typeof args[0] === "string" || args[0] === null ? args[0] : undefined;
      for await (const event of originalJoinStream(...args)) {
        this.captureSdkEvent(event, threadId);
        if (shouldForwardEventToUseStream(event.event)) {
          yield event;
        }
      }
    }.bind(this);
  }

  private captureSdkEvent(event: {
    id?: string;
    event: string;
    data: unknown;
  }, threadId?: string | null) {
    const { mode, namespace } = splitRawEvent(event.event);
    const record: RemoteAgentStreamEvent = {
      id: event.id ?? `${Date.now()}-${this.eventSequence++}`,
      at: Date.now(),
      threadId,
      rawEvent: event.event,
      mode,
      namespace,
      data: event.data,
    };

    for (const listener of this.listeners) {
      listener(record);
    }
  }
}
