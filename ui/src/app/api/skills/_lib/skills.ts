import { promises as fs } from "fs";
import { execFile } from "child_process";
import os from "os";
import path from "path";
import { promisify } from "util";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";
import {
  normalizeSkillMarkdown,
  parseSkillFrontmatter,
} from "@/app/api/skills/_lib/skill-frontmatter";
import type {
  ImportSkillsResponse,
  SkillImportType,
  SkillEntry,
  SkillsConfigResponse,
} from "@/app/skills/types";

const execFileAsync = promisify(execFile);
const GLOBAL_SKILLS_PATH = "~/.internagents/myskills";
const GLOBAL_IMPORTED_SKILLS_PATH = "~/.internagents/imported-skills";
const LEGACY_IMPORTED_SKILLS_PATH = ".internagents/imported-skills";
const IMPORT_TMP_PATH = ".internagents/tmp";
const CLOUD_CLONE_TIMEOUT_MS = 120_000;
const CLOUD_FETCH_TIMEOUT_MS = 30_000;
const CLOUD_RAW_FETCH_TIMEOUT_MS = 30_000;
const MAX_IMPORTED_SKILLS = 50;
const DEFAULT_CATALOG_PATHS = [
  GLOBAL_SKILLS_PATH,
  GLOBAL_IMPORTED_SKILLS_PATH,
  "skills",
  LEGACY_IMPORTED_SKILLS_PATH,
];

interface AgentConfig {
  skills?: unknown;
  [key: string]: unknown;
}

interface SkillSettings {
  enabled: boolean;
  catalogPaths: string[];
  activePath: string;
  selected: string[];
  label: string;
}

const DEFAULT_SKILL_SETTINGS: SkillSettings = {
  enabled: false,
  catalogPaths: DEFAULT_CATALOG_PATHS,
  activePath: ".internagents/active-skills",
  selected: [],
  label: "InternAgentS",
};

function uniqueStrings(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const strings = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(strings));
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function isSameOrInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return (
    relative === "" ||
    (Boolean(relative) &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative))
  );
}

function normalizeSkillSettings(config: AgentConfig): SkillSettings {
  const raw = config.skills;
  if (!raw || Array.isArray(raw) || typeof raw !== "object") {
    return DEFAULT_SKILL_SETTINGS;
  }

  const record = raw as Record<string, unknown>;
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : DEFAULT_SKILL_SETTINGS.enabled,
    catalogPaths: uniqueStrings(
      record.catalog_paths ?? record.catalogPaths,
      DEFAULT_SKILL_SETTINGS.catalogPaths
    ),
    activePath: readString(
      record.active_path ?? record.activePath,
      DEFAULT_SKILL_SETTINGS.activePath
    ),
    selected: uniqueStrings(record.selected, DEFAULT_SKILL_SETTINGS.selected),
    label: readString(record.label, DEFAULT_SKILL_SETTINGS.label),
  };
}

function resolveWorkspaceChild(root: string, relativePath: string): string {
  const cleanPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(root, cleanPath);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path is outside the workspace.");
  }

  return resolved;
}

function toWorkspacePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function resolveConfiguredPath(root: string, configuredPath: string): string {
  const expanded = expandHomePath(configuredPath.trim());
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return resolveWorkspaceChild(root, expanded);
}

function toConfiguredPath(root: string, absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  const workspaceRoot = path.resolve(root);
  if (isSameOrInside(resolved, workspaceRoot)) {
    return toWorkspacePath(workspaceRoot, resolved);
  }

  const home = path.resolve(os.homedir());
  if (isSameOrInside(resolved, home)) {
    const relative = path.relative(home, resolved).split(path.sep).join("/");
    return relative ? `~/${relative}` : "~";
  }

  return resolved;
}

function slugify(value: string, fallback = "skill"): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || fallback;
}

function resolveLocalSource(root: string, source: string): string {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("请输入技能路径。");
  }

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }

  return path.resolve(root, trimmed);
}

