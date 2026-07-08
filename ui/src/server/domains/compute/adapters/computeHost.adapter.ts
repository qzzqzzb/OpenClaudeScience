import { randomUUID } from "crypto";
import { assertSshCommand } from "@/lib/ssh-command";
import { sshCliAdapter } from "@/server/shared/adapters/sshCli.adapter";
import type {
  SshComputeHost,
  SshComputeProbe,
  UpsertComputeHostInput,
} from "../compute.types";
import {
  findStoredComputeHost,
  upsertStoredComputeHost,
} from "./computeStore.adapter";

const DEFAULT_SCRATCH_ROOT = "~/.internagents/remote-jobs";

function hostIdFromLabel(label: string): string {
  const clean = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || `host-${randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function probeSshComputeHost(
  sshCommand: string
): Promise<SshComputeProbe> {
  const checkedAt = nowIso();

  try {
    const connection = await sshCliAdapter.resolveConnection({
      connectionMode: "sshCommand",
      sshCommand: assertSshCommand(sshCommand),
    });
    const probe = await sshCliAdapter.testConnection({
      connection,
      timeoutMs: 15_000,
    });
    if (!probe.ok) {
      return {
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        error: probe.error || "SSH compute host probe failed.",
      };
    }
    if (probe.os !== "Linux") {
      return {
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        os: probe.os,
        error: `Only Linux SSH compute hosts are supported; got ${
          probe.os || "unknown"
        }.`,
      };
    }
    if (!probe.python || !probe.bash || !probe.timeout) {
      return {
        ...probe,
        ok: false,
        checkedAt: probe.checkedAt || checkedAt,
        error: "Linux host must have python3, bash, and timeout.",
      };
    }
    return {
      ok: true,
      checkedAt: probe.checkedAt || checkedAt,
      os: probe.os,
      kernel: probe.kernel,
      arch: probe.arch,
      user: probe.user,
      host: probe.host,
      python: probe.python,
      bash: probe.bash,
      timeout: probe.timeout,
      workdir: probe.workdir,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveComputeHost(
  input: UpsertComputeHostInput
): Promise<SshComputeHost> {
  if (typeof input.sshCommand === "string" && input.sshCommand.trim()) {
    throw new Error("SSH compute hosts must use a Host alias from ~/.ssh/config.");
  }
  const connection = await sshCliAdapter.resolveConnection({
    connectionMode: "sshConfig",
    host: input.host,
  });
  const hostAlias = connection.hostAlias;
  if (!hostAlias) {
    throw new Error("SSH compute hosts must use a Host alias from ~/.ssh/config.");
  }
  const sshCommand = assertSshCommand(connection.sshCommand);
  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim()
      : hostAlias;
  const id =
    typeof input.id === "string" && input.id.trim()
      ? hostIdFromLabel(input.id)
      : hostIdFromLabel(hostAlias);
  const scratchRoot =
    typeof input.scratchRoot === "string" && input.scratchRoot.trim()
      ? input.scratchRoot.trim()
      : DEFAULT_SCRATCH_ROOT;
  if (!scratchRoot.startsWith("/") && !scratchRoot.startsWith("~/")) {
    throw new Error("scratchRoot must be absolute or start with ~/.");
  }

  const probe = await probeSshComputeHost(sshCommand);
  if (!probe.ok) {
    throw new Error(probe.error || "SSH compute host probe failed.");
  }

  const existing = await findStoredComputeHost(id);
  const now = nowIso();
  const next: SshComputeHost = {
    id,
    label,
    hostAlias,
    sshCommand,
    scratchRoot,
    notes:
      typeof input.notes === "string" && input.notes.trim()
        ? input.notes.trim()
        : existing?.notes,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    probe,
  };
  await upsertStoredComputeHost(next);
  return next;
}
