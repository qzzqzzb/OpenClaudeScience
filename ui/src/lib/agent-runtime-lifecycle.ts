import type {
  AgentRuntimeDoneEvent,
  AgentRuntimeErrorEvent,
  AgentRuntimeErrorShape,
  AgentRuntimeRunStartedEvent,
} from "./agent-runtime-protocol";

export interface AgentRuntimeRunIdentity {
  runId: string;
  threadId?: string | null;
  at?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeDoneInput {
  runId?: string;
  status: AgentRuntimeDoneEvent["status"];
  usage?: AgentRuntimeDoneEvent["usage"];
  metadata?: Record<string, unknown>;
}

export function createAgentRuntimeRunStartedEvent({
  at,
  metadata,
  runId,
  threadId,
}: AgentRuntimeRunIdentity): AgentRuntimeRunStartedEvent {
  return {
    type: "run_started",
    runId,
    threadId,
    at: at || new Date().toISOString(),
    metadata,
  };
}

export function createAgentRuntimeDoneEvent({
  metadata,
  runId,
  status,
  usage,
}: AgentRuntimeDoneInput): AgentRuntimeDoneEvent {
  return {
    type: "done",
    runId,
    status,
    usage,
    metadata,
  };
}

export function createAgentRuntimeErrorEvent(
  error: AgentRuntimeErrorShape
): AgentRuntimeErrorEvent {
  return {
    type: "error",
    error,
  };
}

export function unknownRuntimeError(
  error: unknown,
  fallbackMessage = "Agent runtime failed."
): AgentRuntimeErrorShape {
  if (error instanceof Error) {
    return {
      code: "UNKNOWN",
      message: error.message || fallbackMessage,
      retryable: true,
      details: {
        name: error.name,
      },
    };
  }

  if (typeof error === "string") {
    return {
      code: "UNKNOWN",
      message: error || fallbackMessage,
      retryable: true,
    };
  }

  return {
    code: "UNKNOWN",
    message: fallbackMessage,
    retryable: true,
    details: error,
  };
}

export function createAgentRuntimeFailedEvents({
  error,
  metadata,
  runId,
}: {
  error: unknown;
  runId?: string;
  metadata?: Record<string, unknown>;
}): [AgentRuntimeErrorEvent, AgentRuntimeDoneEvent] {
  return [
    createAgentRuntimeErrorEvent(unknownRuntimeError(error)),
    createAgentRuntimeDoneEvent({
      runId,
      status: "failed",
      metadata,
    }),
  ];
}

export function createAgentRuntimeCancelledEvents({
  message = "Agent runtime run cancelled.",
  metadata,
  runId,
}: {
  message?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}): [AgentRuntimeErrorEvent, AgentRuntimeDoneEvent] {
  return [
    createAgentRuntimeErrorEvent({
      code: "CANCELLED",
      message,
      retryable: false,
    }),
    createAgentRuntimeDoneEvent({
      runId,
      status: "cancelled",
      metadata,
    }),
  ];
}
