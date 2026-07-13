import { execFile, spawn } from "child_process";
import { constants, createWriteStream, readFileSync } from "fs";
import { promises as fs } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";

const execFileAsync = promisify(execFile);

const DEFAULT_RELEASE_REPO = "qzzqzzb/OpenClaudeScience";
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 60 * 1000;
const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_LOG_ENTRIES = 40;
const LOCK_STALE_MS = 30 * 60 * 1000;

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "failed";

export interface UpdateLogEntry {
  at: string;
  message: string;
}

export interface UpdateVersionInfo {
  version: string;
  exactTag?: string;
  branch?: string;
  commit?: string;
  dirty: boolean;
  dirtyReason?: string;
  appPath?: string;
  installMode: "desktop-app" | "source";
}

export interface UpdateAssetInfo {
  name: string;
  size?: number;
  downloadUrl: string;
}

export interface UpdateDownloadProgress {
  assetName: string;
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  startedAt: string;
  updatedAt: string;
}

export interface UpdateReleaseInfo {
  tagName: string;
  name: string;
  htmlUrl: string;
  publishedAt?: string;
  notes?: string;
  asset?: UpdateAssetInfo;
}

export interface UpdateStatus {
  state: UpdateState;
  sourceRepo: string;
  sourceUrl: string;
  current: UpdateVersionInfo;
  latest?: UpdateReleaseInfo;
  updateAvailable: boolean;
  canApply: boolean;
  blockReason?: string;
  message: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  previous?: {
    checkoutTarget: string;
    commit: string;
    label: string;
  };
  download?: UpdateDownloadProgress;
  installLogPath?: string;
  log: UpdateLogEntry[];
}

interface CommandOptions {
  timeoutMs?: number;
  allowFailure?: boolean;
  cwd?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface CommandError extends Error {
  stdout?: string;
  stderr?: string;
}

interface GitHubAssetPayload {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  content_type?: unknown;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  assets?: unknown;
}

function updatePaths() {
  const root = getWorkspaceRoot();
  const updateDir = path.join(root, ".internagents", "update");
  return {
    root,
    updateDir,
    statusPath: path.join(updateDir, "status.json"),
    lockPath: path.join(updateDir, "update.lock"),
    downloadsDir: path.join(updateDir, "downloads"),
    stagingDir: path.join(updateDir, "staged-app"),
    installerDir: path.join(updateDir, "installer"),
    installLogPath: path.join(updateDir, "install.log"),
  };
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

function readRuntimeEnvValues(): Record<string, string> {
  try {
    const content = readFileSync(path.join(getWorkspaceRoot(), ".env"), "utf8");
    const values: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) {
        continue;
      }
      values[match[1]] = parseEnvValue(match[2]);
    }
    return values;
  } catch {
    return {};
  }
}

function updateEnvValue(name: string) {
  const processValue = process.env[name]?.trim();
  if (processValue) {
    return processValue;
  }
  return readRuntimeEnvValues()[name]?.trim() || "";
}

function releaseRepoSlug() {
  const raw = (updateEnvValue("INTERNAGENTS_UPDATE_REPO") || DEFAULT_RELEASE_REPO).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)
    ? raw
    : DEFAULT_RELEASE_REPO;
}

function releaseApiUrl() {
  return (
    updateEnvValue("INTERNAGENTS_UPDATE_API_URL") ||
    `https://api.github.com/repos/${releaseRepoSlug()}/releases/latest`
  );
}

function releasePageUrl() {
  return `https://github.com/${releaseRepoSlug()}/releases/latest`;
}

function nowIso() {
  return new Date().toISOString();
}

function trimOutput(value: string, maxLength = 4000) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function appendLog(status: UpdateStatus, message: string): UpdateStatus {
  return {
    ...status,
    updatedAt: nowIso(),
    log: [
      ...status.log,
      {
        at: nowIso(),
        message,
      },
    ].slice(-MAX_LOG_ENTRIES),
  };
}

