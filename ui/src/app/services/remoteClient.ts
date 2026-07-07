import { readJsonResponse, readNdjsonStream } from "@/app/services/apiClient";
import type { ResourceConfig } from "@/lib/config";

export type ConnectionMode = "sshConfig" | "sshCommand";
export type RemoteInstallMode = "auto" | "venv" | "pythonPath" | "conda";

export interface SshHostEntry {
  host: string;
  source: string;
}

export interface RemoteSshHostsPayload {
  hosts?: SshHostEntry[];
  error?: string;
}

export interface RemoteConnectionTestResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface RemoteConnectionTestResponse {
  responseOk: boolean;
  result: RemoteConnectionTestResult;
}

export interface RemoteEnsureResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  state: "up-to-date" | "updated";
  targetReleaseTag: string;
  log: string[];
}

export type RemoteEnsureStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: RemoteEnsureResult }
  | { type: "error"; error?: string };

export interface RemoteSetupResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  log: string[];
}

export interface BackendCliPushResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  backendCliFingerprint: string;
  log: string[];
}

export type RemoteSetupStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: RemoteSetupResult }
  | { type: "error"; error?: string };

export type BackendCliPushStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: BackendCliPushResult }
  | { type: "error"; error?: string };

interface RemoteStreamMessages {
  failed: string;
  noLog: string;
  noResult: string;
}

interface EnsureRemoteConnectionStreamOptions {
  resourceId: string;
  messages: RemoteStreamMessages;
  onLog: (message: string) => void;
}

interface TestRemoteConnectionOptions {
  connectionMode: ConnectionMode;
  host?: string;
  sshCommand?: string;
}

interface SetupRemoteConnectionStreamOptions {
  connectionMode: ConnectionMode;
  host?: string;
  sshCommand?: string;
  label: string;
  workspace: string;
  localPort?: number;
  installMode: RemoteInstallMode;
  pythonPath?: string;
  condaCommand?: string;
  messages: RemoteStreamMessages;
  onLog: (message: string) => void;
}

interface PushBackendCliStreamOptions {
  resourceId: string;
  force?: boolean;
  messages: RemoteStreamMessages;
  onLog: (message: string) => void;
}

export async function listRemoteSshHosts(
  fallbackMessage: string
): Promise<RemoteSshHostsPayload> {
  const response = await fetch("/api/remote-connections/ssh-hosts", {
    cache: "no-store",
  });
  return readJsonResponse<RemoteSshHostsPayload>(response, fallbackMessage);
}

export async function testRemoteConnection({
  connectionMode,
  host,
  sshCommand,
}: TestRemoteConnectionOptions): Promise<RemoteConnectionTestResponse> {
  const response = await fetch("/api/remote-connections/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionMode,
      host,
      sshCommand,
    }),
  });
  const result = (await response.json()) as RemoteConnectionTestResult;

  return {
    responseOk: response.ok,
    result,
  };
}

export async function ensureRemoteConnectionStream({
  resourceId,
  messages,
  onLog,
}: EnsureRemoteConnectionStreamOptions): Promise<RemoteEnsureResult> {
  let result: RemoteEnsureResult | null = null;
  let streamError: string | null = null;

  await readNdjsonStream<RemoteEnsureStreamEvent>(
    "/api/remote-connections/ensure",
    {
      fallbackMessage: messages.failed,
      emptyBodyMessage: messages.noLog,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId }),
      },
      onMessage(event) {
        if (event.type === "log" && event.message) {
          onLog(event.message);
        } else if (event.type === "done" && event.result) {
          result = event.result;
        } else if (event.type === "error") {
          streamError = event.error || messages.failed;
        }
      },
    }
  );

  if (streamError) {
    throw new Error(streamError);
  }
  if (!result) {
    throw new Error(messages.noResult);
  }
  return result;
}

export async function setupRemoteConnectionStream({
  connectionMode,
  host,
  sshCommand,
  label,
  workspace,
  localPort,
  installMode,
  pythonPath,
  condaCommand,
  messages,
  onLog,
}: SetupRemoteConnectionStreamOptions): Promise<RemoteSetupResult> {
  let result: RemoteSetupResult | null = null;
  let streamError: string | null = null;

  await readNdjsonStream<RemoteSetupStreamEvent>(
    "/api/remote-connections/setup",
    {
      fallbackMessage: messages.failed,
      emptyBodyMessage: messages.noLog,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionMode,
          host,
          sshCommand,
          label,
          workspace,
          localPort,
          installMode,
          pythonPath,
          condaCommand,
        }),
      },
      onMessage(event) {
        if (event.type === "log" && event.message) {
          onLog(event.message);
        } else if (event.type === "done" && event.result) {
          result = event.result;
        } else if (event.type === "error") {
          streamError = event.error || messages.failed;
        }
      },
    }
  );

  if (streamError) {
    throw new Error(streamError);
  }
  if (!result) {
    throw new Error(messages.noResult);
  }
  return result;
}

export async function pushBackendCliStream({
  resourceId,
  force,
  messages,
  onLog,
}: PushBackendCliStreamOptions): Promise<BackendCliPushResult> {
  let result: BackendCliPushResult | null = null;
  let streamError: string | null = null;

  await readNdjsonStream<BackendCliPushStreamEvent>(
    "/api/remote-connections/push-backend-cli",
    {
      fallbackMessage: messages.failed,
      emptyBodyMessage: messages.noLog,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, force }),
      },
      onMessage(event) {
        if (event.type === "log" && event.message) {
          onLog(event.message);
        } else if (event.type === "done" && event.result) {
          result = event.result;
        } else if (event.type === "error") {
          streamError = event.error || messages.failed;
        }
      },
    }
  );

  if (streamError) {
    throw new Error(streamError);
  }
  if (!result) {
    throw new Error(messages.noResult);
  }
  return result;
}
