export type ProjectId = string;
export type SessionId = string;
export type MessageId = string;
export type ArtifactId = string;
export type VersionId = string;
export type PermissionId = string;
export type AnnotationId = string;
export type TrackId = string;
export type JobId = string;

export type SessionGroup = "active" | "today" | "all";
export type SessionStatus = "idle" | "running" | "reviewing" | "blocked" | "completed" | "failed";

export interface ProjectSnapshot {
  projectId: ProjectId;
  name: string;
  description: string;
  current?: boolean;
  rootPath?: string;
  updatedAt: string;
}

export interface SessionSnapshot {
  sessionId: SessionId;
  projectId: ProjectId;
  title: string;
  group: SessionGroup;
  status: SessionStatus;
  unread?: number;
  summary: string;
  updatedAt: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool" | "reviewer";

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "artifact_ref"; artifactId: ArtifactId; versionId?: VersionId; label?: string }
  | { type: "session_ref"; sessionId: SessionId; label?: string }
  | { type: "upload_ref"; uploadId: string; label?: string }
  | { type: "skill_ref"; skillId: string; label?: string }
  | { type: "tool"; toolId: string }
  | { type: "plan"; planId: string }
  | { type: "permission"; permissionId: PermissionId }
  | { type: "review"; findingIds: string[] }
  | { type: "track"; trackId: TrackId }
  | { type: "remote_job"; jobId: JobId };

export interface Message {
  messageId: MessageId;
  sessionId: SessionId;
  role: MessageRole;
  parts: MessagePart[];
  status?: "streaming" | "completed" | "failed";
  annotationIds?: AnnotationId[];
  createdAt: string;
}

export type PermissionType =
  | "folder_access"
  | "python"
  | "shell"
  | "install_package"
  | "network_host"
  | "connector"
  | "remote_job"
  | "external_directory"
  | "credential";

export type PermissionScope = "once" | "conversation" | "project" | "global";
export type PermissionDecision = "approve" | "deny";
export type Risk = "low" | "medium" | "high";

export interface PermissionRequest {
  id: PermissionId;
  sessionId: SessionId;
  type: PermissionType;
  title: string;
  summary: string;
  details: Record<string, string | number | boolean>;
  scopes: PermissionScope[];
  recommendedScope: PermissionScope;
  risk: Risk;
  status?: "pending" | "approved" | "denied";
  createdAt: string;
}

export type ArtifactKind =
  | "figure"
  | "pdf"
  | "markdown"
  | "notebook"
  | "table"
  | "code"
  | "environment"
  | "review"
  | "html"
  | "unknown";

export interface ArtifactMetadata {
  id: ArtifactId;
  projectId: ProjectId;
  sessionId: SessionId;
  kind: ArtifactKind;
  name: string;
  currentVersionId: VersionId;
  mimeType: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  artifactId: ArtifactId;
  versionId: VersionId;
  label: string;
  createdAt: string;
  authorMessageId?: MessageId;
  preview: ArtifactPreview;
}

export type ArtifactPreview =
  | { kind: "figure"; title: string; points: PlotPoint[]; callouts: PlotCallout[]; legend: string[] }
  | { kind: "pdf"; title: string; pages: PdfPage[] }
  | { kind: "markdown"; markdown: string }
  | { kind: "notebook"; kernel: KernelState; cells: NotebookCell[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "code"; language: string; code: string }
  | { kind: "environment"; snapshot: EnvironmentSnapshot }
  | { kind: "review"; findings: ReviewerFinding[] }
  | { kind: "html"; html: string }
  | { kind: "unknown"; text: string };

export interface PlotPoint {
  x: number;
  y: number;
  group: string;
}

export interface PlotCallout {
  x: number;
  y: number;
  label: string;
  severity?: "info" | "warning";
}

export interface PdfPage {
  pageNumber: number;
  title: string;
  columns: string[];
  figureCaption?: string;
}

export interface NotebookCell {
  id: string;
  executionCount: number;
  language: "python" | "r" | "bash";
  source: string;
  output: string;
  status: "idle" | "running" | "completed" | "failed";
}

export interface KernelState {
  name: string;
  status: "offline" | "starting" | "live" | "busy";
  sharedWithAgent: boolean;
}

export interface EnvironmentSnapshot {
  python: string;
  packages: Array<{ name: string; version: string }>;
  cwd: string;
  git?: string;
  resources?: string;
}

export interface ProvenanceRecord {
  artifactId: ArtifactId;
  versionId: VersionId;
  tabs: {
    messages: Array<{ messageId: MessageId }>;
    code: Array<{ language: string; downloadUrl: string; code?: string }>;
    executionLog: Array<{
      stepId: string;
      kind: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      durationMs?: number;
    }>;
    environment: EnvironmentSnapshot;
    review: Array<{ findingId: string; severity: ReviewerFinding["severity"] }>;
  };
}

export interface Annotation {
  annotationId: AnnotationId;
  artifactId: ArtifactId;
  versionId: VersionId;
  sessionId: SessionId;
  target:
    | { type: "text"; quote: string }
    | { type: "code_line"; line: number; quote: string }
    | { type: "image_point"; x: number; y: number }
    | { type: "pdf_region"; page: number; rect: [number, number, number, number] }
    | { type: "html_element"; selector: string };
  note: string;
  status: "staged" | "committed";
  createdAt: string;
}

export interface ReviewerFinding {
  findingId: string;
  sessionId: SessionId;
  artifactId?: ArtifactId;
  versionId?: VersionId;
  severity: "info" | "warning" | "error";
  claim: string;
  evidence: string;
  recommendation: string;
  status: "open" | "acknowledged" | "resolved";
}

export interface ToolEvent {
  toolId: string;
  sessionId: SessionId;
  kind: "python" | "shell" | "network" | "notebook" | "review";
  title: string;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  status: "running" | "completed" | "failed";
  createdAt: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "blocked";
}

export interface PlanState {
  planId: string;
  sessionId: SessionId;
  title: string;
  summary: string;
  status: "proposed" | "approved" | "running" | "completed" | "blocked";
  steps: PlanStep[];
}

export interface Track {
  trackId: TrackId;
  sessionId: SessionId;
  title: string;
  status: "queued" | "running" | "completed" | "stopped" | "failed";
  messages: string[];
  progress: number;
}

export interface RemoteJob {
  jobId: JobId;
  sessionId: SessionId;
  title: string;
  status: "queued" | "running" | "completed" | "failed";
  logs: string[];
  artifactIds: ArtifactId[];
}

export interface Settings {
  theme: "bio-lab-glass";
  defaultProjectId: ProjectId;
  notifications: boolean;
  rightPanelBehavior: "pin" | "auto";
  networkAllowlist: string[];
  memoryEnabled: boolean;
  storageRetentionDays: number;
}

export interface Connector {
  id: string;
  name: string;
  status: "connected" | "available" | "disabled";
  description: string;
}

export interface Skill {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
}

export interface Specialist {
  id: string;
  name: string;
  policy: string;
  enabled: boolean;
}

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "folder";
  children?: FileNode[];
}

