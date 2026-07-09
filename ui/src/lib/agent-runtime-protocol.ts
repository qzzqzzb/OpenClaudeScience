import type { AgentRuntimeControlIntent } from "./agent-runtime-runs";

export type AgentRuntimeProviderKind = "langgraph" | "mock" | "opencode";

export type AgentRuntimeRole = "system" | "user" | "assistant" | "tool";

export type AgentRuntimeRunStatus =
  | "queued"
  | "running"
  | "interrupted"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AgentRuntimeMessage {
  id?: string;
  role: AgentRuntimeRole;
  content: string | unknown[];
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeModelConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeWorkspaceContext {
  resourceId?: string;
  workspaceId?: string;
  rootLabel?: string;
  logicalRoot?: string;
  allowedPaths?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeSkillContext {
  key: string;
  name: string;
  sourcePath?: string;
  relativePath?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeMcpToolContext {
  serverName: string;
  toolName: string;
  transport?: "stdio" | "sse" | "http";
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeAttachment {
  name: string;
  mimeType?: string;
  size?: number;
  workspacePath?: string;
  extractedWorkspacePath?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeRunInput {
  intent: AgentRuntimeControlIntent;
  threadId?: string | null;
  assistantId: string;
  resourceId?: string;
  workspaceId?: string;
  messages?: AgentRuntimeMessage[];
  model?: AgentRuntimeModelConfig;
  workspace?: AgentRuntimeWorkspaceContext;
  skills?: AgentRuntimeSkillContext[];
  mcpTools?: AgentRuntimeMcpToolContext[];
  attachments?: AgentRuntimeAttachment[];
  runtimeOptions?: Record<string, unknown>;
  rawInput?: unknown;
  rawOptions?: unknown;
}

export interface AgentRuntimeErrorShape {
  code:
    | "INVALID_INPUT"
    | "AUTH_FAILED"
    | "MODEL_UNAVAILABLE"
    | "RUNTIME_UNAVAILABLE"
    | "TOOL_FAILED"
    | "TIMEOUT"
    | "CANCELLED"
    | "UNKNOWN";
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export interface AgentRuntimeRunStartedEvent {
  type: "run_started";
  runId: string;
  threadId?: string | null;
  at: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeMessageDeltaEvent {
  type: "message_delta";
  messageId?: string;
  role: "assistant";
  text: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeMessageCompletedEvent {
  type: "message_completed";
  messageId?: string;
  role: "assistant";
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  name: string;
  args?: unknown;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  name?: string;
  result?: unknown;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeInterruptEvent {
  type: "interrupt";
  interruptId?: string;
  reason: "approval_required" | "input_required" | "policy_blocked" | "other";
  message: string;
  payload?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeStateEvent {
  type: "state";
  state: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeArtifactEvent {
  type: "artifact";
  artifact: {
    name: string;
    mimeType?: string;
    workspacePath?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface AgentRuntimeErrorEvent {
  type: "error";
  error: AgentRuntimeErrorShape;
}

export interface AgentRuntimeDoneEvent {
  type: "done";
  runId?: string;
  status: Extract<AgentRuntimeRunStatus, "succeeded" | "failed" | "cancelled">;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export type AgentRuntimeRunEvent =
  | AgentRuntimeRunStartedEvent
  | AgentRuntimeMessageDeltaEvent
  | AgentRuntimeMessageCompletedEvent
  | AgentRuntimeToolCallEvent
  | AgentRuntimeToolResultEvent
  | AgentRuntimeInterruptEvent
  | AgentRuntimeStateEvent
  | AgentRuntimeArtifactEvent
  | AgentRuntimeErrorEvent
  | AgentRuntimeDoneEvent;
