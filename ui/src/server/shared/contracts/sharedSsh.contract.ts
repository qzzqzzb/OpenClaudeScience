import type {
  AdapterErrorShape,
  AdapterOperationOptions,
} from "./adapterError.contract";
import type { Readable } from "stream";

export type SshConnectionMode = "sshConfig" | "sshCommand";

export interface SshHost {
  alias: string;
  source: string;
}

export interface ListSshHostsInput {
  includePatterns?: boolean;
}

export interface ResolveSshConnectionInput {
  connectionMode?: SshConnectionMode;
  host?: unknown;
  sshCommand?: unknown;
}

export interface SshConnection {
  mode: SshConnectionMode;
  hostAlias?: string;
  sshCommand: string;
  displayName: string;
}

export interface TestSshConnectionInput extends AdapterOperationOptions {
  connection: SshConnection;
}

export interface SshProbeResult {
  ok: boolean;
  checkedAt: string;
  user?: string;
  host?: string;
  os?: string;
  kernel?: string;
  arch?: string;
  python?: string;
  bash?: string;
  timeout?: string;
  workdir?: string;
  error?: string;
}

export interface RemoteCommandInput extends AdapterOperationOptions {
  connection: SshConnection;
  script: string;
  maxBufferBytes?: number;
}

export interface RemoteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}

export interface RemoteJsonCommandInput extends RemoteCommandInput {
  input?: unknown;
}

export type RemoteCommandStdin = string | Uint8Array | Readable;

export interface RemoteStdinCommandInput extends RemoteCommandInput {
  stdin: RemoteCommandStdin;
}

export interface OpenSshTunnelInput extends AdapterOperationOptions {
  connection: SshConnection;
  localPort: number;
  remotePort: number;
  remoteHost?: string;
  logFile?: string;
  pidFile?: string;
  replaceExistingPid?: boolean;
}

export interface SshTunnelHandle {
  localUrl: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  pid?: number;
  logFile?: string;
  pidFile?: string;
}

export type SshAdapterErrorCode =
  | "SSH_CONFIG_NOT_FOUND"
  | "INVALID_SSH_COMMAND"
  | "AUTH_FAILED"
  | "CONNECT_TIMEOUT"
  | "COMMAND_TIMEOUT"
  | "REMOTE_COMMAND_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "CANCELLED"
  | "PARSE_ERROR"
  | "UNKNOWN";

export interface SshAdapterErrorShape
  extends AdapterErrorShape<SshAdapterErrorCode> {
  code: SshAdapterErrorCode;
  stdout?: string;
  stderr?: string;
}

export interface SharedSshAdapter {
  listHosts(input?: ListSshHostsInput): Promise<SshHost[]>;
  resolveConnection(input: ResolveSshConnectionInput): Promise<SshConnection>;
  testConnection(input: TestSshConnectionInput): Promise<SshProbeResult>;
  runCommand(input: RemoteCommandInput): Promise<RemoteCommandResult>;
  runCommandWithInput(
    input: RemoteStdinCommandInput
  ): Promise<RemoteCommandResult>;
  runJsonCommand<T>(input: RemoteJsonCommandInput): Promise<T>;
  openTunnel(input: OpenSshTunnelInput): Promise<SshTunnelHandle>;
}
