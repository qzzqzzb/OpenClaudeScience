"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
  Fragment,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Square,
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CheckCircle2,
  Clock,
  Circle,
  Copy,
  FileIcon,
  Hash,
  ImagePlus,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Search,
  Sparkles,
  RotateCcw,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ChatMessage } from "@/app/components/ChatMessage";
import {
  BatchToolApprovalInterrupt,
  ToolApprovalInterrupt,
} from "@/app/components/ToolApprovalInterrupt";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
  ChatAttachment,
  GoalState,
  ThreadSkillItem,
  ThreadSkillsState,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import {
  extractStringFromMessageContent,
  extractVisibleStringFromMessageContent,
} from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { formatChatError } from "@/lib/chat-errors";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { useQueryState } from "nuqs";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  WORKSPACE_FILE_DRAG_MIME,
  createWorkspaceFileDragPayload,
  parseWorkspaceFileDragPayload,
  type WorkspaceFileDragPayload,
} from "@/app/utils/workspaceDrag";
import { normalizeWorkspacePreviewPath } from "@/app/utils/workspacePathLinks";
import type { SkillEntry } from "@/app/skills/types";
import { useThreads, type ThreadItem } from "@/app/hooks/useThreads";
import type { WorkspaceEntry } from "@/app/types/workspace";
import type { CopyKey } from "@/lib/i18n";
import {
  getWorkspaceRawFileBlob,
  searchWorkspace,
  uploadWorkspaceAttachment,
} from "@/app/services/workspaceClient";
import { loadSkills } from "@/app/services/skillsClient";

interface ChatInterfaceProps {
  assistant: Assistant | null;
  headerActions?: React.ReactNode;
  onOpenInspector?: () => void;
  workspaceRoot?: string;
}

interface AttachmentCopy {
  unsupportedType: string;
  imageTooLarge: string;
  pdfTooLarge: string;
  pdfUploadFailed: string;
  officeTooLarge: string;
  uploadFailed: string;
}

const MAX_IMAGE_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_SIZE = 128 * 1024;
const MAX_PDF_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_OFFICE_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_MENTION_OPTIONS = 10;
const MAX_MENTION_WORKSPACE_FILE_RESULTS = 40;
const COMPOSER_DRAFT_QUERY_KEY = "composerDraft";
const ENABLE_SKILL_QUERY_KEY = "enableSkill";
const CHAT_COMPOSER_HASH = "#chat-composer";
const IME_COMPOSITION_END_GRACE_MS = 80;

function normalizeReviewConfig(config: ReviewConfig): ReviewConfig {
  return {
    ...config,
    actionName: config.actionName ?? config.action_name,
    allowedDecisions: config.allowedDecisions ?? config.allowed_decisions,
  };
}

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "css",
  "env.example",
  "gitignore",
  "html",
  "ini",
  "js",
  "json",
  "jsx",
  "lock",
  "log",
  "md",
  "markdown",
  "mdx",
  "mjs",
  "py",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const PDF_ATTACHMENT_EXTENSIONS = new Set(["pdf"]);
const OFFICE_ATTACHMENT_MIME_TYPES: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const OFFICE_ATTACHMENT_EXTENSIONS = new Set(
  Object.keys(OFFICE_ATTACHMENT_MIME_TYPES)
);
const AUTO_ATTACHMENT_THREAD_SKILLS: Record<
  "pdf" | "docx" | "xlsx" | "pptx",
  Omit<ThreadSkillItem, "addedAt">
> = {
  pdf: {
    key: "skills/pdf",
    name: "pdf",
    description: "",
    relativePath: "skills/pdf",
    folderName: "pdf",
  },
  docx: {
    key: "skills/docx",
    name: "docx",
    description: "",
    relativePath: "skills/docx",
    folderName: "docx",
  },
  xlsx: {
    key: "skills/xlsx",
    name: "xlsx",
    description: "",
    relativePath: "skills/xlsx",
    folderName: "xlsx",
  },
  pptx: {
    key: "skills/pptx",
    name: "pptx",
    description: "",
    relativePath: "skills/pptx",
    folderName: "pptx",
  },
};
const AUTO_ATTACHMENT_SKILL_BY_MIME: Record<
  string,
  keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS
> = {
  "application/pdf": "pdf",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};
const AUTO_ATTACHMENT_SKILL_BY_EXTENSION: Record<
  string,
  keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS
> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  xls: "xlsx",
  xlsx: "xlsx",
  ppt: "pptx",
  pptx: "pptx",
};

interface AttachmentUploadContext {
  resourceId?: string;
  workspaceId?: string;
  threadId?: string | null;
}

type ComposerTrigger = "@" | "#" | "/";
type ComposerTriggerKind = "artifact" | "session" | "skill" | "search";

const COMPOSER_TRIGGER_KIND: Record<ComposerTrigger, ComposerTriggerKind> = {
  "@": "artifact",
  "#": "session",
  "/": "skill",
};

interface MentionContext {
  start: number;
  query: string;
  kind: ComposerTriggerKind;
  trigger: ComposerTrigger | null;
}

interface MentionMenuPosition {
  bottom: number;
  left: number;
  width: number;
}

type ComposerSuggestionOption =
  | {
      type: "workspace-file";
      key: string;
      label: string;
      description: string;
      entry: WorkspaceEntry;
    }
  | {
      type: "artifact";
      key: string;
      label: string;
      description: string;
      path: string;
      content: string;
    }
  | {
      type: "thread";
      key: string;
      label: string;
      description: string;
      thread: ThreadItem;
    }
  | {
      type: "skill";
      key: string;
      label: string;
      description: string;
      skill: SkillEntry;
      selectedForThread: boolean;
    }
  | {
      type: "command";
      key: string;
      label: string;
      description: string;
      command: "new-session";
    };

interface ComposerSuggestionSection {
  title: string | null;
  options: ComposerSuggestionOption[];
}

function getMentionContext(
  value: string,
  cursor: number
): MentionContext | null {
  const beforeCursor = value.slice(0, cursor);
  const candidates = (Object.keys(COMPOSER_TRIGGER_KIND) as ComposerTrigger[])
    .map((trigger) => ({
      trigger,
      index: beforeCursor.lastIndexOf(trigger),
    }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => right.index - left.index);

  if (candidates.length === 0) {
    return null;
  }

  const { trigger, index } = candidates[0];
  if (index > 0 && !/\s/.test(beforeCursor[index - 1])) {
    return null;
  }

  const query = beforeCursor.slice(index + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    start: index,
    query,
    kind: COMPOSER_TRIGGER_KIND[trigger],
    trigger,
  };
}

function textMatchesQuery(query: string, values: Array<string | undefined>) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    (value || "").toLowerCase().includes(normalizedQuery)
  );
}

function skillMatchesQuery(skill: SkillEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [skill.name, skill.description, skill.key, skill.relativePath].some(
    (value) => value.toLowerCase().includes(normalizedQuery)
  );
}

function skillMatchesIdentifier(
  skill: SkillEntry,
  identifier: string
): boolean {
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) {
    return false;
  }

  const candidates = [
    skill.key,
    skill.name,
    skill.relativePath,
    skill.folderName,
    skill.relativePath.split("/").pop() ?? "",
    skill.key.split("/").pop() ?? "",
  ];

  return candidates.some(
    (candidate) => candidate.trim().toLowerCase() === normalizedIdentifier
  );
}

function threadSkillFromEntry(skill: SkillEntry): ThreadSkillItem {
  return {
    key: skill.key,
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath,
    folderName: skill.folderName,
    addedAt: Math.floor(Date.now() / 1000),
  };
}

function addThreadSkillItem(
  current: ThreadSkillsState | null | undefined,
  skill: ThreadSkillItem
): ThreadSkillsState {
  const active = current?.active ?? [];
  if (active.some((item) => item.key === skill.key)) {
    return {
      revision: current?.revision ?? 0,
      active,
    };
  }

  return {
    revision: (current?.revision ?? 0) + 1,
    active: [...active, skill],
  };
}

function addThreadSkill(
  current: ThreadSkillsState | null | undefined,
  skill: SkillEntry
): ThreadSkillsState {
  return addThreadSkillItem(current, threadSkillFromEntry(skill));
}

function removeThreadSkill(
  current: ThreadSkillsState | null | undefined,
  skillKey: string
): ThreadSkillsState {
  const active = current?.active ?? [];
  const nextActive = active.filter((skill) => skill.key !== skillKey);

  if (nextActive.length === active.length) {
    return {
      revision: current?.revision ?? 0,
      active,
    };
  }

  return {
    revision: (current?.revision ?? 0) + 1,
    active: nextActive,
  };
}

function autoSkillNamesForAttachment(
  attachment: ChatAttachment
): Set<keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS> {
  const names = new Set<keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS>();
  const mimeSkill =
    AUTO_ATTACHMENT_SKILL_BY_MIME[
      (attachment.mimeType || "").trim().toLowerCase()
    ];
  if (mimeSkill) {
    names.add(mimeSkill);
  }

  if (attachment.kind === "pdf") {
    names.add("pdf");
  }

  const candidates = [
    attachment.name,
    attachment.workspacePath,
    attachment.extractedWorkspacePath,
  ].filter((value): value is string => Boolean(value));
  for (const value of candidates) {
    const extension = getAttachmentFileKey(value);
    const extensionSkill = AUTO_ATTACHMENT_SKILL_BY_EXTENSION[extension];
    if (extensionSkill) {
      names.add(extensionSkill);
    }
  }

  return names;
}

