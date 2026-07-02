import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateAdapterStorageRoot } from "./config.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })));
});

describe("adapter config", () => {
  it("rejects adapter storage roots inside the project root", () => {
    const projectRoot = makeTempRoot();

    expect(() => validateAdapterStorageRoot(projectRoot, projectRoot)).toThrow(/outside PROJECT_ROOT/);
    expect(() => validateAdapterStorageRoot(projectRoot, path.join(projectRoot, ".adapter-artifacts"))).toThrow(/outside PROJECT_ROOT/);
  });

  it("accepts adapter storage roots outside the project root", () => {
    const parent = makeTempRoot();
    const projectRoot = path.join(parent, "project");
    const storageRoot = path.join(parent, "adapter-storage");
    fs.mkdirSync(projectRoot);

    expect(() => validateAdapterStorageRoot(projectRoot, storageRoot)).not.toThrow();
  });

  it("rejects adapter storage roots that resolve through a symlink into the project root", async () => {
    const parent = makeTempRoot();
    const projectRoot = path.join(parent, "project");
    const target = path.join(projectRoot, "adapter-storage-target");
    const link = path.join(parent, "storage-link");
    fs.mkdirSync(target, { recursive: true });
    try {
      await fs.promises.symlink(target, link, "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    expect(() => validateAdapterStorageRoot(projectRoot, link)).toThrow(/outside PROJECT_ROOT/);
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-config-"));
  tempRoots.push(root);
  return root;
}
