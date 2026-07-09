"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useThreads, type ThreadItem } from "@/app/hooks/useThreads";
import { RemoteAgentProvider } from "@/providers/ClientProvider";
import { useAgentRuntime } from "@/providers/AgentRuntimeContext";
import { getConfig, type StandaloneConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { UiLanguage } from "@/lib/i18n";
import { useLanguage } from "@/app/hooks/useLanguage";

function formatDate(value: Date, language: UiLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function archivedDate(thread: ThreadItem) {
  const archivedAt = thread.metadata.internagents_archived_at;
  if (typeof archivedAt === "string") {
    const date = new Date(archivedAt);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return thread.updatedAt;
}

function ArchivedThreadsFrame({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
          <Archive className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t("archivedThreads")}</h2>
          <div className="mt-1 text-sm text-muted-foreground">
            {t("archivedThreadsHelp")}
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function ArchivedThreadsCardContent() {
  const { language, t } = useLanguage();
  const agentRuntime = useAgentRuntime();
  const threads = useThreads({ archived: true, limit: 8, lightweight: true });
  const [restoringThreadId, setRestoringThreadId] = useState<string | null>(
    null
  );

  const archivedThreads = useMemo(
    () => threads.data?.flat() ?? [],
    [threads.data]
  );
  const isEmpty = threads.data?.at(0)?.length === 0;
  const isReachingEnd = isEmpty || (threads.data?.at(-1)?.length ?? 0) < 8;

  async function restoreThread(thread: ThreadItem) {
    setRestoringThreadId(thread.id);
    try {
      await agentRuntime.updateThreadMetadata({
        threadId: thread.id,
        metadata: {
          ...thread.metadata,
          internagents_archived: false,
          internagents_unarchived_at: new Date().toISOString(),
        },
      });
      await threads.mutate();
      toast.success(t("threadRestored"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("threadRestoreFailed")
      );
    } finally {
      setRestoringThreadId(null);
    }
  }

  return (
    <ArchivedThreadsFrame>
      {threads.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-[#ff6d8d]/35 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]">
          {threads.error.message}
        </div>
      )}

      {!threads.error && threads.isLoading && !threads.data && (
        <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("loadingArchivedThreads")}
        </div>
      )}

      {!threads.error && !threads.isLoading && isEmpty && (
        <div className="rounded-md bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
          {t("noArchivedThreads")}
        </div>
      )}

      {!threads.error && archivedThreads.length > 0 && (
        <div className="space-y-2">
          {archivedThreads.map((thread) => (
            <div
              key={thread.id}
              className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold">
                    {thread.title}
                  </div>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      thread.status === "interrupted"
                        ? "bg-yellow-500"
                        : thread.status === "busy"
                        ? "bg-primary"
                        : "bg-stone-400"
                    )}
                  />
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>
                    {t("archivedAt", {
                      time: formatDate(archivedDate(thread), language),
                    })}
                  </span>
                  {thread.description && (
                    <span className="min-w-0 flex-1 truncate">
                      {thread.description}
                    </span>
                  )}
                </div>
              </div>

              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                aria-label={t("openThread", { title: thread.title })}
              >
                <Link href={`/?assistantId=agent&threadId=${thread.id}`}>
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void restoreThread(thread)}
                disabled={restoringThreadId === thread.id}
                className="h-8 shrink-0 gap-1"
              >
                {restoringThreadId === thread.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                )}
                {t("restore")}
              </Button>
            </div>
          ))}

          {!isReachingEnd && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void threads.setSize(threads.size + 1)}
              disabled={threads.isLoading}
              className="w-full"
            >
              {threads.isLoading ? t("loading") : t("loadMore")}
            </Button>
          )}
        </div>
      )}
    </ArchivedThreadsFrame>
  );
}

export function ArchivedThreadsCard() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<StandaloneConfig | null>(null);

  useEffect(() => {
    setConfig(getConfig());
  }, []);

  if (!config) {
    return (
      <ArchivedThreadsFrame>
        <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("connectingThreadService")}
        </div>
      </ArchivedThreadsFrame>
    );
  }

  const apiKey =
    config.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  return (
    <RemoteAgentProvider
      deploymentUrl={config.deploymentUrl}
      assistantId={config.assistantId}
      apiKey={apiKey}
    >
      <ArchivedThreadsCardContent />
    </RemoteAgentProvider>
  );
}
