import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSshCommand,
  assertSshConfigHost,
  readSshConfigFile,
  resolveSshConfigPath,
  sshArgsFromCommand,
} from "../src/server/shared/adapters/sshCli.helpers.ts";

test("assertSshCommand accepts SSH connection commands with options", () => {
  const command = 'ssh -i "/tmp/key file" -p 2222 user@example.com';

  assert.equal(assertSshCommand(command), command);
  assert.deepEqual(sshArgsFromCommand(command, ["-o", "BatchMode=yes"]), [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-i",
    "/tmp/key file",
    "-p",
    "2222",
    "user@example.com",
  ]);
});

test("assertSshCommand rejects remote commands and shell operators", () => {
  assert.throws(() => assertSshCommand("scp file host:/tmp"), /ssh 开头/);
  assert.throws(() => assertSshCommand("ssh host\nuptime"), /一行命令/);
  assert.throws(() => assertSshCommand("ssh host uptime"), /不要附加远端命令/);
  assert.throws(() => assertSshCommand("ssh host && echo nope"), /管道/);
  assert.throws(() => assertSshCommand('ssh "unterminated'), /引号未闭合/);
});

test("assertSshConfigHost trims host aliases and rejects whitespace", () => {
  assert.equal(assertSshConfigHost("  gpu-login  "), "gpu-login");
  assert.throws(() => assertSshConfigHost(""), /请选择/);
  assert.throws(() => assertSshConfigHost("gpu login"), /空白字符/);
});

test("readSshConfigFile parses hosts, comments, and relative includes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "internagents-ssh-"));
  try {
    const mainConfig = path.join(tempDir, "config");
    const childConfig = path.join(tempDir, "child.conf");
    await writeFile(
      childConfig,
      [
        "# child config",
        "Host child child-two",
        "  HostName child.example.com",
        "Host *.child.example.com",
      ].join("\n")
    );
    await writeFile(
      mainConfig,
      [
        "# main config",
        "Host alpha beta",
        "  HostName alpha.example.com",
        "Host *.example.com !blocked",
        "Include child.conf",
        "Include *.ignored",
      ].join("\n")
    );

    const hosts = await readSshConfigFile(mainConfig, {
      includePatterns: false,
    });

    assert.deepEqual(
      hosts.map((host) => host.alias),
      ["alpha", "beta", "child", "child-two"]
    );
    assert.equal(hosts[0].source, mainConfig);
    assert.equal(hosts[2].source, childConfig);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readSshConfigFile can include wildcard Host patterns when requested", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "internagents-ssh-"));
  try {
    const mainConfig = path.join(tempDir, "config");
    await writeFile(
      mainConfig,
      ["Host alpha", "Host *.example.com !blocked"].join("\n")
    );

    const hosts = await readSshConfigFile(mainConfig, {
      includePatterns: true,
    });

    assert.deepEqual(
      hosts.map((host) => host.alias),
      ["alpha", "*.example.com", "!blocked"]
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("resolveSshConfigPath resolves home, absolute, and relative paths", () => {
  assert.equal(
    resolveSshConfigPath("~/config.test"),
    path.join(os.homedir(), "config.test")
  );

  const absolute = path.resolve(os.tmpdir(), "ssh-config");
  assert.equal(resolveSshConfigPath(absolute), absolute);
  assert.equal(
    resolveSshConfigPath("child.conf", path.join(os.tmpdir(), "ssh-parent")),
    path.resolve(os.tmpdir(), "ssh-parent", "child.conf")
  );
});
