import { createHash } from "node:crypto";
import type { AdapterMessage, AdapterMessagePart, PublicError } from "../contract.js";
import type { OpenCodeMessageBundle, OpenCodeRuntimeEvent, OpenCodeRuntimePart } from "./opencode.js";

export type NormalizedRuntimeEvent =
  | {
      name: "message.delta";
      sessionId: string;
      payload: {
        sessionId: string;
        messageId: string;
        partId: string;
        delta?: string;
        part: AdapterMessagePart;
      };
    }
  | {
      name: "message.completed" | "message.failed";
      sessionId: string;
      payload: {
        sessionId: string;
        message: AdapterMessage;
      };
    }
  | {
      name: "tool.started" | "tool.output" | "tool.completed" | "tool.failed";
      sessionId: string;
      payload: {
        sessionId: string;
        toolStepId: string;
        tool: string;
        title?: string;
        input?: Record<string, unknown>;
        output?: string;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        error?: PublicError;
      };
    }
  | {
      name: "session.statusChanged";
      sessionId: string;
      payload: {
        sessionId: string;
        status: "idle" | "running" | "error";
      };
    }
  | {
      name: "runtime.statusChanged";
      payload: {
        status: "connected" | "disconnected" | "error";
        message?: string;
      };
    }
  | {
      name: "permission.requested";
      sessionId: string;
        payload: {
        sessionId: string;
        runtimePermission: {
          runtimePermissionId?: string;
          type: string;
          title: string;
          summary: string;
          metadata: Record<string, unknown>;
        };
      };
    };

export function normalizeRuntimeMessages(sessionId: string, messages: OpenCodeMessageBundle[]): AdapterMessage[] {
  return messages.map((message) => normalizeRuntimeMessage(sessionId, message));
}

export function normalizeRuntimeMessage(sessionId: string, message: OpenCodeMessageBundle): AdapterMessage {
  const rawMessageId = message.info.id ?? JSON.stringify(message.info);
  const role = normalizeRole(message.info.role);
  const error = normalizeRuntimeMessageError(message.info.error);
  return {
    id: stableAdapterId("msg", sessionId, rawMessageId),
    sessionId,
    role,
    status: error ? "error" : message.info.time?.completed ? "completed" : "unknown",
    parts: message.parts.map((part, index) => normalizeRuntimePart(sessionId, rawMessageId, part, index)),
    createdAt: fromEpochMillis(message.info.time?.created),
    completedAt: fromEpochMillis(message.info.time?.completed),
    error,
  };
}

export function normalizeRuntimeEvent(
  event: OpenCodeRuntimeEvent,
  resolveSessionId: (runtimeSessionId: string) => string | undefined,
): NormalizedRuntimeEvent[] {
  const payload = "payload" in event && event.payload ? event.payload : event;
  if (!isRecord(payload)) return [];

  switch (payload.type) {
    case "server.connected":
      return [{ name: "runtime.statusChanged", payload: { status: "connected" } }];
    case "session.status": {
      const properties = asRecord(payload.properties);
      const sessionId = resolveRuntimeSession(properties.sessionID, resolveSessionId);
      if (!sessionId) return [];
      const status = asRecord(properties.status).type === "busy" ? "running" : asRecord(properties.status).type === "idle" ? "idle" : "running";
      return [{ name: "session.statusChanged", sessionId, payload: { sessionId, status } }];
    }
    case "session.idle": {
      const properties = asRecord(payload.properties);
      const sessionId = resolveRuntimeSession(properties.sessionID, resolveSessionId);
      if (!sessionId) return [];
      return [{ name: "session.statusChanged", sessionId, payload: { sessionId, status: "idle" } }];
    }
    case "session.error": {
      const properties = asRecord(payload.properties);
      const sessionId = resolveRuntimeSession(properties.sessionID, resolveSessionId);
      const normalized = { status: "error" as const, message: normalizeRuntimeMessageError(properties.error)?.message ?? "Runtime session failed" };
      return sessionId
        ? [
            { name: "runtime.statusChanged", payload: normalized },
            { name: "session.statusChanged", sessionId, payload: { sessionId, status: "error" } },
          ]
        : [{ name: "runtime.statusChanged", payload: normalized }];
    }
    case "message.updated":
      return [];
    case "message.part.updated": {
      const properties = asRecord(payload.properties);
      const part = asRecord(properties.part);
      const sessionId = resolveRuntimeSession(part.sessionID, resolveSessionId);
      if (!sessionId) return [];
      const rawMessageId = String(part.messageID ?? "");
      const tool = normalizeToolEvent(sessionId, part);
      if (tool) return [tool];
      if (part.type !== "text") return [];
      const normalizedPart = normalizeRuntimePart(sessionId, rawMessageId, part as OpenCodeRuntimePart, 0);
      return [
        {
          name: "message.delta",
          sessionId,
          payload: {
            sessionId,
            messageId: stableAdapterId("msg", sessionId, rawMessageId),
            partId: normalizedPart.id,
            delta: typeof properties.delta === "string" ? properties.delta : undefined,
            part: normalizedPart,
          },
        },
      ];
    }
    case "permission.updated": {
      const properties = asRecord(payload.properties);
      const sessionId = resolveRuntimeSession(properties.sessionID, resolveSessionId);
      if (!sessionId) return [];
      const type = typeof properties.type === "string" ? properties.type : "credential";
      const title = typeof properties.title === "string" ? properties.title : "Permission requested";
      return [
        {
          name: "permission.requested",
          sessionId,
          payload: {
            sessionId,
            runtimePermission: {
              runtimePermissionId: typeof properties.id === "string" ? properties.id : undefined,
              type,
              title,
              summary: title,
              metadata: sanitizeRecord(asRecord(properties.metadata)),
            },
          },
        },
      ];
    }
    default:
      return [];
  }
}

