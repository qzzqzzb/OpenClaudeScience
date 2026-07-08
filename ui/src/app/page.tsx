"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Suspense,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Columns2,
  File,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Plus,
  Presentation,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  List,
  UploadCloud,
  X,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  getConfig,
  getResource,
  type ResourceConfig,
  type StandaloneConfig,
} from "@/lib/config";
import { Assistant } from "@langchain/langgraph-sdk";
import {
  RemoteAgentProvider,
  useRemoteAgent,
} from "@/providers/ClientProvider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { ThreadList } from "@/app/components/ThreadList";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";
import { useLanguage } from "@/app/hooks/useLanguage";
import { useThreads } from "@/app/hooks/useThreads";
import { useWorkspaceFiles } from "@/app/hooks/useWorkspaceFiles";
import {
  WORKBENCH_RETURN_STORAGE_KEY,
  pageHrefWithWorkbenchReturn,
  workbenchHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import { displayResourceLabel } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  shouldOpenOnboarding as shouldOpenOnboardingRequest,
} from "@/app/services/configClient";
import { listResources } from "@/app/services/resourcesClient";
import {
  isLocalBackendReady,
  isLocalDeploymentUrl,
} from "@/app/services/runtimeClient";
import {
  ensureRemoteConnectionStream,
  pushBackendCliStream,
} from "@/app/services/remoteClient";
import {
  listWorkspaces,
  pickWorkspace as pickWorkspaceRequest,
  setDefaultWorkspace,
} from "@/app/services/workspacesClient";

const OPEN_WORKSPACE_VALUE = "__open_workspace__";
const ADD_REMOTE_WORKSPACE_VALUE = "__add_remote_workspace__";
const NEW_THREAD_MARKER = "__new_thread__";
const BACKEND_READY_CACHE_PREFIX = "internagents.backend.ready";
const BACKEND_READY_CACHE_TTL_MS = 5 * 60 * 1000;

function backendReadyCacheKey(deploymentUrl: string): string {
  return `${BACKEND_READY_CACHE_PREFIX}:${deploymentUrl}`;
}

function readBackendReadyCache(deploymentUrl: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const value = window.sessionStorage.getItem(
    backendReadyCacheKey(deploymentUrl)
  );
  const timestamp = value ? Number.parseInt(value, 10) : 0;
  return Number.isFinite(timestamp) && Date.now() - timestamp < BACKEND_READY_CACHE_TTL_MS;
}

function writeBackendReadyCache(deploymentUrl: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    backendReadyCacheKey(deploymentUrl),
    String(Date.now())
  );
}

function formatConversationTabTime(date: Date, language: string): string {
  try {
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 5);
  }
}

function StartupState() {
  const { t } = useLanguage();
  return (
    <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("appStarting")}</span>
      </div>
    </div>
  );
}

interface HomePageInnerProps {
  config: StandaloneConfig;
  activeResource: ResourceConfig;
  activeAssistantId: string;
  activeWorkspace: LocalWorkspace | null;
  workspaces: LocalWorkspace[];
  isActiveLocalResource: boolean;
  onResourceChange: (resourceId: string) => Promise<void>;
  onWorkspaceChange: (workspaceId: string) => Promise<void>;
  onWorkspacePick: () => Promise<void>;
  onResourcesRefresh: (
    resources?: ResourceConfig[]
  ) => Promise<ResourceConfig[]>;
}

