import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { loadProjectEnv } from "./env.js";

const rootFromModule = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = process.env.PROJECT_ROOT ? path.resolve(process.env.PROJECT_ROOT) : rootFromModule;

loadProjectEnv(projectRoot);
const storageRoot = process.env.ADAPTER_STORAGE_ROOT ? path.resolve(process.env.ADAPTER_STORAGE_ROOT) : path.join(path.dirname(projectRoot), ".openclaudescience-adapter");
validateAdapterStorageRoot(projectRoot, storageRoot);
const host = process.env.ADAPTER_HOST ?? "127.0.0.1";
const port = readNumber("ADAPTER_PORT", 5178);

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export const adapterConfig = {
  host,
  port,
  corsOrigins: readCorsOrigins(process.env.ADAPTER_CORS_ORIGINS, host, port),
  runtimeMode: readRuntimeMode(process.env.ADAPTER_RUNTIME_MODE),
  projectRoot,
  storageRoot,
  opencode: {
    host: process.env.OPENCODE_HOST ?? "127.0.0.1",
    port: readNumber("OPENCODE_PORT", 4096),
    command: process.env.OPENCODE_COMMAND ?? "opencode.cmd",
    sdkVersion: "1.17.12",
  },
} as const;

export function opencodeBaseUrl(): string {
  return `http://${adapterConfig.opencode.host}:${adapterConfig.opencode.port}`;
}

function readRuntimeMode(value: string | undefined): "external" | "managed" {
  if (!value) return "external";
  if (value === "external" || value === "managed") return value;
  throw new Error("ADAPTER_RUNTIME_MODE must be external or managed");
}

function readCorsOrigins(value: string | undefined, adapterHost: string, adapterPort: number): readonly string[] {
  const defaults = [`http://${adapterHost}:${adapterPort}`, "http://127.0.0.1:5173", "http://localhost:5173"];
  if (!value) return defaults;
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function validateAdapterStorageRoot(projectRootInput: string, storageRootInput: string): void {
  const resolvedProjectRoot = path.resolve(projectRootInput);
  const resolvedStorageRoot = path.resolve(storageRootInput);
  if (isInsideOrSamePath(resolvedProjectRoot, resolvedStorageRoot)) {
    throw new Error("ADAPTER_STORAGE_ROOT must be outside PROJECT_ROOT");
  }

  const realProjectRoot = realpathOrResolved(resolvedProjectRoot);
  const realStorageRoot = realpathExistingPrefix(resolvedStorageRoot);
  if (isInsideOrSamePath(realProjectRoot, realStorageRoot)) {
    throw new Error("ADAPTER_STORAGE_ROOT must be outside PROJECT_ROOT");
  }
}

function realpathOrResolved(inputPath: string): string {
  try {
    return fs.realpathSync.native(inputPath);
  } catch {
    return path.resolve(inputPath);
  }
}

function realpathExistingPrefix(inputPath: string): string {
  const missingSegments: string[] = [];
  let current = path.resolve(inputPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(inputPath);
    missingSegments.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...missingSegments);
}

function isInsideOrSamePath(parentInput: string, childInput: string): boolean {
  const parentPath = path.resolve(parentInput);
  const childPath = path.resolve(childInput);
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
