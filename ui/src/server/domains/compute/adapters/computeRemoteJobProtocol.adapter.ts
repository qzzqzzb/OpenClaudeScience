import { shellQuote } from "@/server/shared/adapters/sshCli.helpers";
import { sshCliAdapter } from "@/server/shared/adapters/sshCli.adapter";

const COMMAND_MAX_BUFFER = 1024 * 1024 * 16;

interface ComputeRemoteJobInputFile {
  path: string;
  contentBase64: string;
}

export interface SubmitComputeRemoteJobProtocolInput {
  sshCommand: string;
  scratchRoot: string;
  jobId: string;
  command: string;
  timeoutSeconds: number;
  inputs: ComputeRemoteJobInputFile[];
  maxOutputFiles: number;
  maxTotalOutputBytes: number;
}

export interface SubmitComputeRemoteJobProtocolResult {
  remoteJobDir: string;
  pid: number;
}

export interface ReadComputeRemoteJobStatusInput {
  sshCommand: string;
  remoteJobDir: string;
  pid?: number;
  outputGlobs: string[];
  maxOutputFileBytes: number;
  maxOutputFiles: number;
  maxTotalOutputBytes: number;
}

export type ComputeRemoteJobProtocolStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout"
  | "unknown";

export interface ComputeRemoteJobOutputFile {
  path: string;
  size: number;
  contentBase64?: string;
  leftOnRemote?: boolean;
}

export interface ComputeRemoteJobStatusPayload {
  status: ComputeRemoteJobProtocolStatus;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  stdout?: string;
  stderr?: string;
  outputs?: ComputeRemoteJobOutputFile[];
}

