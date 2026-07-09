import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRuntimeProviderRegistry,
  collectProviderRunEvents,
  createAgentRuntimeProviderRegistry,
} from "../src/lib/agent-runtime-provider-registry.ts";
import { MockRuntimeProvider } from "../src/lib/mock-agent-runtime.ts";
import type { AgentRuntimeRunInput } from "../src/lib/agent-runtime-protocol.ts";

const input: AgentRuntimeRunInput = {
  intent: "send_message",
  assistantId: "assistant-1",
  threadId: "thread-1",
  messages: [
    {
      role: "user",
      content: "hello",
    },
  ],
};

test("AgentRuntimeProviderRegistry registers and creates providers by kind", async () => {
  const registry = new AgentRuntimeProviderRegistry();
  registry.register(
    "mock",
    () =>
      new MockRuntimeProvider({
        createRunId: () => "run-registry",
      })
  );

  assert.equal(registry.has("mock"), true);
  assert.deepEqual(registry.list(), ["mock"]);

  const provider = registry.create({
    provider: "mock",
    assistantId: "assistant-1",
  });
  const events = await collectProviderRunEvents({
    provider,
    input,
    options: {
      responseText: "ok",
      chunkSize: 2,
    },
  });

  assert.equal(events[0].type, "run_started");
  assert.equal(events[0].runId, "run-registry");
  assert.equal(events.at(-1)?.type, "done");
});

test("createAgentRuntimeProviderRegistry builds a registry from entries", () => {
  const registry = createAgentRuntimeProviderRegistry([
    {
      provider: "mock",
      factory: () => new MockRuntimeProvider(),
    },
  ]);

  assert.equal(registry.has("mock"), true);
  assert.throws(
    () => registry.create({ provider: "opencode" }),
    /No runtime provider registered/
  );
});
