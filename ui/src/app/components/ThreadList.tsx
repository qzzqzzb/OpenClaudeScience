"use client";

import {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format } from "date-fns";
import {
  Archive,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  SquarePen,
  X,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/app/hooks/useLanguage";
import { useAgentRuntime } from "@/providers/AgentRuntimeContext";
import type { ThreadItem } from "@/app/hooks/useThreads";
import { useThreads } from "@/app/hooks/useThreads";

type ThreadGroup = "interrupted" | "today" | "yesterday" | "week" | "older";

const STATUS_COLORS: Record<ThreadItem["status"], string> = {
  idle: "bg-stone-400",
  busy: "bg-primary",
  interrupted: "bg-orange-500",
  error: "bg-red-600",
};

const STALE_BUSY_THREAD_MS = 10 * 60 * 1000;

function isStaleBusyThread(thread: ThreadItem, now = new Date()): boolean {
  return (
    thread.status === "busy" &&
    now.getTime() - thread.updatedAt.getTime() >= STALE_BUSY_THREAD_MS
  );
}

function getThreadColor(thread: ThreadItem, now = new Date()): string {
  if (isStaleBusyThread(thread, now)) {
    return "bg-orange-500";
  }

  return STATUS_COLORS[thread.status] ?? "bg-gray-400";
}

function getThreadBadge(
  thread: ThreadItem,
  labels: {
    possiblyStuck: string;
    attentionRequired: string;
    failed: string;
  },
  now = new Date()
) {
  if (isStaleBusyThread(thread, now)) {
    return {
      label: labels.possiblyStuck,
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }

  if (thread.status === "interrupted") {
    return {
      label: labels.attentionRequired,
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }

  if (thread.status === "error") {
    return {
      label: labels.failed,
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  return null;
}

function formatTime(date: Date, yesterdayLabel: string, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return yesterdayLabel;
  if (days < 7) return format(date, "EEEE");
  return format(date, "MM/dd");
}

function ErrorState({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-red-600">{t("sessionsLoadFailed")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-1.5 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-11 w-full"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center p-5 text-center">
      <MessageSquare className="mb-2 h-8 w-8 text-gray-300" />
      <p className="text-xs text-muted-foreground">{t("noSessions")}</p>
    </div>
  );
}

interface ThreadListProps {
  onThreadSelect: (id: string) => void;
  onNewThread?: () => void;
  onMutateReady?: (mutate: () => void) => void;
  onClose?: () => void;
  onCollapse?: () => void;
  resourceId?: string;
  runtimeUrl?: string;
  assistantId?: string;
  workspaceId?: string;
}

export function ThreadList({
  onThreadSelect,
  onNewThread,
  onMutateReady,
  onClose,
  onCollapse,
  resourceId,
  runtimeUrl,
  assistantId,
  workspaceId,
}: ThreadListProps) {
  const { t } = useLanguage();
  const agentRuntime = useAgentRuntime();
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [archivingThreadId, setArchivingThreadId] = useState<string | null>(
    null
  );

  const threads = useThreads({
    limit: 20,
    resourceId,
    runtimeUrl,
    assistantId,
    workspaceId,
    lightweight: true,
  });

  const flattened = useMemo(() => {
    return threads.data?.flat() ?? [];
  }, [threads.data]);
  const mutateThreads = threads.mutate;
  const hasBusyThreads = useMemo(
    () => flattened.some((thread) => thread.status === "busy"),
    [flattened]
  );

  useEffect(() => {
    if (!hasBusyThreads) return;

    const interval = window.setInterval(() => {
      void mutateThreads();
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [hasBusyThreads, mutateThreads]);

  const isLoadingMore =
    threads.size > 0 && threads.data?.[threads.size - 1] == null;
  const isEmpty = threads.data?.at(0)?.length === 0;
  const isReachingEnd = isEmpty || (threads.data?.at(-1)?.length ?? 0) < 20;

  // Group threads by time and status
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<ThreadGroup, ThreadItem[]> = {
      interrupted: [],
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    flattened.forEach((thread) => {
      if (thread.status === "interrupted" || isStaleBusyThread(thread, now)) {
        groups.interrupted.push(thread);
        return;
      }

      const diff = now.getTime() - thread.updatedAt.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        groups.today.push(thread);
      } else if (days === 1) {
        groups.yesterday.push(thread);
      } else if (days < 7) {
        groups.week.push(thread);
      } else {
        groups.older.push(thread);
      }
    });

    return groups;
  }, [flattened]);

  // Expose thread list revalidation to parent component
  // Use refs to create a stable callback that always calls the latest mutate function
  const onMutateReadyRef = useRef(onMutateReady);
  const mutateRef = useRef(threads.mutate);

  useEffect(() => {
    onMutateReadyRef.current = onMutateReady;
  }, [onMutateReady]);

  useEffect(() => {
    mutateRef.current = threads.mutate;
  }, [threads.mutate]);

  const mutateFn = useCallback(() => {
    mutateRef.current();
  }, []);

  useEffect(() => {
    onMutateReadyRef.current?.(mutateFn);
    // Only run once on mount to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const archiveThread = useCallback(
    async (thread: ThreadItem, event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      setArchivingThreadId(thread.id);
      try {
        await agentRuntime.updateThreadMetadata({
          threadId: thread.id,
          metadata: {
            ...thread.metadata,
            internagents_archived: true,
            internagents_archived_at: new Date().toISOString(),
          },
        });
        if (currentThreadId === thread.id) {
          await setCurrentThreadId(null);
        }
        await threads.mutate();
        toast.success(t("archiveSuccess"));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("archiveFailed");
        toast.error(message);
      } finally {
        setArchivingThreadId(null);
      }
    },
    [agentRuntime, currentThreadId, setCurrentThreadId, t, threads]
  );

  const groupLabels: Record<ThreadGroup, string> = {
    interrupted: t("needsAttention"),
    today: t("today"),
    yesterday: t("yesterday"),
    week: t("thisWeek"),
    older: t("older"),
  };
  const badgeLabels = {
    possiblyStuck: t("possiblyStuck"),
    attentionRequired: t("attentionRequired"),
    failed: t("failed"),
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-sidebar">
      {/* Header with title and actions */}
      <div className="flex min-h-11 flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-card/60 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {onCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onCollapse}
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                  aria-label={t("sessions")}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="center"
                sideOffset={6}
                className="whitespace-nowrap"
              >
                {t("sessions")}
              </TooltipContent>
            </Tooltip>
          )}
          <h2 className="truncate text-sm font-semibold leading-none tracking-tight text-foreground">
            {t("projectSessions")}
          </h2>
        </div>
        <div className="ml-auto flex items-center justify-end gap-1">
          {onNewThread && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onNewThread}
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                  aria-label={t("projectSessions")}
                >
                  <SquarePen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="center"
                sideOffset={6}
                className="whitespace-nowrap"
              >
                {t("newThread")}
              </TooltipContent>
            </Tooltip>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 text-muted-foreground hover:text-primary"
                  aria-label={t("sessions")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="h-0 flex-1">
        {threads.error && <ErrorState message={threads.error.message} />}

        {!threads.error && !threads.data && threads.isLoading && (
          <LoadingState />
        )}

        {!threads.error && !threads.isLoading && isEmpty && (
          <EmptyState />
        )}

        {!threads.error && !isEmpty && (
          <div className="box-border w-full max-w-full overflow-hidden px-4 py-2">
            {(
              Object.keys(groupLabels) as ThreadGroup[]
            ).map((group) => {
              const groupThreads = grouped[group];
              if (groupThreads.length === 0) return null;

              return (
                <div
                  key={group}
                  className="mb-2"
                >
                  <h4 className="m-0 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {groupLabels[group]}
                  </h4>
                  <div className="flex flex-col gap-0.5">
                    {groupThreads.map((thread) => {
                      const threadBadge = getThreadBadge(thread, badgeLabels);

                      return (
                        <div
                          key={thread.id}
                          className={cn(
                            "group/thread flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md pr-1 transition-colors duration-200",
                            "border hover:border-border hover:bg-card",
                            currentThreadId === thread.id
                              ? "border-primary/30 bg-primary/10 hover:bg-primary/10"
                              : "border-transparent bg-transparent"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onThreadSelect(thread.id)}
                            className="w-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md px-2.5 py-2 text-left"
                            aria-current={currentThreadId === thread.id}
                          >
                            <div className="w-full min-w-0 overflow-hidden">
                              {/* Title + Timestamp Row */}
                              <div className="mb-0.5 flex min-w-0 items-center justify-between gap-2">
                                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-foreground">
                                  {thread.title}
                                </h3>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {formatTime(thread.updatedAt, t("yesterday"))}
                                </span>
                              </div>
                              {/* Description + Status Row */}
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <p className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
                                  {thread.description}
                                </p>
                                <div className="flex shrink-0 items-center gap-1">
                                  {threadBadge && (
                                    <span
                                      className={cn(
                                        "rounded border px-1.5 py-0.5 text-[10px] font-medium leading-3",
                                        threadBadge.className
                                      )}
                                    >
                                      {threadBadge.label}
                                    </span>
                                  )}
                                  <div
                                    className={cn(
                                      "h-1.5 w-1.5 rounded-full",
                                      getThreadColor(thread)
                                    )}
                                  />
                                </div>
                              </div>
                            </div>
                          </button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={(event) =>
                                  archiveThread(thread, event)
                                }
                                disabled={archivingThreadId === thread.id}
                                className={cn(
                                  "h-7 w-7 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:text-primary hover:opacity-100",
                                  currentThreadId === thread.id && "opacity-100"
                                )}
                                aria-label={`${t("archiveThread")} ${thread.title}`}
                              >
                                {archivingThreadId === thread.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Archive className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="right"
                              align="center"
                              sideOffset={8}
                              className="whitespace-nowrap"
                            >
                              {t("archiveThread")}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!isReachingEnd && (
              <div className="flex justify-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => threads.setSize(threads.size + 1)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("loading")}
                    </>
                  ) : (
                    t("loadMore")
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
