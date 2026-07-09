import assert from "node:assert/strict";
import test from "node:test";

import {
  MockRuntimeProvider,
  collectMockRuntimeEvents,
  createMockRuntimeEvents,
} from "../src/lib/mock-agent-runtime.ts";
import type { AgentRuntimeRunInput } from "../src/lib/agent-runtime-protocol.ts";

const baseInput: AgentRuntimeRunInput = {
  intent: "send_message",
  assistantId: "mock-assistant",
  threadId: "thread-1",
  resourceId: "resource-1",
  workspaceId: "workspace-1",
  messages: [
    {
      role: "user",
      content: "hello mock runtime",
    },
  ],
};

test("createMockRuntimeEvents emits a successful tool-call scenario", () => {
  const events = createMockRuntimeEvents(baseInput, {
    scenario: "tool_call",
    runId: "run-1",
    messageId: "message-1",
    toolCallId: "tool-1",
    responseText: "abcdef",
    chunkSize: 3,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "run_started",
      "state",
      "message_delta",
      "message_delta",
      "tool_call",
      "tool_result",
      "message_completed",
      "done",
    ]
  );

  const started = events.find((event) => event.type === "run_started");
  assert.equal(started?.runId, "run-1");
  assert.equal(started?.at, "2026-01-01T00:00:00.000Z");

  const deltas = events.filter((event) => event.type === "message_delta");
  assert.deepEqual(
    deltas.map((event) => event.text),
    ["abc", "def"]
  );

  const done = events.find((event) => event.type === "done");
  assert.equal(done?.status, "succeeded");
});

test("MockRuntimeProvider can stream an error scenario", async () => {
  const provider = new MockRuntimeProvider({
    createRunId: () => "run-error",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const events = await collectMockRuntimeEvents(baseInput, {
    scenario: "error",
    runId: "run-error",
  });
  const streamedEvents = [];

  for await (const event of provider.run(baseInput, { scenario: "error" })) {
    streamedEvents.push(event);
  }

  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "state", "error", "done"]
  );
  assert.deepEqual(
    streamedEvents.map((event) => event.type),
    ["run_started", "state", "error", "done"]
  );

  const error = streamedEvents.find((event) => event.type === "error");
  assert.equal(error?.error.code, "UNKNOWN");

  const done = streamedEvents.find((event) => event.type === "done");
  assert.equal(done?.runId, "run-error");
  assert.equal(done?.status, "failed");
});

test("interrupt scenario pauses without emitting done", () => {
  const events = createMockRuntimeEvents(baseInput, {
    scenario: "interrupt",
    runId: "run-interrupt",
  });

  assert.deepEqual(
    events.map((event) => event.type),
    ["run_started", "state", "interrupt"]
  );

  const interrupt = events.find((event) => event.type === "interrupt");
  assert.equal(interrupt?.reason, "approval_required");
});
