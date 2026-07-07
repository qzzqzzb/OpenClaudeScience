"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCcw,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  addSshComputeHost,
  listSshComputeHosts,
  type SshComputeHost,
} from "@/app/services/computeClient";
import {
  listRemoteSshHosts,
  type SshHostEntry,
} from "@/app/services/remoteClient";
import { cn } from "@/lib/utils";

export function ComputeSettingsCard() {
  const { t } = useLanguage();
  const [hosts, setHosts] = useState<SshComputeHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingHost, setAddingHost] = useState(false);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshHostEntry[]>([]);
  const [sshConfigError, setSshConfigError] = useState<string | null>(null);
  const [hostAlias, setHostAlias] = useState("");
  const [hostNotes, setHostNotes] = useState("");
  const [hostAliasMenuOpen, setHostAliasMenuOpen] = useState(false);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hostAliasBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) || hosts[0],
    [hosts, selectedHostId]
  );
  const filteredSshConfigHosts = useMemo(() => {
    const query = hostAlias.trim().toLowerCase();
    return sshConfigHosts.filter((host) => {
      if (!query) {
        return true;
      }
      return host.host.toLowerCase().includes(query);
    });
  }, [hostAlias, sshConfigHosts]);

  function openHostAliasMenu() {
    if (hostAliasBlurTimer.current) {
      clearTimeout(hostAliasBlurTimer.current);
      hostAliasBlurTimer.current = null;
    }
    setHostAliasMenuOpen(true);
  }

  function closeHostAliasMenuSoon() {
    if (hostAliasBlurTimer.current) {
      clearTimeout(hostAliasBlurTimer.current);
    }
    hostAliasBlurTimer.current = setTimeout(() => {
      setHostAliasMenuOpen(false);
    }, 120);
  }

  function selectHostAlias(alias: string) {
    setHostAlias(alias);
    setHostAliasMenuOpen(false);
  }

  async function refreshHosts() {
    const [configResult, computePayload] = await Promise.all([
      listRemoteSshHosts(t("sshConfigUnreadable"))
        .then((payload) => ({ ok: true as const, payload }))
        .catch((configError) => ({
          ok: false as const,
          message:
            configError instanceof Error
              ? configError.message
              : t("sshConfigUnreadable"),
        })),
      listSshComputeHosts(),
    ]);

    if (configResult.ok) {
      const configHosts = configResult.payload.hosts || [];
      setSshConfigHosts(configHosts);
      setSshConfigError(null);
      if (!hostAlias && configHosts[0]) {
        setHostAlias(configHosts[0].host);
      }
    } else {
      setSshConfigHosts([]);
      setSshConfigError(configResult.message);
    }

    setHosts(computePayload.hosts);
    if (!selectedHostId && computePayload.hosts[0]) {
      setSelectedHostId(computePayload.hosts[0].id);
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshHosts();
    } catch (refreshError) {
      const message =
        refreshError instanceof Error ? refreshError.message : t("refreshFailed");
      setError(message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }

  async function addHost() {
    const host = hostAlias.trim();
    if (!host) {
      toast.error(t("enterHostAliasError"));
      return;
    }
    setAddingHost(true);
    setError(null);
    try {
      const payload = await addSshComputeHost({
        host,
        notes: hostNotes.trim() || undefined,
      });
      setHosts((current) => [
        payload.host,
        ...current.filter((candidate) => candidate.id !== payload.host.id),
      ]);
      setSelectedHostId(payload.host.id);
      setHostNotes("");
      toast.success(t("sshComputeHostConnected"));
    } catch (hostError) {
      const message =
        hostError instanceof Error ? hostError.message : t("hostSetupFailed");
      setError(message);
      toast.error(message);
    } finally {
      setAddingHost(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {t("computeHelp")}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          {t("refresh")}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-[#ff6d8d]/35 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-3 flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("sshHostsTitle")}</h3>
        </div>
        <div className="mb-3 space-y-2 text-sm text-muted-foreground">
          <p>{t("sshHostsDescription")}</p>
          {sshConfigError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-[#f5b85b]/35 dark:bg-[#f5b85b]/10 dark:text-[#ffe0aa]">
              {t("sshConfigUnreadable")}
            </div>
          ) : sshConfigHosts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-2">
              {t("sshConfigHostsEmpty")}
            </div>
          ) : null}
        </div>
        <div className="grid gap-3">
          <div className="space-y-2">
            <Label htmlFor="compute-host-alias">{t("hostAlias")}</Label>
            <div className="relative">
              <Input
                id="compute-host-alias"
                value={hostAlias}
                autoComplete="off"
                placeholder={t("hostAliasPlaceholder")}
                className="pr-11"
                role="combobox"
                aria-expanded={hostAliasMenuOpen}
                aria-controls="compute-ssh-config-hosts"
                onBlur={closeHostAliasMenuSoon}
                onFocus={openHostAliasMenu}
                onChange={(event) => {
                  setHostAlias(event.target.value);
                  setHostAliasMenuOpen(true);
                }}
              />
              <button
                type="button"
                aria-label={t("chooseHostAlias")}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setHostAliasMenuOpen((open) => !open)}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition",
                    hostAliasMenuOpen && "rotate-180"
                  )}
                />
              </button>
              {hostAliasMenuOpen && sshConfigHosts.length > 0 && (
                <div
                  id="compute-ssh-config-hosts"
                  className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-lg"
                >
                  {filteredSshConfigHosts.length > 0 ? (
                    filteredSshConfigHosts.map((host) => (
                      <button
                        key={host.host}
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left transition hover:bg-accent",
                          hostAlias === host.host && "bg-accent"
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectHostAlias(host.host)}
                      >
                        <span className="font-mono">{host.host}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {host.source}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-muted-foreground">
                      {t("noMatchingSshHosts")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="compute-host-notes">
              {t("agentHostNotesLabel")}
            </Label>
            <Textarea
              id="compute-host-notes"
              value={hostNotes}
              placeholder={t("agentHostNotesPlaceholder")}
              onChange={(event) => setHostNotes(event.target.value)}
              className="min-h-24"
            />
          </div>
        </div>
        <Button
          type="button"
          className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => void addHost()}
          disabled={addingHost}
        >
          {addingHost ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t("addSshHost")}
        </Button>

        <div className="mt-4 grid gap-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loadingComputeHosts")}
            </div>
          ) : hosts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {t("noSshComputeHosts")}
            </div>
          ) : (
            hosts.map((host) => (
              <button
                key={host.id}
                type="button"
                onClick={() => setSelectedHostId(host.id)}
                className={cn(
                  "rounded-md border p-3 text-left transition hover:border-primary/50 hover:bg-accent",
                  selectedHost?.id === host.id
                    ? "border-primary ring-2 ring-primary/15"
                    : "border-border"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-mono text-sm font-semibold">
                    {host.hostAlias || host.label}
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                      host.probe?.ok
                        ? "bg-primary/10 text-primary"
                        : "bg-red-50 text-red-700 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]"
                    )}
                  >
                    {host.probe?.ok ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {host.probe?.ok ? t("linuxReady") : t("probeFailed")}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-3">
                  <span>
                    {t("osLabel")}: {host.probe?.os || "-"}
                  </span>
                  <span>
                    {t("archLabel")}: {host.probe?.arch || "-"}
                  </span>
                  <span>
                    {t("pythonLabel")}: {host.probe?.python || "-"}
                  </span>
                </div>
                {host.notes && (
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    {host.notes}
                  </div>
                )}
                {host.probe?.error && (
                  <div className="mt-2 text-xs text-red-700 dark:text-[#ffc7d4]">
                    {host.probe.error}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
