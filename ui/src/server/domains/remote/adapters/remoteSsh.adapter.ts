import { sshCliAdapter } from "@/server/shared/adapters/sshCli.adapter";
import type {
  RemoteSshTestInput,
  RemoteSshTestResult,
  SshHostEntry,
} from "../remote.types";

export async function listRemoteSshHosts(): Promise<SshHostEntry[]> {
  const hosts = await sshCliAdapter.listHosts();
  return hosts.map((host) => ({
    host: host.alias,
    source: host.source,
  }));
}

export async function testRemoteSshConnection(
  input: RemoteSshTestInput
): Promise<RemoteSshTestResult> {
  try {
    const connection = await sshCliAdapter.resolveConnection({
      connectionMode:
        input.connectionMode === "sshCommand" ? "sshCommand" : "sshConfig",
      host: input.host,
      sshCommand: input.sshCommand,
    });
    const probe = await sshCliAdapter.testConnection({ connection });
    return {
      ok: probe.ok,
      stdout: probe.ok
        ? [
            `user=${probe.user || ""}`,
            `host=${probe.host || ""}`,
            `python=${probe.python || ""}`,
            `pwd=${probe.workdir || ""}`,
          ].join("\n")
        : "",
      stderr: probe.ok ? "" : probe.error || "SSH test failed.",
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "SSH test failed.",
    };
  }
}
