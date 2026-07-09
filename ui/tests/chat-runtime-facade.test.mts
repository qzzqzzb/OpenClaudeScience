import assert from "node:assert/strict";
import test from "node:test";

import { createChatRuntimeFacade } from "../src/lib/chat-runtime-facade.ts";

test("chat runtime facade routes main and runtime thread operations", async () => {
  const calls: string[] = [];
  const agentRuntime: any = {
    deploymentUrl: "http://main",
    assistantId: "agent_local",
    getThreadState: async (threadId: string) => {
      calls.push(`main-state:${threadId}`);
      return { values: { messages: [] }, checkpoint: { checkpoint_map: {} } };
    },
    getThread: async (threadId: string) => {
      calls.push(`main-thread:${threadId}`);
      return { values: { messages: [] }, metadata: {}, status: "idle" };
    },
    getThreadHistory: async ({ threadId }: { threadId: string }) => {
      calls.push(`main-history:${threadId}`);
      return [];
    },
    getPendingRunInputPreview: async () => null,
    updateState: async ({ threadId }: { threadId: string }) => {
      calls.push(`main-update-state:${threadId}`);
    },
    updateThreadMetadata: async ({ threadId }: { threadId: string }) => {
      calls.push(`main-update-metadata:${threadId}`);
    },
  };
  const runtimeClient: any = {
    listRuns: async (threadId: string) => {
      calls.push(`runtime-runs:${threadId}`);
      return [{ run_id: "run-1", status: "running" }];
    },
    getThreadState: async (threadId: string) => {
      calls.push(`runtime-state:${threadId}`);
      return { values: { messages: [] }, checkpoint: { checkpoint_map: {} } };
    },
    getThread: async (threadId: string) => {
      calls.push(`runtime-thread:${threadId}`);
      return { values: { messages: [] }, metadata: {}, status: "idle" };
    },
    getThreadHistory: async (threadId: string) => {
      calls.push(`runtime-history:${threadId}`);
      return [];
    },
    getPendingRunInputPreview: async () => ({ status: "pending" }),
    joinRunStream: async function* () {
      yield { id: "1", event: "messages", data: {} };
    },
  };

  const facade = createChatRuntimeFacade({
    agentRuntime,
    runtimeClient,
    runtimeUrl: "http://runtime",
    resourceId: "local",
    workspaceId: "workspace-a",
  });

  assert.equal(
    facade.cacheScope,
    "http://main|agent_local|http://runtime|local|workspace-a"
  );
  assert.equal((await facade.listRuntimeRuns("t1"))[0].run_id, "run-1");
  await facade.getMainThreadState("t1");
  await facade.getMainThread("t1");
  await facade.getMainThreadHistory({ threadId: "t1" });
  await facade.getRuntimeThreadState("t1");
  await facade.getRuntimeThread("t1");
  await facade.getRuntimeThreadHistory("t1");
  await facade.updateState({ threadId: "t1", values: {} });
  await facade.updateThreadMetadata({ threadId: "t1", metadata: {} });

  assert.deepEqual(calls, [
    "runtime-runs:t1",
    "main-state:t1",
    "main-thread:t1",
    "main-history:t1",
    "runtime-state:t1",
    "runtime-thread:t1",
    "runtime-history:t1",
    "main-update-state:t1",
    "main-update-metadata:t1",
  ]);
});
