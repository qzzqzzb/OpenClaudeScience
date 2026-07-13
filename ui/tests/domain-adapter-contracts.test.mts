import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { ComputeAdapter } from "../src/server/domains/compute/compute.types.ts";
import type { RemoteAdapter } from "../src/server/domains/remote/remote.types.ts";
import type { RuntimeAdapter } from "../src/server/domains/runtime/runtime.types.ts";
import type {
  WorkspaceDirectoryAdapter,
  WorkspaceFileAdapter,
} from "../src/server/domains/workspace/workspace.types.ts";
import { workspaceRootAdapter } from "../src/server/shared/adapters/workspaceRoot.adapter.ts";

test("domain adapter contracts accept structured object based implementations", async () => {
  const workspaceDirectory = {
    listEntries: async ({ path = "" }) => ({ path, entries: [] }),
    searchFiles: async () => [],
  } satisfies WorkspaceDirectoryAdapter;
  const workspaceFile = {
    readFile: async ({ path }) => ({
      path,
      name: path,
      size: 0,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      isFile: true,
    }),
    readRawFile: async ({ path }) => ({
      path,
      name: path,
      size: 0,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      isFile: true,
      data: Buffer.from(""),
    }),
    streamLocalRawFile: async ({ path }) => ({
      path,
      name: path,
      size: 0,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      isFile: true,
      stream: new ReadableStream<Uint8Array>(),
      contentLength: 0,
    }),
    writeRawFile: async ({ path }) => ({
      path,
      name: path,
      size: 0,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      isFile: true,
    }),
  } satisfies WorkspaceFileAdapter;
  const runtime = {
    isReady: async () => ({ ready: true }),
    getStatus: async () => ({
      status: "idle" as const,
      message: "ok",
      url: "http://127.0.0.1:2024",
      busyThreads: 0,
      interruptedThreads: 0,
    }),
    restart: async () => ({
      status: "restarted" as const,
      message: "ok",
      url: "http://127.0.0.1:2024",
      logPath: ".internagents/logs/backend.log",
    }),
    getDesktopConfig: async () => ({
      desktopMode: true,
      deploymentUrl: "http://127.0.0.1:2024",
      assistantId: "agent_local",
      langsmithApiKey: "",
      defaultResourceId: "local",
      resources: [],
    }),
  } satisfies RuntimeAdapter;
  const remote = {
    listSshHosts: async () => [],
    testConnection: async () => ({ ok: true, stdout: "", stderr: "" }),
    ensureBackend: async () => ({
      resource: { id: "local", label: "Local", assistantId: "agent_local" },
      resources: [],
      remoteUrl: "http://127.0.0.1:22024",
      state: "up-to-date" as const,
      targetReleaseTag: "test",
      log: [],
    }),
    setupBackend: async () => ({
      resource: { id: "local", label: "Local", assistantId: "agent_local" },
      resources: [],
      remoteUrl: "http://127.0.0.1:22024",
      log: [],
    }),
    pushBackendCli: async () => ({
      resource: { id: "local", label: "Local", assistantId: "agent_local" },
      resources: [],
      remoteUrl: "http://127.0.0.1:22024",
      backendCliFingerprint: "fingerprint",
      log: [],
    }),
  } satisfies RemoteAdapter;
  const compute = {
    listHosts: async () => [],
    upsertHost: async () => ({
      id: "host-a",
      label: "Host A",
      sshCommand: "ssh host-a",
      scratchRoot: "~/.internagents/remote-jobs",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    listJobs: async () => [],
    submitJob: async () => ({
      id: "job-a",
      hostId: "host-a",
      command: "echo ok",
      remoteJobDir: "/tmp/job-a",
      status: "queued" as const,
      submittedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      timeoutSeconds: 60,
      outputGlobs: [],
      maxOutputFileBytes: 1024,
    }),
    getJob: async () => ({
      id: "job-a",
      hostId: "host-a",
      command: "echo ok",
      remoteJobDir: "/tmp/job-a",
      status: "succeeded" as const,
      submittedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      timeoutSeconds: 60,
      outputGlobs: [],
      maxOutputFileBytes: 1024,
      exitCode: 0,
    }),
  } satisfies ComputeAdapter;

  assert.deepEqual(await workspaceDirectory.listEntries({ path: "src" }), {
    path: "src",
    entries: [],
  });
  assert.equal((await workspaceFile.readFile({ path: "README.md" })).isFile, true);
  assert.equal((await runtime.isReady()).ready, true);
  assert.equal((await remote.testConnection({})).ok, true);
  assert.equal((await compute.getJob({ jobId: "job-a" })).status, "succeeded");
});

test("workspace root adapter resolves app root without importing workspace route _lib", () => {
  const previous = process.env.INTERNAGENTS_APP_ROOT;
  process.env.INTERNAGENTS_APP_ROOT = "C:/tmp/internagents-contract-root";
  try {
    assert.match(
      workspaceRootAdapter.getWorkspaceRoot().replace(/\\/g, "/"),
      /C:\/tmp\/internagents-contract-root$/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.INTERNAGENTS_APP_ROOT;
    } else {
      process.env.INTERNAGENTS_APP_ROOT = previous;
    }
  }
});

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath);
    }
    return /\.(?:ts|tsx|mts)$/.test(entry.name) ? [entryPath] : [];
  });
}

test("production code has no dependency on API route _lib modules", () => {
  const sourceRoot = path.resolve(process.cwd(), "src");
  const violations = listTypeScriptFiles(sourceRoot)
    .filter((filePath) => /[/\\]_lib[/\\].*\.ts$/.test(filePath))
    .concat(
      listTypeScriptFiles(sourceRoot).filter((filePath) =>
        /(?:app\/api|app\\api).*[/\\]_lib[/\\]/.test(
          readFileSync(filePath, "utf8")
        )
      )
    );

  assert.deepEqual(violations, []);
});
