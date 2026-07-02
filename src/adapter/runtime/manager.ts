import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyBaseLogger } from "fastify";
import type { OpenCodeRuntime } from "./opencode.js";

type RuntimeHealthProbe = Pick<OpenCodeRuntime, "health">;

export type ManagedRuntimeStatus = "idle" | "starting" | "running" | "attached" | "stopped" | "failed";

export type RuntimeManagerState = {
  mode: "external" | "managed";
  managedProcess: {
    status: ManagedRuntimeStatus;
    running: boolean;
    pid?: number;
    command?: string;
    startedAt?: string;
    exitedAt?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    owned?: boolean;
    error?: string;
  };
};

export class OpenCodeRuntimeManager {
  private child?: ChildProcessWithoutNullStreams;
  private state: RuntimeManagerState;

  constructor(
    private readonly input: {
      mode: "external" | "managed";
      command: string;
      host: string;
      port: number;
      corsOrigin: string;
      projectRoot: string;
      runtime: RuntimeHealthProbe;
      logger: FastifyBaseLogger;
    },
  ) {
    this.state = {
      mode: input.mode,
      managedProcess: {
        status: "idle",
        running: false,
      },
    };
  }

  getState(): RuntimeManagerState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.input.mode === "external") return;

    if (await isPortOpen(this.input.host, this.input.port)) {
      const health = await this.input.runtime.health();
      if (!health.connected) {
        this.state = {
          mode: this.input.mode,
          managedProcess: {
            status: "failed",
            running: false,
            owned: false,
            error: `Port ${this.input.host}:${this.input.port} is occupied but OpenCode health check failed: ${health.error ?? "unknown error"}`,
          },
        };
        throw new Error(this.state.managedProcess.error);
      }

      this.state = {
        mode: this.input.mode,
        managedProcess: {
          status: "attached",
          running: true,
          owned: false,
          command: `existing OpenCode server at ${this.input.host}:${this.input.port}`,
          startedAt: new Date().toISOString(),
        },
      };
      this.input.logger.info(
        { host: this.input.host, port: this.input.port },
        "OpenCode port is already open and healthy; managed mode attached to existing server",
      );
      return;
    }

    const args = [
      "serve",
      "--hostname",
      this.input.host,
      "--port",
      String(this.input.port),
      "--cors",
      this.input.corsOrigin,
    ];
    let command: string;
    try {
      command = resolveOpenCodeCommand(this.input.command);
    } catch (error) {
      this.markFailed(error instanceof Error ? error.message : String(error), false);
      throw error;
    }

    const child = spawn(command, args, {
      cwd: this.input.projectRoot,
      windowsHide: true,
      shell: false,
    });
    this.child = child;
    this.state = {
      mode: this.input.mode,
      managedProcess: {
        status: "starting",
        running: true,
        pid: child.pid,
        command: `${this.input.command} ${args.join(" ")}`,
        startedAt: new Date().toISOString(),
        owned: true,
      },
    };

    child.stdout.on("data", (chunk) => this.input.logger.info({ chunk: chunk.toString() }, "opencode stdout"));
    child.stderr.on("data", (chunk) => this.input.logger.warn({ chunk: chunk.toString() }, "opencode stderr"));
    child.on("error", (error) => {
      this.markFailed(`OpenCode process failed to start: ${error.message}`, true);
    });
    child.on("exit", (exitCode, signal) => {
      this.state = {
        ...this.state,
        managedProcess: {
          ...this.state.managedProcess,
          status: exitCode === 0 ? "stopped" : "failed",
          running: false,
          exitedAt: new Date().toISOString(),
          exitCode,
          signal,
        },
      };
      this.input.logger.info({ exitCode, signal }, "OpenCode managed process exited");
    });

    await this.waitForHealthy();
    this.state = {
      ...this.state,
      managedProcess: {
        ...this.state.managedProcess,
        status: "running",
        running: true,
      },
    };
  }

  async stop(): Promise<void> {
    if (this.state.managedProcess.owned === false) return;
    if (!this.child || this.child.killed) return;
    if (process.platform === "win32" && this.child.pid) {
      await waitForExit(spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true }));
    } else {
      this.child.kill();
    }
    await sleep(300);
    if (!this.child.killed && process.platform !== "win32") {
      this.child.kill("SIGKILL");
    }
    this.state = {
      ...this.state,
      managedProcess: {
        ...this.state.managedProcess,
        status: "stopped",
        running: false,
        exitedAt: this.state.managedProcess.exitedAt ?? new Date().toISOString(),
      },
    };
  }

  private async waitForHealthy(): Promise<void> {
    const deadline = Date.now() + 20_000;
    let lastError = "OpenCode did not become healthy";

    while (Date.now() < deadline) {
      if (this.state.managedProcess.status === "failed" && this.state.managedProcess.error) {
        throw new Error(this.state.managedProcess.error);
      }
      const health = await this.input.runtime.health();
      if (health.connected) return;
      lastError = health.error ?? lastError;
      await sleep(500);
    }

    await this.stop();
    this.state = {
      ...this.state,
      managedProcess: {
        ...this.state.managedProcess,
        status: "failed",
        running: false,
        error: `Managed OpenCode failed to start: ${lastError}`,
      },
    };
    throw new Error(this.state.managedProcess.error);
  }

  private markFailed(error: string, owned: boolean | undefined): void {
    this.state = {
      mode: this.input.mode,
      managedProcess: {
        ...this.state.managedProcess,
        status: "failed",
        running: false,
        owned,
        error,
        exitedAt: new Date().toISOString(),
      },
    };
  }
}

async function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

function resolveOpenCodeCommand(command: string): string {
  if (process.platform !== "win32") return command;
  if (!command.toLowerCase().endsWith(".cmd")) return command;

  const where = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (where.status !== 0) {
    throw new Error(`Cannot resolve ${command}: where.exe ${command} failed`);
  }

  const shim = where.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.toLowerCase().endsWith(command.toLowerCase()));
  if (!shim) {
    throw new Error(`Cannot resolve ${command}: command shim was not found in PATH`);
  }

  const prefix = path.dirname(shim);
  const executable = path.join(prefix, "node_modules", "opencode-ai", "bin", "opencode.exe");
  if (!fs.existsSync(executable)) {
    throw new Error(`Cannot resolve ${command}: expected OpenCode executable at ${executable}`);
  }
  return executable;
}
