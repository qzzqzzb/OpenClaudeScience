import useSWRInfinite from "swr/infinite";
import { useMemo } from "react";
import { Client, type Thread } from "@langchain/langgraph-sdk";
import { useAgentRuntime } from "@/providers/AgentRuntimeContext";
import {
  inferThreadDescription,
  inferThreadTitle,
} from "@/app/utils/threadTitle";
import { pendingRunValues } from "@/lib/pending-run-input";
import type { ClientAgentRuntimeAdapter } from "@/lib/agent-runtime";
import {
  messagesFromValues,
  resolveThreadListValues,
} from "@/lib/thread-state";

export interface ThreadItem {
  id: string;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  assistantId?: string;
  metadata: Record<string, unknown>;
  archived: boolean;
}

const DEFAULT_PAGE_SIZE = 20;

async function resolveThreadValues(
  thread: Thread,
  agentRuntime: ClientAgentRuntimeAdapter,
  runtimeClient: Client | null
): Promise<unknown> {
  let pendingRunStatus: string | undefined;

  return resolveThreadListValues({
    threadValues: thread.values,
    loadMainStateValues: async () =>
      (await agentRuntime.getThreadState(thread.thread_id)).values,
    loadPendingValues: async () => {
      const pendingRunPreview = await agentRuntime.getPendingRunInputPreview(
        thread.thread_id
      );
      pendingRunStatus = pendingRunPreview?.status;
      if (!pendingRunPreview) return undefined;
      return {
        ...(thread.values && typeof thread.values === "object"
          ? thread.values
          : {}),
        ...pendingRunValues(pendingRunPreview),
      };
    },
    preferRuntimeValuesBeforePending: () =>
      pendingRunStatus === "pending" || pendingRunStatus === "running",
    loadRuntimeStateValues: runtimeClient
      ? async () =>
          (await runtimeClient.threads.getState(thread.thread_id)).values
      : undefined,
    loadRuntimeThreadValues: runtimeClient
      ? async () => (await runtimeClient.threads.get(thread.thread_id)).values
      : undefined,
    loadRuntimeHistoryValues: runtimeClient
      ? async () => {
          const history = await runtimeClient.threads.getHistory(
            thread.thread_id,
            {
              limit: 80,
            }
          );
          return history.map((state) => state.values);
        }
      : undefined,
  });
}

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
  resourceId?: string;
  runtimeUrl?: string;
  assistantId?: string;
  workspaceId?: string;
  archived?: boolean;
  lightweight?: boolean;
}) {
  const agentRuntime = useAgentRuntime();
  const runtimeClient = useMemo(
    () =>
      props.runtimeUrl
        ? new Client({
            apiUrl: props.runtimeUrl,
            defaultHeaders: { "Content-Type": "application/json" },
          })
        : null,
    [props.runtimeUrl]
  );
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;
  const archived = props.archived ?? false;

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      if (previousPageData && previousPageData.length === 0) {
        return null;
      }

      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: agentRuntime.deploymentUrl,
        assistantId: props.assistantId || agentRuntime.assistantId,
        status: props?.status,
        resourceId: props.resourceId,
        runtimeUrl: props.runtimeUrl,
        workspaceId: props.workspaceId,
        archived,
        lightweight: props.lightweight === true,
      };
    },
    async ({
      assistantId,
      status,
      resourceId,
      workspaceId,
      pageIndex,
      pageSize,
      archived,
      lightweight,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      status?: Thread["status"];
      resourceId?: string;
      runtimeUrl?: string;
      workspaceId?: string;
      archived: boolean;
      lightweight: boolean;
    }) => {
      const threads = await agentRuntime.searchThreads({
        limit: pageSize,
        offset: pageIndex * pageSize,
        status,
        metadata: {
          ...(resourceId ? { resource_id: resourceId } : {}),
          ...(workspaceId ? { internagents_workspace_id: workspaceId } : {}),
          ...(archived ? { internagents_archived: true } : {}),
        },
      });

      const resolvedThreads = await Promise.all(
        threads.map(async (thread) => ({
          thread,
          values: lightweight
            ? thread.values
            : await resolveThreadValues(
                thread,
                agentRuntime,
                runtimeClient
              ),
        }))
      );

      return resolvedThreads
        .map(({ thread, values }): ThreadItem => {
          let title = "Untitled Thread";
          let description = "";
          const metadata =
            thread.metadata && typeof thread.metadata === "object"
              ? (thread.metadata as Record<string, unknown>)
              : {};

          try {
            const valuesRecord =
              values && typeof values === "object" ? (values as any) : null;
            const goal = valuesRecord?.goal;
            const messages = messagesFromValues(values);
            title = inferThreadTitle({
              metadata,
              goal,
              messages,
              fallback: title,
            });
            if (goal?.objective) {
              description = `Goal ${goal.status || "active"}`;
            } else {
              description = inferThreadDescription(messages);
            }
          } catch {
            title = `会话 ${thread.thread_id.slice(0, 8)}`;
          }

          return {
            id: thread.thread_id,
            updatedAt: new Date(thread.updated_at),
            status: thread.status,
            title,
            description,
            assistantId,
            metadata,
            archived: metadata.internagents_archived === true,
          };
        })
        .filter((thread) => (archived ? thread.archived : !thread.archived));
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
    }
  );
}