export interface AdapterSnapshots {
  projects: ProjectSnapshot[];
  sessions: SessionSnapshot[];
  messages: Record<SessionId, Message[]>;
  artifacts: Record<SessionId, ArtifactMetadata[]>;
  versions: Record<ArtifactId, ArtifactVersion[]>;
  provenance: Record<string, ProvenanceRecord>;
  permissions: PermissionRequest[];
  annotations: Annotation[];
  plans: Record<SessionId, PlanState>;
  tracks: Record<SessionId, Track[]>;
  jobs: Record<SessionId, RemoteJob[]>;
  settings: Settings;
  connectors: Connector[];
  skills: Skill[];
  specialists: Specialist[];
  files: FileNode[];
}

export interface WsCommandEnvelope<TPayload = unknown> {
  type: "command";
  requestId: string;
  command: AdapterCommandName;
  payload: TPayload;
}

export interface WsAckEnvelope {
  type: "ack";
  requestId: string;
}

export interface WsEventEnvelope<TPayload = unknown> {
  type: "event";
  eventId: string;
  seq: number;
  sessionId?: SessionId;
  name: AdapterEventName;
  payload: TPayload;
}

export interface WsErrorEnvelope {
  type: "error";
  requestId: string;
  code: string;
  message: string;
}

export type WsEnvelope = WsAckEnvelope | WsEventEnvelope | WsErrorEnvelope;

export type AdapterCommandName =
  | "project.select"
  | "session.create"
  | "session.open"
  | "session.sendMessage"
  | "session.stop"
  | "permission.respond"
  | "plan.approve"
  | "plan.requestRevision"
  | "plan.propose"
  | "plan.recordStepResult"
  | "artifact.open"
  | "artifact.star"
  | "artifact.rename"
  | "artifact.delete"
  | "artifact.downloadUrl"
  | "annotation.stage"
  | "annotation.discard"
  | "annotation.commitWithMessage"
  | "reviewer.run"
  | "track.spawn"
  | "track.update"
  | "track.stop"
  | "remoteJob.submit"
  | "remoteJob.update"
  | "remoteJob.appendLog"
  | "settings.update";

export type AdapterEventName =
  | "session.created"
  | "session.updated"
  | "session.statusChanged"
  | "message.created"
  | "message.delta"
  | "message.completed"
  | "message.failed"
  | "tool.started"
  | "tool.output"
  | "tool.completed"
  | "tool.failed"
  | "permission.requested"
  | "permission.resolved"
  | "plan.proposed"
  | "plan.updated"
  | "plan.approved"
  | "plan.stepStarted"
  | "plan.stepCompleted"
  | "plan.completed"
  | "artifact.created"
  | "artifact.versionCreated"
  | "artifact.updated"
  | "artifact.deleted"
  | "annotation.staged"
  | "annotation.committed"
  | "review.started"
  | "review.findings"
  | "review.completed"
  | "track.created"
  | "track.statusChanged"
  | "track.message"
  | "track.completed"
  | "runtime.statusChanged"
  | "remoteJob.submitted"
  | "remoteJob.statusChanged"
  | "remoteJob.logAppended";
