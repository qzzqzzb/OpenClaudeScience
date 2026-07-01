import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  AtSign,
  Beaker,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  Eye,
  Files,
  FileText,
  GitBranch,
  Hash,
  History,
  Mic,
  MoreHorizontal,
  Network,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  Shield,
  Slash,
  SlidersHorizontal,
  Sparkles,
  Square,
  Star,
  Table2,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  Annotation,
  ArtifactMetadata,
  ArtifactPreview,
  FileNode,
  Message,
  MessagePart,
  PermissionRequest,
  PlanState,
  ProvenanceRecord,
  ReviewerFinding,
  ToolEvent,
  Track,
} from "./adapter/types";
import { useWorkspaceStore } from "./features/workspace/store";

const pointColors: Record<string, string> = {
  neuron: "#3b82f6",
  muscle: "#a7c62b",
  immune: "#25b56a",
  ciliated: "#17becf",
  germline: "#d756a8",
  stem: "#f59e0b",
};

export default function App() {
  const initialize = useWorkspaceStore((state) => state.initialize);
  const loading = useWorkspaceStore((state) => state.loading);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (loading) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">
          <Beaker size={32} />
        </div>
        <p>Starting adapter workbench</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar />
      <Workspace />
      <Inspector />
      <Toasts />
    </main>
  );
}

