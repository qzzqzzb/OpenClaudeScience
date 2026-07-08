import assert from "node:assert/strict";
import test from "node:test";

import type {
  RemoteJobRecord,
  SshComputeHost,
} from "../src/server/domains/compute/compute.types.ts";
import {
  upsertComputeHostRecord,
  upsertComputeJobRecord,
} from "../src/server/domains/compute/adapters/computeStore.helpers.ts";

function host(id: string): SshComputeHost {
  return {
    id,
    label: id,
    hostAlias: id,
    sshCommand: `ssh ${id}`,
    scratchRoot: "~/.internagents/remote-jobs",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function job(id: string, status: RemoteJobRecord["status"]): RemoteJobRecord {
  return {
    id,
    hostId: "host-a",
    command: "python run.py",
    remoteJobDir: `/tmp/${id}`,
    status,
    submittedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    timeoutSeconds: 60,
    outputGlobs: ["out/**"],
    maxOutputFileBytes: 1024,
  };
}

test("upsertComputeHostRecord prepends new and updated hosts", () => {
  assert.deepEqual(
    upsertComputeHostRecord([host("old"), host("other")], {
      ...host("old"),
      label: "updated",
    }).map((item) => item.label),
    ["updated", "other"]
  );

  assert.deepEqual(
    upsertComputeHostRecord([host("old")], host("new")).map((item) => item.id),
    ["new", "old"]
  );
});

test("upsertComputeJobRecord preserves order for existing jobs", () => {
  const updated = { ...job("job-b", "running"), status: "succeeded" as const };

  assert.deepEqual(
    upsertComputeJobRecord(
      [job("job-a", "running"), job("job-b", "running"), job("job-c", "running")],
      updated
    ).map((item) => `${item.id}:${item.status}`),
    ["job-a:running", "job-b:succeeded", "job-c:running"]
  );

  assert.deepEqual(
    upsertComputeJobRecord([job("job-a", "running")], job("job-new", "queued")).map(
      (item) => item.id
    ),
    ["job-new", "job-a"]
  );
});
