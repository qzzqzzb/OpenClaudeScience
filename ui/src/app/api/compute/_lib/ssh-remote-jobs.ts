import { randomUUID } from "crypto";
import { assertSshCommand } from "@/lib/ssh-command";
import {
  findStoredComputeHost,
  findStoredComputeJob,
  listStoredComputeHosts,
  listStoredComputeJobs,
  upsertStoredComputeHost,
  upsertStoredComputeJob,
} from "@/server/domains/compute/adapters/computeStore.adapter";
import {
  readComputeRemoteJobStatus,
  submitComputeRemoteJobProtocol,
} from "@/server/domains/compute/adapters/computeRemoteJobProtocol.adapter";
import { sshCliAdapter } from "@/server/shared/adapters/sshCli.adapter";

const DEFAULT_SCRATCH_ROOT = "~/.internagents/remote-jobs";
const DEFAULT_JOB_TIMEOUT_SECONDS = 30 * 60;
const MAX_COMMAND_LENGTH = 20_000;
const MAX_INPUT_FILES = 16;
const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_GLOBS = 20;
const MAX_OUTPUT_FILES = 64;
const MAX_OUTPUT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_FILE_BYTES = 5 * 1024 * 1024;

export type RemoteJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout"
  | "unknown";

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

function hostIdFromLabel(label: string): string {
  const clean = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || `host-${randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafeRelativePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("Input/output path cannot be empty.");
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized.startsWith("~") ||
    normalized.split("/").some((part) => !part || part === "..")
  ) {
    throw new Error(`Unsafe relative path: ${raw}`);
  }
  return normalized;
}

function normalizeTimeoutSeconds(value: unknown): number {
  if (value == null) {
    return DEFAULT_JOB_TIMEOUT_SECONDS;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 24 * 60 * 60) {
    throw new Error("timeoutSeconds must be an integer between 1 and 86400.");
  }
  return parsed;
}

function normalizeMaxOutputFileBytes(value: unknown): number {
  if (value == null) {
    return DEFAULT_MAX_OUTPUT_FILE_BYTES;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_OUTPUT_FILE_BYTES
  ) {
    throw new Error(
      `maxOutputFileBytes must be an integer between 1 and ${MAX_OUTPUT_FILE_BYTES}.`
    );
  }
  return parsed;
}

function normalizeOutputGlobs(value: unknown): string[] {
  if (value == null) {
    return ["out/**", "*.txt", "*.json", "*.csv", "*.png", "*.pdf", "*.md"];
  }
  if (!Array.isArray(value)) {
    throw new Error("outputGlobs must be an array.");
  }
  if (value.length > MAX_OUTPUT_GLOBS) {
    throw new Error(`outputGlobs cannot include more than ${MAX_OUTPUT_GLOBS} patterns.`);
  }
  return value.map((item) => assertSafeRelativePath(item));
}

function normalizeInputs(value: unknown): RemoteJobInputFile[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("inputs must be an array.");
  }
  if (value.length > MAX_INPUT_FILES) {
    throw new Error(`inputs cannot include more than ${MAX_INPUT_FILES} files.`);
  }
  let totalBytes = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Each input must be an object.");
    }
    const record = item as Record<string, unknown>;
    const contentBase64 =
      typeof record.contentBase64 === "string" ? record.contentBase64 : "";
    if (!contentBase64) {
      throw new Error("Each input must include contentBase64.");
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw new Error("Each input contentBase64 must be valid base64 text.");
    }
    const byteLength = Buffer.byteLength(contentBase64, "base64");
    if (byteLength > MAX_INPUT_FILE_BYTES) {
      throw new Error(`Each input file must be at most ${MAX_INPUT_FILE_BYTES} bytes.`);
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
      throw new Error(`Total input files must be at most ${MAX_TOTAL_INPUT_BYTES} bytes.`);
    }
    return {
      path: assertSafeRelativePath(record.path),
      contentBase64,
    };
  });
}

export async function listSshComputeHosts(): Promise<SshComputeHost[]> {
  return listStoredComputeHosts();
}

export async function probeSshComputeHost(
  sshCommand: string
): Promise<SshComputeProbe> {
  const checkedAt = nowIso();

  try {
    const connection = await sshCliAdapter.resolveConnection({
      connectionMode: "sshCommand",
      sshCommand: assertSshCommand(sshCommand),
    });
    const probe = await sshCliAdapter.testConnection({
      connection,
      timeoutMs: 15_000,
    });
    if (!probe.ok) {
      return {
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        error: probe.error || "SSH compute host probe failed.",
      };
    }
    if (probe.os !== "Linux") {
      return {
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        os: probe.os,
        error: `Only Linux SSH compute hosts are supported; got ${probe.os || "unknown"}.`,
      };
    }
    if (!probe.python || !probe.bash || !probe.timeout) {
      return {
        ...probe,
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        error: "Linux host must have python3, bash, and timeout.",
      };
    }
    return {
      ok: true,
      checkedAt: probe.checkedAt || checkedAt,
      os: probe.os,
      kernel: probe.kernel,
      arch: probe.arch,
      user: probe.user,
      host: probe.host,
      python: probe.python,
      bash: probe.bash,
      timeout: probe.timeout,
      workdir: probe.workdir,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function upsertSshComputeHost(request: {
  id?: unknown;
  label?: unknown;
  host?: unknown;
  sshCommand?: unknown;
  scratchRoot?: unknown;
  notes?: unknown;
}): Promise<SshComputeHost> {
  if (typeof request.sshCommand === "string" && request.sshCommand.trim()) {
    throw new Error("SSH compute hosts must use a Host alias from ~/.ssh/config.");
  }
  const connection = await sshCliAdapter.resolveConnection({
    connectionMode: "sshConfig",
    host: request.host,
  });
  const hostAlias = connection.hostAlias;
  if (!hostAlias) {
    throw new Error("SSH compute hosts must use a Host alias from ~/.ssh/config.");
  }
  const sshCommand = assertSshCommand(connection.sshCommand);
  const label =
    typeof request.label === "string" && request.label.trim()
      ? request.label.trim()
      : hostAlias;
  const id =
    typeof request.id === "string" && request.id.trim()
      ? hostIdFromLabel(request.id)
      : hostIdFromLabel(hostAlias);
  const scratchRoot =
    typeof request.scratchRoot === "string" && request.scratchRoot.trim()
      ? request.scratchRoot.trim()
      : DEFAULT_SCRATCH_ROOT;
  if (!scratchRoot.startsWith("/") && !scratchRoot.startsWith("~/")) {
    throw new Error("scratchRoot must be absolute or start with ~/.");
  }

  const probe = await probeSshComputeHost(sshCommand);
  if (!probe.ok) {
    throw new Error(probe.error || "SSH compute host probe failed.");
  }

  const existing = await findStoredComputeHost(id);
  const now = nowIso();
  const next: SshComputeHost = {
    id,
    label,
    hostAlias,
    sshCommand,
    scratchRoot,
    notes:
      typeof request.notes === "string" && request.notes.trim()
        ? request.notes.trim()
        : existing?.notes,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    probe,
  };
  await upsertStoredComputeHost(next);
  return next;
}

async function getHostOrThrow(hostId: string): Promise<SshComputeHost> {
  const host = await findStoredComputeHost(hostId);
  if (!host) {
    throw new Error(`Unknown SSH compute host: ${hostId}`);
  }
  return host;
}

export async function submitLinuxSshJob(
  request: SubmitRemoteJobRequest
): Promise<RemoteJobRecord> {
  const hostId = typeof request.hostId === "string" ? request.hostId.trim() : "";
  if (!hostId) {
    throw new Error("hostId is required.");
  }
  const host = await getHostOrThrow(hostId);
  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (!command) {
    throw new Error("command is required.");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command must be at most ${MAX_COMMAND_LENGTH} characters.`);
  }
  const timeoutSeconds = normalizeTimeoutSeconds(request.timeoutSeconds);
  const maxOutputFileBytes = normalizeMaxOutputFileBytes(request.maxOutputFileBytes);
  const outputGlobs = normalizeOutputGlobs(request.outputGlobs);
  const inputs = normalizeInputs(request.inputs);
  const jobId = `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

  const data = await submitComputeRemoteJobProtocol({
    sshCommand: host.sshCommand,
    scratchRoot: host.scratchRoot,
    jobId,
    command,
    timeoutSeconds,
    inputs,
    maxOutputFiles: MAX_OUTPUT_FILES,
    maxTotalOutputBytes: MAX_TOTAL_OUTPUT_BYTES,
  });

  const now = nowIso();
  const record: RemoteJobRecord = {
    id: jobId,
    hostId,
    command,
    remoteJobDir: data.remoteJobDir,
    pid: data.pid,
    status: "running",
    submittedAt: now,
    updatedAt: now,
    timeoutSeconds,
    outputGlobs,
    maxOutputFileBytes,
  };
  await upsertStoredComputeJob(record);
  return record;
}

export async function listRemoteJobs(): Promise<RemoteJobRecord[]> {
  return listStoredComputeJobs();
}

function statusFromExitCode(exitCode: number, timeoutSeconds: number): RemoteJobStatus {
  if (exitCode === 0) return "succeeded";
  if (exitCode === 124 && timeoutSeconds > 0) return "timeout";
  return "failed";
}

export async function getRemoteJobSnapshot(jobId: string): Promise<RemoteJobSnapshot> {
  const record = await findStoredComputeJob(jobId);
  if (!record) {
    throw new Error(`Unknown remote job: ${jobId}`);
  }
  const host = await getHostOrThrow(record.hostId);
  const remote = await readComputeRemoteJobStatus({
    sshCommand: host.sshCommand,
    remoteJobDir: record.remoteJobDir,
    pid: record.pid,
    outputGlobs: record.outputGlobs,
    maxOutputFileBytes: record.maxOutputFileBytes,
    maxOutputFiles: MAX_OUTPUT_FILES,
    maxTotalOutputBytes: MAX_TOTAL_OUTPUT_BYTES,
  });
  const nextStatus =
    remote.status === "running" || remote.status === "unknown"
      ? remote.status
      : statusFromExitCode(remote.exitCode ?? 1, record.timeoutSeconds);
  const nextRecord: RemoteJobRecord = {
    ...record,
    status: nextStatus,
    updatedAt: nowIso(),
    finishedAt: remote.finishedAt || record.finishedAt,
  };
  await upsertStoredComputeJob(nextRecord);
  return {
    ...nextRecord,
    stdout: remote.stdout,
    stderr: remote.stderr,
    exitCode: remote.exitCode,
    outputs: remote.outputs,
  };
}