async function readStatusFile(): Promise<UpdateStatus | null> {
  const { statusPath } = updatePaths();
  try {
    const content = await fs.readFile(statusPath, "utf8");
    return JSON.parse(content) as UpdateStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStatusFile(status: UpdateStatus): Promise<UpdateStatus> {
  const { updateDir, statusPath } = updatePaths();
  await fs.mkdir(updateDir, { recursive: true });
  await fs.writeFile(
    statusPath,
    `${JSON.stringify(status, null, 2)}\n`,
    "utf8"
  );
  return status;
}

function fallbackStatus(current: UpdateVersionInfo): UpdateStatus {
  return withApplicability({
    state: "idle",
    sourceRepo: releaseRepoSlug(),
    sourceUrl: releasePageUrl(),
    current,
    updateAvailable: false,
    canApply: false,
    message: "尚未检查更新。",
    updatedAt: nowIso(),
    log: [],
  });
}

async function runCommand(
  command: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || updatePaths().root,
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const commandError = error as CommandError;
    if (options.allowFailure) {
      return {
        stdout: commandError.stdout || "",
        stderr: commandError.stderr || commandError.message,
      };
    }
    const stderr = trimOutput(commandError.stderr || commandError.message);
    throw new Error(stderr || `${command} ${args.join(" ")} failed`, {
      cause: error,
    });
  }
}

async function safeGit(args: string[]): Promise<string | undefined> {
  try {
    const result = await runCommand("git", args);
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeVersion(value: string | undefined) {
  if (!value) {
    return "0.0.0";
  }
  return value.trim().replace(/^v/i, "");
}

function parseSemver(value: string) {
  const normalized = normalizeVersion(value);
  const [main, prerelease = ""] = normalized.split("-", 2);
  const [major = "0", minor = "0", patch = "0"] = main.split(".");
  return {
    major: Number(major) || 0,
    minor: Number(minor) || 0,
    patch: Number(patch) || 0,
    prerelease,
  };
}

function compareVersions(left: string, right: string) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] > b[key] ? 1 : -1;
    }
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (!a.prerelease) {
    return 1;
  }
  if (!b.prerelease) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

function isSafeReleaseTag(tagName: string) {
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tagName);
}

async function readPackageVersion() {
  const { root } = updatePaths();
  const candidates = [
    path.join(root, "pyproject.toml"),
    path.join(root, "ui", "package.json"),
    path.join(root, "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, "utf8");
      if (candidate.endsWith("package.json")) {
        const parsed = JSON.parse(content) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
      const match = content.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      continue;
    }
  }

  return "0.0.0";
}

function appBundlePath() {
  const raw = process.env.INTERNAGENTS_APP_BUNDLE_PATH?.trim();
  if (!raw) {
    return undefined;
  }
  const resolved = path.resolve(raw);
  return resolved.endsWith(".app") ? resolved : undefined;
}

export async function getCurrentVersionInfo(): Promise<UpdateVersionInfo> {
  const appPath = appBundlePath();
  const appVersion = process.env.INTERNAGENTS_APP_VERSION?.trim();
  const exactTag = appVersion
    ? undefined
    : await safeGit(["describe", "--tags", "--exact-match"]);
  const branch = await safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = await safeGit(["rev-parse", "--short", "HEAD"]);
  const version = normalizeVersion(
    appVersion || exactTag || (await readPackageVersion())
  );
  const sourceMode = appPath ? false : true;
  const status = sourceMode
    ? await safeGit(["status", "--porcelain", "--untracked-files=all"])
    : undefined;
  const dirty = Boolean(status?.trim());

  return {
    version,
    exactTag,
    branch,
    commit,
    dirty,
    dirtyReason: dirty
      ? "当前源码目录有未提交改动，源码模式不能自动安装 App 更新。"
      : undefined,
    appPath,
    installMode: appPath ? "desktop-app" : "source",
  };
}

function githubHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "InternAgentS-Updater",
    ...extra,
  };
  const token =
    updateEnvValue("INTERNAGENTS_UPDATE_GITHUB_TOKEN") ||
    updateEnvValue("GH_TOKEN") ||
    updateEnvValue("GITHUB_TOKEN");
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function parseAssets(value: unknown): GitHubAssetPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((asset): asset is GitHubAssetPayload => {
    return Boolean(asset && typeof asset === "object");
  });
}

function assetRegexOverride() {
  const raw = updateEnvValue("INTERNAGENTS_UPDATE_ASSET_REGEX");
  if (!raw) {
    return undefined;
  }
  try {
    return new RegExp(raw, "i");
  } catch {
    return undefined;
  }
}

