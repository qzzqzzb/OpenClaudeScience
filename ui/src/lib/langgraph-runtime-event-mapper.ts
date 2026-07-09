import type { AgentRuntimeStreamEvent } from "./agent-runtime-events";
import type {
  AgentRuntimeInterruptEvent,
  AgentRuntimeRunEvent,
  AgentRuntimeToolCallEvent,
  AgentRuntimeToolResultEvent,
} from "./agent-runtime-protocol";

interface LangGraphMessageLike {
  id?: unknown;
  type?: unknown;
  role?: unknown;
  content?: unknown;
  name?: unknown;
  tool_call_id?: unknown;
  tool_calls?: unknown;
  additional_kwargs?: {
    tool_calls?: unknown;
  };
  response_metadata?: unknown;
  status?: unknown;
}

interface LangGraphToolCallLike {
  id?: unknown;
  name?: unknown;
  args?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

export interface LangGraphRuntimeEventMapperOptions {
  includeStateEvents?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function contentToText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      const record = asRecord(part);
      if (record?.type === "text" && typeof record.text === "string") {
        return record.text;
      }

      return "";
    })
    .join("");

  return text || undefined;
}

function normalizeRole(value: unknown): "assistant" | "user" | "tool" | "system" | undefined {
  if (value === "ai" || value === "assistant") {
    return "assistant";
  }
  if (value === "human" || value === "user") {
    return "user";
  }
  if (value === "tool") {
    return "tool";
  }
  if (value === "system") {
    return "system";
  }
  return undefined;
}

function extractMessage(data: unknown): LangGraphMessageLike | null {
  if (Array.isArray(data)) {
    const [message] = data;
    return asRecord(message) as LangGraphMessageLike | null;
  }

  const record = asRecord(data);
  if (!record) {
    return null;
  }

  if (asRecord(record.message)) {
    return record.message as LangGraphMessageLike;
  }

  if ("content" in record || "tool_calls" in record || "type" in record) {
    return record as LangGraphMessageLike;
  }

  return null;
}

function extractToolCalls(message: LangGraphMessageLike): LangGraphToolCallLike[] {
  const directCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : [];
  const additionalCalls = Array.isArray(message.additional_kwargs?.tool_calls)
    ? message.additional_kwargs.tool_calls
    : [];

  return [...directCalls, ...additionalCalls]
    .map((call) => asRecord(call) as LangGraphToolCallLike | null)
    .filter((call): call is LangGraphToolCallLike => Boolean(call));
}

function toolCallToEvent(
  call: LangGraphToolCallLike,
  index: number,
  source: AgentRuntimeStreamEvent
): AgentRuntimeToolCallEvent {
  const toolCallId =
    asString(call.id) || `${source.id}:tool-call:${index.toString()}`;
  const name =
    asString(call.name) ||
    asString(call.function?.name) ||
    "unknown_tool";
  const args = call.args ?? call.function?.arguments;

  return {
    type: "tool_call",
    toolCallId,
    name,
    args,
    metadata: {
      sourceEventId: source.id,
      rawEvent: source.rawEvent,
      mode: source.mode,
      namespace: source.namespace,
    },
  };
}

function messageToToolResultEvent(
  message: LangGraphMessageLike,
  source: AgentRuntimeStreamEvent
): AgentRuntimeToolResultEvent {
  const toolCallId =
    asString(message.tool_call_id) ||
    asString(message.id) ||
    `${source.id}:tool-result`;

  return {
    type: "tool_result",
    toolCallId,
    name: asString(message.name),
    result: message.content,
    isError: message.status === "error",
    metadata: {
      sourceEventId: source.id,
      rawEvent: source.rawEvent,
      mode: source.mode,
      namespace: source.namespace,
    },
  };
}

function mapMessageEvent(source: AgentRuntimeStreamEvent): AgentRuntimeRunEvent[] {
  const message = extractMessage(source.data);
  if (!message) {
    return [];
  }

  const role = normalizeRole(message.type) || normalizeRole(message.role);
  const events: AgentRuntimeRunEvent[] = [];

  if (role === "assistant") {
    const text = contentToText(message.content);
    if (text) {
      events.push({
        type: "message_delta",
        messageId: asString(message.id),
        role: "assistant",
        text,
        metadata: {
          sourceEventId: source.id,
          rawEvent: source.rawEvent,
          mode: source.mode,
          namespace: source.namespace,
        },
      });
    }

    events.push(
      ...extractToolCalls(message).map((call, index) =>
        toolCallToEvent(call, index, source)
      )
    );
  }

  if (role === "tool") {
    events.push(messageToToolResultEvent(message, source));
  }

  return events;
}

function collectInterrupts(data: unknown): unknown[] {
  const record = asRecord(data);
  if (!record) {
    return [];
  }

  const interrupts: unknown[] = [];
  if (Array.isArray(record.__interrupt__)) {
    interrupts.push(...record.__interrupt__);
  }

  for (const value of Object.values(record)) {
    const nested = asRecord(value);
    if (Array.isArray(nested?.__interrupt__)) {
      interrupts.push(...nested.__interrupt__);
    }
  }

  return interrupts;
}

function interruptMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  const directMessage = asString(record?.message);
  if (directMessage) {
    return directMessage;
  }

  const nestedValue = record?.value;
  if (typeof nestedValue === "string") {
    return nestedValue;
  }

  const actionRequest = asRecord(record?.action_request);
  const action = asString(actionRequest?.action);
  if (action) {
    return `Approval required for ${action}.`;
  }

  return "LangGraph runtime interrupted.";
}

function mapInterrupts(source: AgentRuntimeStreamEvent): AgentRuntimeInterruptEvent[] {
  return collectInterrupts(source.data).map((interrupt, index) => ({
    type: "interrupt",
    interruptId: `${source.id}:interrupt:${index.toString()}`,
    reason: "approval_required",
    message: interruptMessage(interrupt),
    payload: interrupt,
    metadata: {
      sourceEventId: source.id,
      rawEvent: source.rawEvent,
      mode: source.mode,
      namespace: source.namespace,
    },
  }));
}

export function mapLangGraphStreamEventToRuntimeEvents(
  source: AgentRuntimeStreamEvent,
  options: LangGraphRuntimeEventMapperOptions = {}
): AgentRuntimeRunEvent[] {
  const interruptEvents = mapInterrupts(source);
  if (interruptEvents.length > 0) {
    return interruptEvents;
  }

  if (source.mode === "messages" || source.mode === "messages-tuple") {
    return mapMessageEvent(source);
  }

  if (source.mode === "error") {
    return [
      {
        type: "error",
        error: {
          code: "UNKNOWN",
          message:
            typeof source.data === "string"
              ? source.data
              : "LangGraph runtime emitted an error event.",
          retryable: true,
          details: source.data,
        },
      },
    ];
  }

  if (
    options.includeStateEvents &&
    (source.mode === "values" || source.mode === "updates")
  ) {
    return [
      {
        type: "state",
        state: source.data,
        metadata: {
          sourceEventId: source.id,
          rawEvent: source.rawEvent,
          mode: source.mode,
          namespace: source.namespace,
        },
      },
    ];
  }

  return [];
}

export function mapLangGraphStreamEventsToRuntimeEvents(
  sources: AgentRuntimeStreamEvent[],
  options: LangGraphRuntimeEventMapperOptions = {}
): AgentRuntimeRunEvent[] {
  return sources.flatMap((source) =>
    mapLangGraphStreamEventToRuntimeEvents(source, options)
  );
}
