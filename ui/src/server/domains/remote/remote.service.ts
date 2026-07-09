import { pushRemoteRuntimeBackendCli } from "./adapters/remoteBackendCli.adapter";
import {
  ensureRemoteRuntime,
  setupRemoteRuntime,
} from "./adapters/remoteRuntime.adapter";
import {
  listRemoteSshHosts,
  testRemoteSshConnection,
} from "./adapters/remoteSsh.adapter";
import type {
  RemoteBackendCliPushRequest,
  RemoteConnectionSetupRequest,
  RemoteAdapter,
  RemoteOperationResult,
  RemoteSshTestInput,
  RemoteSshTestResult,
  RemoteStreamEvent,
  SshHostEntry,
} from "./remote.types";

export const remoteAdapter: RemoteAdapter = {
  listSshHosts: listRemoteSshHosts,
  testConnection: testRemoteSshConnection,
  ensureBackend: ({ resourceId }, onLog) =>
    ensureRemoteRuntime(resourceId, onLog ?? (() => undefined)),
  setupBackend: (input, onLog) =>
    setupRemoteRuntime(input, onLog ?? (() => undefined)),
  pushBackendCli: (input, onLog) =>
    pushRemoteRuntimeBackendCli(input, onLog ?? (() => undefined)),
};

type RemoteStreamOperation = (
  onLog: (message: string) => void
) => Promise<RemoteOperationResult>;

function createRemoteOperationStream({
  initialMessage,
  fallbackError,
  operation,
}: {
  initialMessage: string;
  fallbackError: string;
  operation: RemoteStreamOperation;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: RemoteStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "log", message: initialMessage });
        const result = await operation((message) => {
          send({ type: "log", message });
        });
        send({ type: "done", result });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : fallbackError,
        });
      } finally {
        controller.close();
      }
    },
  });
}

export function createEnsureRemoteRuntimeStream(
  body: unknown
): ReadableStream<Uint8Array> {
  const resourceId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).resourceId
      : undefined;

  return createRemoteOperationStream({
    initialMessage: "检查远程 backend runtime 版本...",
    fallbackError: "远程 backend runtime 同步失败。",
    operation: (onLog) =>
      remoteAdapter.ensureBackend(
        { resourceId: typeof resourceId === "string" ? resourceId : "" },
        onLog
      ),
  });
}

export function createSetupRemoteRuntimeStream(
  body: unknown
): ReadableStream<Uint8Array> {
  return createRemoteOperationStream({
    initialMessage: "开始配置远程 runtime...",
    fallbackError: "远程机器配置失败。",
    operation: (onLog) =>
      remoteAdapter.setupBackend(body as RemoteConnectionSetupRequest, onLog),
  });
}

export function createPushRemoteBackendCliStream(
  body: unknown
): ReadableStream<Uint8Array> {
  return createRemoteOperationStream({
    initialMessage: "Starting backend CLI push...",
    fallbackError: "Backend CLI push failed.",
    operation: (onLog) =>
      remoteAdapter.pushBackendCli(body as RemoteBackendCliPushRequest, onLog),
  });
}

export async function testRemoteConnection(
  input: RemoteSshTestInput
): Promise<RemoteSshTestResult> {
  return remoteAdapter.testConnection(input);
}

export async function getRemoteSshHosts(): Promise<SshHostEntry[]> {
  return remoteAdapter.listSshHosts();
}