function addAttachmentThreadSkills(
  current: ThreadSkillsState | null | undefined,
  attachments: ChatAttachment[],
  skillDescriptions: Partial<
    Record<keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS, string>
  > = {}
): ThreadSkillsState | null {
  let next = current ?? { revision: 0, active: [] };
  let changed = false;
  const addedAt = Math.floor(Date.now() / 1000);

  for (const attachment of attachments) {
    if (attachment.error) {
      continue;
    }
    for (const skillName of autoSkillNamesForAttachment(attachment)) {
      const template = AUTO_ATTACHMENT_THREAD_SKILLS[skillName];
      if (next.active.some((item) => item.key === template.key)) {
        continue;
      }
      next = addThreadSkillItem(next, {
        ...template,
        description: skillDescriptions[skillName] ?? template.description,
        addedAt,
      });
      changed = true;
    }
  }

  return changed ? next : null;
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatGoalElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes === 0
      ? `${hours}h`
      : `${hours}h ${remainingMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function goalStatusClassName(status: GoalState["status"]): string {
  switch (status) {
    case "complete":
      return "border-success/30 bg-success/10 text-success";
    case "blocked":
      return "border-warning/30 bg-warning/10 text-warning";
    default:
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getAttachmentFileKey(fileName: string): string {
  const lowerName = fileName.trim().toLowerCase();
  if (lowerName === ".env.example") return "env.example";
  if (lowerName === ".gitignore") return "gitignore";
  const parts = lowerName.split(".");
  return parts.length > 1 ? parts[parts.length - 1] || "" : "";
}

function isTextAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    Boolean(mimeType?.startsWith("text/")) ||
    TEXT_ATTACHMENT_EXTENSIONS.has(getAttachmentFileKey(fileName))
  );
}

function isPdfAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    mimeType === "application/pdf" ||
    PDF_ATTACHMENT_EXTENSIONS.has(getAttachmentFileKey(fileName))
  );
}

function isOfficeAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  const fileKey = getAttachmentFileKey(fileName);
  return (
    OFFICE_ATTACHMENT_EXTENSIONS.has(fileKey) ||
    Object.values(OFFICE_ATTACHMENT_MIME_TYPES).includes(
      (mimeType || "").toLowerCase()
    )
  );
}

function isSupportedAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    Boolean(mimeType?.startsWith("image/")) ||
    isPdfAttachmentDescriptor(fileName, mimeType) ||
    isOfficeAttachmentDescriptor(fileName, mimeType) ||
    isTextAttachmentDescriptor(fileName, mimeType)
  );
}

function isTextAttachment(file: File): boolean {
  return isTextAttachmentDescriptor(file.name, file.type);
}

function isPdfAttachment(file: File): boolean {
  return isPdfAttachmentDescriptor(file.name, file.type);
}

function isOfficeAttachment(file: File): boolean {
  return isOfficeAttachmentDescriptor(file.name, file.type);
}

function getAttachmentMimeType(file: File): string {
  const fileKey = getAttachmentFileKey(file.name);
  return (
    file.type ||
    OFFICE_ATTACHMENT_MIME_TYPES[fileKey] ||
    (PDF_ATTACHMENT_EXTENSIONS.has(fileKey) ? "application/pdf" : "") ||
    "application/octet-stream"
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadBinaryAttachment(
  file: File,
  context: AttachmentUploadContext,
  copy: AttachmentCopy
): Promise<Partial<ChatAttachment>> {
  const form = new FormData();
  form.set("file", file);
  if (context.resourceId) {
    form.set("resourceId", context.resourceId);
  }
  if (context.workspaceId) {
    form.set("workspaceId", context.workspaceId);
  }
  if (context.threadId) {
    form.set("threadId", context.threadId);
  }

  return uploadWorkspaceAttachment<Partial<ChatAttachment>>({
    form,
    fallbackMessage: copy.uploadFailed,
  });
}

async function uploadWorkspaceOfficeAttachment(
  payload: WorkspaceFileDragPayload,
  context: AttachmentUploadContext,
  copy: AttachmentCopy
): Promise<Partial<ChatAttachment>> {
  const form = new FormData();
  form.set("workspacePath", payload.path);
  const effectiveResourceId = payload.resourceId || context.resourceId;
  const effectiveWorkspaceId = payload.workspaceId || context.workspaceId;
  if (effectiveResourceId) {
    form.set("resourceId", effectiveResourceId);
  }
  if (effectiveWorkspaceId) {
    form.set("workspaceId", effectiveWorkspaceId);
  }
  if (context.threadId) {
    form.set("threadId", context.threadId);
  }

  return uploadWorkspaceAttachment<Partial<ChatAttachment>>({
    form,
    fallbackMessage: copy.uploadFailed,
  });
}

function writeTextToClipboardFallback(text: string): void {
  const textArea = document.createElement("textarea");
  const selection = document.getSelection();
  const selectedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    document.body.removeChild(textArea);
    if (selection && selectedRange) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard API but still reject it for focus or
      // permission reasons. Fall through to the legacy copy path.
    }
  }

  writeTextToClipboardFallback(text);
}

async function prepareAttachment(
  file: File,
  context: AttachmentUploadContext,
  copy: AttachmentCopy
): Promise<ChatAttachment> {
  const baseAttachment = {
    id: createAttachmentId(),
    name: file.name,
    mimeType: getAttachmentMimeType(file),
    size: file.size,
  };

  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "image",
        error: copy.imageTooLarge,
      };
    }

    return {
      ...baseAttachment,
      kind: "image",
      dataUrl: await readAsDataUrl(file),
    };
  }

  if (isPdfAttachment(file)) {
    if (file.size > MAX_PDF_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "pdf",
        error: copy.pdfTooLarge,
      };
    }

    try {
      const uploaded = await uploadBinaryAttachment(file, context, copy);
      return {
        ...baseAttachment,
        ...uploaded,
        kind: "pdf",
      };
    } catch (error) {
      return {
        ...baseAttachment,
        kind: "pdf",
        error: error instanceof Error ? error.message : copy.pdfUploadFailed,
      };
    }
  }

  if (isOfficeAttachment(file)) {
    if (file.size > MAX_OFFICE_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "file",
        error: copy.officeTooLarge,
      };
    }

    try {
      const uploaded = await uploadBinaryAttachment(file, context, copy);
      return {
        ...baseAttachment,
        ...uploaded,
        kind: "file",
      };
    } catch (error) {
      return {
        ...baseAttachment,
        kind: "file",
        error: error instanceof Error ? error.message : copy.uploadFailed,
      };
    }
  }

  if (isTextAttachment(file)) {
    const slice = file.slice(0, MAX_TEXT_ATTACHMENT_SIZE);
    return {
      ...baseAttachment,
      kind: "text",
      text: await slice.text(),
      truncated: file.size > MAX_TEXT_ATTACHMENT_SIZE,
    };
  }

  return {
    ...baseAttachment,
    kind: "file",
    error: copy.unsupportedType,
  };
}

function hasAttachmentDropData(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(WORKSPACE_FILE_DRAG_MIME) || types.includes("Files");
}

function isWorkspaceFileAttachmentAllowed(
  payload: WorkspaceFileDragPayload
): boolean {
  if (
    payload.previewKind === "docx" ||
    payload.previewKind === "image" ||
    payload.previewKind === "pdf" ||
    payload.previewKind === "pptx" ||
    payload.previewKind === "markdown" ||
    payload.previewKind === "text" ||
    payload.previewKind === "xlsx"
  ) {
    return true;
  }

  const descriptorName = payload.extension
    ? `${payload.name}${payload.extension.startsWith(".") ? "" : "."}${
        payload.extension
      }`
    : payload.name;
  return isSupportedAttachmentDescriptor(descriptorName);
}

function isWorkspaceOfficeAttachment(
  payload: WorkspaceFileDragPayload
): boolean {
  if (
    payload.previewKind === "docx" ||
    payload.previewKind === "pptx" ||
    payload.previewKind === "xlsx"
  ) {
    return true;
  }

  const descriptorName = payload.extension
    ? `${payload.name}${payload.extension.startsWith(".") ? "" : "."}${
        payload.extension
      }`
    : payload.name;
  return isOfficeAttachmentDescriptor(descriptorName);
}

async function workspaceDragPayloadToFile(
  payload: WorkspaceFileDragPayload,
  context: AttachmentUploadContext,
  readFailedMessage: string
): Promise<File> {
  const effectiveResourceId = payload.resourceId || context.resourceId;
  const effectiveWorkspaceId = payload.workspaceId || context.workspaceId;
  const blob = await getWorkspaceRawFileBlob({
    path: payload.path,
    resourceId: effectiveResourceId,
    workspaceId: effectiveWorkspaceId,
    fallbackMessage: readFailedMessage,
  });
  const fileName = payload.name || payload.path.split("/").pop() || "file";
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });
}

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isToolCancellationResult(result: string): boolean {
  const normalized = result.toLowerCase();
  return (
    normalized.includes("was cancelled") ||
    normalized.includes("was canceled") ||
    (normalized.includes("tool call") &&
      (normalized.includes("cancelled") || normalized.includes("canceled"))) ||
    result.includes("已取消") ||
    result.includes("已中断")
  );
}

function settledPendingToolCallStatus(
  runStatus: string,
  t: (key: CopyKey) => string
): Pick<ToolCall, "status" | "result"> {
  if (runStatus === "stopped" || runStatus === "interrupted") {
    return {
      status: "interrupted",
      result: t("toolInterruptedNoResult"),
    };
  }

  return {
    status: "error",
    result: t("toolEndedNoResult"),
  };
}

function messageHasVisibleContent(message: Message): boolean {
  return extractVisibleStringFromMessageContent(message).trim() !== "";
}

function hasTerminalToolIssue(toolCalls: ToolCall[]): boolean {
  return toolCalls.some(
    (toolCall) =>
      Boolean(toolCall.result) &&
      (toolCall.status === "error" || toolCall.status === "interrupted")
  );
}

function toolCallsFromMessage(message: Record<string, any>): ToolCall[] {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

  return toolCalls
    .filter((toolCall) => isRecord(toolCall) && toolCall.name)
    .map((toolCall, index) => ({
      id: String(toolCall.id || `${message.id}-remote-tool-${index}`),
      name: String(toolCall.name),
      args: normalizeToolArgs(toolCall.args),
      status: "pending" as const,
    }));
}

function buildRemoteRuntimeToolMessages(
  streamEvents: Array<{
    mode: string;
    namespace?: string[];
    data: unknown;
  }>,
  topLevelToolCallIds: Set<string>
): Array<{ message: Message; toolCalls: ToolCall[] }> {
  const remoteMessages = new Map<
    string,
    { message: Message; toolCalls: ToolCall[] }
  >();

  for (const event of streamEvents) {
    if (
      event.mode !== "updates" ||
      !event.namespace?.some((part) => part.startsWith("remote_runtime"))
    ) {
      continue;
    }

    const data = isRecord(event.data) ? event.data : {};
    const modelMessages =
      isRecord(data.model) && Array.isArray(data.model.messages)
        ? data.model.messages
        : [];
    const toolMessages =
      isRecord(data.tools) && Array.isArray(data.tools.messages)
        ? data.tools.messages
        : [];

    for (const rawMessage of modelMessages) {
      if (!isRecord(rawMessage) || rawMessage.type !== "ai" || !rawMessage.id) {
        continue;
      }
      const toolCalls = toolCallsFromMessage(rawMessage).filter(
        (toolCall) => !topLevelToolCallIds.has(toolCall.id)
      );
      if (toolCalls.length === 0) continue;
      remoteMessages.set(String(rawMessage.id), {
        message: rawMessage as Message,
        toolCalls,
      });
    }

    for (const rawMessage of toolMessages) {
      if (!isRecord(rawMessage) || rawMessage.type !== "tool") continue;
      const toolCallId = rawMessage.tool_call_id;
      if (!toolCallId || topLevelToolCallIds.has(String(toolCallId))) continue;

      for (const entry of remoteMessages.values()) {
        const toolCallIndex = entry.toolCalls.findIndex(
          (toolCall) => toolCall.id === toolCallId
        );
        if (toolCallIndex === -1) continue;
        entry.toolCalls[toolCallIndex] = {
          ...entry.toolCalls[toolCallIndex],
          status:
            rawMessage.status === "error"
              ? "error"
              : isToolCancellationResult(
                  extractStringFromMessageContent(rawMessage as Message)
                )
              ? "interrupted"
              : "completed",
          result: extractStringFromMessageContent(rawMessage as Message),
        };
        break;
      }
    }
  }

  return Array.from(remoteMessages.values());
}

export const ChatInterface = React.memo<ChatInterfaceProps>(
  ({ assistant, headerActions, onOpenInspector, workspaceRoot }) => {
    const [metaOpen, setMetaOpen] = useState<
      "goal" | "skills" | "tasks" | "files" | null
    >(null);
    const tasksContainerRef = useRef<HTMLDivElement | null>(null);
    const composerRef = useRef<HTMLFormElement | null>(null);
    const mentionMenuRef = useRef<HTMLDivElement | null>(null);
    const commandSearchInputRef = useRef<HTMLInputElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const chatDragDepthRef = useRef(0);
    const suppressSkillsMetaToggleUntilRef = useRef(0);
    const composerCompositionRef = useRef({
      isComposing: false,
      lastEndedAt: 0,
    });
    const [, setSelectedFilePath] = useQueryState("file");
    const [, setThreadIdQuery] = useQueryState("threadId");

    const [input, setInput] = useState("");
    const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
    const [mentionContext, setMentionContext] = useState<MentionContext | null>(
      null
    );
    const [mentionSkills, setMentionSkills] = useState<SkillEntry[]>([]);
    const [mentionSkillsLoaded, setMentionSkillsLoaded] = useState(false);
    const [mentionSkillsLoading, setMentionSkillsLoading] = useState(false);
    const [mentionSkillsError, setMentionSkillsError] = useState<string | null>(
      null
    );
    const [mentionMenuPosition, setMentionMenuPosition] =
      useState<MentionMenuPosition | null>(null);
    const [activeMentionIndex, setActiveMentionIndex] = useState(0);
    const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
    const [isChatDropActive, setIsChatDropActive] = useState(false);
    const [isPreparingDroppedAttachment, setIsPreparingDroppedAttachment] =
      useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");

    const openAttachmentPreview = useCallback(
      (path: string) => {
        const target = normalizeWorkspacePreviewPath(path, {
          workspaceRoot,
          allowBareFile: true,
        });
        if (target?.previewPath) {
          onOpenInspector?.();
          void setSelectedFilePath(target.previewPath);
        }
      },
      [onOpenInspector, setSelectedFilePath, workspaceRoot]
    );

    const updateMentionMenuPosition = useCallback(() => {
      const composer = composerRef.current;
      if (!composer) {
        return;
      }

      const rect = composer.getBoundingClientRect();
      const width = Math.min(288, Math.max(220, rect.width - 32));
      const left = Math.min(
        Math.max(rect.left + 16, 8),
        window.innerWidth - width - 8
      );

      setMentionMenuPosition({
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        left,
        width,
      });
    }, []);

    const openMentionMenu = useCallback(
      (context: MentionContext) => {
        setMentionContext(context);
        setMentionMenuOpen(true);
        setActiveMentionIndex(0);
        window.requestAnimationFrame(updateMentionMenuPosition);
      },
      [updateMentionMenuPosition]
    );

    const closeMentionMenu = useCallback(() => {
      setMentionMenuOpen(false);
      setMentionContext(null);
      setMentionMenuPosition(null);
      setActiveMentionIndex(0);
    }, []);

    const insertComposerTrigger = useCallback(
      (trigger: ComposerTrigger) => {
        const textarea = textareaRef.current;
        const cursorStart = textarea?.selectionStart ?? input.length;
        const cursorEnd = textarea?.selectionEnd ?? cursorStart;
        const prefix = input.slice(0, cursorStart);
        const suffix = input.slice(cursorEnd);
        const needsLeadingSpace =
          prefix.length > 0 && !/\s$/.test(prefix) && !prefix.endsWith(trigger);
        const inserted = `${needsLeadingSpace ? " " : ""}${trigger}`;
        const nextInput = `${prefix}${inserted}${suffix}`;
        const nextMentionStart = prefix.length + (needsLeadingSpace ? 1 : 0);
        const nextCursor = prefix.length + inserted.length;

        setInput(nextInput);
        openMentionMenu({
          start: nextMentionStart,
          query: "",
          kind: COMPOSER_TRIGGER_KIND[trigger],
          trigger,
        });

        window.requestAnimationFrame(() => {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [input, openMentionMenu]
    );

    const openComposerSearch = useCallback(() => {
      const textarea = textareaRef.current;
      const cursor = textarea?.selectionStart ?? input.length;
      openMentionMenu({
        start: cursor,
        query: "",
        kind: "search",
        trigger: null,
      });
      window.requestAnimationFrame(() => {
        commandSearchInputRef.current?.focus();
      });
    }, [input.length, openMentionMenu]);
    const [isSavingTitle, setIsSavingTitle] = useState(false);
    const [showIntermediateResults, setShowIntermediateResults] =
      useState(false);
    const { scrollRef, contentRef } = useStickToBottom();

    const {
      stream,
      messages,
      streamEvents,
      todos,
      files,
      goal,
      threadSkills,
      ui,
      setFiles,
      updateThreadSkills,
      error,
      recoveryNotice,
      isLoading,
      isStreamRecovering,
      isThreadLoading,
      interrupt,
      runStatus,
      threadTitle,
      updateThreadTitle,
      sendMessage,
      retryMessage,
      stopStream,
      resumeInterrupt,
      threadId,
      resourceId,
      workspaceId,
    } = useChatContext();
    const { t } = useLanguage();
    const threadSuggestions = useThreads({
      limit: 20,
      resourceId,
      assistantId: assistant?.assistant_id,
      workspaceId,
    });
    const [mentionWorkspaceFiles, setMentionWorkspaceFiles] = useState<
      WorkspaceEntry[]
    >([]);
    const [mentionWorkspaceFilesLoading, setMentionWorkspaceFilesLoading] =
      useState(false);
    const [mentionWorkspaceFilesError, setMentionWorkspaceFilesError] =
      useState<string | null>(null);

    const composerBusy = isLoading || isStreamRecovering;
    const submitDisabled = composerBusy || !assistant;
    const composerSearchShortcut = "Ctrl+K";
    const activeThreadSkillKeys = useMemo(
      () => new Set((threadSkills?.active ?? []).map((skill) => skill.key)),
      [threadSkills]
    );
    const hasThreadSkills = Boolean(threadSkills?.active?.length);
    const hasSendableAttachments = attachments.some(
      (attachment) => !attachment.error
    );
    const canSendMessage = input.trim().length > 0 || hasSendableAttachments;
    const applyAutoAttachmentSkills = useCallback(
      async (nextAttachments: ChatAttachment[]) => {
        const nextThreadSkills = addAttachmentThreadSkills(
          threadSkills,
          nextAttachments,
          {
            pdf: t("autoPdfAttachmentSkill"),
            docx: t("autoDocxAttachmentSkill"),
            xlsx: t("autoXlsxAttachmentSkill"),
            pptx: t("autoPptxAttachmentSkill"),
          }
        );
        if (!nextThreadSkills) {
          return;
        }

        suppressSkillsMetaToggleUntilRef.current = Date.now() + 500;
        setMetaOpen(null);
        await updateThreadSkills(nextThreadSkills);
      },
      [threadSkills, t, updateThreadSkills]
    );
    const errorMessage = formatChatError(error, t);
    const attachmentHint = t("supportedAttachmentHint");
    const attachmentCopy = useMemo<AttachmentCopy>(
      () => ({
        unsupportedType: t("unsupportedAttachmentType", {
          hint: attachmentHint,
        }),
        imageTooLarge: t("imageTooLarge"),
        pdfTooLarge: t("pdfTooLarge"),
        pdfUploadFailed: t("pdfUploadFailed"),
        officeTooLarge: t("officeTooLarge"),
        uploadFailed: t("attachmentUploadFailed"),
      }),
      [attachmentHint, t]
    );
    const goalStatusText = useCallback(
      (status: GoalState["status"]) => {
        switch (status) {
          case "complete":
            return t("complete");
          case "blocked":
            return t("blocked");
          default:
            return t("inProgress");
        }
      },
      [t]
    );
    const todoStatusText = useCallback(
      (status: TodoItem["status"]) => {
        switch (status) {
          case "completed":
            return t("complete");
          case "in_progress":
            return t("inProgress");
          default:
            return t("pending");
        }
      },
      [t]
    );
    const mentionQuery = mentionContext?.query ?? "";
    const mentionWorkspaceFileSearchEnabled =
      mentionContext?.kind === "artifact" || mentionContext?.kind === "search";

    useEffect(() => {
      if (!mentionWorkspaceFileSearchEnabled) {
        setMentionWorkspaceFilesLoading(false);
        setMentionWorkspaceFilesError(null);
        return;
      }

      const controller = new AbortController();

      setMentionWorkspaceFilesLoading(true);
      setMentionWorkspaceFilesError(null);

      searchWorkspace({
        query: mentionQuery,
        limit: MAX_MENTION_WORKSPACE_FILE_RESULTS,
        resourceId,
        workspaceId,
        signal: controller.signal,
        fallbackMessage: t("projectFilesLoadFailed"),
      })
        .then((payload) => {
          setMentionWorkspaceFiles(
            Array.isArray(payload.entries) ? payload.entries : []
          );
        })
        .catch((searchError) => {
          if (controller.signal.aborted) {
            return;
          }

          setMentionWorkspaceFiles([]);
          setMentionWorkspaceFilesError(
            searchError instanceof Error
              ? searchError.message
              : t("projectFilesLoadFailed")
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setMentionWorkspaceFilesLoading(false);
          }
        });

      return () => {
        controller.abort();
      };
    }, [
      mentionQuery,
      mentionWorkspaceFileSearchEnabled,
      resourceId,
      t,
      workspaceId,
    ]);
    const sortedMentionSkills = useMemo(
      () =>
        [...mentionSkills].sort((left, right) => {
          if (left.enabled !== right.enabled) {
            return left.enabled ? -1 : 1;
          }
          return left.name.localeCompare(right.name, "zh-CN");
        }),
      [mentionSkills]
    );
    const filteredMentionSkills = useMemo(
      () =>
        sortedMentionSkills
          .filter((skill) => skillMatchesQuery(skill, mentionQuery))
          .slice(0, MAX_MENTION_OPTIONS),
      [mentionQuery, sortedMentionSkills]
    );
    const sortedMentionWorkspaceFiles = useMemo(
      () =>
        mentionWorkspaceFiles
          .filter((entry) => entry.kind === "file")
          .slice()
          .sort((left, right) =>
            left.path.localeCompare(right.path, "zh-CN", {
              numeric: true,
              sensitivity: "base",
            })
          ),
      [mentionWorkspaceFiles]
    );
    const flattenedMentionThreads = useMemo(
      () =>
        (threadSuggestions.data?.flat() ?? [])
          .filter((thread) => thread.id !== threadId)
          .sort(
            (left, right) =>
              right.updatedAt.getTime() - left.updatedAt.getTime()
          ),
      [threadId, threadSuggestions.data]
    );
    const workspaceFileOptions = useMemo<ComposerSuggestionOption[]>(
      () =>
        sortedMentionWorkspaceFiles
          .filter((entry) =>
            textMatchesQuery(mentionQuery, [entry.name, entry.path])
          )
          .slice(0, MAX_MENTION_OPTIONS)
          .map((entry) => ({
            type: "workspace-file",
            key: `workspace:${entry.path}`,
            label: entry.name,
            description: [
              t("projectFile"),
              typeof entry.size === "number"
                ? formatAttachmentSize(entry.size)
                : "",
              entry.path,
            ]
              .filter(Boolean)
              .join(" · "),
            entry,
          })),
      [mentionQuery, sortedMentionWorkspaceFiles, t]
    );
    const artifactOptions = useMemo<ComposerSuggestionOption[]>(
      () =>
        Object.entries(files)
          .filter(([path, content]) =>
            textMatchesQuery(mentionQuery, [path, content])
          )
          .slice(0, MAX_MENTION_OPTIONS)
          .map(([path, content]) => ({
            type: "artifact",
            key: `artifact:${path}`,
            label: path.split("/").pop() || path,
            description: [t("sessionArtifact"), path]
              .filter(Boolean)
              .join(" · "),
            path,
            content,
          })),
      [files, mentionQuery, t]
    );
    const fileAndArtifactOptions = useMemo(
      () =>
        [...workspaceFileOptions, ...artifactOptions].slice(
          0,
          MAX_MENTION_OPTIONS
        ),
      [artifactOptions, workspaceFileOptions]
    );
    const threadOptions = useMemo<ComposerSuggestionOption[]>(
      () =>
        flattenedMentionThreads
          .filter((thread) =>
            textMatchesQuery(mentionQuery, [
              thread.title,
              thread.description,
              thread.id,
            ])
          )
          .slice(0, MAX_MENTION_OPTIONS)
          .map((thread) => ({
            type: "thread",
            key: `thread:${thread.id}`,
            label: thread.title,
            description:
              thread.description ||
              `${t("sessions")} · ${thread.id.slice(0, 8)}`,
            thread,
          })),
      [flattenedMentionThreads, mentionQuery, t]
    );
    const skillOptions = useMemo<ComposerSuggestionOption[]>(
      () =>
        filteredMentionSkills.map((skill) => ({
          type: "skill",
          key: `skill:${skill.key}`,
          label: skill.name,
          description: skill.description || skill.relativePath,
          skill,
          selectedForThread: activeThreadSkillKeys.has(skill.key),
        })),
      [activeThreadSkillKeys, filteredMentionSkills]
    );
    const commandOptions = useMemo<ComposerSuggestionOption[]>(
      () =>
        textMatchesQuery(mentionQuery, [
          t("newSessionCommand"),
          t("newThread"),
          "new session",
        ])
          ? [
              {
                type: "command",
                key: "command:new-session",
                label: t("newSessionCommand"),
                description: t("command"),
                command: "new-session",
              },
            ]
          : [],
      [mentionQuery, t]
    );
    const mentionOptions = useMemo<ComposerSuggestionOption[]>(() => {
      switch (mentionContext?.kind) {
        case "artifact":
          return fileAndArtifactOptions;
        case "session":
          return threadOptions;
        case "skill":
          return skillOptions;
        case "search":
          return [
            ...fileAndArtifactOptions.slice(0, 8),
            ...threadOptions.slice(0, 5),
            ...skillOptions.slice(0, 4),
            ...commandOptions,
          ];
        default:
          return [];
      }
    }, [
      commandOptions,
      fileAndArtifactOptions,
      mentionContext?.kind,
      skillOptions,
      threadOptions,
    ]);
    const mentionSections = useMemo<ComposerSuggestionSection[]>(() => {
      if (mentionContext?.kind !== "search") {
        return [{ title: null, options: mentionOptions }];
      }

      return [
        {
          title: t("recentArtifacts"),
          options: fileAndArtifactOptions.slice(0, 8),
        },
        {
          title: t("recentSessions"),
          options: threadOptions.slice(0, 5),
        },
        {
          title: t("skills"),
          options: skillOptions.slice(0, 4),
        },
        {
          title: t("commands"),
          options: commandOptions,
        },
      ].filter((section) => section.options.length > 0);
    }, [
      commandOptions,
      fileAndArtifactOptions,
      mentionContext?.kind,
      mentionOptions,
      skillOptions,
      t,
      threadOptions,
    ]);
    const mentionMenuTitle = useMemo(() => {
      switch (mentionContext?.kind) {
        case "artifact":
          return t("chooseFileOrArtifact");
        case "session":
          return t("chooseSession");
        case "skill":
          return t("chooseSkill");
        case "search":
          return t("commandPalette");
        default:
          return t("searchComposer");
      }
    }, [mentionContext?.kind, t]);
    const mentionMenuEmptyText = useMemo(() => {
      switch (mentionContext?.kind) {
        case "artifact":
          return t("noMatchingFilesOrArtifacts");
        case "session":
          return t("noMatchingSessions");
        case "skill":
          return t("noMatchingSkills");
        default:
          return t("noMatchingResults");
      }
    }, [mentionContext?.kind, t]);
    const threadSuggestionsError =
      threadSuggestions.error instanceof Error
        ? threadSuggestions.error.message
        : threadSuggestions.error
        ? t("sessionsLoadFailed")
        : null;
    const mentionMenuError =
      mentionContext?.kind === "artifact"
        ? mentionWorkspaceFilesError
      : mentionContext?.kind === "session"
      ? threadSuggestionsError
      : mentionContext?.kind === "skill"
      ? mentionSkillsError
      : mentionContext?.kind === "search"
      ? mentionWorkspaceFilesError
      : null;
    const mentionMenuLoading =
      mentionContext?.kind === "artifact"
        ? mentionWorkspaceFilesLoading
      : mentionContext?.kind === "session"
      ? !threadSuggestions.data && !threadSuggestions.error
      : mentionContext?.kind === "skill"
      ? mentionSkillsLoading
      : mentionContext?.kind === "search"
        ? mentionSkillsLoading ||
          mentionWorkspaceFilesLoading ||
          (!threadSuggestions.data && !threadSuggestions.error)
      : false;
    const mentionMenuLoadingText =
      mentionContext?.kind === "artifact"
        ? t("loadingFiles")
        : mentionContext?.kind === "session"
        ? t("loadingSessions")
        : mentionContext?.kind === "skill"
        ? t("loadingSkills")
        : t("loadingResults");
    const mentionMenuIsCommandPalette = mentionContext?.kind === "search";

    const loadMentionSkills = useCallback(async () => {
      if (mentionSkillsLoaded || mentionSkillsLoading) {
        return;
      }

      setMentionSkillsLoading(true);
      setMentionSkillsError(null);
      try {
        const payload = await loadSkills(t("capabilityListLoadFailed"));
        setMentionSkills(Array.isArray(payload.skills) ? payload.skills : []);
        setMentionSkillsLoaded(true);
      } catch (loadError) {
        setMentionSkillsError(
          loadError instanceof Error
            ? loadError.message
            : t("capabilityListLoadFailed")
        );
      } finally {
        setMentionSkillsLoading(false);
      }
    }, [mentionSkillsLoaded, mentionSkillsLoading, t]);

    useEffect(() => {
      if (
        mentionMenuOpen &&
        (mentionContext?.kind === "skill" || mentionContext?.kind === "search")
      ) {
        void loadMentionSkills();
      }
    }, [loadMentionSkills, mentionContext?.kind, mentionMenuOpen]);

    useEffect(() => {
      if (typeof window === "undefined") {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const draft = currentUrl.searchParams.get(COMPOSER_DRAFT_QUERY_KEY);
      const shouldFocusComposer =
        currentUrl.hash === CHAT_COMPOSER_HASH || draft !== null;

      if (!shouldFocusComposer) {
        return;
      }

      if (draft !== null) {
        setInput(draft);
        closeMentionMenu();
        currentUrl.searchParams.delete(COMPOSER_DRAFT_QUERY_KEY);
        window.history.replaceState(
          null,
          "",
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
        );
      }

      const frame = window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        if (draft !== null) {
          textareaRef.current?.setSelectionRange(draft.length, draft.length);
        }
      });

      return () => {
        window.cancelAnimationFrame(frame);
      };
    }, [closeMentionMenu]);

    useEffect(() => {
      if (typeof window === "undefined") {
        return;
      }

      const currentUrl = new URL(window.location.href);
      const skillIdentifier = currentUrl.searchParams
        .get(ENABLE_SKILL_QUERY_KEY)
        ?.trim();

      if (!skillIdentifier) {
        return;
      }

      if (isThreadLoading) {
        return;
      }

      const frame = window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });

      if (composerBusy) {
        toast.error(t("enableSkillAfterRun"), {
          position: "top-center",
        });
        return () => {
          window.cancelAnimationFrame(frame);
        };
      }

      currentUrl.searchParams.delete(ENABLE_SKILL_QUERY_KEY);
      window.history.replaceState(
        null,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
      );

      let cancelled = false;
      const enableSkill = async () => {
        try {
          const payload = await loadSkills(t("capabilityListLoadFailed"));
          const skill = (payload.skills ?? []).find((candidate) =>
            skillMatchesIdentifier(candidate, skillIdentifier)
          );

          if (!skill) {
            throw new Error(t("noSkillToEnable"));
          }

          if (cancelled || activeThreadSkillKeys.has(skill.key)) {
            return;
          }

          const nextThreadSkills = addThreadSkill(threadSkills, skill);
          suppressSkillsMetaToggleUntilRef.current = Date.now() + 500;
          setMetaOpen(null);
          await updateThreadSkills(nextThreadSkills);
        } catch (enableError) {
          if (!cancelled) {
            toast.error(
              enableError instanceof Error
                ? enableError.message
                : t("skillEnableFailed"),
              { position: "top-center" }
            );
          }
        }
      };

      void enableSkill();

      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }, [
      activeThreadSkillKeys,
      composerBusy,
      isThreadLoading,
      t,
      threadSkills,
      updateThreadSkills,
    ]);

    useEffect(() => {
      setActiveMentionIndex(0);
    }, [mentionContext?.kind, mentionQuery]);

    useEffect(() => {
      if (activeMentionIndex >= mentionOptions.length) {
        setActiveMentionIndex(Math.max(0, mentionOptions.length - 1));
      }
    }, [activeMentionIndex, mentionOptions.length]);

    useEffect(() => {
      if (!mentionMenuOpen) {
        return;
      }

      function handlePointerDown(event: PointerEvent) {
        const target = event.target;
        if (!(target instanceof Node)) {
          return;
        }

        const clickedComposer = composerRef.current?.contains(target);
        const clickedMentionMenu = mentionMenuRef.current?.contains(target);
        if (composerRef.current && !clickedComposer && !clickedMentionMenu) {
          closeMentionMenu();
        }
      }

      document.addEventListener("pointerdown", handlePointerDown);
      return () => {
        document.removeEventListener("pointerdown", handlePointerDown);
      };
    }, [closeMentionMenu, mentionMenuOpen]);

    useEffect(() => {
      if (!mentionMenuOpen) {
        return;
      }

      updateMentionMenuPosition();
      window.addEventListener("resize", updateMentionMenuPosition);
      window.addEventListener("scroll", updateMentionMenuPosition, true);
      return () => {
        window.removeEventListener("resize", updateMentionMenuPosition);
        window.removeEventListener("scroll", updateMentionMenuPosition, true);
      };
    }, [mentionMenuOpen, updateMentionMenuPosition]);

    useEffect(() => {
      if (!isEditingTitle) {
        setTitleDraft(threadTitle);
      }
    }, [isEditingTitle, threadTitle]);

    useEffect(() => {
      setShowIntermediateResults(false);
    }, [threadId]);

    useEffect(() => {
      if (isLoading) {
        setShowIntermediateResults(false);
      }
    }, [isLoading]);

    const startTitleEdit = useCallback(() => {
      setTitleDraft(threadTitle);
      setIsEditingTitle(true);
    }, [threadTitle]);

    const cancelTitleEdit = useCallback(() => {
      setTitleDraft(threadTitle);
      setIsEditingTitle(false);
    }, [threadTitle]);

    const saveTitleEdit = useCallback(async () => {
      const nextTitle = titleDraft.trim();
      if (!nextTitle) {
        toast.error(t("titleRequired"));
        return;
      }

      setIsSavingTitle(true);
      try {
        await updateThreadTitle(nextTitle);
        setIsEditingTitle(false);
        toast.success(t("titleUpdated"));
      } catch (titleError) {
        toast.error(
          titleError instanceof Error
            ? titleError.message
            : t("titleUpdateFailed")
        );
      } finally {
        setIsSavingTitle(false);
      }
    }, [t, titleDraft, updateThreadTitle]);

    const removeMentionToken = useCallback(() => {
      const textarea = textareaRef.current;
      const cursorEnd = textarea?.selectionEnd ?? input.length;
      if (!mentionContext || mentionContext.trigger === null) {
        return {
          nextInput: input,
          nextCursor: cursorEnd,
        };
      }

      const start = mentionContext.start;
      return {
        nextInput: `${input.slice(0, start)}${input.slice(cursorEnd)}`,
        nextCursor: start,
      };
    }, [input, mentionContext]);

    const handleInputChange = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextInput = event.currentTarget.value;
        const cursor = event.currentTarget.selectionStart ?? nextInput.length;
        const nextMentionContext = getMentionContext(nextInput, cursor);

        setInput(nextInput);

        if (nextMentionContext) {
          openMentionMenu(nextMentionContext);
        } else if (mentionMenuOpen && mentionContext?.kind === "search") {
          setMentionContext({
            start: cursor,
            query: nextInput.trim(),
            kind: "search",
            trigger: null,
          });
        } else {
          closeMentionMenu();
        }
      },
      [closeMentionMenu, mentionContext?.kind, mentionMenuOpen, openMentionMenu]
    );

    const selectMentionSkill = useCallback(
      (skill: SkillEntry) => {
        if (composerBusy) {
          toast.error(t("addSkillAfterRun"), {
            position: "top-center",
          });
          closeMentionMenu();
          return;
        }

        const { nextInput, nextCursor } = removeMentionToken();
        const alreadyEnabled = activeThreadSkillKeys.has(skill.key);

        setInput(nextInput);
        closeMentionMenu();
        if (!alreadyEnabled) {
          const nextThreadSkills = addThreadSkill(threadSkills, skill);
          suppressSkillsMetaToggleUntilRef.current = Date.now() + 500;
          setMetaOpen(null);
          void updateThreadSkills(nextThreadSkills).catch((error) => {
            toast.error(
              error instanceof Error ? error.message : t("skillAddFailed"),
              { position: "top-center" }
            );
          });
        }

        window.requestAnimationFrame(() => {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [
        activeThreadSkillKeys,
        closeMentionMenu,
        composerBusy,
        removeMentionToken,
        t,
        threadSkills,
        updateThreadSkills,
      ]
    );

    const removeActiveThreadSkill = useCallback(
      (skill: ThreadSkillItem) => {
        if (composerBusy) {
          toast.error(t("addSkillAfterRun"), {
            position: "top-center",
          });
          return;
        }

        const nextThreadSkills = removeThreadSkill(threadSkills, skill.key);
        void updateThreadSkills(nextThreadSkills).catch((error) => {
          toast.error(
            error instanceof Error ? error.message : t("skillRemoveFailed"),
            { position: "top-center" }
          );
        });
      },
      [composerBusy, t, threadSkills, updateThreadSkills]
    );

    const handleSubmit = useCallback(
      (e?: FormEvent) => {
        if (e) {
          e.preventDefault();
        }
        const messageText = input.trim();
        const sendableAttachments = attachments.filter(
          (attachment) => !attachment.error
        );
        if (
          (!messageText && sendableAttachments.length === 0) ||
          composerBusy ||
          submitDisabled
        ) {
          return;
        }

        sendMessage(messageText, sendableAttachments);
        setInput("");
        setAttachments([]);
        closeMentionMenu();
      },
      [
        attachments,
        closeMentionMenu,
        composerBusy,
        input,
        sendMessage,
        setInput,
        submitDisabled,
      ]
    );

    const handleAttachmentFiles = useCallback(
      async (fileList: FileList | null) => {
        const files = Array.from(fileList ?? []);
        if (files.length === 0) return;

        const preparedAttachments = await Promise.all(
          files.map((file) =>
            prepareAttachment(
              file,
              { resourceId, workspaceId, threadId },
              attachmentCopy
            )
          )
        );
        try {
          await applyAutoAttachmentSkills(preparedAttachments);
        } catch (skillError) {
          toast.error(
            skillError instanceof Error
              ? skillError.message
              : t("autoLoadSkillsFailed"),
            { position: "top-center" }
          );
        }
        setAttachments((current) => [...current, ...preparedAttachments]);
      },
      [
        applyAutoAttachmentSkills,
        attachmentCopy,
        resourceId,
        t,
        threadId,
        workspaceId,
      ]
    );

    const appendWorkspaceFileAttachment = useCallback(
      async (payload: WorkspaceFileDragPayload) => {
        if (submitDisabled) {
          toast.error(t("cannotAttachWhileRunning"));
          return;
        }

        if (!isWorkspaceFileAttachmentAllowed(payload)) {
          toast.warning(
            t("unsupportedProjectFile", {
              name: payload.name,
              hint: attachmentHint,
            })
          );
          return;
        }

        setIsPreparingDroppedAttachment(true);
        try {
          const attachmentContext = {
            resourceId,
            workspaceId,
            threadId,
          };
          const attachment = isWorkspaceOfficeAttachment(payload)
            ? ({
                id: createAttachmentId(),
                name: payload.name,
                mimeType:
                  OFFICE_ATTACHMENT_MIME_TYPES[
                    getAttachmentFileKey(payload.name)
                  ] || "application/octet-stream",
                size: payload.size || 0,
                kind: "file",
                ...(await uploadWorkspaceOfficeAttachment(
                  payload,
                  attachmentContext,
                  attachmentCopy
                )),
              } satisfies ChatAttachment)
            : await prepareAttachment(
                await workspaceDragPayloadToFile(
                  payload,
                  attachmentContext,
                  t("unableToReadProjectFile")
                ),
                attachmentContext,
                attachmentCopy
              );

          if (attachment.error) {
            toast.error(`${attachment.name}: ${attachment.error}`);
            return;
          }

          try {
            await applyAutoAttachmentSkills([attachment]);
          } catch (skillError) {
            toast.error(
              skillError instanceof Error
                ? skillError.message
                : t("autoLoadSkillsFailed"),
              { position: "top-center" }
            );
          }
          setAttachments((current) => [...current, attachment]);
          toast.success(t("attachmentAdded", { name: attachment.name }));
        } catch (attachmentError) {
          toast.error(
            attachmentError instanceof Error
              ? attachmentError.message
              : t("unableToReadProjectFile")
          );
        } finally {
          setIsPreparingDroppedAttachment(false);
        }
      },
      [
        applyAutoAttachmentSkills,
        attachmentCopy,
        attachmentHint,
        resourceId,
        submitDisabled,
        t,
        threadId,
        workspaceId,
      ]
    );

    const resetChatDropState = useCallback(() => {
      chatDragDepthRef.current = 0;
      setIsChatDropActive(false);
    }, []);

    const handleChatDragEnter = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasAttachmentDropData(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        chatDragDepthRef.current += 1;
        setIsChatDropActive(true);
      },
      []
    );

    const handleChatDragOver = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasAttachmentDropData(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = submitDisabled ? "none" : "copy";
        setIsChatDropActive(true);
      },
      [submitDisabled]
    );

    const handleChatDragLeave = useCallback(
      (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasAttachmentDropData(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        chatDragDepthRef.current = Math.max(0, chatDragDepthRef.current - 1);
        if (chatDragDepthRef.current === 0) {
          setIsChatDropActive(false);
        }
      },
      []
    );

    const handleChatDrop = useCallback(
      async (event: React.DragEvent<HTMLDivElement>) => {
        if (!hasAttachmentDropData(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        resetChatDropState();

        if (submitDisabled) {
          toast.error(t("cannotAttachWhileRunning"));
          return;
        }

        const workspacePayload = event.dataTransfer.getData(
          WORKSPACE_FILE_DRAG_MIME
        );
        if (!workspacePayload) {
          await handleAttachmentFiles(event.dataTransfer.files);
          return;
        }

        const payload = parseWorkspaceFileDragPayload(workspacePayload);
        if (!payload) {
          toast.error(t("unableToReadProjectFile"));
          return;
        }

        await appendWorkspaceFileAttachment(payload);
      },
      [
        appendWorkspaceFileAttachment,
        handleAttachmentFiles,
        resetChatDropState,
        submitDisabled,
        t,
      ]
    );

    const removeAttachment = useCallback((id: string) => {
      setAttachments((current) =>
        current.filter((attachment) => attachment.id !== id)
      );
    }, []);

    const selectComposerOption = useCallback(
      async (option: ComposerSuggestionOption) => {
        if (option.type === "skill") {
          selectMentionSkill(option.skill);
          return;
        }

        const { nextInput, nextCursor } = removeMentionToken();
        setInput(nextInput);
        closeMentionMenu();

        if (option.type === "command") {
          if (option.command === "new-session") {
            try {
              await setThreadIdQuery(null);
            } catch (commandError) {
              toast.error(
                commandError instanceof Error
                  ? commandError.message
                  : t("threadSwitchFailed")
              );
            }
          }
          return;
        }

        if (option.type === "thread") {
          try {
            await setThreadIdQuery(option.thread.id);
          } catch (threadError) {
            toast.error(
              threadError instanceof Error
                ? threadError.message
                : t("threadSwitchFailed")
            );
          }
          return;
        }

        if (option.type === "workspace-file") {
          const payload = createWorkspaceFileDragPayload(
            option.entry,
            resourceId,
            workspaceId
          );
          if (!payload) {
            toast.error(t("unableToReadProjectFile"));
            return;
          }
          await appendWorkspaceFileAttachment(payload);
        } else if (option.type === "artifact") {
          if (submitDisabled) {
            toast.error(t("cannotAttachWhileRunning"));
            return;
          }

          const fileName = option.path.split("/").pop() || option.path;
          const attachment = await prepareAttachment(
            new File([option.content], fileName, { type: "text/plain" }),
            { resourceId, workspaceId, threadId },
            attachmentCopy
          );

          if (attachment.error) {
            toast.error(`${attachment.name}: ${attachment.error}`);
            return;
          }

          try {
            await applyAutoAttachmentSkills([attachment]);
          } catch (skillError) {
            toast.error(
              skillError instanceof Error
                ? skillError.message
                : t("autoLoadSkillsFailed"),
              { position: "top-center" }
            );
          }
          setAttachments((current) => [...current, attachment]);
          toast.success(t("attachmentAdded", { name: attachment.name }));
        }

        window.requestAnimationFrame(() => {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
      },
      [
        appendWorkspaceFileAttachment,
        applyAutoAttachmentSkills,
        attachmentCopy,
        closeMentionMenu,
        removeMentionToken,
        resourceId,
        selectMentionSkill,
        setThreadIdQuery,
        submitDisabled,
        t,
        threadId,
        workspaceId,
      ]
    );

    const handleSuggestionKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLElement>) => {
        if (!mentionMenuOpen) {
          return false;
        }

        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveMentionIndex((current) =>
            mentionOptions.length === 0
              ? 0
              : (current + 1) % mentionOptions.length
          );
          return true;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveMentionIndex((current) =>
            mentionOptions.length === 0
              ? 0
              : (current - 1 + mentionOptions.length) % mentionOptions.length
          );
          return true;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          closeMentionMenu();
          return true;
        }

        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const selectedOption =
            mentionOptions[
              Math.min(activeMentionIndex, mentionOptions.length - 1)
            ];
          if (selectedOption) {
            void selectComposerOption(selectedOption);
          }
          return true;
        }

        return false;
      },
      [
        activeMentionIndex,
        closeMentionMenu,
        mentionMenuOpen,
        mentionOptions,
        selectComposerOption,
      ]
    );

    const isImeComposingForKeyEvent = useCallback(
      (event: React.KeyboardEvent<HTMLElement>) => {
        const nativeEvent = event.nativeEvent;
        const recentlyEndedComposition =
          Date.now() - composerCompositionRef.current.lastEndedAt <
          IME_COMPOSITION_END_GRACE_MS;

        return (
          composerCompositionRef.current.isComposing ||
          nativeEvent.isComposing ||
          nativeEvent.keyCode === 229 ||
          (event.key === "Enter" && recentlyEndedComposition)
        );
      },
      []
    );

    const handleComposerCompositionStart = useCallback(() => {
      composerCompositionRef.current.isComposing = true;
    }, []);

    const handleComposerCompositionEnd = useCallback(() => {
      composerCompositionRef.current.isComposing = false;
      composerCompositionRef.current.lastEndedAt = Date.now();
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (isImeComposingForKeyEvent(e)) {
          return;
        }

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          openComposerSearch();
          return;
        }

        if (submitDisabled) return;

        if (mentionMenuOpen) {
          if (handleSuggestionKeyDown(e)) {
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [
        handleSuggestionKeyDown,
        handleSubmit,
        isImeComposingForKeyEvent,
        mentionMenuOpen,
        openComposerSearch,
        submitDisabled,
      ]
    );

    const interruptValues = useMemo(() => {
      if (!interrupt) return [];
      const interrupts = Array.isArray(interrupt) ? interrupt : [interrupt];
      return interrupts
        .map((item: any) => item?.value)
        .filter((value: unknown) => value && typeof value === "object");
    }, [interrupt]);

    const actionRequests = useMemo(() => {
      return interruptValues.flatMap((value: any) =>
        Array.isArray(value.action_requests) ? value.action_requests : []
      ) as ActionRequest[];
    }, [interruptValues]);

    const reviewConfigs = useMemo(() => {
      return interruptValues.flatMap((value: any) =>
        Array.isArray(value.review_configs) ? value.review_configs : []
      ).map((config: ReviewConfig) => normalizeReviewConfig(config));
    }, [interruptValues]);

    const interruptedToolNames = useMemo(() => {
      return new Set(actionRequests.map((request) => request.name));
    }, [actionRequests]);

    // TODO: can we make this part of the hook?
    const processedMessages = useMemo(() => {
      /*
     1. Loop through all messages
     2. For each AI message, add the AI message, and any tool calls to the messageMap
     3. For each tool message, find the corresponding tool call in the messageMap and update the status and output
    */
      const messageMap = new Map<
        string,
        { message: Message; toolCalls: ToolCall[] }
      >();
      messages.forEach((message: Message) => {
        if (message.type === "ai") {
          const toolCallsInMessage: Array<{
            id?: string;
            function?: { name?: string; arguments?: unknown };
            name?: string;
            type?: string;
            args?: unknown;
            input?: unknown;
          }> = [];
          if (
            message.additional_kwargs?.tool_calls &&
            Array.isArray(message.additional_kwargs.tool_calls)
          ) {
            toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
          } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
            toolCallsInMessage.push(
              ...message.tool_calls.filter(
                (toolCall: { name?: string }) => toolCall.name !== ""
              )
            );
          } else if (Array.isArray(message.content)) {
            const toolUseBlocks = message.content.filter(
              (block: { type?: string }) => block.type === "tool_use"
            );
            toolCallsInMessage.push(...toolUseBlocks);
          }
          const toolCallsWithStatus = toolCallsInMessage.map(
            (
              toolCall: {
                id?: string;
                function?: { name?: string; arguments?: unknown };
                name?: string;
                type?: string;
                args?: unknown;
                input?: unknown;
              },
              toolCallIndex
            ) => {
              const name =
                toolCall.function?.name ||
                toolCall.name ||
                toolCall.type ||
                "unknown";
              const args =
                toolCall.function?.arguments ||
                toolCall.args ||
                toolCall.input ||
                {};
              return {
                id: toolCall.id || `${message.id}-tool-${toolCallIndex}`,
                name,
                args,
                status: "pending" as const,
              } as ToolCall;
            }
          );
          messageMap.set(message.id!, {
            message,
            toolCalls: toolCallsWithStatus,
          });
        } else if (message.type === "tool") {
          const toolCallId = message.tool_call_id;
          if (!toolCallId) {
            return;
          }
          for (const [, data] of messageMap.entries()) {
            const toolCallIndex = data.toolCalls.findIndex(
              (tc: ToolCall) => tc.id === toolCallId
            );
            if (toolCallIndex === -1) {
              continue;
            }
            data.toolCalls[toolCallIndex] = {
              ...data.toolCalls[toolCallIndex],
              status: isToolCancellationResult(
                extractStringFromMessageContent(message)
              )
                ? "interrupted"
                : (message as any).status === "error"
                ? "error"
                : "completed",
              result: extractStringFromMessageContent(message),
            };
            break;
          }
        } else if (message.type === "human") {
          messageMap.set(message.id!, {
            message,
            toolCalls: [],
          });
        }
      });
      const processedArray = Array.from(messageMap.values());
      const topLevelToolCallIds = new Set(
        processedArray.flatMap((data) =>
          data.toolCalls.map((toolCall) => toolCall.id)
        )
      );

      // Remote runtimes currently arrive as namespaced subgraph stream events.
      // Surface their tool activity while the parent graph is still waiting for
      // the final RemoteGraph state update.
      for (const remoteToolMessage of buildRemoteRuntimeToolMessages(
        streamEvents,
        topLevelToolCallIds
      )) {
        if (!messageMap.has(remoteToolMessage.message.id!)) {
          processedArray.push(remoteToolMessage);
        }
      }

      if (interrupt) {
        const interruptTarget = [...processedArray]
          .reverse()
          .find((data) =>
            data.toolCalls.some(
              (toolCall) =>
                toolCall.status === "pending" &&
                (interruptedToolNames.size === 0 ||
                  interruptedToolNames.has(toolCall.name))
            )
          );

        if (interruptTarget) {
          interruptTarget.toolCalls = interruptTarget.toolCalls.map(
            (toolCall) =>
              toolCall.status === "pending" &&
              (interruptedToolNames.size === 0 ||
                interruptedToolNames.has(toolCall.name))
                ? { ...toolCall, status: "interrupted" as const }
                : toolCall
          );
        }
      }

      const shouldFinalizePendingToolCalls =
        !isLoading &&
        !interrupt &&
        ["completed", "error", "idle", "interrupted", "stopped"].includes(
          runStatus
        );

      if (shouldFinalizePendingToolCalls) {
        const settledStatus = settledPendingToolCallStatus(runStatus, t);
        processedArray.forEach((data, index) => {
          const hasLaterAssistantAnswer = processedArray
            .slice(index + 1)
            .some(
              (laterData) =>
                laterData.message.type === "ai" &&
                messageHasVisibleContent(laterData.message)
            );
          if (hasLaterAssistantAnswer) {
            return;
          }

          data.toolCalls = data.toolCalls.map((toolCall) =>
            toolCall.status === "pending"
              ? { ...toolCall, ...settledStatus }
              : toolCall
          );
        });
      }

      return processedArray.map((data, index) => {
        const prevMessage =
          index > 0 ? processedArray[index - 1].message : null;
        return {
          ...data,
          showAvatar: data.message.type !== prevMessage?.type,
        };
      });
    }, [
      messages,
      streamEvents,
      interrupt,
      interruptedToolNames,
      isLoading,
      runStatus,
      t,
    ]);

    const showRuntimeDetails = isLoading || Boolean(interrupt);
    const terminalToolIssueMessageIds = useMemo(() => {
      const ids = new Set<string>();
      const runHasSettled =
        !isLoading &&
        !isStreamRecovering &&
        !interrupt &&
        ["completed", "error", "idle", "interrupted", "stopped"].includes(
          runStatus
        );
      if (!runHasSettled) {
        return ids;
      }

      for (let index = processedMessages.length - 1; index >= 0; index -= 1) {
        const data = processedMessages[index];
        if (
          data.message.type !== "ai" ||
          messageHasVisibleContent(data.message) ||
          !hasTerminalToolIssue(data.toolCalls)
        ) {
          continue;
        }

        const hasLaterAssistantAnswer = processedMessages
          .slice(index + 1)
          .some(
            (laterData) =>
              laterData.message.type === "ai" &&
              messageHasVisibleContent(laterData.message)
          );
        if (!hasLaterAssistantAnswer && data.message.id) {
          ids.add(data.message.id);
          break;
        }
      }

      return ids;
    }, [
      interrupt,
      isLoading,
      isStreamRecovering,
      processedMessages,
      runStatus,
    ]);
    const visibleMessages = useMemo(() => {
      if (showRuntimeDetails) {
        return processedMessages;
      }

      return processedMessages.filter((data) => {
        if (data.message.type !== "ai") {
          return true;
        }
        return (
          messageHasVisibleContent(data.message) ||
          Boolean(
            data.message.id && terminalToolIssueMessageIds.has(data.message.id)
          )
        );
      });
    }, [processedMessages, showRuntimeDetails, terminalToolIssueMessageIds]);

    const shouldShowThinkingPlaceholder = useMemo(() => {
      return runStatus === "running" || isLoading || isStreamRecovering;
    }, [isLoading, isStreamRecovering, runStatus]);

    const displayMessages = useMemo(() => {
      return visibleMessages.filter((data) => {
        if (data.message.type !== "ai") {
          return true;
        }
        return (
          messageHasVisibleContent(data.message) || data.toolCalls.length > 0
        );
      });
    }, [visibleMessages]);
    const shouldShowThreadLoading =
      isThreadLoading && messages.length === 0 && !recoveryNotice;
    const recoveredInputMessage = useMemo(() => {
      if (!recoveryNotice) {
        return null;
      }

      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.type === "human") {
          return message;
        }
      }

      return null;
    }, [messages, recoveryNotice]);
    const recoveredInputText = useMemo(() => {
      return recoveredInputMessage
        ? extractVisibleStringFromMessageContent(recoveredInputMessage).trim()
        : "";
    }, [recoveredInputMessage]);
    const recoveredInputTextRef = useRef<HTMLPreElement>(null);
    const isStaleActiveRunNotice = recoveryNotice?.kind === "stale_active_run";

    const selectRecoveredInputText = useCallback(() => {
      const element = recoveredInputTextRef.current;
      const selection = document.getSelection();
      if (!element || !selection) {
        return false;
      }

      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }, []);

    const handleCopyRecoveredInput = useCallback(async () => {
      if (!recoveredInputText) {
        toast.error(t("noOriginalInputToCopy"));
        return;
      }

      try {
        await writeTextToClipboard(recoveredInputText);
        toast.success(t("copiedOriginalInput"));
      } catch {
        const selected = selectRecoveredInputText();
        toast.error(
          selected
            ? t("copyOriginalFallbackSelected")
            : t("copyOriginalFallbackManual")
        );
      }
    }, [recoveredInputText, selectRecoveredInputText, t]);

    const handleRetryRecoveredInput = useCallback(() => {
      if (!recoveredInputMessage) {
        toast.error(t("noOriginalInputToRerun"));
        return;
      }

      retryMessage(recoveredInputMessage, { previousMessages: [] });
    }, [recoveredInputMessage, retryMessage, t]);

    const completedAiMessage = useMemo<Message | null>(() => {
      if (
        showRuntimeDetails ||
        error ||
        (runStatus !== "completed" && runStatus !== "idle")
      ) {
        return null;
      }

      for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
        const message = visibleMessages[index].message;
        if (message.type === "ai") {
          return message;
        }
      }

      return null;
    }, [error, runStatus, showRuntimeDetails, visibleMessages]);

    const completedMessageCopyText = useMemo(() => {
      return completedAiMessage
        ? extractVisibleStringFromMessageContent(completedAiMessage).trim()
        : "";
    }, [completedAiMessage]);

    const handleCopyCompletedMessage = useCallback(async () => {
      if (!completedMessageCopyText) {
        toast.error(t("noAiOutputToCopy"));
        return;
      }

      try {
        await writeTextToClipboard(completedMessageCopyText);
        toast.success(t("copiedToClipboard"));
      } catch {
        toast.error(t("copyFailedManual"));
      }
    }, [completedMessageCopyText, t]);

    const intermediateMessages = useMemo(() => {
      if (showRuntimeDetails) {
        return [];
      }

      return processedMessages.filter(
        (data) =>
          data.toolCalls.length > 0 &&
          !(data.message.id && terminalToolIssueMessageIds.has(data.message.id))
      );
    }, [processedMessages, showRuntimeDetails, terminalToolIssueMessageIds]);

    const shouldShowTodosComplete =
      runStatus === "completed" ||
      (runStatus === "idle" &&
        !isThreadLoading &&
        !isLoading &&
        !isStreamRecovering &&
        !interrupt &&
        !error);
    const displayTodos = useMemo(
      () =>
        shouldShowTodosComplete
          ? todos.map((todo) => ({ ...todo, status: "completed" as const }))
          : todos,
      [shouldShowTodosComplete, todos]
    );

    const groupedTodos = {
      in_progress: displayTodos.filter((t) => t.status === "in_progress"),
      pending: displayTodos.filter((t) => t.status === "pending"),
      completed: displayTodos.filter((t) => t.status === "completed"),
    };

    const hasGoal = Boolean(goal?.objective);
    const hasTasks = hasGoal && displayTodos.length > 0;
    const hasFiles = Object.keys(files).length > 0;

    // Parse out any action requests or review configs from the interrupt
    const useBatchApproval = actionRequests.length > 1;

    const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
      if (useBatchApproval) return null;
      return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
    }, [actionRequests, useBatchApproval]);

    const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
      if (useBatchApproval) return null;
      return new Map(
        reviewConfigs
          .filter((rc: ReviewConfig) => rc.actionName)
          .map((rc: ReviewConfig) => [rc.actionName as string, rc])
      );
    }, [reviewConfigs, useBatchApproval]);

    const hasVisibleInterruptToolCall = useMemo(() => {
      return processedMessages.some((data) =>
        data.toolCalls.some(
          (toolCall) =>
            toolCall.status === "interrupted" &&
            (interruptedToolNames.size === 0 ||
              interruptedToolNames.has(toolCall.name))
        )
      );
    }, [processedMessages, interruptedToolNames]);

    const orphanActionRequests = useMemo(() => {
      if (useBatchApproval) return actionRequests;
      return hasVisibleInterruptToolCall ? [] : actionRequests;
    }, [actionRequests, hasVisibleInterruptToolCall, useBatchApproval]);

    const dropOverlayVisible = isChatDropActive || isPreparingDroppedAttachment;
    const dropOverlayTitle = isPreparingDroppedAttachment
      ? t("addingAttachment")
      : submitDisabled
      ? t("cannotAttachWhileRunning")
      : t("releaseToAttach");
    const dropOverlayDescription = submitDisabled
      ? t("waitForCurrentRun")
      : attachmentHint;
    const isEmptyThread =
      !shouldShowThreadLoading &&
      displayMessages.length === 0 &&
      !hasGoal &&
      !hasTasks &&
      !hasFiles &&
      !hasThreadSkills &&
      !errorMessage &&
      orphanActionRequests.length === 0 &&
      !isLoading &&
      !isStreamRecovering &&
      !recoveryNotice;

    return (
      <div
        className={cn(
          "relative flex flex-1 flex-col overflow-hidden bg-card/70 transition-[box-shadow,background-color]",
          isEmptyThread && "ocs-empty-thread",
          dropOverlayVisible && "bg-primary/5 ring-1 ring-inset ring-primary/35"
        )}
        onDragEnter={handleChatDragEnter}
        onDragOver={handleChatDragOver}
        onDragLeave={handleChatDragLeave}
        onDrop={handleChatDrop}
        data-chat-drop-root="true"
      >
        <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <Input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveTitleEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelTitleEdit();
                  }
                }}
                disabled={isSavingTitle}
                autoFocus
                className="h-7 max-w-xl"
                aria-label={t("chatTitle")}
              />
            ) : (
              <h2 className="truncate text-sm font-semibold text-foreground">
                {threadTitle}
              </h2>
            )}
          </div>

          {isEditingTitle ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => void saveTitleEdit()}
                disabled={isSavingTitle}
                aria-label={t("saveChatTitle")}
              >
                {isSavingTitle ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={cancelTitleEdit}
                disabled={isSavingTitle}
                aria-label={t("cancelChatTitleEdit")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                    onClick={startTitleEdit}
                    disabled={isThreadLoading}
                    aria-label={t("editChatTitle")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="center"
                  sideOffset={6}
                  className="whitespace-nowrap"
                >
                  {t("editChatTitle")}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        <div
          className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-card/70"
          data-chat-messages="true"
          ref={scrollRef}
        >
          <div
            className="mx-auto w-full max-w-[1180px] px-6 pb-6 pt-4"
            ref={contentRef}
          >
            {shouldShowThreadLoading ? (
              <div className="flex items-center justify-center p-8">
                <p className="text-muted-foreground">{t("loading")}</p>
              </div>
            ) : (
              <>
                {hasGoal && goal && (
                  <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm shadow-black/[0.03]">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      <Target className="h-4 w-4 text-primary" />
                      Goal
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-semibold normal-case tracking-normal",
                          goalStatusClassName(goal.status)
                        )}
                      >
                        {goalStatusText(goal.status)}
                      </span>
                      <span className="normal-case tracking-normal">
                        {formatGoalElapsed(goal.timeUsedSeconds || 0)}
                      </span>
                      {typeof goal.tokenBudget === "number" && (
                        <span className="normal-case tracking-normal">
                          Tokens {goal.tokensUsed || 0}/{goal.tokenBudget}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-foreground">
                      {goal.objective}
                    </div>
                  </div>
                )}
                {displayMessages.map((data, index) => {
                  const messageUi = ui?.filter(
                    (u: any) => u.metadata?.message_id === data.message.id
                  );
                  const isLastMessage = index === displayMessages.length - 1;
                  const prevVisibleMessage =
                    index > 0 ? displayMessages[index - 1].message : null;
                  const messageKey =
                    data.message.id ?? `${data.message.type}-${index}`;
                  const showTerminalToolIssueNotice = Boolean(
                    data.message.id &&
                      terminalToolIssueMessageIds.has(data.message.id)
                  );
                  const showInlineToolCalls =
                    showRuntimeDetails || showTerminalToolIssueNotice;
                  return (
                    <ChatMessage
                      key={messageKey}
                      message={data.message}
                      toolCalls={showInlineToolCalls ? data.toolCalls : []}
                      showAvatar={
                        data.message.type !== prevVisibleMessage?.type
                      }
                      isLoading={isLoading}
                      actionRequestsMap={
                        isLastMessage ? actionRequestsMap ?? undefined : undefined
                      }
                      reviewConfigsMap={
                        isLastMessage ? reviewConfigsMap ?? undefined : undefined
                      }
                      ui={showInlineToolCalls ? messageUi : undefined}
                      stream={stream}
                      onResumeInterrupt={resumeInterrupt}
                      graphId={assistant?.graph_id}
                      showTerminalToolIssueNotice={showTerminalToolIssueNotice}
                      onOpenAttachment={openAttachmentPreview}
                      workspaceRoot={workspaceRoot}
                    />
                  );
                })}
                {shouldShowThinkingPlaceholder && (
                  <div
                    className="mt-4 flex w-full max-w-full gap-3"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-start justify-center">
                      <div
                        className="border-primary/20 text-primary-foreground flex h-7 w-7 items-center justify-center rounded-md border bg-primary text-xs font-semibold tracking-wide shadow-sm shadow-black/[0.035]"
                        title="InternAgentS"
                        aria-label="InternAgentS"
                      >
                        IA
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{t("thinking")}</span>
                    </div>
                  </div>
                )}
                {recoveryNotice && (
                  <div
                    className="ml-10 mt-4 rounded-md border border-amber-400/35 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 shadow-sm shadow-black/[0.025] dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100"
                    role="status"
                  >
                    <div className="flex gap-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {isStaleActiveRunNotice
                            ? t("staleRunTitle")
                            : t("failedRunTitle")}
                        </div>
                        <p className="mt-1 text-sm text-amber-900/85 dark:text-amber-100/85">
                          {isStaleActiveRunNotice
                            ? t("staleRunDescription")
                            : t("recoveredInputDescription")}
                        </p>
                        {isStaleActiveRunNotice && recoveredInputText && (
                          <pre
                            ref={recoveredInputTextRef}
                            className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-amber-300/60 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-500/35 dark:bg-amber-950/25 dark:text-amber-50"
                          >
                            {recoveredInputText}
                          </pre>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {isStaleActiveRunNotice && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5 text-xs"
                              onClick={() => void handleCopyRecoveredInput()}
                              disabled={!recoveredInputText}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {t("copyOriginalRequest")}
                            </Button>
                          )}
                          {!isStaleActiveRunNotice && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5 text-xs"
                              onClick={handleRetryRecoveredInput}
                              disabled={
                                composerBusy ||
                                !assistant ||
                                !recoveredInputMessage
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t("rerun")}
                            </Button>
                          )}
                          {intermediateMessages.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5 text-xs text-amber-950 hover:text-amber-950 dark:text-amber-100 dark:hover:text-amber-100"
                              onClick={() => setShowIntermediateResults(true)}
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                              {t("viewIntermediateSteps")}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {intermediateMessages.length > 0 && (
                  <div className="ml-10 mt-4 overflow-hidden rounded-md border border-border/30 bg-muted/5 text-muted-foreground/70">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/10"
                      onClick={() =>
                        setShowIntermediateResults((current) => !current)
                      }
                      aria-expanded={showIntermediateResults}
                    >
                      <span>
                        {t("intermediateSteps")} · {intermediateMessages.length}{" "}
                        {t("steps")}
                      </span>
                      {showIntermediateResults ? (
                        <ChevronUp className="h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0" />
                      )}
                    </button>
                    {showIntermediateResults && (
                      <div className="border-t border-border/30 px-3 pb-3">
                        {intermediateMessages.map((data, index) => {
                          const messageUi = ui?.filter(
                            (u: any) =>
                              u.metadata?.message_id === data.message.id
                          );
                          return (
                            <ChatMessage
                              key={`intermediate-${data.message.id ?? index}`}
                              message={data.message}
                              toolCalls={data.toolCalls}
                              showAvatar={false}
                              isLoading={false}
                              runtimeMuted
                              ui={messageUi}
                              stream={stream}
                              onResumeInterrupt={resumeInterrupt}
                              graphId={assistant?.graph_id}
                              onOpenAttachment={openAttachmentPreview}
                              workspaceRoot={workspaceRoot}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {completedAiMessage && (
                  <div className="ml-10 mt-2 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span>{t("complete")}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => void handleCopyCompletedMessage()}
                          disabled={!completedMessageCopyText}
                          aria-label={t("copyLastAiOutput")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t("copy")}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        className="whitespace-nowrap"
                      >
                        {t("copyLastAiOutput")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
                {errorMessage && (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                    <div>{errorMessage}</div>
                  </div>
                )}
                {orphanActionRequests.length > 0 && (
                  <div className="mt-4 flex w-full flex-col gap-3">
                    {useBatchApproval ? (
                      <BatchToolApprovalInterrupt
                        actionRequests={orphanActionRequests}
                        reviewConfigs={reviewConfigs}
                        onResume={resumeInterrupt}
                        isLoading={isLoading}
                      />
                    ) : (
                      orphanActionRequests.map((actionRequest, index) => (
                        <ToolApprovalInterrupt
                          key={`${actionRequest.name}-${index}`}
                          actionRequest={actionRequest}
                          reviewConfig={reviewConfigsMap?.get(actionRequest.name)}
                          onResume={resumeInterrupt}
                          isLoading={isLoading}
                        />
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div
          className="flex-shrink-0 border-t border-border/70 bg-background/80"
          data-chat-composer-shell="true"
        >
          <div
            className={cn(
              "mx-auto mb-4 mt-3 flex w-[calc(100%-32px)] max-w-[1180px] flex-shrink-0 flex-col",
              "transition-colors duration-200 ease-in-out"
            )}
          >
            {(hasGoal || hasTasks || hasFiles || hasThreadSkills) && (
              <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-muted/50 empty:hidden">
                {!metaOpen && (
                  <>
                    {(() => {
                      const activeTask = displayTodos.find(
                        (t) => t.status === "in_progress"
                      );

                      const totalTasks = displayTodos.length;
                      const remainingTasks =
                        totalTasks - groupedTodos.pending.length;
                      const isCompleted = totalTasks === remainingTasks;

                      const tasksTrigger = (() => {
                        if (!hasTasks) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "tasks" ? null : "tasks"
                              )
                            }
                            className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                            aria-expanded={metaOpen === "tasks"}
                          >
                            {(() => {
                              if (isCompleted) {
                                return [
                                  <CheckCircle
                                    key="icon"
                                    size={16}
                                    className="text-success/80"
                                  />,
                                  <span
                                    key="label"
                                    className="ml-[1px] min-w-0 truncate text-sm"
                                  >
                                    {t("allSubtasksComplete")}
                                  </span>,
                                ];
                              }

                              if (activeTask != null) {
                                return [
                                  <div key="icon">
                                    {getStatusIcon(activeTask.status)}
                                  </div>,
                                  <span
                                    key="label"
                                    className="ml-[1px] min-w-0 truncate text-sm"
                                  >
                                    {t("subtasks")}{" "}
                                    {totalTasks - groupedTodos.pending.length} /{" "}
                                    {totalTasks}
                                  </span>,
                                  <span
                                    key="content"
                                    className="min-w-0 gap-2 truncate text-sm text-muted-foreground"
                                  >
                                    {activeTask.content}
                                  </span>,
                                ];
                              }

                              return [
                                <Circle
                                  key="icon"
                                  size={16}
                                  className="text-tertiary/70"
                                />,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  {t("subtasks")}{" "}
                                  {totalTasks - groupedTodos.pending.length} /{" "}
                                  {totalTasks}
                                </span>,
                              ];
                            })()}
                          </button>
                        );
                      })();

                      const goalTrigger = (() => {
                        if (!hasGoal || !goal) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "goal" ? null : "goal"
                              )
                            }
                            className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                            aria-expanded={metaOpen === "goal"}
                          >
                            <Target
                              size={16}
                              className="text-primary"
                            />
                            <span className="ml-[1px] min-w-0 truncate text-sm">
                              {t("goal")} · {goalStatusText(goal.status)}
                            </span>
                            <span className="min-w-0 truncate text-sm text-muted-foreground">
                              {goal.objective}
                            </span>
                          </button>
                        );
                      })();

                      const skillsTrigger = (() => {
                        if (!hasThreadSkills || !threadSkills) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                Date.now() <
                                suppressSkillsMetaToggleUntilRef.current
                              ) {
                                return;
                              }
                              setMetaOpen((prev) =>
                                prev === "skills" ? null : "skills"
                              );
                            }}
                            className="grid min-w-[220px] flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                            aria-expanded={metaOpen === "skills"}
                          >
                            <Sparkles
                              size={16}
                              className="text-primary"
                            />
                            <span className="ml-[1px] min-w-0 truncate text-sm">
                              {t("skills")} · {threadSkills.active.length}
                            </span>
                            <span className="min-w-0 truncate text-sm text-muted-foreground">
                              {threadSkills.active
                                .map((skill) => skill.name)
                                .join("、")}
                            </span>
                          </button>
                        );
                      })();

                      const filesTrigger = (() => {
                        if (!hasFiles) return null;
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "files" ? null : "files"
                              )
                            }
                            className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm transition-colors hover:bg-accent/70"
                            aria-expanded={metaOpen === "files"}
                          >
                            <FileIcon size={16} />
                            {t("filesState")}
                            <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
                              {Object.keys(files).length}
                            </span>
                          </button>
                        );
                      })();

                      return (
                        <div className="flex flex-wrap items-center">
                          {goalTrigger}
                          {skillsTrigger}
                          {tasksTrigger}
                          {filesTrigger}
                        </div>
                      );
                    })()}
                  </>
                )}

                {metaOpen && (
                  <>
                    <div className="sticky top-0 flex items-stretch border-b border-border bg-card text-sm">
                      {hasGoal && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "goal" ? null : "goal"
                            )
                          }
                          aria-expanded={metaOpen === "goal"}
                        >
                          <Target className="h-4 w-4 text-primary" />
                          {t("goal")}
                        </button>
                      )}
                      {hasTasks && (
                        <button
                          type="button"
                          className="py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "tasks" ? null : "tasks"
                            )
                          }
                          aria-expanded={metaOpen === "tasks"}
                        >
                          {t("subtasks")}
                        </button>
                      )}
                      {hasThreadSkills && threadSkills && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "skills" ? null : "skills"
                            )
                          }
                          aria-expanded={metaOpen === "skills"}
                        >
                          <Sparkles className="h-4 w-4 text-primary" />
                          {t("skills")}
                          <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
                            {threadSkills.active.length}
                          </span>
                        </button>
                      )}
                      {hasFiles && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "files" ? null : "files"
                            )
                          }
                          aria-expanded={metaOpen === "files"}
                        >
                          {t("filesState")}
                          <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      )}
                      <button
                        aria-label={t("close")}
                        className="flex-1"
                        onClick={() => setMetaOpen(null)}
                      />
                    </div>
                    <div
                      ref={tasksContainerRef}
                      className="px-[18px]"
                    >
                      {metaOpen === "goal" && goal && (
                        <div className="mb-5 rounded-md border border-border bg-card px-3 py-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs font-semibold",
                                goalStatusClassName(goal.status)
                              )}
                            >
                              {goalStatusText(goal.status)}
                            </span>
                            <span>
                              {formatGoalElapsed(goal.timeUsedSeconds || 0)}
                            </span>
                            {typeof goal.tokenBudget === "number" && (
                              <span>
                                Tokens {goal.tokensUsed || 0}/{goal.tokenBudget}
                              </span>
                            )}
                          </div>
                          <div className="text-sm leading-6 text-foreground">
                            {goal.objective}
                          </div>
                        </div>
                      )}

                      {metaOpen === "tasks" &&
                        Object.entries(groupedTodos)
                          .filter(([_, todos]) => todos.length > 0)
                          .map(([status, todos]) => (
                            <div
                              key={status}
                              className="mb-4"
                            >
                              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-tertiary">
                                {todoStatusText(status as TodoItem["status"])}
                              </h3>
                              <div className="grid grid-cols-[auto_1fr] gap-3 rounded-sm p-1 pl-0 text-sm">
                                {todos.map((todo, index) => (
                                  <Fragment
                                    key={`${status}_${todo.id}_${index}`}
                                  >
                                    {getStatusIcon(todo.status, "mt-0.5")}
                                    <span className="break-words text-inherit">
                                      {todo.content}
                                    </span>
                                  </Fragment>
                                ))}
                              </div>
                            </div>
                          ))}

                      {metaOpen === "skills" && threadSkills && (
                        <div className="mb-5 grid gap-2">
                          {threadSkills.active.map((skill) => (
                            <div
                              key={skill.key}
                              className="grid grid-cols-[auto_1fr_auto] gap-3 rounded-md border border-border bg-card px-3 py-3"
                            >
                              <span className="border-primary/20 bg-primary/10 flex h-8 w-8 items-center justify-center rounded-md border text-sm font-semibold text-primary">
                                {skill.name.slice(0, 1)}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-foreground">
                                  {skill.name}
                                </span>
                                {skill.description && (
                                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                                    {skill.description}
                                  </span>
                                )}
                              </span>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => removeActiveThreadSkill(skill)}
                                disabled={composerBusy}
                                aria-label={t("removeSkill", {
                                  name: skill.name,
                                })}
                                title={t("removeSkill", {
                                  name: skill.name,
                                })}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {metaOpen === "files" && (
                        <div className="mb-6">
                          <FilesPopover
                            files={files}
                            setFiles={setFiles}
                            editDisabled={
                              isLoading === true || interrupt !== undefined
                            }
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <form
              id="chat-composer"
              ref={composerRef}
              onSubmit={handleSubmit}
              className="relative flex flex-col"
            >
              {dropOverlayVisible && (
                <div
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-[1px]"
                  data-chat-drop-overlay="true"
                >
                  <div className="border-primary/45 flex min-w-56 flex-col items-center gap-2 rounded-md border border-dashed bg-card/90 px-5 py-4 text-center shadow-lg shadow-black/[0.04]">
                    <div className="bg-primary/10 flex h-9 w-9 items-center justify-center rounded-full text-primary">
                      {isPreparingDroppedAttachment ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      {dropOverlayTitle}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {dropOverlayDescription}
                    </div>
                  </div>
                </div>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleAttachmentFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleAttachmentFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />
              {mentionMenuOpen &&
                mentionMenuPosition &&
                typeof document !== "undefined" &&
                createPortal(
                  <div
                    ref={mentionMenuRef}
                    style={
                      mentionMenuIsCommandPalette
                        ? undefined
                        : {
                            bottom: mentionMenuPosition.bottom,
                            left: mentionMenuPosition.left,
                            width: mentionMenuPosition.width,
                          }
                    }
                    className={cn(
                      "fixed z-50 overflow-hidden border border-border bg-popover text-popover-foreground shadow-lg shadow-black/10",
                      mentionMenuIsCommandPalette
                        ? "left-1/2 top-[14vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl shadow-2xl shadow-black/20"
                        : "rounded-lg"
                    )}
                    role={mentionMenuIsCommandPalette ? "dialog" : "listbox"}
                    aria-label={mentionMenuTitle}
                  >
                    {mentionMenuIsCommandPalette ? (
                      <div className="border-b border-border/70 px-4 py-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="min-w-0 truncate text-sm font-semibold text-foreground">
                            {mentionMenuTitle}
                          </div>
                          <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t("resultCount", {
                              count: mentionOptions.length,
                            })}
                          </div>
                        </div>
                        <input
                          ref={commandSearchInputRef}
                          value={mentionQuery}
                          onChange={(event) => {
                            const query = event.currentTarget.value;
                            setMentionContext((current) =>
                              current
                                ? {
                                    ...current,
                                    query,
                                    kind: "search",
                                    trigger: null,
                                  }
                                : current
                            );
                          }}
                          onKeyDown={handleSuggestionKeyDown}
                          className="h-10 w-full border-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                          placeholder={t("searchThisProject")}
                          aria-label={t("searchComposer")}
                          role="combobox"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {mentionMenuTitle}
                          </div>
                        </div>
                        {mentionMenuLoading && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    )}
                    {mentionMenuError ? (
                      <div className="px-3 py-4 text-sm text-red-600">
                        {mentionMenuError}
                      </div>
                    ) : mentionMenuLoading && mentionOptions.length === 0 ? (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {mentionMenuLoadingText}
                      </div>
                    ) : mentionOptions.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground">
                        {mentionMenuEmptyText}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "scrollbar-subtle overflow-y-auto p-1",
                          mentionMenuIsCommandPalette
                            ? "max-h-[60vh]"
                            : "max-h-56"
                        )}
                        role="listbox"
                      >
                        {mentionSections.map((section, sectionIndex) => {
                          const sectionStartIndex = mentionSections
                            .slice(0, sectionIndex)
                            .reduce(
                              (count, current) =>
                                count + current.options.length,
                              0
                            );
                          return (
                            <Fragment key={section.title || "options"}>
                              {section.title && (
                                <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {section.title}
                                </div>
                              )}
                              {section.options.map((option, optionIndex) => {
                                const index = sectionStartIndex + optionIndex;
                                const active = index === activeMentionIndex;
                                const selectedForThread =
                                  option.type === "skill" &&
                                  option.selectedForThread;
                                return (
                                  <button
                                    key={option.key}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    onMouseEnter={() =>
                                      setActiveMentionIndex(index)
                                    }
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      void selectComposerOption(option);
                                    }}
                                    className={cn(
                                      "flex min-h-12 w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                      active
                                        ? "bg-accent text-accent-foreground"
                                        : "text-popover-foreground hover:bg-accent/70"
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                                        selectedForThread
                                          ? "border-primary/25 bg-primary/10 text-primary"
                                          : "border-border bg-background text-muted-foreground"
                                      )}
                                    >
                                      {selectedForThread ? (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                      ) : option.type === "thread" ? (
                                        <MessageSquare className="h-3.5 w-3.5" />
                                      ) : option.type === "skill" ? (
                                        <Sparkles className="h-3.5 w-3.5" />
                                      ) : option.type === "command" ? (
                                        <Pencil className="h-3.5 w-3.5" />
                                      ) : (
                                        <FileIcon className="h-3.5 w-3.5" />
                                      )}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-sm font-medium">
                                        {option.label}
                                      </span>
                                      {option.description && (
                                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                          {option.description}
                                        </span>
                                      )}
                                    </span>
                                    {selectedForThread && (
                                      <span className="text-xs text-muted-foreground">
                                        {t("enabled")}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </div>
                    )}
                    {mentionMenuIsCommandPalette && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-4 py-2 text-[11px] text-muted-foreground">
                        <span>{t("navigateHint")}</span>
                        <span>{t("openHint")}</span>
                        <span>{t("mentionHint")}</span>
                        <span>{t("closeHint")}</span>
                        <span>@ {t("artifact")}</span>
                        <span># {t("sessions")}</span>
                      </div>
                    )}
                  </div>,
                  document.body
                )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 border-b border-border px-[18px] py-2">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className={cn(
                        "flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                        attachment.error
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-border bg-muted text-foreground"
                      )}
                    >
                      {attachment.kind === "image" && attachment.dataUrl ? (
                        <img
                          src={attachment.dataUrl}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      {attachment.workspacePath ? (
                        <button
                          type="button"
                          className="min-w-0 max-w-[180px] truncate text-left hover:text-primary"
                          onClick={() =>
                            openAttachmentPreview(attachment.workspacePath!)
                          }
                          title={t("openProjectFile", {
                            path: attachment.workspacePath,
                          })}
                        >
                          {attachment.name}
                        </button>
                      ) : (
                        <span className="min-w-0 max-w-[180px] truncate">
                          {attachment.name}
                        </span>
                      )}
                      <span className="shrink-0 text-muted-foreground">
                        {attachment.error ||
                          formatAttachmentSize(attachment.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label={t("removeAttachment", {
                          name: attachment.name,
                        })}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onCompositionStart={handleComposerCompositionStart}
                onCompositionEnd={handleComposerCompositionEnd}
                onKeyDown={handleKeyDown}
                placeholder={
                  isStreamRecovering
                    ? t("recoveringSession")
                    : isLoading
                    ? t("running")
                    : t("chatPlaceholder", {
                        shortcut: composerSearchShortcut,
                      })
                }
                className="font-inherit field-sizing-content min-h-[64px] flex-1 resize-none border-0 bg-transparent px-4 pb-2.5 pt-4 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                rows={2}
              />
              <div className="ocs-composer-toolbar flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={submitDisabled}
                        aria-label={t("addImage")}
                      >
                        <ImagePlus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("addImage")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={submitDisabled}
                        aria-label={t("addAttachment")}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("addAttachment")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => insertComposerTrigger("@")}
                        disabled={isLoading}
                        aria-label={t("mentionFilesArtifacts")}
                      >
                        <AtSign className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("mentionFilesArtifacts")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => insertComposerTrigger("#")}
                        disabled={isLoading}
                        aria-label={t("mentionSessions")}
                      >
                        <Hash className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("mentionSessions")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => insertComposerTrigger("/")}
                        disabled={isLoading}
                        aria-label={t("mentionSkills")}
                      >
                        <span className="font-mono text-base leading-none">
                          /
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("mentionSkills")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ocs-composer-icon-button h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={openComposerSearch}
                        disabled={isLoading}
                        aria-label={t("searchComposerShortcut", {
                          shortcut: composerSearchShortcut,
                        })}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="center"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      {t("searchComposerShortcut", {
                        shortcut: composerSearchShortcut,
                      })}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {isStreamRecovering ? (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{t("recovering")}</span>
                    </div>
                  ) : null}
                  <Button
                    type={isLoading ? "button" : "submit"}
                    variant={
                      isLoading
                        ? "destructive"
                        : canSendMessage
                        ? "default"
                        : "outline"
                    }
                    onClick={isLoading ? stopStream : handleSubmit}
                    disabled={!isLoading && (submitDisabled || !canSendMessage)}
                    className="ocs-composer-send h-9 rounded-lg px-3 shadow-none"
                  >
                    {isLoading ? (
                      <>
                        <Square size={14} />
                        <span>{t("stop")}</span>
                      </>
                    ) : (
                      <>
                        <ArrowUp size={18} />
                        <span>{t("send")}</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }
);

ChatInterface.displayName = "ChatInterface";
