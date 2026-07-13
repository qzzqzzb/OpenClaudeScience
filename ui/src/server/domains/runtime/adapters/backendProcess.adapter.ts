import { promises as fs } from "fs";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import {
  getResourcesConfigPath,
  type ResourcesFile,
} from "@/server/domains/workspace/adapters/workspaceFs.adapter";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";

const execFileAsync = promisify(execFile);

export interface BackendRestartResult {
  status: "restarted" | "failed";
  message: string;
  url: string;
  pid?: number;
  oldPid?: number;
  logPath: string;
}

export interface BackendStatusResult {
  status: "idle" | "busy" | "unavailable";
  message: string;
  url: string;
  busyThreads: number;
  interruptedThreads: number;
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

const IS_WINDOWS = process.platform === "win32";

function backendHost(): string {
  const deploymentUrl = process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    return "127.0.0.1";
  }

  try {
    return new URL(deploymentUrl).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function backendPort(): number {
  if (process.env.INTERNAGENTS_BACKEND_PORT) {
    return Number(process.env.INTERNAGENTS_BACKEND_PORT);
  }

  const deploymentUrl = process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    return 2024;
  }

  try {
    const parsed = new URL(deploymentUrl);
    return Number(parsed.port || 2024);
  } catch {
    return 2024;
  }
}

function localRuntimePort(): number {
  return Number(process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT || 22024);
}

function langGraphJobsPerWorker(): string {
  return process.env.INTERNAGENTS_LANGGRAPH_JOBS_PER_WORKER || "5";
}

function isExecutable(filePath: string): boolean {
  if (IS_WINDOWS) {
    return existsSync(filePath);
  }

  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pythonBinary(root: string): string {
  if (process.env.INTERNAGENTS_PYTHON_BIN) {
    return process.env.INTERNAGENTS_PYTHON_BIN;
  }

  const candidates = IS_WINDOWS
    ? [
        path.join(root, ".venv", "Scripts", "pythonw.exe"),
        path.join(root, ".venv", "Scripts", "python.exe"),
        path.join(root, ".conda", "pythonw.exe"),
        path.join(root, ".conda", "python.exe"),
        path.join(root, ".conda", "Scripts", "pythonw.exe"),
        path.join(root, ".conda", "Scripts", "python.exe"),
      ]
    : [
        path.join(root, ".venv", "bin", "python"),
        path.join(root, ".conda", "bin", "python"),
      ];

  const bundledPython = candidates.find(isExecutable);
  if (bundledPython) {
    return bundledPython;
  }

  return IS_WINDOWS ? "python" : "python3";
}

function runtimePaths(root: string) {
  const runtimeDir = path.join(root, ".internagents");
  const logDir = path.join(runtimeDir, "logs");
  const pidDir = path.join(runtimeDir, "pids");
  const langGraphStateDir = path.join(runtimeDir, "langgraph-state");

  return {
    runtimeDir,
    logDir,
    pidDir,
    backendStateDir: path.join(langGraphStateDir, "backend"),
    localRuntimeStateDir: path.join(langGraphStateDir, "local-runtime"),
    backendLog: path.join(logDir, "backend.log"),
    localRuntimeLog: path.join(logDir, "local-runtime.log"),
    backendPidFile: path.join(pidDir, "backend.pid"),
    localRuntimePidFile: path.join(pidDir, "local-runtime.pid"),
  };
}

function agentEntrypointShim(): string {
  return [
    "import importlib.util",
    "import os",
    "import sys",
    "from pathlib import Path",
    "",
    '_root = Path(os.environ["INTERNAGENTS_GRAPH_ROOT"])',
    '_spec = importlib.util.spec_from_file_location("_internagents_real_agent", _root / "agent.py")',
    "if _spec is None or _spec.loader is None:",
    '    raise RuntimeError("Unable to load InternAgentS graph entrypoint.")',
    "_module = importlib.util.module_from_spec(_spec)",
    "sys.modules[_spec.name] = _module",
    "_spec.loader.exec_module(_module)",
    'globals().update({name: getattr(_module, name) for name in dir(_module) if not name.startswith("__")})',
    "",
  ].join("\n");
}

function ensureLangGraphStateDir(root: string, stateDir: string) {
  mkdirSync(stateDir, { recursive: true });
  const entrypoint = path.join(stateDir, "agent.py");
  rmSync(entrypoint, { force: true });

  if (!IS_WINDOWS) {
    try {
      symlinkSync(path.join(root, "agent.py"), entrypoint, "file");
      return;
    } catch {
      // Fall back to a shim in environments where symlinks are unavailable.
    }
  }

  writeFileSync(entrypoint, agentEntrypointShim(), "utf8");
}

function parseEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readProjectEnv(root: string): Record<string, string> {
  const envFile = path.join(root, ".env");
  if (!existsSync(envFile)) {
    return {};
  }

  const values: Record<string, string> = {};
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) {
      continue;
    }
    values[match[1]] = parseEnvValue(match[2]);
  }
  return values;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function urlOk(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function countThreadsByStatus(
  url: string,
  status: "busy" | "interrupted"
): Promise<number> {
  const pageSize = 100;
  let offset = 0;
  let count = 0;

  while (true) {
    const response = await fetch(`${url}/threads/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: pageSize,
        offset,
        status,
        select: ["thread_id", "status"],
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Unable to query ${status} threads.`);
    }

    const threads = (await response.json()) as unknown[];
    count += threads.length;
    if (threads.length < pageSize) {
      return count;
    }
    offset += threads.length;
  }
}

export async function getBackendStatus(): Promise<BackendStatusResult> {
  const host = backendHost();
  const port = backendPort();
  const url = `http://${host}:${port}`;

  if (!(await urlOk(`${url}/ok`))) {
    return {
      status: "unavailable",
      message: "后台健康检查失败，无法判断是否空闲。",
      url,
      busyThreads: 0,
      interruptedThreads: 0,
    };
  }

  try {
    const [busyThreads, interruptedThreads] = await Promise.all([
      countThreadsByStatus(url, "busy"),
      countThreadsByStatus(url, "interrupted"),
    ]);
    const isIdle = busyThreads === 0 && interruptedThreads === 0;

    return {
      status: isIdle ? "idle" : "busy",
      message: isIdle
        ? "后台当前空闲，可以安全应用。"
        : "后台存在运行中或等待审批的会话，暂不自动应用。",
      url,
      busyThreads,
      interruptedThreads,
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof Error ? error.message : "无法读取后台会话状态。",
      url,
      busyThreads: 0,
      interruptedThreads: 0,
    };
  }
}

async function waitForBackend(url: string, timeoutMs = 60000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await urlOk(`${url}/ok`)) {
      return true;
    }
    await sleep(750);
  }
  return false;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 10000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isAlive(pid)) {
      return true;
    }
    await sleep(250);
  }
  return !isAlive(pid);
}

function readPidFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }

  const raw = readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function ensureLocalRuntimeResource(runtimeUrl: string): Promise<string> {
  const resourcesPath = getResourcesConfigPath();
  let config: ResourcesFile;

  try {
    const content = await fs.readFile(resourcesPath, "utf8");
    config = JSON.parse(content) as ResourcesFile;
  } catch {
    config = {
      default_resource: "local",
      resources: [],
    };
  }

  const resources = Array.isArray(config.resources) ? config.resources : [];
  const localResource = resources.find((resource) => resource.id === "local") || {
    id: "local",
    label: "Current Machine",
    backend: "local_shell" as const,
    workspace: ".",
    enabled: true,
  };

  localResource.label ||= "Current Machine";
  localResource.backend = "local_shell";
  localResource.workspace ||= ".";
  localResource.remote_url = runtimeUrl;
  localResource.remote_assistant_id = "agent";
  localResource.enabled = localResource.enabled !== false;

  config.default_resource ||= "local";
  config.resources = [
    localResource,
    ...resources.filter((resource) => resource.id !== "local"),
  ];

  await fs.mkdir(path.dirname(resourcesPath), { recursive: true });
  await fs.writeFile(resourcesPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return resourcesPath;
}

async function listListeningPids(port: number): Promise<number[]> {
  if (IS_WINDOWS) {
    return listWindowsListeningPids(port);
  }

  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function listWindowsListeningPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"]);
    const pids = new Set<number>();

    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (
        parts.length < 5 ||
        parts[0].toUpperCase() !== "TCP" ||
        parts[3].toUpperCase() !== "LISTENING"
      ) {
        continue;
      }

      const localAddress = parts[1];
      const separatorIndex = localAddress.lastIndexOf(":");
      const localPort =
        separatorIndex >= 0 ? Number(localAddress.slice(separatorIndex + 1)) : NaN;
      const pid = Number(parts[4]);
      if (localPort === port && Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return Array.from(pids);
  } catch {
    return [];
  }
}

async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (IS_WINDOWS) {
    return getWindowsProcessInfo(pid);
  }

  try {
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pid=",
      "-o",
      "ppid=",
      "-o",
      "pgid=",
      "-o",
      "command=",
    ]);
    const line = stdout.trim();
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      return null;
    }

    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    };
  } catch {
    return null;
  }
}

