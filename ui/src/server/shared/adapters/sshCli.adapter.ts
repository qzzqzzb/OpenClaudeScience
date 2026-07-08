import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import type {
  ListSshHostsInput,
  OpenSshTunnelInput,
  RemoteCommandInput,
  RemoteCommandResult,
  RemoteJsonCommandInput,
  RemoteStdinCommandInput,
  ResolveSshConnectionInput,
  SharedSshAdapter,
  SshAdapterErrorCode,
  SshConnection,
  SshHost,
  SshProbeResult,
  TestSshConnectionInput,
} from "@/server/shared/contracts";
import { AdapterError } from "@/server/shared/contracts";
import {
  assertSshCommand,
  assertSshConfigHost,
  readSshConfigFile,
  remoteBashCommand,
  sshArgsFromCommand,
} from "./sshCli.helpers";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 8;
const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024 * 8;

function sshAdapterError(
  code: SshAdapterErrorCode,
  message: string,
  details?: unknown,
  retryable?: boolean
): AdapterError<SshAdapterErrorCode> {
  return new AdapterError({
    code,
    message,
    details,
    retryable,
  });
}

function stdinToReadable(input: RemoteStdinCommandInput["stdin"]): Readable {
  if (typeof input === "string" || input instanceof Uint8Array) {
    return Readable.from([input]);
  }
  return input;
}

function appendOutputChunk(
  chunks: Buffer[],
  currentBytes: number,
  chunk: Buffer,
  maxBytes: number
): { bytes: number; exceeded: boolean } {
  const nextBytes = currentBytes + chunk.length;
  if (nextBytes > maxBytes) {
    return { bytes: nextBytes, exceeded: true };
  }
  chunks.push(chunk);
  return { bytes: nextBytes, exceeded: false };
}

function parseProbeOutput(stdout: string, checkedAt: string): SshProbeResult {
  const values = Object.fromEntries(
    stdout
      .split(/\r?\n/)
      .map((line) => line.split("=", 2))
      .filter(([key, value]) => key && value != null)
  );

  return {
    ok: true,
    checkedAt,
    os: values.os,
    kernel: values.kernel,
    arch: values.arch,
    user: values.user,
    host: values.host,
    python: values.python,
    bash: values.bash,
    timeout: values.timeout,
    workdir: values.workdir || values.pwd,
  };
}

async function listHosts(input: ListSshHostsInput = {}): Promise<SshHost[]> {
  const entries = await readSshConfigFile(
    path.join(os.homedir(), ".ssh", "config"),
    { includePatterns: input.includePatterns === true }
  );
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (seen.has(entry.alias)) {
        return false;
      }
      seen.add(entry.alias);
      return true;
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

async function assertKnownHost(value: unknown): Promise<string> {
  let host: string;
  try {
    host = assertSshConfigHost(value);
  } catch (error) {
    throw sshAdapterError(
      "SSH_CONFIG_NOT_FOUND",
      error instanceof Error ? error.message : "Invalid SSH config host.",
      { input: value }
    );
  }
  const hosts = await listHosts();
  if (!hosts.some((entry) => entry.alias === host)) {
    throw sshAdapterError(
      "SSH_CONFIG_NOT_FOUND",
      `未在 ~/.ssh/config 中找到 Host: ${host}`,
      { host }
    );
  }
  return host;
}

async function resolveConnection(
  input: ResolveSshConnectionInput
): Promise<SshConnection> {
  if (
    input.connectionMode === "sshCommand" ||
    (typeof input.sshCommand === "string" && input.sshCommand.trim())
  ) {
    let sshCommand: string;
    try {
      sshCommand = assertSshCommand(input.sshCommand);
    } catch (error) {
      throw sshAdapterError(
        "INVALID_SSH_COMMAND",
        error instanceof Error ? error.message : "Invalid SSH command.",
        { sshCommand: input.sshCommand }
      );
    }
    return {
      mode: "sshCommand",
      sshCommand,
      displayName: sshCommand,
    };
  }

  const hostAlias = await assertKnownHost(input.host);
  return {
    mode: "sshConfig",
    hostAlias,
    sshCommand: `ssh ${hostAlias}`,
    displayName: hostAlias,
  };
}

async function runCommand(
  input: RemoteCommandInput
): Promise<RemoteCommandResult> {
  const [binary, ...args] = sshArgsFromCommand(input.connection.sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
  ]);
  const maxBuffer = input.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(binary, [...args, "bash", "-s"], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: input.signal,
      windowsHide: true,
    });
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : undefined;

    const finish = (result: RemoteCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendOutputChunk(stdout, stdoutBytes, chunk, maxBuffer);
      stdoutBytes = next.bytes;
      if (next.exceeded) {
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendOutputChunk(stderr, stderrBytes, chunk, maxBuffer);
      stderrBytes = next.bytes;
      if (next.exceeded) {
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr:
          Buffer.concat(stderr).toString("utf8") ||
          (error instanceof Error ? error.message : String(error)),
        exitCode: 1,
      });
    });
    child.on("close", (code) => {
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 1,
        timedOut,
      });
    });

    child.stdin.on("error", (error) => {
      child.kill("SIGTERM");
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr:
          Buffer.concat(stderr).toString("utf8") ||
          (error instanceof Error ? error.message : String(error)),
        exitCode: 1,
      });
    });
    child.stdin.end(input.script);
  });
}

