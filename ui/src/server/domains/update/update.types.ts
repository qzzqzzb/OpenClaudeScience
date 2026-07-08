export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "failed";

export interface UpdateLogEntry {
  at: string;
  message: string;
}

export interface UpdateVersionInfo {
  version: string;
  exactTag?: string;
  branch?: string;
  commit?: string;
  dirty: boolean;
  dirtyReason?: string;
  appPath?: string;
  installMode: "desktop-app" | "source";
}

export interface UpdateAssetInfo {
  name: string;
  size?: number;
  downloadUrl: string;
}

export interface UpdateDownloadProgress {
  assetName: string;
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
  startedAt: string;
  updatedAt: string;
}

export interface UpdateReleaseInfo {
  tagName: string;
  name: string;
  htmlUrl: string;
  publishedAt?: string;
  notes?: string;
  asset?: UpdateAssetInfo;
}

export interface UpdateStatus {
  state: UpdateState;
  sourceRepo: string;
  sourceUrl: string;
  current: UpdateVersionInfo;
  latest?: UpdateReleaseInfo;
  updateAvailable: boolean;
  canApply: boolean;
  blockReason?: string;
  message: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  previous?: {
    checkoutTarget: string;
    commit: string;
    label: string;
  };
  download?: UpdateDownloadProgress;
  installLogPath?: string;
  log: UpdateLogEntry[];
}
