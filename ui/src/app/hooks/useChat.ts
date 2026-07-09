"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
  type Run,
  type Thread,
  type ThreadState,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type {
  ChatAttachment,
  GoalState,
  ThreadSkillsState,
  TodoItem,
} from "@/app/types/types";
import type { StreamConfig } from "@/lib/config";
import type {
  AgentRuntimeStreamEvent,
  AgentRuntimeStreamMode,
} from "@/lib/agent-runtime-events";
import { useAgentRuntime } from "@/providers/AgentRuntimeContext";
import { useAgentRuntimeStream } from "@/app/hooks/useAgentRuntimeStream";
import { useQueryState } from "nuqs";
import { useStreamEventLayer } from "@/app/hooks/useStreamEventLayer";
import {
  inferThreadTitle,
  THREAD_TITLE_METADATA_KEY,
  THREAD_TITLE_UPDATED_AT_METADATA_KEY,
} from "@/app/utils/threadTitle";
import {
  type PendingRunInputPreview,
} from "@/lib/pending-run-input";
import {
  createProjectRuntimeClient,
  type ProjectRuntimeClient,
} from "@/lib/project-runtime-client";
import {
  createChatRuntimeFacade,
  type ChatRuntimeFacade,
} from "@/lib/chat-runtime-facade";
import {
  findStateWithMessages,
  mergeValuesWithMessages,
  messagesFromValues,
  stateHasMessages,
} from "@/lib/thread-state";

type RunConfig = Record<string, any>;
type ParsedGoalCommand = {
  objective: string;
  tokenBudget?: number;
};
type RetryMessageOptions = {
  checkpoint?: Checkpoint | null;
  previousMessages?: Message[];
};
type RunLifecycleStatus =
  | "idle"
  | "running"
  | "completed"
  | "interrupted"
  | "error"
  | "stopped";
type RunLifecycle = {
  status: RunLifecycleStatus;
  updatedAt?: number;
  runId?: string;
  threadId?: string;
};
type RuntimeRunSnapshot = {
  runId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type ThreadRecoveryNotice =
  | {
      kind: "failed_run_input";
      runId?: string;
      status?: string;
    }
  | {
      kind: "stale_active_run";
      runId?: string;
      status?: string;
      updatedAt?: string;
    };

const MAX_GOAL_OBJECTIVE_CHARS = 4_000;
const THREAD_SNAPSHOT_CACHE_MAX_ENTRIES = 40;
const THREAD_STATUS_METADATA_KEY = "internagents_thread_status";
const THREAD_UPDATED_AT_METADATA_KEY = "internagents_thread_updated_at";
const PENDING_RUN_STATUS_METADATA_KEY = "internagents_pending_run_status";
const THREAD_RECOVERY_KIND_METADATA_KEY = "internagents_recovery_kind";
const THREAD_RECOVERY_FAILED_RUN_INPUT = "failed_run_input";
const STREAM_RECOVERY_VISIBLE_DELAY_MS = 700;
const STALE_ACTIVE_RUN_MS = 10 * 60 * 1000;
const ACTIVE_RUN_STATUSES = new Set(["busy", "pending", "running"]);
const RUNTIME_STREAM_ACTIVE_RUN_STATUSES = new Set(["pending", "running"]);

type ThreadSnapshotCacheEntry = {
  data?: ThreadState<StateType>[];
  updatedAt: number;
  pending?: Promise<ThreadState<StateType>[]>;
  requestId?: number;
};

const threadSnapshotCache = new Map<string, ThreadSnapshotCacheEntry>();
let threadSnapshotRequestSequence = 0;

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  goal?: GoalState | null;
  threadSkills?: ThreadSkillsState | null;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui?: any;
};

type LangGraphContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: string | { url: string; detail?: "auto" | "low" | "high" };
    };

function splitStreamEventName(rawEvent: string): {
  mode: string;
  namespace?: string[];
} {
  const [mode, ...namespace] = rawEvent.split("|");
  return {
    mode,
    namespace: namespace.length > 0 ? namespace : undefined,
  };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isUserInterruptError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as { name?: unknown; message?: unknown };
  return (
    record.name === "UserInterrupt" ||
    record.message === "UserInterrupt" ||
    (typeof record.message === "string" &&
      record.message.includes("UserInterrupt"))
  );
}

function latestActiveRuntimeRun(runs: Run[]): Run | undefined {
  return runs.find((run) =>
    RUNTIME_STREAM_ACTIVE_RUN_STATUSES.has(run.status)
  );
}

function useRuntimeLiveStream({
  runtimeClient,
  runtimeFacade,
  threadId,
  enabled,
  streamMode,
  appendStreamEvent,
  onEvent,
  onSettled,
}: {
  runtimeClient: ProjectRuntimeClient<StateType> | null;
  runtimeFacade: ChatRuntimeFacade<StateType>;
  threadId: string | null;
  enabled: boolean;
  streamMode?: AgentRuntimeStreamMode | AgentRuntimeStreamMode[];
  appendStreamEvent: (event: AgentRuntimeStreamEvent) => void;
  onEvent: () => void;
  onSettled: () => void;
}) {
  const lastEventIdsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (!enabled || !runtimeClient || !threadId) {
      return;
    }

    let cancelled = false;
    let retryTimerId: number | null = null;
    let eventSequence = 0;
    let controller: AbortController | null = null;

    const clearRetryTimer = () => {
      if (retryTimerId === null) return;
      window.clearTimeout(retryTimerId);
      retryTimerId = null;
    };

    const scheduleJoin = (delayMs: number) => {
      if (cancelled) return;
      clearRetryTimer();
      retryTimerId = window.setTimeout(() => {
        retryTimerId = null;
        void joinLatestRuntimeRun();
      }, delayMs);
    };

    const joinLatestRuntimeRun = async () => {
      try {
        const runs = await runtimeFacade.listRuntimeRuns(threadId, { limit: 10 });
        if (cancelled) return;

        const activeRun = latestActiveRuntimeRun(runs);
        if (!activeRun) {
          onSettled();
          scheduleJoin(1_000);
          return;
        }

        const runId = activeRun.run_id;
        const lastEventId = lastEventIdsRef.current.get(runId) ?? "-1";
        controller = new AbortController();

        for await (const event of runtimeFacade.joinRuntimeRunStream({
          threadId,
          runId,
          signal: controller.signal,
          lastEventId,
          streamMode,
        })) {
          if (cancelled) return;

          const rawEvent = String(event.event);
          const { mode, namespace } = splitStreamEventName(rawEvent);
          const eventId =
            event.id ?? `${Date.now()}-${eventSequence++}`;
          if (event.id) {
            lastEventIdsRef.current.set(runId, event.id);
          }

          appendStreamEvent({
            id: `runtime:${runId}:${eventId}`,
            at: Date.now(),
            threadId,
            rawEvent,
            mode,
            namespace: ["remote_runtime_direct", ...(namespace ?? [])],
            data: event.data,
          });
          onEvent();
        }

        onSettled();
        scheduleJoin(1_000);
      } catch (error) {
        if (cancelled || isAbortError(error)) {
          return;
        }
        console.warn("Runtime live stream failed; falling back to snapshot polling", error);
        scheduleJoin(2_000);
      }
    };

    void joinLatestRuntimeRun();

    return () => {
      cancelled = true;
      clearRetryTimer();
      controller?.abort();
    };
  }, [
    appendStreamEvent,
    enabled,
    onEvent,
    onSettled,
    runtimeClient,
    runtimeFacade,
    streamMode,
    threadId,
  ]);
}

