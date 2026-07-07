"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocalWorkspace } from "@/app/types/workspace";
import {
  pageHrefWithAppReturn,
  projectsHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  listWorkspaces,
  pickWorkspace as pickWorkspaceRequest,
  removeWorkspace as removeWorkspaceRequest,
  updateWorkspace as updateWorkspaceRequest,
} from "@/app/services/workspacesClient";
import { shouldOpenOnboarding } from "@/app/services/configClient";
import { getConfig } from "@/lib/config";

type WorkspaceUpdateAction = "save" | "refresh" | "choose";

function compactPath(value: string) {
  if (!value) return "-";
  const homePrefix = "/Users/";
  if (value.startsWith(homePrefix)) {
    const parts = value.split("/").filter(Boolean);
    if (parts.length > 2) {
      return `~/${parts.slice(2).join("/")}`;
    }
  }
  return value;
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const config = useMemo(() => getConfig(), []);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingInitialConfig, setCheckingInitialConfig] = useState(true);
  const [picking, setPicking] = useState(false);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState("");
  const [editingWorkspace, setEditingWorkspace] =
    useState<LocalWorkspace | null>(null);
  const [editName, setEditName] = useState("");
  const [updatingWorkspaceAction, setUpdatingWorkspaceAction] =
    useState<WorkspaceUpdateAction | null>(null);

  const localResource = config.resources.find(
    (resource) => resource.id === "local"
  );
  const assistantId =
    localResource?.assistantId || config.assistantId || "agent_local";
  const projectsHref = useMemo(
    () => projectsHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const configHref = useMemo(
    () => pageHrefWithAppReturn("/config", projectsHref),
    [projectsHref]
  );
  const initialConfigHref = useMemo(() => {
    const href = pageHrefWithAppReturn("/config", projectsHref);
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}onboarding=1`;
  }, [projectsHref]);
  const workbenchHref = useCallback(
    (workspaceId: string) => {
      const params = new URLSearchParams({
        assistantId,
        resourceId: "local",
        workspaceId,
      });
      return `/?${params.toString()}`;
    },
    [assistantId]
  );

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await listWorkspaces(t("projectListReadFailed"));
      setWorkspaces(payload.workspaces || []);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectListReadFailed");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const pickWorkspace = useCallback(async () => {
    setPicking(true);
    try {
      const payload = await pickWorkspaceRequest(t("projectPickFailed"));
      if (payload.cancelled) {
        return;
      }
      const nextWorkspaceId = payload.workspaceId || payload.defaultWorkspaceId;
      if (payload.workspaces) {
        setWorkspaces(payload.workspaces);
      }
      if (nextWorkspaceId) {
        router.push(workbenchHref(nextWorkspaceId));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectPickFailed");
      toast.error(message);
    } finally {
      setPicking(false);
    }
  }, [router, t, workbenchHref]);

  const removeWorkspace = useCallback(
    async (workspace: LocalWorkspace) => {
      const confirmed = window.confirm(
        t("removeProjectConfirm", { name: workspace.label })
      );
      if (!confirmed) {
        return;
      }

      setRemovingWorkspaceId(workspace.id);
      try {
        const payload = await removeWorkspaceRequest(
          workspace.id,
          t("removeProjectFailed")
        );
        setWorkspaces(payload.workspaces || []);
        toast.success(t("removeProjectSuccess"));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("removeProjectFailed");
        toast.error(message);
      } finally {
        setRemovingWorkspaceId("");
      }
    },
    [t]
  );

  const openWorkspaceEditor = useCallback((workspace: LocalWorkspace) => {
    setEditingWorkspace(workspace);
    setEditName(workspace.label);
  }, []);

  const updateWorkspace = useCallback(
    async (
      workspace: LocalWorkspace,
      body: Record<string, string | boolean | undefined>,
      action: WorkspaceUpdateAction
    ) => {
      setUpdatingWorkspaceAction(action);
      try {
        const payload = await updateWorkspaceRequest(
          {
            workspaceId: workspace.id,
            ...body,
          },
          t("projectUpdateFailed")
        );
        if (payload.cancelled) {
          return;
        }

        const nextWorkspaces = payload.workspaces || [];
        setWorkspaces(nextWorkspaces);
        setEditingWorkspace(null);
        setEditName("");
        toast.success(t("projectUpdated"));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("projectUpdateFailed");
        toast.error(message);
      } finally {
        setUpdatingWorkspaceAction(null);
      }
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (await shouldOpenOnboarding()) {
        if (!cancelled) {
          router.replace(initialConfigHref);
        }
        return;
      }
      if (!cancelled) {
        setCheckingInitialConfig(false);
        void loadWorkspaces();
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [initialConfigHref, loadWorkspaces, router]);

  if (checkingInitialConfig) {
    return (
      <main className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-semibold leading-none">
              InternAgentS
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("localResearchWorkbench")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
            >
              <Link href={configHref}>
                <Settings className="h-4 w-4" />
                {t("settings")}
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void pickWorkspace()}
              disabled={picking}
            >
              {picking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("newProject")}
            </Button>
          </div>
        </header>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("projects")}</h2>
          </div>

          {loading ? (
            <div className="flex h-36 items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loadingProjects")}
            </div>
          ) : workspaces.length > 0 ? (
            <div className="space-y-2">
              {workspaces.map((workspace) => (
                <article
                  key={workspace.id}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-4 shadow-sm transition hover:border-primary/35 hover:bg-accent/45"
                >
                  <Link
                    href={workbenchHref(workspace.id)}
                    className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold">
                          {workspace.label}
                        </h3>
                        {workspace.isRemote && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {t("remote")}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm text-muted-foreground">
                        {compactPath(workspace.resolvedPath || workspace.path)}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <span>
                        {workspace.isRemote ? t("remote") : t("local")}
                      </span>
                      <span>{t("ready")}</span>
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      title={t("editProject")}
                      aria-label={t("editProject")}
                      onClick={() => openWorkspaceEditor(workspace)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title={t("removeProject")}
                      aria-label={t("removeProject")}
                      onClick={() => void removeWorkspace(workspace)}
                      disabled={removingWorkspaceId === workspace.id}
                    >
                      {removingWorkspaceId === workspace.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card px-5 py-8 text-center">
              <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold">
                {t("noProjects")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("noProjectsDescription")}
              </p>
              <Button
                type="button"
                className="mt-4"
                onClick={() => void pickWorkspace()}
                disabled={picking}
              >
                {picking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t("newProject")}
              </Button>
            </div>
          )}
        </section>
      </section>
      <Dialog
        open={Boolean(editingWorkspace)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingWorkspace(null);
            setEditName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editProject")}</DialogTitle>
            <DialogDescription>
              {t("editProjectDescription")}
            </DialogDescription>
          </DialogHeader>
          {editingWorkspace && (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void updateWorkspace(
                  editingWorkspace,
                  { label: editName },
                  "save"
                );
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="project-name">{t("projectName")}</Label>
                <Input
                  id="project-name"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  disabled={Boolean(updatingWorkspaceAction)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("projectPath")}</Label>
                <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
                  {compactPath(
                    editingWorkspace.resolvedPath || editingWorkspace.path
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void updateWorkspace(
                      editingWorkspace,
                      { refreshLabel: true },
                      "refresh"
                    )
                  }
                  disabled={Boolean(updatingWorkspaceAction)}
                >
                  {updatingWorkspaceAction === "refresh" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t("refreshProjectName")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void updateWorkspace(
                      editingWorkspace,
                      { chooseFolder: true, refreshLabel: true },
                      "choose"
                    )
                  }
                  disabled={Boolean(updatingWorkspaceAction)}
                >
                  {updatingWorkspaceAction === "choose" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                  {t("reselectProjectFolder")}
                </Button>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingWorkspace(null);
                    setEditName("");
                  }}
                  disabled={Boolean(updatingWorkspaceAction)}
                >
                  {t("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={Boolean(updatingWorkspaceAction)}
                >
                  {updatingWorkspaceAction === "save" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {t("saveProject")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsPageFallback />}>
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
