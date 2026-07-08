import { pushRemoteBackendCli } from "@/app/api/remote-connections/_lib/remote-connections";
import type {
  RemoteBackendCliPushRequest,
  RemoteBackendCliPushResult,
} from "../remote.types";

type LogSink = (message: string) => void;

export async function pushRemoteRuntimeBackendCli(
  input: RemoteBackendCliPushRequest,
  onLog?: LogSink
): Promise<RemoteBackendCliPushResult> {
  return pushRemoteBackendCli(input, onLog);
}