function runtimeRunSnapshot(run?: Run): RuntimeRunSnapshot | null {
  if (!run) {
    return null;
  }
  return {
    runId: run.run_id,
    status: run.status,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function useRuntimeRunSnapshot({
  runtimeClient,
  runtimeFacade,
  threadId,
  enabled,
}: {
  runtimeClient: ProjectRuntimeClient<StateType> | null;
  runtimeFacade: ChatRuntimeFacade<StateType>;
  threadId: string | null;
  enabled: boolean;
}): RuntimeRunSnapshot | null {
  const [snapshot, setSnapshot] = useState<RuntimeRunSnapshot | null>(null);

  useEffect(() => {
    if (!enabled || !runtimeClient || !threadId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      try {
        const runs = await runtimeFacade.listRuntimeRuns(threadId, { limit: 10 });
        if (cancelled) {
          return;
        }
        const activeRun = latestActiveRuntimeRun(runs);
        setSnapshot(runtimeRunSnapshot(activeRun ?? runs[0]));
      } catch {
        if (!cancelled) {
          setSnapshot(null);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, runtimeClient, runtimeFacade, threadId]);

  return snapshot;
}

function threadToState(
  threadId: string,
  thread: Thread<StateType>
): ThreadState<StateType> {
  const rawValues =
    thread.values && typeof thread.values === "object" ? thread.values : {};
  const values = rawValues as Partial<StateType>;

  return {
    values: {
      ...values,
      messages: Array.isArray(values.messages) ? values.messages : [],
    } as StateType,
    next: [],
    tasks: [],
    metadata:
      thread.metadata && typeof thread.metadata === "object"
        ? {
            ...(thread.metadata as Record<string, unknown>),
            ...(typeof thread.updated_at === "string"
              ? { [THREAD_UPDATED_AT_METADATA_KEY]: thread.updated_at }
              : {}),
            ...(typeof thread.status === "string"
              ? { [THREAD_STATUS_METADATA_KEY]: thread.status }
              : {}),
          }
        : typeof thread.status === "string"
        ? {
            ...(typeof thread.updated_at === "string"
              ? { [THREAD_UPDATED_AT_METADATA_KEY]: thread.updated_at }
              : {}),
            [THREAD_STATUS_METADATA_KEY]: thread.status,
          }
        : {},
    created_at: thread.updated_at,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  };
}

function emptyThreadState(threadId: string): ThreadState<StateType> {
  const now = new Date().toISOString();
  return sanitizeThreadState({
    values: {
      messages: [],
      todos: [],
      files: {},
      goal: null,
      threadSkills: null,
    },
    next: [],
    tasks: [],
    metadata: {},
    created_at: now,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  });
}

function pendingRunToState(
  threadId: string,
  preview: PendingRunInputPreview
): ThreadState<StateType> {
  const now = new Date().toISOString();
  const isFailedRunInputRecovery = preview.status === "error";

  return sanitizeThreadState({
    values: {
      messages: preview.messages,
      todos: [],
      files: {},
      goal: null,
      threadSkills: null,
    },
    next: [],
    tasks: [],
    metadata: {
      ...preview.metadata,
      internagents_pending_run_id: preview.runId,
      internagents_pending_run_status: preview.status,
      ...(isFailedRunInputRecovery
        ? {
            [THREAD_RECOVERY_KIND_METADATA_KEY]:
              THREAD_RECOVERY_FAILED_RUN_INPUT,
          }
        : {}),
    },
    created_at: preview.updatedAt ?? preview.createdAt ?? now,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  });
}

function mergePendingRunState(
  threadId: string,
  primaryState: ThreadState<StateType> | null,
  preview: PendingRunInputPreview
): ThreadState<StateType> {
  const pendingState = pendingRunToState(threadId, preview);
  return primaryState
    ? mergeStateSnapshot(primaryState, pendingState)
    : pendingState;
}

function attachPendingRunMetadata(
  threadId: string,
  state: ThreadState<StateType>,
  preview: PendingRunInputPreview
): ThreadState<StateType> {
  const pendingState = pendingRunToState(threadId, preview);
  return sanitizeThreadState({
    ...state,
    metadata: {
      ...(state.metadata || {}),
      ...(pendingState.metadata || {}),
    },
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

function isThreadNotFoundError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.response?.status === "number"
      ? record.response.status
      : undefined;
  if (status === 404) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return (
    /\b404\b/.test(message) ||
    message.includes("not found") ||
    message.includes("thread not found")
  );
}

function stateHasInterrupts(state?: ThreadState<StateType> | null): boolean {
  const values = state?.values as Record<string, unknown> | undefined;
  if (
    Array.isArray(values?.__interrupt__) &&
    values.__interrupt__.length > 0
  ) {
    return true;
  }

  return (
    state?.tasks?.some((task: any) => {
      return Array.isArray(task?.interrupts) && task.interrupts.length > 0;
    }) ?? false
  );
}

function isSyntheticBreakpointInterrupt(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.when === "breakpoint" && !("value" in record);
}

function hasActionableInterrupt(interrupt: unknown): boolean {
  if (!interrupt) {
    return false;
  }

  const interrupts = Array.isArray(interrupt) ? interrupt : [interrupt];
  return interrupts.some((item) => !isSyntheticBreakpointInterrupt(item));
}

function sanitizeThreadState(
  state: ThreadState<StateType>
): ThreadState<StateType> {
  return {
    ...state,
    checkpoint: {
      ...state.checkpoint,
      checkpoint_map: state.checkpoint.checkpoint_map ?? {},
    },
    parent_checkpoint: state.parent_checkpoint
      ? {
          ...state.parent_checkpoint,
          checkpoint_map: state.parent_checkpoint.checkpoint_map ?? {},
        }
      : null,
  };
}

function cloneStateValues(values: StateType): StateType {
  const cloned = {
    ...(values && typeof values === "object" ? values : {}),
  } as StateType;
  if (Array.isArray(cloned.messages)) {
    cloned.messages = [...cloned.messages];
  }
  return cloned;
}

function cloneThreadState(
  state: ThreadState<StateType>
): ThreadState<StateType> {
  return sanitizeThreadState({
    ...state,
    values: cloneStateValues(state.values),
    next: [...(state.next ?? [])],
    tasks: [...(state.tasks ?? [])],
    metadata:
      state.metadata && typeof state.metadata === "object"
        ? { ...(state.metadata as Record<string, unknown>) }
        : {},
    checkpoint: {
      ...state.checkpoint,
      checkpoint_map: state.checkpoint.checkpoint_map
        ? { ...state.checkpoint.checkpoint_map }
        : {},
    },
    parent_checkpoint: state.parent_checkpoint
      ? {
          ...state.parent_checkpoint,
          checkpoint_map: state.parent_checkpoint.checkpoint_map
            ? { ...state.parent_checkpoint.checkpoint_map }
            : {},
        }
      : null,
  });
}

function cloneThreadStates(
  states: ThreadState<StateType>[]
): ThreadState<StateType>[] {
  return states.map(cloneThreadState);
}

function threadSnapshotCacheKey(
  cacheScope: string,
  threadId: string
): string {
  return `${cacheScope}::${threadId}`;
}

function getCachedThreadSnapshot(
  cacheKey: string
): ThreadState<StateType>[] | undefined {
  const entry = threadSnapshotCache.get(cacheKey);
  if (!entry?.data) {
    return undefined;
  }

  threadSnapshotCache.delete(cacheKey);
  threadSnapshotCache.set(cacheKey, entry);
  return cloneThreadStates(entry.data);
}

function setCachedThreadSnapshot(
  cacheKey: string,
  data: ThreadState<StateType>[],
  requestId?: number
): ThreadState<StateType>[] {
  const cloned = cloneThreadStates(data);
  const existing = threadSnapshotCache.get(cacheKey);
  if (requestId !== undefined && existing?.requestId !== requestId) {
    return getCachedThreadSnapshot(cacheKey) ?? cloneThreadStates(cloned);
  }

  threadSnapshotCache.set(cacheKey, {
    ...existing,
    data: cloned,
    updatedAt: Date.now(),
    pending: undefined,
    requestId,
  });

  while (threadSnapshotCache.size > THREAD_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldestKey = threadSnapshotCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    threadSnapshotCache.delete(oldestKey);
  }

  return cloneThreadStates(cloned);
}

function setPendingThreadSnapshot(
  cacheKey: string,
  pending: Promise<ThreadState<StateType>[]>,
  requestId: number
) {
  const existing = threadSnapshotCache.get(cacheKey);
  threadSnapshotCache.set(cacheKey, {
    ...existing,
    updatedAt: existing?.updatedAt ?? 0,
    pending,
    requestId,
  });
}

function clearPendingThreadSnapshot(
  cacheKey: string,
  pending: Promise<ThreadState<StateType>[]>
) {
  const existing = threadSnapshotCache.get(cacheKey);
  if (existing?.pending !== pending) {
    return;
  }
  if (!existing.data) {
    threadSnapshotCache.delete(cacheKey);
    return;
  }
  threadSnapshotCache.set(cacheKey, {
    ...existing,
    pending: undefined,
  });
}

function isActiveThreadSnapshotRequest(
  cacheKey: string,
  requestId?: number
): boolean {
  return (
    requestId === undefined ||
    threadSnapshotCache.get(cacheKey)?.requestId === requestId
  );
}

function hasUsableCheckpoint(
  checkpoint?: Checkpoint | null
): checkpoint is Checkpoint & { checkpoint_id: string } {
  return (
    typeof checkpoint?.checkpoint_id === "string" &&
    checkpoint.checkpoint_id.length > 0
  );
}

function mergeStateValues(
  state: ThreadState<StateType>,
  values: unknown,
  options: { preservePrimaryMessages?: boolean } = {}
): ThreadState<StateType> {
  return sanitizeThreadState({
    ...state,
    values: mergeValuesWithMessages<StateType>(state.values, values, options),
  });
}

function mergeStateSnapshot(
  primaryState: ThreadState<StateType>,
  snapshotState: ThreadState<StateType>,
  options: { preservePrimaryMessages?: boolean } = {}
): ThreadState<StateType> {
  const preservePrimaryMessages =
    options.preservePrimaryMessages && stateHasMessages(primaryState);
  const baseState = preservePrimaryMessages ? primaryState : snapshotState;

  return sanitizeThreadState({
    ...baseState,
    values: mergeValuesWithMessages<StateType>(
      primaryState.values,
      snapshotState.values,
      {
        preservePrimaryMessages,
      }
    ),
    metadata: {
      ...(primaryState.metadata || {}),
      ...(snapshotState.metadata || {}),
    },
  });
}

function mergeThreadRecord(
  state: ThreadState<StateType>,
  thread: Thread<StateType>
): ThreadState<StateType> {
  const mergedState = mergeStateValues(state, thread.values, {
    preservePrimaryMessages: stateHasMessages(state),
  });
  const threadMetadata =
    thread.metadata && typeof thread.metadata === "object"
      ? (thread.metadata as Record<string, unknown>)
      : {};

  return sanitizeThreadState({
    ...mergedState,
    metadata: {
      ...(mergedState.metadata || {}),
      ...threadMetadata,
      ...(typeof thread.updated_at === "string"
        ? { [THREAD_UPDATED_AT_METADATA_KEY]: thread.updated_at }
        : {}),
      ...(typeof thread.status === "string"
        ? { [THREAD_STATUS_METADATA_KEY]: thread.status }
        : {}),
    },
  });
}

function useDelayedBoolean(value: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) {
      setVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return visible;
}

async function loadThreadSnapshot({
  runtimeClient,
  runtimeFacade,
  threadId,
}: {
  runtimeClient: ProjectRuntimeClient<StateType> | null;
  runtimeFacade: ChatRuntimeFacade<StateType>;
  threadId: string;
}): Promise<ThreadState<StateType>[]> {
  let primaryState: ThreadState<StateType> | null = null;
  let primaryError: unknown;
  let hasMainStateMessages = false;

  try {
    const mainState = sanitizeThreadState(
      await runtimeFacade.getMainThreadState<StateType>(threadId)
    );
    primaryState = mainState;
    hasMainStateMessages = stateHasMessages(mainState);
  } catch (error) {
    primaryError = error;
  }

  try {
    const threadRecord = await runtimeFacade.getMainThread<StateType>(threadId);
    const threadState = primaryState
      ? mergeThreadRecord(primaryState, threadRecord)
      : threadToState(threadId, threadRecord);
    if (hasMainStateMessages && stateHasMessages(threadState)) {
      return [sanitizeThreadState(threadState)];
    }
    primaryState = threadState;
  } catch (error) {
    primaryError ??= error;
  }

  try {
    const mainHistory = await runtimeFacade.getMainThreadHistory<StateType>({
      threadId,
      limit: 80,
    });
    const sanitizedHistory = mainHistory.map(sanitizeThreadState);
    const mainStateWithMessages = findStateWithMessages(sanitizedHistory);
    if (mainStateWithMessages) {
      return [mainStateWithMessages];
    }
    if (!primaryState && sanitizedHistory[0]) {
      primaryState = sanitizedHistory[0];
    }
  } catch (error) {
    // The latest thread record above is enough for normal main-service threads.
    primaryError ??= error;
  }

  if (!primaryState && isThreadNotFoundError(primaryError)) {
    return [emptyThreadState(threadId)];
  }

  if (hasMainStateMessages && stateHasMessages(primaryState)) {
    return [sanitizeThreadState(primaryState)];
  }

  const pendingRunPreview = await runtimeFacade.getPendingRunInputPreview(
    threadId
  );
  if (pendingRunPreview?.status === "error") {
    return [mergePendingRunState(threadId, primaryState, pendingRunPreview)];
  }

  if (!pendingRunPreview && stateHasMessages(primaryState)) {
    return [sanitizeThreadState(primaryState)];
  }

  const hasTrustedPrimaryMessages = () =>
    hasMainStateMessages && stateHasMessages(primaryState);
  const mergeRuntimeState = (runtimeState: ThreadState<StateType>) => {
    const mergedState = primaryState
      ? mergeStateSnapshot(primaryState, runtimeState, {
          preservePrimaryMessages: hasTrustedPrimaryMessages(),
        })
      : sanitizeThreadState(runtimeState);
    return pendingRunPreview
      ? attachPendingRunMetadata(threadId, mergedState, pendingRunPreview)
      : mergedState;
  };

  if (runtimeClient) {
    try {
      const runtimeState = sanitizeThreadState(
        await runtimeFacade.getRuntimeThreadState<StateType>(threadId)
      );
      if (stateHasMessages(runtimeState)) {
        return [mergeRuntimeState(runtimeState)];
      }
      if (!primaryState) {
        primaryState = runtimeState;
      }
    } catch {
      // Runtime may not have a materialized state for queued main-service runs.
    }

    try {
      const runtimeThread = await runtimeFacade.getRuntimeThread<StateType>(
        threadId
      );
      const runtimeState = threadToState(threadId, runtimeThread);
      if (stateHasMessages(runtimeState)) {
        return [mergeRuntimeState(runtimeState)];
      }
    } catch {
      // Runtime may not know about every main-service thread.
    }

    try {
      const runtimeHistory = await runtimeFacade.getRuntimeThreadHistory<StateType>(
        threadId,
        { limit: 80 }
      );
      const runtimeStateWithMessages = findStateWithMessages(runtimeHistory);
      if (runtimeStateWithMessages) {
        return [mergeRuntimeState(runtimeStateWithMessages)];
      }
    } catch {
      // Keep the primary snapshot below if runtime history is unavailable.
    }
  }

  if (pendingRunPreview) {
    return [mergePendingRunState(threadId, primaryState, pendingRunPreview)];
  }

  if (stateHasMessages(primaryState)) {
    return [sanitizeThreadState(primaryState)];
  }

  if (primaryState) {
    return [sanitizeThreadState(primaryState)];
  }
  throw primaryError;
}

function useThreadSnapshot({
  runtimeClient,
  runtimeFacade,
  threadId,
  externalThread,
  cacheScope,
}: {
  runtimeClient: ProjectRuntimeClient<StateType> | null;
  runtimeFacade: ChatRuntimeFacade<StateType>;
  threadId: string | null;
  externalThread?: UseStreamThread<StateType>;
  cacheScope: string;
}): UseStreamThread<StateType> | undefined {
  const requestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    cacheKey: string | null;
    threadId: string | null;
    data: ThreadState<StateType>[] | null | undefined;
    error: unknown;
    isLoading: boolean;
  }>(() => {
    const initialCacheKey = threadId
      ? threadSnapshotCacheKey(cacheScope, threadId)
      : null;
    const cachedData = initialCacheKey
      ? getCachedThreadSnapshot(initialCacheKey)
      : undefined;

    return {
      cacheKey: initialCacheKey,
      threadId,
      data: cachedData,
      error: undefined,
      isLoading: Boolean(threadId && !cachedData),
    };
  });

  const mutate = useCallback(
    async (mutateId?: string) => {
      const targetThreadId = mutateId ?? threadId;
      const requestId = ++requestIdRef.current;

      if (!targetThreadId) {
        const empty = {
          cacheKey: null,
          threadId: null,
          data: undefined,
          error: undefined,
          isLoading: false,
        };
        setSnapshot(empty);
        return empty.data;
      }

      const cacheKey = threadSnapshotCacheKey(cacheScope, targetThreadId);
      const cachedData = getCachedThreadSnapshot(cacheKey);

      setSnapshot((current) => ({
        ...current,
        cacheKey,
        threadId: targetThreadId,
        data:
          cachedData ??
          (current.cacheKey === cacheKey ? current.data : undefined),
        error: undefined,
        isLoading: true,
      }));

      let pending: Promise<ThreadState<StateType>[]> | undefined;
      let cacheRequestId: number | undefined;
      try {
        const existingEntry = threadSnapshotCache.get(cacheKey);
        const existingPending = existingEntry?.data
          ? undefined
          : existingEntry?.pending;
        if (existingPending) {
          pending = existingPending;
          cacheRequestId = existingEntry?.requestId;
        } else {
          pending = loadThreadSnapshot({
            runtimeClient,
            runtimeFacade,
            threadId: targetThreadId,
          });
          cacheRequestId = ++threadSnapshotRequestSequence;
          setPendingThreadSnapshot(cacheKey, pending, cacheRequestId);
        }

        const data = await pending;
        if (!isActiveThreadSnapshotRequest(cacheKey, cacheRequestId)) {
          return getCachedThreadSnapshot(cacheKey) ?? cloneThreadStates(data);
        }

        const cachedResult = setCachedThreadSnapshot(
          cacheKey,
          data,
          cacheRequestId
        );
        if (
          requestIdRef.current === requestId &&
          isActiveThreadSnapshotRequest(cacheKey, cacheRequestId)
        ) {
          setSnapshot({
            cacheKey,
            threadId: targetThreadId,
            data: cachedResult,
            error: undefined,
            isLoading: false,
          });
        }
        return cloneThreadStates(cachedResult);
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setSnapshot((current) => ({
            ...current,
            cacheKey,
            data:
              current.cacheKey === cacheKey
                ? current.data
                : getCachedThreadSnapshot(cacheKey),
            error,
            isLoading: false,
          }));
        }
        throw error;
      } finally {
        if (pending) {
          clearPendingThreadSnapshot(cacheKey, pending);
        }
      }
    },
    [cacheScope, runtimeClient, runtimeFacade, threadId]
  );

  useEffect(() => {
    if (externalThread) {
      return;
    }
    void mutate(threadId ?? undefined).catch(() => undefined);
  }, [externalThread, mutate, threadId]);

  return useMemo(() => {
    if (externalThread) {
      return externalThread;
    }
    return {
      data: snapshot.data,
      error: snapshot.error,
      isLoading: snapshot.isLoading,
      mutate,
    };
  }, [
    externalThread,
    mutate,
    snapshot.data,
    snapshot.error,
    snapshot.isLoading,
  ]);
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function workspaceRuntimePath(value: string): string {
  return value.replace(/^\/+/, "") || ".";
}

function workspacePathAttributes(
  logicalName: string,
  runtimeName: string,
  value?: string
): string {
  if (!value) {
    return "";
  }
  return ` ${logicalName}="${formatAttachmentAttribute(
    value
  )}" ${runtimeName}="${formatAttachmentAttribute(workspaceRuntimePath(value))}"`;
}

function describeWorkspacePath(label: string, value: string): string {
  const runtimePath = workspaceRuntimePath(value);
  return `${label}: use ${value} with file tools; use ${runtimePath} in shell commands or inside scripts.`;
}

function attachmentMetadata(attachments: ChatAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    workspacePath: attachment.workspacePath,
    extractedWorkspacePath: attachment.extractedWorkspacePath,
    extractedTextSize: attachment.extractedTextSize,
    pageCount: attachment.pageCount,
    extractedPageCount: attachment.extractedPageCount,
    truncated: attachment.truncated,
    extractionError: attachment.extractionError,
    error: attachment.error,
  }));
}

function buildMessageContent(content: string, attachments: ChatAttachment[]) {
  const validAttachments = attachments.filter(
    (attachment) => !attachment.error
  );
  if (validAttachments.length === 0) {
    return content;
  }

  const blocks: LangGraphContentBlock[] = [
    {
      type: "text",
      text: content.trim() || "请查看附件。",
    },
  ];

  for (const attachment of validAttachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      blocks.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl },
      });
      continue;
    }

    if (attachment.kind === "text" && attachment.text !== undefined) {
      blocks.push({
        type: "text",
        text: [
          `<attachment name="${attachment.name}" mime_type="${
            attachment.mimeType
          }" size="${formatAttachmentSize(attachment.size)}">`,
          attachment.truncated
            ? `${attachment.text}\n\n[Attachment truncated before sending.]`
            : attachment.text,
          "</attachment>",
        ].join("\n"),
      });
      continue;
    }

    if (attachment.kind === "pdf") {
      const pathHint = workspacePathAttributes(
        "logical_path",
        "runtime_path",
        attachment.workspacePath
      );
      const extractedPathHint = workspacePathAttributes(
        "extracted_logical_path",
        "extracted_runtime_path",
        attachment.extractedWorkspacePath
      );
      const pagesHint = attachment.pageCount
        ? ` pages="${attachment.pageCount}"`
        : "";
      const extractedPagesHint = attachment.extractedPageCount
        ? ` extracted_pages="${attachment.extractedPageCount}"`
        : "";
      const extractionError = attachment.extractionError?.trim();
      const extractedText = attachment.text?.trim();
      const originalPdfLocation = attachment.workspacePath
        ? describeWorkspacePath("Original PDF", attachment.workspacePath)
        : "";
      const extractedTextLocation = attachment.extractedWorkspacePath
        ? describeWorkspacePath(
            "Extracted text file",
            attachment.extractedWorkspacePath
          )
        : "";
      const body = attachment.extractedWorkspacePath
        ? [
            `[PDF uploaded and processed locally. ${extractedTextLocation} Use the extracted text file first for reading, summarization, and question answering.`,
            originalPdfLocation,
            attachment.truncated
              ? "The extracted text is truncated; use the original PDF only when additional pages, layout, figures, or tables are needed."
              : "Use the original PDF only when layout, figures, or tables are needed.",
            extractionError
              ? `Local extraction reported: ${extractionError}`
              : "",
            "]",
          ]
            .filter(Boolean)
            .join(" ")
        : extractedText
        ? attachment.truncated
          ? `${extractedText}\n\n[PDF text truncated before sending. ${
              originalPdfLocation ||
              "Use the workspace path above for the original PDF."
            }]`
          : extractedText
        : `[PDF uploaded. ${
            originalPdfLocation ||
            "Use the workspace path above for the original PDF."
          } ${
            extractionError
              ? `Local text extraction failed: ${extractionError}`
              : "No extractable text was found in the uploaded PDF."
          }]`;
      blocks.push({
        type: "text",
        text: [
          `<attachment name="${formatAttachmentAttribute(
            attachment.name
          )}" mime_type="${formatAttachmentAttribute(
            attachment.mimeType || "application/pdf"
          )}" size="${formatAttachmentSize(
            attachment.size
          )}"${pathHint}${extractedPathHint}${pagesHint}${extractedPagesHint}>`,
          body,
          "</attachment>",
        ].join("\n"),
      });
      continue;
    }

    const pathHint = workspacePathAttributes(
      "logical_path",
      "runtime_path",
      attachment.workspacePath
    );
    const readablePathHint = workspacePathAttributes(
      "readable_logical_path",
      "readable_runtime_path",
      attachment.extractedWorkspacePath
    );
    const fileLocation = attachment.workspacePath
      ? describeWorkspacePath("Original file", attachment.workspacePath)
      : "No workspace path is available for this file.";
    const readableLocation = attachment.extractedWorkspacePath
      ? describeWorkspacePath(
          "Readable summary file",
          attachment.extractedWorkspacePath
        )
      : "";
    const readableSummary = attachment.text?.trim();
    const extractionError = attachment.extractionError?.trim();
    blocks.push({
      type: "text",
      text: [
        `<attachment name="${formatAttachmentAttribute(
          attachment.name
        )}" mime_type="${formatAttachmentAttribute(
          attachment.mimeType || "application/octet-stream"
        )}" size="${formatAttachmentSize(
          attachment.size
        )}"${pathHint}${readablePathHint}>`,
        readableSummary
          ? [
              `[Office file uploaded and processed locally. ${fileLocation} ${readableLocation} Use the readable summary first for reading, summarization, and question answering; use the original file when layout, images, formulas, or manual inspection are needed.${
                attachment.truncated
                  ? " The summary shown in this message is truncated."
                  : ""
              }${
                extractionError
                  ? ` Local extraction reported: ${extractionError}`
                  : ""
              }]`,
              "",
              readableSummary,
            ].join("\n")
          : `[File uploaded. ${fileLocation} Binary content is not embedded in this message.]`,
        "</attachment>",
      ].join("\n"),
    });
  }

  return blocks;
}

