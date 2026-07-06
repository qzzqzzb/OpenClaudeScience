import { execFile, spawn } from "child_process";
import crypto from "crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { promisify } from "util";
import type {
  WorkspaceEntry,
  WorkspacePreviewKind,
} from "@/app/types/workspace";

const execFileAsync = promisify(execFile);

const DEFAULT_IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".internagents",
  ".langgraph_api",
  ".next",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  "caddyfile",
  "dockerfile",
  ".env.example",
  "gemfile",
  ".gitignore",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".log",
  ".mjs",
  "makefile",
  "procfile",
  ".py",
  "rakefile",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const MOLECULE_EXTENSIONS = new Set([
  ".cif",
  ".cube",
  ".mcif",
  ".mmcif",
  ".mol",
  ".mol2",
  ".pdb",
  ".pqr",
  ".sdf",
  ".xyz",
]);

const SCIENCE_EXTENSIONS = new Set([
  ".cif",
  ".cube",
  ".jdx",
  ".science.json",
  ".vti",
  ".vtk",
]);

const EXTENSIONLESS_TEXT_FILENAMES = new Set([
  "caddyfile",
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
  "rakefile",
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

const MIME_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  caddyfile: "text/plain; charset=utf-8",
  dockerfile: "text/x-dockerfile; charset=utf-8",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".env.example": "text/plain; charset=utf-8",
  gemfile: "text/plain; charset=utf-8",
  ".gif": "image/gif",
  ".gitignore": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".jdx": "chemical/x-jcamp-dx; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".cif": "chemical/x-cif; charset=utf-8",
  ".cube": "chemical/x-cube; charset=utf-8",
  makefile: "text/x-makefile; charset=utf-8",
  ".mcif": "chemical/x-mmcif; charset=utf-8",
  ".mmcif": "chemical/x-mmcif; charset=utf-8",
  ".mol": "chemical/x-mdl-molfile; charset=utf-8",
  ".mol2": "chemical/x-mol2; charset=utf-8",
  ".pdf": "application/pdf",
  ".pdb": "chemical/x-pdb; charset=utf-8",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".pqr": "chemical/x-pqr; charset=utf-8",
  procfile: "text/plain; charset=utf-8",
  ".py": "text/x-python; charset=utf-8",
  rakefile: "text/plain; charset=utf-8",
  ".sdf": "chemical/x-mdl-sdfile; charset=utf-8",
  ".science.json": "application/vnd.internagents.science-scene+json; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".vti": "application/vnd.vtk+xml; charset=utf-8",
  ".vtk": "model/vnd.vtk; charset=utf-8",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xyz": "chemical/x-xyz; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
};

export const MAX_PREVIEW_FILE_SIZE = 100 * 1024 * 1024;
export const MAX_TEXT_FILE_SIZE = MAX_PREVIEW_FILE_SIZE;
const MAX_RAW_FILE_SIZE = MAX_PREVIEW_FILE_SIZE;
const MAX_BASENAME_MATCHES = 8;
const MAX_BASENAME_SEARCH_DIRECTORIES = 10_000;
const DEFAULT_WORKSPACE_FILE_SEARCH_LIMIT = 80;
const MAX_WORKSPACE_FILE_SEARCH_LIMIT = 200;
const MAX_WORKSPACE_FILE_SEARCH_DIRECTORIES = 10_000;
const REMOTE_WORKSPACE_TIMEOUT_MS = 30_000;
const REMOTE_WORKSPACE_MAX_BUFFER = 160 * 1024 * 1024;
const WORKSPACE_DIRECTORY_LIST_CACHE_TTL_MS = 5_000;

type WorkspaceBackend = "local_shell" | "ssh_shell";

interface WorkspaceDirectoryListCacheEntry {
  entries: WorkspaceEntry[];
  expiresAt: number;
  modifiedAtMs: number;
}

const workspaceDirectoryListCache = new Map<
  string,
  WorkspaceDirectoryListCacheEntry
>();

export interface ResourceRecord {
  id: string;
  label?: string;
  backend?: WorkspaceBackend;
  workspace?: string;
  ssh_command?: string;
  remote_url?: string;
  remote_runtime_port?: number;
  remote_assistant_id?: string;
  remote_backend_release_tag?: string;
  remote_backend_fingerprint?: string;
  remote_backend_source_repo?: string;
  remote_backend_asset_name?: string;
  remote_backend_updated_at?: string;
  remote_install_mode?: "auto" | "venv" | "pythonPath" | "conda";
  remote_python_path?: string;
  remote_conda_command?: string;
  kb_path?: string;
  enabled?: boolean;
  timeout?: number;
  max_output_bytes?: number;
}

export interface ResourcesFile {
  default_resource?: string;
  default_workspace?: string;
  workspaces?: WorkspaceRecord[];
  resources?: ResourceRecord[];
}

export interface WorkspaceRecord {
  id: string;
  label: string;
  path: string;
}

export interface ResolvedWorkspaceRecord extends WorkspaceRecord {
  resolvedPath: string;
}

interface WorkspaceResolvedPath {
  root: string;
  absolutePath: string;
  relativePath: string;
  resource: ResourceRecord;
}

interface WorkspaceFileData {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isFile: boolean;
  content?: string;
  tooLarge?: boolean;
  dataBase64?: string;
}

interface WorkspaceByteRange {
  start: number;
  end: number;
}

export interface WorkspaceRawFileStreamData extends WorkspaceFileData {
  stream: ReadableStream<Uint8Array>;
  contentLength: number;
  range?: WorkspaceByteRange;
}

export class WorkspaceRangeNotSatisfiableError extends Error {
  readonly size: number;

  constructor(size: number) {
    super("Requested range is not satisfiable.");
    this.name = "WorkspaceRangeNotSatisfiableError";
    this.size = size;
  }
}

const DEFAULT_RESOURCES_FILE = "internagent.resources.json";
const LOCAL_RESOURCES_FILE = "internagent.resources.local.json";

function defaultLocalRuntimeUrl() {
  return `http://127.0.0.1:${
    process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT || "22024"
  }`;
}

function defaultLocalWorkspacePath() {
  if (process.env.INTERNAGENTS_DESKTOP === "1") {
    const workspacePath = path.join(os.homedir(), "InternAgentS-Workspace");
    mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
  }
  return ".";
}

function defaultResourcesConfig(): ResourcesFile {
  const workspacePath = defaultLocalWorkspacePath();
  return {
    default_resource: "local",
    resources: [
      {
        id: "local",
        label: "Current Machine",
        backend: "local_shell",
        workspace: workspacePath,
        remote_url: defaultLocalRuntimeUrl(),
        remote_assistant_id: "agent",
        enabled: true,
      },
    ],
    workspaces: [
      {
        id: workspaceIdForPath(workspacePath),
        label: workspaceLabelForPath(workspacePath),
        path: workspacePath,
      },
    ],
    default_workspace: workspaceIdForPath(workspacePath),
  };
}

function getResourcesConfigEnvValue(): string | undefined {
  return (
    process.env.INTERNAGENT_RESOURCES_FILE ||
    readRootEnvValue("INTERNAGENT_RESOURCES_FILE")
  );
}

export function getResourcesConfigPath(): string {
  const explicit = getResourcesConfigEnvValue();
  return explicit
    ? path.resolve(getWorkspaceRoot(), explicit)
    : path.join(getWorkspaceRoot(), DEFAULT_RESOURCES_FILE);
}

function getLocalResourcesConfigPath(): string {
  return path.join(getWorkspaceRoot(), LOCAL_RESOURCES_FILE);
}

function workspaceIdForPath(workspacePath: string): string {
  const digest = crypto
    .createHash("sha1")
    .update(workspacePath)
    .digest("hex")
    .slice(0, 12);
  return `local-${digest}`;
}

function workspaceLabelForPath(workspacePath: string): string {
  const name = path.basename(workspacePath);
  return name || workspacePath;
}

function readResourcesConfig(): ResourcesFile {
  const configPath = getResourcesConfigPath();
  if (!existsSync(configPath)) {
    const config = defaultResourcesConfig();
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return config;
  }
  return JSON.parse(readFileSync(configPath, "utf8")) as ResourcesFile;
}

export function readWorkspaceResourcesConfig(): ResourcesFile {
  return readResourcesConfig();
}

export async function writeResourcesConfigAtPath(
  configPath: string,
  config: ResourcesFile
) {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function writeRootEnvValues(updates: Record<string, string>) {
  const envPath = path.join(getWorkspaceRoot(), ".env");
  let content = "";
  try {
    content = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || line.trim().startsWith("#")) {
      return line;
    }

    const key = match[2];
    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${match[1]}${key}${match[3]}${JSON.stringify(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  const nextContent = `${nextLines
    .filter(
      (_, index) => index < nextLines.length - 1 || nextLines[index] !== ""
    )
    .join("\n")}\n`;

  await fs.writeFile(envPath, nextContent);
}

export async function getWritableResourcesConfig(): Promise<{
  configPath: string;
  config: ResourcesFile;
}> {
  const explicit =
    process.env.INTERNAGENT_RESOURCES_FILE ||
    readRootEnvValue("INTERNAGENT_RESOURCES_FILE");
  if (explicit) {
    const configPath = path.resolve(getWorkspaceRoot(), explicit);
    return {
      configPath,
      config: JSON.parse(
        await fs.readFile(configPath, "utf8")
      ) as ResourcesFile,
    };
  }

  const configPath = getLocalResourcesConfigPath();
  let config: ResourcesFile;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8")) as ResourcesFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    config = readResourcesConfig();
    await writeResourcesConfigAtPath(configPath, config);
  }

  await writeRootEnvValues({
    INTERNAGENT_RESOURCES_FILE: LOCAL_RESOURCES_FILE,
  });

  return { configPath, config };
}

function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function normalizeWorkspacePath(workspacePath: string): Promise<string> {
  const rawPath = workspacePath.trim();
  if (!rawPath) {
    throw new Error("项目路径不能为空。");
  }

  const expandedPath = expandHomePath(rawPath);
  const absolutePath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(getWorkspaceRoot(), expandedPath);
  const realWorkspacePath = await fs.realpath(absolutePath);
  const stats = await fs.stat(realWorkspacePath);
  if (!stats.isDirectory()) {
    throw new Error("项目路径必须是一个文件夹。");
  }

  return realWorkspacePath;
}

function normalizeWorkspaceRecords(
  config: ResourcesFile,
  fallbackWorkspacePaths: string | string[] = []
): WorkspaceRecord[] {
  const seen = new Set<string>();
  const records: WorkspaceRecord[] = [];
  const candidates = config.workspaces || [];
  const fallbackPaths = Array.isArray(fallbackWorkspacePaths)
    ? fallbackWorkspacePaths
    : [fallbackWorkspacePaths];

  for (const workspace of candidates) {
    if (!workspace.path?.trim()) {
      continue;
    }
    const workspacePath = workspace.path.trim();
    const id = workspace.id?.trim() || workspaceIdForPath(workspacePath);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    records.push({
      id,
      label: workspace.label?.trim() || workspaceLabelForPath(workspacePath),
      path: workspacePath,
    });
  }

  for (const fallbackWorkspacePath of fallbackPaths) {
    const workspacePath = fallbackWorkspacePath.trim();
    if (!workspacePath) {
      continue;
    }
    const fallbackId = workspaceIdForPath(workspacePath);
    if (!seen.has(fallbackId)) {
      seen.add(fallbackId);
      records.push({
        id: fallbackId,
        label: workspaceLabelForPath(workspacePath),
        path: workspacePath,
      });
    }
  }

  return records;
}

async function workspaceHistoryPath(value?: string): Promise<string | null> {
  if (!value?.trim()) {
    return null;
  }

  try {
    return await normalizeWorkspacePath(value);
  } catch {
    return value.trim();
  }
}

export async function listLocalWorkspaces(): Promise<{
  defaultWorkspaceId: string;
  workspaces: ResolvedWorkspaceRecord[];
}> {
  const config = readResourcesConfig();
  const resource = getWorkspaceResource("local");
  let currentRoot = "";
  try {
    currentRoot = (await resolveWorkspacePath("", "local")).root;
  } catch {
    currentRoot = (await workspaceHistoryPath(resource.workspace)) || "";
  }
  const records = normalizeWorkspaceRecords(
    config,
    Array.isArray(config.workspaces) ? [] : currentRoot
  );
  const resolved = await Promise.all(
    records.map(async (workspace) => {
      try {
        return {
          ...workspace,
          resolvedPath: await normalizeWorkspacePath(workspace.path),
        };
      } catch {
        return {
          ...workspace,
          resolvedPath: workspace.path,
        };
      }
    })
  );
  const configuredDefaultId =
    typeof config.default_workspace === "string"
      ? config.default_workspace.trim()
      : "";
  const defaultWorkspaceId =
    [configuredDefaultId].find((id) =>
      id ? resolved.some((workspace) => workspace.id === id) : false
    ) ||
    resolved.find((workspace) => workspace.path === resource.workspace)?.id ||
    resolved.find((workspace) => workspace.resolvedPath === currentRoot)?.id ||
    resolved[0]?.id ||
    "";

  return {
    defaultWorkspaceId,
    workspaces: resolved,
  };
}

export async function removeLocalWorkspace(
  workspaceId: string
): Promise<{
  defaultWorkspaceId: string;
  workspaces: ResolvedWorkspaceRecord[];
}> {
  const targetWorkspaceId = workspaceId.trim();
  if (!targetWorkspaceId) {
    throw new Error("项目 ID 不能为空。");
  }

  const { configPath, config } = await getWritableResourcesConfig();
  const workspaces = normalizeWorkspaceRecords(config);
  const removedWorkspace = workspaces.find(
    (workspace) => workspace.id === targetWorkspaceId
  );
  const remainingWorkspaces = workspaces.filter(
    (workspace) => workspace.id !== targetWorkspaceId
  );

  config.workspaces = remainingWorkspaces;

  if (config.default_workspace === targetWorkspaceId) {
    if (remainingWorkspaces[0]) {
      config.default_workspace = remainingWorkspaces[0].id;
    } else {
      delete config.default_workspace;
    }
  }

  const localResource = config.resources?.find(
    (resource) => resource.id === "local"
  );
  const removedPath = await workspaceHistoryPath(removedWorkspace?.path);
  const currentResourcePath = await workspaceHistoryPath(localResource?.workspace);
  const currentResourceWorkspaceId = currentResourcePath
    ? workspaceIdForPath(currentResourcePath)
    : "";

  if (
    localResource &&
    removedWorkspace &&
    (currentResourceWorkspaceId === targetWorkspaceId ||
      (removedPath && currentResourcePath === removedPath))
  ) {
    const nextWorkspace = remainingWorkspaces[0];
    if (nextWorkspace) {
      localResource.workspace = nextWorkspace.path;
    } else {
      localResource.workspace = defaultLocalWorkspacePath();
    }
  }

  await writeResourcesConfigAtPath(configPath, config);
  return await listLocalWorkspaces();
}

export async function updateLocalWorkspaceRecord(
  workspaceId: string,
  options: {
    label?: string;
    workspacePath?: string;
    refreshLabel?: boolean;
  }
): Promise<{
  defaultWorkspaceId: string;
  workspaceId: string;
  workspacePath: string;
  workspaces: ResolvedWorkspaceRecord[];
}> {
  const targetWorkspaceId = workspaceId.trim();
  if (!targetWorkspaceId) {
    throw new Error("项目 ID 不能为空。");
  }

  const { configPath, config } = await getWritableResourcesConfig();
  const workspaces = normalizeWorkspaceRecords(config);
  const existing = workspaces.find(
    (workspace) => workspace.id === targetWorkspaceId
  );
  if (!existing) {
    throw new Error("项目不存在。");
  }

  const nextWorkspacePath = options.workspacePath
    ? await normalizeWorkspacePath(options.workspacePath)
    : existing.path;
  const nextWorkspaceId = options.workspacePath
    ? workspaceIdForPath(nextWorkspacePath)
    : targetWorkspaceId;
  const nextLabel =
    options.refreshLabel || options.label === undefined
      ? workspaceLabelForPath(nextWorkspacePath)
      : options.label.trim() || workspaceLabelForPath(nextWorkspacePath);
  const nextWorkspace = {
    id: nextWorkspaceId,
    label: nextLabel,
    path: nextWorkspacePath,
  };

  let inserted = false;
  const nextWorkspaces: WorkspaceRecord[] = [];
  for (const workspace of workspaces) {
    if (workspace.id === targetWorkspaceId) {
      if (!inserted) {
        nextWorkspaces.push(nextWorkspace);
        inserted = true;
      }
      continue;
    }
    if (workspace.id === nextWorkspaceId) {
      continue;
    }
    nextWorkspaces.push(workspace);
  }
  if (!inserted) {
    nextWorkspaces.unshift(nextWorkspace);
  }

  config.workspaces = nextWorkspaces;

  if (config.default_workspace === targetWorkspaceId) {
    config.default_workspace = nextWorkspaceId;
  }

  const localResource = config.resources?.find(
    (resource) => resource.id === "local"
  );
  const currentResourcePath = await workspaceHistoryPath(localResource?.workspace);
  const existingPath = await workspaceHistoryPath(existing.path);
  const currentResourceWorkspaceId = currentResourcePath
    ? workspaceIdForPath(currentResourcePath)
    : "";

  if (
    localResource &&
    (currentResourceWorkspaceId === targetWorkspaceId ||
      (existingPath && currentResourcePath === existingPath))
  ) {
    localResource.workspace = nextWorkspacePath;
  }

  await writeResourcesConfigAtPath(configPath, config);
  const localWorkspaces = await listLocalWorkspaces();
  return {
    ...localWorkspaces,
    workspaceId: nextWorkspaceId,
    workspacePath: nextWorkspacePath,
  };
}

export async function updateLocalResourceWorkspace(
  workspacePath: string
): Promise<{
  resourcesPath: string;
  workspacePath: string;
  workspaceId: string;
}> {
  const realWorkspacePath = await normalizeWorkspacePath(workspacePath);
  const workspaceId = workspaceIdForPath(realWorkspacePath);
  const { configPath, config } = await getWritableResourcesConfig();
  const resources = config.resources || [];
  let localResource = resources.find((resource) => resource.id === "local");
  const previousWorkspacePath = await workspaceHistoryPath(
    localResource?.workspace
  );
  if (!localResource) {
    localResource = {
      id: "local",
      label: "Current Machine",
      backend: "local_shell",
      enabled: true,
    };
    resources.unshift(localResource);
  }

  localResource.backend = "local_shell";
  localResource.workspace = realWorkspacePath;
  localResource.enabled = true;
  localResource.remote_url ||= "http://127.0.0.1:22024";
  localResource.remote_assistant_id ||= "agent";

  config.resources = resources;
  config.default_resource ||= "local";
  const workspaces = normalizeWorkspaceRecords(
    config,
    previousWorkspacePath ? [previousWorkspacePath] : []
  );
  const existing = workspaces.find((workspace) => workspace.id === workspaceId);
  const selectedWorkspace = {
    id: workspaceId,
    label: existing?.label || workspaceLabelForPath(realWorkspacePath),
    path: realWorkspacePath,
  };
  config.workspaces = [
    selectedWorkspace,
    ...workspaces.filter((workspace) => workspace.id !== workspaceId),
  ];
  config.default_workspace = workspaceId;
  await writeResourcesConfigAtPath(configPath, config);

  return {
    resourcesPath: configPath,
    workspacePath: realWorkspacePath,
    workspaceId,
  };
}

function readRootEnvValue(name: string): string | undefined {
  try {
    const content = readFileSync(path.join(getWorkspaceRoot(), ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] !== name || line.trim().startsWith("#")) {
        continue;
      }
      const value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        return value.slice(1, -1);
      }
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function getWorkspaceRoot(): string {
  return path.resolve(
    process.env.INTERNAGENTS_APP_ROOT ||
      process.env.INTERNAGENTS_WORKSPACE_ROOT ||
      process.env.WORKSPACE_ROOT ||
      path.join(process.cwd(), "..")
  );
}

function enabledResources(): ResourceRecord[] {
  const resources = readResourcesConfig().resources || [];
  return resources.filter((resource) => resource.enabled !== false);
}

export function getWorkspaceResource(
  resourceId?: string | null
): ResourceRecord {
  const resources = enabledResources();
  const defaultResourceId =
    readResourcesConfig().default_resource || resources[0]?.id || "local";
  const selectedId = resourceId || defaultResourceId;
  const resource = resources.find((candidate) => candidate.id === selectedId);
  if (!resource) {
    throw new Error(`Unknown workspace resource: ${selectedId}`);
  }
  return resource;
}

export function isIgnoredEntry(name: string): boolean {
  if (DEFAULT_IGNORED_NAMES.has(name)) {
    return true;
  }

  if (name.startsWith(".env") && name !== ".env.example") {
    return true;
  }

  return false;
}

export function assertReadableFilePath(relativePath: string): void {
  const name = path.basename(relativePath);
  if (name.startsWith(".env") && name !== ".env.example") {
    throw new Error("Refusing to expose environment files.");
  }

  if (/\.(key|pem|p12|pfx)$/i.test(name)) {
    throw new Error("Refusing to expose private key material.");
  }
}

function normalizeRelativePath(relativePath = ""): string {
  const cleanPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleanPath.split("/").some((segment) => segment === "..")) {
    throw new Error("Path is outside the workspace.");
  }
  return cleanPath;
}

function isBareWorkspaceFilePath(relativePath: string): boolean {
  const cleanPath = normalizeRelativePath(relativePath);
  return Boolean(cleanPath && !cleanPath.includes("/"));
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /no such file|cannot find|not found/i.test(message);
}

function formatAmbiguousBasenameError(
  fileName: string,
  matches: string[]
): string {
  return `Multiple files named ${fileName} were found: ${matches.join(
    ", "
  )}. Use the full relative path.`;
}

export function getFileExtension(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase();
  if (basename.endsWith(".science.json")) {
    return ".science.json";
  }
  if (
    basename === ".env.example" ||
    basename === ".gitignore" ||
    EXTENSIONLESS_TEXT_FILENAMES.has(basename)
  ) {
    return basename;
  }
  return path.extname(filePath).toLowerCase();
}

export async function resolveWorkspacePath(
  relativePath = "",
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceResolvedPath> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") !== "local_shell") {
    return resolveRemoteWorkspacePath(resource, relativePath);
  }

  const root = resolveLocalWorkspaceRoot(resource, workspaceId);
  const rootReal = await fs.realpath(root);
  const cleanPath = normalizeRelativePath(relativePath);
  const target = path.resolve(rootReal, cleanPath);
  const targetReal = await fs.realpath(target);

  if (
    targetReal !== rootReal &&
    !targetReal.startsWith(`${rootReal}${path.sep}`)
  ) {
    throw new Error("Path is outside the workspace.");
  }

  return {
    root: rootReal,
    absolutePath: targetReal,
    relativePath: toWorkspacePath(rootReal, targetReal),
    resource,
  };
}

async function findLocalWorkspaceFileByBasename(
  rootReal: string,
  fileName: string
): Promise<string[]> {
  const matches: string[] = [];
  let visitedDirectories = 0;

  const walk = async (directory: string): Promise<void> => {
    visitedDirectories += 1;
    if (visitedDirectories > MAX_BASENAME_SEARCH_DIRECTORIES) {
      throw new Error(
        `Workspace is too large to resolve ${fileName} by filename. Use the full relative path.`
      );
    }

    const dirents = await fs.readdir(directory, { withFileTypes: true });
    for (const dirent of dirents) {
      if (isIgnoredEntry(dirent.name)) {
        continue;
      }

      const absolutePath = path.join(directory, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absolutePath);
        if (matches.length > MAX_BASENAME_MATCHES) {
          return;
        }
        continue;
      }

      if (dirent.isFile() && dirent.name === fileName) {
        matches.push(toWorkspacePath(rootReal, absolutePath));
        if (matches.length > MAX_BASENAME_MATCHES) {
          return;
        }
      }
    }
  };

  await walk(rootReal);
  return matches;
}

async function resolveLocalWorkspaceFilePathByBasename(
  relativePath: string,
  resource: ResourceRecord,
  workspaceId?: string | null
): Promise<WorkspaceResolvedPath | null> {
  if (!isBareWorkspaceFilePath(relativePath)) {
    return null;
  }

  const fileName = normalizeRelativePath(relativePath);
  const root = resolveLocalWorkspaceRoot(resource, workspaceId);
  const rootReal = await fs.realpath(root);
  const matches = await findLocalWorkspaceFileByBasename(rootReal, fileName);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(formatAmbiguousBasenameError(fileName, matches));
  }

  return resolveWorkspacePath(matches[0], resource.id, workspaceId);
}

