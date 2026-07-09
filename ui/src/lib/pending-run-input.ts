"use client";

import type { Message } from "@langchain/langgraph-sdk";

type PendingRunRecord = {
  run_id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: unknown;
  kwargs?: {
    input?: unknown;
  };
};

type PendingRunClient = {
  runs: {
    list(threadId: string, options?: { limit?: number }): Promise<unknown>;
  };
};

export type PendingRunInputPreview = {
  messages: Message[];
  runId?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata: Record<string, unknown>;
};

const PREVIEWABLE_RUN_STATUSES = new Set(["pending", "running", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function messagesFromInput(input: unknown): Message[] {
  if (!isRecord(input) || !Array.isArray(input.messages)) {
    return [];
  }

  return input.messages.flatMap((message): Message[] => {
    if (!isRecord(message)) {
      return [];
    }
    if (typeof message.type === "string") {
      return [message as Message];
    }
    if (typeof message.role !== "string") {
      return [];
    }

    const type =
      message.role === "user"
        ? "human"
        : message.role === "assistant"
        ? "ai"
        : message.role;
    return [{ ...message, type } as Message];
  });
}

function metadataFromRun(run: PendingRunRecord): Record<string, unknown> {
  return isRecord(run.metadata) ? run.metadata : {};
}

export function pendingRunValues(preview: PendingRunInputPreview) {
  return {
    messages: preview.messages,
  };
}

export async function loadPendingRunInputPreview(
  client: PendingRunClient,
  threadId: string
): Promise<PendingRunInputPreview | null> {
  try {
    const runs = (await client.runs.list(threadId, {
      limit: 10,
    })) as PendingRunRecord[];

    for (const run of runs) {
      if (!PREVIEWABLE_RUN_STATUSES.has(run.status ?? "")) {
        continue;
      }

      const messages = messagesFromInput(run.kwargs?.input);
      if (messages.length === 0) {
        continue;
      }

      return {
        messages,
        runId: run.run_id,
        status: run.status,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        metadata: metadataFromRun(run),
      };
    }
  } catch {
    // Pending run input is only a UI fallback; normal state/history loading wins.
  }

  return null;
}
