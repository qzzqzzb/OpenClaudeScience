"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { MoleculeViewer } from "@/app/components/MoleculeViewer";
import { ScienceSceneViewer } from "@/app/components/ScienceSceneViewer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  WorkspaceFileResponse,
  WorkspaceOfficePreviewBlock,
} from "@/app/types/workspace";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  getWorkspaceFile,
  openWorkspaceFile,
} from "@/app/services/workspaceClient";

interface WorkspaceViewerProps {
  selectedPath?: string | null;
  resourceId?: string;
  workspaceId?: string;
  compact?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onClear?: () => void;
  onResolvedPath?: (path: string) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".css": "css",
  caddyfile: "text",
  dockerfile: "dockerfile",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  gemfile: "ruby",
  makefile: "makefile",
  procfile: "text",
  ".py": "python",
  rakefile: "ruby",
  ".sh": "bash",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const PREVIEW_KIND_LABELS: Record<WorkspaceFileResponse["previewKind"], string> =
  {
    binary: "Binary",
    docx: "Docx",
    image: "Image",
    markdown: "Markdown",
    molecule: "Molecule",
    pdf: "PDF",
    pptx: "PPT",
    science: "Science",
    text: "Text",
    unsupported: "File",
    xlsx: "Excel",
  };
const MAX_FILE_PREVIEW_CACHE_ENTRIES = 30;
const DEFAULT_WORKSPACE_SCOPE = "workspace";

const filePreviewCache = new Map<string, WorkspaceFileResponse>();

function filePreviewCacheKey({
  path,
  resourceId,
  workspaceId,
}: {
  path: string;
  resourceId?: string;
  workspaceId?: string;
}): string {
  return [
    resourceId || "local",
    workspaceId || DEFAULT_WORKSPACE_SCOPE,
    path,
  ].join("::");
}

function rememberFilePreview(
  key: string,
  file: WorkspaceFileResponse
): void {
  filePreviewCache.delete(key);
  filePreviewCache.set(key, file);

  while (filePreviewCache.size > MAX_FILE_PREVIEW_CACHE_ENTRIES) {
    const oldestKey = filePreviewCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    filePreviewCache.delete(oldestKey);
  }
}

function previewKindLabel(kind: WorkspaceFileResponse["previewKind"]): string {
  return PREVIEW_KIND_LABELS[kind] || kind;
}

function isOfficePreviewKind(
  kind: WorkspaceFileResponse["previewKind"] | undefined
) {
  return kind === "docx" || kind === "xlsx" || kind === "pptx";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyViewer() {
  const { t } = useLanguage();
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]">
          <PanelRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t("emptyPreview")}
        </p>
      </div>
    </div>
  );
}

function CollapsePreviewButton({ onCollapse }: { onCollapse?: () => void }) {
  const { t } = useLanguage();
  if (!onCollapse) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={t("collapseFilePreview")}
          onClick={onCollapse}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="whitespace-nowrap"
      >
        {t("collapseFilePreview")}
      </TooltipContent>
    </Tooltip>
  );
}

function ClearPreviewButton({ onClear }: { onClear?: () => void }) {
  const { t } = useLanguage();
  if (!onClear) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
          aria-label={t("closeFilePreview")}
          onClick={onClear}
        >
          <X className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="whitespace-nowrap"
      >
        {t("closeFilePreview")}
      </TooltipContent>
    </Tooltip>
  );
}

function ViewerHeader({
  title,
  onCollapse,
}: {
  title: string;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold leading-5">{title}</h2>
      </div>
      <CollapsePreviewButton onCollapse={onCollapse} />
    </div>
  );
}

function hasOfficeBlockContent(block: WorkspaceOfficePreviewBlock): boolean {
  return Boolean(block.lines?.length || block.rows?.length);
}

function OfficeFallback({ message }: { message?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-sm rounded-md border border-border bg-muted p-5 text-sm leading-6 text-muted-foreground">
        {message || t("noPreviewAvailable")}
      </div>
    </div>
  );
}

