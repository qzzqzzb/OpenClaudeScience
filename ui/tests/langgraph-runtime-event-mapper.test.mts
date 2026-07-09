import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeStreamEvent } from "../src/lib/agent-runtime-events.ts";
import {
  mapLangGraphStreamEventToRuntimeEvents,
  mapLangGraphStreamEventsToRuntimeEvents,
} from "../src/lib/langgraph-runtime-event-mapper.ts";

function streamEvent(
  overrides: Partial<AgentRuntimeStreamEvent>
): AgentRuntimeStreamEvent {
  return {
    id: "event-1",
    at: 1,
    rawEvent: "messages-tuple",
    mode: "messages-tuple",
    data: undefined,
    ...overrides,
  };
}

test("maps assistant message chunks to message_delta events", () => {
  const events = mapLangGraphStreamEventToRuntimeEvents(
    streamEvent({
      data: [
        {
          id: "message-1",
          type: "ai",
          content: [{ type: "text", text: "hello" }],
        },
        { node: "agent" },
      ],
    })
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["message_delta"]
  );

  const delta = events[0];
  assert.equal(delta.type, "message_delta");
  assert.equal(delta.messageId, "message-1");
  assert.equal(delta.text, "hello");
});

test("maps assistant tool calls and tool results", () => {
  const events = mapLangGraphStreamEventsToRuntimeEvents([
    streamEvent({
      id: "event-tool-call",
      data: [
        {
          type: "ai",
          content: "",
          tool_calls: [
            {
              id: "tool-1",
              name: "search",
              args: { query: "x" },
            },
          ],
        },
        {},
      ],
    }),
    streamEvent({
      id: "event-tool-result",
      data: {
        id: "result-1",
        type: "tool",
        name: "search",
        tool_call_id: "tool-1",
        content: "found",
      },
    }),
  ]);

  assert.deepEqual(
    events.map((event) => event.type),
    ["tool_call", "tool_result"]
  );

  const toolCall = events[0];
  assert.equal(toolCall.type, "tool_call");
  assert.equal(toolCall.toolCallId, "tool-1");
  assert.equal(toolCall.name, "search");

  const toolResult = events[1];
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.toolCallId, "tool-1");
  assert.equal(toolResult.result, "found");
});

test("maps interrupts before state events", () => {
  const events = mapLangGraphStreamEventToRuntimeEvents(
    streamEvent({
      rawEvent: "updates|remote_runtime:abc",
      mode: "updates",
      namespace: ["remote_runtime:abc"],
      data: {
        agent: {
          __interrupt__: [
            {
              action_request: {
                action: "edit_file",
              },
            },
          ],
        },
      },
    }),
    { includeStateEvents: true }
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["interrupt"]
  );

  const interrupt = events[0];
  assert.equal(interrupt.type, "interrupt");
  assert.equal(interrupt.reason, "approval_required");
  assert.equal(interrupt.message, "Approval required for edit_file.");
});

test("can include state and error events for diagnostics", () => {
  const events = mapLangGraphStreamEventsToRuntimeEvents(
    [
      streamEvent({
        id: "state-1",
        rawEvent: "values",
        mode: "values",
        data: { messages: [] },
      }),
      streamEvent({
        id: "error-1",
        rawEvent: "error",
        mode: "error",
        data: "boom",
      }),
    ],
    { includeStateEvents: true }
  );

  assert.deepEqual(
    events.map((event) => event.type),
    ["state", "error"]
  );
});
