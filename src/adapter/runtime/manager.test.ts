import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeRuntimeManager } from "./manager.js";
import type { RuntimeHealth } from "./opencode.js";

const servers: net.Server[] = [];

describe("OpenCodeRuntimeManager", () => {
  afterEach(async () => {
    await Promise.all(servers.map(closeServer));
    servers.length = 0;
  });

  it("does nothing in external mode", async () => {
    const manager = new OpenCodeRuntimeManager({
      mode: "external",
      command: "opencode.cmd",
      host: "127.0.0.1",
      port: 1,
      corsOrigin: "http://127.0.0.1:5178",
      projectRoot: process.cwd(),
      runtime: fakeRuntime({ connected: false, baseUrl: "http://127.0.0.1:1", error: "offline" }),
      logger: fakeLogger(),
    });

    await manager.start();

    expect(manager.getState().managedProcess).toEqual({
      status: "idle",
      running: false,
    });
  });

  it("attaches to an already-open port only when OpenCode health is connected", async () => {
    const server = await listenOnRandomPort();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    const manager = new OpenCodeRuntimeManager({
      mode: "managed",
      command: "opencode.cmd",
      host: "127.0.0.1",
      port: address.port,
      corsOrigin: "http://127.0.0.1:5178",
      projectRoot: process.cwd(),
      runtime: fakeRuntime({ connected: true, baseUrl: `http://127.0.0.1:${address.port}`, version: "1.17.12" }),
      logger: fakeLogger(),
    });

    await manager.start();

    expect(manager.getState().managedProcess).toMatchObject({
      status: "attached",
      running: true,
      owned: false,
    });
  });

  it("fails explicitly when managed mode finds a non-OpenCode process on the port", async () => {
    const server = await listenOnRandomPort();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    const manager = new OpenCodeRuntimeManager({
      mode: "managed",
      command: "opencode.cmd",
      host: "127.0.0.1",
      port: address.port,
      corsOrigin: "http://127.0.0.1:5178",
      projectRoot: process.cwd(),
      runtime: fakeRuntime({
        connected: false,
        baseUrl: `http://127.0.0.1:${address.port}`,
        error: "health endpoint not found",
      }),
      logger: fakeLogger(),
    });

    await expect(manager.start()).rejects.toThrow(/occupied but OpenCode health check failed/);
    expect(manager.getState().managedProcess).toMatchObject({
      status: "failed",
      running: false,
      owned: false,
    });
  });

  it("records command resolution failures in manager state", async () => {
    const manager = new OpenCodeRuntimeManager({
      mode: "managed",
      command: "definitely-not-opencode.cmd",
      host: "127.0.0.1",
      port: 1,
      corsOrigin: "http://127.0.0.1:5178",
      projectRoot: process.cwd(),
      runtime: fakeRuntime({ connected: false, baseUrl: "http://127.0.0.1:1", error: "offline" }),
      logger: fakeLogger(),
    });

    await expect(manager.start()).rejects.toThrow(/Cannot resolve definitely-not-opencode\.cmd/);
    expect(manager.getState().managedProcess).toMatchObject({
      status: "failed",
      running: false,
      owned: false,
    });
  });
});

function fakeRuntime(health: RuntimeHealth) {
  return {
    health: async () => health,
  };
}

function fakeLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => fakeLogger(),
    level: "silent",
    silent: () => undefined,
  };
}

async function listenOnRandomPort(): Promise<net.Server> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  servers.push(server);
  return server;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
