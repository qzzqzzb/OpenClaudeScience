import {
  ensureRemoteResourceRuntime,
  setupRemoteConnection,
} from "./remoteInfrastructure.adapter";
import type {
  RemoteConnectionEnsureResult,
  RemoteConnectionSetupRequest,
  RemoteConnectionSetupResult,
} from "../remote.types";

type LogSink = (message: string) => void;

export async function ensureRemoteRuntime(
  resourceId: string,
  onLog?: LogSink
): Promise<RemoteConnectionEnsureResult> {
  return ensureRemoteResourceRuntime(resourceId, onLog);
}

export async function setupRemoteRuntime(
  input: RemoteConnectionSetupRequest,
  onLog?: LogSink
): Promise<RemoteConnectionSetupResult> {
  return setupRemoteConnection(input, onLog);
}
