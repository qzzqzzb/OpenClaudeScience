"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RemoteAgentStreamEvent } from "@/lib/remote-agent";

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
  subscribe(listener: (event: RemoteAgentStreamEvent) => void): () => void;
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

function getEventKind(event: RemoteAgentStreamEvent): StreamEventKind {
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

  const appendStreamEvent = useCallback(
    (event: RemoteAgentStreamEvent) => {
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

  const clearStreamEvents = useCallback(() => {
    setStreamEvents([]);
  }, []);

  const lastUpdateNamespace = useMemo(() => {
    return streamEvents.at(-1)?.namespace;
  }, [streamEvents]);

  const interrupt = useMemo(() => {
    const interrupts = [...streamEvents]
      .reverse()
      .flatMap((event) => collectInterrupts(event.data));

    if (interrupts.length === 0) return undefined;
    if (interrupts.length === 1) return interrupts[0];
    return interrupts;
  }, [streamEvents]);

  return {
    streamEvents,
    appendStreamEvent,
    clearStreamEvents,
    interrupt,
    lastUpdateNamespace,
  };
}