function scoreReleaseAsset(asset: GitHubAssetPayload, tagName: string) {
  const name = typeof asset.name === "string" ? asset.name : "";
  const downloadUrl =
    typeof asset.browser_download_url === "string"
      ? asset.browser_download_url
      : "";
  if (!name || !downloadUrl || !name.toLowerCase().endsWith(".dmg")) {
    return -1;
  }

  const override = assetRegexOverride();
  if (override) {
    return override.test(name) ? 1000 : -1;
  }

  const lowerName = name.toLowerCase();
  const arch = process.arch;
  const wantedTokens =
    arch === "arm64"
      ? ["arm64", "aarch64", "apple-silicon", "silicon"]
      : ["x64", "x86_64", "amd64", "intel"];
  const otherTokens =
    arch === "arm64"
      ? ["x64", "x86_64", "amd64", "intel"]
      : ["arm64", "aarch64", "apple-silicon", "silicon"];
  const hasWantedToken = wantedTokens.some((token) =>
    lowerName.includes(token)
  );
  const hasOtherToken = otherTokens.some((token) => lowerName.includes(token));

  if (hasOtherToken && !hasWantedToken) {
    return -1;
  }

  let score = 0;

  if (lowerName.includes("internagents")) {
    score += 100;
  }
  if (hasWantedToken) {
    score += 80;
  }
  if (hasOtherToken) {
    score -= 80;
  }
  if (
    lowerName.includes(normalizeVersion(tagName).toLowerCase()) ||
    lowerName.includes(tagName.toLowerCase())
  ) {
    score += 20;
  }
  return score;
}

