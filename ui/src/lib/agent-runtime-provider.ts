import type {
  AgentRuntimeProviderKind,
  AgentRuntimeRunEvent,
  AgentRuntimeRunInput,
} from "./agent-runtime-protocol";

export interface AgentRuntimeProviderRunOptions {
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeCancelRunInput {
  runId?: string;
  threadId?: string | null;
  reason?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeProviderHealth {
  provider: AgentRuntimeProviderKind;
  ok: boolean;
  status: "ready" | "degraded" | "unavailable";
  message?: string;
  details?: unknown;
}

export interface AgentRuntimeProtocolProvider<
  RunOptions extends AgentRuntimeProviderRunOptions = AgentRuntimeProviderRunOptions
> {
  readonly provider: AgentRuntimeProviderKind;
  healthCheck?(): Promise<AgentRuntimeProviderHealth>;
  run(
    input: AgentRuntimeRunInput,
    options?: RunOptions
  ): AsyncIterable<AgentRuntimeRunEvent>;
  cancelRun?(input: AgentRuntimeCancelRunInput): Promise<void>;
}

const RUNTIME_PROVIDER_KINDS = new Set<AgentRuntimeProviderKind>([
  "langgraph",
  "mock",
  "opencode",
]);

export function isAgentRuntimeProviderKind(
  value: unknown
): value is AgentRuntimeProviderKind {
  return typeof value === "string" && RUNTIME_PROVIDER_KINDS.has(value as any);
}

export function isAgentRuntimeProtocolProvider(
  value: unknown
): value is AgentRuntimeProtocolProvider {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as { provider?: unknown; run?: unknown };
  return isAgentRuntimeProviderKind(record.provider) && typeof record.run === "function";
}

export async function collectAgentRuntimeRunEvents<
  RunOptions extends AgentRuntimeProviderRunOptions
>(
  provider: AgentRuntimeProtocolProvider<RunOptions>,
  input: AgentRuntimeRunInput,
  options?: RunOptions
): Promise<AgentRuntimeRunEvent[]> {
  const events: AgentRuntimeRunEvent[] = [];

  for await (const event of provider.run(input, options)) {
    events.push(event);
  }

  return events;
}