async function getWindowsProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const command = [
      "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = " +
        pid +
        "\";",
      "if ($null -eq $process) { exit 1 }",
      "[pscustomobject]@{",
      "pid = [int]$process.ProcessId;",
      "ppid = [int]$process.ParentProcessId;",
      "command = [string]$process.CommandLine",
      "} | ConvertTo-Json -Compress",
    ].join(" ");
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
    const parsed = JSON.parse(stdout.trim()) as {
      pid?: number;
      ppid?: number;
      command?: string;
    };

    if (!parsed.pid) {
      return null;
    }

    return {
      pid: parsed.pid,
      ppid: parsed.ppid || 0,
      pgid: parsed.pid,
      command: parsed.command || "",
    };
  } catch {
    return null;
  }
}

async function listChildPids(pid: number): Promise<number[]> {
  if (IS_WINDOWS) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((childPid) => Number.isInteger(childPid) && childPid > 1);
  } catch {
    return [];
  }
}

async function listDescendantPids(pid: number): Promise<number[]> {
  const descendants: number[] = [];
  const seen = new Set<number>([pid]);
  const queue = [pid];

  while (queue.length > 0) {
    const parentPid = queue.shift();
    if (!parentPid) {
      continue;
    }

    for (const childPid of await listChildPids(parentPid)) {
      if (seen.has(childPid)) {
        continue;
      }
      seen.add(childPid);
      descendants.push(childPid);
      queue.push(childPid);
    }
  }

  return descendants;
}

function signalProcesses(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have already exited.
    }
  }
}

async function findLangGraphProcess(
  port: number,
  pidFile: string
): Promise<ProcessInfo | null> {
  const candidates = new Set<number>();
  const pidFromFile = readPidFile(pidFile);
  if (pidFromFile && isAlive(pidFromFile)) {
    candidates.add(pidFromFile);
  }

  for (const pid of await listListeningPids(port)) {
    candidates.add(pid);
  }

  const inspected = new Set<number>();
  const queue = Array.from(candidates);
  const infos: ProcessInfo[] = [];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid || inspected.has(pid) || pid <= 1) {
      continue;
    }

    inspected.add(pid);
    const info = await getProcessInfo(pid);
    if (!info) {
      continue;
    }

    infos.push(info);
    if (info.ppid > 1 && !inspected.has(info.ppid)) {
      queue.push(info.ppid);
    }
  }

  return (
    infos.find((info) => /langgraph_cli\s+dev/.test(info.command)) ||
    infos.find((info) => info.command.includes("langgraph_cli")) ||
    null
  );
}

async function terminateBackend(info: ProcessInfo): Promise<void> {
  if (IS_WINDOWS) {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(info.pid), "/T"]);
    } catch {
      // Fall through to the forced termination attempt below.
    }

    if (await waitForProcessExit(info.pid)) {
      return;
    }

    try {
      await execFileAsync("taskkill.exe", ["/PID", String(info.pid), "/T", "/F"]);
    } catch {
      return;
    }

    await waitForProcessExit(info.pid, 5000);
    return;
  }

  const descendants = await listDescendantPids(info.pid);
  signalProcesses([...descendants].reverse(), "SIGTERM");
  signalProcesses([info.pid], "SIGTERM");

  if (await waitForProcessExit(info.pid)) {
    return;
  }

  const remainingDescendants = await listDescendantPids(info.pid);
  signalProcesses([...remainingDescendants].reverse(), "SIGKILL");
  signalProcesses([info.pid], "SIGKILL");

  await waitForProcessExit(info.pid, 5000);
}

