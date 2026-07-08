import { randomUUID } from "crypto";
import {
  readComputeRemoteJobStatus,
  submitComputeRemoteJobProtocol,
} from "./computeRemoteJobProtocol.adapter";
import {
  findStoredComputeHost,
  findStoredComputeJob,
  upsertStoredComputeJob,
} from "./computeStore.adapter";
import type {
  RemoteJobInputFile,
  RemoteJobRecord,
  RemoteJobStatus,
  RemoteJobSnapshot,
  SubmitRemoteJobRequest,
} from "../compute.types";

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
    throw new Error(
      `outputGlobs cannot include more than ${MAX_OUTPUT_GLOBS} patterns.`
    );
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

function statusFromExitCode(
  exitCode: number,
  timeoutSeconds: number
): RemoteJobStatus {
  if (exitCode === 0) return "succeeded";
  if (exitCode === 124 && timeoutSeconds > 0) return "timeout";
  return "failed";
}

export async function submitComputeJob(
  input: SubmitRemoteJobRequest
): Promise<RemoteJobRecord> {
  const hostId = typeof input.hostId === "string" ? input.hostId.trim() : "";
  if (!hostId) {
    throw new Error("hostId is required.");
  }
  const host = await findStoredComputeHost(hostId);
  if (!host) {
    throw new Error(`Unknown SSH compute host: ${hostId}`);
  }
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command) {
    throw new Error("command is required.");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command must be at most ${MAX_COMMAND_LENGTH} characters.`);
  }
  const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds);
  const maxOutputFileBytes = normalizeMaxOutputFileBytes(input.maxOutputFileBytes);
  const outputGlobs = normalizeOutputGlobs(input.outputGlobs);
  const inputs = normalizeInputs(input.inputs);
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

export async function readComputeJobSnapshot(
  jobId: string
): Promise<RemoteJobSnapshot> {
  const record = await findStoredComputeJob(jobId);
  if (!record) {
    throw new Error(`Unknown remote job: ${jobId}`);
  }
  const host = await findStoredComputeHost(record.hostId);
  if (!host) {
    throw new Error(`Unknown SSH compute host: ${record.hostId}`);
  }
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
