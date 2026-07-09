"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentRuntimeStreamEvent } from "@/lib/agent-runtime-events";
import type {
  AgentRuntimeInterruptEvent,
  AgentRuntimeRunEvent,
} from "@/lib/agent-runtime-protocol";

export type StreamEventKind =
  | "message"
  | "update"
  | "interrupt"
  | "value"
  | "metadata"
  | "error"
  | "other";

export interface StreamEventRecord {
  id: string;
  kind: StreamEventKind;
  at: number;
  threadId?: string | null;
  mode: string;
  rawEvent: string;
  namespace?: string[];
  data: unknown;
}

const MAX_STREAM_EVENTS = 100;

interface RuntimeStreamEventSource {
  subscribe(listener: (event: AgentRuntimeStreamEvent) => void): () => void;
  subscribeProtocolEvents?(
    listener: (event: AgentRuntimeRunEvent) => void
  ): () => void;
}

function collectInterrupts(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const interrupts: unknown[] = [];
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.__interrupt__)) {
    interrupts.push(...record.__interrupt__);
  }

  for (const value of Object.values(record)) {
    if (!value || typeof value !== "object") continue;
    const nested = value as Record<string, unknown>;
    if (Array.isArray(nested.__interrupt__)) {
      interrupts.push(...nested.__interrupt__);
    }
  }

  return interrupts;
}

function getEventKind(event: AgentRuntimeStreamEvent): StreamEventKind {
  if (collectInterrupts(event.data).length > 0) return "interrupt";
  if (event.mode === "messages" || event.mode === "messages-tuple") {
    return "message";
  }
  if (event.mode === "updates") return "update";
  if (event.mode === "values") return "value";
  if (event.mode === "metadata") return "metadata";
  if (event.mode === "error") return "error";
  return "other";
}

export function useStreamEventLayer(
  runtime: RuntimeStreamEventSource,
  currentThreadId?: string | null
) {
  const [streamEvents, setStreamEvents] = useState<StreamEventRecord[]>([]);
  const [protocolEvents, setProtocolEvents] = useState<AgentRuntimeRunEvent[]>(
    []
  );

  const appendStreamEvent = useCallback(
    (event: AgentRuntimeStreamEvent) => {
      if (
        currentThreadId &&
        event.threadId &&
        event.threadId !== currentThreadId
      ) {
        return;
      }

      const record: StreamEventRecord = {
        id: event.id,
        kind: getEventKind(event),
        at: event.at,
        threadId: event.threadId,
        mode: event.mode,
        rawEvent: event.rawEvent,
        namespace: event.namespace,
        data: event.data,
      };

      setStreamEvents((prev) => [...prev, record].slice(-MAX_STREAM_EVENTS));
    },
    [currentThreadId]
  );

  useEffect(() => {
    return runtime.subscribe(appendStreamEvent);
  }, [runtime, appendStreamEvent]);

  const appendProtocolEvent = useCallback((event: AgentRuntimeRunEvent) => {
    setProtocolEvents((prev) => [...prev, event].slice(-MAX_STREAM_EVENTS));
  }, []);

  useEffect(() => {
    return runtime.subscribeProtocolEvents?.(appendProtocolEvent);
  }, [runtime, appendProtocolEvent]);

  const clearStreamEvents = useCallback(() => {
    setStreamEvents([]);
    setProtocolEvents([]);
  }, []);

  const lastUpdateNamespace = useMemo(() => {
    return streamEvents.at(-1)?.namespace;
  }, [streamEvents]);

  const interrupt = useMemo(() => {
    const interrupts = [...streamEvents]
      .reverse()
      .flatMap((event) => collectInterrupts(event.data));

    const protocolInterrupts = [...protocolEvents]
      .reverse()
      .filter(
        (event): event is AgentRuntimeInterruptEvent =>
          event.type === "interrupt"
      )
      .map((event) => event.payload ?? event);
    const combinedInterrupts = [...interrupts, ...protocolInterrupts];

    if (combinedInterrupts.length === 0) return undefined;
    if (combinedInterrupts.length === 1) return combinedInterrupts[0];
    return combinedInterrupts;
  }, [protocolEvents, streamEvents]);

  return {
    streamEvents,
    protocolEvents,
    appendStreamEvent,
    appendProtocolEvent,
    clearStreamEvents,
    interrupt,
    lastUpdateNamespace,
  };
}