export function normalizeRuntimeMessageError(error: unknown): PublicError | undefined {
  if (error === undefined) return undefined;
  const name = isRecord(error) && "name" in error ? String(error.name) : undefined;
  if (name === "ProviderAuthError") return { code: "PROVIDER_AUTH_ERROR", message: "Model provider authentication failed" };
  if (name === "MessageAbortedError") return { code: "MESSAGE_ABORTED", message: "Message execution was aborted" };
  if (name === "MessageOutputLengthError") return { code: "MESSAGE_OUTPUT_LENGTH", message: "Message exceeded the output length limit" };
  if (name === "APIError") return { code: "PROVIDER_API_ERROR", message: "Model provider API request failed" };
  return { code: "RUNTIME_MESSAGE_ERROR", message: "Runtime message failed" };
}

function normalizeRuntimePart(sessionId: string, rawMessageId: string, part: OpenCodeRuntimePart, index: number): AdapterMessagePart {
  const partId = stableAdapterId("part", sessionId, rawMessageId, part.id ?? String(index));
  if (part.type === "text") return { id: partId, type: "text", text: part.text ?? "" };
  return { id: partId, type: "unsupported" };
}

function normalizeToolEvent(sessionId: string, part: Record<string, unknown>): NormalizedRuntimeEvent | undefined {
  if (part.type !== "tool") return undefined;
  const state = asRecord(part.state);
  const status = typeof state.status === "string" ? state.status : "running";
  const rawToolIdentity = typeof part.callID === "string" && part.callID ? part.callID : typeof part.id === "string" && part.id ? part.id : undefined;
  if (!rawToolIdentity) return undefined;
  const toolStepId = stableAdapterId("tool", sessionId, rawToolIdentity);
  const metadata = asRecord(state.metadata);
  const input = sanitizeRecord(asRecord(state.input));
  const stdout = typeof state.stdout === "string" ? state.stdout : typeof state.output === "string" ? state.output : undefined;
  const stderr = typeof state.stderr === "string" ? state.stderr : typeof metadata.stderr === "string" ? metadata.stderr : undefined;
  const exitCode = typeof state.exitCode === "number" ? state.exitCode : typeof metadata.exitCode === "number" ? metadata.exitCode : undefined;
  const base = {
    sessionId,
    toolStepId,
    tool: typeof part.tool === "string" ? part.tool : "tool",
    title: typeof state.title === "string" ? state.title : undefined,
    input: Object.keys(input).length ? input : undefined,
  };
  if (status === "completed") {
    return {
      name: "tool.completed",
      sessionId,
      payload: { ...base, output: stdout, stdout, stderr, exitCode },
    };
  }
  if (status === "error") {
    return {
      name: "tool.failed",
      sessionId,
      payload: {
        ...base,
        error: { code: "TOOL_FAILED", message: typeof state.error === "string" ? state.error : "Tool execution failed" },
      },
    };
  }
  if (status === "running") return { name: "tool.started", sessionId, payload: base };
  return { name: "tool.output", sessionId, payload: base };
}

function resolveRuntimeSession(value: unknown, resolveSessionId: (runtimeSessionId: string) => string | undefined): string | undefined {
  return typeof value === "string" ? resolveSessionId(value) : undefined;
}

function normalizeRole(role: string | undefined): AdapterMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "unknown";
}

export function stableAdapterId(prefix: string, ...values: string[]): string {
  return `${prefix}_${createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 16)}`;
}

function fromEpochMillis(value: number | undefined): string | undefined {
  return typeof value === "number" ? new Date(value).toISOString() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean"));
}
