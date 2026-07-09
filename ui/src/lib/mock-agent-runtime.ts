import type {
  AgentRuntimeErrorShape,
  AgentRuntimeProviderKind,
  AgentRuntimeRunEvent,
  AgentRuntimeRunInput,
} from "./agent-runtime-protocol";
import type {
  AgentRuntimeProviderRunOptions,
  AgentRuntimeProtocolProvider,
} from "./agent-runtime-provider";

export type MockRuntimeScenario =
  | "success"
  | "tool_call"
  | "interrupt"
  | "error";

export interface MockRuntimeProviderOptions {
  createRunId?: () => string;
  createMessageId?: () => string;
  createToolCallId?: () => string;
  now?: () => Date;
}

export interface MockRuntimeRunOptions extends AgentRuntimeProviderRunOptions {
  scenario?: MockRuntimeScenario;
  responseText?: string;
  chunkSize?: number;
  delayMs?: number;
  runId?: string;
  messageId?: string;
  toolCallId?: string;
  now?: () => Date;
}

const DEFAULT_RESPONSE =
  "Mock runtime response generated from AgentRuntimeProtocol.";
const DEFAULT_CHUNK_SIZE = 18;

function defaultId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

function safeChunkSize(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0
    ? Math.floor(value)
    : DEFAULT_CHUNK_SIZE;
}

function splitText(text: string, chunkSize: number): string[] {
  if (!text) {
    return [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function getLastUserText(input: AgentRuntimeRunInput): string {
  const userMessage = [...(input.messages || [])]
    .reverse()
    .find((message) => message.role === "user");

  if (!userMessage) {
    return "";
  }

  return typeof userMessage.content === "string"
    ? userMessage.content
    : JSON.stringify(userMessage.content);
}

function createCancelledEvents(runId?: string): AgentRuntimeRunEvent[] {
  return [
    {
      type: "error",
      error: {
        code: "CANCELLED",
        message: "Mock runtime run cancelled.",
        retryable: false,
      },
    },
    {
      type: "done",
      runId,
      status: "cancelled",
    },
  ];
}

function createErrorShape(message?: string): AgentRuntimeErrorShape {
  return {
    code: "UNKNOWN",
    message: message || "Mock runtime simulated error.",
    retryable: true,
  };
}

export function createMockRuntimeEvents(
  input: AgentRuntimeRunInput,
  options: MockRuntimeRunOptions = {}
): AgentRuntimeRunEvent[] {
  const scenario = options.scenario || "success";
  const now = options.now || (() => new Date());
  const runId = options.runId || defaultId("mock-run");
  const messageId = options.messageId || `${runId}-assistant`;
  const toolCallId = options.toolCallId || `${runId}-tool`;
  const responseText =
    options.responseText ||
    `${DEFAULT_RESPONSE} Intent: ${input.intent}. User: ${getLastUserText(
      input
    )}`;
  const events: AgentRuntimeRunEvent[] = [
    {
      type: "run_started",
      runId,
      threadId: input.threadId,
      at: now().toISOString(),
      metadata: {
        provider: "mock",
        assistantId: input.assistantId,
        scenario,
      },
    },
    {
      type: "state",
      state: {
        provider: "mock",
        intent: input.intent,
        resourceId: input.resourceId,
        workspaceId: input.workspaceId,
      },
      metadata: {
        scenario,
      },
    },
  ];

  if (scenario === "error") {
    events.push(
      {
        type: "error",
        error: createErrorShape(),
      },
      {
        type: "done",
        runId,
        status: "failed",
      }
    );
    return events;
  }

  if (scenario === "interrupt") {
    events.push({
      type: "interrupt",
      interruptId: `${runId}-interrupt`,
      reason: "approval_required",
      message: "Mock runtime simulated an approval interrupt.",
      payload: {
        intent: input.intent,
      },
    });
    return events;
  }

  for (const text of splitText(responseText, safeChunkSize(options.chunkSize))) {
    events.push({
      type: "message_delta",
      messageId,
      role: "assistant",
      text,
    });
  }

  if (scenario === "tool_call") {
    events.push(
      {
        type: "tool_call",
        toolCallId,
        name: "mock.workspace.inspect",
        args: {
          resourceId: input.resourceId,
          workspaceId: input.workspaceId,
        },
        displayName: "Mock workspace inspect",
      },
      {
        type: "tool_result",
        toolCallId,
        name: "mock.workspace.inspect",
        result: {
          ok: true,
          filesChecked: 3,
        },
      }
    );
  }

  events.push(
    {
      type: "message_completed",
      messageId,
      role: "assistant",
      text: responseText,
    },
    {
      type: "done",
      runId,
      status: "succeeded",
      metadata: {
        scenario,
      },
    }
  );

  return events;
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }
  await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export async function* streamMockRuntimeEvents(
  events: AgentRuntimeRunEvent[],
  options: Pick<MockRuntimeRunOptions, "delayMs" | "signal" | "runId"> = {}
): AsyncGenerator<AgentRuntimeRunEvent> {
  const delayMs = options.delayMs || 0;

  for (const event of events) {
    if (options.signal?.aborted) {
      for (const cancelledEvent of createCancelledEvents(options.runId)) {
        yield cancelledEvent;
      }
      return;
    }

    await sleep(delayMs);
    yield event;
  }
}

export function streamMockRuntimeRun(
  input: AgentRuntimeRunInput,
  options: MockRuntimeRunOptions = {}
): AsyncGenerator<AgentRuntimeRunEvent> {
  const events = createMockRuntimeEvents(input, options);
  return streamMockRuntimeEvents(events, options);
}

export async function collectMockRuntimeEvents(
  input: AgentRuntimeRunInput,
  options: MockRuntimeRunOptions = {}
): Promise<AgentRuntimeRunEvent[]> {
  const events: AgentRuntimeRunEvent[] = [];
  for await (const event of streamMockRuntimeRun(input, options)) {
    events.push(event);
  }
  return events;
}

export class MockRuntimeProvider
  implements AgentRuntimeProtocolProvider<MockRuntimeRunOptions>
{
  readonly provider: AgentRuntimeProviderKind = "mock";
  private readonly createRunId?: () => string;
  private readonly createMessageId?: () => string;
  private readonly createToolCallId?: () => string;
  private readonly now?: () => Date;

  constructor(options: MockRuntimeProviderOptions = {}) {
    this.createRunId = options.createRunId;
    this.createMessageId = options.createMessageId;
    this.createToolCallId = options.createToolCallId;
    this.now = options.now;
  }

  async healthCheck() {
    return {
      provider: this.provider,
      ok: true,
      status: "ready" as const,
      message: "Mock runtime provider is available.",
    };
  }

  run(
    input: AgentRuntimeRunInput,
    options: MockRuntimeRunOptions = {}
  ): AsyncGenerator<AgentRuntimeRunEvent> {
    return streamMockRuntimeRun(input, {
      ...options,
      runId: options.runId || this.createRunId?.(),
      messageId: options.messageId || this.createMessageId?.(),
      toolCallId: options.toolCallId || this.createToolCallId?.(),
      now: options.now || this.now,
    });
  }
}
