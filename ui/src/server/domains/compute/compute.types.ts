export type RemoteJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout"
  | "unknown";

export interface SshComputeProbe {
  ok: boolean;
  checkedAt: string;
  os?: string;
  kernel?: string;
  arch?: string;
  user?: string;
  host?: string;
  python?: string;
  bash?: string;
  timeout?: string;
  workdir?: string;
  error?: string;
}

export interface SshComputeHost {
  id: string;
  label: string;
  hostAlias?: string;
  sshCommand: string;
  scratchRoot: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  probe?: SshComputeProbe;
}

export interface RemoteJobRecord {
  id: string;
  hostId: string;
  command: string;
  remoteJobDir: string;
  pid?: number;
  status: RemoteJobStatus;
  submittedAt: string;
  updatedAt: string;
  finishedAt?: string;
  timeoutSeconds: number;
  outputGlobs: string[];
  maxOutputFileBytes: number;
}

export interface RemoteJobInputFile {
  path: string;
  contentBase64: string;
}

export interface SubmitRemoteJobRequest {
  hostId: string;
  command: string;
  inputs?: RemoteJobInputFile[];
  outputGlobs?: string[];
  timeoutSeconds?: number;
  maxOutputFileBytes?: number;
}

export interface HarvestedOutputFile {
  path: string;
  size: number;
  contentBase64?: string;
  leftOnRemote?: boolean;
}

export interface RemoteJobSnapshot extends RemoteJobRecord {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outputs?: HarvestedOutputFile[];
}

export interface UpsertComputeHostInput {
  id?: unknown;
  label?: unknown;
  host?: unknown;
  sshCommand?: unknown;
  scratchRoot?: unknown;
  notes?: unknown;
}