function cloneMessageContent(content: Message["content"]): Message["content"] {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((block) =>
    block && typeof block === "object" ? { ...block } : block
  ) as Message["content"];
}

function parseGoalCommand(content: string): ParsedGoalCommand | null {
  const match = content.trim().match(/^\/goal(?:\s+([\s\S]+))?$/i);
  const rawObjective = match?.[1]?.trim();
  if (!rawObjective || rawObjective.length > MAX_GOAL_OBJECTIVE_CHARS) {
    return null;
  }

  const budgetMatch = rawObjective.match(
    /^(?:--tokens|--token-budget)\s+(\d+)\s+([\s\S]+)$/i
  );
  if (!budgetMatch) {
    return { objective: rawObjective };
  }

  const tokenBudget = Number.parseInt(budgetMatch[1], 10);
  const objective = budgetMatch[2].trim();
  if (!objective || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    return { objective: rawObjective };
  }

  return { objective, tokenBudget };
}

function createGoalState(
  goalCommand: ParsedGoalCommand,
  threadId: string
): GoalState {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: uuidv4(),
    threadId,
    objective: goalCommand.objective,
    status: "active",
    tokenBudget: goalCommand.tokenBudget ?? null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeThreadSkills(value: unknown): ThreadSkillsState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<ThreadSkillsState>;
  const revision =
    typeof record.revision === "number" && Number.isFinite(record.revision)
      ? Math.max(0, Math.floor(record.revision))
      : 0;
  const active = Array.isArray(record.active)
    ? record.active.filter(
        (skill) =>
          skill &&
          typeof skill.key === "string" &&
          typeof skill.name === "string" &&
          typeof skill.description === "string" &&
          typeof skill.relativePath === "string" &&
          typeof skill.folderName === "string"
      )
    : [];

  return { revision, active };
}

