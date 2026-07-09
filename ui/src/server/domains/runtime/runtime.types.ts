export interface BackendRestartResult {
  status: "restarted" | "failed";
  message: string;
  url: string;
  pid?: number;
  oldPid?: number;
  logPath: string;
}

export interface BackendStatusResult {
  status: "idle" | "busy" | "unavailable";
  message: string;
  url: string;
  busyThreads: number;
  interruptedThreads: number;
}

export interface RuntimeReadyResult {
  ready: boolean;
  status?: number;
  error?: string;
}

export interface RuntimeResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  runtimeUrl?: string;
}

export interface DesktopRuntimeConfig {
  desktopMode: boolean;
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey: string;
  defaultResourceId: string;
  resources: RuntimeResourceConfig[];
}

export interface RuntimeReadyInput {
  timeoutMs?: number;
}

export interface RuntimeStatusInput {
  timeoutMs?: number;
}

export interface RuntimeRestartInput {
  timeoutMs?: number;
}

export interface RuntimeAdapter {
  isReady(input?: RuntimeReadyInput): Promise<RuntimeReadyResult>;
  getStatus(input?: RuntimeStatusInput): Promise<BackendStatusResult>;
  restart(input?: RuntimeRestartInput): Promise<BackendRestartResult>;
  getDesktopConfig(): Promise<DesktopRuntimeConfig>;
}