async function readAgentConfig(root: string): Promise<AgentConfig> {
  const configPath = path.join(root, "deepagent.config.json");

  try {
    const content = await fs.readFile(configPath, "utf8");
    return JSON.parse(content) as AgentConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeAgentConfig(
  root: string,
  config: AgentConfig
): Promise<void> {
  const configPath = path.join(root, "deepagent.config.json");
  await fs.writeFile(
    configPath,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8"
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasSkillFile(directory: string): Promise<boolean> {
  return pathExists(path.join(directory, "SKILL.md"));
}

async function findSkillDirectories(
  sourceAbsolute: string,
  maxDepth = 2
): Promise<string[]> {
  const stat = await fs.stat(sourceAbsolute).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("没有找到这个技能路径。");
    }
    throw error;
  });

  const sourceDirectory =
    stat.isFile() && path.basename(sourceAbsolute) === "SKILL.md"
      ? path.dirname(sourceAbsolute)
      : sourceAbsolute;

  if (!stat.isDirectory() && sourceDirectory === sourceAbsolute) {
    throw new Error("技能来源需要是目录，或直接指向 SKILL.md 文件。");
  }

  if (await hasSkillFile(sourceDirectory)) {
    return [sourceDirectory];
  }

  const results: string[] = [];
  const visited = new Set<string>();

  async function visit(directory: string, depth: number) {
    if (depth > maxDepth || results.length >= MAX_IMPORTED_SKILLS) {
      return;
    }

    const realDirectory = await fs.realpath(directory).catch(() => directory);
    if (visited.has(realDirectory)) {
      return;
    }
    visited.add(realDirectory);

    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === ".next"
      ) {
        continue;
      }

      const childDirectory = path.join(directory, entry.name);
      if (await hasSkillFile(childDirectory)) {
        results.push(childDirectory);
        if (results.length >= MAX_IMPORTED_SKILLS) {
          return;
        }
      } else {
        await visit(childDirectory, depth + 1);
      }
    }
  }

  await visit(sourceDirectory, 0);

  if (results.length === 0) {
    throw new Error("没有找到包含 SKILL.md 的技能目录。");
  }

  return results;
}

async function nextAvailableDirectory(
  parent: string,
  preferredName: string
): Promise<string> {
  const baseName = slugify(preferredName);
  let candidate = path.join(parent, baseName);
  let suffix = 2;

  while (await pathExists(candidate)) {
    candidate = path.join(parent, `${baseName}-${suffix}`);
    suffix += 1;
  }

  return candidate;
}

async function copySkillIntoImportedCatalog(
  root: string,
  sourceDirectory: string
): Promise<string> {
  const importedRoot = resolveConfiguredPath(root, GLOBAL_IMPORTED_SKILLS_PATH);
  await fs.mkdir(importedRoot, { recursive: true });

  const sourceResolved = path.resolve(sourceDirectory);
  if (
    sourceResolved === importedRoot ||
    sourceResolved.startsWith(`${importedRoot}${path.sep}`)
  ) {
    const skillFile = path.join(sourceResolved, "SKILL.md");
    if (await pathExists(skillFile)) {
      await normalizeSkillFile(skillFile);
    }
    return toConfiguredPath(root, sourceResolved);
  }

  const destination = await nextAvailableDirectory(
    importedRoot,
    path.basename(sourceDirectory)
  );
  await fs.cp(sourceDirectory, destination, {
    dereference: true,
    recursive: true,
  });
  await normalizeSkillFile(path.join(destination, "SKILL.md"));
  return toConfiguredPath(root, destination);
}

async function normalizeSkillFile(skillFile: string): Promise<void> {
  const markdown = await fs.readFile(skillFile, "utf8");
  const normalized = normalizeSkillMarkdown(markdown);
  if (normalized !== markdown) {
    await fs.writeFile(skillFile, normalized, "utf8");
  }
}

async function addImportedCatalogToConfig(root: string): Promise<void> {
  const config = await readAgentConfig(root);
  const current = normalizeSkillSettings(config);

  if (current.catalogPaths.includes(GLOBAL_IMPORTED_SKILLS_PATH)) {
    return;
  }

  await writeAgentConfig(root, {
    ...config,
    skills: {
      enabled: current.enabled,
      catalog_paths: appendUnique(current.catalogPaths, GLOBAL_IMPORTED_SKILLS_PATH),
      active_path: current.activePath,
      selected: current.selected,
      label: current.label,
    },
  });
}

