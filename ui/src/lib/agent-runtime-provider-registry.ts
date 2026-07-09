import type {
  AgentRuntimeProviderKind,
  AgentRuntimeRunInput,
} from "./agent-runtime-protocol";
import type {
  AgentRuntimeProviderRunOptions,
  AgentRuntimeProtocolProvider,
} from "./agent-runtime-provider";

export interface AgentRuntimeProviderFactoryContext {
  provider: AgentRuntimeProviderKind;
  assistantId?: string;
  deploymentUrl?: string;
  resourceId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
}

export type AgentRuntimeProviderFactory<
  RunOptions extends AgentRuntimeProviderRunOptions = AgentRuntimeProviderRunOptions
> = (
  context: AgentRuntimeProviderFactoryContext
) => AgentRuntimeProtocolProvider<RunOptions>;

export class AgentRuntimeProviderRegistry {
  private readonly factories = new Map<
    AgentRuntimeProviderKind,
    AgentRuntimeProviderFactory
  >();

  register<RunOptions extends AgentRuntimeProviderRunOptions>(
    provider: AgentRuntimeProviderKind,
    factory: AgentRuntimeProviderFactory<RunOptions>
  ): void {
    this.factories.set(provider, factory as AgentRuntimeProviderFactory);
  }

  has(provider: AgentRuntimeProviderKind): boolean {
    return this.factories.has(provider);
  }

  list(): AgentRuntimeProviderKind[] {
    return [...this.factories.keys()];
  }

  create<RunOptions extends AgentRuntimeProviderRunOptions>(
    context: AgentRuntimeProviderFactoryContext
  ): AgentRuntimeProtocolProvider<RunOptions> {
    const factory = this.factories.get(context.provider);
    if (!factory) {
      throw new Error(`No runtime provider registered for ${context.provider}.`);
    }
    return factory(context) as AgentRuntimeProtocolProvider<RunOptions>;
  }
}

export function createAgentRuntimeProviderRegistry(
  entries: Array<{
    provider: AgentRuntimeProviderKind;
    factory: AgentRuntimeProviderFactory;
  }> = []
): AgentRuntimeProviderRegistry {
  const registry = new AgentRuntimeProviderRegistry();
  for (const entry of entries) {
    registry.register(entry.provider, entry.factory);
  }
  return registry;
}

export async function collectProviderRunEvents<
  RunOptions extends AgentRuntimeProviderRunOptions
>({
  input,
  options,
  provider,
}: {
  provider: AgentRuntimeProtocolProvider<RunOptions>;
  input: AgentRuntimeRunInput;
  options?: RunOptions;
}) {
  const events = [];
  for await (const event of provider.run(input, options)) {
    events.push(event);
  }
  return events;
}
