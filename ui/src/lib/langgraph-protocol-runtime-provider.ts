import type { AgentRuntimeStreamEvent } from "./agent-runtime-events";
import {
  createAgentRuntimeCancelledEvents,
  createAgentRuntimeDoneEvent,
  createAgentRuntimeFailedEvents,
  createAgentRuntimeRunStartedEvent,
} from "./agent-runtime-lifecycle.ts";
import {
  mapLangGraphStreamEventToRuntimeEvents,
  type LangGraphRuntimeEventMapperOptions,
} from "./langgraph-runtime-event-mapper.ts";
import type {
  AgentRuntimeCancelRunInput,
  AgentRuntimeProviderHealth,
  AgentRuntimeProviderRunOptions,
  AgentRuntimeProtocolProvider,
} from "./agent-runtime-provider";
import type {
  AgentRuntimeRunEvent,
  AgentRuntimeRunInput,
} from "./agent-runtime-protocol";

export interface LangGraphProtocolRunHandle {
  runId: string;
  threadId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LangGraphProtocolRuntimeRunOptions
  extends AgentRuntimeProviderRunOptions,
    LangGraphRuntimeEventMapperOptions {
  rawOptions?: unknown;
}

export interface LangGraphProtocolRuntimeDependencies {
  submitRun(
    input: AgentRuntimeRunInput,
    options?: LangGraphProtocolRuntimeRunOptions
  ): Promise<LangGraphProtocolRunHandle>;
  streamRunEvents(
    run: LangGraphProtocolRunHandle,
    input: AgentRuntimeRunInput,
    options?: LangGraphProtocolRuntimeRunOptions
  ): AsyncIterable<AgentRuntimeStreamEvent>;
  cancelRun?(input: AgentRuntimeCancelRunInput): Promise<void>;
  healthCheck?(): Promise<AgentRuntimeProviderHealth>;
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as { name?: unknown; message?: unknown };
  return record.name === "AbortError" || record.message === "AbortError";
}

export class LangGraphProtocolRuntimeProvider
  implements AgentRuntimeProtocolProvider<LangGraphProtocolRuntimeRunOptions>
{
  readonly provider = "langgraph" as const;
  private readonly dependencies: LangGraphProtocolRuntimeDependencies;

  constructor(dependencies: LangGraphProtocolRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  healthCheck(): Promise<AgentRuntimeProviderHealth> {
    return (
      this.dependencies.healthCheck?.() ??
      Promise.resolve({
        provider: this.provider,
        ok: true,
        status: "ready" as const,
        message: "LangGraph protocol runtime provider is configured.",
      })
    );
  }

  async cancelRun(input: AgentRuntimeCancelRunInput): Promise<void> {
    await this.dependencies.cancelRun?.(input);
  }

  async *run(
    input: AgentRuntimeRunInput,
    options: LangGraphProtocolRuntimeRunOptions = {}
  ): AsyncGenerator<AgentRuntimeRunEvent> {
    if (options.signal?.aborted) {
      yield* createAgentRuntimeCancelledEvents({
        metadata: { provider: this.provider, phase: "before_submit" },
      });
      return;
    }

    let run: LangGraphProtocolRunHandle;
    try {
      run = await this.dependencies.submitRun(input, options);
    } catch (error) {
      yield* createAgentRuntimeFailedEvents({
        error,
        metadata: { provider: this.provider, phase: "submit" },
      });
      return;
    }

    yield createAgentRuntimeRunStartedEvent({
      runId: run.runId,
      threadId: run.threadId ?? input.threadId,
      metadata: {
        provider: this.provider,
        ...run.metadata,
      },
    });

    let sawError = false;
    let sawInterrupt = false;

    try {
      for await (const sourceEvent of this.dependencies.streamRunEvents(
        run,
        input,
        options
      )) {
        if (options.signal?.aborted) {
          yield* createAgentRuntimeCancelledEvents({
            runId: run.runId,
            metadata: { provider: this.provider, phase: "stream" },
          });
          return;
        }

        const protocolEvents = mapLangGraphStreamEventToRuntimeEvents(
          sourceEvent,
          options
        );

        for (const event of protocolEvents) {
          if (event.type === "error") {
            sawError = true;
          }
          if (event.type === "interrupt") {
            sawInterrupt = true;
          }
          yield event;
        }
      }
    } catch (error) {
      if (isAbortLike(error)) {
        yield* createAgentRuntimeCancelledEvents({
          runId: run.runId,
          metadata: { provider: this.provider, phase: "stream_abort" },
        });
        return;
      }

      yield* createAgentRuntimeFailedEvents({
        error,
        runId: run.runId,
        metadata: { provider: this.provider, phase: "stream" },
      });
      return;
    }

    if (sawInterrupt) {
      return;
    }

    yield createAgentRuntimeDoneEvent({
      runId: run.runId,
      status: sawError ? "failed" : "succeeded",
      metadata: { provider: this.provider },
    });
  }
}