function HomePageInner({
  config,
  activeResource,
  activeAssistantId,
  activeWorkspace,
  workspaces,
  isActiveLocalResource,
  onResourceChange,
  onWorkspaceChange,
  onWorkspacePick,
  onResourcesRefresh,
}: HomePageInnerProps) {
  const { language, t } = useLanguage();
  const remoteAgent = useRemoteAgent();
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useQueryState("threadId");
  const [selectedFilePath, setSelectedFilePath] = useQueryState("file");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [openThreadTabIds, setOpenThreadTabIds] = useState<string[]>(() => [
    threadId ?? NEW_THREAD_MARKER,
  ]);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [ensuringResourceId, setEnsuringResourceId] = useState<string | null>(
    null
  );
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [pushingBackendCli, setPushingBackendCli] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const previousObservedThreadIdRef = useRef<string | null>(threadId ?? null);
  const intentionalThreadChangeRef = useRef<string | null>(null);
  const generatedThreadIdRef = useRef<string | null>(null);

  const threadTabs = useThreads({
    limit: 20,
    resourceId: activeResource.id,
    runtimeUrl: activeResource.runtimeUrl,
    assistantId: activeAssistantId,
    workspaceId: isActiveLocalResource ? activeWorkspace?.id : undefined,
  });
  const mutateOpenThreadTabs = threadTabs.mutate;

  const openThreadItems = useMemo(
    () => threadTabs.data?.flat() ?? [],
    [threadTabs.data]
  );
  const openThreadMap = useMemo(
    () => new Map(openThreadItems.map((thread) => [thread.id, thread])),
    [openThreadItems]
  );
  const activeThreadTabId = threadId ?? NEW_THREAD_MARKER;
  const tabScope = `${activeResource.id}:${activeAssistantId}:${
    isActiveLocalResource ? activeWorkspace?.id || "workspace" : "resource"
  }`;
  const previousTabScopeRef = useRef(tabScope);

  const fetchAssistant = useCallback(async () => {
    setAssistant(await remoteAgent.resolveAssistant());
  }, [remoteAgent]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

  const resetForegroundChat = useCallback(() => {
    setChatInstanceKey((key) => key + 1);
  }, []);

  const handleThreadSelect = useCallback(
    async (id: string) => {
      if (id === threadId) return;
      setOpenThreadTabIds((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
      intentionalThreadChangeRef.current = id;
      await setThreadId(id);
      resetForegroundChat();
    },
    [resetForegroundChat, setThreadId, threadId]
  );

  const handleNewThread = useCallback(async () => {
    setOpenThreadTabIds((tabs) =>
      tabs.includes(NEW_THREAD_MARKER) ? tabs : [...tabs, NEW_THREAD_MARKER]
    );
    intentionalThreadChangeRef.current = NEW_THREAD_MARKER;
    await setThreadId(null);
    resetForegroundChat();
  }, [resetForegroundChat, setThreadId]);

  const handleGeneratedThreadId = useCallback((id: string) => {
    generatedThreadIdRef.current = id;
    setOpenThreadTabIds((tabs) => {
      if (tabs.includes(id)) {
        return tabs.filter((tabId) => tabId !== NEW_THREAD_MARKER);
      }
      if (tabs.includes(NEW_THREAD_MARKER)) {
        return tabs.map((tabId) => (tabId === NEW_THREAD_MARKER ? id : tabId));
      }
      return [...tabs, id];
    });
  }, []);

  const handleThreadTabSelect = useCallback(
    async (id: string) => {
      if (id === activeThreadTabId) return;
      intentionalThreadChangeRef.current = id;
      await setThreadId(id === NEW_THREAD_MARKER ? null : id);
      resetForegroundChat();
    },
    [activeThreadTabId, resetForegroundChat, setThreadId]
  );

  const handleThreadTabClose = useCallback(
    async (id: string) => {
      const currentTabs = openThreadTabIds.length
        ? openThreadTabIds
        : [activeThreadTabId];
      const closedIndex = currentTabs.indexOf(id);
      const remainingTabs = currentTabs.filter((tabId) => tabId !== id);
      const nextTabs = remainingTabs.length ? remainingTabs : [NEW_THREAD_MARKER];
      setOpenThreadTabIds(nextTabs);

      if (id !== activeThreadTabId) {
        return;
      }

      const fallbackTabId =
        remainingTabs[closedIndex] ??
        remainingTabs[closedIndex - 1] ??
        NEW_THREAD_MARKER;
      intentionalThreadChangeRef.current = fallbackTabId;
      await setThreadId(
        fallbackTabId === NEW_THREAD_MARKER ? null : fallbackTabId
      );
      resetForegroundChat();
    },
    [activeThreadTabId, openThreadTabIds, resetForegroundChat, setThreadId]
  );

  const openConversationTabs = useMemo(
    () => {
      const tabs = openThreadTabIds.map((id) => {
        const thread = id === NEW_THREAD_MARKER ? null : openThreadMap.get(id);
        return {
          id,
          updatedAt: thread?.updatedAt,
          status: thread?.status,
          title:
            id === NEW_THREAD_MARKER
              ? t("newThread")
              : thread?.title || `${t("sessions")} ${id.slice(0, 8)}`,
        };
      });
      const titleCounts = tabs.reduce((counts, tab) => {
        counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1);
        return counts;
      }, new Map<string, number>());

      return tabs.map((tab) => {
        if (tab.id === NEW_THREAD_MARKER || titleCounts.get(tab.title) === 1) {
          return tab;
        }
        const suffix = tab.updatedAt
          ? formatConversationTabTime(tab.updatedAt, language)
          : tab.id.slice(0, 4);
        return {
          ...tab,
          title: `${tab.title} · ${suffix}`,
        };
      });
    },
    [language, openThreadMap, openThreadTabIds, t]
  );

  useEffect(() => {
    const previousThreadId = previousObservedThreadIdRef.current;
    const nextThreadId = threadId ?? null;
    if (previousThreadId === nextThreadId) return;

    previousObservedThreadIdRef.current = nextThreadId;

    const intentionalThreadId = intentionalThreadChangeRef.current;
    const expectedIntentionalThreadId = nextThreadId ?? NEW_THREAD_MARKER;
    if (intentionalThreadId === expectedIntentionalThreadId) {
      intentionalThreadChangeRef.current = null;
      return;
    }

    if (generatedThreadIdRef.current === nextThreadId) {
      generatedThreadIdRef.current = null;
      return;
    }

    resetForegroundChat();
  }, [resetForegroundChat, threadId]);

  useEffect(() => {
    const nextTabId = threadId ?? NEW_THREAD_MARKER;
    setOpenThreadTabIds((tabs) =>
      tabs.includes(nextTabId) ? tabs : [...tabs, nextTabId]
    );
  }, [threadId]);

  useEffect(() => {
    if (previousTabScopeRef.current === tabScope) return;
    previousTabScopeRef.current = tabScope;
    setOpenThreadTabIds([threadId ?? NEW_THREAD_MARKER]);
  }, [tabScope, threadId]);

  const handleFileSelect = useCallback(
    async (entry: WorkspaceEntry) => {
      if (entry.kind === "file") {
        setInspectorOpen(true);
        await setSelectedFilePath(entry.path);
      }
    },
    [setSelectedFilePath]
  );

  const handleFilePathSelect = useCallback(
    async (path: string) => {
      setInspectorOpen(true);
      await setSelectedFilePath(path);
    },
    [setSelectedFilePath]
  );

  const handleClearSelectedFile = useCallback(async () => {
    await setSelectedFilePath(null);
  }, [setSelectedFilePath]);

  const ensureRemoteResource = useCallback(
    async (resourceId: string) => {
      const toastId = toast.loading(t("remoteRuntimeSyncing"));
      try {
        const result = await ensureRemoteConnectionStream({
          resourceId,
          messages: {
            failed: t("remoteRuntimeSyncFailed"),
            noLog: t("remoteRuntimeNoLog"),
            noResult: t("remoteRuntimeNoResult"),
          },
          onLog() {
            // The workbench keeps this toast compact and only reports completion.
          },
        });

        toast.dismiss(toastId);
        await onResourcesRefresh(result.resources);
        toast.success(
          result.state === "updated"
            ? `远程 backend 已同步到 ${result.targetReleaseTag}`
            : `远程 backend 已是 ${result.targetReleaseTag}`
        );
        return result.resource;
      } catch (error) {
        toast.dismiss(toastId);
        throw error;
      }
    },
    [onResourcesRefresh, t]
  );

  const handleResourceChange = useCallback(
    async (resourceId: string) => {
      try {
        setEnsuringResourceId(resourceId);
        const nextResource = config.resources.find(
          (resource) => resource.id === resourceId
        );
        if (nextResource && nextResource.id !== "local") {
          await ensureRemoteResource(resourceId);
        }
        await setThreadId(null);
        await setSelectedFilePath(null);
        setOpenThreadTabIds([NEW_THREAD_MARKER]);
        await onResourceChange(resourceId);
        mutateThreads?.();
        void mutateOpenThreadTabs();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t("remoteProjectSwitchFailed");
        toast.error(message);
      } finally {
        setEnsuringResourceId(null);
      }
    },
    [
      config.resources,
      ensureRemoteResource,
      mutateOpenThreadTabs,
      mutateThreads,
      onResourceChange,
      setSelectedFilePath,
      setThreadId,
      t,
    ]
  );

  const handleWorkspaceChange = useCallback(
    async (workspaceId: string) => {
      try {
        await setThreadId(null);
        await setSelectedFilePath(null);
        setOpenThreadTabIds([NEW_THREAD_MARKER]);
        await onWorkspaceChange(workspaceId);
        mutateThreads?.();
        void mutateOpenThreadTabs();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("projectSwitchFailed");
        toast.error(message);
      }
    },
    [
      mutateOpenThreadTabs,
      mutateThreads,
      onWorkspaceChange,
      setSelectedFilePath,
      setThreadId,
      t,
    ]
  );

  const handleWorkspacePick = useCallback(async () => {
    try {
      setIsPickingWorkspace(true);
      await setThreadId(null);
      await setSelectedFilePath(null);
      setOpenThreadTabIds([NEW_THREAD_MARKER]);
      await onWorkspacePick();
      mutateThreads?.();
      void mutateOpenThreadTabs();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectPickFailed");
      toast.error(message);
    } finally {
      setIsPickingWorkspace(false);
    }
  }, [
    mutateOpenThreadTabs,
    mutateThreads,
    onWorkspacePick,
    setSelectedFilePath,
    setThreadId,
    t,
  ]);

  const handleEnvironmentChange = useCallback(
    async (value: string) => {
      if (value === ADD_REMOTE_WORKSPACE_VALUE) {
        setRemoteDialogOpen(true);
        return;
      }

      if (value === OPEN_WORKSPACE_VALUE) {
        await handleWorkspacePick();
        return;
      }

      if (value.startsWith("workspace:")) {
        await handleWorkspaceChange(value.slice("workspace:".length));
        return;
      }

      if (value.startsWith("resource:")) {
        await handleResourceChange(value.slice("resource:".length));
      }
    },
    [handleResourceChange, handleWorkspaceChange, handleWorkspacePick]
  );

  const handleRunActivity = useCallback(() => {
    mutateThreads?.();
    void mutateOpenThreadTabs();
    setWorkspaceRefreshKey((key) => key + 1);
  }, [mutateOpenThreadTabs, mutateThreads]);

  const isActiveSshResource =
    activeResource.backend === "ssh_shell" ||
    (!isActiveLocalResource && activeResource.id !== "local");

  const handleRemoteConfigured = useCallback(
    async (resource: ResourceConfig, resources: ResourceConfig[]) => {
      await setThreadId(null);
      await setSelectedFilePath(null);
      setOpenThreadTabIds([NEW_THREAD_MARKER]);
      await onResourcesRefresh(resources);
      await onResourceChange(resource.id);
      mutateThreads?.();
      void mutateOpenThreadTabs();
    },
    [
      mutateOpenThreadTabs,
      mutateThreads,
      onResourceChange,
      onResourcesRefresh,
      setSelectedFilePath,
      setThreadId,
    ]
  );

  const handlePushBackendCli = useCallback(async () => {
    if (!isActiveSshResource || pushingBackendCli) {
      return;
    }

    setPushingBackendCli(true);
    const toastId = toast.loading("Pushing backend CLI...");
    try {
      const result = await pushBackendCliStream({
        resourceId: activeResource.id,
        force: true,
        messages: {
          failed: "Backend CLI push failed.",
          noLog: "Backend CLI push failed: no log stream returned.",
          noResult: "Backend CLI push failed: completion event missing.",
        },
        onLog(message) {
          toast.loading(message, { id: toastId });
        },
      });

      await onResourcesRefresh(result.resources);
      mutateThreads?.();
      setWorkspaceRefreshKey((key) => key + 1);
      toast.success(`${result.resource.label} backend CLI updated`, {
        id: toastId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Backend CLI push failed.";
      toast.error(message, { id: toastId });
    } finally {
      setPushingBackendCli(false);
    }
  }, [
    activeResource.id,
    isActiveSshResource,
    mutateThreads,
    onResourcesRefresh,
    pushingBackendCli,
  ]);

  const environmentValue =
    isActiveLocalResource && activeWorkspace
      ? `workspace:${activeWorkspace.id}`
      : `resource:${activeResource.id}`;
  const remoteResources = config.resources.filter(
    (resource) => resource.id !== "local"
  );
  const environmentLabel =
    activeWorkspace?.label || displayResourceLabel(activeResource.label, language);
  const currentWorkbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const configHref = useMemo(
    () => pageHrefWithWorkbenchReturn("/config", searchParams),
    [searchParams]
  );
  const skillsHref = useMemo(
    () => `${pageHrefWithWorkbenchReturn("/config", searchParams)}#settings-skills`,
    [searchParams]
  );
  const projectsHref = "/projects";

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKBENCH_RETURN_STORAGE_KEY,
        currentWorkbenchHref
      );
    } catch {
      // Ignore storage failures; explicit returnTo links still carry context.
    }
  }, [currentWorkbenchHref]);

  return (
    <div className="internagents-home ocs-app-shell">
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="internagents-workbench-layout"
        className="ocs-workbench-panels"
      >
        <ResizablePanel
          id="workbench-sidebar"
          order={1}
          defaultSize={18}
          minSize={18}
          maxSize={28}
          className="ocs-workbench-panel"
        >
          <WorkbenchSidebar
            activeAssistantId={activeAssistantId}
            activeResource={activeResource}
            activeWorkspace={activeWorkspace}
            environmentLabel={environmentLabel}
            environmentValue={environmentValue}
            isActiveLocalResource={isActiveLocalResource}
            isActiveSshResource={isActiveSshResource}
            isPickingWorkspace={isPickingWorkspace}
            ensuringResourceId={ensuringResourceId}
            pushingBackendCli={pushingBackendCli}
            remoteResources={remoteResources}
            workspaces={workspaces}
            configHref={configHref}
            skillsHref={skillsHref}
            projectsHref={projectsHref}
            onEnvironmentChange={handleEnvironmentChange}
            onMutateReady={(fn) => setMutateThreads(() => fn)}
            onNewThread={handleNewThread}
            onPushBackendCli={handlePushBackendCli}
            onThreadSelect={handleThreadSelect}
          />
        </ResizablePanel>

        <ResizableHandle className="ocs-workbench-resize-handle" />

        <ResizablePanel
          id="workbench-chat"
          order={2}
          defaultSize={inspectorOpen ? 39 : 82}
          minSize={30}
          className="ocs-workbench-panel"
        >
          <section className="ocs-workspace">
            <ConversationTabs
              activeTabId={activeThreadTabId}
              closeLabel={t("close")}
              sessionsLabel={t("sessions")}
              tabs={openConversationTabs}
              onClose={handleThreadTabClose}
              onSelect={handleThreadTabSelect}
            />
            <ChatProvider
              key={`${activeResource.id}:${activeAssistantId}:${
                activeWorkspace?.id || "workspace"
              }:${chatInstanceKey}`}
              activeAssistant={assistant}
              streamConfig={config.stream}
              onHistoryRevalidate={handleRunActivity}
              onGeneratedThreadId={handleGeneratedThreadId}
              resourceId={activeResource.id}
              resourceLabel={activeResource.label}
              runtimeUrl={activeResource.runtimeUrl}
              workspaceId={
                isActiveLocalResource ? activeWorkspace?.id : undefined
              }
              workspacePath={
                isActiveLocalResource
                  ? activeWorkspace?.resolvedPath
                  : undefined
              }
              workspaceLabel={
                isActiveLocalResource ? activeWorkspace?.label : undefined
              }
            >
              <ChatInterface
                assistant={assistant}
                workspaceRoot={
                  isActiveLocalResource ? activeWorkspace?.resolvedPath : undefined
                }
                onOpenInspector={() => setInspectorOpen(true)}
                headerActions={
                  !inspectorOpen ? (
                    <button
                      type="button"
                      className="ocs-split-toggle"
                      onClick={() => setInspectorOpen(true)}
                      title={t("openInspector")}
                      aria-label={t("openInspector")}
                    >
                      <Columns2 className="h-4 w-4" />
                    </button>
                  ) : null
                }
              />
            </ChatProvider>
          </section>
        </ResizablePanel>

        {inspectorOpen && (
          <>
            <ResizableHandle className="ocs-workbench-resize-handle" />

            <ResizablePanel
              id="workbench-inspector"
              order={3}
              defaultSize={43}
              minSize={22}
              className="ocs-workbench-panel"
            >
              <WorkbenchInspector
                activeResource={activeResource}
                activeWorkspace={activeWorkspace}
                selectedFilePath={selectedFilePath}
                workspaceRefreshKey={workspaceRefreshKey}
                workspaceId={
                  isActiveLocalResource ? activeWorkspace?.id : undefined
                }
                onClearSelectedFile={handleClearSelectedFile}
                onClose={() => setInspectorOpen(false)}
                onFileSelect={handleFileSelect}
                onFilePathSelect={handleFilePathSelect}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <RemoteConnectionDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onConfigured={handleRemoteConfigured}
      />
    </div>
  );
}

interface ConversationTab {
  id: string;
  title: string;
  status?: string;
}

interface ConversationTabsProps {
  activeTabId: string;
  closeLabel: string;
  sessionsLabel: string;
  tabs: ConversationTab[];
  onClose: (id: string) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
}

function ConversationTabs({
  activeTabId,
  closeLabel,
  sessionsLabel,
  tabs,
  onClose,
  onSelect,
}: ConversationTabsProps) {
  return (
    <div
      className="ocs-conversation-tabs"
      role="tablist"
      aria-label={sessionsLabel}
    >
      <div className="ocs-conversation-tab-scroll">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isNewThread = tab.id === NEW_THREAD_MARKER;

          return (
            <div
              key={tab.id}
              className={cn("ocs-conversation-tab", {
                "is-active": isActive,
              })}
              data-status={tab.status || (isNewThread ? "new" : "idle")}
            >
              <button
                type="button"
                className="ocs-conversation-tab-main"
                title={tab.title}
                role="tab"
                aria-selected={isActive}
                onClick={() => void onSelect(tab.id)}
              >
                <span
                  className="ocs-conversation-tab-dot"
                  aria-hidden="true"
                />
                <span className="ocs-conversation-tab-title">
                  {tab.title}
                </span>
              </button>
              <button
                type="button"
                className="ocs-conversation-tab-close"
                title={`${closeLabel} ${tab.title}`}
                aria-label={`${closeLabel} ${tab.title}`}
                onClick={() => void onClose(tab.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface WorkbenchSidebarProps {
  activeAssistantId: string;
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
  environmentLabel: string;
  environmentValue: string;
  isActiveLocalResource: boolean;
  isActiveSshResource: boolean;
  isPickingWorkspace: boolean;
  ensuringResourceId: string | null;
  pushingBackendCli: boolean;
  remoteResources: ResourceConfig[];
  workspaces: LocalWorkspace[];
  configHref: string;
  skillsHref: string;
  projectsHref: string;
  onEnvironmentChange: (value: string) => Promise<void>;
  onMutateReady: (mutate: () => void) => void;
  onNewThread: () => Promise<void>;
  onPushBackendCli: () => void;
  onThreadSelect: (id: string) => void;
}

function WorkbenchSidebar({
  activeAssistantId,
  activeResource,
  activeWorkspace,
  environmentLabel,
  environmentValue,
  isActiveLocalResource,
  isActiveSshResource,
  isPickingWorkspace,
  ensuringResourceId,
  pushingBackendCli,
  remoteResources,
  workspaces,
  configHref,
  skillsHref,
  projectsHref,
  onEnvironmentChange,
  onMutateReady,
  onNewThread,
  onPushBackendCli,
  onThreadSelect,
}: WorkbenchSidebarProps) {
  const { language, t } = useLanguage();
  const runtimeLabel = isActiveLocalResource ? t("local") : t("remote");

  return (
    <aside
      className="ocs-sidebar"
    >
      <section className="ocs-brand">
        <Link
          href={projectsHref}
          className="ocs-project-list-link"
          aria-label={t("backToProjects")}
        >
          <ArrowLeft size={15} />
          <span>{t("projectList")}</span>
        </Link>
        <div>
          <h1>InternAgentS</h1>
          <span>{t("projectWorkbench")}</span>
        </div>
      </section>

      <section
        className="ocs-project-picker"
      >
        <div className="ocs-project-picker-label">
          <span>{t("currentProject")}</span>
          <span>{runtimeLabel}</span>
        </div>
        <Select
          value={environmentValue}
          onValueChange={(value) => void onEnvironmentChange(value)}
        >
          <SelectTrigger className="ocs-project-trigger">
            <span className="ocs-project-trigger-content">
              {isPickingWorkspace || ensuringResourceId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className="ocs-project-status-dot"
                  aria-hidden="true"
                />
              )}
              <span className="ocs-project-name">{environmentLabel}</span>
            </span>
          </SelectTrigger>
          <SelectContent
            align="start"
            className="internagents-home ocs-select-content w-[340px]"
          >
            <SelectGroup>
              <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t("localProjects")}
              </SelectLabel>
              {workspaces.map((workspace) => (
                <SelectItem
                  key={workspace.id}
                  value={`workspace:${workspace.id}`}
                  textValue={workspace.label}
                  className="py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{workspace.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {workspace.resolvedPath || workspace.path}
                    </span>
                  </span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem
                value={OPEN_WORKSPACE_VALUE}
                textValue={t("openOrCreateLocalProject")}
                className="py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {isPickingWorkspace ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4 shrink-0" />
                  )}
                  <span>{t("openOrCreateLocalProject")}</span>
                </span>
              </SelectItem>
            </SelectGroup>

            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t("remoteProjects")}
              </SelectLabel>
              {remoteResources.map((resource) => (
                <SelectItem
                  key={resource.id}
                  value={`resource:${resource.id}`}
                  textValue={displayResourceLabel(resource.label, language)}
                  className="py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {displayResourceLabel(resource.label, language)}
                    </span>
                    {resource.workspacePath && (
                      <span className="truncate text-xs text-muted-foreground">
                        {resource.workspacePath}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem
                value={ADD_REMOTE_WORKSPACE_VALUE}
                textValue={t("connectRemoteProject")}
                className="py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>{t("connectRemoteProject")}</span>
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </section>

      <nav
        className="ocs-primary-actions"
        aria-label="project actions"
      >
        <button
          type="button"
          onClick={() => void onNewThread()}
        >
          <SquarePen size={18} />
          <span>{t("newThread")}</span>
        </button>
        <Link
          href={skillsHref}
        >
          <SlidersHorizontal size={18} />
          <span>{t("customize")}</span>
        </Link>
        <Link
          href={configHref}
        >
          <Settings size={18} />
          <span>{t("settings")}</span>
        </Link>
        {isActiveSshResource && (
          <button
            type="button"
            disabled={pushingBackendCli}
            onClick={onPushBackendCli}
          >
            {pushingBackendCli ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud size={18} />
            )}
            <span>{t("syncRemote")}</span>
          </button>
        )}
      </nav>

      <div className="ocs-sidebar-body">
        <div className="ocs-panel-fill">
          <ThreadList
            onThreadSelect={onThreadSelect}
            onNewThread={onNewThread}
            onMutateReady={onMutateReady}
            resourceId={activeResource.id}
            runtimeUrl={activeResource.runtimeUrl}
            assistantId={activeAssistantId}
            workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
          />
        </div>
      </div>

      <footer className="ocs-sidebar-footer">
        <Link
          href={configHref}
          aria-label={t("settings")}
        >
          <Settings size={18} />
        </Link>
        <span>
          <Radio size={14} />
          {runtimeLabel}
        </span>
      </footer>
    </aside>
  );
}

type WorkbenchInspectorMode = "files" | "preview";
type InspectorFilesViewMode = "grid" | "list";

interface WorkbenchInspectorProps {
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
  selectedFilePath?: string | null;
  workspaceRefreshKey: number;
  workspaceId?: string;
  onClearSelectedFile: () => Promise<void>;
  onClose: () => void;
  onFileSelect: (entry: WorkspaceEntry) => void | Promise<void>;
  onFilePathSelect: (path: string) => void | Promise<void>;
}

interface InspectorFilesViewProps {
  selectedFilePath?: string | null;
  resourceId: string;
  workspaceId?: string;
  refreshKey: number;
  onFileSelect: (entry: WorkspaceEntry) => void | Promise<void>;
}

function formatInspectorBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InspectorEntryIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.kind === "directory") {
    return <Folder className="h-4 w-4" />;
  }

  if (entry.previewKind === "markdown") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "pdf") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "docx") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "xlsx") {
    return <FileSpreadsheet className="h-4 w-4" />;
  }

  if (entry.previewKind === "pptx") {
    return <Presentation className="h-4 w-4" />;
  }

  if (entry.extension === ".json") {
    return <FileJson className="h-4 w-4" />;
  }

  if (
    [".js", ".jsx", ".py", ".ts", ".tsx", ".sh"].includes(
      entry.extension || ""
    )
  ) {
    return <FileCode2 className="h-4 w-4" />;
  }

  return <File className="h-4 w-4" />;
}

function matchesInspectorFilter(entry: WorkspaceEntry, filter: string): boolean {
  if (!filter) return true;
  return entry.path.toLowerCase().includes(filter);
}

function isWorkspacePathMissingError(error: string | null): boolean {
  return Boolean(
    error && /ENOENT|no such file|cannot find|not found|realpath/i.test(error)
  );
}

function InspectorFilesView({
  selectedFilePath,
  resourceId,
  workspaceId,
  refreshKey,
  onFileSelect,
}: InspectorFilesViewProps) {
  const { t } = useLanguage();
  const {
    directories,
    expandedPaths,
    loadingPaths,
    error,
    loadDirectory,
    toggleDirectory,
    refresh,
  } = useWorkspaceFiles(resourceId, workspaceId, refreshKey);
  const [filter, setFilter] = useState("");
  const [viewMode, setViewMode] = useState<InspectorFilesViewMode>("list");
  const [currentDirectoryPath, setCurrentDirectoryPath] = useState("");

  const normalizedFilter = filter.trim().toLowerCase();
  const rootEntries = useMemo(() => directories[""] ?? [], [directories]);
  const rootLoading = loadingPaths.has("") && rootEntries.length === 0;
  const currentDirectoryEntries = useMemo(
    () => directories[currentDirectoryPath] ?? [],
    [currentDirectoryPath, directories]
  );
  const currentDirectoryLoading =
    loadingPaths.has(currentDirectoryPath) && currentDirectoryEntries.length === 0;
  const currentDirectorySegments = useMemo(() => {
    const parts = currentDirectoryPath.split("/").filter(Boolean);
    return parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    }));
  }, [currentDirectoryPath]);

  const visibleEntries = useMemo(() => {
    const hasMatchingDescendant = (entry: WorkspaceEntry): boolean => {
      const children = directories[entry.path] ?? [];
      return children.some(
        (child) =>
          matchesInspectorFilter(child, normalizedFilter) ||
          hasMatchingDescendant(child)
      );
    };

    const walk = (
      entries: WorkspaceEntry[],
      depth: number
    ): Array<{ entry: WorkspaceEntry; depth: number }> => {
      return entries.flatMap((entry) => {
        const matches = matchesInspectorFilter(entry, normalizedFilter);
        const childrenMatch =
          entry.kind === "directory" && hasMatchingDescendant(entry);
        if (!matches && !childrenMatch) {
          return [];
        }

        const isExpanded =
          entry.kind === "directory" &&
          (expandedPaths.has(entry.path) || Boolean(normalizedFilter));
        const children = isExpanded
          ? walk(directories[entry.path] ?? [], depth + 1)
          : [];

        return [{ entry, depth }, ...children];
      });
    };

    return walk(rootEntries, 0);
  }, [directories, expandedPaths, normalizedFilter, rootEntries]);

  const gridEntries = useMemo(() => {
    if (normalizedFilter) {
      return visibleEntries;
    }

    return currentDirectoryEntries.map((entry) => ({ entry, depth: 0 }));
  }, [currentDirectoryEntries, normalizedFilter, visibleEntries]);

  const entriesForView = viewMode === "grid" ? gridEntries : visibleEntries;
  const isLoadingFiles =
    viewMode === "grid" && !normalizedFilter
      ? currentDirectoryLoading
      : rootLoading;
  const emptyMessage = normalizedFilter ? t("noMatchingFiles") : t("emptyFolder");

  useEffect(() => {
    setCurrentDirectoryPath("");
  }, [refreshKey, resourceId, workspaceId]);

  const navigateToDirectory = useCallback(
    async (path: string) => {
      await loadDirectory(path);
      setCurrentDirectoryPath(path);
    },
    [loadDirectory]
  );

  const navigateToParentDirectory = useCallback(async () => {
    if (!currentDirectoryPath) {
      return;
    }

    const parentPath = currentDirectoryPath.split("/").slice(0, -1).join("/");
    await navigateToDirectory(parentPath);
  }, [currentDirectoryPath, navigateToDirectory]);

  const handleRefreshFiles = useCallback(() => {
    setCurrentDirectoryPath("");
    void refresh();
  }, [refresh]);

  const handleEntryClick = useCallback(
    async (entry: WorkspaceEntry) => {
      if (entry.kind === "directory") {
        if (viewMode === "grid") {
          await navigateToDirectory(entry.path);
          return;
        }

        await toggleDirectory(entry.path);
        return;
      }

      await onFileSelect(entry);
    },
    [navigateToDirectory, onFileSelect, toggleDirectory, viewMode]
  );

  return (
    <section className="ocs-inspector-files">
      <div className="ocs-inspector-files-toolbar">
        <div className="ocs-inspector-search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("filterFiles")}
          />
        </div>
        <div className="ocs-inspector-view-toggle">
          <button
            type="button"
            className={cn(viewMode === "grid" && "active")}
            onClick={() => setViewMode("grid")}
            title={t("gridView")}
            aria-label={t("gridView")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={cn(viewMode === "list" && "active")}
            onClick={() => setViewMode("list")}
            title={t("listView")}
            aria-label={t("listView")}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={handleRefreshFiles}
            title={t("refreshProjectFiles")}
            aria-label={t("refreshProjectFiles")}
          >
            <RefreshCcw size={15} />
          </button>
        </div>
      </div>

      {viewMode === "grid" && !normalizedFilter && (
        <div
          className="ocs-inspector-file-breadcrumb"
          aria-label={t("currentFolder")}
        >
          <button
            type="button"
            className={cn(!currentDirectoryPath && "active")}
            onClick={() => void navigateToDirectory("")}
          >
            {t("rootFolder")}
          </button>
          {currentDirectorySegments.map((segment) => (
            <React.Fragment key={segment.path}>
              <ChevronRight className="ocs-inspector-file-breadcrumb-separator h-3.5 w-3.5" />
              <button
                type="button"
                className={cn(segment.path === currentDirectoryPath && "active")}
                onClick={() => void navigateToDirectory(segment.path)}
              >
                {segment.label}
              </button>
            </React.Fragment>
          ))}
          {currentDirectoryPath && (
            <button
              type="button"
              className="ocs-inspector-file-up"
              onClick={() => void navigateToParentDirectory()}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("parentFolder")}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="ocs-inspector-file-error">
          {isWorkspacePathMissingError(error) ? (
            <div className="space-y-2">
              <p>{t("workspacePathMissing")}</p>
              <p className="text-sm text-muted-foreground">
                {t("workspacePathMissingAction")}
              </p>
              <Button
                asChild
                variant="outline"
                size="sm"
              >
                <Link href="/projects">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t("backToProjects")}
                </Link>
              </Button>
            </div>
          ) : (
            error
          )}
        </div>
      )}

      {isLoadingFiles ? (
        <div className="ocs-inspector-empty">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      ) : entriesForView.length === 0 ? (
        <div className="ocs-inspector-empty">{emptyMessage}</div>
      ) : viewMode === "grid" ? (
        <div className="ocs-inspector-file-grid">
          {gridEntries.map(({ entry }) => {
            const isDirectory = entry.kind === "directory";
            const isSelected = selectedFilePath === entry.path;

            return (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  "ocs-inspector-file-card",
                  isSelected && "active"
                )}
                onClick={() => void handleEntryClick(entry)}
                title={entry.path}
              >
                <span className="ocs-inspector-file-icon">
                  {isDirectory ? (
                    <Folder className="h-4 w-4" />
                  ) : (
                    <InspectorEntryIcon entry={entry} />
                  )}
                </span>
                <span className="ocs-inspector-file-name">{entry.name}</span>
                <span className="ocs-inspector-file-meta">
                  {isDirectory
                    ? t("folder")
                    : formatInspectorBytes(entry.size) ||
                      entry.previewKind ||
                      t("files")}
                </span>
                {normalizedFilter && entry.path.includes("/") && (
                  <span className="ocs-inspector-file-path">{entry.path}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="ocs-inspector-file-list">
          {visibleEntries.map(({ entry, depth }) => {
            const isDirectory = entry.kind === "directory";
            const isExpanded = expandedPaths.has(entry.path);
            const isLoading = loadingPaths.has(entry.path);
            const isSelected = selectedFilePath === entry.path;

            return (
              <button
                key={entry.path}
                type="button"
                className={cn("ocs-inspector-file-row", isSelected && "active")}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
                onClick={() => void handleEntryClick(entry)}
                title={entry.path}
              >
                <span className="ocs-inspector-file-expander">
                  {isDirectory &&
                    (isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ChevronRight
                        className={cn(
                          "h-4 w-4",
                          isExpanded && "rotate-90"
                        )}
                      />
                    ))}
                </span>
                <span className="ocs-inspector-file-icon">
                  <InspectorEntryIcon entry={entry} />
                </span>
                <span className="ocs-inspector-file-name">{entry.name}</span>
                <span className="ocs-inspector-file-meta">
                  {isDirectory ? t("folder") : formatInspectorBytes(entry.size)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorkbenchInspector({
  activeResource,
  activeWorkspace,
  selectedFilePath,
  workspaceRefreshKey,
  workspaceId,
  onClearSelectedFile,
  onClose,
  onFileSelect,
  onFilePathSelect,
}: WorkbenchInspectorProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<WorkbenchInspectorMode>(
    selectedFilePath ? "preview" : "files"
  );
  const [openFileTabPaths, setOpenFileTabPaths] = useState<string[]>(() =>
    selectedFilePath ? [selectedFilePath] : []
  );
  const previousSelectedFilePathRef = useRef<string | null>(
    selectedFilePath ?? null
  );
  const inspectorScope = `${activeResource.id}:${
    activeWorkspace?.id || workspaceId || "workspace"
  }`;
  const previousInspectorScopeRef = useRef(inspectorScope);

  useEffect(() => {
    const previousSelectedFilePath = previousSelectedFilePathRef.current;
    const nextSelectedFilePath = selectedFilePath ?? null;
    if (previousSelectedFilePath === nextSelectedFilePath) {
      return;
    }

    previousSelectedFilePathRef.current = nextSelectedFilePath;
    if (selectedFilePath) {
      setOpenFileTabPaths((paths) =>
        paths.includes(selectedFilePath) ? paths : [...paths, selectedFilePath]
      );
      setMode("preview");
    } else {
      setMode((currentMode) =>
        currentMode === "preview" ? "files" : currentMode
      );
    }
  }, [selectedFilePath]);

  useEffect(() => {
    if (previousInspectorScopeRef.current === inspectorScope) return;
    previousInspectorScopeRef.current = inspectorScope;
    setOpenFileTabPaths(selectedFilePath ? [selectedFilePath] : []);
    setMode(selectedFilePath ? "preview" : "files");
  }, [inspectorScope, selectedFilePath]);

  const handleFileTabSelect = useCallback(
    async (path: string) => {
      setMode("preview");
      await onFilePathSelect(path);
    },
    [onFilePathSelect]
  );

  const handleFileTabClose = useCallback(
    async (path: string) => {
      const tabIndex = openFileTabPaths.indexOf(path);
      const remainingPaths = openFileTabPaths.filter(
        (tabPath) => tabPath !== path
      );
      setOpenFileTabPaths(remainingPaths);

      if (mode !== "preview" || selectedFilePath !== path) {
        if (selectedFilePath === path) {
          await onClearSelectedFile();
        }
        return;
      }

      const fallbackPath =
        remainingPaths[tabIndex] ?? remainingPaths[tabIndex - 1] ?? null;
      if (fallbackPath) {
        setMode("preview");
        await onFilePathSelect(fallbackPath);
        return;
      }

      setMode("files");
      await onClearSelectedFile();
    },
    [
      onClearSelectedFile,
      onFilePathSelect,
      mode,
      openFileTabPaths,
      selectedFilePath,
    ]
  );

  const handleResolvedFilePath = useCallback(
    (resolvedPath: string) => {
      if (!selectedFilePath || resolvedPath === selectedFilePath) {
        return;
      }

      setOpenFileTabPaths((paths) => {
        const nextPaths = paths.map((path) =>
          path === selectedFilePath ? resolvedPath : path
        );
        return nextPaths.filter(
          (path, index) => nextPaths.indexOf(path) === index
        );
      });
      void onFilePathSelect(resolvedPath);
    },
    [onFilePathSelect, selectedFilePath]
  );

  return (
    <aside className="ocs-inspector">
      <header
        className="ocs-inspector-tabbar"
        role="tablist"
        aria-label={t("files")}
      >
        <button
          type="button"
          className={cn("ocs-inspector-root-tab", mode === "files" && "active")}
          onClick={() => setMode("files")}
        >
          <Files size={15} />
          <span>{t("files")}</span>
        </button>

        <div className="ocs-open-file-tabs">
          {openFileTabPaths.map((path) => {
            const isActive = mode === "preview" && selectedFilePath === path;
            const tabName = displayPathName(path, t("filePreview"));

            return (
              <div
                key={path}
                className={cn("ocs-open-file-tab", isActive && "active")}
              >
                <button
                  type="button"
                  className="ocs-open-file-tab-main"
                  title={path}
                  aria-selected={isActive}
                  onClick={() => void handleFileTabSelect(path)}
                >
                  <FileText size={14} />
                  <span>{tabName}</span>
                </button>
                <button
                  type="button"
                  className="ocs-open-file-tab-close"
                  title={`${t("close")} ${tabName}`}
                  aria-label={`${t("close")} ${tabName}`}
                  onClick={() => void handleFileTabClose(path)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="ocs-inspector-close"
          onClick={onClose}
          title={t("closeInspector")}
          aria-label={t("closeInspector")}
        >
          <Columns2 className="h-4 w-4" />
        </button>
      </header>

      <div
        className={cn(
          "ocs-inspector-content",
          mode !== "files" && "hidden"
        )}
      >
        <InspectorFilesView
          selectedFilePath={selectedFilePath}
          resourceId={activeResource.id}
          workspaceId={workspaceId}
          refreshKey={workspaceRefreshKey}
          onFileSelect={onFileSelect}
        />
      </div>

      <div
        className={cn(
          "ocs-inspector-content ocs-inspector-preview",
          mode !== "preview" && "hidden"
        )}
      >
        <WorkspaceViewer
          key={activeWorkspace?.id || activeResource.id}
          selectedPath={selectedFilePath}
          resourceId={activeResource.id}
          workspaceId={workspaceId}
          onClear={() => void onClearSelectedFile()}
          onResolvedPath={handleResolvedFilePath}
        />
      </div>

    </aside>
  );
}

function displayPathName(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function HomePageContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([]);
  const [localBackendReady, setLocalBackendReady] = useState(false);
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [resourceId, setResourceId] = useQueryState("resourceId");
  const [workspaceId, setWorkspaceId] = useQueryState("workspaceId");
  const [threadId, setThreadId] = useQueryState("threadId");
  const previousResourceId = useRef<string | null>(null);

  const refreshResources = useCallback(
    async (knownResources?: ResourceConfig[]) => {
      let nextResources = knownResources;
      let defaultResourceId: string | undefined;
      if (!nextResources) {
        const payload = await listResources(t("projectListReadFailed"));
        nextResources = payload.resources || [];
        defaultResourceId = payload.defaultResourceId;
      }
      setConfig((current) => {
        if (!current || !isLocalDeploymentUrl(current.deploymentUrl)) {
          return current;
        }
        return {
          ...current,
          resources: nextResources?.length ? nextResources : current.resources,
          defaultResourceId: defaultResourceId || current.defaultResourceId,
        };
      });
      return nextResources || [];
    },
    [t]
  );

  const loadWorkspaces = useCallback(async () => {
    const payload = await listWorkspaces(t("projectReadFailed"));
    const nextWorkspaces = payload.workspaces || [];
    setWorkspaces(nextWorkspaces);
    return nextWorkspaces;
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (cancelled) {
        return;
      }

      const initialConfig = getConfig();
      setConfig(initialConfig);
      if (await shouldOpenOnboardingRequest()) {
        if (!cancelled) {
          window.location.href = "/config?onboarding=1";
        }
        return;
      }
      const initialResource = getResource(initialConfig, resourceId);
      const shouldOpenProjectList =
        isLocalDeploymentUrl(initialConfig.deploymentUrl) &&
        (!initialResource || initialResource.id === "local") &&
        !workspaceId;
      if (shouldOpenProjectList) {
        if (!cancelled) {
          router.replace("/projects");
        }
        return;
      }
      if (!resourceId && initialResource) {
        setResourceId(initialResource.id);
      }
      if (!assistantId) {
        setAssistantId(
          initialResource?.assistantId || initialConfig.assistantId
        );
      }
      void loadWorkspaces().catch((error) => {
        const message =
          error instanceof Error ? error.message : t("projectReadFailed");
        toast.error(message);
      });
      if (isLocalDeploymentUrl(initialConfig.deploymentUrl)) {
        void refreshResources().catch((error) => {
          const message =
            error instanceof Error ? error.message : t("projectListReadFailed");
          toast.error(message);
        });
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!config) {
      setLocalBackendReady(false);
      return;
    }

    const selectedResource = getResource(config, resourceId);
    const targetDeploymentUrl =
      selectedResource?.runtimeUrl || config.deploymentUrl;

    if (!isLocalDeploymentUrl(targetDeploymentUrl)) {
      setLocalBackendReady(true);
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    let hadCachedReady = readBackendReadyCache(targetDeploymentUrl);

    setLocalBackendReady(hadCachedReady);

    const poll = async () => {
      if (await isLocalBackendReady(targetDeploymentUrl)) {
        writeBackendReadyCache(targetDeploymentUrl);
        if (!cancelled) {
          setLocalBackendReady(true);
        }
        return;
      }

      if (!cancelled) {
        if (hadCachedReady) {
          hadCachedReady = false;
          setLocalBackendReady(false);
        }
        timeoutId = window.setTimeout(poll, 800);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [config, resourceId]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    if (selectedResource && assistantId !== selectedResource.assistantId) {
      setAssistantId(selectedResource.assistantId);
    }
  }, [config, resourceId, assistantId, setAssistantId]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    const selectedResourceId = selectedResource?.id || null;
    if (
      previousResourceId.current &&
      selectedResourceId &&
      previousResourceId.current !== selectedResourceId &&
      threadId
    ) {
      setThreadId(null);
    }
    previousResourceId.current = selectedResourceId;
  }, [config, resourceId, threadId, setThreadId]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    if (selectedResource?.id !== "local") {
      if (workspaceId) {
        setWorkspaceId(null);
      }
      return;
    }
    if (!workspaceId) {
      router.replace("/projects");
      return;
    }
    if (workspaces.length > 0) {
      const workspaceExists = workspaces.some(
        (workspace) => workspace.id === workspaceId
      );
      if (!workspaceExists) {
        router.replace("/projects");
      }
    }
  }, [config, resourceId, router, setWorkspaceId, workspaceId, workspaces]);

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  if (!config) {
    return <StartupState />;
  }

  const activeResource = getResource(config, resourceId);
  const activeAssistantId = activeResource?.assistantId || config.assistantId;
  const isActiveLocalResource = activeResource?.id === "local";
  const localWorkspaceMissing = isActiveLocalResource && !workspaceId;
  const localWorkspaceNotFound =
    isActiveLocalResource &&
    !!workspaceId &&
    workspaces.length > 0 &&
    !workspaces.some((workspace) => workspace.id === workspaceId);

  if (localWorkspaceMissing || localWorkspaceNotFound) {
    return <StartupState />;
  }

  const activeDeploymentUrl = activeResource.runtimeUrl || config.deploymentUrl;

  if (isLocalDeploymentUrl(activeDeploymentUrl) && !localBackendReady) {
    return <StartupState />;
  }

  const activeWorkspace = isActiveLocalResource
    ? workspaces.find((workspace) => workspace.id === workspaceId) || null
    : {
        id: `resource:${activeResource.id}`,
        label: activeResource.label,
        path: activeResource.workspacePath || t("remoteProject"),
        resolvedPath: activeResource.workspacePath || t("remoteProject"),
        resourceId: activeResource.id,
        isRemote: true,
      };

  return (
    <RemoteAgentProvider
      key={`${activeDeploymentUrl}:${activeAssistantId}`}
      deploymentUrl={activeDeploymentUrl}
      assistantId={activeAssistantId}
      apiKey={langsmithApiKey}
    >
      <HomePageInner
        config={config}
        activeResource={activeResource}
        activeAssistantId={activeAssistantId}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        isActiveLocalResource={isActiveLocalResource}
        onResourceChange={async (nextResourceId) => {
          await setResourceId(nextResourceId);
          const nextResource = getResource(config, nextResourceId);
          if (nextResource?.id !== "local") {
            await setWorkspaceId(null);
          }
        }}
        onResourcesRefresh={refreshResources}
        onWorkspaceChange={async (nextWorkspaceId) => {
          const workspace = workspaces.find(
            (candidate) => candidate.id === nextWorkspaceId
          );
          if (!workspace) {
            return;
          }
          const payload = await setDefaultWorkspace(
            workspace.resolvedPath || workspace.path,
            t("projectSwitchFailed")
          );
          if (payload.workspaces) {
            setWorkspaces(payload.workspaces);
          }
          await setResourceId("local");
          await setWorkspaceId(payload.defaultWorkspaceId || nextWorkspaceId);
        }}
        onWorkspacePick={async () => {
          const payload = await pickWorkspaceRequest(t("projectPickFailed"));
          if (payload.cancelled) {
            return;
          }
          if (payload.workspaces) {
            setWorkspaces(payload.workspaces);
          }
          const nextWorkspaceId =
            payload.workspaceId || payload.defaultWorkspaceId;
          if (nextWorkspaceId) {
            await setResourceId("local");
            await setWorkspaceId(nextWorkspaceId);
          }
        }}
      />
    </RemoteAgentProvider>
  );
}

function StartupFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
      <p className="text-muted-foreground">{t("appStarting")}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<StartupFallback />}>
      <HomePageContent />
    </Suspense>
  );
}
