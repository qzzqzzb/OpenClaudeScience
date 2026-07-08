import type { RemoteJobRecord, SshComputeHost } from "../compute.types";

export function upsertComputeHostRecord(
  hosts: SshComputeHost[],
  host: SshComputeHost
): SshComputeHost[] {
  return [host, ...hosts.filter((item) => item.id !== host.id)];
}

export function upsertComputeJobRecord(
  jobs: RemoteJobRecord[],
  job: RemoteJobRecord
): RemoteJobRecord[] {
  const existing = jobs.some((item) => item.id === job.id);
  return existing
    ? jobs.map((item) => (item.id === job.id ? job : item))
    : [job, ...jobs];
}
