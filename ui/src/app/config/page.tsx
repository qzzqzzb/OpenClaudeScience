"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Archive,
  Cpu,
  KeyRound,
  Loader2,
  Moon,
  Plug,
  Save,
  Server,
  ServerCog,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CopyKey, UiLanguage } from "@/lib/i18n";
import {
  applyTheme,
  getStoredTheme,
  type ThemeMode,
} from "@/lib/theme";
import { LanguageToggle } from "@/app/components/LanguageToggle";
import { useLanguage } from "@/app/hooks/useLanguage";
import { ArchivedThreadsCard } from "@/app/config/components/ArchivedThreadsCard";
import { ComputeSettingsCard } from "@/app/config/components/ComputeSettingsCard";
import { RemoteProjectsSettingsCard } from "@/app/config/components/RemoteProjectsSettingsCard";
import { SkillsMarketplace } from "@/app/skills/components/SkillsMarketplace";
import {
  appReturnHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import {
  loadConfig as loadConfigRequest,
  saveConfig as saveConfigRequest,
  type AuthorizationMode,
  type ConfigResponse,
} from "@/app/services/configClient";
import {
  getBackendStatus as getBackendStatusRequest,
  isWorkbenchHomeReady,
  restartBackend as restartBackendRequest,
  type BackendRestartResult,
  type BackendStatusResult,
} from "@/app/services/runtimeClient";

const DEFAULT_CONFIG: ConfigResponse = {
  configPath: "",
  envPath: "",
  modelProvider: "openai_compatible",
  model: "deepseek-v4-flash",
  modelSelectionMode: "manual",
  autoModel: "",
  effectiveModel: "deepseek-v4-flash",
  openaiCompatibleModel: "deepseek-v4-flash",
  openaiCompatibleBaseUrl: "https://openrouter.ai/api/v1",
  openaiCompatibleApiKey: "",
  openaiCompatibleApiKeySet: false,
  openaiCompatibleApiKeyPreview: "",
  authorizationMode: "auto",
  language: "zh",
  desktopMode: false,
  needsOnboarding: false,
  onboardingSkipped: false,
  missing: [],
};

const AUTHORIZATION_OPTIONS: Array<{
  id: AuthorizationMode;
  title: CopyKey;
  badge?: CopyKey;
  description: CopyKey;
  detail: CopyKey;
}> = [
  {
    id: "auto",
    title: "authAutoTitle",
    badge: "recommended",
    description: "authAutoDescription",
    detail: "authAutoDetail",
  },
  {
    id: "write",
    title: "authWriteTitle",
    description: "authWriteDescription",
    detail: "authWriteDetail",
  },
  {
    id: "all",
    title: "authAllTitle",
    description: "authAllDescription",
    detail: "authAllDetail",
  },
];

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  title: CopyKey;
  description: CopyKey;
}> = [
  {
    id: "light",
    title: "light",
    description: "lightDescription",
  },
  {
    id: "dark",
    title: "dark",
    description: "darkDescription",
  },
];

const SETTINGS_SECTIONS: Array<{
  id: string;
  title: CopyKey;
  description: CopyKey;
  icon: LucideIcon;
}> = [
  {
    id: "settings-model",
    title: "model",
    description: "modelDescription",
    icon: Cpu,
  },
  {
    id: "settings-skills",
    title: "skills",
    description: "skillsDescription",
    icon: Sparkles,
  },
  {
    id: "settings-connectors",
    title: "connectors",
    description: "connectorsDescription",
    icon: Plug,
  },
  {
    id: "settings-remote-projects",
    title: "remoteProjects",
    description: "remoteProjectsDescription",
    icon: Server,
  },
  {
    id: "settings-compute",
    title: "compute",
    description: "computeDescription",
    icon: ServerCog,
  },
  {
    id: "settings-authorization",
    title: "authorization",
    description: "authorizationDescription",
    icon: ShieldCheck,
  },
  {
    id: "settings-appearance",
    title: "appearance",
    description: "appearanceDescription",
    icon: Sun,
  },
  {
    id: "settings-archives",
    title: "archivedThreads",
    description: "archivedThreadsDescription",
    icon: Archive,
  },
];

