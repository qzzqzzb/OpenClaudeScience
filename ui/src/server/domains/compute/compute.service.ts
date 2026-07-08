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
  RemoteJobRecord,
  RemoteJobSnapshot,
  SubmitRemoteJobRequest,
  SshComputeHost,
  UpsertComputeHostInput,
} from "./compute.types";

export async function getComputeHosts(): Promise<SshComputeHost[]> {
  return listStoredComputeHosts();
}

export async function upsertComputeHost(
  request: NextRequest,
  input: UpsertComputeHostInput
): Promise<SshComputeHost> {
  assertComputeRequestAllowed(request);
  return saveComputeHost(input);
}

export async function getComputeJobs(): Promise<RemoteJobRecord[]> {
  return listStoredComputeJobs();
}

export async function submitRemoteComputeJob(
  request: NextRequest,
  input: SubmitRemoteJobRequest
): Promise<RemoteJobRecord> {
  assertComputeRequestAllowed(request);
  return submitComputeJob(input);
}

export async function getComputeJobSnapshot(
  jobId: string
): Promise<RemoteJobSnapshot> {
  return readComputeJobSnapshot(jobId);
}