interface CloudSkillSpec {
  kind: "git" | "raw";
  repoUrl?: string;
  branch?: string;
  subPath?: string;
  rawUrl?: string;
}

function normalizeGitHubRepoName(value: string): string {
  return value.replace(/\.git$/, "");
}

function isGitCommitRef(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{40}$/i.test(value));
}

function parseGitHubRepoUrl(repoUrl: string | undefined): {
  owner: string;
  repo: string;
} | null {
  if (!repoUrl) {
    return null;
  }

  const match = repoUrl.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/
  );
  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: normalizeGitHubRepoName(match[2]),
  };
}

function normalizeCloudSkillSpec(source: string): CloudSkillSpec {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("请输入云端技能地址。");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);

    if (url.hostname === "github.com") {
      const segments = url.pathname.split("/").filter(Boolean);
      const owner = segments[0];
      const repo = segments[1] ? normalizeGitHubRepoName(segments[1]) : "";
      if (!owner || !repo) {
        throw new Error("GitHub 地址需要包含 owner/repo。");
      }

      let branch: string | undefined;
      let subPath: string | undefined;
      const mode = segments[2];
      if ((mode === "tree" || mode === "blob") && segments[3]) {
        branch = decodeURIComponent(segments[3]);
        const rest = segments.slice(4);
        if (mode === "blob" && rest[rest.length - 1] === "SKILL.md") {
          rest.pop();
        }
        subPath = rest.join("/");
      } else if (segments.length > 2) {
        subPath = segments.slice(2).join("/");
      }

      return {
        kind: "git",
        repoUrl: `https://github.com/${owner}/${repo}.git`,
        branch,
        subPath,
      };
    }

    if (url.pathname.endsWith(".git")) {
      return { kind: "git", repoUrl: trimmed };
    }

    return { kind: "raw", rawUrl: trimmed };
  }

  const common = trimmed.startsWith("github:")
    ? trimmed.slice("github:".length)
    : trimmed;
  const match = common.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:@([^/\s]+))?(?:\/(.+))?$/
  );
  if (!match) {
    throw new Error("云端技能支持 URL、github:owner/repo/path 或 owner/repo。");
  }

  return {
    kind: "git",
    repoUrl: `https://github.com/${match[1]}/${normalizeGitHubRepoName(
      match[2]
    )}.git`,
    branch: match[3],
    subPath: match[4],
  };
}

