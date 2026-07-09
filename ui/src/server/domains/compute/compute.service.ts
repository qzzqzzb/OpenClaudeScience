import type { NextRequest } from "next/server";
import { assertComputeRequestAllowed } from "./adapters/computeAuth.adapter";
import { saveComputeHost } from "./adapters/computeHost.adapter";
import {
  readComputeJobSnapshot,
  submitComputeJob,
} from "./adapters/computeJob.adapter";
import {
  listStoredComputeHosts,
  listStoredComputeJobs,
} from "./adapters/computeStore.adapter";
import type {
  ComputeAdapter,
  RemoteJobRecord,
  RemoteJobSnapshot,
  SubmitRemoteJobRequest,
  SshComputeHost,
  UpsertComputeHostInput,
} from "./compute.types";

export const computeAdapter: ComputeAdapter = {
  listHosts: listStoredComputeHosts,
  upsertHost: saveComputeHost,
  listJobs: listStoredComputeJobs,
  submitJob: submitComputeJob,
  getJob: ({ jobId }) => readComputeJobSnapshot(jobId),
};

export async function getComputeHosts(): Promise<SshComputeHost[]> {
  return computeAdapter.listHosts();
}

export async function upsertComputeHost(
  request: NextRequest,
  input: UpsertComputeHostInput
): Promise<SshComputeHost> {
  assertComputeRequestAllowed(request);
  return computeAdapter.upsertHost(input);
}

export async function getComputeJobs(): Promise<RemoteJobRecord[]> {
  return computeAdapter.listJobs();
}

export async function submitRemoteComputeJob(
  request: NextRequest,
  input: SubmitRemoteJobRequest
): Promise<RemoteJobRecord> {
  assertComputeRequestAllowed(request);
  return computeAdapter.submitJob(input);
}

export async function getComputeJobSnapshot(
  jobId: string
): Promise<RemoteJobSnapshot> {
  return computeAdapter.getJob({ jobId });
}
