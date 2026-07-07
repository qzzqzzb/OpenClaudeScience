"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Download,
  GitBranch,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  applyUpdate,
  checkUpdate,
  getUpdateStatus,
  rollbackUpdate,
  type UpdateStatusResult,
} from "@/app/services/updateClient";
import { workbenchHrefFromSearchParams } from "@/app/utils/navigationContext";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatPercent(value: number | undefined, fallbackLabel: string) {
  if (value === undefined) {
    return fallbackLabel;
  }

  const clamped = Math.min(100, Math.max(0, value));
  const digits = clamped > 0 && clamped < 10 ? 1 : 0;
  return `${clamped.toFixed(digits)}%`;
}

function AboutPageContent() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResult | null>(
    null
  );
  const [statusLoading, setStatusLoading] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [rollingBackUpdate, setRollingBackUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionBusy =
    statusLoading || checkingUpdate || applyingUpdate || rollingBackUpdate;
  const downloadProgress = updateStatus?.download;
  const downloadPercent =
    typeof downloadProgress?.percent === "number"
      ? Math.min(100, Math.max(0, downloadProgress.percent))
      : undefined;
  const showDownloadProgress =
    updateStatus?.state === "downloading" && Boolean(downloadProgress);
  const shouldPollUpdateStatus =
    applyingUpdate ||
    rollingBackUpdate ||
    updateStatus?.state === "downloading" ||
    updateStatus?.state === "applying" ||
    updateStatus?.state === "rolling-back";
  const workbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );

  const downloadProgressLabel = useMemo(() => {
    if (!downloadProgress) {
      return "";
    }
    const downloaded = formatBytes(downloadProgress.downloadedBytes);
    const total =
      downloadProgress.totalBytes !== undefined
        ? formatBytes(downloadProgress.totalBytes)
        : t("unknownSize");
    return `${downloaded} / ${total}`;
  }, [downloadProgress, t]);

  const loadUpdateStatus = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!options?.quiet) {
        setStatusLoading(true);
        setError(null);
      }
      try {
        const payload = await getUpdateStatus(t("updateStatusReadFailed"));
        setUpdateStatus(payload);
      } catch (statusError) {
        const message =
          statusError instanceof Error
            ? statusError.message
            : t("updateStatusReadFailed");
        if (!options?.quiet) {
          setError(message);
          toast.error(message);
        }
      } finally {
        if (!options?.quiet) {
          setStatusLoading(false);
        }
      }
    },
    [t]
  );

  async function checkForSoftwareUpdate() {
    setCheckingUpdate(true);
    setError(null);
    try {
      const { responseOk, status: payload } = await checkUpdate();
      setUpdateStatus(payload);
      if (!responseOk) {
        throw new Error(
          payload.error || payload.message || t("checkUpdateFailed")
        );
      }
      toast.success(payload.message);
    } catch (checkError) {
      const message =
        checkError instanceof Error
          ? checkError.message
          : t("checkUpdateFailed");
      setError(message);
      toast.error(message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function applySoftwareUpdate() {
    const latestTag = updateStatus?.latest?.tagName;
    const confirmed = window.confirm(
      [
        latestTag
          ? t("confirmUpdateToTag", { tag: latestTag })
          : t("confirmUpdateToLatest"),
        "",
        t("confirmUpdateBody"),
        "",
        t("confirmContinue"),
      ].join("\n")
    );
    if (!confirmed) {
      return;
    }

    setApplyingUpdate(true);
    setError(null);
    try {
      const { responseOk, status: payload } = await applyUpdate();
      setUpdateStatus(payload);
      if (!responseOk) {
        throw new Error(payload.error || payload.message || t("updateFailed"));
      }
      toast.success(payload.message);
      if (payload.state === "applied") {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (applyError) {
      const message =
        applyError instanceof Error ? applyError.message : t("updateFailed");
      setError(message);
      toast.error(message);
    } finally {
      setApplyingUpdate(false);
    }
  }

  async function rollbackSoftwareUpdate() {
    const previousLabel = updateStatus?.previous?.label;
    const confirmed = window.confirm(
      [
        previousLabel
          ? t("confirmRollbackToVersion", { version: previousLabel })
          : t("confirmRollbackPrevious"),
        "",
        t("rollbackUnsupportedBody"),
        "",
        t("confirmContinue"),
      ].join("\n")
    );
    if (!confirmed) {
      return;
    }

    setRollingBackUpdate(true);
    setError(null);
    try {
      const { responseOk, status: payload } = await rollbackUpdate();
      setUpdateStatus(payload);
      if (!responseOk) {
        throw new Error(
          payload.error || payload.message || t("rollbackFailed")
        );
      }
      toast.success(payload.message);
      if (payload.state === "rolled-back") {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (rollbackError) {
      const message =
        rollbackError instanceof Error
          ? rollbackError.message
          : t("rollbackFailed");
      setError(message);
      toast.error(message);
    } finally {
      setRollingBackUpdate(false);
    }
  }

  useEffect(() => {
    void loadUpdateStatus();
  }, [loadUpdateStatus]);

  useEffect(() => {
    if (!shouldPollUpdateStatus) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadUpdateStatus({ quiet: true });
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [loadUpdateStatus, shouldPollUpdateStatus]);

  return (
    <div className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2"
          >
            <Link href={workbenchHref}>
              <ArrowLeft className="h-4 w-4" />
              {t("backToWorkbench")}
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {t("aboutAndUpdates")}
            </h1>
            <div className="truncate text-xs text-muted-foreground">
              {t("aboutSubtitle")}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <Info className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">
                    {t("aboutIntroTitle")}
                  </h2>
                  <div className="mt-1 max-w-3xl space-y-2 text-sm leading-6 text-muted-foreground">
                    <p>{t("aboutIntroBody")}</p>
                  </div>
                </div>
              </div>
              <Button
                asChild
                size="sm"
                className="h-9 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <a
                  href="https://internscience.github.io/InternAgents/user-manual/"
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen className="h-4 w-4" />
                  {t("helpDocs")}
                </a>
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{t("updates")}</h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("updateDescription")}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void applySoftwareUpdate()}
                  disabled={
                    actionBusy ||
                    !updateStatus?.updateAvailable ||
                    !updateStatus.canApply
                  }
                  className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {applyingUpdate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {t("oneClickUpdate")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void checkForSoftwareUpdate()}
                  disabled={actionBusy}
                  className="h-9"
                >
                  {checkingUpdate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t("checkUpdate")}
                </Button>
                {updateStatus?.previous && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void rollbackSoftwareUpdate()}
                    disabled={actionBusy}
                    className="h-9"
                  >
                    {rollingBackUpdate ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    {t("rollbackPreviousVersion")}
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {updateStatus?.current.dirty && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  {updateStatus.current.dirtyReason || t("dirtyInstallDefault")}
                </div>
              )}
              {updateStatus?.blockReason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  {updateStatus.blockReason}
                </div>
              )}

              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {t("currentVersion")}
                  </div>
                  <div className="mt-1 truncate font-mono text-sm">
                    {updateStatus?.current.exactTag ||
                      `v${updateStatus?.current.version || "0.0.0"}`}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {t("latestVersion")}
                  </div>
                  <div className="mt-1 truncate font-mono text-sm">
                    {updateStatus?.latest?.tagName || t("notCheckedYet")}
                  </div>
                  {updateStatus?.latest?.publishedAt && (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {new Date(
                        updateStatus.latest.publishedAt
                      ).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">
                    {t("updateStatus")}
                  </div>
                  <div className="mt-1 truncate text-sm">
                    {updateStatus?.message || t("readingUpdateStatus")}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {updateStatus?.backendRestart?.message ||
                      updateStatus?.latest?.asset?.name ||
                      (updateStatus
                        ? t("githubReleaseDmg")
                        : t("waitingStatus"))}
                  </div>
                </div>
              </div>

              {showDownloadProgress && downloadProgress && (
                <div className="rounded-md border border-border bg-background px-3 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 truncate font-medium">
                      {downloadProgress.assetName}
                    </div>
                    <div className="shrink-0 font-mono text-muted-foreground">
                      {formatPercent(downloadPercent, t("downloadingFallback"))}
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{
                        width:
                          downloadPercent !== undefined
                            ? `${downloadPercent}%`
                            : "45%",
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="truncate">{downloadProgressLabel}</div>
                    <div className="shrink-0">
                      {new Date(
                        downloadProgress.updatedAt
                      ).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              )}

              {updateStatus?.latest?.notes && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    {t("releaseNotes")}
                  </div>
                  <div className="line-clamp-3 whitespace-pre-line text-muted-foreground">
                    {updateStatus.latest.notes}
                  </div>
                </div>
              )}

              {updateStatus?.log && updateStatus.log.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {updateStatus.log.slice(-3).map((entry) => (
                    <div
                      key={`${entry.at}-${entry.message}`}
                      className="truncate"
                    >
                      {new Date(entry.at).toLocaleTimeString()} ·{" "}
                      {entry.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function AboutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <AboutPageContent />
    </Suspense>
  );
}