async function downloadGitHubArchiveSkill(
  root: string,
  spec: CloudSkillSpec
): Promise<{ sourcePath: string; tmpDirectory: string } | null> {
  const githubRepo = parseGitHubRepoUrl(spec.repoUrl);
  if (!githubRepo) {
    return null;
  }

  const tmpRoot = resolveWorkspaceChild(root, IMPORT_TMP_PATH);
  await fs.mkdir(tmpRoot, { recursive: true });
  const tmpDirectory = await fs.mkdtemp(path.join(tmpRoot, "skill-import-"));
  const ref = spec.branch || "main";
  const archiveUrl = `https://codeload.github.com/${githubRepo.owner}/${
    githubRepo.repo
  }/tar.gz/${encodeURIComponent(ref)}`;
  const archivePath = path.join(tmpDirectory, "repo.tar.gz");

  try {
    const response = await fetchWithTimeout(
      archiveUrl,
      CLOUD_FETCH_TIMEOUT_MS,
      "GitHub 归档下载"
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await fs.writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    await execFileAsync("tar", ["-xzf", archivePath, "-C", tmpDirectory], {
      timeout: CLOUD_CLONE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    const entries = await fs.readdir(tmpDirectory, { withFileTypes: true });
    const extractedRoot = entries.find(
      (entry) => entry.isDirectory() && entry.name !== "repo"
    );
    if (!extractedRoot) {
      throw new Error("GitHub 归档内容为空。");
    }

    const extractedDirectory = path.join(tmpDirectory, extractedRoot.name);
    return {
      sourcePath: spec.subPath
        ? path.join(extractedDirectory, spec.subPath)
        : extractedDirectory,
      tmpDirectory,
    };
  } catch (error) {
    await fs.rm(tmpDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  label: string
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new Error(`${label}超时，请检查网络或代理设置。`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithCurlFallback(
  url: string,
  timeoutMs: number,
  label: string
): Promise<string> {
  let fetchError: unknown;

  try {
    const response = await fetchWithTimeout(url, timeoutMs, label);
    if (response.ok) {
      return response.text();
    }
    fetchError = new Error(`HTTP ${response.status}`);
  } catch (error) {
    fetchError = error;
  }

  const curlCommand = process.platform === "win32" ? "curl.exe" : "curl";
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));

  try {
    const { stdout } = await execFileAsync(
      curlCommand,
      [
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "--connect-timeout",
        String(Math.min(timeoutSeconds, 15)),
        "--max-time",
        String(timeoutSeconds),
        url,
      ],
      {
        timeout: timeoutMs + 5_000,
        maxBuffer: 5 * 1024 * 1024,
      }
    );
    return stdout;
  } catch (curlError) {
    const fetchMessage =
      fetchError instanceof Error && fetchError.message.trim()
        ? fetchError.message
        : "unknown fetch error";
    const curlMessage =
      curlError instanceof Error && curlError.message.trim()
        ? curlError.message
        : "unknown curl error";
    throw new Error(
      `${label}失败，请检查网络或代理设置。fetch: ${fetchMessage}; curl: ${curlMessage}`,
      { cause: curlError }
    );
  }
}

function githubRawSkillUrl(spec: CloudSkillSpec): string | null {
  const githubRepo = parseGitHubRepoUrl(spec.repoUrl);
  if (!githubRepo || !spec.branch || !spec.subPath) {
    return null;
  }

  const skillPath = spec.subPath.endsWith("/SKILL.md")
    ? spec.subPath
    : `${spec.subPath.replace(/\/+$/, "")}/SKILL.md`;
  const encodedPath = skillPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `https://raw.githubusercontent.com/${githubRepo.owner}/${
    githubRepo.repo
  }/${encodeURIComponent(spec.branch)}/${encodedPath}`;
}

function isScienceCatalogRawCandidate(spec: CloudSkillSpec): boolean {
  const githubRepo = parseGitHubRepoUrl(spec.repoUrl);
  return Boolean(
    githubRepo &&
      githubRepo.owner.toLowerCase() === "internscience" &&
      githubRepo.repo.toLowerCase() === "scp" &&
      spec.branch &&
      spec.subPath?.startsWith("skills/")
  );
}

async function importGitHubRawSkill(
  root: string,
  spec: CloudSkillSpec
): Promise<string[] | null> {
  if (!isScienceCatalogRawCandidate(spec)) {
    return null;
  }

  const rawUrl = githubRawSkillUrl(spec);
  if (!rawUrl) {
    return null;
  }

  const markdown = await fetchTextWithCurlFallback(
    rawUrl,
    CLOUD_RAW_FETCH_TIMEOUT_MS,
    "GitHub SKILL.md 下载"
  );
  if (!markdown.trim()) {
    throw new Error("云端 SKILL.md 内容为空。");
  }

  const importedRoot = resolveConfiguredPath(root, GLOBAL_IMPORTED_SKILLS_PATH);
  await fs.mkdir(importedRoot, { recursive: true });
  const preferredName =
    path.basename(spec.subPath || "") ||
    path.basename(path.dirname(new URL(rawUrl).pathname));
  const destination = await nextAvailableDirectory(importedRoot, preferredName);

  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, "SKILL.md"),
    normalizeSkillMarkdown(markdown),
    "utf8"
  );

  return [toConfiguredPath(root, destination)];
}

async function cloneCloudSkill(
  root: string,
  spec: CloudSkillSpec
): Promise<{ sourcePath: string; tmpDirectory: string }> {
  const tmpRoot = resolveWorkspaceChild(root, IMPORT_TMP_PATH);
  await fs.mkdir(tmpRoot, { recursive: true });
  const tmpDirectory = await fs.mkdtemp(path.join(tmpRoot, "skill-import-"));
  const cloneDirectory = path.join(tmpDirectory, "repo");

  try {
    const args = ["clone"];
    if (isGitCommitRef(spec.branch)) {
      args.push("--filter=blob:none", "--no-checkout");
    } else {
      args.push("--depth", "1");
    }
    if (spec.branch && !isGitCommitRef(spec.branch)) {
      args.push("--branch", spec.branch, "--single-branch");
    }
    args.push(spec.repoUrl!, cloneDirectory);

    await execFileAsync("git", args, {
      timeout: CLOUD_CLONE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });

    if (isGitCommitRef(spec.branch)) {
      await execFileAsync(
        "git",
        ["-C", cloneDirectory, "fetch", "--depth", "1", "origin", spec.branch],
        {
          timeout: CLOUD_CLONE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        }
      );
      await execFileAsync(
        "git",
        ["-C", cloneDirectory, "checkout", "--detach", spec.branch],
        {
          timeout: CLOUD_CLONE_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        }
      );
    }

    return {
      sourcePath: spec.subPath
        ? path.join(cloneDirectory, spec.subPath)
        : cloneDirectory,
      tmpDirectory,
    };
  } catch (error) {
    await fs.rm(tmpDirectory, { force: true, recursive: true });
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "云端技能下载失败。";
    throw new Error(`云端技能下载失败，请检查地址或网络。${message}`, {
      cause: error,
    });
  }
}

async function importRawSkill(root: string, rawUrl: string): Promise<string[]> {
  const markdown = await fetchTextWithCurlFallback(
    rawUrl,
    CLOUD_FETCH_TIMEOUT_MS,
    "云端 SKILL.md 下载"
  );
  if (!markdown.trim()) {
    throw new Error("云端 SKILL.md 内容为空。");
  }

  const importedRoot = resolveConfiguredPath(root, GLOBAL_IMPORTED_SKILLS_PATH);
  await fs.mkdir(importedRoot, { recursive: true });
  const url = new URL(rawUrl);
  const parentName =
    path.basename(path.dirname(url.pathname)) ||
    path.basename(url.pathname, path.extname(url.pathname));
  const destination = await nextAvailableDirectory(importedRoot, parentName);
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(
    path.join(destination, "SKILL.md"),
    normalizeSkillMarkdown(markdown),
    "utf8"
  );

  return [toConfiguredPath(root, destination)];
}

async function importSkillDirectories(
  root: string,
  sourceAbsolute: string,
  maxDepth: number
): Promise<string[]> {
  const skillDirectories = await findSkillDirectories(sourceAbsolute, maxDepth);
  const imported: string[] = [];

  for (const skillDirectory of skillDirectories) {
    imported.push(await copySkillIntoImportedCatalog(root, skillDirectory));
  }

  return imported;
}

async function discoverSkills(
  root: string,
  settings: SkillSettings
): Promise<SkillEntry[]> {
  const selected = new Set(settings.selected);
  const skills: SkillEntry[] = [];

  for (const sourcePath of settings.catalogPaths) {
    const sourceAbsolute = resolveConfiguredPath(root, sourcePath);
    let entries;

    try {
      entries = await fs.readdir(sourceAbsolute, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDirectory = path.join(sourceAbsolute, entry.name);
      const skillFile = path.join(skillDirectory, "SKILL.md");
      let markdown: string;

      try {
        markdown = await fs.readFile(skillFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error;
      }

      const frontmatter = parseSkillFrontmatter(markdown);
      const relativePath = toConfiguredPath(root, skillDirectory);
      const key = relativePath;
      const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim()
          ? frontmatter.name.trim()
          : entry.name;

      skills.push({
        key,
        name,
        description:
          typeof frontmatter.description === "string"
            ? frontmatter.description.trim()
            : "No description provided.",
        sourcePath,
        relativePath,
        folderName: entry.name,
        enabled: settings.enabled && selected.has(key),
      });
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function clearDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(directory, entry.name), {
        force: true,
        recursive: true,
      })
    )
  );
}

async function syncActiveSkills(
  root: string,
  settings: SkillSettings,
  skills: SkillEntry[]
): Promise<void> {
  const activeAbsolute = resolveWorkspaceChild(root, settings.activePath);
  const internagentsRoot = resolveWorkspaceChild(root, ".internagents");
  const importedRoots = [
    resolveConfiguredPath(root, GLOBAL_IMPORTED_SKILLS_PATH),
    resolveWorkspaceChild(root, LEGACY_IMPORTED_SKILLS_PATH),
  ];

  if (
    activeAbsolute !== internagentsRoot &&
    !activeAbsolute.startsWith(`${internagentsRoot}${path.sep}`)
  ) {
    throw new Error("Active skills path must stay inside .internagents/.");
  }

  await clearDirectory(activeAbsolute);
  if (!settings.enabled) {
    return;
  }

  const selected = new Set(settings.selected);
  const usedNames = new Set<string>();

  for (const skill of skills) {
    if (!selected.has(skill.key)) {
      continue;
    }

    const source = resolveConfiguredPath(root, skill.relativePath);
    const sourceResolved = path.resolve(source);
    if (importedRoots.some((importedRoot) => isSameOrInside(sourceResolved, importedRoot))) {
      await normalizeSkillFile(path.join(source, "SKILL.md"));
    }

    let linkName = skill.folderName;
    let suffix = 2;
    while (usedNames.has(linkName)) {
      linkName = `${skill.folderName}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(linkName);

    const destination = path.join(activeAbsolute, linkName);
    try {
      await fs.symlink(source, destination, "dir");
    } catch {
      await fs.cp(source, destination, { recursive: true });
    }
  }
}

export async function readSkillsConfig(): Promise<SkillsConfigResponse> {
  const root = getWorkspaceRoot();
  const config = await readAgentConfig(root);
  const settings = normalizeSkillSettings(config);
  const skills = await discoverSkills(root, settings);

  return {
    enabled: settings.enabled,
    catalogPaths: settings.catalogPaths,
    activePath: settings.activePath,
    selected: settings.selected,
    skills,
  };
}

export async function updateSkillsConfig(
  enabled: boolean,
  selected: string[]
): Promise<SkillsConfigResponse> {
  const root = getWorkspaceRoot();
  const config = await readAgentConfig(root);
  const current = normalizeSkillSettings(config);
  const discovered = await discoverSkills(root, current);
  const knownKeys = new Set(discovered.map((skill) => skill.key));
  const nextSelected = Array.from(
    new Set(selected.filter((key) => knownKeys.has(key)))
  );
  const nextSettings: SkillSettings = {
    ...current,
    enabled,
    selected: nextSelected,
  };

  const nextConfig: AgentConfig = {
    ...config,
    skills: {
      enabled: nextSettings.enabled,
      catalog_paths: nextSettings.catalogPaths,
      active_path: nextSettings.activePath,
      selected: nextSettings.selected,
      label: nextSettings.label,
    },
  };

  await writeAgentConfig(root, nextConfig);
  const skills = await discoverSkills(root, nextSettings);
  await syncActiveSkills(root, nextSettings, skills);

  return {
    enabled: nextSettings.enabled,
    catalogPaths: nextSettings.catalogPaths,
    activePath: nextSettings.activePath,
    selected: nextSettings.selected,
    skills,
    message: "技能配置已保存，应用后生效。",
  };
}

export async function importSkills(
  type: SkillImportType,
  source: string
): Promise<ImportSkillsResponse> {
  const root = getWorkspaceRoot();
  let imported: string[];

  if (type === "local") {
    const sourceAbsolute = resolveLocalSource(root, source);
    imported = await importSkillDirectories(root, sourceAbsolute, 2);
  } else if (type === "cloud") {
    const spec = normalizeCloudSkillSpec(source);
    if (spec.kind === "raw") {
      imported = await importRawSkill(root, spec.rawUrl!);
    } else {
      const rawImported = await importGitHubRawSkill(root, spec);
      if (rawImported) {
        imported = rawImported;
      } else {
        let cloned: { sourcePath: string; tmpDirectory: string };
        try {
          cloned =
            (await downloadGitHubArchiveSkill(root, spec)) ??
            (await cloneCloudSkill(root, spec));
        } catch {
          cloned = await cloneCloudSkill(root, spec);
        }
        try {
          imported = await importSkillDirectories(root, cloned.sourcePath, 3);
        } finally {
          await fs.rm(cloned.tmpDirectory, { force: true, recursive: true });
        }
      }
    }
  } else {
    throw new Error("不支持的技能来源类型。");
  }

  if (imported.length === 0) {
    throw new Error("没有导入任何技能。");
  }

  await addImportedCatalogToConfig(root);
  const skillsConfig = await readSkillsConfig();

  return {
    ...skillsConfig,
    imported,
    message: `已添加 ${imported.length} 个技能，可在列表中勾选后应用。`,
  };
}