async function runCommandWithInput(
  input: RemoteStdinCommandInput
): Promise<RemoteCommandResult> {
  const [binary, ...args] = sshArgsFromCommand(input.connection.sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${DEFAULT_CONNECT_TIMEOUT_SECONDS}`,
  ]);
  const maxBuffer = input.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;

    const child = spawn(binary, [...args, remoteBashCommand(input.script)], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: input.signal,
      windowsHide: true,
    });
    const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
        : undefined;

    const finish = (result: RemoteCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendOutputChunk(stdout, stdoutBytes, chunk, maxBuffer);
      stdoutBytes = next.bytes;
      if (next.exceeded) {
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendOutputChunk(stderr, stderrBytes, chunk, maxBuffer);
      stderrBytes = next.bytes;
      if (next.exceeded) {
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr:
          Buffer.concat(stderr).toString("utf8") ||
          (error instanceof Error ? error.message : String(error)),
        exitCode: 1,
      });
    });
    child.on("close", (code) => {
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 1,
        timedOut,
      });
    });

    const inputStream = stdinToReadable(input.stdin);
    inputStream.on("error", (error) => {
      child.kill("SIGTERM");
      finish({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr:
          Buffer.concat(stderr).toString("utf8") ||
          (error instanceof Error ? error.message : String(error)),
        exitCode: 1,
      });
    });
    inputStream.pipe(child.stdin);
  });
}

async function testConnection(
  input: TestSshConnectionInput
): Promise<SshProbeResult> {
  const checkedAt = new Date().toISOString();
  const script = [
    "set -e",
    "printf 'os=%s\\n' \"$(uname -s 2>/dev/null || true)\"",
    "printf 'kernel=%s\\n' \"$(uname -r 2>/dev/null || true)\"",
    "printf 'arch=%s\\n' \"$(uname -m 2>/dev/null || true)\"",
    "printf 'user=%s\\n' \"$(id -un)\"",
    "printf 'host=%s\\n' \"$(hostname)\"",
    "printf 'python=%s\\n' \"$(command -v python3 || true)\"",
    "printf 'bash=%s\\n' \"$(command -v bash || true)\"",
    "printf 'timeout=%s\\n' \"$(command -v timeout || true)\"",
    "printf 'workdir=%s\\n' \"$(pwd)\"",
  ].join("\n");

  const result = await runCommand({
    connection: input.connection,
    script,
    timeoutMs: input.timeoutMs ?? 15_000,
    signal: input.signal,
  });
  if (result.exitCode !== 0) {
    return {
      ok: false,
      checkedAt,
      error: result.stderr || result.stdout || "SSH 测试失败。",
    };
  }

  return parseProbeOutput(result.stdout, checkedAt);
}

async function runJsonCommand<T>(input: RemoteJsonCommandInput): Promise<T> {
  const result = await runCommand(input);
  if (result.exitCode !== 0) {
    throw sshAdapterError(
      result.timedOut ? "COMMAND_TIMEOUT" : "REMOTE_COMMAND_FAILED",
      result.stderr || result.stdout || "Remote command failed.",
      result,
      result.timedOut === true
    );
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw sshAdapterError(
      "PARSE_ERROR",
      `Invalid remote JSON: ${
        error instanceof Error ? error.message : String(error)
      }: ${result.stdout.slice(0, 1000)}`,
      { stdout: result.stdout.slice(0, 1000) }
    );
  }
}

async function openTunnel(input: OpenSshTunnelInput) {
  const remoteHost = input.remoteHost || "127.0.0.1";
  const localUrl = `http://127.0.0.1:${input.localPort}`;
  if (input.pidFile && input.replaceExistingPid !== false) {
    try {
      const pid = Number((await readFile(input.pidFile, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // No previous tunnel to stop.
    }
  }
  if (input.logFile) {
    await mkdir(path.dirname(input.logFile), { recursive: true });
  }
  if (input.pidFile) {
    await mkdir(path.dirname(input.pidFile), { recursive: true });
  }

  const [sshBinary, ...baseSshArgs] = sshArgsFromCommand(
    input.connection.sshCommand,
    ["-N", "-L", `${input.localPort}:${remoteHost}:${input.remotePort}`]
  );
  const child = spawn(sshBinary, baseSshArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    signal: input.signal,
    windowsHide: true,
  });
  child.on("error", () => {
    // Tunnel health is checked by callers; avoid an unhandled child error event.
  });
  if (input.logFile) {
    const output = createWriteStream(input.logFile, { flags: "a" });
    child.stdout?.pipe(output);
    child.stderr?.pipe(output);
  } else {
    child.stdout?.resume();
    child.stderr?.resume();
  }
  child.unref();
  if (input.pidFile && child.pid) {
    await writeFile(input.pidFile, `${child.pid}\n`);
  }
  return {
    localUrl,
    localPort: input.localPort,
    remoteHost,
    remotePort: input.remotePort,
    pid: child.pid,
    logFile: input.logFile,
    pidFile: input.pidFile,
  };
}

export const sshCliAdapter: SharedSshAdapter = {
  listHosts,
  resolveConnection,
  testConnection,
  runCommand,
  runCommandWithInput,
  runJsonCommand,
  openTunnel,
};
