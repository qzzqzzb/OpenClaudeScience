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
  | "artifact.opened"
  | "artifact.downloadUrlCreated"
  | "artifact.updated"
  | "artifact.deleted"
  | "annotation.staged"
  | "annotation.discarded"
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

export type ClientCommandName =
  | "project.select"
  | "session.create"
  | "session.open"
  | "session.sendMessage"
  | "session.stop"
  | "permission.respond"
  | "plan.propose"
  | "plan.approve"
  | "plan.requestRevision"
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

export type ClientCommandEnvelope = {
  type: "command";
  requestId: string;
  command: ClientCommandName;
  payload?: unknown;
};

export type AckEnvelope = {
  type: "ack";
  requestId: string;
};

export type ErrorEnvelope = {
  type: "error";
  requestId?: string;
  code: string;
  message: string;
  details?: unknown;
};

export type EventEnvelope = {
  type: "event";
  eventId: string;
  seq: number;
  sessionId?: string;
  name: AdapterEventName;
  payload: unknown;
};

export type ServerEnvelope = AckEnvelope | ErrorEnvelope | EventEnvelope;

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "artifact_ref"; artifactId: string; versionId?: string }
  | { type: "session_ref"; sessionId: string }
  | { type: "upload_ref"; uploadId: string }
  | { type: "skill_ref"; skillId: string };

export type AdapterMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "unknown";
  status: "completed" | "running" | "error" | "unknown";
  parts: AdapterMessagePart[];
  createdAt?: string;
  completedAt?: string;
  error?: PublicError;
};

export type AdapterMessagePart =
  | {
      id: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      type: "unsupported";
    };

export type PublicError = {
  code: string;
  message: string;
};

export type ExecutionLogRecord = {
  stepId: string;
  sessionId: string;
  kind: string;
  tool: string;
  title?: string;
  input?: Record<string, unknown>;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  status: "running" | "completed" | "failed";
  error?: PublicError;
  startedAt: string;
  completedAt?: string;
};

export type PermissionScope = "once" | "conversation" | "project" | "global";
export type PermissionDecision = "approve" | "deny";
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