async function resolveReadableWorkspaceFilePath(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceResolvedPath> {
  const resource = getWorkspaceResource(resourceId);
  try {
    return await resolveWorkspacePath(relativePath, resourceId, workspaceId);
  } catch (error) {
    if (
      (resource.backend || "local_shell") !== "local_shell" ||
      !isMissingPathError(error)
    ) {
      throw error;
    }

    const resolved = await resolveLocalWorkspaceFilePathByBasename(
      relativePath,
      resource,
      workspaceId
    );
    if (!resolved) {
      throw error;
    }
    return resolved;
  }
}

function resolveLocalWorkspaceRoot(
  resource: ResourceRecord,
  workspaceId?: string | null
): string {
  if (workspaceId) {
    const fallbackRoot = resolveConfiguredLocalWorkspaceRoot(resource);
    const records = normalizeWorkspaceRecords(
      readResourcesConfig(),
      fallbackRoot
    );
    const selected = records.find((workspace) => workspace.id === workspaceId);
    if (selected) {
      const expandedPath = expandHomePath(selected.path);
      return path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(getWorkspaceRoot(), expandedPath);
    }
  }

  return resolveConfiguredLocalWorkspaceRoot(resource);
}

function resolveConfiguredLocalWorkspaceRoot(resource: ResourceRecord): string {
  const configuredRoot = resource.workspace || ".";
  if (path.isAbsolute(configuredRoot)) {
    return configuredRoot;
  }
  return path.resolve(getWorkspaceRoot(), configuredRoot);
}

function resolveRemoteWorkspacePath(
  resource: ResourceRecord,
  relativePath = ""
): WorkspaceResolvedPath {
  const root = resource.workspace || ".";
  const cleanPath = normalizeRelativePath(relativePath);
  return {
    root,
    absolutePath: cleanPath ? `${root.replace(/\/+$/, "")}/${cleanPath}` : root,
    relativePath: cleanPath,
    resource,
  };
}

export function toWorkspacePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export function getPreviewKind(filePath: string): WorkspacePreviewKind {
  const extension = getFileExtension(filePath);

  if (extension === ".doc" || extension === ".docx") {
    return "docx";
  }

  if (extension === ".xls" || extension === ".xlsx") {
    return "xlsx";
  }

  if (extension === ".ppt" || extension === ".pptx") {
    return "pptx";
  }

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (SCIENCE_EXTENSIONS.has(extension)) {
    return "science";
  }

  if (MOLECULE_EXTENSIONS.has(extension)) {
    return "molecule";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  return "unsupported";
}

export function getPreviewContentSizeLimit(
  previewKind: WorkspacePreviewKind
): number {
  if (
    previewKind === "markdown" ||
    previewKind === "molecule" ||
    previewKind === "science" ||
    previewKind === "text"
  ) {
    return MAX_PREVIEW_FILE_SIZE;
  }

  return 0;
}

export function getMimeType(filePath: string): string {
  const extension = getFileExtension(filePath);
  return MIME_TYPES[extension] || "application/octet-stream";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function splitShellWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping || quote) {
    throw new Error("Invalid SSH command quoting.");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function sshArgsFromCommand(sshCommand: string): string[] {
  const words = splitShellWords(sshCommand);
  if (words[0] !== "ssh" || words.length < 2) {
    throw new Error("Remote workspace SSH command must start with ssh.");
  }
  return [
    words[0],
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    ...words.slice(1),
  ];
}

async function runRemoteWorkspacePython<T>(
  resource: ResourceRecord,
  operation: string,
  relativePath = "",
  extra: Record<string, unknown> = {}
): Promise<T> {
  if (!resource.ssh_command) {
    throw new Error(`Resource ${resource.id} does not define ssh_command.`);
  }

  const payload = JSON.stringify({
    op: operation,
    root: resource.workspace || ".",
    path: normalizeRelativePath(relativePath),
    maxPreviewContentSize: MAX_PREVIEW_FILE_SIZE,
    maxRawFileSize: MAX_RAW_FILE_SIZE,
    ignoredNames: Array.from(DEFAULT_IGNORED_NAMES),
    ...extra,
  });
  const [sshBinary, ...sshArgs] = sshArgsFromCommand(resource.ssh_command);
  const remoteCommand = `python3 -c ${shellQuote(
    REMOTE_WORKSPACE_SCRIPT
  )} ${shellQuote(payload)}`;

  const { stdout } = await execFileAsync(
    sshBinary,
    [...sshArgs, remoteCommand],
    {
      timeout: resource.timeout
        ? resource.timeout * 1000
        : REMOTE_WORKSPACE_TIMEOUT_MS,
      maxBuffer: Math.max(
        resource.max_output_bytes || 0,
        REMOTE_WORKSPACE_MAX_BUFFER
      ),
      windowsHide: true,
    }
  );

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Remote workspace command returned no data.");
  }

  const result = JSON.parse(trimmed) as {
    ok: boolean;
    error?: string;
    data?: T;
  };
  if (!result.ok) {
    throw new Error(result.error || "Remote workspace command failed.");
  }
  return result.data as T;
}

function runRemoteWorkspacePythonWithInput<T>(
  resource: ResourceRecord,
  operation: string,
  relativePath = "",
  input: unknown,
  extra: Record<string, unknown> = {}
): Promise<T> {
  if (!resource.ssh_command) {
    throw new Error(`Resource ${resource.id} does not define ssh_command.`);
  }

  const payload = JSON.stringify({
    op: operation,
    root: resource.workspace || ".",
    path: normalizeRelativePath(relativePath),
    maxPreviewContentSize: MAX_PREVIEW_FILE_SIZE,
    maxRawFileSize: MAX_RAW_FILE_SIZE,
    ignoredNames: Array.from(DEFAULT_IGNORED_NAMES),
    ...extra,
  });
  const [sshBinary, ...sshArgs] = sshArgsFromCommand(resource.ssh_command);
  const remoteCommand = `python3 -c ${shellQuote(
    REMOTE_WORKSPACE_SCRIPT
  )} ${shellQuote(payload)}`;

  return new Promise((resolve, reject) => {
    const child = spawn(sshBinary, [...sshArgs, remoteCommand], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const maxBuffer = Math.max(
      resource.max_output_bytes || 0,
      REMOTE_WORKSPACE_MAX_BUFFER
    );
    const timeout = setTimeout(
      () => {
        if (settled) return;
        child.kill("SIGTERM");
        settled = true;
        reject(new Error("Remote workspace command timed out."));
      },
      resource.timeout ? resource.timeout * 1000 : REMOTE_WORKSPACE_TIMEOUT_MS
    );

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxBuffer && !settled) {
        child.kill("SIGTERM");
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Remote workspace command returned too much data."));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const stdout = Buffer.concat(chunks).toString("utf8").trim();
      const stderr = Buffer.concat(errorChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(stderr || `Remote workspace command exited ${code}.`));
        return;
      }
      if (!stdout) {
        reject(new Error("Remote workspace command returned no data."));
        return;
      }
      try {
        const result = JSON.parse(stdout) as {
          ok: boolean;
          error?: string;
          data?: T;
        };
        if (!result.ok) {
          reject(new Error(result.error || "Remote workspace command failed."));
          return;
        }
        resolve(result.data as T);
      } catch (error) {
        reject(
          new Error(
            `Invalid remote workspace JSON response: ${
              error instanceof Error ? error.message : String(error)
            }: ${stdout.slice(0, 1000)}`
          )
        );
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}

const REMOTE_WORKSPACE_SCRIPT = String.raw`
import base64
import json
import os
import pathlib
import sys

DEFAULT_IGNORED = set(json.loads(sys.argv[1]).get("ignoredNames", []))


def is_ignored(name):
    if name in DEFAULT_IGNORED:
        return True
    return name.startswith(".env") and name != ".env.example"


def safe_resolve(root_value, rel_value):
    root = pathlib.Path(root_value).expanduser().resolve()
    rel = str(rel_value or "").replace("\\", "/").lstrip("/")
    if any(part == ".." for part in rel.split("/")):
        raise ValueError("Path is outside the workspace.")
    target = (root / rel).resolve()
    if target != root:
        target.relative_to(root)
    return root, target, rel


def preview_name(name):
    lower = name.lower()
    if lower in {
        ".env.example",
        ".gitignore",
        "caddyfile",
        "dockerfile",
        "gemfile",
        "makefile",
        "procfile",
        "rakefile",
    }:
        return lower
    return pathlib.PurePosixPath(name).suffix.lower()


def entry_payload(root, child):
    stat = child.stat()
    rel = child.relative_to(root).as_posix()
    is_dir = child.is_dir()
    ext = preview_name(child.name)
    return {
        "name": child.name,
        "path": rel,
        "kind": "directory" if is_dir else "file",
        "extension": ext or None,
        "size": None if is_dir else stat.st_size,
        "modifiedAt": __import__("datetime").datetime.fromtimestamp(stat.st_mtime, __import__("datetime").timezone.utc).isoformat(),
        "hasChildren": is_dir,
    }


def list_dir(root, target):
    if not target.is_dir():
        raise ValueError("Selected workspace path is not a directory.")
    entries = []
    for child in target.iterdir():
        if is_ignored(child.name):
            continue
        try:
            entries.append(entry_payload(root, child))
        except OSError:
            continue
    entries.sort(key=lambda item: (0 if item["kind"] == "directory" else 1, item["name"].lower()))
    return entries


def matches_query(query, item):
    normalized = (query or "").strip().lower()
    if not normalized:
        return True
    return normalized in item["name"].lower() or normalized in item["path"].lower()


def search_files(root, target, query, max_results, max_directories):
    if target.is_file():
        item = entry_payload(root, target)
        return [item] if matches_query(query, item) else []
    if not target.is_dir():
        raise ValueError("Selected workspace path is not a directory.")

    entries = []
    visited_directories = 0

    def walk(directory):
        nonlocal visited_directories
        if len(entries) >= max_results:
            return
        visited_directories += 1
        if visited_directories > max_directories:
            raise ValueError("Workspace is too large to search files.")
        try:
            children = list(directory.iterdir())
        except OSError:
            return
        children.sort(key=lambda child: (0 if child.is_file() else 1, child.name.lower()))
        for child in children:
            if len(entries) >= max_results:
                return
            if is_ignored(child.name) or child.is_symlink():
                continue
            try:
                if child.is_file():
                    item = entry_payload(root, child)
                    if matches_query(query, item):
                        entries.append(item)
                elif child.is_dir():
                    walk(child)
            except OSError:
                continue

    walk(target)
    entries.sort(key=lambda item: item["path"].lower())
    return entries[:max_results]


def file_data(root, target, rel, max_preview_content, max_raw, raw):
    if not target.is_file():
        raise ValueError("Selected workspace path is not a file.")
    stat = target.stat()
    payload = {
        "path": rel,
        "name": target.name,
        "size": stat.st_size,
        "modifiedAt": __import__("datetime").datetime.fromtimestamp(stat.st_mtime, __import__("datetime").timezone.utc).isoformat(),
        "isFile": True,
    }
    if raw:
        if stat.st_size > max_raw:
            raise ValueError("File is too large to stream from remote workspace.")
        payload["dataBase64"] = base64.b64encode(target.read_bytes()).decode("ascii")
        return payload
    if max_preview_content > 0:
        if stat.st_size <= max_preview_content:
            payload["content"] = target.read_text(encoding="utf-8", errors="replace")
        else:
            payload["tooLarge"] = True
    return payload


def write_raw_file(root, target, rel, max_raw):
    request_stdin = sys.stdin.read()
    payload = json.loads(request_stdin or "{}")
    raw = base64.b64decode(payload.get("dataBase64") or "")
    if len(raw) > max_raw:
        raise ValueError("File is too large to upload to remote workspace.")
    if target.exists() and target.is_dir():
        raise ValueError("Selected workspace path is a directory.")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    stat = target.stat()
    return {
        "path": rel,
        "name": target.name,
        "size": stat.st_size,
        "modifiedAt": __import__("datetime").datetime.fromtimestamp(stat.st_mtime, __import__("datetime").timezone.utc).isoformat(),
        "isFile": True,
    }


def main():
    request = json.loads(sys.argv[1])
    root, target, rel = safe_resolve(request.get("root") or ".", request.get("path") or "")
    op = request.get("op")
    if op == "list":
        return {"path": rel, "entries": list_dir(root, target)}
    if op == "searchFiles":
        return {
            "query": request.get("query") or "",
            "entries": search_files(
                root,
                target,
                request.get("query") or "",
                int(request.get("maxResults") or 80),
                int(request.get("maxDirectories") or 10000),
            ),
        }
    max_preview_content = int(request.get("previewContentSizeLimit") or request.get("maxPreviewContentSize") or 0)
    if op == "file":
        return file_data(root, target, rel, max_preview_content, int(request.get("maxRawFileSize") or 0), False)
    if op == "raw":
        return file_data(root, target, rel, max_preview_content, int(request.get("maxRawFileSize") or 0), True)
    if op == "writeRaw":
        return write_raw_file(root, target, rel, int(request.get("maxRawFileSize") or 0))
    raise ValueError("Unknown workspace operation.")

try:
    print(json.dumps({"ok": True, "data": main()}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
`;

function withPreviewKind(entry: WorkspaceEntry): WorkspaceEntry {
  return {
    ...entry,
    previewKind:
      entry.kind === "directory" ? undefined : getPreviewKind(entry.path),
  };
}

function clampWorkspaceSearchLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_WORKSPACE_FILE_SEARCH_LIMIT;
  }

  return Math.max(
    1,
    Math.min(Math.floor(limit || 0), MAX_WORKSPACE_FILE_SEARCH_LIMIT)
  );
}

function workspaceFileMatchesQuery(
  query: string,
  entry: WorkspaceEntry
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [entry.name, entry.path].some((value) =>
    value.toLowerCase().includes(normalizedQuery)
  );
}

function compareWorkspaceFileSearchEntries(
  left: WorkspaceEntry,
  right: WorkspaceEntry
): number {
  return left.path.localeCompare(right.path, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function searchLocalWorkspaceFiles(
  relativePath: string,
  query: string,
  maxResults: number,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceEntry[]> {
  const resolved = await resolveWorkspacePath(
    relativePath,
    resourceId,
    workspaceId
  );
  const rootStats = await fs.stat(resolved.absolutePath);
  const entries: WorkspaceEntry[] = [];
  let visitedDirectories = 0;

  const appendFile = async (absolutePath: string) => {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      return;
    }

    const relativeEntryPath = toWorkspacePath(resolved.root, absolutePath);
    const entry: WorkspaceEntry = {
      name: path.basename(absolutePath),
      path: relativeEntryPath,
      kind: "file",
      extension: getFileExtension(absolutePath) || undefined,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      hasChildren: false,
      previewKind: getPreviewKind(relativeEntryPath),
    };

    if (workspaceFileMatchesQuery(query, entry)) {
      entries.push(entry);
    }
  };

  const walk = async (directory: string): Promise<void> => {
    if (entries.length >= maxResults) {
      return;
    }

    visitedDirectories += 1;
    if (visitedDirectories > MAX_WORKSPACE_FILE_SEARCH_DIRECTORIES) {
      throw new Error("Workspace is too large to search files.");
    }

    let dirents;
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const sortedDirents = dirents
      .filter((dirent) => !isIgnoredEntry(dirent.name))
      .sort((left, right) => {
        if (left.isFile() !== right.isFile()) {
          return left.isFile() ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

    for (const dirent of sortedDirents) {
      if (entries.length >= maxResults) {
        return;
      }

      const absolutePath = path.join(directory, dirent.name);
      if (dirent.isFile()) {
        try {
          await appendFile(absolutePath);
        } catch {
          continue;
        }
        continue;
      }

      if (dirent.isDirectory()) {
        await walk(absolutePath);
      }
    }
  };

  if (rootStats.isFile()) {
    await appendFile(resolved.absolutePath);
  } else if (rootStats.isDirectory()) {
    await walk(resolved.absolutePath);
  } else {
    throw new Error("Selected workspace path is not searchable.");
  }

  return entries.sort(compareWorkspaceFileSearchEntries).slice(0, maxResults);
}

export async function searchWorkspaceFiles(
  query = "",
  resourceId?: string | null,
  workspaceId?: string | null,
  options: {
    relativePath?: string;
    maxResults?: number;
  } = {}
): Promise<WorkspaceEntry[]> {
  const resource = getWorkspaceResource(resourceId);
  const relativePath = options.relativePath || "";
  const maxResults = clampWorkspaceSearchLimit(options.maxResults);

  if ((resource.backend || "local_shell") === "ssh_shell") {
    const payload = await runRemoteWorkspacePython<{
      query: string;
      entries: WorkspaceEntry[];
    }>(resource, "searchFiles", relativePath, {
      query,
      maxResults,
      maxDirectories: MAX_WORKSPACE_FILE_SEARCH_DIRECTORIES,
    });
    return payload.entries
      .filter((entry) => entry.kind === "file")
      .map(withPreviewKind)
      .sort(compareWorkspaceFileSearchEntries)
      .slice(0, maxResults);
  }

  return searchLocalWorkspaceFiles(
    relativePath,
    query,
    maxResults,
    resourceId,
    workspaceId
  );
}

export async function listWorkspaceEntries(
  relativePath = "",
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceEntry[]> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    const payload = await runRemoteWorkspacePython<{
      path: string;
      entries: WorkspaceEntry[];
    }>(resource, "list", relativePath);
    return payload.entries.map(withPreviewKind);
  }

  const resolved = await resolveWorkspacePath(
    relativePath,
    resourceId,
    workspaceId
  );
  return listLocalWorkspaceEntriesFromResolvedPath(resolved, resourceId, workspaceId);
}

export async function listLocalWorkspaceEntriesFromResolvedPath(
  resolved: WorkspaceResolvedPath,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceEntry[]> {
  const { root, absolutePath, relativePath } = resolved;
  const directoryStats = await fs.stat(absolutePath);
  if (!directoryStats.isDirectory()) {
    throw new Error("Selected workspace path is not a directory.");
  }

  const cacheKey = [
    resourceId || "default",
    workspaceId || "default",
    relativePath,
    absolutePath,
  ].join("\u0000");
  const now = Date.now();
  const cached = workspaceDirectoryListCache.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > now &&
    cached.modifiedAtMs === directoryStats.mtimeMs
  ) {
    return cached.entries;
  }

  const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => !isIgnoredEntry(dirent.name))
      .map(async (dirent) => {
        const entryAbsolutePath = path.join(absolutePath, dirent.name);
        const relativeEntryPath = toWorkspacePath(root, entryAbsolutePath);
        const extension = getFileExtension(dirent.name);
        if (dirent.isDirectory()) {
          return {
            name: dirent.name,
            path: relativeEntryPath,
            kind: "directory",
            extension: extension || undefined,
            hasChildren: true,
          } satisfies WorkspaceEntry;
        }

        const stats = await fs.stat(entryAbsolutePath);

        return {
          name: dirent.name,
          path: relativeEntryPath,
          kind: "file",
          extension: extension || undefined,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          hasChildren: false,
          previewKind: getPreviewKind(relativeEntryPath),
        } satisfies WorkspaceEntry;
      })
  );

  const sortedEntries = entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  workspaceDirectoryListCache.set(cacheKey, {
    entries: sortedEntries,
    expiresAt: now + WORKSPACE_DIRECTORY_LIST_CACHE_TTL_MS,
    modifiedAtMs: directoryStats.mtimeMs,
  });
  return sortedEntries;
}

export async function readWorkspaceFileData(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  const previewKind = getPreviewKind(relativePath);
  const previewContentSizeLimit = getPreviewContentSizeLimit(previewKind);
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    return runRemoteWorkspacePython<WorkspaceFileData>(
      resource,
      "file",
      relativePath,
      { previewContentSizeLimit }
    );
  }

  const resolved = await resolveReadableWorkspaceFilePath(
    relativePath,
    resourceId,
    workspaceId
  );
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new Error("Selected workspace path is not a file.");
  }

  const payload: WorkspaceFileData = {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
  };
  if (previewContentSizeLimit > 0) {
    if (stats.size <= previewContentSizeLimit) {
      payload.content = await fs.readFile(resolved.absolutePath, "utf8");
    } else {
      payload.tooLarge = true;
    }
  }
  return payload;
}

function parseWorkspaceRange(
  rangeHeader: string | null,
  size: number
): WorkspaceByteRange | undefined {
  if (!rangeHeader) {
    return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || size <= 0) {
    throw new WorkspaceRangeNotSatisfiableError(size);
  }

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) {
    throw new WorkspaceRangeNotSatisfiableError(size);
  }

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new WorkspaceRangeNotSatisfiableError(size);
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      throw new WorkspaceRangeNotSatisfiableError(size);
    }
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

export async function streamLocalWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null,
  rangeHeader?: string | null
): Promise<WorkspaceRawFileStreamData> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") !== "local_shell") {
    throw new Error(
      "Raw file streaming is only available for local workspace files."
    );
  }

  const resolved = await resolveReadableWorkspaceFilePath(
    relativePath,
    resourceId,
    workspaceId
  );
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new Error("Selected workspace path is not a file.");
  }

  const range = parseWorkspaceRange(rangeHeader || null, stats.size);
  const stream = Readable.toWeb(
    createReadStream(
      resolved.absolutePath,
      range ? { start: range.start, end: range.end } : undefined
    )
  ) as ReadableStream<Uint8Array>;

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
    stream,
    contentLength: range ? range.end - range.start + 1 : stats.size,
    range,
  };
}

