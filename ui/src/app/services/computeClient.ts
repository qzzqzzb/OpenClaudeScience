import { readJsonResponse } from "@/app/services/apiClient";

export interface SshComputeProbe {
  ok: boolean;
  checkedAt: string;
  os?: string;
  kernel?: string;
  arch?: string;
  user?: string;
  host?: string;
  python?: string;
  bash?: string;
  workdir?: string;
  error?: string;
}

export interface SshComputeHost {
  id: string;
  label: string;
  hostAlias?: string;
  sshCommand: string;
  scratchRoot: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  probe?: SshComputeProbe;
}

interface SshComputeHostsPayload {
  hosts: SshComputeHost[];
}

interface SshComputeHostPayload {
  host: SshComputeHost;
}

interface AddSshComputeHostOptions {
  host: string;
  notes?: string;
}

export async function listSshComputeHosts(): Promise<SshComputeHostsPayload> {
  const response = await fetch("/api/compute/ssh-hosts", {
    cache: "no-store",
  });
  return readJsonResponse<SshComputeHostsPayload>(
    response,
    `Request failed with ${response.status}`
  );
}

export async function addSshComputeHost({
  host,
  notes,
}: AddSshComputeHostOptions): Promise<SshComputeHostPayload> {
  const response = await fetch("/api/compute/ssh-hosts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      host,
      notes,
    }),
  });
  return readJsonResponse<SshComputeHostPayload>(
    response,
    `Request failed with ${response.status}`
  );
}