async function runRemotePythonWithInput<T>(
  sshCommand: string,
  source: string,
  payload: unknown,
  timeoutMs: number
): Promise<T> {
  const connection = await sshCliAdapter.resolveConnection({
    connectionMode: "sshCommand",
    sshCommand,
  });
  const result = await sshCliAdapter.runCommandWithInput({
    connection,
    script: `python3 -c ${shellQuote(source)}`,
    stdin: JSON.stringify(payload),
    timeoutMs,
    maxBufferBytes: COMMAND_MAX_BUFFER,
  });
  const out = result.stdout.trim();
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Remote Python exited ${result.exitCode}.`);
  }
  try {
    const parsed = JSON.parse(out) as { ok: boolean; error?: string; data: T };
    if (!parsed.ok) {
      throw new Error(parsed.error || "Remote Python command failed.");
    }
    return parsed.data;
  } catch (error) {
    throw new Error(
      `Invalid remote JSON: ${
        error instanceof Error ? error.message : String(error)
      }: ${out.slice(0, 1000)}`
    );
  }
}

export async function submitComputeRemoteJobProtocol(
  input: SubmitComputeRemoteJobProtocolInput
): Promise<SubmitComputeRemoteJobProtocolResult> {
  return runRemotePythonWithInput<SubmitComputeRemoteJobProtocolResult>(
    input.sshCommand,
    REMOTE_SUBMIT_SCRIPT,
    {
      scratchRoot: input.scratchRoot,
      jobId: input.jobId,
      command: input.command,
      timeoutSeconds: input.timeoutSeconds,
      inputs: input.inputs,
      maxOutputFiles: input.maxOutputFiles,
      maxTotalOutputBytes: input.maxTotalOutputBytes,
    },
    20_000
  );
}

export async function readComputeRemoteJobStatus(
  input: ReadComputeRemoteJobStatusInput
): Promise<ComputeRemoteJobStatusPayload> {
  return runRemotePythonWithInput<ComputeRemoteJobStatusPayload>(
    input.sshCommand,
    REMOTE_STATUS_SCRIPT,
    {
      remoteJobDir: input.remoteJobDir,
      pid: input.pid,
      outputGlobs: input.outputGlobs,
      maxOutputFileBytes: input.maxOutputFileBytes,
      maxOutputFiles: input.maxOutputFiles,
      maxTotalOutputBytes: input.maxTotalOutputBytes,
    },
    20_000
  );
}

const REMOTE_SUBMIT_SCRIPT = String.raw`
import base64
import json
import os
import pathlib
import stat
import subprocess
import sys


def safe_child(root, rel):
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    if rel.startswith("~") or any(part in {"", ".."} for part in rel.split("/")):
        raise ValueError(f"Unsafe input path: {rel}")
    target = (root / rel).resolve()
    target.relative_to(root)
    return target


def main():
    request = json.loads(sys.stdin.read() or "{}")
    scratch = pathlib.Path(request["scratchRoot"]).expanduser().resolve()
    job_id = request["jobId"]
    if not job_id.startswith("job_"):
        raise ValueError("Invalid job id")
    job_dir = (scratch / job_id).resolve()
    job_dir.relative_to(scratch)
    work_dir = job_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=False)

    for item in request.get("inputs") or []:
        target = safe_child(work_dir, item["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(item["contentBase64"]))

    command_file = job_dir / "command.sh"
    command_file.write_text(request["command"], encoding="utf-8")
    wrapper = job_dir / "run.sh"
    wrapper.write_text(f"""#!/usr/bin/env bash
set +e
cd {str(work_dir)!r}
date -u +%Y-%m-%dT%H:%M:%SZ > ../started_at.txt
if ! command -v timeout >/dev/null 2>&1; then
  echo "Remote host is missing the timeout command." > ../stderr.log
  code=127
else
  timeout {int(request["timeoutSeconds"])} bash -lc "$(cat ../command.sh)" > ../stdout.log 2> ../stderr.log
  code=$?
fi
printf '%s\n' "$code" > ../exit_code.txt
date -u +%Y-%m-%dT%H:%M:%SZ > ../finished_at.txt
exit "$code"
""", encoding="utf-8")
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
    proc = subprocess.Popen(
        ["nohup", "bash", str(wrapper)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    (job_dir / "pid.txt").write_text(str(proc.pid), encoding="utf-8")
    return {"remoteJobDir": str(job_dir), "pid": proc.pid}


try:
    print(json.dumps({"ok": True, "data": main()}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
`;

const REMOTE_STATUS_SCRIPT = String.raw`
import base64
import glob
import json
import os
import pathlib
import sys


def read_text(path, limit=200000):
    try:
        raw = pathlib.Path(path).read_bytes()
    except OSError:
        return ""
    if len(raw) > limit:
        return raw[:limit].decode("utf-8", "replace") + f"\n\n... truncated at {limit} bytes"
    return raw.decode("utf-8", "replace")


def is_running(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def safe_output(root, path):
    resolved = pathlib.Path(path).resolve()
    resolved.relative_to(root)
    return resolved


def collect_outputs(work_dir, globs, max_bytes, max_files, max_total_bytes):
    outputs = []
    seen = set()
    total_bytes = 0
    for pattern in globs:
        for matched in glob.glob(str(work_dir / pattern), recursive=True):
            if len(outputs) >= max_files:
                return outputs
            path = pathlib.Path(matched)
            if not path.is_file():
                continue
            resolved = safe_output(work_dir, path)
            if resolved in seen:
                continue
            seen.add(resolved)
            size = resolved.stat().st_size
            rel = resolved.relative_to(work_dir).as_posix()
            item = {"path": rel, "size": size}
            if size <= max_bytes and total_bytes + size <= max_total_bytes:
                item["contentBase64"] = base64.b64encode(resolved.read_bytes()).decode("ascii")
                total_bytes += size
            else:
                item["leftOnRemote"] = True
            outputs.append(item)
    outputs.sort(key=lambda item: item["path"])
    return outputs


def main():
    request = json.loads(sys.stdin.read() or "{}")
    job_dir = pathlib.Path(request["remoteJobDir"]).expanduser().resolve()
    work_dir = job_dir / "work"
    pid = request.get("pid")
    exit_file = job_dir / "exit_code.txt"
    finished_file = job_dir / "finished_at.txt"
    payload = {
        "stdout": read_text(job_dir / "stdout.log"),
        "stderr": read_text(job_dir / "stderr.log"),
    }
    if exit_file.exists():
        exit_code = int(exit_file.read_text(encoding="utf-8").strip())
        payload.update({
            "status": "succeeded" if exit_code == 0 else "failed",
            "exitCode": exit_code,
            "finishedAt": read_text(finished_file).strip() or None,
            "outputs": collect_outputs(
                work_dir,
                request.get("outputGlobs") or [],
                int(request.get("maxOutputFileBytes") or 0),
                int(request.get("maxOutputFiles") or 0),
                int(request.get("maxTotalOutputBytes") or 0),
            ),
        })
        return payload
    if is_running(pid):
        payload["status"] = "running"
        return payload
    payload["status"] = "unknown"
    return payload


try:
    print(json.dumps({"ok": True, "data": main()}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
`;
