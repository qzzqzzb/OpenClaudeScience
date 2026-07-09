export type RemoteResourceBackend = "local_shell" | "ssh_shell";
export type RemoteInstallMode = "auto" | "venv" | "pythonPath" | "conda";

export interface UiResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  backend?: RemoteResourceBackend;
  runtimeUrl?: string;
  remoteRuntimePort?: number;
  workspacePath?: string;
}

export interface SshHostEntry {
  host: string;
  source: string;
}

export interface RemoteConnectionSetupRequest {
  label: string;
  connectionMode?: "sshConfig" | "sshCommand";
  host?: string;
  sshCommand?: string;
  workspace: string;
  resourceId?: string;
  localPort?: number;
  copyEnv?: boolean;
  installMode?: RemoteInstallMode;
  pythonPath?: string;
  condaCommand?: string;
}

export interface RemoteConnectionSetupResult {
  resource: UiResourceConfig;
  resources: UiResourceConfig[];
  remoteUrl: string;
  log: string[];
}

export interface RemoteConnectionEnsureResult {
  resource: UiResourceConfig;
  resources: UiResourceConfig[];
  remoteUrl: string;
  state: "up-to-date" | "updated";
  targetReleaseTag: string;
  log: string[];
}

export interface RemoteBackendCliPushRequest {
  resourceId?: unknown;
  force?: unknown;
}

export interface RemoteBackendCliPushResult {
  resource: UiResourceConfig;
  resources: UiResourceConfig[];
  remoteUrl: string;
  backendCliFingerprint: string;
  log: string[];
}

export interface RemoteSshTestInput {
  connectionMode?: unknown;
  host?: unknown;
  sshCommand?: unknown;
}

export interface RemoteSshTestResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type RemoteOperationResult =
  | RemoteConnectionEnsureResult
  | RemoteConnectionSetupResult
  | RemoteBackendCliPushResult;

export type RemoteStreamEvent =
  | { type: "log"; message: string }
  | { type: "done"; result: RemoteOperationResult }
  | { type: "error"; error: string };

export interface RemoteEnsureBackendInput {
  resourceId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RemoteBackendCliPushInput extends RemoteBackendCliPushRequest {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RemoteAdapter {
  listSshHosts(): Promise<SshHostEntry[]>;
  testConnection(input: RemoteSshTestInput): Promise<RemoteSshTestResult>;
  ensureBackend(
    input: RemoteEnsureBackendInput,
    onLog?: (message: string) => void
  ): Promise<RemoteConnectionEnsureResult>;
  setupBackend(
    input: RemoteConnectionSetupRequest,
    onLog?: (message: string) => void
  ): Promise<RemoteConnectionSetupResult>;
  pushBackendCli(
    input: RemoteBackendCliPushInput,
    onLog?: (message: string) => void
  ): Promise<RemoteBackendCliPushResult>;
}
