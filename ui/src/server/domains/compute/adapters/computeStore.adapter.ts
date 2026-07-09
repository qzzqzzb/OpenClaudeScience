import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { getWorkspaceRoot } from "@/server/shared/adapters/workspaceRoot.adapter";
import type { RemoteJobRecord, SshComputeHost } from "../compute.types";
import {
  upsertComputeHostRecord,
  upsertComputeJobRecord,
} from "./computeStore.helpers";

interface HostsStore {
  hosts: SshComputeHost[];
}

interface JobsStore {
  jobs: RemoteJobRecord[];
}

const STATE_DIR = path.join(getWorkspaceRoot(), ".internagents", "compute");
const HOSTS_FILE = path.join(STATE_DIR, "ssh-hosts.json");
const JOBS_FILE = path.join(STATE_DIR, "remote-jobs.json");
let storeWriteQueue: Promise<void> = Promise.resolve();

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  ensureStateDir();
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`);
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function writeJsonFile<T>(filePath: string, value: T) {
  ensureStateDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, filePath);
}

function readHostsStore(): HostsStore {
  return readJsonFile<HostsStore>(HOSTS_FILE, { hosts: [] });
}

async function writeHostsStore(store: HostsStore) {
  await writeJsonFile(HOSTS_FILE, store);
}

function readJobsStore(): JobsStore {
  return readJsonFile<JobsStore>(JOBS_FILE, { jobs: [] });
}

async function writeJobsStore(store: JobsStore) {
  await writeJsonFile(JOBS_FILE, store);
}

async function withStoreWrite<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = storeWriteQueue;
  let release!: () => void;
  storeWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function listStoredComputeHosts(): Promise<SshComputeHost[]> {
  return readHostsStore().hosts;
}

export async function findStoredComputeHost(
  hostId: string
): Promise<SshComputeHost | undefined> {
  return readHostsStore().hosts.find((host) => host.id === hostId);
}

export async function upsertStoredComputeHost(
  host: SshComputeHost
): Promise<void> {
  await withStoreWrite(async () => {
    const store = readHostsStore();
    store.hosts = upsertComputeHostRecord(store.hosts, host);
    await writeHostsStore(store);
  });
}

export async function listStoredComputeJobs(): Promise<RemoteJobRecord[]> {
  return readJobsStore().jobs;
}

export async function findStoredComputeJob(
  jobId: string
): Promise<RemoteJobRecord | undefined> {
  return readJobsStore().jobs.find((job) => job.id === jobId);
}

export async function upsertStoredComputeJob(
  job: RemoteJobRecord
): Promise<void> {
  await withStoreWrite(async () => {
    const store = readJobsStore();
    store.jobs = upsertComputeJobRecord(store.jobs, job);
    await writeJobsStore(store);
  });
}