function Sidebar() {
  const {
    projects,
    currentProject,
    selectProject,
    createSession,
    sessionGroup,
    setSessionGroup,
    sessions,
    activeSessionId,
    openSession,
    renameSession,
    deleteSession,
    leftMode,
    setLeftMode,
    showSettings,
    files,
    runtimeStatus,
  } = useWorkspaceStore();

  return (
    <aside className="sidebar">
      <section className="brand">
        <div>
          <h1>OpenClaudeScience</h1>
          <span>adapter demo</span>
        </div>
        <Beaker size={24} />
      </section>

      <label className="project-picker">
        <span>Project</span>
        <select value={currentProject?.projectId} onChange={(event) => void selectProject(event.target.value)}>
          {projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </label>

      <nav className="primary-actions" aria-label="workspace actions">
        <button onClick={() => void createSession()} title="New session">
          <Plus size={18} />
          <span>New</span>
        </button>
        <button onClick={() => showSettings()} title="Customize">
          <SlidersHorizontal size={18} />
          <span>Customize</span>
        </button>
        <button onClick={() => setLeftMode("files")} title="Files">
          <Files size={18} />
          <span>Files</span>
        </button>
      </nav>

      <div className="sidebar-tabs">
        {(["sessions", "files", "settings"] as const).map((mode) => (
          <button key={mode} className={leftMode === mode ? "active" : ""} onClick={() => (mode === "settings" ? showSettings() : setLeftMode(mode))}>
            {mode}
          </button>
        ))}
      </div>

      {leftMode === "sessions" && (
        <section className="session-nav">
          <div className="group-tabs">
            {(["active", "today", "all"] as const).map((group) => (
              <button key={group} className={sessionGroup === group ? "active" : ""} onClick={() => void setSessionGroup(group)}>
                {group}
              </button>
            ))}
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                className={`session-item ${session.sessionId === activeSessionId ? "active" : ""}`}
                onClick={() => void openSession(session.sessionId)}
              >
                <Circle size={10} className={`status-dot ${session.status}`} />
                <span className="session-title">{session.title}</span>
                {session.unread ? <span className="unread">{session.unread}</span> : null}
                <span className="session-summary">{session.summary}</span>
                <span className="session-tools">
                  <Pencil
                    size={14}
                    onClick={(event) => {
                      event.stopPropagation();
                      const title = window.prompt("Rename session", session.title);
                      if (title) void renameSession(session.sessionId, title);
                    }}
                  />
                  <Trash2
                    size={14}
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteSession(session.sessionId);
                    }}
                  />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {leftMode === "files" && <FileTree nodes={files} />}

      {leftMode === "settings" && (
        <section className="sidebar-settings">
          <Settings size={18} />
          <p>Settings are loaded from the adapter catalog and rendered in the inspector.</p>
        </section>
      )}

      <footer className="sidebar-footer">
        <button onClick={() => showSettings()} title="Settings">
          <Settings size={18} />
        </button>
        <span>
          <Radio size={14} />
          {runtimeStatus}
        </span>
      </footer>
    </aside>
  );
}

function FileTree({ nodes }: { nodes: FileNode[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterFiles(nodes, query), [nodes, query]);
  return (
    <section className="files-pane">
      <label className="search-field">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files" />
      </label>
      <div className="file-tree">
        {filtered.map((node) => (
          <FileNodeView key={node.path} node={node} />
        ))}
      </div>
    </section>
  );
}

function FileNodeView({ node }: { node: FileNode }) {
  return (
    <div className={`file-node ${node.type}`}>
      <div>
        {node.type === "folder" ? <Files size={14} /> : <FileText size={14} />}
        <span>{node.name}</span>
      </div>
      {node.children?.map((child) => (
        <FileNodeView key={child.path} node={child} />
      ))}
    </div>
  );
}

function Workspace() {
  const {
    activeSessionId,
    sessions,
    messages,
    permissions,
    plans,
    tools,
    tracks,
    jobs,
    findings,
    stopSession,
    spawnTrack,
    runReviewer,
  } = useWorkspaceStore();
  const session = sessions.find((item) => item.sessionId === activeSessionId);
  const sessionMessages = activeSessionId ? messages[activeSessionId] ?? [] : [];
  const sessionPermissions = Object.values(permissions).filter((permission) => permission.sessionId === activeSessionId && permission.status === "pending");
  const sessionFindings = Object.values(findings).filter((finding) => finding.sessionId === activeSessionId);
  const plan = activeSessionId ? plans[activeSessionId] : undefined;
  const sessionTracks = activeSessionId ? tracks[activeSessionId] ?? [] : [];
  const sessionJobs = Object.values(jobs).filter((job) => job.sessionId === activeSessionId);

  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">Session</span>
          <h2>{session?.title ?? "No session selected"}</h2>
          <p>{session?.summary}</p>
        </div>
        <div className="header-actions">
          <button onClick={() => void spawnTrack()} title="Spawn parallel track">
            <GitBranch size={17} />
            <span>Track</span>
          </button>
          <button onClick={() => void runReviewer()} title="Run reviewer">
            <Brain size={17} />
            <span>Review</span>
          </button>
          <button className="danger-ghost" onClick={() => void stopSession()} title="Stop session">
            <Square size={16} />
          </button>
        </div>
      </header>

      <div className="timeline">
        {plan ? <PlanPanel plan={plan} /> : null}
        {sessionPermissions.map((permission) => (
          <PermissionCard key={permission.id} permission={permission} />
        ))}
        {sessionTracks.length ? <TrackPanel tracks={sessionTracks} /> : null}
        {sessionJobs.length ? <RemoteJobs jobs={sessionJobs} /> : null}
        {sessionMessages.map((message) => (
          <MessageView key={message.messageId} message={message} tools={tools} />
        ))}
        {sessionFindings.length ? <ReviewFindings findings={sessionFindings} /> : null}
      </div>

      <Composer />
    </section>
  );
}

function PlanPanel({ plan }: { plan: PlanState }) {
  const approvePlan = useWorkspaceStore((state) => state.approvePlan);
  const requestPlanRevision = useWorkspaceStore((state) => state.requestPlanRevision);
  return (
    <motion.section className="plan-panel" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="panel-heading">
        <Play size={17} />
        <div>
          <strong>{plan.title}</strong>
          <span>{plan.status}</span>
        </div>
      </div>
      <p>{plan.summary}</p>
      <ol className="plan-steps">
        {plan.steps.map((step) => (
          <li key={step.id} className={step.status}>
            <CheckCircle2 size={15} />
            <span>{step.title}</span>
            <em>{step.status}</em>
          </li>
        ))}
      </ol>
      <div className="inline-actions">
        <button onClick={() => void approvePlan(plan.planId)}>Approve</button>
        <button onClick={() => void requestPlanRevision(plan.planId)}>Request revision</button>
      </div>
    </motion.section>
  );
}

function PermissionCard({ permission }: { permission: PermissionRequest }) {
  const [scope, setScope] = useState(permission.recommendedScope);
  const respondPermission = useWorkspaceStore((state) => state.respondPermission);
  return (
    <motion.section className={`permission-card ${permission.risk}`} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="panel-heading">
        <Shield size={18} />
        <div>
          <strong>{permission.title}</strong>
          <span>{permission.type}</span>
        </div>
      </div>
      <p>{permission.summary}</p>
      <div className="permission-details">
        {Object.entries(permission.details).map(([name, value]) => (
          <span key={name}>
            {name}: {String(value)}
          </span>
        ))}
      </div>
      <div className="scope-row">
        {permission.scopes.map((item) => (
          <button key={item} className={scope === item ? "active" : ""} onClick={() => setScope(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="inline-actions">
        <button onClick={() => void respondPermission(permission.id, "approve", scope)}>Approve</button>
        <button onClick={() => void respondPermission(permission.id, "deny")}>Deny</button>
      </div>
    </motion.section>
  );
}

function MessageView({ message, tools }: { message: Message; tools: Record<string, ToolEvent> }) {
  const openArtifact = useWorkspaceStore((state) => state.openArtifact);
  return (
    <motion.article className={`message ${message.role}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="message-meta">
        <span>{message.role}</span>
        {message.status === "streaming" ? <em>streaming</em> : null}
      </div>
      {message.parts.map((part, index) => {
        if (part.type === "text") return <p key={index}>{part.text}</p>;
        if (part.type === "artifact_ref") {
          return (
            <button key={index} className="ref-chip" onClick={() => void openArtifact(part.artifactId)}>
              <FileText size={14} />
              {part.label ?? part.artifactId}
            </button>
          );
        }
        if (part.type === "tool") return <ToolCell key={index} tool={tools[part.toolId]} toolId={part.toolId} />;
        if (part.type === "permission") return <span key={index} className="muted-chip">permission {part.permissionId}</span>;
        if (part.type === "remote_job") return <span key={index} className="muted-chip">remote job {part.jobId}</span>;
        if (part.type === "session_ref") return <span key={index} className="muted-chip">session {part.label ?? part.sessionId}</span>;
        if (part.type === "skill_ref") return <span key={index} className="muted-chip">skill {part.label ?? part.skillId}</span>;
        if (part.type === "upload_ref") return <span key={index} className="muted-chip">upload {part.label ?? part.uploadId}</span>;
        return null;
      })}
      {message.annotationIds?.length ? <span className="annotation-footnote">{message.annotationIds.length} annotations attached</span> : null}
    </motion.article>
  );
}

function ToolCell({ tool, toolId }: { tool?: ToolEvent; toolId: string }) {
  const [open, setOpen] = useState(false);
  if (!tool) return <span className="muted-chip">tool {toolId}</span>;
  return (
    <section className={`tool-cell ${tool.status}`}>
      <button onClick={() => setOpen((value) => !value)}>
        <Terminal size={15} />
        <span>{tool.title}</span>
        <em>{tool.status}</em>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {tool.code ? <pre>{tool.code}</pre> : null}
            <code>{tool.stdout}</code>
            {tool.stderr ? <code className="stderr">{tool.stderr}</code> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function TrackPanel({ tracks }: { tracks: Track[] }) {
  const stopTrack = useWorkspaceStore((state) => state.stopTrack);
  return (
    <section className="track-panel">
      <div className="panel-heading">
        <GitBranch size={17} />
        <strong>{tracks.length} delegation tracks</strong>
      </div>
      {tracks.map((track) => (
        <div key={track.trackId} className="track-row">
          <span>{track.title}</span>
          <progress value={track.progress} max={100} />
          <em>{track.status}</em>
          <button onClick={() => void stopTrack(track.trackId)} title="Stop track">
            <Square size={14} />
          </button>
          <small>{track.messages.join(" · ")}</small>
        </div>
      ))}
    </section>
  );
}

function RemoteJobs({ jobs }: { jobs: ReturnType<typeof useWorkspaceStore.getState>["jobs"][string][] }) {
  return (
    <section className="job-panel">
      <div className="panel-heading">
        <Network size={17} />
        <strong>Remote jobs</strong>
      </div>
      {jobs.map((job) => (
        <div key={job.jobId} className="job-row">
          <span>{job.title}</span>
          <em>{job.status}</em>
          {job.logs.map((line) => (
            <code key={line}>{line}</code>
          ))}
        </div>
      ))}
    </section>
  );
}

function ReviewFindings({ findings }: { findings: ReviewerFinding[] }) {
  return (
    <section className="review-panel">
      <div className="panel-heading">
        <Brain size={17} />
        <strong>Reviewer · {findings.length} findings</strong>
      </div>
      {findings.map((finding) => (
        <article key={finding.findingId} className={`finding ${finding.severity}`}>
          <span>
            <AlertTriangle size={15} />
            {finding.severity}
          </span>
          <strong>{finding.claim}</strong>
          <p>{finding.evidence}</p>
          <em>{finding.recommendation}</em>
        </article>
      ))}
    </section>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const {
    activeSessionId,
    activeArtifactId,
    activeVersionId,
    pendingParts,
    annotations,
    addPendingPart,
    attachUpload,
    clearPendingParts,
    sendMessage,
  } = useWorkspaceStore();
  const staged = Object.values(annotations).filter((annotation) => annotation.sessionId === activeSessionId && annotation.status === "staged");

  return (
    <section className="composer">
      <div className="composer-status">
        {staged.length ? <span>{staged.length} comments staged</span> : <span>Adapter command composer</span>}
        {pendingParts.map((part, index) => (
          <button key={index} onClick={clearPendingParts}>{part.type}</button>
        ))}
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask anything" />
      <div className="composer-actions">
        <button title="Upload" onClick={() => void attachUpload("dataset_upload.h5ad")}>
          <Paperclip size={18} />
        </button>
        <button
          title="@ artifact"
          onClick={() =>
            activeArtifactId &&
            addPendingPart({ type: "artifact_ref", artifactId: activeArtifactId, versionId: activeVersionId, label: "current artifact" })
          }
        >
          <AtSign size={18} />
        </button>
        <button title="# session" onClick={() => activeSessionId && addPendingPart({ type: "session_ref", sessionId: activeSessionId, label: "current session" })}>
          <Hash size={18} />
        </button>
        <button title="/ skill" onClick={() => addPendingPart({ type: "skill_ref", skillId: "skill_figure_review", label: "Figure reviewer" })}>
          <Slash size={18} />
        </button>
        <span className="composer-spacer" />
        <button title="Voice mock">
          <Mic size={18} />
        </button>
        <button
          className="send-button"
          onClick={() => {
            void sendMessage(text);
            setText("");
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </section>
  );
}

function Inspector() {
  const { inspectorMode } = useWorkspaceStore();
  if (inspectorMode === "settings") return <SettingsInspector />;
  return <ArtifactInspector />;
}

function ArtifactInspector() {
  const {
    activeArtifactId,
    activeVersionId,
    activeSessionId,
    artifacts,
    versions,
    provenance,
    inspectorMode,
    provenanceTab,
    openArtifact,
    selectArtifactVersion,
    setProvenanceTab,
    starArtifact,
    renameArtifact,
    deleteArtifact,
    downloadArtifact,
    stageAnnotation,
  } = useWorkspaceStore();
  const artifact = Object.values(artifacts)
    .flat()
    .find((item) => item.id === activeArtifactId);
  const artifactVersions = activeArtifactId ? versions[activeArtifactId] ?? [] : [];
  const version = artifactVersions.find((item) => item.versionId === activeVersionId) ?? artifactVersions[0];
  const activeProvenance = activeArtifactId && activeVersionId ? provenance[`${activeArtifactId}:${activeVersionId}`] : undefined;
  const sessionArtifacts = activeSessionId ? artifacts[activeSessionId] ?? [] : [];

  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div>
          <span className="eyebrow">Artifact</span>
          <h3>{artifact?.name ?? "No artifact open"}</h3>
        </div>
        {artifact ? (
          <div className="icon-row">
            <button onClick={() => void starArtifact(artifact.id, !artifact.starred)} title="Star">
              <Star size={17} fill={artifact.starred ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => {
                const name = window.prompt("Rename artifact", artifact.name);
                if (name) void renameArtifact(artifact.id, name);
              }}
              title="Rename"
            >
              <Pencil size={16} />
            </button>
            <button onClick={() => void downloadArtifact(artifact.id, activeVersionId)} title="Download">
              <Download size={17} />
            </button>
            <button onClick={() => void deleteArtifact(artifact.id)} title="Delete">
              <Trash2 size={17} />
            </button>
          </div>
        ) : null}
      </header>

      <div className="artifact-strip">
        {sessionArtifacts.map((item) => (
          <button key={item.id} className={item.id === activeArtifactId ? "active" : ""} onClick={() => void openArtifact(item.id)}>
            {kindIcon(item.kind)}
            {item.name}
          </button>
        ))}
      </div>

      {artifact && version ? (
        <>
          <div className="version-bar">
            <button className={inspectorMode === "artifact" ? "active" : ""} onClick={() => void openArtifact(artifact.id, "artifact")}>
              <Eye size={15} />
              Preview
            </button>
            <button className={inspectorMode === "provenance" ? "active" : ""} onClick={() => setProvenanceTab("messages")}>
              <History size={15} />
              Provenance
            </button>
            <select value={version.versionId} onChange={(event) => void selectArtifactVersion(artifact.id, event.target.value)}>
              {artifactVersions.map((item) => (
                <option key={item.versionId} value={item.versionId}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {inspectorMode === "provenance" ? (
            <ProvenancePanel provenance={activeProvenance} tab={provenanceTab} setTab={setProvenanceTab} />
          ) : (
            <ArtifactPreviewView preview={version.preview} stageAnnotation={stageAnnotation} />
          )}
        </>
      ) : (
        <div className="empty-inspector">
          <FileText size={28} />
          <p>Open an artifact from the session to inspect versions and provenance.</p>
        </div>
      )}
    </aside>
  );
}

function ArtifactPreviewView({
  preview,
  stageAnnotation,
}: {
  preview: ArtifactPreview;
  stageAnnotation: (target: Annotation["target"], note: string) => Promise<void>;
}) {
  if (preview.kind === "figure") {
    return (
      <section className="figure-preview">
        <header>
          <strong>{preview.title}</strong>
          <button onClick={() => void stageAnnotation({ type: "image_point", x: 68, y: 74 }, "Increase label halo here.")}>
            <Plus size={15} />
            Comment
          </button>
        </header>
        <div className="scatter">
          {preview.points.map((point, index) => (
            <span
              key={index}
              className="plot-point"
              style={{ left: `${point.x}%`, top: `${point.y}%`, background: pointColors[point.group] ?? "#0f766e" }}
            />
          ))}
          {preview.callouts.map((callout) => (
            <button
              key={callout.label}
              className={`callout ${callout.severity ?? "info"}`}
              style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
              onClick={() => void stageAnnotation({ type: "image_point", x: callout.x, y: callout.y }, `${callout.label} label needs attention.`)}
            >
              {callout.label}
            </button>
          ))}
        </div>
        <div className="legend">
          {preview.legend.map((group) => (
            <span key={group}>
              <i style={{ background: pointColors[group] }} />
              {group}
            </span>
          ))}
        </div>
      </section>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <section className="pdf-preview">
        {preview.pages.map((page) => (
          <article key={page.pageNumber} className="pdf-page">
            <span>Page {page.pageNumber}</span>
            <h2>{preview.title}</h2>
            <h3>{page.title}</h3>
            <div className="pdf-columns">
              {page.columns.map((column) => (
                <p key={column}>{column}</p>
              ))}
            </div>
            <button onClick={() => void stageAnnotation({ type: "pdf_region", page: page.pageNumber, rect: [34, 24, 52, 38] }, "Check this claim against execution log.")}>
              Add PDF region annotation
            </button>
            {page.figureCaption ? <footer>{page.figureCaption}</footer> : null}
          </article>
        ))}
      </section>
    );
  }

  if (preview.kind === "notebook") {
    return (
      <section className="notebook-preview">
        <header>
          <BookOpen size={17} />
          <strong>{preview.kernel.name}</strong>
          <span className={`live-pill ${preview.kernel.status}`}>{preview.kernel.status}</span>
        </header>
        {preview.cells.map((cell) => (
          <article key={cell.id} className={`notebook-cell ${cell.status}`}>
            <span>[{cell.executionCount}] {cell.language}</span>
            <pre>{cell.source}</pre>
            <code>{cell.output}</code>
          </article>
        ))}
      </section>
    );
  }

  if (preview.kind === "table") {
    return (
      <section className="table-preview">
        <table>
          <thead>
            <tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (preview.kind === "code") {
    return (
      <section className="code-preview">
        <span>{preview.language}</span>
        <pre>
          {preview.code.split("\n").map((line, index) => (
            <button
              key={`${line}-${index}`}
              onClick={() => void stageAnnotation({ type: "code_line", line: index + 1, quote: line }, `Review line ${index + 1}.`)}
            >
              <em>{index + 1}</em>
              <code>{line}</code>
            </button>
          ))}
        </pre>
      </section>
    );
  }

  if (preview.kind === "environment") {
    return (
      <section className="environment-preview">
        <strong>Python {preview.snapshot.python}</strong>
        <p>{preview.snapshot.cwd}</p>
        {preview.snapshot.packages.map((pkg) => (
          <span key={pkg.name}>{pkg.name} {pkg.version}</span>
        ))}
      </section>
    );
  }

  if (preview.kind === "markdown") return <section className="markdown-preview">{preview.markdown}</section>;
  if (preview.kind === "review") return <ReviewFindings findings={preview.findings} />;
  if (preview.kind === "html") return <section className="html-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />;
  return <section className="markdown-preview">{preview.text}</section>;
}

function ProvenancePanel({
  provenance,
  tab,
  setTab,
}: {
  provenance?: ProvenanceRecord;
  tab: "messages" | "code" | "executionLog" | "environment" | "review";
  setTab: (tab: "messages" | "code" | "executionLog" | "environment" | "review") => void;
}) {
  if (!provenance) return <div className="empty-inspector">No provenance loaded.</div>;
  return (
    <section className="provenance-panel">
      <nav>
        {(["messages", "code", "executionLog", "environment", "review"] as const).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      {tab === "messages" && provenance.tabs.messages.map((item) => <code key={item.messageId}>{item.messageId}</code>)}
      {tab === "code" &&
        provenance.tabs.code.map((item) => (
          <article key={item.downloadUrl}>
            <strong>{item.language}</strong>
            <pre>{item.code ?? item.downloadUrl}</pre>
          </article>
        ))}
      {tab === "executionLog" &&
        provenance.tabs.executionLog.map((entry) => (
          <article key={entry.stepId} className="execution-record">
            <strong>{entry.kind} · exit {entry.exitCode}</strong>
            <pre>{entry.stdout}</pre>
            {entry.stderr ? <pre>{entry.stderr}</pre> : null}
            <span>{entry.durationMs} ms</span>
          </article>
        ))}
      {tab === "environment" && (
        <article className="environment-preview">
          <strong>Python {provenance.tabs.environment.python}</strong>
          <p>{provenance.tabs.environment.cwd}</p>
          {provenance.tabs.environment.git ? <p>{provenance.tabs.environment.git}</p> : null}
          {provenance.tabs.environment.packages.map((pkg) => (
            <span key={pkg.name}>{pkg.name} {pkg.version}</span>
          ))}
        </article>
      )}
      {tab === "review" && provenance.tabs.review.map((item) => <code key={item.findingId}>{item.findingId} · {item.severity}</code>)}
    </section>
  );
}

function SettingsInspector() {
  const { settings, connectors, skills, specialists, permissions, revokePermission, updateSettings } = useWorkspaceStore();
  if (!settings) return null;
  return (
    <aside className="inspector settings-inspector">
      <header className="inspector-header">
        <div>
          <span className="eyebrow">Settings</span>
          <h3>Adapter catalogs</h3>
        </div>
        <Settings size={22} />
      </header>
      <section>
        <h4>General</h4>
        <label className="toggle-row">
          <span>Notifications</span>
          <input type="checkbox" checked={settings.notifications} onChange={(event) => void updateSettings({ notifications: event.target.checked })} />
        </label>
        <label className="toggle-row">
          <span>Project memory</span>
          <input type="checkbox" checked={settings.memoryEnabled} onChange={(event) => void updateSettings({ memoryEnabled: event.target.checked })} />
        </label>
      </section>
      <section>
        <h4>Permissions</h4>
        {Object.values(permissions).map((permission) => (
          <div key={permission.id} className="settings-row">
            <span>{permission.title}</span>
            <em>{permission.status}</em>
            <button onClick={() => void revokePermission(permission.id)}>Revoke</button>
          </div>
        ))}
      </section>
      <Catalog title="Connectors" items={connectors} />
      <Catalog title="Skills" items={skills} />
      <Catalog title="Specialists" items={specialists} />
      <section>
        <h4>Network allowlist</h4>
        {settings.networkAllowlist.map((host) => <code key={host}>{host}</code>)}
      </section>
    </aside>
  );
}

function Catalog({ title, items }: { title: string; items: Array<{ id: string; name: string; description?: string; status?: string; enabled?: boolean; policy?: string }> }) {
  return (
    <section>
      <h4>{title}</h4>
      {items.map((item) => (
        <div key={item.id} className="settings-row">
          <span>{item.name}</span>
          <em>{item.status ?? (item.enabled ? "enabled" : "disabled")}</em>
          <small>{item.description ?? item.policy}</small>
        </div>
      ))}
    </section>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useWorkspaceStore();
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button key={toast.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={() => dismissToast(toast.id)}>
            {toast.text}
            <X size={14} />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

function kindIcon(kind: ArtifactMetadata["kind"]) {
  if (kind === "figure") return <Sparkles size={14} />;
  if (kind === "pdf") return <FileText size={14} />;
  if (kind === "notebook") return <BookOpen size={14} />;
  if (kind === "table") return <Table2 size={14} />;
  if (kind === "code") return <Terminal size={14} />;
  if (kind === "review") return <Brain size={14} />;
  return <MoreHorizontal size={14} />;
}

function filterFiles(nodes: FileNode[], query: string): FileNode[] {
  if (!query.trim()) return nodes;
  const result: FileNode[] = [];
  for (const node of nodes) {
    const children = node.children ? filterFiles(node.children, query) : [];
    const matches = node.name.toLowerCase().includes(query.toLowerCase());
    if (matches || children.length) {
      result.push(children.length ? { ...node, children } : { ...node });
    }
  }
  return result;
}
