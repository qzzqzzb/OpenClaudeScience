import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { NextRequest } from "next/server";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";

const STATE_DIR = path.join(getWorkspaceRoot(), ".internagents", "compute");
const TOKEN_FILE = path.join(STATE_DIR, "api-token");
const TOKEN_HEADER = "x-internagents-compute-token";

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function getComputeApiToken(): string {
  ensureStateDir();
  if (existsSync(TOKEN_FILE)) {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    if (token) return token;
  }
  const token = randomBytes(32).toString("base64url");
  try {
    writeFileSync(TOKEN_FILE, `${token}\n`, { flag: "wx" });
    return token;
  } catch {
    const existing = readFileSync(TOKEN_FILE, "utf8").trim();
    if (existing) return existing;
    throw new Error("Could not initialize compute API token.");
  }
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function isSameLocalOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return (
      isLocalHost(parsed.hostname) &&
      parsed.host === host &&
      (parsed.protocol === "http:" || parsed.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function hasValidToken(request: NextRequest): boolean {
  const supplied = request.headers.get(TOKEN_HEADER);
  return Boolean(supplied && supplied === getComputeApiToken());
}

export function assertComputeRequestAllowed(request: NextRequest): void {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Compute API POST requests must use application/json.");
  }
  if (hasValidToken(request) || isSameLocalOrigin(request)) {
    return;
  }
  throw new Error("Compute API POST request is not authorized.");
}