function OfficeTextBlock({
  block,
  documentMode = false,
}: {
  block: WorkspaceOfficePreviewBlock;
  documentMode?: boolean;
}) {
  const { t } = useLanguage();
  const lines = block.lines || [];
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("noPreviewText")}</p>;
  }

  return (
    <div className={documentMode ? "space-y-4" : "space-y-3"}>
      {lines.map((line, index) => (
        <p
          key={`${index}-${line.slice(0, 24)}`}
          className={
            documentMode
              ? "whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground"
              : "whitespace-pre-wrap break-words text-sm leading-6 text-foreground"
          }
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function OfficeSheetBlock({ block }: { block: WorkspaceOfficePreviewBlock }) {
  const { t } = useLanguage();
  const rows = block.rows || [];
  const maxColumns = Math.max(...rows.map((row) => row.length), 0);
  const columns = Array.from({ length: maxColumns }, (_, index) => index);

  if (rows.length === 0 || maxColumns === 0) {
    return <p className="text-sm text-muted-foreground">{t("noPreviewSheet")}</p>;
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-background">
      <div className="scrollbar-subtle w-full min-w-0 overflow-x-auto overflow-y-hidden pb-2">
        <table className="w-max min-w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className="border-b border-border last:border-b-0"
              >
                <th className="sticky left-0 z-10 w-10 min-w-10 border-r border-border bg-muted px-2 py-1 text-right font-medium text-muted-foreground">
                  {rowIndex + 1}
                </th>
                {columns.map((columnIndex) => (
                  <td
                    key={columnIndex}
                    className="min-w-[120px] max-w-[260px] border-r border-border px-2 py-1 align-top leading-5 text-foreground last:border-r-0"
                  >
                    <span className="block whitespace-pre-wrap break-words">
                      {row[columnIndex] || ""}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OfficePreview({ file }: { file: WorkspaceFileResponse }) {
  const { t } = useLanguage();
  const preview = file.officePreview;
  const blocks = preview?.blocks || [];
  const hasContent = blocks.some(hasOfficeBlockContent);

  if (!preview || preview.error || !hasContent) {
    return <OfficeFallback message={preview?.error} />;
  }

  if (preview.kind === "docx") {
    return (
      <div className="scrollbar-subtle h-full w-full min-w-0 overflow-y-auto bg-muted/30">
        <div className="w-full min-w-0 px-4 py-5 sm:px-6">
          {preview.truncated && (
            <div className="mx-auto mb-4 max-w-[740px] rounded-md border border-border bg-background px-3 py-2 text-xs leading-5 text-muted-foreground shadow-sm shadow-black/[0.025]">
              {t("previewTruncated")}
            </div>
          )}
          <article className="mx-auto min-h-[72vh] w-full max-w-[740px] rounded-md border border-border bg-background px-6 py-7 shadow-sm shadow-black/[0.04] sm:px-10 sm:py-10">
            <div className="space-y-7">
              {blocks.map((block, index) => (
                <section key={`${block.title}-${index}`} className="min-w-0">
                  {blocks.length > 1 && (
                    <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/70 pb-2">
                      <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {block.title}
                      </h3>
                      {block.truncated && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t("truncated")}
                        </span>
                      )}
                    </div>
                  )}
                  <OfficeTextBlock block={block} documentMode />
                </section>
              ))}
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-subtle h-full w-full min-w-0 overflow-y-auto">
      <div className="min-w-0 space-y-4 px-5 py-4">
        {preview.truncated && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            {t("previewTruncated")}
          </div>
        )}
        {blocks.map((block, index) => (
          <section
            key={`${block.title}-${index}`}
            className="min-w-0 rounded-md border border-border bg-card p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="truncate text-sm font-semibold leading-5">
                {block.title}
              </h3>
              {block.truncated && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t("truncated")}
                </span>
              )}
            </div>
            {preview.kind === "xlsx" ? (
              <OfficeSheetBlock block={block} />
            ) : (
              <OfficeTextBlock block={block} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceViewer({
  selectedPath,
  resourceId,
  workspaceId,
  compact,
  onCollapse,
  onExpand,
  onClear,
  onResolvedPath,
}: WorkspaceViewerProps) {
  const { t } = useLanguage();
  const [file, setFile] = useState<WorkspaceFileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    const cacheKey = filePreviewCacheKey({
      path: selectedPath,
      resourceId,
      workspaceId,
    });
    const cachedFile = filePreviewCache.get(cacheKey) || null;

    if (cachedFile) {
      rememberFilePreview(cacheKey, cachedFile);
      setFile(cachedFile);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);

    getWorkspaceFile({
      path: selectedPath,
      resourceId,
      workspaceId,
      fallbackMessage: t("unableToLoadFile"),
    })
      .then((payload) => {
        if (!isCancelled) {
          rememberFilePreview(cacheKey, payload);
          if (payload.path && payload.path !== selectedPath) {
            rememberFilePreview(
              filePreviewCacheKey({
                path: payload.path,
                resourceId,
                workspaceId,
              }),
              payload
            );
          }
          setFile(payload);
          if (payload.path && payload.path !== selectedPath) {
            onResolvedPath?.(payload.path);
          }
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          if (!cachedFile) {
            setFile(null);
            setError(err instanceof Error ? err.message : t("unableToLoadFile"));
          }
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [onResolvedPath, resourceId, selectedPath, t, workspaceId]);

  const language = useMemo(() => {
    return file?.extension ? LANGUAGE_MAP[file.extension] || "text" : "text";
  }, [file?.extension]);

  async function openFileInSystemViewer() {
    if (!file || isOpeningFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      await openWorkspaceFile({
        path: file.path,
        resourceId,
        workspaceId,
        fallbackMessage: t("unableToOpenLocalFile"),
      });
    } catch (openError) {
      const message =
        openError instanceof Error
          ? openError.message
          : t("unableToOpenLocalFile");
      toast.error(message);
    } finally {
      setIsOpeningFile(false);
    }
  }

  if (compact) {
    return (
      <div className="flex h-full w-full items-start justify-center border-l border-border bg-card/70 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
              aria-label={t("expandFilePreview")}
              onClick={onExpand}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            sideOffset={8}
            className="whitespace-nowrap"
          >
            {t("expandFilePreview")}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-card">
        <ViewerHeader
          title={t("filePreview")}
          onCollapse={onCollapse}
        />
        <EmptyViewer />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-card">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-5">
            {file?.name || selectedPath}
          </h2>
          <div className="flex shrink-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
            {file && <span>{formatBytes(file.size)}</span>}
            {file?.previewKind && (
              <span>{previewKindLabel(file.previewKind)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {file?.rawUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void openFileInSystemViewer()}
              disabled={isOpeningFile}
              aria-label={t("openWithSystemViewer")}
              title={t("openWithSystemViewer")}
            >
              {isOpeningFile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4" />
              )}
            </Button>
          )}
          <ClearPreviewButton onClear={onClear} />
          <CollapsePreviewButton onCollapse={onCollapse} />
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {isLoading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loadingFile")}
          </div>
        )}

        {!isLoading && error && (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "pdf" && file.rawUrl && (
          <iframe
            src={file.rawUrl}
            title={file.path}
            className="h-full w-full border-0 bg-muted"
          />
        )}

        {!isLoading && !error && file?.previewKind === "image" && file.rawUrl && (
          <div className="flex h-full items-center justify-center bg-muted/30 p-6">
            <img
              src={file.rawUrl}
              alt={file.name}
              className="max-h-full max-w-full rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]"
            />
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "markdown" && (
          <ScrollArea className="h-full">
            <div className="px-6 py-5">
              <MarkdownContent content={file.content || ""} />
            </div>
          </ScrollArea>
        )}

        {!isLoading && !error && file?.previewKind === "molecule" && (
          <MoleculeViewer file={file} />
        )}

        {!isLoading && !error && file?.previewKind === "science" && (
          <ScienceSceneViewer file={file} />
        )}

        {!isLoading && !error && file?.previewKind === "text" && (
          <div className="h-full overflow-auto">
            <div className="min-w-0 p-4">
              {file.tooLarge ? (
                <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
                  {t("textFileTooLarge")}
                </div>
              ) : (
                <SyntaxHighlighter
                  language={language}
                  style={oneLight}
                  showLineNumbers
                  wrapLines
                  wrapLongLines
                  codeTagProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  lineProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  customStyle={{
                    margin: 0,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.8125rem",
                    minHeight: "100%",
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                    overflowX: "auto",
                    background: "hsl(var(--card))",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {file.content || ""}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        )}

        {!isLoading &&
          !error &&
          file &&
          isOfficePreviewKind(file.previewKind) && <OfficePreview file={file} />}

        {!isLoading &&
          !error &&
          file &&
          ![
            "image",
            "markdown",
            "molecule",
            "pdf",
            "science",
            "text",
          ].includes(file.previewKind) &&
          !isOfficePreviewKind(file.previewKind) && (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div className="max-w-xs rounded-md border border-border bg-muted p-5 text-sm text-muted-foreground">
                {t("unsupportedPreview")}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
