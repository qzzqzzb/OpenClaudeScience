import assert from "node:assert/strict";
import test from "node:test";

import {
  collectAgentRuntimeRunEvents,
  isAgentRuntimeProtocolProvider,
  isAgentRuntimeProviderKind,
} from "../src/lib/agent-runtime-provider.ts";
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

test("recognizes supported runtime provider kinds", () => {
  assert.equal(isAgentRuntimeProviderKind("langgraph"), true);
  assert.equal(isAgentRuntimeProviderKind("mock"), true);
  assert.equal(isAgentRuntimeProviderKind("opencode"), true);
  assert.equal(isAgentRuntimeProviderKind("other"), false);
});

test("MockRuntimeProvider satisfies the neutral provider contract", async () => {
  const provider = new MockRuntimeProvider({
    createRunId: () => "run-1",
    createMessageId: () => "message-1",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(isAgentRuntimeProtocolProvider(provider), true);

  const health = await provider.healthCheck();
  assert.deepEqual(health, {
    provider: "mock",
    ok: true,
    status: "ready",
    message: "Mock runtime provider is available.",
  });

  const events = await collectAgentRuntimeRunEvents(provider, input, {
    scenario: "success",
    responseText: "ok",
    chunkSize: 2,
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "state", "message_delta", "message_completed", "done"]
  );
  assert.equal(events[0].type, "run_started");
  assert.equal(events[0].runId, "run-1");
});