async function waitForWorkbenchReady(url: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const [homeResponse, configPayload] = await Promise.all([
        isWorkbenchHomeReady(url),
        loadConfigRequest<{ needsOnboarding?: boolean }>({ baseUrl: url }),
      ]);

      if (
        homeResponse &&
        configPayload.needsOnboarding !== true
      ) {
        return true;
      }
    } catch {
      // Retry while the local desktop server is settling.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

function ConfigPageContent() {
  const searchParams = useSearchParams();
  const { language, setLanguage, t } = useLanguage();
  const [config, setConfig] = useState<ConfigResponse>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] =
    useState<ConfigResponse>(DEFAULT_CONFIG);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [onboardingRequested, setOnboardingRequested] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [restartResult, setRestartResult] =
    useState<BackendRestartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionBusy = loading || saving || restarting;
  const isBusy = actionBusy || checkingStatus;
  const hasChanges = useMemo(() => {
    return (
      config.openaiCompatibleApiKey.trim() !== "" ||
      config.openaiCompatibleBaseUrl !== savedConfig.openaiCompatibleBaseUrl ||
      config.openaiCompatibleModel !== savedConfig.openaiCompatibleModel ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode ||
      config.language !== savedConfig.language
    );
  }, [
    config.authorizationMode,
    config.model,
    config.modelSelectionMode,
    config.openaiCompatibleApiKey,
    config.openaiCompatibleBaseUrl,
    config.openaiCompatibleModel,
    config.language,
    savedConfig.authorizationMode,
    savedConfig.model,
    savedConfig.modelSelectionMode,
    savedConfig.openaiCompatibleBaseUrl,
    savedConfig.openaiCompatibleModel,
    savedConfig.language,
  ]);
  const restartSensitiveChanged = useMemo(() => {
    return (
      config.openaiCompatibleApiKey.trim() !== "" ||
      config.openaiCompatibleBaseUrl !== savedConfig.openaiCompatibleBaseUrl ||
      config.openaiCompatibleModel !== savedConfig.openaiCompatibleModel ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode
    );
  }, [
    config.authorizationMode,
    config.model,
    config.modelSelectionMode,
    config.openaiCompatibleApiKey,
    config.openaiCompatibleBaseUrl,
    config.openaiCompatibleModel,
    savedConfig.authorizationMode,
    savedConfig.model,
    savedConfig.modelSelectionMode,
    savedConfig.openaiCompatibleBaseUrl,
    savedConfig.openaiCompatibleModel,
  ]);
  const hasAnyChanges = hasChanges;
  const hasPendingRestart = requiresRestart;
  const canApplyWhenIdle = !isBusy;
  const canApplyNow = !isBusy;
  const onboardingMode = onboardingRequested;
  const canFinishOnboarding =
    !actionBusy &&
    Boolean(
      config.openaiCompatibleBaseUrl.trim() &&
        (config.openaiCompatibleApiKey.trim() ||
          config.openaiCompatibleApiKeySet)
    );
  const backendStatusMessage = backendStatus?.message.trim();
  const showBackendStatus = Boolean(backendStatusMessage) && !restartResult;
  const returnHref = useMemo(
    () => appReturnHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const returnLabel = returnHref.startsWith("/projects")
    ? t("backToProject")
    : t("backToWorkbench");

  function updateLanguage(nextLanguage: UiLanguage) {
    setLanguage(nextLanguage);
    setConfig((current) => ({
      ...current,
      language: nextLanguage,
    }));
  }

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const payload = await loadConfigRequest<ConfigResponse>({
        fallbackMessage: t("configReadFailed"),
      });
      const nextConfig = {
        ...DEFAULT_CONFIG,
        ...payload,
        openaiCompatibleApiKey: "",
        // Keep Settings in the current browser language. The backend config
        // language is only changed when the user explicitly saves Appearance.
        language,
      } as ConfigResponse;
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setRequiresRestart(false);
      setRestartResult(null);
      setBackendStatus(null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : t("configReadFailed");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(
    options: {
      onboardingSkipped?: boolean;
      scheduleIdle?: boolean;
      silent?: boolean;
    } = {}
  ): Promise<{ saved: boolean; needsRestart: boolean }> {
    const scheduleIdle = options.scheduleIdle ?? true;
    const needsRestart = options.onboardingSkipped
      ? false
      : restartSensitiveChanged;
    setSaving(true);
    setError(null);
    try {
      const payload = await saveConfigRequest<ConfigResponse>(
        {
          model: config.openaiCompatibleModel || "deepseek-v4-flash",
          modelProvider: "openai_compatible",
          modelSelectionMode: "manual",
          openaiCompatibleApiKey: options.onboardingSkipped
            ? undefined
            : config.openaiCompatibleApiKey.trim() || undefined,
          openaiCompatibleBaseUrl:
            config.openaiCompatibleBaseUrl.trim() || undefined,
          authorizationMode: config.authorizationMode,
          language: config.language,
          onboardingSkipped: options.onboardingSkipped === true,
        },
        t("configSaveFailed")
      );
      const nextConfig = {
        ...DEFAULT_CONFIG,
        ...payload,
        openaiCompatibleApiKey: "",
      } as ConfigResponse;
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setRequiresRestart(needsRestart);
      setBackendStatus(null);
      setRestartResult(null);
      setAutoRestart(scheduleIdle && needsRestart);
      if (!options.silent) {
        toast.success(
          options.onboardingSkipped
            ? t("configSkipped")
            : needsRestart
            ? scheduleIdle
              ? t("configSavedIdle")
              : t("configSaved")
            : t("configSaved")
        );
      }
      return { saved: true, needsRestart };
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : t("configSaveFailed");
      setError(message);
      toast.error(message);
      return { saved: false, needsRestart: false };
    } finally {
      setSaving(false);
    }
  }

  async function navigateAfterOnboarding({
    waitForReady,
  }: {
    waitForReady: boolean;
  }) {
    const nextHref = returnHref;
    if (waitForReady && nextHref.startsWith("/?")) {
      const homeUrl = new URL(nextHref, window.location.origin);
      await waitForWorkbenchReady(homeUrl.toString());
      window.location.replace(homeUrl.toString());
      return;
    }
    window.location.replace(nextHref);
  }

  async function checkBackendStatus(): Promise<BackendStatusResult> {
    setCheckingStatus(true);
    try {
      const status = await getBackendStatusRequest();
      setBackendStatus(status);
      return status;
    } finally {
      setCheckingStatus(false);
    }
  }

  async function restartBackendNow({
    manual,
    redirectHome = false,
  }: {
    manual: boolean;
    redirectHome?: boolean;
  }): Promise<boolean> {
    if (manual) {
      const status = await checkBackendStatus();
      const confirmed = window.confirm(
        [
          t("confirmApplyNowTitle"),
          "",
          t("confirmApplyNowRisk"),
          "",
          status.status === "idle"
            ? t("confirmApplyIdle")
            : `${status.message} ${t("applyNow")}?`,
        ].join("\n")
      );
      if (!confirmed) {
        return false;
      }
    }

    setRestarting(true);
    setError(null);
    try {
      const restart = await restartBackendRequest();
      setRestartResult(restart);
      setRequiresRestart(restart.status !== "restarted");

      if (restart.status !== "restarted") {
        throw new Error(restart.message || t("applyConfigFailed"));
      }

      setAutoRestart(false);
      setBackendStatus(null);
      toast.success(restart.message || t("configApplied"));
      if (redirectHome) {
        await navigateAfterOnboarding({ waitForReady: true });
      }
      return true;
    } catch (restartError) {
      const message =
        restartError instanceof Error
          ? restartError.message
          : t("applyConfigFailed");
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setRestarting(false);
    }
  }

  async function saveUnifiedConfig(): Promise<{
    saved: boolean;
    needsRestart: boolean;
  }> {
    let configResult = {
      saved: true,
      needsRestart: requiresRestart,
    };
    if (hasChanges) {
      configResult = await saveConfig({ scheduleIdle: false, silent: true });
      if (!configResult.saved) {
        return { saved: false, needsRestart: false };
      }
    }

    return {
      saved: true,
      needsRestart: configResult.needsRestart || requiresRestart,
    };
  }

  async function applyWhenIdle() {
    const result = await saveUnifiedConfig();
    if (!result.saved) {
      return;
    }

    if (result.needsRestart) {
      setAutoRestart(true);
      toast.success(t("configSavedIdle"));
      return;
    }

    toast.success(t("configSaved"));
  }

  async function applyNow() {
    const result = await saveUnifiedConfig();
    if (result.saved && result.needsRestart) {
      await restartBackendNow({ manual: true });
    }
  }

  async function finishOnboarding() {
    if (
      !config.openaiCompatibleBaseUrl.trim() ||
      (!config.openaiCompatibleApiKey.trim() &&
        !config.openaiCompatibleApiKeySet)
    ) {
      const message = t("missingOpenAiFields");
      setError(message);
      toast.error(message);
      return;
    }

    const result = await saveConfig({ scheduleIdle: false });
    if (!result.saved) {
      return;
    }
    if (result.needsRestart) {
      await restartBackendNow({ manual: false, redirectHome: true });
      return;
    }
    await navigateAfterOnboarding({ waitForReady: true });
  }

  async function skipOnboarding() {
    const result = await saveConfig({
      onboardingSkipped: true,
      scheduleIdle: false,
    });
    if (!result.saved) {
      return;
    }
    await navigateAfterOnboarding({ waitForReady: false });
  }

  function updateTheme(nextTheme: ThemeMode) {
    setThemeMode(nextTheme);
    applyTheme(nextTheme);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setOnboardingRequested(params.get("onboarding") === "1");
    }
    const storedTheme = getStoredTheme();
    setThemeMode(storedTheme);
    applyTheme(storedTheme);
    void loadConfig();
  }, []);

  useEffect(() => {
    if (
      !autoRestart ||
      !hasPendingRestart ||
      hasAnyChanges ||
      actionBusy
    ) {
      return;
    }

    let cancelled = false;
    const checkAndRestart = async () => {
      try {
        const status = await checkBackendStatus();
        if (!cancelled && status.status === "idle") {
          await restartBackendNow({ manual: false });
        }
      } catch {
        // Keep polling; the visible status text updates on the next successful check.
      }
    };

    void checkAndRestart();
    const interval = window.setInterval(checkAndRestart, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoRestart,
    hasPendingRestart,
    hasAnyChanges,
    actionBusy,
  ]);

  return (
    <div className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      {!onboardingMode && (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <div className="flex min-w-0 items-center gap-4">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-2"
            >
              <Link href={returnHref}>
                <ArrowLeft className="h-4 w-4" />
                {returnLabel}
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold">
                {t("configTitle")}
              </h1>
              <div className="truncate text-xs text-muted-foreground">
                {t("configSubtitle")}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle
              language={config.language || language}
              onChange={updateLanguage}
              compact
            />
            <>
              <Button
                type="button"
                size="sm"
                onClick={applyWhenIdle}
                disabled={!canApplyWhenIdle}
                title={
                  hasAnyChanges
                    ? t("saveIdleTitle")
                    : t("applyIdleTitle")
                }
                className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {hasAnyChanges ? t("saveAndApplyIdle") : t("applyIdle")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void applyNow()}
                disabled={!canApplyNow}
                title={
                  hasAnyChanges
                    ? t("saveNowTitle")
                    : t("applyNowTitle")
                }
                className="h-9"
              >
                {restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ServerCog className="h-4 w-4" />
                )}
                {hasAnyChanges ? t("saveAndApplyNow") : t("applyNow")}
              </Button>
            </>
          </div>
        </header>
      )}

      <main
        className={cn(
          "mx-auto w-full px-6 py-6",
          onboardingMode
            ? "flex min-h-[calc(100vh-var(--app-footer-height))] max-w-lg flex-col justify-center"
            : "max-w-6xl"
        )}
      >
        {onboardingMode && (
          <div className="mb-4 text-center">
            <div className="mb-4 flex justify-center">
              <LanguageToggle
                language={config.language || language}
                onChange={updateLanguage}
              />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("firstRunTitle")}
            </h1>
            <div className="mt-2 text-sm text-muted-foreground">
              {t("firstRunSubtitle")}
            </div>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-[#ff6d8d]/35 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]">
            {error}
          </div>
        )}
        {config.workspaceError && !loading && !onboardingMode && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-[#f5b85b]/35 dark:bg-[#f5b85b]/10 dark:text-[#ffe0aa]">
            {config.workspaceError}
          </div>
        )}

        <form
          id="internagents-config-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (onboardingMode) {
              void finishOnboarding();
            } else {
              void applyWhenIdle();
            }
          }}
          className={cn(
            onboardingMode
              ? "w-full space-y-4"
              : "grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start"
          )}
        >
          {!onboardingMode && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground lg:col-span-2">
              <span>{t("configEffectHint")}</span>
              {hasPendingRestart && !hasAnyChanges && (
                <span className="text-amber-700 dark:text-[#f5b85b]">
                  {t("configPending")}
                </span>
              )}
              {restartResult && (
                <span
                  className={cn(
                    restartResult.status === "restarted"
                      ? "text-primary"
                      : "text-red-700 dark:text-[#ff6d8d]"
                  )}
                >
                  {restartResult.message}
                </span>
              )}
              {backendStatus && showBackendStatus && (
                <span
                  className={cn(
                    backendStatus.status === "idle"
                      ? "text-primary"
                      : backendStatus.status === "busy"
                      ? "text-amber-700 dark:text-[#f5b85b]"
                      : "text-red-700 dark:text-[#ff6d8d]"
                  )}
                >
                  {backendStatus.message}
                </span>
              )}
            </div>
          )}

          {!onboardingMode && (
            <aside className="sticky top-20 hidden rounded-lg border border-border bg-card/90 p-2 shadow-sm backdrop-blur lg:block">
              <div className="px-2 pb-2 pt-1">
                <div className="text-sm font-semibold">{t("settings")}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {t("quickJump")}
                </div>
              </div>
              <nav
                aria-label={t("configNavLabel")}
                className="space-y-1"
              >
                {SETTINGS_SECTIONS.map((section) => {
                  const SectionIcon = section.icon;
                  return (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className="flex items-start gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-accent hover:text-accent-foreground"
                    >
                      <SectionIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block font-medium">
                          {t(section.title)}
                        </span>
                        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                          {t(section.description)}
                        </span>
                      </span>
                    </a>
                  );
                })}
              </nav>
            </aside>
          )}

          <div
            className={cn(
              onboardingMode
                ? "space-y-4"
                : "min-w-0 space-y-5 lg:col-start-2"
            )}
          >
          <section
            id="settings-model"
            className={cn(
              "scroll-mt-24 rounded-lg border border-border bg-card shadow-sm",
              onboardingMode ? "p-4" : "p-5"
            )}
          >
            {!onboardingMode && (
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <Cpu className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{t("model")}</h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t("modelSectionHelp")}
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("loadingConfig")}
              </div>
            ) : (
              <div
                className={cn(
                  onboardingMode ? "space-y-4" : "space-y-5"
                )}
              >
                {!onboardingMode && (
                  <div className="text-xs leading-5 text-muted-foreground">
                    {t("openAiCompatibleDescription")}
                  </div>
                )}

                <div
                  className={cn(
                    onboardingMode ? "mt-4 space-y-3" : "space-y-4"
                  )}
                >
                  {!onboardingMode && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="openai-compatible-api-key">
                        {t("openAiCompatible")}
                      </Label>
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-xs font-medium",
                          config.openaiCompatibleApiKeySet
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {config.openaiCompatibleApiKeySet
                          ? t("saved")
                          : t("unsaved")}
                      </span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <ServerCog className="h-3.5 w-3.5" />
                      Base URL
                    </div>
                    <Input
                      id="openai-compatible-base-url"
                      type="url"
                      autoComplete="off"
                      value={config.openaiCompatibleBaseUrl}
                      disabled={loading}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          openaiCompatibleBaseUrl: event.target.value,
                        }))
                      }
                      placeholder="https://openrouter.ai/api/v1"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5" />
                        API Key
                      </div>
                      <Input
                        id="openai-compatible-api-key"
                        type="password"
                        autoComplete="off"
                        value={config.openaiCompatibleApiKey}
                        disabled={loading}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            openaiCompatibleApiKey: event.target.value,
                          }))
                        }
                        placeholder={
                          config.openaiCompatibleApiKeySet
                            ? t("savedKeyPlaceholder")
                            : "sk-..."
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Cpu className="h-3.5 w-3.5" />
                        {t("modelId")}
                      </div>
                      <Input
                        id="openai-compatible-model"
                        type="text"
                        autoComplete="off"
                        value={config.openaiCompatibleModel}
                        disabled={loading}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            model: event.target.value,
                            openaiCompatibleModel: event.target.value,
                          }))
                        }
                        placeholder="deepseek-v4-flash"
                      />
                    </div>
                  </div>
                  {!onboardingMode && (
                    <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div className="min-w-0 truncate">
                        {t("modelLabel")}:{" "}
                        {config.openaiCompatibleModel || "deepseek-v4-flash"}
                      </div>
                      <div className="min-w-0 truncate">
                        Base URL:{" "}
                        {config.openaiCompatibleBaseUrl ||
                          "https://openrouter.ai/api/v1"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {onboardingMode && (
            <div className="space-y-2">
              <Button
                type="submit"
                disabled={!canFinishOnboarding}
                className="h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving || restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ServerCog className="h-4 w-4" />
                )}
                {t("finishSetup")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={actionBusy}
                title={t("skipSetupTitle")}
                onClick={() => void skipOnboarding()}
                className="h-10 w-full"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t("skipSetup")}
              </Button>
            </div>
          )}

          {!onboardingMode && (
            <>
              <section
                id="settings-skills"
                className="flex h-[min(760px,calc(100vh-8rem))] scroll-mt-24 flex-col overflow-hidden rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 flex shrink-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{t("skills")}</h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("skillsSectionHelp")}
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <SkillsMarketplace embedded view="skills" />
                </div>
              </section>

              <section
                id="settings-connectors"
                className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <Plug className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">
                      {t("connectors")}
                    </h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("connectorsSectionHelp")}
                    </div>
                  </div>
                </div>
                <SkillsMarketplace
                  embedded
                  initialTab="connections"
                  view="connections"
                />
              </section>

              <section
                id="settings-remote-projects"
                className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-sm lg:col-start-2"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <Server className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">
                      {t("remoteProjects")}
                    </h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("remoteProjectsDescription")}
                    </div>
                  </div>
                </div>

                <RemoteProjectsSettingsCard />
              </section>

              <section
                id="settings-compute"
                className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-sm lg:col-start-2"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <ServerCog className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{t("compute")}</h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("computeSectionSubtitle")}
                    </div>
                  </div>
                </div>

                <ComputeSettingsCard />
              </section>

              <section
                id="settings-authorization"
                className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">
                      {t("authorization")}
                    </h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("authorizationHelp")}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {AUTHORIZATION_OPTIONS.map((option) => {
                    const active = config.authorizationMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            authorizationMode: option.id,
                          }))
                        }
                        className={cn(
                          "flex min-h-44 flex-col rounded-lg border bg-background p-4 text-left transition hover:border-primary/50 hover:bg-accent dark:hover:border-[hsl(var(--primary)/0.5)]",
                          active
                            ? "border-primary ring-2 ring-primary/20 dark:border-[hsl(var(--primary))] dark:ring-[hsl(var(--primary)/0.2)]"
                            : "border-border"
                        )}
                      >
                        <div className="mb-4 flex items-center justify-between gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary">
                            <Shield className="h-4 w-4" />
                          </div>
                          {option.badge && (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground dark:bg-[hsl(var(--primary))] dark:text-[hsl(var(--primary-foreground))]">
                              {t(option.badge)}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold">
                          {t(option.title)}
                        </div>
                        <div className="mt-2 text-sm text-foreground">
                          {t(option.description)}
                        </div>
                        <div className="mt-3 text-xs leading-5 text-muted-foreground">
                          {t(option.detail)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section
                id="settings-appearance"
                className="scroll-mt-24 rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                    {themeMode === "dark" ? (
                      <Moon className="h-5 w-5" />
                    ) : (
                      <Sun className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">
                      {t("appearance")}
                    </h2>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {t("appearanceHelp")}
                    </div>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
                  <div>
                    <div className="text-sm font-semibold">
                      {t("language")}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {config.language === "zh" ? t("chinese") : t("english")}
                    </div>
                  </div>
                  <LanguageToggle
                    language={config.language || language}
                    onChange={updateLanguage}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {THEME_OPTIONS.map((option) => {
                    const active = themeMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => updateTheme(option.id)}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border bg-background p-4 text-left transition hover:border-primary/50 hover:bg-accent dark:hover:border-[hsl(var(--primary)/0.5)]",
                          active
                            ? "border-primary ring-2 ring-primary/20 dark:border-[hsl(var(--primary))] dark:ring-[hsl(var(--primary)/0.2)]"
                            : "border-border"
                        )}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary">
                          {option.id === "dark" ? (
                            <Moon className="h-4 w-4" />
                          ) : (
                            <Sun className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-semibold">
                            {t(option.title)}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {t(option.description)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div
                id="settings-archives"
                className="scroll-mt-24"
              >
                <ArchivedThreadsCard />
              </div>

              <div className="flex justify-end text-xs text-muted-foreground">
                <div className="truncate">
                  {t("configFile")}: {config.configPath || "-"}
                </div>
              </div>
            </>
          )}
          </div>
        </form>
      </main>
    </div>
  );
}

export default function ConfigPage() {
  return (
    <Suspense fallback={<ConfigPageFallback />}>
      <ConfigPageContent />
    </Suspense>
  );
}

function ConfigPageFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