function hasThreadSkills(value: ThreadSkillsState | null | undefined): boolean {
  return Boolean(value?.active?.length);
}

export function useChat({
  activeAssistant,
  streamConfig,
  onHistoryRevalidate,
  onGeneratedThreadId,
  thread,
  resourceId,
  resourceLabel,
  runtimeUrl,
  workspaceId,
  workspacePath,
  workspaceLabel,
}: {
  activeAssistant: Assistant | null;
  streamConfig: StreamConfig;
  onHistoryRevalidate?: () => void;
  onGeneratedThreadId?: (threadId: string) => void;
  thread?: UseStreamThread<StateType>;
  resourceId?: string;
  resourceLabel?: string;
  runtimeUrl?: string;
  workspaceId?: string;
  workspacePath?: string;
  workspaceLabel?: string;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [optimisticThreadTitle, setOptimisticThreadTitle] = useState<
    string | null
  >(null);
  const [pendingThreadSkills, setPendingThreadSkills] =
    useState<ThreadSkillsState | null>(null);
  const [optimisticThreadSkills, setOptimisticThreadSkills] =
    useState<ThreadSkillsState | null>(null);
  const threadSkillsRef = useRef<ThreadSkillsState | null>(null);
  const [runLifecycle, setRunLifecycle] = useState<RunLifecycle>({
    status: "idle",
  });
  const [localRunInFlight, setLocalRunInFlight] = useState(false);
  const [visibleError, setVisibleError] = useState<unknown>();
  const previousThreadIdRef = useRef<string | null>(threadId ?? null);
  const pendingNewThreadTitleRef = useRef<string | null>(null);
  const pendingNewThreadTitleThreadIdRef = useRef<string | null>(null);
  const runtimeStreamRefreshTimerRef = useRef<number | null>(null);
  const agentRuntime = useAgentRuntime();
  const runtimeClient = useMemo(
    () =>
      runtimeUrl
        ? createProjectRuntimeClient<StateType>(runtimeUrl)
        : null,
    [runtimeUrl]
  );
  const runtimeFacade = useMemo(
    () =>
      createChatRuntimeFacade<StateType>({
        agentRuntime,
        runtimeClient,
        runtimeUrl,
        resourceId,
        workspaceId,
      }),
    [agentRuntime, resourceId, runtimeClient, runtimeUrl, workspaceId]
  );
  const streamEventLayer = useStreamEventLayer(agentRuntime, threadId ?? null);
  const { clearStreamEvents } = streamEventLayer;
  const threadSnapshotCacheScope = runtimeFacade.cacheScope;
  const markRunStarting = useCallback(() => {
    setVisibleError(undefined);
    setLocalRunInFlight(true);
    setRunLifecycle({
      status: "running",
      updatedAt: Date.now(),
    });
  }, []);
  const threadSnapshot = useThreadSnapshot({
    runtimeClient,
    runtimeFacade,
    threadId: threadId ?? null,
    externalThread: thread,
    cacheScope: threadSnapshotCacheScope,
  });
  const runtimeRunSnapshot = useRuntimeRunSnapshot({
    runtimeClient,
    runtimeFacade,
    threadId: threadId ?? null,
    enabled: Boolean(threadId && runtimeClient),
  });
  const threadMetadata = useMemo(() => {
    const metadata = threadSnapshot?.data?.[0]?.metadata;
    return metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  }, [threadSnapshot?.data]);
  const threadStatus =
    typeof threadMetadata[THREAD_STATUS_METADATA_KEY] === "string"
      ? threadMetadata[THREAD_STATUS_METADATA_KEY]
      : null;
  const pendingRunStatus =
    typeof threadMetadata[PENDING_RUN_STATUS_METADATA_KEY] === "string"
      ? threadMetadata[PENDING_RUN_STATUS_METADATA_KEY]
      : null;
  const detectedActiveRun =
    (threadStatus ? ACTIVE_RUN_STATUSES.has(threadStatus) : false) ||
    (pendingRunStatus ? ACTIVE_RUN_STATUSES.has(pendingRunStatus) : false) ||
    (runtimeRunSnapshot?.status
      ? ACTIVE_RUN_STATUSES.has(runtimeRunSnapshot.status)
      : false);
  const snapshotHasActiveRun =
    runLifecycle.status !== "stopped" && detectedActiveRun;
  const snapshotHasSettledRunState =
    Boolean(threadStatus) && !snapshotHasActiveRun;

  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const nextThreadId = threadId ?? null;

    if (previousThreadId === nextThreadId) return;

    previousThreadIdRef.current = nextThreadId;
    const shouldCarryPendingTitle =
      Boolean(nextThreadId) &&
      pendingNewThreadTitleThreadIdRef.current === nextThreadId &&
      Boolean(pendingNewThreadTitleRef.current);

    if (!shouldCarryPendingTitle) {
      pendingNewThreadTitleRef.current = null;
      pendingNewThreadTitleThreadIdRef.current = null;
      setOptimisticThreadTitle(null);
    }
    setPendingThreadSkills(null);
    setOptimisticThreadSkills(null);
    threadSkillsRef.current = null;
  }, [threadId]);

  const streamSubmitOptions = useMemo(
    () => agentRuntime.getStreamSubmitOptions(streamConfig),
    [agentRuntime, streamConfig]
  );

  const workspaceMetadata = useMemo(
    () => ({
      ...(resourceId ? { resource_id: resourceId } : {}),
      ...(resourceLabel ? { resource_label: resourceLabel } : {}),
      ...(workspaceId ? { internagents_workspace_id: workspaceId } : {}),
      ...(workspacePath ? { internagents_workspace_path: workspacePath } : {}),
      ...(workspaceLabel
        ? { internagents_workspace_label: workspaceLabel }
        : {}),
    }),
    [resourceId, resourceLabel, workspaceId, workspacePath, workspaceLabel]
  );

  const buildRunConfig = useCallback(
    (overrides: RunConfig = {}) => {
      const base = (activeAssistant?.config || {}) as RunConfig;
      return {
        ...base,
        ...overrides,
        configurable: {
          ...(base.configurable || {}),
          ...workspaceMetadata,
          ...(overrides.configurable || {}),
        },
        metadata: {
          ...(base.metadata || {}),
          ...workspaceMetadata,
          ...(overrides.metadata || {}),
        },
      };
    },
    [activeAssistant?.config, workspaceMetadata]
  );

  const withStreamSubmitOptions = useCallback(
    <T extends object>(options: T) => ({
      streamResumable: true,
      onDisconnect: "continue" as const,
      ...streamSubmitOptions,
      ...options,
    }),
    [streamSubmitOptions]
  );
  const invalidImplicitCheckpointOptions = useMemo(() => {
    const headCheckpoint = threadSnapshot?.data?.[0]?.checkpoint;
    return hasUsableCheckpoint(headCheckpoint) ? {} : { checkpoint: null };
  }, [threadSnapshot?.data]);
  const handleGeneratedThreadId = useCallback(
    (generatedThreadId: string) => {
      onGeneratedThreadId?.(generatedThreadId);
      setThreadId(generatedThreadId);
      onHistoryRevalidate?.();
      window.setTimeout(() => {
        onHistoryRevalidate?.();
      }, 500);
    },
    [onGeneratedThreadId, onHistoryRevalidate, setThreadId]
  );

  const handleStreamCreated = useCallback(
    (run?: { run_id?: string; thread_id?: string }) => {
      setRunLifecycle({
        status: "running",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamFinish = useCallback(
    (
      state: ThreadState<StateType>,
      run?: { run_id?: string; thread_id?: string }
    ) => {
      setVisibleError(undefined);
      setLocalRunInFlight(false);
      setRunLifecycle({
        status: stateHasInterrupts(state) ? "interrupted" : "completed",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamError = useCallback(
    (error: unknown, run?: { run_id?: string; thread_id?: string }) => {
      if (isUserInterruptError(error)) {
        setVisibleError(undefined);
        setLocalRunInFlight(false);
        setRunLifecycle({
          status: "stopped",
          updatedAt: Date.now(),
          runId: run?.run_id,
          threadId: run?.thread_id,
        });
        onHistoryRevalidate?.();
        return;
      }

      setVisibleError(error);
      setLocalRunInFlight(false);
      setRunLifecycle({
        status: "error",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamStop = useCallback(() => {
    setVisibleError(undefined);
    setLocalRunInFlight(false);
    setRunLifecycle((current) => ({
      ...current,
      status: "stopped",
      updatedAt: Date.now(),
    }));
  }, []);

  const stream = useAgentRuntimeStream<StateType>({
    agentRuntime,
    assistantId: activeAssistant?.assistant_id || "",
    reconnectOnMount: true,
    threadId: threadId ?? null,
    onThreadId: handleGeneratedThreadId,
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    // Enable fetching state history when switching to existing threads
    fetchStateHistory: true,
    // Revalidate thread list when stream finishes, errors, or creates new thread
    onFinish: handleStreamFinish,
    onError: handleStreamError,
    onCreated: handleStreamCreated,
    onStop: handleStreamStop,
    experimental_thread: threadSnapshot,
  });

  const {
    submitSendMessageRun,
    submitRetryMessageRun,
    submitSingleStepRun,
    submitRerunSubagentStepRun,
    submitContinueRun,
    submitResolveThreadRun,
    submitResumeInterruptRun,
    stopCurrentRun,
  } = stream;

  const shouldPollThreadSnapshot =
    Boolean(threadId) &&
    (stream.isLoading ||
      runLifecycle.status === "running" ||
      snapshotHasActiveRun);

  const mutateThreadSnapshot = threadSnapshot?.mutate;

  const refreshThreadSnapshotNow = useCallback(() => {
    if (!threadId || !mutateThreadSnapshot) {
      return;
    }
    if (runtimeStreamRefreshTimerRef.current !== null) {
      window.clearTimeout(runtimeStreamRefreshTimerRef.current);
      runtimeStreamRefreshTimerRef.current = null;
    }
    void mutateThreadSnapshot(threadId).catch(() => undefined);
  }, [mutateThreadSnapshot, threadId]);

  const refreshThreadSnapshotSoon = useCallback(() => {
    if (!threadId || !mutateThreadSnapshot) {
      return;
    }
    if (runtimeStreamRefreshTimerRef.current !== null) {
      return;
    }
    runtimeStreamRefreshTimerRef.current = window.setTimeout(() => {
      runtimeStreamRefreshTimerRef.current = null;
      void mutateThreadSnapshot(threadId).catch(() => undefined);
    }, 500);
  }, [mutateThreadSnapshot, threadId]);

  useEffect(() => {
    return () => {
      if (runtimeStreamRefreshTimerRef.current === null) {
        return;
      }
      window.clearTimeout(runtimeStreamRefreshTimerRef.current);
      runtimeStreamRefreshTimerRef.current = null;
    };
  }, [threadId]);

  const shouldSubscribeRuntimeLiveStream =
    Boolean(threadId) &&
    Boolean(runtimeClient) &&
    runLifecycle.status !== "stopped" &&
    (stream.isLoading ||
      localRunInFlight ||
      runLifecycle.status === "running" ||
      snapshotHasActiveRun);

  useRuntimeLiveStream({
    runtimeClient,
    runtimeFacade,
    threadId: threadId ?? null,
    enabled: shouldSubscribeRuntimeLiveStream,
    streamMode: streamSubmitOptions.streamMode,
    appendStreamEvent: streamEventLayer.appendStreamEvent,
    onEvent: refreshThreadSnapshotSoon,
    onSettled: refreshThreadSnapshotNow,
  });

  useEffect(() => {
    if (!shouldPollThreadSnapshot || !mutateThreadSnapshot || !threadId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void mutateThreadSnapshot(threadId);
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldPollThreadSnapshot, threadId, mutateThreadSnapshot]);

  const effectiveStreamValues = useMemo<StateType>(() => {
    const currentValues = stream.values;
    const snapshotValues = threadSnapshot?.data?.[0]?.values;
    const currentMessages = messagesFromValues(currentValues);
    const snapshotMessages = messagesFromValues(snapshotValues);
    const shouldUseSnapshotMessages =
      snapshotMessages.length > 0 &&
      (!stream.isLoading ||
        currentMessages.length === 0 ||
        snapshotMessages.length > currentMessages.length);

    if (!shouldUseSnapshotMessages) {
      return currentValues;
    }

    const currentRecord =
      currentValues && typeof currentValues === "object" ? currentValues : {};
    const snapshotRecord =
      snapshotValues && typeof snapshotValues === "object"
        ? snapshotValues
        : {};

    return {
      ...currentRecord,
      ...snapshotRecord,
      messages: snapshotMessages,
    } as StateType;
  }, [stream.isLoading, stream.values, threadSnapshot?.data]);

  const streamScopeKey = useMemo(
    () =>
      [
        agentRuntime.deploymentUrl,
        activeAssistant?.assistant_id || "",
        resourceId || "",
        workspaceId || "",
        threadId || "__new_thread__",
      ].join("|"),
    [
      agentRuntime.deploymentUrl,
      activeAssistant?.assistant_id,
      resourceId,
      workspaceId,
      threadId,
    ]
  );
  const previousStreamScopeKey = useRef<string | null>(null);

  useEffect(() => {
    if (previousStreamScopeKey.current === streamScopeKey) return;
    previousStreamScopeKey.current = streamScopeKey;
    if (!stream.isLoading) {
      clearStreamEvents();
      setVisibleError(undefined);
      setLocalRunInFlight(false);
      setRunLifecycle({ status: "idle" });
    }
  }, [streamScopeKey, stream.isLoading, clearStreamEvents]);

  const sendMessage = useCallback(
    (
      content: string,
      attachments: ChatAttachment[] = []
    ) => {
      const goalCommand = parseGoalCommand(content);
      const existingGoal = threadId ? stream.values.goal : null;
      const hasActiveGoal = existingGoal?.status === "active";
      const pendingSkills = normalizeThreadSkills(pendingThreadSkills);
      const selectedSkills = normalizeThreadSkills(threadSkillsRef.current);
      const streamSkills = normalizeThreadSkills(stream.values.threadSkills);
      const snapshotSkills = normalizeThreadSkills(
        threadSnapshot?.data?.[0]?.values?.threadSkills
      );
      const runThreadSkills =
        selectedSkills ??
        (threadId ? streamSkills ?? snapshotSkills : pendingSkills);
      const shouldSeedGoal = Boolean(goalCommand && !hasActiveGoal);
      const shouldSeedThreadSkills = hasThreadSkills(runThreadSkills);
      const pendingNewThreadTitle = pendingNewThreadTitleRef.current;
      const newThreadId =
        !threadId &&
        (shouldSeedGoal ||
          shouldSeedThreadSkills ||
          pendingNewThreadTitle)
          ? uuidv4()
          : null;
      const seededGoalThreadId = shouldSeedGoal
        ? threadId ?? newThreadId ?? uuidv4()
        : null;
      const seededGoal =
        shouldSeedGoal && goalCommand && seededGoalThreadId
          ? createGoalState(goalCommand, seededGoalThreadId)
          : null;
      const seededThreadSkills = shouldSeedThreadSkills ? runThreadSkills : null;
      const messageContent = seededGoal
        ? seededGoal.objective
        : content;
      const additionalKwargs = {
        ...(attachments.length > 0
          ? { attachments: attachmentMetadata(attachments) }
          : {}),
        ...(seededGoal
          ? {
              internagents_goal_command: {
                original_content: content,
                goal_id: seededGoal.id,
              },
            }
          : {}),
      };
      const newMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: buildMessageContent(
          messageContent,
          attachments
        ) as Message["content"],
        additional_kwargs:
          Object.keys(additionalKwargs).length > 0
            ? additionalKwargs
            : undefined,
      };
      clearStreamEvents();
      markRunStarting();
      if (newThreadId && pendingNewThreadTitle) {
        pendingNewThreadTitleThreadIdRef.current = newThreadId;
      }
      submitSendMessageRun(
        {
          messages: [newMessage],
          ...(seededGoal ? { goal: seededGoal } : {}),
          ...(seededThreadSkills ? { threadSkills: seededThreadSkills } : {}),
        },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...invalidImplicitCheckpointOptions,
          ...(newThreadId ? { threadId: newThreadId } : {}),
          optimisticValues: (prev: StateType) => ({
            messages: [...(prev.messages ?? []), newMessage],
            ...(seededGoal ? { goal: seededGoal } : {}),
            ...(seededThreadSkills
              ? { threadSkills: seededThreadSkills }
              : {}),
          }),
          config: buildRunConfig(),
          ...(seededGoal ? { durability: "async" as const } : {}),
        })
      );
      // Update thread list immediately when sending a message
      onHistoryRevalidate?.();
    },
    [
      stream,
      clearStreamEvents,
      markRunStarting,
      submitSendMessageRun,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
      pendingThreadSkills,
      threadSnapshot?.data,
      workspaceMetadata,
      invalidImplicitCheckpointOptions,
      threadId,
    ]
  );

  const retryMessage = useCallback(
    (message: Message, options: RetryMessageOptions = {}) => {
      if (message.type !== "human") {
        return;
      }

      const newMessage: Message = {
        ...message,
        id: uuidv4(),
        type: "human",
        content: cloneMessageContent(message.content),
        additional_kwargs: message.additional_kwargs
          ? { ...message.additional_kwargs }
          : undefined,
      };

      clearStreamEvents();
      markRunStarting();
      const checkpointOptions = hasUsableCheckpoint(options.checkpoint)
        ? { checkpoint: { ...options.checkpoint } }
        : invalidImplicitCheckpointOptions;
      submitRetryMessageRun(
        { messages: [newMessage] },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...checkpointOptions,
          optimisticValues: (prev: StateType) => ({
            messages: [
              ...(options.previousMessages ?? prev.messages ?? []),
              newMessage,
            ],
          }),
          config: buildRunConfig(),
        })
      );
      onHistoryRevalidate?.();
    },
    [
      clearStreamEvents,
      markRunStarting,
      submitRetryMessageRun,
      withStreamSubmitOptions,
      workspaceMetadata,
      invalidImplicitCheckpointOptions,
      buildRunConfig,
      onHistoryRevalidate,
    ]
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[]
    ) => {
      clearStreamEvents();
      markRunStarting();
      if (hasUsableCheckpoint(checkpoint)) {
        const submitStepRun = isRerunningSubagent
          ? submitRerunSubagentStepRun
          : submitSingleStepRun;

        submitStepRun(
          undefined,
          withStreamSubmitOptions({
            ...(optimisticMessages
              ? { optimisticValues: { messages: optimisticMessages } }
              : {}),
            checkpoint: checkpoint,
            ...(isRerunningSubagent
              ? { interruptAfter: ["tools"] }
              : { interruptBefore: ["tools"] }),
            config: buildRunConfig(),
          })
        );
      } else {
        submitSingleStepRun(
          { messages },
          withStreamSubmitOptions({
            ...invalidImplicitCheckpointOptions,
            config: buildRunConfig(),
            interruptBefore: ["tools"],
          })
        );
      }
    },
    [
      clearStreamEvents,
      markRunStarting,
      submitRerunSubagentStepRun,
      submitSingleStepRun,
      withStreamSubmitOptions,
      buildRunConfig,
      invalidImplicitCheckpointOptions,
    ]
  );

  const setFiles = useCallback(
    async (files: Record<string, string>) => {
      if (!threadId) return;
      // TODO: missing a way how to revalidate the internal state
      // I think we do want to have the ability to externally manage the state
      await runtimeFacade.updateState({ threadId, values: { files } });
    },
    [runtimeFacade, threadId]
  );

  const updateThreadSkills = useCallback(
    async (nextThreadSkills: ThreadSkillsState | null) => {
      const normalized = normalizeThreadSkills(nextThreadSkills) ?? {
        revision: 0,
        active: [],
      };
      const previous = threadSkillsRef.current;
      threadSkillsRef.current = normalized;
      if (!threadId) {
        setPendingThreadSkills(normalized);
        return;
      }

      setOptimisticThreadSkills(normalized);
      try {
        await runtimeFacade.updateState({
          threadId,
          values: { threadSkills: normalized },
        });
        await threadSnapshot?.mutate?.(threadId);
        onHistoryRevalidate?.();
      } catch (error) {
        threadSkillsRef.current = previous;
        setOptimisticThreadSkills(previous);
        throw error;
      }
    },
    [runtimeFacade, onHistoryRevalidate, threadId, threadSnapshot]
  );

  const isThreadScopedStateLoading = Boolean(
    threadId &&
      (stream.isThreadLoading ||
        (threadSnapshot?.isLoading && !threadSnapshot.data))
  );
  const hasScopedFallbackMessages =
    messagesFromValues(effectiveStreamValues).length > 0;
  const scopedValues = useMemo<StateType>(() => {
    if (!isThreadScopedStateLoading || hasScopedFallbackMessages) {
      return effectiveStreamValues;
    }

    return {
      messages: [],
      todos: [],
      files: {},
      goal: null,
      threadSkills: null,
    };
  }, [
    effectiveStreamValues,
    hasScopedFallbackMessages,
    isThreadScopedStateLoading,
  ]);
  const scopedMessages = useMemo(
    () => messagesFromValues(scopedValues),
    [scopedValues]
  );
  const activeGoal = scopedValues.goal ?? null;
  const activeThreadSkills = useMemo(() => {
    const stateSkills = normalizeThreadSkills(scopedValues.threadSkills);
    const snapshotSkills = normalizeThreadSkills(
      threadSnapshot?.data?.[0]?.values?.threadSkills
    );
    if (optimisticThreadSkills) {
      return optimisticThreadSkills;
    }
    if (stateSkills) {
      return stateSkills;
    }
    if (snapshotSkills) {
      return snapshotSkills;
    }
    if (!threadId) {
      return pendingThreadSkills;
    }
    return null;
  }, [
    optimisticThreadSkills,
    pendingThreadSkills,
    scopedValues.threadSkills,
    threadSnapshot?.data,
    threadId,
  ]);

  useEffect(() => {
    threadSkillsRef.current = activeThreadSkills;
  }, [activeThreadSkills]);

  const threadTitle = useMemo(() => {
    if (optimisticThreadTitle) {
      return optimisticThreadTitle;
    }
    return inferThreadTitle({
      metadata: threadMetadata,
      goal: activeGoal,
      messages: scopedMessages,
      fallback: threadId ? `会话 ${threadId.slice(0, 8)}` : "新会话",
    });
  }, [
    activeGoal,
    optimisticThreadTitle,
    scopedMessages,
    threadId,
    threadMetadata,
  ]);

  const updateThreadTitle = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        throw new Error("标题不能为空。");
      }

      if (!threadId) {
        pendingNewThreadTitleRef.current = trimmed;
        setOptimisticThreadTitle(trimmed);
        return;
      }

      await runtimeFacade.updateThreadMetadata({
        threadId,
        metadata: {
          ...threadMetadata,
          [THREAD_TITLE_METADATA_KEY]: trimmed,
          [THREAD_TITLE_UPDATED_AT_METADATA_KEY]: new Date().toISOString(),
        },
      });
      setOptimisticThreadTitle(trimmed);
      await threadSnapshot?.mutate?.(threadId);
      onHistoryRevalidate?.();
    },
    [
      onHistoryRevalidate,
      runtimeFacade,
      threadId,
      threadMetadata,
      threadSnapshot,
    ]
  );

  useEffect(() => {
    const pendingTitle = pendingNewThreadTitleRef.current;
    if (
      !threadId ||
      !pendingTitle ||
      pendingNewThreadTitleThreadIdRef.current !== threadId
    ) {
      return;
    }

    if (threadMetadata[THREAD_TITLE_METADATA_KEY] === pendingTitle) {
      pendingNewThreadTitleRef.current = null;
      pendingNewThreadTitleThreadIdRef.current = null;
      return;
    }

    let cancelled = false;

    void runtimeFacade
      .updateThreadMetadata({
        threadId,
        metadata: {
          ...threadMetadata,
          [THREAD_TITLE_METADATA_KEY]: pendingTitle,
          [THREAD_TITLE_UPDATED_AT_METADATA_KEY]: new Date().toISOString(),
        },
      })
      .then(async () => {
        if (cancelled) return;
        pendingNewThreadTitleRef.current = null;
        pendingNewThreadTitleThreadIdRef.current = null;
        setOptimisticThreadTitle(pendingTitle);
        await threadSnapshot?.mutate?.(threadId);
        onHistoryRevalidate?.();
      })
      .catch((error) => {
        console.error("Failed to persist pending thread title", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    onHistoryRevalidate,
    runtimeFacade,
    threadId,
    threadMetadata,
    threadSnapshot,
  ]);

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      clearStreamEvents();
      markRunStarting();
      submitContinueRun(
        undefined,
        withStreamSubmitOptions({
          ...invalidImplicitCheckpointOptions,
          config: buildRunConfig(),
          ...(hasTaskToolCall
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        })
      );
      // Update thread list when continuing stream
      onHistoryRevalidate?.();
    },
    [
      clearStreamEvents,
      markRunStarting,
      submitContinueRun,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
      invalidImplicitCheckpointOptions,
    ]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    submitResolveThreadRun(
      null,
      withStreamSubmitOptions({
        ...invalidImplicitCheckpointOptions,
        command: { goto: "__end__", update: null },
      })
    );
    // Update thread list when marking thread as resolved
    onHistoryRevalidate?.();
  }, [
    submitResolveThreadRun,
    withStreamSubmitOptions,
    invalidImplicitCheckpointOptions,
    onHistoryRevalidate,
  ]);

  const resumeInterrupt = useCallback(
    (value: any) => {
      clearStreamEvents();
      markRunStarting();
      submitResumeInterruptRun(
        null,
        withStreamSubmitOptions({
          ...invalidImplicitCheckpointOptions,
          command: { resume: value },
          config: buildRunConfig(),
        })
      );
      // Update thread list when resuming from interrupt
      onHistoryRevalidate?.();
    },
    [
      clearStreamEvents,
      markRunStarting,
      submitResumeInterruptRun,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
      invalidImplicitCheckpointOptions,
    ]
  );

  const stopStream = useCallback(() => {
    setVisibleError(undefined);
    setLocalRunInFlight(false);
    setRunLifecycle((current) => ({
      ...current,
      status: "stopped",
      updatedAt: Date.now(),
    }));
    stopCurrentRun();
  }, [stopCurrentRun]);

  const isRunLoading =
    snapshotHasActiveRun || (stream.isLoading && localRunInFlight);
  const shouldShowStreamRecovery =
    stream.isLoading && !isRunLoading && !snapshotHasSettledRunState;
  const isStreamRecovering = useDelayedBoolean(
    shouldShowStreamRecovery,
    STREAM_RECOVERY_VISIBLE_DELAY_MS
  );

  const activeInterrupt = isThreadScopedStateLoading
    ? undefined
    : stream.interrupt ?? streamEventLayer.interrupt;
  const visibleInterrupt = hasActionableInterrupt(activeInterrupt)
    ? activeInterrupt
    : undefined;
  const runStatus: RunLifecycleStatus = visibleError
    ? "error"
    : visibleInterrupt
    ? "interrupted"
    : isRunLoading
    ? "running"
    : runLifecycle.status;
  const recoveryNotice = useMemo<ThreadRecoveryNotice | null>(() => {
    const recoveryKind = threadMetadata[THREAD_RECOVERY_KIND_METADATA_KEY];
    const runId = threadMetadata.internagents_pending_run_id;
    const hasHumanMessage = scopedMessages.some(
      (message) => message.type === "human"
    );
    const hasNonHumanProgress = scopedMessages.some(
      (message) => message.type !== "human"
    );
    const runtimeRunUpdatedAt = runtimeRunSnapshot?.updatedAt
      ? Date.parse(runtimeRunSnapshot.updatedAt)
      : NaN;
    const threadUpdatedAt =
      typeof threadMetadata[THREAD_UPDATED_AT_METADATA_KEY] === "string"
        ? Date.parse(threadMetadata[THREAD_UPDATED_AT_METADATA_KEY])
        : NaN;
    const hasStaleRuntimeRun =
      snapshotHasActiveRun &&
      runtimeRunSnapshot?.status &&
      ACTIVE_RUN_STATUSES.has(runtimeRunSnapshot.status) &&
      Number.isFinite(runtimeRunUpdatedAt) &&
      Date.now() - runtimeRunUpdatedAt >= STALE_ACTIVE_RUN_MS &&
      hasHumanMessage &&
      !hasNonHumanProgress;
    const hasStaleCoordinatorThread =
      snapshotHasActiveRun &&
      threadStatus &&
      ACTIVE_RUN_STATUSES.has(threadStatus) &&
      Number.isFinite(threadUpdatedAt) &&
      Date.now() - threadUpdatedAt >= STALE_ACTIVE_RUN_MS &&
      hasHumanMessage &&
      !hasNonHumanProgress;

    if ((hasStaleRuntimeRun || hasStaleCoordinatorThread) && !visibleInterrupt) {
      return {
        kind: "stale_active_run",
        runId: runtimeRunSnapshot?.runId,
        status: runtimeRunSnapshot?.status ?? threadStatus ?? undefined,
        updatedAt:
          runtimeRunSnapshot?.updatedAt ??
          (typeof threadMetadata[THREAD_UPDATED_AT_METADATA_KEY] === "string"
            ? threadMetadata[THREAD_UPDATED_AT_METADATA_KEY]
            : undefined),
      };
    }

    if (
      isThreadScopedStateLoading ||
      isRunLoading ||
      visibleInterrupt ||
      recoveryKind !== THREAD_RECOVERY_FAILED_RUN_INPUT ||
      pendingRunStatus !== "error" ||
      hasNonHumanProgress
    ) {
      return null;
    }

    return {
      kind: THREAD_RECOVERY_FAILED_RUN_INPUT,
      runId: typeof runId === "string" ? runId : undefined,
      status: pendingRunStatus,
    };
  }, [
    isRunLoading,
    isThreadScopedStateLoading,
    pendingRunStatus,
    runtimeRunSnapshot,
    scopedMessages,
    snapshotHasActiveRun,
    threadMetadata,
    threadStatus,
    visibleInterrupt,
  ]);

  return {
    stream,
    todos: scopedValues.todos ?? [],
    files: scopedValues.files ?? {},
    goal: activeGoal,
    threadSkills: activeThreadSkills,
    email: scopedValues.email,
    ui: scopedValues.ui,
    threadId,
    resourceId,
    workspaceId,
    threadTitle,
    threadMetadata,
    updateThreadTitle,
    updateThreadSkills,
    setFiles,
    messages: scopedMessages,
    error: visibleError,
    recoveryNotice,
    isLoading: isRunLoading,
    isStreamRecovering,
    isThreadLoading: isThreadScopedStateLoading,
    interrupt: visibleInterrupt,
    runStatus,
    runUpdatedAt: runLifecycle.updatedAt,
    getMessagesMetadata: stream.getMessagesMetadata,
    streamEvents: streamEventLayer.streamEvents,
    protocolEvents: streamEventLayer.protocolEvents,
    clearStreamEvents: streamEventLayer.clearStreamEvents,
    lastUpdateNamespace: streamEventLayer.lastUpdateNamespace,
    sendMessage,
    retryMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
  };
}
