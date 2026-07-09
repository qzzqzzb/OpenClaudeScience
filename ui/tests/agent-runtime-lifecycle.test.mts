import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRuntimeCancelledEvents,
  createAgentRuntimeDoneEvent,
  createAgentRuntimeFailedEvents,
  createAgentRuntimeRunStartedEvent,
  unknownRuntimeError,
} from "../src/lib/agent-runtime-lifecycle.ts";

test("creates explicit run_started and done lifecycle events", () => {
  const started = createAgentRuntimeRunStartedEvent({
    runId: "run-1",
    threadId: "thread-1",
    at: "2026-01-01T00:00:00.000Z",
  });
  const done = createAgentRuntimeDoneEvent({
    runId: "run-1",
    status: "succeeded",
  });

  assert.deepEqual(started, {
    type: "run_started",
    runId: "run-1",
    threadId: "thread-1",
    at: "2026-01-01T00:00:00.000Z",
    metadata: undefined,
  });
  assert.deepEqual(done, {
    type: "done",
    runId: "run-1",
    status: "succeeded",
    usage: undefined,
    metadata: undefined,
  });
});

test("normalizes unknown runtime errors", () => {
  assert.deepEqual(unknownRuntimeError(new Error("boom")), {
    code: "UNKNOWN",
    message: "boom",
    retryable: true,
    details: {
      name: "Error",
    },
  });

  assert.deepEqual(unknownRuntimeError("plain error"), {
    code: "UNKNOWN",
    message: "plain error",
    retryable: true,
  });
});

test("creates failed and cancelled event pairs", () => {
  const failed = createAgentRuntimeFailedEvents({
    error: "failed",
    runId: "run-failed",
  });
  const cancelled = createAgentRuntimeCancelledEvents({
    runId: "run-cancelled",
  });

  assert.deepEqual(
    failed.map((event) => event.type),
    ["error", "done"]
  );
  assert.equal(failed[1].status, "failed");
  assert.deepEqual(
    cancelled.map((event) => event.type),
    ["error", "done"]
  );
  assert.equal(cancelled[0].error.code, "CANCELLED");
  assert.equal(cancelled[1].status, "cancelled");
});