export async function readWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData & { data: Buffer }> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    const payload = await runRemoteWorkspacePython<WorkspaceFileData>(
      resource,
      "raw",
      relativePath
    );
    if (!payload.dataBase64) {
      throw new Error("Remote workspace did not return file data.");
    }
    return {
      ...payload,
      data: Buffer.from(payload.dataBase64, "base64"),
    };
  }

  const resolved = await resolveReadableWorkspaceFilePath(
    relativePath,
    resourceId,
    workspaceId
  );
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new Error("Selected workspace path is not a file.");
  }
  if (stats.size > MAX_RAW_FILE_SIZE) {
    throw new Error("File is too large to stream from workspace.");
  }
  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
    data: await fs.readFile(resolved.absolutePath),
  };
}

async function resolveWorkspaceWritePath(
  relativePath: string,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceResolvedPath> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") !== "local_shell") {
    return resolveRemoteWorkspacePath(resource, relativePath);
  }

  const root = resolveLocalWorkspaceRoot(resource, workspaceId);
  const rootReal = await fs.realpath(root);
  const cleanPath = normalizeRelativePath(relativePath);
  const target = path.resolve(rootReal, cleanPath);

  if (target !== rootReal && !target.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Path is outside the workspace.");
  }

  return {
    root: rootReal,
    absolutePath: target,
    relativePath: toWorkspacePath(rootReal, target),
    resource,
  };
}

export async function writeWorkspaceRawFile(
  relativePath: string,
  data: Buffer,
  resourceId?: string | null,
  workspaceId?: string | null
): Promise<WorkspaceFileData> {
  if (data.length > MAX_RAW_FILE_SIZE) {
    throw new Error("File is too large to upload to workspace.");
  }

  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    return runRemoteWorkspacePythonWithInput<WorkspaceFileData>(
      resource,
      "writeRaw",
      relativePath,
      { dataBase64: data.toString("base64") }
    );
  }

  const resolved = await resolveWorkspaceWritePath(
    relativePath,
    resourceId,
    workspaceId
  );
  await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
  await fs.writeFile(resolved.absolutePath, data);
  const stats = await fs.stat(resolved.absolutePath);

  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
  };
}
