import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeStreamEvent } from "../src/lib/agent-runtime-events.ts";
import {
  collectAgentRuntimeRunEvents,
  isAgentRuntimeProtocolProvider,
} from "../src/lib/agent-runtime-provider.ts";
import { LangGraphProtocolRuntimeProvider } from "../src/lib/langgraph-protocol-runtime-provider.ts";
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

async function* events(
  items: AgentRuntimeStreamEvent[]
): AsyncGenerator<AgentRuntimeStreamEvent> {
  for (const item of items) {
    yield item;
  }
}

test("LangGraphProtocolRuntimeProvider composes lifecycle and stream mapper", async () => {
  const provider = new LangGraphProtocolRuntimeProvider({
    async submitRun() {
      return { runId: "run-1", threadId: "thread-1" };
    },
    streamRunEvents() {
      return events([
        streamEvent({
          data: [
            {
              id: "message-1",
              type: "ai",
              content: "hello from langgraph",
            },
            {},
          ],
        }),
      ]);
    },
  });

  assert.equal(isAgentRuntimeProtocolProvider(provider), true);

  const protocolEvents = await collectAgentRuntimeRunEvents(provider, input);

  assert.deepEqual(
    protocolEvents.map((event) => event.type),
    ["run_started", "message_delta", "done"]
  );
  assert.equal(protocolEvents[0].type, "run_started");
  assert.equal(protocolEvents[0].runId, "run-1");
  assert.equal(protocolEvents[1].type, "message_delta");
  assert.equal(protocolEvents[1].text, "hello from langgraph");
  assert.equal(protocolEvents[2].type, "done");
  assert.equal(protocolEvents[2].status, "succeeded");
});

test("LangGraphProtocolRuntimeProvider leaves interrupted runs open", async () => {
  const provider = new LangGraphProtocolRuntimeProvider({
    async submitRun() {
      return { runId: "run-interrupt", threadId: "thread-1" };
    },
    streamRunEvents() {
      return events([
        streamEvent({
          rawEvent: "updates",
          mode: "updates",
          data: {
            agent: {
              __interrupt__: [{ message: "approval needed" }],
            },
          },
        }),
      ]);
    },
  });

  const protocolEvents = await collectAgentRuntimeRunEvents(provider, input, {
    includeStateEvents: true,
  });

  assert.deepEqual(
    protocolEvents.map((event) => event.type),
    ["run_started", "interrupt"]
  );
});

test("LangGraphProtocolRuntimeProvider converts stream failures", async () => {
  const provider = new LangGraphProtocolRuntimeProvider({
    async submitRun() {
      return { runId: "run-failed", threadId: "thread-1" };
    },
    async *streamRunEvents() {
      throw new Error("stream failed");
    },
  });

  const protocolEvents = await collectAgentRuntimeRunEvents(provider, input);

  assert.deepEqual(
    protocolEvents.map((event) => event.type),
    ["run_started", "error", "done"]
  );
  assert.equal(protocolEvents[1].type, "error");
  assert.equal(protocolEvents[1].error.message, "stream failed");
  assert.equal(protocolEvents[2].type, "done");
  assert.equal(protocolEvents[2].status, "failed");
});
