import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenCodeRuntime } from "./opencode.js";

describe("OpenCodeRuntime.health", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a healthy response with the expected version", async () => {
    mockFetch({ healthy: true, version: "1.17.12" });
    const runtime = new OpenCodeRuntime({
      baseUrl: "http://127.0.0.1:4096",
      projectRoot: process.cwd(),
      sdkVersion: "1.17.12",
    });

    await expect(runtime.health()).resolves.toMatchObject({
      connected: true,
      version: "1.17.12",
    });
  });

  it("rejects healthy responses without a version", async () => {
    mockFetch({ healthy: true });
    const runtime = new OpenCodeRuntime({
      baseUrl: "http://127.0.0.1:4096",
      projectRoot: process.cwd(),
      sdkVersion: "1.17.12",
    });

    await expect(runtime.health()).resolves.toMatchObject({
      connected: false,
      errorCode: "INVALID_RUNTIME_HEALTH",
    });
  });

  it("rejects unexpected OpenCode versions", async () => {
    mockFetch({ healthy: true, version: "9.9.9" });
    const runtime = new OpenCodeRuntime({
      baseUrl: "http://127.0.0.1:4096",
      projectRoot: process.cwd(),
      sdkVersion: "1.17.12",
    });

    await expect(runtime.health()).resolves.toMatchObject({
      connected: false,
      version: "9.9.9",
      errorCode: "VERSION_MISMATCH",
    });
  });
});

function mockFetch(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => body,
    })),
  );
}
