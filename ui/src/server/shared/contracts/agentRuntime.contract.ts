import type {
  AdapterErrorShape,
  AdapterOperationOptions,
} from "./adapterError.contract";

export type AgentRole = "system" | "user" | "assistant" | "tool";

export interface AgentRuntimeHealthInput extends AdapterOperationOptions {
  resourceId?: string;
  assistantId?: string;
}

export interface AgentRuntimeHealth {
  ok: boolean;
  status: "ready" | "unavailable" | "degraded";
  message?: string;
  details?: unknown;
}

export interface AgentThread {
  threadId: string;
  resourceId?: string;
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentThreadInput {
  resourceId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentThreadResult {
  threadId: string;
  metadata?: Record<string, unknown>;
}

export interface GetAgentThreadStateInput {
  threadId: string;
  resourceId?: string;
}

export interface AgentThreadState {
  thread: AgentThread;
  values?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id?: string;
  role: AgentRole;
  content: string;
  name?: string;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
}

export interface AgentWorkspaceContext {
  resourceId?: string;
  workspaceId?: string;
  rootLabel?: string;
  allowedPaths?: string[];
}

export interface EnabledSkill {
  key: string;
  name: string;
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentAttachment {
  name: string;
  mimeType?: string;
  size?: number;
  workspacePath?: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunInput extends AdapterOperationOptions {
  threadId: string;
  assistantId: string;
  resourceId?: string;
  workspaceId?: string;
  messages: AgentMessage[];
  model?: AgentModelConfig;
  workspace?: AgentWorkspaceContext;
  skills?: EnabledSkill[];
  attachments?: AgentAttachment[];
  runtimeOptions?: Record<string, unknown>;
}

export interface CancelAgentRunInput extends AdapterOperationOptions {
  threadId: string;
  runId: string;
  resourceId?: string;
}

export interface CancelAgentRunResult {
  runId: string;
  status: "cancelled" | "not_found" | "already_finished";
  message?: string;
}

export interface AgentRunStartedEvent {
  type: "run_started";
  runId: string;
  threadId: string;
  at: string;
}

export interface AgentMessageDeltaEvent {
  type: "message_delta";
  messageId: string;
  role: "assistant";
  text: string;
}

export interface AgentMessageCompletedEvent {
  type: "message_completed";
  messageId: string;
  text?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolCallEvent {
  type: "tool_call";
  toolCallId: string;
  name: string;
  args: unknown;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentToolResultEvent {
  type: "tool_result";
  toolCallId: string;
  name?: string;
  result: unknown;
  isError?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AgentInterruptEvent {
  type: "interrupt";
  interruptId: string;
  reason: "approval_required" | "input_required" | "policy_blocked" | "other";
  message: string;
  payload?: unknown;
}

export interface AgentStateEvent {
  type: "state";
  state: unknown;
  metadata?: Record<string, unknown>;
}

export interface AgentArtifactEvent {
  type: "artifact";
  artifact: {
    name: string;
    mimeType?: string;
    workspacePath?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface AgentErrorEvent {
  type: "error";
  error: AdapterErrorShape;
}

export interface AgentRunCompletedEvent {
  type: "done";
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

export type AgentRunEvent =
  | AgentRunStartedEvent
  | AgentMessageDeltaEvent
  | AgentMessageCompletedEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentInterruptEvent
  | AgentStateEvent
  | AgentArtifactEvent
  | AgentErrorEvent
  | AgentRunCompletedEvent;

export interface AgentRuntimeAdapter {
  healthCheck(input?: AgentRuntimeHealthInput): Promise<AgentRuntimeHealth>;
  createThread(input: CreateAgentThreadInput): Promise<CreateAgentThreadResult>;
  getThreadState(input: GetAgentThreadStateInput): Promise<AgentThreadState>;
  run(input: AgentRunInput): AsyncIterable<AgentRunEvent>;
  cancelRun(input: CancelAgentRunInput): Promise<CancelAgentRunResult>;
}