function selectReleaseAsset(
  assets: GitHubAssetPayload[],
  tagName: string
): UpdateAssetInfo | undefined {
  const ranked = assets
    .map((asset) => ({ asset, score: scoreReleaseAsset(asset, tagName) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0]?.asset;
  if (
    !selected ||
    typeof selected.name !== "string" ||
    typeof selected.browser_download_url !== "string"
  ) {
    return undefined;
  }

  return {
    name: selected.name,
    size: typeof selected.size === "number" ? selected.size : undefined,
    downloadUrl: selected.browser_download_url,
  };
}

function releaseTagFromUrl(value: string | undefined) {
  if (!value) {
    return "";
  }
  try {
    const parsed = new URL(value, `https://github.com/${releaseRepoSlug()}/`);
    const match = parsed.pathname.match(/\/releases\/tag\/([^/]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function publicAssetCandidates(tagName: string) {
  const version = normalizeVersion(tagName);
  const archTokens = process.arch === "arm64" ? ["arm64"] : ["x64", "x86_64"];
  const versionTokens = Array.from(new Set([version, tagName]));
  const names = new Set<string>();

  for (const versionToken of versionTokens) {
    for (const archToken of archTokens) {
      names.add(`InternAgentS-${versionToken}-${archToken}.dmg`);
    }
    names.add(`InternAgentS-${versionToken}.dmg`);
  }

  return [...names];
}

function publicLatestDownloadUrl(assetName: string) {
  return `https://github.com/${releaseRepoSlug()}/releases/latest/download/${encodeURIComponent(assetName)}`;
}

async function selectPublicReleaseAsset(tagName: string, signal: AbortSignal) {
  for (const name of publicAssetCandidates(tagName)) {
    const response = await fetch(publicLatestDownloadUrl(name), {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent": "InternAgentS-Updater",
      },
      signal,
    });
    if ((response.status >= 200 && response.status < 400) || response.status === 405) {
      const size = Number(response.headers.get("content-length") || "");
      return {
        name,
        size: Number.isFinite(size) && size > 0 ? size : undefined,
        downloadUrl: publicLatestDownloadUrl(name),
      };
    }
  }

  return undefined;
}

async function fetchLatestPublicRelease(signal: AbortSignal): Promise<UpdateReleaseInfo> {
  const response = await fetch(releasePageUrl(), {
    redirect: "manual",
    cache: "no-store",
    headers: {
      "User-Agent": "InternAgentS-Updater",
    },
    signal,
  });
  const location = response.headers.get("location") || response.url;
  const tagName = releaseTagFromUrl(location);
  if (!tagName || !isSafeReleaseTag(tagName)) {
    throw new Error("公开 Release 页面没有返回有效的 latest tag。");
  }

  return {
    tagName,
    name: tagName,
    htmlUrl: `https://github.com/${releaseRepoSlug()}/releases/tag/${encodeURIComponent(tagName)}`,
    asset: await selectPublicReleaseAsset(tagName, signal),
  };
}

function githubRateLimitResetMessage(response: Response) {
  const reset = response.headers.get("x-ratelimit-reset");
  if (!reset) {
    return "";
  }
  const resetAt = new Date(Number(reset) * 1000);
  if (Number.isNaN(resetAt.getTime())) {
    return "";
  }
  return `，限制将在 ${resetAt.toLocaleString()} 后重置`;
}

async function githubResponseError(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as {
    message?: unknown;
  };
  const message = typeof payload.message === "string" ? payload.message : "";
  const rateLimited =
    response.status === 403 &&
    (response.headers.get("x-ratelimit-remaining") === "0" ||
      /rate limit/i.test(message));

  if (rateLimited) {
    return [
      "GitHub Release 读取失败：HTTP 403（GitHub API 访问频率限制）。",
      `当前更新源是 ${releaseRepoSlug()}${githubRateLimitResetMessage(response)}。`,
      "公开 Release 不需要权限 token；如果频繁检查或共享出口 IP 被限流，可以等待重置或在桌面运行时 .env 中设置 INTERNAGENTS_UPDATE_GITHUB_TOKEN 提高限额。",
    ].join("");
  }

  if (response.status === 404) {
    return [
      "GitHub Release 读取失败：HTTP 404。",
      `没有找到 ${releaseRepoSlug()} 的 latest release，或当前仓库/Release 不公开。`,
    ].join("");
  }

  return `GitHub Release 读取失败：HTTP ${response.status}${message ? `：${message}` : ""}`;
}

async function fetchLatestRelease(): Promise<UpdateReleaseInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(releaseApiUrl(), {
      headers: githubHeaders(),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const apiError = await githubResponseError(response);
      if (response.status === 403 || response.status === 404) {
        try {
          return await fetchLatestPublicRelease(controller.signal);
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : "公开 Release 页面回退检查失败。";
          throw new Error(`${apiError} 公开 Release 回退也失败：${fallbackMessage}`, {
            cause: fallbackError,
          });
        }
      }
      throw new Error(apiError);
    }

    const payload = (await response.json()) as GitHubReleasePayload;
    const tagName =
      typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
    if (!tagName || !isSafeReleaseTag(tagName)) {
      throw new Error("最新 release tag 不是受支持的 vX.Y.Z 格式。");
    }

    return {
      tagName,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : tagName,
      htmlUrl:
        typeof payload.html_url === "string" && payload.html_url.trim()
          ? payload.html_url.trim()
          : releasePageUrl(),
      publishedAt:
        typeof payload.published_at === "string"
          ? payload.published_at
          : undefined,
      notes: typeof payload.body === "string" ? payload.body : undefined,
      asset: selectReleaseAsset(parseAssets(payload.assets), tagName),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function blockReasonFor(status: UpdateStatus) {
  if (!status.updateAvailable) {
    return undefined;
  }
  if (status.state === "downloading" || status.state === "applying") {
    return "更新正在进行中。";
  }
  if (process.platform !== "darwin") {
    return "自动安装 App 更新仅支持 macOS。";
  }
  if (!status.latest?.asset) {
    return "最新 Release 没有匹配当前 Mac 架构的 DMG 资产。";
  }
  if (status.current.installMode !== "desktop-app" || !status.current.appPath) {
    return "当前不是从打包后的 macOS App 启动；请下载 DMG 后手动安装。";
  }
  if (status.current.appPath.startsWith("/Volumes/")) {
    return "当前 App 似乎直接运行在 DMG 中；请先拖到 Applications 后再更新。";
  }
  return undefined;
}

function withApplicability(status: UpdateStatus): UpdateStatus {
  const blockReason = blockReasonFor(status);
  return {
    ...status,
    sourceRepo: releaseRepoSlug(),
    sourceUrl: releasePageUrl(),
    canApply: status.updateAvailable && !blockReason,
    blockReason,
  };
}

function buildStatusWithRelease(
  current: UpdateVersionInfo,
  latest: UpdateReleaseInfo,
  previous?: UpdateStatus | null
): UpdateStatus {
  const updateAvailable = compareVersions(latest.tagName, current.version) > 0;
  return withApplicability({
    ...(previous || fallbackStatus(current)),
    state: updateAvailable ? "available" : "up-to-date",
    sourceRepo: releaseRepoSlug(),
    sourceUrl: releasePageUrl(),
    current,
    latest,
    updateAvailable,
    canApply: false,
    blockReason: undefined,
    message: updateAvailable
      ? `发现新版本 ${latest.tagName}。`
      : `当前已是最新版本 v${current.version}。`,
    updatedAt: nowIso(),
  });
}

function normalizeApplyingStatus(status: UpdateStatus): UpdateStatus {
  if (
    status.state === "applying" &&
    status.latest &&
    compareVersions(status.current.version, status.latest.tagName) >= 0
  ) {
    return {
      ...status,
      state: "applied",
      updateAvailable: false,
      message: `已更新到 ${status.latest.tagName}。`,
      completedAt: status.completedAt || nowIso(),
    };
  }
  return status;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const current = await getCurrentVersionInfo();
  const saved = await readStatusFile();
  if (!saved) {
    return fallbackStatus(current);
  }

  return withApplicability(
    normalizeApplyingStatus({
      ...saved,
      sourceRepo: releaseRepoSlug(),
      sourceUrl: releasePageUrl(),
      current,
      updateAvailable:
        saved.latest !== undefined &&
        compareVersions(saved.latest.tagName, current.version) > 0,
      updatedAt: nowIso(),
    })
  );
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = await getCurrentVersionInfo();
  let status = appendLog(
    {
      ...(await getUpdateStatus()),
      state: "checking",
      current,
      message: "正在检查 GitHub Release。",
      updateAvailable: false,
      canApply: false,
      blockReason: undefined,
    },
    `检查 ${releaseRepoSlug()} 最新 release。`
  );
  await writeStatusFile(status);

  try {
    const latest = await fetchLatestRelease();
    status = buildStatusWithRelease(current, latest, status);
    status = appendLog(status, status.message);
    if (status.updateAvailable && !latest.asset) {
      status = appendLog(status, "未找到适用于当前 Mac 的 DMG 资产。");
    }
    return writeStatusFile(status);
  } catch (error) {
    status = withApplicability(
      appendLog(
        {
          ...status,
          state: "failed",
          message: error instanceof Error ? error.message : "检查更新失败。",
          updateAvailable: false,
          completedAt: nowIso(),
        },
        "检查更新失败。"
      )
    );
    return writeStatusFile(status);
  }
}

async function acquireLock() {
  const { updateDir, lockPath } = updatePaths();
  await fs.mkdir(updateDir, { recursive: true });

  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fs.unlink(lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
    );
    await handle.writeFile(`${process.pid}\n${nowIso()}\n`);
    return async () => {
      await handle?.close();
      await fs.unlink(lockPath).catch(() => undefined);
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("已有更新任务正在运行。", { cause: error });
    }
    throw error;
  }
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function parseContentLength(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function downloadAsset(
  asset: UpdateAssetInfo,
  reportProgress?: (progress: UpdateDownloadProgress) => Promise<void>
): Promise<string> {
  const { downloadsDir } = updatePaths();
  await fs.mkdir(downloadsDir, { recursive: true });
  const destination = path.join(downloadsDir, safeFileName(asset.name));
  const partial = `${destination}.partial`;

  const response = await fetch(asset.downloadUrl, {
    headers: githubHeaders({ Accept: "application/octet-stream" }),
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    throw new Error(`DMG 下载失败：HTTP ${response.status}`);
  }

  const totalBytes =
    asset.size ?? parseContentLength(response.headers.get("content-length"));
  const startedAt = nowIso();
  let downloadedBytes = 0;
  let lastReportAt = 0;
  let lastReportBytes = 0;
  const reportEveryMs = 250;
  const reportEveryBytes = 1024 * 1024;

  const buildProgress = (): UpdateDownloadProgress => {
    const percent =
      totalBytes !== undefined
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 1000) / 10)
        : undefined;

    return {
      assetName: asset.name,
      downloadedBytes,
      totalBytes,
      percent,
      startedAt,
      updatedAt: nowIso(),
    };
  };

  const emitProgress = async (force = false) => {
    if (!reportProgress) {
      return;
    }
    const currentTime = Date.now();
    if (
      !force &&
      currentTime - lastReportAt < reportEveryMs &&
      downloadedBytes - lastReportBytes < reportEveryBytes
    ) {
      return;
    }
    lastReportAt = currentTime;
    lastReportBytes = downloadedBytes;
    await reportProgress(buildProgress());
  };

  await emitProgress(true);

  const progressStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloadedBytes += chunk.length;
      emitProgress(downloadedBytes === totalBytes)
        .then(() => callback(null, chunk))
        .catch((error) => callback(error));
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    progressStream,
    createWriteStream(partial)
  );

  await emitProgress(true);

  if (asset.size !== undefined) {
    const stat = await fs.stat(partial);
    if (stat.size !== asset.size) {
      throw new Error(
        `DMG 下载大小不一致：期望 ${asset.size}，实际 ${stat.size}。`
      );
    }
  }

  await fs.rename(partial, destination);
  return destination;
}

async function findAppBundle(
  directory: string,
  depth = 0
): Promise<string | null> {
  if (depth > 5) {
    return null;
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return fullPath;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith(".app")) {
      continue;
    }
    const result = await findAppBundle(
      path.join(directory, entry.name),
      depth + 1
    );
    if (result) {
      return result;
    }
  }
  return null;
}

async function mountDmg(dmgPath: string): Promise<string> {
  const { updateDir } = updatePaths();
  const mountDir = path.join(updateDir, `mount-${process.pid}-${Date.now()}`);
  await fs.rm(mountDir, { recursive: true, force: true });
  await fs.mkdir(mountDir, { recursive: true });
  try {
    await runCommand(
      "hdiutil",
      ["attach", dmgPath, "-readonly", "-nobrowse", "-mountpoint", mountDir],
      {
        timeoutMs: UPDATE_TIMEOUT_MS,
      }
    );
    return mountDir;
  } catch (error) {
    await fs
      .rm(mountDir, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

async function detachDmg(mountDir: string) {
  await runCommand("hdiutil", ["detach", mountDir, "-quiet"], {
    allowFailure: true,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  await fs
    .rm(mountDir, { recursive: true, force: true })
    .catch(() => undefined);
}

async function stageAppFromDmg(
  dmgPath: string,
  tagName: string
): Promise<string> {
  const { stagingDir } = updatePaths();
  let mountDir: string | null = null;
  try {
    mountDir = await mountDmg(dmgPath);
    const sourceApp = await findAppBundle(mountDir);
    if (!sourceApp) {
      throw new Error("DMG 中没有找到 .app。");
    }

    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
    const stagedApp = path.join(
      stagingDir,
      `InternAgentS-${safeFileName(tagName)}.app`
    );
    await runCommand("ditto", [sourceApp, stagedApp], {
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    await runCommand(
      "codesign",
      ["--verify", "--deep", "--strict", stagedApp],
      {
        timeoutMs: COMMAND_TIMEOUT_MS,
      }
    );
    return stagedApp;
  } finally {
    if (mountDir) {
      await detachDmg(mountDir);
    }
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function writeInstallerScript(
  stagedApp: string,
  targetApp: string,
  tagName: string
) {
  const { installerDir, installLogPath, stagingDir } = updatePaths();
  await fs.mkdir(installerDir, { recursive: true });
  const scriptPath = path.join(
    installerDir,
    `install-${safeFileName(tagName)}.zsh`
  );
  const appPid = Number(process.env.INTERNAGENTS_APP_PID || process.ppid || 0);
  const backupApp = `${targetApp}.previous-internagents-update`;

  const script = `#!/bin/zsh
set -u
LOG=${shellQuote(installLogPath)}
TARGET=${shellQuote(targetApp)}
STAGED=${shellQuote(stagedApp)}
BACKUP=${shellQuote(backupApp)}
STAGING_ROOT=${shellQuote(stagingDir)}
APP_PID=${String(appPid)}
{
  echo "[$(/bin/date -u +"%Y-%m-%dT%H:%M:%SZ")] Installing InternAgentS ${tagName}"
  /bin/sleep 1
  if [ "$APP_PID" -gt 1 ]; then
    /bin/kill -TERM "$APP_PID" 2>/dev/null || true
    for i in {1..80}; do
      /bin/kill -0 "$APP_PID" 2>/dev/null || break
      /bin/sleep 0.25
    done
    if /bin/kill -0 "$APP_PID" 2>/dev/null; then
      /bin/kill -KILL "$APP_PID" 2>/dev/null || true
      /bin/sleep 1
    fi
  fi

  if [ ! -d "$STAGED" ]; then
    echo "Staged app is missing: $STAGED"
    exit 1
  fi

  if [ -d "$TARGET" ]; then
    /bin/rm -rf "$BACKUP"
    /bin/mv "$TARGET" "$BACKUP"
  fi

  if ! /usr/bin/ditto "$STAGED" "$TARGET"; then
    echo "Failed to copy updated app."
    if [ -d "$BACKUP" ] && [ ! -d "$TARGET" ]; then
      /bin/mv "$BACKUP" "$TARGET"
    fi
    exit 1
  fi

  if ! /usr/bin/codesign --verify --deep --strict "$TARGET"; then
    echo "Updated app failed codesign verification."
    /bin/rm -rf "$TARGET"
    if [ -d "$BACKUP" ]; then
      /bin/mv "$BACKUP" "$TARGET"
    fi
    exit 1
  fi

  /bin/rm -rf "$STAGING_ROOT"
  /usr/bin/open -n "$TARGET"
  echo "Install complete."
} >> "$LOG" 2>&1
`;

  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return { scriptPath, installLogPath };
}

async function launchInstaller(
  stagedApp: string,
  targetApp: string,
  tagName: string
) {
  const { scriptPath, installLogPath } = await writeInstallerScript(
    stagedApp,
    targetApp,
    tagName
  );
  const installer = spawn("/bin/zsh", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  installer.unref();
  return installLogPath;
}

export async function applyUpdate(): Promise<UpdateStatus> {
  const releaseCheck = await checkForUpdate();
  const latest = releaseCheck.latest;
  if (!latest || !releaseCheck.updateAvailable) {
    return releaseCheck;
  }

  if (
    !releaseCheck.canApply ||
    !latest.asset ||
    !releaseCheck.current.appPath
  ) {
    return writeStatusFile(
      withApplicability(
        appendLog(
          {
            ...releaseCheck,
            state: "failed",
            message: releaseCheck.blockReason || "当前环境不能自动安装更新。",
            completedAt: nowIso(),
          },
          "更新被环境检查阻止。"
        )
      )
    );
  }

  const releaseLock = await acquireLock();
  const asset = latest.asset;
  const targetAppPath = releaseCheck.current.appPath;
  let status = releaseCheck;

  try {
    status = appendLog(
      {
        ...status,
        state: "downloading",
        startedAt: nowIso(),
        completedAt: undefined,
        message: `正在下载 ${asset.name}。`,
        download: {
          assetName: asset.name,
          downloadedBytes: 0,
          totalBytes: asset.size,
          percent: asset.size !== undefined ? 0 : undefined,
          startedAt: nowIso(),
          updatedAt: nowIso(),
        },
      },
      `开始下载 ${asset.name}。`
    );
    await writeStatusFile(status);

    const dmgPath = await downloadAsset(asset, async (download) => {
      status = {
        ...status,
        state: "downloading",
        message:
          download.percent !== undefined
            ? `正在下载 ${asset.name}，已完成 ${download.percent.toFixed(1)}%。`
            : `正在下载 ${asset.name}。`,
        download,
        updatedAt: download.updatedAt,
      };
      await writeStatusFile(status);
    });
    status = appendLog(status, `已下载 ${asset.name}。`);
    await writeStatusFile(status);

    const stagedApp = await stageAppFromDmg(dmgPath, latest.tagName);
    status = appendLog(status, "已校验并暂存新版 App。");
    await writeStatusFile(status);

    const installLogPath = await launchInstaller(
      stagedApp,
      targetAppPath,
      latest.tagName
    );

    status = appendLog(
      {
        ...status,
        state: "applying",
        installLogPath,
        message: "安装器已启动，InternAgentS 将退出、替换 App 并重新打开。",
      },
      "已启动本机安装器。"
    );
    return writeStatusFile(status);
  } catch (error) {
    status = withApplicability(
      appendLog(
        {
          ...status,
          state: "failed",
          message: error instanceof Error ? error.message : "更新失败。",
          completedAt: nowIso(),
        },
        "更新失败。"
      )
    );
    return writeStatusFile(status);
  } finally {
    await releaseLock();
  }
}

export async function rollbackUpdate(): Promise<UpdateStatus> {
  const status = await getUpdateStatus();
  return writeStatusFile(
    withApplicability(
      appendLog(
        {
          ...status,
          state: "failed",
          message:
            "App 安装器模式不支持应用内回滚；请从 release 页面下载上一版 DMG 重新安装。",
          completedAt: nowIso(),
        },
        "已拒绝应用内回滚。"
      )
    )
  );
}