async function startLangGraphServer({
  root,
  host,
  port,
  configFile,
  logPath,
  pidFile,
  stateDir,
  allowBlocking = false,
  env,
}: {
  root: string;
  host: string;
  port: number;
  configFile: string;
  logPath: string;
  pidFile: string;
  stateDir: string;
  allowBlocking?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const paths = runtimePaths(root);
  mkdirSync(paths.logDir, { recursive: true });
  mkdirSync(paths.pidDir, { recursive: true });
  ensureLangGraphStateDir(root, stateDir);
  const configPath = path.isAbsolute(configFile)
    ? configFile
    : path.join(root, configFile);

  const shouldAllowBlocking = allowBlocking && IS_WINDOWS;
  const args = [
    "-m",
    "langgraph_cli",
    "dev",
    "--host",
    host,
    "--port",
    String(port),
    "--no-browser",
    "--no-reload",
    "--n-jobs-per-worker",
    langGraphJobsPerWorker(),
    ...(shouldAllowBlocking ? ["--allow-blocking"] : []),
    "--config",
    configPath,
  ];
  const serverEnv = {
    ...process.env,
    ...readProjectEnv(root),
    ...(env || {}),
    INTERNAGENTS_GRAPH_ROOT: root,
    ...(IS_WINDOWS
      ? {
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        }
      : {}),
  };

  const fd = openSync(logPath, "a");
  const child = spawn(
    pythonBinary(root),
    args,
    {
      cwd: stateDir,
      detached: true,
      env: serverEnv,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    }
  );
  child.unref();
  closeSync(fd);

  await fs.writeFile(pidFile, `${child.pid}\n`, "utf8");
  return child.pid;
}

export async function restartBackend(): Promise<BackendRestartResult> {
  const root = getWorkspaceRoot();
  const host = backendHost();
  const port = backendPort();
  const runtimePort = localRuntimePort();
  const url = `http://${host}:${port}`;
  const runtimeUrl = `http://${host}:${runtimePort}`;
  const paths = runtimePaths(root);

  try {
    mkdirSync(paths.logDir, { recursive: true });
    mkdirSync(paths.pidDir, { recursive: true });

    const oldProcess = await findLangGraphProcess(port, paths.backendPidFile);
    const oldRuntimeProcess = await findLangGraphProcess(
      runtimePort,
      paths.localRuntimePidFile
    );
    if (!oldProcess && (await urlOk(`${url}/ok`))) {
      return {
        status: "failed",
        message:
          "后台端口已有健康服务，但无法确认它属于 InternAgentS，已跳过自动应用。",
        url,
        logPath: paths.backendLog,
      };
    }
    if (!oldRuntimeProcess && (await urlOk(`${runtimeUrl}/ok`))) {
      return {
        status: "failed",
        message:
          "本机 runtime 端口已有健康服务，但无法确认它属于 InternAgentS，已跳过自动应用。",
        url,
        logPath: paths.localRuntimeLog,
      };
    }

    if (oldProcess) {
      await terminateBackend(oldProcess);
    }
    if (oldRuntimeProcess) {
      await terminateBackend(oldRuntimeProcess);
    }

    const runtimePid = await startLangGraphServer({
      root,
      host,
      port: runtimePort,
      configFile: "langgraph.runtime.json",
      logPath: paths.localRuntimeLog,
      pidFile: paths.localRuntimePidFile,
      stateDir: paths.localRuntimeStateDir,
      allowBlocking: IS_WINDOWS,
      env: {
        ...process.env,
        INTERNAGENT_PROCESS_ROLE: "runtime",
        INTERNAGENT_RUNTIME_ID: "local",
      },
    });
    const runtimeReady = await waitForBackend(runtimeUrl);

    if (!runtimeReady) {
      return {
        status: "failed",
        message: "本机 runtime 已启动，但健康检查超时。请查看 local-runtime.log。",
        url,
        pid: runtimePid,
        oldPid: oldRuntimeProcess?.pid,
        logPath: paths.localRuntimeLog,
      };
    }

    await ensureLocalRuntimeResource(runtimeUrl);

    const pid = await startLangGraphServer({
      root,
      host,
      port,
      configFile: "langgraph.json",
      logPath: paths.backendLog,
      pidFile: paths.backendPidFile,
      stateDir: paths.backendStateDir,
    });
    const ready = await waitForBackend(url);

    if (!ready) {
      return {
        status: "failed",
        message: "后台进程已启动，但健康检查超时。请查看 backend.log。",
        url,
        pid,
        oldPid: oldProcess?.pid,
        logPath: paths.backendLog,
      };
    }

    return {
      status: "restarted",
      message: "本机 runtime 和主后台已应用新配置。",
      url,
      pid,
      oldPid: oldProcess?.pid,
      logPath: paths.backendLog,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "技能配置自动应用失败。",
      url,
      logPath: paths.backendLog,
    };
  }
}
